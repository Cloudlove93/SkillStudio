import type { GuidedCreationSession } from '@educlaw/shared';
import {
  Columns3,
  FileUp,
  FlaskConical,
  History,
  LayoutTemplate,
  Library,
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
  WandSparkles,
} from 'lucide-react';
import { ThemeToggle } from '../theme-toggle';
import type { SkillWorkspaceView } from './skill-workspace-state';

export type SkillCreateMode = 'conversation' | 'template' | 'import' | 'manual';

type Props = {
  sessions: GuidedCreationSession[];
  selectedSessionId: string | null;
  repositoryActive: boolean;
  activeView: SkillWorkspaceView;
  selectedSessionCompleted: boolean;
  selectedCreateMode: SkillCreateMode;
  collapsed: boolean;
  search: string;
  userName: string;
  onSearch: (value: string) => void;
  onToggle: () => void;
  onNew: () => void;
  onRepository: () => void;
  onNavigate: (view: SkillWorkspaceView) => void;
  onCreateMode: (mode: SkillCreateMode) => void;
  onSelect: (session: GuidedCreationSession) => void;
  onLogout: () => void;
};

const creationModes = [
  { mode: 'conversation', label: '自然对话创建', icon: MessageSquareText },
  { mode: 'template', label: '模板创建', icon: LayoutTemplate },
  { mode: 'import', label: '导入 Skill', icon: FileUp },
  { mode: 'manual', label: '手动创建', icon: PencilLine },
] as const;

const skillActions = [
  { view: 'run', label: '运行 Skill', icon: Play },
  { view: 'test', label: '测试', icon: FlaskConical },
  { view: 'arena', label: 'Arena 对比', icon: Columns3 },
  { view: 'optimize', label: '交互式优化', icon: WandSparkles },
  { view: 'versions', label: '版本管理', icon: History },
] as const;

const statusLabel: Record<string, string> = {
  collecting: '待完善',
  ready_for_confirmation: '待确认',
  finalizing: '生成中',
  failed: '需重试',
};

export function getSessionName(session: GuidedCreationSession) {
  return session.draft.goal || session.draft.roles || '未命名 Skill';
}

export function SkillWorkspaceSidebar({
  sessions,
  selectedSessionId,
  repositoryActive,
  activeView,
  selectedSessionCompleted,
  selectedCreateMode,
  collapsed,
  search,
  userName,
  onSearch,
  onToggle,
  onNew,
  onRepository,
  onNavigate,
  onCreateMode,
  onSelect,
  onLogout,
}: Props) {
  const query = search.trim().toLowerCase();
  const visible = sessions.filter((session) =>
    getSessionName(session).toLowerCase().includes(query),
  );

  return (
    <aside className={`skill-sidebar ${collapsed ? 'is-collapsed' : ''}`}>
      <div className="skill-sidebar-brand">
        <div className="skill-brand-title">
          <Sparkles size={17} />
          {!collapsed && <strong>EduSkill</strong>}
        </div>
        <button
          className="skill-icon-button"
          onClick={onToggle}
          aria-label={collapsed ? '展开左侧栏' : '收起左侧栏'}
          title={collapsed ? '展开左侧栏' : '收起左侧栏'}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      <nav className="skill-sidebar-commands" aria-label="Skill 工作区功能">
        <button onClick={onNew} className={!repositoryActive && !selectedSessionId ? 'is-active' : ''}>
          <Plus size={16} />{!collapsed && <span>新建 Skill</span>}
        </button>
        <button onClick={onRepository} className={repositoryActive ? 'is-active' : ''}>
          <Library size={16} />{!collapsed && <span>Skill 仓库</span>}
        </button>
      </nav>

      {activeView === 'create' && (
        <nav className="skill-sidebar-subnav" aria-label="新建 Skill 的方式">
          {!collapsed && <div className="skill-sidebar-heading"><span>开始方式</span></div>}
          {creationModes.map(({ mode, label, icon: Icon }) => (
            <button
              key={mode}
              className={mode === selectedCreateMode ? 'is-active' : ''}
              onClick={() => onCreateMode(mode)}
              title={label}
            >
              <Icon size={15} />
              {!collapsed && <span>{label}</span>}
            </button>
          ))}
        </nav>
      )}

      {selectedSessionCompleted && !repositoryActive && (
        <nav className="skill-sidebar-subnav" aria-label="当前 Skill 功能">
          {!collapsed && <div className="skill-sidebar-heading"><span>当前 Skill</span></div>}
          {skillActions.map(({ view, label, icon: Icon }) => (
            <button
              key={view}
              className={activeView === view ? 'is-active' : ''}
              onClick={() => onNavigate(view)}
              title={label}
            >
              <Icon size={15} />
              {!collapsed && <span>{label}</span>}
            </button>
          ))}
        </nav>
      )}

      {!collapsed && (
        <label className="skill-search">
          <Search size={14} />
          <input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="搜索"
          />
        </label>
      )}

      <div className="skill-sidebar-scroll">
        {!collapsed && <div className="skill-sidebar-heading"><span>最近使用</span></div>}
        {!collapsed && visible.length === 0 && (
          <div className="skill-sidebar-empty">暂无记录</div>
        )}
        {visible.map((item) => (
          <button
            key={item.id}
            className={`skill-session-item ${selectedSessionId === item.id && !repositoryActive ? 'is-active' : ''}`}
            onClick={() => onSelect(item)}
            title={collapsed ? getSessionName(item) : undefined}
          >
            <span className={`skill-status-dot status-${item.status}`} />
            {!collapsed && (
              <span className="skill-session-copy">
                <strong>{getSessionName(item)}</strong>
                <small>
                  {item.status === 'completed'
                    ? `Skill · ${new Date(item.updated_at).toLocaleDateString()}`
                    : statusLabel[item.status] || '草稿'}
                </small>
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="skill-sidebar-footer">
        <details className="skill-user-menu">
          <summary className="skill-user-row">
            <div className="skill-user-avatar">{userName.slice(0, 1).toUpperCase()}</div>
            {!collapsed && <span className="skill-user-name">{userName}</span>}
            {!collapsed && <MoreHorizontal size={15} />}
          </summary>
          <div className="skill-user-popover">
            <div><span>外观</span><ThemeToggle /></div>
            <button onClick={onLogout}><LogOut size={14} />退出登录</button>
          </div>
        </details>
      </div>
    </aside>
  );
}
