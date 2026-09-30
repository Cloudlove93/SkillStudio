export type PasswordAuthMode = 'login' | 'register';

export interface PasswordAuthRequest {
  mode: PasswordAuthMode;
  username: string;
  password: string;
  email?: string;
  inviteCode?: string;
}

export function buildPasswordAuthRequest(
  mode: PasswordAuthMode,
  username: string,
  password: string,
  inviteCode?: string,
  email?: string,
): PasswordAuthRequest {
  if (mode === 'register') {
    return {
      mode,
      username,
      password,
      email,
      inviteCode,
    };
  }

  return {
    mode,
    username,
    password,
  };
}
