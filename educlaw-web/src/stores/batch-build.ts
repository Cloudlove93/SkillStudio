import { create } from 'zustand';
import type { AgentConfig } from '@educlaw/shared';
import * as api from '../api/manager';
import type { GenerateProfileEvent } from '../api/manager';
import { useAgentStore } from './agent';
import { useLibraryStore } from './library';
import { useSettingsStore } from './settings';
import type { BuiltSkillArtifact, LogEntry, ProfilePreview, SkillPreview } from './build';

export type FileBuildStatus = 'pending' | 'building' | 'done' | 'error';

export interface FileBuildState {
  fileId: string;
  fileName: string;
  fileSize: number;
  file: File;
  status: FileBuildStatus;
  logs: LogEntry[];
  streamingText: string;
  isStreaming: boolean;
  isWaitingLLM: boolean;
  profilePreview: ProfilePreview | null;
  skillPreview: SkillPreview | null;
  resultAgent: AgentConfig | null;
  resultSkill: BuiltSkillArtifact | null;
  projectCreated: boolean;
}

interface BatchBuildStore {
  items: Map<string, FileBuildState>;
  queue: string[];
  activeFileId: string | null;
  selectedFileId: string | null;
  batchModel: string | undefined;
  allDone: boolean;
  active: boolean;

  reset: () => void;
  startBatch: (files: File[], model: string | undefined) => void;
  selectFile: (fileId: string) => void;
  createProject: (fileId: string) => void;
}

function makeFileId(file: File, index: number): string {
  return `${index}-${file.name}`;
}

function updateFileState(
  set: (fn: (s: BatchBuildStore) => Partial<BatchBuildStore>) => void,
  fileId: string,
  updater: (state: FileBuildState) => Partial<FileBuildState>,
) {
  set((s) => {
    const item = s.items.get(fileId);
    if (!item) return {};
    const newItems = new Map(s.items);
    newItems.set(fileId, { ...item, ...updater(item) });
    return { items: newItems };
  });
}

function handleFileBuildEvent(
  evt: GenerateProfileEvent,
  fileId: string,
  set: (fn: (s: BatchBuildStore) => Partial<BatchBuildStore>) => void,
  get: () => BatchBuildStore,
) {
  switch (evt.event) {
    case 'step':
      updateFileState(set, fileId, (s) => ({
        isStreaming: false,
        isWaitingLLM: false,
        logs: [...s.logs, { type: 'step', message: evt.data.message as string }],
      }));
      break;
    case 'llm_waiting':
      updateFileState(set, fileId, () => ({ isWaitingLLM: true, streamingText: '' }));
      break;
    case 'llm_streaming':
      updateFileState(set, fileId, () => ({ isWaitingLLM: false, isStreaming: true }));
      break;
    case 'delta':
      updateFileState(set, fileId, (s) => ({
        isStreaming: true,
        isWaitingLLM: false,
        streamingText: s.streamingText + (evt.data.text as string),
      }));
      break;
    case 'artifact_decision':
      updateFileState(set, fileId, (s) => ({
        isStreaming: false,
        streamingText: '',
        logs: [...s.logs, {
          type: 'decision',
          decision: {
            kind: evt.data.kind === 'skill' ? 'skill' : 'agent',
            reason: String(evt.data.reason || ''),
            suggestedName: typeof evt.data.suggestedName === 'string' ? evt.data.suggestedName : undefined,
            suggestedDescription: typeof evt.data.suggestedDescription === 'string' ? evt.data.suggestedDescription : undefined,
          },
        }],
      }));
      break;
    case 'profile_preview':
      updateFileState(set, fileId, () => ({
        isStreaming: false,
        streamingText: '',
        skillPreview: null,
        profilePreview: evt.data as unknown as ProfilePreview,
      }));
      break;
    case 'skill_preview':
      updateFileState(set, fileId, () => ({
        isStreaming: false,
        streamingText: '',
        profilePreview: null,
        skillPreview: evt.data as unknown as SkillPreview,
      }));
      break;
    case 'profile':
      updateFileState(set, fileId, (s) => ({
        isStreaming: false,
        isWaitingLLM: false,
        streamingText: '',
        profilePreview: null,
        skillPreview: null,
        logs: [...s.logs, { type: 'profile', profile: evt.data as LogEntry['profile'] }],
      }));
      break;
    case 'skill':
      updateFileState(set, fileId, (s) => ({
        isStreaming: false,
        isWaitingLLM: false,
        streamingText: '',
        logs: [...s.logs, {
          type: 'skill',
          skill: {
            dirName: typeof evt.data.dirName === 'string' ? evt.data.dirName : undefined,
            name: String(evt.data.name || ''),
            description: String(evt.data.description || ''),
            metadata: (evt.data.metadata as Record<string, unknown>) || undefined,
          },
        }],
      }));
      break;
    case 'done': {
      if (evt.data.kind === 'skill') {
        const skill = evt.data.skill as BuiltSkillArtifact;
        useLibraryStore.getState().fetchSkills(true);
        updateFileState(set, fileId, (s) => ({
          status: 'done',
          resultAgent: null,
          resultSkill: skill,
          logs: [...s.logs, { type: 'done', message: 'skill' }],
        }));
        processNext(set, get);
        break;
      }

      const agent = evt.data.agent as AgentConfig;
      useAgentStore.getState().fetchProfiles(true);
      useLibraryStore.getState().fetchSkills(true);
      updateFileState(set, fileId, (s) => ({
        status: 'done',
        resultAgent: agent,
        resultSkill: null,
        logs: [...s.logs, { type: 'done', message: 'agent' }],
      }));
      processNext(set, get);
      break;
    }
    case 'error':
      updateFileState(set, fileId, (s) => ({
        status: 'error',
        isStreaming: false,
        isWaitingLLM: false,
        streamingText: '',
        profilePreview: null,
        skillPreview: null,
        logs: [...s.logs, {
          type: 'error',
          message: evt.data.message as string,
          errorType: (evt.data.errorType as string) || undefined,
          detail: (evt.data.detail as string) || undefined,
        }],
      }));
      processNext(set, get);
      break;
  }
}

function processNext(
  set: (fn: (s: BatchBuildStore) => Partial<BatchBuildStore>) => void,
  get: () => BatchBuildStore,
) {
  const state = get();
  const nextQueue = [...state.queue];
  const nextId = nextQueue.shift();

  if (!nextId) {
    set(() => ({ activeFileId: null, queue: [], allDone: true }));
    return;
  }

  set(() => ({ activeFileId: nextId, queue: nextQueue, selectedFileId: nextId }));
  updateFileState(set, nextId, () => ({ status: 'building' }));

  const item = get().items.get(nextId);
  if (!item) return;

  const { enabledPublicSkills } = useSettingsStore.getState();
  api.generateProfileFromFile(
    item.file,
    state.batchModel,
    (evt) => handleFileBuildEvent(evt, nextId, set, get),
    enabledPublicSkills ?? undefined,
  ).catch((err) => {
    const msg = err.message || '';
    const msgLower = msg.toLowerCase();
    const isNetwork = msgLower.includes('fetch') || msgLower.includes('failed') || msgLower.includes('network');
    updateFileState(set, nextId, (s) => ({
      status: 'error',
      isStreaming: false,
      isWaitingLLM: false,
      logs: [...s.logs, {
        type: 'error',
        message: isNetwork ? 'network_error' : (msg || 'unknown_error'),
        errorType: isNetwork ? 'network' : 'unexpected',
        detail: msg || undefined,
      }],
    }));
    processNext(set, get);
  });
}

const initialState = {
  items: new Map<string, FileBuildState>(),
  queue: [] as string[],
  activeFileId: null as string | null,
  selectedFileId: null as string | null,
  batchModel: undefined as string | undefined,
  allDone: false,
  active: false,
};

export const useBatchBuildStore = create<BatchBuildStore>((set, get) => ({
  ...initialState,

  reset() {
    set({ ...initialState, items: new Map() });
  },

  startBatch(files: File[], model: string | undefined) {
    const items = new Map<string, FileBuildState>();
    const queue: string[] = [];

    files.forEach((file, i) => {
      const id = makeFileId(file, i);
      items.set(id, {
        fileId: id,
        fileName: file.name,
        fileSize: file.size,
        file,
        status: 'pending',
        logs: [],
        streamingText: '',
        isStreaming: false,
        isWaitingLLM: false,
        profilePreview: null,
        skillPreview: null,
        resultAgent: null,
        resultSkill: null,
        projectCreated: false,
      });
      queue.push(id);
    });

    set({
      items,
      queue,
      activeFileId: null,
      selectedFileId: queue[0] ?? null,
      batchModel: model,
      allDone: false,
      active: true,
    });

    processNext(set, get);
  },

  selectFile(fileId: string) {
    set({ selectedFileId: fileId });
  },

  createProject(fileId: string) {
    const item = get().items.get(fileId);
    if (!item || !item.resultAgent || item.projectCreated) return;
    const agent = item.resultAgent;
    useAgentStore.setState((s) => ({ agents: [...s.agents, agent] }));
    useAgentStore.getState().fetchProfiles(true);
    const newItems = new Map(get().items);
    newItems.set(fileId, { ...item, projectCreated: true });
    set({ items: newItems });
  },
}));
