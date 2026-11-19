import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { createServer as createViteServer } from 'vite';
import { WebSocketServer, WebSocket } from 'ws';
import { DownloadManager } from './server/downloadManager.ts';
import type { DownloadSettings } from './shared/downloadCore.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = 3000;

function makeTestPayload(sizeBytes: number): Buffer {
  const buf = Buffer.alloc(sizeBytes);
  for (let i = 0; i < sizeBytes; i += 1) {
    buf[i] = (i * 17 + 13) & 0xff;
  }
  return buf;
}

const TEST_FILES: Record<string, { size: number; mime: string; ranged: boolean }> = {
  'sample-video-4mb.mp4': { size: 4 * 1024 * 1024, mime: 'video/mp4', ranged: true },
  'sample-archive-2mb.zip': { size: 2 * 1024 * 1024, mime: 'application/zip', ranged: true },
  'no-range-doc.pdf': { size: 1024 * 1024, mime: 'application/pdf', ranged: false },
  'demo-installer.exe': { size: 512 * 1024, mime: 'application/octet-stream', ranged: true },
};

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json());

  const manager = new DownloadManager({
    downloadFolder: path.resolve(__dirname, 'downloads'),
  });

  const clients = new Set<WebSocket>();
  const broadcastState = (payload?: unknown) => {
    const data = JSON.stringify({
      type: 'downloads:state',
      ...(payload && typeof payload === 'object'
        ? payload
        : { jobs: manager.listJobs(), settings: manager.getSettings() }),
    });
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  };

  manager.on('state:changed', (snapshot) => {
    broadcastState(snapshot);
  });

  manager.on('job:completed', (job) => {
    const msg = JSON.stringify({ type: 'downloads:notify', level: 'success', job });
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
  });

  manager.on('job:error', (job) => {
    const msg = JSON.stringify({ type: 'downloads:notify', level: 'error', job });
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, port: PORT });
  });

  // Built-in local HTTP Range Test Server
  app.all('/api/test-server/files/:name', (req, res) => {
    const name = req.params.name;

    if (name === 'expired-link.zip') {
      res.status(410).send('Link expired');
      return;
    }
    if (name === 'protected-report.pdf') {
      res.status(401).send('Authentication required');
      return;
    }
    if (name === 'missing-file.zip') {
      res.status(404).send('Not found');
      return;
    }
    if (name === 'rate-limited.mp4') {
      if (req.headers.range && !req.headers.range.startsWith('bytes=0-')) {
        res.status(429).send('Too many parallel connections');
        return;
      }
      const buf = makeTestPayload(1024 * 1024);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', String(buf.length));
      res.setHeader('Content-Type', 'video/mp4');
      if (req.method === 'HEAD') {
        res.status(200).end();
        return;
      }
      res.status(200).end(buf);
      return;
    }

    const spec = TEST_FILES[name];
    if (!spec) {
      res.status(404).send('Test file not found');
      return;
    }

    const payload = makeTestPayload(spec.size);

    if (!spec.ranged) {
      res.setHeader('Content-Length', String(payload.length));
      res.setHeader('Content-Type', spec.mime);
      if (req.method === 'HEAD') {
        res.status(200).end();
        return;
      }
      res.status(200).end(payload);
      return;
    }

    if (req.method === 'HEAD') {
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', String(payload.length));
      res.setHeader('Content-Type', spec.mime);
      res.status(200).end();
      return;
    }

    const rangeHeader = req.headers.range;
    if (rangeHeader) {
      const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
      const start = match ? Number(match[1]) : 0;
      const end = match && match[2] ? Math.min(payload.length - 1, Number(match[2])) : payload.length - 1;
      if (start >= payload.length || start > end) {
        res.status(416).setHeader('Content-Range', `bytes */${payload.length}`).end();
        return;
      }
      const slice = payload.subarray(start, end + 1);
      res.status(206);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Range', `bytes ${start}-${end}/${payload.length}`);
      res.setHeader('Content-Length', String(slice.length));
      res.setHeader('Content-Type', spec.mime);

      // Stream in paced chunks so pause/resume and speed telemetry are observable
      let offset = 0;
      const chunkBytes = Math.max(32 * 1024, Math.ceil(slice.length / 8));
      const pump = () => {
        if (res.writableEnded || res.destroyed) return;
        const nextEnd = Math.min(slice.length, offset + chunkBytes);
        res.write(slice.subarray(offset, nextEnd));
        offset = nextEnd;
        if (offset >= slice.length) {
          res.end();
        } else {
          setTimeout(pump, 40);
        }
      };
      pump();
      return;
    }

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', String(payload.length));
    res.setHeader('Content-Type', spec.mime);
    res.status(200).end(payload);
  });

  // Download manager REST API
  app.get('/api/downloads', (_req, res) => {
    res.json({
      jobs: manager.listJobs(),
      settings: manager.getSettings(),
    });
  });

  app.post('/api/downloads', (req, res) => {
    const body = (req.body ?? {}) as {
      url?: string;
      confirmExecutable?: boolean;
      customFilename?: string;
    };
    const result = manager.addDownload({
      url: String(body.url ?? ''),
      confirmExecutable: Boolean(body.confirmExecutable),
      customFilename: body.customFilename,
    });
    if (!result.ok) {
      const statusCode = result.requiresExecutableConfirmation ? 409 : 400;
      res.status(statusCode).json(result);
      return;
    }
    res.status(201).json(result);
  });

  app.post('/api/downloads/:id/pause', (req, res) => {
    const job = manager.pauseJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'Download not found.' });
      return;
    }
    res.json({ ok: true, job });
  });

  app.post('/api/downloads/:id/resume', (req, res) => {
    const job = manager.resumeJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'Download not found.' });
      return;
    }
    res.json({ ok: true, job });
  });

  app.post('/api/downloads/:id/retry', (req, res) => {
    const job = manager.retryJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'Download not found.' });
      return;
    }
    res.json({ ok: true, job });
  });

  app.post('/api/downloads/:id/cancel', (req, res) => {
    const job = manager.cancelJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'Download not found.' });
      return;
    }
    res.json({ ok: true, job });
  });

  app.delete('/api/downloads/:id', (req, res) => {
    const removed = manager.removeJob(req.params.id);
    if (!removed) {
      res.status(404).json({ error: 'Download not found.' });
      return;
    }
    res.json({ ok: true });
  });

  app.post('/api/downloads/clear-history', (_req, res) => {
    manager.clearHistory();
    res.json({ ok: true });
  });

  app.get('/api/downloads/:id/file', (req, res) => {
    const job = manager.getJob(req.params.id);
    if (!job || job.status !== 'completed' || !fs.existsSync(job.destinationPath)) {
      res.status(404).json({ error: 'Completed file not found on disk.' });
      return;
    }
    res.download(job.destinationPath, job.filename);
  });

  app.put('/api/settings', (req, res) => {
    const patch = (req.body ?? {}) as Partial<DownloadSettings>;
    const updated = manager.updateSettings(patch);
    res.json({ ok: true, settings: updated });
  });

  // Export clean GitHub monorepo ZIP
  app.get('/api/download/my-download-manager-repo.zip', async (_req, res) => {
    const zip = new JSZip();
    const rootFiles = [
      'README.md',
      'LICENSE',
      'CONTRIBUTING.md',
      'SECURITY.md',
      '.gitignore',
      'package.json',
      'tsconfig.json',
      'vite.config.ts',
      'index.html',
      'server.ts',
      'metadata.json',
    ];
    for (const file of rootFiles) {
      const full = path.resolve(__dirname, file);
      if (fs.existsSync(full)) {
        zip.file(file, fs.readFileSync(full), { createFolders: false });
      }
    }

    const dirs = ['shared', 'server', 'src', 'android', 'desktop', 'docs', '.github'];
    const skipNames = new Set(['node_modules', 'dist', 'build', 'downloads', '.gradle', 'release']);
    for (const dir of dirs) {
      const base = path.resolve(__dirname, dir);
      if (!fs.existsSync(base)) continue;
      const walk = (cur: string) => {
        for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
          if (skipNames.has(entry.name)) continue;
          const fp = path.join(cur, entry.name);
          const rel = path.relative(__dirname, fp).replace(/\\/g, '/');
          if (entry.isDirectory()) {
            walk(fp);
          } else {
            zip.file(rel, fs.readFileSync(fp), { createFolders: false });
          }
        }
      };
      walk(base);
    }

    const buffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
      platform: 'DOS',
    });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', 'attachment; filename="my-download-manager-repo.zip"');
    res.end(buffer);
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.send(
      JSON.stringify({
        type: 'downloads:state',
        jobs: manager.listJobs(),
        settings: manager.getSettings(),
      }),
    );
    ws.on('close', () => {
      clients.delete(ws);
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`My Download Manager server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start My Download Manager server:', err);
  process.exit(1);
});
