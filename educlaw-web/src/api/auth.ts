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

// ── 错误翻译（原 auth-proxy 中的逻辑迁移到前端）──────────────────────────
const ERROR_TRANSLATIONS: Record<string, string> = {
  'Authentication failed': '邮箱或密码错误',
  'Registration failed': '注册失败，请稍后重试',
};

function translateError(message: string): string {
  if (/[一-鿿]/.test(message)) return message;
  const exact = ERROR_TRANSLATIONS[message];
  if (exact) return exact;
  for (const [en, zh] of Object.entries(ERROR_TRANSLATIONS)) {
    if (message.startsWith(en)) return zh;
  }
  return message;
}

function persistPasswordAuth(tokens: StoredTokenResponse): StoredTokenResponse {
  persistTokens(tokens);
  return tokens;
}

async function submitPasswordAuth(
  mode: PasswordAuthMode,
  username: string,
  password: string,
  inviteCode?: string,
  email?: string,
): Promise<StoredTokenResponse> {
  try {
    const tokens = await apiFetchJson<StoredTokenResponse>(`/auth/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPasswordAuthRequest(mode, username, password, inviteCode, email)),
    });
    return persistPasswordAuth(tokens);
  } catch (err: unknown) {
    if (err instanceof Error) {
      throw new Error(translateError(err.message), { cause: err });
    }
    throw err;
  }
}

export async function login(
  username: string,
  password: string,
): Promise<StoredTokenResponse> {
  return submitPasswordAuth('login', username, password);
}

export async function register(
  email: string,
  password: string,
  inviteCode?: string,
  username?: string,
): Promise<StoredTokenResponse> {
  const loginName = username || email;
  try {
    await apiFetchJson<{ ok: true }>(`/auth/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        buildPasswordAuthRequest('register', loginName, password, inviteCode, email),
      ),
    });
  } catch (err: unknown) {
    if (err instanceof Error) {
      throw new Error(translateError(err.message), { cause: err });
    }
    throw err;
  }
  return submitPasswordAuth('login', email, password);
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
