// sidebar.js - Domain Navigator Sidebar Functionality

class EZProxyDomainSidebar {
    constructor() {
        this.isOpen = false;
        this.categories = null;
        this.domains = null;
        this.filteredCategories = null;
        this.config = null;
        
        // Initialize the sidebar
        this.init();
    }

    async init() {
        debugLog('[Sidebar] Initializing domain sidebar');
        
        try {
            // Load configuration and data
            await this.loadConfig();
            await this.loadCategories();
            await this.loadDomains();
            
            // Create and inject sidebar
            this.createSidebar();
            this.bindEvents();
            
            debugLog('[Sidebar] Sidebar initialization completed');
        } catch (error) {
            console.error('[Sidebar] Failed to initialize sidebar:', error);
        }
    }

    async loadConfig() {
        try {
            const response = await chrome.runtime.sendMessage({ type: 'GET_CONFIG' });
            if (response && response.config) {
                this.config = response.config;
            }
        } catch (error) {
            console.warn('[Sidebar] Failed to load config:', error);
        }
    }

    async loadCategories() {
        try {
            const url = chrome.runtime.getURL('domain-categories.json');
            const response = await fetch(url);
            const data = await response.json();
            this.categories = data.categories;
            this.filteredCategories = { ...this.categories };
        } catch (error) {
            console.error('[Sidebar] Failed to load categories:', error);
            // Fallback to basic categorization
            this.categories = this.createBasicCategories();
            this.filteredCategories = { ...this.categories };
        }
    }

    async loadDomains() {
        try {
            const url = chrome.runtime.getURL('domain-list.json');
            const response = await fetch(url);
            const data = await response.json();
            this.domains = data.domains || data;
        } catch (error) {
            console.error('[Sidebar] Failed to load domains:', error);
            this.domains = [];
        }
    }

    createBasicCategories() {
        // Fallback categorization based on domain patterns
        const basicCategories = {
            'Academic Publishers': {
                description: 'University presses and academic publishers',
                domains: this.domains.filter(domain => 
                    domain.includes('cambridge') || domain.includes('oxford') || 
                    domain.includes('springer') || domain.includes('sage')
                )
            },
            'Science & Research': {
                description: 'Scientific journals and research databases',
                domains: this.domains.filter(domain => 
                    domain.includes('science') || domain.includes('nature') || 
                    domain.includes('ieee') || domain.includes('acm')
                )
            },
            'All Resources': {
                description: 'Complete list of available resources',
                domains: this.domains
            }
        };
        return basicCategories;
    }

    createSidebar() {
        // Check if sidebar already exists
        if (document.getElementById('ezproxy-domain-sidebar')) {
            return;
        }

        // Create toggle button
        const toggleButton = document.createElement('button');
        toggleButton.id = 'ezproxy-sidebar-toggle';
        toggleButton.title = 'Open EZProxy Domain Navigator';
        toggleButton.innerHTML = '📚';
        toggleButton.style.cssText = `
            position: fixed;
            top: 50%;
            right: 20px;
            transform: translateY(-50%);
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border: none;
            color: white;
            width: 50px;
            height: 50px;
            border-radius: 50%;
            cursor: pointer;
            font-size: 18px;
            z-index: 2147483646;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            transition: all 0.3s ease;
        `;

        // Create sidebar container
        const sidebar = document.createElement('div');
        sidebar.id = 'ezproxy-domain-sidebar';
        sidebar.style.cssText = `
            position: fixed;
            top: 0;
            right: -400px;
            width: 400px;
            height: 100vh;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            box-shadow: -2px 0 10px rgba(0, 0, 0, 0.3);
            z-index: 2147483647;
            transition: right 0.3s ease-in-out;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            color: white;
            overflow: hidden;
            display: flex;
            flex-direction: column;
        `;

        // Create sidebar content
        sidebar.innerHTML = `
            <div class="sidebar-header" style="padding: 20px; background: rgba(0, 0, 0, 0.2); border-bottom: 1px solid rgba(255, 255, 255, 0.2);">
                <button class="close-button" id="sidebar-close-btn" style="position: absolute; top: 15px; right: 15px; background: rgba(255, 255, 255, 0.2); border: none; color: white; width: 30px; height: 30px; border-radius: 50%; cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center;">×</button>
                <h2 style="font-size: 18px; font-weight: 600; margin: 0 0 10px 0;">EZProxy Navigator</h2>
                <p style="font-size: 14px; opacity: 0.8; margin: 0;">Browse available academic resources</p>
            </div>

            <div class="search-container" style="padding: 15px 20px; background: rgba(0, 0, 0, 0.1);">
                <input type="text" id="domain-search" placeholder="Search domains..." style="width: 100%; padding: 10px 12px; border: none; border-radius: 6px; background: rgba(255, 255, 255, 0.9); color: #333; font-size: 14px; box-sizing: border-box;">
            </div>

            <div class="categories-container" id="categories-container" style="flex: 1; overflow-y: auto; padding: 20px;">
                <!-- Categories will be populated here -->
            </div>
        `;

        // Add to page
        document.body.appendChild(toggleButton);
        document.body.appendChild(sidebar);

        // Populate categories
        this.populateCategories();
    }

    populateCategories() {
        const container = document.getElementById('categories-container');
        if (!container) return;

        container.innerHTML = '';

        Object.entries(this.filteredCategories).forEach(([categoryName, categoryData]) => {
            const categoryDiv = this.createCategoryElement(categoryName, categoryData);
            container.appendChild(categoryDiv);
        });
    }

    createCategoryElement(name, data) {
        const categoryDiv = document.createElement('div');
        categoryDiv.className = 'category';
        categoryDiv.style.cssText = `
            margin-bottom: 15px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 8px;
            overflow: hidden;
        `;

        const domainCount = data.domains ? data.domains.length : 0;
        
        categoryDiv.innerHTML = `
            <div class="category-header" style="padding: 12px 15px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; background: rgba(0, 0, 0, 0.1);">
                <div>
                    <div class="category-title" style="font-weight: 500; font-size: 14px;">${name}</div>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span class="category-count" style="background: rgba(255, 255, 255, 0.2); padding: 2px 8px; border-radius: 12px; font-size: 12px;">${domainCount}</span>
                    <span class="category-toggle" style="font-size: 12px;">▶</span>
                </div>
            </div>
            <div class="domain-list" style="max-height: 0; overflow: hidden; transition: max-height 0.3s ease;">
                ${this.createDomainList(data.domains || [])}
            </div>
        `;

        return categoryDiv;
    }

    createDomainList(domains) {
        return domains.map(domain => {
            const isCurrentDomain = window.location.hostname === domain;
            const statusText = isCurrentDomain ? 'Currently viewing' : 'Available via EZProxy';
            
            return `
                <div class="domain-item" data-domain="${domain}" style="padding: 8px 15px; border-bottom: 1px solid rgba(255, 255, 255, 0.1); cursor: pointer; font-size: 13px;">
                    <div class="domain-name" style="font-weight: 500;">${domain}</div>
                    <div class="domain-status" style="font-size: 11px; opacity: 0.7; margin-top: 2px;">${statusText}</div>
                </div>
            `;
        }).join('');
    }

    bindEvents() {
        // Toggle button
        const toggleButton = document.getElementById('ezproxy-sidebar-toggle');
        if (toggleButton) {
            toggleButton.addEventListener('click', () => this.toggleSidebar());
        }

        // Close button
        const closeButton = document.getElementById('sidebar-close-btn');
        if (closeButton) {
            closeButton.addEventListener('click', () => this.closeSidebar());
        }

        // Search functionality
        const searchInput = document.getElementById('domain-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => this.handleSearch(e.target.value));
        }

        // Category toggle
        document.addEventListener('click', (e) => {
            if (e.target.closest('.category-header')) {
                this.toggleCategory(e.target.closest('.category'));
            }
        });

        // Domain click
        document.addEventListener('click', (e) => {
            if (e.target.closest('.domain-item')) {
                const domain = e.target.closest('.domain-item').dataset.domain;
                this.handleDomainClick(domain);
            }
        });

        // Close on outside click
        document.addEventListener('click', (e) => {
            const sidebar = document.getElementById('ezproxy-domain-sidebar');
            const toggleButton = document.getElementById('ezproxy-sidebar-toggle');
            
            if (this.isOpen && sidebar && !sidebar.contains(e.target) && e.target !== toggleButton) {
                this.closeSidebar();
            }
        });

        // ESC key to close
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) {
                this.closeSidebar();
            }
        });
    }

    toggleSidebar() {
        if (this.isOpen) {
            this.closeSidebar();
        } else {
            this.openSidebar();
        }
    }

    openSidebar() {
        const sidebar = document.getElementById('ezproxy-domain-sidebar');
        if (sidebar) {
            sidebar.style.right = '0';
            this.isOpen = true;
            debugLog('[Sidebar] Sidebar opened');
        }
    }

    closeSidebar() {
        const sidebar = document.getElementById('ezproxy-domain-sidebar');
        if (sidebar) {
            sidebar.style.right = '-400px';
            this.isOpen = false;
            debugLog('[Sidebar] Sidebar closed');
        }
    }

    toggleCategory(categoryElement) {
        if (!categoryElement) return;

        const isExpanded = categoryElement.classList.contains('expanded');
        const domainList = categoryElement.querySelector('.domain-list');
        const toggle = categoryElement.querySelector('.category-toggle');

        if (isExpanded) {
            categoryElement.classList.remove('expanded');
            domainList.style.maxHeight = '0';
            toggle.textContent = '▶';
        } else {
            categoryElement.classList.add('expanded');
            domainList.style.maxHeight = '400px';
            toggle.textContent = '▼';
        }
    }

    handleSearch(query) {
        if (!query.trim()) {
            this.filteredCategories = { ...this.categories };
        } else {
            this.filteredCategories = {};
            const lowerQuery = query.toLowerCase();

            Object.entries(this.categories).forEach(([categoryName, categoryData]) => {
                const filteredDomains = categoryData.domains.filter(domain =>
                    domain.toLowerCase().includes(lowerQuery)
                );

                if (filteredDomains.length > 0) {
                    this.filteredCategories[categoryName] = {
                        ...categoryData,
                        domains: filteredDomains
                    };
                }
            });
        }

        this.populateCategories();
    }

    async handleDomainClick(domain) {
        if (!domain) return;

        debugLog('[Sidebar] Domain clicked:', domain);

        try {
            // Generate EZProxy URL
            const ezproxyUrl = this.generateEZProxyUrl(domain);
            
            // Open in new tab
            window.open(ezproxyUrl, '_blank');
            
            // Close sidebar
            this.closeSidebar();
            
        } catch (error) {
            console.error('[Sidebar] Error handling domain click:', error);
        }
    }

    generateEZProxyUrl(domain) {
        if (!this.config) {
            // Fallback URL generation
            return `https://ezproxy.library.wwu.edu/login?url=https://${domain}`;
        }

        const baseUrl = this.config.ezproxyBaseUrl;
        return `https://${baseUrl}/login?url=https://${domain}`;
    }
}

// Initialize sidebar when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        new EZProxyDomainSidebar();
    });
} else {
    new EZProxyDomainSidebar();
}