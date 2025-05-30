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
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (!tab || !tab.url) {
            updateStatus('Could not access current tab', false);
            return;
        }
        
        // Check if current URL is in the domain list
        const domainList = await getDomainList();
        const currentUrl = new URL(tab.url);
        const isDomainInList = domainList.some(domain => 
            currentUrl.hostname.endsWith(domain) || 
            currentUrl.hostname === domain
        );
        
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
            accessButton.onclick = () => undismissDomain(currentUrl.hostname);
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
    statusDiv.textContent = message;
    statusDiv.className = `status ${isActive ? 'active' : 'inactive'}`;
}

// Helper function to get domain list
async function getDomainList() {
    try {
        const response = await fetch(chrome.runtime.getURL('domain-list.json'));
        return await response.json();
    } catch (error) {
        console.error('Error loading domain list:', error);
        return [];
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
        // Get the current list of dismissed domains
        const result = await chrome.storage.local.get(STORAGE_KEYS.DISMISSED_DOMAINS);
        const dismissedDomains = result[STORAGE_KEYS.DISMISSED_DOMAINS] || [];
        
        // Remove the domain from the dismissed list
        const updatedDomains = dismissedDomains.filter(d => d !== domain);
        
        // Save the updated list
        await chrome.storage.local.set({ [STORAGE_KEYS.DISMISSED_DOMAINS]: updatedDomains });
        
        // Update the extension icon to show normal state
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.id) {
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
            await chrome.tabs.reload(tab.id);
            window.close();
        }
    } catch (error) {
        console.error('Error undismissing domain:', error);
        updateStatus('Error updating settings', false);
    }
}
