import { AUTH_ROUTES } from '@educlaw/shared';
import { apiFetchJson } from './client';

export interface AuthResponse {
  token: string;
  user: { id: string; username: string; isAdmin?: boolean };
}

export interface AuthUser {
  id: string;
  username: string;
  isAdmin?: boolean;
}

export async function login(username: string, password: string): Promise<AuthResponse> {
  return apiFetchJson<AuthResponse>(`/api/auth${AUTH_ROUTES.LOGIN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
}

export async function register(username: string, password: string, inviteCode: string): Promise<AuthResponse> {
  return apiFetchJson<AuthResponse>(`/api/auth${AUTH_ROUTES.REGISTER}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, inviteCode }),
  });
}

export async function getMe(token: string): Promise<AuthUser> {
  return apiFetchJson<AuthUser>(`/api/auth${AUTH_ROUTES.ME}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}
