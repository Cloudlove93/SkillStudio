import { useEffect, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { AgentSummary } from '@educlaw/shared';
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  Bot,
  Plus,
  CheckSquare2,
  Trash2,
} from 'lucide-react';
import { agentsApi } from '../../api/agents';
import { liteApi, type RepositorySkillRecord } from '../../api/lite-api';
import { BASE } from '../../api/client';
import { PRODUCT_NAME } from '../../lib/brand';
import { ThemeToggle } from '../theme-toggle';
import { AgentWorkspacePanel } from '../agent-workspace/AgentWorkspacePanel';
import { AssetCard } from './AssetCard';
import { AssetList } from './AssetList';
import { AgentAssetCard } from './AgentAssetCard';
import { SkillAssetDetail } from './SkillAssetDetail';
import {
  agentIsReady,
  skillIsReady,
  readAssetListState,
  type AssetTab,
  type AssetListState,
} from './asset-center-state';

export function AssetCenter({ token }: { token: string }) {
  return <AssetCenterSession key={token} token={token} />;
}

function AssetCenterSession({ token }: { token: string }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab: AssetTab = params.get('tab') === 'skills' ? 'skills' : 'agents';
  const agentOpen =
    params.has('agentId') ||
    params.has('skillId') ||
    params.get('create') === 'agent';
  const previewId = params.get('previewSkill');
  const previewPackage = params.get('previewPackage');
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [skills, setSkills] = useState<RepositorySkillRecord[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [skillsLoading, setSkillsLoading] = useState(true);
  const [agentsError, setAgentsError] = useState('');
  const [skillsError, setSkillsError] = useState('');
  const [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [linkedSkill, setLinkedSkill] = useState<RepositorySkillRecord | null>(
    null,
  );
  const [linkedError, setLinkedError] = useState('');
  const [linkedLoading, setLinkedLoading] = useState(false);
  const [managing, setManaging] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  useEffect(() => {
    let current = true;
    setAgentsLoading(true);
    setAgentsError('');
    void agentsApi
      .list(token)
      .then((items) => {
        if (current) setAgents(items);
      })
      .catch((e) => {
        if (current)
          setAgentsError(e instanceof Error ? e.message : 'Agent 加载失败');
      })
      .finally(() => {
        if (current) setAgentsLoading(false);
      });
    return () => {
      current = false;
    };
  }, [token, revision]);

  useEffect(() => {
    let current = true;
    setLinkedSkill(null);
    setLinkedError('');
    setLinkedLoading(!!previewId && !!previewPackage);
    if (!previewId || !previewPackage) return;
    void (async () => {
      const records = await liteApi.listPackageSkills(
        token,
        previewPackage,
        false,
      );
      const record = records.find((item) => item.id === previewId);
      if (!record) throw new Error('这个 Skill 已被移除或无权访问。');
      const versions = await liteApi.listSkillVersions(
        token,
        previewPackage,
        previewId,
        { limit: 100 },
      );
      const latest = versions.items[0];
      const currentVersion = versions.items.find(
        (item) => item.id === versions.currentVersionId,
      );
      if (current)
        setLinkedSkill({
          ...record,
          packageName: `Package #${previewPackage}`,
          packageDescription: '',
          latestVersionId: latest?.id ?? null,
          latestVersionNumber: latest?.versionNumber ?? null,
          currentVersionId: versions.currentVersionId,
          currentVersionNumber: currentVersion?.versionNumber ?? null,
        });
    })()
      .catch((e) => {
        if (current)
          setLinkedError(
            e instanceof Error ? e.message : '关联 Skill 加载失败',
          );
      })
      .finally(() => {
        if (current) setLinkedLoading(false);
      });
    return () => {
      current = false;
    };
  }, [token, previewId, previewPackage, revision]);
  useEffect(() => {
    let current = true;
    setSkillsLoading(true);
    setSkillsError('');
    void (async () => {
      const records = new Map<string, RepositorySkillRecord>();
      const cursors = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await liteApi.listRepositorySkills(token, {
          limit: 100,
          cursor,
        });
        if (!current) return;
        page.items.forEach((item) => records.set(item.id, item));
        if (!page.nextCursor) break;
        if (cursors.has(page.nextCursor))
          throw new Error('仓库分页游标重复，请刷新重试');
        cursors.add(page.nextCursor);
        cursor = page.nextCursor;
      } while (cursor);
      if (current) setSkills([...records.values()]);
    })()
      .catch((e) => {
        if (current)
          setSkillsError(e instanceof Error ? e.message : 'Skill 加载失败');
      })
      .finally(() => {
        if (current) setSkillsLoading(false);
      });
    return () => {
      current = false;
    };
  }, [token, revision]);

  function navigateSafely(url: string) {
    if (dirty && !window.confirm('配置尚未保存，放弃修改并离开？')) return;
    setDirty(false);
    navigate(url);
  }
  function open(updates: Record<string, string>) {
    const next = new URLSearchParams(window.location.search);
    [
      'agentId',
      'skillId',
      'previewSkill',
      'previewPackage',
      'skillVersion',
      'create',
      'conversation',
      'autochat',
    ].forEach((key) => next.delete(key));
    Object.entries(updates).forEach(([key, value]) => next.set(key, value));
    navigateSafely(`/agents?${next}`);
  }
  function changeList(changes: Partial<AssetListState>) {
    // BrowserRouter writes the URL before a transition renders. Merge only the
    // changed fields against that URL so rapid input cannot overwrite filters.
    const next = new URLSearchParams(window.location.search);
    const state = { ...readAssetListState(next, tab), ...changes };
    next.set(`${tab}Query`, state.query);
    next.set(`${tab}Filter`, state.filter);
    next.set(`${tab}Sort`, state.sort);
    next.set(`${tab}Page`, String(state.page));
    setParams(next, { replace: true });
  }
  async function deleteSelected() {
    if (
      deleting ||
      !selected.size ||
      !window.confirm(
        `删除所选 ${selected.size} 个 Skill？关联的使用记录也可能受到影响。`,
      )
    )
      return;
    setDeleting(true);
    setDeleteError('');
    try {
      await liteApi.batchDeleteSkills(token, [...selected]);
      setSelected(new Set());
      setManaging(false);
      setRevision((n) => n + 1);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : '删除失败，请重试');
    } finally {
      setDeleting(false);
    }
  }
  function tabKey(event: KeyboardEvent<HTMLButtonElement>, current: AssetTab) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 'agents'
        : event.key === 'End'
          ? 'skills'
          : current === 'agents'
            ? 'skills'
            : 'agents';
    open({ tab: next });
    document.getElementById(`assets-${next}-tab`)?.focus();
  }
  const preview = previewPackage
    ? linkedSkill
    : skills.find((skill) => skill.id === previewId);
  const previewLoading = previewPackage ? linkedLoading : skillsLoading;
  const previewError = previewPackage ? linkedError : skillsError;
  const state = readAssetListState(params, tab);
  const detail = agentOpen || !!previewId;
  return (
    <div className="asset-center">
      <header className="asset-topbar">
        <Link
          to="/"
          onClick={(e) => {
            if (dirty && !window.confirm('配置尚未保存，放弃修改并离开？'))
              e.preventDefault();
          }}
        >
          <img src={`${BASE}/logo.png`} alt="" />
          {PRODUCT_NAME}
        </Link>
        <ThemeToggle />
      </header>
      <main id="main-content" className="asset-content" tabIndex={-1}>
        <header className="asset-heading">
          {detail ? (
            <button
              type="button"
              onClick={() => {
                open({ tab });
                setRevision((n) => n + 1);
              }}
            >
              <ArrowLeft size={16} />
              返回资产中心
            </button>
          ) : (
            <h1>资产中心</h1>
          )}
          {!detail && (
            <div className="asset-actions">
              <button type="button" onClick={() => navigate('/?view=create')}>
                <Plus size={16} />
                生成资产
              </button>
              <button
                type="button"
                className="asset-primary"
                onClick={() => open({ create: 'agent', tab: 'agents' })}
              >
                <Plus size={16} />
                创建 Agent
              </button>
            </div>
          )}
        </header>
        {agentOpen ? (
          <AgentWorkspacePanel
            key={`${token}:${params.get('agentId') || params.get('skillId') || 'new'}`}
            token={token}
            embedded
            createNew={params.get('create') === 'agent'}
            onDirtyChange={setDirty}
            onOpenSkill={(skill) =>
              open({
                tab: 'skills',
                previewSkill: skill.skillId,
                previewPackage: skill.packageId,
                ...(skill.skillVersionId
                  ? { skillVersion: skill.skillVersionId }
                  : {}),
              })
            }
          />
        ) : previewId ? (
          previewLoading ? (
            <p role="status">正在加载 Skill…</p>
          ) : previewError ? (
            <div role="alert" className="asset-error">
              {previewError}
              <button type="button" onClick={() => setRevision((n) => n + 1)}>
                重试
              </button>
            </div>
          ) : preview ? (
            <SkillAssetDetail
              key={`${preview.id}:${params.get('skillVersion') || ''}`}
              token={token}
              skill={preview}
              pinnedVersion={params.get('skillVersion')}
              onNavigate={navigateSafely}
              onChanged={() => setRevision((n) => n + 1)}
              onDeleted={() => {
                open({ tab: 'skills' });
                setRevision((n) => n + 1);
              }}
            />
          ) : (
            <p role="alert" className="asset-error">
              这个 Skill 已被移除或无权访问。
            </p>
          )
        ) : (
          <>
            <div className="asset-tabs" role="tablist" aria-label="资产类型">
              {(['agents', 'skills'] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  role="tab"
                  id={`assets-${item}-tab`}
                  aria-controls="asset-list-panel"
                  aria-selected={tab === item}
                  tabIndex={tab === item ? 0 : -1}
                  onKeyDown={(e) => tabKey(e, item)}
                  onClick={() => open({ tab: item })}
                >
                  {item === 'agents' ? (
                    <Bot size={17} />
                  ) : (
                    <BookOpen size={17} />
                  )}
                  {item === 'agents' ? 'Agent' : 'Skill'}
                </button>
              ))}
            </div>
            <section
              id="asset-list-panel"
              role="tabpanel"
              aria-labelledby={`assets-${tab}-tab`}
            >
              {tab === 'skills' && (
                <div className="asset-actions">
                  <button
                    type="button"
                    disabled={deleting}
                    aria-pressed={managing}
                    onClick={() => {
                      setManaging((value) => !value);
                      setSelected(new Set());
                      setDeleteError('');
                    }}
                  >
                    <CheckSquare2 size={16} />
                    {managing ? '完成管理' : '批量管理'}
                  </button>
                  {managing && (
                    <>
                      <span role="status">已选择 {selected.size} / 100 项</span>
                      <button
                        type="button"
                        disabled={deleting || !selected.size}
                        onClick={() => void deleteSelected()}
                      >
                        <Trash2 size={16} />
                        {deleting ? '正在删除…' : '删除所选'}
                      </button>
                    </>
                  )}
                </div>
              )}
              {tab === 'skills' && deleteError && (
                <p role="alert" className="asset-error">
                  {deleteError}
                </p>
              )}
              {tab === 'agents' ? (
                <AssetList
                  items={agents.map((agent) => ({
                    ...agent,
                    ready: agentIsReady(agent),
                  }))}
                  state={state}
                  onChange={changeList}
                  loading={agentsLoading}
                  error={agentsError}
                  onRetry={() => setRevision((n) => n + 1)}
                  renderItem={(agent) => (
                    <AgentAssetCard
                      key={agent.id}
                      token={token}
                      agent={agent}
                      onOpen={() => open({ agentId: agent.id })}
                      onChat={() => open({ agentId: agent.id, autochat: '1' })}
                    />
                  )}
                />
              ) : (
                <AssetList
                  items={skills.map((skill) => ({
                    ...skill,
                    ready: skillIsReady(skill),
                  }))}
                  state={state}
                  onChange={changeList}
                  loading={skillsLoading}
                  error={skillsError}
                  onRetry={() => setRevision((n) => n + 1)}
                  renderItem={(skill) => (
                    <AssetCard
                      key={skill.id}
                      kind="skill"
                      name={skill.name}
                      description={skill.description}
                      onOpen={() => open({ previewSkill: skill.id })}
                      metadata={[
                        {
                          label: '当前版本',
                          value: skill.currentVersionNumber
                            ? `v${skill.currentVersionNumber}`
                            : '暂无当前版本',
                        },
                        {
                          label: '来源',
                          value:
                            skill.packageName ||
                            `Package #${skill.originPackageId || skill.packageId}`,
                        },
                        {
                          label: '状态',
                          value: skillIsReady(skill) ? '可使用' : '待配置',
                        },
                        {
                          label: '最近更新',
                          value: new Date(skill.updatedAt).toLocaleDateString(
                            'zh-CN',
                          ),
                        },
                      ]}
                    >
                      {managing && (
                        <label className="asset-selection">
                          <input
                            type="checkbox"
                            aria-label={`选择 ${skill.name}`}
                            checked={selected.has(skill.id)}
                            disabled={
                              deleting ||
                              (!selected.has(skill.id) && selected.size >= 100)
                            }
                            onChange={(e) =>
                              setSelected((previous) => {
                                const next = new Set(previous);
                                if (e.target.checked) next.add(skill.id);
                                else next.delete(skill.id);
                                return next;
                              })
                            }
                          />
                          选择
                        </label>
                      )}
                      <button
                        type="button"
                        disabled={deleting}
                        onClick={() => open({ previewSkill: skill.id })}
                      >
                        <ArrowUpRight size={15} />
                        查看 Skill
                      </button>
                    </AssetCard>
                  )}
                />
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
