// content.js

// Constants
const BANNER_ID = 'ezproxy-banner';
const STORAGE_KEY_DISMISSED = 'ezproxy-dismissed-domains';
const STORAGE_KEY_AUTO_REDIRECT = 'ezproxy-auto-redirect';

// Check if user has reduced motion preference
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function hasInstitutionalAccess() {
    const pageText = document.body.textContent || '';
    return pageText.includes('Access provided by') && 
           (pageText.includes('Western Washington University') || 
            pageText.includes('WWU') || 
            pageText.includes('www.wwu.edu'));
}

async function isDomainDismissed(domain) {
    try {
        const result = await chrome.storage.local.get(STORAGE_KEY_DISMISSED);
        const dismissedDomains = result[STORAGE_KEY_DISMISSED] || [];
        return dismissedDomains.includes(domain);
    } catch (error) {
        console.error('Error checking dismissed domains:', error);
        return false;
    }
}

async function dismissDomain(domain) {
    try {
        const result = await chrome.storage.local.get(STORAGE_KEY_DISMISSED);
        const dismissedDomains = result[STORAGE_KEY_DISMISSED] || [];
        if (!dismissedDomains.includes(domain)) {
            dismissedDomains.push(domain);
            await chrome.storage.local.set({ [STORAGE_KEY_DISMISSED]: dismissedDomains });
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

function createBanner(message, ezproxyUrl, domain) {
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
        background-color: #f8f9fa;
        border-bottom: 1px solid #dee2e6;
        padding: 12px 20px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        font-size: 14px;
        line-height: 1.5;
    `;
    
    // Add animation styles if motion is not reduced
    const animationStyles = prefersReducedMotion ? '' : `
        transform: translateY(-100%);
        transition: transform 0.3s ease-out;
    `;
    
    // Mobile responsive styles
    const responsiveStyles = `
        @media (max-width: 768px) {
            flex-direction: column;
            gap: 10px;
            padding: 15px;
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

    const messageDiv = document.createElement('div');
    messageDiv.className = 'banner-message';
    messageDiv.textContent = message;
    messageDiv.style.cssText = `
        color: #495057;
        flex: 1;
        margin-right: 15px;
    `;

    const buttonsDiv = document.createElement('div');
    buttonsDiv.className = 'banner-buttons';

    // Main redirect button
    const redirectButton = document.createElement('button');
    redirectButton.textContent = 'Access via EZProxy';
    redirectButton.setAttribute('aria-label', 'Access this resource via EZProxy');
    redirectButton.style.cssText = `
        background-color: #0d6efd;
        color: white;
        border: none;
        padding: 8px 16px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        transition: background-color 0.2s ease;
    `;
    
    // Add hover and focus styles
    redirectButton.addEventListener('mouseenter', () => {
        redirectButton.style.backgroundColor = '#0b5ed7';
    });
    redirectButton.addEventListener('mouseleave', () => {
        redirectButton.style.backgroundColor = '#0d6efd';
    });
    redirectButton.addEventListener('focus', () => {
        redirectButton.style.outline = '2px solid #0d6efd';
        redirectButton.style.outlineOffset = '2px';
    });
    redirectButton.addEventListener('blur', () => {
        redirectButton.style.outline = '';
        redirectButton.style.outlineOffset = '';
    });
    
    redirectButton.addEventListener('click', () => {
        window.location.href = ezproxyUrl;
    });

    // Dismiss button
    const dismissButton = document.createElement('button');
    dismissButton.textContent = 'Not now';
    dismissButton.setAttribute('aria-label', 'Dismiss this notification');
    dismissButton.style.cssText = `
        background: none;
        border: 1px solid #6c757d;
        color: #6c757d;
        cursor: pointer;
        font-size: 14px;
        padding: 6px 12px;
        border-radius: 4px;
        transition: all 0.2s ease;
    `;
    
    dismissButton.addEventListener('mouseenter', () => {
        dismissButton.style.backgroundColor = '#6c757d';
        dismissButton.style.color = 'white';
    });
    dismissButton.addEventListener('mouseleave', () => {
        dismissButton.style.backgroundColor = 'transparent';
        dismissButton.style.color = '#6c757d';
    });
    dismissButton.addEventListener('focus', () => {
        dismissButton.style.outline = '2px solid #6c757d';
        dismissButton.style.outlineOffset = '2px';
    });
    dismissButton.addEventListener('blur', () => {
        dismissButton.style.outline = '';
        dismissButton.style.outlineOffset = '';
    });
    
    dismissButton.addEventListener('click', () => {
        removeBanner();
    });

    // Close button (X)
    const closeButton = document.createElement('button');
    closeButton.textContent = '✕';
    closeButton.setAttribute('aria-label', 'Close notification');
    closeButton.style.cssText = `
        background: none;
        border: none;
        color: #6c757d;
        cursor: pointer;
        font-size: 18px;
        padding: 0 8px;
        margin-left: 8px;
        border-radius: 4px;
        transition: color 0.2s ease;
    `;
    
    closeButton.addEventListener('mouseenter', () => {
        closeButton.style.color = '#495057';
    });
    closeButton.addEventListener('mouseleave', () => {
        closeButton.style.color = '#6c757d';
    });
    closeButton.addEventListener('focus', () => {
        closeButton.style.outline = '2px solid #6c757d';
        closeButton.style.outlineOffset = '2px';
    });
    closeButton.addEventListener('blur', () => {
        closeButton.style.outline = '';
        closeButton.style.outlineOffset = '';
    });
    
    closeButton.addEventListener('click', async () => {
        await dismissDomain(domain);
        removeBanner();
    });

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

function removeBanner() {
    const banner = document.getElementById(BANNER_ID);
    if (!banner) return;

    if (!prefersReducedMotion) {
        // Animate out
        banner.style.transform = 'translateY(-100%)';
        setTimeout(() => {
            banner.remove();
            restorePageMargin();
        }, 300);
    } else {
        // Immediate removal
        banner.remove();
        restorePageMargin();
    }
}

// Enhanced message listener with auto-redirect support
chrome.runtime.onMessage.addListener(async (message) => {
    if (message.type === 'DOMAIN_MATCH') {
        // Check if user has institutional access
        if (hasInstitutionalAccess()) {
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