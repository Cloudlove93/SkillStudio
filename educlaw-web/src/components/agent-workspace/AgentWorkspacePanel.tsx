import { useEffect, useRef, useState } from 'react';
import type {
  AgentWorkspace,
  AgentWorkspaceInput,
  ArenaThread,
} from '@educlaw/shared';
import {
  Bot,
  FlaskConical,
  MessageSquare,
  Plus,
  Settings2,
} from 'lucide-react';
import { agentsApi, AgentWorkspaceApiError } from '../../api/agents';
import { liteApi, type RepositorySkillRecord } from '../../api/lite-api';
import { AgentSkillPicker, type OpenAgentSkill } from './AgentSkillPicker';
import { AgentConversation } from './AgentConversation';
import '../skill-workspace/skill-workspace.css';
import './agent-workspace.css';

export type AgentWorkspacePanelProps = {
  token: string;
  onOpenSkill?: OpenAgentSkill;
  initialSkillId?: string;
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

/** Mount inside the authenticated /agents page or an existing workspace shell. */
export function AgentWorkspacePanel(props: AgentWorkspacePanelProps) {
  return <AgentWorkspaceSession key={props.token} {...props} />;
}

function AgentWorkspaceSession({
  token,
  onOpenSkill,
  initialSkillId,
}: AgentWorkspacePanelProps) {
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
  const [thread, setThread] = useState<ArenaThread | null>(null);
  const [tab, setTab] = useState<'settings' | 'chat'>('settings');
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
    setTab('settings');
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
    if (!selectionReady) return;
    let current = true;
    setConversationError('');
    setConversationLoading(!!selectedId);
    if (!selectedId) {
      setConversations([]);
      return;
    }
    void agentsApi
      .listConversations(token, selectedId)
      .then((items) => {
        if (!current) return;
        setConversations(items);
        const requested = new URLSearchParams(window.location.search).get(
          'conversation',
        );
        const restored = items.find((item) => String(item.id) === requested);
        if (restored) {
          setThread(restored);
          setTab('chat');
        }
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
  }, [token, selectedId, conversationRetry, selectionReady]);

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
    setTab('settings');
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
      if (andRun && saved.skills.some((s) => s.enabled)) {
        if (
          requestKey.current?.agentId !== saved.id ||
          requestKey.current.purpose !== 'run'
        ) {
          requestKey.current = {
            agentId: saved.id,
            purpose: 'run',
            requestId: crypto.randomUUID(),
          };
        }
        const input = {
          purpose: 'run' as const,
          requestId: requestKey.current.requestId,
        };
        const next = await agentsApi.createConversation(token, saved.id, input);
        if (!mounted.current || generation !== scope.current) return;
        writeSelection(saved.id, next.id);
        requestKey.current = null;
        setConversations((previous) => [
          next,
          ...previous.filter((c) => c.id !== next.id),
        ]);
        setThread(next);
        setTab('chat');
      } else {
        setNotice('Agent 配置已保存。新对话会使用当前配置。');
      }
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

  async function start(purpose: 'run' | 'test') {
    if (
      !agent ||
      dirty ||
      !agent.skills.some((s) => s.enabled) ||
      actionLock.current
    )
      return;
    actionLock.current = true;
    setStarting(true);
    setActionError('');
    const generation = scope.current;
    if (
      requestKey.current?.agentId !== agent.id ||
      requestKey.current.purpose !== purpose
    ) {
      requestKey.current = {
        agentId: agent.id,
        purpose,
        requestId: crypto.randomUUID(),
      };
    }
    const input = { purpose, requestId: requestKey.current.requestId };
    try {
      const next = await agentsApi.createConversation(token, agent.id, input);
      if (!mounted.current || generation !== scope.current) return;
      requestKey.current = null;
      setConversations((previous) => [
        next,
        ...previous.filter((c) => c.id !== next.id),
      ]);
      setThread(next);
      writeSelection(agent.id, next.id);
      setTab('chat');
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
    !starting &&
    !saving &&
    agent.skills.some((s) => s.enabled);
  const openSkill = onOpenSkill;
  return (
    <div className="skill-workspace-root agent-workspace-panel">
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
        <p className="agent-muted">把多个 Skills 组合成自己的教学助手。</p>
        {listLoading && <p role="status">正在加载 Agents…</p>}
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
                {item.skills.filter((s) => s.enabled).length} 个启用的 Skills
              </small>
            </button>
          ))}
        </nav>
        {!listLoading && !listError && !agents.length && (
          <div className="agent-empty-inline">
            创建第一个 Agent，绑定你已有的 Skills。
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
      <main className="agent-main" aria-label="Agent 工作区">
        <header className="agent-header">
          <div>
            <p className="agent-eyebrow">AGENT WORKSPACE</p>
            <h1>{agent?.name ?? (selectedId ? 'Agent 配置' : '创建 Agent')}</h1>
            <p className="agent-muted">
              配置你的助手，明确它可以使用的 Skills。
            </p>
          </div>
          <div className="agent-actions">
            <button
              type="button"
              disabled={!canStart}
              onClick={() => void start('test')}
            >
              <FlaskConical size={16} />
              新建测试对话
            </button>
            <button
              type="button"
              className="agent-primary"
              disabled={!canStart}
              onClick={() => void start('run')}
            >
              <MessageSquare size={16} />
              新建运行对话
            </button>
          </div>
        </header>
        {attachmentLoading && (
          <p role="status" className="agent-banner">
            正在查找待绑定 Skill…
          </p>
        )}
        {attachmentError && (
          <div role="alert" className="agent-error">
            {attachmentError}
          </div>
        )}
        {pendingSkill && (
          <div className="agent-banner">
            <div>
              <strong>待绑定：{pendingSkill.name}</strong>
              <p>为新 Agent 预选，或从左侧选择已有 Agent 后添加。</p>
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
                  pendingSkill.currentVersionId ?? pendingSkill.latestVersionId
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
            <div className="agent-tabs" role="tablist" aria-label="Agent 面板">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'settings'}
                id="agent-settings-tab"
                aria-controls="agent-settings"
                onClick={() => setTab('settings')}
              >
                <Settings2 size={15} />
                配置{dirty ? ' · 未保存' : ''}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'chat'}
                id="agent-chat-tab"
                aria-controls="agent-chat"
                disabled={!agent}
                onClick={() => setTab('chat')}
              >
                <MessageSquare size={15} />
                对话 ({conversations.length})
              </button>
            </div>
            {tab === 'settings' ? (
              <form
                id="agent-settings"
                role="tabpanel"
                aria-labelledby="agent-settings-tab"
                className="agent-editor"
                onSubmit={(e) => {
                  e.preventDefault();
                  void save();
                }}
              >
                <fieldset disabled={saving || starting}>
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
                      placeholder="定义角色、工作方式和多个 Skills 的协作规则…"
                      onChange={(e) =>
                        setDraft({ ...draft, instructions: e.target.value })
                      }
                    />
                  </label>
                  <AgentSkillPicker
                    token={token}
                    skills={draft.skills}
                    resolvedSkills={agent?.skills ?? []}
                    onOpenSkill={openSkill}
                    onChange={(skills) => setDraft({ ...draft, skills })}
                  />
                </fieldset>
                <footer className="agent-editor-footer">
                  <p className="agent-muted">
                    {dirty
                      ? '保存并使用会将当前配置绑定到新对话。'
                      : !draft.skills.some((s) => s.enabled)
                        ? '可以保存；运行前需启用至少一个 Skill。'
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
                      {agent ? '保存并使用' : '创建并使用'}
                    </button>
                  </div>
                </footer>
              </form>
            ) : (
              <section
                id="agent-chat"
                role="tabpanel"
                aria-labelledby="agent-chat-tab"
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
                      还没有对话。新建运行或测试对话后输入任务。
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
                    <h2>选择一个对话，或开始新任务</h2>
                    <p>历史对话保留创建时的 Agent 配置与 Skill 版本。</p>
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
