import type { RefObject } from 'react';
import {
  AlertTriangle,
  Check,
  CircleStop,
  Loader2,
  Play,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import type {
  MediaSessionDetail,
  MediaSessionProgress,
} from '../../../api/lite-api';
import type { MultimodalWorkbenchError } from '../multimodal-guided-creation-state';
import {
  mediaJobProgressLabel,
  mediaJobProgressPercent,
} from './multimodal-wizard-model';

const PROCESS_NODES = [
  {
    key: 'security',
    label: '安全校验',
    stages: ['draft', 'uploading'],
  },
  { key: 'prepare', label: '媒体预处理', stages: ['preparing_media'] },
  {
    key: 'transcript',
    label: '语音转录',
    stages: ['transcribing', 'reviewing_transcript'],
  },
  {
    key: 'evidence',
    label: '关键帧与证据',
    stages: [
      'building_semantic_windows',
      'building_evidence',
      'building_adler',
    ],
  },
] as const;

const COMPLETE_PROCESSING_STAGES = new Set([
  'awaiting_adler_overview',
  'extracting_candidates',
  'validating_candidates',
  'awaiting_candidates',
  'building_skills',
  'arena_testing',
  'ready_to_publish',
  'publishing',
  'published',
]);

const PROCESS_NODE_STATUS_LABELS = {
  complete: '已完成',
  current: '处理中',
  future: '未开始',
  failed: '处理失败',
} as const;

type Props = {
  detail: MediaSessionDetail | null;
  progress: MediaSessionProgress | null;
  error: MultimodalWorkbenchError | null;
  busyAction: string | null;
  uploadPercent: number | null;
  displayName: string;
  sourceUrl: string;
  rightsConfirmed: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onDisplayNameChange: (value: string) => void;
  onSourceUrlChange: (value: string) => void;
  onRightsConfirmedChange: (value: boolean) => void;
  onFileSelected: (file: File) => void;
  onChooseFile: () => void;
  onImportUrl: () => void;
  onCancelUpload: () => void;
  onStart: () => void;
  onCancel: () => void;
  onDeleteReference: () => void;
  onOpenDiagnostics: () => void;
};

function activeNodeIndex(
  detail: MediaSessionDetail | null,
  progress: MediaSessionProgress | null,
) {
  if (!detail) return 0;
  if (detail.mediaStage === 'failed') {
    if (progress?.currentJob?.jobType === 'media_prepare') return 1;
    if (progress?.currentJob?.jobType === 'transcribe') return 2;
    if (progress?.currentJob?.jobType === 'frame_materialize') return 3;
    return 0;
  }
  const index = PROCESS_NODES.findIndex((node) =>
    node.stages.some((stage) => stage === detail.mediaStage),
  );
  return index < 0 ? PROCESS_NODES.length : index;
}

export function MultimodalProgressStep(props: Props) {
  const currentIndex = activeNodeIndex(props.detail, props.progress);
  const processingComplete = props.detail
    ? COMPLETE_PROCESSING_STAGES.has(props.detail.mediaStage)
    : false;
  const isFailed = props.detail?.mediaStage === 'failed';
  const hasSource = Boolean(props.detail?.mediaState.primarySource);
  const readyToStart = props.detail?.mediaStage === 'ready_to_process';
  const currentJob = props.progress?.currentJob ?? null;
  const currentJobIndex =
    currentJob?.jobType === 'media_prepare'
      ? 1
      : currentJob?.jobType === 'transcribe'
        ? 2
        : currentJob?.jobType === 'frame_materialize'
          ? 3
          : 0;
  const currentJobIsActive =
    currentJob?.status === 'queued' || currentJob?.status === 'leased';
  const currentJobPercent = currentJob
    ? mediaJobProgressPercent(currentJob)
    : null;

  return (
    <div className="skill-mm-progress-step">
      <header>
        <span className="skill-eyebrow">处理素材</span>
        <h2>{hasSource ? '正在形成课堂证据' : '添加课堂音频或视频'}</h2>
        <p>
          {hasSource
            ? '处理状态持续保存在服务端，可以安全离开后再回来。'
            : '素材只用于当前工作区，发布前仍需要人工确认。'}
        </p>
      </header>

      {!hasSource && (
        <section className="skill-mm-source-form">
          <label>
            任务名称
            <input
              name="multimodal-task-name"
              autoComplete="off"
              value={props.displayName}
              maxLength={200}
              onChange={(event) =>
                props.onDisplayNameChange(event.target.value)
              }
            />
          </label>
          <div className="skill-mm-source-buttons">
            <button
              type="button"
              className="skill-primary-button"
              onClick={props.onChooseFile}
              disabled={Boolean(props.busyAction)}
            >
              {props.busyAction === 'upload' ? (
                <Loader2 className="spin" size={16} aria-hidden="true" />
              ) : (
                <Upload size={16} aria-hidden="true" />
              )}
              上传音频或视频
            </button>
            {props.busyAction === 'upload' && (
              <button
                type="button"
                className="skill-secondary-button"
                onClick={props.onCancelUpload}
              >
                <CircleStop size={15} aria-hidden="true" />
                取消上传
              </button>
            )}
            <input
              ref={props.fileInputRef}
              name="multimodal-source-file"
              hidden
              type="file"
              accept="audio/*,video/*"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) props.onFileSelected(file);
                event.target.value = '';
              }}
            />
          </div>
          {props.uploadPercent !== null && (
            <div
              className="skill-mm-upload-progress"
              role="progressbar"
              aria-label="素材上传进度"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={props.uploadPercent}
            >
              <span style={{ width: String(props.uploadPercent) + '%' }} />
              <small>{props.uploadPercent}%</small>
            </div>
          )}
          <div className="skill-mm-url-import">
            <input
              name="multimodal-source-url"
              autoComplete="url"
              type="url"
              value={props.sourceUrl}
              onChange={(event) => props.onSourceUrlChange(event.target.value)}
              placeholder="或粘贴可直接下载的 HTTP(S) 音视频地址"
            />
            <button
              type="button"
              className="skill-secondary-button"
              onClick={props.onImportUrl}
              disabled={
                !props.rightsConfirmed ||
                !props.sourceUrl.trim() ||
                Boolean(props.busyAction)
              }
            >
              导入地址
            </button>
            <label>
              <input
                name="multimodal-rights-confirmed"
                type="checkbox"
                checked={props.rightsConfirmed}
                onChange={(event) =>
                  props.onRightsConfirmedChange(event.target.checked)
                }
              />
              我确认有权处理此素材，且地址无需登录、Cookie 或绕过付费限制
            </label>
          </div>
        </section>
      )}

      {hasSource && (
        <ol className="skill-mm-process-nodes">
          {PROCESS_NODES.map((node, index) => {
            const status =
              readyToStart
                ? index === 0
                  ? 'complete'
                  : 'future'
                : isFailed && index === currentIndex
                ? 'failed'
                : processingComplete || index < currentIndex
                  ? 'complete'
                  : index === currentIndex
                    ? 'current'
                    : 'future';
            return (
              <li
                key={node.key}
                data-status={status}
                aria-label={`${node.label}：${PROCESS_NODE_STATUS_LABELS[status]}`}
              >
                <span aria-hidden="true">
                  {status === 'complete' ? (
                    <Check size={15} />
                  ) : status === 'failed' ? (
                    <AlertTriangle size={15} />
                  ) : (
                    index + 1
                  )}
                </span>
                <div>
                  <strong>{node.label}</strong>
                  {status === 'current' && (
                    <small aria-live="polite">
                      {currentJobIsActive && currentJobIndex === index
                        ? mediaJobProgressLabel(currentJob)
                        : '等待服务端更新处理状态'}
                    </small>
                  )}
                  {status === 'failed' && (
                    <small>{props.error?.message ?? '该步骤处理失败'}</small>
                  )}
                </div>
                {status === 'current' &&
                  currentJobIsActive &&
                  currentJobIndex === index &&
                  currentJobPercent !== null &&
                  currentJobPercent !== undefined && (
                    <b aria-label={`${node.label}进度 ${currentJobPercent}%`}>
                      {currentJobPercent}%
                    </b>
                  )}
              </li>
            );
          })}
        </ol>
      )}

      <div className="skill-mm-progress-actions">
        {readyToStart && (
          <>
            <div className="skill-mm-ready-notice" role="status">
              <Check size={16} aria-hidden="true" />
              <div>
                <strong>素材安全校验已完成</strong>
                <small>确认后将开始语音转录、关键帧与证据提取。</small>
              </div>
            </div>
            <button
              type="button"
              className="skill-primary-button"
              onClick={props.onStart}
              disabled={Boolean(props.busyAction)}
            >
              <Play size={15} aria-hidden="true" />
              开始蒸馏
            </button>
          </>
        )}
        {isFailed && (
          <p className="skill-mm-auto-recovery-note">
            <RefreshCw size={15} aria-hidden="true" />
            系统已自动尝试恢复，仍未成功。请查看诊断。
          </p>
        )}
        {(props.error || isFailed) && (
          <button
            type="button"
            className="skill-text-button"
            onClick={props.onOpenDiagnostics}
          >
            查看处理诊断
          </button>
        )}
        {props.detail &&
          ![
            'published',
            'cancelled',
            'failed',
            'draft',
            'ready_to_process',
          ].includes(props.detail.mediaStage) && (
            <button
              type="button"
              className="skill-secondary-button"
              onClick={props.onCancel}
              disabled={Boolean(props.busyAction)}
            >
              <CircleStop size={15} aria-hidden="true" />
              取消处理
            </button>
          )}
        {props.detail &&
          !['published', 'publishing'].includes(props.detail.mediaStage) && (
            <button
              type="button"
              className="skill-text-button"
              onClick={props.onDeleteReference}
              disabled={Boolean(props.busyAction)}
            >
              <Trash2 size={14} aria-hidden="true" />
              删除工作区引用
            </button>
          )}
      </div>
    </div>
  );
}
