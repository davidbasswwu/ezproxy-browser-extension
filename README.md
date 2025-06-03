## EZproxy browser extension for Western Washington University

### What it does 
This Chrome browser extension makes it easy to access Library resources when the user is off-campus by checking the current domain against a list of EZproxy domains.

If the user is on a website that the Library has access to, the extension will offer to redirect them to the EZproxy version of the site, which allows them to authenticate using their library account.

Here is what it looks like before (on https://www.chronicle.com/)
![EZproxy Domain Checker Screenshot](images/chronicle-before.png)

and after the user clicks the button (now on https://www-chronicle-com.ezproxy.library.wwu.edu/):
![EZproxy Domain Checker Screenshot](images/chronicle-after.png)

### Configuration
The extension can be configured by editing the [config.json](config.json) file. The following settings are available:

- `domainListUrl`: The URL of the domain list file
- `ezproxyBaseUrl`: The base URL of the EZproxy server
- `institutionName`: The name of the institution
- `institutionDomain`: The institution's domain (e.g., `wwu.edu`)
- `institutionShortName`: Short name for the institution (e.g., `WWU`)
- `institutionLibraryName`: The name of the institution's library (e.g., `WWU Libraries`)
- `libraryHelpUrl`: The URL for library help or support, used for exception domains
- `updateInterval`: How often (in milliseconds) to update the domain list (default: 86400000 = 24 hours)
- `retryAttempts`: Number of retry attempts for network requests
- `retryDelay`: Delay in milliseconds between retry attempts
- `enableAutoRedirect`: Whether to enable auto-redirect to EZProxy (true/false)
- `enableUserNotifications`: Whether to show user notifications (true/false)
- `bannerMessage`: The default message to display in the main banner
- `version`: The version of the extension
- `accessIndicators`: Strings used to detect if a page indicates the user already has institutional access (case-insensitive)
- `fullAccessIndicators`: Strings indicating the user already has full access and doesn't need EZProxy
- `urlExceptions`: Domains that require special handling for EZProxy access (e.g., `ft.com`). For these, users are redirected to the `libraryHelpUrl` instead of the standard EZProxy URL.
- `secondaryHelpButtonText`: Text for the button that appears on EZProxy pages for exception domains, linking to help information (default: "Info for this site")
- `banner`: Styling and text configuration for the EZProxy access banner, including:
    - `backgroundColor`, `textColor`, `borderColor`, `padding`, `fontFamily`, `fontSize`, `lineHeight`, `boxShadow`, `zIndex`, `animationDuration`, `mobileBreakpoint`
    - `button`: Styles and text for the main action button
    - `dismissButton`: Styles and text for the dismiss button
    - `closeButton`: Styles and text for the close button

See the comments in `config.json` for more details on each option.

### To install
Until this becomes available in the Chrome Extension store, clone the repository or download the zip file from the releases page.  
Load the unpacked extension in Chrome by going to chrome://extensions/ and clicking the "Load unpacked" button.  Choose the "test-build" or "dist" folder.

### What's Next?
See the [TODO.md](TODO.md) file for a list of things that need to be done.

### Credits
Idea and initial implementation by David Bass at WWU with a *lot* of help from Cursor, Windsurf, Anthropic, OpenAI and SWE-1.