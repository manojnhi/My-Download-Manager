import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, CheckCircle2, Search, ShieldCheck, Trash2, X } from 'lucide-react';
import type { DownloadJob } from '../server/downloadManager';
import {
  DEFAULT_SETTINGS,
  type DownloadSettings,
  type FileCategory,
} from '../shared/downloadCore';
import { AddUrlBar } from './components/AddUrlBar';
import { DownloadRow } from './components/DownloadRow';
import { GitHubRepoHub } from './components/GitHubRepoHub';
import { SettingsPanel } from './components/SettingsPanel';
import { type ManagerTab, TopNav } from './components/TopNav';

const CATEGORY_FILTER_OPTIONS: { id: 'all' | FileCategory; label: string }[] = [
  { id: 'all', label: 'All Types' },
  { id: 'video', label: 'Video' },
  { id: 'audio', label: 'Audio' },
  { id: 'image', label: 'Images' },
  { id: 'document', label: 'Documents' },
  { id: 'archive', label: 'Archives' },
  { id: 'installer', label: 'Installers' },
  { id: 'other', label: 'Other' },
];

interface ToastNotification {
  id: string;
  level: 'success' | 'error';
  title: string;
  body: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<ManagerTab>('queue');
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [settings, setSettings] = useState<DownloadSettings>(DEFAULT_SETTINGS);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | FileCategory>('all');
  const [toast, setToast] = useState<ToastNotification | null>(null);

  const fetchInitialState = useCallback(async () => {
    try {
      const res = await fetch('/api/downloads');
      if (!res.ok) return;
      const data = (await res.json()) as {
        jobs?: DownloadJob[];
        settings?: DownloadSettings;
      };
      if (Array.isArray(data.jobs)) setJobs(data.jobs);
      if (data.settings) setSettings(data.settings);
    } catch {
      // Initial poll failure will recover via WS or user action
    }
  }, []);

  useEffect(() => {
    void fetchInitialState();
  }, [fetchInitialState]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', Boolean(settings.darkMode));
  }, [settings.darkMode]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${window.location.host}/ws`);
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as {
            type?: string;
            jobs?: DownloadJob[];
            settings?: DownloadSettings;
            level?: 'success' | 'error';
            job?: DownloadJob;
          };
          if (msg.type === 'downloads:state') {
            if (Array.isArray(msg.jobs)) setJobs(msg.jobs);
            if (msg.settings) setSettings(msg.settings);
          } else if (msg.type === 'downloads:notify' && msg.job) {
            setSettings((latest) => {
              if (latest.notificationsEnabled) {
                const isSuccess = msg.level === 'success';
                const title = isSuccess
                  ? `Download complete: ${msg.job!.filename}`
                  : `Download failed: ${msg.job!.filename}`;
                const body = isSuccess
                  ? `Saved locally (${msg.job!.connectionsUsed} stream${msg.job!.connectionsUsed === 1 ? '' : 's'}).`
                  : msg.job!.error ?? 'Check URL and retry.';
                setToast({
                  id: `${msg.job!.id}-${Date.now()}`,
                  level: isSuccess ? 'success' : 'error',
                  title,
                  body,
                });
                if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
                  new Notification(title, { body });
                }
              }
              return latest;
            });
          }
        } catch {
          // Ignore malformed WS packet
        }
      };

      ws.onclose = () => {
        if (!disposed) {
          reconnectTimer = setTimeout(connect, 1500);
        }
      };
    };

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);

  const handleSubmitUrl = async (url: string, confirmExecutable = false) => {
    const res = await fetch('/api/downloads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, confirmExecutable }),
    });
    const data = (await res.json()) as {
      ok: boolean;
      error?: string;
      requiresExecutableConfirmation?: boolean;
    };
    await fetchInitialState();
    return data;
  };

  const handleAction = async (id: string, action: 'pause' | 'resume' | 'retry' | 'cancel') => {
    await fetch(`/api/downloads/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
    await fetchInitialState();
  };

  const handleRemove = async (id: string) => {
    await fetch(`/api/downloads/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await fetchInitialState();
  };

  const handleClearHistory = async () => {
    await fetch('/api/downloads/clear-history', { method: 'POST' });
    await fetchInitialState();
  };

  const handleSaveSettings = async (patch: Partial<DownloadSettings>) => {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const data = (await res.json()) as { settings?: DownloadSettings };
      if (data.settings) setSettings(data.settings);
    }
  };

  const handleToggleDarkMode = () => {
    void handleSaveSettings({ darkMode: !settings.darkMode });
  };

  const activeJobs = useMemo(
    () =>
      jobs.filter(
        (j) =>
          j.status === 'downloading' ||
          j.status === 'probing' ||
          j.status === 'queued' ||
          j.status === 'paused' ||
          j.status === 'error',
      ),
    [jobs],
  );

  const historyJobs = useMemo(
    () => jobs.filter((j) => j.status === 'completed' || j.status === 'canceled'),
    [jobs],
  );

  const filterList = useCallback(
    (list: DownloadJob[]) => {
      const q = searchQuery.trim().toLowerCase();
      return list.filter((job) => {
        if (categoryFilter !== 'all' && job.category !== categoryFilter) return false;
        if (!q) return true;
        return (
          job.filename.toLowerCase().includes(q) ||
          job.url.toLowerCase().includes(q) ||
          (job.error?.toLowerCase().includes(q) ?? false)
        );
      });
    },
    [categoryFilter, searchQuery],
  );

  const visibleActiveJobs = useMemo(() => filterList(activeJobs), [activeJobs, filterList]);
  const visibleHistoryJobs = useMemo(() => filterList(historyJobs), [historyJobs, filterList]);

  const runningCount = jobs.filter(
    (j) => j.status === 'downloading' || j.status === 'probing',
  ).length;
  const queuedCount = jobs.filter((j) => j.status === 'queued').length;
  const completedCount = jobs.filter((j) => j.status === 'completed').length;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 flex flex-col">
      <TopNav
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        darkMode={settings.darkMode}
        onToggleDarkMode={handleToggleDarkMode}
      />

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 space-y-6 sm:px-6">
        {/* Dismissible notification toast */}
        {toast && (
          <div
            role="status"
            className={`flex items-start justify-between gap-4 rounded-xl border px-4 py-3 text-xs ${
              toast.level === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/60 dark:text-emerald-200'
                : 'border-red-200 bg-red-50 text-red-900 dark:border-red-900/60 dark:bg-red-950/60 dark:text-red-200'
            }`}
          >
            <div className="flex items-start gap-2.5">
              {toast.level === 'success' ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <Bell className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <div>
                <p className="font-semibold">{toast.title}</p>
                <p className="mt-0.5 opacity-90">{toast.body}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setToast(null)}
              aria-label="Dismiss notification"
              className="rounded p-1 hover:bg-black/5 dark:hover:bg-white/10"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {(activeTab === 'queue' || activeTab === 'history') && (
          <>
            <AddUrlBar onSubmitUrl={handleSubmitUrl} />

            {/* Compact Queue & Filter Bar */}
            <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300 tabular-nums">
                <span>
                  <strong className="text-slate-900 dark:text-slate-100">{runningCount}</strong> active
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  <strong className="text-slate-900 dark:text-slate-100">{queuedCount}</strong> queued
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  <strong className="text-slate-900 dark:text-slate-100">{completedCount}</strong>{' '}
                  completed
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  Speed cap:{' '}
                  <strong className="text-slate-900 dark:text-slate-100">
                    {settings.speedLimitKBps > 0 ? `${settings.speedLimitKBps} KB/s` : 'Unlimited'}
                  </strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  Connections:{' '}
                  <strong className="text-slate-900 dark:text-slate-100">
                    {settings.connectionsPerDownload}
                  </strong>
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 sm:w-56 sm:flex-initial">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <label htmlFor="filter-search" className="sr-only">
                    Filter downloads
                  </label>
                  <input
                    id="filter-search"
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filter by filename or URL..."
                    className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>

                <label htmlFor="filter-category" className="sr-only">
                  Filter by file type
                </label>
                <select
                  id="filter-category"
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value as 'all' | FileCategory)}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  {CATEGORY_FILTER_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </>
        )}

        {activeTab === 'queue' && (
          <section aria-label="Active downloads and queue" className="space-y-3">
            {visibleActiveJobs.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center dark:border-slate-700 dark:bg-slate-900">
                <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                  No active or queued downloads
                </p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Paste a direct HTTP/HTTPS URL above or click any Local Test Server sample to verify
                  multi-connection resuming.
                </p>
              </div>
            ) : (
              visibleActiveJobs.map((job) => (
                <DownloadRow
                  key={job.id}
                  job={job}
                  onPause={(id) => void handleAction(id, 'pause')}
                  onResume={(id) => void handleAction(id, 'resume')}
                  onRetry={(id) => void handleAction(id, 'retry')}
                  onCancel={(id) => void handleAction(id, 'cancel')}
                  onRemove={(id) => void handleRemove(id)}
                />
              ))
            )}
          </section>
        )}

        {activeTab === 'history' && (
          <section aria-label="Download history" className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Completed &amp; Canceled History ({visibleHistoryJobs.length})
              </h2>
              {historyJobs.length > 0 && (
                <button
                  type="button"
                  onClick={() => void handleClearHistory()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Clear History
                </button>
              )}
            </div>

            {visibleHistoryJobs.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center dark:border-slate-700 dark:bg-slate-900">
                <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                  Download history is empty
                </p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Completed downloads appear here with their verified SHA-256 checksums.
                </p>
              </div>
            ) : (
              visibleHistoryJobs.map((job) => (
                <DownloadRow
                  key={job.id}
                  job={job}
                  onPause={(id) => void handleAction(id, 'pause')}
                  onResume={(id) => void handleAction(id, 'resume')}
                  onRetry={(id) => void handleAction(id, 'retry')}
                  onCancel={(id) => void handleAction(id, 'cancel')}
                  onRemove={(id) => void handleRemove(id)}
                />
              ))
            )}
          </section>
        )}

        {activeTab === 'settings' && (
          <SettingsPanel settings={settings} onSaveSettings={handleSaveSettings} />
        )}

        {activeTab === 'github' && <GitHubRepoHub />}
      </main>

      <footer className="border-t border-slate-200 bg-white px-4 py-4 dark:border-slate-800 dark:bg-slate-900 sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 text-xs text-slate-500 dark:text-slate-400 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>
              Local-only storage. Download only authorized direct URLs and documented public APIs;
              use official platform apps for protected streaming services.
            </span>
          </div>
          <span className="font-mono text-[11px] shrink-0">Folder: {settings.downloadFolder}</span>
        </div>
      </footer>
    </div>
  );
}
