# Debug Logging

This extension includes conditional debug logging that is disabled by default in production.

## Enabling Debug Logging

To enable debug logging during development or troubleshooting:

1. Open the extension popup
2. Open the browser's developer console (F12)
3. In the console, run:
   ```javascript
   localStorage.setItem('ezproxy-debug', 'true');
   ```
4. Reload the pages you want to debug

## Disabling Debug Logging

To disable debug logging:

1. In the browser's developer console, run:
   ```javascript
   localStorage.removeItem('ezproxy-debug');
   ```
2. Reload the pages

## Debug Log Prefixes

- `[EZProxy]` - Content script logs
- `[EZProxy-BG]` - Background script logs  
- `[EZProxy-Popup]` - Popup script logs

## Production Build

In production builds, all `debugLog()` calls are conditional and will not output anything unless explicitly enabled by the user through localStorage.

This keeps the browser console clean while still allowing for debugging when needed. 