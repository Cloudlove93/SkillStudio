import type { SkillVersionDetail } from '@educlaw/shared';
import type { SkillPinnedUpdate, SkillWorkspaceView } from './skill-workspace-state';
import { SkillArenaWorkspace } from './SkillArenaWorkspace';
import { SkillOptimizeWorkspace } from './SkillOptimizeWorkspace';
import { SkillRunWorkspace } from './SkillRunWorkspace';
import { SkillVersionWorkspace } from './SkillVersionWorkspace';

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
};

const viewLabels: Record<DetailView, string> = {
  overview: '概览',
  run: '运行 Skill',
  test: '测试',
  arena: 'Arena 对比',
  optimize: '交互式优化',
  versions: '版本',
};

export function SkillDetailWorkspace(props: Props) {
  const currentVersion = props.versions.find((version) => version.id === props.currentVersionId);

  return (
    <main className="skill-center skill-detail-workspace">
      <header className="skill-workspace-topbar">
        <strong className="skill-current-view">{viewLabels[props.view]}</strong>
        {(props.view === 'run' || props.view === 'test') && <span className="skill-active-version">固定使用 v{currentVersion?.versionNumber ?? '-'}</span>}
      </header>

      <div className="skill-detail-content">
        {props.view === 'overview' && <Overview skill={props.skill} />}
        {props.view === 'run' && (
          <SkillRunWorkspace
            token={props.token}
            packageId={props.skill.packageId}
            version={currentVersion}
            onCompleted={() => props.onPublishUpdate({
              id: 'skill-run-completed',
              title: 'Skill 运行完成',
              message: `本次任务由 v${currentVersion?.versionNumber ?? '-'} 完成，运行记录已保存在服务端。`,
              actionLabel: '查看运行信息',
            }, false)}
          />
        )}
        {props.view === 'test' && (
          <SkillRunWorkspace
            token={props.token}
            packageId={props.skill.packageId}
            version={currentVersion}
            purpose="test"
            onCompleted={() => props.onPublishUpdate({
              id: 'test-recorded',
              title: '测试完成',
              message: `v${currentVersion?.versionNumber ?? '-'} 的测试记录已保存在服务端。`,
              actionLabel: '查看测试信息',
            }, false)}
          />
        )}
        {props.view === 'arena' && (
          <SkillArenaWorkspace
            token={props.token}
            packageId={props.skill.packageId}
            versions={props.versions}
            currentVersionId={props.currentVersionId}
            onCompleted={() => props.onPublishUpdate({
              id: 'arena-completed',
              title: 'Arena 对比完成',
              message: '两个固定 Skill 版本的运行结果已生成并保存在服务端。',
              actionLabel: '查看对比信息',
            }, false)}
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
