import { create } from 'zustand';

export type MainView = 'gallery' | 'build' | 'skills' | 'tools' | 'diary' | 'deep-study' | null;
export type DeepStudyTab = 'gallery' | 'build' | 'skills' | 'tools' | 'arena' | 'optimize';

export interface PendingArenaTarget {
  kind: 'profile' | 'skill' | 'agent';
  ref: string;
  label?: string;
}

interface UIStore {
  sidebarOpen: boolean;
  mainView: MainView;
  deepStudyTab: DeepStudyTab;
  fileExplorerExpanded: boolean;
  openFilePath: string | null;
  pendingProfileFileName: string | null;
  pendingBuildScenario: string | null;
  pendingSkillDirName: string | null;
  pendingToolDirName: string | null;
  pendingArenaTarget: PendingArenaTarget | null;
  fileRefreshCounters: Map<string, number>;
  toggleSidebar: () => void;
  setSidebarOpen: (v: boolean) => void;
  setMainView: (v: MainView) => void;
  setDeepStudyTab: (v: DeepStudyTab) => void;
  setFileExplorerExpanded: (v: boolean) => void;
  setOpenFilePath: (path: string | null) => void;
  setPendingProfileFileName: (v: string | null) => void;
  setPendingBuildScenario: (v: string | null) => void;
  setPendingSkillDirName: (v: string | null) => void;
  setPendingToolDirName: (v: string | null) => void;
  setPendingArenaTarget: (v: PendingArenaTarget | null) => void;
  triggerFileRefresh: (agentId: string) => void;
}

export const useUIStore = create<UIStore>((set, get) => ({
  sidebarOpen: false,
  mainView: null,
  deepStudyTab: 'arena',
  fileExplorerExpanded: false,
  openFilePath: null,
  pendingProfileFileName: null,
  pendingBuildScenario: null,
  pendingSkillDirName: null,
  pendingToolDirName: null,
  pendingArenaTarget: null,
  fileRefreshCounters: new Map(),

  toggleSidebar() {
    set((s) => ({ sidebarOpen: !s.sidebarOpen }));
  },

  setSidebarOpen(v) {
    set({ sidebarOpen: v });
  },

  setMainView(v) {
    set({ mainView: v });
  },

  setDeepStudyTab(v) {
    set({ deepStudyTab: v });
  },

  setFileExplorerExpanded(v) {
    set({ fileExplorerExpanded: v });
  },

  setOpenFilePath(path) {
    set({ openFilePath: path });
  },

  setPendingProfileFileName(v) {
    set({ pendingProfileFileName: v });
  },

  setPendingBuildScenario(v) {
    set({ pendingBuildScenario: v });
  },

  setPendingSkillDirName(v) {
    set({ pendingSkillDirName: v });
  },

  setPendingToolDirName(v) {
    set({ pendingToolDirName: v });
  },

  setPendingArenaTarget(v) {
    set({ pendingArenaTarget: v });
  },

  triggerFileRefresh(agentId) {
    const counters = new Map(get().fileRefreshCounters);
    counters.set(agentId, (counters.get(agentId) ?? 0) + 1);
    set({ fileRefreshCounters: counters });
  },
}));
