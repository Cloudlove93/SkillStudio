import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GuidedCreationSessionDetail, GuidedEducationDimension, SkillVersionDetail } from '@educlaw/shared';
import {
  Check,
  ChevronRight,
  ExternalLink,
  FileText,
  FlaskConical,
  GitBranch,
  LayoutGrid,
  Maximize2,
  Minimize2,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Scale,
  Sparkles,
  WandSparkles,
} from 'lucide-react';
import type { SkillContextView, SkillWorkspaceView } from './skill-workspace-state';
import type { AnswerOptimizationSelection } from './answer-optimization-selection';
import { SkillAnswerOptimizationPanel } from './SkillAnswerOptimizationPanel';

const EDUCATION_DIMENSIONS: { key: GuidedEducationDimension; title: string }[] = [
  { key: 'educational_goal', title: '教育目标' },
  { key: 'audience_context', title: '对象与情境' },
  { key: 'input_evidence', title: '输入与依据' },
  { key: 'teaching_strategy', title: '教育策略' },
  { key: 'action_adaptation', title: '行动与调整' },
  { key: 'boundaries_responsibility', title: '边界与责任' },
  { key: 'completion_evidence', title: '完成与证据' },
];

type Props = {
  session: GuidedCreationSessionDetail | null;
  hasSkill: boolean;
  open: boolean;
  view: SkillContextView;
  activeView: SkillWorkspaceView;
  versions: SkillVersionDetail[];
  currentVersionId: string | null;
  versionsLoading?: boolean;
  onOpen: (view: SkillContextView) => void;
  onClose: () => void;
  onOpenVersionManager: () => void;
  onNavigate: (view: SkillWorkspaceView) => void;
  token: string;
  answerOptimization: AnswerOptimizationSelection | null;
  onAnswerOptimizationSaved: (versionNumber: number) => void;
  onAnswerOptimizationRerun: (versionNumber: number, selection: AnswerOptimizationSelection) => void;
};

const fallbackTopics = [
  { key: 'positioning', title: '定位与目标', fields: ['roles', 'goal'] },
  { key: 'scenario', title: '使用场景', fields: ['usage_scenario'] },
  { key: 'input_output', title: '输入与输出', fields: ['input_contract', 'output_contract'] },
  { key: 'capability_flow', title: '能力与流程', fields: ['core_capabilities', 'workflow'] },
  { key: 'knowledge_boundary', title: '依据与边界', fields: ['knowledge_evidence', 'boundaries_permissions'] },
  { key: 'recovery_completion', title: '异常与完成标准', fields: ['exception_recovery', 'completion_evidence'] },
] as const;

const CONTEXT_OPTIONS: { view: SkillContextView; label: string; icon: typeof FileText; desc: string }[] = [
  { view: 'summary', label: '摘要', icon: FileText, desc: '查看当前信息' },
  { view: 'versions', label: '版本', icon: GitBranch, desc: '浏览版本列表' },
  { view: 'optimization', label: '优化', icon: WandSparkles, desc: '回答优化面板' },
];

const VIEW_OPTIONS = [
  { view: 'run' as const, label: '使用', icon: Play, desc: '运行当前版本' },
  { view: 'test' as const, label: '测试', icon: FlaskConical, desc: '固定版本测试' },
  { view: 'arena' as const, label: 'Arena', icon: Scale, desc: '双版本对比' },
  { view: 'optimize' as const, label: '优化', icon: WandSparkles, desc: '改进回答' },
  { view: 'versions' as const, label: '版本', icon: GitBranch, desc: '版本管理' },
];

function summaryTitle(activeView: SkillWorkspaceView) {
  if (activeView === 'run') return ['运行信息', '当前运行'];
  if (activeView === 'test') return ['测试信息', '当前测试'];
  if (activeView === 'arena') return ['Arena 信息', '版本对比'];
  if (activeView === 'optimize') return ['优化信息', '本轮建议'];
  return ['当前 Skill', '需求摘要'];
}

export function SkillContextPanel(props: Props) {
  const [menuOpen, setMenuOpen] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const railRef = useRef<HTMLDivElement>(null);

  const toggleMenu = useCallback(() => {
    setMenuOpen((prev) => {
      if (!prev && railRef.current) {
        const rect = railRef.current.getBoundingClientRect();
        setPopoverPos({ top: rect.bottom + 6, left: rect.right - 8 });
      }
      return !prev;
    });
  }, []);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  useEffect(() => {
    if (railRef.current) {
      const rect = railRef.current.getBoundingClientRect();
      setPopoverPos({ top: rect.bottom + 6, left: rect.right - 8 });
    }
  }, []);

  const wasMenuOpenRef = useRef(true);

  useEffect(() => {
    if (props.open) {
      wasMenuOpenRef.current = menuOpen;
      closeMenu();
    } else {
      setMenuOpen(wasMenuOpenRef.current);
      setFullscreen(false);
    }
  }, [props.open, closeMenu]);

  const [eyebrow, title] = props.view === 'versions'
    ? ['版本管理', '最近版本']
    : props.view === 'optimization'
      ? ['回答优化', '改进这条回答']
      : summaryTitle(props.activeView);

  return (
    <aside className={`skill-context ${props.open ? 'is-open' : 'is-collapsed'} ${fullscreen && props.open ? 'is-fullscreen' : ''}`}>
      <nav ref={railRef} className="skill-context-rail" aria-label="右侧栏操作" aria-hidden={props.open}>
        <button
          ref={menuBtnRef}
          className={`skill-icon-button ${menuOpen ? 'is-active' : ''}`}
          onClick={toggleMenu}
          aria-label="功能选项"
          title="功能选项"
        >
          <LayoutGrid size={17} />
        </button>
        <button
          className="skill-icon-button"
          onClick={() => props.onOpen('summary')}
          aria-label="展开右侧栏"
          title="展开右侧栏"
        >
          <PanelRightOpen size={17} />
        </button>
      </nav>
      {menuOpen && createPortal(
        <div className="skill-context-popover" style={{ top: popoverPos.top, left: popoverPos.left }}>
          <div className="skill-context-popover-section">
            <span className="skill-context-popover-label">视图切换</span>
            {VIEW_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const isActive = props.activeView === opt.view;
              return (
                <button
                  key={opt.view}
                  className={`skill-context-popover-item ${isActive ? 'is-current' : ''}`}
                  onClick={() => { props.onNavigate(opt.view); closeMenu(); }}
                >
                  <span className="skill-context-popover-icon">
                    <Icon size={14} />
                  </span>
                  <div className="skill-context-popover-copy">
                    <strong>{opt.label}</strong>
                    <small>{opt.desc}</small>
                  </div>
                  {isActive && <span className="skill-context-popover-dot" />}
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
      <div className="skill-context-panel-body" aria-hidden={!props.open}>
        <header className="skill-context-header">
          <div>
            <span className="skill-eyebrow">{eyebrow}</span>
            <h2>{title}</h2>
          </div>
          <div className="skill-context-header-actions">
            {props.view === 'versions' && (
              <button className="skill-icon-button" onClick={props.onOpenVersionManager} title="在主区域打开">
                <ExternalLink size={16} />
              </button>
            )}
            <button className="skill-icon-button" onClick={() => setFullscreen((v) => !v)} title={fullscreen ? '退出全屏' : '全屏覆盖中间栏'}>
              {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
            <button className="skill-icon-button" onClick={props.onClose} title="收起右侧栏">
              <PanelRightClose size={17} />
            </button>
          </div>
        </header>
        {props.view === 'versions' ? (
          <VersionSummary {...props} />
        ) : props.view === 'optimization' && props.answerOptimization ? (
          <SkillAnswerOptimizationPanel
            token={props.token}
            selection={props.answerOptimization}
            onSaved={props.onAnswerOptimizationSaved}
            onRerun={props.onAnswerOptimizationRerun}
          />
        ) : (
          <ContextSummary session={props.session} activeView={props.activeView} currentVersionId={props.currentVersionId} versions={props.versions} />
        )}
      </div>
    </aside>
  );
}

const versionSourceLabels: Record<SkillVersionDetail['source'], string> = {
  generated: '首次生成',
  imported: '导入创建',
  optimized: '自动优化',
  manual: '手动修改',
  interactive: '交互式优化',
  rollback: '版本回退',
};

function ContextSummary({
  session,
  activeView,
  versions,
  currentVersionId,
}: Pick<Props, 'session' | 'activeView' | 'versions' | 'currentVersionId'>) {
  if (activeView === 'run' || activeView === 'test' || activeView === 'arena') {
    const current = versions.find((item) => item.id === currentVersionId);
    const activeVersionCount = versions.filter((v) => v.status !== 'discarded').length;
    return (
      <div className="skill-context-scroll skill-context-mode-summary">
        <section><span>使用版本</span><strong>{current ? `v${current.versionNumber}` : '当前版本'}</strong></section>
        <section><span>版本来源</span><strong>{current ? versionSourceLabels[current.source] : '—'}</strong></section>
        <section><span>创建时间</span><strong>{current ? new Date(current.createdAt).toLocaleString() : '—'}</strong></section>
        <section><span>版本总数</span><strong>{activeVersionCount} 个有效版本</strong></section>
        <section><span>工作方式</span><strong>{activeView === 'arena' ? '双版本对比' : activeView === 'test' ? '固定版本测试' : '固定版本运行'}</strong></section>
        <section><span>记录</span><strong>服务端自动保存</strong></section>
      </div>
    );
  }

  if (activeView === 'optimize') {
    const current = versions.find((item) => item.id === currentVersionId);
    return (
      <div className="skill-context-scroll skill-optimization-summary">
        <div className="skill-optimization-version"><span>优化目标</span><strong>{current ? `Skill v${current.versionNumber}` : '当前 Skill'}</strong></div>
        <section><Sparkles size={14} /><div><strong>对话确认修改</strong><p>系统会先给出建议，只有明确采纳的修改才进入待保存列表。</p></div></section>
        <section><GitBranch size={14} /><div><strong>生成新版本</strong><p>保存时创建新版本，当前版本和历史记录不会被覆盖。</p></div></section>
        <p className="skill-context-muted">待保存数量和保存按钮会出现在中间对话区底部。</p>
      </div>
    );
  }

  return <RequirementSummary session={session} />;
}

function RequirementSummary({ session }: { session: GuidedCreationSessionDetail | null }) {
  if (!session) {
    return (
      <div className="skill-context-placeholder">
        <div className="skill-context-orb" />
        <p>开始描述后，这里会自动整理 Skill 的关键信息。</p>
      </div>
    );
  }

  const isEducationFlow = session.flow_version === 3 || Boolean(session.education_draft);

  const sections = isEducationFlow
    ? EDUCATION_DIMENSIONS.map((dim) => ({
        key: dim.key,
        title: dim.title,
        content: session.education_draft?.[dim.key]?.content?.trim() || '',
      }))
    : session?.confirmation?.sections ?? fallbackTopics.map((topic) => ({
        key: topic.key,
        title: topic.title,
        content: topic.fields
          .map((field) => session?.draft[field] || '')
          .filter(Boolean)
          .join('\n'),
      }));

  const completedCount = isEducationFlow
    ? EDUCATION_DIMENSIONS.filter((dim) => session.education_draft?.[dim.key]?.content?.trim()).length
    : Object.values(session.field_states).filter((state) => state !== 'missing' && state !== 'conflicted').length;
  const totalCount = isEducationFlow ? EDUCATION_DIMENSIONS.length : 11;

  return (
    <div className="skill-context-scroll">
      <div className="skill-context-progress">
        <div><span>需求完整度</span><strong>{completedCount}/{totalCount}</strong></div>
        <div className="skill-context-progress-track">
          <span style={{ width: `${Math.round((completedCount / totalCount) * 100)}%` }} />
        </div>
      </div>
      <div className="skill-context-sections">
        {sections.map((section) => {
          const hasContent = Boolean(section.content.trim());
          return (
            <details key={section.key} open={hasContent}>
              <summary>
                <span className={hasContent ? 'is-complete' : ''}>
                  {hasContent ? <Check size={12} /> : <span className="skill-summary-dot" />}
                </span>
                <strong>{section.title}</strong><ChevronRight size={14} />
              </summary>
              <p>{section.content || '等待补充'}</p>
            </details>
          );
        })}
      </div>
    </div>
  );
}

function VersionSummary({
  versions,
  currentVersionId,
  versionsLoading,
  onOpenVersionManager,
}: Props) {
  return (
    <div className="skill-context-version-body">
      <div className="skill-context-scroll">
        {versionsLoading ? (
          <p className="skill-context-muted">正在读取版本…</p>
        ) : versions.length === 0 ? (
          <p className="skill-context-muted">当前 Skill 暂无可展示版本。</p>
        ) : (
          <div className="skill-context-version-list">
            {versions.slice(0, 8).map((version) => (
              <button key={version.id} onClick={onOpenVersionManager}>
                <span className={version.id === currentVersionId ? 'is-current' : ''}>v{version.versionNumber}</span>
                <div><strong>{version.id === currentVersionId ? '当前使用' : version.note || '历史版本'}</strong><small>{new Date(version.createdAt).toLocaleString()}</small></div>
                <ChevronRight size={14} />
              </button>
            ))}
          </div>
        )}
      </div>
      <footer className="skill-context-footer">
        <button className="skill-primary-button" onClick={onOpenVersionManager}>打开完整版本管理</button>
      </footer>
    </div>
  );
}
