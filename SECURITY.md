# Security Policy

## Supported Versions

Only the latest version of the EZProxy Extension receives security updates. Please ensure you are always running the most recent version.

## Reporting a Vulnerability

If you discover a security vulnerability within this extension, please follow these steps:

1. **Do not** create a public GitHub issue for security vulnerabilities
2. Email the security team at [security@example.com](mailto:security@example.com) with:
   - A clear description of the vulnerability
   - Steps to reproduce the issue
   - Any relevant logs or screenshots
   - Your contact information

We will respond to your report within 48 hours and keep you updated on the progress towards fixing the issue.

## Security Best Practices

### For Users
- Only install the extension from the official Chrome Web Store
- Keep your browser and extensions up to date
- Review extension permissions before installation
- Report any suspicious behavior immediately

### For Developers
- Follow the principle of least privilege when requesting permissions
- Keep all dependencies up to date using `npm audit`
- Run security checks before each release
- Never commit sensitive information to version control
- Use Content Security Policy (CSP) headers
- Validate and sanitize all user input
- Use secure communication (HTTPS) for all network requests
- Implement proper error handling without leaking sensitive information
- Follow the OWASP Top 10 security guidelines

## Security Features

- **Content Security Policy (CSP)**: Restricts sources of scripts and other resources
- **Subresource Integrity (SRI)**: Ensures resources haven't been tampered with
- **Secure Storage**: Sensitive data is encrypted before storage
- **CSRF Protection**: Implements anti-CSRF tokens for state-changing operations
- **Rate Limiting**: Prevents abuse of API endpoints
- **Input Validation/Sanitization**: All user input is validated and sanitized

## Dependencies

Regularly update dependencies using:
```bash
npm update
npm audit fix
```

## Security Audits

Run the following commands to perform security checks:

```bash
# Lint code with security rules
npm run lint

# Check for vulnerable dependencies
npm audit

# Run security tests
npm test
```

## Known Security Considerations

- The extension requires broad host permissions to function but follows the principle of least privilege
- Sensitive operations require user interaction
- All external resources are loaded over HTTPS
