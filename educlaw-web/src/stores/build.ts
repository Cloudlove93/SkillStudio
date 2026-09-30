import { create } from 'zustand';
import type { AgentConfig } from '@educlaw/shared';
import * as api from '../api/manager';
import type { GenerateProfileEvent } from '../api/manager';
import { useAgentStore } from './agent';
import { useLibraryStore } from './library';
import { useSettingsStore } from './settings';

interface ProfilePreview {
  name: string;
  description: string;
  details: string;
}

export interface ArtifactDecisionLog {
  kind: 'agent' | 'skill';
  reason: string;
  suggestedName?: string;
  suggestedDescription?: string;
}

export interface SkillPreview {
  name: string;
  description: string;
  skillMarkdown?: string;
  metadata?: Record<string, unknown>;
}

export interface BuiltSkillArtifact {
  dirName: string;
  name: string;
  description: string;
}

interface SkillLog {
  dirName?: string;
  name: string;
  description: string;
  metadata?: Record<string, unknown>;
}

interface LogEntry {
  type: 'step' | 'decision' | 'profile' | 'skill' | 'done' | 'error';
  message?: string;
  errorType?: string;
  detail?: string;
  decision?: ArtifactDecisionLog;
  profile?: { name: string; description: string; details: string; skills: string[] };
  skill?: SkillLog;
}

interface BuildStore {
  loading: boolean;
  logs: LogEntry[];
  finished: boolean;
  resultAgent: AgentConfig | null;
  resultSkill: BuiltSkillArtifact | null;
  streamingText: string;
  isStreaming: boolean;
  isWaitingLLM: boolean;
  profilePreview: ProfilePreview | null;
  skillPreview: SkillPreview | null;
  isDetailed: boolean;

  reset: () => void;
  startQuickBuild: (instruction: string, model: string | undefined) => void;
  startDetailedBuild: (file: File, model: string | undefined) => void;
}

function handleSSEEvent(
  evt: GenerateProfileEvent,
  isDetailed: boolean,
  set: (partial: Partial<BuildStore> | ((s: BuildStore) => Partial<BuildStore>)) => void,
) {
  switch (evt.event) {
    case 'step':
      set((s) => ({
        isStreaming: false,
        isWaitingLLM: false,
        logs: [...s.logs, { type: 'step', message: evt.data.message as string }],
      }));
      break;
    case 'llm_waiting':
      set({ isWaitingLLM: true, streamingText: '' });
      break;
    case 'llm_streaming':
      set({ isWaitingLLM: false, isStreaming: true });
      break;
    case 'delta':
      set((s) => ({
        isStreaming: true,
        isWaitingLLM: false,
        streamingText: s.streamingText + (evt.data.text as string),
      }));
      break;
    case 'artifact_decision':
      set((s) => ({
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
      set({
        isStreaming: false,
        streamingText: '',
        skillPreview: null,
        profilePreview: evt.data as unknown as ProfilePreview,
      });
      break;
    case 'skill_preview':
      set({
        isStreaming: false,
        streamingText: '',
        profilePreview: null,
        skillPreview: evt.data as unknown as SkillPreview,
      });
      break;
    case 'profile':
      set((s) => ({
        isStreaming: false,
        isWaitingLLM: false,
        streamingText: '',
        profilePreview: null,
        skillPreview: null,
        logs: [...s.logs, { type: 'profile', profile: evt.data as LogEntry['profile'] }],
      }));
      break;
    case 'skill':
      set((s) => ({
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
      const kind = evt.data.kind === 'skill' ? 'skill' : 'agent';
      if (kind === 'skill') {
        const skill = evt.data.skill as BuiltSkillArtifact;
        useLibraryStore.getState().fetchSkills(true);
        set((s) => ({
          resultAgent: null,
          resultSkill: skill,
          logs: [...s.logs, { type: 'done', message: 'skill' }],
          finished: true,
          loading: false,
        }));
        break;
      }

      const agent = evt.data.agent as AgentConfig;
      useAgentStore.getState().fetchProfiles(true);
      if (isDetailed) {
        useLibraryStore.getState().fetchSkills(true);
      }
      set((s) => ({
        resultAgent: agent,
        resultSkill: null,
        logs: [...s.logs, { type: 'done', message: 'agent' }],
        finished: true,
        loading: false,
      }));
      break;
    }
    case 'error':
      set((s) => ({
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
        finished: true,
        loading: false,
      }));
      break;
  }
}

function handleCatchError(
  err: unknown,
  set: (partial: Partial<BuildStore> | ((s: BuildStore) => Partial<BuildStore>)) => void,
) {
  const msg = err instanceof Error ? err.message : '';
  const msgLower = msg.toLowerCase();
  const isNetwork = msgLower.includes('fetch') || msgLower.includes('failed') || msgLower.includes('networkerror') || msgLower.includes('network error') || msgLower.includes('err_') || msgLower.includes('econnrefused') || msgLower.includes('etimedout') || msgLower.includes('abort');
  set((s) => ({
    logs: [...s.logs, {
      type: 'error',
      message: isNetwork ? 'network_error' : (msg || 'unknown_error'),
      errorType: isNetwork ? 'network' : 'unexpected',
      detail: msg || undefined,
    }],
    finished: true,
    loading: false,
  }));
}

const initialState = {
  loading: false,
  logs: [] as LogEntry[],
  finished: false,
  resultAgent: null as AgentConfig | null,
  resultSkill: null as BuiltSkillArtifact | null,
  streamingText: '',
  isStreaming: false,
  isWaitingLLM: false,
  profilePreview: null as ProfilePreview | null,
  skillPreview: null as SkillPreview | null,
  isDetailed: false,
};

export const useBuildStore = create<BuildStore>((set) => ({
  ...initialState,

  reset() {
    set(initialState);
  },

  startQuickBuild(instruction: string, model: string | undefined) {
    set({
      ...initialState,
      loading: true,
      isDetailed: false,
    });
    const { enabledPublicSkills } = useSettingsStore.getState();
    api.generateProfile(
      instruction,
      model,
      (evt) => handleSSEEvent(evt, false, set),
      enabledPublicSkills ?? undefined,
    ).catch((err) => {
      handleCatchError(err, set);
    });
  },

  startDetailedBuild(file: File, model: string | undefined) {
    set({
      ...initialState,
      loading: true,
      isDetailed: true,
    });
    const { enabledPublicSkills } = useSettingsStore.getState();
    api.generateProfileFromFile(
      file,
      model,
      (evt) => handleSSEEvent(evt, true, set),
      enabledPublicSkills ?? undefined,
    ).catch((err) => {
      handleCatchError(err, set);
    });
  },
}));

export type { LogEntry, ProfilePreview };
