import type {
  AgentPackageDetail,
  AgentPackageSnapshot,
  AgentPackageSummary,
  ArenaMessage,
  ArenaReport,
  ArenaThread,
  ArenaThreadDetail,
  GuidedCreationAction,
  GuidedCreationCancelPayload,
  GuidedCreationConfirmPayload,
  GuidedCreationDeletePayload,
  GuidedCreationDetailPayload,
  GuidedCreationListPayload,
  GuidedCreationMessage,
  GuidedCreationMessagePayload,
  GuidedCreationRenamePayload,
  GuidedCreationSession,
  GuidedCreationSessionDetail,
  GuidedCreationStartPayload,
  MediaConfirmationStage,
  MediaJobStatus,
  MediaJobType,
  MediaStage,
  MultimodalCandidatePasses,
  MultimodalEvidence,
  PublicMultimodalSessionState,
  OptimizationResult,
  PackageSkillRecord,
  PackageVersion,
  RollbackSkillVersionPayload,
  SkillAction,
  SkillVersionDetail,
  SkillVersionListResult,
  UserSummary,
} from '@educlaw/shared';
import { ARENA_ROUTES, PACKAGE_ROUTES } from '@educlaw/shared';
import { apiFetch } from './client';

export interface DiagnosisIssue {
  id: string;
  target: 'agent' | 'rubric' | 'skill';
  targetId?: string;
  targetName?: string;
  title: string;
  reason: string;
  suggestion: string;
}

export interface DiagnosisResult {
  welcomeMessage: string;
  issues: DiagnosisIssue[];
}

export interface AdoptedChange {
  id: string;
  target: 'agent' | 'rubric' | 'skill';
  targetId?: string;
  targetName?: string;
  original: string;
  modified: string;
  reason: string;
}

export interface ChatOptimizeResult {
  reply: string;
  newAdoptions: AdoptedChange[];
  newRejections: string[];
  isDone: boolean;
  session?: InteractiveOptimizationSession;
}

export interface InteractiveOptimizationMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface InteractiveOptimizationSession {
  id: string;
  packageId: string;
  threadId: string;
  status: string;
  messages: InteractiveOptimizationMessage[];
  issues: DiagnosisIssue[];
  adoptedChanges: AdoptedChange[];
  summary: string;
  versionId?: string;
  versionNumber?: number;
  createdAt: string;
  updatedAt: string;
}

export interface LineDiff {
  type: 'same' | 'removed' | 'added';
  text: string;
}

export function computeLineDiff(oldText: string, newText: string): LineDiff[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const result: LineDiff[] = [];
  let i = 0,
    j = 0;
  while (i < oldLines.length || j < newLines.length) {
    const oldLine = i < oldLines.length ? oldLines[i] : undefined;
    const newLine = j < newLines.length ? newLines[j] : undefined;
    if (oldLine === newLine) {
      result.push({ type: 'same', text: oldLine || '' });
      i++;
      j++;
    } else if (oldLine !== undefined && newLine !== undefined) {
      const newIndexAhead = newLines.slice(j + 1).indexOf(oldLine);
      const oldIndexAhead = oldLines.slice(i + 1).indexOf(newLine);
      if (
        newIndexAhead !== -1 &&
        (oldIndexAhead === -1 || newIndexAhead <= oldIndexAhead)
      ) {
        result.push({ type: 'removed', text: oldLine });
        i++;
      } else if (
        oldIndexAhead !== -1 &&
        (newIndexAhead === -1 || oldIndexAhead < newIndexAhead)
      ) {
        result.push({ type: 'added', text: newLine });
        j++;
      } else {
        result.push({ type: 'removed', text: oldLine });
        result.push({ type: 'added', text: newLine });
        i++;
        j++;
      }
    } else if (oldLine !== undefined) {
      result.push({ type: 'removed', text: oldLine });
      i++;
    } else if (newLine !== undefined) {
      result.push({ type: 'added', text: newLine });
      j++;
    }
  }
  return result;
}

export interface SkillDiff {
  dirName: string;
  name: string;
  diff: LineDiff[];
}

export interface VersionCompareResult {
  baseVersion: {
    id: string;
    versionNumber: number;
    source: string;
    createdAt: string;
  };
  targetVersion: {
    id: string;
    versionNumber: number;
    source: string;
    createdAt: string;
  };
  diffs: {
    agentMd: LineDiff[];
    rubricMd: LineDiff[];
    skills: SkillDiff[];
  };
  summary: string;
}

/* ── 反馈式优化（基于单条回答反馈的 Skill 优化草稿） ── */
export type FeedbackScope =
  | 'reusable_preference'
  | 'single_turn_feedback'
  | 'unsafe_or_unclear';
export type FeedbackPatchOp =
  | 'append_to_section'
  | 'replace_in_section'
  | 'add_section';

export interface FeedbackPatchOperation {
  op: FeedbackPatchOp;
  targetSection: string;
  oldText?: string;
  content: string;
  rationale?: string;
}

export interface FeedbackOptimizationResult {
  issueSummary: string;
  feedbackScope: FeedbackScope;
  targetSkillId: string;
  targetSkillName: string;
  targetSections: string[];
  patchOperations: FeedbackPatchOperation[];
  rationale: string;
  evidenceFromAnswer: string[];
  riskNotes: string[];
  originalSkillMd: string;
  optimizedSkillMd: string;
  optimizedSnapshot: AgentPackageSnapshot;
  validationErrors: string[];
  diff: LineDiff[];
}

export type PackageGeneratePreview = {
  type: string;
  name: string;
  content: string;
};
export type PackageGeneratePreviewDelta = {
  type: string;
  name: string;
  delta: string;
};
export type PackageGenerateStreamEvent =
  | { event: 'phase'; data: { label: string } }
  | { event: 'preview'; data: PackageGeneratePreview }
  | { event: 'preview_delta'; data: PackageGeneratePreviewDelta }
  | { event: 'ping'; data: Record<string, never> }
  | { event: 'done'; data: AgentPackageDetail }
  | { event: 'error'; data: { error: string } }
  | { event: 'stream_end'; data: { ok: boolean } };

export type GuidedCreationSseEvent =
  | { event: 'phase'; data: { phase: string } }
  | { event: 'message'; data: { message: GuidedCreationMessage } }
  | { event: 'confirmation'; data: { session: GuidedCreationSessionDetail } }
  | {
      event: 'preview';
      data: { files: Array<{ path: string; content: string }> };
    }
  | { event: 'done'; data: { session: GuidedCreationSessionDetail } }
  | {
      event: 'error';
      data: { code: string; message: string; retryable: boolean };
    }
  | { event: 'stream_end'; data: Record<string, never> }
  | { event: 'ping'; data: Record<string, never> };

export type ConfirmationStage = MediaConfirmationStage;

export interface MediaSessionSummary {
  sessionId: string;
  displayName: string;
  status:
    | 'collecting'
    | 'ready_for_confirmation'
    | 'finalizing'
    | 'completed'
    | 'failed'
    | 'cancelled';
  mediaStage: MediaStage;
  revisionNo: number;
  createdAt: string;
  updatedAt: string;
}

export interface RepositorySkillRecord {
  id: string;
  packageId: string;
  skillUid: string;
  dirName: string;
  name: string;
  description: string;
  updatedAt: string;
  packageName: string;
  packageDescription: string;
}

export interface RepositorySkillPage {
  items: RepositorySkillRecord[];
  nextCursor: string | null;
}

export interface ArenaThreadPage {
  items: ArenaThread[];
  nextCursor: string | null;
}

export interface MediaSessionDetail extends MediaSessionSummary {
  mediaState: PublicMultimodalSessionState;
  error: {
    code: string;
    stage: MediaStage;
    resumeStage: MediaStage;
    retryable: boolean;
    message: string;
  } | null;
  arenaEvaluation?: MediaArenaEvaluation | null;
  publishedPackage?: {
    packageId: string;
    packageVersionId: string;
    packageVersionNumber: number;
    skillVersionIds: Record<string, string>;
    publishedAt: string;
  } | null;
}

export type MediaJsonAction =
  | 'skill.media.session.create'
  | 'skill.media.session.list'
  | 'skill.media.asset.preview'
  | 'skill.media.upload.intent'
  | 'skill.media.upload.confirm'
  | 'skill.media.url.import'
  | 'skill.media.process.start'
  | 'skill.media.retry'
  | 'skill.media.cancel'
  | 'skill.media.session.delete'
  | 'skill.media.transcript.update'
  | 'skill.media.evidence.update'
  | 'skill.media.candidate.update'
  | 'skill.media.overview.confirm'
  | 'skill.media.candidate.confirm'
  | 'skill.media.test.start'
  | 'skill.media.generate.confirm'
  | 'skill.media.publish';

export interface MediaArenaEvaluation {
  schemaVersion: 1;
  configVersion: 'multimodal-arena-v1';
  caseVersion: string;
  candidateRevisionNo: number;
  snapshotHash: string;
  models: { baseline: string; enhanced: string };
  cases: Array<{
    caseId: string;
    input: string;
    baselineOutput: string;
    enhancedOutput: string;
    baselineScore: number;
    enhancedScore: number;
    safetyPassed: boolean;
    groundedPassed: boolean;
    passed: boolean;
    reason: string;
  }>;
  passedCaseCount: number;
  passed: boolean;
  deterministicFailures: string[];
  resultHash: string;
}

export interface MediaArenaTestResult {
  sessionId: string;
  revisionNo: number;
  mediaStage: 'arena_testing' | 'ready_to_publish';
  passed: boolean;
  evaluation: MediaArenaEvaluation;
  replayed: boolean;
}

export interface MediaPublishResult {
  sessionId: string;
  revisionNo: number;
  mediaStage: 'published';
  packageId: string;
  packageVersionId: string;
  packageVersionNumber: number;
  skillVersionIds: Record<string, string>;
  publishedAt: string;
  replayed: boolean;
}

export type MediaUploadIntent =
  | {
      sessionId: string;
      revisionNo: number;
      mediaStage: 'uploading';
      uploadMode: 'single_put';
      expiresAt: string;
      uploadToken: string;
      upload: {
        method: 'PUT';
        url: string;
        requiredHeaders: Record<string, string>;
      };
      replayed: boolean;
    }
  | {
      sessionId: string;
      revisionNo: number;
      mediaStage: 'uploading';
      uploadMode: 'multipart';
      expiresAt: string;
      uploadToken: string;
      multipart: {
        partSizeBytes: number;
        partCount: number;
        parts: Array<{
          partNumber: number;
          url: string;
          expiresAt: string;
          requiredHeaders: Record<string, string>;
        }>;
      };
      replayed: boolean;
    };

export interface MediaUploadConfirmResult {
  sessionId: string;
  revisionNo: number;
  mediaStage: 'uploading' | 'ready_to_process';
  materialStatus: 'verifying';
  jobId: string;
  observedSizeBytes: number;
  observedContentType: string;
  jobType: 'media_quality_check';
  replayed: boolean;
}

export interface MediaUrlImportResult {
  sessionId: string;
  revisionNo: number;
  mediaStage: MediaStage;
  jobId: string;
  jobType: 'media_quality_check';
  sizeBytes: number;
  contentType: string;
  replayed: boolean;
}

export interface MediaProcessStartResult {
  sessionId: string;
  revisionNo: number;
  mediaStage: 'preparing_media';
  job: { jobId: string; jobType: string; status: string; attemptNo: number };
  pipelinePlan: {
    transcribe: boolean;
    frameMaterialize: boolean;
    visualOnly: boolean;
  };
  replayed: boolean;
}

export interface MediaMutationResult {
  sessionId: string;
  revisionNo: number;
  mediaStage: MediaStage;
  invalidatedFrom:
    | 'semantic_moments'
    | 'adler_overview'
    | 'candidate_validation';
  replayed: boolean;
}

export interface MediaConfirmationResult {
  sessionId: string;
  revisionNo: number;
  mediaStage: MediaStage;
  confirmedStage: 'adler_overview' | 'evidence_and_candidates';
  replayed: boolean;
}

export interface MediaSessionProgress extends MediaSessionSummary {
  currentJob: {
    jobId: string;
    jobType: MediaJobType;
    status: MediaJobStatus;
    percent: number | null;
    hint: string | null;
  } | null;
}

export type MediaProgressSseEvent =
  | {
      event: 'progress';
      data: {
        progress: MediaSessionProgress;
      };
    }
  | {
      event: 'confirmation';
      data: {
        session: MediaSessionDetail;
        confirmationStage: ConfirmationStage;
      };
    }
  | {
      event: 'done';
      data: {
        session: MediaSessionDetail;
      };
    }
  | {
      event: 'error';
      data: {
        code: string;
        message: string;
        retryable: boolean;
      };
    }
  | {
      event: 'stream_end';
      data: {
        reason?: 'not_started';
      };
    }
  | { event: 'ping'; data: Record<string, never> };

export type ArenaMessageStreamEvent =
  | { event: 'phase'; data: { label: string } }
  | { event: 'shared'; data: { message: ArenaMessage } }
  | {
      event: 'thinking_status';
      data: { requested: boolean; enabled: boolean; supported: boolean };
    }
  | { event: 'side_start'; data: { side: 'baseline' | 'enhanced' } }
  | { event: 'delta'; data: { side: 'baseline' | 'enhanced'; delta: string } }
  | {
      event: 'reasoning_delta';
      data: { side: 'baseline' | 'enhanced'; delta: string };
    }
  | {
      event: 'side_done';
      data: {
        side: 'baseline' | 'enhanced';
        content: string;
        reasoningContent: string | null;
        ok: boolean;
        error?: string;
      };
    }
  | { event: 'done'; data: { thread: ArenaThread; messages: ArenaMessage[] } }
  | { event: 'error'; data: { error: string } }
  | { event: 'stream_end'; data: { ok: boolean } };

export type ArenaMode = 'compare' | 'agent' | 'baseline';

export interface SkillArenaSelectionPayload {
  skillId: string;
  skillVersionId: string;
}

export type ReportStreamEvent =
  | { event: 'phase'; data: { label: string } }
  | { event: 'ping'; data: Record<string, never> }
  | { event: 'done'; data: ArenaReport }
  | { event: 'error'; data: { error: string } }
  | { event: 'stream_end'; data: { ok: boolean } };

export type OptimizeStreamEvent =
  | { event: 'phase'; data: { label: string } }
  | { event: 'ping'; data: Record<string, never> }
  | { event: 'done'; data: OptimizationResult }
  | { event: 'error'; data: { error: string } }
  | { event: 'stream_end'; data: { ok: boolean } };

async function request<T>(
  path: string,
  init: RequestInit = {},
  token?: string,
): Promise<T> {
  const response = await apiFetch(`/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    const body = await response
      .json()
      .catch(() => ({ error: `HTTP ${response.status}` }));
    throw new Error(body.error || `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

class LiteApiError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly status?: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

async function actionRequest<T>(
  token: string,
  action: SkillAction,
  pkgId: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const response = await apiFetch('/api', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ action, pkgId, payload }),
  });
  const body = await response
    .json()
    .catch(() => ({ message: `HTTP ${response.status}` }));
  if (!response.ok) {
    const message =
      body && typeof body.message === 'string' && body.message.trim()
        ? body.message
        : `HTTP ${response.status}`;
    throw new LiteApiError(
      message,
      typeof body?.code === 'string' ? body.code : undefined,
      response.status,
      body && typeof body === 'object' ? body : undefined,
    );
  }
  return body.data as T;
}

async function guidedActionRequest<T>(
  token: string,
  action:
    | GuidedCreationAction
    | 'skill.media.session.detail'
    | 'skill.media.progress',
  payload: Record<string, unknown> = {},
): Promise<T> {
  const response = await apiFetch('/api', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ action, payload }),
  });
  const body = await response
    .json()
    .catch(() => ({ message: `HTTP ${response.status}` }));
  if (!response.ok) {
    throw new LiteApiError(
      typeof body?.message === 'string' ? body.message : `HTTP ${response.status}`,
      typeof body?.code === 'string' ? body.code : undefined,
      response.status,
      body && typeof body === 'object' ? body : undefined,
    );
  }
  return body.data as T;
}

async function mediaActionRequest<T>(
  token: string,
  action: MediaJsonAction,
  input: {
    sessionId?: string;
    idempotencyKey?: string;
    payload?: Record<string, unknown>;
  } = {},
): Promise<T> {
  const response = await apiFetch('/api', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      action,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.idempotencyKey
        ? { idempotencyKey: input.idempotencyKey }
        : {}),
      payload: input.payload ?? {},
    }),
  });
  const body = await response
    .json()
    .catch(() => ({ message: `HTTP ${response.status}` }));
  if (!response.ok) {
    const message =
      typeof body?.message === 'string' && body.message.trim()
        ? body.message
        : typeof body?.error === 'string' && body.error.trim()
          ? body.error
          : `HTTP ${response.status}`;
    throw new LiteApiError(
      message,
      typeof body?.code === 'string' ? body.code : undefined,
      response.status,
      body && typeof body === 'object' ? body : undefined,
    );
  }
  return body.data as T;
}

function guidedStreamRequest<
  TEvent extends GuidedCreationSseEvent | MediaProgressSseEvent,
>(
  token: string,
  action: GuidedCreationAction | 'skill.media.progress.stream',
  payload: Record<string, unknown>,
  onEvent: (event: TEvent) => void,
  signal?: AbortSignal,
) {
  return streamRequest<TEvent>(
    '',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, payload }),
      signal,
    },
    token,
    onEvent,
  );
}

async function streamRequest<TEvent>(
  path: string,
  init: RequestInit,
  token: string,
  onEvent: (event: TEvent) => void,
): Promise<void> {
  const response = await apiFetch(`/api${path}`, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    const body = await response
      .json()
      .catch(() => ({ error: `HTTP ${response.status}` }));
    throw new Error(body.error || `HTTP ${response.status}`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Stream not available');
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';
    for (const part of parts) {
      if (!part.trim()) continue;
      let eventName = 'message',
        data = '';
      for (const line of part.split('\n')) {
        if (line.startsWith('event: ')) eventName = line.slice(7);
        if (line.startsWith('data: ')) data = line.slice(6);
      }
      if (!data) continue;
      onEvent({ event: eventName, data: JSON.parse(data) } as TEvent);
    }
  }
}

export const liteApi = {
  createMediaSession: (
    token: string,
    input: { idempotencyKey: string; displayName: string },
  ) =>
    mediaActionRequest<MediaSessionDetail>(token, 'skill.media.session.create', {
      idempotencyKey: input.idempotencyKey,
      payload: { displayName: input.displayName },
    }),
  listMediaSessions: (
    token: string,
    input: { limit?: number; cursor?: string } = {},
  ) =>
    mediaActionRequest<{
      items: MediaSessionSummary[];
      nextCursor: string | null;
    }>(token, 'skill.media.session.list', { payload: input }),
  createMediaAssetPreview: (
    token: string,
    input: { sessionId: string; objectKey: string },
  ) =>
    mediaActionRequest<{ url: string; expiresAt: string; mimeType: string }>(
      token,
      'skill.media.asset.preview',
      { payload: input },
    ),
  createMediaUploadIntent: (
    token: string,
    input: {
      sessionId: string;
      idempotencyKey: string;
      fileName: string;
      declaredMimeType: string;
      sizeBytes: number;
    },
  ) =>
    mediaActionRequest<MediaUploadIntent>(token, 'skill.media.upload.intent', {
      sessionId: input.sessionId,
      idempotencyKey: input.idempotencyKey,
      payload: {
        fileName: input.fileName,
        declaredMimeType: input.declaredMimeType,
        sizeBytes: input.sizeBytes,
      },
    }),
  confirmMediaUpload: (
    token: string,
    input: {
      sessionId: string;
      idempotencyKey: string;
      uploadToken: string;
      expectedRevisionNo: number;
      parts?: Array<{ partNumber: number; etag: string }>;
    },
  ) =>
    mediaActionRequest<MediaUploadConfirmResult>(
      token,
      'skill.media.upload.confirm',
      {
        sessionId: input.sessionId,
        idempotencyKey: input.idempotencyKey,
        payload: {
          uploadToken: input.uploadToken,
          expectedRevisionNo: input.expectedRevisionNo,
          ...(input.parts ? { parts: input.parts } : {}),
        },
      },
    ),
  importMediaUrl: (
    token: string,
    input: {
      sessionId: string;
      idempotencyKey: string;
      url: string;
      rightsConfirmed: true;
    },
  ) =>
    mediaActionRequest<MediaUrlImportResult>(token, 'skill.media.url.import', {
      sessionId: input.sessionId,
      idempotencyKey: input.idempotencyKey,
      payload: { url: input.url, rightsConfirmed: input.rightsConfirmed },
    }),
  startMediaProcessing: (
    token: string,
    input: {
      sessionId: string;
      idempotencyKey: string;
      expectedRevisionNo: number;
      understandingMode: 'auto' | 'nativeVideo' | 'compatible';
    },
  ) =>
    mediaActionRequest<MediaProcessStartResult>(
      token,
      'skill.media.process.start',
      {
        sessionId: input.sessionId,
        idempotencyKey: input.idempotencyKey,
        payload: {
          expectedRevisionNo: input.expectedRevisionNo,
          understandingMode: input.understandingMode,
          transcriptionMode: 'deploymentDefault',
        },
      },
    ),
  retryMediaProcessing: (
    token: string,
    input: {
      sessionId: string;
      idempotencyKey: string;
      expectedRevisionNo: number;
      failedJobId?: string;
    },
  ) =>
    mediaActionRequest<{
      sessionId: string;
      revisionNo: number;
      mediaStage: MediaStage;
      retriedJobId: string | null;
      job: { jobId: string; jobType: string; status: string; attemptNo: number } | null;
      replayed: boolean;
    }>(token, 'skill.media.retry', {
      sessionId: input.sessionId,
      idempotencyKey: input.idempotencyKey,
      payload: {
        expectedRevisionNo: input.expectedRevisionNo,
        ...(input.failedJobId ? { failedJobId: input.failedJobId } : {}),
      },
    }),
  cancelMediaProcessing: (
    token: string,
    input: { sessionId: string; expectedRevisionNo: number },
  ) =>
    mediaActionRequest<{
      sessionId: string;
      revisionNo: number;
      mediaStage: 'cancelled';
      cancelledJobCount: number;
    }>(token, 'skill.media.cancel', {
      sessionId: input.sessionId,
      payload: { expectedRevisionNo: input.expectedRevisionNo },
    }),
  deleteMediaSession: (
    token: string,
    input: { sessionId: string; expectedRevisionNo: number },
  ) =>
    mediaActionRequest<{ sessionId: string; revisionNo: number; deletedAt: string }>(
      token,
      'skill.media.session.delete',
      {
        sessionId: input.sessionId,
        payload: { expectedRevisionNo: input.expectedRevisionNo },
      },
    ),
  updateMediaTranscriptSegment: (
    token: string,
    input: {
      sessionId: string;
      idempotencyKey: string;
      expectedRevisionNo: number;
      segmentIndex: number;
      expectedSegmentRevisionNo: number;
      text: string;
      speaker: string | null;
    },
  ) =>
    mediaActionRequest<MediaMutationResult>(
      token,
      'skill.media.transcript.update',
      {
        sessionId: input.sessionId,
        idempotencyKey: input.idempotencyKey,
        payload: {
          expectedRevisionNo: input.expectedRevisionNo,
          segmentIndex: input.segmentIndex,
          expectedSegmentRevisionNo: input.expectedSegmentRevisionNo,
          text: input.text,
          speaker: input.speaker,
        },
      },
    ),
  updateMediaEvidence: (
    token: string,
    input: {
      sessionId: string;
      idempotencyKey: string;
      expectedRevisionNo: number;
      evidenceItems: MultimodalEvidence[];
    },
  ) =>
    mediaActionRequest<MediaMutationResult>(token, 'skill.media.evidence.update', {
      sessionId: input.sessionId,
      idempotencyKey: input.idempotencyKey,
      payload: {
        expectedRevisionNo: input.expectedRevisionNo,
        evidenceItems: input.evidenceItems,
      },
    }),
  updateMediaCandidates: (
    token: string,
    input: {
      sessionId: string;
      idempotencyKey: string;
      expectedRevisionNo: number;
      candidatePasses: MultimodalCandidatePasses;
    },
  ) =>
    mediaActionRequest<MediaMutationResult>(token, 'skill.media.candidate.update', {
      sessionId: input.sessionId,
      idempotencyKey: input.idempotencyKey,
      payload: {
        expectedRevisionNo: input.expectedRevisionNo,
        candidatePasses: input.candidatePasses,
      },
    }),
  confirmMediaOverview: (
    token: string,
    input: {
      sessionId: string;
      idempotencyKey: string;
      expectedRevisionNo: number;
      title: string;
      userNotes: string;
    },
  ) =>
    mediaActionRequest<MediaConfirmationResult>(
      token,
      'skill.media.overview.confirm',
      {
        sessionId: input.sessionId,
        idempotencyKey: input.idempotencyKey,
        payload: {
          expectedRevisionNo: input.expectedRevisionNo,
          overview: {
            title: input.title,
            approved: true,
            userNotes: input.userNotes,
          },
        },
      },
    ),
  confirmMediaCandidates: (
    token: string,
    input: {
      sessionId: string;
      idempotencyKey: string;
      expectedRevisionNo: number;
      selectedCandidateIds: string[];
    },
  ) =>
    mediaActionRequest<MediaConfirmationResult>(
      token,
      'skill.media.candidate.confirm',
      {
        sessionId: input.sessionId,
        idempotencyKey: input.idempotencyKey,
        payload: {
          expectedRevisionNo: input.expectedRevisionNo,
          selectedCandidateIds: input.selectedCandidateIds,
        },
      },
    ),
  startMediaArenaTest: (
    token: string,
    input: {
      sessionId: string;
      idempotencyKey: string;
      expectedRevisionNo: number;
    },
  ) =>
    mediaActionRequest<MediaArenaTestResult>(token, 'skill.media.test.start', {
      sessionId: input.sessionId,
      idempotencyKey: input.idempotencyKey,
      payload: { expectedRevisionNo: input.expectedRevisionNo },
    }),
  confirmGeneratedMediaSkills: (
    token: string,
    input: {
      sessionId: string;
      idempotencyKey: string;
      expectedRevisionNo: number;
      targetPackageId: string | null;
      expectedPackageVersionId: string | null;
    },
  ) =>
    mediaActionRequest<MediaPublishResult>(token, 'skill.media.generate.confirm', {
      sessionId: input.sessionId,
      idempotencyKey: input.idempotencyKey,
      payload: {
        expectedRevisionNo: input.expectedRevisionNo,
        targetPackageId: input.targetPackageId,
        expectedPackageVersionId: input.expectedPackageVersionId,
      },
    }),
  publishMediaSkillPack: (
    token: string,
    input: {
      sessionId: string;
      idempotencyKey: string;
      expectedRevisionNo: number;
      targetPackageId: string | null;
      expectedPackageVersionId: string | null;
    },
  ) =>
    mediaActionRequest<MediaPublishResult>(token, 'skill.media.publish', {
      sessionId: input.sessionId,
      idempotencyKey: input.idempotencyKey,
      payload: {
        expectedRevisionNo: input.expectedRevisionNo,
        targetPackageId: input.targetPackageId,
        expectedPackageVersionId: input.expectedPackageVersionId,
      },
    }),
  listGuidedCreations: (token: string, payload: GuidedCreationListPayload = {}) =>
    guidedActionRequest<{
      items: GuidedCreationSession[];
      next_cursor: string | null;
    }>(token, 'SkillGuidedCreationList', payload as unknown as Record<string, unknown>),
  getGuidedCreationDetail: (
    token: string,
    payload: GuidedCreationDetailPayload,
  ) =>
    guidedActionRequest<GuidedCreationSessionDetail>(
      token,
      'SkillGuidedCreationDetail',
      payload as unknown as Record<string, unknown>,
    ),
  getMediaSessionDetail: (
    token: string,
    payload: {
      sessionId: string;
    },
  ) =>
    guidedActionRequest<MediaSessionDetail>(
      token,
      'skill.media.session.detail',
      payload as unknown as Record<string, unknown>,
    ),
  getMediaProgress: (
    token: string,
    payload: {
      sessionId: string;
    },
  ) =>
    guidedActionRequest<MediaSessionProgress>(
      token,
      'skill.media.progress',
      payload as unknown as Record<string, unknown>,
    ),
  cancelGuidedCreation: (
    token: string,
    payload: GuidedCreationCancelPayload,
  ) =>
    guidedActionRequest<GuidedCreationSessionDetail>(
      token,
      'SkillGuidedCreationCancel',
      payload as unknown as Record<string, unknown>,
    ),
  renameGuidedCreation: (
    token: string,
    payload: GuidedCreationRenamePayload,
  ) =>
    guidedActionRequest<GuidedCreationSessionDetail>(
      token,
      'SkillGuidedCreationRename',
      payload as unknown as Record<string, unknown>,
    ),
  deleteGuidedCreation: (
    token: string,
    payload: GuidedCreationDeletePayload,
  ) =>
    guidedActionRequest<{ id: string; deleted_at: string }>(
      token,
      'SkillGuidedCreationDelete',
      payload as unknown as Record<string, unknown>,
    ),
  startGuidedCreationStream: (
    token: string,
    payload: GuidedCreationStartPayload,
    onEvent: (event: GuidedCreationSseEvent) => void,
  ) =>
    guidedStreamRequest(
      token,
      'SkillGuidedCreationStart',
      payload as unknown as Record<string, unknown>,
      onEvent,
    ),
  sendGuidedCreationMessageStream: (
    token: string,
    payload: GuidedCreationMessagePayload,
    onEvent: (event: GuidedCreationSseEvent) => void,
  ) =>
    guidedStreamRequest(
      token,
      'SkillGuidedCreationMessage',
      payload as unknown as Record<string, unknown>,
      onEvent,
    ),
  confirmGuidedCreationStream: (
    token: string,
    payload: GuidedCreationConfirmPayload,
    onEvent: (event: GuidedCreationSseEvent) => void,
  ) =>
    guidedStreamRequest(
      token,
      'SkillGuidedCreationConfirm',
      payload as unknown as Record<string, unknown>,
      onEvent,
    ),
  streamMediaProgress: (
    token: string,
    payload: {
      sessionId: string;
    },
    onEvent: (event: MediaProgressSseEvent) => void,
    signal?: AbortSignal,
  ) =>
    guidedStreamRequest(
      token,
      'skill.media.progress.stream',
      payload as unknown as Record<string, unknown>,
      onEvent,
      signal,
    ),
  me: (token: string) => request<UserSummary>('/auth/me', {}, token),
  listPackages: (token: string) =>
    request<AgentPackageSummary[]>(PACKAGE_ROUTES.LIST, {}, token),
  getPackage: (token: string, packageId: string) =>
    request<AgentPackageDetail>(
      `${PACKAGE_ROUTES.DETAIL}?packageId=${encodeURIComponent(packageId)}`,
      {},
      token,
    ),
  renamePackage: (token: string, packageId: string, name: string) =>
    request<AgentPackageDetail>(
      `/packages/${packageId}`,
      { method: 'PATCH', body: JSON.stringify({ name }) },
      token,
    ),
  saveManualMarkdownEdit: (
    token: string,
    packageId: string,
    data: {
      target: 'agent' | 'rubric' | 'skill';
      content: string;
      skillId?: string;
      note?: string;
    },
  ) =>
    request<AgentPackageDetail>(
      `/packages/${packageId}/manual-edit`,
      { method: 'POST', body: JSON.stringify(data) },
      token,
    ),
  repairRubric: (token: string, packageId: string, model?: string) =>
    request<AgentPackageDetail>(
      `/packages/${packageId}/rubric/repair`,
      { method: 'POST', body: JSON.stringify({ model }) },
      token,
    ),
  optimizeRubric: (token: string, packageId: string, model?: string) =>
    request<AgentPackageDetail>(
      `/packages/${packageId}/rubric/optimize`,
      { method: 'POST', body: JSON.stringify({ model }) },
      token,
    ),
  listVersions: (token: string, packageId: string) =>
    request<PackageVersion[]>(`/packages/${packageId}/versions`, {}, token),
  listPackageSkills: (
    token: string,
    packageId: string,
    includeRemoved = true,
  ) =>
    actionRequest<PackageSkillRecord[]>(token, 'skill.list', packageId, {
      includeRemoved,
    }),
  renameSkill: (
    token: string,
    packageId: string,
    skillId: string,
    displayName: string,
  ) =>
    actionRequest<PackageSkillRecord>(token, 'skill.rename', packageId, {
      skillId,
      displayName,
    }),
  listSkillVersions: (
    token: string,
    packageId: string,
    skillId: string,
    options?: {
      includeDiscarded?: boolean;
      cursor?: string;
      limit?: number;
    },
  ) =>
    actionRequest<SkillVersionListResult>(
      token,
      'skill.version.list',
      packageId,
      {
        skillId,
        includeDiscarded: options?.includeDiscarded,
        cursor: options?.cursor,
        limit: options?.limit,
      },
    ),
  getSkillVersionDetail: (token: string, packageId: string, versionId: string) =>
    actionRequest<SkillVersionDetail>(
      token,
      'skill.version.detail',
      packageId,
      { versionId },
    ),
  rollbackSkillVersion: (
    token: string,
    packageId: string,
    payload: RollbackSkillVersionPayload,
  ) =>
    actionRequest<{
      packageId: string;
      packageVersionId: string;
      versionNumber: number;
      rolledBackSkillVersionId: string;
    }>(token, 'skill.version.rollback', packageId, payload),
  rollbackPackageVersion: (
    token: string,
    packageId: string,
    payload: {
      versionId: string;
      expectedPackageVersionId: string;
      idempotencyKey: string;
      note?: string;
    },
  ) =>
    actionRequest<{
      packageId: string;
      packageVersionId: string;
      versionNumber: number;
      rolledBackPackageVersionId: string;
      rolledBackFromVersionNumber: number;
    }>(token, 'package.version.rollback', packageId, payload),
  discardSkillVersion: (
    token: string,
    packageId: string,
    versionId: string,
    reason: string,
  ) =>
    actionRequest<SkillVersionDetail>(
      token,
      'skill.version.discard',
      packageId,
      { versionId, reason },
    ),
  undiscardSkillVersion: (token: string, packageId: string, versionId: string) =>
    actionRequest<SkillVersionDetail>(
      token,
      'skill.version.undiscard',
      packageId,
      { versionId },
    ),
  generatePackageStream: (
    token: string,
    instruction: string,
    model: string | undefined,
    documents: Array<{ name: string; content: string }>,
    onEvent: (event: PackageGenerateStreamEvent) => void,
  ) =>
    streamRequest<PackageGenerateStreamEvent>(
      '/packages/generate/stream',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction, model, documents }),
      },
      token,
      onEvent,
    ),
  deletePackage: (token: string, packageId: string) =>
    request<{ ok: boolean }>(
      `/packages/${packageId}`,
      { method: 'DELETE' },
      token,
    ),
  batchDeleteSkills: (token: string, skillIds: string[]) =>
    request<{ deletedSkillIds: string[]; deletedCount: number }>(
      '/skills/batch-delete',
      { method: 'POST', body: JSON.stringify({ skillIds }) },
      token,
    ),
  listRepositorySkills: (
    token: string,
    options?: { cursor?: string; limit?: number },
  ) => {
    const query = new URLSearchParams();
    if (options?.cursor) query.set('cursor', options.cursor);
    if (options?.limit !== undefined) {
      query.set('limit', String(options.limit));
    }
    const suffix = query.size > 0 ? `?${query.toString()}` : '';
    return request<RepositorySkillPage>(
      `/skills/repository${suffix}`,
      {},
      token,
    );
  },
  listThreads: (token: string, packageId: string) =>
    request<ArenaThread[]>(
      `${ARENA_ROUTES.THREADS}?packageId=${encodeURIComponent(packageId)}`,
      {},
      token,
    ),
  listThreadPage: (
    token: string,
    options: {
      packageId: string;
      skillId?: string;
      cursor?: string;
      limit?: number;
    },
  ) => {
    const query = new URLSearchParams({ packageId: options.packageId });
    if (options.skillId) query.set('skillId', options.skillId);
    if (options.cursor) query.set('cursor', options.cursor);
    if (options.limit !== undefined) query.set('limit', String(options.limit));
    return request<ArenaThreadPage>(
      `/arena/threads/page?${query.toString()}`,
      {},
      token,
    );
  },
  createThread: (token: string, packageId: string, model?: string) =>
    request<ArenaThread>(
      ARENA_ROUTES.CREATE_THREAD,
      { method: 'POST', body: JSON.stringify({ packageId, model }) },
      token,
    ),
  createArenaThread: (
    token: string,
    packageId: string,
    payload: {
      idempotencyKey: string;
      basePackageVersionId: string;
      left: SkillArenaSelectionPayload | null;
      right: SkillArenaSelectionPayload | null;
      model?: string;
      surface?: 'run' | 'test' | 'arena' | 'optimize';
    },
  ) =>
    actionRequest<ArenaThread>(token, 'arena.thread.create', packageId, {
      arenaKind: 'skill_arena',
      idempotencyKey: payload.idempotencyKey,
      basePackageVersionId: payload.basePackageVersionId,
      left: payload.left,
      right: payload.right,
      model: payload.model,
      surface: payload.surface,
    }),
  getThread: (token: string, threadId: string) =>
    request<ArenaThreadDetail>(
      `${ARENA_ROUTES.THREAD_DETAIL}?threadId=${encodeURIComponent(threadId)}`,
      {},
      token,
    ),
  getArenaThreadDetail: (token: string, packageId: string, threadId: string) =>
    actionRequest<ArenaThreadDetail>(token, 'arena.thread.detail', packageId, {
      threadId,
    }),
  renameArenaThread: (token: string, packageId: string, threadId: string, title: string) =>
    actionRequest<ArenaThread>(token, 'arena.thread.rename', packageId, {
      threadId,
      title,
    }),
  deleteArenaThread: (token: string, packageId: string, threadId: string) =>
    actionRequest<{ ok: boolean }>(token, 'arena.thread.delete', packageId, {
      threadId,
    }),
  sendMessageStream: (
    token: string,
    threadId: string,
    content: string,
    model: string | undefined,
    mode: ArenaMode,
    thinkingEnabled: boolean,
    onEvent: (event: ArenaMessageStreamEvent) => void,
    signal?: AbortSignal,
  ) =>
    streamRequest<ArenaMessageStreamEvent>(
      `${ARENA_ROUTES.MESSAGE_STREAM}?threadId=${encodeURIComponent(threadId)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, model, mode, thinkingEnabled }),
        signal,
      },
      token,
      onEvent,
    ),
  generateReportStream: (
    token: string,
    threadId: string,
    model: string | undefined,
    onEvent: (event: ReportStreamEvent) => void,
  ) =>
    streamRequest<ReportStreamEvent>(
      `/arena/threads/${threadId}/report/stream`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      },
      token,
      onEvent,
    ),
  optimizePackageStream: (
    token: string,
    packageId: string,
    threadId: string,
    model: string | undefined,
    onEvent: (event: OptimizeStreamEvent) => void,
  ) =>
    streamRequest<OptimizeStreamEvent>(
      `/packages/${packageId}/optimize/stream`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId, model }),
      },
      token,
      onEvent,
    ),
  async importPackage(token: string, file: File): Promise<AgentPackageDetail> {
    const formData = new FormData();
    formData.append('file', file, file.name);
    const response = await apiFetch(`/api/packages/import`, {
      method: 'POST',
      body: formData,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!response.ok) {
      const body = await response
        .json()
        .catch(() => ({ error: `HTTP ${response.status}` }));
      throw new Error(body.error || `HTTP ${response.status}`);
    }
    return response.json();
  },
  diagnosePackage: (
    token: string,
    packageId: string,
    threadId: string,
    model?: string,
    targetSkillDirName?: string,
  ) =>
    request<DiagnosisResult & { session?: InteractiveOptimizationSession }>(
      `/packages/${packageId}/optimize/diagnose`,
      { method: 'POST', body: JSON.stringify({ threadId, model, targetSkillDirName }) },
      token,
    ),
  listInteractiveSessions: (token: string, packageId: string) =>
    request<InteractiveOptimizationSession[]>(
      `/packages/${packageId}/optimize/sessions`,
      {},
      token,
    ),
  chatOptimize: (
    token: string,
    packageId: string,
    sessionId: string | undefined,
    messages: Array<{ role: string; content: string }>,
    adoptedChanges: AdoptedChange[],
    model?: string,
    targetSkillDirName?: string,
  ) =>
    request<ChatOptimizeResult>(
      `/packages/${packageId}/optimize/chat`,
      {
        method: 'POST',
        body: JSON.stringify({ sessionId, messages, adoptedChanges, model, targetSkillDirName }),
      },
      token,
    ),
  applyInteractiveChanges: (
    token: string,
    packageId: string,
    sessionId: string | undefined,
    changes: AdoptedChange[],
    note?: string,
    targetSkillDirName?: string,
  ) =>
    request<{ versionId: string; versionNumber: number }>(
      `/packages/${packageId}/optimize/apply`,
      { method: 'POST', body: JSON.stringify({ sessionId, changes, note, targetSkillDirName }) },
      token,
    ),
  createFeedbackOptimization: (
    token: string,
    packageId: string,
    data: {
      threadId?: string;
      turnIndex?: number;
      userQuestion?: string;
      agentAnswer?: string;
      baselineAnswer?: string;
      userFeedback: string;
      targetSkillId?: string;
      model?: string;
    },
  ) =>
    request<FeedbackOptimizationResult>(
      `/packages/${packageId}/optimize/feedback`,
      { method: 'POST', body: JSON.stringify(data) },
      token,
    ),
  testFeedbackOptimizationDraft: (
    token: string,
    packageId: string,
    data: {
      draftSnapshot: AgentPackageSnapshot;
      userQuestion: string;
      model?: string;
    },
  ) =>
    request<{ optimizedAnswer: string }>(
      `/packages/${packageId}/optimize/test-draft`,
      { method: 'POST', body: JSON.stringify(data) },
      token,
    ),
  applyFeedbackOptimizationDraft: (
    token: string,
    packageId: string,
    data: {
      draftSnapshot: AgentPackageSnapshot;
      changeSummary?: string;
    },
  ) =>
    request<{
      versionId: string;
      versionNumber: number;
      package: AgentPackageDetail;
    }>(`/packages/${packageId}/optimize/apply-draft`, {
      method: 'POST',
      body: JSON.stringify(data),
    }, token),
  compareVersions: (
    token: string,
    packageId: string,
    baseVersionId: string,
    targetVersionId: string,
    model?: string,
  ) =>
    request<VersionCompareResult>(
      `/packages/${packageId}/versions/compare`,
      {
        method: 'POST',
        body: JSON.stringify({ baseVersionId, targetVersionId, model }),
      },
      token,
    ),
  updateVersionNote: (
    token: string,
    packageId: string,
    versionId: string,
    note: string,
  ) =>
    request<PackageVersion>(
      `/packages/${packageId}/versions/${versionId}/note`,
      { method: 'POST', body: JSON.stringify({ note }) },
      token,
    ),
  async exportPackage(token: string, packageId: string): Promise<void> {
    const response = await apiFetch(`/api/packages/${packageId}/export`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!response.ok) {
      const body = await response
        .json()
        .catch(() => ({ error: `HTTP ${response.status}` }));
      throw new Error(body.error || `HTTP ${response.status}`);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${packageId}.zip`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },
};

export { LiteApiError };
