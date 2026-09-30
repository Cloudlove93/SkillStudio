import { create } from 'zustand';
import { toast } from 'sonner';
import type { AgentProfile, AgentConfig } from '@educlaw/shared';
import * as api from '../api/manager';
import { useSettingsStore } from './settings';
import { useNotificationStore } from './notification';
import { pollAgentStatus } from '../services/agent-polling';

export type { AgentProfile, AgentConfig };

/** Frontend-extended AgentConfig with ownership flag */
export interface AgentConfigWithOwner extends AgentConfig {
  isOwner?: boolean;
}

/** Check if the current user owns this agent */
export function isOwnedAgent(agent: AgentConfigWithOwner): boolean {
  return agent.isOwner !== false;
}

const CACHE_TTL = 30_000; // 30s

interface AgentStore {
  profiles: AgentProfile[];
  profilesLastFetchedAt: number;
  agents: AgentConfigWithOwner[];
  loading: boolean;
  fetchProfiles: (force?: boolean) => Promise<void>;
  invalidateProfiles: () => void;
  fetchAgents: () => Promise<void>;
  createAgent: (profileFileName: string) => Promise<AgentConfigWithOwner>;
  removeAgent: (id: string) => Promise<void>;
  startAgent: (id: string) => Promise<void>;
  stopAgent: (id: string) => Promise<void>;
  togglePublic: (id: string, isPublic: boolean) => Promise<void>;
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  profiles: [],
  profilesLastFetchedAt: 0,
  agents: [],
  loading: false,

  async fetchProfiles(force?: boolean) {
    const now = Date.now();
    if (!force && now - get().profilesLastFetchedAt < CACHE_TTL) return;
    const profiles = await api.listProfiles();
    set({ profiles, profilesLastFetchedAt: Date.now() });
  },

  invalidateProfiles() {
    set({ profilesLastFetchedAt: 0 });
  },

  async fetchAgents() {
    const agents = await api.listAgents();
    set({ agents });
  },

  async createAgent(profileFileName: string) {
    set({ loading: true });
    try {
      const { enabledPublicSkills } = useSettingsStore.getState();
      const agent = await api.createAgent(profileFileName, enabledPublicSkills ?? undefined);
      set((s) => ({ agents: [...s.agents, agent] }));
      toast.success('Agent created');
      useNotificationStore.getState().add('success', 'Agent created', agent.name);
      return agent;
    } catch (err) {
      toast.error('Failed to create agent', { description: err instanceof Error ? err.message : undefined });
      throw err;
    } finally {
      set({ loading: false });
    }
  },

  async removeAgent(id: string) {
    try {
      await api.removeAgent(id);
      set((s) => ({ agents: s.agents.filter((a) => a.id !== id) }));
      toast.success('Agent deleted');
    } catch (err) {
      toast.error('Failed to delete agent', { description: err instanceof Error ? err.message : undefined });
      throw err;
    }
  },

  async startAgent(id: string) {
    // Only one agent can run at a time — stop any currently running agent first
    const running = get().agents.find((a) => a.id !== id && (a.status === 'running' || a.status === 'starting'));
    if (running) {
      await get().stopAgent(running.id);
    }

    set((s) => ({
      agents: s.agents.map((a) => (a.id === id ? { ...a, status: 'starting' as const } : a)),
    }));
    try {
      const updated = await api.startAgent(id);
      set((s) => ({
        agents: s.agents.map((a) => (a.id === id ? updated : a)),
      }));

      // If the server returned a non-terminal status, poll until running or error
      if (updated.status === 'starting') {
        const latest = await pollAgentStatus(id);
        if (latest) {
          set((s) => ({
            agents: s.agents.map((a) => (a.id === id ? latest : a)),
          }));
        }
      }
    } catch (err) {
      toast.error('Failed to start agent', { description: err instanceof Error ? err.message : undefined });
      useNotificationStore.getState().add('error', 'Agent failed to start', err instanceof Error ? err.message : undefined);
      set((s) => ({
        agents: s.agents.map((a) => (a.id === id ? { ...a, status: 'error' as const } : a)),
      }));
      try {
        const agents = await api.listAgents();
        set({ agents });
      } catch {
        // ignore refresh failures
      }
    }
  },

  async stopAgent(id: string) {
    try {
      const updated = await api.stopAgent(id);
      set((s) => ({
        agents: s.agents.map((a) => (a.id === id ? updated : a)),
      }));
    } catch (err) {
      toast.error('Failed to stop agent', { description: err instanceof Error ? err.message : undefined });
      set((s) => ({
        agents: s.agents.map((a) => (a.id === id ? { ...a, status: 'stopped' as const } : a)),
      }));
      try {
        const agents = await api.listAgents();
        set({ agents });
      } catch { /* ignore */ }
    }
  },

  async togglePublic(id: string, isPublic: boolean) {
    await api.updateAgentSettings(id, { public: isPublic });
    set((s) => ({
      agents: s.agents.map((a) => (a.id === id ? { ...a, public: isPublic } : a)),
    }));
  },
}));
