import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type {
  AgentWorkspace,
  AgentWorkspaceInput,
  ArenaThread,
} from '@educlaw/shared';
import { Bot, ChevronLeft, MessageSquare, Plus } from 'lucide-react';
import { agentsApi, AgentWorkspaceApiError } from '../../api/agents';
import { liteApi, type RepositorySkillRecord } from '../../api/lite-api';
import { AgentSkillPicker, type OpenAgentSkill } from './AgentSkillPicker';
import { AgentConversation } from './AgentConversation';
import '../skill-workspace/skill-workspace.css';
import './agent-workspace.css';
import './studio-agent.css';

export type AgentWorkspaceMode = 'assemble' | 'chat';
export type AgentWorkspacePanelProps = {
  token: string;
  onOpenSkill?: OpenAgentSkill;
  initialSkillId?: string;
  /** assemble = 只负责装配配置；chat = 只负责使用对话。 */
  mode?: AgentWorkspaceMode;
};
export type { OpenAgentSkill } from './AgentSkillPicker';

const emptyInput = (): AgentWorkspaceInput => ({
  name: '',
  description: '',
  instructions: '',
  model: '',
  skills: [],
});
const inputOf = (agent: AgentWorkspace): AgentWorkspaceInput => ({
  name: agent.name,
  description: agent.description,
  instructions: agent.instructions,
  model: agent.model,
  skills: agent.skills.map(({ skillId, skillVersionId, enabled }) => ({
    skillId,
    skillVersionId,
    enabled,
  })),
});
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : '操作失败，请重试';
const newRequestId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const pendingRequestStorageKey = (agentId: string, purpose: 'run' | 'test') =>
  `skillstudio:pending-conversation:${agentId}:${purpose}`;
function conversationRequestId(
  agentId: string,
  purpose: 'run' | 'test',
  preferred?: string,
) {
  const key = pendingRequestStorageKey(agentId, purpose);
  try {
    const requestId =
      sessionStorage.getItem(key) || preferred || newRequestId();
    sessionStorage.setItem(key, requestId);
    return requestId;
  } catch {
    return preferred || newRequestId();
  }
}
function completeConversationRequest(agentId: string, purpose: 'run' | 'test') {
  try {
    sessionStorage.removeItem(pendingRequestStorageKey(agentId, purpose));
  } catch {
    // The in-memory key still prevents duplicate requests when storage is unavailable.
  }
}
function writeSelection(agentId: string | null, conversationId?: number) {
  const url = new URL(window.location.href);
  if (agentId) url.searchParams.set('agentId', agentId);
  else url.searchParams.delete('agentId');
  if (conversationId)
    url.searchParams.set('conversation', String(conversationId));
  else url.searchParams.delete('conversation');
  window.history.replaceState(
    window.history.state,
    '',
    `${url.pathname}${url.search}${url.hash}`,
  );
}
/** 自动开聊只生效一次，成功后移除参数，避免刷新页面重复建会话。 */
function clearAutoChatParam() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('autochat')) return;
  url.searchParams.delete('autochat');
  window.history.replaceState(
    window.history.state,
    '',
    `${url.pathname}${url.search}${url.hash}`,
  );
}

/** Mount inside the authenticated /agents page or an existing workspace shell. */
export function AgentWorkspacePanel(props: AgentWorkspacePanelProps) {
  return <AgentWorkspaceSession key={props.token} {...props} />;
}

function AgentWorkspaceSession({
  token,
  onOpenSkill,
  initialSkillId,
  mode = 'assemble',
}: AgentWorkspacePanelProps) {
  const isChat = mode === 'chat';
  const navigate = useNavigate();
  const [querySkillId, setQuerySkillId] = useState(
    () =>
      initialSkillId ??
      new URLSearchParams(window.location.search).get('skillId') ??
      '',
  );
  const [pendingSkill, setPendingSkill] =
    useState<RepositorySkillRecord | null>(null);
  const [attachmentError, setAttachmentError] = useState('');
  const [attachmentLoading, setAttachmentLoading] = useState(false);
  const [agents, setAgents] = useState<AgentWorkspace[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [listRetry, setListRetry] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get('agentId'),
  );
  const [selectionReady, setSelectionReady] = useState(false);
  const [agent, setAgent] = useState<AgentWorkspace | null>(null);
  const [draft, setDraft] = useState<AgentWorkspaceInput>(emptyInput);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailRetry, setDetailRetry] = useState(0);
  const [detailError, setDetailError] = useState('');
  const [conversations, setConversations] = useState<ArenaThread[]>([]);
  const [conversationError, setConversationError] = useState('');
  const [conversationLoading, setConversationLoading] = useState(false);
  const [conversationRetry, setConversationRetry] = useState(0);
  /** 对话历史加载完成的 Agent；自动开聊必须等它匹配后才允许启动。 */
  const [conversationLoadedFor, setConversationLoadedFor] = useState<
    string | null
  >(null);
  const [provisionFailed, setProvisionFailed] = useState(false);
  const [provisionRetry, setProvisionRetry] = useState(0);
  const [thread, setThread] = useState<ArenaThread | null>(null);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false);
  const [discardTarget, setDiscardTarget] = useState<{
    id: string | null;
  } | null>(null);
  const actionLock = useRef(false);
  const scope = useRef(0);
  const mounted = useRef(true);
  const requestKey = useRef<{
    agentId: string;
    purpose: 'run' | 'test';
    requestId: string;
  } | null>(null);
  const adoptedAgentId = useRef<string | null>(null);
  const provisionAttempt = useRef<{
    skillId: string;
    promise: ReturnType<typeof agentsApi.provision>;
  } | null>(null);
  const autoChatStarted = useRef(false);
  const [autoChat] = useState(
    () => new URLSearchParams(window.location.search).get('autochat') === '1',
  );
  const [autoNew] = useState(
    () => new URLSearchParams(window.location.search).get('new') === '1',
  );
  const dirty =
    JSON.stringify(draft) !==
    JSON.stringify(agent ? inputOf(agent) : emptyInput());

  useEffect(() => {
    mounted.current = true;
    const generation = scope;
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, []);
  useEffect(() => {
    const sync = () => {
      const params = new URLSearchParams(window.location.search);
      setQuerySkillId(initialSkillId ?? params.get('skillId') ?? '');
      setSelectedId(params.get('agentId'));
      setDetailRetry((r) => r + 1);
      setConversationRetry((r) => r + 1);
    };
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, [initialSkillId]);

  useEffect(() => {
    let current = true;
    setListLoading(true);
    setListError('');
    void agentsApi
      .list(token)
      .then((items) => {
        if (!current) return;
        setAgents(items);
        if (!selectionReady) {
          const requested = new URLSearchParams(window.location.search).get(
            'agentId',
          );
          const nextId =
            requested ?? (querySkillId ? null : (items[0]?.id ?? null));
          setSelectedId(nextId);
          if (!requested) writeSelection(nextId);
          setSelectionReady(true);
        }
      })
      .catch((e: unknown) => {
        if (current) setListError(errorMessage(e));
      })
      .finally(() => {
        if (current) setListLoading(false);
      });
    return () => {
      current = false;
    };
    // Refreshing the list must preserve the selected Agent and unsaved edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, listRetry]);

  useEffect(() => {
    let current = true;
    setPendingSkill(null);
    setAttachmentError('');
    setAttachmentLoading(!!querySkillId);
    if (!querySkillId) return;
    void (async () => {
      let cursor: string | undefined;
      const seen = new Set<string>();
      do {
        const page = await liteApi.listRepositorySkills(token, {
          limit: 100,
          cursor,
        });
        if (!current) return;
        const skill = page.items.find((s) => s.id === querySkillId);
        if (skill) {
          setPendingSkill(skill);
          return;
        }
        cursor = page.nextCursor ?? undefined;
        if (cursor && seen.has(cursor)) break;
        if (cursor) seen.add(cursor);
      } while (cursor);
      if (current)
        setAttachmentError(
          '待绑定的 Skill 不在当前仓库中，请检查访问权限或从仓库重新选择。',
        );
    })()
      .catch((e: unknown) => {
        if (current) setAttachmentError(errorMessage(e));
      })
      .finally(() => {
        if (current) setAttachmentLoading(false);
      });
    return () => {
      current = false;
    };
  }, [token, querySkillId]);

  useEffect(() => {
    if (!selectionReady) return;
    if (selectedId && adoptedAgentId.current === selectedId) {
      adoptedAgentId.current = null;
      return;
    }
    const generation = ++scope.current;
    let current = true;
    setAgent(null);
    setDraft(emptyInput());
    setDetailError('');
    setActionError('');
    setConflict(false);
    setNotice('');
    setThread(null);
    setConversations([]);
    setDetailLoading(!!selectedId);
    if (selectedId) {
      void agentsApi
        .get(token, selectedId)
        .then((next) => {
          if (!current || generation !== scope.current) return;
          setAgent(next);
          setDraft(inputOf(next));
        })
        .catch((e: unknown) => {
          if (current) setDetailError(errorMessage(e));
        })
        .finally(() => {
          if (current) setDetailLoading(false);
        });
    }
    return () => {
      current = false;
    };
  }, [token, selectedId, selectionReady, detailRetry]);

  useEffect(() => {
    if (!selectionReady || !isChat) {
      setConversations([]);
      setConversationError('');
      setConversationLoading(false);
      setConversationLoadedFor(null);
      return;
    }
    let current = true;
    setConversationError('');
    setConversationLoading(!!selectedId);
    setConversationLoadedFor(null);
    if (!selectedId) {
      setConversations([]);
      return;
    }
    void agentsApi
      .listConversations(token, selectedId)
      .then((items) => {
        if (!current) return;
        setConversations(items);
        setConversationLoadedFor(selectedId);
        const requested = new URLSearchParams(window.location.search).get(
          'conversation',
        );
        const restored = items.find((item) => String(item.id) === requested);
        if (restored) setThread(restored);
      })
      .catch((e: unknown) => {
        if (current) setConversationError(errorMessage(e));
      })
      .finally(() => {
        if (current) setConversationLoading(false);
      });
    return () => {
      current = false;
    };
  }, [token, selectedId, conversationRetry, selectionReady, isChat]);

  useEffect(() => {
    if (!pendingSkill || !selectionReady || selectedId) return;
    const versionId =
      pendingSkill.currentVersionId ?? pendingSkill.latestVersionId;
    if (!versionId) return;
    setDraft((previous) =>
      previous.skills.some((s) => s.skillId === pendingSkill.id)
        ? previous
        : {
            ...previous,
            skills: [
              ...previous.skills,
              {
                skillId: pendingSkill.id,
                skillVersionId: versionId,
                enabled: true,
              },
            ],
          },
    );
  }, [pendingSkill, querySkillId, selectionReady, selectedId, detailRetry]);

  // 从生成流程或仓库带着 skillId 进入时，直接把 Skill 转成可对话的 Agent。
  useEffect(() => {
    if (!selectionReady || selectedId || !querySkillId) return;
    let current = true;
    if (provisionAttempt.current?.skillId !== querySkillId) {
      provisionAttempt.current = {
        skillId: querySkillId,
        promise: agentsApi.provision(token, { skillId: querySkillId }),
      };
    }
    setProvisionFailed(false);
    setAttachmentLoading(true);
    setAttachmentError('');
    void provisionAttempt.current.promise
      .then((created) => {
        if (!current) return;
        setAgents((previous) => [
          created,
          ...previous.filter((item) => item.id !== created.id),
        ]);
        setSelectedId(created.id);
        setSelectionReady(true);
        setQuerySkillId('');
        setPendingSkill(null);
        const url = new URL(window.location.href);
        url.searchParams.delete('skillId');
        url.searchParams.set('agentId', created.id);
        window.history.replaceState(
          window.history.state,
          '',
          `${url.pathname}${url.search}${url.hash}`,
        );
      })
      .catch((e: unknown) => {
        if (!current) return;
        setProvisionFailed(true);
        setAttachmentError(errorMessage(e));
      })
      .finally(() => {
        if (current) setAttachmentLoading(false);
      });
    return () => {
      current = false;
    };
  }, [token, querySkillId, selectionReady, selectedId, provisionRetry]);

  function retryProvision() {
    provisionAttempt.current = null;
    setProvisionFailed(false);
    setAttachmentError('');
    setProvisionRetry((r) => r + 1);
  }

  function choose(id: string | null) {
    if (saving || starting || (selectionReady && id === selectedId)) return;
    if (dirty) {
      setDiscardTarget({ id });
      return;
    }
    setSelectedId(id);
    writeSelection(id);
    setSelectionReady(true);
  }

  function attachPending() {
    const versionId =
      pendingSkill?.currentVersionId ?? pendingSkill?.latestVersionId;
    if (
      !pendingSkill ||
      !versionId ||
      draft.skills.some((s) => s.skillId === pendingSkill.id)
    )
      return;
    if (draft.skills.length >= 20) {
      setActionError('每个 Agent 最多挂载 20 个 Skill');
      return;
    }
    setDraft((previous) => ({
      ...previous,
      skills: [
        ...previous.skills,
        { skillId: pendingSkill.id, skillVersionId: versionId, enabled: true },
      ],
    }));
    setAttachmentError('');
    setProvisionFailed(false);
    setNotice(`已添加 ${pendingSkill.name}，保存后生效。`);
  }

  async function save(andRun = false) {
    if (
      actionLock.current ||
      !draft.name.trim() ||
      detailLoading ||
      detailError
    )
      return;
    actionLock.current = true;
    setSaving(true);
    setActionError('');
    setNotice('');
    if (andRun) {
      autoChatStarted.current = true;
      clearAutoChatParam();
    }
    const generation = scope.current;
    const input = {
      ...draft,
      name: draft.name.trim(),
      skills: draft.skills.map(({ skillId, skillVersionId, enabled }) => ({
        skillId,
        skillVersionId,
        enabled,
      })),
    };
    try {
      const saved = agent
        ? dirty
          ? await agentsApi.update(token, agent.id, {
              ...input,
              expectedUpdatedAt: agent.updatedAt,
            })
          : agent
        : await agentsApi.create(token, input);
      if (!mounted.current || generation !== scope.current) return;
      setAgents((previous) => [
        saved,
        ...previous.filter((a) => a.id !== saved.id),
      ]);
      setAgent(saved);
      setDraft(inputOf(saved));
      setConflict(false);
      if (selectedId !== saved.id) {
        adoptedAgentId.current = saved.id;
        writeSelection(saved.id);
        setSelectedId(saved.id);
      }
      if (
        andRun &&
        saved.skills.some((s) => s.enabled && s.available !== false)
      ) {
        navigate(
          `/agents/chat?agentId=${encodeURIComponent(saved.id)}&new=1`,
        );
        return;
      }
      setNotice('Agent 配置已保存。新对话会使用当前配置。');
    } catch (e) {
      if (mounted.current && generation === scope.current) {
        setActionError(errorMessage(e));
        setConflict(e instanceof AgentWorkspaceApiError && e.status === 409);
      }
    } finally {
      actionLock.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  async function start(purpose: 'run' | 'test', requestId?: string) {
    if (
      !agent ||
      dirty ||
      !agent.skills.some((s) => s.enabled && s.available !== false) ||
      actionLock.current
    )
      return;
    actionLock.current = true;
    setStarting(true);
    setActionError('');
    autoChatStarted.current = true;
    clearAutoChatParam();
    const generation = scope.current;
    if (requestId) {
      requestKey.current = {
        agentId: agent.id,
        purpose,
        requestId: conversationRequestId(agent.id, purpose, requestId),
      };
    } else if (
      requestKey.current?.agentId !== agent.id ||
      requestKey.current.purpose !== purpose
    ) {
      requestKey.current = {
        agentId: agent.id,
        purpose,
        requestId: conversationRequestId(agent.id, purpose),
      };
    }
    const input = { purpose, requestId: requestKey.current.requestId };
    try {
      const next = await agentsApi.createConversation(token, agent.id, input);
      if (!mounted.current || generation !== scope.current) return;
      completeConversationRequest(agent.id, purpose);
      requestKey.current = null;
      setConversations((previous) => [
        next,
        ...previous.filter((c) => c.id !== next.id),
      ]);
      setThread(next);
      writeSelection(agent.id, next.id);
      const url = new URL(window.location.href);
      if (url.searchParams.has('new')) {
        url.searchParams.delete('new');
        window.history.replaceState(
          window.history.state,
          '',
          `${url.pathname}${url.search}${url.hash}`,
        );
      }
    } catch (e) {
      if (mounted.current && generation === scope.current)
        setActionError(errorMessage(e));
      // Retain the key so a retry cannot duplicate a conversation after a lost response.
    } finally {
      actionLock.current = false;
      if (mounted.current) setStarting(false);
    }
  }

  const canStart =
    !!agent &&
    !dirty &&
    !detailLoading &&
    !detailError &&
    (!isChat || !conversationLoading) &&
    !starting &&
    !saving &&
    agent.skills.some((s) => s.enabled && s.available !== false);

  // 装配台收到 autochat 旧链接时，转交给独立的会话页，不在装配流程里混入对话。
  useEffect(() => {
    if (isChat || !autoChat || autoChatStarted.current) return;
    if (!agent || detailLoading || detailError) return;
    autoChatStarted.current = true;
    const params = new URLSearchParams(window.location.search);
    const conversation = params.get('conversation');
    const target = `/agents/chat?agentId=${encodeURIComponent(agent.id)}${
      conversation
        ? `&conversation=${encodeURIComponent(conversation)}`
        : '&new=1'
    }`;
    clearAutoChatParam();
    navigate(target, { replace: true });
  }, [isChat, autoChat, agent, detailLoading, detailError, navigate]);

  // 会话页带 new=1 进入时，等历史加载完成后自动开一个新对话。
  useEffect(() => {
    if (
      !isChat ||
      !autoNew ||
      autoChatStarted.current ||
      !agent ||
      dirty ||
      starting ||
      saving ||
      conversationLoading ||
      (conversationLoadedFor !== agent.id && !conversationError)
    )
      return;
    if (!agent.skills.some((s) => s.enabled && s.available !== false)) return;
    autoChatStarted.current = true;
    void start('run');
    // 只在首次进入时自动开一次对话，后续由用户主动操作。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isChat,
    autoNew,
    agent,
    dirty,
    starting,
    saving,
    conversationLoading,
    conversationLoadedFor,
    conversationError,
  ]);

  const openSkill = onOpenSkill;
  return (
    <div
      className={`skill-workspace-root agent-workspace-panel${
        isChat ? ' agent-chat-page' : ''
      }`}
    >
      {!isChat && (
        <aside className="agent-sidebar" aria-label="我的 Agent">
        <div className="agent-section-heading">
          <h2>
            <Bot size={20} />
            我的 Agent
          </h2>
          <button
            type="button"
            aria-label="创建 Agent"
            onClick={() => choose(null)}
            disabled={saving || starting}
          >
            <Plus size={17} />
          </button>
        </div>
        <p className="agent-muted">把可复用的 Skill 组合成自己的教学 Agent。</p>
        {listLoading && <p role="status">正在加载 Agent…</p>}
        {listError && (
          <div role="alert" className="agent-error">
            {listError}
            <button type="button" onClick={() => setListRetry((r) => r + 1)}>
              重试 Agent 列表
            </button>
          </div>
        )}
        <nav className="agent-list">
          {agents.map((item) => (
            <button
              type="button"
              key={item.id}
              aria-current={selectedId === item.id ? 'true' : undefined}
              disabled={saving || starting}
              onClick={() => choose(item.id)}
            >
              <strong>{item.name}</strong>
              <span>{item.description || '教学助手'}</span>
              <small>
                {item.skills.filter((s) => s.enabled).length} 个启用的 Skill
              </small>
            </button>
          ))}
        </nav>
        {!listLoading && !listError && !agents.length && (
          <div className="agent-empty-inline">
            创建第一个 Agent，绑定你已有的 Skill。
          </div>
        )}
        <button
          type="button"
          className="agent-new-button"
          onClick={() => choose(null)}
          disabled={saving || starting}
        >
          <Plus size={15} />
          新建 Agent
        </button>
      </aside>
      )}
      <main className="agent-main" aria-label="Agent 工作区">
        <header className="agent-header">
          <div>
            {isChat && (
              <Link
                className="agent-back-link"
                to={`/agents${selectedId ? `?agentId=${selectedId}` : ''}`}
              >
                <ChevronLeft size={14} />
                返回装配台
              </Link>
            )}
            <p className="agent-eyebrow">
              {isChat ? 'AGENT 会话' : 'AGENT 装配台'}
            </p>
            <h1>
              {agent?.name ?? (selectedId ? 'Agent 配置' : '创建 Agent')}
            </h1>
            <p className="agent-muted">
              {isChat
                ? '对话固定创建时的 Agent 指令、模型与 Skill 版本。'
                : '定义 Agent 核心，再把 Skill 模块自由装配成可运行的包。'}
            </p>
            <div className="agent-hero-stats" aria-label="Agent 概览">
              <span className="agent-stat is-primary">
                <strong>{draft.skills.filter((s) => s.enabled).length}</strong>
                启用模块
              </span>
              <span className="agent-stat">
                <strong>{draft.skills.length}</strong>
                已装配
              </span>
              <span className="agent-stat is-model">
                {draft.model.trim() || '默认模型'}
              </span>
            </div>
          </div>
          <div className="agent-actions">
            {isChat ? (
              <button
                type="button"
                className="agent-primary"
                disabled={!canStart}
                onClick={() => void start('run')}
              >
                <Plus size={16} />
                新对话
              </button>
            ) : (
              <button
                type="button"
                className="agent-primary"
                disabled={!canStart}
                onClick={() =>
                  navigate(
                    `/agents/chat?agentId=${encodeURIComponent(agent!.id)}&new=1`,
                  )
                }
              >
                <MessageSquare size={16} />
                开始对话
              </button>
            )}
          </div>
        </header>
        {!isChat && (
          <>
            {attachmentLoading && (
              <p role="status" className="agent-banner">
                {querySkillId
                  ? '正在把 Skill 转换成 Agent…'
                  : '正在查找待绑定 Skill…'}
              </p>
            )}
            {attachmentError && (
              <div role="alert" className="agent-error">
                {attachmentError}
                {provisionFailed && querySkillId && (
                  <button type="button" onClick={retryProvision}>
                    重新尝试自动创建
                  </button>
                )}
              </div>
            )}
            {pendingSkill && (
              <div className="agent-banner">
                <div>
                  <strong>待绑定：{pendingSkill.name}</strong>
                  <p>自动创建 Agent 未成功，可把这个 Skill 手动加入后继续。</p>
                </div>
                <button
                  type="button"
                  disabled={
                    detailLoading ||
                    saving ||
                    starting ||
                    !selectionReady ||
                    !!detailError ||
                    !(
                      pendingSkill.currentVersionId ??
                      pendingSkill.latestVersionId
                    ) ||
                    draft.skills.some((s) => s.skillId === pendingSkill.id)
                  }
                  onClick={attachPending}
                >
                  {draft.skills.some((s) => s.skillId === pendingSkill.id)
                    ? '已加入当前配置'
                    : '添加待绑定 Skill'}
                </button>
              </div>
            )}
          </>
        )}
        {actionError && (
          <div role="alert" className="agent-error">
            {actionError}
            {conflict && (
              <button
                type="button"
                onClick={() => {
                  setDiscardTarget({ id: selectedId });
                }}
              >
                重新加载配置
              </button>
            )}
          </div>
        )}
        {notice && (
          <p role="status" className="agent-notice">
            {notice}
          </p>
        )}
        {detailLoading ? (
          <p role="status" className="agent-empty-inline">
            正在加载 Agent 配置…
          </p>
        ) : detailError ? (
          <div role="alert" className="agent-error">
            {detailError}
            <button type="button" onClick={() => setDetailRetry((r) => r + 1)}>
              重试配置
            </button>
          </div>
        ) : selectionReady ? (
          <>
            {!isChat && (
              <form
                className="agent-editor"
                onSubmit={(e) => {
                  e.preventDefault();
                  void save();
                }}
              >
                <fieldset disabled={saving || starting}>
                  <div className="agent-editor-layout">
                    <section className="agent-panel agent-core-panel">
                      <header className="agent-panel-head">
                        <span className="agent-panel-index">01</span>
                        <div>
                          <h2>Agent 核心</h2>
                          <p>身份、模型与工作方式</p>
                        </div>
                      </header>
                      <div className="agent-form-grid">
                        <label className="agent-field">
                          Agent 名称
                          <input
                            required
                            maxLength={100}
                            value={draft.name}
                            placeholder="例如：课程设计助手"
                            onChange={(e) =>
                              setDraft({ ...draft, name: e.target.value })
                            }
                          />
                        </label>
                        <label className="agent-field">
                          模型
                          <input
                            maxLength={256}
                            value={draft.model}
                            placeholder="留空使用服务端默认模型"
                            onChange={(e) =>
                              setDraft({ ...draft, model: e.target.value })
                            }
                          />
                        </label>
                      </div>
                      <label className="agent-field">
                        描述
                        <textarea
                          maxLength={2000}
                          rows={2}
                          value={draft.description}
                          placeholder="这个助手适合完成什么任务？"
                          onChange={(e) =>
                            setDraft({ ...draft, description: e.target.value })
                          }
                        />
                      </label>
                      <label className="agent-field">
                        Agent 指令
                        <textarea
                          maxLength={16000}
                          rows={5}
                          value={draft.instructions}
                          placeholder="定义角色、工作方式和多个 Skill 的协作规则…"
                          onChange={(e) =>
                            setDraft({ ...draft, instructions: e.target.value })
                          }
                        />
                      </label>
                    </section>
                    <section className="agent-panel agent-module-panel">
                      <header className="agent-panel-head">
                        <span className="agent-panel-index is-module">02</span>
                        <div>
                          <h2>Skill 模块</h2>
                          <p>从仓库挑选能力，自由组合到当前 Agent</p>
                        </div>
                      </header>
                      <AgentSkillPicker
                        token={token}
                        skills={draft.skills}
                        resolvedSkills={agent?.skills ?? []}
                        onOpenSkill={openSkill}
                        onChange={(skills) => setDraft({ ...draft, skills })}
                      />
                    </section>
                  </div>
                </fieldset>
                <footer className="agent-editor-footer">
                  <p className="agent-muted">
                    {dirty
                      ? '保存并开始对话会把当前配置绑定到新对话。'
                      : !draft.skills.some((s) => s.enabled)
                        ? '可以保存；开始对话前需启用至少一个 Skill。'
                        : '新对话固定当前指令、模型与 Skill 版本。'}
                  </p>
                  <div className="agent-actions">
                    <button
                      type="submit"
                      disabled={
                        saving ||
                        starting ||
                        !draft.name.trim() ||
                        (!!agent && !dirty)
                      }
                    >
                      {saving ? '正在保存…' : agent ? '保存配置' : '创建 Agent'}
                    </button>
                    <button
                      type="button"
                      className="agent-primary"
                      disabled={
                        saving ||
                        starting ||
                        !draft.name.trim() ||
                        !draft.skills.some((s) => s.enabled)
                      }
                      onClick={() => void save(true)}
                    >
                      {agent ? '保存并开始对话' : '创建并开始对话'}
                    </button>
                  </div>
                </footer>
              </form>
            )}
            {isChat && (
              <section
                className="agent-chat-layout"
              >
                <aside
                  className="agent-conversation-list"
                  aria-label="Agent 对话历史"
                >
                  <div className="agent-section-heading">
                    <h3>对话历史</h3>
                    <button
                      type="button"
                      disabled={conversationLoading}
                      onClick={() => setConversationRetry((r) => r + 1)}
                    >
                      刷新
                    </button>
                  </div>
                  {conversationLoading && <p role="status">正在加载对话…</p>}
                  {conversationError && (
                    <p role="alert" className="agent-error">
                      {conversationError}
                    </p>
                  )}
                  {conversations.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      aria-current={thread?.id === item.id ? 'true' : undefined}
                      onClick={() => {
                        setThread(item);
                        writeSelection(selectedId, item.id);
                      }}
                    >
                      <span>{item.title}</span>
                      <small>
                        {item.skillArenaConfig?.surface === 'test'
                          ? '测试'
                          : '运行'}{' '}
                        · {new Date(item.updatedAt).toLocaleDateString('zh-CN')}
                      </small>
                    </button>
                  ))}
                  {!conversationLoading && !conversations.length && (
                    <p className="agent-empty-inline">
                      还没有对话。点击「新对话」开始。
                    </p>
                  )}
                </aside>
                {thread ? (
                  <AgentConversation
                    key={`${token}:${thread.id}`}
                    token={token}
                    thread={thread}
                    onOpenSkill={openSkill}
                  />
                ) : (
                  <div className="agent-chat-empty">
                    <Bot size={32} />
                    <h2>
                      {canStart
                        ? '选择一个对话，或开始新对话'
                        : '还没有可运行的 Skill 模块'}
                    </h2>
                    <p>
                      {canStart
                        ? '历史对话保留创建时的 Agent 配置与 Skill 版本。'
                        : '先在装配台启用至少一个 Skill，再回来开始对话。'}
                    </p>
                    {!canStart && agent && (
                      <Link
                        className="agent-back-link"
                        to={`/agents?agentId=${agent.id}`}
                      >
                        <ChevronLeft size={14} />
                        去装配台启用 Skill
                      </Link>
                    )}
                  </div>
                )}
              </section>
            )}
          </>
        ) : null}
      </main>
      {discardTarget && (
        <div className="agent-dialog-backdrop">
          <section
            className="agent-discard-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="agent-discard-title"
          >
            <h2 id="agent-discard-title">放弃未保存的配置？</h2>
            <p>切换或重新加载后，当前编辑内容会丢失。</p>
            <div className="agent-actions">
              <button
                autoFocus
                type="button"
                onClick={() => setDiscardTarget(null)}
              >
                继续编辑
              </button>
              <button
                type="button"
                onClick={() => {
                  const id = discardTarget.id;
                  setDiscardTarget(null);
                  if (id === selectedId) setDetailRetry((r) => r + 1);
                  else {
                    writeSelection(id);
                    setSelectedId(id);
                  }
                }}
              >
                放弃并继续
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
