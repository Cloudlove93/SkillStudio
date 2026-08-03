import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type {
  GuidedCreationDocument,
  GuidedCreationSession,
  GuidedCreationSessionDetail,
  SkillVersionDetail,
} from '@educlaw/shared';
import { toast } from 'sonner';
import { liteApi, type GuidedCreationSseEvent } from '../api/lite-api';
import { useAuthStore } from '../stores/auth';
import { GuidedSkillCreationPanel } from '../components/skill-workspace/GuidedSkillCreationPanel';
import {
  isGuidedFinalizationStale,
  isGuidedRunVisible,
} from '../components/skill-workspace/guided-creation-state';
import { SkillContextPanel } from '../components/skill-workspace/SkillContextPanel';
import {
  SkillWorkspaceSidebar,
  type SkillCreateMode,
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
  const [selectedRepositorySkill, setSelectedRepositorySkill] = useState<RepositorySkill | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<GuidedCreationDocument[]>([]);
  const [search, setSearch] = useState('');
  const [createMode, setCreateMode] = useState<SkillCreateMode>('conversation');
  const [leftCollapsed, setLeftCollapsed] = useState(false);
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

  useEffect(() => {
    void loadVersions();
  }, [loadVersions]);

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
  ) => {
    const runId = createRequestId('run');
    activeRunRef.current = runId;
    resetStream();
    try {
      await run((event) => handleStreamEvent(event, runSessionId, runId));
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

  const newSkill = (mode: SkillCreateMode = 'conversation') => {
    activeRunRef.current = null;
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

  const openRepositorySkill = (skill: RepositorySkill) => {
    activeRunRef.current = null;
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
    setBusy(true);
    try {
      await liteApi.importPackage(token, file);
      await refreshRepository();
      toast.success('Skill 已导入并加入仓库');
      openRepository();
    } catch (importError) {
      toast.error(importError instanceof Error ? importError.message : 'Skill 导入失败');
    } finally {
      setBusy(false);
    }
  };

  const completed = Boolean(activeSkill);
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
        activeView={workspaceState.activeView}
        selectedSessionCompleted={Boolean(completed)}
        selectedCreateMode={createMode}
        collapsed={leftCollapsed}
        search={search}
        userName={user?.username || '用户'}
        onSearch={setSearch}
        onToggle={() => setLeftCollapsed((value) => !value)}
        onNew={() => newSkill()}
        onRepository={openRepository}
        onNavigate={(view) => dispatchWorkspace({ type: 'navigate', view })}
        onCreateMode={newSkill}
        onSelect={(item) => void openSession(item)}
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
              onPublishUpdate={publishUpdate}
              onReloadVersions={loadVersions}
            />
          ) : (
            <GuidedSkillCreationPanel
              session={session}
              createMode={createMode}
              documents={documents}
              busy={busy}
              phase={phase}
              previews={previews}
              error={error}
              onSend={send}
              onConfirm={confirm}
              onRetry={() => lastActionRef.current?.()}
              onFiles={(files) => void addFiles(files)}
              onImport={(file) => void importSkill(file)}
              onRemoveDocument={(index) =>
                setDocuments((current) => current.filter((_, itemIndex) => itemIndex !== index))
              }
            />
          )}
        </div>
      </div>
      <SkillContextPanel
        session={workspaceState.activeView === 'repository' ? null : session}
        hasSkill={Boolean(activeSkill)}
        open={workspaceState.contextOpen}
        view={workspaceState.contextView}
        activeView={workspaceState.activeView}
        versions={versions}
        currentVersionId={currentVersionId}
        versionsLoading={versionsLoading}
        onOpen={(view) => dispatchWorkspace({ type: 'open-context', view })}
        onClose={() => dispatchWorkspace({ type: 'close-context' })}
        onOpenVersionManager={() => {
          dispatchWorkspace({ type: 'navigate', view: 'versions' });
          dispatchWorkspace({ type: 'close-context' });
        }}
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
