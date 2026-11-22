let memoryToken: string | null = null;

export function setAuthToken(token: string | null) {
  memoryToken = token;
}

export function getAuthToken(): string | null {
  return memoryToken;
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (memoryToken) {
    headers.set('Authorization', `Bearer ${memoryToken}`);
  }

  const res = await fetch(path, {
    ...options,
    headers,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export async function uploadFile(
  file: Blob,
  filename: string,
  roomId: string,
  durationSec?: number
) {
  const formData = new FormData();
  formData.append('file', file, filename);
  formData.append('roomId', roomId);
  if (durationSec !== undefined) {
    formData.append('durationSec', String(durationSec));
  }

  const res = await apiRequest<{ file: import('../types').FileAttachment }>('/api/upload', {
    method: 'POST',
    body: formData,
  });
  return res.file;
}

// Cache authenticated media blob URLs in memory
const mediaUrlCache = new Map<string, string>();
const pendingMediaRequests = new Map<string, Promise<string>>();

export async function fetchAuthenticatedMediaUrl(url: string): Promise<string> {
  if (!url.startsWith('/api/files/')) {
    return url;
  }
  const cached = mediaUrlCache.get(url);
  if (cached) return cached;

  const pending = pendingMediaRequests.get(url);
  if (pending) return pending;

  const promise = (async () => {
    const headers: HeadersInit = {};
    if (memoryToken) {
      headers['Authorization'] = `Bearer ${memoryToken}`;
    }
    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error('Failed to load media');
    }
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    mediaUrlCache.set(url, objUrl);
    return objUrl;
  })().finally(() => {
    pendingMediaRequests.delete(url);
  });

  pendingMediaRequests.set(url, promise);
  return promise;
}

export async function downloadAuthenticatedFile(url: string, filename: string): Promise<void> {
  const headers: HeadersInit = {};
  if (memoryToken) {
    headers['Authorization'] = `Bearer ${memoryToken}`;
  }
  const downloadUrl = url.includes('?') ? `${url}&download=1` : `${url}?download=1`;
  const res = await fetch(downloadUrl, { headers });
  if (!res.ok) {
    throw new Error('Download failed');
  }
  const blob = await res.blob();
  const objUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(objUrl), 5000);
}

export function clearMediaCache() {
  for (const objUrl of mediaUrlCache.values()) {
    URL.revokeObjectURL(objUrl);
  }
  mediaUrlCache.clear();
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatListTime(ts: number): string {
  const now = new Date();
  const d = new Date(ts);
  const sameDay =
    now.getFullYear() === d.getFullYear() &&
    now.getMonth() === d.getMonth() &&
    now.getDate() === d.getDate();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  const diffDays = Math.floor((now.getTime() - d.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays < 7) {
    return d.toLocaleDateString([], { weekday: 'short' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
