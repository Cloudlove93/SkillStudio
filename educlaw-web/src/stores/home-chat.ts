import { create } from 'zustand';
import type { HomeChatSession as HomeChatSessionDto } from '@educlaw/shared';
import * as chatApi from '../api/chat';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatSession {
  id: string;
  title: string;
  model: string;
  createdAt: string;
  updatedAt: string;
}

export type DiaryStatus = 'idle' | 'loading' | 'success' | 'error';

interface HomeChatStore {
  sessions: ChatSession[];
  activeSessionId: string | null;
  pendingMessage: string | null;
  loading: boolean;
  /** diary save status per session id */
  diaryStatusMap: Map<string, DiaryStatus>;

  fetchSessions: () => Promise<void>;
  createSession: (title?: string, model?: string) => Promise<string>;
  deleteSession: (id: string) => Promise<void>;
  setActiveSession: (id: string | null) => void;
  updateSessionTitle: (id: string, title: string) => void;
  setPendingMessage: (msg: string | null) => void;
  consumePendingMessage: () => string | null;
  setDiaryStatus: (sessionId: string, status: DiaryStatus) => void;
}

function mapSession(s: HomeChatSessionDto): ChatSession {
  return {
    id: s.id,
    title: s.title,
    model: s.model,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
  };
}

export const useHomeChatStore = create<HomeChatStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  pendingMessage: null,
  loading: false,
  diaryStatusMap: new Map(),

  async fetchSessions() {
    set({ loading: true });
    try {
      const raw = await chatApi.fetchChatSessions();
      set({ sessions: raw.map(mapSession), loading: false });
    } catch {
      set({ loading: false });
    }
  },

  async createSession(title = '', model = '') {
    const raw = await chatApi.createChatSession(title, model);
    const session = mapSession(raw);
    set((s) => ({
      sessions: [session, ...s.sessions],
      activeSessionId: session.id,
    }));
    return session.id;
  },

  async deleteSession(id: string) {
    set((s) => ({
      sessions: s.sessions.filter((sess) => sess.id !== id),
      activeSessionId: s.activeSessionId === id ? null : s.activeSessionId,
    }));
    try { await chatApi.deleteChatSession(id); } catch { /* best effort */ }
  },

  setActiveSession(id: string | null) {
    set({ activeSessionId: id });
  },

  updateSessionTitle(id: string, title: string) {
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === id ? { ...sess, title } : sess,
      ),
    }));
  },

  setPendingMessage(msg: string | null) {
    set({ pendingMessage: msg });
  },

  consumePendingMessage() {
    const msg = get().pendingMessage;
    if (msg) set({ pendingMessage: null });
    return msg;
  },

  setDiaryStatus(sessionId: string, status: DiaryStatus) {
    const map = new Map(get().diaryStatusMap);
    if (status === 'idle') {
      map.delete(sessionId);
    } else {
      map.set(sessionId, status);
    }
    set({ diaryStatusMap: map });
  },
}));
