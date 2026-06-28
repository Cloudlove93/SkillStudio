import { getStoredAccessToken } from './token-storage';

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

// Production runs behind the same nginx origin; keep API calls under the app base.
const API_BASE = (() => {
  const configured = import.meta.env.VITE_API_BASE;
  if (configured) return configured.replace(/\/+$/, '');
  return BASE;
})();

function resolveUrl(url: string): string {
  if (url.startsWith('http')) return url;
  if (API_BASE && (url === API_BASE || url.startsWith(`${API_BASE}/`)))
    return url;
  return `${API_BASE}${url}`;
}

function createRequestId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function getToken(): string | null {
  return getStoredAccessToken();
}

/** Low-level fetch with Authorization header */
export function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const token = getToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!headers.has('x-request-id')) {
    headers.set('x-request-id', createRequestId());
  }
  return fetch(resolveUrl(url), { ...init, headers });
}

async function readResponseError(res: Response): Promise<string> {
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const body = await res.json().catch(() => null);
    if (
      body &&
      typeof body === 'object' &&
      'error' in body &&
      typeof body.error === 'string' &&
      body.error.trim()
    ) {
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
export async function apiFetchJson<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const res = await apiFetch(url, init);
  if (!res.ok) {
    throw new Error(await readResponseError(res));
  }
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(
      `Expected JSON response but received ${contentType || 'unknown content type'}`,
    );
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
  return apiPost<{
    profiles: Array<{
      fileName: string;
      name: string;
      description: string;
      details?: string;
      source?: string;
      score: number;
    }>;
  }>(`${API_BASE}/profiles/match`, { text });
}
