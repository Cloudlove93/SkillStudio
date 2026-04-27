import { create } from 'zustand';
import {
  listSkillSummaries,
  createUserSkill,
  updateUserSkill,
  deleteUserSkill,
  publishSkill,
  unpublishSkill,
  listToolSummaries,
  publishTool,
  unpublishTool,
  type SkillSummary,
  type ToolSummary,
} from '../api/manager';

const CACHE_TTL = 30_000; // 30s

interface LibraryStore {
  // Skills
  skills: SkillSummary[];
  skillsLastFetchedAt: number;
  skillsLoading: boolean;
  fetchSkills: (force?: boolean) => Promise<void>;
  invalidateSkills: () => void;
  doCreateUserSkill: (dirName: string, name: string, description: string, content: string) => Promise<void>;
  doUpdateUserSkill: (dirName: string, name: string, description: string, content: string) => Promise<string>;
  doDeleteUserSkill: (dirName: string) => Promise<void>;
  doPublishSkill: (dirName: string) => Promise<void>;
  doUnpublishSkill: (dirName: string) => Promise<void>;

  // Tools
  tools: ToolSummary[];
  toolsLastFetchedAt: number;
  toolsLoading: boolean;
  fetchTools: (force?: boolean) => Promise<void>;
  doPublishTool: (dirName: string) => Promise<void>;
  doUnpublishTool: (dirName: string) => Promise<void>;
}

export const useLibraryStore = create<LibraryStore>((set, get) => ({
  // ── Skills ──────────────────────────────────────────────────
  skills: [],
  skillsLastFetchedAt: 0,
  skillsLoading: false,

  async fetchSkills(force?: boolean) {
    const now = Date.now();
    if (!force && now - get().skillsLastFetchedAt < CACHE_TTL) return;
    set({ skillsLoading: true });
    try {
      const skills = await listSkillSummaries();
      set({ skills, skillsLastFetchedAt: Date.now() });
    } catch {
      // ignore
    } finally {
      set({ skillsLoading: false });
    }
  },

  invalidateSkills() {
    set({ skillsLastFetchedAt: 0 });
  },

  async doCreateUserSkill(dirName, name, description, content) {
    await createUserSkill(dirName, name, description, content);
    set({ skillsLastFetchedAt: 0 });
  },

  async doUpdateUserSkill(dirName, name, description, content) {
    const res = await updateUserSkill(dirName, name, description, content);
    set({ skillsLastFetchedAt: 0 });
    return res.dirName;
  },

  async doDeleteUserSkill(dirName) {
    await deleteUserSkill(dirName);
    set({ skillsLastFetchedAt: 0 });
  },

  async doPublishSkill(dirName) {
    await publishSkill(dirName);
    set({ skillsLastFetchedAt: 0 });
  },

  async doUnpublishSkill(dirName) {
    await unpublishSkill(dirName);
    set({ skillsLastFetchedAt: 0 });
  },

  // ── Tools ───────────────────────────────────────────────────
  tools: [],
  toolsLastFetchedAt: 0,
  toolsLoading: false,

  async fetchTools(force?: boolean) {
    const now = Date.now();
    if (!force && now - get().toolsLastFetchedAt < CACHE_TTL) return;
    set({ toolsLoading: true });
    try {
      const tools = await listToolSummaries();
      set({ tools, toolsLastFetchedAt: Date.now() });
    } catch {
      // ignore
    } finally {
      set({ toolsLoading: false });
    }
  },

  async doPublishTool(dirName) {
    await publishTool(dirName);
    set({ toolsLastFetchedAt: 0 });
  },

  async doUnpublishTool(dirName) {
    await unpublishTool(dirName);
    set({ toolsLastFetchedAt: 0 });
  },
}));
