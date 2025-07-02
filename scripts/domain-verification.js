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
const ScreenshotAnnotator = require('../utils/screenshot-annotator.js');

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
    quality: 90,
    dynamicContentWait: 1500  // Wait 1.5 seconds for dynamic content to load (authentication banners, etc.)
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
    
    // Check for fresh session flag
    if (process.argv.includes('--fresh') || process.argv.includes('--new-session')) {
      console.log('🔄 Fresh session requested - clearing existing authentication');
      if (fs.existsSync(CONFIG.session.cookiesFile)) {
        fs.unlinkSync(CONFIG.session.cookiesFile);
        console.log('✅ Existing session cleared');
      }
    }
    
    // Check required dependencies early
    this.checkDependencies();
    
    this.domainCategories = this.loadDomainCategories();
    this.config = this.loadConfig();
    
    // Session management
    this.browser = null;
    this.page = null;
    this.isAuthenticated = false;
    this.sessionCookies = null;
    
    // Screenshot annotation
    this.annotator = new ScreenshotAnnotator();
    
    // Ensure screenshots directory exists
    if (!fs.existsSync(CONFIG.screenshotDir)) {
      fs.mkdirSync(CONFIG.screenshotDir, { recursive: true });
    }
  }

  checkDependencies() {
    const missingDeps = [];
    
    // Check for Puppeteer
    try {
      require('puppeteer');
    } catch (error) {
      missingDeps.push('puppeteer');
    }
    
    // Check for Sharp (only if URL overlay is enabled)
    if (CONFIG.screenshot.urlOverlay) {
      try {
        require('sharp');
      } catch (error) {
        missingDeps.push('sharp');
      }
    }
    
    if (missingDeps.length > 0) {
      console.log('\n❌ MISSING DEPENDENCIES');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('The domain verification script requires the following dependencies:');
      console.log('');
      
      missingDeps.forEach(dep => {
        if (dep === 'puppeteer') {
          console.log('📱 Puppeteer - Browser automation for screenshots and authentication');
        } else if (dep === 'sharp') {
          console.log('🎨 Sharp - Image processing for adding URL headers to screenshots');
        }
      });
      
      console.log('');
      console.log('🔧 To install missing dependencies, run:');
      console.log(`   npm install ${missingDeps.join(' ')} --save-dev`);
      console.log('');
      console.log('🚀 Then restart the script:');
      console.log('   npm run verify-domains');
      console.log('');
      console.log('💡 Alternative: Run the script without URL overlays by disabling them in CONFIG.screenshot.urlOverlay');
      console.log('');
      
      // Exit the process to force user to install dependencies
      process.exit(1);
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
        '--disable-web-security', // Allow access to chrome:// URLs if needed
        '--disable-infobars', // Remove info bars
        '--disable-default-apps',
        '--no-first-run',
        `--window-size=${CONFIG.screenshot.width},${CONFIG.screenshot.height + 150}` // Extra height for address bar
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
      console.log('🔍 Checking if this is a WWU authentication page...');
      
      // Wait for page to fully load
      await new Promise(resolve => setTimeout(resolve, CONFIG.session.loginDetectionTimeout));
      
      // Get current page URL and basic info - no need to check for general login elements
      const pageInfo = await this.page.evaluate(() => {
        return {
          currentUrl: window.location.href,
          pageTitle: document.title,
          hasWWUBranding: document.body.innerHTML.toLowerCase().includes('western washington university')
        };
      });

      // Use configuration values for domains and URLs
      const institutionDomain = this.config.institutionDomain || 'wwu.edu';
      const ezproxyBaseUrl = this.config.ezproxyBaseUrl || 'ezproxy.library.wwu.edu';
      const institutionLoginUrl = this.config.institutionLoginUrl || 'https://websso.wwu.edu/cas/login';
      
      // Only detect specific institutional authentication URLs - ignore all general site login pages
      const isLoginPage = pageInfo.currentUrl.startsWith(institutionLoginUrl) ||
                         pageInfo.currentUrl.includes(`login.${ezproxyBaseUrl}/login`) ||
                         // EZProxy configuration/menu pages indicate misconfiguration, not authentication
                         pageInfo.currentUrl.includes(`${ezproxyBaseUrl}/menu`) ||
                         // Check for institutional Shibboleth authentication URLs only
                         (pageInfo.currentUrl.includes('shibboleth') && pageInfo.currentUrl.includes(institutionDomain));

      if (isLoginPage) {
        const institutionShortName = this.config.institutionShortName || 'Institution';
        console.log(`\n🔑 ${institutionShortName.toUpperCase()} AUTHENTICATION PAGE DETECTED`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`Page Title: ${pageInfo.pageTitle}`);
        console.log(`URL: ${pageInfo.currentUrl}`);
        
        if (pageInfo.currentUrl.startsWith(institutionLoginUrl)) {
          console.log(`• ${institutionShortName} authentication login detected`);
        }
        if (pageInfo.currentUrl.includes(`login.${ezproxyBaseUrl}/login`)) {
          console.log('• EZProxy login page detected');  
        }
        if (pageInfo.currentUrl.includes(`${ezproxyBaseUrl}/menu`)) {
          console.log('• EZProxy configuration page detected (may indicate setup issue)');
        }
        if (pageInfo.currentUrl.includes('shibboleth') && pageInfo.currentUrl.includes(institutionDomain)) {
          console.log(`• ${institutionShortName} Shibboleth authentication detected`);
        }
      } else {
        const institutionShortName = this.config.institutionShortName || 'institutional';
        console.log(`✅ No ${institutionShortName} authentication required - proceeding with screenshot`);
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
        // Don't automatically set isAuthenticated = true
        // We'll verify authentication when we actually try to access content
        console.log('🔄 Loaded existing session cookies (verification pending)');
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

  async detectInstitutionalAccess() {
    try {
      console.log('🔍 Analyzing page for institutional access indicators...');
      
      // Get page content and analyze for institutional access
      const accessDetection = await this.page.evaluate((configData) => {
        const pageText = document.body ? document.body.textContent : '';
        
        // Use ONLY the configured access indicators - no hardcoded values
        const accessIndicators = [
          ...(configData.accessIndicators || []),
          ...(configData.fullAccessIndicators || [])
        ];
        
        // Get institution-specific values from config
        const institutionIndicators = [
          configData.institutionName,
          configData.institutionDomain, 
          configData.institutionShortName,
          configData.institutionLibraryName
        ].filter(indicator => indicator && indicator.trim().length > 0);
        
        const foundIndicators = [];
        const foundElements = [];
        
        // Only check for explicit access indicators from config
        accessIndicators.forEach(indicator => {
          if (indicator && pageText.toLowerCase().includes(indicator.toLowerCase())) {
            foundIndicators.push(indicator);
            
            // Find the element containing this access indicator
            const elements = document.querySelectorAll('*');
            for (const element of elements) {
              if (element.textContent && element.textContent.toLowerCase().includes(indicator.toLowerCase())) {
                const rect = element.getBoundingClientRect();
                const tagName = element.tagName.toLowerCase();
                
                // Be very selective about elements - avoid headers, logos, navigation
                if (rect.width > 0 && rect.height > 0 && 
                    rect.width < window.innerWidth && rect.height < 100 &&
                    !['html', 'body', 'main', 'nav', 'header', 'h1', 'h2', 'h3'].includes(tagName) &&
                    !element.closest('nav, header, .logo, .brand, .site-title')) {
                  foundElements.push({
                    text: indicator,
                    x: Math.round(rect.left),
                    y: Math.round(rect.top),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height),
                    tagName: tagName
                  });
                  break; // Take the first good match
                }
              }
            }
          }
        });
        
        // For institution names, be MUCH more conservative
        // Only look for them in specific contexts that indicate access
        institutionIndicators.forEach(indicator => {
          if (indicator) {
            // Look for institution name only when preceded by access-related phrases
            const accessContextPatterns = [
              `access provided by ${indicator}`,
              `licensed to ${indicator}`,
              `subscribed by ${indicator}`,
              `authenticated via ${indicator}`,
              `access through ${indicator}`,
              `you have access via ${indicator}`
            ];
            
            accessContextPatterns.forEach(pattern => {
              if (pageText.toLowerCase().includes(pattern.toLowerCase())) {
                foundIndicators.push(pattern);
                
                // Find element containing this contextual access indicator
                const elements = document.querySelectorAll('*');
                for (const element of elements) {
                  if (element.textContent && element.textContent.toLowerCase().includes(pattern.toLowerCase())) {
                    const rect = element.getBoundingClientRect();
                    const tagName = element.tagName.toLowerCase();
                    
                    if (rect.width > 0 && rect.height > 0 && 
                        rect.width < window.innerWidth && rect.height < 100 &&
                        !['html', 'body', 'main', 'nav', 'header'].includes(tagName)) {
                      foundElements.push({
                        text: pattern,
                        x: Math.round(rect.left),
                        y: Math.round(rect.top),
                        width: Math.round(rect.width),
                        height: Math.round(rect.height),
                        tagName: tagName
                      });
                      break;
                    }
                  }
                }
              }
            });
          }
        });
        
        return {
          found: foundIndicators.length > 0,
          indicators: foundIndicators,
          elements: foundElements,
          pageTitle: document.title,
          currentUrl: window.location.href
        };
      }, {
        accessIndicators: this.config.accessIndicators || [],
        fullAccessIndicators: this.config.fullAccessIndicators || [],
        institutionName: this.config.institutionName,
        institutionDomain: this.config.institutionDomain,
        institutionShortName: this.config.institutionShortName,
        institutionLibraryName: this.config.institutionLibraryName
      });
      
      if (accessDetection.found) {
        console.log(`✅ Institutional access detected!`);
        console.log(`   Indicators found: ${accessDetection.indicators.join(', ')}`);
        console.log(`   Elements located: ${accessDetection.elements.length}`);
        
        if (accessDetection.elements.length > 0) {
          const element = accessDetection.elements[0];
          console.log(`   Best element: "${element.text}" at (${element.x}, ${element.y})`);
        }
      } else {
        console.log(`ℹ️  No institutional access indicators detected`);
      }
      
      return accessDetection;
    } catch (error) {
      console.log(`⚠️  Error detecting institutional access: ${error.message}`);
      return { found: false, indicators: [], elements: [] };
    }
  }

  async addUrlHeader(inputPath, outputPath, url, timestamp, domain = null) {
    try {
      // Sharp is guaranteed to be available at this point due to early dependency check
      const sharp = require('sharp');

      const date = new Date(timestamp);
      const readableDate = date.toLocaleString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric',
        hour: 'numeric', 
        minute: '2-digit',
        hour12: true 
      });

      // Extract original URL from domain if provided
      const originalUrl = domain ? `https://${domain}` : null;

      // Read the original screenshot
      const originalImage = sharp(inputPath);
      const { width, height } = await originalImage.metadata();

      // Create single-line header with format: EZproxy: URL    Original: URL    Date
      const headerHeight = 40;
      
      // Format date as "02 July 2025, 10:43 AM"
      const formattedDate = date.toLocaleString('en-US', { 
        day: '2-digit',
        month: 'long', 
        year: 'numeric',
        hour: 'numeric', 
        minute: '2-digit',
        hour12: true 
      });
      
      const headerSvg = `
        <svg width="${width}" height="${headerHeight}" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="headerGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" style="stop-color:rgb(0,32,64);stop-opacity:0.95" />
              <stop offset="100%" style="stop-color:rgb(0,0,0);stop-opacity:0.95" />
            </linearGradient>
          </defs>
          <rect width="100%" height="100%" fill="url(#headerGrad)" />
          <rect x="0" y="${headerHeight-2}" width="100%" height="2" fill="#007acc" />
          
          <!-- Single line layout: EZproxy: URL    Original: URL    Date -->
          <text x="16" y="26" font-family="system-ui, -apple-system, sans-serif" font-size="16" fill="white">
            EZproxy: ${url}${originalUrl ? `        Original: ${originalUrl}` : ''}        ${formattedDate}
          </text>
        </svg>
      `;

      // Convert SVG to buffer
      const headerBuffer = Buffer.from(headerSvg);

      // Create header image
      const headerImage = sharp(headerBuffer);

      // Combine header with original screenshot
      const combinedImage = sharp({
        create: {
          width: width,
          height: height + headerHeight,
          channels: 3,
          background: { r: 255, g: 255, b: 255 }
        }
      })
      .composite([
        { input: await headerImage.png().toBuffer(), top: 0, left: 0 },
        { input: await originalImage.toBuffer(), top: headerHeight, left: 0 }
      ])
      .png();

      // Save the final image
      await combinedImage.toFile(outputPath);
      
      console.log(`🎨 Added URL header to screenshot`);
    } catch (error) {
      console.log(`⚠️  Failed to add URL header: ${error.message}`);
      // Fallback: just copy the original file
      fs.copyFileSync(inputPath, outputPath);
    }
  }


  async takeScreenshot(domain, type = 'ezproxy') {
    try {
      // Ensure browser is initialized
      await this.initializeBrowser();

      const transformedDomain = domain.replace(/\./g, '-');
      const url = `https://${transformedDomain}.${this.config.ezproxyBaseUrl}`;
      
      // Create date-based folder structure: screenshots/2025/July/03/
      const now = new Date();
      const year = now.getFullYear().toString();
      const month = now.toLocaleString('en-US', { month: 'long' }); // "July"
      const day = now.getDate().toString().padStart(2, '0'); // "03"
      
      const dateFolder = path.join(CONFIG.screenshotDir, year, month, day);
      
      // Ensure the date-based directory exists
      if (!fs.existsSync(dateFolder)) {
        fs.mkdirSync(dateFolder, { recursive: true });
        console.log(`📁 Created date folder: ${dateFolder}`);
      }
      
      const filename = `screenshot-${domain}-ezproxy-${Date.now()}.png`;
      const filepath = path.join(dateFolder, filename);
      
      console.log(`📸 Taking screenshot: ${url}`);
      
      // Navigate to the URL with generous timeout
      console.log(`🌐 Navigating to: ${url}`);
      const response = await this.page.goto(url, { 
        waitUntil: 'networkidle0', 
        timeout: CONFIG.session.navigationTimeout 
      });
      
      // Check if page is still valid
      if (!this.page || this.page.isClosed()) {
        throw new Error('Page is closed or invalid');
      }
      
      // Check for pages that don't need dynamic content waiting (already fully rendered)
      const currentUrl = await this.page.url();
      const statusCode = response ? response.status() : 200;
      const ezproxyBaseUrl = this.config.ezproxyBaseUrl || 'ezproxy.library.wwu.edu';
      
      const needsWaiting = !(
        statusCode === 404 || 
        currentUrl.includes(`${ezproxyBaseUrl}/menu`) ||
        currentUrl.includes('login.' + ezproxyBaseUrl + '/menu')
      );
      
      if (needsWaiting) {
        // Wait additional time for dynamic content to load (authentication banners, etc.)
        console.log(`⏳ Waiting ${CONFIG.screenshot.dynamicContentWait/1000}s for dynamic content to fully load...`);
        await new Promise(resolve => setTimeout(resolve, CONFIG.screenshot.dynamicContentWait));
      } else {
        if (statusCode === 404) {
          console.log('📄 404 error page detected - no need to wait for dynamic content');
        } else {
          console.log('📄 EZProxy menu page detected - no need to wait for dynamic content');
        }
      }
      
      
      // Quick check for EZProxy configuration issues (menu pages)
      // currentUrl and ezproxyBaseUrl already declared above
      
      if (currentUrl.includes(`${ezproxyBaseUrl}/menu`) || currentUrl.includes(`login.${ezproxyBaseUrl}/menu`)) {
        console.log('\n⚠️  EZPROXY CONFIGURATION ISSUE');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('This domain is not properly configured in EZProxy.');
        
        // Mark this as a configuration error
        const configError = {
          domain,
          type: 'ezproxy-config',
          url: currentUrl,
          error: 'Domain not configured in EZProxy - redirected to menu page',
          timestamp: new Date().toISOString()
        };
        this.results.errors.push(configError);
        
        console.log('📸 Taking screenshot to document the configuration issue...');
      } else if (!this.isAuthenticated) {
        // Only check for authentication if we don't already have a session
        console.log('🔍 Checking if authentication is needed...');
        
        try {
          const isLoginPage = await this.detectLoginPage();
          
          if (isLoginPage) {
            console.log('🔑 Login page detected - manual authentication required');
            console.log('💡 The browser window is open and ready for you to login');
            
            await this.promptForLogin();
            await this.saveCookies();
            this.isAuthenticated = true;
            
            // After login, reload the current page to get authenticated content
            console.log(`🔄 Reloading page with your authenticated session...`);
            await this.page.reload({ 
              waitUntil: 'networkidle0', 
              timeout: CONFIG.session.navigationTimeout 
            });
            
            console.log(`⏳ Waiting ${CONFIG.screenshot.dynamicContentWait/1000}s for authenticated content to fully load...`);
            await new Promise(resolve => setTimeout(resolve, CONFIG.screenshot.dynamicContentWait));
            
            console.log('✅ Page reloaded with authentication - ready for screenshot');
          } else {
            console.log('✅ No login required - proceeding with content');
            this.isAuthenticated = true;
          }
        } catch (error) {
          console.log(`⚠️  Authentication check failed: ${error.message}`);
        }
      } else {
        console.log('✅ Using existing authenticated session');
      }
      
      // Detect institutional access before taking screenshot
      const accessDetection = await this.detectInstitutionalAccess();
      
      // Take clean screenshot without overlay
      const tempFilepath = filepath.replace('.png', '-temp.png');
      await this.page.screenshot({ 
        path: tempFilepath,
        fullPage: false 
      });
      
      console.log(`📸 Clean screenshot captured`);
      
      // Process screenshot with URL overlay and annotations
      let processedFilepath = tempFilepath;
      
      // Step 1: Add URL overlay header (if enabled)
      if (CONFIG.screenshot.urlOverlay) {
        const urlHeaderFilepath = filepath.replace('.png', '-with-header.png');
        await this.addUrlHeader(tempFilepath, urlHeaderFilepath, url, new Date().toISOString(), domain);
        processedFilepath = urlHeaderFilepath;
        console.log(`🎨 URL header added with both EZProxy and original URLs`);
      }
      
      // Step 2: Add institutional access annotations (if detected)
      if (accessDetection.found && accessDetection.elements.length > 0) {
        console.log(`🎯 Adding institutional access annotations...`);
        
        const element = accessDetection.elements[0];
        const detectionData = {
          location: {
            x: element.x,
            y: element.y + (CONFIG.screenshot.urlOverlay ? 40 : 0), // Adjust for URL header
            width: element.width,
            height: element.height
          },
          text: element.text,
          confidence: 0.95,
          indicators: accessDetection.indicators
        };
        
        const annotatedFilepath = filepath.replace('.png', '-annotated.png');
        const success = await this.annotator.annotateScreenshot(
          processedFilepath, 
          annotatedFilepath, 
          detectionData
        );
        
        if (success) {
          processedFilepath = annotatedFilepath;
          console.log(`✅ Institutional access annotations added`);
        } else {
          console.log(`⚠️  Failed to add annotations, using screenshot without annotations`);
        }
      }
      
      // Step 3: Move final processed file to target location
      if (processedFilepath !== filepath) {
        fs.renameSync(processedFilepath, filepath);
      }
      
      // Clean up temporary files
      const tempFiles = [
        tempFilepath,
        filepath.replace('.png', '-with-header.png'),
        filepath.replace('.png', '-annotated.png')
      ];
      
      tempFiles.forEach(tempFile => {
        if (tempFile !== filepath && fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
      });
      
      if (accessDetection.found) {
        console.log(`✅ Screenshot saved with URL header and institutional access annotations`);
      } else {
        console.log(`✅ Screenshot saved with URL header`);
      }
      
      const screenshotData = {
        domain,
        type,
        url,
        filename,
        filepath,
        relativePath: path.relative(process.cwd(), filepath), // Show relative path from project root
        timestamp: new Date().toISOString(),
        authenticated: this.isAuthenticated,
        institutionalAccess: {
          detected: accessDetection.found,
          indicators: accessDetection.indicators,
          elementsFound: accessDetection.elements.length,
          annotated: accessDetection.found && accessDetection.elements.length > 0
        }
      };
      
      this.results.screenshots.push(screenshotData);
      console.log(`✅ Screenshot saved: ${path.relative(process.cwd(), filepath)}`);
      
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
    
    // Show today's screenshot folder
    const now = new Date();
    const year = now.getFullYear().toString();
    const month = now.toLocaleString('en-US', { month: 'long' });
    const day = now.getDate().toString().padStart(2, '0');
    const todaysFolder = path.join(CONFIG.screenshotDir, year, month, day);
    console.log(`Screenshots will be saved to: ${todaysFolder}`);
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
        
        // Brief pause between domains (reduced since we now wait longer per page)
        if (i < domains.length - 1) {
          console.log(`\n⏳ Moving to next domain in 1 second...`);
          console.log(`📊 Progress: ${processedDomains}/${totalDomains} complete`);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
  }

  generateReport() {
    // Calculate institutional access statistics
    const institutionalAccessStats = this.results.screenshots.reduce((stats, screenshot) => {
      if (screenshot.institutionalAccess) {
        if (screenshot.institutionalAccess.detected) {
          stats.detected++;
          if (screenshot.institutionalAccess.annotated) {
            stats.annotated++;
          }
        }
      }
      return stats;
    }, { detected: 0, annotated: 0 });

    this.results.summary = {
      totalDomains: this.results.screenshots.length + this.results.errors.length,
      screenshotsTaken: this.results.screenshots.length,
      screenshotErrors: this.results.errors.length,
      authenticated: this.isAuthenticated,
      sessionSaved: fs.existsSync(CONFIG.session.cookiesFile),
      institutionalAccess: {
        totalDetected: institutionalAccessStats.detected,
        totalAnnotated: institutionalAccessStats.annotated,
        detectionRate: this.results.screenshots.length > 0 ? 
          Math.round((institutionalAccessStats.detected / this.results.screenshots.length) * 100) : 0
      }
    };

    // Write report to file
    fs.writeFileSync(CONFIG.reportFile, JSON.stringify(this.results, null, 2));
    
    console.log('\n📊 SCREENSHOT SUMMARY');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Total domains processed: ${this.results.summary.totalDomains}`);
    console.log(`📸 Screenshots taken: ${this.results.summary.screenshotsTaken}`);
    console.log(`❌ Screenshot errors: ${this.results.summary.screenshotErrors}`);
    console.log(`🔐 Authentication status: ${this.isAuthenticated ? 'Authenticated' : 'Not required'}`);
    console.log(`🎯 Institutional access detected: ${this.results.summary.institutionalAccess.totalDetected} domains (${this.results.summary.institutionalAccess.detectionRate}%)`);
    console.log(`🏹 Screenshots annotated: ${this.results.summary.institutionalAccess.totalAnnotated}`);
    console.log(`📄 Report saved to: ${CONFIG.reportFile}`);
    
    if (this.isAuthenticated) {
      console.log(`💾 Session saved to: ${CONFIG.session.cookiesFile}`);
    }
    
    if (this.results.errors.length > 0) {
      // Separate configuration issues from other errors
      const configErrors = this.results.errors.filter(e => e.type === 'ezproxy-config');
      const otherErrors = this.results.errors.filter(e => e.type !== 'ezproxy-config');
      
      if (configErrors.length > 0) {
        console.log('\n⚠️  EZPROXY CONFIGURATION ISSUES:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        configErrors.forEach(entry => {
          console.log(`   • ${entry.domain}: Not configured in EZProxy`);
        });
      }
      
      if (otherErrors.length > 0) {
        console.log('\n❌ SCREENSHOT ERRORS:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        otherErrors.forEach(entry => {
          console.log(`   • ${entry.domain}: ${entry.error}`);
        });
      }
    }
    
    if (this.results.screenshots.length > 0) {
      console.log('\n✅ SCREENSHOTS SAVED:');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      this.results.screenshots.forEach(entry => {
        const authStatus = entry.authenticated ? '🔐' : '🌐';
        const accessStatus = entry.institutionalAccess?.annotated ? '🎯' : 
                           entry.institutionalAccess?.detected ? '✅' : '⚪';
        const displayPath = entry.relativePath || entry.filename;
        console.log(`   • ${authStatus}${accessStatus} ${entry.domain} → ${displayPath}`);
        if (entry.institutionalAccess?.detected && entry.institutionalAccess.indicators.length > 0) {
          console.log(`      └─ Access: ${entry.institutionalAccess.indicators.slice(0, 2).join(', ')}${entry.institutionalAccess.indicators.length > 2 ? '...' : ''}`);
        }
      });
      
      console.log('\n🔑 Legend:');
      console.log('   🔐 = Authenticated  🌐 = No auth needed');
      console.log('   🎯 = Annotated      ✅ = Access detected  ⚪ = No access detected');
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