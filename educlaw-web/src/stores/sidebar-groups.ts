import { create } from 'zustand';
import * as api from '../api/sidebar-groups';

export interface SidebarGroup {
  id: string;
  name: string;
  icon: string;
  sortOrder: number;
  items: { itemId: string; itemType: 'agent' | 'chat' }[];
  collapsed: boolean;
}

interface SidebarGroupStore {
  groups: SidebarGroup[];
  loading: boolean;
  fetchGroups: () => Promise<void>;
  createGroup: (name: string, icon: string) => Promise<void>;
  updateGroup: (id: string, updates: { name?: string; icon?: string }) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;
  addItem: (groupId: string, itemId: string, itemType: 'agent' | 'chat') => Promise<void>;
  removeItem: (groupId: string, itemId: string, itemType: 'agent' | 'chat') => Promise<void>;
  moveItem: (itemId: string, itemType: 'agent' | 'chat', targetGroupId: string | null) => Promise<void>;
  toggleCollapsed: (groupId: string) => void;
  getItemGroupId: (itemId: string, itemType: 'agent' | 'chat') => string | null;
}

function mapGroup(g: api.SidebarGroupResponse, collapsed: boolean): SidebarGroup {
  return {
    id: g.id,
    name: g.name,
    icon: g.icon,
    sortOrder: g.sort_order,
    items: g.items.map((i) => ({ itemId: i.item_id, itemType: i.item_type })),
    collapsed,
  };
}

export const useSidebarGroupStore = create<SidebarGroupStore>((set, get) => ({
  groups: [],
  loading: false,

  async fetchGroups() {
    set({ loading: true });
    try {
      const raw = await api.fetchSidebarGroups();
      const prevGroups = get().groups;
      set({
        groups: raw.map((g) => {
          const prev = prevGroups.find((p) => p.id === g.id);
          return mapGroup(g, prev?.collapsed ?? false);
        }),
        loading: false,
      });
    } catch {
      set({ loading: false });
    }
  },

  async createGroup(name, icon) {
    const raw = await api.createSidebarGroup(name, icon);
    set((s) => ({ groups: [...s.groups, mapGroup(raw, false)] }));
  },

  async updateGroup(id, updates) {
    set((s) => ({
      groups: s.groups.map((g) =>
        g.id === id ? { ...g, ...updates } : g
      ),
    }));
    try { await api.updateSidebarGroup(id, updates); } catch { /* best effort */ }
  },

  async deleteGroup(id) {
    set((s) => ({ groups: s.groups.filter((g) => g.id !== id) }));
    try { await api.deleteSidebarGroup(id); } catch { /* best effort */ }
  },

  async addItem(groupId, itemId, itemType) {
    set((s) => ({
      groups: s.groups.map((g) => {
        // Remove item from other groups
        const filtered = g.items.filter((i) => !(i.itemId === itemId && i.itemType === itemType));
        if (g.id === groupId) {
          return { ...g, items: [...filtered, { itemId, itemType }] };
        }
        return { ...g, items: filtered };
      }),
    }));
    try { await api.addGroupItem(groupId, itemId, itemType); } catch { /* best effort */ }
  },

  async removeItem(groupId, itemId, itemType) {
    set((s) => ({
      groups: s.groups.map((g) =>
        g.id === groupId
          ? { ...g, items: g.items.filter((i) => !(i.itemId === itemId && i.itemType === itemType)) }
          : g
      ),
    }));
    try { await api.removeGroupItem(groupId, itemId, itemType); } catch { /* best effort */ }
  },

  async moveItem(itemId, itemType, targetGroupId) {
    set((s) => ({
      groups: s.groups.map((g) => {
        const filtered = g.items.filter((i) => !(i.itemId === itemId && i.itemType === itemType));
        if (targetGroupId && g.id === targetGroupId) {
          return { ...g, items: [...filtered, { itemId, itemType }] };
        }
        return { ...g, items: filtered };
      }),
    }));
    try { await api.moveGroupItemApi(itemId, itemType, targetGroupId); } catch { /* best effort */ }
  },

  toggleCollapsed(groupId) {
    set((s) => ({
      groups: s.groups.map((g) =>
        g.id === groupId ? { ...g, collapsed: !g.collapsed } : g
      ),
    }));
  },

  getItemGroupId(itemId, itemType) {
    for (const g of get().groups) {
      if (g.items.some((i) => i.itemId === itemId && i.itemType === itemType)) {
        return g.id;
      }
    }
    return null;
  },
}));
