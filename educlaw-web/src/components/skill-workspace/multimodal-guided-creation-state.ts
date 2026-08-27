import type {
  MediaConfirmationStage,
  MediaStage,
  MultimodalEvidence,
} from '@educlaw/shared';
import { MULTIMODAL_MAX_SELECTED_CANDIDATE_IDS } from '@educlaw/shared';
import type {
  MediaPublishResult,
  MediaProgressSseEvent,
  MediaSessionDetail,
  MediaSessionProgress,
} from '../../api/lite-api';

export const MULTIMODAL_RESUME_KEY = 'educlaw:multimodal-skill-resume';
export const MULTIMODAL_SELECTION_LIMIT = MULTIMODAL_MAX_SELECTED_CANDIDATE_IDS;

export function mediaOperationIdempotencyKey(
  operation: string,
  sessionId: string,
  revisionNo: number,
) {
  const safeOperation = String(operation || 'media-operation')
    .trim()
    .replace(/[^A-Za-z0-9._:-]+/g, '-');
  return `${safeOperation}:${sessionId}:r${revisionNo}`;
}

export function isMediaGenerationPublished(detail: MediaSessionDetail) {
  return Boolean(
    detail.status === 'completed' &&
      detail.mediaStage === 'published' &&
      detail.publishedPackage?.packageId &&
      detail.publishedPackage.packageVersionId &&
      Object.keys(detail.publishedPackage.skillVersionIds).length > 0,
  );
}

export function applyMediaGenerationResult(
  detail: MediaSessionDetail,
  result: MediaPublishResult,
): MediaSessionDetail {
  return {
    ...detail,
    status: 'completed',
    mediaStage: 'published',
    revisionNo: result.revisionNo,
    updatedAt: result.publishedAt,
    error: null,
    publishedPackage: {
      packageId: result.packageId,
      packageVersionId: result.packageVersionId,
      packageVersionNumber: result.packageVersionNumber,
      skillVersionIds: result.skillVersionIds,
      publishedAt: result.publishedAt,
    },
  };
}

export type MediaGenerationConfirmationResolution =
  | { kind: 'result'; result: MediaPublishResult }
  | { kind: 'detail'; detail: MediaSessionDetail };

const DEFAULT_GENERATION_RETRY_DELAYS_MS = [0, 400, 1_200, 2_500];

function isAmbiguousGenerationError(error: unknown) {
  if (!error || typeof error !== 'object') return true;
  const status = (error as { status?: unknown }).status;
  if (typeof status !== 'number') return true;
  return status >= 500 || status === 408 || status === 429;
}

function waitFor(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

export async function confirmMediaGenerationReliably(input: {
  confirm: () => Promise<MediaPublishResult>;
  getDetail: () => Promise<MediaSessionDetail>;
  wait?: (delayMs: number) => Promise<void>;
  retryDelaysMs?: number[];
}): Promise<MediaGenerationConfirmationResolution> {
  const retryDelaysMs = input.retryDelaysMs?.length
    ? input.retryDelaysMs
    : DEFAULT_GENERATION_RETRY_DELAYS_MS;
  const wait = input.wait ?? waitFor;
  let firstError: unknown;

  for (let attempt = 0; attempt < retryDelaysMs.length; attempt += 1) {
    const delayMs = Math.max(0, retryDelaysMs[attempt] ?? 0);
    if (delayMs > 0) await wait(delayMs);
    try {
      return { kind: 'result', result: await input.confirm() };
    } catch (error) {
      firstError ??= error;
      try {
        const detail = await input.getDetail();
        if (isMediaGenerationPublished(detail)) {
          return { kind: 'detail', detail };
        }
      } catch {
        // 查询失败仍保留原始确认错误，并按同一幂等键继续有限重放。
      }
      if (!isAmbiguousGenerationError(error)) throw error;
    }
  }

  throw firstError;
}

export type MultimodalConnection = 'offline' | 'sse' | 'polling' | 'settled';

export interface MultimodalWorkbenchError {
  code: string;
  message: string;
  retryable: boolean;
  requestId?: string;
}

export interface MultimodalWorkbenchState {
  detail: MediaSessionDetail | null;
  progress: MediaSessionProgress | null;
  connection: MultimodalConnection;
  uploadPercent: number | null;
  busyAction: string | null;
  error: MultimodalWorkbenchError | null;
  revisionConflict: boolean;
  playerTimeMs: number;
  sourceKind: 'video' | 'audio' | null;
  hasVisualTrack: boolean;
}

export type MultimodalWorkbenchEvent =
  | { type: 'detail.received'; detail: MediaSessionDetail }
  | { type: 'progress.received'; progress: MediaSessionProgress }
  | { type: 'connection.sse' }
  | { type: 'connection.polling' }
  | { type: 'connection.settled' }
  | { type: 'connection.offline' }
  | { type: 'upload.progress'; percent: number }
  | { type: 'action.started'; action: string }
  | { type: 'action.completed' }
  | { type: 'action.failed'; error: MultimodalWorkbenchError }
  | { type: 'player.seek'; timeMs: number }
  | { type: 'stream.event'; event: MediaProgressSseEvent };

export function createMultimodalWorkbenchState(): MultimodalWorkbenchState {
  return {
    detail: null,
    progress: null,
    connection: 'offline',
    uploadPercent: null,
    busyAction: null,
    error: null,
    revisionConflict: false,
    playerTimeMs: 0,
    sourceKind: null,
    hasVisualTrack: false,
  };
}

function hydrate(
  state: MultimodalWorkbenchState,
  detail: MediaSessionDetail,
): MultimodalWorkbenchState {
  if (
    state.detail?.sessionId === detail.sessionId &&
    state.detail.revisionNo > detail.revisionNo
  ) {
    return state;
  }
  if (
    state.detail?.sessionId === detail.sessionId &&
    state.detail.revisionNo === detail.revisionNo &&
    state.detail.mediaStage === detail.mediaStage &&
    state.detail.updatedAt === detail.updatedAt
  ) {
    return state;
  }
  const sourceKind = detail.mediaState.primarySource?.kind ?? null;
  return {
    ...state,
    detail,
    sourceKind,
    hasVisualTrack: sourceKind === 'video',
    busyAction: null,
    error: null,
    revisionConflict: false,
  };
}

export function applyMultimodalEvent(
  state: MultimodalWorkbenchState,
  event: MultimodalWorkbenchEvent,
): MultimodalWorkbenchState {
  if (event.type === 'detail.received') return hydrate(state, event.detail);
  if (event.type === 'progress.received') {
    const current = state.progress;
    const next = event.progress;
    if (
      current?.revisionNo === next.revisionNo &&
      current.mediaStage === next.mediaStage &&
      current.status === next.status &&
      current.currentJob?.jobId === next.currentJob?.jobId &&
      current.currentJob?.status === next.currentJob?.status &&
      current.currentJob?.percent === next.currentJob?.percent &&
      current.currentJob?.hint === next.currentJob?.hint
    ) {
      return state;
    }
    return { ...state, progress: event.progress };
  }
  if (event.type === 'connection.sse') return { ...state, connection: 'sse' };
  if (event.type === 'connection.polling') {
    return { ...state, connection: 'polling' };
  }
  if (event.type === 'connection.settled') {
    return { ...state, connection: 'settled' };
  }
  if (event.type === 'connection.offline') {
    return { ...state, connection: 'offline' };
  }
  if (event.type === 'upload.progress') {
    return {
      ...state,
      uploadPercent: Math.max(0, Math.min(100, event.percent)),
    };
  }
  if (event.type === 'action.started') {
    return {
      ...state,
      busyAction: event.action,
      error: null,
      revisionConflict: false,
    };
  }
  if (event.type === 'action.completed') {
    return { ...state, busyAction: null, error: null };
  }
  if (event.type === 'action.failed') {
    return {
      ...state,
      busyAction: null,
      error: event.error,
      revisionConflict:
        event.error.code === 'REVISION_CONFLICT' ||
        event.error.code === 'SEGMENT_REVISION_CONFLICT' ||
        event.error.code === 'SESSION_REVISION_CONFLICT' ||
        event.error.code === 'PACKAGE_VERSION_CONFLICT',
    };
  }
  if (event.type === 'player.seek') {
    return { ...state, playerTimeMs: Math.max(0, event.timeMs) };
  }
  const stream = event.event;
  if (stream.event === 'progress') {
    return { ...state, progress: stream.data.progress, connection: 'sse' };
  }
  if (stream.event === 'confirmation' || stream.event === 'done') {
    return hydrate({ ...state, connection: 'sse' }, stream.data.session);
  }
  if (stream.event === 'error') {
    return {
      ...state,
      error: null,
      connection: 'polling',
      busyAction: null,
    };
  }
  if (stream.event === 'stream_end') {
    if (state.connection === 'polling') return state;
    return { ...state, connection: 'settled' };
  }
  return state;
}

const SETTLED_MEDIA_STAGES = new Set<MediaStage>([
  'draft',
  'ready_to_process',
  'awaiting_adler_overview',
  'awaiting_candidates',
  'arena_testing',
  'ready_to_publish',
  'published',
  'failed',
  'cancelled',
]);

export function shouldStreamMediaProgress(stage: MediaStage): boolean {
  return !SETTLED_MEDIA_STAGES.has(stage);
}

export function shouldReconcileMediaDetail(
  stage: MediaStage,
  connection: MultimodalConnection,
  forceSettledStage = false,
): boolean {
  void connection;
  return forceSettledStage || shouldStreamMediaProgress(stage);
}

export function mediaReconcileIntervalMs(
  connection: MultimodalConnection,
): number {
  if (connection === 'polling') return 4_000;
  if (connection === 'offline') return 8_000;
  return 12_000;
}

export function pendingConfirmationStage(
  stage: MediaSessionDetail['mediaStage'],
): MediaConfirmationStage | null {
  if (stage === 'awaiting_adler_overview') return 'adler_overview';
  if (stage === 'awaiting_candidates') return 'evidence_and_candidates';
  if (stage === 'arena_testing' || stage === 'ready_to_publish') return 'publish';
  return null;
}

export type EvidenceAlignmentRelation =
  | 'current'
  | 'upcoming'
  | 'recent'
  | 'empty';

const UPCOMING_EVIDENCE_WINDOW_MS = 5_000;

export function evidenceAlignmentAtTime(
  detail: MediaSessionDetail,
  timeMs: number,
): { items: MultimodalEvidence[]; relation: EvidenceAlignmentRelation } {
  const evidenceItems = detail.mediaState.evidenceTimeline.evidenceItems;
  const current = evidenceItems.filter((item) => {
    if (item.timeRange.startMs === item.timeRange.endMs) {
      return item.timeRange.startMs <= timeMs && timeMs <= item.timeRange.startMs + 1_000;
    }
    return item.timeRange.startMs <= timeMs && item.timeRange.endMs >= timeMs;
  });
  if (current.length) return { items: current, relation: 'current' };

  const futureStart = evidenceItems.reduce<number | null>((nearest, item) => {
    if (item.timeRange.startMs <= timeMs) return nearest;
    return nearest === null
      ? item.timeRange.startMs
      : Math.min(nearest, item.timeRange.startMs);
  }, null);
  const previousEnd = evidenceItems.reduce<number | null>((nearest, item) => {
    if (item.timeRange.endMs >= timeMs) return nearest;
    return nearest === null
      ? item.timeRange.endMs
      : Math.max(nearest, item.timeRange.endMs);
  }, null);

  if (
    futureStart !== null &&
    (previousEnd === null || futureStart - timeMs <= UPCOMING_EVIDENCE_WINDOW_MS)
  ) {
    return {
      items: evidenceItems.filter((item) => item.timeRange.startMs === futureStart),
      relation: 'upcoming',
    };
  }
  if (previousEnd !== null) {
    return {
      items: evidenceItems.filter((item) => item.timeRange.endMs === previousEnd),
      relation: 'recent',
    };
  }
  return { items: [], relation: 'empty' };
}

export function evidenceAtTime(
  detail: MediaSessionDetail,
  timeMs: number,
): MultimodalEvidence[] {
  return evidenceAlignmentAtTime(detail, timeMs).items;
}

export function serializeMultimodalResumeState(input: {
  sessionId: string;
  signedUrl?: string;
  uploadToken?: string;
}): string {
  return JSON.stringify({ sessionId: input.sessionId });
}

export function hasMultimodalResumeState(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as { sessionId?: unknown } | null;
    return typeof parsed?.sessionId === 'string' && parsed.sessionId.trim().length > 0;
  } catch {
    return false;
  }
}

export function limitMultimodalCandidateSelection(
  candidateIds: readonly string[],
): string[] {
  return [...new Set(candidateIds)].slice(0, MULTIMODAL_SELECTION_LIMIT);
}

export function toggleMultimodalCandidateSelection(
  current: readonly string[],
  candidateId: string,
  checked: boolean,
): string[] {
  if (!checked) return current.filter((id) => id !== candidateId);
  if (current.includes(candidateId) || current.length >= MULTIMODAL_SELECTION_LIMIT) {
    return [...current];
  }
  return [...current, candidateId];
}
