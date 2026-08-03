import type { GuidedCreationSession } from '@educlaw/shared';
import { ArrowRight, Clock3, Library, Plus, Search, Sparkles } from 'lucide-react';
import { getSessionName } from './SkillWorkspaceSidebar';

export type RepositorySkill = {
  key: string;
  packageId: string;
  skillId: string;
  name: string;
  description: string;
  updatedAt: string;
};

type Props = {
  skills: RepositorySkill[];
  sessions: GuidedCreationSession[];
  search: string;
  onSearch: (value: string) => void;
  onSelectSkill: (skill: RepositorySkill) => void;
  onSelectDraft: (session: GuidedCreationSession) => void;
  onNew: () => void;
};

export function SkillRepositoryWorkspace({
  skills,
  sessions,
  search,
  onSearch,
  onSelectSkill,
  onSelectDraft,
  onNew,
}: Props) {
  const query = search.trim().toLowerCase();
  const created = skills.filter((skill) =>
    `${skill.name} ${skill.description}`.toLowerCase().includes(query),
  );
  const drafts = sessions.filter(
    (item) => item.status !== 'completed'
      && item.status !== 'cancelled'
      && getSessionName(item).toLowerCase().includes(query),
  );

  return (
    <main className="skill-repository skill-view-enter">
      <header className="skill-repository-header">
        <div>
          <span className="skill-eyebrow">Skill 仓库</span>
          <h1>管理你的教育 Skill</h1>
          <p>已生成、导入的 Skill 和未完成草稿都统一放在这里。</p>
        </div>
        <button className="skill-primary-button" onClick={onNew}><Plus size={16} />新建 Skill</button>
      </header>

      <label className="skill-repository-search">
        <Search size={16} />
        <input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="搜索 Skill" />
      </label>

      <section className="skill-repository-section">
        <div className="skill-repository-section-title"><Library size={15} /><h2>已创建</h2><span>{created.length}</span></div>
        {created.length === 0 ? (
          <div className="skill-repository-empty"><Sparkles size={18} /><span>还没有已创建的 Skill</span></div>
        ) : (
          <div className="skill-repository-list">
            {created.map((skill) => (
              <button key={skill.key} onClick={() => onSelectSkill(skill)}>
                <span className="skill-repository-item-icon"><Sparkles size={15} /></span>
                <span className="skill-repository-item-copy">
                  <strong>{skill.name}</strong>
                  <small>{skill.description || '可继续运行、测试、优化和管理版本'}</small>
                </span>
                <time>{new Date(skill.updatedAt).toLocaleDateString()}</time>
                <ArrowRight size={15} />
              </button>
            ))}
          </div>
        )}
      </section>

      {drafts.length > 0 && (
        <section className="skill-repository-section">
          <div className="skill-repository-section-title"><Clock3 size={15} /><h2>继续创建</h2><span>{drafts.length}</span></div>
          <div className="skill-repository-list">
            {drafts.map((item) => (
              <button key={item.id} onClick={() => onSelectDraft(item)}>
                <span className="skill-repository-item-icon"><Clock3 size={15} /></span>
                <span className="skill-repository-item-copy">
                  <strong>{getSessionName(item)}</strong>
                  <small>继续完善需求并生成 Skill</small>
                </span>
                <time>{new Date(item.updated_at).toLocaleDateString()}</time>
                <ArrowRight size={15} />
              </button>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
