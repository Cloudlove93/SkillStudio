import { create } from 'zustand';
import * as authApi from '../api/auth';
import type { AuthUser } from '../api/auth';
import { clearStoredTokens, getStoredAccessToken } from '../api/token-storage';

function hasAdminRole(user: AuthUser | null): boolean {
  return !!user?.roles?.some((role) => /admin/i.test(role));
}

interface AuthStore {
  token: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (
    email: string,
    password: string,
    inviteCode: string,
    username: string,
  ) => Promise<void>;
  logout: () => void;
  checkAuth: () => Promise<boolean>;
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  token: getStoredAccessToken(),
  user: null,
  isAuthenticated: false,
  isAdmin: false,

  async login(username: string, password: string) {
    const tokens = await authApi.login(username, password);
    const me = await authApi.getMe(tokens.access_token);
    set({
      token: tokens.access_token,
      user: me,
      isAuthenticated: true,
      isAdmin: hasAdminRole(me),
    });
  },

  async register(email: string, password: string, inviteCode: string, username: string) {
    const tokens = await authApi.register(email, password, inviteCode, username);
    const me = await authApi.getMe(tokens.access_token);
    set({
      token: tokens.access_token,
      user: me,
      isAuthenticated: true,
      isAdmin: hasAdminRole(me),
    });
  },

  logout() {
    void authApi.logout();
    set({ token: null, user: null, isAuthenticated: false, isAdmin: false });
  },

  async checkAuth(): Promise<boolean> {
    const token = getStoredAccessToken() ?? get().token;
    if (!token) {
      clearStoredTokens();
      set({ isAuthenticated: false, isAdmin: false });
      return false;
    }
    try {
      const user = await authApi.getMe(token);
      set({ token, user, isAuthenticated: true, isAdmin: hasAdminRole(user) });
      return true;
    } catch {
      clearStoredTokens();
      set({ token: null, user: null, isAuthenticated: false, isAdmin: false });
      return false;
    }
  },
}));
