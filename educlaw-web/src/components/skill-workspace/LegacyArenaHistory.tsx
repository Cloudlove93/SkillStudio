import { useEffect, useState } from 'react';
import type { ArenaThreadDetail } from '@educlaw/shared';
import { liteApi } from '../../api/lite-api';
import { MarkdownContent } from '../lite/lite-rendering';

/** Old comparison threads remain readable without admitting a new Skill-only run. */
export function LegacyArenaHistory({
  token,
  packageId,
  threadId,
}: {
  token: string;
  packageId: string;
  threadId: string;
}) {
  const [detail, setDetail] = useState<ArenaThreadDetail>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true;
    setDetail(undefined);
    setError('');
    void liteApi
      .getArenaThreadDetail(token, packageId, threadId)
      .then((next) => {
        if (!current) return;
        if (
          String(next.thread.id) !== threadId ||
          String(next.thread.packageId) !== packageId
        )
          throw new Error('历史对话与当前 Skill 不匹配');
        setDetail(next);
      })
      .catch((cause: unknown) => {
        if (current)
          setError(cause instanceof Error ? cause.message : '历史对话加载失败');
      });
    return () => {
      current = false;
    };
  }, [token, packageId, threadId, retry]);
  if (error)
    return (
      <div role="alert" className="skill-run-error">
        {error}
        <button type="button" onClick={() => setRetry((n) => n + 1)}>
          重试历史对话
        </button>
      </div>
    );
  if (!detail) return <p role="status">正在加载历史版本对比…</p>;
  const config = detail.thread.skillArenaConfig;
  return (
    <section
      className="skill-flat-overview skill-view-enter"
      aria-label="历史版本对比"
    >
      <h2>{detail.thread.title}</h2>
      <p>
        {config?.surface === 'run' || config?.surface === 'test'
          ? '历史 Skill 对话'
          : '历史版本对比'}{' '}
        · 模型：{detail.thread.model || '创建时默认模型'}
      </p>
      <p>
        A：
        {config?.left
          ? `${config.left.skillName} · v${config.left.versionNumber}（版本 ID：${config.left.skillVersionId}）`
          : '未使用 Skill'}
      </p>
      <p>
        B：
        {config?.right
          ? `${config.right.skillName} · v${config.right.versionNumber}（版本 ID：${config.right.skillVersionId}）`
          : '未使用 Skill'}
      </p>
      {detail.messages.map((message) => (
        <article key={message.id} className="skill-overview-sections">
          <h3>
            {message.role === 'user'
              ? '任务'
              : message.side === 'baseline'
                ? 'A 回答'
                : 'B 回答'}
          </h3>
          <MarkdownContent content={message.content} />
        </article>
      ))}
      {!detail.messages.length && <p>此历史对话尚无消息。</p>}
    </section>
  );
}
