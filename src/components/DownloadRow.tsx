import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import type { DownloadJob } from '../../server/downloadManager';
import { formatBytes, formatEta, formatSpeed } from '../../shared/downloadCore';

interface DownloadRowProps {
  job: DownloadJob;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onRetry: (id: string) => void;
  onCancel: (id: string) => void;
  onRemove: (id: string) => void;
}

function getStatusLabel(status: DownloadJob['status']): { text: string; className: string } {
  switch (status) {
    case 'downloading':
      return { text: 'Downloading', className: 'text-blue-700 dark:text-blue-400' };
    case 'probing':
      return { text: 'Connecting', className: 'text-blue-700 dark:text-blue-400' };
    case 'paused':
      return { text: 'Paused', className: 'text-amber-700 dark:text-amber-400' };
    case 'completed':
      return { text: 'Completed', className: 'text-emerald-700 dark:text-emerald-400' };
    case 'error':
      return { text: 'Failed', className: 'text-red-700 dark:text-red-400' };
    case 'canceled':
      return { text: 'Canceled', className: 'text-slate-500 dark:text-slate-400' };
    default:
      return { text: 'Queued', className: 'text-slate-600 dark:text-slate-300' };
  }
}

export function DownloadRow({
  job,
  onPause,
  onResume,
  onRetry,
  onCancel,
  onRemove,
}: DownloadRowProps) {
  const percent =
    job.totalBytes && job.totalBytes > 0
      ? Math.min(100, Math.round((job.downloadedBytes / job.totalBytes) * 100))
      : job.status === 'completed'
        ? 100
        : 0;

  const statusMeta = getStatusLabel(job.status);

  return (
    <article
      data-testid={`download-row-${job.id}`}
      className="rounded-xl border border-slate-200 bg-white p-4 transition-colors dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate max-w-md">
              {job.filename}
            </h3>
            <span className="text-xs text-slate-500 dark:text-slate-400 capitalize">
              {job.category}
            </span>
          </div>

          <p className="truncate font-mono text-xs text-slate-500 dark:text-slate-400">
            {job.url}
          </p>

          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 pt-0.5 text-xs text-slate-600 dark:text-slate-300 tabular-nums">
            <span className={`font-semibold ${statusMeta.className}`}>{statusMeta.text}</span>
            <span aria-hidden="true">·</span>
            <span>
              {formatBytes(job.downloadedBytes)}
              {job.totalBytes ? ` / ${formatBytes(job.totalBytes)}` : ''} ({percent}%)
            </span>
            <span aria-hidden="true">·</span>
            <span>{job.connectionsUsed} {job.connectionsUsed === 1 ? 'connection' : 'connections'}</span>
            {(job.status === 'downloading' || job.speedBytesPerSec > 0) && (
              <>
                <span aria-hidden="true">·</span>
                <span>{formatSpeed(job.speedBytesPerSec)}</span>
                <span aria-hidden="true">·</span>
                <span>ETA {formatEta(job.etaSeconds)}</span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span>{job.resumable ? 'Resumable' : 'Single stream'}</span>
          </div>
        </div>

        {/* Accessible action buttons */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {(job.status === 'downloading' || job.status === 'probing' || job.status === 'queued') && (
            <button
              type="button"
              onClick={() => onPause(job.id)}
              aria-label={`Pause ${job.filename}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 whitespace-nowrap"
            >
              <Pause className="h-3.5 w-3.5" />
              Pause
            </button>
          )}

          {job.status === 'paused' && (
            <button
              type="button"
              onClick={() => onResume(job.id)}
              aria-label={`Resume ${job.filename}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 whitespace-nowrap"
            >
              <Play className="h-3.5 w-3.5" />
              Resume
            </button>
          )}

          {job.status === 'error' && (
            <button
              type="button"
              onClick={() => onRetry(job.id)}
              aria-label={`Retry ${job.filename}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 whitespace-nowrap"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Retry
            </button>
          )}

          {job.status !== 'completed' && job.status !== 'canceled' && (
            <button
              type="button"
              onClick={() => onCancel(job.id)}
              aria-label={`Cancel ${job.filename}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap"
            >
              <X className="h-3.5 w-3.5" />
              Cancel
            </button>
          )}

          {job.status === 'completed' && (
            <a
              href={`/api/downloads/${encodeURIComponent(job.id)}/file`}
              download={job.filename}
              aria-label={`Save local copy of ${job.filename}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-700 whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" />
              Save File
            </a>
          )}

          <button
            type="button"
            onClick={() => onRemove(job.id)}
            aria-label={`Remove ${job.filename}`}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-red-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:text-red-400 whitespace-nowrap"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove
          </button>
        </div>
      </div>

      {/* Multi-segment progress track */}
      {job.status !== 'canceled' && (
        <div className="mt-3 space-y-1.5">
          {job.segments.length > 1 ? (
            <div
              className="grid gap-1"
              style={{ gridTemplateColumns: `repeat(${job.segments.length}, minmax(0, 1fr))` }}
            >
              {job.segments.map((seg) => {
                const segTotal =
                  seg.endByte !== null ? seg.endByte - seg.startByte + 1 : job.totalBytes ?? 1;
                const segPct = Math.min(100, Math.round((seg.downloadedBytes / Math.max(1, segTotal)) * 100));
                return (
                  <div
                    key={seg.index}
                    className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
                    title={`Connection ${seg.index + 1}: ${segPct}%`}
                  >
                    <div
                      className={`h-full transition-all duration-150 ${
                        job.status === 'completed'
                          ? 'bg-emerald-600'
                          : job.status === 'error'
                            ? 'bg-red-600'
                            : job.status === 'paused'
                              ? 'bg-amber-500'
                              : 'bg-blue-600'
                      }`}
                      style={{ width: `${segPct}%` }}
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                className={`h-full transition-all duration-150 ${
                  job.status === 'completed'
                    ? 'bg-emerald-600'
                    : job.status === 'error'
                      ? 'bg-red-600'
                      : job.status === 'paused'
                        ? 'bg-amber-500'
                        : 'bg-blue-600'
                }`}
                style={{ width: `${percent}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* Explicit error, warning, or completed SHA-256 verification line */}
      {job.error && (
        <p
          role="alert"
          className="mt-2.5 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{job.error}</span>
        </p>
      )}

      {!job.error && job.warning && (
        <p className="mt-2.5 flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{job.warning}</span>
        </p>
      )}

      {job.status === 'completed' && job.sha256 && (
        <p className="mt-2.5 flex items-center gap-1.5 font-mono text-[11px] text-slate-500 dark:text-slate-400 truncate">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>SHA-256: {job.sha256}</span>
        </p>
      )}
    </article>
  );
}
