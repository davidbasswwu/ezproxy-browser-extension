// background.js

// Constants
const DEFAULT_RETRY_DELAY_MS = 2000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_UPDATE_INTERVAL = 86400000; // 24 hours
const MIN_UPDATE_INTERVAL = 60000; // 1 minute

let DOMAIN_LIST = new Set();
let CONFIG = {
    // Configuration will be loaded from config.json
    domainListUrl: null,
    updateInterval: DEFAULT_UPDATE_INTERVAL,
    ezproxyBaseUrl: 'ezproxy.library.wwu.edu',
    institutionName: 'Western Washington University',
    retryAttempts: DEFAULT_MAX_RETRIES,
    retryDelay: DEFAULT_RETRY_DELAY_MS,
    enableAutoRedirect: false,
    enableUserNotifications: true,
    bannerMessage: 'This resource is available through WWU Libraries. Access the full content via EZProxy.',
    version: '1.0'
};

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
        
        // Validate configuration
        if (!config.domainListUrl || typeof config.domainListUrl !== 'string') {
            throw new Error('Invalid or missing domainListUrl in configuration');
        }
        if (config.updateInterval && (typeof config.updateInterval !== 'number' || config.updateInterval < MIN_UPDATE_INTERVAL)) {
            throw new Error(`Invalid updateInterval: must be a number >= ${MIN_UPDATE_INTERVAL} (1 minute)`);
        }
        
        CONFIG = { ...CONFIG, ...config };
        console.log('Configuration loaded successfully:', CONFIG);
        return true;
    } catch (error) {
        console.error('Error loading configuration:', error);
        // Use default config for basic functionality
        console.log('Using default configuration');
        return false;
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
        }

        // Check if we need to update based on interval
        const now = Date.now();
        const lastUpdate = stored.lastUpdate || 0;
        const timeSinceUpdate = now - lastUpdate;
        
        if (timeSinceUpdate < CONFIG.updateInterval && DOMAIN_LIST.size > 0) {
            console.log(`Domain list is up to date (last updated ${Math.round(timeSinceUpdate / 1000 / 60)} minutes ago)`);
            return;
        }

        if (!CONFIG.domainListUrl) {
            console.log('No remote domain list URL configured, using local list only');
            if (DOMAIN_LIST.size === 0) {
                DOMAIN_LIST = await loadLocalDomainList();
            }
            return;
        }

        // Fetch fresh list from remote with retry logic
        console.log('Fetching remote domain list...');
        const response = await fetchWithRetry(CONFIG.domainListUrl);
        const domains = await response.json();
        
        // Validate remote domain list
        if (!Array.isArray(domains)) {
            throw new Error('Remote domain list is not an array');
        }
        
        const validDomains = domains.filter(domain => typeof domain === 'string' && domain.length > 0);
        DOMAIN_LIST = new Set(validDomains);
        
        // Store in local storage for offline access
        await chrome.storage.local.set({ 
            domainList: Array.from(DOMAIN_LIST),
            lastUpdate: now
        });
        
        // Clear URL transform cache when domain list updates
        urlTransformCache.clear();
        
        console.log(`Domain list updated successfully (${DOMAIN_LIST.size} domains)`);
    } catch (error) {
        console.error('Error updating remote domain list:', error);
        
        // Show user notification for critical errors
        if (DOMAIN_LIST.size === 0) {
            console.log('No domain list available, falling back to local list');
            DOMAIN_LIST = await loadLocalDomainList();
            
            if (DOMAIN_LIST.size === 0) {
                console.error('CRITICAL: No domain list available (local or remote)');
                // Could show a notification to user here if needed
            } else {
                console.log(`Using local domain list (${DOMAIN_LIST.size} domains)`);
            }
        } else {
            console.log(`Keeping existing domain list (${DOMAIN_LIST.size} domains)`);
        }
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
        
        // Load configuration (continue even if it fails)
        await loadConfig();
        
        // Load domain list
        await updateDomainList();
        
        // Schedule periodic updates only if we have a valid config
        if (CONFIG.domainListUrl && CONFIG.updateInterval) {
            setInterval(updateDomainList, CONFIG.updateInterval);
            console.log(`Scheduled domain list updates every ${CONFIG.updateInterval / 1000 / 60} minutes`);
        }
        
        console.log('EZProxy extension initialized successfully');
    } catch (error) {
        console.error('Error initializing extension:', error);
        // Try to load local domain list as fallback
        if (DOMAIN_LIST.size === 0) {
            DOMAIN_LIST = await loadLocalDomainList();
        }
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
