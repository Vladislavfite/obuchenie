/* Разбор ссылок на видео и трансляции.
   Перенесено из storage.js дословно вместе с правилами безопасности:
   пользовательский URL никогда не попадает в iframe — из него извлекается
   videoId, проверяется по регулярке, и embed-URL собирается заново. */

export const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_EMBED_BASE = 'https://www.youtube.com/embed/';

const YOUTUBE_HOSTS: Record<string, boolean> = {
  'youtube.com': true,
  'www.youtube.com': true,
  'm.youtube.com': true,
  'music.youtube.com': true,
  'youtu.be': true,
  'www.youtu.be': true,
  'youtube-nocookie.com': true,
  'www.youtube-nocookie.com': true,
};

const VIMEO_HOSTS: Record<string, boolean> = {
  'vimeo.com': true,
  'www.vimeo.com': true,
  'player.vimeo.com': true,
};

export interface ParsedVideo {
  provider: 'youtube' | 'vimeo' | 'file';
  videoId: string;
  url: string;
  embedUrl: string;
  watchUrl: string;
  live: boolean;
  startSeconds: number;
}

export function isYouTubeVideoId(id: unknown): boolean {
  return YT_ID_RE.test(String(id ?? ''));
}

/* Таймкод: ?t=30s, ?t=1m5s, ?start=65 */
export function parseYouTubeStart(u: URL): number {
  const raw = u.searchParams.get('t') || u.searchParams.get('start') || '';
  if (!raw) return 0;
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(raw);
  if (!m) return 0;
  const h = parseInt(m[1] || '0', 10);
  const min = parseInt(m[2] || '0', 10);
  const s = parseInt(m[3] || '0', 10);
  return h * 3600 + min * 60 + s;
}

export function youtubeEmbedUrl(videoId: string, startSeconds = 0): string {
  if (!isYouTubeVideoId(videoId)) return '';
  return YOUTUBE_EMBED_BASE + videoId + (startSeconds > 0 ? `?start=${startSeconds}` : '');
}

export function parseVideoUrl(url: unknown): ParsedVideo | null {
  const raw = String(url ?? '').trim();
  if (!raw) return null;

  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;

  const host = u.hostname.toLowerCase();

  if (YOUTUBE_HOSTS[host]) {
    let videoId = '';
    let live = false;
    const path = u.pathname.replace(/\/+$/, '');

    if (host === 'youtu.be' || host === 'www.youtu.be') {
      videoId = path.slice(1);
    } else if (path === '/watch') {
      videoId = u.searchParams.get('v') || '';
    } else if (path.startsWith('/embed/')) {
      videoId = path.slice('/embed/'.length);
    } else if (path.startsWith('/shorts/')) {
      videoId = path.slice('/shorts/'.length);
    } else if (path.startsWith('/live/')) {
      videoId = path.slice('/live/'.length);
      live = true;
    } else if (path.startsWith('/v/')) {
      videoId = path.slice('/v/'.length);
    }

    // Любые попытки обхода (/embed/../../evil) отсекаются проверкой формата id.
    if (!isYouTubeVideoId(videoId)) return null;

    const startSeconds = parseYouTubeStart(u);
    return {
      provider: 'youtube',
      videoId,
      url: raw,
      embedUrl: youtubeEmbedUrl(videoId, startSeconds),
      watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
      live,
      startSeconds,
    };
  }

  if (VIMEO_HOSTS[host]) {
    const m = /\/(\d{6,12})/.exec(u.pathname);
    if (!m) return null;
    return {
      provider: 'vimeo',
      videoId: m[1],
      url: raw,
      embedUrl: `https://player.vimeo.com/video/${m[1]}`,
      watchUrl: `https://vimeo.com/${m[1]}`,
      live: false,
      startSeconds: 0,
    };
  }

  if (/\.(mp4|webm|ogg|ogv|m4v|mov)(\?|#|$)/i.test(u.pathname + u.search)) {
    return {
      provider: 'file',
      videoId: '',
      url: u.toString(),
      embedUrl: '',
      watchUrl: u.toString(),
      live: false,
      startSeconds: 0,
    };
  }

  return null;
}

export interface ParsedZoom {
  provider: 'zoom';
  joinUrl: string;
  meetingId: string;
}

export function parseZoomUrl(url: unknown): ParsedZoom | null {
  const raw = String(url ?? '').trim();
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  if (!/(^|\.)zoom\.(us|com)$/i.test(u.hostname)) return null;
  const m = /\/j\/(\d{9,12})/.exec(u.pathname);
  return { provider: 'zoom', joinUrl: u.toString(), meetingId: m ? m[1] : '' };
}

/* Определение типа внешней ссылки (§26 ТЗ): URL не обязан быть видео. */
export type ExternalLinkKind = 'youtube' | 'youtube_live' | 'vimeo' | 'zoom' | 'video_file' | 'file' | 'external';

export function detectLinkKind(url: unknown): ExternalLinkKind {
  const video = parseVideoUrl(url);
  if (video) {
    if (video.provider === 'youtube') return video.live ? 'youtube_live' : 'youtube';
    if (video.provider === 'vimeo') return 'vimeo';
    return 'video_file';
  }
  if (parseZoomUrl(url)) return 'zoom';
  const raw = String(url ?? '');
  if (/\.(pdf|docx?|pptx?|xlsx?|zip|rar|txt|csv)(\?|#|$)/i.test(raw)) return 'file';
  return 'external';
}
