import { useState } from 'react';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  FolderGit2,
  Lock,
  Monitor,
  Smartphone,
} from 'lucide-react';

export function GitHubRepoHub() {
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [zipError, setZipError] = useState<string | null>(null);
  const [zipSuccess, setZipSuccess] = useState(false);

  const handleDownloadRepoZip = async () => {
    setDownloadingZip(true);
    setZipError(null);
    setZipSuccess(false);
    try {
      const response = await fetch('/api/download/my-download-manager-repo.zip', {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`Server returned HTTP ${response.status}`);
      }
      const buffer = await response.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      if (
        bytes.length < 4 ||
        bytes[0] !== 0x50 ||
        bytes[1] !== 0x4b ||
        bytes[2] !== 0x03 ||
        bytes[3] !== 0x04
      ) {
        throw new Error('Downloaded payload is not a valid PKZIP archive.');
      }

      const blob = new Blob([bytes], { type: 'application/zip' });
      const blobUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = 'my-download-manager-repo.zip';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
      setZipSuccess(true);
    } catch (err) {
      setZipError(err instanceof Error ? err.message : 'Unable to download ZIP archive.');
    } finally {
      setDownloadingZip(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Monorepo Export Banner */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <FolderGit2 className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                My Download Manager — GitHub Repository
              </h2>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Complete monorepo with Android (Kotlin/Compose APK), Windows Desktop (Electron EXE),
              shared core logic, tests, MIT license, and GitHub Actions release workflows.
            </p>
          </div>

          <button
            type="button"
            disabled={downloadingZip}
            onClick={() => void handleDownloadRepoZip()}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-60 dark:bg-blue-600 dark:hover:bg-blue-700 whitespace-nowrap shrink-0"
          >
            <Archive className="h-4 w-4" />
            {downloadingZip ? 'Packaging ZIP...' : 'Download GitHub Repo (.zip)'}
          </button>
        </div>

        {zipError && (
          <p
            role="alert"
            className="mt-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{zipError}</span>
          </p>
        )}

        {zipSuccess && (
          <p className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>
              Verified PKZIP archive downloaded as <code>my-download-manager-repo.zip</code>.
            </span>
          </p>
        )}

        {/* Monorepo Tree */}
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-800 dark:bg-slate-950">
            <p className="font-mono font-semibold text-slate-900 dark:text-slate-100">shared/</p>
            <p className="mt-1 text-slate-600 dark:text-slate-400">
              URL inspector, DRM filter, segment planner, queue scheduler, HTTP error mapper, and unit tests.
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-800 dark:bg-slate-950">
            <p className="font-mono font-semibold text-slate-900 dark:text-slate-100">android/</p>
            <p className="mt-1 text-slate-600 dark:text-slate-400">
              Kotlin + Jetpack Compose + OkHttp multi-connection engine, Share Menu receiver, JUnit 4 tests.
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-800 dark:bg-slate-950">
            <p className="font-mono font-semibold text-slate-900 dark:text-slate-100">desktop/</p>
            <p className="mt-1 text-slate-600 dark:text-slate-400">
              Windows Electron app sharing <code className="font-mono">shared/</code>, clipboard link detection, NSIS &amp; portable EXE config.
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-800 dark:bg-slate-950">
            <p className="font-mono font-semibold text-slate-900 dark:text-slate-100">.github/workflows/</p>
            <p className="mt-1 text-slate-600 dark:text-slate-400">
              CI build for Android APK + Windows EXE, unit tests, SHA-256 checksums, and <code className="font-mono">v*</code> GitHub Releases.
            </p>
          </div>
        </div>
      </section>

      {/* Platform Build Guides */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-3 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Android APK Build &amp; Setup
            </h3>
          </div>
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            Supports Share Menu (<code className="font-mono">ACTION_SEND</code> /{' '}
            <code className="font-mono">ACTION_VIEW</code>) link capture, parallel OkHttp Byte-Range
            segments, pause/resume, and Storage Access Framework (SAF) folder selection.
          </p>
          <pre className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
{`cd android
gradle testDebugUnitTest
gradle assembleDebug assembleRelease`}
          </pre>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Requires JDK 17+ and Android SDK 35 (provided automatically by the GitHub Actions workflow).
          </p>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-3 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2">
            <Monitor className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Windows EXE Build &amp; Setup
            </h3>
          </div>
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            Electron + TypeScript app sharing <code className="font-mono">shared/downloadCore.ts</code>{' '}
            and <code className="font-mono">server/downloadManager.ts</code>, with Windows clipboard paste
            detection and NSIS installer + portable <code className="font-mono">.exe</code> targets.
          </p>
          <pre className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
{`cd desktop
npm install
npm run build
npm run dist:win`}
          </pre>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Produces installer and portable executables on Windows runners in GitHub Actions.
          </p>
        </section>
      </div>

      {/* Signing Secrets & Platform Limitations */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2">
          <Lock className="h-5 w-5 text-slate-700 dark:text-slate-300" />
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Release Signing Secrets &amp; Platform Limitations
          </h3>
        </div>
        <ul className="list-disc pl-5 space-y-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
          <li>
            <strong>No secrets in repository:</strong> Configure{' '}
            <code className="font-mono">ANDROID_KEYSTORE_BASE64</code>,{' '}
            <code className="font-mono">ANDROID_KEYSTORE_PASSWORD</code>,{' '}
            <code className="font-mono">ANDROID_KEY_ALIAS</code>,{' '}
            <code className="font-mono">ANDROID_KEY_PASSWORD</code>,{' '}
            <code className="font-mono">WINDOWS_CERT_BASE64</code>, and{' '}
            <code className="font-mono">WINDOWS_CERT_PASSWORD</code> in GitHub Actions Secrets (see{' '}
            <code className="font-mono">docs/SIGNING.md</code>).
          </li>
          <li>
            <strong>Automated Versioned Releases:</strong> Push a tag such as{' '}
            <code className="font-mono">git tag v1.0.0 &amp;&amp; git push origin v1.0.0</code> to publish
            signed/unsigned Android APK, Windows EXE installer + portable EXE, and{' '}
            <code className="font-mono">SHA256SUMS.txt</code>.
          </li>
          <li>
            <strong>Platform Boundaries:</strong> Only direct HTTP/HTTPS files and documented public APIs are
            supported. DRM streams, paywalled sites, and protected video platforms are explicitly refused;
            Android background downloads require notification permission on Android 13+; unsigned Windows
            builds trigger SmartScreen warnings until signed with an Authenticode certificate.
          </li>
        </ul>
      </section>
    </div>
  );
}
