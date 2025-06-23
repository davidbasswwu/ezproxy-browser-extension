// Constants
const STORAGE_KEYS = {
    DISMISSED_DOMAINS: 'ezproxy-dismissed-domains',
    AUTO_REDIRECT: 'ezproxy-auto-redirect'
};
// Global list of exception domains loaded from domain-list.json
let EXCEPTION_DOMAINS = [];

// Get DOM elements
const statusDiv = document.getElementById('status');
const accessButton = document.getElementById('accessButton');
const resetButton = document.getElementById('resetDismissed');

// Production logging helper - only logs in development mode
function debugLog(message, data = null) {
    try {
        // Only log in development or when debugging is explicitly enabled
        const isDebugMode = localStorage.getItem('ezproxy-debug') === 'true';
        if (isDebugMode) {
            if (data) {
                debugLog(`[EZProxy-Popup] ${message}`, data);
            } else {
                debugLog(`[EZProxy-Popup] ${message}`);
            }
        }
    } catch (e) {
        // Silently fail if logging fails
    }
}

// Check the current tab's status when popup opens
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Set initial status
        updateStatus('Checking current page...', false);
        
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        debugLog('Current tab:', tab);
        
        if (!tab || !tab.url) {
            console.error('No tab or URL found');
            updateStatus('Could not access current tab', false);
            return;
        }
        
        debugLog('Checking URL:', tab.url);
        
        // Check if current URL is in the domain list or exception list
        const domainList = await getDomainList();
        debugLog('Domain list loaded, length:', domainList.length, 'Exceptions:', EXCEPTION_DOMAINS.length);
        
        if (!domainList || domainList.length === 0) {
            console.error('Domain list is empty or failed to load');
            updateStatus('Domain list could not be loaded', false);
            return;
        }
        
        const currentUrl = new URL(tab.url);
        debugLog('Current hostname:', currentUrl.hostname);

        // Load config for EZProxy base and help URL (ensure defined before using)
        const config = await (await fetch(chrome.runtime.getURL('config.json'))).json();
        const ezproxyBaseUrl = config.ezproxyBaseUrl;
        const libraryHelpUrl = config.libraryHelpUrl;
        const secondaryHelpButtonText = config.secondaryHelpButtonText || 'Info for this site';

        // Detect if current page is already proxied
        if (currentUrl.hostname.includes(ezproxyBaseUrl)) {
            updateStatus('You are already on a proxied page.', true);
            accessButton.disabled = false;
            accessButton.textContent = secondaryHelpButtonText;
            const baseDomain = getBaseDomainFromProxied(currentUrl.hostname, ezproxyBaseUrl);
            let helpUrl = libraryHelpUrl;
            if (helpUrl) {
                helpUrl += (helpUrl.includes('?') ? '&' : '?') + 'q=' + encodeURIComponent(baseDomain);
            }
            accessButton.onclick = () => {
                chrome.tabs.create({ url: helpUrl });
                window.close();
            };
            return;
        }

        // First, handle exception domains that require special help flow
        const isExceptionDomain = Array.isArray(EXCEPTION_DOMAINS) && EXCEPTION_DOMAINS.some(ex => currentUrl.hostname.endsWith(ex) || currentUrl.hostname === ex);
        if (isExceptionDomain) {
            const baseDomainParts = currentUrl.hostname.split('.');
            const baseDomain = baseDomainParts.slice(-2).join('.');
            let helpUrl = libraryHelpUrl;
            if (helpUrl) {
                helpUrl += (helpUrl.includes('?') ? '&' : '?') + 'q=' + encodeURIComponent(baseDomain);
            }
            updateStatus('This site may require special access. See library help.', true);
            accessButton.disabled = false;
            accessButton.textContent = secondaryHelpButtonText;
            accessButton.onclick = () => {
                chrome.tabs.create({ url: helpUrl });
                window.close();
            };
            return;
        }
        
        // Check if domain matches any in the list
        const isDomainInList = domainList.some(domain => {
            const matches = currentUrl.hostname.endsWith(domain) || currentUrl.hostname === domain;
            if (matches) debugLog('Match found with domain:', domain);
            return matches;
        });
        
        debugLog('Is domain in list:', isDomainInList);
        
        if (!isDomainInList) {
            updateStatus('Current page is not a known library resource', false);
            return;
        }
        
        // Check if domain is dismissed
        const result = await chrome.storage.local.get(STORAGE_KEYS.DISMISSED_DOMAINS);
        const dismissedDomains = result[STORAGE_KEYS.DISMISSED_DOMAINS] || [];
        debugLog('Checking dismissed domains:', dismissedDomains);
        
        // Find the specific dismissed domain that matches the current hostname
        const matchingDismissedDomain = dismissedDomains.find(d => 
            currentUrl.hostname.endsWith(d) || currentUrl.hostname === d
        );
        debugLog('Matching dismissed domain:', matchingDismissedDomain);
        
        const isDismissed = !!matchingDismissedDomain;
        
        if (isDismissed) {
            updateStatus('Banner is currently dismissed for this domain', false);
            accessButton.disabled = false;
            accessButton.textContent = 'Show Banner Again';
            accessButton.onclick = async () => {
                debugLog('Show Banner Again button clicked for domain:', currentUrl.hostname);
                // Store the matching domain for undismissing
                const domainToUndismiss = matchingDismissedDomain || currentUrl.hostname;
                debugLog('Will undismiss domain:', domainToUndismiss);
                await undismissDomain(domainToUndismiss);
            };
        } else {
            updateStatus('This page is a known library resource', true);
            accessButton.disabled = false;
            accessButton.onclick = () => redirectToEZProxy(tab.url);
        }
    } catch (error) {
        console.error('Error in popup:', error);
        updateStatus('Error checking current page', false);
    }
});

// Handle reset dismissed domains button
resetButton.addEventListener('click', async () => {
    debugLog('Reset button clicked');
    
    // Show confirmation dialog
    const confirmed = confirm('Are you sure you want to reset all dismissed domains? This will re-enable the banner for all previously dismissed domains.');
    
    if (!confirmed) {
        debugLog('Reset cancelled by user');
        return;
    }
    
    try {
        debugLog('Starting reset process...');
        
        // Save the original button text
        // Removed unused variable 'originalButtonText' to fix ESLint error
        
        // Clear the dismissed domains
        debugLog('Clearing dismissed domains from storage...');
        await chrome.storage.local.remove(STORAGE_KEYS.DISMISSED_DOMAINS);
        debugLog('Dismissed domains cleared');
        
        // Verify the domains were cleared
        const result = await chrome.storage.local.get(STORAGE_KEYS.DISMISSED_DOMAINS);
        debugLog('Storage after clear:', result);
        
        // Update the status
        updateStatus('Successfully reset all dismissed domains. Reloading page...', true);
        
        // Get the current active tab first
        const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        debugLog('Current active tab:', currentTab);
        
        if (currentTab && currentTab.id) {
            // Reset the icon for the current tab first
            debugLog(`Updating icon for current tab ${currentTab.id}`);
            try {
                await chrome.runtime.sendMessage({
                    action: 'updateIcon',
                    tabId: currentTab.id,
                    isDismissed: false
                });
                debugLog('Icon updated for current tab');
            } catch (error) {
                console.error('Error updating icon for current tab:', error);
            }
            
            // Reload the current tab to show the banner
            debugLog('Reloading current tab...');
            await chrome.tabs.reload(currentTab.id);
            debugLog('Current tab reloaded');
        }
        
        // Reset icons for all other tabs in the background
        debugLog('Updating icons for all tabs...');
        const allTabs = await chrome.tabs.query({});
        for (const tab of allTabs) {
            if (tab.id && tab.id !== currentTab?.id) {
                try {
                    await chrome.runtime.sendMessage({
                        action: 'updateIcon',
                        tabId: tab.id,
                        isDismissed: false
                    });
                    debugLog(`Updated icon for tab ${tab.id}`);
                } catch (error) {
                    console.error(`Error updating icon for tab ${tab.id}:`, error);
                }
            }
        }
        
        debugLog('Reset process completed');
        
        // Close the popup after a short delay
        setTimeout(() => {
            debugLog('Closing popup...');
            window.close();
        }, 1000);
        
    } catch (error) {
        console.error('Error in reset process:', error);
        updateStatus('Error: ' + (error.message || 'Failed to reset domains'), false);
        resetButton.disabled = false;
        resetButton.textContent = 'Try Again';
    }
});

// Helper function to update the status display
function updateStatus(message, isActive) {
    debugLog(`Updating status: ${message}, isActive: ${isActive}`);
    
    // Make sure the status div exists
    if (!statusDiv) {
        console.error('Status div not found in DOM');
        return;
    }
    
    // Update the text content
    statusDiv.textContent = message;
    
    // Update the class
    statusDiv.className = `status ${isActive ? 'active' : 'inactive'}`;
    
    // Update button state if it exists
    if (accessButton) {
        accessButton.disabled = !isActive && message !== 'Banner is currently dismissed for this domain';
    } else {
        console.error('Access button not found in DOM');
    }
}

// Helper function to get domain list
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
        let domainsArray = [];
        if (Array.isArray(data)) {
            domainsArray = data;
            EXCEPTION_DOMAINS = [];
        } else if (data && Array.isArray(data.domains)) {
            domainsArray = data.domains;
            EXCEPTION_DOMAINS = Array.isArray(data.exceptions) ? data.exceptions : [];
        }
        debugLog('Domain list loaded successfully, entries:', domainsArray.length, 'Exceptions:', EXCEPTION_DOMAINS.length);
        return domainsArray;
    } catch (error) {
        console.error('Error loading domain list:', error);
        // Try to load a backup list from storage
        try {
            const result = await chrome.storage.local.get('ezproxy-domain-list-backup');
            const backupList = result['ezproxy-domain-list-backup'];
            debugLog('Using backup domain list from storage:', backupList ? backupList.length : 0, 'entries');
            return Array.isArray(backupList) ? backupList : [];
        } catch (storageError) {
            console.error('Failed to load backup domain list:', storageError);
            return [];
        }
    }
}

// Helper function to redirect to EZProxy
async function redirectToEZProxy(url) {
    try {
        const config = await (await fetch(chrome.runtime.getURL('config.json'))).json();
        
        // Extract domain from URL
        let domain;
        try {
            const urlObj = new URL(url);
            domain = urlObj.hostname;
        } catch (e) {
            console.error('Invalid URL for EZProxy redirect:', url);
            updateStatus('Invalid URL for redirect', false);
            return;
        }
        
        // Create proper EZProxy subdomain URL with full path
        // Convert www.jstor.org/article/123 -> www-jstor-org.ezproxy.library.wwu.edu/article/123
        const transformedDomain = domain.replace(/\./g, '-');
        const currentUrl = new URL(url);
        const ezproxyUrl = `${currentUrl.protocol}//${transformedDomain}.${config.ezproxyBaseUrl}${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`;
        
        debugLog('Redirecting to EZProxy URL:', ezproxyUrl);
        
        await chrome.tabs.update({ url: ezproxyUrl });
        window.close();
    } catch (error) {
        console.error('Error redirecting to EZProxy:', error);
        updateStatus('Error redirecting to EZProxy', false);
    }
}

// Helper function to undismiss a domain
async function undismissDomain(domain) {
    try {
        debugLog('Undismissing domain:', domain);
        
        // Get the current list of dismissed domains
        const result = await chrome.storage.local.get(STORAGE_KEYS.DISMISSED_DOMAINS);
        const dismissedDomains = result[STORAGE_KEYS.DISMISSED_DOMAINS] || [];
        debugLog('Current dismissed domains:', dismissedDomains);
        
        if (dismissedDomains.length === 0) {
            console.warn('No dismissed domains found in storage');
            updateStatus('No dismissed domains found', false);
            return;
        }
        
        // For debugging, log each domain in the list and check if it matches
        debugLog('Checking each dismissed domain against:', domain);
        let foundMatches = [];
        
        dismissedDomains.forEach(d => {
            const endsWith = domain.endsWith(d);
            const exactMatch = domain === d;
            debugLog(`Domain: ${d}, endsWith: ${endsWith}, exactMatch: ${exactMatch}`);
            
            if (exactMatch || endsWith) {
                foundMatches.push(d);
            }
        });
        
        debugLog('Found matching dismissed domains:', foundMatches);
        
        if (foundMatches.length === 0) {
            console.warn('Could not find any matching dismissed domains for:', domain);
            updateStatus('No matching domains found in dismissed list', false);
            return;
        }
        
        // Remove all matching domains from the dismissed list
        const updatedDomains = dismissedDomains.filter(d => !foundMatches.includes(d));
        debugLog('Updated dismissed domains:', updatedDomains);
        
        // Save the updated list
        await chrome.storage.local.set({ [STORAGE_KEYS.DISMISSED_DOMAINS]: updatedDomains });
        debugLog('Saved updated dismissed domains list');
        
        // Update the extension icon to show normal state
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        debugLog('Current tab:', tab);
        
        if (tab && tab.id) {
            debugLog('Sending updateIcon message for tab:', tab.id);
            try {
                const response = await chrome.runtime.sendMessage({
                    action: 'updateIcon',
                    tabId: tab.id,
                    isDismissed: false
                });
                debugLog('Response from updateIcon message:', response);
            } catch (msgError) {
                console.error('Error sending updateIcon message:', msgError);
            }
            
            // Update the UI
            updateStatus('Banner will show again on next visit', true);
            accessButton.disabled = true;
            accessButton.textContent = 'Access via EZProxy';
            
            // Reload the current tab to show the banner
            debugLog('Reloading tab:', tab.id);
            await chrome.tabs.reload(tab.id);
            window.close();
        }
    } catch (error) {
        console.error('Error undismissing domain:', error);
        updateStatus('Error updating settings', false);
    }
}

// Utility to extract the base domain (e.g., chronicle.com) from a proxied hostname (e.g., www-chronicle-com.ezproxy.library.wwu.edu)
function getBaseDomainFromProxied(hostname, ezproxyBaseUrl) {
    // Remove the ezproxy part
    const proxiedPart = hostname.replace('.' + ezproxyBaseUrl, '');
    // Convert dashes to dots
    const original = proxiedPart.replace(/-/g, '.');
    // Return last two parts (base domain)
    const parts = original.split('.');
    if (parts.length <= 2) return original;
    return parts.slice(-2).join('.');
}
