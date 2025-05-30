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
    } catch (error) {
        console.error('Fatal error initializing extension:', error);
        // No fallback - extension requires valid configuration
        throw error;
    }
}

// Message handler for content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_CONFIG') {
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
    return false;
});

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
