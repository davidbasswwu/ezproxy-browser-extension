#!/usr/bin/env node

/**
 * Domain Verification Script
 * 
 * This script performs automated testing of domains in domain-categories.json:
 * 1. Tests if each domain is accessible (returns 200)
 * 2. Tests the EZProxy version of each domain
 * 3. Takes screenshots of both versions
 * 4. Flags domains that don't respond with 200 for follow-up
 * 5. Generates a comprehensive report
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// Configuration
const CONFIG = {
  timeout: 10000,
  userAgent: 'Mozilla/5.0 (compatible; EZProxy-Extension-Test/1.0)',
  maxConcurrent: 5,
  screenshotDir: path.join(process.cwd(), 'screenshots'),
  reportFile: path.join(process.cwd(), 'domain-verification-report.json'),
  screenshot: {
    width: 1280,
    height: 850,
    urlOverlay: true,
    includeTimestamp: true,
    quality: 90 // JPEG quality if needed
  }
};

class DomainVerifier {
  constructor() {
    this.results = {
      timestamp: new Date().toISOString(),
      summary: {},
      flaggedForFollowUp: [],
      successfulDomains: [],
      failedDomains: [],
      screenshots: []
    };
    
    this.domainCategories = this.loadDomainCategories();
    this.config = this.loadConfig();
    
    // Ensure screenshots directory exists
    if (!fs.existsSync(CONFIG.screenshotDir)) {
      fs.mkdirSync(CONFIG.screenshotDir, { recursive: true });
    }
  }

  loadDomainCategories() {
    const filePath = path.join(process.cwd(), 'domain-categories.json');
    if (!fs.existsSync(filePath)) {
      throw new Error('domain-categories.json not found');
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }

  loadConfig() {
    const filePath = path.join(process.cwd(), 'config.json');
    if (!fs.existsSync(filePath)) {
      throw new Error('config.json not found');
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }

  async makeRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const isHttps = urlObj.protocol === 'https:';
      const client = isHttps ? https : http;
      
      const requestOptions = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: 'HEAD',
        headers: {
          'User-Agent': CONFIG.userAgent,
          ...options.headers
        },
        timeout: CONFIG.timeout
      };

      const req = client.request(requestOptions, (res) => {
        resolve({
          success: true,
          status: res.statusCode,
          statusText: res.statusMessage,
          headers: res.headers,
          url: url
        });
      });

      req.on('error', (error) => {
        resolve({
          success: false,
          error: error.message,
          type: error.code,
          url: url
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({
          success: false,
          error: 'Request timeout',
          type: 'TIMEOUT',
          url: url
        });
      });

      req.end();
    });
  }

  async testDomain(domain, category, type = 'original') {
    const transformedDomain = domain.replace(/\./g, '-');
    const url = type === 'ezproxy' 
      ? `https://${transformedDomain}.${this.config.ezproxyBaseUrl}` 
      : `https://${domain}`;
    
    console.log(`Testing ${type} domain: ${url}`);
    
    const result = await this.makeRequest(url);
    
    const testResult = {
      domain,
      category,
      type,
      timestamp: new Date().toISOString(),
      ...result
    };

    if (!result.success || result.status !== 200) {
      // Flag for follow-up
      const reason = result.success 
        ? `${type} domain returned ${result.status} ${result.statusText}`
        : `${type} domain connection failed: ${result.error}`;
      
      const flaggedEntry = {
        ...testResult,
        reason,
        flagged: true
      };
      
      this.results.flaggedForFollowUp.push(flaggedEntry);
      this.results.failedDomains.push(flaggedEntry);
      
      console.log(`❌ FLAGGED: ${domain} (${type}) - ${reason}`);
    } else {
      this.results.successfulDomains.push(testResult);
      console.log(`✅ SUCCESS: ${domain} (${type}) - ${result.status}`);
    }

    return testResult;
  }

  async takeScreenshot(domain, type = 'original') {
    try {
      // Check if Puppeteer is available
      let puppeteer;
      try {
        puppeteer = require('puppeteer');
      } catch (error) {
        console.log(`⚠️  Puppeteer not installed, skipping screenshots. Install with: npm install puppeteer`);
        return null;
      }

      const transformedDomain = domain.replace(/\./g, '-');
      const url = type === 'ezproxy' 
        ? `https://${transformedDomain}.${this.config.ezproxyBaseUrl}` 
        : `https://${domain}`;
      
      const filename = `screenshot-${domain}${type === 'ezproxy' ? '-ezproxy' : ''}-${Date.now()}.png`;
      const filepath = path.join(CONFIG.screenshotDir, filename);
      
      console.log(`📸 Taking screenshot: ${url}`);
      
      const browser = await puppeteer.launch({ 
        headless: 'new', // Use new headless mode for better screenshot capabilities
        args: [
          '--no-sandbox', 
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          `--window-size=${CONFIG.screenshot.width},${CONFIG.screenshot.height + 50}` // Accommodate URL bar
        ] 
      });
      const page = await browser.newPage();
      
      await page.setViewport({ width: CONFIG.screenshot.width, height: CONFIG.screenshot.height });
      await page.setUserAgent(CONFIG.userAgent);
      
      // Set timeout for navigation
      await page.goto(url, { 
        waitUntil: 'networkidle0', 
        timeout: CONFIG.timeout 
      });
      
      // Add URL overlay to the top of the page (if enabled)
      if (CONFIG.screenshot.urlOverlay) {
        await page.evaluate((url, timestamp, includeTimestamp) => {
        // Create URL overlay div that looks like a browser address bar
        const overlay = document.createElement('div');
        overlay.innerHTML = `
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="background: #f0f0f0; color: #333; padding: 2px 6px; border-radius: 3px; font-size: 12px;">🔒</span>
            <strong style="color: #007acc;">URL:</strong>
            <span style="color: #ddd;">${url}</span>
            ${includeTimestamp ? `<span style="margin-left: auto; font-size: 12px; color: #999;">${timestamp}</span>` : ''}
          </div>
        `;
        overlay.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          background: linear-gradient(135deg, rgba(0, 0, 0, 0.9), rgba(0, 32, 64, 0.9));
          color: white;
          padding: 10px 16px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
          font-size: 13px;
          z-index: 2147483647;
          border-bottom: 1px solid #007acc;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
          word-break: break-all;
          backdrop-filter: blur(10px);
        `;
        
        // Ensure we can insert it even if body doesn't exist yet
        const target = document.body || document.documentElement;
        if (target.firstChild) {
          target.insertBefore(overlay, target.firstChild);
        } else {
          target.appendChild(overlay);
        }
        
        // Push content down to avoid overlap
        const bodyStyle = document.body ? document.body.style : null;
        if (bodyStyle) {
          bodyStyle.paddingTop = '50px';
        }
      }, url, new Date().toISOString(), CONFIG.screenshot.includeTimestamp);
      }
      
      // Take screenshot with URL overlay
      await page.screenshot({ 
        path: filepath,
        fullPage: false 
      });
      
      await browser.close();
      
      const screenshotData = {
        domain,
        type,
        url,
        filename,
        filepath,
        timestamp: new Date().toISOString()
      };
      
      this.results.screenshots.push(screenshotData);
      console.log(`✅ Screenshot saved: ${filename}`);
      
      return screenshotData;
    } catch (error) {
      console.log(`❌ Screenshot failed for ${domain} (${type}): ${error.message}`);
      return {
        domain,
        type,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  async verifyDomain(domain, category) {
    console.log(`\n🔍 Verifying EZProxy domain: ${domain} (${category})`);
    
    // Test EZProxy domain only
    const ezproxyResult = await this.testDomain(domain, category, 'ezproxy');
    
    // Take screenshot of EZProxy domain if accessible
    if (ezproxyResult.success && ezproxyResult.status === 200) {
      await this.takeScreenshot(domain, 'ezproxy');
    }
    
    return { ezproxyResult };
  }

  async runVerification() {
    console.log('🚀 Starting domain verification...\n');
    console.log(`EZProxy base URL: ${this.config.ezproxyBaseUrl}`);
    console.log(`Total categories: ${Object.keys(this.domainCategories.categories).length}`);
    
    // Count total domains
    let totalDomains = 0;
    Object.values(this.domainCategories.categories).forEach(category => {
      totalDomains += category.domains.length;
    });
    console.log(`Total domains: ${totalDomains}`);
    console.log(`Testing: EZProxy domains only`);
    console.log(`Screenshots will be saved to: ${CONFIG.screenshotDir}\n`);
    
    let processedDomains = 0;
    
    for (const [categoryName, categoryData] of Object.entries(this.domainCategories.categories)) {
      console.log(`\n📂 Processing category: ${categoryName} (${categoryData.domains.length} domains)`);
      
      // Process domains in batches to avoid overwhelming servers
      const domains = categoryData.domains;
      for (let i = 0; i < domains.length; i += CONFIG.maxConcurrent) {
        const batch = domains.slice(i, i + CONFIG.maxConcurrent);
        const promises = batch.map(domain => this.verifyDomain(domain, categoryName));
        
        try {
          await Promise.all(promises);
          processedDomains += batch.length;
          console.log(`Progress: ${processedDomains}/${totalDomains} domains processed`);
        } catch (error) {
          console.error(`Error processing batch: ${error.message}`);
        }
        
        // Brief pause between batches
        if (i + CONFIG.maxConcurrent < domains.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
  }

  generateReport() {
    this.results.summary = {
      totalTested: this.results.successfulDomains.length + this.results.failedDomains.length,
      successful: this.results.successfulDomains.length,
      failed: this.results.failedDomains.length,
      flaggedForFollowUp: this.results.flaggedForFollowUp.length,
      screenshotsTaken: this.results.screenshots.length
    };

    // Write report to file
    fs.writeFileSync(CONFIG.reportFile, JSON.stringify(this.results, null, 2));
    
    console.log('\n📊 VERIFICATION SUMMARY');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Total domains tested: ${this.results.summary.totalTested}`);
    console.log(`✅ Successful: ${this.results.summary.successful}`);
    console.log(`❌ Failed: ${this.results.summary.failed}`);
    console.log(`⚠️  Flagged for follow-up: ${this.results.summary.flaggedForFollowUp}`);
    console.log(`📸 Screenshots taken: ${this.results.summary.screenshotsTaken}`);
    console.log(`📄 Report saved to: ${CONFIG.reportFile}`);
    
    if (this.results.flaggedForFollowUp.length > 0) {
      console.log('\n⚠️  DOMAINS FLAGGED FOR FOLLOW-UP:');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      this.results.flaggedForFollowUp.forEach(entry => {
        console.log(`   • ${entry.domain} (${entry.category}, ${entry.type}): ${entry.reason}`);
      });
    }
  }

  async run() {
    try {
      await this.runVerification();
      this.generateReport();
    } catch (error) {
      console.error('❌ Verification failed:', error.message);
      process.exit(1);
    }
  }
}

// Run the verification if this script is executed directly
if (require.main === module) {
  const verifier = new DomainVerifier();
  verifier.run();
}

module.exports = DomainVerifier;