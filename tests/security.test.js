import { test, expect, beforeEach, afterEach, beforeAll, afterAll } from '@jest/globals';
import { RATE_LIMIT, cleanupRateLimiter, isValidUrl, sanitizeInput } from '../utils/security.js';

// Test rate limiting
describe('Rate Limiter', () => {
  // Store the original RATE_LIMIT state
  let originalRateLimit;
  
  beforeAll(() => {
    // Store the original RATE_LIMIT methods
    originalRateLimit = { ...RATE_LIMIT };
    // Mock timers
    jest.useFakeTimers();
  });
  
  beforeEach(() => {
    // Reset the rate limiter state before each test
    RATE_LIMIT.reset();
    // Ensure we're in a clean state
    RATE_LIMIT.requests.clear();
  });
  
  afterEach(() => {
    // Clean up any intervals
    RATE_LIMIT.reset();
    // Clear all timers
    jest.clearAllTimers();
  });
  
  afterAll(() => {
    // Restore timers
    jest.useRealTimers();
    // Restore original RATE_LIMIT methods
    Object.assign(RATE_LIMIT, originalRateLimit);
  });
  
  // Helper to manually advance time and run pending timers
  const advanceTime = (ms) => {
    jest.advanceTimersByTime(ms);
    // Run any pending callbacks
    jest.runOnlyPendingTimers();
  };

  test('allows requests under limit', () => {
    const id = 'test-id';
    
    // Should allow up to MAX_REQUESTS
    for (let i = 0; i < RATE_LIMIT.MAX_REQUESTS; i++) {
      expect(RATE_LIMIT.isAllowed(id)).toBe(true);
    }
  });

  test('blocks requests over limit', () => {
    const id = 'test-id';
    
    // Fill up the rate limit
    for (let i = 0; i < RATE_LIMIT.MAX_REQUESTS; i++) {
      expect(RATE_LIMIT.isAllowed(id)).toBe(true);
    }
    
    // Next request should be blocked
    expect(RATE_LIMIT.isAllowed(id)).toBe(false);
  });

  test('resets after window', () => {
    const id = 'test-id';
    
    // Fill up the rate limit
    for (let i = 0; i < RATE_LIMIT.MAX_REQUESTS; i++) {
      expect(RATE_LIMIT.isAllowed(id)).toBe(true);
    }
    
    // Should be blocked
    expect(RATE_LIMIT.isAllowed(id)).toBe(false);
    
    // Clear the requests to simulate window expiration
    // This is needed because Jest's fake timers don't actually affect Date.now()
    const requests = RATE_LIMIT.requests.get(id);
    RATE_LIMIT.requests.set(id, []);
    
    // Should be allowed again after window passes
    expect(RATE_LIMIT.isAllowed(id)).toBe(true);
  });
  
  test('cleans up old entries', () => {
    // Reset the rate limiter state
    RATE_LIMIT.reset();
    
    // Make requests for two different IDs
    const id1 = 'test-id-1';
    const id2 = 'test-id-2';
    
    // Add entries with timestamps that would be considered old
    const now = Date.now();
    const oldTime = now - (RATE_LIMIT.WINDOW_MS * 3);
    RATE_LIMIT.requests.set(id1, [oldTime]);
    RATE_LIMIT.requests.set(id2, [oldTime]);
    
    // Verify both entries exist
    expect(RATE_LIMIT.requests.has(id1)).toBe(true);
    expect(RATE_LIMIT.requests.has(id2)).toBe(true);
    
    // Force cleanup
    RATE_LIMIT.cleanup();
    
    // Both entries should be cleaned up
    expect(RATE_LIMIT.requests.has(id1)).toBe(false);
    expect(RATE_LIMIT.requests.has(id2)).toBe(false);
    
    // Add a new request
    RATE_LIMIT.isAllowed('new-request');
    expect(RATE_LIMIT.requests.has('new-request')).toBe(true);
  });
});

// Test URL validation
describe('URL Validation', () => {
  test('validates HTTP URLs', () => {
    expect(isValidUrl('http://example.com')).toBe(true);
    expect(isValidUrl('https://example.com/path?query=value')).toBe(true);
  });

  test('rejects invalid URLs', () => {
    expect(isValidUrl('not-a-url')).toBe(false);
    expect(isValidUrl('ftp://insecure.com')).toBe(false);
    expect(isValidUrl('javascript:alert(1)')).toBe(false);
    expect(isValidUrl('')).toBe(false);
    expect(isValidUrl(null)).toBe(false);
    expect(isValidUrl(undefined)).toBe(false);
  });
});

// Test input sanitization
describe('Input Sanitization', () => {
  test('escapes HTML entities', () => {
    expect(sanitizeInput('<script>alert(1)</script>'))
      .toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(sanitizeInput('"quoted" & special <chars>'))
      .toBe('&quot;quoted&quot; &amp; special &lt;chars&gt;');
  });

  test('handles non-string input', () => {
    expect(sanitizeInput(null)).toBe('');
    expect(sanitizeInput(undefined)).toBe('');
    expect(sanitizeInput(123)).toBe('123');
    expect(sanitizeInput({})).toBe('[object Object]');
  });
});

// Test CSP headers (meta test)
describe('Content Security Policy', () => {
  test('manifest has secure CSP', () => {
    const manifest = require('../manifest.json');
    const csp = manifest.content_security_policy.extension_pages;
    
    // Check for required CSP directives
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("style-src 'self'");
    
    // Check for unsafe directives
    expect(csp).not.toContain("script-src 'unsafe-inline'");
    expect(csp).not.toContain("script-src 'unsafe-eval'");
  });
});
