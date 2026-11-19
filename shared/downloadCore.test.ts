import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyFileCategory,
  computeSegments,
  extractUrlsFromText,
  formatBytes,
  formatEta,
  formatSpeed,
  inspectDownloadUrl,
  mapHttpStatusError,
  selectJobsToStart,
} from './downloadCore';

test('inspectDownloadUrl rejects unsupported streaming platforms and DRM manifests cleanly', () => {
  const yt = inspectDownloadUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(yt.valid, true);
  assert.equal(yt.supported, false);
  assert.match(yt.reason ?? '', /official download feature/i);

  const hls = inspectDownloadUrl('https://cdn.example.com/live/stream.m3u8');
  assert.equal(hls.supported, false);
});

test('inspectDownloadUrl flags executables and classifies common file types', () => {
  const exe = inspectDownloadUrl('https://releases.example.com/setup-1.2.exe');
  assert.equal(exe.supported, true);
  assert.equal(exe.isExecutable, true);
  assert.equal(exe.category, 'installer');
  assert.equal(exe.isHttps, true);

  const zip = inspectDownloadUrl('http://files.example.org/bundle.tar.gz');
  assert.equal(zip.supported, true);
  assert.equal(zip.isExecutable, false);
  assert.equal(zip.category, 'archive');
  assert.equal(zip.isHttps, false);

  assert.equal(classifyFileCategory('lecture.mp4'), 'video');
  assert.equal(classifyFileCategory('podcast.mp3'), 'audio');
  assert.equal(classifyFileCategory('diagram.png'), 'image');
  assert.equal(classifyFileCategory('manual.pdf'), 'document');
});

test('computeSegments splits ranged files across parallel connections and falls back safely', () => {
  const ranged = computeSegments(4 * 1024 * 1024, 4, true);
  assert.equal(ranged.length, 4);
  assert.equal(ranged[0].startByte, 0);
  assert.equal(ranged[0].endByte, 1024 * 1024 - 1);
  assert.equal(ranged[3].endByte, 4 * 1024 * 1024 - 1);

  const nonRanged = computeSegments(4 * 1024 * 1024, 8, false);
  assert.equal(nonRanged.length, 1);
  assert.equal(nonRanged[0].startByte, 0);
  assert.equal(nonRanged[0].endByte, 4 * 1024 * 1024 - 1);

  const unknownSize = computeSegments(null, 4, true);
  assert.equal(unknownSize.length, 1);
  assert.equal(unknownSize[0].endByte, null);
});

test('selectJobsToStart enforces max concurrent download limit in FIFO order', () => {
  const toStart = selectJobsToStart(
    [
      { id: 'j1', status: 'downloading', createdAt: 10 },
      { id: 'j2', status: 'queued', createdAt: 30 },
      { id: 'j3', status: 'queued', createdAt: 20 },
      { id: 'j4', status: 'paused', createdAt: 15 },
    ],
    2,
  );
  assert.deepEqual(toStart, ['j3']);
});

test('extractUrlsFromText detects pasted or shared HTTP/HTTPS links', () => {
  const urls = extractUrlsFromText(
    'Check this file: https://example.com/archive.zip and also http://example.org/video.mp4.',
  );
  assert.deepEqual(urls, [
    'https://example.com/archive.zip',
    'http://example.org/video.mp4',
  ]);
});

test('mapHttpStatusError and formatters return clear actionable outputs', () => {
  assert.match(mapHttpStatusError(401), /Authentication/i);
  assert.match(mapHttpStatusError(404), /unavailable/i);
  assert.match(mapHttpStatusError(410), /expired/i);
  assert.match(mapHttpStatusError(429), /rate-limited/i);

  assert.equal(formatBytes(1024 * 1024), '1.00 MB');
  assert.equal(formatSpeed(2048), '2.00 KB/s');
  assert.equal(formatEta(125), '2m 5s');
});
