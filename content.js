// content.js

// Constants
const BANNER_ID = 'ezproxy-banner';
const SECONDARY_BANNER_ID = 'ezproxy-secondary-banner';
const STORAGE_KEYS = {
    DISMISSED_DOMAINS: 'ezproxy-dismissed-domains',
    AUTO_REDIRECT: 'ezproxy-auto-redirect'
};

// Global variable to track if we've initialized
let isInitialized = false;

// Global list of exception domains loaded from domain-list.json
let EXCEPTION_DOMAINS = [];

// Check if user has reduced motion preference
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Cache for configuration
let configCache = null;
/**
 * Gets the current configuration from the background script
 * @returns {Promise<Object>} The configuration object
 */
async function getConfig() {
    // Return cached config if available
    if (configCache) {
        return configCache;
    }
    
    try {
        // Request configuration from background script
        const response = await chrome.runtime.sendMessage({ type: 'GET_CONFIG' });
        if (response && response.config) {
            configCache = response.config;
            return configCache;
        }
        throw new Error('Invalid configuration received');
    } catch (error) {
        console.error('Failed to load configuration:', error);
        // Return a minimal safe default config
        return {
            institutionName: 'Institution',
            accessIndicators: ['access provided by', 'authenticated via', 'logged in as'],
            bannerMessage: 'This resource is available through your institution. Access the full content via EZProxy.'
        };
    }
}

/**
 * Gets the domain list from the local file
 * @returns {Promise<Array>} Array of domains
 */
async function getDomainList() {
    try {
        console.log('Fetching domain list...');
        const url = chrome.runtime.getURL('domain-list.json');
        console.log('Domain list URL:', url);
        
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`Failed to fetch domain list: ${response.status} ${response.statusText}`);
        }
        
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            console.warn('Unexpected content type:', contentType);
        }
        
        const data = await response.json();

        // Handle legacy array format or new object format
        let domainArray = [];
        if (Array.isArray(data)) {
            domainArray = data;
            EXCEPTION_DOMAINS = [];
        } else if (data && Array.isArray(data.domains)) {
            domainArray = data.domains;
            EXCEPTION_DOMAINS = Array.isArray(data.exceptions) ? data.exceptions : [];
        }

        console.log('Domain list loaded. Domains:', domainArray.length, 'Exceptions:', EXCEPTION_DOMAINS.length);
        return domainArray;
    } catch (error) {
        console.error('Error loading domain list:', error);
        // Try to load a backup list from storage (legacy array only)
        try {
            const result = await chrome.storage.local.get('ezproxy-domain-list-backup');
            const backupList = result['ezproxy-domain-list-backup'];
            console.log('Using backup domain list from storage:', backupList ? backupList.length : 0, 'entries');
            EXCEPTION_DOMAINS = [];
            return Array.isArray(backupList) ? backupList : [];
        } catch (storageError) {
            console.error('Failed to load backup domain list:', storageError);
            EXCEPTION_DOMAINS = [];
            return [];
        }
    }
}

/**
 * Checks if the current page indicates institutional access
 * @param {Object} config - The configuration object
 * @returns {boolean} True if institutional access is detected
 */
async function hasInstitutionalAccess(config) {
    console.log('[hasInstitutionalAccess] Checking if user has institutional access');
    
    if (!config) {
        console.warn('[hasInstitutionalAccess] No config provided');
        return false;
    }
    
    // Get current domain to check for special cases
    const currentHostname = window.location.hostname.toLowerCase();
    
    // // IMPORTANT: For Nature and Chronicle, we'll return false to ensure the banner shows
    // // This is a temporary fix to ensure consistent banner display
    // if (currentHostname.includes('nature.com') || currentHostname.includes('chronicle.com')) {
    //     console.log(`[hasInstitutionalAccess] Special case for ${currentHostname}: forcing banner display`);
    //     return false;
    // }
    
    // Enhanced page text extraction with multiple methods
    let pageText = '';
    
    try {
        // Method 1: Direct textContent extraction
        pageText = document.body?.textContent || document.documentElement?.textContent || '';
        
        // Method 2: If text is empty or very short, try getting text from main content areas
        if (!pageText || pageText.length < 100) {
            console.log('[hasInstitutionalAccess] Direct text extraction yielded limited content, trying content areas');
            const contentSelectors = [
                'main', 'article', '.content', '.article', '#content', '#main', 
                '[role="main"]', '[role="article"]', '.page-content'
            ];
            
            for (const selector of contentSelectors) {
                const elements = document.querySelectorAll(selector);
                if (elements && elements.length > 0) {
                    for (const element of elements) {
                        pageText += ' ' + (element.textContent || '');
                    }
                }
            }
        }
        
        // Method 3: If still empty, try getting text from all paragraphs
        if (!pageText || pageText.length < 100) {
            console.log('[hasInstitutionalAccess] Content area extraction yielded limited content, trying paragraphs');
            const paragraphs = document.querySelectorAll('p');
            if (paragraphs && paragraphs.length > 0) {
                for (const p of paragraphs) {
                    pageText += ' ' + (p.textContent || '');
                }
            }
        }
        
        // Clean up the text
        pageText = pageText.trim();
    } catch (error) {
        console.error('[hasInstitutionalAccess] Error extracting page text:', error);
    }
    
    if (!pageText) {
        console.warn('[hasInstitutionalAccess] Could not get page text after multiple extraction attempts');
        // Don't return false immediately - continue with other checks
    }
    
    // Get institution details from config with defaults
    const instName = (config.institutionName || 'Institution').toLowerCase();
    const configDomain = (config.institutionDomain || 'example.edu').toLowerCase();
    const shortName = (config.institutionShortName || '').toLowerCase();
    const libraryName = (config.institutionLibraryName || '').toLowerCase();
    
    console.log('[hasInstitutionalAccess] Using institution:', instName, 'domain:', configDomain);
    
    // // Special case for Financial Times (ft.com)
    // if (currentHostname.includes('ft.com')) {
    //     console.log('[hasInstitutionalAccess] Financial Times website detected, performing detailed check');
        
    //     // Check if we need to wait for content to load
    //     const needsDelay = !pageText || pageText.length < 1000;
    //     if (needsDelay) {
    //         console.log('[hasInstitutionalAccess] FT content may not be fully loaded, adding delay checks');
            
    //         // Set a flag in sessionStorage to prevent infinite loops
    //         const checkCount = parseInt(sessionStorage.getItem('ft-check-count') || '0');
    //         if (checkCount < 3) { // Limit to 3 attempts
    //             // Increment the counter
    //             sessionStorage.setItem('ft-check-count', (checkCount + 1).toString());
                
    //             // Set a timeout to check again after content has had time to load
    //             setTimeout(() => {
    //                 console.log(`[hasInstitutionalAccess] Retrying FT check (attempt ${checkCount + 1}/3)`);
    //                 // Force a recheck
    //                 hasInstitutionalAccess(config);
    //             }, 1500); // 1.5 second delay
                
    //             // Return false for now, the timeout will trigger another check
    //             return false;
    //         } else {
    //             // Reset the counter after 3 attempts
    //             sessionStorage.removeItem('ft-check-count');
    //             console.log('[hasInstitutionalAccess] Maximum FT check attempts reached, proceeding with current content');
    //         }
    //     } else {
    //         // Content seems to be loaded, reset the counter
    //         sessionStorage.removeItem('ft-check-count');
    //     }
        
        // // Check for specific FT access elements
        // const ftAccessIndicators = [
        //     // Check for subscription/access buttons that indicate no institutional access
        //     { selector: '.o-header__top-link--subscribe', negative: true, description: 'Subscribe button' },
        //     { selector: '.o-header__top-button--primary', negative: true, description: 'Sign In button' },
        //     { selector: '.o-banner__outer', negative: true, description: 'Subscription banner' },
        //     { selector: '.n-messaging-banner', negative: true, description: 'Messaging banner' },
        //     { selector: '.n-messaging-banner__content', negative: true, description: 'Messaging banner content' },
        //     { selector: '.o-message', negative: true, description: 'Message component' },
        //     { selector: '.o-message__content-main', negative: true, description: 'Message content' },
        //     { selector: '.o-message__actions', negative: true, description: 'Message actions' },
            
        //     // Check for elements that indicate institutional access
        //     { selector: '.n-myft-ui--follow', negative: false, description: 'MyFT follow button (requires access)' },
        //     { selector: '.article__content', negative: false, description: 'Full article content' },
        //     { selector: '.n-content-body', negative: false, description: 'Article body content' },
        //     { selector: '.article-body', negative: false, description: 'Article body' },
        //     { selector: '.js-article__content', negative: false, description: 'JS article content' },
        //     { selector: '.js-article-body', negative: false, description: 'JS article body' },
        //     { selector: '.article__content-body', negative: false, description: 'Article content body' }
        // ];
        
        // let hasAccess = false;
        // let noAccess = false;
        
        // for (const indicator of ftAccessIndicators) {
        //     const elements = document.querySelectorAll(indicator.selector);
        //     if (elements && elements.length > 0) {
        //         console.log(`[hasInstitutionalAccess] Found FT ${indicator.description}: ${elements.length} elements`);
                
        //         if (indicator.negative) {
        //             // If this is a negative indicator (like subscribe button), it suggests no access
        //             noAccess = true;
        //         } else {
        //             // If this is a positive indicator, it suggests access
        //             hasAccess = true;
        //         }
        //     }
        // }
        
    //     // Check for paywall messaging
    //     const paywallText = [
    //         'subscribe to read', 
    //         'to continue reading', 
    //         'premium content', 
    //         'subscribe to the ft',
    //         'subscribe to continue reading',
    //         'start your trial',
    //         'free trial',
    //         'sign up to',
    //         'sign in to',
    //         'subscription required',
    //         'please subscribe',
    //         'for unlimited access',
    //         'to unlock this article',
    //         'to access this article',
    //         'already a subscriber? sign in',
    //         'already a subscriber? log in'
    //     ];
        
    //     const hasPaywall = paywallText.some(text => {
    //         const found = pageText.toLowerCase().includes(text);
    //         if (found) {
    //             console.log(`[hasInstitutionalAccess] Found FT paywall text: "${text}"`);
    //             return true;
    //         }
    //         return false;
    //     });
        
    //     if (hasPaywall) {
    //         console.log('[hasInstitutionalAccess] Detected paywall content on FT');
    //         noAccess = true;
    //     }
        
    //     // If we have clear indicators of access, return true
    //     if (hasAccess && !noAccess) {
    //         console.log('[hasInstitutionalAccess] Detected institutional access on FT based on page elements');
    //         return true;
    //     }
    // }
    
    // Check for common indicators of institutional access
    const accessIndicators = [
        // Generic access indicators
        'access provided by',
        'authenticated via',
        'logged in as',
        'institutional access',
        'institution=',
        `institution=${instName}`,
        `institution=${configDomain}`,
        // Institution-specific indicators (from config)
        instName,
        configDomain,
        shortName,
        // Generic full access indicators
        'you have full access',
        'full access available',
        'access to full text'
    ];
    
    // Add institution-specific phrases
    if (instName) {
        accessIndicators.push(`site license access provided by ${instName}`);
    }
    
    // Add library name if available
    if (libraryName) {
        accessIndicators.push(libraryName);
    } else if (instName) {
        // Fallback to institution name + libraries
        accessIndicators.push(`${instName} libraries`);
    }
    
    // Add any custom indicators from config
    if (Array.isArray(config.accessIndicators)) {
        accessIndicators.push(...config.accessIndicators.map(i => i.toLowerCase()));
    }
    
    // Add full access indicators from config
    if (Array.isArray(config.fullAccessIndicators)) {
        accessIndicators.push(...config.fullAccessIndicators.map(i => i.toLowerCase()));
    }
    
    // Log what we're checking for
    console.log('[hasInstitutionalAccess] Checking page for indicators:', accessIndicators);
    
    // Convert page text to lowercase once for case-insensitive search
    const normalizedPageText = pageText.toLowerCase();
    console.log('[hasInstitutionalAccess] Page text sample (first 500 chars):', 
        normalizedPageText.substring(0, 500).replace(/\s+/g, ' ').trim() + '...');
    
    // Check for access indicators in page text
    const foundIndicators = [];
    accessIndicators.forEach(indicator => {
        if (!indicator) return;
        const found = normalizedPageText.includes(indicator.toLowerCase());
        if (found) {
            foundIndicators.push(indicator);
            console.log(`[hasInstitutionalAccess] FOUND INDICATOR: "${indicator}" in page text`);
        }
    });
    
    if (foundIndicators.length > 0) {
        console.warn('[hasInstitutionalAccess] ⚠️  INSTITUTIONAL ACCESS DETECTED - BANNER WILL NOT SHOW');
        console.log('[hasInstitutionalAccess] Found access indicators:', foundIndicators);
        console.log('[hasInstitutionalAccess] Current URL:', window.location.href);
        console.log('[hasInstitutionalAccess] Page title:', document.title);
        return true;
    }
    
    // Additional check for EZProxy elements in the page
    const ezproxyElements = [
        ...Array.from(document.querySelectorAll('a[href*="ezproxy" i]')),
        ...Array.from(document.querySelectorAll('a[href*="proxy" i]')),
        ...Array.from(document.querySelectorAll('*')).filter(el => {
            const text = el.textContent?.toLowerCase() || '';
            return text.includes('ezproxy') || 
                   text.includes('proxy login') ||
                   text.includes('institutional login');
        })
    ];
    
    if (ezproxyElements.length > 0) {
        console.log(`[hasInstitutionalAccess] Found ${ezproxyElements.length} EZProxy related elements`);
        return true;
    }
    
    // Check for access denied or login required pages (more specific patterns)
    const deniedIndicators = [
        'access denied',
        'login required',
        'sign in',
        'log in', 
        'authentication required',
        'institutional access required',
        'subscription required',
        'subscribe',
        'register', 
    ];
    
    // Check each denied indicator and log what we find
    const foundDeniedIndicators = [];
    const isDeniedPage = deniedIndicators.some(indicator => {
        const found = normalizedPageText.includes(indicator.toLowerCase());
        if (found) {
            foundDeniedIndicators.push(indicator);
            console.log(`[hasInstitutionalAccess] FOUND DENIED INDICATOR: "${indicator}" in page text`);
        }
        return found;
    });
    
    if (isDeniedPage) {
        console.log('[hasInstitutionalAccess] 🚫 ACCESS DENIED/LOGIN PAGE DETECTED - BANNER SHOULD SHOW');
        console.log('[hasInstitutionalAccess] Found denied indicators:', foundDeniedIndicators);
        console.log('[hasInstitutionalAccess] Current URL:', window.location.href);
        return false;
    }
    
    console.log('[hasInstitutionalAccess] ✅ NO institutional access indicators found - BANNER SHOULD SHOW');
    console.log('[hasInstitutionalAccess] Current URL:', window.location.href);
    console.log('[hasInstitutionalAccess] Page title:', document.title);
    return false;
}

async function isDomainDismissed(domain) {
    try {
        console.log('Checking if domain is dismissed:', domain);
        const result = await chrome.storage.local.get(STORAGE_KEYS.DISMISSED_DOMAINS);
        const dismissedDomains = result[STORAGE_KEYS.DISMISSED_DOMAINS] || [];
        console.log('Current dismissed domains:', dismissedDomains);
        
        // Check if the domain matches any in the dismissed list
        // using the same logic as in popup.js
        const isDismissed = dismissedDomains.some(d => 
            domain.endsWith(d) || domain === d
        );
        
        console.log('Domain dismissed status:', isDismissed);
        return isDismissed;
    } catch (error) {
        console.error('Error checking dismissed domains:', error);
        return false;
    }
}


async function dismissDomain(domain) {
    try {
        console.log('Dismissing domain:', domain);
        const result = await chrome.storage.local.get(STORAGE_KEYS.DISMISSED_DOMAINS);
        const dismissedDomains = result[STORAGE_KEYS.DISMISSED_DOMAINS] || [];
        
        // Check if this exact domain or a parent domain is already in the list
        const existingDomain = dismissedDomains.find(d => 
            domain === d || domain.endsWith('.' + d)
        );
        
        if (existingDomain) {
            console.log('Domain or parent domain already in dismissed list:', existingDomain);
        } else {
            dismissedDomains.push(domain);
            console.log('Saving dismissed domains:', dismissedDomains);
            await chrome.storage.local.set({ [STORAGE_KEYS.DISMISSED_DOMAINS]: dismissedDomains });
        }
        
        // Notify the background script to update the icon
        try {
            // First try to get the current tab ID
            let tabId;
            
            // Method 1: Try using chrome.tabs if available
            if (chrome.tabs && chrome.tabs.query) {
                try {
                    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
                    if (tabs && tabs[0]?.id) {
                        tabId = tabs[0].id;
                    }
                } catch (e) {
                    console.warn('Could not get tab ID using chrome.tabs:', e);
                }
            }
            
            // Method 2: If we couldn't get tabId, use a message to the background script
            if (!tabId) {
                console.log('No tab ID available, using background script to update icon');
                await chrome.runtime.sendMessage({
                    action: 'dismissDomain',
                    domain: domain
                });
            } else {
                console.log('Updating icon for tab:', tabId);
                // Update the icon directly if we have the tab ID
                await chrome.runtime.sendMessage({
                    action: 'updateIcon',
                    tabId: tabId,
                    isDismissed: true
                });
                
                // Update badge if available
                if (chrome.action && chrome.action.setBadgeText) {
                    try {
                        await chrome.action.setBadgeText({
                            tabId: tabId,
                            text: 'X'
                        });
                        await chrome.action.setBadgeBackgroundColor({
                            tabId: tabId,
                            color: '#dc3545' // Red color
                        });
                    } catch (e) {
                        console.warn('Could not update badge:', e);
                    }
                }
            }
        } catch (e) {
            console.error('Error updating icon:', e);
        }
        
        return true;
    } catch (error) {
        console.error('Error saving dismissed domain:', error);
        return false;
    }
}

/**
 * Checks if auto-redirect is enabled in the extension settings
 * @returns {Promise<boolean>} True if auto-redirect is enabled
 */
async function shouldAutoRedirect() {
    try {
        const result = await chrome.storage.local.get(STORAGE_KEYS.AUTO_REDIRECT);
        // Return the stored value or default to false if not set
        return result[STORAGE_KEYS.AUTO_REDIRECT] === true;
    } catch (error) {
        console.error('Error checking auto-redirect setting:', error);
        // Default to false on error to avoid unwanted redirects
        return false;
    }
}

function adjustPageMargin(bannerHeight) {
    // Only adjust if there's no existing top margin/padding that might conflict
    const currentMargin = parseInt(getComputedStyle(document.body).marginTop) || 0;
    if (currentMargin < bannerHeight) {
        document.body.style.marginTop = bannerHeight + 'px';
    }
}

function restorePageMargin() {
    // Check if we need to restore the original margin
    const banner = document.getElementById(BANNER_ID);
    if (!banner) {
        document.body.style.marginTop = '';
    }
}

/**
 * Creates and displays a notification banner for EZProxy access
 * @param {string} message - The message to display in the banner
 * @param {string} ezproxyUrl - The URL to redirect to for EZProxy access
 * @param {string} domain - The domain that was matched
 * @returns {Promise<void>}
 */
async function createBanner(message, ezproxyUrl, domain) {
    // Get the current configuration
    const config = await getConfig();
    const bannerConfig = config.banner || {};
    
    // Remove existing banner if any
    const existingBanner = document.getElementById(BANNER_ID);
    if (existingBanner) {
        existingBanner.remove();
    }

    // Create banner elements
    const banner = document.createElement('div');
    banner.id = BANNER_ID;
    banner.setAttribute('role', 'banner');
    banner.setAttribute('aria-label', 'EZProxy access notification');
    
    // Base styles
    const baseStyles = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        background-color: ${bannerConfig.backgroundColor || '#f8f9fa'};
        color: ${bannerConfig.textColor || '#495057'};
        border-bottom: 1px solid ${bannerConfig.borderColor || '#dee2e6'};
        padding: ${bannerConfig.padding || '12px 20px'};
        display: flex;
        justify-content: space-between;
        align-items: center;
        z-index: ${bannerConfig.zIndex || '2147483647'};
        font-family: ${bannerConfig.fontFamily || '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'};
        box-shadow: ${bannerConfig.boxShadow || '0 2px 4px rgba(0,0,0,0.1)'};
        font-size: ${bannerConfig.fontSize || '14px'};
        line-height: ${bannerConfig.lineHeight || '1.5'};
    `;
    
    // Add animation styles if motion is not reduced
    const animationStyles = prefersReducedMotion ? '' : `
        transform: translateY(-100%);
        transition: transform ${bannerConfig.animationDuration || '0.3s'} ease-out;
    `;
    
    // Mobile responsive styles
    const mobileBreakpoint = bannerConfig.mobileBreakpoint || '768px';
    const responsiveStyles = `
        @media (max-width: ${mobileBreakpoint}) {
            flex-direction: column;
            gap: 10px;
            padding: 15px !important;
            text-align: center;
        }
    `;
    
    banner.style.cssText = baseStyles + animationStyles;
    
    // Add responsive styles
    if (!document.getElementById('ezproxy-banner-styles')) {
        const style = document.createElement('style');
        style.id = 'ezproxy-banner-styles';
        style.textContent = `
            #${BANNER_ID} ${responsiveStyles}
            #${BANNER_ID} .banner-buttons {
                display: flex;
                gap: 10px;
                align-items: center;
            }
            @media (max-width: 768px) {
                #${BANNER_ID} .banner-buttons {
                    justify-content: center;
                    width: 100%;
                }
                #${BANNER_ID} .banner-message {
                    margin-bottom: 5px;
                }
            }
        `;
        document.head.appendChild(style);
    }

    // Create message div
    const messageDiv = document.createElement('div');
    messageDiv.className = 'banner-message';
    messageDiv.textContent = message;
    messageDiv.style.cssText = `
        color: ${bannerConfig.textColor || '#495057'};
        flex: 1;
        margin-right: 15px;
    `;

    const buttonsDiv = document.createElement('div');
    buttonsDiv.className = 'banner-buttons';

    // Get button configurations with fallbacks
    const buttonConfig = bannerConfig.button || {};
    const dismissButtonConfig = bannerConfig.dismissButton || {};
    const closeButtonConfig = bannerConfig.closeButton || {};

    // Main redirect button
    const redirectButton = document.createElement('button');
    
    // Check if this is an exception domain and use appropriate button text
    const isExceptionDomain = sessionStorage.getItem('ezproxy-exception-domain') === 'true';
    if (isExceptionDomain) {
        // Use the stored button text or fallback to default
        const exceptionButtonText = sessionStorage.getItem('ezproxy-exception-button-text') || 'How to Access';
        const exceptionButtonAriaLabel = sessionStorage.getItem('ezproxy-exception-button-aria') || 
            'Learn how to access this resource through your library';
        
        redirectButton.textContent = exceptionButtonText;
        redirectButton.setAttribute('aria-label', exceptionButtonAriaLabel);
        
        // Clear the session storage items after using them
        sessionStorage.removeItem('ezproxy-exception-domain');
        sessionStorage.removeItem('ezproxy-exception-button-text');
        sessionStorage.removeItem('ezproxy-exception-button-aria');
    } else {
        redirectButton.textContent = buttonConfig.text || 'Access via EZProxy';
        redirectButton.setAttribute('aria-label', 'Access this resource via EZProxy');
    }
    
    // Apply button styles
    redirectButton.style.cssText = `
        background-color: ${buttonConfig.backgroundColor || '#0d6efd'};
        color: ${buttonConfig.textColor || '#ffffff'};
        border: none;
        padding: ${buttonConfig.padding || '8px 16px'};
        border-radius: ${buttonConfig.borderRadius || '4px'};
        cursor: pointer;
        font-size: ${bannerConfig.fontSize || '14px'};
        font-weight: 500;
        transition: all 0.2s ease;
    `;
    
    // Add hover and focus styles
    redirectButton.addEventListener('mouseenter', () => {
        redirectButton.style.backgroundColor = buttonConfig.hoverColor || '#0b5ed7';
        redirectButton.style.transform = 'translateY(-1px)';
    });
    
    redirectButton.addEventListener('mouseleave', () => {
        redirectButton.style.backgroundColor = buttonConfig.backgroundColor || '#0d6efd';
        redirectButton.style.transform = '';
    });
    
    redirectButton.addEventListener('focus', () => {
        redirectButton.style.outline = `2px solid ${buttonConfig.hoverColor || '#0b5ed7'}`;
        redirectButton.style.outlineOffset = '2px';
    });
    
    redirectButton.addEventListener('blur', () => {
        redirectButton.style.outline = '';
        redirectButton.style.outlineOffset = '';
    });
    
    redirectButton.addEventListener('click', () => {
        window.location.href = ezproxyUrl;
    });

    // Dismiss button (for domain)
    const dismissButton = document.createElement('button');
    dismissButton.textContent = dismissButtonConfig.text || 'Dismiss';
    dismissButton.setAttribute('aria-label', 'Dismiss this notification');
    
    // Apply dismiss button styles
    dismissButton.style.cssText = `
        background-color: ${dismissButtonConfig.backgroundColor || 'transparent'};
        color: ${dismissButtonConfig.textColor || '#6c757d'};
        border: 1px solid ${bannerConfig.borderColor || '#dee2e6'};
        padding: ${dismissButtonConfig.padding || '6px 12px'};
        border-radius: ${dismissButtonConfig.borderRadius || '4px'};
        margin-right: 10px;
        cursor: pointer;
        font-size: ${bannerConfig.fontSize || '14px'};
        transition: all 0.2s ease;
    `;
    
    // Add hover and focus styles for dismiss button
    dismissButton.addEventListener('mouseenter', () => {
        dismissButton.style.backgroundColor = dismissButtonConfig.hoverColor || '#e9ecef';
        dismissButton.style.borderColor = bannerConfig.borderColor || '#ced4da';
        dismissButton.style.transform = 'translateY(-1px)';
    });
    
    dismissButton.addEventListener('mouseleave', () => {
        dismissButton.style.backgroundColor = dismissButtonConfig.backgroundColor || 'transparent';
        dismissButton.style.borderColor = bannerConfig.borderColor || '#dee2e6';
        dismissButton.style.transform = '';
    });
    
    dismissButton.addEventListener('focus', () => {
        dismissButton.style.outline = `2px solid ${dismissButtonConfig.hoverColor || '#6c757d'}`;
        dismissButton.style.outlineOffset = '2px';
    });
    
    dismissButton.addEventListener('blur', () => {
        dismissButton.style.outline = '';
        dismissButton.style.outlineOffset = '';
    });
    
    dismissButton.addEventListener('click', async () => {
        await dismissDomain(domain);
        removeBanner();
    });
    
    // Close button (for current session only)
    const closeButton = document.createElement('button');
    closeButton.textContent = closeButtonConfig.text || '×';
    closeButton.setAttribute('aria-label', 'Close this notification');
    
    closeButton.style.cssText = `
        background: transparent;
        border: none;
        font-size: 20px;
        font-weight: bold;
        color: ${closeButtonConfig.color || '#6c757d'};
        cursor: pointer;
        padding: 0 0 0 10px;
        line-height: 1;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        transition: all 0.2s ease;
    `;
    
    closeButton.addEventListener('mouseenter', () => {
        closeButton.style.backgroundColor = closeButtonConfig.hoverColor || '#e9ecef';
        closeButton.style.color = closeButtonConfig.hoverColor || '#212529';
        closeButton.style.transform = 'scale(1.1)';
    });
    
    closeButton.addEventListener('mouseleave', () => {
        closeButton.style.backgroundColor = 'transparent';
        closeButton.style.color = closeButtonConfig.color || '#6c757d';
        closeButton.style.transform = '';
    });
    
    closeButton.addEventListener('focus', () => {
        closeButton.style.outline = `2px solid ${closeButtonConfig.hoverColor || '#6c757d'}`;
        closeButton.style.outlineOffset = '2px';
    });
    
    closeButton.addEventListener('blur', () => {
        closeButton.style.outline = '';
        closeButton.style.outlineOffset = '';
    });
    
    closeButton.addEventListener('click', removeBanner);

    // Keyboard navigation
    banner.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            removeBanner();
        }
    });

    // Assemble banner
    buttonsDiv.appendChild(redirectButton);
    buttonsDiv.appendChild(dismissButton);
    buttonsDiv.appendChild(closeButton);
    banner.appendChild(messageDiv);
    banner.appendChild(buttonsDiv);

    // Add banner to page
    document.body.insertBefore(banner, document.body.firstChild);

    // Animate in if motion is not reduced
    if (!prefersReducedMotion) {
        // Force reflow to ensure initial transform is applied
        banner.offsetHeight;
        banner.style.transform = 'translateY(0)';
    }

    // Adjust page margin to prevent content overlap
    const bannerHeight = banner.offsetHeight;
    adjustPageMargin(bannerHeight);

    // Set focus to the main button for accessibility
    setTimeout(() => {
        redirectButton.focus();
    }, prefersReducedMotion ? 0 : 100);
}

// Remove banner notification
async function removeBanner() {
    const banner = document.getElementById(BANNER_ID);
    if (!banner) return;
    
    const bannerConfig = (await getConfig()).banner || {};
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    
    if (prefersReducedMotion) {
        banner.remove();
        restorePageMargin();
    } else {
        banner.style.transition = `transform ${bannerConfig.animationDuration || '0.3s'} ease-out`;
        banner.style.transform = 'translateY(-100%)';
        
        // Use a promise to handle the animation end
        await new Promise(resolve => {
            banner.addEventListener('transitionend', () => resolve(), { once: true });
            // Fallback in case transitionend doesn't fire
            setTimeout(resolve, bannerConfig.animationDuration ? 
                (parseFloat(bannerConfig.animationDuration) * 1000) : 300);
        });
        
        banner.remove();
        restorePageMargin();
    }
    
    // Remove any keyboard focus from banner elements
    if (document.activeElement && document.activeElement.closest(`#${BANNER_ID}`)) {
        document.activeElement.blur();
    }
}

/**
 * Check if current URL is an EZProxy URL for an exception domain
 * @param {Object} config - The configuration object
 * @returns {Object|null} - Object with original domain if match found, null otherwise
 */
function checkEZProxyExceptionURL(config) {
    const currentHostname = window.location.hostname;
    
    // Check if we're on an EZProxy domain
    if (!config.ezproxyBaseUrl || !currentHostname.includes(config.ezproxyBaseUrl)) {
        return null;
    }
    
    // Sanitize ezproxyBaseUrl before using in RegExp
    const safeEzproxyBaseUrl = String(config.ezproxyBaseUrl).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Use static RegExp pattern to avoid security issues
    const ezproxyPattern = new RegExp('^([^.]+)\\.' + safeEzproxyBaseUrl);
    const match = currentHostname.match(ezproxyPattern);
    
    if (!match) {
        return null;
    }
    
    // Convert the transformed domain back to original format
    // www-example-com -> www.example.com
    const transformedDomain = match[1];
    const originalDomain = transformedDomain.replace(/-/g, '.');
    
    // Check if this original domain is in our exception list
    if (Array.isArray(EXCEPTION_DOMAINS)) {
        const matchedExceptionDomain = EXCEPTION_DOMAINS.find(exception => 
            originalDomain.includes(exception) || originalDomain === exception
        );
        
        if (matchedExceptionDomain) {
            return {
                originalDomain: originalDomain,
                exceptionDomain: matchedExceptionDomain
            };
        }
    }
    
    return null;
}

/**
 * Utility to extract the base domain (e.g., ft.com) from a hostname (e.g., www.ft.com)
 * @param {string} hostname
 * @returns {string} base domain
 */
function getBaseDomain(hostname) {
    // Remove port if present
    hostname = hostname.split(':')[0];
    // Split by dot
    const parts = hostname.split('.');
    if (parts.length <= 2) {
        return hostname;
    }
    // Return last two parts (handles most cases like www.ft.com -> ft.com)
    return parts.slice(-2).join('.');
}

/**
 * Create secondary help banner for EZProxy exception domains
 * @param {string} originalDomain - The original domain name
 * @param {string} helpUrl - The help URL with search parameter
 * @param {string} buttonText - Text for the help button
 */
async function createSecondaryBanner(originalDomain, helpUrl, buttonText) {
    const config = await getConfig();
    const bannerConfig = config.banner || {};
    
    // Remove existing secondary banner if any
    const existingBanner = document.getElementById(SECONDARY_BANNER_ID);
    if (existingBanner) {
        existingBanner.remove();
    }

    // Create secondary banner elements
    const banner = document.createElement('div');
    banner.id = SECONDARY_BANNER_ID;
    banner.setAttribute('role', 'banner');
    banner.setAttribute('aria-label', 'Library help information');
    
    // Base styles - similar to main banner but with different colors
    const baseStyles = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        background-color: #e8f4f8;
        color: #155e75;
        border-bottom: 1px solid #0891b2;
        padding: ${bannerConfig.padding || '12px 20px'};
        display: flex;
        justify-content: space-between;
        align-items: center;
        z-index: ${bannerConfig.zIndex || '2147483647'};
        font-family: ${bannerConfig.fontFamily || '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'};
        box-shadow: ${bannerConfig.boxShadow || '0 2px 4px rgba(0,0,0,0.1)'};
        font-size: ${bannerConfig.fontSize || '14px'};
        line-height: ${bannerConfig.lineHeight || '1.5'};
    `;
    
    // Add animation styles if motion is not reduced
    const animationStyles = prefersReducedMotion ? '' : `
        transform: translateY(-100%);
        transition: transform ${bannerConfig.animationDuration || '0.3s'} ease-out;
    `;
    
    banner.style.cssText = baseStyles + animationStyles;

    // Create message div
    const messageDiv = document.createElement('div');
    messageDiv.className = 'banner-message';
    messageDiv.textContent = `This site may require additional steps.  Please see the 'Info for this site' button.`;
    messageDiv.style.cssText = `
        color: #155e75;
        flex: 1;
        margin-right: 15px;
    `;

    const buttonsDiv = document.createElement('div');
    buttonsDiv.className = 'banner-buttons';
    buttonsDiv.style.cssText = `
        display: flex;
        gap: 10px;
        align-items: center;
    `;

    // Help button
    const helpButton = document.createElement('button');
    helpButton.textContent = buttonText;
    helpButton.setAttribute('aria-label', `Get help information for ${originalDomain}`);
    
    // Apply button styles
    helpButton.style.cssText = `
        background-color: #0891b2;
        color: #ffffff;
        border: none;
        padding: 8px 16px;
        border-radius: 4px;
        cursor: pointer;
        font-size: ${bannerConfig.fontSize || '14px'};
        font-weight: 500;
        transition: all 0.2s ease;
    `;
    
    // Add hover and focus styles
    helpButton.addEventListener('mouseenter', () => {
        helpButton.style.backgroundColor = '#0e7490';
        helpButton.style.transform = 'translateY(-1px)';
    });
    
    helpButton.addEventListener('mouseleave', () => {
        helpButton.style.backgroundColor = '#0891b2';
        helpButton.style.transform = '';
    });
    
    helpButton.addEventListener('focus', () => {
        helpButton.style.outline = '2px solid #0e7490';
        helpButton.style.outlineOffset = '2px';
    });
    
    helpButton.addEventListener('blur', () => {
        helpButton.style.outline = '';
        helpButton.style.outlineOffset = '';
    });
    
    helpButton.addEventListener('click', () => {
        window.open(helpUrl, '_blank');
    });

    // Close button
    const closeButton = document.createElement('button');
    closeButton.textContent = '×';
    closeButton.setAttribute('aria-label', 'Close this notification');
    
    closeButton.style.cssText = `
        background: transparent;
        border: none;
        font-size: 20px;
        font-weight: bold;
        color: #155e75;
        cursor: pointer;
        padding: 0 0 0 10px;
        line-height: 1;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        transition: all 0.2s ease;
    `;
    
    closeButton.addEventListener('mouseenter', () => {
        closeButton.style.backgroundColor = '#cffafe';
        closeButton.style.transform = 'scale(1.1)';
    });
    
    closeButton.addEventListener('mouseleave', () => {
        closeButton.style.backgroundColor = 'transparent';
        closeButton.style.transform = '';
    });
    
    closeButton.addEventListener('focus', () => {
        closeButton.style.outline = '2px solid #0e7490';
        closeButton.style.outlineOffset = '2px';
    });
    
    closeButton.addEventListener('blur', () => {
        closeButton.style.outline = '';
        closeButton.style.outlineOffset = '';
    });
    
    closeButton.addEventListener('click', removeSecondaryBanner);

    // Keyboard navigation
    banner.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            removeSecondaryBanner();
        }
    });

    // Assemble banner
    buttonsDiv.appendChild(helpButton);
    buttonsDiv.appendChild(closeButton);
    banner.appendChild(messageDiv);
    banner.appendChild(buttonsDiv);

    // Add banner to page
    document.body.insertBefore(banner, document.body.firstChild);

    // Animate in if motion is not reduced
    if (!prefersReducedMotion) {
        // Force reflow to ensure initial transform is applied
        banner.offsetHeight;
        banner.style.transform = 'translateY(0)';
    }

    // Adjust page margin to prevent content overlap
    const bannerHeight = banner.offsetHeight;
    adjustPageMargin(bannerHeight);

    // Set focus to the help button for accessibility
    setTimeout(() => {
        helpButton.focus();
    }, prefersReducedMotion ? 0 : 100);
}

/**
 * Remove secondary banner notification
 */
async function removeSecondaryBanner() {
    const banner = document.getElementById(SECONDARY_BANNER_ID);
    if (!banner) return;
    
    const bannerConfig = (await getConfig()).banner || {};
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    
    if (prefersReducedMotion) {
        banner.remove();
        restorePageMargin();
    } else {
        banner.style.transition = `transform ${bannerConfig.animationDuration || '0.3s'} ease-out`;
        banner.style.transform = 'translateY(-100%)';
        
        // Use a promise to handle the animation end
        await new Promise(resolve => {
            banner.addEventListener('transitionend', () => resolve(), { once: true });
            // Fallback in case transitionend doesn't fire
            setTimeout(resolve, bannerConfig.animationDuration ? 
                (parseFloat(bannerConfig.animationDuration) * 1000) : 300);
        });
        
        banner.remove();
        restorePageMargin();
    }
    
    // Remove any keyboard focus from banner elements
    if (document.activeElement && document.activeElement.closest(`#${SECONDARY_BANNER_ID}`)) {
        document.activeElement.blur();
    }
}

/**
 * Initialize the content script
 */
async function init() {
    if (isInitialized) return;
    
    // Ensure domain list and config are loaded before checking exception URL
    try {
        // Load config and domain list in parallel
        const [config] = await Promise.all([
            getConfig(),
            // Load domain list so EXCEPTION_DOMAINS is populated before we test
            getDomainList().catch(() => [])
        ]);

        // Check if we're on an EZProxy URL for an exception domain
        const ezproxyMatch = checkEZProxyExceptionURL(config);
        
        if (ezproxyMatch) {
            console.log('[init] Detected EZProxy exception URL for domain:', ezproxyMatch.originalDomain);
            // Create the help URL with the BASE domain as search parameter
            const libraryHelpUrl = config.libraryHelpUrl || 'https://library.example.edu/ask';
            const baseDomain = getBaseDomain(ezproxyMatch.originalDomain);
            const helpUrlWithSearch = `${libraryHelpUrl}${libraryHelpUrl.includes('?') ? '&' : '?'}q=${baseDomain}`;
            // Get the button text from config
            const buttonText = config.secondaryHelpButtonText || 'Info for this site';
            // Show the secondary banner
            await createSecondaryBanner(ezproxyMatch.originalDomain, helpUrlWithSearch, buttonText);
        }
    } catch (error) {
        console.error('[init] Error checking for EZProxy exception URL:', error);
    }
    
    // Listen for storage changes to update the banner when domains are undismissed
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' && changes.dismissedDomains) {
            // Remove existing banner if any
            const banner = document.getElementById(BANNER_ID);
            if (banner) {
                banner.remove();
                restorePageMargin();
            }
            
            // Re-check if we should show the banner
            const currentUrl = window.location.href;
            checkAndShowBanner(currentUrl);
        }
    });
    
    // IMPORTANT: Also check the current page for banner display
    // This serves as a fallback in case the background script message system fails
    console.log('[init] Checking current page for banner display...');
    try {
        const currentUrl = window.location.href;
        await checkAndShowBanner(currentUrl);
    } catch (error) {
        console.error('[init] Error checking current page for banner:', error);
    }
    
    isInitialized = true;
}

/**
 * Check if we should show the banner for the current URL and show it if needed
 * @param {string} url - The URL to check
 */
async function checkAndShowBanner(url) {
    console.log('[checkAndShowBanner] Starting check for URL:', url);
    
    if (!url || typeof url !== 'string') {
        console.error('[checkAndShowBanner] Invalid URL provided:', url);
        return;
    }
    
    try {
        // Step 1: Load configuration
        console.log('[checkAndShowBanner] Step 1: Loading configuration...');
        const config = await getConfig().catch(err => {
            console.error('[checkAndShowBanner] Failed to load config:', err);
            throw new Error('Failed to load extension configuration');
        });
        
        if (!config) {
            console.error('[checkAndShowBanner] No configuration loaded');
            return;
        }
        
        console.log('[checkAndShowBanner] Config loaded:', {
            institutionName: config.institutionName,
            ezproxyBaseUrl: config.ezproxyBaseUrl ? '***' : 'Not set',
            hasAccessIndicators: Array.isArray(config.accessIndicators) ? config.accessIndicators.length : 0
        });
        
        // Step 2: Load domain list
        console.log('[checkAndShowBanner] Step 2: Loading domain list...');
        const domainList = await getDomainList().catch(err => {
            console.error('[checkAndShowBanner] Failed to load domain list:', err);
            throw new Error('Failed to load domain list');
        });
        
        console.log(`[checkAndShowBanner] Domain list loaded with ${domainList.length} entries`);
        
        // Step 3: Parse and validate URL
        console.log('[checkAndShowBanner] Step 3: Parsing URL...');
        let domain;
        try {
            const urlObj = new URL(url);
            domain = urlObj.hostname;
            console.log('[checkAndShowBanner] Extracted domain:', domain);
            
            // Check for IP address (skip if it's an IP)
            if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(domain)) {
                console.log('[checkAndShowBanner] IP address detected, skipping banner check');
                return;
            }
        } catch (e) {
            console.error('[checkAndShowBanner] Invalid URL:', url, 'Error:', e);
            return;
        }
        
        // Step 4: Check domain against domain list
        console.log('[checkAndShowBanner] Step 4: Checking domain against domain list...');
        const matchedDomain = domainList.find(d => {
            const exactMatch = domain === d;
            const subdomainMatch = domain.endsWith('.' + d);
            console.log(`[checkAndShowBanner] Checking ${d}: exact=${exactMatch}, subdomain=${subdomainMatch}`);
            return exactMatch || subdomainMatch;
        });
        
        if (!matchedDomain) {
            console.log('[checkAndShowBanner] Domain not in list, updating icon to normal state');
            // Update icon to normal state for non-library domains
            try {
                const [tab] = await chrome.runtime.sendMessage({ action: 'getTab' });
                if (tab?.id) {
                    await chrome.runtime.sendMessage({
                        action: 'updateIcon',
                        tabId: tab.id,
                        isDismissed: false
                    });
                }
            } catch (e) {
                console.error('[checkAndShowBanner] Error updating icon for non-library domain:', e);
            }
            return;
        }
        
        console.log('[checkAndShowBanner] Matched domain in list:', matchedDomain);
        
        // Step 5: Check if domain is dismissed
        console.log('[checkAndShowBanner] Step 5: Checking if domain is dismissed...');
        const isDismissed = await isDomainDismissed(matchedDomain).catch(err => {
            console.error('[checkAndShowBanner] Error checking if domain is dismissed:', err);
            return false; // Default to not dismissed on error
        });
        
        if (isDismissed) {
            console.log('[checkAndShowBanner] Domain is dismissed, updating icon to dismissed state');
            try {
                const [tab] = await chrome.runtime.sendMessage({ action: 'getTab' });
                if (tab?.id) {
                    await chrome.runtime.sendMessage({
                        action: 'updateIcon',
                        tabId: tab.id,
                        isDismissed: true
                    });
                }
            } catch (e) {
                console.error('[checkAndShowBanner] Error updating icon for dismissed domain:', e);
            }
            return;
        }
        
        // Step 6: Check for institutional access
        console.log('[checkAndShowBanner] Step 6: Checking for institutional access...');
        try {
            const hasAccess = await hasInstitutionalAccess(config);
            
            if (hasAccess) {
                console.log('[checkAndShowBanner] User has institutional access, skipping EZProxy notification');
                return;
            }
            console.log('[checkAndShowBanner] No institutional access detected, proceeding with banner check');
        } catch (e) {
            console.error('[checkAndShowBanner] Error checking institutional access:', e);
            // Continue with banner display if we can't determine access
        }
        
        // Step 7: Double-check if domain was dismissed (race condition protection)
        console.log('[checkAndShowBanner] Step 7: Verifying domain is still not dismissed...');
        const isStillDismissed = await isDomainDismissed(matchedDomain).catch(() => false);
        if (isStillDismissed) {
            console.log('[checkAndShowBanner] Domain was dismissed during processing, aborting');
            return;
        }
        
        // Step 8: Prepare EZProxy URL
        console.log('[checkAndShowBanner] Step 8: Preparing EZProxy URL...');
        if (!config.ezproxyBaseUrl) {
            console.error('[checkAndShowBanner] No EZProxy base URL configured');
            return;
        }
        
        let ezproxyBase = config.ezproxyBaseUrl.trim();
        if (!ezproxyBase.endsWith('/')) {
            ezproxyBase = `${ezproxyBase}/`;
        }
        
        // Clean the target URL
        let targetUrl = url;
        const httpMatch = targetUrl.match(/^https?:\/\/(.*)/i);
        if (httpMatch) {
            targetUrl = httpMatch[1];
        }
        
        // Check if the domain is in the exceptions list
        const matchedExceptionDomain = EXCEPTION_DOMAINS.find(exception => 
            matchedDomain.includes(exception) || matchedDomain === exception
        );
        const isException = !!matchedExceptionDomain;
        
        let ezproxyUrl;
        let bannerMessage;
        let buttonText;
        let buttonAriaLabel;
        
        if (isException) {
            // For exceptions, create a URL to the library help page with the domain as a search parameter
            const libraryHelpUrl = config.libraryHelpUrl || 'https://library.example.edu/ask';
            const baseDomain = getBaseDomain(matchedDomain);
            const helpUrlWithSearch = `${libraryHelpUrl}${libraryHelpUrl.includes('?') ? '&' : '?'}q=${baseDomain}`;
            ezproxyUrl = helpUrlWithSearch;
            
            // Create a more specific message for the exception domain
            bannerMessage = `${matchedExceptionDomain} requires special access and cannot be accessed via standard EZProxy. Please visit your library's help page for assistance.`;
            buttonText = 'How to Access';
            buttonAriaLabel = 'Learn how to access this resource through your library';
            
            console.log(`[checkAndShowBanner] Domain ${matchedDomain} is an exception (${matchedExceptionDomain}). Using help URL:`, ezproxyUrl);
            
            // Store the exception information to modify the banner later
            sessionStorage.setItem('ezproxy-exception-domain', 'true');
            sessionStorage.setItem('ezproxy-exception-button-text', buttonText);
            sessionStorage.setItem('ezproxy-exception-button-aria', buttonAriaLabel);
        } else {
            // Standard EZProxy URL creation
            ezproxyUrl = `${ezproxyBase}${targetUrl}`;
            bannerMessage = `This resource is available through ${config.institutionName || 'your library'}. Access the full content via EZProxy.`;
            console.log('[checkAndShowBanner] Created standard EZProxy URL:', ezproxyUrl);
        }
        
        // Step 9: Create and show the banner
        console.log('[checkAndShowBanner] Step 9: Creating banner...');
        try {
            await createBanner(
                bannerMessage,
                ezproxyUrl,
                matchedDomain
            );
            console.log('[checkAndShowBanner] Banner creation completed successfully');
        } catch (e) {
            console.error('[checkAndShowBanner] Error creating banner:', e);
            throw e; // Re-throw to be caught by the outer try-catch
        }
    } catch (error) {
        console.error('[checkAndShowBanner] Unhandled error:', error);
        // Try to show a generic error banner if possible
        try {
            const errorBanner = document.createElement('div');
            errorBanner.style.position = 'fixed';
            errorBanner.style.top = '10px';
            errorBanner.style.right = '10px';
            errorBanner.style.padding = '10px';
            errorBanner.style.backgroundColor = '#ffebee';
            errorBanner.style.border = '1px solid #ef9a9a';
            errorBanner.style.borderRadius = '4px';
            errorBanner.style.zIndex = '100000';
            errorBanner.style.maxWidth = '300px';
            errorBanner.style.fontFamily = 'Arial, sans-serif';
            errorBanner.style.fontSize = '14px';
            
            // Create error content safely
            const errorTitle = document.createElement('div');
            errorTitle.style.fontWeight = 'bold';
            errorTitle.style.marginBottom = '5px';
            errorTitle.textContent = 'EZProxy Extension Error';
            
            const errorMessage = document.createElement('div');
            errorMessage.textContent = error.message || 'An unknown error occurred';
            
            const errorDetail = document.createElement('div');
            errorDetail.style.marginTop = '5px';
            errorDetail.style.fontSize = '12px';
            errorDetail.style.color = '#666';
            errorDetail.textContent = 'Check console for details';
            
            errorBanner.appendChild(errorTitle);
            errorBanner.appendChild(errorMessage);
            errorBanner.appendChild(errorDetail);
            document.body.appendChild(errorBanner);
            
            // Auto-remove after 10 seconds
            setTimeout(() => {
                if (document.body.contains(errorBanner)) {
                    errorBanner.remove();
                }
            }, 10000);
        } catch (e) {
            console.error('Could not display error banner:', e);
        }
    }
}

// Initialize when DOM is fully loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// Enhanced message listener with auto-redirect support
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'DOMAIN_MATCH') {
        console.log('[onMessage] Received DOMAIN_MATCH message for:', message.domain);
        
        // Process the message asynchronously but respond immediately
        // to prevent connection issues
        sendResponse({ received: true });
        
        // Use a promise chain to handle all the checks in sequence
        getConfig()
            .then(config => {
                // Store the config for later use
                const configData = config;
                
                // First check if the domain was dismissed
                return isDomainDismissed(message.domain)
                    .then(dismissed => {
                        if (dismissed) {
                            console.log('[onMessage] Domain was previously dismissed, skipping notification');
                            throw new Error('DOMAIN_DISMISSED');
                        }
                        return configData;
                    });
            })
            .then(config => {
                // Then check for institutional access
                return hasInstitutionalAccess(config)
                    .then(hasAccess => {
                        if (hasAccess) {
                            console.log('[onMessage] User has institutional access, skipping EZProxy notification');
                            throw new Error('HAS_INSTITUTIONAL_ACCESS');
                        }
                        return config;
                    })
                    .catch(err => {
                        if (err.message === 'HAS_INSTITUTIONAL_ACCESS') {
                            throw err;
                        }
                        // If there's an error checking access, continue with banner
                        console.warn('[onMessage] Error checking institutional access, proceeding with banner:', err);
                        return config;
                    });
            })
            .then(config => {
                // Then check for auto-redirect
                return shouldAutoRedirect()
                    .then(shouldRedirect => {
                        if (shouldRedirect) {
                            console.log('[onMessage] Auto-redirect enabled, redirecting to EZProxy');
                            window.location.href = message.ezproxyUrl;
                            throw new Error('AUTO_REDIRECTED');
                        }
                        return config;
                    });
            })
            .then(config => {
                // Finally, show the banner
                console.log('[onMessage] Showing banner for:', message.domain);
                createBanner(
                    message.bannerMessage || `This resource is available through ${config.institutionLibraryName || 'your library'}. Access the full content via EZProxy.`,
                    message.ezproxyUrl,
                    message.domain
                );
            })
            .catch(err => {
                // These are expected flow control errors, not actual errors
                if (!['DOMAIN_DISMISSED', 'HAS_INSTITUTIONAL_ACCESS', 'AUTO_REDIRECTED'].includes(err.message)) {
                    console.error('[onMessage] Error processing domain match:', err);
                }
            });
        
        // Return true to indicate we'll handle this asynchronously
        return true;
    }
});