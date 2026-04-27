/**
 * Derive the path prefix so the app works behind reverse proxies with sub-paths.
 *
 * import.meta.url points to the JS bundle, e.g.
 *   https://host/ws-.../proxy/80/assets/index-xxx.js
 * Stripping the "/assets/..." suffix gives the deploy root:
 *   /ws-.../proxy/80
 */
const BASE = (() => {
  try {
    const url = new URL(import.meta.url);
    // Only derive base from production Vite output (/assets/<file>)
    const match = url.pathname.match(/^(.*)\/assets\/[^/]+$/);
    if (!match) return '';
    // Remove trailing slash(es) so callers can write `${BASE}/foo`
    return match[1].replace(/\/+$/, '');
  } catch {
    return '';
  }
})();

// 生产环境：前后端分离部署，API 请求指向后端 3000 端口
const API_BASE = (() => {
  if (import.meta.env.DEV) return BASE;
  try {
    // Notebook 代理模式：/.../proxy/8080 → /.../proxy/3000
    const proxyMatch = BASE.match(/^(.*\/proxy\/)8080$/);
    if (proxyMatch) return proxyMatch[1] + '3000';
    // 直接访问模式：前后端分离，指向 3000 端口
    if (typeof window !== 'undefined') {
      const { protocol, hostname, port } = window.location;
      if (port && port !== '3000') return `${protocol}//${hostname}:3000`;
    }
    return BASE;
  } catch {
    return BASE;
  }
})();

function resolveUrl(url: string): string {
  if (url.startsWith('http')) return url;
  return `${API_BASE}${url}`;
}

const TOKEN_KEY = 'educlaw-token';

function createRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

/** Low-level fetch with Authorization header */
export function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const token = getToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!headers.has('x-request-id')) {
    headers.set('x-request-id', createRequestId());
  }
  return fetch(url, { ...init, headers });
}

async function readResponseError(res: Response): Promise<string> {
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const body = await res.json().catch(() => null);
    if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' && body.error.trim()) {
      return body.error;
    }
  }

  const text = (await res.text().catch(() => '')).trim();
  if (!text) return `HTTP ${res.status}`;
  if (text.startsWith('<!doctype') || text.startsWith('<html')) {
    return `HTTP ${res.status}`;
  }
  return text;
}

/** Fetch JSON with automatic error handling */
export async function apiFetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(url, init);
  if (!res.ok) {
    throw new Error(await readResponseError(res));
  }
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(`Expected JSON response but received ${contentType || 'unknown content type'}`);
  }
  return res.json();
}
/** POST JSON shorthand */
export function apiPost<T>(url: string, body?: unknown): Promise<T> {
  return apiFetchJson<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined,
  });
}

/** PUT JSON shorthand */
export function apiPut<T>(url: string, body?: unknown): Promise<T> {
  return apiFetchJson<T>(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined,
  });
}

/** PATCH JSON shorthand */
export function apiPatch<T>(url: string, body?: unknown): Promise<T> {
  return apiFetchJson<T>(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined,
  });
}

export { BASE, API_BASE };

/** Match agent profiles against query text using BM25 */
export function matchProfiles(text: string) {
  return apiPost<{ profiles: Array<{ fileName: string; name: string; description: string; details?: string; source?: string; score: number }> }>(
    `${API_BASE}/profiles/match`,
    { text },
  );
}
