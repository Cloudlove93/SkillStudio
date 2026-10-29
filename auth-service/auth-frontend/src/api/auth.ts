import { apiFetch } from './client';

const BASE = '';

export interface AuthUser {
  id: string;
  username: string;
  email?: string;
  roles: string[];
}

const TOKEN_KEY = 'access_token';
const REFRESH_TOKEN_KEY = 'refresh_token';

type PasswordAuthMode = 'login' | 'register';

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
};

async function parseApiResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

async function postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const res = await apiFetch(`${BASE}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  return parseApiResponse<T>(res);
}

function persistTokens(tokens: TokenResponse): void {
  localStorage.setItem(TOKEN_KEY, tokens.access_token);
  if (tokens.refresh_token) {
    localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refresh_token);
  } else {
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  }
}

export function clearStoredTokens(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

function getReturnToParam(): string | null {
  return new URLSearchParams(window.location.search).get('returnTo');
}

function isAllowedReturnToTarget(target: URL): boolean {
  if (!target || !/^https?:$/.test(target.protocol)) return false;

  const currentHost = window.location.hostname;
  const suffix = currentHost.startsWith('auth.')
    ? currentHost.slice('auth.'.length)
    : currentHost;

  if (suffix === 'localhost') {
    return target.hostname === 'localhost' || target.hostname.endsWith('.localhost');
  }

  return target.hostname === suffix || target.hostname.endsWith(`.${suffix}`);
}

export function getPostAuthDestination(): string {
  const token = localStorage.getItem(TOKEN_KEY);
  const returnTo = getReturnToParam();

  if (!returnTo) return '/nav';

  try {
    const target = new URL(returnTo, window.location.origin);
    if (!isAllowedReturnToTarget(target)) return '/nav';
    if (target.origin !== window.location.origin && token) {
      target.hash = 'token=' + encodeURIComponent(token);
    }
    return target.toString();
  } catch {
    return '/nav';
  }
}

function resolveServiceBase(hostPrefix: string): string {
  const url = new URL(window.location.origin);
  const { hostname } = url;

  if (hostname === 'localhost') {
    url.hostname = `${hostPrefix}.localhost`;
    return url.origin;
  }

  const servicePrefixes = new Set(['auth', 'app', 'edunex']);
  const [currentPrefix, ...rest] = hostname.split('.');
  if (servicePrefixes.has(currentPrefix) && rest.length > 0) {
    url.hostname = `${hostPrefix}.${rest.join('.')}`;
    return url.origin;
  }

  url.hostname = `${hostPrefix}.${hostname}`;
  return url.origin;
}

export function resolveAppBase(): string {
  return resolveServiceBase('app');
}

export function resolveEdunexBase(): string {
  return resolveServiceBase('edunex');
}

async function submitPasswordAuth(
  mode: PasswordAuthMode,
  payload: { username: string; password: string; email?: string },
): Promise<void> {
  persistTokens(await postJson<TokenResponse>('/auth/password', { mode, ...payload }));
}

export async function loginWithPassword(username: string, password: string): Promise<void> {
  await submitPasswordAuth('login', { username, password });
}

export async function registerWithPassword(
  username: string,
  email: string,
  password: string,
): Promise<void> {
  await submitPasswordAuth('register', { username, email, password });
}

export async function getMe(token: string): Promise<AuthUser> {
  const res = await apiFetch(`${BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  return parseApiResponse<AuthUser>(res);
}

export async function logout(): Promise<void> {
  const refresh = localStorage.getItem(REFRESH_TOKEN_KEY);
  clearStoredTokens();

  if (refresh) {
    postJson('/auth/logout', { refresh_token: refresh }).catch((err) => {
      console.warn('Logout revoke failed:', err);
    });
  }
}

// ─── SMS 验证码 ──────────────────────────────────────────────────────────────

export async function sendSmsCode(phone: string): Promise<string> {
  const data = await postJson<{ otpId: string }>('/auth/sms/send', { phone });
  return data.otpId;
}

export async function loginWithSms(
  phone: string,
  code: string,
  otpId: string,
): Promise<void> {
  persistTokens(await postJson<TokenResponse>('/auth/sms/login', { phone, code, otpId }));
}

export async function registerWithSms(
  phone: string,
  code: string,
  otpId: string,
  username: string,
  password: string,
): Promise<void> {
  persistTokens(
    await postJson<TokenResponse>('/auth/sms/register', { phone, code, otpId, username, password }),
  );
}
