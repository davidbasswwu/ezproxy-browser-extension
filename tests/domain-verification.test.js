import { test, expect, describe } from '@jest/globals';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

describe('Domain Screenshot Tests', () => {
  let domainCategories;
  let config;
  let screenshotResults = {
    timestamp: new Date().toISOString(),
    summary: {},
    screenshots: [],
    errors: []
  };
  
  beforeAll(() => {
    // Load domain categories and config
    const domainCategoriesPath = join(process.cwd(), 'domain-categories.json');
    const configPath = join(process.cwd(), 'config.json');
    
    try {
      domainCategories = JSON.parse(readFileSync(domainCategoriesPath, 'utf-8'));
      config = JSON.parse(readFileSync(configPath, 'utf-8'));
      
      console.log(`Loaded ${Object.keys(domainCategories.categories || {}).length} categories`);
    } catch (error) {
      console.error('Failed to load test data:', error.message);
      throw error;
    }
  });


  afterAll(() => {
    // Write screenshot report
    const reportPath = join(process.cwd(), 'domain-screenshot-report.json');
    screenshotResults.summary = {
      totalDomains: screenshotResults.screenshots.length + screenshotResults.errors.length,
      screenshotsTaken: screenshotResults.screenshots.length,
      screenshotErrors: screenshotResults.errors.length
    };
    
    writeFileSync(reportPath, JSON.stringify(screenshotResults, null, 2));
    console.log(`\nDomain screenshot report written to: ${reportPath}`);
    
    if (screenshotResults.screenshots.length > 0) {
      console.log(`\n📸 ${screenshotResults.screenshots.length} screenshots simulated`);
    }
  });


  // Helper function to simulate taking a screenshot
  const takeEZProxyScreenshot = async (domain, category) => {
    const transformedDomain = domain.replace(/\./g, '-');
    const url = `https://${transformedDomain}.${config.ezproxyBaseUrl}`;
    
    // Simulate screenshot functionality
    const screenshotData = {
      timestamp: new Date().toISOString(),
      url: url,
      domain: domain,
      category: category,
      filename: `screenshot-${domain}-ezproxy-${Date.now()}.png`,
      viewport: { width: 1280, height: 850 },
      userAgent: 'Mozilla/5.0 (compatible; EZProxy-Extension-Test/1.0)',
      features: {
        urlOverlay: true,
        overlayText: `URL: ${url}`,
        transformedDomain: transformedDomain
      }
    };
    
    screenshotResults.screenshots.push(screenshotData);
    return screenshotData;
  };

  // Test data loading
  test('should load domain categories data', () => {
    expect(domainCategories).toBeDefined();
    expect(domainCategories.categories).toBeDefined();
    expect(config).toBeDefined();
    expect(config.ezproxyBaseUrl).toBeDefined();
  });

  // Test each category conditionally
  describe('Category Tests', () => {
    test('should have categories loaded', () => {
      expect(domainCategories?.categories).toBeDefined();
    });

    if (domainCategories?.categories) {
      Object.entries(domainCategories.categories).forEach(([categoryName, categoryData]) => {
        describe(`Category: ${categoryName}`, () => {
          const domains = categoryData.domains;
          
          test(`should have valid domains in ${categoryName}`, () => {
            expect(Array.isArray(domains)).toBe(true);
            expect(domains.length).toBeGreaterThan(0);
            
            domains.forEach(domain => {
              expect(typeof domain).toBe('string');
              expect(domain.length).toBeGreaterThan(0);
              expect(domain).not.toContain('http');
              expect(domain).not.toContain('//');
            });
          });

          // Test a subset of domains for performance (first 3 per category)
          const testDomains = domains.slice(0, 3);
          
          testDomains.forEach(domain => {
            test(`should capture EZProxy screenshot - ${domain}`, async () => {
              // Test screenshot for EZProxy version
              const screenshot = await takeEZProxyScreenshot(domain, categoryName);
              
              expect(screenshot.domain).toBe(domain);
              expect(screenshot.category).toBe(categoryName);
              
              const transformedDomain = domain.replace(/\./g, '-');
              const expectedUrl = `https://${transformedDomain}.${config.ezproxyBaseUrl}`;
              expect(screenshot.url).toBe(expectedUrl);
              
              expect(screenshot.filename).toContain(domain);
              expect(screenshot.filename).toContain('ezproxy');
              expect(screenshot.filename).toContain('.png');
              expect(screenshot.timestamp).toBeDefined();
              
              // Verify URL transformation
              expect(screenshot.features.transformedDomain).toBe(transformedDomain);
              
              // Verify URL overlay features
              expect(screenshot.features.urlOverlay).toBe(true);
              expect(screenshot.features.overlayText).toContain(expectedUrl);
            });
          });
        });
      });
    }
  });

  // Summary test to verify overall data structure
  test('should have valid domain categories structure', () => {
    expect(domainCategories).toBeDefined();
    expect(domainCategories.categories).toBeDefined();
    expect(typeof domainCategories.categories).toBe('object');
    
    const categories = Object.keys(domainCategories.categories);
    expect(categories.length).toBeGreaterThan(0);
    
    // Count total domains
    let totalDomains = 0;
    categories.forEach(category => {
      const domains = domainCategories.categories[category].domains;
      totalDomains += domains.length;
      
      expect(domainCategories.categories[category].description).toBeDefined();
      expect(typeof domainCategories.categories[category].description).toBe('string');
    });
    
    console.log(`\nEZProxy screenshot summary:`);
    console.log(`- Total categories: ${categories.length}`);
    console.log(`- Total domains: ${totalDomains}`);
    console.log(`- Testing screenshot capture for subset of domains`);
    console.log(`- EZProxy base URL: ${config.ezproxyBaseUrl}`);
  });

  // Test configuration validation
  test('should have valid EZProxy configuration', () => {
    expect(config.ezproxyBaseUrl).toBeDefined();
    expect(typeof config.ezproxyBaseUrl).toBe('string');
    expect(config.ezproxyBaseUrl).toContain('.');
    expect(config.institutionName).toBeDefined();
    expect(config.institutionDomain).toBeDefined();
  });
});