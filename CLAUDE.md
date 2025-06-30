# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Chrome browser extension that helps users access library resources through EZProxy when off-campus. The extension detects when users visit academic websites and offers to redirect them to the EZProxy version for institutional access.

## Development Commands

### Build and Development
- `npm run build` - Build extension for production (outputs to `dist/` folder)
- `npm run dev` - Build in development mode with watch enabled
- `npm run lint` - Run ESLint to check code quality
- `npm test` - Run Jest tests
- `npm test -- -t "security"` - Run security-specific tests

### Installation
Load the unpacked extension from the `dist/` folder in Chrome's extension manager.

## Code Architecture

### Core Components

**Background Script (`background.js`)**
- Service worker that manages extension lifecycle
- Loads configuration from `config.json` and domain list
- Monitors tab updates and sends messages to content scripts
- Handles domain matching logic and EZProxy URL generation
- Manages extension icon states (normal vs dismissed)

**Content Script (`content.js`)**
- Runs on all web pages to detect library resources
- Creates and manages notification banners
- Checks for institutional access indicators in page content
- Handles banner dismissal and domain exception logic
- Manages auto-redirect functionality

**Popup (`popup.js` + `popup.html`)**
- Extension popup interface for manual access
- Shows current page status and EZProxy redirect options
- Allows users to reset dismissed domains
- Handles exception domains with special help flows

### Key Data Files

**Configuration (`config.json`)**
- Institution-specific settings (WWU by default)
- EZProxy base URL and library help URLs
- Access indicators for detecting institutional access
- Banner styling and behavior configuration
- Exception domains requiring special handling

**Domain List (`domain-list.json`)**
- Contains list of domains that have EZProxy access
- Can be either simple array format or structured object with exceptions
- Updated periodically from remote URL configured in config.json

### Architecture Patterns

**Message Passing**
- Background script coordinates between tabs and content scripts
- Uses chrome.runtime.sendMessage for cross-component communication
- Handles tab updates and icon state management

**Storage Management**
- Uses chrome.storage.local for dismissed domains and settings
- Caches domain lists locally with periodic updates
- Stores user preferences like auto-redirect settings

**Security Features**
- Content Security Policy restricts script execution
- Input validation for URLs and domain matching
- Secure handling of configuration and domain data
- Uses utility functions in `utils/security.js` for validation

## Configuration

The extension is highly configurable via `config.json`. Key settings include:
- Institution details and branding
- EZProxy server configuration
- Domain list URLs and update intervals
- Access detection indicators
- Banner appearance and behavior
- Exception domains requiring special handling

## Testing

Uses Jest with jsdom environment for testing. Security tests are specifically available with `npm test -- -t "security"`. Test helpers are in `tests/test-helpers.js`.

## Build Process

Uses Webpack for bundling with separate entry points for background, content, and popup scripts. The build process:
- Transpiles modern JavaScript with Babel
- Copies static assets (HTML, CSS, images, config files)
- Minifies code for production builds
- Generates source maps for debugging