import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { DownloadManager } from './downloadManager';

function createFixtureBuffer(sizeBytes: number): Buffer {
  const buf = Buffer.alloc(sizeBytes);
  for (let i = 0; i < sizeBytes; i += 1) {
    buf[i] = (i * 31 + 7) & 0xff;
  }
  return buf;
}

function waitForStatus(
  manager: DownloadManager,
  jobId: string,
  targetStatuses: string[],
  timeoutMs = 8000,
): Promise<ReturnType<DownloadManager['getJob']>> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const job = manager.getJob(jobId);
      if (job && targetStatuses.includes(job.status)) {
        manager.off('state:changed', check);
        resolve(job);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        manager.off('state:changed', check);
        reject(new Error(`Timed out waiting for status ${targetStatuses.join('/')}, current=${job?.status}`));
      }
    };
    manager.on('state:changed', check);
    check();
  });
}

test('DownloadManager completes multi-connection resumable download, pause/resume, non-range fallback, and error cases', async () => {
  const payload = createFixtureBuffer(1024 * 1024); // 1 MB
  const expectedSha = crypto.createHash('sha256').update(payload).digest('hex');

  const server = http.createServer((req, res) => {
    if (req.url === '/expired.zip') {
      res.writeHead(410);
      res.end('Gone');
      return;
    }
    if (req.url === '/private.pdf') {
      res.writeHead(401);
      res.end('Unauthorized');
      return;
    }
    if (req.url === '/no-range.bin') {
      res.writeHead(200, {
        'Content-Length': String(payload.length),
        'Content-Type': 'application/octet-stream',
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      res.end(payload);
      return;
    }

    // Resumable file with artificial chunk pacing so pause/resume can intercept mid-transfer
    if (req.url === '/ranged-video.mp4') {
      const rangeHeader = req.headers.range;
      if (req.method === 'HEAD') {
        res.writeHead(200, {
          'Accept-Ranges': 'bytes',
          'Content-Length': String(payload.length),
          'Content-Type': 'video/mp4',
        });
        res.end();
        return;
      }

      if (rangeHeader) {
        const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
        const start = match ? Number(match[1]) : 0;
        const end = match && match[2] ? Number(match[2]) : payload.length - 1;
        const slice = payload.subarray(start, end + 1);
        res.writeHead(206, {
          'Accept-Ranges': 'bytes',
          'Content-Range': `bytes ${start}-${end}/${payload.length}`,
          'Content-Length': String(slice.length),
        });
        // Stream in 4 pieces with tiny delay so pause test can catch it downloading
        let offset = 0;
        const pump = () => {
          if (res.writableEnded || res.destroyed) return;
          const nextEnd = Math.min(slice.length, offset + Math.ceil(slice.length / 4));
          res.write(slice.subarray(offset, nextEnd));
          offset = nextEnd;
          if (offset >= slice.length) {
            res.end();
          } else {
            setTimeout(pump, 20);
          }
        };
        pump();
        return;
      }

      res.writeHead(200, {
        'Accept-Ranges': 'bytes',
        'Content-Length': String(payload.length),
      });
      res.end(payload);
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdm-test-'));
  const manager = new DownloadManager({
    downloadFolder: tmpDir,
    maxConcurrentDownloads: 2,
    connectionsPerDownload: 4,
  });

  try {
    // 1. Executable warning requires explicit confirmation
    const exeBlocked = manager.addDownload({ url: `${baseUrl}/setup.exe` });
    assert.equal(exeBlocked.ok, false);
    if (!exeBlocked.ok) {
      assert.equal(exeBlocked.requiresExecutableConfirmation, true);
    }

    // 2. Resumable multi-connection download + pause/resume
    const rangedAdded = manager.addDownload({ url: `${baseUrl}/ranged-video.mp4` });
    assert.equal(rangedAdded.ok, true);
    if (!rangedAdded.ok) return;

    await waitForStatus(manager, rangedAdded.job.id, ['downloading']);
    await new Promise((r) => setTimeout(r, 25));
    const paused = manager.pauseJob(rangedAdded.job.id);
    assert.equal(paused?.status, 'paused');

    const resumed = manager.resumeJob(rangedAdded.job.id);
    assert.ok(resumed);
    const completedRanged = await waitForStatus(manager, rangedAdded.job.id, ['completed']);
    assert.equal(completedRanged?.status, 'completed');
    assert.equal(completedRanged?.resumable, true);
    assert.equal(completedRanged?.connectionsUsed, 4);
    assert.equal(completedRanged?.sha256, expectedSha);

    // 3. Non-range server safely falls back to 1 connection
    const nonRangeAdded = manager.addDownload({ url: `${baseUrl}/no-range.bin` });
    assert.equal(nonRangeAdded.ok, true);
    if (nonRangeAdded.ok) {
      const done = await waitForStatus(manager, nonRangeAdded.job.id, ['completed']);
      assert.equal(done?.connectionsUsed, 1);
      assert.equal(done?.resumable, false);
      assert.equal(done?.sha256, expectedSha);
    }

    // 4. Expired link (410) & Auth error (401)
    const expired = manager.addDownload({ url: `${baseUrl}/expired.zip` });
    if (expired.ok) {
      const errJob = await waitForStatus(manager, expired.job.id, ['error']);
      assert.match(errJob?.error ?? '', /expired/i);
    }

    const auth = manager.addDownload({ url: `${baseUrl}/private.pdf` });
    if (auth.ok) {
      const errJob = await waitForStatus(manager, auth.job.id, ['error']);
      assert.match(errJob?.error ?? '', /Authentication/i);
    }
  } finally {
    manager.shutdown();
    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
