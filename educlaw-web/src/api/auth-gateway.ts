export type PasswordAuthMode = 'login' | 'register';

export interface PasswordAuthRequest {
  mode: PasswordAuthMode;
  username: string;
  password: string;
  email?: string;
  inviteCode?: string;
}

function shortHex(input: string): string {
  let hash = 0x811c9dc5;
  const utf8 = new TextEncoder().encode(input);

  for (const value of utf8) {
    hash ^= value;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(16).padStart(8, '0');
}

function normalizeRegistrationLocalPart(username: string): string {
  const normalized = username
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const hash = shortHex(username.trim());

  if (!normalized) {
    return `user-${hash}`;
  }

  return normalized === 'user' ? `user-${hash}` : `user-${normalized}-${hash}`;
}

export function buildRegistrationEmail(username: string): string {
  return `${normalizeRegistrationLocalPart(username)}@eduskill.localhost`;
}

export function buildPasswordAuthRequest(
  mode: PasswordAuthMode,
  username: string,
  password: string,
  inviteCode?: string,
): PasswordAuthRequest {
  if (mode === 'register') {
    return {
      mode,
      username,
      password,
      email: buildRegistrationEmail(username),
      inviteCode,
    };
  }

  return {
    mode,
    username,
    password,
  };
}
