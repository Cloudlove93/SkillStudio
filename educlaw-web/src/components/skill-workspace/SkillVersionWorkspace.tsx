import { useEffect, useMemo, useRef, useState } from 'react';
import { createPatch } from 'diff';
import type {
  ManualEditSkillVersionResult,
  SkillVersionDetail,
} from '@educlaw/shared';
import {
  ArrowLeft,
  Check,
  GitCompare,
  History,
  Loader2,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { liteApi } from '../../api/lite-api';
import DiffView from '../editor/DiffView';
import {
  canDiscardSkillVersion,
  canRollbackSkillVersion,
  visibleSkillVersions,
} from './skill-version-state';
import { SkillVersionContentDialog } from './SkillVersionContentDialog';

type Props = {
  token: string;
  packageId: string;
  versions: SkillVersionDetail[];
  currentVersionId: string | null;
  currentPackageVersionId: string | null;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => Promise<void>;
  loading: boolean;
  onReload: () => Promise<void>;
  onVersionChanged: (message: string) => void;
  onBackToRepository: () => void;
};

type VersionComparison = {
  baseVersionId: string;
  targetVersionId: string;
};

type PendingAction = {
  kind: 'rollback' | 'discard' | 'restore';
  version: SkillVersionDetail;
  idempotencyKey?: string;
  expectedPackageVersionId?: string | null;
};

const sourceLabels: Record<SkillVersionDetail['source'], string> = {
  generated: '首次生成',
  imported: '导入创建',
  optimized: '自动优化',
  manual: '手动修改',
  interactive: '交互式优化',
  rollback: '版本回退',
  distilled: '提炼生成',
};

const versionDateFormatter = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function SkillVersionWorkspace(props: Props) {
  const [includeDiscarded, setIncludeDiscarded] = useState(false);
  const [preview, setPreview] = useState<SkillVersionDetail | null>(null);
  const [comparison, setComparison] = useState<VersionComparison | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [mutating, setMutating] = useState(false);
  const mutationLock = useRef(false);
  const mounted = useRef(false);
  const identity = JSON.stringify([props.token, props.packageId]);
  const identityRef = useRef(identity);
  identityRef.current = identity;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const visible = useMemo(
    () => visibleSkillVersions(props.versions, includeDiscarded),
    [props.versions, includeDiscarded],
  );
  const current =
    props.versions.find((version) => version.id === props.currentVersionId) ??
    null;
  const comparisonBase = comparison
    ? visible.find((version) => version.id === comparison.baseVersionId) ?? null
    : null;
  const comparisonTarget = comparison
    ? visible.find((version) => version.id === comparison.targetVersionId) ?? null
    : null;

  useEffect(() => {
    if (!comparison) return;
    const base = visible.find(
      (version) => version.id === comparison.baseVersionId,
    );
    if (!base) {
      setComparison(null);
      return;
    }
    if (visible.some((version) => version.id === comparison.targetVersionId))
      return;
    const target = defaultComparisonTarget(base, visible);
    setComparison(
      target
        ? { baseVersionId: base.id, targetVersionId: target.id }
        : null,
    );
  }, [comparison, visible]);

  const startComparison = (base: SkillVersionDetail) => {
    const target = defaultComparisonTarget(base, visible);
    if (!target) return;
    setComparison({ baseVersionId: base.id, targetVersionId: target.id });
  };

  const mutate = async () => {
    if (!pending || mutationLock.current) return;
    mutationLock.current = true;
    setMutating(true);
    const currentRequest = () =>
      mounted.current && identityRef.current === identity;
    try {
      if (pending.kind === 'rollback') {
        if (!current || !pending.expectedPackageVersionId)
          throw new Error('无法确认当前 Skill 版本，请刷新后重试');
        await liteApi.rollbackSkillVersion(props.token, props.packageId, {
          skillId: pending.version.skillId,
          versionId: pending.version.id,
          expectedPackageVersionId: pending.expectedPackageVersionId,
          idempotencyKey: pending.idempotencyKey!,
          note: `从 Skill v${pending.version.versionNumber} 创建回退版本`,
        });
        if (!currentRequest()) return;
        props.onVersionChanged(
          `已基于 v${pending.version.versionNumber} 创建新的回退版本`,
        );
      } else if (pending.kind === 'discard') {
        await liteApi.discardSkillVersion(
          props.token,
          props.packageId,
          pending.version.id,
          '用户在版本管理中废弃',
        );
        if (!currentRequest()) return;
        props.onVersionChanged(
          `Skill v${pending.version.versionNumber} 已废弃`,
        );
      } else {
        await liteApi.undiscardSkillVersion(
          props.token,
          props.packageId,
          pending.version.id,
        );
        if (!currentRequest()) return;
        props.onVersionChanged(
          `Skill v${pending.version.versionNumber} 已恢复`,
        );
      }
      await props.onReload();
      if (!currentRequest()) return;
      setPending(null);
    } catch (error) {
      if (!currentRequest()) return;
      toast.error(error instanceof Error ? error.message : '版本操作失败');
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'PACKAGE_VERSION_CONFLICT'
      ) {
        setPending(null);
        await props.onReload();
      }
    } finally {
      mutationLock.current = false;
      if (currentRequest()) setMutating(false);
    }
  };

  const handleManualVersionSaved = async (
    result: ManualEditSkillVersionResult,
  ) => {
    const baseVersionNumber = preview?.versionNumber;
    await props.onReload();
    const created = await liteApi.getSkillVersionDetail(
      props.token,
      props.packageId,
      result.skillVersionId,
    );
    setPreview(created);
    props.onVersionChanged(
      `已从 Skill v${baseVersionNumber ?? '历史'} 创建手动编辑版本 v${result.skillVersionNumber}`,
    );
    toast.success(
      `已从 v${baseVersionNumber ?? '历史'} 创建新版本 v${result.skillVersionNumber}`,
    );
  };

  if (comparisonBase && comparisonTarget) {
    const diffText = createPatch(
      comparisonBase.skill.name || 'skill.md',
      comparisonBase.skill.skillMd,
      comparisonTarget.skill.skillMd,
      `基准版本 · v${comparisonBase.versionNumber}`,
      `对比版本 · v${comparisonTarget.versionNumber}`,
    );
    return (
      <div className="skill-version-page skill-view-enter">
        <header className="skill-version-compare-head">
          <button
            className="skill-text-button"
            onClick={() => setComparison(null)}
          >
            <ArrowLeft size={15} />
            返回版本列表
          </button>
          <div className="skill-version-compare-title">
            <span className="skill-eyebrow">内容对比</span>
            <div className="skill-version-compare-picker">
              <strong>v{comparisonBase.versionNumber}</strong>
              <span>与</span>
              <label>
                <span className="sr-only">选择对比版本</span>
                <select
                  aria-label="选择对比版本"
                  value={comparisonTarget.id}
                  onChange={(event) =>
                    setComparison({
                      baseVersionId: comparisonBase.id,
                      targetVersionId: event.target.value,
                    })
                  }
                >
                  {visible
                    .filter((version) => version.id !== comparisonBase.id)
                    .map((version) => (
                      <option key={version.id} value={version.id}>
                        v{version.versionNumber}
                        {version.id === props.currentVersionId ? '（当前）' : ''}
                      </option>
                    ))}
                </select>
              </label>
            </div>
          </div>
        </header>
        <div className="skill-version-compare-diff">
          <DiffView diff={diffText} />
        </div>
      </div>
    );
  }

  return (
    <div className="skill-version-page skill-view-enter">
      <header className="skill-version-page-head">
        <div className="skill-version-page-title">
          <button
            type="button"
            className="skill-version-back-repository"
            onClick={props.onBackToRepository}
          >
            <ArrowLeft size={15} aria-hidden="true" />
            返回 Skill 仓库
          </button>
          <div>
            <span className="skill-eyebrow">Skill 生命周期</span>
            <h2>版本管理</h2>
            <p>回退会创建新版本，已有内容和历史记录都不会被覆盖。</p>
          </div>
        </div>
        <div className="skill-version-page-tools">
          <label>
            <input
              type="checkbox"
              name="include-discarded-versions"
              checked={includeDiscarded}
              onChange={(event) => setIncludeDiscarded(event.target.checked)}
            />
            显示已废弃版本
          </label>
          <button
            className="skill-text-button"
            disabled={props.loading || mutating}
            onClick={() => void props.onReload()}
          >
            刷新版本
          </button>
        </div>
      </header>
      {props.loading ? (
        <div className="skill-version-loading">
          <Loader2 className="spin" size={20} />
          正在读取版本
        </div>
      ) : visible.length === 0 ? (
        <div className="skill-version-loading">当前 Skill 暂无版本记录</div>
      ) : (
        <div className="skill-version-table">
          {visible.map((version) => {
            const isCurrent = version.id === props.currentVersionId;
            return (
              <article
                key={version.id}
                className={`skill-version-row ${isCurrent ? 'is-current' : ''}`}
              >
                <div className="skill-version-identity">
                  <span>v{version.versionNumber}</span>
                  <div>
                    <strong>
                      {isCurrent
                        ? '当前使用版本'
                        : version.note || sourceLabels[version.source]}
                    </strong>
                    <small>{sourceLabels[version.source]}</small>
                  </div>
                </div>
                <div
                  className={`skill-version-status ${version.status === 'discarded' ? 'is-discarded' : ''}`}
                >
                  {isCurrent ? (
                    <>
                      <Check size={12} />
                      当前版本
                    </>
                  ) : version.status === 'discarded' ? (
                    '已废弃'
                  ) : (
                    '正常'
                  )}
                </div>
                <time dateTime={version.createdAt}>
                  {versionDateFormatter.format(new Date(version.createdAt))}
                </time>
                <div className="skill-version-actions">
                  <button onClick={() => setPreview(version)}>预览</button>
                  <button
                    disabled={visible.length < 2}
                    title={
                      visible.length < 2
                        ? '至少需要两个版本才能对比'
                        : `以 v${version.versionNumber} 为基准进行对比`
                    }
                    onClick={() => startComparison(version)}
                  >
                    <GitCompare size={13} />
                    对比
                  </button>
                  {canRollbackSkillVersion(version, props.currentVersionId) && (
                    <button
                      onClick={() =>
                        setPending({
                          kind: 'rollback',
                          version,
                          idempotencyKey: createRequestId('skill-rollback'),
                          expectedPackageVersionId:
                            props.currentPackageVersionId,
                        })
                      }
                    >
                      <RotateCcw size={13} />
                      回退
                    </button>
                  )}
                  {canDiscardSkillVersion(version, props.currentVersionId) && (
                    <button
                      onClick={() => setPending({ kind: 'discard', version })}
                    >
                      <Trash2 size={13} />
                      废弃
                    </button>
                  )}
                  {version.status === 'discarded' && (
                    <button
                      onClick={() => setPending({ kind: 'restore', version })}
                    >
                      恢复
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
      {props.hasMore && !props.loading && (
        <button
          className="skill-secondary-button"
          disabled={props.loadingMore}
          onClick={() => void props.onLoadMore?.()}
        >
          {props.loadingMore ? '正在加载…' : '加载更多版本'}
        </button>
      )}
      {preview && (
        <SkillVersionContentDialog
          key={preview.id}
          token={props.token}
          packageId={props.packageId}
          version={preview}
          currentPackageVersionId={props.currentPackageVersionId}
          onClose={() => setPreview(null)}
          onSaved={handleManualVersionSaved}
        />
      )}
      {pending && (
        <div className="skill-version-confirm" role="dialog" aria-modal="true">
          <div>
            <History size={20} />
            <h3>{actionTitle(pending)}</h3>
            <p>{actionDescription(pending)}</p>
            <footer>
              <button
                className="skill-secondary-button"
                onClick={() => setPending(null)}
                disabled={mutating}
              >
                取消
              </button>
              <button
                className="skill-primary-button"
                onClick={() => void mutate()}
                disabled={mutating}
              >
                {mutating && <Loader2 size={14} className="spin" />}
                {pending.kind === 'rollback' ? '创建新版本并回退' : '确认'}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

function actionTitle(action: PendingAction) {
  if (action.kind === 'rollback')
    return `回退到 Skill v${action.version.versionNumber}？`;
  if (action.kind === 'discard')
    return `废弃 Skill v${action.version.versionNumber}？`;
  return `恢复 Skill v${action.version.versionNumber}？`;
}

function actionDescription(action: PendingAction) {
  if (action.kind === 'rollback')
    return '系统会读取该历史版本并创建新的 Skill Version，当前版本和全部历史都会保留。';
  if (action.kind === 'discard')
    return '废弃后默认不再展示，但不会物理删除，可以随时恢复。';
  return '恢复后该版本会重新出现在默认版本列表中。';
}

function createRequestId(prefix: string) {
  if (typeof crypto !== 'undefined' && crypto.randomUUID)
    return crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function defaultComparisonTarget(
  base: SkillVersionDetail,
  versions: SkillVersionDetail[],
): SkillVersionDetail | null {
  const candidates = versions.filter((version) => version.id !== base.id);
  const previous = candidates
    .filter((version) => version.versionNumber < base.versionNumber)
    .sort((left, right) => right.versionNumber - left.versionNumber)[0];
  if (previous) return previous;
  return (
    candidates
      .filter((version) => version.versionNumber > base.versionNumber)
      .sort((left, right) => left.versionNumber - right.versionNumber)[0] ??
    candidates[0] ??
    null
  );
}
