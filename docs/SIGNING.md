# Release Signing Configuration (GitHub Secrets)

Signing keys and certificates are **never** stored inside this repository. Maintainers configure them as encrypted **GitHub Repository Secrets** under **Settings → Secrets and variables → Actions**.

## Android APK Signing

1. Generate an upload keystore locally (never commit the `.jks` file):
   ```bash
   keytool -genkey -v -keystore release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias mydownloadmanager
   ```
2. Base64-encode the keystore:
   ```bash
   base64 -w 0 release.jks
   ```
3. Add these GitHub Secrets:
   - `ANDROID_KEYSTORE_BASE64`: Base64 string of `release.jks`
   - `ANDROID_KEYSTORE_PASSWORD`: Keystore password
   - `ANDROID_KEY_ALIAS`: `mydownloadmanager`
   - `ANDROID_KEY_PASSWORD`: Key password

When these secrets are present, `.github/workflows/ci-and-release.yml` decodes the keystore ephemerally in CI, signs `app-release.apk`, and deletes the keystore after the job completes. When omitted, CI outputs `app-release-unsigned.apk` and `app-debug.apk`.

## Windows EXE Code Signing

1. Obtain an Authenticode `.pfx` / `.p12` certificate from a trusted Certificate Authority.
2. Base64-encode the `.pfx` file and configure these GitHub Secrets:
   - `CSC_LINK`: Base64-encoded `.pfx` certificate
   - `CSC_KEY_PASSWORD`: Certificate password

When omitted, `electron-builder` produces an unsigned NSIS installer and portable `.exe`. Windows SmartScreen may show *"Windows protected your PC"* on unsigned builds until signed with a trusted CA certificate.
