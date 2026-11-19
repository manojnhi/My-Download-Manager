import { useState } from 'react';
import { AlertTriangle, ClipboardPaste, Plus, ShieldAlert } from 'lucide-react';
import { extractUrlsFromText, inspectDownloadUrl } from '../../shared/downloadCore';

interface AddUrlBarProps {
  onSubmitUrl: (url: string, confirmExecutable?: boolean) => Promise<{
    ok: boolean;
    error?: string;
    requiresExecutableConfirmation?: boolean;
  }>;
}

export function AddUrlBar({ onSubmitUrl }: AddUrlBarProps) {
  const [urlInput, setUrlInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [detectedPastedUrl, setDetectedPastedUrl] = useState<string | null>(null);
  const [executablePrompt, setExecutablePrompt] = useState<{
    url: string;
    message: string;
  } | null>(null);

  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';

  const submitUrl = async (
    targetUrl: string,
    confirmExecutable = false,
    clearInputOnSuccess = false,
  ) => {
    const clean = targetUrl.trim();
    if (!clean) {
      setInlineError('Enter a direct HTTP or HTTPS file URL.');
      return;
    }

    const inspection = inspectDownloadUrl(clean);
    if (!inspection.valid || !inspection.supported) {
      setInlineError(inspection.reason ?? 'Enter a valid, supported direct file URL.');
      return;
    }

    if (inspection.isExecutable && !confirmExecutable) {
      setInlineError(null);
      setExecutablePrompt({
        url: inspection.normalizedUrl,
        message:
          'Warning: You are about to download an executable or installer file. Confirm you trust the source URL below; files are never executed automatically.',
      });
      return;
    }

    setSubmitting(true);
    setInlineError(null);
    try {
      const res = await onSubmitUrl(inspection.normalizedUrl, confirmExecutable);
      if (!res.ok) {
        if (res.requiresExecutableConfirmation) {
          setExecutablePrompt({
            url: inspection.normalizedUrl,
            message:
              res.error ??
              'This link points to an executable/installer file. Verify the source URL before downloading.',
          });
          return;
        }
        setInlineError(res.error ?? 'Unable to add download.');
        return;
      }
      if (clearInputOnSuccess) {
        setUrlInput('');
        setDetectedPastedUrl(null);
      }
      setExecutablePrompt(null);
    } finally {
      setSubmitting(false);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text');
    const urls = extractUrlsFromText(pasted);
    if (urls.length > 0 && urls[0] !== pasted.trim()) {
      e.preventDefault();
      setUrlInput(urls[0]);
      setDetectedPastedUrl(urls[0]);
      setInlineError(null);
    }
  };

  const handleReadClipboard = async () => {
    setInlineError(null);
    try {
      const text = await navigator.clipboard.readText();
      const urls = extractUrlsFromText(text);
      if (urls.length === 0) {
        setInlineError('No HTTP or HTTPS link found on clipboard.');
        return;
      }
      setUrlInput(urls[0]);
      setDetectedPastedUrl(urls[0]);
    } catch {
      setInlineError('Clipboard permission blocked by browser. Paste directly into the URL box.');
    }
  };

  const quickSamples = [
    {
      label: '4 MB Resumable Video',
      url: `${origin}/api/test-server/files/sample-video-4mb.mp4`,
    },
    {
      label: '2 MB Archive (.zip)',
      url: `${origin}/api/test-server/files/sample-archive-2mb.zip`,
    },
    {
      label: '1 MB Non-Range PDF',
      url: `${origin}/api/test-server/files/no-range-doc.pdf`,
    },
    {
      label: 'Executable Warning (.exe)',
      url: `${origin}/api/test-server/files/demo-installer.exe`,
    },
    {
      label: 'Expired Link (410)',
      url: `${origin}/api/test-server/files/expired-link.zip`,
    },
    {
      label: 'Auth Required (401)',
      url: `${origin}/api/test-server/files/protected-report.pdf`,
    },
  ];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submitUrl(urlInput, false, true);
        }}
        className="flex flex-col gap-3 sm:flex-row"
      >
        <div className="flex-1">
          <label htmlFor="download-url-input" className="sr-only">
            Direct file URL
          </label>
          <input
            id="download-url-input"
            type="text"
            value={urlInput}
            onPaste={handlePaste}
            onChange={(e) => {
              setUrlInput(e.target.value);
              setInlineError(null);
            }}
            placeholder="Paste a direct HTTP/HTTPS file link (video, audio, image, document, archive, installer)..."
            className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void handleReadClipboard()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 whitespace-nowrap"
          >
            <ClipboardPaste className="h-4 w-4" />
            Paste Link
          </button>

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            {submitting ? 'Adding...' : 'Add Download'}
          </button>
        </div>
      </form>

      {detectedPastedUrl && (
        <p className="mt-2 text-xs text-blue-700 dark:text-blue-400">
          Detected pasted link: <span className="font-mono">{detectedPastedUrl}</span>
        </p>
      )}

      {inlineError && (
        <p
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{inlineError}</span>
        </p>
      )}

      {/* Quick Test Server Links */}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Local Test Server:
        </span>
        {quickSamples.map((sample) => (
          <button
            key={sample.label}
            type="button"
            onClick={() => void submitUrl(sample.url, false)}
            className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap"
          >
            {sample.label}
          </button>
        ))}
      </div>

      {/* Executable Confirmation Modal */}
      {executablePrompt && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="exe-warning-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
        >
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 space-y-4 shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 h-6 w-6 text-amber-600 dark:text-amber-400 shrink-0" />
              <div>
                <h2 id="exe-warning-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Executable File Security Warning
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                  {executablePrompt.message} Downloaded installers are stored locally and never run
                  automatically.
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950">
              <span className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                Verified Source URL
              </span>
              <code className="block break-all font-mono text-xs text-slate-800 dark:text-slate-200">
                {executablePrompt.url}
              </code>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setExecutablePrompt(null)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() =>
                  void submitUrl(executablePrompt.url, true, executablePrompt.url === urlInput.trim())
                }
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Confirm &amp; Download File
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
