import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type {
  ArenaRunSnapshot,
  ArenaThread,
  SkillVersionDetail,
} from '@educlaw/shared';
import type {
  SkillPinnedUpdate,
  SkillWorkspaceView,
} from './skill-workspace-state';
import type {
  AnswerOptimizationRerunRequest,
  AnswerOptimizationSelection,
} from './answer-optimization-selection';
import { liteApi } from '../../api/lite-api';
import { getConversationSurface } from './skill-conversation-list';

const LegacyArenaHistory = lazy(() =>
  import('./LegacyArenaHistory').then((module) => ({
    default: module.LegacyArenaHistory,
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

type DetailView = Extract<
  SkillWorkspaceView,
  'overview' | 'run' | 'arena' | 'optimize' | 'versions'
>;
const needsLegacyHistory = (thread: ArenaThread) =>
  getConversationSurface(thread) === 'arena' ||
  (!thread.skillArenaConfig?.right && !!thread.skillArenaConfig?.left);

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
  currentPackageVersionId: string | null;
  versionsHasMore?: boolean;
  versionsLoadingMore?: boolean;
  onLoadMoreVersions?: () => Promise<void>;
  onNewConversation: () => void;
  versionsLoading: boolean;
  onPublishUpdate: (update: SkillPinnedUpdate, autoOpen?: boolean) => void;
  onReloadVersions: () => Promise<void>;
  onNavigate: (view: DetailView) => void;
  onBackToRepository: () => void;
  onAttachToAgent?: () => void;
  onRunStateChange?: (
    running: boolean,
    threadId?: string | null,
    status?: ArenaRunSnapshot['status'],
  ) => void;
  onOptimizeAnswer: (selection: AnswerOptimizationSelection) => void;
  conversations: ArenaThread[];
  selectedConversationId: string | null;
  onConversationCreated: (thread: ArenaThread) => void;
  onConversationUpdated: (thread: ArenaThread) => void;
  answerRerunRequest?: AnswerOptimizationRerunRequest | null;
  onRerunHandled?: (requestId: string) => void;
};

export function SkillDetailWorkspace(props: Props) {
  const currentVersion = props.versions.find(
    (version) => version.id === props.currentVersionId,
  );
  const [selectedRunVersionId, setSelectedRunVersionId] = useState('');
  useEffect(() => {
    if (
      selectedRunVersionId &&
      !props.versions.some(
        (version) =>
          version.id === selectedRunVersionId && version.status === 'active',
      )
    ) {
      setSelectedRunVersionId('');
    }
  }, [props.currentVersionId, props.versions, selectedRunVersionId]);
  const selectedRunVersion =
    props.versions.find(
      (version) =>
        version.id === selectedRunVersionId && version.status === 'active',
    ) ??
    (currentVersion?.status === 'active'
      ? currentVersion
      : props.versions.find((v) => v.status === 'active'));
  const selectedThread = props.conversations.find(
    (t) => String(t.id) === props.selectedConversationId,
  );
  const boundId = selectedThread?.skillArenaConfig?.right?.skillVersionId;
  const listedBoundVersion = props.versions.find((v) => v.id === boundId);
  const bindingKey = JSON.stringify([
    props.token,
    props.skill.packageId,
    props.skill.skillId,
    props.selectedConversationId,
  ]);
  const [binding, setBinding] = useState<{
    key: string;
    version?: SkillVersionDetail;
    thread?: ArenaThread;
    error?: string;
  } | null>(null);
  const [bindingRetry, setBindingRetry] = useState(0);
  useEffect(() => {
    if (
      !props.selectedConversationId ||
      listedBoundVersion ||
      (selectedThread && needsLegacyHistory(selectedThread))
    )
      return;
    let cancelled = false;
    setBinding(null);
    void (async () => {
      try {
        const thread =
          selectedThread ??
          (
            await liteApi.getArenaThreadDetail(
              props.token,
              props.skill.packageId,
              props.selectedConversationId!,
            )
          ).thread;
        if (needsLegacyHistory(thread)) {
          if (!cancelled) setBinding({ key: bindingKey, thread });
          return;
        }
        const id = thread.skillArenaConfig?.right?.skillVersionId;
        if (!id) throw new Error('无法确认本对话绑定的 Skill 版本');
        const version = await liteApi.getSkillVersionDetail(
          props.token,
          props.skill.packageId,
          id,
        );
        if (version.skillId !== props.skill.skillId)
          throw new Error('对话与当前 Skill 不匹配');
        if (!cancelled) setBinding({ key: bindingKey, version });
      } catch (error) {
        if (!cancelled)
          setBinding({
            key: bindingKey,
            error: error instanceof Error ? error.message : '对话版本加载失败',
          });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    bindingKey,
    bindingRetry,
    props.token,
    props.skill.packageId,
    props.skill.skillId,
    props.selectedConversationId,
    selectedThread,
    listedBoundVersion,
  ]);
  const boundVersion =
    listedBoundVersion ??
    (binding?.key === bindingKey ? binding.version : undefined);
  const resolvedThread =
    selectedThread ??
    (binding?.key === bindingKey ? binding.thread : undefined);
  const legacyComparison =
    !!resolvedThread && needsLegacyHistory(resolvedThread);
  const runVersion = props.selectedConversationId
    ? boundVersion
    : selectedRunVersion;
  const selectedRerun = useRef<string | null>(null);
  useEffect(() => {
    const request = props.answerRerunRequest;
    if (
      !request ||
      request.selection.origin === 'arena' ||
      selectedRerun.current === request.requestId
    )
      return;
    const next = props.versions.find(
      (version) => version.versionNumber === request.versionNumber,
    );
    if (next && next.status === 'active') {
      selectedRerun.current = request.requestId;
      setSelectedRunVersionId(next.id);
    }
  }, [props.answerRerunRequest, props.versions, selectedRunVersionId]);

  return (
    <main className="skill-center skill-detail-workspace">
      {(props.view === 'run' || props.view === 'arena') && (
        <header className="skill-workspace-topbar">
          {props.onAttachToAgent ? (
            <button type="button" onClick={props.onAttachToAgent}>
              进入 Agent 工作区
            </button>
          ) : (
            <a
              href={`/agents?skillId=${encodeURIComponent(props.skill.skillId)}&autochat=1`}
            >
              进入 Agent 工作区
            </a>
          )}
          {props.selectedConversationId && (
            <span role="status">
              {legacyComparison
                ? '本对话保留创建时的固定版本'
                : boundVersion
                  ? `本对话版本：v${boundVersion.versionNumber}${boundVersion.status === 'discarded' ? '（已废弃，保留原对话绑定）' : ''}`
                  : '正在确认对话版本…'}
            </span>
          )}
          {binding?.key === bindingKey && binding.error && (
            <span role="alert">
              {binding.error}
              <button onClick={() => setBindingRetry((n) => n + 1)}>
                重试
              </button>
            </span>
          )}
          {!props.selectedConversationId && (
            <label className="skill-active-version skill-version-picker">
              <span>预览版本</span>
              <select
                disabled={props.versionsLoading || !selectedRunVersion}
                value={selectedRunVersion?.id ?? ''}
                onChange={(event) =>
                  setSelectedRunVersionId(event.target.value)
                }
              >
                {props.versions
                  .filter((version) => version.status !== 'discarded')
                  .map((version) => (
                    <option value={version.id} key={version.id}>
                      v{version.versionNumber}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {props.versionsHasMore && (
            <button
              className="skill-text-button"
              disabled={props.versionsLoadingMore}
              onClick={() => void props.onLoadMoreVersions?.()}
            >
              {props.versionsLoadingMore ? '正在加载…' : '加载更多版本'}
            </button>
          )}
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
          {props.view === 'run' &&
            props.selectedConversationId &&
            !legacyComparison && (
              <SkillRunWorkspace
                token={props.token}
                packageId={props.skill.packageId}
                version={runVersion}
                currentPackageVersionId={
                  props.currentPackageVersionId ?? undefined
                }
                onRunStateChange={props.onRunStateChange}
                onOptimizeAnswer={props.onOptimizeAnswer}
                selectedThreadId={props.selectedConversationId}
                onThreadCreated={props.onConversationCreated}
                onThreadUpdated={props.onConversationUpdated}
                rerunRequest={props.answerRerunRequest}
                onRerunHandled={props.onRerunHandled}
              />
            )}
          {(props.view === 'run' || props.view === 'arena') &&
            props.selectedConversationId &&
            legacyComparison && (
              <LegacyArenaHistory
                token={props.token}
                packageId={props.skill.packageId}
                threadId={props.selectedConversationId}
              />
            )}
          {((props.view === 'run' && !props.selectedConversationId) ||
            (props.view === 'arena' && !legacyComparison)) && (
            <section className="skill-flat-overview skill-view-enter">
              <div className="skill-overview-intro">
                <span className="skill-eyebrow">Skill 只读预览</span>
                <h1>{props.skill.name}</h1>
                <p>
                  进入 Agent 工作区后，将此 Skill 与 Agent
                  指令一起用于运行或测试。历史对话仍可从对话列表打开。
                </p>
              </div>
              {selectedRunVersion && (
                <details className="skill-overview-sections" open>
                  <summary>
                    固定版本 v{selectedRunVersion.versionNumber}
                  </summary>
                  <pre
                    style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                  >
                    {selectedRunVersion.skill?.skillMd}
                  </pre>
                </details>
              )}
            </section>
          )}
          {props.view === 'optimize' && (
            <SkillOptimizeWorkspace
              token={props.token}
              packageId={props.skill.packageId}
              version={currentVersion}
              onSaved={(versionNumber) => {
                void props.onReloadVersions();
                props.onPublishUpdate(
                  {
                    id: 'version-changed',
                    title: '优化版本已生成',
                    message: `修改已保存为 Skill v${versionNumber}，旧版本仍然保留。`,
                    actionLabel: '查看版本',
                  },
                  true,
                );
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
              currentPackageVersionId={props.currentPackageVersionId}
              hasMore={props.versionsHasMore}
              loadingMore={props.versionsLoadingMore}
              onLoadMore={props.onLoadMoreVersions}
              onReload={props.onReloadVersions}
              onBackToRepository={props.onBackToRepository}
              onVersionChanged={(message) =>
                props.onPublishUpdate({
                  id: 'version-changed',
                  title: '版本状态已更新',
                  message,
                  actionLabel: '查看版本',
                })
              }
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
      <div className="skill-overview-intro">
        <span className="skill-eyebrow">教学 Skill</span>
        <h1>{skill.name}</h1>
        <p>{skill.description || '通过结构化流程完成教育场景任务'}</p>
      </div>
      <div className="skill-overview-sections">
        {skill.sections?.map((section) => (
          <section key={section.key}>
            <h3>{section.title}</h3>
            <p>{section.content}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
