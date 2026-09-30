import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useArenaStore } from '../../stores/arena';
import { useAgentStore, isOwnedAgent } from '../../stores/agent';
import { useLibraryStore } from '../../stores/library';
import { useUIStore } from '../../stores/ui';
import { useOptimizeStore } from '../../stores/optimize';
import * as api from '../../api/manager';

const TEXT = {
  highRisk: '\u9ad8\u98ce\u9669',
  mediumRisk: '\u4e2d\u98ce\u9669',
  lowRisk: '\u4f4e\u98ce\u9669',
  statusApplied: '\u5df2\u5e94\u7528',
  statusRejected: '\u5df2\u62d2\u7edd',
  statusFailed: '\u5931\u8d25',
  statusPartial: '\u90e8\u5206\u5904\u7406',
  statusPending: '\u5f85\u5904\u7406',
  generating: '\u6b63\u5728\u751f\u6210...',
  emptyMessages: '\u6682\u65e0\u5bf9\u8bdd',
  title: 'Arena \u5bf9\u8bdd',
  subtitle:
    '\u540c\u4e00\u4e2a\u8f93\u5165\u540c\u65f6\u53d1\u5f80 baseline \u4e0e\u589e\u5f3a\u7248\uff0c\u53cc\u680f\u5b9e\u65f6\u5bf9\u6bd4\uff0c\u652f\u6301\u6d41\u5f0f\u56de\u590d\u3001\u751f\u6210\u62a5\u544a\u548c\u57fa\u4e8e\u62a5\u544a\u7684\u4f18\u5316\u3002',
  refresh: '\u5237\u65b0',
  createSession: '\u521b\u5efa\u4f1a\u8bdd',
  createSessionTitle: '\u65b0\u5efa Arena \u4f1a\u8bdd',
  selectTarget: '\u9009\u62e9\u76ee\u6807',
  sessionList: '\u4f1a\u8bdd\u5217\u8868',
  emptyState:
    '\u5148\u4ece\u5de6\u4fa7\u9009\u62e9\u6216\u521b\u5efa\u4e00\u4e2a Arena \u4f1a\u8bdd\u3002',
  deleteSession: '\u5220\u9664\u4f1a\u8bdd',
  generateReport: '\u751f\u6210\u62a5\u544a',
  optimizeFromReport: '\u57fa\u4e8e\u62a5\u544a\u751f\u6210\u5efa\u8bae',
  collapseReport: '\u6536\u8d77\u62a5\u544a',
  expandReport: '\u67e5\u770b\u62a5\u544a',
  collapseOptimization: '\u6536\u8d77\u4f18\u5316\u5efa\u8bae',
  expandOptimization: '\u67e5\u770b\u4f18\u5316\u5efa\u8bae',
  streamingHint:
    '\u6b63\u5728\u6d41\u5f0f\u751f\u6210\u4e24\u4fa7\u56de\u590d...',
  currentReport: '\u5f53\u524d\u62a5\u544a',
  dimension: '\u7ef4\u5ea6',
  reportDrivenOptimization: '\u62a5\u544a\u9a71\u52a8\u4f18\u5316\u5efa\u8bae',
  optimizationDesc:
    '\u8fd9\u91cc\u76f4\u63a5\u5c55\u793a\u57fa\u4e8e\u5f53\u524d Arena \u62a5\u544a\u751f\u6210\u7684 patch\uff0c\u53ef\u4ee5\u539f\u5730\u5e94\u7528\u6216\u62d2\u7edd\u3002',
  openOptimizePanel: '\u6253\u5f00\u5b8c\u6574\u9762\u677f',
  rejectAll: '\u5168\u90e8\u62d2\u7edd',
  applyAll: '\u5168\u90e8\u5e94\u7528',
  state: '\u72b6\u6001',
  suggestionCount: '\u5efa\u8bae\u6761\u6570',
  pendingCount: '\u5f85\u5904\u7406',
  reject: '\u62d2\u7edd',
  apply: '\u5e94\u7528',
  rationale: '\u5efa\u8bae\u7406\u7531',
  result: '\u5904\u7406\u7ed3\u679c',
  patchPreview: 'Patch \u9884\u89c8',
  inputPlaceholder:
    '\u8f93\u5165\u540c\u4e00\u4e2a\u95ee\u9898\uff0c\u540c\u65f6\u53d1\u9001\u5230 baseline \u548c\u589e\u5f3a\u7248\u3002',
  sendingHint:
    '\u6b63\u5728\u6d41\u5f0f\u56de\u590d\uff0c\u53ef\u4ee5\u76f4\u63a5\u89c2\u5bdf\u4e24\u4fa7\u8f93\u51fa\u3002',
  readyHint:
    '\u53d1\u9001\u540e\u5de6\u53f3\u4e24\u4fa7\u4f1a\u540c\u65f6\u751f\u6210\u56de\u590d\u3002',
  sendBoth: '\u540c\u65f6\u53d1\u9001\u5230\u4e24\u8fb9',
};

function formatTime(value: string) {
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? value : time.toLocaleString();
}

function riskTone(risk: 'low' | 'medium' | 'high') {
  if (risk === 'high') return 'border-red-500/20 bg-red-500/10 text-red-600';
  if (risk === 'medium')
    return 'border-amber-500/20 bg-amber-500/10 text-amber-600';
  return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600';
}

function riskLabel(risk: 'low' | 'medium' | 'high') {
  if (risk === 'high') return TEXT.highRisk;
  if (risk === 'medium') return TEXT.mediumRisk;
  return TEXT.lowRisk;
}

function statusTone(status: string) {
  if (status === 'applied')
    return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600';
  if (status === 'rejected')
    return 'border-slate-500/20 bg-slate-500/10 text-slate-600';
  if (status === 'failed')
    return 'border-red-500/20 bg-red-500/10 text-red-600';
  if (status === 'partial')
    return 'border-amber-500/20 bg-amber-500/10 text-amber-600';
  return 'border-primary/20 bg-primary/10 text-primary';
}

function statusLabel(status: string) {
  if (status === 'applied') return TEXT.statusApplied;
  if (status === 'rejected') return TEXT.statusRejected;
  if (status === 'failed') return TEXT.statusFailed;
  if (status === 'partial') return TEXT.statusPartial;
  return TEXT.statusPending;
}

function renderPatch(patchType: string, patch: Record<string, unknown>) {
  if (patchType === 'skill_markdown' && typeof patch.content === 'string') {
    return patch.content;
  }
  return JSON.stringify(patch, null, 2);
}

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1.5 py-2">
      <span className="size-1.5 rounded-full bg-primary/60 animate-bounce [animation-delay:0ms]" />
      <span className="size-1.5 rounded-full bg-primary/60 animate-bounce [animation-delay:150ms]" />
      <span className="size-1.5 rounded-full bg-primary/60 animate-bounce [animation-delay:300ms]" />
      <span className="ml-2 text-xs text-muted-foreground">
        {TEXT.generating}
      </span>
    </div>
  );
}

function SideColumn({
  title,
  messages,
  side,
  phase,
  error,
}: {
  title: string;
  messages: Array<{
    side: 'shared' | 'baseline' | 'enhanced';
    role: 'user' | 'assistant';
    content: string;
    id: string;
  }>;
  side: 'baseline' | 'enhanced';
  phase: 'idle' | 'streaming' | 'done' | 'error';
  error: string | null;
}) {
  const items = messages.filter(
    (message) => message.side === 'shared' || message.side === side,
  );
  return (
    <div className="flex min-h-0 flex-col rounded-[22px] border border-border/70 bg-card p-4 shadow-[var(--shadow-sm)]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-base font-semibold text-foreground">{title}</div>
        <div className="flex items-center gap-2">
          <div className="text-xs text-muted-foreground">
            {side === 'baseline' ? 'Baseline' : 'Enhanced'}
          </div>
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${phase === 'streaming' ? 'border-amber-500/20 bg-amber-500/10 text-amber-600' : phase === 'done' ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600' : phase === 'error' ? 'border-red-500/20 bg-red-500/10 text-red-600' : 'border-border/70 bg-muted/40 text-muted-foreground'}`}
          >
            {phase === 'streaming'
              ? '生成中'
              : phase === 'done'
                ? '已完成'
                : phase === 'error'
                  ? '失败'
                  : '等待中'}
          </span>
        </div>
      </div>
      {phase === 'error' && error && (
        <div className="mb-3 rounded-[14px] border border-red-500/20 bg-red-500/8 px-3 py-2 text-xs text-red-600">
          {error}
        </div>
      )}
      <div className="min-h-0 flex-1 space-y-3 overflow-auto pr-1">
        {items.length === 0 && (
          <div className="text-sm text-muted-foreground">
            {TEXT.emptyMessages}
          </div>
        )}
        {items.map((message) => {
          const isEmptyAssistant =
            message.role === 'assistant' &&
            message.side === side &&
            !message.content.trim();
          return (
            <div
              key={message.id}
              className={`rounded-[16px] px-4 py-3 text-sm leading-6 ${message.side === 'shared' ? 'bg-muted/30 text-foreground' : side === 'baseline' ? 'bg-slate-500/8 text-foreground' : 'bg-primary/8 text-foreground'}`}
            >
              <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {message.side === 'shared'
                  ? 'User'
                  : message.role === 'assistant'
                    ? 'Assistant'
                    : 'User'}
              </div>
              {isEmptyAssistant ? (
                <ThinkingDots />
              ) : (
                <div className="whitespace-pre-wrap break-words">
                  {message.content}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ScoreRow({
  name,
  baseline,
  enhanced,
}: {
  name: string;
  baseline: string;
  enhanced: string;
}) {
  const baselineScore = Number(baseline.split('/')[0] || 0);
  const enhancedScore = Number(enhanced.split('/')[0] || 0);
  const delta = enhancedScore - baselineScore;
  return (
    <tr className="border-b border-border/50 align-top">
      <td className="px-2 py-3 font-medium text-foreground">{name}</td>
      <td className="px-2 py-3 text-slate-500">{baseline}</td>
      <td className="px-2 py-3 text-primary">{enhanced}</td>
      <td
        className={`px-2 py-3 font-medium ${delta >= 0 ? 'text-emerald-600' : 'text-red-600'}`}
      >
        {delta.toFixed(2)}
      </td>
    </tr>
  );
}

export default function ArenaPanel() {
  const sessions = useArenaStore((s) => s.sessions);
  const selectedSessionId = useArenaStore((s) => s.selectedSessionId);
  const selectedSession = useArenaStore((s) => s.selectedSession);
  const latestReport = useArenaStore((s) => s.latestReport);
  const latestOptimizationRunId = useArenaStore(
    (s) => s.latestOptimizationRunId,
  );
  const loading = useArenaStore((s) => s.loading);
  const creating = useArenaStore((s) => s.creating);
  const sending = useArenaStore((s) => s.sending);
  const reporting = useArenaStore((s) => s.reporting);
  const optimizing = useArenaStore((s) => s.optimizing);
  const deleting = useArenaStore((s) => s.deleting);
  const fetchSessions = useArenaStore((s) => s.fetchSessions);
  const openSession = useArenaStore((s) => s.openSession);
  const createProfileSession = useArenaStore((s) => s.createProfileSession);
  const createSkillSession = useArenaStore((s) => s.createSkillSession);
  const createAgentSession = useArenaStore((s) => s.createAgentSession);
  const sendMessage = useArenaStore((s) => s.sendMessage);
  const generateReport = useArenaStore((s) => s.generateReport);
  const sendLatestReportToOptimize = useArenaStore(
    (s) => s.sendLatestReportToOptimize,
  );
  const deleteSession = useArenaStore((s) => s.deleteSession);

  const profiles = useAgentStore((s) => s.profiles);
  const agents = useAgentStore((s) => s.agents);
  const skills = useLibraryStore((s) => s.skills);
  const fetchProfiles = useAgentStore((s) => s.fetchProfiles);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const fetchSkills = useLibraryStore((s) => s.fetchSkills);
  const pendingArenaTarget = useUIStore((s) => s.pendingArenaTarget);
  const setPendingArenaTarget = useUIStore((s) => s.setPendingArenaTarget);

  const optimizationRuns = useOptimizeStore((s) => s.runs);
  const optimizationActing = useOptimizeStore((s) => s.acting);
  const applyOptimizationRun = useOptimizeStore((s) => s.applyRun);
  const rejectOptimizationRun = useOptimizeStore((s) => s.rejectRun);
  const openOptimizationRun = useOptimizeStore((s) => s.setSelectedRunId);

  const [targetKind, setTargetKind] = useState<'profile' | 'skill' | 'agent'>(
    'skill',
  );
  const [targetRef, setTargetRef] = useState('');
  const [input, setInput] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [models, setModels] = useState<{ name: string; modelName: string }[]>(
    [],
  );
  const [showReport, setShowReport] = useState(false);
  const [showOptimization, setShowOptimization] = useState(false);

  useEffect(() => {
    void fetchSessions();
    void fetchProfiles(true);
    void fetchAgents();
    void fetchSkills(true);
  }, [fetchSessions, fetchProfiles, fetchAgents, fetchSkills]);

  useEffect(() => {
    api.listLLMModels().then((list) => {
      setModels(list);
      if (list.length > 0 && !selectedModel) setSelectedModel(list[0].name);
    });
  }, [selectedModel]);

  useEffect(() => {
    if (pendingArenaTarget) {
      setTargetKind(pendingArenaTarget.kind);
      setTargetRef(pendingArenaTarget.ref);
      setPendingArenaTarget(null);
    }
  }, [pendingArenaTarget, setPendingArenaTarget]);

  const targetOptions = useMemo(() => {
    if (targetKind === 'profile')
      return profiles.map((profile) => ({
        value: profile.fileName,
        label: profile.name,
      }));
    if (targetKind === 'skill')
      return skills.map((skill) => ({
        value: skill.dirName,
        label: skill.name,
      }));
    return agents
      .filter((agent) => isOwnedAgent(agent))
      .map((agent) => ({ value: agent.id, label: agent.name }));
  }, [targetKind, profiles, skills, agents]);

  const sideStates = useArenaStore((s) => s.sideStates);
  const sideErrors = useArenaStore((s) => s.sideErrors);

  const latestOptimizationRun = useMemo(() => {
    if (!latestOptimizationRunId || !selectedSession) return null;
    return (
      optimizationRuns.find(
        (run) =>
          run.run.id === latestOptimizationRunId &&
          run.run.target_kind === selectedSession.session.target_kind &&
          run.run.target_ref === selectedSession.session.target_ref,
      ) ?? null
    );
  }, [latestOptimizationRunId, optimizationRuns, selectedSession]);

  useEffect(() => {
    if (
      latestReport &&
      selectedSession &&
      latestReport.run.target_ref === selectedSession.session.target_ref &&
      latestReport.run.target_kind === selectedSession.session.target_kind
    ) {
      setShowReport(true);
    }
  }, [latestReport, selectedSession]);

  useEffect(() => {
    if (latestOptimizationRun) {
      setShowOptimization(true);
    }
  }, [latestOptimizationRun]);

  const optimizationPendingCount =
    latestOptimizationRun?.items.filter((item) => item.status === 'pending')
      .length ?? 0;

  async function handleCreateSession() {
    if (!targetRef) return;
    if (targetKind === 'profile') {
      await createProfileSession(targetRef, {
        model: selectedModel || undefined,
      });
      return;
    }
    if (targetKind === 'skill') {
      await createSkillSession(targetRef, {
        model: selectedModel || undefined,
      });
      return;
    }
    await createAgentSession(targetRef, { model: selectedModel || undefined });
  }

  async function handleSend() {
    if (!selectedSessionId || !input.trim()) return;
    await sendMessage(selectedSessionId, {
      prompt: input.trim(),
      model: selectedModel || undefined,
    });
    setInput('');
  }

  const reportRows =
    latestReport?.evaluation_spec.dimensions.map((dimension) => {
      const baseline = latestReport.baseline.dimensions.find(
        (item) => item.key === dimension.key,
      );
      const enhanced = latestReport.enhanced.dimensions.find(
        (item) => item.key === dimension.key,
      );
      return {
        key: dimension.key,
        name: dimension.name,
        baseline: `${baseline?.score ?? 0}/${baseline?.maxScore ?? 100}`,
        enhanced: `${enhanced?.score ?? 0}/${enhanced?.maxScore ?? 100}`,
      };
    }) ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border/70 px-6 py-4">
        <div>
          <div className="text-lg font-semibold text-foreground">
            {TEXT.title}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {TEXT.subtitle}
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void fetchSessions()}
          disabled={
            loading ||
            creating ||
            sending ||
            reporting ||
            optimizing ||
            deleting
          }
          className="gap-1.5 rounded-full"
        >
          {loading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          {TEXT.refresh}
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <div className="border-b border-border/70 lg:border-b-0 lg:border-r lg:border-r-border/70">
          <div className="space-y-3 px-3 py-3">
            <div className="rounded-[18px] border border-border/70 bg-card p-4">
              <div className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {TEXT.createSessionTitle}
              </div>
              <div className="space-y-3">
                <select
                  value={targetKind}
                  onChange={(e) => {
                    setTargetKind(
                      e.target.value as 'profile' | 'skill' | 'agent',
                    );
                    setTargetRef('');
                  }}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
                >
                  <option value="skill">Skill</option>
                  <option value="profile">Profile</option>
                  <option value="agent">Agent</option>
                </select>
                <select
                  value={targetRef}
                  onChange={(e) => setTargetRef(e.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
                >
                  <option value="">{TEXT.selectTarget}</option>
                  {targetOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
                >
                  {models.map((model) => (
                    <option key={model.name} value={model.name}>
                      {model.name}
                    </option>
                  ))}
                </select>
                <Button
                  onClick={() => void handleCreateSession()}
                  disabled={creating || !targetRef}
                  className="w-full gap-1.5 rounded-full"
                >
                  {creating ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <BarChart3 className="size-3.5" />
                  )}
                  {TEXT.createSession}
                </Button>
              </div>
            </div>

            <div className="px-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {TEXT.sessionList}
            </div>
            <div className="space-y-2 overflow-auto pb-3">
              {sessions.map((session) => (
                <button
                  key={session.id}
                  onClick={() => void openSession(session.id)}
                  className={`w-full rounded-[18px] border px-4 py-3 text-left transition-colors ${selectedSession?.session.id === session.id ? 'border-primary/25 bg-primary/8' : 'border-border/70 bg-card hover:border-primary/20 hover:bg-muted/40'}`}
                >
                  <div className="truncate text-sm font-semibold text-foreground">
                    {session.target_label}
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {formatTime(session.updated_at)}
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {session.target_kind} / {session.target_scope}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="min-h-0 overflow-hidden px-4 py-4 sm:px-5">
          {!selectedSession && (
            <div className="flex h-full min-h-[320px] items-center justify-center rounded-[24px] border border-dashed border-border/70 bg-muted/20 px-6 text-center text-sm text-muted-foreground">
              {TEXT.emptyState}
            </div>
          )}

          {selectedSession && (
            <div className="flex h-full min-h-0 flex-col gap-3">
              <div className="card-premium shrink-0 rounded-[24px] px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-base font-semibold text-foreground">
                      {selectedSession.session.target_label}
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {selectedSession.session.target_kind} /{' '}
                      {selectedSession.session.target_scope}
                    </div>
                    <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                      {selectedSession.session.workspace_id && (
                        <div>
                          workspace:{' '}
                          <span className="font-mono">
                            {selectedSession.session.workspace_id}
                          </span>
                        </div>
                      )}
                      {selectedSession.session.baseline_session_id && (
                        <div>
                          baseline run:{' '}
                          <span className="font-mono">
                            {selectedSession.session.baseline_session_id}
                          </span>
                        </div>
                      )}
                      {selectedSession.session.enhanced_session_id && (
                        <div>
                          enhanced run:{' '}
                          <span className="font-mono">
                            {selectedSession.session.enhanced_session_id}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void deleteSession(selectedSession.session.id)
                      }
                      disabled={deleting}
                      className="gap-1.5 rounded-full"
                    >
                      <Trash2 className="size-3.5" />
                      {TEXT.deleteSession}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void generateReport(selectedSession.session.id, {
                          model: selectedModel || undefined,
                        })
                      }
                      disabled={
                        reporting ||
                        selectedSession.messages.length === 0 ||
                        sending
                      }
                      className="gap-1.5 rounded-full"
                    >
                      {reporting ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <BarChart3 className="size-3.5" />
                      )}
                      {TEXT.generateReport}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => void sendLatestReportToOptimize()}
                      disabled={!latestReport || optimizing || sending}
                      className="gap-1.5 rounded-full"
                    >
                      {optimizing ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="size-3.5" />
                      )}
                      {TEXT.optimizeFromReport}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="shrink-0 flex flex-wrap items-center gap-2">
                {latestReport &&
                  latestReport.run.target_ref ===
                    selectedSession.session.target_ref &&
                  latestReport.run.target_kind ===
                    selectedSession.session.target_kind && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowReport((value) => !value)}
                      className="gap-1.5 rounded-full"
                    >
                      {showReport ? (
                        <ChevronDown className="size-3.5" />
                      ) : (
                        <ChevronRight className="size-3.5" />
                      )}
                      {showReport ? TEXT.collapseReport : TEXT.expandReport}
                    </Button>
                  )}
                {latestOptimizationRun && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowOptimization((value) => !value)}
                    className="gap-1.5 rounded-full"
                  >
                    {showOptimization ? (
                      <ChevronDown className="size-3.5" />
                    ) : (
                      <ChevronRight className="size-3.5" />
                    )}
                    {showOptimization
                      ? TEXT.collapseOptimization
                      : TEXT.expandOptimization}
                  </Button>
                )}
                {sending && (
                  <span className="text-xs text-muted-foreground">
                    {TEXT.streamingHint}
                  </span>
                )}
              </div>

              {showReport &&
                latestReport &&
                latestReport.run.target_ref ===
                  selectedSession.session.target_ref &&
                latestReport.run.target_kind ===
                  selectedSession.session.target_kind && (
                  <div className="card-premium shrink-0 rounded-[24px] p-5 max-h-[12rem] overflow-auto">
                    <div className="mb-3 text-base font-semibold text-foreground">
                      {TEXT.currentReport}
                    </div>
                    <div className="grid gap-3 lg:grid-cols-3">
                      <div className="rounded-[18px] border border-border/70 bg-card px-4 py-3">
                        <div className="text-xs text-muted-foreground">
                          Baseline
                        </div>
                        <div className="mt-2 text-2xl font-semibold text-slate-500">
                          {latestReport.baseline.totalScore.toFixed(2)}
                        </div>
                      </div>
                      <div className="rounded-[18px] border border-border/70 bg-card px-4 py-3">
                        <div className="text-xs text-muted-foreground">
                          Enhanced
                        </div>
                        <div className="mt-2 text-2xl font-semibold text-primary">
                          {latestReport.enhanced.totalScore.toFixed(2)}
                        </div>
                      </div>
                      <div className="rounded-[18px] border border-border/70 bg-card px-4 py-3">
                        <div className="text-xs text-muted-foreground">
                          Delta
                        </div>
                        <div
                          className={`mt-2 text-2xl font-semibold ${latestReport.report.delta >= 0 ? 'text-emerald-600' : 'text-red-600'}`}
                        >
                          {latestReport.report.delta.toFixed(2)}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 rounded-[18px] border border-border/70 bg-muted/25 px-4 py-3 text-sm text-foreground">
                      {latestReport.report.recommendation}
                    </div>
                    <div className="mt-3 overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="border-b border-border text-left text-muted-foreground">
                            <th className="px-2 py-2">{TEXT.dimension}</th>
                            <th className="px-2 py-2">Baseline</th>
                            <th className="px-2 py-2">Enhanced</th>
                            <th className="px-2 py-2">Delta</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reportRows.map((row) => (
                            <ScoreRow
                              key={row.key}
                              name={row.name}
                              baseline={row.baseline}
                              enhanced={row.enhanced}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

              {showOptimization && latestOptimizationRun && (
                <div className="card-premium shrink-0 rounded-[24px] p-5 max-h-[16rem] overflow-auto">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="text-base font-semibold text-foreground">
                        {TEXT.reportDrivenOptimization}
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {TEXT.optimizationDesc}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          openOptimizationRun(latestOptimizationRun.run.id)
                        }
                        className="gap-1.5 rounded-full"
                      >
                        <ExternalLink className="size-3.5" />
                        {TEXT.openOptimizePanel}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={
                          optimizationActing || optimizationPendingCount === 0
                        }
                        onClick={() =>
                          void rejectOptimizationRun(
                            latestOptimizationRun.run.id,
                          )
                        }
                        className="gap-1.5 rounded-full"
                      >
                        <X className="size-3.5" />
                        {TEXT.rejectAll}
                      </Button>
                      <Button
                        size="sm"
                        disabled={
                          optimizationActing || optimizationPendingCount === 0
                        }
                        onClick={() =>
                          void applyOptimizationRun(
                            latestOptimizationRun.run.id,
                          )
                        }
                        className="gap-1.5 rounded-full"
                      >
                        <Check className="size-3.5" />
                        {TEXT.applyAll}
                      </Button>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-3 lg:grid-cols-3">
                    <div className="rounded-[18px] border border-border/70 bg-card px-4 py-3">
                      <div className="text-xs text-muted-foreground">
                        {TEXT.state}
                      </div>
                      <div
                        className={`mt-2 inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${statusTone(latestOptimizationRun.run.status)}`}
                      >
                        {statusLabel(latestOptimizationRun.run.status)}
                      </div>
                    </div>
                    <div className="rounded-[18px] border border-border/70 bg-card px-4 py-3">
                      <div className="text-xs text-muted-foreground">
                        {TEXT.suggestionCount}
                      </div>
                      <div className="mt-2 text-2xl font-semibold text-foreground">
                        {latestOptimizationRun.items.length}
                      </div>
                    </div>
                    <div className="rounded-[18px] border border-border/70 bg-card px-4 py-3">
                      <div className="text-xs text-muted-foreground">
                        {TEXT.pendingCount}
                      </div>
                      <div className="mt-2 text-2xl font-semibold text-primary">
                        {optimizationPendingCount}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 space-y-4">
                    {latestOptimizationRun.items.map((item) => (
                      <div
                        key={item.id}
                        className="rounded-[20px] border border-border/70 bg-card p-4"
                      >
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-base font-semibold text-foreground">
                                {item.title}
                              </div>
                              <span
                                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${riskTone(item.risk)}`}
                              >
                                {riskLabel(item.risk)}
                              </span>
                              <span
                                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusTone(item.status)}`}
                              >
                                {statusLabel(item.status)}
                              </span>
                            </div>
                            <div className="mt-2 text-sm leading-6 text-muted-foreground">
                              {item.preview}
                            </div>
                          </div>
                          {item.status === 'pending' && (
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={optimizationActing}
                                onClick={() =>
                                  void rejectOptimizationRun(
                                    latestOptimizationRun.run.id,
                                    item.suggestion_key,
                                  )
                                }
                                className="gap-1.5 rounded-full"
                              >
                                <X className="size-3.5" />
                                {TEXT.reject}
                              </Button>
                              <Button
                                size="sm"
                                disabled={optimizationActing}
                                onClick={() =>
                                  void applyOptimizationRun(
                                    latestOptimizationRun.run.id,
                                    item.suggestion_key,
                                  )
                                }
                                className="gap-1.5 rounded-full"
                              >
                                <Check className="size-3.5" />
                                {TEXT.apply}
                              </Button>
                            </div>
                          )}
                        </div>
                        <div className="mt-3 grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
                          <div className="rounded-[18px] border border-border/70 bg-muted/25 px-4 py-3">
                            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                              {TEXT.rationale}
                            </div>
                            <div className="text-sm leading-6 text-foreground/90">
                              {item.rationale || '-'}
                            </div>
                          </div>
                          <div className="rounded-[18px] border border-border/70 bg-muted/25 px-4 py-3">
                            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                              {TEXT.result}
                            </div>
                            <div className="text-sm leading-6 text-foreground/90">
                              {item.result_note || '-'}
                            </div>
                          </div>
                        </div>
                        <div className="mt-3 rounded-[18px] border border-border/70 bg-background px-4 py-3">
                          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                            <ChevronRight className="size-3.5" />
                            {TEXT.patchPreview}
                          </div>
                          <pre className="max-h-[12rem] overflow-auto whitespace-pre-wrap break-words rounded-[14px] bg-muted/40 p-3 text-xs leading-6 text-foreground">
                            {renderPatch(item.patch_type, item.patch)}
                          </pre>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-2">
                <SideColumn
                  title="Baseline"
                  messages={selectedSession.messages}
                  side="baseline"
                  phase={sideStates.baseline}
                  error={sideErrors.baseline}
                />
                <SideColumn
                  title="Enhanced"
                  messages={selectedSession.messages}
                  side="enhanced"
                  phase={sideStates.enhanced}
                  error={sideErrors.enhanced}
                />
              </div>

              <div className="card-premium shrink-0 rounded-[24px] p-4">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  rows={3}
                  placeholder={TEXT.inputPlaceholder}
                />
                <div className="mt-3 flex items-center justify-between gap-3">
                  <div className="text-xs text-muted-foreground">
                    {sending ? TEXT.sendingHint : TEXT.readyHint}
                  </div>
                  <Button
                    onClick={() => void handleSend()}
                    disabled={sending || !input.trim()}
                    className="gap-1.5 rounded-full"
                  >
                    {sending ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="size-3.5" />
                    )}
                    {TEXT.sendBoth}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
