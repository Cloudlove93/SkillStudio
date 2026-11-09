import { useEffect, useMemo, useState } from 'react';
import type { ArenaThread, SkillVersionDetail } from '@educlaw/shared';
import { liteApi } from '../../api/lite-api';
import { SkillRunWorkspace } from '../skill-workspace/SkillRunWorkspace';
import type { OpenAgentSkill } from './AgentSkillPicker';

export function AgentConversation({
  token,
  thread,
  onOpenSkill,
}: {
  token: string;
  thread: ArenaThread;
  onOpenSkill?: OpenAgentSkill;
}) {
  const [legacyVersion, setLegacyVersion] = useState<SkillVersionDetail>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const execution = thread.skillArenaConfig?.agentExecution;
  const anchor = thread.skillArenaConfig?.right;
  const boundAnchor = execution?.skills.find(
    (s) =>
      s.skillId === anchor?.skillId &&
      s.skillVersionId === anchor?.skillVersionId,
  );
  // 依赖原始值而不是每次渲染都会新建的对象，避免 effect 反复触发重复请求。
  const anchorSkillId = boundAnchor?.skillId ?? anchor?.skillId ?? '';
  const anchorVersionId =
    boundAnchor?.skillVersionId ?? anchor?.skillVersionId ?? '';
  const anchorPackageId = boundAnchor?.packageId ?? String(thread.packageId);
  const pinnedVersion = useMemo<SkillVersionDetail | undefined>(() => {
    if (!boundAnchor) return;
    return {
      id: boundAnchor.skillVersionId,
      skillId: boundAnchor.skillId,
      packageId: boundAnchor.packageId,
      createdInPackageVersionId: boundAnchor.packageVersionId,
      versionNumber: boundAnchor.versionNumber,
      source: 'manual',
      basedOnVersionId: null,
      skill: {
        id: boundAnchor.skillUid,
        dirName: boundAnchor.skillUid,
        name: boundAnchor.name,
        description: boundAnchor.description,
        skillMd: boundAnchor.skillMd,
      },
      contentHash: '',
      status: 'active',
      note: '对话创建时的 Skill 快照',
      createdAt: thread.createdAt,
      discardedAt: null,
      discardedBy: null,
      discardReason: null,
      restoredAt: null,
      restoredBy: null,
    };
  }, [boundAnchor, thread.createdAt]);
  const version = execution ? pinnedVersion : legacyVersion;

  useEffect(() => {
    let current = true;
    setLegacyVersion(undefined);
    setError('');
    if (execution) {
      if (!pinnedVersion)
        setError('此对话缺少完整的 Agent 运行快照，请重新打开其他历史对话。');
      return;
    }
    if (!anchorSkillId || !anchorVersionId || !anchorPackageId) {
      setError('此历史对话缺少固定版本信息，无法恢复。');
      return;
    }
    void liteApi
      .getSkillVersionDetail(token, anchorPackageId, anchorVersionId)
      .then((next) => {
        if (!current) return;
        if (
          next.id !== anchorVersionId ||
          next.skillId !== anchorSkillId ||
          next.packageId !== anchorPackageId
        )
          throw new Error('对话绑定版本与返回的 Skill 版本不一致');
        setLegacyVersion(next);
      })
      .catch((e: unknown) => {
        if (current)
          setError(e instanceof Error ? e.message : '对话版本加载失败');
      });
    return () => {
      current = false;
    };
  }, [
    token,
    anchorSkillId,
    anchorVersionId,
    anchorPackageId,
    execution,
    pinnedVersion,
    retry,
  ]);

  return (
    <div className="agent-conversation">
      <details className="agent-bound-skills" open>
        <summary>
          本对话绑定 · {execution?.name ?? '历史 Skill 对话'} ·{' '}
          {execution?.skills.length ?? (anchor ? 1 : 0)} 个 Skills
        </summary>
        <p className="agent-muted">
          模型：{execution?.model || thread.model || '服务端默认'} ·{' '}
          {thread.skillArenaConfig?.surface === 'test'
            ? '测试对话'
            : '运行对话'}
          。修改 Agent 配置不会改变本对话。
        </p>
        <div className="agent-binding-chips">
          {execution?.skills.map((skill) => (
            <details key={skill.skillId} className="agent-pinned-skill">
              <summary>
                {skill.name} · v{skill.versionNumber}
              </summary>
              <p className="agent-muted">固定版本 ID：{skill.skillVersionId}</p>
              <pre className="agent-pinned-instructions">{skill.skillMd}</pre>
              {onOpenSkill ? (
                <button
                  type="button"
                  onClick={() =>
                    onOpenSkill({
                      packageId: skill.packageId,
                      skillId: skill.skillId,
                      skillVersionId: skill.skillVersionId,
                      name: skill.name,
                      description: skill.description,
                    })
                  }
                  title="打开原 Skill 工作区，可查看版本和优化 Skill"
                >
                  查看 Skill 资产：{skill.name} ↗
                </button>
              ) : null}
            </details>
          ))}
          {!execution && anchor && (
            <details className="agent-pinned-skill">
              <summary>
                {anchor.skillName} · v{anchor.versionNumber}（历史固定版本）
              </summary>
              <p className="agent-muted">
                固定版本 ID：{anchor.skillVersionId}
              </p>
              {version && (
                <pre className="agent-pinned-instructions">
                  {version.skill.skillMd}
                </pre>
              )}
            </details>
          )}
        </div>
        {execution?.instructions && (
          <details>
            <summary>本对话 Agent 指令</summary>
            <p className="agent-pinned-instructions">
              {execution.instructions}
            </p>
          </details>
        )}
      </details>
      {error ? (
        <div className="agent-error" role="alert">
          {error}
          <button type="button" onClick={() => setRetry((r) => r + 1)}>
            重试对话版本
          </button>
        </div>
      ) : version ? (
        <SkillRunWorkspace
          token={token}
          packageId={anchorPackageId}
          version={version}
          currentPackageVersionId={
            boundAnchor?.packageVersionId ??
            thread.basePackageVersionId ??
            undefined
          }
          selectedThreadId={String(thread.id)}
          purpose={thread.skillArenaConfig?.surface === 'test' ? 'test' : 'run'}
          agentName={execution?.name}
          showAnswerOptimization={false}
          onOptimizeAnswer={() => {}}
        />
      ) : (
        <p role="status" className="agent-empty-inline">
          正在加载本对话绑定版本…
        </p>
      )}
    </div>
  );
}
