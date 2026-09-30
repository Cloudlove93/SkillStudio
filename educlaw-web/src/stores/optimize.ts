import { create } from 'zustand';
import { toast } from 'sonner';
import type { OptimizationCreateResult, OptimizationRequestInput, OptimizationRunView } from '../api/manager';
import {
  optimizeProfile,
  optimizeSkill,
  optimizeAgent,
  listOptimizationRuns,
  getOptimizationRun,
  applyOptimizationRun,
  rejectOptimizationRun,
  deleteOptimizationRun,
} from '../api/manager';
import { useUIStore } from './ui';
import { useAgentStore } from './agent';
import { useLibraryStore } from './library';

interface CreateRunOptions {
  openPanel?: boolean;
}

function openOptimizePanel() {
  const ui = useUIStore.getState();
  ui.setMainView('deep-study');
  ui.setDeepStudyTab('optimize');
}

function upsertRun(runs: OptimizationRunView[], next: OptimizationRunView): OptimizationRunView[] {
  return [next, ...runs.filter((run) => run.run.id !== next.run.id)].sort(
    (a, b) => new Date(b.run.created_at).getTime() - new Date(a.run.created_at).getTime(),
  );
}

function chooseSelectedRunId(runs: OptimizationRunView[], current: string | null): string | null {
  if (current && runs.some((run) => run.run.id === current)) {
    return current;
  }
  return runs[0]?.run.id ?? null;
}

function handleCreateResult(
  result: OptimizationCreateResult,
  successMessage: string,
  setState: (updater: (state: OptimizeStore) => Partial<OptimizeStore>) => void,
  options: CreateRunOptions = {},
): OptimizationRunView | undefined {
  if (!result.created) {
    toast.info(result.message);
    return undefined;
  }

  if (options.openPanel !== false) {
    openOptimizePanel();
  }
  setState((state) => ({
    runs: upsertRun(state.runs, result),
    selectedRunId: result.run.id,
  }));
  toast.success(successMessage);
  return result;
}

async function refreshRelatedResources(runView: OptimizationRunView) {
  if (runView.run.target_kind === 'profile') {
    useAgentStore.getState().invalidateProfiles();
    await useAgentStore.getState().fetchProfiles(true);
    useUIStore.getState().setPendingProfileFileName(runView.run.target_ref);
    return;
  }
  if (runView.run.target_kind === 'skill') {
    await useLibraryStore.getState().fetchSkills(true);
    useUIStore.getState().setPendingSkillDirName(runView.run.target_ref);
    return;
  }
  await useAgentStore.getState().fetchAgents();
}

interface OptimizeStore {
  runs: OptimizationRunView[];
  selectedRunId: string | null;
  loading: boolean;
  creating: boolean;
  acting: boolean;
  setSelectedRunId: (runId: string | null) => void;
  fetchRuns: (force?: boolean) => Promise<void>;
  refreshRun: (runId: string) => Promise<void>;
  createProfileRun: (fileName: string, input?: OptimizationRequestInput, options?: CreateRunOptions) => Promise<OptimizationRunView | undefined>;
  createSkillRun: (dirName: string, input?: OptimizationRequestInput, options?: CreateRunOptions) => Promise<OptimizationRunView | undefined>;
  createAgentRun: (agentId: string, input?: OptimizationRequestInput, options?: CreateRunOptions) => Promise<OptimizationRunView | undefined>;
  applyRun: (runId: string, suggestionKey?: string) => Promise<void>;
  rejectRun: (runId: string, suggestionKey?: string) => Promise<void>;
  deleteRun: (runId: string) => Promise<void>;
}

export const useOptimizeStore = create<OptimizeStore>((set, get) => ({
  runs: [],
  selectedRunId: null,
  loading: false,
  creating: false,
  acting: false,

  setSelectedRunId(runId) {
    openOptimizePanel();
    set({ selectedRunId: runId });
  },

  async fetchRuns() {
    set({ loading: true });
    try {
      const runs = await listOptimizationRuns();
      set((state) => ({
        runs,
        selectedRunId: chooseSelectedRunId(runs, state.selectedRunId),
      }));
    } finally {
      set({ loading: false });
    }
  },

  async refreshRun(runId) {
    const next = await getOptimizationRun(runId);
    set((state) => {
      const runs = upsertRun(state.runs, next);
      return {
        runs,
        selectedRunId: chooseSelectedRunId(runs, state.selectedRunId ?? runId),
      };
    });
  },

  async createProfileRun(fileName, input = {}, options = {}) {
    set({ creating: true });
    try {
      const result = await optimizeProfile(fileName, input);
      return handleCreateResult(result, '\u5df2\u751f\u6210\u6a21\u677f\u4f18\u5316\u5efa\u8bae', set, options);
    } catch (error) {
      toast.error('\u751f\u6210\u6a21\u677f\u4f18\u5316\u5efa\u8bae\u5931\u8d25', { description: error instanceof Error ? error.message : undefined });
      await get().fetchRuns(true);
      return undefined;
    } finally {
      set({ creating: false });
    }
  },

  async createSkillRun(dirName, input = {}, options = {}) {
    set({ creating: true });
    try {
      const result = await optimizeSkill(dirName, input);
      return handleCreateResult(result, '\u5df2\u751f\u6210\u6280\u80fd\u4f18\u5316\u5efa\u8bae', set, options);
    } catch (error) {
      toast.error('\u751f\u6210\u6280\u80fd\u4f18\u5316\u5efa\u8bae\u5931\u8d25', { description: error instanceof Error ? error.message : undefined });
      await get().fetchRuns(true);
      return undefined;
    } finally {
      set({ creating: false });
    }
  },

  async createAgentRun(agentId, input = {}, options = {}) {
    set({ creating: true });
    try {
      const result = await optimizeAgent(agentId, input);
      return handleCreateResult(result, '\u5df2\u751f\u6210\u667a\u80fd\u4f53\u4f18\u5316\u5efa\u8bae', set, options);
    } catch (error) {
      toast.error('\u751f\u6210\u667a\u80fd\u4f53\u4f18\u5316\u5efa\u8bae\u5931\u8d25', { description: error instanceof Error ? error.message : undefined });
      await get().fetchRuns(true);
      return undefined;
    } finally {
      set({ creating: false });
    }
  },

  async applyRun(runId, suggestionKey) {
    set({ acting: true });
    try {
      const next = await applyOptimizationRun(runId, suggestionKey);
      set((state) => ({
        runs: upsertRun(state.runs, next),
        selectedRunId: next.run.id,
      }));
      await refreshRelatedResources(next);
      toast.success(suggestionKey ? '\u5df2\u5e94\u7528\u5efa\u8bae' : '\u5df2\u5e94\u7528\u5168\u90e8\u5efa\u8bae');
    } catch (error) {
      toast.error('\u5e94\u7528\u5efa\u8bae\u5931\u8d25', { description: error instanceof Error ? error.message : undefined });
    } finally {
      set({ acting: false });
    }
  },

  async rejectRun(runId, suggestionKey) {
    set({ acting: true });
    try {
      const next = await rejectOptimizationRun(runId, suggestionKey);
      set((state) => ({
        runs: upsertRun(state.runs, next),
        selectedRunId: next.run.id,
      }));
      toast.success(suggestionKey ? '\u5df2\u62d2\u7edd\u5efa\u8bae' : '\u5df2\u62d2\u7edd\u5168\u90e8\u5efa\u8bae');
    } catch (error) {
      toast.error('\u62d2\u7edd\u5efa\u8bae\u5931\u8d25', { description: error instanceof Error ? error.message : undefined });
    } finally {
      set({ acting: false });
    }
  },

  async deleteRun(runId) {
    set({ acting: true });
    try {
      await deleteOptimizationRun(runId);
      set((state) => {
        const runs = state.runs.filter((run) => run.run.id !== runId);
        return {
          runs,
          selectedRunId: chooseSelectedRunId(runs, state.selectedRunId === runId ? null : state.selectedRunId),
        };
      });
      toast.success('\u5df2\u5220\u9664\u4f18\u5316\u8bb0\u5f55');
    } catch (error) {
      toast.error('\u5220\u9664\u4f18\u5316\u8bb0\u5f55\u5931\u8d25', { description: error instanceof Error ? error.message : undefined });
    } finally {
      set({ acting: false });
    }
  },
}));
