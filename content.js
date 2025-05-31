// content.js

// Constants
const BANNER_ID = 'ezproxy-banner';
const STORAGE_KEYS = {
    DISMISSED_DOMAINS: 'ezproxy-dismissed-domains',
    AUTO_REDIRECT: 'ezproxy-auto-redirect'
};

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
function hasInstitutionalAccess(config) {
    console.log('[hasInstitutionalAccess] Checking for institutional access indicators...');
    
    if (!config) {
        console.warn('[hasInstitutionalAccess] No config provided');
        return false;
    }
    
    // Get page text safely
    const pageText = document.body?.textContent || document.documentElement?.textContent || '';
    if (!pageText) {
        console.warn('[hasInstitutionalAccess] Could not get page text');
        return false;
    }
    
    // Get institution name and domain from config with defaults
    const instName = (config.institutionName || 'WWU').toLowerCase();
    const domain = (config.institutionDomain || 'wwu.edu').toLowerCase();
    
    console.log('[hasInstitutionalAccess] Using institution:', instName, 'domain:', domain);
    
    // Check for common indicators of institutional access
    const accessIndicators = [
        'access provided by',
        'authenticated via',
        'logged in as',
        'institution:',
        'institution=',
        `institution=${instName}`,
        `institution=${domain}`,
        instName,
        domain
    ];
    
    // Add any custom indicators from config
    if (Array.isArray(config.accessIndicators)) {
        accessIndicators.push(...config.accessIndicators.map(i => i.toLowerCase()));
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
        const result = await chrome.storage.local.get(STORAGE_KEYS.DISMISSED_DOMAINS);
        const dismissedDomains = result[STORAGE_KEYS.DISMISSED_DOMAINS] || [];
        return dismissedDomains.includes(domain);
    } catch (error) {
        console.error('Error checking dismissed domains:', error);
        return false;
    }
}

// Update the extension icon based on domain dismissal status
async function updateExtensionIcon(domain, isDismissed) {
    try {
        await chrome.runtime.sendMessage({
            action: 'updateIcon',
            iconType: isDismissed ? 'DISMISSED' : 'NORMAL',
            tabId: (await chrome.runtime.sendMessage({ action: 'getTabId' })).tabId
        });
    } catch (error) {
        console.error('Error updating extension icon:', error);
    }
}

async function dismissDomain(domain) {
    console.log('Dismissing domain:', domain);
    try {
        const result = await chrome.storage.local.get(STORAGE_KEYS.DISMISSED_DOMAINS);
        const dismissedDomains = result[STORAGE_KEYS.DISMISSED_DOMAINS] || [];
        if (!dismissedDomains.includes(domain)) {
            dismissedDomains.push(domain);
            console.log('Saving dismissed domains:', dismissedDomains);
            await chrome.storage.local.set({ [STORAGE_KEYS.DISMISSED_DOMAINS]: dismissedDomains });
            
            // Get the current tab
            const tabs = await new Promise(resolve => {
                chrome.tabs.query({ active: true, currentWindow: true }, resolve);
            });
            
            if (tabs && tabs[0] && tabs[0].id) {
                console.log('Updating icon for tab:', tabs[0].id);
                // Directly call the background script's updateIcon function
                await chrome.runtime.sendMessage({
                    action: 'updateIcon',
                    tabId: tabs[0].id,
                    isDismissed: true
                });
                
                // Also update the badge to show dismissed state
                await chrome.action.setBadgeText({
                    tabId: tabs[0].id,
                    text: 'X'
                });
                await chrome.action.setBadgeBackgroundColor({
                    tabId: tabs[0].id,
                    color: '#dc3545' // Red color
                });
            }
        }
    } catch (error) {
        console.error('Error saving dismissed domain:', error);
    }
}

async function shouldAutoRedirect() {
    try {
        const result = await chrome.storage.local.get(STORAGE_KEY_AUTO_REDIRECT);
        return result[STORAGE_KEY_AUTO_REDIRECT] === true;
    } catch (error) {
        console.error('Error checking auto-redirect setting:', error);
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
    redirectButton.textContent = buttonConfig.text || 'Access via EZProxy';
    redirectButton.setAttribute('aria-label', 'Access this resource via EZProxy');
    
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
        
        const ezproxyUrl = `${ezproxyBase}${targetUrl}`;
        console.log('[checkAndShowBanner] Created EZProxy URL:', ezproxyUrl);
        
        // Step 9: Create and show the banner
        console.log('[checkAndShowBanner] Step 9: Creating banner...');
        try {
            await createBanner(
                `This resource is available through ${config.institutionName || 'your library'}. Access the full content via EZProxy.`,
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