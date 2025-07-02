# Domain Verification System

This document describes the automated domain verification system that tests all domains in `domain-categories.json` for functionality and EZProxy accessibility.

## Overview

The domain verification system performs comprehensive testing of academic domains to ensure they:
1. Are accessible and return HTTP 200 responses
2. Work properly through EZProxy 
3. Are flagged for follow-up if they don't respond correctly
4. Have screenshots captured for visual verification with URL overlay

### Screenshot Features
- **EZProxy Only**: Screenshots are only taken of domains that successfully load through EZProxy (HTTP 200)
- **URL Overlay**: Each screenshot includes a browser-like address bar overlay showing the EZProxy URL being tested
- **Timestamp**: Screenshots include capture timestamp for reference
- **Visual Verification**: Easy identification of EZProxy domain accessibility and content loading
- **Transform Verification**: Screenshots show the correctly transformed domain (dots replaced with dashes)

## Components

### 1. Jest Test Suite (`tests/domain-verification.test.js`)
- Unit tests with mocked responses for CI/CD integration
- Tests domain connectivity, EZProxy functionality, and error handling
- Validates domain categories structure and configuration
- Runs quickly with mocked network requests

### 2. Real-World Verification Script (`scripts/domain-verification.js`)
- Makes actual HTTP requests to test domain accessibility
- Takes screenshots using Puppeteer (optional dependency)
- Generates comprehensive reports with flagged domains
- Handles rate limiting and concurrent requests safely

## Usage

### Running Tests
```bash
# Run all tests including domain verification
npm test

# Run only domain verification tests
npm run test:domains

# Run with specific test patterns
npm test -- --testNamePattern="domain"
```

### Running Real Verification
```bash
# Run actual domain verification with screenshots
npm run verify-domains

# Or run directly
node scripts/domain-verification.js
```

### Installing Screenshot Dependencies
For screenshot functionality, install Puppeteer:
```bash
npm install puppeteer --save-dev
```

## Output and Reports

### Test Reports
- Console output during test execution
- Jest test results with pass/fail status
- Automatic flagging in test results

### Verification Reports
- `domain-verification-report.json` - Comprehensive JSON report
- `screenshots/` directory - PNG screenshots of working EZProxy domains
- Console summary with flagged domains for follow-up

### Report Structure
```json
{
  "timestamp": "2025-01-01T12:00:00.000Z",
  "summary": {
    "totalTested": 150,
    "successful": 140,
    "failed": 10,
    "flaggedForFollowUp": 10,
    "screenshotsTaken": 140
  },
  "flaggedForFollowUp": [
    {
      "domain": "example.com",
      "category": "Science & Technology",
      "reason": "Original domain returned 404 Not Found",
      "type": "original",
      "status": 404,
      "timestamp": "2025-01-01T12:00:00.000Z"
    }
  ],
  "successfulDomains": [...],
  "failedDomains": [...],
  "screenshots": [...]
}
```

## Flagging Criteria

Domains are automatically flagged for follow-up when:

### Original Domain Issues
- HTTP status code is not 200 (404, 403, 500, 503, etc.)
- Connection timeout or network errors
- DNS resolution failures
- SSL/TLS certificate errors

### EZProxy Domain Issues  
- EZProxy URL returns non-200 status codes
- EZProxy server connectivity issues
- Authentication or configuration problems
- Proxy timeout errors

### Common Follow-up Actions
- **404 Not Found**: Domain may have changed or been discontinued
- **403 Forbidden**: Access restrictions may be in place
- **500/503 Errors**: Server issues that may be temporary
- **Connection Failures**: DNS, network, or infrastructure problems
- **EZProxy Issues**: Configuration or authentication problems

## Configuration

### Test Configuration
Edit `tests/domain-verification.test.js` to modify:
- Timeout values
- Number of domains tested per category (default: first 3)
- Test scenarios and error cases

### Script Configuration
Edit `CONFIG` object in `scripts/domain-verification.js`:
```javascript
const CONFIG = {
  timeout: 10000,           // Request timeout in ms
  maxConcurrent: 5,         // Concurrent requests
  screenshotDir: 'screenshots',  // Screenshot directory
  reportFile: 'domain-verification-report.json'
};
```

## Integration with CI/CD

### GitHub Actions Example
```yaml
- name: Run domain verification tests
  run: npm run test:domains

- name: Run full domain verification (optional)
  run: npm run verify-domains
  continue-on-error: true  # Don't fail build on domain issues

- name: Upload domain report
  uses: actions/upload-artifact@v3
  with:
    name: domain-verification-report
    path: domain-verification-report.json
```

## Monitoring and Maintenance

### Regular Verification
- Run domain verification weekly to catch issues early
- Monitor the report for patterns in failed domains
- Update domain lists based on verification results

### Handling Flagged Domains
1. **Investigate** the specific error or status code
2. **Verify manually** by visiting the domain directly
3. **Check EZProxy configuration** for proxy-specific issues
4. **Update domain list** if domains have moved or been discontinued
5. **Contact vendors** if widespread issues are detected

### Performance Considerations
- Script processes domains in batches to avoid overwhelming servers
- Includes delays between requests to be respectful to target servers
- Screenshots are optional and can be disabled for faster execution
- Concurrent request limit prevents rate limiting issues

## Troubleshooting

### Common Issues
- **Puppeteer installation errors**: Install with `npm install puppeteer --save-dev`
- **Network timeouts**: Increase timeout values in configuration
- **Rate limiting**: Reduce `maxConcurrent` value in script configuration
- **Memory issues**: Process domains in smaller batches for large lists

### Debug Mode
Enable debug logging by setting environment variable:
```bash
DEBUG=domain-verification npm run verify-domains
```