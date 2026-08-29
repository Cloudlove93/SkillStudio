import { useEffect, useRef, useState, type MouseEvent } from 'react';
import type { ArenaThread, GuidedCreationSession } from '@educlaw/shared';
import {
  AudioLines,
  FileText,
  FileUp,
  FlaskConical,
  History,
  Info,
  Library,
  Layers2,
  LogOut,
  MessageSquareText,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  PencilLine,
  Play,
  Plus,
  Search,
  Sparkles,
  Trash2,
  ChevronRight,
  X,
} from 'lucide-react';
import { ThemeToggle } from '../theme-toggle';
import { SkillConversationList } from './SkillConversationList';
import { SkillContextMenu } from './SkillContextMenu';
import type { RepositorySkill } from './SkillRepositoryWorkspace';
// skill-conversation-list / 新建对话 / 鏂板缓瀵硅瘽 / onConversationSelect

export type SkillCreateMode = 'conversation' | 'multimodal' | 'document' | 'manual';
export type SkillCreateAction = SkillCreateMode | 'import';
export type SkillMenuAction =
  | 'open'
  | 'overview'
  | 'test'
  | 'versions'
  | 'rename'
  | 'remove';

type Props = {
  sessions: GuidedCreationSession[];
  selectedSessionId: string | null;
  repositoryActive: boolean;
  selectedCreateMode: SkillCreateMode;
  collapsed: boolean;
  search: string;
  userName: string;
  onSearch: (value: string) => void;
  onToggle: () => void;
  onRepository: () => void;
  onCreateMode: (mode: SkillCreateAction) => void;
  onSelect: (session: GuidedCreationSession) => void;
  skills?: RepositorySkill[];
  allRepositorySkills?: RepositorySkill[];
  activeSkillKey?: string | null;
  activeSkillName?: string | null;
  onSelectSkill?: (skill: RepositorySkill) => void;
  onSkillAction?: (skill: RepositorySkill, action: SkillMenuAction) => void;
  onRename: (session: GuidedCreationSession, displayName: string) => Promise<void>;
  onDelete: (session: GuidedCreationSession) => Promise<void>;
  conversations?: ArenaThread[];
  selectedConversationId?: string | null;
  conversationLoading?: boolean;
  conversationRunningId?: string | null;
  completedConversationIds?: ReadonlySet<string>;
  onConversationSelect?: (id: string) => void;
  onNewConversation?: () => void;
  onConversationRename?: (thread: ArenaThread, title: string) => Promise<void> | void;
  onConversationDelete?: (thread: ArenaThread) => Promise<void> | void;
  onLogout: () => void;
};

const creationModes = [
  {
    mode: 'multimodal',
    label: '音视频蒸馏',
    description: '从课堂视频或播客生成 Skill',
    icon: AudioLines,
  },
  {
    mode: 'conversation',
    label: '对话共创',
    description: '边聊边完善，也可从常用场景开始',
    icon: MessageSquareText,
  },
  {
    mode: 'document',
    label: '文档生成',
    description: '一份文档生成一个 Skill',
    icon: FileText,
  },
  {
    mode: 'manual',
    label: '完整填写',
    description: '按字段一次填写需求',
    icon: PencilLine,
  },
  {
    mode: 'import',
    label: '导入 Skill',
    description: '导入标准 Skill ZIP',
    icon: FileUp,
  },
] as const;

const multimodalCreationEnabled =
  import.meta.env.VITE_MULTIMODAL_SKILL_PACK_ENABLED !== 'false';

const statusLabel: Record<string, string> = {
  collecting: '待完善',
  ready_for_confirmation: '待确认',
  finalizing: '生成中',
  failed: '需重试',
};

export function getSessionName(session: GuidedCreationSession) {
  if (session.display_name?.trim()) return session.display_name;
  // v3 教育版流程：优先从 education_draft 提取标题
  const eduDraft = session.education_draft;
  if (eduDraft) {
    const goal = eduDraft.educational_goal?.content?.trim();
    if (goal) return goal;
    const audience = eduDraft.audience_context?.content?.trim();
    if (audience) return audience;
  }
  return session.draft.goal || session.draft.roles || '未命名 Skill';
}

export function SkillWorkspaceSidebar({
  sessions,
  selectedSessionId,
  repositoryActive,
  selectedCreateMode,
  collapsed,
  search,
  userName,
  onSearch,
  onToggle,
  onRepository,
  onCreateMode,
  onSelect,
  skills = [],
  allRepositorySkills = [],
  activeSkillKey = null,
  activeSkillName = null,
  onSelectSkill,
  onSkillAction,
  onRename,
  onDelete,
  conversations = [],
  selectedConversationId = null,
  conversationLoading = false,
  conversationRunningId = null,
  completedConversationIds,
  onConversationSelect,
  onNewConversation,
  onConversationRename,
  onConversationDelete,
  onLogout,
}: Props) {
  const createMenuRef = useRef<HTMLDetailsElement>(null);
  const [dialog, setDialog] = useState<{
    mode: 'rename' | 'delete';
    session: GuidedCreationSession;
  } | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [skillMenu, setSkillMenu] = useState<{
    skill: RepositorySkill;
    x: number;
    y: number;
  } | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addDialogQuery, setAddDialogQuery] = useState('');
  const [expandedSkillKey, setExpandedSkillKey] = useState<string | null>(activeSkillKey);
  const skillEntries = activeSkillKey && activeSkillName && !skills.some((skill) => skill.key === activeSkillKey)
    ? [{ key: activeSkillKey, packageId: '', skillId: '', name: activeSkillName, description: '', updatedAt: '' }, ...skills]
    : skills;
  const visibleDrafts = sessions.filter((item) => {
    if (item.status === 'completed') return false;
    const keyword = search.trim().toLowerCase();
    if (!keyword) return true;
    return getSessionName(item).toLowerCase().includes(keyword);
  });
  const showSkillConversations = Boolean(
    activeSkillKey
      && !repositoryActive
      && onConversationSelect
      && onNewConversation
      && onConversationRename
      && onConversationDelete,
  );
  const skillMenuItems = [
    { id: 'open', label: '打开 Skill', icon: Play },
    { id: 'overview', label: '查看详情', icon: Info },
    { id: 'test', label: '测试 Skill', icon: FlaskConical },
    { id: 'versions', label: '版本管理', icon: History },
    { id: 'rename', label: '重命名', icon: PencilLine },
    { id: 'remove', label: '从工作区移除', icon: LogOut },
  ];

  const openSkillMenu = (event: MouseEvent, skill: RepositorySkill) => {
    event.preventDefault();
    event.stopPropagation();
    setSkillMenu({ skill, x: event.clientX, y: event.clientY });
  };

  useEffect(() => {
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!createMenuRef.current?.contains(event.target as Node)) {
        createMenuRef.current?.removeAttribute('open');
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        createMenuRef.current?.removeAttribute('open');
      }
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  useEffect(() => {
    if (activeSkillKey) setExpandedSkillKey(activeSkillKey);
  }, [activeSkillKey]);

  return (
    <aside className={`skill-sidebar ${collapsed ? 'is-collapsed' : ''}`}>
      <div className="skill-sidebar-brand">
        <div className="skill-brand-title">
          <Sparkles size={17} />
          <strong>EduSkill</strong>
        </div>
          <button
            type="button"
            className="skill-icon-button"
          onClick={onToggle}
          aria-label={collapsed ? '展开左侧栏' : '收起左侧栏'}
          title={collapsed ? '展开左侧栏' : '收起左侧栏'}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      <details ref={createMenuRef} className="skill-create-menu skill-create-menu-primary">
        <summary className="skill-new-button" aria-haspopup="menu" title="新建 Skill">
          <Plus size={16} /><span>新建 Skill</span>
        </summary>
        <div className="skill-create-popover" role="menu" aria-label="新建 Skill 的方式">
          <span className="skill-create-popover-title">创建方式</span>
          {creationModes
            .filter(({ mode }) => mode !== 'multimodal' || multimodalCreationEnabled)
            .map(({ mode, label, description, icon: Icon }) => (
            <button
              key={mode}
              type="button"
              role="menuitem"
              className={`skill-create-menu-item ${mode === selectedCreateMode ? 'is-active' : ''}`}
              onClick={(event) => {
                event.currentTarget.closest('details')?.removeAttribute('open');
                onCreateMode(mode);
              }}
            >
              <span className="skill-create-menu-icon"><Icon size={15} /></span>
              <span className="skill-create-menu-copy">
                <strong>{label}</strong>
                <small>{description}</small>
              </span>
              <ChevronRight size={14} />
            </button>
          ))}
        </div>
      </details>
      <button type="button" className="skill-repository-link" onClick={() => setAddDialogOpen(true)}>
        <Layers2 size={14} /><span>加入工作区</span>
      </button>
      <button type="button" className="skill-repository-link" onClick={onRepository}>
        <Library size={14} /><span>Skill 仓库</span>
      </button>

      <label className="skill-search">
        <Search size={14} />
        <input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="搜索"
        />
      </label>

      <div className="skill-sidebar-scroll">
        {skillEntries.length === 0 ? (
          <div className="skill-sidebar-empty">工作区为空，前往「Skill 仓库」选择要使用的 Skill</div>
        ) : skillEntries.map((skill, index) => (
          <div key={skill.key} className={`skill-skill-group ${activeSkillKey === skill.key ? 'is-active' : ''}`}>
            <div
              className="skill-session-row skill-skill-row"
              onContextMenu={(event) => openSkillMenu(event, skill)}
            >
               <button
                 type="button"
                 className="skill-skill-main"
                 onClick={() => {
                   if (activeSkillKey === skill.key && expandedSkillKey === skill.key) {
                     setExpandedSkillKey(null);
                     return;
                   }
                   setExpandedSkillKey(skill.key);
                   onSelectSkill?.(skill);
                 }}
                 title={skill.description}
              >
                <Layers2
                  size={15}
                  strokeWidth={1.8}
                  className={`skill-skill-symbol skill-skill-symbol-${index % 3}`}
                  aria-hidden="true"
                />
                <span className="skill-session-copy">
                  <strong>{skill.name}</strong>
                </span>
              </button>
              <button
                type="button"
                className="skill-skill-more"
                aria-label={`${skill.name} 更多操作`}
                title="更多操作"
                onClick={(event) => openSkillMenu(event, skill)}
              >
                <MoreHorizontal size={14} />
              </button>
            </div>
             {activeSkillKey === skill.key && expandedSkillKey === skill.key && showSkillConversations ? (
              <div className="skill-skill-conversations">
                <SkillConversationList
                  conversations={conversations}
                  selectedConversationId={selectedConversationId}
                  runningConversationId={conversationRunningId}
                  completedConversationIds={completedConversationIds}
                  loading={conversationLoading}
                  onConversationSelect={onConversationSelect}
                  onNewConversation={onNewConversation}
                  onRename={onConversationRename}
                  onDelete={onConversationDelete}
                />
              </div>
            ) : null}
          </div>
        ))}

        {visibleDrafts.length > 0 && (
          <div className="skill-draft-section">
            <div className="skill-sidebar-heading"><span>未完成草稿</span></div>
            {visibleDrafts.map((item) => (
              <div key={item.id} className={`skill-session-row ${selectedSessionId === item.id ? 'is-active' : ''}`}>
                <button
                  type="button"
                  className="skill-session-item"
                  onClick={() => onSelect(item)}
                  title={collapsed ? getSessionName(item) : undefined}
                >
                  <span className={`skill-status-dot status-${item.status}`} />
                  <span className="skill-session-copy">
                    <span>{getSessionName(item)}</span>
                    <small>{statusLabel[item.status] || '草稿'}</small>
                  </span>
                </button>
                {item.status !== 'finalizing' && (
                  <details
                    className="skill-session-actions"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <summary aria-label="会话操作" title="会话操作">
                      <MoreHorizontal size={15} />
                    </summary>
                    <div role="menu">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={(event) => {
                          event.currentTarget.closest('details')?.removeAttribute('open');
                          setDisplayName(getSessionName(item));
                          setDialog({ mode: 'rename', session: item });
                        }}
                      >
                        <PencilLine size={14} />重命名
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="is-destructive"
                        onClick={(event) => {
                          event.currentTarget.closest('details')?.removeAttribute('open');
                          setDialog({ mode: 'delete', session: item });
                        }}
                      >
                        <Trash2 size={14} />删除
                      </button>
                    </div>
                  </details>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {skillMenu ? (
        <SkillContextMenu
          x={skillMenu.x}
          y={skillMenu.y}
          items={skillMenuItems}
          onClose={() => setSkillMenu(null)}
          onSelect={(action) => {
            setSkillMenu(null);
            const selectedAction = action as SkillMenuAction;
            if (selectedAction === 'open' && !onSkillAction) {
              onSelectSkill?.(skillMenu.skill);
              return;
            }
            onSkillAction?.(skillMenu.skill, selectedAction);
          }}
        />
      ) : null}

      {addDialogOpen ? (
        <SkillAddDialog
          skills={allRepositorySkills}
          workspaceKeys={new Set(skills.map((s) => s.key))}
          query={addDialogQuery}
          onQueryChange={setAddDialogQuery}
          onClose={() => {
            setAddDialogOpen(false);
            setAddDialogQuery('');
          }}
          onSelect={(skill) => {
            setAddDialogOpen(false);
            setAddDialogQuery('');
            onSelectSkill?.(skill);
          }}
        />
      ) : null}

      <div className="skill-sidebar-footer">
        <details className="skill-user-menu">
          <summary className="skill-user-row">
            <div className="skill-user-avatar">{userName.slice(0, 1).toUpperCase()}</div>
            <span className="skill-user-name">{userName}</span>
            <MoreHorizontal size={15} />
          </summary>
          <div className="skill-user-popover">
            <div><span>外观</span><ThemeToggle /></div>
            <button onClick={onLogout}><LogOut size={14} />退出登录</button>
          </div>
        </details>
      </div>
      {dialog && (
        <div
          className="skill-session-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !actionBusy) setDialog(null);
          }}
        >
          <form
            className="skill-session-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={dialog.mode === 'rename' ? '重命名会话' : '删除会话'}
            onSubmit={async (event) => {
              event.preventDefault();
              if (actionBusy) return;
              setActionBusy(true);
              try {
                if (dialog.mode === 'rename') {
                  await onRename(dialog.session, displayName.trim());
                } else {
                  await onDelete(dialog.session);
                }
                setDialog(null);
              } finally {
                setActionBusy(false);
              }
            }}
          >
            <h2>{dialog.mode === 'rename' ? '重命名会话' : dialog.session.status === 'completed' ? '移除这段会话？' : '删除这份草稿？'}</h2>
            {dialog.mode === 'rename' ? (
              <input
                autoFocus
                value={displayName}
                maxLength={200}
                onChange={(event) => setDisplayName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && !actionBusy) setDialog(null);
                }}
              />
            ) : (
              <p>
                {dialog.session.status === 'completed'
                  ? '只会从最近使用中移除这段创建会话，Skill 仓库中的内容和版本都会保留。'
                  : '这份草稿和对话将从最近使用中移除。'}
              </p>
            )}
            <footer>
              <button type="button" onClick={() => setDialog(null)} disabled={actionBusy}>取消</button>
              <button
                type="submit"
                className={dialog.mode === 'delete' ? 'is-destructive' : 'is-primary'}
                disabled={actionBusy || (dialog.mode === 'rename' && !displayName.trim())}
              >
                {dialog.mode === 'rename' ? '保存' : '确认删除'}
              </button>
            </footer>
          </form>
        </div>
      )}
    </aside>
  );
}

type SkillAddDialogProps = {
  skills: RepositorySkill[];
  workspaceKeys: Set<string>;
  query: string;
  onQueryChange: (value: string) => void;
  onClose: () => void;
  onSelect: (skill: RepositorySkill) => void;
};

function SkillAddDialog({
  skills,
  workspaceKeys,
  query,
  onQueryChange,
  onClose,
  onSelect,
}: SkillAddDialogProps) {
  const q = query.trim().toLowerCase();
  const addable = skills.filter((s) => {
    if (workspaceKeys.has(s.key)) return false;
    if (!q) return true;
    return `${s.name} ${s.description}`.toLowerCase().includes(q);
  });

  return (
    <div className="skill-add-dialog-backdrop" onClick={onClose}>
      <div className="skill-add-dialog" onClick={(e) => e.stopPropagation()}>
        <header className="skill-add-dialog-header">
          <div>
            <h2>加入工作区</h2>
            <p>从仓库选择 Skill 加入左侧工作区</p>
          </div>
          <button type="button" className="skill-icon-button" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </header>
        <label className="skill-add-dialog-search">
          <Search size={15} />
          <input
            autoFocus
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="搜索 Skill 名称或描述"
          />
        </label>
        <div className="skill-add-dialog-list">
          {addable.length === 0 ? (
            <div className="skill-add-dialog-empty">
              {skills.length === 0 ? '仓库中暂无 Skill' : '没有匹配的 Skill'}
            </div>
          ) : addable.map((skill) => (
            <button
              key={skill.key}
              type="button"
              className="skill-add-dialog-item"
              onClick={() => onSelect(skill)}
            >
              <span className="skill-add-dialog-item-icon">
                <Sparkles size={15} />
              </span>
              <span className="skill-add-dialog-item-copy">
                <strong>{skill.name}</strong>
                <small>{skill.description || '无描述'}</small>
              </span>
              <Plus size={15} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
