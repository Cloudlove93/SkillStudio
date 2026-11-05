import { useEffect, useState } from 'react';
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
  const [version, setVersion] = useState<SkillVersionDetail>();
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
  const anchorSkillId = boundAnchor?.skillId ?? '';
  const anchorVersionId = boundAnchor?.skillVersionId ?? '';
  const anchorPackageId = boundAnchor?.packageId ?? '';

  useEffect(() => {
    let current = true;
    setVersion(undefined);
    setError('');
    if (!execution || !anchorSkillId || !anchorVersionId || !anchorPackageId) {
      setError('此对话缺少 Agent 运行绑定，无法安全恢复。请创建新对话。');
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
        setVersion(next);
      })
      .catch((e: unknown) => {
        if (current)
          setError(e instanceof Error ? e.message : '对话版本加载失败');
      });
    return () => {
      current = false;
    };
  }, [token, anchorSkillId, anchorVersionId, anchorPackageId, execution, retry]);

  return (
    <div className="agent-conversation">
      <details className="agent-bound-skills" open>
        <summary>
          本对话绑定 · {execution?.name ?? 'Agent'} ·{' '}
          {execution?.skills.length ?? 0} 个 Skills
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
            <span key={skill.skillId}>
              {onOpenSkill ? (
                <button
                  type="button"
                  onClick={() =>
                    onOpenSkill({
                      packageId: skill.packageId,
                      skillId: skill.skillId,
                      name: skill.name,
                      description: skill.description,
                    })
                  }
                  title="打开原 Skill 工作区，可查看版本和优化 Skill"
                >
                  {skill.name} · v{skill.versionNumber} ↗
                </button>
              ) : (
                <span>
                  {skill.name} · v{skill.versionNumber}
                </span>
              )}
            </span>
          ))}
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
      ) : version && boundAnchor ? (
        <SkillRunWorkspace
          token={token}
          packageId={boundAnchor.packageId}
          version={version}
          currentPackageVersionId={boundAnchor.packageVersionId}
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
