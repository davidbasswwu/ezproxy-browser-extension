// content.js - No imports version
// We'll include the necessary functions directly to avoid import issues

// Security utility functions
function sanitizeInput(input) {
  if (!input) return '';
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isValidUrl(url) {
  try {
    const parsedUrl = new URL(url);
    return ['http:', 'https:'].includes(parsedUrl.protocol);
  } catch (e) {
    return false;
  }
}

// Constants
const BANNER_ID = 'ezproxy-banner';
const STORAGE_KEYS = {
    DISMISSED_DOMAINS: 'ezproxy-dismissed-domains',
    AUTO_REDIRECT: 'ezproxy-auto-redirect',
    SESSION_ID: 'ezproxy-session-id'
};

// Generate a unique session ID if not exists
async function getSessionId() {
    let { sessionId } = await chrome.storage.local.get(STORAGE_KEYS.SESSION_ID);
    if (!sessionId) {
        sessionId = crypto.randomUUID();
        await chrome.storage.local.set({ [STORAGE_KEYS.SESSION_ID]: sessionId });
    }
    return sessionId;
}

// Sanitize HTML to prevent XSS
function sanitizeHTML(html) {
    if (!html) return '';
    
    const doc = document.implementation.createHTMLDocument('');
    const div = doc.createElement('div');
    div.textContent = html;
    return div.innerHTML;
}

// Icon paths
const ICON_PATHS = {
    NORMAL: {
        '16': 'images/icon-16.png',
        '48': 'images/icon-48.png',
        '128': 'images/icon-128.png'
    },
    DISMISSED: {
        '16': 'images/icon-dismissed-16.png',
        '48': 'images/icon-48.png',  // Using normal icon for larger sizes
        '128': 'images/icon-128.png'  // Using normal icon for larger sizes
    }
};

// Global variable to track if we've initialized
let isInitialized = false;

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
        
        // Method 4: If still empty, try getting text from all divs with substantial content
        if (!pageText || pageText.length < 100) {
            console.log('[hasInstitutionalAccess] Paragraph extraction yielded limited content, trying divs');
            const divs = document.querySelectorAll('div');
            if (divs && divs.length > 0) {
                for (const div of divs) {
                    if (div.textContent && div.textContent.length > 50) {
                        pageText += ' ' + div.textContent;
                    }
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
    
    // Get current domain
    const domain = window.location.hostname;
    console.log('[hasInstitutionalAccess] Current domain:', domain);
    
    // Special case for Nature website
    if (domain.includes('nature.com')) {
        console.log('[hasInstitutionalAccess] Nature website detected, performing detailed check');
        
        // Look specifically for the full access message on Nature
        const fullAccessText = 'You have full access to this article via your institution';
        const hasFullAccess = pageText.toLowerCase().includes(fullAccessText.toLowerCase());
        
        if (hasFullAccess) {
            console.log('[hasInstitutionalAccess] Found Nature full access message:', fullAccessText);
            return true;
        }
        
        // Log a sample of the page text to debug
        console.log('[hasInstitutionalAccess] Nature page text sample:', 
            pageText.substring(0, 500).replace(/\s+/g, ' ').trim() + '...');
    }
    

    
    // Get institution details from config with defaults
    const instName = (config.institutionName || 'Institution').toLowerCase();
    const configDomain = (config.institutionDomain || 'example.edu').toLowerCase();
    const shortName = (config.institutionShortName || '').toLowerCase();
    const libraryName = (config.institutionLibraryName || '').toLowerCase();
    
    console.log('[hasInstitutionalAccess] Using institution:', instName, 'domain:', configDomain);
    
    // Special case for Financial Times (ft.com)
    if (domain.includes('ft.com')) {
        console.log('[hasInstitutionalAccess] Financial Times website detected, performing detailed check');
        
        // Check if we need to wait for content to load
        const needsDelay = !pageText || pageText.length < 1000;
        if (needsDelay) {
            console.log('[hasInstitutionalAccess] FT content may not be fully loaded, adding delay checks');
            
            // Set a flag in sessionStorage to prevent infinite loops
            const checkCount = parseInt(sessionStorage.getItem('ft-check-count') || '0');
            if (checkCount < 3) { // Limit to 3 attempts
                // Increment the counter
                sessionStorage.setItem('ft-check-count', (checkCount + 1).toString());
                
                // Set a timeout to check again after content has had time to load
                setTimeout(() => {
                    console.log(`[hasInstitutionalAccess] Retrying FT check (attempt ${checkCount + 1}/3)`);
                    // Force a recheck
                    hasInstitutionalAccess(config);
                }, 1500); // 1.5 second delay
                
                // Return false for now, the timeout will trigger another check
                return false;
            } else {
                // Reset the counter after 3 attempts
                sessionStorage.removeItem('ft-check-count');
                console.log('[hasInstitutionalAccess] Maximum FT check attempts reached, proceeding with current content');
            }
        } else {
            // Content seems to be loaded, reset the counter
            sessionStorage.removeItem('ft-check-count');
        }
        
        // Check for specific FT access elements
        const ftAccessIndicators = [
            // Check for subscription/access buttons that indicate no institutional access
            { selector: '.o-header__top-link--subscribe', negative: true, description: 'Subscribe button' },
            { selector: '.o-header__top-button--primary', negative: true, description: 'Sign In button' },
            { selector: '.o-banner__outer', negative: true, description: 'Subscription banner' },
            { selector: '.n-messaging-banner', negative: true, description: 'Messaging banner' },
            { selector: '.n-messaging-banner__content', negative: true, description: 'Messaging banner content' },
            { selector: '.o-message', negative: true, description: 'Message component' },
            { selector: '.o-message__content-main', negative: true, description: 'Message content' },
            { selector: '.o-message__actions', negative: true, description: 'Message actions' },
            
            // Check for elements that indicate institutional access
            { selector: '.n-myft-ui--follow', negative: false, description: 'MyFT follow button (requires access)' },
            { selector: '.article__content', negative: false, description: 'Full article content' },
            { selector: '.n-content-body', negative: false, description: 'Article body content' },
            { selector: '.article-body', negative: false, description: 'Article body' },
            { selector: '.js-article__content', negative: false, description: 'JS article content' },
            { selector: '.js-article-body', negative: false, description: 'JS article body' },
            { selector: '.article__content-body', negative: false, description: 'Article content body' }
        ];
        
        let hasAccess = false;
        let noAccess = false;
        
        for (const indicator of ftAccessIndicators) {
            const elements = document.querySelectorAll(indicator.selector);
            if (elements && elements.length > 0) {
                console.log(`[hasInstitutionalAccess] Found FT ${indicator.description}: ${elements.length} elements`);
                
                if (indicator.negative) {
                    // If this is a negative indicator (like subscribe button), it suggests no access
                    noAccess = true;
                } else {
                    // If this is a positive indicator, it suggests access
                    hasAccess = true;
                }
            }
        }
        
        // Check for paywall messaging
        const paywallText = [
            'subscribe to read', 
            'to continue reading', 
            'premium content', 
            'subscribe to the ft',
            'subscribe to continue reading',
            'start your trial',
            'free trial',
            'sign up to',
            'sign in to',
            'subscription required',
            'please subscribe',
            'for unlimited access',
            'to unlock this article',
            'to access this article',
            'already a subscriber? sign in',
            'already a subscriber? log in'
        ];
        
        const hasPaywall = paywallText.some(text => {
            const found = pageText.toLowerCase().includes(text);
            if (found) {
                console.log(`[hasInstitutionalAccess] Found FT paywall text: "${text}"`);
                return true;
            }
            return false;
        });
        
        if (hasPaywall) {
            console.log('[hasInstitutionalAccess] Detected paywall content on FT');
            noAccess = true;
        }
        
        // Check for institutional access indicators in the header
        const headerElements = document.querySelectorAll('header, .o-header, .o-header__row, .o-header__top');
        let headerText = '';
        
        headerElements.forEach(el => {
            headerText += ' ' + (el.textContent || '');
        });
        
        headerText = headerText.toLowerCase().trim();
        console.log('[hasInstitutionalAccess] FT header text:', headerText);
        
        // Check for institutional indicators in header
        const instIndicators = [instName, configDomain, shortName, libraryName];
        const headerHasInst = instIndicators.some(indicator => {
            if (indicator && headerText.includes(indicator.toLowerCase())) {
                console.log(`[hasInstitutionalAccess] Found institutional indicator in FT header: ${indicator}`);
                return true;
            }
            return false;
        });
        
        // If we have clear indicators of access, return true
        if ((hasAccess && !noAccess) || headerHasInst) {
            console.log('[hasInstitutionalAccess] Detected institutional access on FT based on page elements');
            return true;
        }
        
        // Log a sample of the page text to debug
        console.log('[hasInstitutionalAccess] FT page text sample:', 
            pageText.substring(0, 500).replace(/\s+/g, ' ').trim() + '...');
    }
    
    // Check for common indicators of institutional access
    const accessIndicators = [
        // Generic access indicators
        'access provided by',
        'authenticated via',
        'logged in as',
        'institution:',
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
    
    // Add any domain-specific indicators
    if (configDomain) {
        const domainParts = configDomain.split('.');
        if (domainParts.length >= 2) {
            // For domains like 'wwu.edu', add 'wwu libraries'
            const subdomain = domainParts[0];
            if (subdomain && subdomain !== 'www' && !libraryName) {
                accessIndicators.push(`${subdomain} libraries`);
            }
        }
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
    const hasIndicator = accessIndicators.some(indicator => {
        if (!indicator) return false;
        const found = normalizedPageText.includes(indicator.toLowerCase());
        if (found) {
            foundIndicators.push(indicator);
            return true;
        }
        return false;
    });
    
    // Additional pattern matching for access messages that might appear in different formats
    if (!hasIndicator) {
        // Common patterns for full access messages
        const accessPatterns = [
            /full\s+access\s+(?:to|for|available|provided)\s+(?:this|the|your)/i,
            /you\s+have\s+access\s+(?:to|for|via|through)/i,
            /access\s+(?:provided|available|granted)\s+(?:by|via|through)\s+(?:your|the)\s+institution/i,
            /(?:your|this)\s+institution\s+(?:has|provides|grants)\s+access/i
        ];
        
        const hasAccessPattern = accessPatterns.some(pattern => {
            const match = normalizedPageText.match(pattern);
            if (match) {
                foundIndicators.push(`pattern: ${match[0]}`);
                console.log(`[hasInstitutionalAccess] Found access pattern: ${match[0]}`);
                return true;
            }
            return false;
        });
        
        if (hasAccessPattern) {
            return true;
        }
    }
    
    // Special check for indicators in the page header
    // This is more reliable for detecting institutional access
    if (!hasIndicator) {
        console.log('[hasInstitutionalAccess] Checking page header for institutional indicators...');
        
        // Get header elements (first 1000px of page content is likely to be header)
        const headerElements = Array.from(document.querySelectorAll('header, nav, .header, #header, [role="banner"], .banner, .navbar, .navigation'));
        
        // Also include any elements in the top portion of the page
        const topElements = Array.from(document.querySelectorAll('*')).filter(el => {
            const rect = el.getBoundingClientRect();
            return rect.top >= 0 && rect.top <= 200 && rect.height > 0 && rect.width > 0;
        });
        
        // Combine and get text content
        const headerTexts = [...headerElements, ...topElements].map(el => el.textContent?.toLowerCase() || '');
        const headerText = headerTexts.join(' ');
        
        console.log('[hasInstitutionalAccess] Header text sample:', 
            headerText.substring(0, 200).replace(/\s+/g, ' ').trim() + '...');
        
        // Check header text for institutional indicators
        const headerIndicator = accessIndicators.some(indicator => {
            if (!indicator) return false;
            const found = headerText.includes(indicator.toLowerCase());
            if (found) {
                foundIndicators.push(`header: ${indicator}`);
                return true;
            }
            return false;
        });
        
        if (headerIndicator) {
            console.log('[hasInstitutionalAccess] Found access indicators in header:', foundIndicators);
            return true;
        }
    }
    
    if (foundIndicators.length > 0) {
        console.log('[hasInstitutionalAccess] Found access indicators:', foundIndicators);
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
    
    // Check for institution logo or branding images
    // Build selectors based on institution name and domain
    const logoSelectors = [];
    
    // Add selectors based on domain (e.g., 'wwu' from 'wwu.edu')
    if (configDomain) {
        const domainParts = configDomain.split('.');
        if (domainParts.length >= 2) {
            const subdomain = domainParts[0];
            if (subdomain && subdomain !== 'www') {
                logoSelectors.push(`img[src*="${subdomain}" i]`);
                logoSelectors.push(`img[alt*="${subdomain}" i]`);
            }
        }
    }
    
    // Add selectors based on institution name
    if (instName) {
        // Split institution name into words
        const nameWords = instName.split(/\s+/);
        
        // Add selectors for each significant word (3+ characters)
        nameWords.forEach(word => {
            if (word.length >= 3) {
                logoSelectors.push(`img[src*="${word}" i]`);
                logoSelectors.push(`img[alt*="${word}" i]`);
            }
        });
        
        // Add selector for short name if available
        if (shortName) {
            logoSelectors.push(`img[src*="${shortName}" i]`);
            logoSelectors.push(`img[alt*="${shortName}" i]`);
        }
    }
    
    // If we have selectors, check for matching images
    if (logoSelectors.length > 0) {
        const selector = logoSelectors.join(', ');
        console.log(`[hasInstitutionalAccess] Checking for logo with selector: ${selector}`);
        
        const logoElements = Array.from(document.querySelectorAll(selector));
        if (logoElements.length > 0) {
            console.log(`[hasInstitutionalAccess] Found ${logoElements.length} institution logo/branding elements:`, 
                logoElements.map(el => ({ src: el.src, alt: el.alt })));
            return true;
        }
    }
    
    // Check for access buttons or links that indicate the user already has access
    const accessButtonTexts = [
        'full text',
        'pdf',
        'html full text',
        'download pdf',
        'view full text',
        'read article',
        'access article',
        'read full article',
        'download article'
    ];
    
    // Look for buttons or links with these texts that don't have 'login' or 'sign in' nearby
    const accessButtons = Array.from(document.querySelectorAll('a, button')).filter(el => {
        const text = el.textContent?.toLowerCase().trim() || '';
        const hasAccessText = accessButtonTexts.some(btnText => text.includes(btnText));
        
        if (hasAccessText) {
            // Check if this is not a login button
            const hasLoginText = text.includes('login') || text.includes('sign in') || 
                               text.includes('subscribe') || text.includes('purchase');
            
            // Also check parent elements for login context
            const parent = el.parentElement;
            const parentText = parent?.textContent?.toLowerCase() || '';
            const parentHasLoginText = parentText.includes('login') || parentText.includes('sign in') || 
                                     parentText.includes('subscribe') || parentText.includes('purchase');
            
            return !hasLoginText && !parentHasLoginText;
        }
        return false;
    });
    
    if (accessButtons.length > 0) {
        console.log(`[hasInstitutionalAccess] Found ${accessButtons.length} access buttons/links:`, 
            accessButtons.map(el => el.textContent?.trim()));
        return true;
    }
    
    if (ezproxyElements.length > 0) {
        console.log(`[hasInstitutionalAccess] Found ${ezproxyElements.length} EZProxy related elements`);
        return true;
    }
    
    // Check for access denied or login required pages
    const deniedIndicators = [
        'access denied',
        'login required',
        'sign in',
        'log in',
        'authentication required',
        'institutional access required'
    ];
    
    const isDeniedPage = deniedIndicators.some(indicator => 
        normalizedPageText.includes(indicator)
    );
    
    if (isDeniedPage) {
        console.log('[hasInstitutionalAccess] Detected access denied/login page');
        return false;
    }
    
    console.log('[hasInstitutionalAccess] No institutional access indicators found');
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

// Update the extension icon based on domain dismissal status
async function updateExtensionIcon(domain, isDismissed) {
    try {
        // First get the current tab ID
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tabId = tabs && tabs[0] && tabs[0].id;
        
        if (!tabId) {
            console.warn('Could not get current tab ID for icon update');
            return;
        }
        
        console.log(`Updating icon for tab ${tabId}, isDismissed: ${isDismissed}`);
        
        // Send message to update the icon
        await chrome.runtime.sendMessage({
            action: 'updateIcon',
            tabId: tabId,
            isDismissed: isDismissed
        });
    } catch (error) {
        console.error('Error updating extension icon:', error);
    }
}

async function dismissDomain(domain) {
    console.log('Dismissing domain:', domain);
    try {
        // Save the dismissed domain to storage
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
        }
    } catch (error) {
        console.error('Error saving dismissed domain:', error);
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
    closeButton.innerHTML = closeButtonConfig.text || '&times;';
    closeButton.setAttribute('aria-label', 'Close this notification');
    
    // Apply close button styles
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
    
    // Add hover and focus styles for close button
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
 * Initialize the content script
 */
async function init() {
    if (isInitialized) return;
    
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
        // Check both the matched domain and the current domain
        const isDismissed = await isDomainDismissed(domain).catch(err => {
            console.error('[checkAndShowBanner] Error checking if domain is dismissed:', err);
            return false; // Default to not dismissed on error
        });
        
        // Double check with the matched domain from the list if needed
        let isMatchedDomainDismissed = false;
        if (!isDismissed && matchedDomain !== domain) {
            isMatchedDomainDismissed = await isDomainDismissed(matchedDomain).catch(() => false);
            console.log(`[checkAndShowBanner] Matched domain ${matchedDomain} dismissed status:`, isMatchedDomainDismissed);
        }
        
        if (isDismissed || isMatchedDomainDismissed) {
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
            const hasAccess = hasInstitutionalAccess(config);
            
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
        const isStillDismissed = await isDomainDismissed(domain).catch(() => false);
        const isMatchedStillDismissed = matchedDomain !== domain ? 
            await isDomainDismissed(matchedDomain).catch(() => false) : false;
            
        if (isStillDismissed || isMatchedStillDismissed) {
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
        const matchedExceptionDomain = Array.isArray(config.urlExceptions) ? 
            config.urlExceptions.find(exception => matchedDomain.includes(exception)) : null;
        const isException = !!matchedExceptionDomain;
        
        let ezproxyUrl;
        let bannerMessage;
        let buttonText;
        let buttonAriaLabel;
        
        if (isException) {
            // For exceptions, create a URL to the library help page with the domain as a search parameter
            const libraryHelpUrl = config.libraryHelpUrl || 'https://library.example.edu/ask';
            const helpUrlWithSearch = `${libraryHelpUrl}${libraryHelpUrl.includes('?') ? '&' : '?'}q=${matchedDomain}`;
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
            errorBanner.innerHTML = `
                <div style="font-weight: bold; margin-bottom: 5px;">EZProxy Extension Error</div>
                <div>${error.message || 'An unknown error occurred'}</div>
                <div style="margin-top: 5px; font-size: 12px; color: #666;">
                    Check console for details
                </div>
            `;
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
chrome.runtime.onMessage.addListener(async (message) => {
    if (message.type === 'DOMAIN_MATCH') {
        // Check if user has institutional access
        // Get the current configuration
        const config = await getConfig();
        if (hasInstitutionalAccess(config)) {
            console.log('User has institutional access, skipping EZProxy notification');
            return;
        }

        // Check if domain was previously dismissed
        if (await isDomainDismissed(message.domain)) {
            console.log('Domain was previously dismissed, skipping notification');
            return;
        }

        // Check for auto-redirect setting
        if (await shouldAutoRedirect()) {
            console.log('Auto-redirect enabled, redirecting to EZProxy');
            window.location.href = message.ezproxyUrl;
            return;
        }

        // Show banner notification
        createBanner(
            message.bannerMessage || `This resource is available through WWU Libraries. Access the full content via EZProxy.`,
            message.ezproxyUrl,
            message.domain
        );
    }
});