import { lazy, Suspense, useEffect, useState } from 'react';
import type { ArenaThread, SkillVersionDetail } from '@educlaw/shared';
import type { SkillPinnedUpdate, SkillWorkspaceView } from './skill-workspace-state';
import type { AnswerOptimizationRerunRequest, AnswerOptimizationSelection } from './answer-optimization-selection';

const SkillArenaWorkspace = lazy(() =>
  import('./SkillArenaWorkspace').then((module) => ({
    default: module.SkillArenaWorkspace,
  })),
);
const SkillOptimizeWorkspace = lazy(() =>
  import('./SkillOptimizeWorkspace').then((module) => ({
    default: module.SkillOptimizeWorkspace,
  })),
);
const SkillRunWorkspace = lazy(() =>
  import('./SkillRunWorkspace').then((module) => ({
    default: module.SkillRunWorkspace,
  })),
);
const SkillVersionWorkspace = lazy(() =>
  import('./SkillVersionWorkspace').then((module) => ({
    default: module.SkillVersionWorkspace,
  })),
);

type DetailView = Extract<SkillWorkspaceView, 'overview' | 'run' | 'test' | 'arena' | 'optimize' | 'versions'>;

export type SkillDetailSelection = {
  packageId: string;
  skillId: string;
  name: string;
  description: string;
  sections?: Array<{ key: string; title: string; content: string }>;
};

type Props = {
  token: string;
  skill: SkillDetailSelection;
  view: DetailView;
  versions: SkillVersionDetail[];
  currentVersionId: string | null;
  versionsLoading: boolean;
  onPublishUpdate: (update: SkillPinnedUpdate, autoOpen?: boolean) => void;
  onReloadVersions: () => Promise<void>;
  onNavigate: (view: DetailView) => void;
  onRunStateChange?: (running: boolean, threadId?: string | null) => void;
  onOptimizeAnswer: (selection: AnswerOptimizationSelection) => void;
  conversations: ArenaThread[];
  selectedConversationId: string | null;
  onConversationCreated: (thread: ArenaThread) => void;
  onConversationUpdated: (thread: ArenaThread) => void;
  answerRerunRequest?: AnswerOptimizationRerunRequest | null;
};

export function SkillDetailWorkspace(props: Props) {
  const currentVersion = props.versions.find((version) => version.id === props.currentVersionId);
  const [selectedRunVersionId, setSelectedRunVersionId] = useState(props.currentVersionId ?? '');
  useEffect(() => {
    if (!props.versions.some((version) => version.id === selectedRunVersionId)) {
      setSelectedRunVersionId(props.currentVersionId ?? props.versions[0]?.id ?? '');
    }
  }, [props.currentVersionId, props.versions, selectedRunVersionId]);
  const selectedRunVersion = props.versions.find((version) => version.id === selectedRunVersionId) ?? currentVersion;
  useEffect(() => {
    const request = props.answerRerunRequest;
    if (!request || request.selection.origin === 'arena') return;
    const next = props.versions.find((version) => version.versionNumber === request.versionNumber);
    if (next && selectedRunVersionId !== next.id) setSelectedRunVersionId(next.id);
  }, [props.answerRerunRequest, props.versions, selectedRunVersionId]);

  return (
    <main className="skill-center skill-detail-workspace">
      {(props.view === 'run' || props.view === 'test') && (
        <header className="skill-workspace-topbar">
          <label className="skill-active-version skill-version-picker">
            <span>当前版本</span>
            <select value={selectedRunVersion?.id ?? ''} onChange={(event) => setSelectedRunVersionId(event.target.value)}>
              {props.versions.filter((version) => version.status !== 'discarded').map((version) => <option value={version.id} key={version.id}>v{version.versionNumber}</option>)}
            </select>
          </label>
        </header>
      )}

      <div className="skill-detail-content">
        <Suspense
          fallback={
            <div className="skill-workspace-loading" role="status">
              正在打开功能…
            </div>
          }
        >
        {props.view === 'overview' && <Overview skill={props.skill} />}
        {props.view === 'run' && (
          <SkillRunWorkspace
            token={props.token}
            packageId={props.skill.packageId}
            version={selectedRunVersion}
            currentPackageVersionId={currentVersion?.createdInPackageVersionId}
            onRunStateChange={props.onRunStateChange}
            onOptimizeAnswer={props.onOptimizeAnswer}
            selectedThreadId={props.selectedConversationId}
            onThreadCreated={props.onConversationCreated}
            onThreadUpdated={props.onConversationUpdated}
            rerunRequest={props.answerRerunRequest}
          />
        )}
        {props.view === 'test' && (
          <SkillRunWorkspace
            token={props.token}
            packageId={props.skill.packageId}
            version={selectedRunVersion}
            currentPackageVersionId={currentVersion?.createdInPackageVersionId}
            purpose="test"
            onRunStateChange={props.onRunStateChange}
            onOptimizeAnswer={props.onOptimizeAnswer}
            selectedThreadId={props.selectedConversationId}
            onThreadCreated={props.onConversationCreated}
            onThreadUpdated={props.onConversationUpdated}
            rerunRequest={props.answerRerunRequest}
          />
        )}
        {props.view === 'arena' && (
          <SkillArenaWorkspace
            token={props.token}
            packageId={props.skill.packageId}
            versions={props.versions}
            currentVersionId={props.currentVersionId}
            onOptimizeAnswer={props.onOptimizeAnswer}
            onCompleted={() => undefined}
            rerunRequest={props.answerRerunRequest}
          />
        )}
        {props.view === 'optimize' && (
          <SkillOptimizeWorkspace
            token={props.token}
            packageId={props.skill.packageId}
            version={currentVersion}
            onSaved={(versionNumber) => {
              void props.onReloadVersions();
              props.onPublishUpdate({
                id: 'version-changed',
                title: '优化版本已生成',
                message: `修改已保存为 Skill v${versionNumber}，旧版本仍然保留。`,
                actionLabel: '查看版本',
              }, true);
            }}
          />
        )}
        {props.view === 'versions' && (
          <SkillVersionWorkspace
            token={props.token}
            packageId={props.skill.packageId}
            versions={props.versions}
            currentVersionId={props.currentVersionId}
            loading={props.versionsLoading}
            onReload={props.onReloadVersions}
            onVersionChanged={(message) => props.onPublishUpdate({ id: 'version-changed', title: '版本状态已更新', message, actionLabel: '查看版本' })}
          />
        )}
        </Suspense>
      </div>
    </main>
  );
}

function Overview({ skill }: { skill: SkillDetailSelection }) {
  return (
    <div className="skill-flat-overview skill-view-enter">
      <div className="skill-overview-intro"><span className="skill-eyebrow">教育 Skill</span><h1>{skill.name}</h1><p>{skill.description || '通过结构化流程完成教育场景任务'}</p></div>
      <div className="skill-overview-sections">
        {skill.sections?.map((section) => <section key={section.key}><h3>{section.title}</h3><p>{section.content}</p></section>)}
      </div>
    </div>
  );
}
