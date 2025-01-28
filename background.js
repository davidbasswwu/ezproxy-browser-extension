// background.js
let DOMAIN_LIST = new Set();

// URL of the remote domain list
const DOMAIN_LIST_URL = 'https://raw.githubusercontent.com/davidbasswwu/ezproxy-browser-extension/main/domain-list.json';
const UPDATE_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

async function loadLocalDomainList() {
    try {
        const response = await fetch('domain-list.json');
        if (!response.ok) {
            throw new Error('Failed to load local domain list');
        }
        const domains = await response.json();
        return new Set(domains);
    } catch (error) {
        console.error('Error loading local domain list:', error);
        return new Set(); // Return empty set as last resort
    }
}

async function updateDomainList() {
    try {
        const response = await fetch(DOMAIN_LIST_URL);
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        const domains = await response.json();
        DOMAIN_LIST = new Set(domains);
        console.log('Domain list updated successfully');
    } catch (error) {
        console.log('Error updating remote domain list:', error);
        console.log('Falling back to local domain list');
        DOMAIN_LIST = await loadLocalDomainList();
    }
}

// Update domain list on extension startup
updateDomainList();

// Schedule periodic updates
setInterval(updateDomainList, UPDATE_INTERVAL);

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url) {
        try {
            const url = new URL(tab.url);
            const currentDomain = url.hostname;
            console.log('Current domain:', currentDomain);
            
            // Remove 'www.' if it exists
            const domainWithoutWww = currentDomain.replace(/^www\./, '');
            console.log('Domain without www:', domainWithoutWww);
            
            if (DOMAIN_LIST.has(domainWithoutWww)) {
                console.log('Domain matches tracking list:', domainWithoutWww);
                // Transform the domain for EZProxy
                const transformedDomain = domainWithoutWww.replace(/\./g, '-');
                console.log('Transformed domain for EZProxy:', transformedDomain);
                const ezproxyUrl = `${url.protocol}//${transformedDomain}.ezproxy.library.wwu.edu${url.pathname}${url.search}${url.hash}`;
                
                chrome.tabs.sendMessage(tabId, {
                    type: 'DOMAIN_MATCH',
                    domain: domainWithoutWww,
                    originalUrl: tab.url,
                    ezproxyUrl: ezproxyUrl
                }).catch(error => {
                    console.error('Error sending message to content script:', error);
                });
            }
        } catch (error) {
            console.error('Error processing URL:', error);
        }
    }
});
