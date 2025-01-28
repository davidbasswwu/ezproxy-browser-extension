// background.js
let DOMAIN_LIST = new Set();

// URL of the remote domain list (replace with your actual hosted JSON file URL)
const DOMAIN_LIST_URL = 'https://raw.githubusercontent.com/davidbasswwu/ezproxy-browser-extension/refs/heads/main/domain-list.json?token=GHSAT0AAAAAAC6BO7BVF6N6HZN7UCH77D62Z4ZJB7A';
const UPDATE_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

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
        console.error('Error updating domain list:', error);
    }
}

// Update domain list on extension startup
updateDomainList();

// Schedule periodic updates
setInterval(updateDomainList, UPDATE_INTERVAL);

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    const url = new URL(tab.url);
    console.log('URL:', url);

    const currentDomain = url.hostname;
    console.log('Current domain:', currentDomain);

    if (DOMAIN_LIST.has(currentDomain)) {
      chrome.tabs.sendMessage(tabId, {
        type: 'DOMAIN_MATCH',
        domain: currentDomain
      });
    }
  }
});
