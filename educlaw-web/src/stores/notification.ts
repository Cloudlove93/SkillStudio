import { create } from 'zustand';

export interface Notification {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  description?: string;
  timestamp: number;
  read: boolean;
}

interface NotificationStore {
  notifications: Notification[];
  unreadCount: number;
  add: (type: Notification['type'], title: string, description?: string) => void;
  markAllRead: () => void;
  dismiss: (id: string) => void;
  clear: () => void;
}

const MAX_NOTIFICATIONS = 50;

export const useNotificationStore = create<NotificationStore>((set) => ({
  notifications: [],
  unreadCount: 0,

  add(type, title, description) {
    const notification: Notification = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type,
      title,
      description,
      timestamp: Date.now(),
      read: false,
    };
    set((s) => ({
      notifications: [notification, ...s.notifications].slice(0, MAX_NOTIFICATIONS),
      unreadCount: s.unreadCount + 1,
    }));
  },

  markAllRead() {
    set((s) => ({
      notifications: s.notifications.map((n) => ({ ...n, read: true })),
      unreadCount: 0,
    }));
  },

  dismiss(id) {
    set((s) => {
      const target = s.notifications.find((n) => n.id === id);
      return {
        notifications: s.notifications.filter((n) => n.id !== id),
        unreadCount: target && !target.read ? s.unreadCount - 1 : s.unreadCount,
      };
    });
  },

  clear() {
    set({ notifications: [], unreadCount: 0 });
  },
}));
