// content.js

// console.log('[EZProxy DEBUG] Content script loaded at:', new Date().toISOString());

// Production logging helper - only logs in development mode
function debugLog(message, data = null) {
    try {
        // Only log in development or when debugging is explicitly enabled
        const isDebugMode = localStorage.getItem('ezproxy-debug') === 'true';
        if (isDebugMode) {
            if (data) {
                console.log(`[EZProxy] ${message}`, data);
            } else {
                console.log(`[EZProxy] ${message}`);
            }
        }
    } catch (e) {
        // Silently fail if logging fails
    }
}

// Debug console logging helper that respects debug mode
function debugConsole(message, ...args) {
    try {
        const isDebugMode = localStorage.getItem('ezproxy-debug') === 'true';
        if (isDebugMode) {
            console.log(message, ...args);
        }
    } catch (e) {
        // Silently fail if logging fails
    }
}

// Initialize extension logging
// console.log('[EZProxy DEBUG] Content script initialization:', {
//     url: window.location.href,
//     hostname: window.location.hostname,
//     timestamp: new Date().toISOString()
// });
debugLog('Content script loaded', {
    url: window.location.href,
    hostname: window.location.hostname,
    timestamp: new Date().toISOString()
});

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

// Global flag to track if institutional access was detected for this page
let institutionalAccessDetected = false;

// Global flag to prevent any banner operations while checking institutional access
let institutionalAccessCheckInProgress = false;

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
            accessIndicators: ['access provided by', 'authenticated via', 'logged in as','I have access via'],
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
        debugLog('Fetching domain list...');
        const url = chrome.runtime.getURL('domain-list.json');
        debugLog('Domain list URL:', url);
        
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

        debugLog('Domain list loaded. Domains:', domainArray.length, 'Exceptions:', EXCEPTION_DOMAINS.length);
        return domainArray;
    } catch (error) {
        console.error('Error loading domain list:', error);
        // Try to load a backup list from storage (legacy array only)
        try {
            const result = await chrome.storage.local.get('ezproxy-domain-list-backup');
            const backupList = result['ezproxy-domain-list-backup'];
            debugLog('Using backup domain list from storage:', backupList ? backupList.length : 0, 'entries');
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
    debugLog('[hasInstitutionalAccess] Checking if user has institutional access');
    
    // Reset the institutional access flag for this new check
    institutionalAccessDetected = false;
    
    // Set the check in progress flag to block other banner creation attempts
    institutionalAccessCheckInProgress = true;
    debugConsole('[EZProxy DEBUG] Setting institutionalAccessCheckInProgress = true');
    
    if (!config) {
        console.warn('[hasInstitutionalAccess] No config provided');
        institutionalAccessCheckInProgress = false;
        return false;
    }
    
    // Get current domain to check for special cases
    // const currentHostname = window.location.hostname.toLowerCase();
    
    // Enhanced page text extraction with multiple methods
    let pageText = '';
    
    try {
        // Method 1: Direct textContent extraction, but exclude extension banners
        let bodyElement = document.body || document.documentElement;
        if (bodyElement) {
            // Create a clone to avoid modifying the original DOM
            const bodyClone = bodyElement.cloneNode(true);
            
            // Remove extension banner elements from the clone
            const bannersToRemove = bodyClone.querySelectorAll(`#${BANNER_ID}, #${SECONDARY_BANNER_ID}`);
            bannersToRemove.forEach(banner => banner.remove());
            
            pageText = bodyClone.textContent || '';
        }
        
        // Method 2: If text is empty or very short, try getting text from main content areas
        if (!pageText || pageText.length < 100) {
            debugLog('[hasInstitutionalAccess] Direct text extraction yielded limited content, trying content areas');
            const contentSelectors = [
                'main', 'article', '.content', '.article', '#content', '#main', 
                '[role="main"]', '[role="article"]', '.page-content'
            ];
            
            for (const selector of contentSelectors) {
                const elements = document.querySelectorAll(selector);
                if (elements && elements.length > 0) {
                    for (const element of elements) {
                        // Create a clone and remove banner elements
                        const elementClone = element.cloneNode(true);
                        const bannersToRemove = elementClone.querySelectorAll(`#${BANNER_ID}, #${SECONDARY_BANNER_ID}`);
                        bannersToRemove.forEach(banner => banner.remove());
                        
                        pageText += ' ' + (elementClone.textContent || '');
                    }
                }
            }
        }
        
        // Method 3: If still empty, try getting text from all paragraphs
        if (!pageText || pageText.length < 100) {
            debugLog('[hasInstitutionalAccess] Content area extraction yielded limited content, trying paragraphs');
            const paragraphs = document.querySelectorAll('p');
            if (paragraphs && paragraphs.length > 0) {
                for (const p of paragraphs) {
                    // Skip paragraphs that are inside banner elements
                    if (p.closest(`#${BANNER_ID}, #${SECONDARY_BANNER_ID}`)) {
                        continue;
                    }
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
        debugLog('[hasInstitutionalAccess] Could not get page text after multiple extraction attempts');
        // Don't return false immediately - continue with other checks
    }
    
    // Get institution details from config with defaults
    const instName = (config.institutionName || 'Institution').toLowerCase();
    const configDomain = (config.institutionDomain || 'example.edu').toLowerCase();
    
    debugLog('[hasInstitutionalAccess] Using institution:', instName, 'domain:', configDomain);
    
    // Check if this is a domain we want to debug (can be enabled via localStorage)
    const debugHostname = window.location.hostname.toLowerCase();
    const isDebugMode = localStorage.getItem('ezproxy-debug') === 'true';
    
    // Check for VERY SPECIFIC indicators of institutional access
    // Only look for explicit, unambiguous access indicators to avoid false positives
    const accessIndicators = [
        // Only very specific access indicators that clearly indicate institutional access
        'access provided by',
        'authenticated via',
        'logged in as',
        'institutional access granted',
        'institution=',
        `institution=${instName}`,
        `institution=${configDomain}`,
        // Very specific institutional phrases
        `site license access provided by ${instName}`,
        `access through ${instName}`,
        `licensed to ${instName}`,
        'you are accessing this content through your institution',
        'institutional subscription',
        'institutional license',
        'I have access via'
    ];
    
    // Add any custom indicators from config (but only if explicitly configured)
    if (Array.isArray(config.accessIndicators)) {
        accessIndicators.push(...config.accessIndicators.map(i => i.toLowerCase()));
    }
    
    // Add full access indicators from config (but only if explicitly configured)
    if (Array.isArray(config.fullAccessIndicators)) {
        accessIndicators.push(...config.fullAccessIndicators.map(i => i.toLowerCase()));
    }
    
    // Add institution-specific combinations for better detection
    const institutionNames = [
        instName.toLowerCase(),
        (config.institutionDomain || '').toLowerCase(),
        (config.institutionShortName || '').toLowerCase(),
        (config.institutionLibraryName || '').toLowerCase()
    ].filter(name => name && name.length > 0);
    
    // Add combined phrases that indicate institutional access
    const accessPhrases = [
        'access provided by',
        'site license access provided by',
        'licensed to',
        'access through',
        'I have access via'
    ];
    
    // Create combinations of access phrases with institution names
    accessPhrases.forEach(phrase => {
        institutionNames.forEach(name => {
            accessIndicators.push(`${phrase} ${name}`);
        });
    });
    
    // Log what we're checking for
    debugLog('[hasInstitutionalAccess] Checking page for indicators:', accessIndicators);
    
    // TEMPORARY DEBUG: Always log key info for debugging
    debugConsole('[EZProxy DEBUG] Institution name:', instName);
    debugConsole('[EZProxy DEBUG] Number of access indicators to check:', accessIndicators.length);
    debugConsole('[EZProxy DEBUG] Sample indicators:', accessIndicators.slice(0, 5));
    
    // Convert page text to lowercase once for case-insensitive search
    const normalizedPageText = pageText.toLowerCase();
    debugLog('[hasInstitutionalAccess] Page text sample (first 500 chars):', 
        normalizedPageText.substring(0, 500).replace(/\s+/g, ' ').trim() + '...');
    
    // TEMPORARY DEBUG: Always log page text sample
    debugConsole('[EZProxy DEBUG] Page text length:', normalizedPageText.length);
    debugConsole('[EZProxy DEBUG] Page text sample:', normalizedPageText.substring(0, 300).replace(/\s+/g, ' ').trim());
    
    // Check for access indicators in page text
    const foundIndicators = [];
    debugConsole(`[EZProxy DEBUG] About to check ${accessIndicators.length} indicators against page text`);
    accessIndicators.forEach((indicator, index) => {
        if (!indicator) return;
        const found = normalizedPageText.includes(indicator.toLowerCase());
        if (found) {
            foundIndicators.push(indicator);
            debugConsole(`[EZProxy DEBUG] FOUND INDICATOR: "${indicator}" in page text`);
            debugLog(`[hasInstitutionalAccess] FOUND INDICATOR: "${indicator}" in page text`);
            
            // Show context around the found indicator for debugging
            const indicatorIndex = normalizedPageText.indexOf(indicator.toLowerCase());
            const contextStart = Math.max(0, indicatorIndex - 50);
            const contextEnd = Math.min(normalizedPageText.length, indicatorIndex + indicator.length + 50);
            const context = normalizedPageText.substring(contextStart, contextEnd);
            debugConsole(`[EZProxy DEBUG] CONTEXT: "...${context}..."`);
            debugLog(`[hasInstitutionalAccess] CONTEXT: "...${context}..."`);
        }
    });
    debugConsole(`[EZProxy DEBUG] Finished checking indicators. Found: ${foundIndicators.length}`);
    
    if (foundIndicators.length > 0) {
        debugLog('[hasInstitutionalAccess] ⚠️  INSTITUTIONAL ACCESS DETECTED - BANNER WILL NOT SHOW');
        debugLog('[hasInstitutionalAccess] Found access indicators:', foundIndicators);
        debugLog('[hasInstitutionalAccess] Current URL:', window.location.href);
        debugLog('[hasInstitutionalAccess] Page title:', document.title);
        debugLog('[hasInstitutionalAccess] Full page text length:', normalizedPageText.length);
        
        // Set global flag to prevent any banner creation
        institutionalAccessDetected = true;
        institutionalAccessCheckInProgress = false;
        debugConsole('[EZProxy DEBUG] Setting global institutionalAccessDetected = true');
        
        // Remove any existing banner that might already be on the page
        const existingBanner = document.getElementById(BANNER_ID);
        if (existingBanner) {
            debugConsole('[EZProxy DEBUG] Removing existing banner because institutional access detected');
            existingBanner.remove();
            restorePageMargin();
        }
        
        return true;
    }
    
    // Additional check for EZProxy elements in the page
    // Only look for actual EZProxy links/forms, not just mentions in content
    const ezproxyElements = [
        ...Array.from(document.querySelectorAll('a[href*="ezproxy"]')),
        ...Array.from(document.querySelectorAll('form[action*="ezproxy"]')),
        ...Array.from(document.querySelectorAll('input[name*="proxy"], input[value*="proxy login"]'))
    ];
    
    if (ezproxyElements.length > 0) {
        debugConsole(`[EZProxy DEBUG] Found ${ezproxyElements.length} EZProxy related elements on page`);
        debugConsole('[EZProxy DEBUG] EZProxy elements found:', ezproxyElements.slice(0, 3).map(el => el.tagName + ': ' + (el.textContent?.substring(0, 100) || el.href?.substring(0, 100) || 'no content')));
        debugLog(`[hasInstitutionalAccess] Found ${ezproxyElements.length} EZProxy related elements`);
        return true;
    }
    
    // Check for access denied or login required pages (only very specific patterns)
    const deniedIndicators = [
        'access denied',
        'login required',
        'authentication required',
        'institutional access required',
        'please log in to continue',
        'subscription required to view this content'
    ];
    
    // Check each denied indicator and log what we find
    const foundDeniedIndicators = [];
    const isDeniedPage = deniedIndicators.some(indicator => {
        const found = normalizedPageText.includes(indicator.toLowerCase());
        if (found) {
            foundDeniedIndicators.push(indicator);
            debugLog(`[hasInstitutionalAccess] FOUND DENIED INDICATOR: "${indicator}" in page text`);
        }
        return found;
    });
    
    if (isDeniedPage) {
        debugLog('[hasInstitutionalAccess] 🚫 ACCESS DENIED/LOGIN PAGE DETECTED - BANNER SHOULD SHOW');
        debugLog('[hasInstitutionalAccess] Found denied indicators:', foundDeniedIndicators);
        debugLog('[hasInstitutionalAccess] Current URL:', window.location.href);
        return false;
    }
    
    debugLog('[hasInstitutionalAccess] ✅ NO institutional access indicators found - BANNER SHOULD SHOW');
    debugLog('[hasInstitutionalAccess] Current URL:', window.location.href);
    debugLog('[hasInstitutionalAccess] Page title:', document.title);
    institutionalAccessCheckInProgress = false;
    return false;
}

async function isDomainDismissed(domain) {
    try {
        debugLog('Checking if domain is dismissed:', domain);
        const result = await chrome.storage.local.get(STORAGE_KEYS.DISMISSED_DOMAINS);
        const dismissedDomains = result[STORAGE_KEYS.DISMISSED_DOMAINS] || [];
        debugLog('Current dismissed domains:', dismissedDomains);
        
        // Check if the domain matches any in the dismissed list
        // using the same logic as in popup.js
        const isDismissed = dismissedDomains.some(d => 
            domain.endsWith(d) || domain === d
        );
        
        debugLog('Domain dismissed status:', isDismissed);
        return isDismissed;
    } catch (error) {
        console.error('Error checking dismissed domains:', error);
        return false;
    }
}


async function dismissDomain(domain) {
    try {
        debugLog('Dismissing domain:', domain);
        const result = await chrome.storage.local.get(STORAGE_KEYS.DISMISSED_DOMAINS);
        const dismissedDomains = result[STORAGE_KEYS.DISMISSED_DOMAINS] || [];
        
        // Check if this exact domain or a parent domain is already in the list
        const existingDomain = dismissedDomains.find(d => 
            domain === d || domain.endsWith('.' + d)
        );
        
        if (existingDomain) {
            debugLog('Domain or parent domain already in dismissed list:', existingDomain);
        } else {
            dismissedDomains.push(domain);
            debugLog('Saving dismissed domains:', dismissedDomains);
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
                debugLog('No tab ID available, using background script to update icon');
                await chrome.runtime.sendMessage({
                    action: 'dismissDomain',
                    domain: domain
                });
            } else {
                debugLog('Updating icon for tab:', tabId);
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
    debugLog('createBanner() function started', { domain });
    
    // FIRST: Check global flags
    if (institutionalAccessDetected) {
        debugConsole('[EZProxy DEBUG] createBanner: Global flag shows institutional access detected, aborting');
        return;
    }
    
    if (institutionalAccessCheckInProgress) {
        debugConsole('[EZProxy DEBUG] createBanner: Institutional access check in progress, waiting...');
        // Wait a bit and check again
        await new Promise(resolve => setTimeout(resolve, 100));
        if (institutionalAccessDetected) {
            debugConsole('[EZProxy DEBUG] createBanner: Institutional access detected while waiting, aborting');
            return;
        }
    }
    
    // Get the current configuration
    const config = await getConfig();
    
    // SECOND: Check for institutional access before creating any banner
    debugLog('Checking institutional access before creating banner');
    try {
        const hasAccess = await hasInstitutionalAccess(config);
        if (hasAccess) {
            debugLog('Institutional access detected, aborting banner creation');
            return; // Exit early without creating banner
        }
    } catch (error) {
        console.warn('Error checking institutional access in createBanner, proceeding with banner:', error);
    }
    
    const bannerConfig = config.banner || {};
    
    debugLog('createBanner: got config');
    
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
    
    // Base styles - START HIDDEN to prevent flash
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
        opacity: 0;
        visibility: hidden;
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

    // Add banner to page (still hidden)
    document.body.insertBefore(banner, document.body.firstChild);

    // FINAL CHECK: Verify no institutional access before showing banner
    debugConsole('[EZProxy DEBUG] Final institutional access check before showing banner');
    try {
        const finalAccessCheck = await hasInstitutionalAccess(config);
        if (finalAccessCheck) {
            debugConsole('[EZProxy DEBUG] Final check: Institutional access detected, removing banner immediately');
            banner.remove();
            return;
        }
    } catch (error) {
        console.warn('[EZProxy DEBUG] Error in final access check, proceeding with banner:', error);
    }

    // If we get here, no institutional access detected - show the banner
    debugConsole('[EZProxy DEBUG] Final check passed, showing banner');
    banner.style.opacity = '1';
    banner.style.visibility = 'visible';

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
    
    debugLog('createBanner: function completed successfully');
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
    
    // Use string methods instead of RegExp for security
    const ezproxyBaseUrl = config.ezproxyBaseUrl;
    const ezproxyDotPrefix = '.' + ezproxyBaseUrl;
    
    // Check if hostname ends with the ezproxy domain and get the subdomain part
    if (!currentHostname.endsWith(ezproxyDotPrefix)) {
        return null;
    }
    
    // Extract the subdomain part (everything before .ezproxy.domain)
    const transformedDomain = currentHostname.substring(0, currentHostname.length - ezproxyDotPrefix.length);
    const match = transformedDomain ? [currentHostname, transformedDomain] : null;
    
    if (!match) {
        return null;
    }
    
    // Convert the transformed domain back to original format
    // www-example-com -> www.example.com
    const extractedDomain = match[1];
    const originalDomain = extractedDomain.replace(/-/g, '.');
    
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
    debugLog('Content script starting', {
        url: window.location.href,
        hostname: window.location.hostname,
        readyState: document.readyState
    });
    
    if (isInitialized) {
        debugLog('Already initialized, skipping');
        return;
    }
    
    debugLog('Loading config and domain list');
    
    // Declare ezproxyMatch outside the try block so it's accessible later
    let ezproxyMatch = null;
    
    // Ensure domain list and config are loaded before checking exception URL
    try {
        // Load config and domain list in parallel
        const [config] = await Promise.all([
            getConfig(),
            // Load domain list so EXCEPTION_DOMAINS is populated before we test
            getDomainList().catch(() => [])
        ]);
        
        debugLog('Config and domain list loaded successfully');

        // Check if we're on an EZProxy URL for an exception domain
        ezproxyMatch = checkEZProxyExceptionURL(config);
        
        if (ezproxyMatch) {
            debugLog('EZProxy exception URL detected', { originalDomain: ezproxyMatch.originalDomain });
            // Create the help URL with the BASE domain as search parameter
            const libraryHelpUrl = config.libraryHelpUrl || 'https://library.example.edu/ask';
            const baseDomain = getBaseDomain(ezproxyMatch.originalDomain);
            const helpUrlWithSearch = `${libraryHelpUrl}${libraryHelpUrl.includes('?') ? '&' : '?'}q=${baseDomain}`;
            // Get the button text from config
            const buttonText = config.secondaryHelpButtonText || 'Info for this site';
            // Show the secondary banner
            await createSecondaryBanner(ezproxyMatch.originalDomain, helpUrlWithSearch, buttonText);
        } else {
            debugLog('No EZProxy exception URL detected');
        }
    } catch (error) {
        debugLog('Error in init config/domain loading', { error: error.message });
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
    
    // Check the current page for banner display
    // This serves as a fallback in case the background script message system fails
    // BUT only if we're not already showing a secondary banner for exception domains
    debugLog('Checking current page for banner display');
    try {
        const currentUrl = window.location.href;
        
        // If we showed a secondary banner for an exception domain, skip the regular banner check
        if (!ezproxyMatch) {
            debugLog('Calling checkAndShowBanner');
            await checkAndShowBanner(currentUrl);
        } else {
            debugLog('Skipping regular banner check - secondary banner shown for exception domain');
        }
    } catch (error) {
        debugLog('Error in checkAndShowBanner', { error: error.message });
        console.error('[init] Error checking current page for banner:', error);
    }
    
    debugLog('Init completed successfully');
    isInitialized = true;
}

/**
 * Check if we should show the banner for the current URL and show it if needed
 * @param {string} url - The URL to check
 */
async function checkAndShowBanner(url) {
    const callId = Math.random().toString(36).substr(2, 9);
    debugConsole(`[EZProxy DEBUG] checkAndShowBanner called with URL: ${url} [CALL-${callId}]`);
    debugLog('Starting banner check', { url });
    
    // FIRST: Check global flag immediately
    if (institutionalAccessDetected) {
        debugConsole(`[EZProxy DEBUG] checkAndShowBanner: Global flag already set, exiting [CALL-${callId}]`);
        return;
    }
    
    if (!url || typeof url !== 'string') {
        debugLog('Invalid URL provided', { url });
        return;
    }
    
    try {
        // Parse URL to get hostname
        let hostname;
        try {
            hostname = new URL(url).hostname.toLowerCase();
            debugLog('URL parsed successfully', { hostname });
            

        } catch (e) {
            debugLog('Failed to parse URL', { url, error: e.message });
            return;
        }
        // Step 1: Load configuration
        debugLog('Loading configuration');
        
        const config = await getConfig().catch(err => {
            debugLog('Failed to load config', { error: err.message });
            throw new Error('Failed to load extension configuration');
        });
        
        debugLog('Configuration loaded successfully');
        
        if (!config) {
            console.error('[checkAndShowBanner] No configuration loaded');
            return;
        }
        
        debugLog('[checkAndShowBanner] Config loaded:', {
            institutionName: config.institutionName,
            ezproxyBaseUrl: config.ezproxyBaseUrl ? '***' : 'Not set',
            hasAccessIndicators: Array.isArray(config.accessIndicators) ? config.accessIndicators.length : 0
        });
        
        // Step 2: Load domain list
        debugLog('Loading domain list');
        
        const domainList = await getDomainList().catch(err => {
            debugLog('Failed to load domain list', { error: err.message });
            throw new Error('Failed to load domain list');
        });
        
        debugLog('Domain list loaded successfully', { count: domainList.length });
        
        debugLog(`[checkAndShowBanner] Domain list loaded with ${domainList.length} entries`);
        
        // Step 3: Extract domain from URL
        let domain;
        try {
            const urlObj = new URL(url);
            domain = urlObj.hostname;
            debugLog('Extracted domain from URL', { domain });
            
            // Check for IP address (skip if it's an IP)
            if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(domain)) {
                debugLog('IP address detected, skipping banner check');
                return;
            }
        } catch (e) {
            debugLog('Invalid URL in domain extraction', { url, error: e.message });
            return;
        }
        
        // Step 4: Check domain against domain list
        debugConsole('[EZProxy DEBUG] Checking domain against domain list');
        debugConsole('[EZProxy DEBUG] Domain to match:', domain);
        debugConsole('[EZProxy DEBUG] Domain list length:', domainList.length);
        debugLog('[checkAndShowBanner] Step 4: Checking domain against domain list...');
        debugLog('[checkAndShowBanner] Domain to match:', domain);
        debugLog('[checkAndShowBanner] Domain list length:', domainList.length);
        

        
        const matchedDomain = domainList.find(d => {
            const exactMatch = domain === d;
            const subdomainMatch = domain.endsWith('.' + d);
            
            debugLog(`[checkAndShowBanner] Checking ${d}: exact=${exactMatch}, subdomain=${subdomainMatch}`);
            
            return exactMatch || subdomainMatch;
        });
        
        if (!matchedDomain) {
            debugLog('[checkAndShowBanner] Domain not in list, updating icon to normal state');
            

            
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
        
        debugLog('[checkAndShowBanner] Matched domain in list:', matchedDomain);
        
        // Step 5: Check for institutional access IMMEDIATELY after domain match
        debugConsole(`[EZProxy DEBUG] About to check institutional access EARLY [CALL-${callId}]`);
        try {
            const config = await getConfig().catch(err => {
                debugLog('Failed to load config for early institutional check', { error: err.message });
                throw new Error('Failed to load extension configuration');
            });
            
            const hasAccess = await hasInstitutionalAccess(config);
            if (hasAccess) {
                debugConsole(`[EZProxy DEBUG] checkAndShowBanner: EARLY INSTITUTIONAL ACCESS DETECTED - EXITING [CALL-${callId}]`);
                return;
            }
        } catch (e) {
            console.error('[checkAndShowBanner] Error in early institutional access check:', e);
            // Continue with processing
        }

        
        // Step 6: Check if domain is dismissed
        debugLog('[checkAndShowBanner] Step 5: Checking if domain is dismissed...');
        const isDismissed = await isDomainDismissed(matchedDomain).catch(err => {
            console.error('[checkAndShowBanner] Error checking if domain is dismissed:', err);
            return false; // Default to not dismissed on error
        });
        
        // Debug logging for dismissed domains
        debugLog(`Domain dismiss check completed`, { domain: matchedDomain, isDismissed });
        
        if (isDismissed) {
            debugLog('[checkAndShowBanner] Domain is dismissed, updating icon to dismissed state');
            
            debugLog('Domain is dismissed, skipping banner display', { domain: matchedDomain });
            
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
        debugConsole('[EZProxy DEBUG] About to check institutional access');
        debugLog('[checkAndShowBanner] Step 6: Checking for institutional access...');
        try {
            const hasAccess = await hasInstitutionalAccess(config);
            
            debugLog('Institutional access check completed', { domain: matchedDomain, hasAccess });
            
            if (hasAccess) {
                debugConsole(`[EZProxy DEBUG] checkAndShowBanner: INSTITUTIONAL ACCESS DETECTED - EXITING WITHOUT BANNER [CALL-${callId}]`);
                debugLog('[checkAndShowBanner] User has institutional access, skipping EZProxy notification');
                
                debugLog('User has institutional access, skipping banner', { domain: matchedDomain });
                
                debugConsole(`[EZProxy DEBUG] checkAndShowBanner: ABOUT TO RETURN - BANNER SHOULD NOT BE CREATED [CALL-${callId}]`);
                return;
            }
            debugLog('[checkAndShowBanner] No institutional access detected, proceeding with banner check');
        } catch (e) {
            console.error('[checkAndShowBanner] Error checking institutional access:', e);
            // Continue with banner display if we can't determine access
        }
        
        // Step 7: Double-check if domain was dismissed (race condition protection)
        debugLog('[checkAndShowBanner] Step 7: Verifying domain is still not dismissed...');
        const isStillDismissed = await isDomainDismissed(matchedDomain).catch(() => false);
        if (isStillDismissed) {
            debugLog('[checkAndShowBanner] Domain was dismissed during processing, aborting');
            return;
        }
        
        // Step 8: Prepare EZProxy URL
        debugLog('Preparing EZProxy URL', { domain, ezproxyBaseUrl: config.ezproxyBaseUrl });
        if (!config.ezproxyBaseUrl) {
            console.error('[checkAndShowBanner] No EZProxy base URL configured');
            return;
        }
        
        // Create proper EZProxy subdomain URL with full path
        // Convert www.jstor.org/article/123 -> www-jstor-org.ezproxy.library.wwu.edu/article/123
        const transformedDomain = domain.replace(/\./g, '-');
        const currentUrl = new URL(url);
        const ezproxyUrl = `${currentUrl.protocol}//${transformedDomain}.${config.ezproxyBaseUrl}${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`;
        
        const bannerMessage = `This resource is available through ${config.institutionName || 'your library'}. Access the full content via EZProxy.`;
        debugLog('Created EZProxy URL', { originalDomain: domain, transformedDomain, ezproxyUrl });
        
        // Step 9: Create and show the banner
        debugLog('Creating banner', { domain: matchedDomain, ezproxyUrl });
        

        
        try {
            debugConsole(`[EZProxy DEBUG] checkAndShowBanner: CREATING BANNER - this should NOT happen if institutional access detected [CALL-${callId}]`);
            await createBanner(
                bannerMessage,
                ezproxyUrl,
                matchedDomain
            );
            debugLog('Banner creation completed successfully');
            

        } catch (e) {
            debugLog('Banner creation failed', { error: e.message });
            console.error('[checkAndShowBanner] Error creating banner:', e);
            

            
            throw e; // Re-throw to be caught by the outer try-catch
        }
    } catch (error) {
        debugLog('Unhandled error in checkAndShowBanner', { error: error.message || error.toString() });
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
debugLog('Setting up initialization');
if (document.readyState === 'loading') {
    debugLog('DOM loading, waiting for ready');
    document.addEventListener('DOMContentLoaded', init);
} else {
    debugLog('DOM ready, calling init immediately');
    init();
}

// Enhanced message listener with auto-redirect support
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'DOMAIN_MATCH') {
        debugConsole('[EZProxy DEBUG] Received DOMAIN_MATCH message for:', message.domain);
        debugLog('[onMessage] Received DOMAIN_MATCH message for:', message.domain);
        
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
                            debugLog('[onMessage] Domain was previously dismissed, skipping notification');
                            throw new Error('DOMAIN_DISMISSED');
                        }
                        return configData;
                    });
            })
            .then(async config => {
                // Then check for institutional access
                debugConsole('[EZProxy DEBUG] Message listener checking institutional access');
                try {
                    const hasAccess = await hasInstitutionalAccess(config);
                    if (hasAccess) {
                        debugConsole('[EZProxy DEBUG] Message listener: User has institutional access, skipping EZProxy notification');
                        debugLog('[onMessage] User has institutional access, skipping EZProxy notification');
                        throw new Error('HAS_INSTITUTIONAL_ACCESS');
                    }
                    debugConsole('[EZProxy DEBUG] Message listener: No institutional access detected, proceeding with banner');
                    return config;
                } catch (err) {
                    if (err.message === 'HAS_INSTITUTIONAL_ACCESS') {
                        throw err;
                    }
                    // If there's an error checking access, continue with banner
                    console.warn('[onMessage] Error checking institutional access, proceeding with banner:', err);
                    return config;
                }
            })
            .then(config => {
                // Then check for auto-redirect
                return shouldAutoRedirect()
                    .then(shouldRedirect => {
                        if (shouldRedirect) {
                            debugLog('[onMessage] Auto-redirect enabled, redirecting to EZProxy');
                            window.location.href = message.ezproxyUrl;
                            throw new Error('AUTO_REDIRECTED');
                        }
                        return config;
                    });
            })
            .then(config => {
                // Finally, show the banner
                debugLog('[onMessage] Showing banner for:', message.domain);
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

// =====================================
// DOMAIN NAVIGATION SIDEBAR FEATURE
// =====================================

class EZProxyDomainSidebar {
    constructor() {
        this.isOpen = false;
        this.categories = null;
        this.domains = null;
        this.filteredCategories = null;
        this.config = null;
        
        // Only initialize sidebar on main frames to avoid conflicts
        if (window.self === window.top) {
            this.init();
        }
    }

    async init() {
        debugLog('[Sidebar] Initializing domain sidebar');
        
        try {
            // Small delay to ensure page is ready
            setTimeout(async () => {
                await this.loadConfig();
                await this.loadCategories();
                await this.loadDomains();
                this.createSidebar();
                this.bindEvents();
                debugLog('[Sidebar] Sidebar initialization completed');
            }, 1000);
        } catch (error) {
            console.error('[Sidebar] Failed to initialize sidebar:', error);
        }
    }

    async loadConfig() {
        try {
            this.config = await getConfig();
        } catch (error) {
            console.warn('[Sidebar] Failed to load config:', error);
        }
    }

    async loadCategories() {
        try {
            // Request categories from background script (which handles caching and updates)
            const response = await chrome.runtime.sendMessage({ type: 'GET_CATEGORIES' });
            if (response && response.categories) {
                this.categories = response.categories;
                this.filteredCategories = { ...this.categories };
                debugLog('[Sidebar] Categories loaded from background script');
                return;
            }
            
            if (response && response.error) {
                throw new Error(response.error);
            }
            
            throw new Error('No categories received from background script');
        } catch (error) {
            console.error('[Sidebar] Failed to load categories:', error);
            this.categories = this.createBasicCategories();
            this.filteredCategories = { ...this.categories };
            debugLog('[Sidebar] Using basic fallback categories');
        }
    }

    async loadDomains() {
        try {
            const domainList = await getDomainList();
            this.domains = domainList || [];
        } catch (error) {
            console.error('[Sidebar] Failed to load domains:', error);
            this.domains = [];
        }
    }

    createBasicCategories() {
        return {
            'All Resources': {
                description: 'Complete list of available resources',
                domains: this.domains || []
            }
        };
    }

    createSidebar() {
        // Check if sidebar already exists
        if (document.getElementById('ezproxy-domain-sidebar')) {
            return;
        }

        // Create toggle button
        const toggleButton = document.createElement('button');
        toggleButton.id = 'ezproxy-sidebar-toggle';
        toggleButton.title = 'Open EZProxy Domain Navigator';
        toggleButton.innerHTML = '📚';
        toggleButton.style.cssText = `
            position: fixed !important;
            top: 50% !important;
            right: 20px !important;
            transform: translateY(-50%) !important;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
            border: none !important;
            color: white !important;
            width: 50px !important;
            height: 50px !important;
            border-radius: 50% !important;
            cursor: pointer !important;
            font-size: 18px !important;
            z-index: 2147483646 !important;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3) !important;
            transition: all 0.3s ease !important;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
        `;

        // Create sidebar container
        const sidebar = document.createElement('div');
        sidebar.id = 'ezproxy-domain-sidebar';
        // Responsive width based on screen size
        const isMobile = window.innerWidth <= 768;
        const sidebarWidth = isMobile ? '100vw' : '500px';
        const sidebarHiddenPosition = isMobile ? '-100vw' : '-500px';

        sidebar.style.cssText = `
            position: fixed !important;
            top: 0 !important;
            right: ${sidebarHiddenPosition} !important;
            width: ${sidebarWidth} !important;
            height: 100vh !important;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
            box-shadow: -2px 0 10px rgba(0, 0, 0, 0.3) !important;
            z-index: 2147483647 !important;
            transition: right 0.3s ease-in-out !important;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
            color: white !important;
            overflow: hidden !important;
            display: flex !important;
            flex-direction: column !important;
        `;

        // Create sidebar content
        sidebar.innerHTML = `
            <div style="padding: 20px; background: rgba(0, 0, 0, 0.2); border-bottom: 1px solid rgba(255, 255, 255, 0.2);">
                <button id="sidebar-close-btn" style="position: absolute; top: 15px; right: 15px; background: rgba(255, 255, 255, 0.2); border: none; color: white; width: 30px; height: 30px; border-radius: 50%; cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center;">×</button>
                <h2 style="font-size: 18px; font-weight: 600; margin: 0 0 10px 0; color: white;">EZProxy Navigator</h2>
                <p style="font-size: 14px; opacity: 0.8; margin: 0; color: white;">Browse available academic resources</p>
            </div>

            <div style="padding: 15px 20px; background: rgba(0, 0, 0, 0.1);">
                <input type="text" id="domain-search" placeholder="Search domains..." style="width: 100%; padding: 10px 12px; border: none; border-radius: 6px; background: rgba(255, 255, 255, 0.9); color: #333; font-size: 14px; box-sizing: border-box;">
            </div>

            <div id="categories-container" style="flex: 1; overflow-y: auto; padding: 20px;">
                <!-- Categories will be populated here -->
            </div>
        `;

        // Add to page
        document.body.appendChild(toggleButton);
        document.body.appendChild(sidebar);

        // Populate categories
        this.populateCategories();
    }

    populateCategories() {
        const container = document.getElementById('categories-container');
        if (!container) return;

        container.innerHTML = '';

        Object.entries(this.filteredCategories).forEach(([categoryName, categoryData]) => {
            const categoryDiv = this.createCategoryElement(categoryName, categoryData);
            container.appendChild(categoryDiv);
        });
    }

    createCategoryElement(name, data) {
        const categoryDiv = document.createElement('div');
        categoryDiv.className = 'category';
        categoryDiv.style.cssText = `
            margin-bottom: 15px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 8px;
            overflow: hidden;
        `;

        const domainCount = data.domains ? data.domains.length : 0;
        
        categoryDiv.innerHTML = `
            <div class="category-header" style="padding: 12px 15px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; background: rgba(0, 0, 0, 0.1);">
                <div>
                    <div style="font-weight: 500; font-size: 14px; color: white;">${name}</div>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="background: rgba(255, 255, 255, 0.2); padding: 2px 8px; border-radius: 12px; font-size: 12px; color: white;">${domainCount}</span>
                    <span class="category-toggle" style="font-size: 12px; color: white;">▶</span>
                </div>
            </div>
            <div class="domain-list" style="max-height: 0; overflow: hidden; transition: max-height 0.3s ease; overflow-y: auto;">
                ${this.createDomainList(data.domains || [])}
            </div>
        `;

        return categoryDiv;
    }

    createDomainList(domains) {
        return domains.map(domain => {
            const isCurrentDomain = window.location.hostname === domain;
            const statusText = isCurrentDomain ? 'Currently viewing' : 'Available via EZProxy';
            
            return `
                <div class="domain-item" data-domain="${domain}" style="padding: 12px 15px; border-bottom: 1px solid rgba(255, 255, 255, 0.1); cursor: pointer; font-size: 13px; color: white; transition: background 0.2s ease;">
                    <div style="font-weight: 500; word-wrap: break-word; overflow-wrap: break-word; line-height: 1.4;">${domain}</div>
                    <div style="font-size: 11px; opacity: 0.7; margin-top: 4px; line-height: 1.2;">${statusText}</div>
                </div>
            `;
        }).join('');
    }

    bindEvents() {
        // Toggle button
        const toggleButton = document.getElementById('ezproxy-sidebar-toggle');
        if (toggleButton) {
            toggleButton.addEventListener('click', () => this.toggleSidebar());
        }

        // Close button
        const closeButton = document.getElementById('sidebar-close-btn');
        if (closeButton) {
            closeButton.addEventListener('click', () => this.closeSidebar());
        }

        // Search functionality
        const searchInput = document.getElementById('domain-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => this.handleSearch(e.target.value));
        }

        // Category toggle
        document.addEventListener('click', (e) => {
            if (e.target.closest('.category-header')) {
                this.toggleCategory(e.target.closest('.category'));
            }
        });

        // Domain click and hover effects
        document.addEventListener('click', (e) => {
            if (e.target.closest('.domain-item')) {
                const domain = e.target.closest('.domain-item').dataset.domain;
                this.handleDomainClick(domain);
            }
        });

        // Add hover effects for domain items
        document.addEventListener('mouseover', (e) => {
            if (e.target.closest('.domain-item')) {
                e.target.closest('.domain-item').style.background = 'rgba(255, 255, 255, 0.15)';
            }
        });

        document.addEventListener('mouseout', (e) => {
            if (e.target.closest('.domain-item')) {
                e.target.closest('.domain-item').style.background = 'transparent';
            }
        });

        // Close on outside click
        document.addEventListener('click', (e) => {
            const sidebar = document.getElementById('ezproxy-domain-sidebar');
            const toggleButton = document.getElementById('ezproxy-sidebar-toggle');
            
            if (this.isOpen && sidebar && !sidebar.contains(e.target) && e.target !== toggleButton) {
                this.closeSidebar();
            }
        });

        // ESC key to close
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) {
                this.closeSidebar();
            }
        });
    }

    toggleSidebar() {
        if (this.isOpen) {
            this.closeSidebar();
        } else {
            this.openSidebar();
        }
    }

    openSidebar() {
        const sidebar = document.getElementById('ezproxy-domain-sidebar');
        if (sidebar) {
            sidebar.style.right = '0';
            this.isOpen = true;
            debugLog('[Sidebar] Sidebar opened');
        }
    }

    closeSidebar() {
        const sidebar = document.getElementById('ezproxy-domain-sidebar');
        if (sidebar) {
            const isMobile = window.innerWidth <= 768;
            const hiddenPosition = isMobile ? '-100vw' : '-500px';
            sidebar.style.right = hiddenPosition;
            this.isOpen = false;
            debugLog('[Sidebar] Sidebar closed');
        }
    }

    toggleCategory(categoryElement) {
        if (!categoryElement) return;

        const isExpanded = categoryElement.classList.contains('expanded');
        const domainList = categoryElement.querySelector('.domain-list');
        const toggle = categoryElement.querySelector('.category-toggle');

        if (isExpanded) {
            categoryElement.classList.remove('expanded');
            domainList.style.maxHeight = '0';
            toggle.textContent = '▶';
        } else {
            categoryElement.classList.add('expanded');
            domainList.style.maxHeight = '600px';
            toggle.textContent = '▼';
        }
    }

    handleSearch(query) {
        if (!query.trim()) {
            this.filteredCategories = { ...this.categories };
        } else {
            this.filteredCategories = {};
            const lowerQuery = query.toLowerCase();

            Object.entries(this.categories).forEach(([categoryName, categoryData]) => {
                const filteredDomains = categoryData.domains.filter(domain =>
                    domain.toLowerCase().includes(lowerQuery)
                );

                if (filteredDomains.length > 0) {
                    this.filteredCategories[categoryName] = {
                        ...categoryData,
                        domains: filteredDomains
                    };
                }
            });
        }

        this.populateCategories();
    }

    async handleDomainClick(domain) {
        if (!domain) return;

        debugLog('[Sidebar] Domain clicked:', domain);

        try {
            // Generate EZProxy URL
            const ezproxyUrl = this.generateEZProxyUrl(domain);
            
            // Open in new tab
            window.open(ezproxyUrl, '_blank');
            
            // Close sidebar
            this.closeSidebar();
            
        } catch (error) {
            console.error('[Sidebar] Error handling domain click:', error);
        }
    }

    generateEZProxyUrl(domain) {
        if (!this.config) {
            // Fallback URL generation
            return `https://ezproxy.library.wwu.edu/login?url=https://${domain}`;
        }

        const baseUrl = this.config.ezproxyBaseUrl;
        return `https://${baseUrl}/login?url=https://${domain}`;
    }
}

// Initialize sidebar after everything else is loaded
setTimeout(() => {
    if (window.self === window.top) {
        new EZProxyDomainSidebar();
    }
}, 2000);