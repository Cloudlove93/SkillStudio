import { useState } from 'react';
import type { GuidedCreationSessionDetail, SkillVersionDetail } from '@educlaw/shared';
import {
  Check,
  ChevronRight,
  ExternalLink,
  GitBranch,
  Info,
  Maximize2,
  Minimize2,
  PanelRightClose,
  Sparkles,
} from 'lucide-react';
import type { SkillContextView, SkillWorkspaceView } from './skill-workspace-state';

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
};

const fallbackTopics = [
  { key: 'positioning', title: '定位与目标', fields: ['roles', 'goal'] },
  { key: 'scenario', title: '使用场景', fields: ['usage_scenario'] },
  { key: 'input_output', title: '输入与输出', fields: ['input_contract', 'output_contract'] },
  { key: 'capability_flow', title: '能力与流程', fields: ['core_capabilities', 'workflow'] },
  { key: 'knowledge_boundary', title: '依据与边界', fields: ['knowledge_evidence', 'boundaries_permissions'] },
  { key: 'recovery_completion', title: '异常与完成标准', fields: ['exception_recovery', 'completion_evidence'] },
] as const;

function summaryTitle(activeView: SkillWorkspaceView) {
  if (activeView === 'run') return ['运行信息', '当前运行'];
  if (activeView === 'test') return ['测试信息', '当前测试'];
  if (activeView === 'arena') return ['Arena 信息', '版本对比'];
  if (activeView === 'optimize') return ['优化信息', '本轮建议'];
  return ['当前 Skill', '需求摘要'];
}

export function SkillContextPanel(props: Props) {
  const [fullscreen, setFullscreen] = useState(false);
  if (!props.open) {
    return (
      <aside className="skill-context is-collapsed">
        <nav className="skill-context-rail" aria-label="右侧快捷工具">
          <button
            className="skill-icon-button"
            onClick={() => props.onOpen('summary')}
            aria-label="当前信息"
            title="当前信息"
          >
            <Info size={17} />
          </button>
          <button
            className="skill-icon-button"
            onClick={() => props.onOpen('versions')}
            aria-label="版本管理"
            title="版本管理"
            disabled={!props.hasSkill}
          >
            <GitBranch size={17} />
          </button>
        </nav>
      </aside>
    );
  }

  const [eyebrow, title] = props.view === 'versions'
    ? ['版本管理', '最近版本']
    : summaryTitle(props.activeView);

  return (
    <aside className={`skill-context is-open ${fullscreen ? 'is-fullscreen' : ''}`}>
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
          <button
            className="skill-icon-button"
            onClick={() => setFullscreen((value) => !value)}
            title={fullscreen ? '退出全屏右侧栏' : '全屏显示右侧栏'}
          >
            {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          <button className="skill-icon-button" onClick={props.onClose} title="收起右侧栏">
            <PanelRightClose size={17} />
          </button>
        </div>
      </header>
      {props.view === 'versions' ? (
        <VersionSummary {...props} />
      ) : (
        <ContextSummary session={props.session} activeView={props.activeView} currentVersionId={props.currentVersionId} versions={props.versions} />
      )}
    </aside>
  );
}

function ContextSummary({
  session,
  activeView,
  versions,
  currentVersionId,
}: Pick<Props, 'session' | 'activeView' | 'versions' | 'currentVersionId'>) {
  if (activeView === 'run' || activeView === 'test' || activeView === 'arena') {
    const current = versions.find((item) => item.id === currentVersionId);
    return (
      <div className="skill-context-scroll skill-context-mode-summary">
        <section><span>使用版本</span><strong>{current ? `v${current.versionNumber}` : '当前版本'}</strong></section>
        <section><span>工作方式</span><strong>{activeView === 'arena' ? '双版本对比' : activeView === 'test' ? '固定版本测试' : '固定版本运行'}</strong></section>
        <section><span>记录</span><strong>服务端自动保存</strong></section>
        <p>中间区域用于任务和结果，右侧只保留当前运行信息，不挤占主要交互空间。</p>
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
  const sections = session?.confirmation?.sections ?? fallbackTopics.map((topic) => ({
    key: topic.key,
    title: topic.title,
    content: topic.fields
      .map((field) => session?.draft[field] || '')
      .filter(Boolean)
      .join('\n'),
  }));
  const completedCount = session
    ? Object.values(session.field_states).filter((state) => state !== 'missing' && state !== 'conflicted').length
    : 0;

  if (!session) {
    return (
      <div className="skill-context-placeholder">
        <div className="skill-context-orb" />
        <p>开始描述后，这里会自动整理 Skill 的关键信息。</p>
      </div>
    );
  }

  return (
    <div className="skill-context-scroll">
      <div className="skill-context-progress">
        <div><span>需求完整度</span><strong>{completedCount}/11</strong></div>
        <div className="skill-context-progress-track">
          <span style={{ width: `${Math.round((completedCount / 11) * 100)}%` }} />
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
            {versions.slice(0, 4).map((version) => (
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
