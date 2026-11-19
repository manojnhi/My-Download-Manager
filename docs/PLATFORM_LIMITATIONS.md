# Platform Limitations & Additional Setup

## Android (`android/`)
- **Scoped Storage (Android 10+ / API 29+)**: Direct arbitrary filesystem paths are restricted by Android. Users select a custom destination folder via the Storage Access Framework (`Intent.ACTION_OPEN_DOCUMENT_TREE`), or files save to the app's `Downloads/MyDownloadManager` directory.
- **Background Downloads**: Long downloads on Android require `FOREGROUND_SERVICE_DATA_SYNC` and notification permission (`POST_NOTIFICATIONS` on Android 13+) to avoid OS battery-optimization pauses.
- **APK Installation**: Installing a debug or self-signed APK outside Google Play requires enabling **Install unknown apps** for your file manager/browser.

## Windows (`desktop/`)
- **Unsigned EXE Warning**: Unless signed with an Authenticode certificate (`docs/SIGNING.md`), Windows Defender SmartScreen displays a prompt on first launch (*More info → Run anyway*).
- **OS Notifications**: Native toast notifications require the app shortcut created by the NSIS installer (`electron-builder --win`).

## Web & Network Limitations
- **Server Range Support**: Multi-connection acceleration and pause/resume require the origin server to return `Accept-Ranges: bytes` and `206 Partial Content`. Servers returning `200 OK` without range headers automatically fall back to a single non-resumable stream.
- **Unsupported Streaming Sites**: Platforms using encrypted HLS/DASH streams or DRM (e.g., YouTube, Netflix, Spotify) are intentionally unsupported; use each service's official app download button.
