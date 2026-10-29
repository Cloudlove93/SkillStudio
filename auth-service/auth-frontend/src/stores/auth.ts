import { create } from 'zustand';
import * as authApi from '../api/auth';
import type { AuthUser } from '../api/auth';

interface AuthStore {
  token: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  loginWithPassword: (username: string, password: string) => Promise<void>;
  registerWithPassword: (username: string, email: string, password: string) => Promise<void>;
  loginWithPhone: (phone: string, code: string, otpId: string) => Promise<void>;
  registerWithPhone: (phone: string, code: string, otpId: string, username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<boolean>;
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  token: null,
  user: null,
  isAuthenticated: false,

  async loginWithPassword(username: string, password: string) {
    await withAuthRefresh(() => authApi.loginWithPassword(username, password));
  },

  async registerWithPassword(username: string, email: string, password: string) {
    await withAuthRefresh(() => authApi.registerWithPassword(username, email, password));
  },

  async loginWithPhone(phone: string, code: string, otpId: string) {
    await withAuthRefresh(() => authApi.loginWithSms(phone, code, otpId));
  },

  async registerWithPhone(phone: string, code: string, otpId: string, username: string, password: string) {
    await withAuthRefresh(() => authApi.registerWithSms(phone, code, otpId, username, password));
  },

  async logout() {
    set({ token: null, user: null, isAuthenticated: false });
    await authApi.logout();
  },

  async checkAuth(): Promise<boolean> {
    const token = localStorage.getItem('access_token') ?? get().token;
    if (!token) {
      authApi.clearStoredTokens();
      set({ token: null, user: null, isAuthenticated: false });
      return false;
    }
    try {
      const me = await authApi.getMe(token);
      set({ token, user: me, isAuthenticated: true });
      return true;
    } catch {
      authApi.clearStoredTokens();
      set({ token: null, user: null, isAuthenticated: false });
      return false;
    }
  },
}));

async function withAuthRefresh(authAction: () => Promise<void>): Promise<void> {
  await authAction();
  await useAuthStore.getState().checkAuth();
}
