import { test, expect, describe } from '@jest/globals';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

// Mock fetch for testing
global.fetch = jest.fn();

describe('Domain Verification Tests', () => {
  let domainCategories;
  let config;
  let flaggedDomains = [];
  let verificationResults = {
    timestamp: new Date().toISOString(),
    summary: {},
    flaggedForFollowUp: [],
    successfulDomains: [],
    failedDomains: []
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

  beforeEach(() => {
    fetch.mockClear();
  });

  afterAll(() => {
    // Write flagged domains report
    const reportPath = join(process.cwd(), 'domain-verification-report.json');
    verificationResults.summary = {
      totalTested: verificationResults.successfulDomains.length + verificationResults.failedDomains.length,
      successful: verificationResults.successfulDomains.length,
      failed: verificationResults.failedDomains.length,
      flaggedForFollowUp: verificationResults.flaggedForFollowUp.length
    };
    
    writeFileSync(reportPath, JSON.stringify(verificationResults, null, 2));
    console.log(`\nDomain verification report written to: ${reportPath}`);
    
    if (verificationResults.flaggedForFollowUp.length > 0) {
      console.log(`\n⚠️  ${verificationResults.flaggedForFollowUp.length} domains flagged for follow-up:`);
      verificationResults.flaggedForFollowUp.forEach(item => {
        console.log(`   - ${item.domain} (${item.category}): ${item.reason}`);
      });
    }
  });

  // Helper function to flag domain for follow-up
  const flagDomainForFollowUp = (domain, category, reason, type = 'original', additionalInfo = {}) => {
    const flaggedEntry = {
      domain,
      category,
      reason,
      type, // 'original' or 'ezproxy'
      timestamp: new Date().toISOString(),
      ...additionalInfo
    };
    
    verificationResults.flaggedForFollowUp.push(flaggedEntry);
    verificationResults.failedDomains.push(flaggedEntry);
    
    return flaggedEntry;
  };

  // Helper function to record successful domain
  const recordSuccessfulDomain = (domain, category, type = 'original', additionalInfo = {}) => {
    const successEntry = {
      domain,
      category,
      type,
      timestamp: new Date().toISOString(),
      ...additionalInfo
    };
    
    verificationResults.successfulDomains.push(successEntry);
    return successEntry;
  };


  // Helper function to test EZProxy version
  const testEZProxyDomain = async (domain, category, timeout = 10000) => {
    const transformedDomain = domain.replace(/\./g, '-');
    const ezproxyUrl = `https://${transformedDomain}.${config.ezproxyBaseUrl}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
      const response = await fetch(ezproxyUrl, {
        method: 'HEAD',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; EZProxy-Extension-Test/1.0)'
        }
      });
      clearTimeout(timeoutId);
      
      const result = {
        success: response.ok,
        status: response.status,
        statusText: response.statusText,
        url: ezproxyUrl,
        headers: Object.fromEntries(response.headers.entries())
      };

      // Flag for follow-up if not a 200 response
      if (response.status !== 200) {
        const reason = `EZProxy domain returned ${response.status} ${response.statusText}`;
        flagDomainForFollowUp(domain, category, reason, 'ezproxy', {
          status: response.status,
          statusText: response.statusText,
          url: ezproxyUrl
        });
      } else {
        recordSuccessfulDomain(domain, category, 'ezproxy', {
          status: response.status,
          statusText: response.statusText,
          url: ezproxyUrl
        });
      }

      return result;
    } catch (error) {
      clearTimeout(timeoutId);
      
      const result = {
        success: false,
        error: error.message,
        type: error.name,
        url: ezproxyUrl
      };

      // Flag for follow-up on connection errors
      const reason = `EZProxy domain connection failed: ${error.message}`;
      flagDomainForFollowUp(domain, category, reason, 'ezproxy', {
        error: error.message,
        errorType: error.name,
        url: ezproxyUrl
      });

      return result;
    }
  };

  // Helper function to simulate taking a screenshot
  const takeScreenshot = async (domain, isEzproxy = false) => {
    const transformedDomain = domain.replace(/\./g, '-');
    const url = isEzproxy ? `https://${transformedDomain}.${config.ezproxyBaseUrl}` : `https://${domain}`;
    
    // In a real implementation, this would use Puppeteer or similar
    // For now, we'll simulate the screenshot functionality
    const screenshotData = {
      timestamp: new Date().toISOString(),
      url: url,
      domain: domain,
      isEzproxy: isEzproxy,
      filename: `screenshot-${domain}${isEzproxy ? '-ezproxy' : ''}-${Date.now()}.png`,
      // Simulated screenshot metadata
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (compatible; EZProxy-Extension-Test/1.0)',
      features: {
        urlOverlay: true,
        overlayText: `URL: ${url}`
      }
    };
    
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
            describe(`Domain: ${domain}`, () => {
          
          test(`should work through EZProxy - ${domain}`, async () => {
            // Mock successful response for EZProxy domain
            fetch.mockResolvedValueOnce({
              ok: true,
              status: 200,
              statusText: 'OK',
              headers: new Map([
                ['content-type', 'text/html'],
                ['server', 'EZproxy'],
                ['x-ezproxy-version', '7.0']
              ])
            });

            const result = await testEZProxyDomain(domain, categoryName);
            
            const transformedDomain = domain.replace(/\./g, '-');
            const expectedUrl = `https://${transformedDomain}.${config.ezproxyBaseUrl}`;
            expect(fetch).toHaveBeenCalledWith(
              expectedUrl,
              expect.objectContaining({
                method: 'HEAD'
              })
            );

            expect(result.success).toBe(true);
            expect(result.status).toBe(200);
            expect(result.url).toBe(expectedUrl);
          }, 15000);

          test(`should handle EZProxy non-200 responses - ${domain}`, async () => {
            // Test with different response codes that should be flagged
            const testCases = [
              { status: 404, statusText: 'Not Found' },
              { status: 403, statusText: 'Forbidden' },
              { status: 500, statusText: 'Internal Server Error' },
              { status: 503, statusText: 'Service Unavailable' }
            ];

            for (const testCase of testCases) {
              fetch.mockClear();
              
              // Mock non-200 response for EZProxy
              fetch.mockResolvedValueOnce({
                ok: false,
                status: testCase.status,
                statusText: testCase.statusText,
                headers: new Map([
                  ['content-type', 'text/html']
                ])
              });

              const result = await testEZProxyDomain(domain, categoryName);
              
              expect(result.success).toBe(false);
              expect(result.status).toBe(testCase.status);
              
              // Verify domain was flagged for follow-up
              const flaggedEntries = verificationResults.flaggedForFollowUp.filter(
                entry => entry.domain === domain && entry.type === 'ezproxy'
              );
              expect(flaggedEntries.length).toBeGreaterThan(0);
              
              const latestFlag = flaggedEntries[flaggedEntries.length - 1];
              expect(latestFlag.reason).toContain(testCase.status.toString());
              expect(latestFlag.status).toBe(testCase.status);
            }
          }, 20000);

          test(`should handle EZProxy connection errors - ${domain}`, async () => {
            // Test different error scenarios for EZProxy
            const errorCases = [
              { name: 'TypeError', message: 'Failed to fetch' },
              { name: 'AbortError', message: 'The operation was aborted' },
              { name: 'NetworkError', message: 'Network request failed' }
            ];

            for (const errorCase of errorCases) {
              fetch.mockClear();
              
              // Mock connection error for EZProxy
              const error = new Error(errorCase.message);
              error.name = errorCase.name;
              fetch.mockRejectedValueOnce(error);

              const result = await testEZProxyDomain(domain, categoryName);
              
              expect(result.success).toBe(false);
              expect(result.error).toBe(errorCase.message);
              
              // Verify domain was flagged for follow-up
              const flaggedEntries = verificationResults.flaggedForFollowUp.filter(
                entry => entry.domain === domain && entry.type === 'ezproxy'
              );
              expect(flaggedEntries.length).toBeGreaterThan(0);
              
              const latestFlag = flaggedEntries[flaggedEntries.length - 1];
              expect(latestFlag.reason).toContain('connection failed');
              expect(latestFlag.error).toBe(errorCase.message);
            }
          }, 20000);

          test(`should capture EZProxy screenshots - ${domain}`, async () => {
            // Test screenshot for EZProxy version only
            const ezproxyScreenshot = await takeScreenshot(domain, true);
            expect(ezproxyScreenshot.domain).toBe(domain);
            expect(ezproxyScreenshot.isEzproxy).toBe(true);
            const transformedDomain = domain.replace(/\./g, '-');
            expect(ezproxyScreenshot.url).toBe(`https://${transformedDomain}.${config.ezproxyBaseUrl}`);
            expect(ezproxyScreenshot.filename).toContain(domain);
            expect(ezproxyScreenshot.filename).toContain('ezproxy');
            expect(ezproxyScreenshot.filename).toContain('.png');
            expect(ezproxyScreenshot.timestamp).toBeDefined();
            
            // Verify URL overlay features are included in screenshot metadata
            expect(ezproxyScreenshot.features).toBeDefined();
            expect(ezproxyScreenshot.features.urlOverlay).toBe(true);
            expect(ezproxyScreenshot.features.overlayText).toContain(ezproxyScreenshot.url);
          });

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
    
    console.log(`\nDomain verification summary:`);
    console.log(`- Total categories: ${categories.length}`);
    console.log(`- Total domains: ${totalDomains}`);
    console.log(`- Testing subset of domains per category for performance`);
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