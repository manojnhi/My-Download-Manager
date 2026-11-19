export type FileCategory =
  | 'video'
  | 'audio'
  | 'image'
  | 'document'
  | 'archive'
  | 'installer'
  | 'other';

export type DownloadStatus =
  | 'queued'
  | 'probing'
  | 'downloading'
  | 'paused'
  | 'completed'
  | 'error'
  | 'canceled';

export interface SegmentPlan {
  index: number;
  startByte: number;
  endByte: number | null;
  downloadedBytes: number;
  completed: boolean;
}

export interface DownloadSettings {
  downloadFolder: string;
  maxConcurrentDownloads: number;
  connectionsPerDownload: number;
  speedLimitKBps: number; // 0 = unlimited
  organizeByCategory: boolean;
  categoryFolders: Record<FileCategory, string>;
  notificationsEnabled: boolean;
  darkMode: boolean;
}

export const DEFAULT_CATEGORY_FOLDERS: Record<FileCategory, string> = {
  video: 'Videos',
  audio: 'Audio',
  image: 'Images',
  document: 'Documents',
  archive: 'Archives',
  installer: 'Installers',
  other: 'General',
};

export const DEFAULT_SETTINGS: DownloadSettings = {
  downloadFolder: './downloads',
  maxConcurrentDownloads: 3,
  connectionsPerDownload: 4,
  speedLimitKBps: 0,
  organizeByCategory: true,
  categoryFolders: { ...DEFAULT_CATEGORY_FOLDERS },
  notificationsEnabled: true,
  darkMode: false,
};

export interface UrlInspectionResult {
  valid: boolean;
  supported: boolean;
  normalizedUrl: string;
  hostname: string;
  isHttps: boolean;
  filename: string;
  category: FileCategory;
  isExecutable: boolean;
  reason?: string;
}

const UNSUPPORTED_STREAMING_HOSTS = [
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
  'netflix.com',
  'www.netflix.com',
  'spotify.com',
  'open.spotify.com',
  'primevideo.com',
  'www.primevideo.com',
  'disneyplus.com',
  'www.disneyplus.com',
  'hulu.com',
  'www.hulu.com',
  'twitch.tv',
  'www.twitch.tv',
];

const EXECUTABLE_EXTENSIONS = new Set([
  'exe',
  'msi',
  'apk',
  'bat',
  'cmd',
  'ps1',
  'sh',
  'dmg',
  'pkg',
  'appimage',
  'deb',
  'rpm',
  'vbs',
  'jar',
]);

const CATEGORY_EXTENSIONS: Record<FileCategory, Set<string>> = {
  video: new Set(['mp4', 'mkv', 'webm', 'mov', 'avi', 'm4v']),
  audio: new Set(['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'opus']),
  image: new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'bmp', 'avif']),
  document: new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'md', 'epub']),
  archive: new Set(['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso']),
  installer: EXECUTABLE_EXTENSIONS,
  other: new Set(),
};

export function getFileExtension(filename: string): string {
  const clean = filename.split('?')[0].split('#')[0].trim().toLowerCase();
  const lastDot = clean.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === clean.length - 1) return '';
  return clean.slice(lastDot + 1);
}

export function classifyFileCategory(filename: string): FileCategory {
  const ext = getFileExtension(filename);
  if (!ext) return 'other';
  for (const [category, extensions] of Object.entries(CATEGORY_EXTENSIONS)) {
    if (extensions.has(ext)) {
      return category as FileCategory;
    }
  }
  return 'other';
}

export function isExecutableFilename(filename: string): boolean {
  const ext = getFileExtension(filename);
  return EXECUTABLE_EXTENSIONS.has(ext);
}

export function sanitizeFilename(rawName: string): string {
  const base = rawName
    .split('?')[0]
    .split('#')[0]
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .trim();
  return base || 'download.bin';
}

export function inspectDownloadUrl(rawUrl: string): UrlInspectionResult {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return {
      valid: false,
      supported: false,
      normalizedUrl: '',
      hostname: '',
      isHttps: false,
      filename: '',
      category: 'other',
      isExecutable: false,
      reason: 'Enter a valid HTTP or HTTPS file URL.',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      valid: false,
      supported: false,
      normalizedUrl: trimmed,
      hostname: '',
      isHttps: false,
      filename: '',
      category: 'other',
      isExecutable: false,
      reason: 'Invalid URL format. Include http:// or https://.',
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      valid: false,
      supported: false,
      normalizedUrl: parsed.toString(),
      hostname: parsed.hostname,
      isHttps: false,
      filename: '',
      category: 'other',
      isExecutable: false,
      reason: 'Only HTTP and HTTPS direct file URLs are supported.',
    };
  }

  const host = parsed.hostname.toLowerCase();
  const pathLower = parsed.pathname.toLowerCase();

  if (
    UNSUPPORTED_STREAMING_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`)) ||
    pathLower.endsWith('.m3u8') ||
    pathLower.endsWith('.mpd')
  ) {
    return {
      valid: true,
      supported: false,
      normalizedUrl: parsed.toString(),
      hostname: host,
      isHttps: parsed.protocol === 'https:',
      filename: '',
      category: 'video',
      isExecutable: false,
      reason:
        'This streaming or protected platform is not supported. Use the service’s official download feature instead of third-party extraction.',
    };
  }

  const rawSegment = parsed.pathname.split('/').filter(Boolean).pop() ?? 'download.bin';
  const decodedSegment = (() => {
    try {
      return decodeURIComponent(rawSegment);
    } catch {
      return rawSegment;
    }
  })();

  const filename = sanitizeFilename(decodedSegment);
  const category = classifyFileCategory(filename);
  const isExecutable = isExecutableFilename(filename);

  return {
    valid: true,
    supported: true,
    normalizedUrl: parsed.toString(),
    hostname: host,
    isHttps: parsed.protocol === 'https:',
    filename,
    category,
    isExecutable,
  };
}

export function extractUrlsFromText(input: string): string[] {
  const matches = input.match(/https?:\/\/[^\s<>"'`]+/gi) ?? [];
  const unique = new Set<string>();
  for (const m of matches) {
    const cleaned = m.replace(/[),.;!?]+$/, '');
    try {
      const parsed = new URL(cleaned);
      unique.add(parsed.toString());
    } catch {
      // Skip invalid URL fragment
    }
  }
  return Array.from(unique);
}

export function computeSegments(
  totalBytes: number | null,
  requestedConnections: number,
  acceptRanges: boolean,
  minChunkSizeBytes = 256 * 1024,
): SegmentPlan[] {
  const safeConn = Math.max(1, Math.min(16, Math.floor(requestedConnections)));

  if (!acceptRanges || totalBytes === null || totalBytes <= 0 || safeConn === 1) {
    return [
      {
        index: 0,
        startByte: 0,
        endByte: totalBytes !== null && totalBytes > 0 ? totalBytes - 1 : null,
        downloadedBytes: 0,
        completed: false,
      },
    ];
  }

  const maxUsefulConnections = Math.max(1, Math.floor(totalBytes / minChunkSizeBytes));
  const actualConnections = Math.min(safeConn, maxUsefulConnections);
  const baseSize = Math.floor(totalBytes / actualConnections);
  const segments: SegmentPlan[] = [];

  for (let i = 0; i < actualConnections; i += 1) {
    const startByte = i * baseSize;
    const endByte = i === actualConnections - 1 ? totalBytes - 1 : (i + 1) * baseSize - 1;
    segments.push({
      index: i,
      startByte,
      endByte,
      downloadedBytes: 0,
      completed: false,
    });
  }

  return segments;
}

export interface SchedulableJob {
  id: string;
  status: DownloadStatus;
  createdAt: number;
}

export function selectJobsToStart(jobs: SchedulableJob[], maxConcurrent: number): string[] {
  const limit = Math.max(1, Math.floor(maxConcurrent));
  const activeCount = jobs.filter(
    (job) => job.status === 'downloading' || job.status === 'probing',
  ).length;
  const availableSlots = Math.max(0, limit - activeCount);
  if (availableSlots === 0) return [];

  return jobs
    .filter((job) => job.status === 'queued')
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, availableSlots)
    .map((job) => job.id);
}

export function mapHttpStatusError(status: number): string {
  switch (status) {
    case 401:
    case 403:
      return `Authentication or permission required (HTTP ${status}). Sign in on the source site and provide an authorized direct link.`;
    case 404:
      return 'File unavailable on the source server (HTTP 404). Check that the URL still exists.';
    case 410:
      return 'Download link has expired (HTTP 410). Request a fresh download URL from the source.';
    case 416:
      return 'Server rejected the byte-range resume offset (HTTP 416). Restart the download from the beginning.';
    case 429:
      return 'Server rate-limited parallel connections (HTTP 429). Reduce connections or wait before retrying.';
    default:
      if (status >= 500) {
        return `Source server encountered an error (HTTP ${status}). Try resuming again shortly.`;
      }
      return `Download failed with HTTP status ${status}.`;
  }
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes < 0 || Number.isNaN(bytes)) return 'Unknown';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exp = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const val = bytes / 1024 ** exp;
  return `${val >= 100 ? val.toFixed(0) : val >= 10 ? val.toFixed(1) : val.toFixed(2)} ${units[exp]}`;
}

export function formatSpeed(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return '0 B/s';
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatEta(remainingSeconds: number | null): string {
  if (remainingSeconds === null || !Number.isFinite(remainingSeconds) || remainingSeconds < 0) {
    return '—';
  }
  const total = Math.ceil(remainingSeconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
