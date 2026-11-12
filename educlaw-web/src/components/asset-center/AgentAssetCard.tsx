import { useEffect, useState } from 'react';
import type { AgentSummary, ArenaThread } from '@educlaw/shared';
import { MessageSquare, ArrowUpRight } from 'lucide-react';
import { agentsApi } from '../../api/agents';
import { AssetCard } from './AssetCard';
import { agentIsReady } from './asset-center-state';

export function AgentAssetCard({
  agent,
  token,
  onOpen,
  onChat,
}: {
  agent: AgentSummary;
  token: string;
  onOpen: () => void;
  onChat: () => void;
}) {
  const [recent, setRecent] = useState<ArenaThread | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(false);
    void agentsApi
      .listConversations(token, agent.id)
      .then((items) => {
        if (current) setRecent(items[0] ?? null);
      })
      .catch(() => {
        if (current) setError(true);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [token, agent.id, retry]);
  return (
    <AssetCard
      kind="agent"
      name={agent.name}
      description={agent.description}
      onOpen={onOpen}
      metadata={[
        { label: '模型', value: agent.model || '服务端默认模型' },
        {
          label: 'Skill',
          value: `${agent.skills.filter((s) => s.enabled).length} 启用 / ${agent.skills.length} 已绑定`,
        },
        {
          label: '当前版本',
          value: agent.currentVersion
            ? `#${agent.currentVersion}`
            : '暂无版本信息',
        },
        { label: '状态', value: agentIsReady(agent) ? '可使用' : '待配置' },
        {
          label: '最近对话',
          value: loading ? (
            '加载中…'
          ) : error ? (
            <button type="button" onClick={() => setRetry((n) => n + 1)}>
              加载失败，重试
            </button>
          ) : recent ? (
            `${recent.title} · ${new Date(recent.updatedAt).toLocaleDateString('zh-CN')}`
          ) : (
            '暂无对话'
          ),
        },
      ]}
    >
      <button type="button" onClick={onOpen}>
        <ArrowUpRight size={15} />
        查看详情
      </button>
      <button
        type="button"
        className="asset-primary"
        onClick={onChat}
        disabled={!agentIsReady(agent)}
      >
        <MessageSquare size={15} />
        进入对话
      </button>
    </AssetCard>
  );
}
