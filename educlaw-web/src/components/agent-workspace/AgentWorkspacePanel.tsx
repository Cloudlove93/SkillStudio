import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { AgentWorkspace, AgentWorkspaceInput } from '@educlaw/shared';
import {
  BookOpen,
  Bot,
  MessageSquare,
  Plus,
  Settings2,
} from 'lucide-react';
import { agentsApi, AgentWorkspaceApiError } from '../../api/agents';
import { routes } from '../../lib/routes';
import { AgentSkillPicker, type OpenAgentSkill } from './AgentSkillPicker';
import { AgentOverview } from '../asset-center/AgentOverview';
import { agentIsReady } from '../asset-center/asset-center-state';
import '../skill-workspace/skill-workspace.css';
import './agent-workspace.css';
import './studio-agent.css';

/** 只负责装配配置；对话在主页进行。 */
export type AgentWorkspacePanelProps = {
  token: string;
  onOpenSkill?: OpenAgentSkill;
  /** 嵌入仓库时隐藏自带列表，只渲染当前 Agent 的详情与编辑。 */
  embedded?: boolean;
  /** 仓库「创建 Agent」入口：即使已有 Agent 也打开空白表单。 */
  createNew?: boolean;
  /** 把未保存状态同步给外层，用于离开前确认。 */
  onDirtyChange?: (dirty: boolean) => void;
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
function writeSelection(agentId: string | null) {
  const url = new URL(window.location.href);
  if (agentId) {
    url.searchParams.set('agentId', agentId);
    // 新建表单已经落到具体 Agent，地址栏不再保留创建入口标记。
    url.searchParams.delete('create');
  } else url.searchParams.delete('agentId');
  window.history.replaceState(
    window.history.state,
    '',
    `${url.pathname}${url.search}${url.hash}`,
  );
}

/** Mount inside the authenticated /agents page. */
export function AgentWorkspacePanel(props: AgentWorkspacePanelProps) {
  return <AgentWorkspaceSession key={props.token} {...props} />;
}

function AgentWorkspaceSession({
  token,
  onOpenSkill,
  embedded = false,
  createNew = false,
  onDirtyChange,
}: AgentWorkspacePanelProps) {
  const navigate = useNavigate();
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
  const [tab, setTab] = useState<'overview' | 'settings'>('overview');
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false);
  const [discardTarget, setDiscardTarget] = useState<{
    id: string | null;
  } | null>(null);
  const actionLock = useRef(false);
  const scope = useRef(0);
  const mounted = useRef(true);
  const adoptedAgentId = useRef<string | null>(null);
  const dirty =
    JSON.stringify(draft) !==
    JSON.stringify(agent ? inputOf(agent) : emptyInput());

  useEffect(() => {
    onDirtyChange?.(dirty || saving);
    return () => onDirtyChange?.(false);
  }, [dirty, saving, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => {
    if (!discardTarget) return;
    const previous = document.activeElement;
    const dialog = document.querySelector<HTMLElement>('.agent-discard-dialog');
    dialog?.querySelector<HTMLButtonElement>('button')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setDiscardTarget(null);
      }
      if (event.key !== 'Tab') return;
      const buttons = dialog?.querySelectorAll<HTMLButtonElement>('button');
      const first = buttons?.[0];
      const last = buttons?.[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, [discardTarget]);

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
      setSelectedId(params.get('agentId'));
      setDetailRetry((r) => r + 1);
    };
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

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
            requested ?? (createNew ? null : (items[0]?.id ?? null));
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
    setTab(selectedId ? 'overview' : 'settings');
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

  function choose(id: string | null) {
    if (saving || (selectionReady && id === selectedId)) return;
    if (dirty) {
      setDiscardTarget({ id });
      return;
    }
    setSelectedId(id);
    writeSelection(id);
    setSelectionReady(true);
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
      if (
        andRun &&
        saved.skills.some((s) => s.enabled && s.available !== false)
      ) {
        navigate(routes.chat(saved.id));
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

  const canChat =
    !!agent &&
    !dirty &&
    !detailLoading &&
    !detailError &&
    !saving &&
    agentIsReady(agent);

  const openSkill = onOpenSkill;
  return (
    <div
      className={`skill-workspace-root agent-workspace-panel${embedded ? ' is-embedded' : ''}`}
    >
      {!embedded && (
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
              disabled={saving}
            >
              <Plus size={17} />
            </button>
          </div>
          <p className="agent-muted">
            把可复用的 Skill 组合成自己的教学 Agent。
          </p>
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
                disabled={saving}
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
            disabled={saving}
          >
            <Plus size={15} />
            新建 Agent
          </button>
        </aside>
      )}
      <main className="agent-main" aria-label="Agent 工作区">
        {embedded && listLoading && <p role="status">正在加载 Agent…</p>}
        {embedded && listError && (
          <div role="alert" className="agent-error">
            {listError}
            <button
              type="button"
              onClick={() => setListRetry((value) => value + 1)}
            >
              重试 Agent 列表
            </button>
          </div>
        )}
        <header className="agent-header">
          <div className="agent-header-main">
            <div className="agent-header-copy">
              <p className="agent-eyebrow">AGENT 装配台</p>
              <h1>
                {agent?.name ?? (selectedId ? 'Agent 配置' : '创建 Agent')}
              </h1>
              <p className="agent-muted">
                定义 Agent 核心，再把 Skill 模块自由装配成可运行的包。
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
          </div>
          <div className="agent-actions">
            <button
              type="button"
              className="agent-primary"
              disabled={!canChat}
              onClick={() => navigate(routes.chat(agent!.id))}
            >
              <MessageSquare size={16} />
              开始对话
            </button>
          </div>
        </header>
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
                {agent && (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'overview'}
                    id="agent-overview-tab"
                    aria-controls="agent-overview"
                    onClick={() => setTab('overview')}
                  >
                    <BookOpen size={15} />
                    概览
                  </button>
                )}
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'settings'}
                  id="agent-settings-tab"
                  aria-controls="agent-settings"
                  onClick={() => setTab('settings')}
                >
                  <Settings2 size={15} />
                  编辑配置{dirty ? ' · 未保存' : ''}
                </button>
              </div>
              {tab === 'overview' && agent ? (
                <div
                  id="agent-overview"
                  role="tabpanel"
                  aria-labelledby="agent-overview-tab"
                >
                  <AgentOverview
                    key={agent.updatedAt}
                    token={token}
                    agent={agent}
                    onEdit={() => setTab('settings')}
                    onOpenSkill={openSkill}
                  />
                </div>
              ) : tab === 'settings' ? (
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
                  <fieldset disabled={saving}>
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
                              setDraft({
                                ...draft,
                                description: e.target.value,
                              })
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
                              setDraft({
                                ...draft,
                                instructions: e.target.value,
                              })
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
              ) : null}
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
