// background.js

// Configuration will be loaded from config.json
let CONFIG = null;
let DOMAIN_LIST = new Set();

// Constants
const MIN_UPDATE_INTERVAL = 60000; // 1 minute

// Cache for transformed URLs to improve performance
const urlTransformCache = new Map();

async function loadConfig() {
    try {
        const configUrl = chrome.runtime.getURL('config.json');
        const response = await fetch(configUrl);
        if (!response.ok) {
            throw new Error(`Failed to load configuration: ${response.status}`);
        }
        
        const config = await response.json();
        
        // Validate required fields
        const requiredFields = [
            'domainListUrl', 
            'ezproxyBaseUrl', 
            'institutionName', 
            'bannerMessage',
            'updateInterval',
            'retryAttempts',
            'retryDelay',
            'enableAutoRedirect',
            'enableUserNotifications'
        ];
        
        const missingFields = requiredFields.filter(field => config[field] === undefined);
        
        if (missingFields.length > 0) {
            throw new Error(`Missing required configuration fields: ${missingFields.join(', ')}`);
        }
        
        // Ensure updateInterval is a valid number and meets minimum requirement
        if (typeof config.updateInterval !== 'number' || config.updateInterval < MIN_UPDATE_INTERVAL) {
            throw new Error(`updateInterval must be a number >= ${MIN_UPDATE_INTERVAL}ms (1 minute)`);
        }
        
        // Ensure retryAttempts is a valid number
        if (typeof config.retryAttempts !== 'number' || config.retryAttempts < 0) {
            throw new Error('retryAttempts must be a non-negative number');
        }
        
        // Ensure retryDelay is a valid number
        if (typeof config.retryDelay !== 'number' || config.retryDelay < 0) {
            throw new Error('retryDelay must be a non-negative number');
        }
        
        CONFIG = config;
        console.log('Configuration loaded successfully');
        return true;
    } catch (error) {
        console.error('Error loading configuration:', error);
        throw error; // Rethrow to prevent extension from running with invalid config
    }
}

async function loadLocalDomainList() {
    try {
        const domainListUrl = chrome.runtime.getURL('domain-list.json');
        const response = await fetch(domainListUrl);
        if (!response.ok) {
            throw new Error(`Failed to load local domain list: ${response.status}`);
        }
        const domains = await response.json();
        
        // Validate domain list format
        if (!Array.isArray(domains)) {
            throw new Error('Domain list must be an array');
        }
        
        return new Set(domains.filter(domain => typeof domain === 'string' && domain.length > 0));
    } catch (error) {
        console.error('Error loading local domain list:', error);
        return new Set(); // Return empty set as last resort
    }
}

async function fetchWithRetry(url, maxRetries = CONFIG.retryAttempts, retryDelay = CONFIG.retryDelay) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return response;
        } catch (error) {
            lastError = error;
            console.log(`Fetch attempt ${attempt}/${maxRetries} failed:`, error.message);
            
            if (attempt < maxRetries) {
                const delay = retryDelay * Math.pow(2, attempt - 1); // Exponential backoff
                console.log(`Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    
    throw lastError;
}

async function updateDomainList() {
    try {
        // Try to load from storage first
        const stored = await chrome.storage.local.get(['domainList', 'lastUpdate']);
        if (stored.domainList && Array.isArray(stored.domainList)) {
            DOMAIN_LIST = new Set(stored.domainList);
            console.log(`Domain list loaded from storage (${DOMAIN_LIST.size} domains)`);
            
            // Check if we need to update based on interval
            const now = Date.now();
            const lastUpdate = stored.lastUpdate || 0;
            const timeSinceUpdate = now - lastUpdate;
            
            if (timeSinceUpdate < CONFIG.updateInterval) {
                console.log(`Domain list is up to date (last updated ${Math.round(timeSinceUpdate / 1000 / 60)} minutes ago)`);
                return;
            }
        }

        // If we get here, we need to fetch a fresh list
        console.log('Fetching remote domain list from:', CONFIG.domainListUrl);
        const response = await fetchWithRetry(CONFIG.domainListUrl, CONFIG.retryAttempts, CONFIG.retryDelay);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const domains = await response.json();
        
        // Validate remote domain list
        if (!Array.isArray(domains)) {
            throw new Error('Remote domain list is not an array');
        }
        
        const validDomains = domains
            .filter(domain => typeof domain === 'string' && domain.length > 0)
            .map(domain => domain.toLowerCase().trim())
            .filter(domain => {
                // Basic domain validation
                try {
                    new URL(domain.startsWith('http') ? domain : `https://${domain}`);
                    return true;
                } catch {
                    console.warn(`Invalid domain format: ${domain}`);
                    return false;
                }
            });
            
        if (validDomains.length === 0) {
            throw new Error('No valid domains found in the domain list');
        }
        
        DOMAIN_LIST = new Set(validDomains);
        
        // Store in local storage for offline access
        await chrome.storage.local.set({ 
            domainList: Array.from(DOMAIN_LIST),
            lastUpdate: Date.now()
        });
        
        // Clear URL transform cache when domain list updates
        urlTransformCache.clear();
        
        console.log(`Domain list updated successfully (${DOMAIN_LIST.size} domains)`);
        return true;
    } catch (error) {
        console.error('Error updating domain list:', error);
        
        // If we don't have a domain list yet, try to load the local fallback
        if (DOMAIN_LIST.size === 0) {
            console.log('Attempting to load local domain list as fallback...');
            try {
                const localDomains = await loadLocalDomainList();
                if (localDomains.size > 0) {
                    DOMAIN_LIST = localDomains;
                    console.log(`Loaded ${localDomains.size} domains from local fallback`);
                    return true;
                }
            } catch (localError) {
                console.error('Error loading local domain list:', localError);
            }
            
            // If we get here, we have no domains at all
            console.error('CRITICAL: No domain list available (local or remote)');
            throw new Error('No domain list available. Please check your internet connection and try again.');
        }
        
        // If we have an existing domain list, we can continue using it
        console.log(`Using existing domain list (${DOMAIN_LIST.size} domains)`);
        return false;
    }
}

function transformDomainForEzproxy(domain) {
    // Use cache to improve performance
    if (urlTransformCache.has(domain)) {
        return urlTransformCache.get(domain);
    }
    
    const transformed = domain.replace(/\./g, '-');
    urlTransformCache.set(domain, transformed);
    return transformed;
}

function buildEzproxyUrl(originalUrl, domain) {
    try {
        const url = new URL(originalUrl);
        const transformedDomain = transformDomainForEzproxy(domain);
        const ezproxyUrl = `${url.protocol}//${transformedDomain}.${CONFIG.ezproxyBaseUrl}${url.pathname}${url.search}${url.hash}`;
        
        // Basic URL validation
        new URL(ezproxyUrl); // Will throw if invalid
        return ezproxyUrl;
    } catch (error) {
        console.error('Error building EZProxy URL:', error);
        return null;
    }
}

// Debounce function for tab updates
let tabUpdateTimeout;
function debounceTabUpdate(callback, delay = 100) {
    clearTimeout(tabUpdateTimeout);
    tabUpdateTimeout = setTimeout(callback, delay);
}

// Listen for tab updates to check domain status
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url) {
        try {
            // Check if the tab's URL is in the dismissed domains list
            const url = new URL(tab.url);
            const domain = url.hostname;
            
            // Get the current tab's ID
            const currentTab = await chrome.tabs.get(tabId);
            
            // Check if the domain is dismissed
            const result = await chrome.storage.local.get('ezproxy-dismissed-domains');
            const dismissedDomains = result['ezproxy-dismissed-domains'] || [];
            const isDismissed = dismissedDomains.some(d => 
                domain.endsWith(d) || domain === d
            );
            
            // Update the icon based on the domain's dismissal status
            await updateExtensionIcon(tabId, isDismissed);
        } catch (error) {
            console.error('Error in tab update listener:', error);
        }
    }
});

// Listen for messages from content scripts and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Received message in background:', request.action || 'unknown action', request);
    
    // Handle updateIcon action
    if (request.action === 'updateIcon') {
        updateExtensionIcon(request.tabId, request.isDismissed)
            .then(() => sendResponse({ success: true }))
            .catch(error => {
                console.error('Error updating icon:', error);
                sendResponse({ success: false, error: error.message });
            });
        return true; // Required for async response
    }
    
    // Handle dismissDomain action
    if (request.action === 'dismissDomain') {
        console.log('Handling dismissDomain for domain:', request.domain);
        // Get the current active tab to update its icon
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs && tabs[0] && tabs[0].id) {
                console.log('Updating icon for tab:', tabs[0].id);
                updateExtensionIcon(tabs[0].id, true)
                    .then(() => {
                        console.log('Icon updated successfully after domain dismissal');
                        sendResponse({ success: true });
                    })
                    .catch(error => {
                        console.error('Error updating icon after domain dismissal:', error);
                        sendResponse({ success: false, error: error.message });
                    });
            } else {
                console.warn('No active tab found to update icon');
                sendResponse({ success: false, error: 'No active tab found' });
            }
        });
        return true; // Required for async response
    }
    
    // Handle getTab action
    if (request.action === 'getTab') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            sendResponse(tabs);
        });
        return true; // Required for async response
    }
    
    // Handle getTabId action
    if (request.action === 'getTabId') {
        sendResponse({ tabId: sender.tab ? sender.tab.id : null });
        return true;
    }
    
    // Handle GET_CONFIG action
    if (request.type === 'GET_CONFIG') {
        if (CONFIG) {
            sendResponse({ config: CONFIG });
        } else {
            loadConfig()
                .then(() => sendResponse({ config: CONFIG }))
                .catch(error => {
                    console.error('Error loading config for content script:', error);
                    sendResponse({ error: 'Failed to load configuration' });
                });
        }
        return true; // Required for async response
    }
    
    // Log unhandled messages for debugging
    console.warn('Unhandled message in background script:', request);
    return false;
});

// Test function to verify icon updates
async function testIconUpdate() {
    console.log('Testing icon update functionality...');
    
    // Try to get the current tab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs[0] && tabs[0].id) {
        const tabId = tabs[0].id;
        console.log(`Found active tab: ${tabId}`);
        
        // Test setting the dismissed icon
        try {
            console.log('Setting dismissed icon...');
            await updateExtensionIcon(tabId, true);
            console.log('Dismissed icon set successfully');
            
            // Set a timeout to reset the icon after 3 seconds
            setTimeout(async () => {
                console.log('Resetting to normal icon...');
                await updateExtensionIcon(tabId, false);
                console.log('Normal icon restored');
            }, 3000);
            
        } catch (error) {
            console.error('Error testing icon update:', error);
        }
    } else {
        console.error('No active tab found for testing');
    }
}

// Helper function to update the extension icon
async function updateExtensionIcon(tabId, isDismissed) {
    console.log(`[updateExtensionIcon] Updating icon for tab ${tabId}, isDismissed: ${isDismissed}`);
    
    // Define icon paths - using chrome.runtime.getURL() for proper resource loading
    const getIconPath = (size, dismissed = false) => 
        chrome.runtime.getURL(`images/icon${dismissed ? '-dismissed' : ''}-${size}.png`);
        
    const icons = {
        '16': getIconPath(16, isDismissed),
        '32': getIconPath(32, isDismissed),
        '48': chrome.runtime.getURL('images/icon-48.png'),
        '128': chrome.runtime.getURL('images/icon-128.png')
    };
    
    console.log('Using icon paths:', icons);
    
    console.log('[updateExtensionIcon] Using icon paths:', icons);
    
    // Set the title based on dismissed state
    const title = isDismissed 
        ? 'EZProxy: Banner is dismissed for this domain'
        : 'EZProxy: Click to access library resources';
    
    try {
        // First try to update the tab-specific icon
        if (tabId) {
            console.log(`[updateExtensionIcon] Updating icon for specific tab ${tabId}`);
            try {
                await chrome.action.setIcon({
                    tabId: tabId,
                    path: icons
                });
                console.log(`[updateExtensionIcon] Successfully updated tab ${tabId} icon`);
                
                // Also update the title
                await chrome.action.setTitle({
                    tabId: tabId,
                    title: title
                });
                console.log(`[updateExtensionIcon] Set title for tab ${tabId}: ${title}`);
                
                // Also update the badge
                await chrome.action.setBadgeText({
                    tabId: tabId,
                    text: isDismissed ? 'X' : ''
                });
                
                await chrome.action.setBadgeBackgroundColor({
                    tabId: tabId,
                    color: isDismissed ? '#dc3545' : [0, 0, 0, 0]
                });
                
                return; // Successfully updated tab-specific icon
                
            } catch (tabError) {
                console.error(`[updateExtensionIcon] Error updating tab ${tabId} icon:`, tabError);
                // Continue to try updating the global icon
            }
        }
        
        // If we get here, either tabId wasn't provided or tab-specific update failed
        console.log('[updateExtensionIcon] Updating global icon');
        await chrome.action.setIcon({
            tabId: undefined, // Update global icon
            path: icons
        });
        
        // Update global title
        await chrome.action.setTitle({
            tabId: undefined,
            title: title
        });
        
        console.log('[updateExtensionIcon] Successfully updated global icon and title');
        
    } catch (error) {
        console.error('[updateExtensionIcon] Error in updateExtensionIcon:', error);
        throw error;
    }
}

// Initialize extension
async function initialize() {
    try {
        console.log('Initializing EZProxy extension...');
        
        // Load configuration - will throw if config is invalid
        await loadConfig();
        
        // Load domain list
        await updateDomainList();
        
        // Schedule periodic updates
        setInterval(updateDomainList, CONFIG.updateInterval);
        console.log(`Scheduled domain list updates every ${CONFIG.updateInterval / 1000 / 60} minutes`);
        
        console.log('EZProxy extension initialized successfully');
        
        // Run the icon test
        setTimeout(testIconUpdate, 1000);
    } catch (error) {
        console.error('Fatal error initializing extension:', error);
        // No fallback - extension requires valid configuration
        throw error;
    }
}

// Start initialization
initialize();

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Only process when page is complete and we have a URL
    if (changeInfo.status !== 'complete' || !tab.url) {
        return;
    }
    
    // Skip non-HTTP(S) URLs
    if (!tab.url.startsWith('http://') && !tab.url.startsWith('https://')) {
        return;
    }
    
    // Debounce rapid tab updates
    debounceTabUpdate(() => {
        try {
            const url = new URL(tab.url);
            const currentDomain = url.hostname;
            
            // Remove 'www.' if it exists
            const domainWithoutWww = currentDomain.replace(/^www\./, '');
            
            if (DOMAIN_LIST.has(domainWithoutWww)) {
                console.log('Domain matches tracking list:', domainWithoutWww);
                
                const ezproxyUrl = buildEzproxyUrl(tab.url, domainWithoutWww);
                if (!ezproxyUrl) {
                    console.error('Failed to build EZProxy URL for:', domainWithoutWww);
                    return;
                }
                
                chrome.tabs.sendMessage(tabId, {
                    type: 'DOMAIN_MATCH',
                    domain: domainWithoutWww,
                    originalUrl: tab.url,
                    ezproxyUrl: ezproxyUrl,
                    bannerMessage: CONFIG.bannerMessage
                }).catch(error => {
                    // This is expected for pages that don't have content scripts loaded
                    if (!error.message.includes('Receiving end does not exist')) {
                        console.error('Error sending message to content script:', error);
                    }
                });
            }
        } catch (error) {
            console.error('Error processing URL:', error);
        }
    });
});
