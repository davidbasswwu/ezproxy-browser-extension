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
  timeout: 30000, // 30 seconds for general timeouts
  userAgent: 'Mozilla/5.0 (compatible; EZProxy-Extension-Test/1.0)',
  maxConcurrent: 1, // Set to 1 to reuse browser session
  screenshotDir: path.join(process.cwd(), 'screenshots'),
  reportFile: path.join(process.cwd(), 'domain-verification-report.json'),
  screenshot: {
    width: 1280,
    height: 850,
    urlOverlay: true,
    includeTimestamp: true,
    quality: 90
  },
  session: {
    cookiesFile: path.join(process.cwd(), 'ezproxy-session.json'),
    loginDetectionTimeout: 15000, // Wait 15 seconds for page to load before checking for login
    navigationTimeout: 120000 // 2 minutes for page navigation (generous for slow connections)
  }
};

class DomainVerifier {
  constructor() {
    this.results = {
      timestamp: new Date().toISOString(),
      summary: {},
      screenshots: [],
      errors: []
    };
    
    this.domainCategories = this.loadDomainCategories();
    this.config = this.loadConfig();
    
    // Session management
    this.browser = null;
    this.page = null;
    this.isAuthenticated = false;
    this.sessionCookies = null;
    
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

  async initializeBrowser() {
    if (this.browser) return; // Already initialized

    console.log('🚀 Initializing browser for EZProxy session...');
    
    // Check if Puppeteer is available
    let puppeteer;
    try {
      puppeteer = require('puppeteer');
    } catch (error) {
      throw new Error('Puppeteer not installed. Install with: npm install puppeteer');
    }

    this.browser = await puppeteer.launch({ 
      headless: false, // Visible browser for manual login
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        `--window-size=${CONFIG.screenshot.width},${CONFIG.screenshot.height + 100}`
      ] 
    });

    this.page = await this.browser.newPage();
    await this.page.setViewport({ width: CONFIG.screenshot.width, height: CONFIG.screenshot.height });
    await this.page.setUserAgent(CONFIG.userAgent);

    // Load existing cookies if available
    await this.loadCookies();
    
    console.log('✅ Browser initialized');
  }

  async detectLoginPage() {
    try {
      console.log('🔍 Checking if this is a login page...');
      
      // Wait longer for page to fully load
      await this.page.waitForTimeout(CONFIG.session.loginDetectionTimeout);
      
      // Check for common login indicators
      const loginIndicators = await this.page.evaluate(() => {
        const indicators = {
          hasLoginForm: !!document.querySelector('form[name*="login"], form[id*="login"], form[action*="login"]'),
          hasPasswordField: !!document.querySelector('input[type="password"]'),
          hasUsernameField: !!document.querySelector('input[type="text"][name*="user"], input[type="email"], input[name*="username"]'),
          hasWWULogin: document.body.innerHTML.toLowerCase().includes('western washington university'),
          hasUniversalLogin: document.body.innerHTML.toLowerCase().includes('universal login'),
          hasShibboleth: document.body.innerHTML.toLowerCase().includes('shibboleth'),
          hasSignIn: document.body.innerHTML.toLowerCase().includes('sign in'),
          hasAuthentication: document.body.innerHTML.toLowerCase().includes('authentication'),
          currentUrl: window.location.href,
          pageTitle: document.title
        };
        
        return indicators;
      });

      const isLoginPage = loginIndicators.hasLoginForm || 
                         (loginIndicators.hasPasswordField && loginIndicators.hasUsernameField) ||
                         loginIndicators.hasWWULogin ||
                         loginIndicators.hasUniversalLogin ||
                         loginIndicators.hasShibboleth ||
                         (loginIndicators.hasSignIn && loginIndicators.hasAuthentication);

      if (isLoginPage) {
        console.log('\n🔑 LOGIN PAGE DETECTED');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`Page Title: ${loginIndicators.pageTitle}`);
        console.log(`URL: ${loginIndicators.currentUrl}`);
        if (loginIndicators.hasWWULogin) console.log('• Western Washington University login detected');
        if (loginIndicators.hasUniversalLogin) console.log('• Universal login system detected');
        if (loginIndicators.hasShibboleth) console.log('• Shibboleth authentication detected');
        if (loginIndicators.hasLoginForm) console.log('• Login form detected');
        if (loginIndicators.hasPasswordField) console.log('• Password field detected');
      } else {
        console.log('✅ No login required - proceeding with screenshot');
      }

      return isLoginPage;
    } catch (error) {
      console.log(`⚠️  Login detection failed: ${error.message}`);
      return false;
    }
  }

  async promptForLogin() {
    console.log('\n🚨 AUTHENTICATION PAUSED - WAITING FOR YOU 🚨');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('The script has STOPPED and is waiting for you to login.');
    console.log('There are NO TIME LIMITS - take as long as you need!');
    console.log('');
    console.log('📋 Complete these steps at your own pace:');
    console.log('');
    console.log('1. 🔍 Find the browser window (check your taskbar/dock)');
    console.log('2. 🔑 Login to Western Washington University');
    console.log('3. ✅ Complete 2FA or any additional authentication');
    console.log('4. ⏳ Wait for all redirects and loading to finish');
    console.log('5. 🎯 Make sure you see actual content (not login forms)');
    console.log('6. ⌨️  Return here and press ENTER when 100% complete');
    console.log('');
    console.log('⏰ NO RUSH! NO TIMEOUTS! NO PRESSURE!');
    console.log('🕐 Take 5 minutes, 10 minutes, 30 minutes - whatever you need');
    console.log('⚡ The script is PAUSED and waiting patiently for you');
    console.log('💡 This is a one-time setup - future runs will be automatic');
    console.log('');
    console.log('🆘 Troubleshooting:');
    console.log('   • Can\'t find browser? Look in taskbar/dock for Chrome/Chromium');
    console.log('   • Login fails? Close browser and restart this script');  
    console.log('   • Start over? Delete ezproxy-session.json and restart');
    console.log('   • Need to cancel? Press Ctrl+C anytime');
    console.log('');
    console.log('🛑 CRITICAL: Only press ENTER when you see actual academic content!');
    console.log('   ❌ NOT login forms, loading pages, or "redirecting" messages');
    console.log('   ✅ YES journal articles, databases, or library content');
    console.log('');

    // Wait for user input with infinite patience
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve) => {
      const askAgain = () => {
        rl.question('✋ Press ENTER only when login is COMPLETELY finished and you see content: ', (answer) => {
          if (answer.toLowerCase().includes('help') || answer.toLowerCase().includes('?')) {
            console.log('');
            console.log('💬 You should see actual academic content in the browser, not:');
            console.log('   ❌ Login forms or password fields');
            console.log('   ❌ Loading or "please wait" pages');
            console.log('   ❌ Redirect or "you will be redirected" pages');
            console.log('   ✅ Journal articles, database content, or library resources');
            console.log('');
            askAgain();
          } else {
            rl.close();
            console.log('');
            console.log('🎉 Excellent! Login completed successfully!');
            console.log('💾 Saving your authenticated session...');
            console.log('🚀 Proceeding to capture screenshots...');
            console.log('');
            this.isAuthenticated = true;
            resolve();
          }
        });
      };
      
      askAgain();
    });
  }

  async saveCookies() {
    try {
      if (!this.page) return;
      
      const cookies = await this.page.cookies();
      this.sessionCookies = cookies;
      
      fs.writeFileSync(CONFIG.session.cookiesFile, JSON.stringify(cookies, null, 2));
      console.log(`💾 Session saved to ${CONFIG.session.cookiesFile}`);
    } catch (error) {
      console.log(`⚠️  Failed to save session: ${error.message}`);
    }
  }

  async loadCookies() {
    try {
      if (fs.existsSync(CONFIG.session.cookiesFile)) {
        const cookies = JSON.parse(fs.readFileSync(CONFIG.session.cookiesFile, 'utf-8'));
        await this.page.setCookie(...cookies);
        this.sessionCookies = cookies;
        this.isAuthenticated = true;
        console.log('🔄 Loaded existing session');
        return true;
      }
    } catch (error) {
      console.log(`⚠️  Failed to load session: ${error.message}`);
    }
    return false;
  }

  async closeBrowser() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }


  async takeScreenshot(domain, type = 'ezproxy') {
    try {
      // Ensure browser is initialized
      await this.initializeBrowser();

      const transformedDomain = domain.replace(/\./g, '-');
      const url = `https://${transformedDomain}.${this.config.ezproxyBaseUrl}`;
      
      const filename = `screenshot-${domain}-ezproxy-${Date.now()}.png`;
      const filepath = path.join(CONFIG.screenshotDir, filename);
      
      console.log(`📸 Taking screenshot: ${url}`);
      
      // Navigate to the URL with generous timeout
      console.log(`🌐 Navigating to: ${url}`);
      await this.page.goto(url, { 
        waitUntil: 'networkidle0', 
        timeout: CONFIG.session.navigationTimeout 
      });
      
      // Handle authentication on first domain only
      if (!this.isAuthenticated) {
        console.log('🔍 Checking if authentication is needed...');
        
        // Always prompt for login on first run, regardless of page content
        console.log('🔑 First run detected - manual authentication required');
        console.log('💡 The browser window is open and ready for you to login');
        
        await this.promptForLogin();
        await this.saveCookies();
        
        // After login, reload the current page to get authenticated content
        console.log(`🔄 Reloading page with your authenticated session...`);
        await this.page.reload({ 
          waitUntil: 'networkidle0', 
          timeout: CONFIG.session.navigationTimeout 
        });
        
        console.log('✅ Page reloaded with authentication - ready for screenshot');
      } else {
        console.log('🔐 Using saved authentication session');
      }
      
      // Add URL overlay to the top of the page (if enabled)
      if (CONFIG.screenshot.urlOverlay) {
        await this.page.evaluate((url, timestamp, includeTimestamp) => {
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
      await this.page.screenshot({ 
        path: filepath,
        fullPage: false 
      });
      
      const screenshotData = {
        domain,
        type,
        url,
        filename,
        filepath,
        timestamp: new Date().toISOString(),
        authenticated: this.isAuthenticated
      };
      
      this.results.screenshots.push(screenshotData);
      console.log(`✅ Screenshot saved: ${filename}`);
      
      return screenshotData;
    } catch (error) {
      console.log(`❌ Screenshot failed for ${domain}: ${error.message}`);
      const errorData = {
        domain,
        type: 'ezproxy',
        url: `https://${domain.replace(/\./g, '-')}.${this.config.ezproxyBaseUrl}`,
        error: error.message,
        timestamp: new Date().toISOString()
      };
      
      this.results.errors.push(errorData);
      return errorData;
    }
  }

  async verifyDomain(domain, category) {
    console.log(`\n📸 Processing domain: ${domain} (${category})`);
    
    if (this.isAuthenticated) {
      console.log(`🔐 Using authenticated session for ${domain}`);
    } else {
      console.log(`🌐 Processing ${domain} (authentication will be required)`);
    }
    
    // Take screenshot of EZProxy domain
    await this.takeScreenshot(domain, 'ezproxy');
    
    return { domain, category, screenshotTaken: true };
  }

  async runVerification() {
    console.log('🚀 Starting EZProxy domain screenshot capture...\n');
    console.log(`EZProxy base URL: ${this.config.ezproxyBaseUrl}`);
    console.log(`Total categories: ${Object.keys(this.domainCategories.categories).length}`);
    
    // Count total domains
    let totalDomains = 0;
    Object.values(this.domainCategories.categories).forEach(category => {
      totalDomains += category.domains.length;
    });
    console.log(`Total domains: ${totalDomains}`);
    console.log(`Action: Taking screenshots of EZProxy domains`);
    console.log(`Screenshots will be saved to: ${CONFIG.screenshotDir}`);
    console.log('');
    console.log('📝 Note: This script will take its time to ensure quality results');
    console.log('⏰ If authentication is required, you will be prompted to login manually');
    console.log('🔄 Authenticated sessions are saved for future runs');
    console.log('');
    
    let processedDomains = 0;
    
    for (const [categoryName, categoryData] of Object.entries(this.domainCategories.categories)) {
      console.log(`\n📂 Processing category: ${categoryName} (${categoryData.domains.length} domains)`);
      
      // Process domains sequentially to maintain session
      const domains = categoryData.domains;
      for (let i = 0; i < domains.length; i++) {
        const domain = domains[i];
        
        try {
          await this.verifyDomain(domain, categoryName);
          processedDomains++;
          console.log(`Progress: ${processedDomains}/${totalDomains} domains processed`);
        } catch (error) {
          console.error(`Error processing ${domain}: ${error.message}`);
          processedDomains++;
        }
        
        // Generous pause between domains to avoid overwhelming servers  
        if (i < domains.length - 1) {
          console.log(`\n⏳ Moving to next domain in 2 seconds...`);
          console.log(`📊 Progress: ${processedDomains}/${totalDomains} complete`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }
  }

  generateReport() {
    this.results.summary = {
      totalDomains: this.results.screenshots.length + this.results.errors.length,
      screenshotsTaken: this.results.screenshots.length,
      screenshotErrors: this.results.errors.length,
      authenticated: this.isAuthenticated,
      sessionSaved: fs.existsSync(CONFIG.session.cookiesFile)
    };

    // Write report to file
    fs.writeFileSync(CONFIG.reportFile, JSON.stringify(this.results, null, 2));
    
    console.log('\n📊 SCREENSHOT SUMMARY');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Total domains processed: ${this.results.summary.totalDomains}`);
    console.log(`📸 Screenshots taken: ${this.results.summary.screenshotsTaken}`);
    console.log(`❌ Screenshot errors: ${this.results.summary.screenshotErrors}`);
    console.log(`🔐 Authentication status: ${this.isAuthenticated ? 'Authenticated' : 'Not required'}`);
    console.log(`📄 Report saved to: ${CONFIG.reportFile}`);
    
    if (this.isAuthenticated) {
      console.log(`💾 Session saved to: ${CONFIG.session.cookiesFile}`);
    }
    
    if (this.results.errors.length > 0) {
      console.log('\n❌ SCREENSHOT ERRORS:');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      this.results.errors.forEach(entry => {
        console.log(`   • ${entry.domain}: ${entry.error}`);
      });
    }
    
    if (this.results.screenshots.length > 0) {
      console.log('\n✅ SCREENSHOTS SAVED:');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      this.results.screenshots.forEach(entry => {
        const authStatus = entry.authenticated ? '🔐' : '🌐';
        console.log(`   • ${authStatus} ${entry.domain} → ${entry.filename}`);
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
    } finally {
      // Cleanup
      console.log('\n🧹 Cleaning up...');
      await this.closeBrowser();
      console.log('✅ Browser closed');
    }
  }
}

// Run the verification if this script is executed directly
if (require.main === module) {
  const verifier = new DomainVerifier();
  verifier.run();
}

module.exports = DomainVerifier;