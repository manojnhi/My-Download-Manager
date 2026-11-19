# Security Policy

## Security Guarantees

- **No Automatic Execution**: Downloaded files are never launched or executed automatically.
- **Executable File Confirmation**: `.exe`, `.msi`, `.apk`, `.bat`, `.ps1`, `.sh`, `.dmg`, and `.appimage` downloads require explicit user confirmation displaying the exact source URL.
- **HTTPS Preference**: Unencrypted `http://` URLs display a clear warning; HTTPS is used whenever provided.
- **Local-Only Data**: Download history, queues, and files remain strictly on the user's device.

## Reporting a Vulnerability

Please open a private GitHub Security Advisory on the repository rather than filing a public issue with exploit details.
