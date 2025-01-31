// content.js

function hasInstitutionalAccess() {
    const pageText = document.body.textContent || '';
    return pageText.includes('Access provided by') && 
           pageText.includes('Western Washington University');
}


function createBanner(message, ezproxyUrl) {
    // Remove existing banner if any
    const existingBanner = document.getElementById('ezproxy-banner');
    if (existingBanner) {
        existingBanner.remove();
    }

    // Create banner elements
    const banner = document.createElement('div');
    banner.id = 'ezproxy-banner';
    banner.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        background-color: #f8f9fa;
        border-bottom: 1px solid #dee2e6;
        padding: 10px 20px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        z-index: 10000;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    `;

    const messageDiv = document.createElement('div');
    messageDiv.textContent = message;
    messageDiv.style.cssText = `
        color: #495057;
        font-size: 14px;
    `;

    const buttonsDiv = document.createElement('div');
    buttonsDiv.style.cssText = `
        display: flex;
        gap: 10px;
    `;

    const redirectButton = document.createElement('button');
    redirectButton.textContent = 'Go to EZProxy Version';
    redirectButton.style.cssText = `
        background-color: #0d6efd;
        color: white;
        border: none;
        padding: 6px 12px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
    `;
    redirectButton.addEventListener('click', () => {
        window.location.href = ezproxyUrl;
    });

    const closeButton = document.createElement('button');
    closeButton.textContent = '✕';
    closeButton.style.cssText = `
        background: none;
        border: none;
        color: #6c757d;
        cursor: pointer;
        font-size: 16px;
        padding: 0 6px;
    `;
    closeButton.addEventListener('click', () => {
        banner.remove();
    });

    // Assemble banner
    buttonsDiv.appendChild(redirectButton);
    buttonsDiv.appendChild(closeButton);
    banner.appendChild(messageDiv);
    banner.appendChild(buttonsDiv);

    // Add banner to page
    document.body.insertBefore(banner, document.body.firstChild);

    // Adjust page body to prevent banner overlap
    document.body.style.marginTop = banner.offsetHeight + 'px';
}

chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'DOMAIN_MATCH' && !hasInstitutionalAccess()) {
        createBanner(
            `This resource is available through WWU Libraries. Click to access via EZProxy.`,
            message.ezproxyUrl
        );
    }
});