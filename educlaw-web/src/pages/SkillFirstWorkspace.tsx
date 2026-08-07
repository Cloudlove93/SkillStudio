import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type {
  ArenaThread,
  GuidedCreationDocument,
  GuidedCreationSession,
  GuidedCreationSessionDetail,
  SkillVersionDetail,
} from '@educlaw/shared';
import { toast } from 'sonner';
import { liteApi, type GuidedCreationSseEvent } from '../api/lite-api';
import { useAuthStore } from '../stores/auth';
import { GuidedSkillCreationPanel } from '../components/skill-workspace/GuidedSkillCreationPanel';
import { DocumentSkillCreationPanel } from '../components/skill-workspace/DocumentSkillCreationPanel';
import { StructuredSkillCreationPanel } from '../components/skill-workspace/StructuredSkillCreationPanel';
import { SkillImportDialog } from '../components/skill-workspace/SkillImportDialog';
import {
  isGuidedFinalizationStale,
  isGuidedRunVisible,
} from '../components/skill-workspace/guided-creation-state';
import {
  createPendingGuidedMessage,
  type PendingGuidedMessage,
} from '../components/skill-workspace/guided-optimistic-message';
import { SkillContextPanel } from '../components/skill-workspace/SkillContextPanel';
import {
  SkillWorkspaceSidebar,
  type SkillCreateAction,
  type SkillCreateMode,
  type SkillMenuAction,
} from '../components/skill-workspace/SkillWorkspaceSidebar';
import { SkillPinnedUpdate } from '../components/skill-workspace/SkillPinnedUpdate';
import {
  SkillDetailWorkspace,
  type SkillDetailSelection,
} from '../components/skill-workspace/SkillDetailWorkspace';
import {
  SkillRepositoryWorkspace,
  type RepositorySkill,
} from '../components/skill-workspace/SkillRepositoryWorkspace';
import {
  createSkillWorkspaceState,
  skillWorkspaceReducer,
  type SkillPinnedUpdate as SkillPinnedUpdateValue,
} from '../components/skill-workspace/skill-workspace-state';
import '../components/skill-workspace/skill-workspace.css';
import type {
  AnswerOptimizationRerunRequest,
  AnswerOptimizationSelection,
} from '../components/skill-workspace/answer-optimization-selection';
import { isSkillConversationThread } from '../components/skill-workspace/skill-conversation-list';

type StreamError = { code: string; message: string; retryable: boolean };

function createRequestId(prefix: string) {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function SkillFirstWorkspace() {
  const token = useAuthStore((state) => state.token) || '';
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const [sessions, setSessions] = useState<GuidedCreationSession[]>([]);
  const [repositorySkills, setRepositorySkills] = useState<RepositorySkill[]>([]);
  const [session, setSession] = useState<GuidedCreationSessionDetail | null>(null);
  const [pendingGuidedMessage, setPendingGuidedMessage] =
    useState<PendingGuidedMessage | null>(null);
  const [selectedRepositorySkill, setSelectedRepositorySkill] = useState<RepositorySkill | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<GuidedCreationDocument[]>([]);
  const [search, setSearch] = useState('');
  const [createMode, setCreateMode] = useState<SkillCreateMode>('conversation');
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [workspaceState, dispatchWorkspace] = useReducer(
    skillWorkspaceReducer,
    undefined,
    createSkillWorkspaceState,
  );
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Array<{ path: string; content: string }>>([]);
  const [error, setError] = useState<StreamError | null>(null);
  const [versions, setVersions] = useState<SkillVersionDetail[]>([]);
  const [currentVersionId, setCurrentVersionId] = useState<string | null>(null);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [answerOptimization, setAnswerOptimization] = useState<AnswerOptimizationSelection | null>(null);
  const [answerRerunRequest, setAnswerRerunRequest] = useState<AnswerOptimizationRerunRequest | null>(null);
  const [conversations, setConversations] = useState<ArenaThread[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [runningConversationId, setRunningConversationId] = useState<string | null>(null);
  const [completedConversationIds, setCompletedConversationIds] = useState<Set<string>>(new Set());
  const lastActionRef = useRef<(() => void) | null>(null);
  const selectedRef = useRef<string | null>(null);
  const activeRunRef = useRef<string | null>(null);
  const activeSkill: SkillDetailSelection | null = selectedRepositorySkill ?? (
    session?.status === 'completed' && session.package_id && session.skill_id
      ? {
          packageId: session.package_id,
          skillId: session.skill_id,
          name: session.draft.goal || '教育 Skill',
          description: session.draft.roles || '通过结构化流程完成教育场景任务',
          sections: session.confirmation?.sections,
        }
      : null
  );
  const visiblePendingGuidedMessage =
    pendingGuidedMessage?.sessionId === selectedSessionId ? pendingGuidedMessage : null;

  useEffect(() => {
    selectedRef.current = selectedSessionId;
  }, [selectedSessionId]);

  const publishUpdate = useCallback(
    (update: SkillPinnedUpdateValue, autoOpen = true) => {
      dispatchWorkspace({
        type: 'publish-update',
        update,
        contextView: 'summary',
        autoOpen,
      });
    },
    [],
  );

  const loadVersions = useCallback(async () => {
    if (!activeSkill?.packageId || !activeSkill.skillId) {
      setVersions([]);
      setCurrentVersionId(null);
      return;
    }
    setVersionsLoading(true);
    try {
      const result = await liteApi.listSkillVersions(token, activeSkill.packageId, activeSkill.skillId, {
        includeDiscarded: true,
        limit: 100,
      });
      setVersions(result.items);
      setCurrentVersionId(result.currentVersionId);
    } catch (loadError) {
      toast.error(loadError instanceof Error ? loadError.message : '版本加载失败');
    } finally {
      setVersionsLoading(false);
    }
  }, [activeSkill?.packageId, activeSkill?.skillId, token]);

  const loadConversations = useCallback(async () => {
    if (!activeSkill?.packageId || !activeSkill.skillId) {
      setConversations([]);
      setSelectedConversationId(null);
      setRunningConversationId(null);
      setCompletedConversationIds(new Set());
      return;
    }
    setRunningConversationId(null);
    setCompletedConversationIds(new Set());
    setConversationLoading(true);
    try {
      const threads = await liteApi.listThreads(token, activeSkill.packageId);
      const next = threads
        .filter((thread) => isSkillConversationThread(thread, activeSkill.skillId))
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      setConversations(next);
      setSelectedConversationId((current) =>
        current && next.some((thread) => String(thread.id) === current)
          ? current
          : next[0] ? String(next[0].id) : null,
      );
    } catch (loadError) {
      toast.error(loadError instanceof Error ? loadError.message : '对话加载失败');
    } finally {
      setConversationLoading(false);
    }
  }, [activeSkill?.packageId, activeSkill?.skillId, token]);

  useEffect(() => {
    void loadVersions();
  }, [loadVersions]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  const refreshRepository = useCallback(async () => {
    const packages = await liteApi.listPackages(token);
    const entries = await Promise.all(
      packages.map(async (pkg) => {
        try {
          const skills = await liteApi.listPackageSkills(token, String(pkg.id), true);
          return skills
            .filter((skill) => skill.status === 'active')
            .map((skill): RepositorySkill => ({
              key: `${pkg.id}:${skill.id}`,
              packageId: String(pkg.id),
              skillId: skill.id,
              name: skill.name,
              description: skill.description || pkg.description,
              updatedAt: skill.updatedAt || pkg.updatedAt,
            }));
        } catch {
          return [];
        }
      }),
    );
    setRepositorySkills(entries.flat().sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    ));
  }, [token]);

  useEffect(() => {
    void refreshRepository().catch((loadError) => {
      toast.error(loadError instanceof Error ? loadError.message : 'Skill 仓库加载失败');
    });
  }, [refreshRepository]);

  useEffect(() => {
    let cancelled = false;
    liteApi
      .listGuidedCreations(token, { limit: 100 })
      .then((result) => {
        if (!cancelled) setSessions(result.items);
      })
      .catch((loadError) => {
        if (!cancelled) toast.error(loadError instanceof Error ? loadError.message : '草稿加载失败');
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const mergeSession = (next: GuidedCreationSession) => {
    setSessions((current) => {
      const filtered = current.filter((item) => item.id !== next.id);
      return [next, ...filtered].sort(
        (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      );
    });
  };

  const resetStream = () => {
    setBusy(true);
    setPhase('understanding');
    setPreviews([]);
    setError(null);
  };

  const handleStreamEvent = (
    event: GuidedCreationSseEvent,
    runSessionId: string | null,
    runId: string,
    clientMessageId?: string,
  ) => {
    const isVisibleRun = isGuidedRunVisible(
      selectedRef.current,
      runSessionId,
      activeRunRef.current ?? undefined,
      runId,
    );
    if (event.event === 'phase' && isVisibleRun) setPhase(event.data.phase);
    if (event.event === 'preview' && isVisibleRun) {
      setPreviews((current) => {
        const next = [...current];
        for (const file of event.data.files) {
          const index = next.findIndex((item) => item.path === file.path);
          if (index >= 0) next[index] = file;
          else next.push(file);
        }
        return next;
      });
    }
    if (event.event === 'error') {
      if (isVisibleRun) {
        setError(event.data);
        setBusy(false);
        setPhase(null);
      } else if (runSessionId) {
        void liteApi
          .getGuidedCreationDetail(token, { session_id: runSessionId })
          .then((detail) => {
            mergeSession(detail);
            toast.error(`${detail.draft.goal || 'Skill'} 生成失败，请稍后重试`);
          })
          .catch(() => undefined);
      }
    }
    if (event.event === 'done') {
      const next = event.data.session;
      if (clientMessageId) {
        setPendingGuidedMessage((current) =>
          current?.clientMessageId === clientMessageId ? null : current,
        );
      }
      mergeSession(next);
      if (next.status === 'completed') void refreshRepository().catch(() => undefined);
      if (isVisibleRun) {
        setBusy(false);
        setPhase(null);
        setSession(next);
        setSelectedSessionId(next.id);
        setDocuments(next.documents);
        if (next.status === 'completed') {
          dispatchWorkspace({ type: 'navigate', view: 'run' });
          publishUpdate({
            id: 'skill-created',
            title: 'Skill 已创建完成',
            message: '格式校验、保存和重新加载验证均已通过。',
            actionLabel: '查看 Skill',
          });
        } else {
          publishUpdate({
            id: 'creation-updated',
            title: '创建草案已更新',
            message: '新的需求信息已保存，右侧栏同步整理当前确认状态。',
            actionLabel: '查看创建状态',
          });
        }
      } else if (next.status === 'completed' && next.skill_id) {
        toast.success('Skill 已生成完成', {
          action: {
            label: '打开 Skill',
            onClick: () => void openSession(next),
          },
        });
      }
    }
  };

  const runStream = async (
    run: (onEvent: (event: GuidedCreationSseEvent) => void) => Promise<void>,
    runSessionId: string | null,
    clientMessageId?: string,
  ) => {
    const runId = createRequestId('run');
    activeRunRef.current = runId;
    resetStream();
    try {
      await run((event) => handleStreamEvent(event, runSessionId, runId, clientMessageId));
    } catch (streamError) {
      if (activeRunRef.current !== runId) return;
      setBusy(false);
      setPhase(null);
      setError({
        code: 'NETWORK_ERROR',
        message: streamError instanceof Error ? streamError.message : '网络请求失败',
        retryable: true,
      });
    }
  };

  const start = (content: string) => {
    dispatchWorkspace({ type: 'open-context', view: 'summary' });
    const clientMessageId = createRequestId('message');
    setPendingGuidedMessage(createPendingGuidedMessage(content, clientMessageId, null));
    const action = () =>
      runStream(
        (onEvent) =>
          liteApi.startGuidedCreationStream(
            token,
            {
              content,
              client_message_id: clientMessageId,
              documents,
            },
            onEvent,
          ),
        null,
        clientMessageId,
      );
    lastActionRef.current = action;
    void action();
  };

  const send = (content: string) => {
    if (!session) {
      start(content);
      return;
    }
    dispatchWorkspace({ type: 'open-context', view: 'summary' });
    const sessionId = session.id;
    const clientMessageId = createRequestId('message');
    setPendingGuidedMessage(createPendingGuidedMessage(content, clientMessageId, sessionId));
    const revisionNo = session.revision_no;
    const action = () =>
      runStream(
        (onEvent) =>
          liteApi.sendGuidedCreationMessageStream(
            token,
            {
              session_id: sessionId,
              revision_no: revisionNo,
              client_message_id: clientMessageId,
              content,
            },
            onEvent,
          ),
        sessionId,
        clientMessageId,
      );
    lastActionRef.current = action;
    void action();
  };

  const confirm = () => {
    if (!session) return;
    publishUpdate({
      id: 'skill-generating',
      title: '正在生成 Skill',
      message: '系统正在生成文件、校验结构并保存首个版本。',
      actionLabel: '查看生成状态',
    });
    const sessionId = session.id;
    const requestId = createRequestId('finalize');
    const action = () =>
      runStream(
        (onEvent) =>
          liteApi.confirmGuidedCreationStream(
            token,
            {
              session_id: sessionId,
              revision_no: session.revision_no,
              request_id: requestId,
            },
            onEvent,
          ),
        sessionId,
      );
    lastActionRef.current = action;
    void action();
  };

  const openSession = async (summary: GuidedCreationSession) => {
    activeRunRef.current = null;
    setPendingGuidedMessage(null);
    setSelectedRepositorySkill(null);
    setSelectedSessionId(summary.id);
    selectedRef.current = summary.id;
    setBusy(false);
    setError(null);
    setPhase(null);
    setPreviews([]);
    try {
      const detail = await liteApi.getGuidedCreationDetail(token, { session_id: summary.id });
      if (selectedRef.current !== summary.id) return;
      setSession(detail);
      setDocuments(detail.documents);
      if (detail.status === 'finalizing') {
        setBusy(true);
        setPhase('generating');
        const recoveryRequestId = createRequestId('finalize-recovery');
        lastActionRef.current = () => runStream(
          (onEvent) => liteApi.confirmGuidedCreationStream(
            token,
            {
              session_id: detail.id,
              revision_no: detail.revision_no,
              request_id: recoveryRequestId,
            },
            onEvent,
          ),
          detail.id,
        );
      }
      if (detail.status === 'completed') {
        dispatchWorkspace({ type: 'navigate', view: 'run' });
        dispatchWorkspace({ type: 'close-context' });
        dispatchWorkspace({ type: 'dismiss-update' });
      } else {
        dispatchWorkspace({ type: 'navigate', view: 'create' });
      }
    } catch (loadError) {
      toast.error(loadError instanceof Error ? loadError.message : '内容加载失败');
    }
  };

  useEffect(() => {
    if (!session || session.status !== 'finalizing') return undefined;
    let cancelled = false;
    const poll = async () => {
      try {
        const detail = await liteApi.getGuidedCreationDetail(token, { session_id: session.id });
        if (cancelled || selectedRef.current !== session.id) return;
        if (detail.status === 'finalizing') {
          if (isGuidedFinalizationStale(detail.updated_at)) {
            setBusy(false);
            setPhase(null);
            setError({
              code: 'FINALIZATION_STALE',
              message: '生成任务已中断，可以从当前草稿继续重试',
              retryable: true,
            });
          }
          return;
        }
        setSession(detail);
        setSessions((current) => [
          detail,
          ...current.filter((item) => item.id !== detail.id),
        ]);
        setBusy(false);
        setPhase(null);
        if (detail.status === 'completed') {
          setError(null);
          void refreshRepository().catch(() => undefined);
          dispatchWorkspace({ type: 'navigate', view: 'run' });
        } else if (detail.status === 'failed') {
          setError({
            code: String(detail.error?.code || 'FINALIZATION_FAILED'),
            message: String(detail.error?.message || '生成失败，可以重试'),
            retryable: true,
          });
        }
      } catch {
        // Keep the current view and try again on the next poll.
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 3_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [refreshRepository, session, token]);

  const newSkill = (mode: SkillCreateAction = 'conversation') => {
    if (mode === 'import') {
      setImportOpen(true);
      return;
    }
    setImportOpen(false);
    activeRunRef.current = null;
    setPendingGuidedMessage(null);
    setCreateMode(mode);
    setSession(null);
    setSelectedRepositorySkill(null);
    setSelectedSessionId(null);
    selectedRef.current = null;
    setDocuments([]);
    setBusy(false);
    setPhase(null);
    setPreviews([]);
    setError(null);
    setVersions([]);
    setCurrentVersionId(null);
    dispatchWorkspace({ type: 'navigate', view: 'create' });
    dispatchWorkspace({ type: 'close-context' });
    dispatchWorkspace({ type: 'dismiss-update' });
  };

  const openRepository = () => {
    dispatchWorkspace({ type: 'navigate', view: 'repository' });
    dispatchWorkspace({ type: 'close-context' });
    dispatchWorkspace({ type: 'dismiss-update' });
  };

  const renameSession = async (item: GuidedCreationSession, displayName: string) => {
    try {
      const renamed = await liteApi.renameGuidedCreation(token, {
        session_id: item.id,
        revision_no: item.revision_no,
        display_name: displayName,
      });
      mergeSession(renamed);
      if (selectedSessionId === item.id) setSession(renamed);
      toast.success('会话名称已更新');
    } catch (renameError) {
      toast.error(renameError instanceof Error ? renameError.message : '重命名失败');
      throw renameError;
    }
  };

  const deleteSession = async (item: GuidedCreationSession) => {
    try {
      await liteApi.deleteGuidedCreation(token, {
        session_id: item.id,
        revision_no: item.revision_no,
      });
      setSessions((current) => current.filter((candidate) => candidate.id !== item.id));

      if (selectedSessionId === item.id) {
        activeRunRef.current = null;
        setPendingGuidedMessage(null);
        setSession(null);
        setSelectedRepositorySkill(null);
        setSelectedSessionId(null);
        selectedRef.current = null;
        setDocuments([]);
        setBusy(false);
        setPhase(null);
        setPreviews([]);
        setError(null);
        setVersions([]);
        setCurrentVersionId(null);
        if (item.status === 'completed') openRepository();
        else newSkill();
      }

      toast.success(item.status === 'completed'
        ? '会话已从最近使用中移除'
        : '草稿已删除');
    } catch (deleteError) {
      toast.error(deleteError instanceof Error ? deleteError.message : '删除失败');
      throw deleteError;
    }
  };

  const handleConversationCreated = (thread: ArenaThread) => {
    setConversations((current) => [thread, ...current.filter((item) => item.id !== thread.id)]);
    setSelectedConversationId(String(thread.id));
    setCompletedConversationIds((current) => {
      const next = new Set(current);
      next.delete(String(thread.id));
      return next;
    });
  };

  const handleConversationUpdated = (thread: ArenaThread) => {
    setConversations((current) => current.map((item) => item.id === thread.id ? thread : item));
  };

  const handleConversationSelect = (id: string) => {
    setSelectedConversationId(id);
    dispatchWorkspace({ type: 'navigate', view: 'run' });
    dispatchWorkspace({ type: 'close-context' });
  };

  const handleConversationRunState = (running: boolean, threadId?: string | null) => {
    if (running) {
      const runId = threadId ?? selectedConversationId;
      setRunningConversationId(runId);
      if (runId) {
        setCompletedConversationIds((current) => {
          const next = new Set(current);
          next.delete(runId);
          return next;
        });
      }
      return;
    }
    const completedId = threadId ?? runningConversationId;
    setRunningConversationId((current) => {
      if (!completedId || current === completedId) return null;
      return current;
    });
    if (completedId) {
      setCompletedConversationIds((current) => {
        const next = new Set(current);
        next.add(completedId);
        return next;
      });
    }
  };

  const handleNewConversation = () => {
    setSelectedConversationId(null);
    dispatchWorkspace({ type: 'navigate', view: 'run' });
    dispatchWorkspace({ type: 'close-context' });
  };

  const renameConversation = async (thread: ArenaThread, title: string) => {
    if (!activeSkill) return;
    const renamed = await liteApi.renameArenaThread(token, activeSkill.packageId, String(thread.id), title);
    handleConversationUpdated(renamed);
  };

  const deleteConversation = async (thread: ArenaThread) => {
    if (!activeSkill) return;
    try {
      await liteApi.deleteArenaThread(token, activeSkill.packageId, String(thread.id));
      setConversations((current) => current.filter((item) => item.id !== thread.id));
      setSelectedConversationId((current) => current === String(thread.id) ? null : current);
      setCompletedConversationIds((current) => {
        const next = new Set(current);
        next.delete(String(thread.id));
        return next;
      });
      setRunningConversationId((current) => current === String(thread.id) ? null : current);
      toast.success('对话已删除');
    } catch (deleteError) {
      toast.error(deleteError instanceof Error ? deleteError.message : '对话删除失败');
    }
  };

  const openRepositorySkill = (skill: RepositorySkill) => {
    activeRunRef.current = null;
    setPendingGuidedMessage(null);
    setSelectedRepositorySkill(skill);
    setSession(null);
    setSelectedSessionId(null);
    selectedRef.current = null;
    setDocuments([]);
    setBusy(false);
    setError(null);
    dispatchWorkspace({ type: 'navigate', view: 'run' });
    dispatchWorkspace({ type: 'close-context' });
    dispatchWorkspace({ type: 'dismiss-update' });
  };

  const handleSkillMenuAction = (skill: RepositorySkill, action: SkillMenuAction) => {
    openRepositorySkill(skill);
    if (action === 'open') return;
    dispatchWorkspace({
      type: 'navigate',
      view: action === 'overview' ? 'overview' : action,
    });
  };

  const addFiles = async (files: FileList) => {
    try {
      const parsed = await Promise.all(Array.from(files).slice(0, 10).map(readDocument));
      setDocuments((current) => [...current, ...parsed].slice(0, 10));
      toast.success(`已添加 ${parsed.length} 份参考材料`);
    } catch (fileError) {
      toast.error(fileError instanceof Error ? fileError.message : '材料读取失败');
    }
  };

  const importSkill = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.zip')) {
      toast.error('请选择标准 Skill ZIP 文件');
      return;
    }
    setImportBusy(true);
    try {
      await liteApi.importPackage(token, file);
      await refreshRepository();
      toast.success('Skill 已导入并加入仓库');
      setImportOpen(false);
      openRepository();
    } catch (importError) {
      toast.error(importError instanceof Error ? importError.message : 'Skill 导入失败');
    } finally {
      setImportBusy(false);
    }
  };

  const activeSkillKey = activeSkill ? `${activeSkill.packageId}:${activeSkill.skillId}` : null;
  const activeSkillName = repositorySkills.find((skill) => skill.key === activeSkillKey)?.name
    || activeSkill?.name
    || null;
  const detailView = (
    ['overview', 'run', 'test', 'arena', 'optimize', 'versions'].includes(workspaceState.activeView)
      ? workspaceState.activeView
      : 'run'
  ) as 'overview' | 'run' | 'test' | 'arena' | 'optimize' | 'versions';
  const handlePinnedAction = (update: SkillPinnedUpdateValue) => {
    if (update.id === 'version-changed') {
      dispatchWorkspace({ type: 'navigate', view: 'versions' });
      dispatchWorkspace({ type: 'close-context' });
      return;
    }
    if (update.id === 'skill-created') {
      dispatchWorkspace({ type: 'navigate', view: 'run' });
      return;
    }
    dispatchWorkspace({ type: 'open-context', view: 'summary' });
  };

  return (
    <div className={`skill-workspace-root ${leftCollapsed ? 'is-left-collapsed' : ''} ${workspaceState.contextOpen ? 'is-context-open' : ''}`}>
      <SkillWorkspaceSidebar
        sessions={sessions}
        selectedSessionId={selectedSessionId}
        repositoryActive={workspaceState.activeView === 'repository'}
        selectedCreateMode={createMode}
        collapsed={leftCollapsed}
        search={search}
        userName={user?.username || '用户'}
        onSearch={setSearch}
        onToggle={() => setLeftCollapsed((value) => !value)}
        onRepository={openRepository}
        onCreateMode={newSkill}
        onSelect={(item) => void openSession(item)}
        skills={repositorySkills}
        activeSkillKey={activeSkillKey}
        activeSkillName={activeSkillName}
        onSelectSkill={openRepositorySkill}
        onSkillAction={handleSkillMenuAction}
        onRename={renameSession}
        onDelete={deleteSession}
        conversations={conversations}
        selectedConversationId={selectedConversationId}
        conversationLoading={conversationLoading}
        conversationRunningId={runningConversationId}
        completedConversationIds={completedConversationIds}
        onConversationSelect={handleConversationSelect}
        onNewConversation={handleNewConversation}
        onConversationRename={renameConversation}
        onConversationDelete={deleteConversation}
        onLogout={logout}
      />
      <div className="skill-main-column">
        <SkillPinnedUpdate
          update={workspaceState.pinnedUpdate}
          onAction={handlePinnedAction}
          onDismiss={() => dispatchWorkspace({ type: 'dismiss-update' })}
        />
        <div className="skill-main-stage" key={workspaceState.activeView === 'repository' ? 'repository' : activeSkill ? `skill-${activeSkill.packageId}-${activeSkill.skillId}` : session?.id || 'new'}>
          {workspaceState.activeView === 'repository' ? (
            <SkillRepositoryWorkspace
              skills={repositorySkills}
              sessions={sessions}
              search={search}
              onSearch={setSearch}
              onSelectSkill={openRepositorySkill}
              onSelectDraft={(item) => void openSession(item)}
              onNew={newSkill}
            />
          ) : activeSkill ? (
            <SkillDetailWorkspace
              token={token}
              skill={activeSkill}
              view={detailView}
              versions={versions}
              currentVersionId={currentVersionId}
              versionsLoading={versionsLoading}
              onRunStateChange={handleConversationRunState}
              onPublishUpdate={publishUpdate}
              onReloadVersions={loadVersions}
              onOptimizeAnswer={(selection) => {
                setAnswerOptimization(selection);
                dispatchWorkspace({ type: 'open-context', view: 'optimization' });
              }}
              conversations={conversations}
              selectedConversationId={selectedConversationId}
              onConversationCreated={handleConversationCreated}
              onConversationUpdated={handleConversationUpdated}
              answerRerunRequest={answerRerunRequest}
            />
          ) : session ? (
            <GuidedSkillCreationPanel
              session={session}
              pendingMessage={visiblePendingGuidedMessage}
              documents={documents}
              busy={busy}
              phase={phase}
              previews={previews}
              error={error}
              onSend={send}
              onConfirm={confirm}
              onRetry={() => lastActionRef.current?.()}
              onFiles={(files) => void addFiles(files)}
              onRemoveDocument={(index) =>
                setDocuments((current) => current.filter((_, itemIndex) => itemIndex !== index))
              }
            />
          ) : createMode === 'document' ? (
            <DocumentSkillCreationPanel
              token={token}
              onGenerated={async () => {
                await refreshRepository();
                dispatchWorkspace({ type: 'navigate', view: 'repository' });
              }}
            />
          ) : createMode === 'manual' ? (
            <StructuredSkillCreationPanel
              documents={documents}
              busy={busy}
              onSubmit={send}
              onFiles={(files) => void addFiles(files)}
              onRemoveDocument={(index) =>
                setDocuments((current) => current.filter((_, itemIndex) => itemIndex !== index))
              }
            />
          ) : (
            <GuidedSkillCreationPanel
              session={null}
              pendingMessage={visiblePendingGuidedMessage}
              documents={documents}
              busy={busy}
              phase={phase}
              previews={previews}
              error={error}
              onSend={send}
              onConfirm={confirm}
              onRetry={() => lastActionRef.current?.()}
              onFiles={(files) => void addFiles(files)}
              onRemoveDocument={(index) =>
                setDocuments((current) => current.filter((_, itemIndex) => itemIndex !== index))
              }
            />
          )}
        </div>
      </div>
      <SkillContextPanel
        token={token}
        session={workspaceState.activeView === 'repository' ? null : session}
        hasSkill={Boolean(activeSkill)}
        open={workspaceState.contextOpen}
        view={workspaceState.contextView}
        activeView={workspaceState.activeView}
        versions={versions}
        currentVersionId={currentVersionId}
        versionsLoading={versionsLoading}
        answerOptimization={answerOptimization}
        onAnswerOptimizationSaved={() => { void loadVersions(); }}
        onAnswerOptimizationRerun={(versionNumber, selection) => {
          void (async () => {
            await loadVersions();
            dispatchWorkspace({ type: 'navigate', view: selection.origin });
            setAnswerRerunRequest({ requestId: createRequestId('rerun'), versionNumber, selection });
          })();
        }}
        onOpen={(view) => dispatchWorkspace({ type: 'open-context', view })}
        onClose={() => dispatchWorkspace({ type: 'close-context' })}
        onOpenVersionManager={() => {
          dispatchWorkspace({ type: 'navigate', view: 'versions' });
          dispatchWorkspace({ type: 'close-context' });
        }}
      />
      <SkillImportDialog
        open={importOpen}
        busy={importBusy}
        onClose={() => setImportOpen(false)}
        onImport={(file) => void importSkill(file)}
      />
    </div>
  );
}

async function readDocument(file: File): Promise<GuidedCreationDocument> {
  const isDocx = file.name.toLowerCase().endsWith('.docx');
  let content: string;
  if (isDocx) {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    content = result.value.trim();
  } else {
    content = (await file.text()).trim();
  }
  if (!content) throw new Error(`${file.name} 没有可读取的文本`);
  if (content.length > 12_000) content = content.slice(0, 12_000);
  return { name: file.name, content, mime_type: file.type || undefined };
}
