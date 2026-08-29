import { useDeferredValue, useMemo, useRef, useState } from 'react';
import type {
  AdlerLayerKey,
  CandidatePassKey,
  MultimodalCandidateSuggestion,
  MultimodalClaimType,
  MultimodalEvidence,
  MultimodalEvidenceKind,
  MultimodalTranscriptSegment,
} from '@educlaw/shared';
import { CANDIDATE_PASS_KEYS } from '@educlaw/shared';
import { useVirtualizer } from '@tanstack/react-virtual';
import type {
  MediaSessionDetail,
  MediaSessionProgress,
} from '../../../api/lite-api';
import type { MultimodalWorkbenchError } from '../multimodal-guided-creation-state';
import {
  aggregateMultimodalDegradations,
  CLAIM_TYPE_LABELS,
  degradationPresentation,
  EVIDENCE_KIND_LABELS,
  mediaJobProgressLabel,
  mediaJobProgressPercent,
} from './multimodal-wizard-model';

export type MultimodalInspectorKind =
  | 'progress'
  | 'transcript'
  | 'evidence'
  | 'diagnostics'
  | 'overview'
  | 'candidate'
  | 'skill'
  | null;

type CandidateSkill =
  MediaSessionDetail['mediaState']['candidateSkills'][number];

type Props = {
  detail: MediaSessionDetail | null;
  error: MultimodalWorkbenchError | null;
  progress: MediaSessionProgress | null;
  statusText: string;
  view: MultimodalInspectorKind;
  selectedLayer: AdlerLayerKey | null;
  selectedCandidate: {
    passKey: CandidatePassKey;
    candidate: MultimodalCandidateSuggestion;
  } | null;
  selectedSkill: CandidateSkill | null;
  framePreview: { evidenceId: string; url: string } | null;
  onSeek: (timeMs: number) => void;
  onUpdateTranscript: (
    index: number,
    text: string,
    speaker: string | null,
  ) => void;
  onPreviewFrame: (evidenceId: string, objectKey: string) => void;
  onRemoveEvidence: (evidenceId: string) => void;
  onUpdateCandidate: (
    passKey: CandidatePassKey,
    candidateId: string,
    patch: Partial<MultimodalCandidateSuggestion>,
  ) => void;
  onSplitCandidate: (
    passKey: CandidatePassKey,
    candidate: MultimodalCandidateSuggestion,
  ) => void;
  onDiscardCandidate: (passKey: CandidatePassKey, candidateId: string) => void;
  onMergeSelectedCandidates: () => void;
  onSaveCandidates: () => void;
};

function formatTime(value: number) {
  const seconds = Math.max(0, Math.floor(value / 1_000));
  return (
    String(Math.floor(seconds / 60)) +
    ':' +
    String(seconds % 60).padStart(2, '0')
  );
}

function VirtualTranscriptList(props: {
  items: Array<{ segment: MultimodalTranscriptSegment; sourceIndex: number }>;
  onSeek: (timeMs: number) => void;
  onUpdate: (index: number, text: string, speaker: string | null) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // TanStack Virtual intentionally exposes imperative functions; keep this
  // list outside React Compiler memoization to avoid stale measurements.
  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: props.items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 108,
    overscan: 6,
    getItemKey: (index) => {
      const item = props.items[index];
      return (
        String(item.segment.startMs) +
        ':' +
        String(item.segment.endMs) +
        ':' +
        String(item.sourceIndex)
      );
    },
  });

  return (
    <div ref={scrollRef} className="skill-mm-virtual-scroll">
      <div
        className="skill-mm-virtual-canvas"
        style={{ height: rowVirtualizer.getTotalSize() }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const item = props.items[virtualRow.index];
          return (
            <article
              ref={rowVirtualizer.measureElement}
              data-index={virtualRow.index}
              key={virtualRow.key}
              className="skill-mm-transcript-row"
              style={{
                position: 'absolute',
                transform: 'translateY(' + String(virtualRow.start) + 'px)',
                width: '100%',
              }}
            >
              <button
                type="button"
                onClick={() => props.onSeek(item.segment.startMs)}
              >
                {formatTime(item.segment.startMs)}–
                {formatTime(item.segment.endMs)}
              </button>
              <textarea
                name={'transcript-segment-' + String(item.sourceIndex + 1)}
                autoComplete="off"
                defaultValue={item.segment.text}
                aria-label={'第 ' + String(item.sourceIndex + 1) + ' 段转录'}
                onBlur={(event) =>
                  props.onUpdate(
                    item.sourceIndex,
                    event.target.value,
                    item.segment.speaker ?? null,
                  )
                }
              />
              <small>
                {item.segment.speaker ?? '未标注说话人'}
                {item.segment.confidence != null
                  ? ' · 置信度 ' +
                    String(Math.round(item.segment.confidence * 100)) +
                    '%'
                  : ''}
                {item.segment.editedByUser ? ' · 已人工修订' : ''}
                {item.segment.correctedByModel ? ' · 已模型纠错' : ''}
              </small>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function VirtualEvidenceList(props: {
  items: MultimodalEvidence[];
  canRemove: boolean;
  framePreview: { evidenceId: string; url: string } | null;
  onSeek: (timeMs: number) => void;
  onPreviewFrame: (evidenceId: string, objectKey: string) => void;
  onRemove: (evidenceId: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // TanStack Virtual intentionally exposes imperative functions; keep this
  // list outside React Compiler memoization to avoid stale measurements.
  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: props.items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 132,
    overscan: 6,
    getItemKey: (index) => props.items[index].evidenceId,
  });

  return (
    <div ref={scrollRef} className="skill-mm-virtual-scroll">
      <div
        className="skill-mm-virtual-canvas"
        style={{ height: rowVirtualizer.getTotalSize() }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const item = props.items[virtualRow.index];
          return (
            <article
              ref={rowVirtualizer.measureElement}
              data-index={virtualRow.index}
              key={virtualRow.key}
              className="skill-mm-evidence-row"
              style={{
                position: 'absolute',
                transform: 'translateY(' + String(virtualRow.start) + 'px)',
                width: '100%',
              }}
            >
              <header>
                <span>{EVIDENCE_KIND_LABELS[item.kind]}</span>
                <span>{CLAIM_TYPE_LABELS[item.claimType]}</span>
              </header>
              {item.kind === 'frame' &&
                item.assetRef &&
                (props.framePreview?.evidenceId === item.evidenceId ? (
                  <img
                    src={props.framePreview.url}
                    alt={'关键帧：' + item.selectionReason}
                    width={640}
                    height={360}
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <button
                    type="button"
                    className="skill-mm-frame-preview"
                    onClick={() =>
                      props.onPreviewFrame(
                        item.evidenceId,
                        item.assetRef!.objectKey,
                      )
                    }
                  >
                    预览关键帧
                  </button>
                ))}
              <button
                type="button"
                className="skill-text-button"
                onClick={() => props.onSeek(item.timeRange.startMs)}
              >
                {formatTime(item.timeRange.startMs)}–
                {formatTime(item.timeRange.endMs)}
              </button>
              <p>{item.text}</p>
              <small>{item.selectionReason}</small>
              {props.canRemove && (
                <button
                  type="button"
                  className="skill-text-button"
                  onClick={() => props.onRemove(item.evidenceId)}
                >
                  撤销引用（对象仍保留）
                </button>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

export function MultimodalInspectorContent(props: Props) {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [lowConfidenceOnly, setLowConfidenceOnly] = useState(false);
  const [editedOnly, setEditedOnly] = useState(false);
  const [evidenceKind, setEvidenceKind] = useState<
    MultimodalEvidenceKind | 'all'
  >('all');
  const [claimType, setClaimType] = useState<MultimodalClaimType | 'all'>(
    'all',
  );

  const transcriptItems = useMemo(() => {
    const normalized = deferredQuery.trim().toLocaleLowerCase();
    return (props.detail?.mediaState.transcript.segments ?? [])
      .map((segment, sourceIndex) => ({ segment, sourceIndex }))
      .filter(({ segment }) => {
        if (
          normalized &&
          !segment.text.toLocaleLowerCase().includes(normalized)
        ) {
          return false;
        }
        if (
          lowConfidenceOnly &&
          (segment.confidence == null || segment.confidence >= 0.7)
        ) {
          return false;
        }
        if (editedOnly && !segment.editedByUser) return false;
        return true;
      });
  }, [deferredQuery, editedOnly, lowConfidenceOnly, props.detail]);

  const evidenceItems = useMemo(() => {
    const normalized = deferredQuery.trim().toLocaleLowerCase();
    return (
      props.detail?.mediaState.evidenceTimeline.evidenceItems ?? []
    ).filter((item) => {
      if (
        normalized &&
        !item.text.toLocaleLowerCase().includes(normalized) &&
        !item.selectionReason.toLocaleLowerCase().includes(normalized)
      ) {
        return false;
      }
      if (evidenceKind !== 'all' && item.kind !== evidenceKind) {
        return false;
      }
      if (claimType !== 'all' && item.claimType !== claimType) {
        return false;
      }
      return true;
    });
  }, [claimType, deferredQuery, evidenceKind, props.detail]);

  const selectedCandidateSources = useMemo(() => {
    if (props.selectedCandidate?.passKey !== 'fused' || props.detail === null) {
      return [];
    }
    const evidenceIds = new Set(props.selectedCandidate.candidate.evidenceIds);
    const detail = props.detail;
    return CANDIDATE_PASS_KEYS.flatMap(
      (passKey) => detail.mediaState.candidatePasses[passKey],
    ).filter((candidate) =>
      candidate.evidenceIds.some((evidenceId) => evidenceIds.has(evidenceId)),
    );
  }, [props.detail, props.selectedCandidate]);

  const degradationItems = aggregateMultimodalDegradations(
    props.detail?.mediaState.degradations ?? [],
  );
  const selectedLayerStatements =
    props.selectedLayer && props.detail?.mediaState.adlerOverview
      ? props.detail.mediaState.adlerOverview.overview[props.selectedLayer]
      : [];
  const currentProgressJob = props.progress?.currentJob ?? null;
  const currentProgressLabel = currentProgressJob
    ? mediaJobProgressLabel(currentProgressJob)
    : null;
  const currentProgressPercent = currentProgressJob
    ? mediaJobProgressPercent(currentProgressJob)
    : null;

  return (
    <div className="skill-mm-inspector-content">
      {props.view === 'progress' && (
        <div className="skill-mm-inspector-progress">
          <section>
            <span>当前状态</span>
            <strong>{props.statusText}</strong>
          </section>
          {currentProgressJob && currentProgressLabel && (
            <section>
              <span>
                {currentProgressJob.status === 'queued' ||
                currentProgressJob.status === 'leased'
                  ? '正在处理'
                  : '最近任务'}
              </span>
              <strong aria-live="polite">{currentProgressLabel}</strong>
              {currentProgressPercent != null && (
                <div
                  className="skill-context-progress-track"
                  role="progressbar"
                  aria-label={`${currentProgressLabel}进度`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={currentProgressPercent}
                >
                  <span
                    style={{ width: `${currentProgressPercent}%` }}
                  />
                </div>
              )}
            </section>
          )}
          <section>
            <span>已形成内容</span>
            <strong>
              {props.detail?.mediaState.transcript.segments.length ?? 0} 段转录
              ·{' '}
              {props.detail?.mediaState.evidenceTimeline.evidenceItems.length ??
                0}{' '}
              条证据
            </strong>
          </section>
          <p>状态保存在服务端，可以安全离开后再回来继续。</p>
        </div>
      )}

      {props.view === 'transcript' && (
        <div className="skill-mm-inspector-dataset">
          <div className="skill-mm-inspector-filters">
            <input
              type="search"
              name="multimodal-transcript-search"
              autoComplete="off"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索转录"
            />
            <label>
              <input
                type="checkbox"
                name="transcript-low-confidence-only"
                checked={lowConfidenceOnly}
                onChange={(event) => setLowConfidenceOnly(event.target.checked)}
              />
              低置信度
            </label>
            <label>
              <input
                type="checkbox"
                name="transcript-edited-only"
                checked={editedOnly}
                onChange={(event) => setEditedOnly(event.target.checked)}
              />
              已人工修改
            </label>
          </div>
          <span
            className="skill-mm-result-count"
            role="status"
            aria-live="polite"
          >
            {transcriptItems.length} 个片段
          </span>
          <VirtualTranscriptList
            items={transcriptItems}
            onSeek={props.onSeek}
            onUpdate={props.onUpdateTranscript}
          />
        </div>
      )}

      {props.view === 'evidence' && (
        <div className="skill-mm-inspector-dataset">
          <div className="skill-mm-inspector-filters">
            <input
              type="search"
              name="multimodal-evidence-search"
              autoComplete="off"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索证据"
            />
            <label>
              证据类型
              <select
                name="multimodal-evidence-kind"
                value={evidenceKind}
                onChange={(event) =>
                  setEvidenceKind(
                    event.target.value as MultimodalEvidenceKind | 'all',
                  )
                }
              >
                <option value="all">全部</option>
                <option value="transcript">转录</option>
                <option value="audio_segment">音频片段</option>
                <option value="frame">关键帧</option>
              </select>
            </label>
            <label>
              结论类型
              <select
                name="multimodal-claim-type"
                value={claimType}
                onChange={(event) =>
                  setClaimType(
                    event.target.value as MultimodalClaimType | 'all',
                  )
                }
              >
                <option value="all">全部</option>
                <option value="sourceFact">原文事实</option>
                <option value="modelInference">模型推断</option>
                <option value="userInput">人工输入</option>
              </select>
            </label>
          </div>
          <span
            className="skill-mm-result-count"
            role="status"
            aria-live="polite"
          >
            {evidenceItems.length} 条证据
          </span>
          <VirtualEvidenceList
            items={evidenceItems}
            canRemove={
              props.detail?.mediaStage === 'awaiting_adler_overview' &&
              evidenceItems.length > 1
            }
            framePreview={props.framePreview}
            onSeek={props.onSeek}
            onPreviewFrame={props.onPreviewFrame}
            onRemove={props.onRemoveEvidence}
          />
        </div>
      )}

      {props.view === 'diagnostics' && (
        <div className="skill-mm-diagnostics">
          {props.error && (
            <article className="skill-mm-diagnostic-item" role="alert">
              <header>
                <strong>{props.error.message}</strong>
                <span>{props.error.code}</span>
              </header>
              <p>
                {props.error.retryable
                  ? '本次操作没有完成，可以刷新状态后再次尝试。'
                  : '请根据提示修正当前状态后再继续。'}
                {props.error.requestId
                  ? ` 诊断编号：${props.error.requestId}`
                  : ''}
              </p>
            </article>
          )}
          {degradationItems.length ? (
            degradationItems.map((item) => {
              const display = degradationPresentation(item.code, item.message);
              return (
                <article
                  key={item.code + ':' + item.message}
                  className="skill-mm-diagnostic-item"
                >
                  <header>
                    <strong>{display.title}</strong>
                    <span>{item.count} 个片段</span>
                  </header>
                  <p>{display.detail}</p>
                </article>
              );
            })
          ) : !props.error ? (
            <p className="skill-media-muted">本次处理没有记录降级信息。</p>
          ) : null}
        </div>
      )}

      {props.view === 'overview' && (
        <div className="skill-mm-overview-expanded">
          {selectedLayerStatements.map((statement, index) => (
            <button
              type="button"
              key={String(index)}
              onClick={() => {
                const evidence =
                  props.detail?.mediaState.evidenceTimeline.evidenceItems.find(
                    (item) => statement.evidenceIds.includes(item.evidenceId),
                  );
                if (evidence) props.onSeek(evidence.timeRange.startMs);
              }}
            >
              <span>{statement.text}</span>
              <small>{statement.evidenceIds.length} 条证据</small>
            </button>
          ))}
        </div>
      )}

      {props.view === 'candidate' && props.selectedCandidate && (
        <div className="skill-mm-candidate-editor">
          <label>
            候选标题
            <input
              name="multimodal-candidate-title"
              autoComplete="off"
              value={props.selectedCandidate.candidate.title}
              onChange={(event) =>
                props.onUpdateCandidate(
                  props.selectedCandidate!.passKey,
                  props.selectedCandidate!.candidate.candidateId,
                  { title: event.target.value },
                )
              }
            />
          </label>
          <label>
            主题简介
            <textarea
              name="multimodal-candidate-summary"
              autoComplete="off"
              value={props.selectedCandidate.candidate.summary}
              onChange={(event) =>
                props.onUpdateCandidate(
                  props.selectedCandidate!.passKey,
                  props.selectedCandidate!.candidate.candidateId,
                  { summary: event.target.value },
                )
              }
            />
          </label>
          <label>
            可复用规则
            <textarea
              name="multimodal-candidate-rule"
              autoComplete="off"
              value={props.selectedCandidate.candidate.reusableRule}
              onChange={(event) =>
                props.onUpdateCandidate(
                  props.selectedCandidate!.passKey,
                  props.selectedCandidate!.candidate.candidateId,
                  { reusableRule: event.target.value },
                )
              }
            />
          </label>
          <small>
            {props.selectedCandidate.candidate.evidenceIds.length} 条证据 ·{' '}
            {props.selectedCandidate.candidate.claimType}
          </small>
          <section className="skill-mm-candidate-sources">
            <h3>融合来源</h3>
            {selectedCandidateSources.length > 0 ? (
              <ul>
                {selectedCandidateSources.map((candidate) => (
                  <li key={candidate.candidateId}>
                    <strong>{candidate.title}</strong>
                    <span>{candidate.evidenceIds.length} 条证据</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>这个主题基于证据关联形成，没有额外的原子候选来源。</p>
            )}
          </section>
          <div className="skill-mm-candidate-editor-actions">
            <button
              type="button"
              className="skill-secondary-button"
              onClick={() =>
                props.onSplitCandidate(
                  props.selectedCandidate!.passKey,
                  props.selectedCandidate!.candidate,
                )
              }
            >
              拆分候选
            </button>
            <button
              type="button"
              className="skill-secondary-button"
              onClick={props.onMergeSelectedCandidates}
            >
              合并所选同类候选
            </button>
            <button
              type="button"
              className="skill-secondary-button"
              onClick={props.onSaveCandidates}
            >
              保存并重新验证
            </button>
            <button
              type="button"
              className="skill-text-button"
              onClick={() =>
                props.onDiscardCandidate(
                  props.selectedCandidate!.passKey,
                  props.selectedCandidate!.candidate.candidateId,
                )
              }
            >
              废弃候选
            </button>
          </div>
        </div>
      )}

      {props.view === 'skill' && props.selectedSkill && (
        <div className="skill-mm-skill-document">
          <p>{props.selectedSkill.description}</p>
          <pre>{props.selectedSkill.skillMd}</pre>
        </div>
      )}
    </div>
  );
}
