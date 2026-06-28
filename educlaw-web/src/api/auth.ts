import { apiFetchJson } from './client';
import {
  buildPasswordAuthRequest,
  type PasswordAuthMode,
} from './auth-gateway';
import {
  clearStoredTokens,
  persistTokens,
  type StoredTokenResponse,
} from './token-storage';

export interface AuthUser {
  id: string;
  username: string;
  email?: string;
  roles?: string[];
}

function persistPasswordAuth(tokens: StoredTokenResponse): StoredTokenResponse {
  persistTokens(tokens);
  return tokens;
}

async function submitPasswordAuth(
  mode: PasswordAuthMode,
  username: string,
  password: string,
): Promise<StoredTokenResponse> {
  const tokens = await apiFetchJson<StoredTokenResponse>(`/auth/password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildPasswordAuthRequest(mode, username, password)),
  });

  return persistPasswordAuth(tokens);
}

export async function login(
  username: string,
  password: string,
): Promise<StoredTokenResponse> {
  return submitPasswordAuth('login', username, password);
}

export async function register(
  username: string,
  password: string,
): Promise<StoredTokenResponse> {
  return submitPasswordAuth('register', username, password);
}

export async function getMe(token: string): Promise<AuthUser> {
  return apiFetchJson<AuthUser>(`/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function logout(): Promise<void> {
  const accessToken = localStorage.getItem('access_token');
  const refreshToken = localStorage.getItem('refresh_token');
  clearStoredTokens();

  if (!accessToken && !refreshToken) {
    return;
  }

  void apiFetchJson<{ ok: boolean }>(`/auth/logout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      access_token: accessToken,
      refresh_token: refreshToken,
    }),
  }).catch(() => undefined);
}
