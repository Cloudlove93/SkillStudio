import { CheckSquare2, Sparkles } from 'lucide-react';
import type { RepositorySkill } from './SkillRepositoryWorkspace';

const inspectorDateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

export function RepositoryInspectorContent({
  previewSkill,
  selectedSkills,
  filteredCount,
  managing,
}: {
  previewSkill: RepositorySkill | null;
  selectedSkills: RepositorySkill[];
  filteredCount: number;
  managing: boolean;
}) {
  if (managing) {
    return (
      <div className="skill-inspector-repository">
        <section className="skill-inspector-selection-summary">
          <CheckSquare2 size={20} aria-hidden="true" />
          <div>
            <span>当前筛选 {filteredCount} 个</span>
            <strong>已选择 {selectedSkills.length} 个 Skill</strong>
          </div>
        </section>
        {selectedSkills.length > 0 ? (
          <ul>
            {selectedSkills.map((skill) => (
              <li key={skill.key}>{skill.name}</li>
            ))}
          </ul>
        ) : (
          <p>勾选需要统一管理的 Skill，删除前仍会再次确认。</p>
        )}
      </div>
    );
  }

  if (previewSkill) {
    return (
      <div className="skill-inspector-repository">
        <div className="skill-inspector-skill-preview">
          <Sparkles size={20} aria-hidden="true" />
          <h3>{previewSkill.name}</h3>
          <p>
            {previewSkill.description || '可继续运行、测试、优化和管理版本。'}
          </p>
          <dl>
            <div>
              <dt>最近更新</dt>
              <dd>
                {inspectorDateFormatter.format(
                  new Date(previewSkill.updatedAt),
                )}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    );
  }

  return (
    <div className="skill-context-placeholder">
      <Sparkles size={22} aria-hidden="true" />
      <p>使用键盘聚焦某个 Skill，可在这里快速查看摘要。</p>
    </div>
  );
}
