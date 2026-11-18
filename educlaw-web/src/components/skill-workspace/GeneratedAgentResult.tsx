import type { GuidedCreationSession } from '@educlaw/shared';
import {
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  FileText,
  MessageSquare,
} from 'lucide-react';

/** 生成结果内容，不拥有仓库布局或对话运行逻辑。 */
export function GeneratedAgentResult({
  session,
  busy = false,
  onOpenAgent,
  onOpenSkill,
}: {
  session: GuidedCreationSession;
  busy?: boolean;
  onOpenAgent: () => void;
  onOpenSkill: (skillId?: string) => void;
}) {
  const result = session.generatedAgent;
  const displayName =
    result?.name || session.display_name || session.draft.goal || 'Agent 包';
  const skillCount = result?.skills.length ?? 0;
  const initial = displayName.trim().slice(0, 1) || 'A';

  return (
    <section className="studio-result skill-view-enter" aria-label="生成结果">
      <header className="studio-result-masthead">
        <div className="studio-result-heading">
          <span className="skill-eyebrow">生成完成 · AGENT DOSSIER</span>
          <div className="studio-result-title-row">
            <div className="studio-result-title">
              <span className="studio-result-kind">
                {result ? 'AGENT' : 'LEGACY SKILL'}
              </span>
              <h1>{displayName}</h1>
            </div>
            <span className="studio-result-stamp" aria-hidden="true">
              <em>AGENT</em>
              <strong>{initial}</strong>
              <small>装配档案</small>
            </span>
          </div>
          <p className="studio-result-description">
            {result
              ? result.description ||
                'Agent 已保存，包含核心指令与可独立运行的 Skill 模块。'
              : '这是一条历史 Skill 生成记录。可转为 Agent 使用，原 Skill 和版本继续保留。'}
          </p>
          <dl className="studio-result-ledger">
            <div>
              <dt>MODEL</dt>
              <dd>{result?.model || '服务端默认模型'}</dd>
            </div>
            <div>
              <dt>VERSION</dt>
              <dd>{result ? `#${result.packageVersionId}` : '—'}</dd>
            </div>
            <div>
              <dt>SKILLS</dt>
              <dd>{result ? `${skillCount} 个` : '—'}</dd>
            </div>
          </dl>
          <div className="studio-result-actions">
            <button
              type="button"
              className="studio-result-primary"
              onClick={() => onOpenAgent()}
              disabled={busy || (!session.package_id && !session.skill_id)}
            >
              <MessageSquare size={16} aria-hidden="true" />
              {busy ? '正在打开' : result ? '进入 Agent 对话' : '转为 Agent'}
            </button>
            <button
              type="button"
              className="studio-result-secondary"
              onClick={() => onOpenSkill()}
              disabled={!session.package_id || !session.skill_id}
            >
              <BookOpen size={16} aria-hidden="true" />
              查看 Skill
            </button>
          </div>
        </div>
      </header>

      {result && (
        <>
          <details className="studio-result-instructions">
            <summary>
              <FileText size={15} aria-hidden="true" />
              Agent 指令
              <span>查看角色、边界与 Skill 路由</span>
              <ChevronDown size={15} aria-hidden="true" />
            </summary>
            <pre>{result.instructions}</pre>
          </details>

          <section className="studio-result-skills">
            <header className="studio-result-section-head">
              <div>
                <span className="studio-result-section-index">02</span>
                <h2>这个 Agent 装配的 Skill</h2>
              </div>
              <span className="studio-result-count">{skillCount} 个模块</span>
            </header>
            <div className="studio-result-skill-stack">
              {result.skills.map((skill, index) => (
                <button
                  key={skill.id}
                  type="button"
                  className="asset-skill-link studio-result-skill"
                  onClick={() => onOpenSkill(skill.id)}
                  title={`查看 ${skill.name}`}
                >
                  <span className="studio-result-skill-index">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="studio-result-skill-body">
                    <span className="studio-result-skill-kind">SKILL</span>
                    <strong>{skill.name}</strong>
                    <small>
                      {skill.description ||
                        '装配在当前 Agent 中，可单独打开查看与优化。'}
                    </small>
                  </span>
                  <ArrowUpRight
                    size={16}
                    className="studio-result-skill-open"
                    aria-hidden="true"
                  />
                </button>
              ))}
            </div>
          </section>
        </>
      )}
    </section>
  );
}
