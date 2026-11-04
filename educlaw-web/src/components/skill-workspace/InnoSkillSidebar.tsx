import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ArenaThread, GuidedCreationSession } from '@educlaw/shared';
import {
  AudioLines,
  Bot,
  BookOpen,
  ChevronDown,
  FileText,
  FileUp,
  Home,
  Layers3,
  LogOut,
  MessageSquareText,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  PencilLine,
  Plus,
  Settings,
} from 'lucide-react';
import { PRODUCT_NAME } from '../../lib/brand';
import { ThemeToggle } from '../theme-toggle';
import { SkillConversationList } from './SkillConversationList';
import type { RepositorySkill } from './SkillRepositoryWorkspace';
import {
  getSessionName,
  type SkillCreateAction,
  type SkillCreateMode,
  type SkillMenuAction,
} from './SkillWorkspaceSidebar';

export type InnoSkillNavSection = 'home' | 'my-skills' | 'create';

type Props = {
  sessions: GuidedCreationSession[];
  selectedSessionId: string | null;
  selectedCreateMode: SkillCreateMode;
  activeSection: InnoSkillNavSection;
  collapsed: boolean;
  userName: string;
  isAdmin: boolean;
  skills: RepositorySkill[];
  activeSkillKey?: string | null;
  activeSkillName?: string | null;
  conversations?: ArenaThread[];
  selectedConversationId?: string | null;
  conversationLoading?: boolean;
  conversationRunningIds?: ReadonlySet<string>;
  completedConversationIds?: ReadonlySet<string>;
  onToggle: () => void;
  onNavigate: (section: Exclude<InnoSkillNavSection, 'create'>) => void;
  onCreateMode: (mode: SkillCreateAction) => void;
  onSelectDraft: (session: GuidedCreationSession) => void;
  onRenameDraft: (
    session: GuidedCreationSession,
    displayName: string,
  ) => Promise<void>;
  onDeleteDraft: (session: GuidedCreationSession) => Promise<void>;
  onSelectSkill: (skill: RepositorySkill) => void;
  onSkillAction: (skill: RepositorySkill, action: SkillMenuAction) => void;
  onConversationSelect?: (id: string) => void;
  onNewConversation?: () => void;
  onConversationRename?: (
    thread: ArenaThread,
    title: string,
  ) => Promise<void> | void;
  onConversationDelete?: (thread: ArenaThread) => Promise<void> | void;
  onAgents?: () => void;
  onAdmin: () => void;
  onLogout: () => void;
};

const creationModes = [
  { mode: 'conversation', label: '对话共创', icon: MessageSquareText },
  { mode: 'multimodal', label: '实录蒸馏', icon: AudioLines },
  { mode: 'document', label: '文档生成', icon: FileText },
  { mode: 'manual', label: '结构视图', icon: PencilLine },
  { mode: 'import', label: '导入 Skill ZIP', icon: FileUp },
] as const;

const statusLabel: Record<string, string> = {
  collecting: '待完善',
  ready_for_confirmation: '待确认',
  finalizing: '生成中',
  failed: '需重试',
};

export function InnoSkillSidebar(props: Props) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  const [draftDialog, setDraftDialog] = useState<{
    mode: 'rename' | 'delete';
    session: GuidedCreationSession;
  } | null>(null);
  const [draftName, setDraftName] = useState('');
  const [busy, setBusy] = useState(false);
  const drafts = props.sessions.filter((item) => item.status !== 'completed');
  const showConversations = Boolean(
    props.activeSkillName &&
    props.onConversationSelect &&
    props.onNewConversation &&
    props.onConversationRename &&
    props.onConversationDelete,
  );

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node))
        menuRef.current?.removeAttribute('open');
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  return (
    <aside
      className={`skill-sidebar isk-sidebar ${props.collapsed ? 'is-collapsed' : ''}`}
    >
      <div className="skill-sidebar-brand">
        <div className="skill-brand-title">
          <img src="/innoskill-logo.svg" alt="" />
          <strong>{PRODUCT_NAME}</strong>
        </div>
        <button
          type="button"
          className="skill-icon-button"
          onClick={props.onToggle}
          aria-label={props.collapsed ? '展开左侧栏' : '收起左侧栏'}
        >
          {props.collapsed ? (
            <PanelLeftOpen size={17} />
          ) : (
            <PanelLeftClose size={17} />
          )}
        </button>
      </div>

      <nav className="isk-sidebar-nav" aria-label="InnoSkill 主导航">
        <NavButton
          active={props.activeSection === 'home'}
          icon={<Home />}
          label="主页"
          onClick={() => props.onNavigate('home')}
        />
        <NavButton
          active={props.activeSection === 'my-skills'}
          icon={<BookOpen />}
          label="我的 Skill"
          onClick={() => props.onNavigate('my-skills')}
        />

        {props.onAgents && <NavButton active={false} icon={<Bot />} label="我的 Agent" onClick={props.onAgents} />}
        <span className="isk-sidebar-section-label">生成</span>
        <div
          className={`isk-sidebar-create ${props.activeSection === 'create' ? 'is-active' : ''}`}
        >
          <button
            type="button"
            onClick={() => props.onCreateMode('conversation')}
          >
            <Plus />
            <span>新建 Skill</span>
          </button>
          <details ref={menuRef}>
            <summary aria-label="选择创建方式">
              <ChevronDown />
            </summary>
            <div>
              {creationModes.map(({ mode, label, icon: Icon }) => (
                <button
                  type="button"
                  key={mode}
                  className={
                    props.selectedCreateMode === mode ? 'is-active' : ''
                  }
                  onClick={() => {
                    menuRef.current?.removeAttribute('open');
                    props.onCreateMode(mode);
                  }}
                >
                  <Icon size={15} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </details>
        </div>

        {drafts.slice(0, 4).map((draft) => (
          <div
            className={`isk-sidebar-draft ${props.selectedSessionId === draft.id ? 'is-active' : ''}`}
            key={draft.id}
          >
            <button
              type="button"
              className="skill-session-item"
              onClick={() => props.onSelectDraft(draft)}
            >
              <span>{getSessionName(draft)}</span>
              <em className={`is-${draft.status}`}>
                {statusLabel[draft.status] || '草稿'}
              </em>
            </button>
            <details>
              <summary aria-label={`${getSessionName(draft)} 更多操作`}>
                <MoreHorizontal />
              </summary>
              <div>
                <button
                  type="button"
                  onClick={() => {
                    setDraftName(getSessionName(draft));
                    setDraftDialog({ mode: 'rename', session: draft });
                  }}
                >
                  重命名
                </button>
                <button
                  type="button"
                  className="is-danger"
                  onClick={() =>
                    setDraftDialog({ mode: 'delete', session: draft })
                  }
                >
                  删除
                </button>
              </div>
            </details>
          </div>
        ))}

        {props.skills.length ? (
          <>
            <span className="isk-sidebar-section-label is-compact">
              最近 Skill
            </span>
            {props.skills.slice(0, 5).map((skill) => (
              <div
                className={`isk-sidebar-skill ${props.activeSkillKey === skill.key ? 'is-active' : ''}`}
                key={skill.key}
              >
                <button
                  type="button"
                  onClick={() => props.onSelectSkill(skill)}
                >
                  <Layers3 />
                  <span>{skill.name}</span>
                </button>
                <details>
                  <summary aria-label={`${skill.name} 更多操作`}>
                    <MoreHorizontal />
                  </summary>
                  <div>
                    <button
                      type="button"
                      onClick={() => props.onSkillAction(skill, 'overview')}
                    >
                      查看详情
                    </button>
                    <button
                      type="button"
                      onClick={() => props.onSkillAction(skill, 'versions')}
                    >
                      版本管理
                    </button>
                    <button
                      type="button"
                      onClick={() => props.onSkillAction(skill, 'export')}
                    >
                      导出 Skill
                    </button>
                    <button
                      type="button"
                      onClick={() => props.onSkillAction(skill, 'rename')}
                    >
                      重命名
                    </button>
                    <button
                      type="button"
                      onClick={() => props.onSkillAction(skill, 'remove')}
                    >
                      从工作区移除
                    </button>
                  </div>
                </details>
              </div>
            ))}
          </>
        ) : null}

        {showConversations ? (
          <div className="isk-sidebar-current-skill">
            <span>当前 Skill</span>
            <strong>
              <Layers3 size={14} />
              {props.activeSkillName}
            </strong>
            <SkillConversationList
              conversations={props.conversations ?? []}
              selectedConversationId={props.selectedConversationId ?? null}
              runningConversationIds={props.conversationRunningIds}
              completedConversationIds={props.completedConversationIds}
              loading={props.conversationLoading ?? false}
              onConversationSelect={props.onConversationSelect!}
              onNewConversation={props.onNewConversation!}
              onRename={props.onConversationRename!}
              onDelete={props.onConversationDelete!}
            />
          </div>
        ) : null}

        {props.isAdmin ? (
          <>
            <span className="isk-sidebar-section-label">管理</span>
            <NavButton
              icon={<Settings />}
              label="管理后台"
              onClick={props.onAdmin}
            />
          </>
        ) : null}
      </nav>

      <div className="skill-sidebar-footer">
        <details className="skill-user-menu">
          <summary className="skill-user-row">
            <div className="skill-user-avatar">
              {props.userName.slice(0, 1).toUpperCase()}
            </div>
            <span className="skill-user-name">{props.userName}</span>
            <MoreHorizontal size={15} />
          </summary>
          <div className="skill-user-popover">
            <div>
              <span>外观</span>
              <ThemeToggle />
            </div>
            <button type="button" onClick={props.onLogout}>
              <LogOut size={14} />
              退出登录
            </button>
          </div>
        </details>
      </div>

      {draftDialog ? (
        <div
          className="skill-session-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy)
              setDraftDialog(null);
          }}
        >
          <form
            className="skill-session-dialog"
            role="dialog"
            aria-modal="true"
            onSubmit={async (event) => {
              event.preventDefault();
              if (busy) return;
              setBusy(true);
              try {
                if (draftDialog.mode === 'rename')
                  await props.onRenameDraft(
                    draftDialog.session,
                    draftName.trim(),
                  );
                else await props.onDeleteDraft(draftDialog.session);
                setDraftDialog(null);
              } finally {
                setBusy(false);
              }
            }}
          >
            <h2>
              {draftDialog.mode === 'rename' ? '重命名草稿' : '删除这份草稿？'}
            </h2>
            {draftDialog.mode === 'rename' ? (
              <input
                autoFocus
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
              />
            ) : (
              <p>草稿及对应共创记录将被删除。</p>
            )}
            <footer>
              <button type="button" onClick={() => setDraftDialog(null)}>
                取消
              </button>
              <button
                type="submit"
                className={
                  draftDialog.mode === 'delete'
                    ? 'is-destructive'
                    : 'is-primary'
                }
                disabled={
                  busy || (draftDialog.mode === 'rename' && !draftName.trim())
                }
              >
                {draftDialog.mode === 'rename' ? '保存' : '确认删除'}
              </button>
            </footer>
          </form>
        </div>
      ) : null}
    </aside>
  );
}

function NavButton({
  active = false,
  icon,
  label,
  badge,
  onClick,
}: {
  active?: boolean;
  icon: ReactNode;
  label: string;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`isk-nav-button ${active ? 'is-active' : ''}`}
      onClick={onClick}
    >
      <span>{icon}</span>
      <b>{label}</b>
      {badge ? <em>{badge} 待办</em> : null}
    </button>
  );
}
