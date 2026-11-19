import { useEffect, useState } from 'react';
import { Check, RotateCcw, Save } from 'lucide-react';
import {
  DEFAULT_CATEGORY_FOLDERS,
  DEFAULT_SETTINGS,
  type DownloadSettings,
  type FileCategory,
} from '../../shared/downloadCore';

interface SettingsPanelProps {
  settings: DownloadSettings;
  onSaveSettings: (patch: Partial<DownloadSettings>) => Promise<void>;
}

const CATEGORY_LABELS: Record<FileCategory, string> = {
  video: 'Videos',
  audio: 'Audio',
  image: 'Images',
  document: 'Documents',
  archive: 'Archives',
  installer: 'Installers & Executables',
  other: 'Other Files',
};

export function SettingsPanel({ settings, onSaveSettings }: SettingsPanelProps) {
  const [form, setForm] = useState<DownloadSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    setForm(settings);
  }, [settings]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedNotice(false);
    try {
      await onSaveSettings(form);
      setSavedNotice(true);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    setSavedNotice(false);
    try {
      const defaults: DownloadSettings = {
        ...DEFAULT_SETTINGS,
        categoryFolders: { ...DEFAULT_CATEGORY_FOLDERS },
      };
      setForm(defaults);
      await onSaveSettings(defaults);
      setSavedNotice(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Engine &amp; Queue Limits
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Configure download destination, parallel byte-range connections, and global speed caps.
            </p>
          </div>
          {savedNotice && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
              <Check className="h-3.5 w-3.5" />
              Settings saved
            </span>
          )}
        </div>

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label
              htmlFor="setting-folder"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            >
              Download Folder
            </label>
            <input
              id="setting-folder"
              type="text"
              value={form.downloadFolder}
              onChange={(e) => setForm({ ...form, downloadFolder: e.target.value })}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              Files and download state stay local on disk. Nothing is uploaded externally.
            </p>
          </div>

          <div>
            <label
              htmlFor="setting-max-concurrent"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            >
              Max Simultaneous Downloads (1–8)
            </label>
            <input
              id="setting-max-concurrent"
              type="number"
              min={1}
              max={8}
              value={form.maxConcurrentDownloads}
              onChange={(e) =>
                setForm({
                  ...form,
                  maxConcurrentDownloads: Math.max(1, Math.min(8, Number(e.target.value) || 1)),
                })
              }
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 tabular-nums focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>

          <div>
            <label
              htmlFor="setting-connections"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            >
              Parallel Connections per File (1–16)
            </label>
            <input
              id="setting-connections"
              type="number"
              min={1}
              max={16}
              value={form.connectionsPerDownload}
              onChange={(e) =>
                setForm({
                  ...form,
                  connectionsPerDownload: Math.max(1, Math.min(16, Number(e.target.value) || 1)),
                })
              }
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 tabular-nums focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              Automatically falls back to 1 stream if the server does not support HTTP Range requests.
            </p>
          </div>

          <div>
            <label
              htmlFor="setting-speed-limit"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            >
              Bandwidth Limit (KB/s, 0 = Unlimited)
            </label>
            <input
              id="setting-speed-limit"
              type="number"
              min={0}
              max={500000}
              step={50}
              value={form.speedLimitKBps}
              onChange={(e) =>
                setForm({
                  ...form,
                  speedLimitKBps: Math.max(0, Number(e.target.value) || 0),
                })
              }
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 tabular-nums focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>

          <div className="flex flex-col justify-center gap-3 pt-1">
            <label className="inline-flex items-center gap-2.5 text-sm text-slate-800 dark:text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={form.organizeByCategory}
                onChange={(e) => setForm({ ...form, organizeByCategory: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
              />
              <span>Organize completed files into category folders</span>
            </label>

            <label className="inline-flex items-center gap-2.5 text-sm text-slate-800 dark:text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={form.notificationsEnabled}
                onChange={(e) => setForm({ ...form, notificationsEnabled: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
              />
              <span>Show completion and error notifications</span>
            </label>
          </div>
        </div>
      </div>

      {/* Category Subfolders */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          File-Type Subfolders
        </h2>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          Used when automatic folder organization is enabled.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(Object.keys(CATEGORY_LABELS) as FileCategory[]).map((category) => (
            <div key={category}>
              <label
                htmlFor={`cat-folder-${category}`}
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                {CATEGORY_LABELS[category]}
              </label>
              <input
                id={`cat-folder-${category}`}
                type="text"
                disabled={!form.organizeByCategory}
                value={form.categoryFolders[category] ?? DEFAULT_CATEGORY_FOLDERS[category]}
                onChange={(e) =>
                  setForm({
                    ...form,
                    categoryFolders: {
                      ...form.categoryFolders,
                      [category]: e.target.value,
                    },
                  })
                }
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 disabled:opacity-50 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleReset()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset Defaults
          </button>

          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </form>
  );
}
