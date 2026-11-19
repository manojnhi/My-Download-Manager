import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import {
  computeSegments,
  DEFAULT_SETTINGS,
  inspectDownloadUrl,
  mapHttpStatusError,
  selectJobsToStart,
  type DownloadSettings,
  type DownloadStatus,
  type FileCategory,
  type SegmentPlan,
} from '../shared/downloadCore.ts';

export interface DownloadJob {
  id: string;
  url: string;
  filename: string;
  category: FileCategory;
  isExecutable: boolean;
  isHttps: boolean;
  destinationPath: string;
  partPath: string;
  status: DownloadStatus;
  totalBytes: number | null;
  downloadedBytes: number;
  speedBytesPerSec: number;
  etaSeconds: number | null;
  resumable: boolean;
  connectionsUsed: number;
  segments: SegmentPlan[];
  sha256: string | null;
  error: string | null;
  warning: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export interface AddDownloadInput {
  url: string;
  confirmExecutable?: boolean;
  customFilename?: string;
}

export class DownloadManager extends EventEmitter {
  private settings: DownloadSettings;
  private jobs = new Map<string, DownloadJob>();
  private controllers = new Map<string, AbortController>();
  private storageFile: string;
  private speedSamples = new Map<string, { lastBytes: number; lastTime: number }>();

  constructor(initialSettings?: Partial<DownloadSettings>) {
    super();
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...initialSettings,
      categoryFolders: {
        ...DEFAULT_SETTINGS.categoryFolders,
        ...(initialSettings?.categoryFolders ?? {}),
      },
    };
    this.ensureDir(this.settings.downloadFolder);
    this.storageFile = path.resolve(this.settings.downloadFolder, '.my-download-manager-state.json');
    this.loadPersistedState();
  }

  getSettings(): DownloadSettings {
    return {
      ...this.settings,
      categoryFolders: { ...this.settings.categoryFolders },
    };
  }

  updateSettings(patch: Partial<DownloadSettings>): DownloadSettings {
    this.settings = {
      ...this.settings,
      ...patch,
      maxConcurrentDownloads: Math.max(
        1,
        Math.min(8, Math.floor(patch.maxConcurrentDownloads ?? this.settings.maxConcurrentDownloads)),
      ),
      connectionsPerDownload: Math.max(
        1,
        Math.min(16, Math.floor(patch.connectionsPerDownload ?? this.settings.connectionsPerDownload)),
      ),
      speedLimitKBps: Math.max(0, Math.floor(patch.speedLimitKBps ?? this.settings.speedLimitKBps)),
      categoryFolders: {
        ...this.settings.categoryFolders,
        ...(patch.categoryFolders ?? {}),
      },
    };
    this.ensureDir(this.settings.downloadFolder);
    this.persistState();
    this.emitSnapshot();
    this.scheduleQueue();
    return this.getSettings();
  }

  listJobs(): DownloadJob[] {
    return Array.from(this.jobs.values())
      .map((job) => ({
        ...job,
        segments: job.segments.map((s) => ({ ...s })),
      }))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  getJob(id: string): DownloadJob | null {
    const job = this.jobs.get(id);
    if (!job) return null;
    return { ...job, segments: job.segments.map((s) => ({ ...s })) };
  }

  addDownload(
    input: AddDownloadInput,
  ): { ok: true; job: DownloadJob } | { ok: false; code: string; error: string; requiresExecutableConfirmation?: boolean } {
    const inspection = inspectDownloadUrl(input.url);
    if (!inspection.valid || !inspection.supported) {
      return {
        ok: false,
        code: 'UNSUPPORTED_URL',
        error: inspection.reason ?? 'Unsupported URL.',
      };
    }

    if (inspection.isExecutable && !input.confirmExecutable) {
      return {
        ok: false,
        code: 'EXECUTABLE_WARNING',
        requiresExecutableConfirmation: true,
        error: `Executable file detected (${inspection.filename}). Confirm the source URL before downloading.`,
      };
    }

    const filename = input.customFilename?.trim() || inspection.filename;
    const subFolder = this.settings.organizeByCategory
      ? this.settings.categoryFolders[inspection.category] || 'General'
      : '';
    const targetDir = subFolder
      ? path.resolve(this.settings.downloadFolder, subFolder)
      : path.resolve(this.settings.downloadFolder);
    this.ensureDir(targetDir);

    const uniqueName = this.resolveUniqueFilename(targetDir, filename);
    const destinationPath = path.join(targetDir, uniqueName);
    const partPath = `${destinationPath}.part`;

    const id = `dl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const job: DownloadJob = {
      id,
      url: inspection.normalizedUrl,
      filename: uniqueName,
      category: inspection.category,
      isExecutable: inspection.isExecutable,
      isHttps: inspection.isHttps,
      destinationPath,
      partPath,
      status: 'queued',
      totalBytes: null,
      downloadedBytes: 0,
      speedBytesPerSec: 0,
      etaSeconds: null,
      resumable: false,
      connectionsUsed: 1,
      segments: [],
      sha256: null,
      error: null,
      warning: !inspection.isHttps
        ? 'Unencrypted HTTP connection — source server does not use HTTPS.'
        : null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      completedAt: null,
    };

    this.jobs.set(id, job);
    this.persistState();
    this.emitSnapshot();
    this.scheduleQueue();

    return { ok: true, job: this.getJob(id)! };
  }

  pauseJob(id: string): DownloadJob | null {
    const job = this.jobs.get(id);
    if (!job) return null;
    if (job.status !== 'downloading' && job.status !== 'probing' && job.status !== 'queued') {
      return this.getJob(id);
    }

    this.controllers.get(id)?.abort();
    this.controllers.delete(id);
    job.status = 'paused';
    job.speedBytesPerSec = 0;
    job.etaSeconds = null;
    if (!job.resumable && job.downloadedBytes > 0) {
      job.warning =
        'Server does not support HTTP range requests; resuming will restart from the beginning.';
    }
    job.updatedAt = Date.now();
    this.persistState();
    this.emitSnapshot();
    this.scheduleQueue();
    return this.getJob(id);
  }

  resumeJob(id: string): DownloadJob | null {
    const job = this.jobs.get(id);
    if (!job) return null;
    if (job.status !== 'paused' && job.status !== 'error') {
      return this.getJob(id);
    }

    if (!job.resumable) {
      job.downloadedBytes = 0;
      job.segments = [];
      if (fs.existsSync(job.partPath)) {
        fs.unlinkSync(job.partPath);
      }
    }

    job.error = null;
    job.status = 'queued';
    job.updatedAt = Date.now();
    this.persistState();
    this.emitSnapshot();
    this.scheduleQueue();
    return this.getJob(id);
  }

  retryJob(id: string): DownloadJob | null {
    const job = this.jobs.get(id);
    if (!job) return null;
    this.controllers.get(id)?.abort();
    this.controllers.delete(id);
    job.error = null;
    job.status = 'queued';
    if (!job.resumable || job.segments.length === 0) {
      job.downloadedBytes = 0;
      job.segments = [];
      if (fs.existsSync(job.partPath)) {
        fs.unlinkSync(job.partPath);
      }
    }
    job.updatedAt = Date.now();
    this.persistState();
    this.emitSnapshot();
    this.scheduleQueue();
    return this.getJob(id);
  }

  cancelJob(id: string): DownloadJob | null {
    const job = this.jobs.get(id);
    if (!job) return null;
    this.controllers.get(id)?.abort();
    this.controllers.delete(id);
    if (fs.existsSync(job.partPath)) {
      try {
        fs.unlinkSync(job.partPath);
      } catch {
        // Ignore cleanup errors
      }
    }
    job.status = 'canceled';
    job.speedBytesPerSec = 0;
    job.etaSeconds = null;
    job.updatedAt = Date.now();
    this.persistState();
    this.emitSnapshot();
    this.scheduleQueue();
    return this.getJob(id);
  }

  removeJob(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;
    this.controllers.get(id)?.abort();
    this.controllers.delete(id);
    if (job.status !== 'completed' && fs.existsSync(job.partPath)) {
      try {
        fs.unlinkSync(job.partPath);
      } catch {
        // Ignore cleanup errors
      }
    }
    this.jobs.delete(id);
    this.persistState();
    this.emitSnapshot();
    this.scheduleQueue();
    return true;
  }

  clearHistory(): void {
    for (const [id, job] of this.jobs.entries()) {
      if (job.status === 'completed' || job.status === 'canceled') {
        this.jobs.delete(id);
      }
    }
    this.persistState();
    this.emitSnapshot();
  }

  shutdown(): void {
    for (const ctrl of this.controllers.values()) {
      ctrl.abort();
    }
    this.controllers.clear();
  }

  private scheduleQueue(): void {
    const toStart = selectJobsToStart(
      Array.from(this.jobs.values()).map((j) => ({
        id: j.id,
        status: j.status,
        createdAt: j.createdAt,
      })),
      this.settings.maxConcurrentDownloads,
    );
    for (const jobId of toStart) {
      void this.runJob(jobId);
    }
  }

  private async runJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'queued') return;

    const controller = new AbortController();
    this.controllers.set(jobId, controller);
    job.status = 'probing';
    job.error = null;
    job.updatedAt = Date.now();
    this.emitSnapshot();

    try {
      const canResumeExisting =
        job.resumable &&
        job.segments.length > 0 &&
        job.totalBytes !== null &&
        fs.existsSync(job.partPath);

      if (!canResumeExisting) {
        const probe = await this.probeSource(job.url, controller.signal);
        if (controller.signal.aborted) return;

        job.totalBytes = probe.totalBytes;
        job.resumable = probe.acceptRanges;
        if (!probe.acceptRanges) {
          job.warning =
            (job.warning ? `${job.warning} ` : '') +
            'Server does not advertise byte-range support; using single-stream download.';
        }

        const segments = computeSegments(
          probe.totalBytes,
          this.settings.connectionsPerDownload,
          probe.acceptRanges,
        );
        job.segments = segments;
        job.connectionsUsed = segments.length;
        job.downloadedBytes = 0;

        this.ensureDir(path.dirname(job.partPath));
        const fh = await fs.promises.open(job.partPath, 'w');
        try {
          if (probe.totalBytes !== null && probe.totalBytes > 0) {
            await fh.truncate(probe.totalBytes);
          }
        } finally {
          await fh.close();
        }
      }

      if (controller.signal.aborted) return;

      job.status = 'downloading';
      job.updatedAt = Date.now();
      this.speedSamples.set(jobId, { lastBytes: job.downloadedBytes, lastTime: Date.now() });
      this.emitSnapshot();

      const progressTimer = setInterval(() => {
        this.updateJobSpeed(job);
        this.emitSnapshot();
      }, 250);

      try {
        await this.executeSegments(job, controller.signal);
      } finally {
        clearInterval(progressTimer);
      }

      if (controller.signal.aborted) return;

      // Finalize .part -> final destination and compute SHA-256 locally
      if (fs.existsSync(job.destinationPath)) {
        fs.unlinkSync(job.destinationPath);
      }
      await fs.promises.rename(job.partPath, job.destinationPath);
      job.sha256 = await this.computeSha256(job.destinationPath);
      job.status = 'completed';
      job.speedBytesPerSec = 0;
      job.etaSeconds = 0;
      job.completedAt = Date.now();
      job.updatedAt = Date.now();
      this.persistState();
      this.emit('job:completed', this.getJob(job.id));
    } catch (err) {
      if (controller.signal.aborted || (job.status as DownloadStatus) === 'paused' || (job.status as DownloadStatus) === 'canceled') {
        return;
      }
      job.status = 'error';
      job.speedBytesPerSec = 0;
      job.etaSeconds = null;
      job.error = err instanceof Error ? err.message : 'Download interrupted unexpectedly.';
      job.updatedAt = Date.now();
      this.persistState();
      this.emit('job:error', this.getJob(job.id));
    } finally {
      this.controllers.delete(jobId);
      this.speedSamples.delete(jobId);
      this.emitSnapshot();
      this.scheduleQueue();
    }
  }

  private async probeSource(
    url: string,
    signal: AbortSignal,
  ): Promise<{ totalBytes: number | null; acceptRanges: boolean }> {
    let response = await fetch(url, { method: 'HEAD', redirect: 'follow', signal });

    if (response.status === 405 || response.status === 501) {
      response = await fetch(url, {
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
        redirect: 'follow',
        signal,
      });
      await response.body?.cancel();
    }

    if (!response.ok && response.status !== 206) {
      throw new Error(mapHttpStatusError(response.status));
    }

    const contentRange = response.headers.get('content-range');
    let totalBytes: number | null = null;
    if (contentRange) {
      const match = /\/(\d+)$/.exec(contentRange);
      if (match) totalBytes = Number(match[1]);
    }
    if (totalBytes === null) {
      const lenHeader = response.headers.get('content-length');
      if (lenHeader && /^\d+$/.test(lenHeader)) {
        totalBytes = Number(lenHeader);
      }
    }

    const acceptRangesHeader = (response.headers.get('accept-ranges') ?? '').toLowerCase();
    const acceptRanges =
      (acceptRangesHeader.includes('bytes') || response.status === 206) &&
      totalBytes !== null &&
      totalBytes > 0;

    return { totalBytes, acceptRanges };
  }

  private async executeSegments(job: DownloadJob, signal: AbortSignal): Promise<void> {
    const fh = await fs.promises.open(job.partPath, 'r+');
    let fallbackTriggered = false;

    const runSingleSegment = async (seg: SegmentPlan): Promise<void> => {
      if (seg.completed) return;

      const resumeOffset = seg.startByte + seg.downloadedBytes;
      const headers: Record<string, string> = {};
      if (job.resumable && seg.endByte !== null) {
        headers.Range = `bytes=${resumeOffset}-${seg.endByte}`;
      } else if (job.resumable && seg.startByte > 0) {
        headers.Range = `bytes=${resumeOffset}-`;
      }

      const res = await fetch(job.url, { headers, redirect: 'follow', signal });

      if (res.status === 429 && job.segments.length > 1) {
        fallbackTriggered = true;
        throw new Error(mapHttpStatusError(429));
      }

      if (!res.ok && res.status !== 206) {
        throw new Error(mapHttpStatusError(res.status));
      }

      // Server ignored Range and replied 200 OK while multi-segment was requested
      if (res.status === 200 && job.segments.length > 1) {
        await res.body?.cancel();
        fallbackTriggered = true;
        return;
      }

      if (res.status === 200 && seg.downloadedBytes > 0) {
        // Non-resumable restart from 0
        seg.downloadedBytes = 0;
        job.downloadedBytes = 0;
      }

      const reader = res.body?.getReader();
      if (!reader) return;

      let writePos = resumeOffset;
      let windowStart = Date.now();
      let windowBytes = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.byteLength === 0) continue;

        await fh.write(value, 0, value.byteLength, writePos);
        writePos += value.byteLength;
        seg.downloadedBytes += value.byteLength;
        job.downloadedBytes = job.segments.reduce((sum, s) => sum + s.downloadedBytes, 0);

        // Enforce per-job speed limit if configured
        const limitKBps = this.settings.speedLimitKBps;
        if (limitKBps > 0) {
          const perConnLimitBps = Math.max(1024, (limitKBps * 1024) / Math.max(1, job.connectionsUsed));
          windowBytes += value.byteLength;
          const expectedMs = (windowBytes / perConnLimitBps) * 1000;
          const elapsedMs = Date.now() - windowStart;
          if (expectedMs > elapsedMs) {
            await new Promise((r) => setTimeout(r, Math.min(500, expectedMs - elapsedMs)));
          }
          if (Date.now() - windowStart > 1000) {
            windowStart = Date.now();
            windowBytes = 0;
          }
        }
      }

      seg.completed = true;
    };

    try {
      await Promise.all(job.segments.map((seg) => runSingleSegment(seg)));

      if (fallbackTriggered && !signal.aborted) {
        // Safely fall back to a single non-ranged stream
        job.resumable = false;
        job.connectionsUsed = 1;
        job.downloadedBytes = 0;
        job.warning =
          'Source server rejected or ignored parallel Range requests; switched safely to 1 connection.';
        job.segments = computeSegments(job.totalBytes, 1, false);
        await fh.truncate(job.totalBytes ?? 0);
        await runSingleSegment(job.segments[0]);
      }
    } finally {
      await fh.close();
    }
  }

  private updateJobSpeed(job: DownloadJob): void {
    const sample = this.speedSamples.get(job.id);
    const now = Date.now();
    if (!sample) {
      this.speedSamples.set(job.id, { lastBytes: job.downloadedBytes, lastTime: now });
      return;
    }
    const dtSec = Math.max(0.1, (now - sample.lastTime) / 1000);
    const deltaBytes = Math.max(0, job.downloadedBytes - sample.lastBytes);
    const instantSpeed = deltaBytes / dtSec;
    job.speedBytesPerSec =
      job.speedBytesPerSec > 0 ? job.speedBytesPerSec * 0.55 + instantSpeed * 0.45 : instantSpeed;

    if (job.totalBytes && job.speedBytesPerSec > 0) {
      const remaining = Math.max(0, job.totalBytes - job.downloadedBytes);
      job.etaSeconds = remaining / job.speedBytesPerSec;
    } else {
      job.etaSeconds = null;
    }
    job.updatedAt = now;
    this.speedSamples.set(job.id, { lastBytes: job.downloadedBytes, lastTime: now });
  }

  private async computeSha256(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  private resolveUniqueFilename(dir: string, filename: string): string {
    const parsed = path.parse(filename);
    let candidate = filename;
    let index = 1;
    while (
      fs.existsSync(path.join(dir, candidate)) ||
      fs.existsSync(path.join(dir, `${candidate}.part`))
    ) {
      candidate = `${parsed.name} (${index})${parsed.ext}`;
      index += 1;
    }
    return candidate;
  }

  private ensureDir(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  private loadPersistedState(): void {
    if (!fs.existsSync(this.storageFile)) return;
    try {
      const raw = JSON.parse(fs.readFileSync(this.storageFile, 'utf-8')) as {
        settings?: Partial<DownloadSettings>;
        jobs?: DownloadJob[];
      };
      if (raw.settings) {
        this.settings = {
          ...this.settings,
          ...raw.settings,
          categoryFolders: {
            ...this.settings.categoryFolders,
            ...(raw.settings.categoryFolders ?? {}),
          },
        };
      }
      if (Array.isArray(raw.jobs)) {
        for (const job of raw.jobs) {
          // Any interrupted in-progress jobs become paused on restart
          if (job.status === 'downloading' || job.status === 'probing' || job.status === 'queued') {
            job.status = 'paused';
            job.speedBytesPerSec = 0;
            job.etaSeconds = null;
          }
          this.jobs.set(job.id, job);
        }
      }
    } catch {
      // Ignore corrupt local state
    }
  }

  private persistState(): void {
    try {
      this.ensureDir(path.dirname(this.storageFile));
      fs.writeFileSync(
        this.storageFile,
        JSON.stringify(
          {
            settings: this.settings,
            jobs: Array.from(this.jobs.values()),
          },
          null,
          2,
        ),
      );
    } catch {
      // Ignore disk write failure
    }
  }

  private emitSnapshot(): void {
    this.emit('state:changed', {
      jobs: this.listJobs(),
      settings: this.getSettings(),
    });
  }
}
