# Contributing to My Download Manager

Thank you for helping improve **My Download Manager**.

## Development Guidelines

1. **Keep Shared Logic Pure**: Put URL validation, queue scheduling, segment math, and error mapping in `shared/downloadCore.ts` (and keep `android/.../DownloadCore.kt` aligned).
2. **Respect Legal & Platform Compliance**:
   - Do not add DRM circumvention, paywall bypasses, CAPTCHA/anti-bot bypasses, or third-party video site scrapers.
   - Maintain clear warnings for executable files and insecure `http://` links.
3. **Never Commit Secrets**: Keystores, `.pfx` certificates, passwords, and API tokens must never be committed. Use GitHub Actions Secrets (`docs/SIGNING.md`).
4. **Tests Required**: All pull requests modifying queue logic, pause/resume behavior, or error mapping must include passing tests:
   ```bash
   npx tsx --test shared/downloadCore.test.ts server/downloadManager.test.ts
   ```
   For Android changes:
   ```bash
   cd android && gradle test
   ```
   For Windows desktop changes:
   ```bash
   cd desktop && npm install && npm run build
   ```
