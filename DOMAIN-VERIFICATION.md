# Domain Verification System

This document describes the automated domain verification system that tests all domains in `domain-categories.json` for functionality and EZProxy accessibility.

## Overview

The domain verification system performs comprehensive testing of academic domains through EZProxy to:
1. Take screenshots of EZProxy domains for visual verification
2. Handle login screens with interactive authentication
3. Maintain authenticated sessions across multiple domains
4. Provide screenshots with URL overlays showing the EZProxy URLs being tested

### Screenshot Features
- **EZProxy Only**: Screenshots are taken of EZProxy domains regardless of HTTP response codes
- **Interactive Authentication**: Automatically detects login screens and prompts for manual login
- **Session Management**: Maintains authenticated session across all domains after initial login
- **URL Overlay**: Each screenshot includes a browser-like address bar overlay showing the EZProxy URL being tested
- **Authentication Status**: Screenshots are marked with authentication status (🔐 authenticated, 🌐 public)
- **Transform Verification**: Screenshots show the correctly transformed domain (dots replaced with dashes)

## Authentication System

The domain verification script includes sophisticated authentication handling:

### Login Detection
- **Automatic Detection**: Identifies Western Washington University login pages
- **Multiple Indicators**: Detects login forms, password fields, WWU branding, Shibboleth authentication
- **Visual Confirmation**: Shows browser window with login page for manual authentication

### Interactive Login Process
1. **Detection**: Script automatically detects when EZProxy redirects to a login page
2. **Browser Window**: Opens visible browser window showing the login page
3. **Manual Login**: User completes authentication manually in the browser
4. **Session Capture**: Script waits for user confirmation before capturing session cookies
5. **Reuse**: Authenticated session is maintained for all subsequent domains

### Session Management
- **Cookie Persistence**: Session cookies are saved to `ezproxy-session.json`
- **Session Reuse**: Subsequent runs automatically load saved authentication
- **Cross-Domain**: Single authentication works for all EZProxy domains
- **Cleanup**: Browser closes automatically after all screenshots are complete

### Security Features
- **No Credential Storage**: No usernames or passwords are stored in code or config
- **Manual Authentication**: User maintains full control over the login process
- **Session File**: Only session cookies are saved (can be deleted anytime)
- **Visible Browser**: All authentication happens in a visible browser window

## Components

### 1. Jest Test Suite (`tests/domain-verification.test.js`)
- Unit tests with mocked responses for CI/CD integration
- Tests EZProxy functionality and error handling
- Validates domain categories structure and configuration
- Runs quickly with mocked network requests

### 2. Real-World Verification Script (`scripts/domain-verification.js`)
- Makes actual HTTP requests to test EZProxy domain accessibility
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
# Run actual domain verification with screenshots and authentication
npm run verify-domains

# Or run directly
node scripts/domain-verification.js
```

**First Run (Authentication Required):**
1. Script opens browser window with EZProxy login page
2. **TAKE AS MUCH TIME AS YOU NEED** - there are no time limits
3. Complete login, 2FA, and any additional authentication steps
4. Navigate through any redirect pages or prompts
5. Wait until you see actual academic content (journals, databases, etc.)
6. Only then press ENTER in terminal to continue
7. Script captures session and proceeds with all domains

**Infinite Patience Approach:**
- **No time pressure** - take 5, 10, 15+ minutes if needed
- **2 minute navigation timeout** (only applies to page loading, not login)
- **15 seconds for login detection** before prompting
- **2 seconds between domains** for respectful processing
- **Manual control** - you decide when authentication is complete

**Subsequent Runs (Authenticated):**
1. Script automatically loads saved session
2. No manual authentication required
3. Proceeds directly to screenshot capture

**Clear Session:**
```bash
# Remove saved authentication session
rm ezproxy-session.json
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

### EZProxy Domain Issues  
- EZProxy URL returns non-200 status codes (404, 403, 500, 503, etc.)
- EZProxy server connectivity issues
- Authentication or configuration problems
- Proxy timeout errors
- DNS resolution failures
- SSL/TLS certificate errors

### Common Follow-up Actions
- **404 Not Found**: Domain may have changed or EZProxy configuration needs updating
- **403 Forbidden**: Access restrictions or authentication issues
- **500/503 Errors**: EZProxy server issues that may be temporary
- **Connection Failures**: DNS, network, or EZProxy infrastructure problems
- **302 Redirects**: May indicate login requirements or configuration issues

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

### Authentication Issues
- **Script rushing login**: The script now waits indefinitely for you to complete login
- **Can't find browser window**: Check your taskbar or dock for the Chromium/Chrome window
- **Login not working**: Close the browser window and restart the script
- **Session expired**: Delete `ezproxy-session.json` and run the script again
- **Multiple login prompts**: University systems sometimes require multiple authentication steps
- **Redirects after login**: Wait for all redirects to complete before pressing ENTER

### Technical Issues  
- **Puppeteer installation errors**: Install with `npm install puppeteer --save-dev`
- **Network timeouts**: Script uses 2-minute timeouts for page loading
- **Memory issues**: Script processes domains sequentially to avoid overload
- **Script hanging**: Press Ctrl+C to cancel and restart if needed

### Debug Mode
Enable debug logging by setting environment variable:
```bash
DEBUG=domain-verification npm run verify-domains
```