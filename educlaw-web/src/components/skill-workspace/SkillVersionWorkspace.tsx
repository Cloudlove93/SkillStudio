import { useMemo, useState } from 'react';
import { createPatch } from 'diff';
import type { SkillVersionDetail } from '@educlaw/shared';
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

type Props = {
  token: string;
  packageId: string;
  versions: SkillVersionDetail[];
  currentVersionId: string | null;
  loading: boolean;
  onReload: () => Promise<void>;
  onVersionChanged: (message: string) => void;
};

type PendingAction = {
  kind: 'rollback' | 'discard' | 'restore';
  version: SkillVersionDetail;
};

const sourceLabels: Record<SkillVersionDetail['source'], string> = {
  generated: '首次生成',
  imported: '导入创建',
  optimized: '自动优化',
  manual: '手动修改',
  interactive: '交互式优化',
  rollback: '版本回退',
};

const versionDateFormatter = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function SkillVersionWorkspace(props: Props) {
  const [includeDiscarded, setIncludeDiscarded] = useState(false);
  const [preview, setPreview] = useState<SkillVersionDetail | null>(null);
  const [compare, setCompare] = useState<SkillVersionDetail | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [mutating, setMutating] = useState(false);
  const visible = useMemo(
    () => visibleSkillVersions(props.versions, includeDiscarded),
    [props.versions, includeDiscarded],
  );
  const current =
    props.versions.find((version) => version.id === props.currentVersionId) ??
    null;

  const mutate = async () => {
    if (!pending) return;
    setMutating(true);
    try {
      if (pending.kind === 'rollback') {
        if (!current) throw new Error('无法确认当前 Skill 版本，请刷新后重试');
        await liteApi.rollbackSkillVersion(props.token, props.packageId, {
          skillId: pending.version.skillId,
          versionId: pending.version.id,
          expectedPackageVersionId: current.createdInPackageVersionId,
          idempotencyKey: createRequestId('skill-rollback'),
          note: `从 Skill v${pending.version.versionNumber} 创建回退版本`,
        });
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
        props.onVersionChanged(
          `Skill v${pending.version.versionNumber} 已废弃`,
        );
      } else {
        await liteApi.undiscardSkillVersion(
          props.token,
          props.packageId,
          pending.version.id,
        );
        props.onVersionChanged(
          `Skill v${pending.version.versionNumber} 已恢复`,
        );
      }
      await props.onReload();
      setPending(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '版本操作失败');
    } finally {
      setMutating(false);
    }
  };

  if (compare && current) {
    const diffText = createPatch(
      current.skill.name || 'skill.md',
      compare.skill.skillMd,
      current.skill.skillMd,
      `历史版本 · v${compare.versionNumber}`,
      `当前版本 · v${current.versionNumber}`,
    );
    return (
      <div className="skill-version-page skill-view-enter">
        <header className="skill-version-compare-head">
          <button
            className="skill-text-button"
            onClick={() => setCompare(null)}
          >
            <ArrowLeft size={15} />
            返回版本列表
          </button>
          <div>
            <span className="skill-eyebrow">内容对比</span>
            <h2>
              v{current.versionNumber} 与 v{compare.versionNumber}
            </h2>
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
        <div>
          <span className="skill-eyebrow">Skill 生命周期</span>
          <h2>版本管理</h2>
          <p>回退会创建新版本，已有内容和历史记录都不会被覆盖。</p>
        </div>
        <label>
          <input
            type="checkbox"
            name="include-discarded-versions"
            checked={includeDiscarded}
            onChange={(event) => setIncludeDiscarded(event.target.checked)}
          />
          显示已废弃版本
        </label>
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
                  {!isCurrent && (
                    <button onClick={() => setCompare(version)}>
                      <GitCompare size={13} />
                      对比
                    </button>
                  )}
                  {canRollbackSkillVersion(version, props.currentVersionId) && (
                    <button
                      onClick={() => setPending({ kind: 'rollback', version })}
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
      {preview && (
        <div className="skill-version-preview" role="dialog" aria-modal="true">
          <div>
            <header>
              <div>
                <span className="skill-eyebrow">版本预览</span>
                <h3>Skill v{preview.versionNumber}</h3>
              </div>
              <button
                type="button"
                className="skill-icon-button"
                onClick={() => setPreview(null)}
                aria-label="关闭版本预览"
              >
                ×
              </button>
            </header>
            <pre>{preview.skill.skillMd}</pre>
          </div>
        </div>
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
