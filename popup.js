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
    // Show confirmation dialog
    const confirmed = confirm('Are you sure you want to reset all dismissed domains? This will re-enable the banner for all previously dismissed domains.');
    
    if (!confirmed) {
        return;
    }
    
    try {
        // Save the original button text
        const originalButtonText = resetButton.textContent;
        resetButton.disabled = true;
        resetButton.textContent = 'Resetting...';
        
        // Clear the dismissed domains
        await chrome.storage.local.remove(STORAGE_KEYS.DISMISSED_DOMAINS);
        
        // Update the status
        updateStatus('Successfully reset all dismissed domains', true);
        
        // Reset the extension icon for all tabs
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
            if (tab.id) {
                try {
                    await chrome.runtime.sendMessage({
                        action: 'updateIcon',
                        tabId: tab.id,
                        isDismissed: false
                    });
                } catch (error) {
                    console.error(`Error updating icon for tab ${tab.id}:`, error);
                }
            }
        }
        
        // Reset the button state after a delay
        setTimeout(() => {
            resetButton.textContent = originalButtonText;
            resetButton.disabled = false;
            
            // Reload the current tab to show the banner if applicable
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0] && tabs[0].id) {
                    chrome.tabs.reload(tabs[0].id);
                }
            });
            
            // Close the popup after a short delay
            setTimeout(() => window.close(), 1000);
        }, 1000);
        
    } catch (error) {
        console.error('Error resetting dismissed domains:', error);
        updateStatus('Error resetting dismissed domains', false);
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
