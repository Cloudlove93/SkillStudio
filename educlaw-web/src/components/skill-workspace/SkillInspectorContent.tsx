import type {
  GuidedCreationSessionDetail,
  GuidedEducationDimension,
  SkillVersionDetail,
} from '@educlaw/shared';
import { lazy, Suspense } from 'react';
import { Check, ChevronRight, GitBranch, Sparkles } from 'lucide-react';
import type { AnswerOptimizationSelection } from './answer-optimization-selection';
import type { SkillWorkspaceView } from './skill-workspace-state';
import type { InspectorDescriptor } from './workspace-inspector-state';

const SkillAnswerOptimizationPanel = lazy(() =>
  import('./SkillAnswerOptimizationPanel').then((module) => ({
    default: module.SkillAnswerOptimizationPanel,
  })),
);

const EDUCATION_DIMENSIONS: { key: GuidedEducationDimension; title: string }[] =
  [
    { key: 'educational_goal', title: '教育目标' },
    { key: 'audience_context', title: '对象与情境' },
    { key: 'input_evidence', title: '输入与依据' },
    { key: 'teaching_strategy', title: '教育策略' },
    { key: 'action_adaptation', title: '行动与调整' },
    { key: 'boundaries_responsibility', title: '边界与责任' },
    { key: 'completion_evidence', title: '完成与证据' },
  ];

type Props = {
  descriptor: InspectorDescriptor | null;
  session: GuidedCreationSessionDetail | null;
  activeView: SkillWorkspaceView;
  versions: SkillVersionDetail[];
  currentVersionId: string | null;
  versionsLoading?: boolean;
  onOpenVersionManager: () => void;
  token: string;
  answerOptimization: AnswerOptimizationSelection | null;
  onAnswerOptimizationSaved: (versionNumber: number) => void;
  onAnswerOptimizationRerun: (
    versionNumber: number,
    selection: AnswerOptimizationSelection,
  ) => void;
};

const fallbackTopics = [
  { key: 'positioning', title: '定位与目标', fields: ['roles', 'goal'] },
  { key: 'scenario', title: '使用场景', fields: ['usage_scenario'] },
  {
    key: 'input_output',
    title: '输入与输出',
    fields: ['input_contract', 'output_contract'],
  },
  {
    key: 'capability_flow',
    title: '能力与流程',
    fields: ['core_capabilities', 'workflow'],
  },
  {
    key: 'knowledge_boundary',
    title: '依据与边界',
    fields: ['knowledge_evidence', 'boundaries_permissions'],
  },
  {
    key: 'recovery_completion',
    title: '异常与完成标准',
    fields: ['exception_recovery', 'completion_evidence'],
  },
] as const;

const versionSourceLabels: Record<SkillVersionDetail['source'], string> = {
  generated: '首次生成',
  imported: '导入创建',
  optimized: '自动优化',
  manual: '手动修改',
  interactive: '交互式优化',
  rollback: '版本回退',
};

const inspectorDateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function SkillInspectorContent(props: Props) {
  if (props.descriptor?.view === 'versions') {
    return <VersionSummary {...props} />;
  }
  if (props.descriptor?.view === 'optimization' && props.answerOptimization) {
    return (
      <Suspense
        fallback={<div className="skill-workspace-loading" role="status">正在打开优化建议…</div>}
      >
        <SkillAnswerOptimizationPanel
          token={props.token}
          selection={props.answerOptimization}
          onSaved={props.onAnswerOptimizationSaved}
          onRerun={props.onAnswerOptimizationRerun}
        />
      </Suspense>
    );
  }
  return (
    <ContextSummary
      session={props.session}
      activeView={props.activeView}
      versions={props.versions}
      currentVersionId={props.currentVersionId}
    />
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
    const activeVersionCount = versions.filter(
      (version) => version.status !== 'discarded',
    ).length;
    return (
      <div className="skill-context-scroll skill-context-mode-summary">
        <section>
          <span>使用版本</span>
          <strong>{current ? `v${current.versionNumber}` : '当前版本'}</strong>
        </section>
        <section>
          <span>版本来源</span>
          <strong>{current ? versionSourceLabels[current.source] : '—'}</strong>
        </section>
        <section>
          <span>创建时间</span>
          <strong>
            {current
              ? inspectorDateTimeFormatter.format(new Date(current.createdAt))
              : '—'}
          </strong>
        </section>
        <section>
          <span>版本总数</span>
          <strong>{activeVersionCount} 个有效版本</strong>
        </section>
        <section>
          <span>工作方式</span>
          <strong>
            {activeView === 'arena'
              ? '双版本对比'
              : activeView === 'test'
                ? '固定版本测试'
                : '固定版本运行'}
          </strong>
        </section>
        <section>
          <span>记录</span>
          <strong>服务端自动保存</strong>
        </section>
      </div>
    );
  }

  if (activeView === 'optimize') {
    const current = versions.find((item) => item.id === currentVersionId);
    return (
      <div className="skill-context-scroll skill-optimization-summary">
        <div className="skill-optimization-version">
          <span>优化目标</span>
          <strong>
            {current ? `Skill v${current.versionNumber}` : '当前 Skill'}
          </strong>
        </div>
        <section>
          <Sparkles size={14} />
          <div>
            <strong>对话确认修改</strong>
            <p>系统会先给出建议，只有明确采纳的修改才进入待保存列表。</p>
          </div>
        </section>
        <section>
          <GitBranch size={14} />
          <div>
            <strong>生成新版本</strong>
            <p>保存时创建新版本，当前版本和历史记录不会被覆盖。</p>
          </div>
        </section>
        <p className="skill-context-muted">
          待保存数量和保存按钮会出现在中间对话区底部。
        </p>
      </div>
    );
  }

  return <RequirementSummary session={session} />;
}

function RequirementSummary({
  session,
}: {
  session: GuidedCreationSessionDetail | null;
}) {
  if (!session) {
    return (
      <div className="skill-context-placeholder">
        <div className="skill-context-orb" />
        <p>开始描述后，这里会自动整理 Skill 的关键信息。</p>
      </div>
    );
  }

  const isEducationFlow =
    session.flow_version === 3 || Boolean(session.education_draft);
  const sections = isEducationFlow
    ? EDUCATION_DIMENSIONS.map((dimension) => ({
        key: dimension.key,
        title: dimension.title,
        content:
          session.education_draft?.[dimension.key]?.content?.trim() || '',
      }))
    : (session.confirmation?.sections ??
      fallbackTopics.map((topic) => ({
        key: topic.key,
        title: topic.title,
        content: topic.fields
          .map((field) => session.draft[field] || '')
          .filter(Boolean)
          .join('\n'),
      })));

  const completedCount = isEducationFlow
    ? EDUCATION_DIMENSIONS.filter((dimension) =>
        session.education_draft?.[dimension.key]?.content?.trim(),
      ).length
    : Object.values(session.field_states).filter(
        (state) => state !== 'missing' && state !== 'conflicted',
      ).length;
  const totalCount = isEducationFlow ? EDUCATION_DIMENSIONS.length : 11;

  return (
    <div className="skill-context-scroll">
      <div className="skill-context-progress">
        <div>
          <span>需求完整度</span>
          <strong>
            {completedCount}/{totalCount}
          </strong>
        </div>
        <div className="skill-context-progress-track">
          <span
            style={{
              width: `${Math.round((completedCount / totalCount) * 100)}%`,
            }}
          />
        </div>
      </div>
      <div className="skill-context-sections">
        {sections.map((section) => {
          const hasContent = Boolean(section.content.trim());
          return (
            <details key={section.key} open={hasContent}>
              <summary>
                <span className={hasContent ? 'is-complete' : ''}>
                  {hasContent ? (
                    <Check size={12} />
                  ) : (
                    <span className="skill-summary-dot" />
                  )}
                </span>
                <strong>{section.title}</strong>
                <ChevronRight size={14} />
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
              <button
                key={version.id}
                type="button"
                onClick={onOpenVersionManager}
              >
                <span
                  className={
                    version.id === currentVersionId ? 'is-current' : ''
                  }
                >
                  v{version.versionNumber}
                </span>
                <div>
                  <strong>
                    {version.id === currentVersionId
                      ? '当前使用'
                      : version.note || '历史版本'}
                  </strong>
                  <small>
                    {inspectorDateTimeFormatter.format(
                      new Date(version.createdAt),
                    )}
                  </small>
                </div>
                <ChevronRight size={14} />
              </button>
            ))}
          </div>
        )}
      </div>
      <footer className="skill-context-footer">
        <button
          className="skill-primary-button"
          type="button"
          onClick={onOpenVersionManager}
        >
          打开完整版本管理
        </button>
      </footer>
    </div>
  );
}
