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
    if (!config || !config.institutionName) {
        console.warn('No institution name configured for access check');
        return false;
    }
    
    const pageText = document.body.textContent || '';
    const institutionName = config.institutionName.toLowerCase();
    
    // Create a domain from the institution name as a fallback
    const domainFromName = institutionName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '.') // Replace non-alphanumeric with dots
        .replace(/(^\.|\.$)/g, '');  // Remove leading/trailing dots
    
    // Check for common access indicators
    const accessIndicators = [
        'access provided by',
        'authenticated via',
        'logged in as',
        institutionName,
        domainFromName
    ];
    
    // Add any additional indicators from config if available
    if (Array.isArray(config.accessIndicators)) {
        accessIndicators.push(...config.accessIndicators);
    }
    
    // Check if any indicator is found in the page text
    const normalizedPageText = pageText.toLowerCase();
    return accessIndicators.some(indicator => 
        indicator && normalizedPageText.includes(indicator.toLowerCase())
    );
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
    try {
        const result = await chrome.storage.local.get(STORAGE_KEYS.DISMISSED_DOMAINS);
        const dismissedDomains = result[STORAGE_KEYS.DISMISSED_DOMAINS] || [];
        if (!dismissedDomains.includes(domain)) {
            dismissedDomains.push(domain);
            await chrome.storage.local.set({ [STORAGE_KEYS.DISMISSED_DOMAINS]: dismissedDomains });
            
            // Get the current tab to update its icon
            const [tab] = await chrome.runtime.sendMessage({ action: 'getTab' });
            if (tab && tab.id) {
                await chrome.runtime.sendMessage({
                    action: 'updateIcon',
                    tabId: tab.id,
                    isDismissed: true
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
    try {
        const config = await getConfig();
        const domainList = await getDomainList();
        
        // Parse the URL to get the domain
        let domain;
        try {
            const urlObj = new URL(url);
            domain = urlObj.hostname;
        } catch (e) {
            console.error('Invalid URL:', url);
            return;
        }
        
        // Check if the domain is in our list
        const matchedDomain = domainList.find(d => 
            domain === d || domain.endsWith('.' + d)
        );
        
        if (!matchedDomain) {
            // Update icon to normal state for non-library domains
            const [tab] = await chrome.runtime.sendMessage({ action: 'getTab' });
            if (tab && tab.id) {
                await chrome.runtime.sendMessage({
                    action: 'updateIcon',
                    tabId: tab.id,
                    isDismissed: false
                });
            }
            return;
        }
        
        // Check if the domain is dismissed
        const isDismissed = await isDomainDismissed(matchedDomain);
        if (isDismissed) {
            // Update icon to dismissed state
            const [tab] = await chrome.runtime.sendMessage({ action: 'getTab' });
            if (tab && tab.id) {
                await chrome.runtime.sendMessage({
                    action: 'updateIcon',
                    tabId: tab.id,
                    isDismissed: true
                });
            }
            return;
        }
        
        // Check if user has institutional access
        if (hasInstitutionalAccess(config)) {
            console.log('User has institutional access, skipping EZProxy notification');
            return;
        }
        
        // Check if domain was previously dismissed
        if (await isDomainDismissed(matchedDomain)) {
            console.log('Domain was previously dismissed, skipping notification');
            return;
        }
        
        // Ensure the EZProxy base URL ends with a forward slash
        let ezproxyBase = config.ezproxyBaseUrl;
        if (!ezproxyBase.endsWith('/')) {
            ezproxyBase = `${ezproxyBase}/`;
        }
        
        // Ensure the target URL doesn't include the protocol
        let targetUrl = url;
        if (targetUrl.startsWith('http://')) {
            targetUrl = targetUrl.substring(7);
        } else if (targetUrl.startsWith('https://')) {
            targetUrl = targetUrl.substring(8);
        }
        
        const ezproxyUrl = `${ezproxyBase}${targetUrl}`;
        console.log('Created EZProxy URL:', ezproxyUrl);
        
        // Show the banner
        createBanner(
            `This resource is available through ${config.institutionName || 'your library'}. Access the full content via EZProxy.`,
            ezproxyUrl,
            matchedDomain
        );
    } catch (error) {
        console.error('Error in checkAndShowBanner:', error);
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