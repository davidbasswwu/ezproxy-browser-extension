// background.js

// Configuration will be loaded from config.json
let CONFIG = null;
let DOMAIN_LIST = new Set();

// Constants
const MIN_UPDATE_INTERVAL = 60000; // 1 minute

// Cache for transformed URLs to improve performance
const urlTransformCache = new Map();

// Production logging helper - only logs in development mode
function debugLog(message, data = null) {
    try {
        // Only log in development or when debugging is explicitly enabled
        const isDebugMode = localStorage.getItem('ezproxy-debug') === 'true';
        if (isDebugMode) {
            if (data) {
                console.log(`[EZProxy-BG] ${message}`, data);
            } else {
                console.log(`[EZProxy-BG] ${message}`);
            }
        }
    } catch (e) {
        // Silently fail if logging fails
    }
}

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
        
        // Handle both formats: simple array or structured object
        let domainArray = [];
        if (Array.isArray(domains)) {
            // Legacy format: simple array
            domainArray = domains;
        } else if (domains && Array.isArray(domains.domains)) {
            // New format: structured object with domains and exceptions
            domainArray = domains.domains;
            debugLog('Local domain list has structured format with', domainArray.length, 'domains and', 
                       (domains.exceptions || []).length, 'exceptions');
        } else {
            throw new Error('Domain list must be an array or structured object with domains array');
        }
        
        return new Set(domainArray.filter(domain => typeof domain === 'string' && domain.length > 0));
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
            debugLog(`Fetch attempt ${attempt}/${maxRetries} failed:`, error.message);
            
            if (attempt < maxRetries) {
                const delay = retryDelay * Math.pow(2, attempt - 1); // Exponential backoff
                debugLog(`Retrying in ${delay}ms...`);
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
            debugLog(`Domain list loaded from storage (${DOMAIN_LIST.size} domains)`);
            
            // Check if we need to update based on interval
            const now = Date.now();
            const lastUpdate = stored.lastUpdate || 0;
            const timeSinceUpdate = now - lastUpdate;
            
            if (timeSinceUpdate < CONFIG.updateInterval) {
                debugLog(`Domain list is up to date (last updated ${Math.round(timeSinceUpdate / 1000 / 60)} minutes ago)`);
                return;
            }
        }

        // If we get here, we need to fetch a fresh list
        debugLog('Fetching remote domain list from:', CONFIG.domainListUrl);
        const response = await fetchWithRetry(CONFIG.domainListUrl, CONFIG.retryAttempts, CONFIG.retryDelay);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const domains = await response.json();
        
        // Handle both formats: simple array or structured object
        let domainArray = [];
        if (Array.isArray(domains)) {
            // Legacy format: simple array
            domainArray = domains;
        } else if (domains && Array.isArray(domains.domains)) {
            // New format: structured object with domains and exceptions
            domainArray = domains.domains;
            debugLog('Remote domain list has structured format with', domainArray.length, 'domains and', 
                       (domains.exceptions || []).length, 'exceptions');
        } else {
            throw new Error('Remote domain list is neither an array nor a valid structured object');
        }
        
        const validDomains = domainArray
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
        
        debugLog(`Domain list updated successfully (${DOMAIN_LIST.size} domains)`);
        return true;
    } catch (error) {
        console.error('Error updating domain list:', error);
        
        // If we don't have a domain list yet, try to load the local fallback
        if (DOMAIN_LIST.size === 0) {
            debugLog('Attempting to load local domain list as fallback...');
            try {
                const localDomains = await loadLocalDomainList();
                if (localDomains.size > 0) {
                    DOMAIN_LIST = localDomains;
                    debugLog(`Loaded ${localDomains.size} domains from local fallback`);
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
        debugLog(`Using existing domain list (${DOMAIN_LIST.size} domains)`);
        return false;
    }
}

async function updateDomainCategories() {
    try {
        // Try to load from storage first
        const stored = await chrome.storage.local.get(['domainCategories', 'categoriesLastUpdate']);
        if (stored.domainCategories && typeof stored.domainCategories === 'object') {
            debugLog('Domain categories loaded from storage');
            
            // Check if we need to update based on interval
            const now = Date.now();
            const lastUpdate = stored.categoriesLastUpdate || 0;
            const timeSinceUpdate = now - lastUpdate;
            
            if (timeSinceUpdate < CONFIG.updateInterval) {
                debugLog(`Domain categories are up to date (last updated ${Math.round(timeSinceUpdate / 1000 / 60)} minutes ago)`);
                return;
            }
        }

        // If we get here, we need to fetch fresh categories
        if (!CONFIG.domainCategoriesUrl) {
            debugLog('No domain categories URL configured, skipping remote update');
            return;
        }

        debugLog('Fetching remote domain categories from:', CONFIG.domainCategoriesUrl);
        const response = await fetchWithRetry(CONFIG.domainCategoriesUrl, CONFIG.retryAttempts, CONFIG.retryDelay);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const categories = await response.json();
        
        // Validate categories structure
        if (!categories || typeof categories !== 'object') {
            throw new Error('Remote domain categories is not a valid object');
        }

        if (!categories.categories || typeof categories.categories !== 'object') {
            throw new Error('Remote domain categories missing "categories" property');
        }
        
        // Store in local storage for offline access
        await chrome.storage.local.set({ 
            domainCategories: categories,
            categoriesLastUpdate: Date.now()
        });
        
        debugLog('Domain categories updated successfully');
        return true;
    } catch (error) {
        console.error('Error updating domain categories:', error);
        
        // If we don't have categories yet, try to load the local fallback
        const stored = await chrome.storage.local.get(['domainCategories']);
        if (!stored.domainCategories) {
            debugLog('Attempting to load local domain categories as fallback...');
            try {
                const localCategoriesUrl = chrome.runtime.getURL('domain-categories.json');
                const response = await fetch(localCategoriesUrl);
                const localCategories = await response.json();
                
                // Store the local version so it's cached
                await chrome.storage.local.set({ 
                    domainCategories: localCategories,
                    categoriesLastUpdate: Date.now()
                });
                
                debugLog('Loaded domain categories from local fallback');
                return true;
            } catch (localError) {
                console.error('Error loading local domain categories:', localError);
            }
        }
        
        debugLog('Using existing domain categories from storage');
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
            // Removed unused variable 'currentTab' to fix ESLint error
            
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
    debugLog('Received message in background:', request.action || 'unknown action', request);
    
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
        debugLog('Handling dismissDomain for domain:', request.domain);
        // Get the current active tab to update its icon
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs && tabs[0] && tabs[0].id) {
                debugLog('Updating icon for tab:', tabs[0].id);
                updateExtensionIcon(tabs[0].id, true)
                    .then(() => {
                        debugLog('Icon updated successfully after domain dismissal');
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
    
    // Handle clearDismissedDomain action
    if (request.action === 'clearDismissedDomain') {
        debugLog('Clearing dismissed status for domain:', request.domain);
        chrome.storage.local.get(['dismissedDomains'], (result) => {
            const dismissedDomains = result.dismissedDomains || {};
            if (dismissedDomains[request.domain]) {
                delete dismissedDomains[request.domain];
                chrome.storage.local.set({ dismissedDomains }, () => {
                    debugLog('Cleared dismissed status for domain:', request.domain);
                    // Update icon to normal state
                    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                        if (tabs && tabs[0] && tabs[0].id) {
                            updateExtensionIcon(tabs[0].id, false)
                                .then(() => {
                                    sendResponse({ success: true });
                                })
                                .catch(error => {
                                    console.error('Error updating icon after clearing dismiss:', error);
                                    sendResponse({ success: false, error: error.message });
                                });
                        } else {
                            sendResponse({ success: true });
                        }
                    });
                });
            } else {
                debugLog('Domain was not dismissed:', request.domain);
                sendResponse({ success: true });
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
    
    // Handle GET_CATEGORIES action
    if (request.type === 'GET_CATEGORIES') {
        chrome.storage.local.get(['domainCategories'], (result) => {
            if (result.domainCategories && result.domainCategories.categories) {
                sendResponse({ categories: result.domainCategories.categories });
            } else {
                // Fallback to local file
                const localUrl = chrome.runtime.getURL('domain-categories.json');
                fetch(localUrl)
                    .then(response => response.json())
                    .then(data => {
                        sendResponse({ categories: data.categories });
                    })
                    .catch(error => {
                        console.error('Error loading local categories:', error);
                        sendResponse({ error: 'Failed to load categories' });
                    });
            }
        });
        return true; // Required for async response
    }
    
    // Log unhandled messages for debugging
    console.warn('Unhandled message in background script:', request);
    return false;
});

// Test function to verify icon updates
async function testIconUpdate() {
    debugLog('Testing icon update functionality...');
    
    // Try to get the current tab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs[0] && tabs[0].id) {
        const tabId = tabs[0].id;
        debugLog(`Found active tab: ${tabId}`);
        
        // Test setting the dismissed icon
        try {
            debugLog('Setting dismissed icon...');
            await updateExtensionIcon(tabId, true);
            debugLog('Dismissed icon set successfully');
            
            // Set a timeout to reset the icon after 3 seconds
            setTimeout(async () => {
                debugLog('Resetting to normal icon...');
                await updateExtensionIcon(tabId, false);
                debugLog('Normal icon restored');
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
    debugLog(`[updateExtensionIcon] Updating icon for tab ${tabId}, isDismissed: ${isDismissed}`);
    
    // Define icon paths - using chrome.runtime.getURL() for proper resource loading
    const getIconPath = (size, dismissed = false) => 
        chrome.runtime.getURL(`images/icon${dismissed ? '-dismissed' : ''}-${size}.png`);
        
    const icons = {
        '16': getIconPath(16, isDismissed),
        '32': getIconPath(32, isDismissed),
        '48': chrome.runtime.getURL('images/icon-48.png'),
        '128': chrome.runtime.getURL('images/icon-128.png')
    };
    
    debugLog('Using icon paths:', icons);
    
    debugLog('[updateExtensionIcon] Using icon paths:', icons);
    
    // Set the title based on dismissed state
    const title = isDismissed 
        ? 'EZProxy: Banner is dismissed for this domain'
        : 'EZProxy: Click to access library resources';
    
    try {
        // First try to update the tab-specific icon
        if (tabId) {
            debugLog(`[updateExtensionIcon] Updating icon for specific tab ${tabId}`);
            try {
                await chrome.action.setIcon({
                    tabId: tabId,
                    path: icons
                });
                debugLog(`[updateExtensionIcon] Successfully updated tab ${tabId} icon`);
                
                // Also update the title
                await chrome.action.setTitle({
                    tabId: tabId,
                    title: title
                });
                debugLog(`[updateExtensionIcon] Set title for tab ${tabId}: ${title}`);
                
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
        debugLog('[updateExtensionIcon] Updating global icon');
        await chrome.action.setIcon({
            tabId: undefined, // Update global icon
            path: icons
        });
        
        // Update global title
        await chrome.action.setTitle({
            tabId: undefined,
            title: title
        });
        
        debugLog('[updateExtensionIcon] Successfully updated global icon and title');
        
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
        
        // Load domain categories
        await updateDomainCategories();
        
        // Schedule periodic updates
        setInterval(updateDomainList, CONFIG.updateInterval);
        setInterval(updateDomainCategories, CONFIG.updateInterval);
        console.log(`Scheduled domain list and categories updates every ${CONFIG.updateInterval / 1000 / 60} minutes`);
        
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
            
            // Check for exact match first
            let matchedDomain = null;
            if (DOMAIN_LIST.has(domainWithoutWww)) {
                matchedDomain = domainWithoutWww;
            } else {
                // If not an exact match, check if it's a subdomain of any domain in our list
                for (const listedDomain of DOMAIN_LIST) {
                    if (domainWithoutWww.endsWith('.' + listedDomain)) {
                        matchedDomain = listedDomain;
                        break;
                    }
                }
            }
            
            if (matchedDomain) {
                console.log('Domain matches tracking list:', matchedDomain, 'for URL:', tab.url);
                
                const ezproxyUrl = buildEzproxyUrl(tab.url, matchedDomain);
                if (!ezproxyUrl) {
                    console.error('Failed to build EZProxy URL for:', matchedDomain);
                    return;
                }
                
                // Try sending the message, and if it fails (content script not ready),
                // retry after a short delay
                const sendMessageWithRetry = (retryCount = 0) => {
                    chrome.tabs.sendMessage(tabId, {
                        type: 'DOMAIN_MATCH',
                        domain: matchedDomain,
                        originalUrl: tab.url,
                        ezproxyUrl: ezproxyUrl,
                        bannerMessage: CONFIG.bannerMessage
                    }).catch(error => {
                        // If content script isn't ready yet, retry a few times
                        if (error.message.includes('Receiving end does not exist') && retryCount < 3) {
                            console.log(`Content script not ready, retrying in ${500 * (retryCount + 1)}ms (attempt ${retryCount + 1}/3)`);
                            setTimeout(() => sendMessageWithRetry(retryCount + 1), 500 * (retryCount + 1));
                        } else if (!error.message.includes('Receiving end does not exist')) {
                            console.error('Error sending message to content script:', error);
                        }
                    });
                };
                
                sendMessageWithRetry();
            }
        } catch (error) {
            console.error('Error processing URL:', error);
        }
    });
});
