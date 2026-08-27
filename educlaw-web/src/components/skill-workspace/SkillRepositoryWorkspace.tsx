import { useEffect, useMemo, useState } from 'react';
import type { GuidedCreationSession } from '@educlaw/shared';
import {
  ArrowRight,
  CheckSquare2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  MoreHorizontal,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { getSessionName } from './SkillWorkspaceSidebar';
import { SkillDeleteConfirmDialog } from './SkillDeleteConfirmDialog';
import {
  clampRepositoryPage,
  filterRepositorySkills,
  intersectSkillSelection,
  REPOSITORY_PAGE_SIZE,
  repositoryPageItems,
  selectionForFilteredSkills,
} from './skill-repository-state';

export type RepositorySkill = {
  key: string;
  packageId: string;
  skillId: string;
  name: string;
  description: string;
  updatedAt: string;
};

type RepositoryTab = 'created' | 'drafts';

type Props = {
  skills: RepositorySkill[];
  sessions: GuidedCreationSession[];
  search: string;
  onSearch: (value: string) => void;
  onSelectSkill: (skill: RepositorySkill) => void;
  onSelectDraft: (session: GuidedCreationSession) => void;
  onDeleteSkills: (skills: RepositorySkill[]) => Promise<void>;
  onNew: () => void;
};

export function SkillRepositoryWorkspace({
  skills,
  sessions,
  search,
  onSearch,
  onSelectSkill,
  onSelectDraft,
  onDeleteSkills,
  onNew,
}: Props) {
  const [activeTab, setActiveTab] = useState<RepositoryTab>('created');
  const [page, setPage] = useState(1);
  const [managing, setManaging] = useState(false);
  const [selectedSkillIds, setSelectedSkillIds] = useState<Set<string>>(new Set());
  const [menuSkillId, setMenuSkillId] = useState<string | null>(null);
  const [pendingDeletion, setPendingDeletion] = useState<RepositorySkill[]>([]);
  const [deleteReturnFocusSkillId, setDeleteReturnFocusSkillId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const created = useMemo(
    () => filterRepositorySkills(skills, search),
    [search, skills],
  );
  const drafts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return sessions.filter(
      (item) => item.status !== 'completed'
        && item.status !== 'cancelled'
        && (!query || getSessionName(item).toLocaleLowerCase().includes(query)),
    );
  }, [search, sessions]);
  const safePage = clampRepositoryPage(page, created.length);
  const pageItems = repositoryPageItems(created, safePage);
  const pageCount = Math.max(1, Math.ceil(created.length / REPOSITORY_PAGE_SIZE));
  const selectedSkills = created.filter((skill) => selectedSkillIds.has(skill.skillId));
  const allFilteredSelected = created.length > 0
    && created.every((skill) => selectedSkillIds.has(skill.skillId));

  useEffect(() => {
    setPage((current) => clampRepositoryPage(current, created.length));
    setSelectedSkillIds((current) => intersectSkillSelection(current, created));
  }, [created]);

  const stopManaging = () => {
    setManaging(false);
    setSelectedSkillIds(new Set());
    setMenuSkillId(null);
  };

  const toggleSelection = (skillId: string) => {
    setSelectedSkillIds((current) => {
      const next = new Set(current);
      if (next.has(skillId)) next.delete(skillId);
      else next.add(skillId);
      return next;
    });
  };

  const confirmDeletion = async () => {
    if (pendingDeletion.length === 0 || deleting) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await onDeleteSkills(pendingDeletion);
      setPendingDeletion([]);
      stopManaging();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : '删除失败，请稍后重试');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <main
      className="skill-repository skill-view-enter"
      data-skill-delete-return-focus
      tabIndex={-1}
    >
      <header className="skill-repository-header">
        <div>
          <span className="skill-eyebrow">Skill 仓库</span>
          <h1>管理你的教育 Skill</h1>
          <p>查找、使用和整理已创建的 Skill。</p>
        </div>
        <button className="skill-primary-button" onClick={onNew}><Plus size={16} />新建 Skill</button>
      </header>

      <div className="skill-repository-tabs" role="tablist" aria-label="Skill 仓库内容">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'created'}
          className={activeTab === 'created' ? 'is-active' : ''}
          onClick={() => { setActiveTab('created'); setPage(1); }}
        >
          已创建 <span>{created.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'drafts'}
          className={activeTab === 'drafts' ? 'is-active' : ''}
          onClick={() => { setActiveTab('drafts'); stopManaging(); }}
        >
          未完成草稿 <span>{drafts.length}</span>
        </button>
      </div>

      <div className="skill-repository-toolbar">
        <label className="skill-repository-search">
          <Search size={16} />
          <input value={search} onChange={(event) => { onSearch(event.target.value); setPage(1); }} placeholder="搜索 Skill" />
        </label>
        {activeTab === 'created' && !managing ? (
          <button type="button" className="skill-repository-manage" onClick={() => setManaging(true)}>
            <CheckSquare2 size={15} />批量管理
          </button>
        ) : null}
      </div>

      {activeTab === 'created' && managing ? (
        <div className="skill-repository-bulkbar">
          <button
            type="button"
            onClick={() => setSelectedSkillIds(
              allFilteredSelected ? new Set() : selectionForFilteredSkills(created, selectedSkillIds),
            )}
          >
            {allFilteredSelected ? '取消全选' : '全选当前搜索结果'}
          </button>
          <span>已选择 {selectedSkills.length} 个 Skill</span>
          <button type="button" onClick={stopManaging}><X size={14} />取消</button>
          <button
            type="button"
            className="is-destructive"
            disabled={selectedSkills.length === 0}
            onClick={() => {
              setDeleteReturnFocusSkillId(null);
              setDeleteError('');
              setPendingDeletion(selectedSkills);
            }}
          >
            <Trash2 size={14} />删除
          </button>
        </div>
      ) : null}

      {activeTab === 'created' ? (
        <section className="skill-repository-section" aria-label="已创建的 Skill">
          {created.length === 0 ? (
            <div className="skill-repository-empty"><Sparkles size={18} /><span>还没有已创建的 Skill</span></div>
          ) : (
            <div className="skill-repository-list">
              {pageItems.map((skill) => (
                <div key={skill.key} className={`skill-repository-row ${selectedSkillIds.has(skill.skillId) ? 'is-selected' : ''}`}>
                  {managing ? (
                    <label className="skill-repository-checkbox" onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedSkillIds.has(skill.skillId)}
                        onChange={() => toggleSelection(skill.skillId)}
                        aria-label={`选择 ${skill.name}`}
                      />
                    </label>
                  ) : null}
                  <button
                    type="button"
                    className="skill-repository-row-main"
                    onClick={() => managing ? toggleSelection(skill.skillId) : onSelectSkill(skill)}
                  >
                    <span className="skill-repository-item-icon"><Sparkles size={15} /></span>
                    <span className="skill-repository-item-copy">
                      <strong>{skill.name}</strong>
                      <small>{skill.description || '可继续运行、测试、优化和管理版本'}</small>
                    </span>
                    <time>{new Date(skill.updatedAt).toLocaleDateString()}</time>
                    {!managing ? <ArrowRight size={15} /> : null}
                  </button>
                  {!managing ? (
                    <div className="skill-repository-row-menu">
                      <button
                        type="button"
                        aria-label="Skill 操作"
                        aria-expanded={menuSkillId === skill.skillId}
                        data-skill-delete-return={skill.skillId}
                        onClick={() => setMenuSkillId((current) => current === skill.skillId ? null : skill.skillId)}
                      >
                        <MoreHorizontal size={16} />
                      </button>
                      {menuSkillId === skill.skillId ? (
                        <div role="menu">
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setDeleteReturnFocusSkillId(skill.skillId);
                              setMenuSkillId(null);
                              setDeleteError('');
                              setPendingDeletion([skill]);
                            }}
                          >
                            <Trash2 size={14} />删除 Skill
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
          {created.length > 0 ? (
            <nav className="skill-repository-pagination" aria-label="Skill 仓库分页">
              <button type="button" disabled={safePage <= 1} onClick={() => setPage((current) => current - 1)} aria-label="上一页">
                <ChevronLeft size={15} />
              </button>
              <span>{safePage} / {pageCount}</span>
              <button type="button" disabled={safePage >= pageCount} onClick={() => setPage((current) => current + 1)} aria-label="下一页">
                <ChevronRight size={15} />
              </button>
            </nav>
          ) : null}
        </section>
      ) : (
        <section className="skill-repository-section" aria-label="未完成草稿">
          {drafts.length === 0 ? (
            <div className="skill-repository-empty"><Clock3 size={18} /><span>没有未完成草稿</span></div>
          ) : (
            <div className="skill-repository-list">
              {drafts.map((item) => (
                <div key={item.id} className="skill-repository-row">
                  <button type="button" className="skill-repository-row-main" onClick={() => onSelectDraft(item)}>
                    <span className="skill-repository-item-icon"><Clock3 size={15} /></span>
                    <span className="skill-repository-item-copy">
                      <strong>{getSessionName(item)}</strong>
                      <small>继续完善需求并生成 Skill</small>
                    </span>
                    <time>{new Date(item.updated_at).toLocaleDateString()}</time>
                    <ArrowRight size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {pendingDeletion.length > 0 ? (
        <SkillDeleteConfirmDialog
          skills={pendingDeletion}
          deleting={deleting}
          error={deleteError}
          returnFocusSkillId={deleteReturnFocusSkillId}
          onCancel={() => { if (!deleting) { setPendingDeletion([]); setDeleteError(''); } }}
          onConfirm={() => void confirmDeletion()}
        />
      ) : null}
    </main>
  );
}
