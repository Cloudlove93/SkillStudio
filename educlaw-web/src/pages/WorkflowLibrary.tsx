import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Flag,
  GitBranch,
  Play,
  Plus,
  Puzzle,
  RefreshCw,
  Search,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { liteApi, type WorkflowListItem } from '../api/lite-api';
import './workflow-library.css';

type Props = {
  token: string;
  onCreate: () => void;
  onOpen: (packageId: string) => void;
};

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '刚刚更新'
    : date.toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function WorkflowLibrary({ token, onCreate, onOpen }: Props) {
  const [items, setItems] = useState<WorkflowListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      setItems(await liteApi.listWorkflows(token));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '无法加载工作流库');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return items;
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(keyword) ||
        item.description.toLowerCase().includes(keyword),
    );
  }, [items, query]);

  const totalNodes = items.reduce((total, item) => total + item.nodeCount, 0);
  const totalSkillNodes = items.reduce(
    (total, item) => total + item.skillNodeCount,
    0,
  );

  return (
    <main className="skill-workflow-library">
      <header className="workflow-library-header">
        <div>
          <span className="skill-eyebrow">WORKFLOW · 工作流库</span>
          <h1>工作流库</h1>
          <p>把多个 Skill 和模型步骤连成一条流程，保存后随时继续编排或试运行。</p>
        </div>
        <div className="workflow-library-actions">
          <button type="button" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'is-spinning' : undefined} />
            刷新
          </button>
          <button type="button" className="skill-primary-button" onClick={onCreate}>
            <Plus size={15} />
            新建工作流
          </button>
        </div>
      </header>

      <div className="workflow-stats" aria-label="工作流概览">
        <span>
          <strong>{items.length}</strong> 个工作流
        </span>
        <i aria-hidden="true" />
        <span>
          <strong>{totalNodes}</strong> 个节点
        </span>
        <i aria-hidden="true" />
        <span>
          <strong>{totalSkillNodes}</strong> 个 Skill 节点
        </span>
      </div>

      {loading ? (
        <div className="workflow-state" role="status">
          <RefreshCw size={16} className="is-spinning" aria-hidden="true" />
          正在加载工作流…
        </div>
      ) : items.length ? (
        <>
          <div className="workflow-toolbar">
            <label className="workflow-search">
              <Search size={14} aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索工作流名称或描述"
                aria-label="搜索工作流"
              />
            </label>
            <span className="workflow-result-count">
              共 {filtered.length} 个
            </span>
          </div>
          {filtered.length ? (
            <section className="workflow-grid" aria-label="工作流列表">
              <button
                type="button"
                className="workflow-create-tile"
                onClick={onCreate}
              >
                <span className="workflow-create-plus">
                  <Plus size={19} aria-hidden="true" />
                </span>
                <strong>空白工作流</strong>
                <span>从开始节点搭建</span>
              </button>
              {filtered.map((item, index) => (
                <article className="workflow-card" key={item.id}>
                  <div className="workflow-card-preview" aria-hidden="true">
                    <span className="workflow-card-index">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <div className="workflow-mini">
                      <span className="workflow-mini-node is-start">
                        <Play size={9} />
                        <em>开始</em>
                      </span>
                      {item.nodeCount > 2 ? (
                        <>
                          <i className="workflow-mini-link" />
                          <span className="workflow-mini-node">
                            <Sparkles size={9} />
                            <em>LLM</em>
                          </span>
                        </>
                      ) : null}
                      {item.skillNodeCount ? (
                        <>
                          <i className="workflow-mini-link" />
                          <span className="workflow-mini-node is-skill">
                            <Puzzle size={9} />
                            <em>Skill</em>
                          </span>
                        </>
                      ) : null}
                      <i className="workflow-mini-link" />
                      <span className="workflow-mini-node is-end">
                        <Flag size={9} />
                        <em>结束</em>
                      </span>
                    </div>
                  </div>
                  <div className="workflow-card-body">
                    <header>
                      <h2>{item.name}</h2>
                      <span className="workflow-version">v{item.versionNumber}</span>
                    </header>
                    <p>{item.description || '工作流草稿'}</p>
                    <span className="workflow-card-updated">
                      更新于 {formatUpdatedAt(item.updatedAt)}
                    </span>
                    <div className="workflow-card-foot">
                      <span>
                        {item.nodeCount} 个节点 · {item.skillNodeCount} 个 Skill
                      </span>
                      <button
                        type="button"
                        className="workflow-card-open"
                        onClick={() => onOpen(item.id)}
                      >
                        继续编辑
                        <ArrowRight size={14} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </section>
          ) : (
            <section className="workflow-empty">
              <Search size={22} aria-hidden="true" />
              <h2>没有匹配的工作流</h2>
              <p>换个关键词试试，或清空搜索查看全部。</p>
              <button
                type="button"
                className="workflow-empty-action"
                onClick={() => setQuery('')}
              >
                清空搜索
              </button>
            </section>
          )}
        </>
      ) : (
        <section className="workflow-empty">
          <GitBranch size={22} aria-hidden="true" />
          <h2>还没有保存的工作流</h2>
          <p>新建一个工作流后，它会自动出现在这里。</p>
          <button
            type="button"
            className="workflow-empty-action"
            onClick={onCreate}
          >
            <Plus size={15} />
            新建工作流
          </button>
        </section>
      )}
    </main>
  );
}
