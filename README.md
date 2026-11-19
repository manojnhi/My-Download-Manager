# My Download Manager

A fast, privacy-first, multi-connection download manager inspired by Internet Download Manager (IDM), built as a unified monorepo for **Android (APK)**, **Windows Desktop (EXE)**, and an interactive **Web & Test Console**.

## Repository Structure

```text
my-download-manager/
├── shared/                  # Shared pure TypeScript core (URL compliance, segment planner, queue, errors)
├── android/                 # Native Kotlin + Jetpack Compose + OkHttp Android app (APK)
├── desktop/                 # Windows Electron + TypeScript desktop app (NSIS + Portable EXE)
├── server/                  # Node.js multi-connection download engine + local HTTP Range test server
├── src/                     # Accessible Light/Dark React UI
├── docs/                    # Signing guide & platform limitations
└── .github/workflows/       # Automated CI tests, APK/EXE builds, SHA-256 checksums, GitHub Releases
```

## Core Features

- **Multi-Connection Segmented Downloads**: Probes `Accept-Ranges: bytes` and splits large files across configurable parallel connections (1–16), automatically falling back to 1 stream if a server does not support ranges or rate-limits (`HTTP 429`).
- **Pause, Resume, Retry, Cancel & Remove**: Preserves partial `.part` byte offsets locally for resumable downloads.
- **Concurrent Queue & Speed Limiter**: Configurable concurrent download slots and global bandwidth cap (`KB/s`).
- **Category Folders & Custom Destination**: Routes Videos, Audio, Images, Documents, Archives, and Installers into customizable folders.
- **Link Capture**:
  - **Android**: Registers `ACTION_SEND` and `ACTION_VIEW` intents so links shared from any browser or app open directly in My Download Manager.
  - **Windows**: Detects downloadable HTTP/HTTPS links pasted into the app (`Ctrl+V` or paste button).
- **Accessible Light & Dark Mode**: High-contrast UI with full keyboard navigation and clear status/error messages.

## Website Compatibility, Security & Privacy

- Downloads **only direct file URLs** and documented public APIs that the user is authorized to access.
- Refuses unsupported DRM/streaming sites (e.g., YouTube, Netflix, Spotify, `.m3u8`/`.mpd` manifests) and instructs users to use each service's official download feature.
- Never embeds third-party extraction services or bypasses DRM, paywalls, authentication, or anti-bot protections.
- Shows an explicit **Executable File Warning** with the full source URL before downloading `.exe`, `.apk`, `.msi`, `.bat`, `.ps1`, `.sh`, or `.dmg` files, and **never runs downloaded files automatically**.
- Stores all download history, settings, and `.part` files locally — zero telemetry or URL uploads.

## Quick Start & Build Instructions

### 1. Run Tests & Local Web Console (with Built-in Resumable Test Server)
```bash
npm install
npx tsx --test shared/downloadCore.test.ts server/downloadManager.test.ts
npm run dev
```
Open `http://localhost:3000` to test live multi-connection downloads, pause/resume, bandwidth limiting, executable warnings, and HTTP `410`/`401`/`404` error handling against the built-in test server.

### 2. Build Android APK (`android/`)
Requires JDK 17 and Android SDK 35:
```bash
cd android
gradle assembleDebug assembleRelease
# Output: android/app/build/outputs/apk/debug/app-debug.apk
```

### 3. Build Windows EXE (`desktop/`)
Requires Node.js 22+:
```bash
cd desktop
npm install
npm run dist:win
# Output: desktop/release/My Download Manager Setup *.exe
```

### 4. Automated GitHub Builds & Releases
Push a version tag (e.g. `git tag v1.0.0 && git push origin v1.0.0`) or trigger **Actions -> CI & Release Builds** manually on GitHub to build the Android APK, Windows EXE, and `SHA256SUMS.txt`. See [docs/SIGNING.md](docs/SIGNING.md) for configuring release signing secrets safely.
