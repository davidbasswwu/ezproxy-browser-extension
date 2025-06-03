## EZproxy browser extension for Western Washington University

### What it does 
This Chrome browser extension makes it easy to access Library resources when the user is off-campus by checking the current domain against a list of EZproxy domains.

If the user is on a website that the Library has access to, the extension will offer to redirect them to the EZproxy version of the site, which allows them to authenticate using their library account.

Here is what it looks like before (on https://www.chronicle.com/)
![EZproxy Domain Checker Screenshot](images/chronicle-before.png)

and after the user clicks the button (now on https://www-chronicle-com.ezproxy.library.wwu.edu/):
![EZproxy Domain Checker Screenshot](images/chronicle-after.png)

### Configuration
The extension can be configured by editing the [config.json](config.json) file.  The following settings are available:

- `domainListUrl`: The URL of the domain list file
- `ezproxyBaseUrl`: The base URL of the EZproxy server
- `institutionName`: The name of the institution
- `updateInterval`: The interval in milliseconds between updates
- `retryAttempts`: The number of retry attempts
- `retryDelay`: The delay in milliseconds between retry attempts
- `enableAutoRedirect`: Whether to enable auto-redirect
- `enableUserNotifications`: Whether to enable user notifications
- `bannerMessage`: The message to display in the banner
- `version`: The version of the extension
- `accessIndicators`: The access indicators to look for
- `banner`: The banner configuration

### To install
Until this becomes available in the Chrome Extension store, clone the repository or download the zip file from the releases page.  
Load the unpacked extension in Chrome by going to chrome://extensions/ and clicking the "Load unpacked" button.  Choose the "test-build" or "dist" folder.

### What's Next?
See the [TODO.md](TODO.md) file for a list of things that need to be done.

### Credits
Idea and initial implementation by David Bass at WWU with a *lot* of help from Cursor, Windsurf, Anthropic, OpenAI and SWE-1.