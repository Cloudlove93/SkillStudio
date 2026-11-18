import { useEffect, useState } from 'react';
import type { AgentSummary, ArenaThread } from '@educlaw/shared';
import { MessageSquare } from 'lucide-react';
import { agentsApi } from '../../api/agents';
import { AssetCard } from './AssetCard';
import { agentIsReady } from './asset-center-state';

export function AgentAssetCard({
  agent,
  token,
  index,
  onOpen,
  onChat,
}: {
  agent: AgentSummary;
  token: string;
  index?: number;
  onOpen: () => void;
  onChat: () => void;
}) {
  const [recent, setRecent] = useState<ArenaThread | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [requested, setRequested] = useState(false);
  useEffect(() => {
    if (!requested) return;
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
  }, [token, agent.id, retry, requested]);
  return (
    <AssetCard
      kind="agent"
      name={agent.name}
      description={agent.description}
      onOpen={onOpen}
      index={index}
      onMouseEnter={() => setRequested(true)}
      onFocus={() => setRequested(true)}
      status={
        agentIsReady(agent)
          ? { label: '可使用', tone: 'ready' }
          : { label: '待配置', tone: 'attention' }
      }
      metadata={[
        { label: '模型', value: agent.model || '服务端默认模型' },
        {
          label: 'Skill',
          value: `${agent.skills.filter((s) => s.enabled).length} 启用 / ${agent.skills.length} 已绑定`,
        },
        {
          label: '当前版本',
          value: agent.currentVersionNumber
            ? `v${agent.currentVersionNumber}`
            : '暂无版本信息',
        },
        {
          label: '最近对话',
          value: !requested ? (
            '悬停查看'
          ) : loading ? (
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
