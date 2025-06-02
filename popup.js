// Constants
const STORAGE_KEYS = {
    DISMISSED_DOMAINS: 'ezproxy-dismissed-domains',
    AUTO_REDIRECT: 'ezproxy-auto-redirect'
};

// Get DOM elements
const statusDiv = document.getElementById('status');
const accessButton = document.getElementById('accessButton');
const resetButton = document.getElementById('resetDismissed');

// Check the current tab's status when popup opens
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Set initial status
        updateStatus('Checking current page...', false);
        
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        console.log('Current tab:', tab);
        
        if (!tab || !tab.url) {
            console.error('No tab or URL found');
            updateStatus('Could not access current tab', false);
            return;
        }
        
        console.log('Checking URL:', tab.url);
        
        // Check if current URL is in the domain list
        const domainList = await getDomainList();
        console.log('Domain list loaded, length:', domainList.length);
        
        if (!domainList || domainList.length === 0) {
            console.error('Domain list is empty or failed to load');
            updateStatus('Domain list could not be loaded', false);
            return;
        }
        
        const currentUrl = new URL(tab.url);
        console.log('Current hostname:', currentUrl.hostname);
        
        // Check if domain matches any in the list
        const isDomainInList = domainList.some(domain => {
            const matches = currentUrl.hostname.endsWith(domain) || currentUrl.hostname === domain;
            if (matches) console.log('Match found with domain:', domain);
            return matches;
        });
        
        console.log('Is domain in list:', isDomainInList);
        
        if (!isDomainInList) {
            updateStatus('Current page is not a known library resource', false);
            return;
        }
        
        // Check if domain is dismissed
        const result = await chrome.storage.local.get(STORAGE_KEYS.DISMISSED_DOMAINS);
        const dismissedDomains = result[STORAGE_KEYS.DISMISSED_DOMAINS] || [];
        const isDismissed = dismissedDomains.some(d => 
            currentUrl.hostname.endsWith(d) || 
            currentUrl.hostname === d
        );
        
        if (isDismissed) {
            updateStatus('Banner is currently dismissed for this domain', false);
            accessButton.disabled = false;
            accessButton.textContent = 'Show Banner Again';
            accessButton.onclick = async () => {
                console.log('Show Banner Again button clicked for domain:', currentUrl.hostname);
                await undismissDomain(currentUrl.hostname);
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
    console.log('Reset button clicked');
    
    // Show confirmation dialog
    const confirmed = confirm('Are you sure you want to reset all dismissed domains? This will re-enable the banner for all previously dismissed domains.');
    
    if (!confirmed) {
        console.log('Reset cancelled by user');
        return;
    }
    
    try {
        console.log('Starting reset process...');
        
        // Save the original button text
        const originalButtonText = resetButton.textContent;
        resetButton.disabled = true;
        resetButton.textContent = 'Resetting...';
        
        // Clear the dismissed domains
        console.log('Clearing dismissed domains from storage...');
        await chrome.storage.local.remove(STORAGE_KEYS.DISMISSED_DOMAINS);
        console.log('Dismissed domains cleared');
        
        // Verify the domains were cleared
        const result = await chrome.storage.local.get(STORAGE_KEYS.DISMISSED_DOMAINS);
        console.log('Storage after clear:', result);
        
        // Update the status
        updateStatus('Successfully reset all dismissed domains. Reloading page...', true);
        
        // Get the current active tab first
        const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        console.log('Current active tab:', currentTab);
        
        if (currentTab && currentTab.id) {
            // Reset the icon for the current tab first
            console.log(`Updating icon for current tab ${currentTab.id}`);
            try {
                await chrome.runtime.sendMessage({
                    action: 'updateIcon',
                    tabId: currentTab.id,
                    isDismissed: false
                });
                console.log('Icon updated for current tab');
            } catch (error) {
                console.error('Error updating icon for current tab:', error);
            }
            
            // Reload the current tab to show the banner
            console.log('Reloading current tab...');
            await chrome.tabs.reload(currentTab.id);
            console.log('Current tab reloaded');
        }
        
        // Reset icons for all other tabs in the background
        console.log('Updating icons for all tabs...');
        const allTabs = await chrome.tabs.query({});
        for (const tab of allTabs) {
            if (tab.id && tab.id !== currentTab?.id) {
                try {
                    await chrome.runtime.sendMessage({
                        action: 'updateIcon',
                        tabId: tab.id,
                        isDismissed: false
                    });
                    console.log(`Updated icon for tab ${tab.id}`);
                } catch (error) {
                    console.error(`Error updating icon for tab ${tab.id}:`, error);
                }
            }
        }
        
        console.log('Reset process completed');
        
        // Close the popup after a short delay
        setTimeout(() => {
            console.log('Closing popup...');
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
    console.log(`Updating status: ${message}, isActive: ${isActive}`);
    
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
        console.log('Domain list loaded successfully, entries:', data.length);
        return Array.isArray(data) ? data : [];
    } catch (error) {
        console.error('Error loading domain list:', error);
        // Try to load a backup list from storage
        try {
            const result = await chrome.storage.local.get('ezproxy-domain-list-backup');
            const backupList = result['ezproxy-domain-list-backup'];
            console.log('Using backup domain list from storage:', backupList ? backupList.length : 0, 'entries');
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
        
        // Ensure the target URL is properly formatted
        let targetUrl = url;
        if (targetUrl.startsWith('http://')) {
            targetUrl = targetUrl.substring(7); // Remove http://
        } else if (targetUrl.startsWith('https://')) {
            targetUrl = targetUrl.substring(8); // Remove https://
        }
        
        // Ensure the EZProxy base URL ends with a forward slash
        let ezproxyBase = config.ezproxyBaseUrl;
        if (!ezproxyBase.endsWith('/')) {
            ezproxyBase = `${ezproxyBase}/`;
        }
        
        const ezproxyUrl = `${ezproxyBase}${targetUrl}`;
        console.log('Redirecting to EZProxy URL:', ezproxyUrl);
        
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
        console.log('Undismissing domain:', domain);
        
        // Get the current list of dismissed domains
        const result = await chrome.storage.local.get(STORAGE_KEYS.DISMISSED_DOMAINS);
        const dismissedDomains = result[STORAGE_KEYS.DISMISSED_DOMAINS] || [];
        console.log('Current dismissed domains:', dismissedDomains);
        
        // Find the exact dismissed domain entry that matches the current hostname
        const matchingDomain = dismissedDomains.find(d => 
            domain.endsWith(d) || domain === d
        );
        
        if (!matchingDomain) {
            console.warn('Could not find matching dismissed domain for:', domain);
            updateStatus('Domain was not found in dismissed list', false);
            return;
        }
        
        console.log('Found matching dismissed domain:', matchingDomain);
        
        // Remove the domain from the dismissed list
        const updatedDomains = dismissedDomains.filter(d => d !== matchingDomain);
        console.log('Updated dismissed domains:', updatedDomains);
        
        // Save the updated list
        await chrome.storage.local.set({ [STORAGE_KEYS.DISMISSED_DOMAINS]: updatedDomains });
        console.log('Saved updated dismissed domains list');
        
        // Update the extension icon to show normal state
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.id) {
            console.log('Sending updateIcon message for tab:', tab.id);
            await chrome.runtime.sendMessage({
                action: 'updateIcon',
                tabId: tab.id,
                isDismissed: false
            });
            
            // Update the UI
            updateStatus('Banner will show again on next visit', true);
            accessButton.disabled = true;
            accessButton.textContent = 'Access via EZProxy';
            
            // Reload the current tab to show the banner
            console.log('Reloading tab:', tab.id);
            await chrome.tabs.reload(tab.id);
            window.close();
        }
    } catch (error) {
        console.error('Error undismissing domain:', error);
        updateStatus('Error updating settings', false);
    }
}
