import { useState } from 'react';
import type { AgentSummary, PackageVersion } from '@educlaw/shared';
import { ArrowUpRight, Settings2 } from 'lucide-react';
import { liteApi } from '../../api/lite-api';
import type { OpenAgentSkill } from '../agent-workspace/AgentSkillPicker';
import { AssetCard } from './AssetCard';

export function AgentOverview({
  token,
  agent,
  onEdit,
  onOpenSkill,
}: {
  token: string;
  agent: AgentSummary;
  onEdit: () => void;
  onOpenSkill?: OpenAgentSkill;
}) {
  const [versions, setVersions] = useState<PackageVersion[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  async function loadVersions() {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      setVersions(await liteApi.listVersions(token, agent.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : '版本加载失败');
    } finally {
      setLoading(false);
    }
  }
  return (
    <section className="asset-detail" aria-label="Agent 只读详情">
      <AssetCard
        detail
        kind="agent"
        name={agent.name}
        description={agent.description}
        metadata={[
          { label: '模型', value: agent.model || '服务端默认模型' },
          {
            label: '当前版本',
            value: agent.currentVersion
              ? `#${agent.currentVersion}`
              : '暂无版本信息',
          },
          {
            label: 'Skill',
            value: `${agent.skills.filter((s) => s.enabled).length} 启用 / ${agent.skills.length} 已绑定`,
          },
          {
            label: '生成来源',
            value: agent.sourceSessionId
              ? `会话 #${agent.sourceSessionId}`
              : '手动配置或历史资产',
          },
        ]}
      >
        <button type="button" onClick={onEdit}>
          <Settings2 size={16} />
          编辑配置
        </button>
      </AssetCard>
      <h3>Agent 指令</h3>
      <pre>{agent.instructions || '暂无额外指令'}</pre>
      <details
        onToggle={(e) => {
          if (e.currentTarget.open && versions === null && !error)
            void loadVersions();
        }}
      >
        <summary>版本记录</summary>
        {loading && <p role="status">正在加载版本…</p>}
        {error && (
          <div role="alert" className="asset-error">
            {error}
            <button type="button" onClick={() => void loadVersions()}>
              重试版本
            </button>
          </div>
        )}
        {versions?.map((version) => (
          <details key={version.id}>
            <summary>
              v{version.versionNumber} ·{' '}
              {new Date(version.createdAt).toLocaleDateString('zh-CN')}
              {String(version.id) === agent.currentVersion ? ' · 当前' : ''}
            </summary>
            <p>{version.note || version.source}</p>
            <pre>{version.snapshot.agentMd || '暂无额外指令'}</pre>
            <ul>
              {version.snapshot.skills.map((skill) => (
                <li key={skill.id}>
                  {skill.name}
                  {skill.enabled === false ? '（已停用）' : '（已启用）'}
                </li>
              ))}
            </ul>
          </details>
        ))}
        {versions?.length === 0 && <p>暂无历史版本</p>}
      </details>
      <h3>关联 Skill</h3>
      <div className="asset-skill-links">
        {agent.skills.map((skill) => (
          <AssetCard
            key={skill.skillId}
            kind="skill"
            name={skill.name}
            description={skill.description}
            metadata={[
              { label: '固定版本', value: `v${skill.versionNumber}` },
              {
                label: '状态',
                value: !skill.available
                  ? '版本不可用'
                  : skill.enabled
                    ? '已启用'
                    : '已停用',
              },
            ]}
          >
            {onOpenSkill && (
              <button type="button" onClick={() => onOpenSkill(skill)}>
                <ArrowUpRight size={15} />
                查看 Skill
              </button>
            )}
          </AssetCard>
        ))}
      </div>
      {!agent.skills.length && <p>尚未绑定 Skill</p>}
    </section>
  );
}
