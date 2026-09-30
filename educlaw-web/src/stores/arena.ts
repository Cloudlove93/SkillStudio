import { create } from 'zustand';
import { toast } from 'sonner';
import type {
  ArenaChatMessage,
  ArenaChatSession,
  ArenaChatSessionView,
  ArenaChatStreamEvent,
  ArenaRequestInput,
  ArenaRunView,
  OptimizationRequestInput,
  OptimizationRunView,
  OptimizationTargetKind,
} from '../api/manager';
import {
  createArenaChatProfileSession,
  createArenaChatSkillSession,
  createArenaChatAgentSession,
  createArenaReportFromSession,
  deleteArenaChatSession,
  getArenaChatSession,
  listArenaChatSessions,
  sendArenaChatMessageStream,
} from '../api/manager';
import { useUIStore } from './ui';
import { useOptimizeStore } from './optimize';

export type ArenaSidePhase = 'idle' | 'streaming' | 'done' | 'error';

function openArenaPanel() {
  const ui = useUIStore.getState();
  ui.setMainView('deep-study');
  ui.setDeepStudyTab('arena');
}

function upsertSession(sessions: ArenaChatSession[], next: ArenaChatSession): ArenaChatSession[] {
  return [next, ...sessions.filter((session) => session.id !== next.id)].sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
  );
}

function clampText(text: string, maxLength = 1500): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength)}\n...[\u5185\u5bb9\u5df2\u622a\u65ad]`;
}

function buildOptimizationInput(report: ArenaRunView, session: ArenaChatSessionView | null): OptimizationRequestInput {
  const dimensionLines = report.evaluation_spec.dimensions.map((dimension) => {
    const baseline = report.baseline.dimensions.find((item) => item.key === dimension.key);
    const enhanced = report.enhanced.dimensions.find((item) => item.key === dimension.key);
    return [
      `- ${dimension.name}`,
      `  baseline: ${baseline?.score ?? 0}/${baseline?.maxScore ?? dimension.scale}`,
      `  enhanced: ${enhanced?.score ?? 0}/${enhanced?.maxScore ?? dimension.scale}`,
      `  threshold: ${dimension.passThreshold ?? '-'}`,
      `  enhanced issue: ${enhanced?.reason ?? '\u672a\u63d0\u4f9b'}`,
    ].join('\n');
  });

  const sharedTurns = session?.messages.filter((message) => message.side === 'shared' && message.role === 'user') ?? [];
  const latestSharedTurn = sharedTurns[sharedTurns.length - 1] ?? null;
  const latestEnhancedReply = latestSharedTurn
    ? session?.messages.find((message) => message.side === 'enhanced' && message.role === 'assistant' && message.turn_index === latestSharedTurn.turn_index) ?? null
    : null;

  return {
    instruction: [
      '\u8bf7\u4e25\u683c\u57fa\u4e8e\u4ee5\u4e0b Arena \u62a5\u544a\u751f\u6210\u53ef\u76f4\u63a5\u5e94\u7528\u7684\u4f18\u5316\u5efa\u8bae\uff0c\u53ea\u5728\u786e\u5b9e\u80fd\u5f62\u6210 patch \u65f6\u8fd4\u56de\u5efa\u8bae\u3002',
      `\u4f18\u5316\u76ee\u6807\uff1a${report.report.optimizeInstruction}`,
      `\u603b\u4f53\u5efa\u8bae\uff1a${report.report.recommendation}`,
      `\u603b\u5206\u5bf9\u6bd4\uff1abaseline ${report.baseline.totalScore.toFixed(2)}\uff0cenhanced ${report.enhanced.totalScore.toFixed(2)}\uff0cdelta ${report.report.delta.toFixed(2)}`,
      report.report.weakestDimensions.length > 0 ? `\u4f18\u5148\u4fee\u590d\u7ef4\u5ea6\uff1a${report.report.weakestDimensions.join('\u3001')}` : '',
      report.report.strongestDimensions.length > 0 ? `\u5f53\u524d\u8868\u73b0\u8f83\u5f3a\u7ef4\u5ea6\uff1a${report.report.strongestDimensions.join('\u3001')}` : '',
      dimensionLines.length > 0 ? `\u7ef4\u5ea6\u660e\u7ec6\uff1a\n${dimensionLines.join('\n')}` : '',
      latestSharedTurn ? `\u6700\u8fd1\u4e00\u6b21 Arena \u7528\u6237\u8f93\u5165\uff1a\n${clampText(latestSharedTurn.content, 800)}` : '',
      latestEnhancedReply ? `\u6700\u8fd1\u4e00\u6b21\u589e\u5f3a\u7248\u56de\u7b54\uff1a\n${clampText(latestEnhancedReply.content, 1200)}` : '',
      '\u8bf7\u4f18\u5148\u8f93\u51fa\u80fd\u76f4\u63a5\u6539\u8fdb\u5f53\u524d\u7528\u6237\u79c1\u6709 skill / profile / agent \u7684\u53ef\u786e\u8ba4 patch\u3002',
    ].filter(Boolean).join('\n\n'),
    chatContext: latestSharedTurn
      ? [
          { role: 'user', content: clampText(latestSharedTurn.content, 800) },
          ...(latestEnhancedReply ? [{ role: 'assistant' as const, content: clampText(latestEnhancedReply.content, 1200) }] : []),
        ]
      : undefined,
    model: report.run.model ?? undefined,
  };
}

function buildTempMessage(id: string, sessionId: string, userId: string, side: 'shared' | 'baseline' | 'enhanced', role: 'user' | 'assistant', content: string, turnIndex: number): ArenaChatMessage {
  return {
    id,
    arena_session_id: sessionId,
    user_id: userId,
    side,
    role,
    content,
    turn_index: turnIndex,
    created_at: new Date().toISOString(),
  };
}

function replaceTurnMessages(messages: ArenaChatMessage[], turnIndex: number, nextMessages: ArenaChatMessage[]): ArenaChatMessage[] {
  return [
    ...messages.filter((message) => message.turn_index !== turnIndex),
    ...nextMessages,
  ].sort((a, b) => {
    if (a.turn_index !== b.turn_index) return a.turn_index - b.turn_index;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });
}

interface SideStates {
  baseline: ArenaSidePhase;
  enhanced: ArenaSidePhase;
}

interface SideErrors {
  baseline: string | null;
  enhanced: string | null;
}

const idleSideStates: SideStates = { baseline: 'idle', enhanced: 'idle' };
const emptySideErrors: SideErrors = { baseline: null, enhanced: null };

interface ArenaStore {
  sessions: ArenaChatSession[];
  selectedSessionId: string | null;
  selectedSession: ArenaChatSessionView | null;
  latestReport: ArenaRunView | null;
  latestOptimizationRunId: string | null;
  sideStates: SideStates;
  sideErrors: SideErrors;
  loading: boolean;
  creating: boolean;
  sending: boolean;
  reporting: boolean;
  optimizing: boolean;
  deleting: boolean;
  fetchSessions: () => Promise<void>;
  openSession: (sessionId: string) => Promise<void>;
  setSelectedSessionId: (sessionId: string | null) => void;
  createProfileSession: (fileName: string, input?: { model?: string }) => Promise<ArenaChatSessionView | undefined>;
  createSkillSession: (dirName: string, input?: { model?: string }) => Promise<ArenaChatSessionView | undefined>;
  createAgentSession: (agentId: string, input?: { model?: string }) => Promise<ArenaChatSessionView | undefined>;
  sendMessage: (sessionId: string, input: ArenaRequestInput) => Promise<void>;
  generateReport: (sessionId: string, input?: { model?: string }) => Promise<void>;
  sendLatestReportToOptimize: () => Promise<OptimizationRunView | undefined>;
  deleteSession: (sessionId: string) => Promise<void>;
}

export const useArenaStore = create<ArenaStore>((set, get) => ({
  sessions: [],
  selectedSessionId: null,
  selectedSession: null,
  latestReport: null,
  latestOptimizationRunId: null,
  sideStates: idleSideStates,
  sideErrors: emptySideErrors,
  loading: false,
  creating: false,
  sending: false,
  reporting: false,
  optimizing: false,
  deleting: false,

  async fetchSessions() {
    set({ loading: true });
    try {
      const sessions = await listArenaChatSessions();
      set((state) => ({
        sessions,
        selectedSessionId: state.selectedSessionId && sessions.some((item) => item.id === state.selectedSessionId)
          ? state.selectedSessionId
          : sessions[0]?.id ?? null,
      }));
    } finally {
      set({ loading: false });
    }
  },

  async openSession(sessionId) {
    const detail = await getArenaChatSession(sessionId);
    set((state) => ({
      selectedSessionId: sessionId,
      selectedSession: detail,
      sessions: upsertSession(state.sessions, detail.session),
      sideStates: idleSideStates,
      sideErrors: emptySideErrors,
    }));
    openArenaPanel();
  },

  setSelectedSessionId(sessionId) {
    set({ selectedSessionId: sessionId, sideStates: idleSideStates, sideErrors: emptySideErrors });
  },

  async createProfileSession(fileName, input = {}) {
    set({ creating: true });
    try {
      const detail = await createArenaChatProfileSession(fileName, input);
      openArenaPanel();
      set((state) => ({
        sessions: upsertSession(state.sessions, detail.session),
        selectedSessionId: detail.session.id,
        selectedSession: detail,
        latestReport: null,
        latestOptimizationRunId: null,
        sideStates: idleSideStates,
        sideErrors: emptySideErrors,
      }));
      return detail;
    } catch (error) {
      toast.error('Arena report generation failed', { description: error instanceof Error ? error.message : undefined });
      return undefined;
    } finally {
      set({ creating: false });
    }
  },

  async createSkillSession(dirName, input = {}) {
    set({ creating: true });
    try {
      const detail = await createArenaChatSkillSession(dirName, input);
      openArenaPanel();
      set((state) => ({
        sessions: upsertSession(state.sessions, detail.session),
        selectedSessionId: detail.session.id,
        selectedSession: detail,
        latestReport: null,
        latestOptimizationRunId: null,
        sideStates: idleSideStates,
        sideErrors: emptySideErrors,
      }));
      return detail;
    } catch (error) {
      toast.error('\u521b\u5efa Arena \u4f1a\u8bdd\u5931\u8d25', { description: error instanceof Error ? error.message : undefined });
      return undefined;
    } finally {
      set({ creating: false });
    }
  },

  async createAgentSession(agentId, input = {}) {
    set({ creating: true });
    try {
      const detail = await createArenaChatAgentSession(agentId, input);
      openArenaPanel();
      set((state) => ({
        sessions: upsertSession(state.sessions, detail.session),
        selectedSessionId: detail.session.id,
        selectedSession: detail,
        latestReport: null,
        latestOptimizationRunId: null,
        sideStates: idleSideStates,
        sideErrors: emptySideErrors,
      }));
      return detail;
    } catch (error) {
      toast.error('\u521b\u5efa Arena \u4f1a\u8bdd\u5931\u8d25', { description: error instanceof Error ? error.message : undefined });
      return undefined;
    } finally {
      set({ creating: false });
    }
  },

  async sendMessage(sessionId, input) {
    const current = get().selectedSession;
    if (!current || current.session.id !== sessionId) {
      await get().openSession(sessionId);
    }
    const active = get().selectedSession;
    if (!active) return;

    const turnIndex = active.messages.filter((message) => message.side === 'shared' && message.role === 'user').length + 1;
    const tempUserId = `temp-user-${Date.now()}`;
    const tempBaselineId = `temp-baseline-${Date.now()}`;
    const tempEnhancedId = `temp-enhanced-${Date.now()}`;

    const tempMessages = [
      buildTempMessage(tempUserId, sessionId, active.session.user_id, 'shared', 'user', input.prompt, turnIndex),
      buildTempMessage(tempBaselineId, sessionId, active.session.user_id, 'baseline', 'assistant', '', turnIndex),
      buildTempMessage(tempEnhancedId, sessionId, active.session.user_id, 'enhanced', 'assistant', '', turnIndex),
    ];

    set((state) => ({
      sending: true,
      latestReport: null,
      latestOptimizationRunId: null,
      sideStates: { baseline: 'idle', enhanced: 'idle' },
      sideErrors: { baseline: null, enhanced: null },
      selectedSession: state.selectedSession && state.selectedSession.session.id === sessionId
        ? { ...state.selectedSession, messages: [...state.selectedSession.messages, ...tempMessages] }
        : state.selectedSession,
      sessions: state.selectedSession && state.selectedSession.session.id === sessionId
        ? upsertSession(state.sessions, { ...state.selectedSession.session, updated_at: new Date().toISOString() })
        : state.sessions,
    }));

    let streamError: Error | null = null;

    try {
      await sendArenaChatMessageStream(
        sessionId,
        { content: input.prompt, model: input.model },
        (event: ArenaChatStreamEvent) => {
          if (event.event === 'side_start') {
            set((state) => ({
              sideStates: { ...state.sideStates, [event.data.side]: 'streaming' },
              sideErrors: { ...state.sideErrors, [event.data.side]: null },
            }));
            return;
          }

          if (event.event === 'delta') {
            set((state) => {
              if (!state.selectedSession || state.selectedSession.session.id !== sessionId) {
                return {};
              }
              const targetId = event.data.side === 'baseline' ? tempBaselineId : tempEnhancedId;
              return {
                selectedSession: {
                  ...state.selectedSession,
                  messages: state.selectedSession.messages.map((message) => (
                    message.id === targetId
                      ? { ...message, content: `${message.content}${event.data.delta}` }
                      : message
                  )),
                },
                sideStates: { ...state.sideStates, [event.data.side]: 'streaming' },
              };
            });
            return;
          }

          if (event.event === 'side_done') {
            set((state) => {
              if (!state.selectedSession || state.selectedSession.session.id !== sessionId) {
                return {};
              }
              const targetId = event.data.side === 'baseline' ? tempBaselineId : tempEnhancedId;
              const isError = event.data.ok === false;
              return {
                selectedSession: {
                  ...state.selectedSession,
                  messages: state.selectedSession.messages.map((message) => (
                    message.id === targetId ? { ...message, content: event.data.content } : message
                  )),
                },
                sideStates: { ...state.sideStates, [event.data.side]: isError ? 'error' : 'done' },
                sideErrors: { ...state.sideErrors, [event.data.side]: isError ? (event.data.error || event.data.content || 'Arena reply failed') : null },
              };
            });
            return;
          }

          if (event.event === 'done') {
            set((state) => ({
              sessions: upsertSession(state.sessions, event.data.session),
              selectedSession: state.selectedSession && state.selectedSession.session.id === sessionId
                ? {
                    ...state.selectedSession,
                    session: event.data.session,
                    messages: replaceTurnMessages(state.selectedSession.messages, turnIndex, event.data.messages),
                  }
                : state.selectedSession,
            }));
            return;
          }

          if (event.event === 'error') {
            streamError = new Error(event.data.error || 'Arena stream failed');
            set((state) => ({
              sideStates: {
                baseline: state.sideStates.baseline === 'done' ? 'done' : 'error',
                enhanced: state.sideStates.enhanced === 'done' ? 'done' : 'error',
              },
              sideErrors: {
                baseline: state.sideStates.baseline === 'done' ? state.sideErrors.baseline : (event.data.error || 'Arena stream failed'),
                enhanced: state.sideStates.enhanced === 'done' ? state.sideErrors.enhanced : (event.data.error || 'Arena stream failed'),
              },
            }));
          }
        },
      );

      if (streamError) {
        throw streamError;
      }
    } catch (error) {
      set((state) => ({
        selectedSession: state.selectedSession && state.selectedSession.session.id === sessionId
          ? {
              ...state.selectedSession,
              messages: state.selectedSession.messages.filter((message) => message.turn_index !== turnIndex),
            }
          : state.selectedSession,
      }));
      toast.error('Arena session failed', { description: error instanceof Error ? error.message : undefined });
      return;
    } finally {
      set({ sending: false });
    }
  },

  async generateReport(sessionId, input = {}) {
    set({ reporting: true });
    try {
      const report = await createArenaReportFromSession(sessionId, input);
      set({ latestReport: report, latestOptimizationRunId: null });
      toast.success('Arena report generated');
    } catch (error) {
      toast.error('Arena report generation failed', { description: error instanceof Error ? error.message : undefined });
    } finally {
      set({ reporting: false });
    }
  },

  async sendLatestReportToOptimize() {
    const report = get().latestReport;
    if (!report) return undefined;

    set({ optimizing: true });
    try {
      const optimizeInput = buildOptimizationInput(report, get().selectedSession);
      const kind = report.run.target_kind as OptimizationTargetKind;
      let created: OptimizationRunView | undefined;
      if (kind === 'profile') {
        created = await useOptimizeStore.getState().createProfileRun(report.run.target_ref, optimizeInput, { openPanel: false });
      } else if (kind === 'skill') {
        created = await useOptimizeStore.getState().createSkillRun(report.run.target_ref, optimizeInput, { openPanel: false });
      } else {
        created = await useOptimizeStore.getState().createAgentRun(report.run.target_ref, optimizeInput, { openPanel: false });
      }
      set({ latestOptimizationRunId: created?.run.id ?? null });
      return created;
    } finally {
      set({ optimizing: false });
    }
  },

  async deleteSession(sessionId) {
    set({ deleting: true });
    try {
      await deleteArenaChatSession(sessionId);
      set((state) => {
        const sessions = state.sessions.filter((item) => item.id !== sessionId);
        const nextSelected = state.selectedSessionId === sessionId ? (sessions[0]?.id ?? null) : state.selectedSessionId;
        return {
          sessions,
          selectedSessionId: nextSelected,
          selectedSession: state.selectedSessionId === sessionId ? null : state.selectedSession,
          latestReport: state.selectedSessionId === sessionId ? null : state.latestReport,
          latestOptimizationRunId: state.selectedSessionId === sessionId ? null : state.latestOptimizationRunId,
          sideStates: state.selectedSessionId === sessionId ? idleSideStates : state.sideStates,
          sideErrors: state.selectedSessionId === sessionId ? emptySideErrors : state.sideErrors,
        };
      });
      toast.success('Arena report generated');
    } catch (error) {
      toast.error('\u5220\u9664 Arena \u4f1a\u8bdd\u5931\u8d25', { description: error instanceof Error ? error.message : undefined });
    } finally {
      set({ deleting: false });
    }
  },
}));

