import type { GuidedCreationSession } from '@educlaw/shared';
import {
  ArrowUpRight,
  BookOpen,
  Check,
  Clock3,
  MoreHorizontal,
  PencilLine,
  Trash2,
} from 'lucide-react';
import { getSessionName } from './SkillWorkspaceSidebar';
import type { RepositorySkill } from './SkillRepositoryWorkspace';

const repositoryDateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

export function RepositorySkillCard({
  skill,
  managing,
  selected,
  menuOpen,
  onPreview,
  onOpen,
  onToggleSelection,
  onToggleMenu,
  onRequestRename,
  onRequestDelete,
}: {
  skill: RepositorySkill;
  managing: boolean;
  selected: boolean;
  menuOpen: boolean;
  onPreview: () => void;
  onOpen: () => void;
  onToggleSelection: () => void;
  onToggleMenu: () => void;
  onRequestRename: () => void;
  onRequestDelete: () => void;
}) {
  const cardAction = managing ? onToggleSelection : onOpen;

  return (
    <article
      role="listitem"
      className={`skill-repository-card${selected ? ' is-selected' : ''}`}
    >
      <button
        type="button"
        className="skill-repository-card-main"
        aria-label={managing ? `选择${skill.name}` : `打开${skill.name}`}
        aria-pressed={managing ? selected : undefined}
        onFocus={() => {
          if (!managing) onPreview();
        }}
        onClick={cardAction}
      >
        <span className="skill-repository-card-heading">
          <span className="skill-repository-card-icon" aria-hidden="true">
            <BookOpen size={18} />
          </span>
          <span className="skill-repository-card-status">已创建</span>
        </span>
        <strong>{skill.name}</strong>
        <span className="skill-repository-card-description">
          {skill.description || '可继续运行、试用、优化和管理版本。'}
        </span>
        <span className="skill-repository-card-footer">
          <time dateTime={skill.updatedAt}>
            更新于 {repositoryDateFormatter.format(new Date(skill.updatedAt))}
          </time>
          <span className="skill-repository-card-open">
            {managing ? (selected ? '已选择' : '选择') : '打开'}
            {managing ? (
              <Check size={15} aria-hidden="true" />
            ) : (
              <ArrowUpRight size={15} aria-hidden="true" />
            )}
          </span>
        </span>
      </button>

      {managing ? (
        <label
          className="skill-repository-card-checkbox"
          onClick={(event) => event.stopPropagation()}
        >
          <input
            type="checkbox"
            name="selected-skill"
            value={skill.skillId}
            checked={selected}
            onChange={onToggleSelection}
            aria-label={`选择 ${skill.name}`}
          />
        </label>
      ) : (
        <div className="skill-repository-card-menu">
          <button
            type="button"
            aria-label={`${skill.name}操作`}
            title={`${skill.name}操作`}
            aria-expanded={menuOpen}
            data-skill-delete-return={skill.skillId}
            onClick={() => {
              onPreview();
              onToggleMenu();
            }}
          >
            <MoreHorizontal size={17} aria-hidden="true" />
          </button>
          {menuOpen ? (
            <div role="menu">
              <button type="button" role="menuitem" onClick={onRequestRename}>
                <PencilLine size={14} aria-hidden="true" />
                重命名 Skill
              </button>
              <button type="button" role="menuitem" onClick={onRequestDelete}>
                <Trash2 size={14} aria-hidden="true" />
                删除 Skill
              </button>
            </div>
          ) : null}
        </div>
      )}
    </article>
  );
}

export function RepositoryDraftCard({
  session,
  onOpen,
}: {
  session: GuidedCreationSession;
  onOpen: () => void;
}) {
  const name = getSessionName(session);

  return (
    <article role="listitem" className="skill-repository-card is-draft">
      <button
        type="button"
        className="skill-repository-card-main"
        aria-label={`继续编辑${name}`}
        onClick={onOpen}
      >
        <span className="skill-repository-card-heading">
          <span className="skill-repository-card-icon" aria-hidden="true">
            <Clock3 size={18} />
          </span>
          <span className="skill-repository-card-status">未完成草稿</span>
        </span>
        <strong>{name}</strong>
        <span className="skill-repository-card-description">
          继续完善需求，完成后即可生成并保存到 Skill 仓库。
        </span>
        <span className="skill-repository-card-footer">
          <time dateTime={session.updated_at}>
            更新于 {repositoryDateFormatter.format(new Date(session.updated_at))}
          </time>
          <span className="skill-repository-card-open">
            继续完善
            <ArrowUpRight size={15} aria-hidden="true" />
          </span>
        </span>
      </button>
    </article>
  );
}
