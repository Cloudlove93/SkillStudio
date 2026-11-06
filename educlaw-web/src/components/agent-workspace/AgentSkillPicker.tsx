import { useEffect, useState } from 'react';
import type { AgentResolvedSkill, AgentSkillBinding } from '@educlaw/shared';
import { liteApi, type RepositorySkillRecord } from '../../api/lite-api';
import { useSkillVersions } from '../skill-workspace/use-skill-versions';

export type OpenAgentSkill = (skill: {
  packageId: string;
  skillId: string;
  name: string;
  description: string;
}) => void;

export function AgentSkillPicker({
  token,
  skills,
  resolvedSkills,
  onChange,
  onOpenSkill,
}: {
  token: string;
  skills: AgentSkillBinding[];
  resolvedSkills: AgentResolvedSkill[];
  onChange: (skills: AgentSkillBinding[]) => void;
  onOpenSkill?: OpenAgentSkill;
}) {
  const [repository, setRepository] = useState<RepositorySkillRecord[]>([]);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError('');
    void liteApi
      .listRepositorySkills(token, { limit: 100 })
      .then((page) => {
        if (!current) return;
        setRepository(page.items);
        setCursor(page.nextCursor);
      })
      .catch((e: unknown) => {
        if (current)
          setError(e instanceof Error ? e.message : 'Skill 仓库加载失败');
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [token, retry]);

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    setError('');
    try {
      const page = await liteApi.listRepositorySkills(token, {
        limit: 100,
        cursor,
      });
      setRepository((previous) => [
        ...new Map([...previous, ...page.items].map((s) => [s.id, s])).values(),
      ]);
      setCursor(page.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Skill 仓库加载失败');
    } finally {
      setLoading(false);
    }
  }

  const needle = query.trim().toLocaleLowerCase();
  const limitReached = skills.length >= 20;
  const available = repository.filter(
    (s) => !skills.some((binding) => binding.skillId === s.id),
  );
  return (
    <section className="agent-skills" aria-label="Agent 的 Skills">
      <div className="agent-section-heading">
        <h3>绑定 Skills</h3>
        <span>
          {skills.filter((s) => s.enabled).length} 个启用 / {skills.length}{' '}
          个绑定
        </span>
      </div>
      <p className="agent-muted">
        每个 Skill 固定到明确版本。更新 Skill
        后，可在这里选择新版本；已创建的对话保留原有绑定。
        {limitReached ? ' 每个 Agent 最多挂载 20 个 Skill。' : ''}
      </p>
      <div className="agent-attached-skills">
        {skills.map((binding) => {
          const record = repository.find((s) => s.id === binding.skillId);
          const resolved = resolvedSkills.find(
            (s) => s.skillId === binding.skillId,
          );
          const info = record ? { skillId: record.id, ...record } : resolved;
          return (
            <AttachedSkill
              key={binding.skillId}
              token={token}
              binding={binding}
              info={info}
              onOpenSkill={onOpenSkill}
              onChange={(next) =>
                onChange(
                  skills.map((s) => (s.skillId === binding.skillId ? next : s)),
                )
              }
              onRemove={() =>
                onChange(skills.filter((s) => s.skillId !== binding.skillId))
              }
            />
          );
        })}
      </div>
      {!skills.length && (
        <p className="agent-empty-inline">
          还没有绑定 Skill。可以先保存 Agent，再回来添加。
        </p>
      )}
      <label className="agent-field">
        从 Skill 仓库添加
        <input
          type="search"
          value={query}
          placeholder="搜索 Skill 名称或描述"
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="agent-skill-results">
        {available
          .filter((s) =>
            `${s.name} ${s.description} ${s.packageName}`
              .toLocaleLowerCase()
              .includes(needle),
          )
          .map((s) => {
            const versionId = s.currentVersionId ?? s.latestVersionId;
            return (
              <div className="agent-skill-result" key={s.id}>
                <div>
                  <strong>{s.name}</strong>
                  <p>{s.description || s.packageName}</p>
                  <small>
                    {versionId
                      ? `v${s.currentVersionNumber ?? s.latestVersionNumber ?? '—'}`
                      : '暂无可绑定版本'}
                  </small>
                </div>
                <button
                  type="button"
                  disabled={!versionId || limitReached}
                  title={limitReached ? '每个 Agent 最多挂载 20 个 Skill' : undefined}
                  onClick={() => {
                    if (versionId && !limitReached)
                      onChange([
                        ...skills,
                        {
                          skillId: s.id,
                          skillVersionId: versionId,
                          enabled: true,
                        },
                      ]);
                  }}
                >
                  添加
                </button>
              </div>
            );
          })}
        {!loading &&
          !available.some((s) =>
            `${s.name} ${s.description} ${s.packageName}`
              .toLocaleLowerCase()
              .includes(needle),
          ) && (
            <p className="agent-empty-inline">
              当前已加载的仓库中没有匹配的 Skill。
            </p>
          )}
      </div>
      {loading && (
        <p role="status" className="agent-muted">
          正在加载 Skills…
        </p>
      )}
      {error && (
        <div role="alert" className="agent-error">
          {error}{' '}
          <button type="button" onClick={() => setRetry((r) => r + 1)}>
            重试
          </button>
        </div>
      )}
      {cursor && (
        <button
          type="button"
          disabled={loading}
          onClick={() => void loadMore()}
        >
          加载更多 Skills
        </button>
      )}
    </section>
  );
}

function AttachedSkill({
  token,
  binding,
  info,
  onChange,
  onRemove,
  onOpenSkill,
}: {
  token: string;
  binding: AgentSkillBinding;
  info?: {
    skillId: string;
    packageId: string;
    name: string;
    description: string;
    versionNumber?: number;
    available?: boolean;
  };
  onChange: (binding: AgentSkillBinding) => void;
  onRemove: () => void;
  onOpenSkill?: OpenAgentSkill;
}) {
  const versions = useSkillVersions(token, info?.packageId, binding.skillId);
  const pinned = versions.versions.find((v) => v.id === binding.skillVersionId);
  const unavailable = info?.available === false;
  return (
    <div
      className={`agent-attached-skill${binding.enabled ? '' : ' is-disabled'}`}
    >
      <div className="agent-section-heading">
        <strong>{info?.name ?? `Skill ${binding.skillId}`}</strong>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`移除 ${info?.name ?? binding.skillId}`}
        >
          移除
        </button>
      </div>
      <p>{info?.description}</p>
      {unavailable && (
        <p role="alert" className="agent-error">
          该 Skill 或版本已不可用，请移除后重新绑定。
        </p>
      )}
      <div className="agent-binding-controls">
        <label>
          <input
            type="checkbox"
            checked={binding.enabled}
            disabled={unavailable}
            onChange={(e) =>
              onChange({ ...binding, enabled: e.target.checked })
            }
          />
          启用
        </label>
        <label>
          绑定版本{' '}
          <select
            aria-label={`${info?.name ?? binding.skillId} 的绑定版本`}
            value={binding.skillVersionId}
            disabled={versions.loading || !info}
            onChange={(e) =>
              onChange({ ...binding, skillVersionId: e.target.value })
            }
          >
            {!pinned && (
              <option value={binding.skillVersionId}>
                {info?.versionNumber
                  ? `v${info.versionNumber}`
                  : `已绑定版本 ${binding.skillVersionId}`}
              </option>
            )}
            {versions.versions.map((v) => (
              <option
                key={v.id}
                value={v.id}
                disabled={
                  v.status === 'discarded' && v.id !== binding.skillVersionId
                }
              >
                v{v.versionNumber}
                {v.status === 'discarded' ? '（已弃用）' : ''}
                {v.id === versions.currentVersionId ? ' · 当前' : ''}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={versions.loading}
          onClick={() => void versions.reload()}
          aria-label={`刷新 ${info?.name ?? binding.skillId} 的版本`}
        >
          刷新版本
        </button>
        {versions.hasMore && (
          <button
            type="button"
            disabled={versions.loadingMore}
            onClick={() => void versions.loadMore()}
          >
            更多版本
          </button>
        )}
        {onOpenSkill && info && (
          <button type="button" onClick={() => onOpenSkill(info)}>
            打开 Skill ↗
          </button>
        )}
      </div>
    </div>
  );
}
