import { useEffect, useMemo, useState } from 'react';
import type { GuidedCreationSession } from '@educlaw/shared';
import {
  CheckSquare2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { getSessionName } from './SkillWorkspaceSidebar';
import {
  RepositoryDraftCard,
  RepositorySkillCard,
} from './RepositoryCards';
import { SkillDeleteConfirmDialog } from './SkillDeleteConfirmDialog';
import { SkillRenameDialog } from './SkillRenameDialog';
import { InspectorPortal } from './InspectorPortal';
import { RepositoryInspectorContent } from './RepositoryInspectorContent';
import { useWorkspaceInspector } from './WorkspaceInspectorProvider';
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
  onRenameSkill: (skill: RepositorySkill, displayName: string) => Promise<void>;
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
  onRenameSkill,
  onNew,
}: Props) {
  const {
    state: inspectorState,
    openInspector,
    closeInspector,
  } = useWorkspaceInspector();
  const [activeTab, setActiveTab] = useState<RepositoryTab>('created');
  const [page, setPage] = useState(1);
  const [managing, setManaging] = useState(false);
  const [selectedSkillIds, setSelectedSkillIds] = useState<Set<string>>(
    new Set(),
  );
  const [menuSkillId, setMenuSkillId] = useState<string | null>(null);
  const [pendingDeletion, setPendingDeletion] = useState<RepositorySkill[]>([]);
  const [pendingRename, setPendingRename] = useState<RepositorySkill | null>(
    null,
  );
  const [deleteReturnFocusSkillId, setDeleteReturnFocusSkillId] = useState<
    string | null
  >(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [previewSkill, setPreviewSkill] = useState<RepositorySkill | null>(
    null,
  );

  const created = useMemo(
    () => filterRepositorySkills(skills, search),
    [search, skills],
  );
  const drafts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return sessions.filter(
      (item) =>
        item.status !== 'completed' &&
        item.status !== 'cancelled' &&
        (!query || getSessionName(item).toLocaleLowerCase().includes(query)),
    );
  }, [search, sessions]);
  const safePage = clampRepositoryPage(page, created.length);
  const pageItems = repositoryPageItems(created, safePage);
  const pageCount = Math.max(
    1,
    Math.ceil(created.length / REPOSITORY_PAGE_SIZE),
  );
  const selectedSkills = created.filter((skill) =>
    selectedSkillIds.has(skill.skillId),
  );
  const allFilteredSelected =
    created.length > 0 &&
    created.every((skill) => selectedSkillIds.has(skill.skillId));

  useEffect(() => {
    setPage((current) => clampRepositoryPage(current, created.length));
    setSelectedSkillIds((current) => intersectSkillSelection(current, created));
  }, [created]);

  useEffect(() => {
    if (inspectorState.descriptor?.owner !== 'repository') return;
    const itemId = inspectorState.descriptor.itemId;
    if (!itemId) return;
    const selected = skills.find((skill) => skill.skillId === itemId);
    if (selected) {
      setPreviewSkill((current) =>
        current?.skillId === itemId ? current : selected,
      );
    }
  }, [inspectorState.descriptor, skills]);

  const stopManaging = () => {
    setManaging(false);
    setSelectedSkillIds(new Set());
    setMenuSkillId(null);
    setPreviewSkill(null);
    closeInspector({ force: true });
  };

  const previewRepositorySkill = (skill: RepositorySkill) => {
    setPreviewSkill(skill);
    openInspector({
      owner: 'repository',
      view: 'repository-selection',
      title: skill.name,
      description: '快速预览',
      itemId: skill.skillId,
    });
  };

  const startManaging = () => {
    setManaging(true);
    setPreviewSkill(null);
    openInspector({
      owner: 'repository',
      view: 'repository-selection',
      title: '批量选择',
      description: '删除前仍会进行确认。',
    });
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
      setDeleteError(
        error instanceof Error ? error.message : '删除失败，请稍后重试',
      );
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
        <button className="skill-primary-button" onClick={onNew}>
          <Plus size={16} aria-hidden="true" />
          新建 Skill
        </button>
      </header>

      <div
        className="skill-repository-tabs"
        role="tablist"
        aria-label="Skill 仓库内容"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'created'}
          className={activeTab === 'created' ? 'is-active' : ''}
          onClick={() => {
            setActiveTab('created');
            setPage(1);
          }}
        >
          已创建 <span>{created.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'drafts'}
          className={activeTab === 'drafts' ? 'is-active' : ''}
          onClick={() => {
            setActiveTab('drafts');
            stopManaging();
          }}
        >
          未完成草稿 <span>{drafts.length}</span>
        </button>
      </div>

      <div className="skill-repository-toolbar">
        <label className="skill-repository-search">
          <Search size={16} aria-hidden="true" />
          <input
            name="skill-repository-search"
            type="search"
            autoComplete="off"
            value={search}
            onChange={(event) => {
              onSearch(event.target.value);
              setPage(1);
            }}
            placeholder="搜索 Skill…"
          />
        </label>
        {activeTab === 'created' && !managing ? (
          <button
            type="button"
            className="skill-repository-manage"
            onClick={startManaging}
          >
            <CheckSquare2 size={15} aria-hidden="true" />
            批量管理
          </button>
        ) : null}
      </div>

      {activeTab === 'created' && managing ? (
        <div className="skill-repository-bulkbar">
          <button
            type="button"
            onClick={() =>
              setSelectedSkillIds(
                allFilteredSelected
                  ? new Set()
                  : selectionForFilteredSkills(created, selectedSkillIds),
              )
            }
          >
            {allFilteredSelected ? '取消全选' : '全选当前搜索结果'}
          </button>
          <span>已选择 {selectedSkills.length} 个 Skill</span>
          <button type="button" onClick={stopManaging}>
            <X size={14} aria-hidden="true" />
            取消
          </button>
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
            <Trash2 size={14} aria-hidden="true" />
            删除
          </button>
        </div>
      ) : null}

      {activeTab === 'created' ? (
        <section
          className="skill-repository-section"
          aria-label="已创建的 Skill"
        >
          {created.length === 0 ? (
            <div className="skill-repository-empty">
              <Sparkles size={18} />
              <span>还没有已创建的 Skill</span>
            </div>
          ) : (
            <div
              className="skill-repository-card-grid"
              role="list"
              aria-label="已创建的 Skill"
            >
              {pageItems.map((skill) => (
                <RepositorySkillCard
                  key={skill.key}
                  skill={skill}
                  managing={managing}
                  selected={selectedSkillIds.has(skill.skillId)}
                  menuOpen={menuSkillId === skill.skillId}
                  onPreview={() => previewRepositorySkill(skill)}
                  onOpen={() => onSelectSkill(skill)}
                  onToggleSelection={() => toggleSelection(skill.skillId)}
                  onToggleMenu={() =>
                    setMenuSkillId((current) =>
                      current === skill.skillId ? null : skill.skillId,
                    )
                  }
                  onRequestRename={() => {
                    setMenuSkillId(null);
                    setPendingRename(skill);
                  }}
                  onRequestDelete={() => {
                    setDeleteReturnFocusSkillId(skill.skillId);
                    setMenuSkillId(null);
                    setDeleteError('');
                    setPendingDeletion([skill]);
                  }}
                />
              ))}
            </div>
          )}
          {created.length > 0 ? (
            <nav
              className="skill-repository-pagination"
              aria-label="Skill 仓库分页"
            >
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => setPage((current) => current - 1)}
                aria-label="上一页"
              >
                <ChevronLeft size={15} aria-hidden="true" />
              </button>
              <span>
                {safePage} / {pageCount}
              </span>
              <button
                type="button"
                disabled={safePage >= pageCount}
                onClick={() => setPage((current) => current + 1)}
                aria-label="下一页"
              >
                <ChevronRight size={15} aria-hidden="true" />
              </button>
            </nav>
          ) : null}
        </section>
      ) : (
        <section className="skill-repository-section" aria-label="未完成草稿">
          {drafts.length === 0 ? (
            <div className="skill-repository-empty">
              <Clock3 size={18} />
              <span>没有未完成草稿</span>
            </div>
          ) : (
            <div
              className="skill-repository-card-grid"
              role="list"
              aria-label="未完成草稿"
            >
              {drafts.map((item) => (
                <RepositoryDraftCard
                  key={item.id}
                  session={item}
                  onOpen={() => onSelectDraft(item)}
                />
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
          onCancel={() => {
            if (!deleting) {
              setPendingDeletion([]);
              setDeleteError('');
            }
          }}
          onConfirm={() => void confirmDeletion()}
        />
      ) : null}
      {pendingRename ? (
        <SkillRenameDialog
          skill={pendingRename}
          onCancel={() => setPendingRename(null)}
          onRename={onRenameSkill}
        />
      ) : null}
      <InspectorPortal owner="repository">
        <RepositoryInspectorContent
          previewSkill={previewSkill}
          selectedSkills={selectedSkills}
          filteredCount={created.length}
          managing={managing}
        />
      </InspectorPortal>
    </main>
  );
}
