import { create } from 'zustand';
import * as authApi from '../api/auth';
import type { AuthUser } from '../api/auth';

const TOKEN_KEY = 'educlaw-token';

interface AuthStore {
  token: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => void;
  checkAuth: () => Promise<boolean>;
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  token: localStorage.getItem(TOKEN_KEY),
  user: null,
  isAuthenticated: false,
  isAdmin: false,

  async login(username: string, password: string) {
    const { token, user } = await authApi.login(username, password);
    localStorage.setItem(TOKEN_KEY, token);
    set({ token, user, isAuthenticated: true, isAdmin: !!user.isAdmin });
    // Fetch full user info (including isAdmin) from /auth/me
    try {
      const me = await authApi.getMe(token);
      set({ user: me, isAdmin: !!me.isAdmin });
    } catch { /* ignore */ }
  },

  async register(username: string, password: string) {
    const { token, user } = await authApi.register(username, password);
    localStorage.setItem(TOKEN_KEY, token);
    set({ token, user, isAuthenticated: true, isAdmin: !!user.isAdmin });
  },

  logout() {
    localStorage.removeItem(TOKEN_KEY);
    set({ token: null, user: null, isAuthenticated: false, isAdmin: false });
  },

  async checkAuth(): Promise<boolean> {
    const token = get().token;
    if (!token) {
      set({ isAuthenticated: false, isAdmin: false });
      return false;
    }
    try {
      const user = await authApi.getMe(token);
      set({ user, isAuthenticated: true, isAdmin: !!user.isAdmin });
      return true;
    } catch {
      localStorage.removeItem(TOKEN_KEY);
      set({ token: null, user: null, isAuthenticated: false, isAdmin: false });
      return false;
    }
  },
}));
