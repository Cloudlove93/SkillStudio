import type { GuidedCreationSession } from '@educlaw/shared';
import { Bot, BookOpen, MessageSquare } from 'lucide-react';

/** 生成结果内容，不拥有资产中心布局或对话运行逻辑。 */
export function GeneratedAgentResult({
  session,
  busy = false,
  onOpenAgent,
  onOpenSkill,
}: {
  session: GuidedCreationSession;
  busy?: boolean;
  onOpenAgent: () => void;
  onOpenSkill: () => void;
}) {
  const result = session.generatedAgent;
  return (
    <section
      className="skill-confirmation-page skill-view-enter"
      aria-label="生成结果"
    >
      <span className="skill-eyebrow">生成完成</span>
      <h1>
        <Bot size={24} aria-hidden="true" />{' '}
        {result?.name ||
          session.display_name ||
          session.draft.goal ||
          '教学 Skill'}
      </h1>
      <p className="skill-page-subtitle">
        {result
          ? result.description ||
            'Agent 和教学 Skill 已保存，可以开始对话或查看 Skill。'
          : '这是一条历史 Skill 生成记录。可转为 Agent 使用，原 Skill 和版本继续保留。'}
      </p>
      {result && (
        <>
          <p>模型：{result.model}</p>
          <details className="skill-file-preview">
            <summary>查看 Agent 指令</summary>
            <pre>{result.instructions}</pre>
          </details>
          <h2>已包含的 Skill</h2>
          <ul>
            {result.skills.map((skill) => (
              <li key={skill.id}>
                <strong>{skill.name}</strong>
                {skill.description && <p>{skill.description}</p>}
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="skill-confirm-actions">
        <button
          type="button"
          className="skill-primary-button"
          onClick={onOpenAgent}
          disabled={busy || (!session.package_id && !session.skill_id)}
        >
          <MessageSquare size={16} aria-hidden="true" />
          {busy ? '正在打开' : result ? '进入 Agent 对话' : '转为 Agent'}
        </button>
        <button
          type="button"
          className="skill-secondary-button"
          onClick={onOpenSkill}
          disabled={!session.package_id || !session.skill_id}
        >
          <BookOpen size={16} aria-hidden="true" />
          查看 Skill
        </button>
      </div>
    </section>
  );
}
