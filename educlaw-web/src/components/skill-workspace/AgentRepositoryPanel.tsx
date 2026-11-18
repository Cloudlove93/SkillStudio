import { useEffect, useState } from 'react';
import { Bot, Layers3, Plus, RefreshCw } from 'lucide-react';
import { agentsApi, type AgentWorkspace } from '../../api/agents';

type Props = {
  token: string;
  onOpenAgent: (agentId: string) => void;
  onCreateAgent: () => void;
};

function updatedLabel(value: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  });
}

export function AgentRepositoryPanel({
  token,
  onOpenAgent,
  onCreateAgent,
}: Props) {
  const [agents, setAgents] = useState<AgentWorkspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    agentsApi
      .list(token)
      .then((list) => {
        if (!active) return;
        setAgents(list);
        setLoading(false);
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        setError(
          loadError instanceof Error ? loadError.message : 'Agent 仓库加载失败',
        );
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token, retry]);

  if (loading) {
    return (
      <div className="agent-repository-state" role="status">
        <RefreshCw size={16} aria-hidden="true" />
        <span>正在加载 Agent…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="agent-repository-state is-error" role="alert">
        <span>{error}</span>
        <button
          type="button"
          onClick={() => setRetry((current) => current + 1)}
        >
          重试
        </button>
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className="agent-repository-empty">
        <Bot size={20} aria-hidden="true" />
        <strong>还没有 Agent</strong>
        <p>先创建一个 Agent，再把 Skill 模块自由装配进去。</p>
        <button
          type="button"
          className="skill-primary-button"
          onClick={onCreateAgent}
        >
          <Plus size={15} aria-hidden="true" />
          新建 Agent
        </button>
      </div>
    );
  }

  return (
    <section className="agent-repository-section" aria-label="Agent 仓库">
      <div className="agent-repository-grid" role="list">
        {agents.map((agent) => {
          const enabled = agent.skills.filter((skill) => skill.enabled).length;
          return (
            <button
              type="button"
              role="listitem"
              key={agent.id}
              className="agent-repository-card"
              aria-label={`打开 Agent ${agent.name}`}
              onClick={() => onOpenAgent(agent.id)}
            >
              <span className="agent-repository-icon" aria-hidden="true">
                <Bot size={18} />
              </span>
              <span className="agent-repository-body">
                <strong>{agent.name}</strong>
                <span className="agent-repository-desc">
                  {agent.description || '尚未填写描述'}
                </span>
                <span className="agent-repository-meta">
                  <span>
                    <Layers3 size={13} aria-hidden="true" />
                    {enabled} 个启用模块
                  </span>
                  <span>{agent.model || '默认模型'}</span>
                  {updatedLabel(agent.updatedAt) ? (
                    <span>更新于 {updatedLabel(agent.updatedAt)}</span>
                  ) : null}
                </span>
              </span>
              <span className="agent-repository-action">打开装配台</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
