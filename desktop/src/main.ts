import { app, BrowserWindow, clipboard, dialog, ipcMain, Notification } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {
  computeSegments,
  DEFAULT_SETTINGS,
  extractUrlsFromText,
  inspectDownloadUrl,
  mapHttpStatusError,
  selectJobsToStart,
  type DownloadSettings,
  type DownloadStatus,
  type SegmentPlan,
} from '../../shared/downloadCore';

interface DesktopJob {
  id: string;
  url: string;
  filename: string;
  destinationPath: string;
  partPath: string;
  status: DownloadStatus;
  totalBytes: number | null;
  downloadedBytes: number;
  resumable: boolean;
  connectionsUsed: number;
  segments: SegmentPlan[];
  error: string | null;
  createdAt: number;
}

let mainWindow: BrowserWindow | null = null;
const jobs = new Map<string, DesktopJob>();
const controllers = new Map<string, AbortController>();
let settings: DownloadSettings = {
  ...DEFAULT_SETTINGS,
  downloadFolder: path.join(app.getPath('downloads'), 'MyDownloadManager'),
};

function notify(title: string, body: string): void {
  if (settings.notificationsEnabled && Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
}

function broadcast(): void {
  mainWindow?.webContents.send('downloads:updated', {
    jobs: Array.from(jobs.values()).sort((a, b) => b.createdAt - a.createdAt),
    settings,
  });
}

function schedule(): void {
  const nextIds = selectJobsToStart(
    Array.from(jobs.values()).map((j) => ({ id: j.id, status: j.status, createdAt: j.createdAt })),
    settings.maxConcurrentDownloads,
  );
  for (const id of nextIds) {
    void runDownload(id);
  }
}

async function runDownload(id: string): Promise<void> {
  const job = jobs.get(id);
  if (!job || job.status !== 'queued') return;

  const ctrl = new AbortController();
  controllers.set(id, ctrl);
  job.status = 'probing';
  broadcast();

  try {
    if (!job.resumable || job.segments.length === 0 || !fs.existsSync(job.partPath)) {
      const head = await fetch(job.url, { method: 'HEAD', signal: ctrl.signal });
      if (!head.ok && head.status !== 206) {
        throw new Error(mapHttpStatusError(head.status));
      }
      const total = Number(head.headers.get('content-length') ?? '') || null;
      const acceptRanges =
        (head.headers.get('accept-ranges') ?? '').toLowerCase().includes('bytes') && total !== null;
      job.totalBytes = total;
      job.resumable = acceptRanges;
      job.segments = computeSegments(total, settings.connectionsPerDownload, acceptRanges);
      job.connectionsUsed = job.segments.length;
      fs.mkdirSync(path.dirname(job.partPath), { recursive: true });
      const fh = await fs.promises.open(job.partPath, 'w');
      try {
        if (total && total > 0) await fh.truncate(total);
      } finally {
        await fh.close();
      }
    }

    job.status = 'downloading';
    broadcast();

    const fh = await fs.promises.open(job.partPath, 'r+');
    try {
      await Promise.all(
        job.segments
          .filter((s) => !s.completed)
          .map(async (seg) => {
            const offset = seg.startByte + seg.downloadedBytes;
            const headers: Record<string, string> = {};
            if (job.resumable && seg.endByte !== null) {
              headers.Range = `bytes=${offset}-${seg.endByte}`;
            }
            const res = await fetch(job.url, { headers, signal: ctrl.signal });
            if (!res.ok && res.status !== 206) throw new Error(mapHttpStatusError(res.status));
            const reader = res.body?.getReader();
            if (!reader) return;
            let pos = offset;
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (!value) continue;
              await fh.write(value, 0, value.byteLength, pos);
              pos += value.byteLength;
              seg.downloadedBytes += value.byteLength;
              job.downloadedBytes = job.segments.reduce((a, s) => a + s.downloadedBytes, 0);
              broadcast();
            }
            seg.completed = true;
          }),
      );
    } finally {
      await fh.close();
    }

    if (fs.existsSync(job.destinationPath)) fs.unlinkSync(job.destinationPath);
    await fs.promises.rename(job.partPath, job.destinationPath);
    job.status = 'completed';
    notify('Download Complete', `${job.filename} saved locally.`);
  } catch (err) {
    if (ctrl.signal.aborted) return;
    job.status = 'error';
    job.error = err instanceof Error ? err.message : 'Download failed.';
  } finally {
    controllers.delete(id);
    broadcast();
    schedule();
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    title: 'My Download Manager',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, '../../../renderer/index.html'));
}

ipcMain.handle('downloads:inspect', (_e, url: string) => inspectDownloadUrl(url));
ipcMain.handle('downloads:read-clipboard', () => extractUrlsFromText(clipboard.readText()));
ipcMain.handle('downloads:pick-folder', async () => {
  if (!mainWindow) return settings.downloadFolder;
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (!res.canceled && res.filePaths[0]) {
    settings = { ...settings, downloadFolder: res.filePaths[0] };
    broadcast();
  }
  return settings.downloadFolder;
});

ipcMain.handle('downloads:add', (_e, payload: { url: string; confirmExecutable?: boolean }) => {
  const check = inspectDownloadUrl(payload.url);
  if (!check.valid || !check.supported) return { ok: false, error: check.reason };
  if (check.isExecutable && !payload.confirmExecutable) {
    return { ok: false, requiresExecutableConfirmation: true, url: check.normalizedUrl, filename: check.filename };
  }
  const dir = settings.organizeByCategory
    ? path.join(settings.downloadFolder, settings.categoryFolders[check.category])
    : settings.downloadFolder;
  const dest = path.join(dir, check.filename);
  const id = `win_${Date.now().toString(36)}`;
  jobs.set(id, {
    id,
    url: check.normalizedUrl,
    filename: check.filename,
    destinationPath: dest,
    partPath: `${dest}.part`,
    status: 'queued',
    totalBytes: null,
    downloadedBytes: 0,
    resumable: false,
    connectionsUsed: 1,
    segments: [],
    error: null,
    createdAt: Date.now(),
  });
  broadcast();
  schedule();
  return { ok: true };
});

ipcMain.handle('downloads:pause', (_e, id: string) => {
  controllers.get(id)?.abort();
  const job = jobs.get(id);
  if (job) job.status = 'paused';
  broadcast();
});

ipcMain.handle('downloads:resume', (_e, id: string) => {
  const job = jobs.get(id);
  if (job) {
    job.status = 'queued';
    job.error = null;
  }
  broadcast();
  schedule();
});

ipcMain.handle('downloads:remove', (_e, id: string) => {
  controllers.get(id)?.abort();
  jobs.delete(id);
  broadcast();
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
