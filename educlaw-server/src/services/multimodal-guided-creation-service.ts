import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  parseMediaJobRecord,
  parseMultimodalSessionState,
  type MediaJobRecord,
  type MediaJobStatus,
  type MediaJobType,
  type MediaOperationReceipt,
  type MultimodalCandidatePasses,
  type MultimodalEvidence,
  type MultimodalTranscriptSegment,
  type MultimodalSessionState,
  type PersistedMultimodalPendingUpload,
  type PersistedUploadingMultipartPendingUpload,
  type PersistedUploadingSinglePutPendingUpload,
  type PublicMultimodalPendingUpload,
  type PublicMultimodalSessionState,
  type MultimodalUploadMode,
} from '@educlaw/shared';
import type { GuidedCreationStatus } from '@educlaw/shared';
import { config } from '../config.js';
import { readObjectStorageConfig } from '../config/object-storage-config.js';
import { query, withTransaction, type Queryable } from './db.js';
import {
  createObjectStorageService,
} from './object-storage/object-storage.service.js';
import type {
  MediaConfirmationStage,
  MediaStage,
} from './media-session-state-machine.js';
import {
  assertMediaStageGate,
  assertMediaEditReset,
  assertMediaStageTransition,
  assertResumeFromFailed,
  canCancelMediaStage,
  getGuidedCreationStatusForMediaStage,
} from './media-session-state-machine.js';
import { GuidedCreationError } from './guided-creation-service.js';
import type { MultimodalArenaEvaluation } from './arena-service.js';
import {
  readMultimodalReleaseStatus,
  type PublicMultimodalPublishedPackage,
} from './multimodal-release-service.js';
import { createMultimodalJobService } from './multimodal-job-service.js';
import {
  createMultimodalPipelineStore,
  type MultimodalPipelineStore,
} from './multimodal-pipeline-store.js';
import {
  parseMediaQualityCheckJobInputManifest,
  parseMediaQualityCheckOutputManifest,
} from './media-quality-check-contract.js';
import {
  createUploadSecurityService,
  UploadSecurityError,
} from './upload-security.service.js';

const SESSION_STATUSES = [
  'collecting',
  'ready_for_confirmation',
  'finalizing',
  'completed',
  'failed',
  'cancelled',
] as const;
const CREATION_MODE = 'multimodal_distill';
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;
const MEDIA_STAGES = [
  'draft',
  'uploading',
  'ready_to_process',
  'preparing_media',
  'transcribing',
  'reviewing_transcript',
  'building_semantic_windows',
  'building_evidence',
  'building_adler',
  'awaiting_adler_overview',
  'extracting_candidates',
  'validating_candidates',
  'awaiting_candidates',
  'building_skills',
  'arena_testing',
  'ready_to_publish',
  'publishing',
  'published',
  'failed',
  'cancelled',
] as const satisfies readonly MediaStage[];
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const SAFE_CANDIDATE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const POSITIVE_INTEGER_ID = /^[1-9]\d*$/;
const MIN_MULTIPART_PART_SIZE_BYTES = 5 * 1024 * 1024;
const RETRYABLE_AFTER_WORKER_UPGRADE = new Set([
  'media_prepare:VISUAL_SIGNAL_DETECT_FAILED',
  'transcribe:WORKER_LEASE_EXPIRED',
  'transcribe:OBJECT_STORAGE_WRITE_FAILED',
  'frame_materialize:FRAME_MATERIALIZE_FAILED',
  'frame_materialize:DATA_INTEGRITY_ERROR',
]);
const CONFIRMED_STAGES = [
  'adler_overview',
  'evidence_and_candidates',
  'publish',
] as const satisfies readonly MediaConfirmationStage[];
type HumanConfirmAction = 'skill.media.overview.confirm' | 'skill.media.candidate.confirm';
type MediaEditAction =
  | 'skill.media.transcript.update'
  | 'skill.media.evidence.update'
  | 'skill.media.candidate.update';

type SessionStatus = (typeof SESSION_STATUSES)[number];
type UploadMode = MultimodalUploadMode;
type HumanConfirmReceipt = MediaOperationReceipt & {
  action: HumanConfirmAction;
  confirmedStage: 'adler_overview' | 'evidence_and_candidates';
};
type UploadConfirmReceipt = MediaOperationReceipt & {
  action: 'skill.media.upload.confirm';
  confirmedStage: 'uploading';
};
type UploadingPendingUpload =
  | PersistedUploadingSinglePutPendingUpload
  | PersistedUploadingMultipartPendingUpload;
type UploadConfirmPreflight =
  | { kind: 'replay'; result: MultimodalUploadConfirmResult }
  | { kind: 'execute'; pendingUpload: UploadingPendingUpload };
type ObjectStorageService = ReturnType<typeof createObjectStorageService>;
type UploadSecurityService = ReturnType<typeof createUploadSecurityService>;

export class MultimodalGuidedCreationServiceError extends GuidedCreationError {}

export interface MultimodalSessionSummary {
  sessionId: string;
  displayName: string;
  status: GuidedCreationStatus;
  mediaStage: MediaStage;
  revisionNo: number;
  createdAt: string;
  updatedAt: string;
}

export interface MultimodalSessionDetail extends MultimodalSessionSummary {
  mediaState: PublicMultimodalSessionState;
  error: PublicMultimodalPipelineError | null;
  arenaEvaluation?: MultimodalArenaEvaluation | null;
  publishedPackage?: PublicMultimodalPublishedPackage | null;
}

export interface PublicMultimodalPipelineError {
  code: string;
  stage: MediaStage;
  resumeStage: MediaStage;
  retryable: boolean;
  message: string;
}

export interface SinglePutUploadIntentResult {
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

export interface MultipartUploadIntentResult {
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
}

export type MultimodalUploadIntentResult =
  | SinglePutUploadIntentResult
  | MultipartUploadIntentResult;

export interface MultimodalUploadConfirmResult {
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

export interface ServerPendingUploadBinding {
  sessionId: string;
  revisionNo: number;
  objectKey: string;
  uploadMode: UploadMode;
  fileName: string;
  declaredMimeType: string;
  sizeBytes: number;
}

export interface PersistedMediaQualityCheckReceipt {
  sessionId: string;
  revisionNo: number;
  mediaStage: MediaStage;
  jobId: string;
  jobStatus: MediaJobStatus;
  expectedSizeBytes: number;
  expectedContentType: string;
}

export interface MultimodalSessionProgress extends MultimodalSessionSummary {
  currentJob: {
    jobId: string;
    jobType: MediaJobType;
    status: MediaJobStatus;
    percent: number | null;
    hint: string | null;
  } | null;
}

export interface MultimodalSessionConfirmationResult {
  sessionId: string;
  revisionNo: number;
  mediaStage: MediaStage;
  confirmedStage: 'adler_overview' | 'evidence_and_candidates';
  replayed: boolean;
}

export interface MultimodalSessionMutationResult {
  sessionId: string;
  revisionNo: number;
  mediaStage: MediaStage;
  invalidatedFrom: 'semantic_moments' | 'adler_overview' | 'candidate_validation';
  replayed: boolean;
}

interface PersistedMultimodalSessionDetail extends MultimodalSessionSummary {
  mediaState: MultimodalSessionState;
}

interface SessionRow {
  id: unknown;
  display_name: unknown;
  status: unknown;
  creation_mode: unknown;
  media_stage: unknown;
  media_state_json: unknown;
  confirmed_stages_json?: unknown;
  revision_no: unknown;
  start_request_hash?: unknown;
  package_version_id?: unknown;
  validation_result_json?: unknown;
  confirmation_json?: unknown;
  error_json?: unknown;
  deleted_at?: unknown;
  created_at: unknown;
  updated_at: unknown;
}

type ProcessingUnderstandingMode = 'auto' | 'nativeVideo' | 'compatible';
type ProcessingTranscriptionMode = 'deploymentDefault';

export interface MultimodalProcessStartResult {
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

export interface MultimodalRetryResult {
  sessionId: string;
  revisionNo: number;
  mediaStage: MediaStage;
  retriedJobId: string | null;
  job: { jobId: string; jobType: string; status: string; attemptNo: number } | null;
  replayed: boolean;
}

interface JobRow {
  id: unknown;
  session_id: unknown;
  job_type: unknown;
  status: unknown;
  idempotency_key: unknown;
  request_hash: unknown;
  attempt_no: unknown;
  max_attempts: unknown;
  progress_json: unknown;
  input_manifest_json: unknown;
  output_manifest_json: unknown;
  result_hash: unknown;
  error_json: unknown;
}

interface OwnedJobRow extends JobRow {
  revision_no: unknown;
  media_stage: unknown;
}

interface ServiceDependencies {
  query?: typeof query;
  withTransaction?: typeof withTransaction;
  now?: () => Date;
  objectStorageService?: ObjectStorageService | null;
  uploadSecurityService?: UploadSecurityService;
  uploadTokenSecret?: string | null;
  createSourceId?: () => string;
  createMediaJobInTransaction?: (input: {
    db: Queryable;
    sessionId: string;
    jobType: MediaJobType;
    idempotencyKey: string;
    requestHash: string;
    inputManifest: unknown;
    maxAttempts?: number;
  }) => Promise<{ jobId: string; jobType: string; status: string; attemptNo: number }>;
  pipelineFailureResumer?: Pick<MultimodalPipelineStore, 'resumePipelineFailure'>;
  multimodalUploadMaxBytes?: number;
  multimodalSinglePutMaxBytes?: number;
  multimodalMultipartPartBytes?: number;
}

function fail(
  code: string,
  message: string,
  statusCode: number,
  retryable = false,
): never {
  throw new MultimodalGuidedCreationServiceError(
    code,
    message,
    statusCode,
    retryable,
  );
}

function normalizeDisplayName(value: string): string {
  if (typeof value !== 'string') {
    fail('INVALID_DISPLAY_NAME', 'displayName 格式不正确', 422);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > 200) {
    fail('INVALID_DISPLAY_NAME', 'displayName 格式不正确', 422);
  }
  return normalized;
}

function normalizeIdempotencyKey(value: string): string {
  if (typeof value !== 'string' || !REQUEST_ID_PATTERN.test(value)) {
    fail('INVALID_IDEMPOTENCY_KEY', 'idempotencyKey 格式不正确', 422);
  }
  return value;
}

function normalizeSourceId(value: string): string {
  if (typeof value !== 'string' || !SAFE_CANDIDATE_ID_PATTERN.test(value)) {
    fail('MULTIMODAL_UPLOAD_UNAVAILABLE', '媒体上传暂时不可用，请稍后重试。', 503, true);
  }
  return value;
}

function normalizeUploadMode(value: unknown): UploadMode {
  if (value !== 'single_put' && value !== 'multipart') {
    fail('MULTIMODAL_UPLOAD_UNAVAILABLE', '媒体上传暂时不可用，请稍后重试。', 503, true);
  }
  return value;
}

function normalizeUploadTokenSecret(value: string | null | undefined): string {
  if (typeof value !== 'string' || value.length < 32) {
    fail('MULTIMODAL_UPLOAD_UNAVAILABLE', '媒体上传暂时不可用，请稍后重试。', 503, true);
  }
  return value;
}

function safeCompareHexHash(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) {
    return false;
  }
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function buildProcessStartRequestHash(input: {
  sessionId: string;
  expectedRevisionNo: number;
  inputManifest: Record<string, unknown>;
}): string {
  return sha256Hex(
    stableRequestHashJson({
      action: 'skill.media.process.start',
      sessionId: input.sessionId,
      expectedRevisionNo: input.expectedRevisionNo,
      inputManifest: input.inputManifest,
    }),
  );
}

function buildRetryRequestHash(input: {
  sessionId: string;
  failedJobId: string;
  jobType: MediaJobType;
  inputManifest: Record<string, unknown>;
}): string {
  return sha256Hex(
    stableRequestHashJson({
      action: 'skill.media.retry',
      sessionId: input.sessionId,
      failedJobId: input.failedJobId,
      jobType: input.jobType,
      inputManifest: input.inputManifest,
    }),
  );
}

function readProcessingPipelinePlan(inputManifest: Record<string, unknown>) {
  const value = inputManifest.pipelinePlan;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('MULTIMODAL_SESSION_FAILED', '媒体处理计划损坏', 500);
  }
  const plan = value as Record<string, unknown>;
  if (
    typeof plan.transcribe !== 'boolean' ||
    typeof plan.frameMaterialize !== 'boolean' ||
    typeof plan.visualOnly !== 'boolean'
  ) {
    fail('MULTIMODAL_SESSION_FAILED', '媒体处理计划损坏', 500);
  }
  return {
    transcribe: plan.transcribe,
    frameMaterialize: plan.frameMaterialize,
    visualOnly: plan.visualOnly,
  };
}

function toJobActionResult(job: MediaJobRecord) {
  return {
    jobId: job.id,
    jobType: job.jobType,
    status: job.status,
    attemptNo: job.attemptNo,
  };
}

function normalizeMultipartPartBytes(value: number): number {
  if (
    !Number.isInteger(value) ||
    value < MIN_MULTIPART_PART_SIZE_BYTES ||
    value > Number.MAX_SAFE_INTEGER
  ) {
    fail('MULTIMODAL_UPLOAD_UNAVAILABLE', '媒体上传暂时不可用，请稍后重试。', 503, true);
  }
  return value;
}

function buildMultipartPlan(input: {
  sizeBytes: number;
  partSizeBytes: number;
}): { partSizeBytes: number; partCount: number } {
  const partSizeBytes = normalizeMultipartPartBytes(input.partSizeBytes);
  const partCount = Math.ceil(input.sizeBytes / partSizeBytes);
  if (
    !Number.isInteger(partCount) ||
    partCount < 1 ||
    partCount > 10_000
  ) {
    fail('MULTIMODAL_UPLOAD_UNAVAILABLE', '媒体上传暂时不可用，请稍后重试。', 503, true);
  }
  return { partSizeBytes, partCount };
}

async function abortMultipartBestEffort(
  storage: ObjectStorageService,
  input: { objectKey: string; multipartUploadId: string },
): Promise<void> {
  try {
    await storage.abortIncompleteMultipartUpload(input);
  } catch {
    // best effort only
  }
}

type UploadIntentTokenBinding = {
  sessionId: string;
  authUserId: string;
  sourceId: string;
  objectKey: string;
  declaredMimeType: string;
  sizeBytes: number;
  uploadMode: MultimodalUploadMode;
  multipartUploadId?: string;
  partSizeBytes?: number;
  partCount?: number;
  intentRevisionNo: number;
};

function buildUploadIntentClaimsHash(binding: UploadIntentTokenBinding): string {
  return sha256Hex(
    stableRequestHashJson({
      sessionId: binding.sessionId,
      authUserId: binding.authUserId,
      sourceId: binding.sourceId,
      objectKey: binding.objectKey,
      declaredMimeType: binding.declaredMimeType,
      sizeBytes: binding.sizeBytes,
      uploadMode: binding.uploadMode,
      ...(binding.uploadMode === 'multipart'
        ? {
            multipartUploadId: binding.multipartUploadId,
            partSizeBytes: binding.partSizeBytes,
            partCount: binding.partCount,
          }
        : {}),
      intentRevisionNo: binding.intentRevisionNo,
    }),
  );
}

type UploadIntentTokenPayload = {
  v: 1;
  sid: string;
  rid: number;
  exp: string;
  ch: string;
};

function parseUploadIntentTokenPayload(value: unknown): UploadIntentTokenPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const payload = value as Record<string, unknown>;
  if (
    payload.v !== 1 ||
    typeof payload.sid !== 'string' ||
    !POSITIVE_INTEGER_ID.test(payload.sid) ||
    typeof payload.rid !== 'number' ||
    !Number.isInteger(payload.rid) ||
    payload.rid < 0 ||
    typeof payload.exp !== 'string' ||
    Number.isNaN(new Date(payload.exp).getTime()) ||
    typeof payload.ch !== 'string' ||
    !/^[a-f0-9]{64}$/.test(payload.ch)
  ) {
    return null;
  }
  return {
    v: 1,
    sid: payload.sid,
    rid: payload.rid,
    exp: payload.exp,
    ch: payload.ch,
  };
}

function issueUploadIntentToken(input: {
  secret: string;
  binding: UploadIntentTokenBinding;
  expiresAt: string;
}): string {
  const payload = stableRequestHashJson({
    v: 1,
    sid: input.binding.sessionId,
    rid: input.binding.intentRevisionNo,
    exp: input.expiresAt,
    ch: buildUploadIntentClaimsHash(input.binding),
  } satisfies UploadIntentTokenPayload);
  const signature = createHmac('sha256', input.secret)
    .update(payload, 'utf8')
    .digest('base64url');
  return `${Buffer.from(payload, 'utf8').toString('base64url')}.${signature}`;
}

function verifyUploadIntentToken(input: {
  token: string;
  secret: string;
  binding: UploadIntentTokenBinding;
  now?: () => Date;
}): boolean {
  if (typeof input.token !== 'string' || !input.token.includes('.')) {
    return false;
  }
  const [encodedPayload, encodedSignature, extra] = input.token.split('.');
  if (!encodedPayload || !encodedSignature || extra !== undefined) {
    return false;
  }
  try {
    const payloadJson = Buffer.from(encodedPayload, 'base64url').toString('utf8');
    const payload = parseUploadIntentTokenPayload(JSON.parse(payloadJson));
    if (!payload) {
      return false;
    }
    if (payload.sid !== input.binding.sessionId) {
      return false;
    }
    if (payload.rid !== input.binding.intentRevisionNo) {
      return false;
    }
    if (payload.ch !== buildUploadIntentClaimsHash(input.binding)) {
      return false;
    }
    if ((input.now ?? (() => new Date()))().getTime() >= new Date(payload.exp).getTime()) {
      return false;
    }
    const expectedSignature = createHmac('sha256', input.secret)
      .update(payloadJson, 'utf8')
      .digest();
    const actualSignature = Buffer.from(encodedSignature, 'base64url');
    return (
      expectedSignature.length === actualSignature.length &&
      timingSafeEqual(expectedSignature, actualSignature)
    );
  } catch {
    return false;
  }
}

function buildUploadIntentRequestHash(input: {
  sessionId: string;
  fileName: string;
  declaredMimeType: string;
  sizeBytes: number;
  mediaKind: 'video' | 'audio';
  serverManaged?: boolean;
}): string {
  return sha256Hex(
    stableRequestHashJson({
      action: 'skill.media.upload.intent',
      sessionId: input.sessionId,
      fileName: input.fileName,
      declaredMimeType: input.declaredMimeType,
      sizeBytes: input.sizeBytes,
      mediaKind: input.mediaKind,
      ...(input.serverManaged === true ? { serverManaged: true } : {}),
    }),
  );
}

function buildUploadConfirmRequestHash(input: {
  action: 'skill.media.upload.confirm';
  sessionId: string;
  sourceId: string;
  objectKey: string;
  declaredMimeType: string;
  sizeBytes: number;
  uploadMode: MultimodalUploadMode;
  intentRevisionNo: number;
  parts?: Array<{ partNumber: number; etag: string }>;
}): string {
  return sha256Hex(
    stableRequestHashJson({
      action: input.action,
      sessionId: input.sessionId,
      sourceId: input.sourceId,
      objectKey: input.objectKey,
      declaredMimeType: input.declaredMimeType,
      sizeBytes: input.sizeBytes,
      uploadMode: input.uploadMode,
      intentRevisionNo: input.intentRevisionNo,
      parts: input.parts ?? null,
    }),
  );
}

function normalizeUploadIntentRequestIdentity(input: {
  fileName: string;
  declaredMimeType: string;
  sizeBytes: number;
}): {
  fileName: string;
  declaredMimeType: string;
  sizeBytes: number;
  mediaKind: 'video' | 'audio';
} {
  if (
    typeof input.fileName !== 'string' ||
    typeof input.declaredMimeType !== 'string'
  ) {
    fail('INVALID_UPLOAD_INTENT', '上传文件参数不合法', 422);
  }
  const fileName = input.fileName;
  const declaredMimeType = input.declaredMimeType.trim().toLowerCase();
  const mediaKind = declaredMimeType.startsWith('audio/')
    ? 'audio'
    : declaredMimeType.startsWith('video/')
      ? 'video'
      : null;
  if (
    fileName.length === 0 ||
    fileName !== fileName.trim() ||
    declaredMimeType.length === 0 ||
    !Number.isSafeInteger(input.sizeBytes) ||
    input.sizeBytes <= 0 ||
    mediaKind == null
  ) {
    fail('INVALID_UPLOAD_INTENT', '上传文件参数不合法', 422);
  }
  return {
    fileName,
    declaredMimeType,
    sizeBytes: input.sizeBytes,
    mediaKind,
  };
}

function normalizeExpectedRevisionNo(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    fail('INVALID_ARGUMENT', 'expectedRevisionNo 必须是非负整数', 422);
  }
  return value;
}

function normalizeTranscriptSegmentUpdate(value: unknown): {
  segmentIndex: number;
  expectedSegmentRevisionNo: number;
  text: string;
  speaker: string | null;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_ARGUMENT', 'transcript update 格式不正确', 422);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== 4 ||
    !keys.includes('segmentIndex') ||
    !keys.includes('expectedSegmentRevisionNo') ||
    !keys.includes('text') ||
    !keys.includes('speaker')
  ) {
    fail('INVALID_ARGUMENT', 'transcript update 格式不正确', 422);
  }
  if (
    typeof record.segmentIndex !== 'number' ||
    !Number.isSafeInteger(record.segmentIndex) ||
    record.segmentIndex < 0 ||
    typeof record.expectedSegmentRevisionNo !== 'number' ||
    !Number.isSafeInteger(record.expectedSegmentRevisionNo) ||
    record.expectedSegmentRevisionNo < 0
  ) {
    fail('INVALID_ARGUMENT', 'segment revision 格式不正确', 422);
  }
  if (
    typeof record.text !== 'string' ||
    !record.text.trim() ||
    record.text.length > 16_384
  ) {
    fail('INVALID_ARGUMENT', 'segment text 格式不正确', 422);
  }
  if (
    record.speaker !== null &&
    (typeof record.speaker !== 'string' ||
      !record.speaker.trim() ||
      record.speaker.length > 256)
  ) {
    fail('INVALID_ARGUMENT', 'segment speaker 格式不正确', 422);
  }
  return {
    segmentIndex: record.segmentIndex,
    expectedSegmentRevisionNo: record.expectedSegmentRevisionNo,
    text: record.text.trim(),
    speaker: record.speaker === null ? null : record.speaker.trim(),
  };
}

function normalizeUnderstandingMode(value: unknown): ProcessingUnderstandingMode {
  if (value !== 'auto' && value !== 'nativeVideo' && value !== 'compatible') {
    fail('INVALID_ARGUMENT', 'understandingMode 不正确', 422);
  }
  return value;
}

function normalizeTranscriptionMode(value: unknown): ProcessingTranscriptionMode {
  if (value !== 'deploymentDefault') {
    fail('INVALID_ARGUMENT', 'transcriptionMode 不正确', 422);
  }
  return value;
}

function normalizeOverviewReviewInput(value: unknown): {
  title: string;
  approved: true;
  userNotes: string;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_ARGUMENT', 'overview 格式不正确', 422);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== 3 ||
    !keys.includes('title') ||
    !keys.includes('approved') ||
    !keys.includes('userNotes')
  ) {
    fail('INVALID_ARGUMENT', 'overview 格式不正确', 422);
  }
  if (record.approved !== true) {
    fail('INVALID_ARGUMENT', 'overview.approved 必须为 true', 422);
  }
  if (typeof record.title !== 'string') {
    fail('INVALID_ARGUMENT', 'overview.title 格式不正确', 422);
  }
  const title = normalizeDisplayName(record.title);
  if (typeof record.userNotes !== 'string' || record.userNotes.length > 2_000) {
    fail('INVALID_ARGUMENT', 'overview.userNotes 格式不正确', 422);
  }
  return {
    title,
    approved: true,
    userNotes: record.userNotes,
  };
}

function normalizeSelectedCandidateIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) {
    fail(
      'INVALID_ARGUMENT',
      'selectedCandidateIds 必须是 1 到 16 个候选 ID',
      422,
    );
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!(index in value)) {
      fail(
        'INVALID_ARGUMENT',
        'selectedCandidateIds 必须是稠密数组',
        422,
      );
    }
  }
  const selected = value.map((item, index) => {
    if (
      typeof item !== 'string' ||
      item.length === 0 ||
      item.length > 128 ||
      !SAFE_CANDIDATE_ID_PATTERN.test(item)
    ) {
      fail(
        'INVALID_ARGUMENT',
        `selectedCandidateIds[${index}] 必须是安全字符串 ID`,
        422,
      );
    }
    return item;
  });
  if (new Set(selected).size !== selected.length) {
    fail('INVALID_ARGUMENT', 'selectedCandidateIds 不能重复', 422);
  }
  return selected;
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_LIST_LIMIT;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_LIST_LIMIT
  ) {
    fail('INVALID_ARGUMENT', 'limit 必须是 1 到 100 的整数', 422);
  }
  return value;
}

function normalizeCursor(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) {
    fail('INVALID_ARGUMENT', 'cursor 格式不正确', 422);
  }
  const normalized = value.trim();
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    fail('INVALID_ARGUMENT', 'cursor 格式不正确', 422);
  }
  return normalized;
}

function safeString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    fail('MULTIMODAL_SESSION_FAILED', `${fieldName} 无效`, 500);
  }
  return value;
}

function positiveId(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    fail('INVALID_ARGUMENT', `${fieldName} 必须是正整数字符串`, 422);
  }
  return value;
}

function persistedPositiveId(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !POSITIVE_INTEGER_ID.test(value)) {
    fail('MULTIMODAL_SESSION_FAILED', `${fieldName} 无效`, 500);
  }
  return value;
}

function readRevisionNo(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    fail('MULTIMODAL_SESSION_FAILED', `${fieldName} 无效`, 500);
  }
  return value;
}

function readSessionStatus(value: unknown): SessionStatus {
  if (
    typeof value !== 'string' ||
    !SESSION_STATUSES.includes(value as SessionStatus)
  ) {
    fail('MULTIMODAL_SESSION_FAILED', 'status 无效', 500);
  }
  return value as SessionStatus;
}

function readMediaStage(value: unknown): MediaStage {
  if (
    typeof value !== 'string' ||
    !MEDIA_STAGES.includes(value as MediaStage)
  ) {
    fail('MULTIMODAL_SESSION_FAILED', 'mediaStage 无效', 500);
  }
  return value as MediaStage;
}

function readCreationMode(value: unknown): typeof CREATION_MODE {
  if (value !== CREATION_MODE) {
    fail('MULTIMODAL_SESSION_FAILED', 'creationMode 无效', 500);
  }
  return CREATION_MODE;
}

function asIso(value: unknown, fieldName: string): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'string' || !value.trim()) {
    fail('MULTIMODAL_SESSION_FAILED', `${fieldName} 无效`, 500);
  }
  return value;
}

function parseStoredJson(value: unknown, fieldName: string): unknown {
  try {
    if (typeof value === 'string') {
      return JSON.parse(value);
    }
    return structuredClone(value);
  } catch {
    fail('MULTIMODAL_SESSION_FAILED', `${fieldName} 无效`, 500);
  }
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, sortJson(item)]),
    );
  }
  return value;
}

export function stableRequestHashJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function buildMultimodalSessionCreateRequestHash(
  displayName: string,
): string {
  return sha256Hex(
    stableRequestHashJson({
      action: 'skill.media.session.create',
      creationMode: CREATION_MODE,
      displayName,
    }),
  );
}

function buildOverviewConfirmRequestHash(input: {
  sessionId: string;
  expectedRevisionNo: number;
  overview: { title: string; approved: true; userNotes: string };
}): string {
  return sha256Hex(
    stableRequestHashJson({
      action: 'skill.media.overview.confirm',
      sessionId: input.sessionId,
      expectedRevisionNo: input.expectedRevisionNo,
      overview: input.overview,
    }),
  );
}

function buildCandidateConfirmRequestHash(input: {
  sessionId: string;
  expectedRevisionNo: number;
  selectedCandidateIds: string[];
}): string {
  return sha256Hex(
    stableRequestHashJson({
      action: 'skill.media.candidate.confirm',
      sessionId: input.sessionId,
      expectedRevisionNo: input.expectedRevisionNo,
      selectedCandidateIds: input.selectedCandidateIds,
    }),
  );
}

function buildMediaEditRequestHash(input: {
  action: MediaEditAction;
  sessionId: string;
  expectedRevisionNo: number;
  mutation: unknown;
}): string {
  return sha256Hex(
    stableRequestHashJson({
      action: input.action,
      sessionId: input.sessionId,
      expectedRevisionNo: input.expectedRevisionNo,
      mutation: input.mutation,
    }),
  );
}

function buildInitialMediaState(): MultimodalSessionState {
  return parseMultimodalSessionState({
    schemaVersion: 1,
    primarySource: null,
    pendingUpload: null,
    transcript: {
      status: 'pending',
      editable: true,
      segments: [],
    },
    evidenceTimeline: {
      evidenceItems: [],
    },
    candidatePasses: {
      frameworks: [],
      principles: [],
      cases: [],
      counterexamples: [],
      terms: [],
    },
    candidatePassMeta: null,
    semanticMoments: [],
    degradations: [],
    adlerOverview: null,
    adlerOverviewReview: null,
    selectedCandidateIds: [],
    candidateValidations: [],
    candidateSkills: [],
    operationReceipts: [],
  });
}

let cachedObjectStorageService: ObjectStorageService | null | undefined;
let cachedUploadSecurityService: UploadSecurityService | undefined;
let cachedUploadTokenSecret: string | null | undefined;

function getObjectStorageService(): ObjectStorageService | null {
  if (cachedObjectStorageService !== undefined) {
    return cachedObjectStorageService;
  }
  const storageConfig = readObjectStorageConfig();
  cachedObjectStorageService = storageConfig
    ? createObjectStorageService({ config: storageConfig })
    : null;
  return cachedObjectStorageService;
}

function getUploadSecurityService(): UploadSecurityService {
  if (!cachedUploadSecurityService) {
    cachedUploadSecurityService = createUploadSecurityService({
      maxUploadBytes: config.multimodalUploadMaxBytes,
      maxRemoteBytes: config.multimodalUploadMaxBytes,
    });
  }
  return cachedUploadSecurityService;
}

function getUploadTokenSecret(): string | null {
  if (cachedUploadTokenSecret !== undefined) {
    return cachedUploadTokenSecret;
  }
  if (!config.mediaUploadTokenSecret) {
    cachedUploadTokenSecret = null;
    return cachedUploadTokenSecret;
  }
  cachedUploadTokenSecret = config.mediaUploadTokenSecret;
  return cachedUploadTokenSecret;
}

function toPublicPendingUpload(
  pendingUpload: PersistedMultimodalPendingUpload | null,
): PublicMultimodalPendingUpload | null {
  if (!pendingUpload) {
    return null;
  }
  if (
    pendingUpload.uploadMode === 'multipart' &&
    pendingUpload.materialStatus === 'uploading'
  ) {
    return {
      sourceId: pendingUpload.sourceId,
      mediaKind: pendingUpload.mediaKind,
      fileName: pendingUpload.fileName,
      declaredMimeType: pendingUpload.declaredMimeType,
      sizeBytes: pendingUpload.sizeBytes,
      uploadMode: 'multipart',
      materialStatus: 'uploading',
      expiresAt: pendingUpload.expiresAt,
      partSizeBytes: pendingUpload.partSizeBytes,
      partCount: pendingUpload.partCount,
    };
  }
  if (
    pendingUpload.uploadMode === 'multipart' &&
    pendingUpload.materialStatus === 'verifying'
  ) {
    return {
      sourceId: pendingUpload.sourceId,
      mediaKind: pendingUpload.mediaKind,
      fileName: pendingUpload.fileName,
      declaredMimeType: pendingUpload.declaredMimeType,
      sizeBytes: pendingUpload.sizeBytes,
      uploadMode: 'multipart',
      materialStatus: 'verifying',
      partSizeBytes: pendingUpload.partSizeBytes,
      partCount: pendingUpload.partCount,
      verification: {
        jobId: pendingUpload.verification.jobId,
        observedSizeBytes: pendingUpload.verification.observedSizeBytes,
        observedContentType: pendingUpload.verification.observedContentType,
        confirmedAt: pendingUpload.verification.confirmedAt,
      },
    };
  }
  if (pendingUpload.materialStatus === 'uploading') {
    return {
      sourceId: pendingUpload.sourceId,
      mediaKind: pendingUpload.mediaKind,
      fileName: pendingUpload.fileName,
      declaredMimeType: pendingUpload.declaredMimeType,
      sizeBytes: pendingUpload.sizeBytes,
      uploadMode: 'single_put',
      materialStatus: 'uploading',
      expiresAt: pendingUpload.expiresAt,
    };
  }
  return {
    sourceId: pendingUpload.sourceId,
    mediaKind: pendingUpload.mediaKind,
    fileName: pendingUpload.fileName,
    declaredMimeType: pendingUpload.declaredMimeType,
    sizeBytes: pendingUpload.sizeBytes,
    uploadMode: 'single_put',
    materialStatus: 'verifying',
    verification: {
      jobId: pendingUpload.verification.jobId,
      observedSizeBytes: pendingUpload.verification.observedSizeBytes,
      observedContentType: pendingUpload.verification.observedContentType,
      confirmedAt: pendingUpload.verification.confirmedAt,
    },
  };
}

function toPublicSessionState(
  state: MultimodalSessionState,
): PublicMultimodalSessionState {
  return {
    ...state,
    pendingUpload: toPublicPendingUpload(state.pendingUpload),
  };
}

function collectReferencedAssetKeys(state: PublicMultimodalSessionState): Set<string> {
  const keys = new Set<string>();
  const add = (objectKey: string | undefined | null) => {
    if (objectKey) keys.add(objectKey);
  };
  add(state.primarySource?.assetRef.objectKey);
  for (const evidence of state.evidenceTimeline.evidenceItems) {
    add(evidence.assetRef?.objectKey);
    add(evidence.source.relatedAssetRef?.objectKey);
  }
  return keys;
}

function parseSessionState(value: unknown): MultimodalSessionState {
  try {
    return parseMultimodalSessionState(parseStoredJson(value, 'mediaState'));
  } catch {
    fail('MULTIMODAL_SESSION_FAILED', '媒体会话状态损坏', 500);
  }
}

function parseConfirmedStages(value: unknown): MediaConfirmationStage[] {
  const parsed = parseStoredJson(value, 'confirmedStages');
  if (!Array.isArray(parsed)) {
    fail('MULTIMODAL_SESSION_FAILED', 'confirmedStages 损坏', 500);
  }
  const stages = parsed.map((item) => {
    if (
      typeof item !== 'string' ||
      !CONFIRMED_STAGES.includes(item as MediaConfirmationStage)
    ) {
      fail('MULTIMODAL_SESSION_FAILED', 'confirmedStages 损坏', 500);
    }
    return item as MediaConfirmationStage;
  });
  if (new Set(stages).size !== stages.length) {
    fail('MULTIMODAL_SESSION_FAILED', 'confirmedStages 损坏', 500);
  }
  let previousIndex = -1;
  for (const stage of stages) {
    const index = CONFIRMED_STAGES.indexOf(stage);
    if (index <= previousIndex) {
      fail('MULTIMODAL_SESSION_FAILED', 'confirmedStages 顺序非法', 500);
    }
    previousIndex = index;
  }
  return stages;
}

function parseSessionRowForMutation(row: SessionRow) {
  const detail = mapSessionRowInternal(row);
  const confirmedStages = parseConfirmedStages(row.confirmed_stages_json ?? []);
  const receiptStages = detail.mediaState.operationReceipts
    .filter((receipt) => (CONFIRMED_STAGES as readonly string[]).includes(receipt.confirmedStage))
    .map((receipt) => receipt.confirmedStage);
  const expectedReceiptStages = confirmedStages.filter(
    (stage) => stage !== 'publish',
  );
  if (
    receiptStages.length !== expectedReceiptStages.length ||
    receiptStages.some((stage, index) => stage !== expectedReceiptStages[index])
  ) {
    fail('MULTIMODAL_SESSION_FAILED', 'confirmedStages 与工作态不一致', 500);
  }
  return { detail, confirmedStages };
}

function nextMediaStageForConfirmation(
  confirmedStage: 'adler_overview' | 'evidence_and_candidates',
): MediaStage {
  return confirmedStage === 'adler_overview'
    ? 'extracting_candidates'
    : 'building_skills';
}

function replayConfirmationResult(receipt: {
  resultRevisionNo: number;
  confirmedStage: 'adler_overview' | 'evidence_and_candidates';
}): MultimodalSessionConfirmationResult {
  return {
    sessionId: '',
    revisionNo: receipt.resultRevisionNo,
    mediaStage: nextMediaStageForConfirmation(receipt.confirmedStage),
    confirmedStage: receipt.confirmedStage,
    replayed: true,
  };
}

function flattenCandidateIds(
  state: MultimodalSessionState,
): string[] {
  return [
    ...state.candidatePasses.frameworks,
    ...state.candidatePasses.principles,
    ...state.candidatePasses.cases,
    ...state.candidatePasses.counterexamples,
    ...state.candidatePasses.terms,
    ...state.candidatePasses.fused,
  ].map((candidate) => candidate.candidateId);
}

function assertValidationCoverage(state: MultimodalSessionState) {
  const candidateIds = flattenCandidateIds(state);
  if (candidateIds.length === 0) {
    fail('QUALITY_GATE_FAILED', '当前没有可确认的候选 Skill', 422);
  }
  const validationIds = state.candidateValidations.map(
    (validation) => validation.candidate.candidateId,
  );
  if (
    candidateIds.length !== validationIds.length ||
    candidateIds.some((id) => !validationIds.includes(id))
  ) {
    fail('MULTIMODAL_SESSION_FAILED', '候选校验覆盖不完整', 500);
  }
}

function getExistingReceipt(
  state: MultimodalSessionState,
  action: HumanConfirmAction,
  idempotencyKey: string,
): HumanConfirmReceipt | null {
  return (
    state.operationReceipts.find(
      (receipt) =>
        receipt.action === action &&
        receipt.idempotencyKey === idempotencyKey,
    ) as HumanConfirmReceipt | undefined ?? null
  );
}

function getUploadConfirmReceipt(
  state: MultimodalSessionState,
  idempotencyKey: string,
): UploadConfirmReceipt | null {
  const receipt = state.operationReceipts.find(
    (item) =>
      item.action === 'skill.media.upload.confirm' &&
      item.idempotencyKey === idempotencyKey,
  );
  if (!receipt) return null;
  if (receipt.confirmedStage !== 'uploading') {
    fail('MULTIMODAL_SESSION_FAILED', '上传确认 receipt 状态损坏', 500);
  }
  return receipt as UploadConfirmReceipt;
}

function getMediaEditReceipt(
  state: MultimodalSessionState,
  action: MediaEditAction,
  idempotencyKey: string,
): MediaOperationReceipt | null {
  return (
    state.operationReceipts.find(
      (receipt) =>
        receipt.action === action && receipt.idempotencyKey === idempotencyKey,
    ) ?? null
  );
}

function mediaStageForEditAction(action: MediaEditAction): MediaStage {
  if (action === 'skill.media.transcript.update') return 'building_semantic_windows';
  if (action === 'skill.media.evidence.update') return 'building_adler';
  return 'validating_candidates';
}

function invalidationForEditAction(
  action: MediaEditAction,
): MultimodalSessionMutationResult['invalidatedFrom'] {
  if (action === 'skill.media.transcript.update') return 'semantic_moments';
  if (action === 'skill.media.evidence.update') return 'adler_overview';
  return 'candidate_validation';
}

function emptyCandidatePasses(): MultimodalSessionState['candidatePasses'] {
  return {
    frameworks: [],
    principles: [],
    cases: [],
    counterexamples: [],
    terms: [],
    fused: [],
  };
}

function assertTransition(
  fromStage: MediaStage,
  toStage: MediaStage,
  confirmedStages: MediaConfirmationStage[],
) {
  try {
    assertMediaStageTransition(fromStage, toStage);
    assertMediaStageGate({
      targetStage: toStage,
      confirmedStages,
    });
  } catch {
    fail('INVALID_MEDIA_STAGE', '当前阶段不允许执行该确认操作', 409);
  }
}

function mapSessionRowInternal(row: SessionRow): PersistedMultimodalSessionDetail {
  readCreationMode(row.creation_mode);
  const sessionId = persistedPositiveId(String(row.id), 'sessionId');
  const status = readSessionStatus(row.status);
  const mediaStage = readMediaStage(row.media_stage);
  if (status !== getGuidedCreationStatusForMediaStage(mediaStage)) {
    fail('MULTIMODAL_SESSION_FAILED', 'status 与 mediaStage 不一致', 500);
  }
  return {
    sessionId,
    displayName: safeString(row.display_name, 'displayName'),
    status,
    mediaStage,
    revisionNo: readRevisionNo(row.revision_no, 'revisionNo'),
    createdAt: asIso(row.created_at, 'createdAt'),
    updatedAt: asIso(row.updated_at, 'updatedAt'),
    mediaState: parseSessionState(row.media_state_json),
  };
}

function toPublicPipelineError(
  value: unknown,
  mediaStage: MediaStage,
): PublicMultimodalPipelineError | null {
  if (mediaStage !== 'failed' || value == null) return null;
  const parsed = parseStoredJson(value, 'error');
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (
    typeof record.code !== 'string' ||
    !/^[A-Z0-9_:-]+$/.test(record.code) ||
    typeof record.message !== 'string' ||
    !record.message.trim() ||
    record.message.length > 512 ||
    typeof record.retryable !== 'boolean'
  ) {
    return null;
  }
  try {
    return {
      code: record.code,
      stage: readMediaStage(record.stage),
      resumeStage: readMediaStage(record.resumeStage),
      retryable: record.retryable,
      message: record.message.trim(),
    };
  } catch {
    return null;
  }
}

function mapSessionRow(row: SessionRow): MultimodalSessionDetail {
  const internalDetail = mapSessionRowInternal(row);
  return {
    ...internalDetail,
    mediaState: toPublicSessionState(internalDetail.mediaState),
    error: toPublicPipelineError(row.error_json, internalDetail.mediaStage),
  };
}

function parseJobRow(row: JobRow): MediaJobRecord {
  try {
    return parseMediaJobRecord({
      id: persistedPositiveId(String(row.id), 'jobId'),
      sessionId: persistedPositiveId(String(row.session_id), 'job.sessionId'),
      jobType: row.job_type,
      status: row.status,
      idempotencyKey: row.idempotency_key,
      requestHash: row.request_hash,
      attemptNo: row.attempt_no,
      maxAttempts: row.max_attempts,
      progress: parseStoredJson(row.progress_json, 'progress'),
      inputManifest: parseStoredJson(row.input_manifest_json, 'inputManifest'),
      outputManifest:
        row.output_manifest_json == null
          ? row.output_manifest_json
          : parseStoredJson(row.output_manifest_json, 'outputManifest'),
      resultHash: row.result_hash,
      error:
        row.error_json == null
          ? row.error_json
          : parseStoredJson(row.error_json, 'error'),
    });
  } catch {
    fail('MULTIMODAL_SESSION_FAILED', '媒体任务状态损坏', 500);
  }
}

const MEDIA_JOB_PROGRESS_LABELS: Record<
  MediaJobType,
  { active: string; completed: string }
> = {
  media_quality_check: {
    active: '正在进行安全校验',
    completed: '安全校验完成',
  },
  media_prepare: {
    active: '正在预处理媒体',
    completed: '媒体预处理完成',
  },
  transcribe: {
    active: '正在进行语音转录',
    completed: '语音转录完成',
  },
  frame_materialize: {
    active: '正在生成关键帧与证据',
    completed: '关键帧与证据生成完成',
  },
};

const WORKER_PHASE_LABELS: Record<string, string> = {
  claimed: '任务已进入处理队列',
  ready_to_complete: '正在提交处理结果',
  downloading_source: '正在读取素材',
  probing_media: '正在分析媒体信息',
  normalizing_audio: '正在标准化音轨',
  detecting_visual_signals: '正在识别画面变化',
  uploading_result_manifest: '正在保存处理结果',
  downloading_audio: '正在读取音轨',
  transcribing: '正在识别语音内容',
  transcribing_audio: '正在识别语音内容',
  uploading_transcript: '正在保存转录结果',
  downloading_video: '正在读取视频画面',
  materializing_frames: '正在生成候选关键帧',
  uploading_frames: '正在保存关键帧',
};

function localizedProgressHint(job: MediaJobRecord, phase: string | null) {
  const labels = MEDIA_JOB_PROGRESS_LABELS[job.jobType];
  if (job.status === 'succeeded') return labels.completed;
  if (job.status === 'failed') return '处理失败';
  if (job.status === 'cancelled') return '处理已取消';
  return (phase && WORKER_PHASE_LABELS[phase]) || labels.active;
}

function sanitizeProgress(job: MediaJobRecord): MultimodalSessionProgress['currentJob'] {
  const phase =
    typeof job.progress.phase === 'string' && job.progress.phase.trim()
      ? job.progress.phase.trim()
      : null;
  const rawPercent = job.progress.percent;
  const percent =
    job.status === 'succeeded'
      ? 100
      : typeof rawPercent === 'number' &&
          Number.isFinite(rawPercent) &&
          rawPercent >= 0 &&
          rawPercent <= 100
        ? rawPercent
        : null;

  return {
    jobId: job.id,
    jobType: job.jobType,
    status: job.status,
    percent,
    hint: localizedProgressHint(job, phase),
  };
}

function toSummary(detail: MultimodalSessionDetail): MultimodalSessionSummary {
  return {
    sessionId: detail.sessionId,
    displayName: detail.displayName,
    status: detail.status,
    mediaStage: detail.mediaStage,
    revisionNo: detail.revisionNo,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
  };
}

export type MultimodalGuidedCreationService = ReturnType<
  typeof createMultimodalGuidedCreationService
>;

export function createMultimodalGuidedCreationService(
  deps: ServiceDependencies = {},
) {
  const queryFn = deps.query ?? query;
  const withTransactionFn = deps.withTransaction ?? withTransaction;
  const now = deps.now ?? (() => new Date());
  const objectStorageService = deps.objectStorageService ?? getObjectStorageService();
  const uploadSecurityService = deps.uploadSecurityService ?? getUploadSecurityService();
  const uploadTokenSecret = deps.uploadTokenSecret ?? getUploadTokenSecret();
  const createSourceId = deps.createSourceId ?? (() => `source-${randomUUID()}`);
  const multimodalUploadMaxBytes =
    deps.multimodalUploadMaxBytes ?? config.multimodalUploadMaxBytes;
  const multimodalSinglePutMaxBytes =
    deps.multimodalSinglePutMaxBytes ?? config.multimodalSinglePutMaxBytes;
  const multimodalMultipartPartBytes =
    deps.multimodalMultipartPartBytes ?? config.multimodalMultipartPartBytes;
  const createMediaJobInTransactionFn: NonNullable<
    ServiceDependencies['createMediaJobInTransaction']
  > =
    deps.createMediaJobInTransaction ??
    (() => {
      const mediaJobService = createMultimodalJobService();
      return async (
        input: Parameters<
          NonNullable<ServiceDependencies['createMediaJobInTransaction']>
        >[0],
      ) => {
        const job = await mediaJobService.createMediaJobInTransaction(input);
        return {
          jobId: job.id,
          jobType: job.jobType,
          status: job.status,
          attemptNo: job.attemptNo,
        };
      };
    })();

  return {
    async createSession(input: {
      authUserId: string;
      idempotencyKey: string;
      displayName: string;
    }): Promise<MultimodalSessionDetail> {
      const displayName = normalizeDisplayName(input.displayName);
      const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
      const mediaState = buildInitialMediaState();
      const initialMediaStage: MediaStage = 'draft';
      const initialStatus = getGuidedCreationStatusForMediaStage(initialMediaStage);
      const requestHash = buildMultimodalSessionCreateRequestHash(displayName);
      const createdAt = now().toISOString();

      return withTransactionFn(async (db: Queryable) => {
        const inserted = await db.query<SessionRow>(
          `insert into skill_guided_creation_sessions (
             user_id,
             display_name,
             creation_mode,
             start_client_message_id,
             start_request_hash,
             media_stage,
             status,
             media_state_json,
             created_at,
             updated_at,
             revision_no
           ) values (
             $1,
             $2,
             $3,
             $4,
             $5,
             $6,
             $7,
             $8::jsonb,
             $9,
             $9,
             0
           )
           on conflict (user_id, start_client_message_id)
             where start_client_message_id is not null
           do nothing
           returning id,
                     display_name,
                     status,
                     creation_mode,
                     media_stage,
                     media_state_json,
                     revision_no,
                     start_request_hash,
                     created_at,
                     updated_at`,
          [
            input.authUserId,
            displayName,
            CREATION_MODE,
            idempotencyKey,
            requestHash,
            initialMediaStage,
            initialStatus,
            stableRequestHashJson(mediaState),
            createdAt,
          ],
        );
        const insertedRow = inserted.rows[0];
        if (insertedRow) {
          return mapSessionRow(insertedRow);
        }

        const existing = await db.query<SessionRow>(
          `select id,
                  display_name,
                  status,
                  creation_mode,
                  media_stage,
                  media_state_json,
                  revision_no,
                  start_request_hash,
                  created_at,
                  updated_at
             from skill_guided_creation_sessions
            where user_id = $1
              and start_client_message_id = $2`,
          [input.authUserId, idempotencyKey],
        );
        const existingRow = existing.rows[0];
        if (!existingRow) {
          fail(
            'MULTIMODAL_SESSION_CREATE_FAILED',
            '媒体会话创建冲突，请重试',
            409,
            true,
          );
        }
        if (existingRow.start_request_hash !== requestHash) {
          fail(
            'IDEMPOTENCY_KEY_REUSED',
            '相同 idempotencyKey 不能复用于不同请求',
            409,
          );
        }
        return mapSessionRow(existingRow);
      });
    },

    async createUploadIntent(input: {
      authUserId: string;
      sessionId: string;
      idempotencyKey: string;
      fileName: string;
      declaredMimeType: string;
      sizeBytes: number;
      serverManaged?: boolean;
    }): Promise<MultimodalUploadIntentResult> {
      const sessionId = positiveId(input.sessionId, 'sessionId');
      const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
      const signedObjectStorage = objectStorageService;
      const requestIdentity = normalizeUploadIntentRequestIdentity({
        fileName: input.fileName,
        declaredMimeType: input.declaredMimeType,
        sizeBytes: input.sizeBytes,
      });
      const requestHash = buildUploadIntentRequestHash({
        sessionId,
        fileName: requestIdentity.fileName,
        declaredMimeType: requestIdentity.declaredMimeType,
        sizeBytes: requestIdentity.sizeBytes,
        mediaKind: requestIdentity.mediaKind,
        serverManaged: input.serverManaged,
      });
      let createdMultipartForAbort:
        | { objectKey: string; multipartUploadId: string }
        | null = null;
      let transactionResolved = false;

      try {
        const result: MultimodalUploadIntentResult = await withTransactionFn(
          async (db: Queryable): Promise<MultimodalUploadIntentResult> => {
        const sessionResult = await db.query<SessionRow>(
          `select id,
                  display_name,
                  status,
                  creation_mode,
                  media_stage,
                  media_state_json,
                  confirmed_stages_json,
                  revision_no,
                  created_at,
                  updated_at
             from skill_guided_creation_sessions
            where id = $1
              and user_id = $2
              and creation_mode = $3
              and deleted_at is null
            for update`,
          [sessionId, input.authUserId, CREATION_MODE],
        );
        const sessionRow = sessionResult.rows[0];
        if (!sessionRow) {
          fail('GUIDED_SESSION_NOT_FOUND', '没有找到这个多模态会话', 404);
        }
        const signingSecret = normalizeUploadTokenSecret(uploadTokenSecret);
        if (!signedObjectStorage) {
          fail('MULTIMODAL_UPLOAD_UNAVAILABLE', '媒体上传暂时不可用，请稍后重试。', 503, true);
        }

        const { detail, confirmedStages } = parseSessionRowForMutation(sessionRow);
        const existingPendingUpload = detail.mediaState.pendingUpload;
        if (
          existingPendingUpload &&
          existingPendingUpload.idempotencyKey === idempotencyKey
        ) {
          if (detail.mediaStage !== 'uploading') {
            fail('INVALID_MEDIA_STAGE', '当前阶段不允许申请上传', 409);
          }
          if (existingPendingUpload.materialStatus !== 'uploading') {
            fail('UPLOAD_ALREADY_CONFIRMED', '该上传已进入校验流程，不能重新申请上传', 409);
          }
          if (existingPendingUpload.requestHash !== requestHash) {
            fail(
              'IDEMPOTENCY_KEY_REUSED',
              '相同 idempotencyKey 不能复用于不同请求',
              409,
            );
          }
          const replayBinding = {
            sessionId: detail.sessionId,
            authUserId: input.authUserId,
            sourceId: existingPendingUpload.sourceId,
            objectKey: String(existingPendingUpload.objectKey),
            declaredMimeType: existingPendingUpload.declaredMimeType,
            sizeBytes: existingPendingUpload.sizeBytes,
            uploadMode: normalizeUploadMode(existingPendingUpload.uploadMode),
            ...(existingPendingUpload.uploadMode === 'multipart'
              ? {
                  multipartUploadId: existingPendingUpload.multipartUploadId,
                  partSizeBytes: existingPendingUpload.partSizeBytes,
                  partCount: existingPendingUpload.partCount,
                }
              : {}),
            intentRevisionNo: Number(existingPendingUpload.intentRevisionNo),
          };
          if (
            !safeCompareHexHash(
              existingPendingUpload.intentClaimsHash,
              buildUploadIntentClaimsHash(replayBinding),
            )
          ) {
            fail('MULTIMODAL_SESSION_FAILED', '媒体会话状态损坏', 500);
          }
          if (existingPendingUpload.uploadMode === 'multipart') {
            const parts = await Promise.all(
              Array.from(
                { length: existingPendingUpload.partCount },
                async (_, index) =>
                  signedObjectStorage.createSignedUploadPartGrant({
                    objectKey: String(existingPendingUpload.objectKey),
                    multipartUploadId: existingPendingUpload.multipartUploadId,
                    partNumber: index + 1,
                  }),
              ),
            );
            const expiresAt = parts.reduce(
              (earliest, part) =>
                earliest < part.expiresAt ? earliest : part.expiresAt,
              parts[0]?.expiresAt ?? existingPendingUpload.expiresAt,
            );
            const replayToken = issueUploadIntentToken({
              secret: signingSecret,
              binding: replayBinding,
              expiresAt,
            });
            return {
              sessionId: detail.sessionId,
              revisionNo: detail.revisionNo,
              mediaStage: 'uploading',
              uploadMode: 'multipart',
              expiresAt,
              uploadToken: replayToken,
              multipart: {
                partSizeBytes: existingPendingUpload.partSizeBytes,
                partCount: existingPendingUpload.partCount,
                parts,
              },
              replayed: true,
            };
          }
          const replayGrant = await signedObjectStorage.createSignedPutGrant({
            objectKey: String(existingPendingUpload.objectKey),
            contentType: existingPendingUpload.declaredMimeType,
          });
          const replayToken = issueUploadIntentToken({
            secret: signingSecret,
            binding: replayBinding,
            expiresAt: replayGrant.expiresAt,
          });
          return {
            sessionId: detail.sessionId,
            revisionNo: detail.revisionNo,
            mediaStage: 'uploading',
            uploadMode: 'single_put',
            expiresAt: replayGrant.expiresAt,
            uploadToken: replayToken,
            upload: {
              method: 'PUT',
              url: replayGrant.url,
              requiredHeaders: replayGrant.requiredHeaders,
            },
            replayed: true,
          };
        }

        let normalizedIntent: ReturnType<UploadSecurityService['validateUploadIntent']>;
        try {
          normalizedIntent = uploadSecurityService.validateUploadIntent({
            fileName: input.fileName,
            declaredMimeType: input.declaredMimeType,
            sizeBytes: input.sizeBytes,
          });
        } catch (error) {
          if (error instanceof UploadSecurityError) {
            fail(error.code, error.message, error.status, error.retryable);
          }
          fail('INVALID_UPLOAD_INTENT', '上传文件参数不合法', 422);
        }

        if (input.sizeBytes > multimodalUploadMaxBytes) {
          fail('FILE_TOO_LARGE', 'Uploaded content is too large.', 413);
        }

        const uploadMode: UploadMode =
          input.serverManaged === true
            ? 'single_put'
            : input.sizeBytes > multimodalSinglePutMaxBytes
              ? 'multipart'
              : 'single_put';
        const multipartPlan =
          uploadMode === 'multipart'
            ? buildMultipartPlan({
                sizeBytes: input.sizeBytes,
                partSizeBytes: multimodalMultipartPartBytes,
              })
            : null;

        if (detail.mediaState.primarySource != null || existingPendingUpload != null) {
          fail('PRIMARY_SOURCE_ALREADY_EXISTS', '当前会话已存在主源或待上传主源', 409);
        }
        if (detail.mediaStage !== 'draft') {
          fail('INVALID_MEDIA_STAGE', '当前阶段不允许申请上传', 409);
        }
        assertTransition(detail.mediaStage, 'uploading', confirmedStages);

        const nextRevisionNo = detail.revisionNo + 1;
        const objectKey = signedObjectStorage.createSessionObjectKey({
          sessionId: detail.sessionId,
          category: 'source',
          extension: normalizedIntent.extension,
        });
        const sourceId = normalizeSourceId(createSourceId());
        const nextStage: MediaStage = 'uploading';
        const nextStatus = getGuidedCreationStatusForMediaStage(nextStage);
        const recordedAt = now().toISOString();

        if (uploadMode === 'single_put') {
          const putGrant = await signedObjectStorage.createSignedPutGrant({
            objectKey,
            contentType: normalizedIntent.declaredMimeType,
          });
          const binding = {
            sessionId: detail.sessionId,
            authUserId: input.authUserId,
            sourceId,
            objectKey,
            declaredMimeType: normalizedIntent.declaredMimeType,
            sizeBytes: input.sizeBytes,
            uploadMode: 'single_put' as const,
            intentRevisionNo: nextRevisionNo,
          };
          const nextState = parseMultimodalSessionState({
            ...detail.mediaState,
            pendingUpload: {
              sourceId,
              mediaKind: normalizedIntent.mediaKind,
              fileName: normalizedIntent.normalizedFileName,
              declaredMimeType: normalizedIntent.declaredMimeType,
              sizeBytes: input.sizeBytes,
              uploadMode: 'single_put',
              materialStatus: 'uploading',
              verification: null,
              objectKey,
              idempotencyKey,
              requestHash,
              intentClaimsHash: buildUploadIntentClaimsHash(binding),
              intentRevisionNo: nextRevisionNo,
              expiresAt: putGrant.expiresAt,
            },
          });
          const updateResult = await db.query<SessionRow>(
            `update skill_guided_creation_sessions
                set updated_at = $1,
                    revision_no = $2,
                    media_state_json = $3::jsonb,
                    media_stage = $4,
                    status = $5
              where id = $6
                and user_id = $7
                and creation_mode = $8
                and deleted_at is null
                and revision_no = $9
                and media_stage = $10
              returning id,
                        display_name,
                        status,
                        creation_mode,
                        media_stage,
                        media_state_json,
                        confirmed_stages_json,
                        revision_no,
                        created_at,
                        updated_at`,
            [
              recordedAt,
              nextRevisionNo,
              stableRequestHashJson(nextState),
              nextStage,
              nextStatus,
              detail.sessionId,
              input.authUserId,
              CREATION_MODE,
              detail.revisionNo,
              detail.mediaStage,
            ],
          );
          const updatedRow = updateResult.rows[0];
          if (!updateResult.rowCount || !updatedRow) {
            fail('SESSION_REVISION_CONFLICT', '会话版本已变化，请刷新后重试', 409);
          }
          parseSessionRowForMutation(updatedRow);
          return {
            sessionId: detail.sessionId,
            revisionNo: nextRevisionNo,
            mediaStage: 'uploading',
            uploadMode: 'single_put',
            expiresAt: putGrant.expiresAt,
            uploadToken: issueUploadIntentToken({
              secret: signingSecret,
              binding,
              expiresAt: putGrant.expiresAt,
            }),
            upload: {
              method: 'PUT',
              url: putGrant.url,
              requiredHeaders: putGrant.requiredHeaders,
            },
            replayed: false,
          };
        }

          const createdMultipart = await signedObjectStorage.createMultipartUpload({
            objectKey,
            contentType: normalizedIntent.declaredMimeType,
          });
          createdMultipartForAbort = {
            objectKey,
            multipartUploadId: createdMultipart.multipartUploadId,
          };
          const multipartUploadId = createdMultipart.multipartUploadId;
          const resolvedMultipartUploadId = multipartUploadId;
          const partSizeBytes = multipartPlan?.partSizeBytes ?? 0;
          const partCount = multipartPlan?.partCount ?? 0;
          const parts = await Promise.all(
            Array.from({ length: partCount }, async (_, index) =>
              signedObjectStorage.createSignedUploadPartGrant({
                objectKey,
                multipartUploadId: resolvedMultipartUploadId,
                partNumber: index + 1,
              }),
            ),
          );
          const expiresAt = parts.reduce(
            (earliest, part) =>
              earliest < part.expiresAt ? earliest : part.expiresAt,
            parts[0]?.expiresAt ?? recordedAt,
          );
          const binding = {
            sessionId: detail.sessionId,
            authUserId: input.authUserId,
            sourceId,
            objectKey,
            declaredMimeType: normalizedIntent.declaredMimeType,
            sizeBytes: input.sizeBytes,
            uploadMode: 'multipart' as const,
            multipartUploadId: resolvedMultipartUploadId,
            partSizeBytes,
            partCount,
            intentRevisionNo: nextRevisionNo,
          };
          const nextState = parseMultimodalSessionState({
            ...detail.mediaState,
            pendingUpload: {
              sourceId,
              mediaKind: normalizedIntent.mediaKind,
              fileName: normalizedIntent.normalizedFileName,
              declaredMimeType: normalizedIntent.declaredMimeType,
              sizeBytes: input.sizeBytes,
              uploadMode: 'multipart',
              materialStatus: 'uploading',
              verification: null,
              objectKey,
              idempotencyKey,
              requestHash,
              intentClaimsHash: buildUploadIntentClaimsHash(binding),
              intentRevisionNo: nextRevisionNo,
              expiresAt,
              multipartUploadId: resolvedMultipartUploadId,
              partSizeBytes,
              partCount,
            },
          });
          const updateResult = await db.query<SessionRow>(
            `update skill_guided_creation_sessions
                set updated_at = $1,
                    revision_no = $2,
                    media_state_json = $3::jsonb,
                    media_stage = $4,
                    status = $5
              where id = $6
                and user_id = $7
                and creation_mode = $8
                and deleted_at is null
                and revision_no = $9
                and media_stage = $10
              returning id,
                        display_name,
                        status,
                        creation_mode,
                        media_stage,
                        media_state_json,
                        confirmed_stages_json,
                        revision_no,
                        created_at,
                        updated_at`,
            [
              recordedAt,
              nextRevisionNo,
              stableRequestHashJson(nextState),
              nextStage,
              nextStatus,
              detail.sessionId,
              input.authUserId,
              CREATION_MODE,
              detail.revisionNo,
              detail.mediaStage,
            ],
          );
          const updatedRow = updateResult.rows[0];
          if (!updateResult.rowCount || !updatedRow) {
            fail('SESSION_REVISION_CONFLICT', '会话版本已变化，请刷新后重试', 409);
          }
          parseSessionRowForMutation(updatedRow);
          return {
            sessionId: detail.sessionId,
            revisionNo: nextRevisionNo,
            mediaStage: 'uploading',
            uploadMode: 'multipart',
            expiresAt,
            uploadToken: issueUploadIntentToken({
              secret: signingSecret,
              binding,
              expiresAt,
            }),
            multipart: {
              partSizeBytes,
              partCount,
              parts,
            },
            replayed: false,
          };
          },
        );
        transactionResolved = true;
        return result;
      } catch (error) {
        if (
          createdMultipartForAbort &&
          !transactionResolved &&
          signedObjectStorage
        ) {
          await abortMultipartBestEffort(
            signedObjectStorage,
            createdMultipartForAbort,
          );
        }
        if (error instanceof MultimodalGuidedCreationServiceError) {
          throw error;
        }
        fail('MULTIMODAL_UPLOAD_UNAVAILABLE', '媒体上传暂时不可用，请稍后重试。', 503, true);
      }
    },

    async getServerPendingUpload(input: {
      authUserId: string;
      sessionId: string;
      idempotencyKey: string;
    }): Promise<ServerPendingUploadBinding> {
      const sessionId = positiveId(input.sessionId, 'sessionId');
      const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
      const result = await queryFn<SessionRow>(
        `select id,
                display_name,
                status,
                creation_mode,
                media_stage,
                media_state_json,
                revision_no,
                created_at,
                updated_at
           from skill_guided_creation_sessions
          where id = $1
            and user_id = $2
            and creation_mode = $3
            and deleted_at is null`,
        [sessionId, input.authUserId, CREATION_MODE],
      );
      const row = result.rows[0];
      if (!row) {
        fail('GUIDED_SESSION_NOT_FOUND', '没有找到这个多模态会话', 404);
      }
      const detail = mapSessionRowInternal(row);
      const pending = detail.mediaState.pendingUpload;
      if (
        !pending ||
        pending.idempotencyKey !== idempotencyKey ||
        pending.materialStatus !== 'uploading'
      ) {
        fail('UPLOAD_NOT_FOUND', '没有找到可由服务端写入的待上传对象', 409);
      }
      return {
        sessionId: detail.sessionId,
        revisionNo: detail.revisionNo,
        objectKey: pending.objectKey,
        uploadMode: pending.uploadMode,
        fileName: pending.fileName,
        declaredMimeType: pending.declaredMimeType,
        sizeBytes: pending.sizeBytes,
      };
    },

    async findMediaQualityCheckByIdempotency(input: {
      authUserId: string;
      sessionId: string;
      idempotencyKey: string;
    }): Promise<PersistedMediaQualityCheckReceipt | null> {
      const sessionId = positiveId(input.sessionId, 'sessionId');
      const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
      const result = await queryFn<OwnedJobRow>(
        `select j.id,
                j.session_id,
                j.job_type,
                j.status,
                j.idempotency_key,
                j.request_hash,
                j.attempt_no,
                j.max_attempts,
                j.progress_json,
                j.input_manifest_json,
                j.output_manifest_json,
                j.result_hash,
                j.error_json,
                s.revision_no,
                s.media_stage
           from skill_media_jobs j
           join skill_guided_creation_sessions s on s.id = j.session_id
          where j.session_id = $1
            and j.job_type = $2
            and j.idempotency_key = $3
            and s.user_id = $4
            and s.creation_mode = $5
            and s.deleted_at is null
          limit 1`,
        [
          sessionId,
          'media_quality_check',
          idempotencyKey,
          input.authUserId,
          CREATION_MODE,
        ],
      );
      const row = result.rows[0];
      if (!row) return null;
      const job = parseJobRow(row);
      let manifest: ReturnType<typeof parseMediaQualityCheckJobInputManifest>;
      try {
        manifest = parseMediaQualityCheckJobInputManifest(job.inputManifest);
      } catch {
        fail('MULTIMODAL_SESSION_FAILED', '媒体质量检查任务输入损坏', 500);
      }
      if (job.sessionId !== sessionId) {
        fail('MULTIMODAL_SESSION_FAILED', '媒体任务归属漂移', 500);
      }
      return {
        sessionId,
        revisionNo: readRevisionNo(row.revision_no, 'revisionNo'),
        mediaStage: readMediaStage(row.media_stage),
        jobId: job.id,
        jobStatus: job.status,
        expectedSizeBytes: manifest.expectedSizeBytes,
        expectedContentType: manifest.expectedContentType,
      };
    },

    async updateTranscriptSegment(input: {
      authUserId: string;
      sessionId: string;
      idempotencyKey: string;
      expectedRevisionNo: number;
      mutation: {
        segmentIndex: number;
        expectedSegmentRevisionNo: number;
        text: string;
        speaker: string | null;
      };
    }): Promise<MultimodalSessionMutationResult> {
      const sessionId = positiveId(input.sessionId, 'sessionId');
      const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
      const expectedRevisionNo = normalizeExpectedRevisionNo(
        input.expectedRevisionNo,
      );
      const mutation = normalizeTranscriptSegmentUpdate(input.mutation);
      const action = 'skill.media.transcript.update' as const;
      const requestHash = buildMediaEditRequestHash({
        action,
        sessionId,
        expectedRevisionNo,
        mutation,
      });

      return withTransactionFn(async (db: Queryable) => {
        const sessionResult = await db.query<SessionRow>(
          `select id,
                  display_name,
                  status,
                  creation_mode,
                  media_stage,
                  media_state_json,
                  confirmed_stages_json,
                  revision_no,
                  created_at,
                  updated_at
             from skill_guided_creation_sessions
            where id = $1
              and user_id = $2
              and creation_mode = $3
              and deleted_at is null
            for update`,
          [sessionId, input.authUserId, CREATION_MODE],
        );
        const sessionRow = sessionResult.rows[0];
        if (!sessionRow) {
          fail('GUIDED_SESSION_NOT_FOUND', '没有找到这个多模态会话', 404);
        }
        const { detail, confirmedStages } = parseSessionRowForMutation(sessionRow);
        const existingReceipt = getMediaEditReceipt(
          detail.mediaState,
          action,
          idempotencyKey,
        );
        if (existingReceipt) {
          if (existingReceipt.requestHash !== requestHash) {
            fail(
              'IDEMPOTENCY_KEY_REUSED',
              '相同 idempotencyKey 不能复用于不同请求',
              409,
            );
          }
          return {
            sessionId,
            revisionNo: existingReceipt.resultRevisionNo,
            mediaStage: mediaStageForEditAction(action),
            invalidatedFrom: invalidationForEditAction(action),
            replayed: true,
          };
        }
        if (detail.revisionNo !== expectedRevisionNo) {
          fail('SESSION_REVISION_CONFLICT', '会话版本已变化，请刷新后重试', 409);
        }
        if (confirmedStages.length > 0) {
          fail('INVALID_MEDIA_STAGE', 'Overview 确认后不允许回改 transcript', 409);
        }
        const nextStage: MediaStage = 'building_semantic_windows';
        try {
          assertMediaEditReset({
            kind: 'transcript',
            fromStage: detail.mediaStage,
            targetStage: nextStage,
          });
        } catch {
          fail('INVALID_MEDIA_STAGE', '当前阶段不允许编辑 transcript', 409);
        }
        if (detail.mediaState.transcript.status !== 'ready') {
          fail('INVALID_MEDIA_STAGE', 'transcript 尚未准备完成', 409);
        }
        const currentSegment = detail.mediaState.transcript.segments[mutation.segmentIndex];
        if (!currentSegment) {
          fail('INVALID_ARGUMENT', 'segmentIndex 不存在', 422);
        }
        const currentSegmentRevisionNo = currentSegment.revisionNo ?? 0;
        if (currentSegmentRevisionNo !== mutation.expectedSegmentRevisionNo) {
          fail('SEGMENT_REVISION_CONFLICT', '转写片段版本已变化，请刷新后重试', 409);
        }
        const nextSegment: MultimodalTranscriptSegment = {
          ...currentSegment,
          text: mutation.text,
          speaker: mutation.speaker,
          editedByUser: true,
          revisionNo: currentSegmentRevisionNo + 1,
        };
        const nextRevisionNo = expectedRevisionNo + 1;
        const recordedAt = now().toISOString();
        const nextState = parseMultimodalSessionState({
          ...detail.mediaState,
          transcript: {
            ...detail.mediaState.transcript,
            segments: detail.mediaState.transcript.segments.map((segment, index) =>
              index === mutation.segmentIndex ? nextSegment : segment,
            ),
          },
          semanticMoments: [],
          evidenceTimeline: { evidenceItems: [] },
          candidatePasses: emptyCandidatePasses(),
          candidatePassMeta: null,
          degradations: [],
          adlerOverview: null,
          adlerOverviewReview: null,
          selectedCandidateIds: [],
          candidateValidations: [],
          candidateSkills: [],
          operationReceipts: [
            ...detail.mediaState.operationReceipts,
            {
              action,
              idempotencyKey,
              requestHash,
              baseRevisionNo: expectedRevisionNo,
              resultRevisionNo: nextRevisionNo,
              confirmedStage: 'transcript',
              recordedAt,
            },
          ],
        });
        const updateResult = await db.query<SessionRow>(
          `update skill_guided_creation_sessions
              set updated_at = $1,
                  revision_no = $2,
                  media_state_json = $3::jsonb,
                  media_stage = $4,
                  status = $5
            where id = $6
              and user_id = $7
              and creation_mode = $8
              and deleted_at is null
              and revision_no = $9
              and media_stage = $10
            returning id,
                      display_name,
                      status,
                      creation_mode,
                      media_stage,
                      media_state_json,
                      confirmed_stages_json,
                      revision_no,
                      created_at,
                      updated_at`,
          [
            recordedAt,
            nextRevisionNo,
            stableRequestHashJson(nextState),
            nextStage,
            getGuidedCreationStatusForMediaStage(nextStage),
            sessionId,
            input.authUserId,
            CREATION_MODE,
            expectedRevisionNo,
            detail.mediaStage,
          ],
        );
        const updatedRow = updateResult.rows[0];
        if (!updateResult.rowCount || !updatedRow) {
          fail('SESSION_REVISION_CONFLICT', '会话版本已变化，请刷新后重试', 409);
        }
        parseSessionRowForMutation(updatedRow);
        return {
          sessionId,
          revisionNo: nextRevisionNo,
          mediaStage: nextStage,
          invalidatedFrom: 'semantic_moments',
          replayed: false,
        };
      });
    },

    async updateEvidence(input: {
      authUserId: string;
      sessionId: string;
      idempotencyKey: string;
      expectedRevisionNo: number;
      evidenceItems: MultimodalEvidence[];
    }): Promise<MultimodalSessionMutationResult> {
      const sessionId = positiveId(input.sessionId, 'sessionId');
      const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
      const expectedRevisionNo = normalizeExpectedRevisionNo(
        input.expectedRevisionNo,
      );
      if (!Array.isArray(input.evidenceItems) || input.evidenceItems.length < 1) {
        fail('INVALID_ARGUMENT', 'evidenceItems 必须至少保留一条证据', 422);
      }
      const action = 'skill.media.evidence.update' as const;
      const requestHash = buildMediaEditRequestHash({
        action,
        sessionId,
        expectedRevisionNo,
        mutation: input.evidenceItems,
      });

      return withTransactionFn(async (db: Queryable) => {
        const sessionResult = await db.query<SessionRow>(
          `select id, display_name, status, creation_mode, media_stage,
                  media_state_json, confirmed_stages_json, revision_no,
                  created_at, updated_at
             from skill_guided_creation_sessions
            where id = $1 and user_id = $2 and creation_mode = $3
              and deleted_at is null
            for update`,
          [sessionId, input.authUserId, CREATION_MODE],
        );
        const sessionRow = sessionResult.rows[0];
        if (!sessionRow) {
          fail('GUIDED_SESSION_NOT_FOUND', '没有找到这个多模态会话', 404);
        }
        const { detail, confirmedStages } = parseSessionRowForMutation(sessionRow);
        const existingReceipt = getMediaEditReceipt(
          detail.mediaState,
          action,
          idempotencyKey,
        );
        if (existingReceipt) {
          if (existingReceipt.requestHash !== requestHash) {
            fail('IDEMPOTENCY_KEY_REUSED', '相同 idempotencyKey 不能复用于不同请求', 409);
          }
          return {
            sessionId,
            revisionNo: existingReceipt.resultRevisionNo,
            mediaStage: mediaStageForEditAction(action),
            invalidatedFrom: invalidationForEditAction(action),
            replayed: true,
          };
        }
        if (detail.revisionNo !== expectedRevisionNo) {
          fail('SESSION_REVISION_CONFLICT', '会话版本已变化，请刷新后重试', 409);
        }
        if (confirmedStages.length > 0) {
          fail('INVALID_MEDIA_STAGE', 'Overview 确认后不允许回改证据', 409);
        }
        const nextStage: MediaStage = 'building_adler';
        try {
          assertMediaEditReset({
            kind: 'evidence',
            fromStage: detail.mediaStage,
            targetStage: nextStage,
          });
        } catch {
          fail('INVALID_MEDIA_STAGE', '当前阶段不允许编辑证据', 409);
        }
        const nextRevisionNo = expectedRevisionNo + 1;
        const recordedAt = now().toISOString();
        let nextState: MultimodalSessionState;
        try {
          nextState = parseMultimodalSessionState({
            ...detail.mediaState,
            evidenceTimeline: { evidenceItems: input.evidenceItems },
            candidatePasses: emptyCandidatePasses(),
            candidatePassMeta: null,
            adlerOverview: null,
            adlerOverviewReview: null,
            selectedCandidateIds: [],
            candidateValidations: [],
            candidateSkills: [],
            operationReceipts: [
              ...detail.mediaState.operationReceipts,
              {
                action,
                idempotencyKey,
                requestHash,
                baseRevisionNo: expectedRevisionNo,
                resultRevisionNo: nextRevisionNo,
                confirmedStage: 'evidence',
                recordedAt,
              },
            ],
          });
        } catch {
          fail('INVALID_ARGUMENT', 'evidenceItems 与当前媒体状态不一致', 422);
        }
        const updateResult = await db.query<SessionRow>(
          `update skill_guided_creation_sessions
              set updated_at = $1, revision_no = $2,
                  media_state_json = $3::jsonb, media_stage = $4, status = $5
            where id = $6 and user_id = $7 and creation_mode = $8
              and deleted_at is null and revision_no = $9 and media_stage = $10
            returning id, display_name, status, creation_mode, media_stage,
                      media_state_json, confirmed_stages_json, revision_no,
                      created_at, updated_at`,
          [
            recordedAt,
            nextRevisionNo,
            stableRequestHashJson(nextState),
            nextStage,
            getGuidedCreationStatusForMediaStage(nextStage),
            sessionId,
            input.authUserId,
            CREATION_MODE,
            expectedRevisionNo,
            detail.mediaStage,
          ],
        );
        const updatedRow = updateResult.rows[0];
        if (!updateResult.rowCount || !updatedRow) {
          fail('SESSION_REVISION_CONFLICT', '会话版本已变化，请刷新后重试', 409);
        }
        parseSessionRowForMutation(updatedRow);
        return {
          sessionId,
          revisionNo: nextRevisionNo,
          mediaStage: nextStage,
          invalidatedFrom: 'adler_overview',
          replayed: false,
        };
      });
    },

    async updateCandidates(input: {
      authUserId: string;
      sessionId: string;
      idempotencyKey: string;
      expectedRevisionNo: number;
      candidatePasses: MultimodalCandidatePasses;
    }): Promise<MultimodalSessionMutationResult> {
      const sessionId = positiveId(input.sessionId, 'sessionId');
      const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
      const expectedRevisionNo = normalizeExpectedRevisionNo(
        input.expectedRevisionNo,
      );
      if (!input.candidatePasses || typeof input.candidatePasses !== 'object') {
        fail('INVALID_ARGUMENT', 'candidatePasses 格式不正确', 422);
      }
      const action = 'skill.media.candidate.update' as const;
      const requestHash = buildMediaEditRequestHash({
        action,
        sessionId,
        expectedRevisionNo,
        mutation: input.candidatePasses,
      });

      return withTransactionFn(async (db: Queryable) => {
        const sessionResult = await db.query<SessionRow>(
          `select id, display_name, status, creation_mode, media_stage,
                  media_state_json, confirmed_stages_json, revision_no,
                  created_at, updated_at
             from skill_guided_creation_sessions
            where id = $1 and user_id = $2 and creation_mode = $3
              and deleted_at is null
            for update`,
          [sessionId, input.authUserId, CREATION_MODE],
        );
        const sessionRow = sessionResult.rows[0];
        if (!sessionRow) {
          fail('GUIDED_SESSION_NOT_FOUND', '没有找到这个多模态会话', 404);
        }
        const { detail, confirmedStages } = parseSessionRowForMutation(sessionRow);
        const existingReceipt = getMediaEditReceipt(
          detail.mediaState,
          action,
          idempotencyKey,
        );
        if (existingReceipt) {
          if (existingReceipt.requestHash !== requestHash) {
            fail('IDEMPOTENCY_KEY_REUSED', '相同 idempotencyKey 不能复用于不同请求', 409);
          }
          return {
            sessionId,
            revisionNo: existingReceipt.resultRevisionNo,
            mediaStage: mediaStageForEditAction(action),
            invalidatedFrom: invalidationForEditAction(action),
            replayed: true,
          };
        }
        if (detail.revisionNo !== expectedRevisionNo) {
          fail('SESSION_REVISION_CONFLICT', '会话版本已变化，请刷新后重试', 409);
        }
        if (
          confirmedStages.length !== 1 ||
          confirmedStages[0] !== 'adler_overview'
        ) {
          fail('INVALID_MEDIA_STAGE', '候选编辑需要已确认 Overview', 409);
        }
        const nextStage: MediaStage = 'validating_candidates';
        try {
          assertMediaEditReset({
            kind: 'candidate',
            fromStage: detail.mediaStage,
            targetStage: nextStage,
          });
        } catch {
          fail('INVALID_MEDIA_STAGE', '当前阶段不允许编辑候选', 409);
        }
        const nextRevisionNo = expectedRevisionNo + 1;
        const recordedAt = now().toISOString();
        let nextState: MultimodalSessionState;
        try {
          nextState = parseMultimodalSessionState({
            ...detail.mediaState,
            candidatePasses: input.candidatePasses,
            selectedCandidateIds: [],
            candidateValidations: [],
            candidateSkills: [],
            operationReceipts: [
              ...detail.mediaState.operationReceipts,
              {
                action,
                idempotencyKey,
                requestHash,
                baseRevisionNo: expectedRevisionNo,
                resultRevisionNo: nextRevisionNo,
                confirmedStage: 'candidate',
                recordedAt,
              },
            ],
          });
        } catch {
          fail('INVALID_ARGUMENT', 'candidatePasses 与当前证据不一致', 422);
        }
        if (flattenCandidateIds(nextState).length < 1) {
          fail('INVALID_ARGUMENT', 'candidatePasses 必须至少保留一个候选', 422);
        }
        const updateResult = await db.query<SessionRow>(
          `update skill_guided_creation_sessions
              set updated_at = $1, revision_no = $2,
                  media_state_json = $3::jsonb, media_stage = $4, status = $5
            where id = $6 and user_id = $7 and creation_mode = $8
              and deleted_at is null and revision_no = $9 and media_stage = $10
            returning id, display_name, status, creation_mode, media_stage,
                      media_state_json, confirmed_stages_json, revision_no,
                      created_at, updated_at`,
          [
            recordedAt,
            nextRevisionNo,
            stableRequestHashJson(nextState),
            nextStage,
            getGuidedCreationStatusForMediaStage(nextStage),
            sessionId,
            input.authUserId,
            CREATION_MODE,
            expectedRevisionNo,
            detail.mediaStage,
          ],
        );
        const updatedRow = updateResult.rows[0];
        if (!updateResult.rowCount || !updatedRow) {
          fail('SESSION_REVISION_CONFLICT', '会话版本已变化，请刷新后重试', 409);
        }
        parseSessionRowForMutation(updatedRow);
        return {
          sessionId,
          revisionNo: nextRevisionNo,
          mediaStage: nextStage,
          invalidatedFrom: 'candidate_validation',
          replayed: false,
        };
      });
    },

    async confirmOverview(input: {
      authUserId: string;
      sessionId: string;
      idempotencyKey: string;
      expectedRevisionNo: number;
      overview: { title: string; approved: true; userNotes: string };
    }): Promise<MultimodalSessionConfirmationResult> {
      const sessionId = positiveId(input.sessionId, 'sessionId');
      const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
      const expectedRevisionNo = normalizeExpectedRevisionNo(
        input.expectedRevisionNo,
      );
      const overview = normalizeOverviewReviewInput(input.overview);
      const requestHash = buildOverviewConfirmRequestHash({
        sessionId,
        expectedRevisionNo,
        overview,
      });
      const action = 'skill.media.overview.confirm' as const;

      return withTransactionFn(async (db: Queryable) => {
        const sessionResult = await db.query<SessionRow>(
          `select id,
                  display_name,
                  status,
                  creation_mode,
                  media_stage,
                  media_state_json,
                  confirmed_stages_json,
                  revision_no,
                  created_at,
                  updated_at
             from skill_guided_creation_sessions
            where id = $1
              and user_id = $2
              and creation_mode = $3
              and deleted_at is null
            for update`,
          [sessionId, input.authUserId, CREATION_MODE],
        );
        const sessionRow = sessionResult.rows[0];
        if (!sessionRow) {
          fail('GUIDED_SESSION_NOT_FOUND', '没有找到这个多模态会话', 404);
        }

        const { detail, confirmedStages } = parseSessionRowForMutation(sessionRow);
        const existingReceipt = getExistingReceipt(
          detail.mediaState,
          action,
          idempotencyKey,
        );
        if (existingReceipt) {
          if (existingReceipt.requestHash !== requestHash) {
            fail(
              'IDEMPOTENCY_KEY_REUSED',
              '相同 idempotencyKey 不能复用于不同请求',
              409,
            );
          }
          return {
            ...replayConfirmationResult(existingReceipt),
            sessionId: detail.sessionId,
          };
        }

        if (detail.revisionNo !== expectedRevisionNo) {
          fail('SESSION_REVISION_CONFLICT', '会话版本已变化，请刷新后重试', 409);
        }
        if (detail.mediaStage !== 'awaiting_adler_overview') {
          fail('INVALID_MEDIA_STAGE', '当前阶段不允许执行该确认操作', 409);
        }
        if (
          detail.mediaState.adlerOverview == null ||
          detail.mediaState.adlerOverviewReview !== null ||
          confirmedStages.includes('adler_overview')
        ) {
          fail('MULTIMODAL_SESSION_FAILED', 'Overview 确认前置状态损坏', 500);
        }

        const nextConfirmedStages = [...confirmedStages, 'adler_overview'] as const;
        assertTransition(
          detail.mediaStage,
          'extracting_candidates',
          [...nextConfirmedStages],
        );

        const recordedAt = now().toISOString();
        const nextRevisionNo = expectedRevisionNo + 1;
        const nextStage: MediaStage = 'extracting_candidates';
        const nextState = parseMultimodalSessionState({
          ...detail.mediaState,
          adlerOverviewReview: overview,
          operationReceipts: [
            ...detail.mediaState.operationReceipts,
            {
              action,
              idempotencyKey,
              requestHash,
              baseRevisionNo: expectedRevisionNo,
              resultRevisionNo: nextRevisionNo,
              confirmedStage: 'adler_overview',
              recordedAt,
            },
          ],
        });
        const nextStatus = getGuidedCreationStatusForMediaStage(nextStage);
        const updateResult = await db.query<SessionRow>(
          `update skill_guided_creation_sessions
              set updated_at = $1,
                  revision_no = $2,
                  confirmed_stages_json = $3::jsonb,
                  media_state_json = $4::jsonb,
                  media_stage = $5,
                  status = $6
            where id = $7
              and user_id = $8
              and creation_mode = $9
              and deleted_at is null
              and revision_no = $10
              and media_stage = $11
            returning id,
                      display_name,
                      status,
                      creation_mode,
                      media_stage,
                      media_state_json,
                      confirmed_stages_json,
                      revision_no,
                      created_at,
                      updated_at`,
          [
            recordedAt,
            nextRevisionNo,
            stableRequestHashJson(nextConfirmedStages),
            stableRequestHashJson(nextState),
            nextStage,
            nextStatus,
            sessionId,
            input.authUserId,
            CREATION_MODE,
            expectedRevisionNo,
            detail.mediaStage,
          ],
        );
        const updatedRow = updateResult.rows[0];
        if (!updateResult.rowCount || !updatedRow) {
          fail('SESSION_REVISION_CONFLICT', '会话版本已变化，请刷新后重试', 409);
        }
        parseSessionRowForMutation(updatedRow);
        return {
          sessionId,
          revisionNo: nextRevisionNo,
          mediaStage: nextStage,
          confirmedStage: 'adler_overview',
          replayed: false,
        };
      });
    },

    async confirmCandidates(input: {
      authUserId: string;
      sessionId: string;
      idempotencyKey: string;
      expectedRevisionNo: number;
      selectedCandidateIds: string[];
    }): Promise<MultimodalSessionConfirmationResult> {
      const sessionId = positiveId(input.sessionId, 'sessionId');
      const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
      const expectedRevisionNo = normalizeExpectedRevisionNo(
        input.expectedRevisionNo,
      );
      const selectedCandidateIds = normalizeSelectedCandidateIds(
        input.selectedCandidateIds,
      );
      const requestHash = buildCandidateConfirmRequestHash({
        sessionId,
        expectedRevisionNo,
        selectedCandidateIds,
      });
      const action = 'skill.media.candidate.confirm' as const;

      return withTransactionFn(async (db: Queryable) => {
        const sessionResult = await db.query<SessionRow>(
          `select id,
                  display_name,
                  status,
                  creation_mode,
                  media_stage,
                  media_state_json,
                  confirmed_stages_json,
                  revision_no,
                  created_at,
                  updated_at
             from skill_guided_creation_sessions
            where id = $1
              and user_id = $2
              and creation_mode = $3
              and deleted_at is null
            for update`,
          [sessionId, input.authUserId, CREATION_MODE],
        );
        const sessionRow = sessionResult.rows[0];
        if (!sessionRow) {
          fail('GUIDED_SESSION_NOT_FOUND', '没有找到这个多模态会话', 404);
        }

        const { detail, confirmedStages } = parseSessionRowForMutation(sessionRow);
        const existingReceipt = getExistingReceipt(
          detail.mediaState,
          action,
          idempotencyKey,
        );
        if (existingReceipt) {
          if (existingReceipt.requestHash !== requestHash) {
            fail(
              'IDEMPOTENCY_KEY_REUSED',
              '相同 idempotencyKey 不能复用于不同请求',
              409,
            );
          }
          return {
            ...replayConfirmationResult(existingReceipt),
            sessionId: detail.sessionId,
          };
        }

        if (detail.revisionNo !== expectedRevisionNo) {
          fail('SESSION_REVISION_CONFLICT', '会话版本已变化，请刷新后重试', 409);
        }
        if (detail.mediaStage !== 'awaiting_candidates') {
          fail('INVALID_MEDIA_STAGE', '当前阶段不允许执行该确认操作', 409);
        }
        if (
          !confirmedStages.includes('adler_overview') ||
          detail.mediaState.adlerOverviewReview == null ||
          detail.mediaState.candidateSkills.length > 0 ||
          confirmedStages.includes('evidence_and_candidates')
        ) {
          fail('MULTIMODAL_SESSION_FAILED', '候选确认前置状态损坏', 500);
        }

        assertValidationCoverage(detail.mediaState);
        const validationMap = new Map(
          detail.mediaState.candidateValidations.map((validation) => [
            validation.candidate.candidateId,
            validation,
          ]),
        );
        const fusedCandidateIds = new Set(
          detail.mediaState.candidatePasses.fused.map(
            (candidate) => candidate.candidateId,
          ),
        );
        for (const candidateId of selectedCandidateIds) {
          const validation = validationMap.get(candidateId);
          if (
            !fusedCandidateIds.has(candidateId) ||
            !validation ||
            !validation.overallPassed ||
            validation.disposition !== 'retain'
          ) {
            fail('QUALITY_GATE_FAILED', '所选融合主题不可确认', 422);
          }
        }

        const nextConfirmedStages = [
          ...confirmedStages,
          'evidence_and_candidates',
        ] as const;
        assertTransition(
          detail.mediaStage,
          'building_skills',
          [...nextConfirmedStages],
        );

        const recordedAt = now().toISOString();
        const nextRevisionNo = expectedRevisionNo + 1;
        const nextStage: MediaStage = 'building_skills';
        const nextState = parseMultimodalSessionState({
          ...detail.mediaState,
          selectedCandidateIds,
          operationReceipts: [
            ...detail.mediaState.operationReceipts,
            {
              action,
              idempotencyKey,
              requestHash,
              baseRevisionNo: expectedRevisionNo,
              resultRevisionNo: nextRevisionNo,
              confirmedStage: 'evidence_and_candidates',
              recordedAt,
            },
          ],
        });
        const nextStatus = getGuidedCreationStatusForMediaStage(nextStage);
        const updateResult = await db.query<SessionRow>(
          `update skill_guided_creation_sessions
              set updated_at = $1,
                  revision_no = $2,
                  confirmed_stages_json = $3::jsonb,
                  media_state_json = $4::jsonb,
                  media_stage = $5,
                  status = $6
            where id = $7
              and user_id = $8
              and creation_mode = $9
              and deleted_at is null
              and revision_no = $10
              and media_stage = $11
            returning id,
                      display_name,
                      status,
                      creation_mode,
                      media_stage,
                      media_state_json,
                      confirmed_stages_json,
                      revision_no,
                      created_at,
                      updated_at`,
          [
            recordedAt,
            nextRevisionNo,
            stableRequestHashJson(nextConfirmedStages),
            stableRequestHashJson(nextState),
            nextStage,
            nextStatus,
            sessionId,
            input.authUserId,
            CREATION_MODE,
            expectedRevisionNo,
            detail.mediaStage,
          ],
        );
        const updatedRow = updateResult.rows[0];
        if (!updateResult.rowCount || !updatedRow) {
          fail('SESSION_REVISION_CONFLICT', '会话版本已变化，请刷新后重试', 409);
        }
        parseSessionRowForMutation(updatedRow);
        return {
          sessionId,
          revisionNo: nextRevisionNo,
          mediaStage: nextStage,
          confirmedStage: 'evidence_and_candidates',
          replayed: false,
        };
      });
    },

    async createUploadConfirm(input: {
      authUserId: string;
      sessionId: string;
      idempotencyKey: string;
      uploadToken: string;
      expectedRevisionNo: number;
      parts?: Array<{ partNumber: number; etag: string }>;
    }): Promise<MultimodalUploadConfirmResult> {
      const sessionId = positiveId(input.sessionId, 'sessionId');
      const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
      const expectedRevisionNo = normalizeExpectedRevisionNo(input.expectedRevisionNo);
      const uploadToken = input.uploadToken;

      if (!objectStorageService) {
        fail('OBJECT_STORAGE_NOT_CONFIGURED', '对象存储尚未配置', 503, true);
      }
      if (!uploadTokenSecret) {
        fail('UPLOAD_TOKEN_NOT_CONFIGURED', '上传令牌服务尚未配置', 503, true);
      }

      const preflight: UploadConfirmPreflight = await withTransactionFn(async (db) => {
        const sessionResult = await db.query<SessionRow>(
          `select id,
                  display_name,
                  status,
                  creation_mode,
                  media_stage,
                  media_state_json,
                  confirmed_stages_json,
                  revision_no,
                  created_at,
                  updated_at
             from skill_guided_creation_sessions
            where id = $1
              and user_id = $2
              and creation_mode = $3
              and deleted_at is null
            for update`,
          [sessionId, input.authUserId, CREATION_MODE],
        );
        const sessionRow = sessionResult.rows[0];
        if (!sessionRow) {
          fail('GUIDED_SESSION_NOT_FOUND', '没有找到这个多模态会话', 404);
        }

        const { detail } = parseSessionRowForMutation(sessionRow);
        const mediaState = detail.mediaState;
        const pendingForHash = mediaState.pendingUpload;
        if (!pendingForHash) {
          fail('UPLOAD_ALREADY_CONFIRMED', '该上传已经确认或正在验证中', 409);
        }
        const requestHash = buildUploadConfirmRequestHash({
          action: 'skill.media.upload.confirm',
          sessionId,
          sourceId: pendingForHash.sourceId,
          objectKey: pendingForHash.objectKey,
          declaredMimeType: pendingForHash.declaredMimeType,
          sizeBytes: pendingForHash.sizeBytes,
          uploadMode: pendingForHash.uploadMode,
          intentRevisionNo: pendingForHash.intentRevisionNo,
          parts: input.parts,
        });

        const existingReceipt = getUploadConfirmReceipt(mediaState, idempotencyKey);
        if (existingReceipt) {
          if (existingReceipt.requestHash !== requestHash) {
            fail(
              'IDEMPOTENCY_KEY_REUSED',
              '相同 idempotencyKey 不能复用于不同请求',
              409,
            );
          }
          const pending = mediaState.pendingUpload;
          if (
            !pending ||
            pending.materialStatus !== 'verifying' ||
            !pending.verification ||
            pending.verification.idempotencyKey !== idempotencyKey ||
            pending.verification.requestHash !== requestHash
          ) {
            fail('MULTIMODAL_SESSION_FAILED', '上传确认 receipt 与 verification 不一致', 500);
          }
          return {
            kind: 'replay',
            result: {
              sessionId,
              revisionNo: existingReceipt.resultRevisionNo,
              mediaStage: 'uploading' as const,
              materialStatus: 'verifying' as const,
              jobId: pending.verification.jobId,
              observedSizeBytes: pending.verification.observedSizeBytes,
              observedContentType: pending.verification.observedContentType,
              jobType: 'media_quality_check' as const,
              replayed: true,
            },
          } satisfies UploadConfirmPreflight;
        }

        const pendingUpload = mediaState.pendingUpload;
        if (!pendingUpload) {
          fail('UPLOAD_NOT_STARTED', '没有进行中的上传', 422);
        }
        if (pendingUpload.materialStatus !== 'uploading') {
          fail('UPLOAD_ALREADY_CONFIRMED', '该上传已经确认或正在验证中', 409);
        }
        if (detail.revisionNo !== expectedRevisionNo) {
          fail('SESSION_REVISION_CONFLICT', '会话版本已变化，请刷新后重试', 409);
        }
        if (detail.mediaStage !== 'uploading') {
          fail('INVALID_MEDIA_STAGE', '当前阶段不允许执行该确认操作', 409);
        }

        if (!verifyUploadIntentToken({
          token: uploadToken,
          secret: uploadTokenSecret,
          binding: {
            sessionId,
            authUserId: input.authUserId,
            sourceId: pendingUpload.sourceId,
            objectKey: pendingUpload.objectKey,
            declaredMimeType: pendingUpload.declaredMimeType,
            sizeBytes: pendingUpload.sizeBytes,
            uploadMode: pendingUpload.uploadMode,
            ...(pendingUpload.uploadMode === 'multipart' && 'multipartUploadId' in pendingUpload
              ? {
                  multipartUploadId: (pendingUpload as PersistedUploadingMultipartPendingUpload).multipartUploadId,
                  partSizeBytes: (pendingUpload as PersistedUploadingMultipartPendingUpload).partSizeBytes,
                  partCount: (pendingUpload as PersistedUploadingMultipartPendingUpload).partCount,
                }
              : {}),
            intentRevisionNo: pendingUpload.intentRevisionNo,
          },
          now,
        })) {
          fail('UPLOAD_TOKEN_INVALID', '上传令牌无效', 422);
        }

        return {
          kind: 'execute',
          pendingUpload: pendingUpload as UploadingPendingUpload,
        } satisfies UploadConfirmPreflight;
      });

      if (preflight.kind === 'replay') {
        return preflight.result;
      }
      const pendingUpload = preflight.pendingUpload;
      const requestHash = buildUploadConfirmRequestHash({
        action: 'skill.media.upload.confirm',
        sessionId,
        sourceId: pendingUpload.sourceId,
        objectKey: pendingUpload.objectKey,
        declaredMimeType: pendingUpload.declaredMimeType,
        sizeBytes: pendingUpload.sizeBytes,
        uploadMode: pendingUpload.uploadMode,
        intentRevisionNo: pendingUpload.intentRevisionNo,
        parts: input.parts,
      });

      if (pendingUpload.uploadMode === 'multipart') {
        const multipartUpload = pendingUpload as PersistedUploadingMultipartPendingUpload;
        const partCount = multipartUpload.partCount;
        const parts = input.parts;
        if (!parts || parts.length !== partCount) {
          fail('UPLOAD_CONFIRM_PARTS', `multipart 需要 ${partCount} 个 part 的 ETag 列表`, 422);
        }
        for (let i = 0; i < parts.length; i += 1) {
          if (parts[i].partNumber !== i + 1) {
            fail('UPLOAD_CONFIRM_PARTS', `part 编号必须从 1 开始连续到 ${partCount}`, 422);
          }
          if (typeof parts[i].etag !== 'string' || !parts[i].etag.trim()) {
            fail('UPLOAD_CONFIRM_PARTS', 'ETag 不能为空', 422);
          }
        }
        const etagSet = new Set(parts.map((p) => p.etag));
        if (etagSet.size !== parts.length) {
          fail('UPLOAD_CONFIRM_PARTS', 'ETag 不能重复', 422);
        }
      } else if (input.parts) {
        fail('UPLOAD_CONFIRM_PARTS', '单次上传不能附带 parts', 422);
      }

      let observed: { sizeBytes: number; contentType: string } | null = null;

      if (pendingUpload.uploadMode === 'multipart') {
        const multipartUpload = pendingUpload as PersistedUploadingMultipartPendingUpload;
        try {
          await objectStorageService.completeMultipartUpload({
            objectKey: multipartUpload.objectKey,
            multipartUploadId: multipartUpload.multipartUploadId,
            parts: input.parts!,
          });
        } catch (error) {
          const headInfo = await objectStorageService.headObject({
            objectKey: multipartUpload.objectKey,
          }).catch(() => null);
          if (headInfo) {
            observed = { sizeBytes: headInfo.sizeBytes, contentType: headInfo.contentType };
          } else {
            throw error;
          }
        }

        if (!observed) {
          const headInfo = await objectStorageService.headObject({
            objectKey: multipartUpload.objectKey,
          });
          observed = { sizeBytes: headInfo.sizeBytes, contentType: headInfo.contentType };
        }
      } else {
        const headInfo = await objectStorageService.headObject({
          objectKey: pendingUpload.objectKey,
        });
        observed = { sizeBytes: headInfo.sizeBytes, contentType: headInfo.contentType };
      }

      if (!observed) {
        fail('UPLOAD_NOT_FOUND', '上传对象不存在', 422);
      }
      const { sizeBytes: observedSizeBytes, contentType: observedContentType } = observed;

      if (observedSizeBytes !== pendingUpload.sizeBytes) {
        fail('FILE_MISMATCH', '文件大小与预期不符', 422);
      }
      if (observedContentType !== pendingUpload.declaredMimeType) {
        fail('FILE_MISMATCH', '文件类型与预期不符', 422);
      }

      return withTransactionFn(async (db) => {
        const sessionResult = await db.query<SessionRow>(
          `select id,
                  display_name,
                  status,
                  creation_mode,
                  media_stage,
                  media_state_json,
                  confirmed_stages_json,
                  revision_no,
                  created_at,
                  updated_at
             from skill_guided_creation_sessions
            where id = $1
              and user_id = $2
              and creation_mode = $3
              and deleted_at is null
            for update`,
          [sessionId, input.authUserId, CREATION_MODE],
        );
        const sessionRow = sessionResult.rows[0];
        if (!sessionRow) {
          fail('GUIDED_SESSION_NOT_FOUND', '没有找到这个多模态会话', 404);
        }

        const { detail } = parseSessionRowForMutation(sessionRow);
        const mediaState = detail.mediaState;

        const existingReceipt = getUploadConfirmReceipt(mediaState, idempotencyKey);
        if (existingReceipt) {
          if (existingReceipt.requestHash !== requestHash) {
            fail(
              'IDEMPOTENCY_KEY_REUSED',
              '相同 idempotencyKey 不能复用于不同请求',
              409,
            );
          }
          const pending = mediaState.pendingUpload;
          if (
            !pending ||
            pending.materialStatus !== 'verifying' ||
            !pending.verification ||
            pending.verification.idempotencyKey !== idempotencyKey ||
            pending.verification.requestHash !== requestHash
          ) {
            fail('MULTIMODAL_SESSION_FAILED', '上传确认 receipt 与 verification 不一致', 500);
          }
          return {
            sessionId,
            revisionNo: existingReceipt.resultRevisionNo,
            mediaStage: 'uploading' as const,
            materialStatus: 'verifying' as const,
            jobId: pending.verification.jobId,
            observedSizeBytes: pending.verification.observedSizeBytes,
            observedContentType: pending.verification.observedContentType,
            jobType: 'media_quality_check' as const,
            replayed: true,
          };
        }

        const currentPendingUpload = mediaState.pendingUpload;
        if (
          !currentPendingUpload ||
          currentPendingUpload.materialStatus !== 'uploading'
        ) {
          fail('UPLOAD_ALREADY_CONFIRMED', '该上传已经确认或正在验证中', 409);
        }
        if (detail.mediaStage !== 'uploading') {
          fail('INVALID_MEDIA_STAGE', '当前阶段不允许执行该确认操作', 409);
        }
        if (detail.revisionNo !== expectedRevisionNo) {
          fail('SESSION_REVISION_CONFLICT', '会话版本已变化，请刷新后重试', 409);
        }

        const recordedAt = now().toISOString();
        const nextRevisionNo = expectedRevisionNo + 1;

        const jobResult = await createMediaJobInTransactionFn({
          db,
          sessionId,
          jobType: 'media_quality_check',
          idempotencyKey,
          requestHash,
          inputManifest: parseMediaQualityCheckJobInputManifest({
            schemaVersion: 1,
            sourceId: currentPendingUpload.sourceId,
            mediaKind: currentPendingUpload.mediaKind,
            objectKey: currentPendingUpload.objectKey,
            fileName: currentPendingUpload.fileName,
            expectedSizeBytes: currentPendingUpload.sizeBytes,
            expectedContentType: currentPendingUpload.declaredMimeType,
            uploadMode: currentPendingUpload.uploadMode,
          }),
        });

        const verification = {
          jobId: jobResult.jobId,
          idempotencyKey,
          requestHash,
          observedSizeBytes,
          observedContentType,
          confirmedAt: recordedAt,
        };

        const newPendingUpload = {
          ...currentPendingUpload,
          materialStatus: 'verifying' as const,
          verification,
        };

        const nextState = parseMultimodalSessionState({
          ...mediaState,
          pendingUpload: newPendingUpload,
          operationReceipts: [
            ...mediaState.operationReceipts,
            {
              action: 'skill.media.upload.confirm' as const,
              idempotencyKey,
              requestHash,
              baseRevisionNo: expectedRevisionNo,
              resultRevisionNo: nextRevisionNo,
              confirmedStage: 'uploading' as const,
              recordedAt,
            },
          ],
        });

        const updateResult = await db.query<SessionRow>(
          `update skill_guided_creation_sessions
              set updated_at = $1,
                  revision_no = $2,
                  media_state_json = $3::jsonb
            where id = $4
              and user_id = $5
              and creation_mode = $6
              and deleted_at is null
              and revision_no = $7
              and media_stage = $8
            returning id,
                      display_name,
                      status,
                      creation_mode,
                      media_stage,
                      media_state_json,
                      confirmed_stages_json,
                      revision_no,
                      created_at,
                      updated_at`,
          [
            recordedAt,
            nextRevisionNo,
            stableRequestHashJson(nextState),
            sessionId,
            input.authUserId,
            CREATION_MODE,
            expectedRevisionNo,
            detail.mediaStage,
          ],
        );
        const updatedRow = updateResult.rows[0];
        if (!updateResult.rowCount || !updatedRow) {
          fail('SESSION_REVISION_CONFLICT', '会话版本已变化，请刷新后重试', 409);
        }
        parseSessionRowForMutation(updatedRow);

        return {
          sessionId,
          revisionNo: nextRevisionNo,
          mediaStage: 'uploading' as const,
          materialStatus: 'verifying' as const,
          jobId: jobResult.jobId,
          observedSizeBytes,
          observedContentType,
          jobType: 'media_quality_check' as const,
          replayed: false,
        };
      });
    },

    async startProcessing(input: {
      authUserId: string;
      sessionId: string;
      idempotencyKey: string;
      expectedRevisionNo: number;
      understandingMode: ProcessingUnderstandingMode;
      transcriptionMode: ProcessingTranscriptionMode;
    }): Promise<MultimodalProcessStartResult> {
      const sessionId = positiveId(input.sessionId, 'sessionId');
      const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
      const expectedRevisionNo = normalizeExpectedRevisionNo(
        input.expectedRevisionNo,
      );
      const understandingMode = normalizeUnderstandingMode(
        input.understandingMode,
      );
      const transcriptionMode = normalizeTranscriptionMode(
        input.transcriptionMode,
      );

      return withTransactionFn(async (db: Queryable) => {
        const sessionResult = await db.query<SessionRow>(
          `select id,
                  display_name,
                  status,
                  creation_mode,
                  media_stage,
                  media_state_json,
                  confirmed_stages_json,
                  revision_no,
                  package_version_id,
                  deleted_at,
                  created_at,
                  updated_at
             from skill_guided_creation_sessions
            where id = $1
              and user_id = $2
              and creation_mode = $3
              and deleted_at is null
            for update`,
          [sessionId, input.authUserId, CREATION_MODE],
        );
        const row = sessionResult.rows[0];
        if (!row) {
          fail('GUIDED_SESSION_NOT_FOUND', '没有找到这个多模态会话', 404);
        }
        const detail = mapSessionRowInternal(row);
        if (
          detail.mediaStage === 'preparing_media' &&
          detail.revisionNo === expectedRevisionNo + 1
        ) {
          const replayResult = await db.query<JobRow>(
            `select id,
                    session_id,
                    job_type,
                    status,
                    idempotency_key,
                    request_hash,
                    attempt_no,
                    max_attempts,
                    progress_json,
                    input_manifest_json,
                    output_manifest_json,
                    result_hash,
                    error_json
               from skill_media_jobs
              where session_id = $1
                and job_type = 'media_prepare'
                and idempotency_key = $2
              limit 1
              for update`,
            [sessionId, idempotencyKey],
          );
          const replayRow = replayResult.rows[0];
          if (replayRow) {
            const replayJob = parseJobRow(replayRow);
            const processingConfig = replayJob.inputManifest.processingConfig;
            const configMatches =
              processingConfig !== null &&
              typeof processingConfig === 'object' &&
              !Array.isArray(processingConfig) &&
              (processingConfig as Record<string, unknown>).understandingMode ===
                understandingMode &&
              (processingConfig as Record<string, unknown>).transcriptionMode ===
                transcriptionMode;
            const replayHash = buildProcessStartRequestHash({
              sessionId,
              expectedRevisionNo,
              inputManifest: replayJob.inputManifest,
            });
            if (
              !configMatches ||
              !safeCompareHexHash(replayJob.requestHash, replayHash)
            ) {
              fail(
                'IDEMPOTENCY_KEY_REUSED',
                '相同 idempotencyKey 不能复用于不同请求',
                409,
              );
            }
            return {
              sessionId,
              revisionNo: detail.revisionNo,
              mediaStage: 'preparing_media',
              job: toJobActionResult(replayJob),
              pipelinePlan: readProcessingPipelinePlan(
                replayJob.inputManifest,
              ),
              replayed: true,
            };
          }
        }
        if (detail.revisionNo !== expectedRevisionNo) {
          fail('SESSION_REVISION_CONFLICT', '会话版本已变化，请刷新后重试', 409);
        }
        if (detail.mediaStage !== 'ready_to_process') {
          fail('INVALID_STATE_TRANSITION', '当前阶段不能启动媒体处理', 409);
        }
        const primarySource = detail.mediaState.primarySource;
        if (!primarySource || detail.mediaState.pendingUpload !== null) {
          fail('INVALID_STATE_TRANSITION', '主要媒体源尚未完成可信验收', 409);
        }

        const qualityResult = await db.query<JobRow>(
          `select id,
                  session_id,
                  job_type,
                  status,
                  idempotency_key,
                  request_hash,
                  attempt_no,
                  max_attempts,
                  progress_json,
                  input_manifest_json,
                  output_manifest_json,
                  result_hash,
                  error_json
             from skill_media_jobs
            where session_id = $1
              and job_type = 'media_quality_check'
              and status = 'succeeded'
            order by created_at desc, id desc
            limit 1
            for update`,
          [sessionId],
        );
        const qualityRow = qualityResult.rows[0];
        if (!qualityRow) {
          fail('INVALID_STATE_TRANSITION', '主要媒体源缺少可信验收记录', 409);
        }
        const qualityJob = parseJobRow(qualityRow);
        let qualityOutput;
        try {
          qualityOutput = parseMediaQualityCheckOutputManifest(
            qualityJob.outputManifest,
          );
        } catch {
          fail('MULTIMODAL_SESSION_FAILED', '媒体验收记录损坏', 500);
        }
        if (
          qualityOutput.sessionId !== sessionId ||
          qualityOutput.sourceId !== primarySource.sourceId ||
          qualityOutput.sourceKind !== primarySource.kind ||
          stableRequestHashJson(qualityOutput.sourceAsset) !==
            stableRequestHashJson(primarySource.assetRef)
        ) {
          fail('MULTIMODAL_SESSION_FAILED', '媒体验收记录与主要源不一致', 500);
        }

        const pipelinePlan = {
          transcribe: primarySource.kind === 'audio' || qualityOutput.probe.hasAudio,
          frameMaterialize: primarySource.kind === 'video',
          visualOnly:
            primarySource.kind === 'video' && !qualityOutput.probe.hasAudio,
        };
        const inputManifest = {
          schemaVersion: 1,
          sessionId,
          sourceId: primarySource.sourceId,
          sourceKind: primarySource.kind,
          sourceAsset: primarySource.assetRef,
          sourceProbe: qualityOutput.probe,
          qualityManifestRef: qualityOutput.resultManifestRef,
          processingConfig: {
            understandingMode,
            transcriptionMode,
          },
          pipelinePlan,
        };
        const requestHash = buildProcessStartRequestHash({
          sessionId,
          expectedRevisionNo,
          inputManifest,
        });
        const job = await createMediaJobInTransactionFn({
          db,
          sessionId,
          jobType: 'media_prepare',
          idempotencyKey,
          requestHash,
          inputManifest,
        });
        const nextStage: MediaStage = 'preparing_media';
        assertTransition(
          detail.mediaStage,
          nextStage,
          parseConfirmedStages(row.confirmed_stages_json ?? []),
        );
        const updated = await db.query<SessionRow>(
          `update skill_guided_creation_sessions
              set status = $4,
                  media_stage = $5,
                  revision_no = revision_no + 1,
                  updated_at = $6
            where id = $1
              and user_id = $2
              and creation_mode = $3
              and deleted_at is null
              and revision_no = $7
              and media_stage = 'ready_to_process'
          returning id,
                    display_name,
                    status,
                    creation_mode,
                    media_stage,
                    media_state_json,
                    confirmed_stages_json,
                    revision_no,
                    created_at,
                    updated_at`,
          [
            sessionId,
            input.authUserId,
            CREATION_MODE,
            getGuidedCreationStatusForMediaStage(nextStage),
            nextStage,
            now().toISOString(),
            expectedRevisionNo,
          ],
        );
        const updatedRow = updated.rows[0];
        if (!updatedRow) {
          fail('SESSION_REVISION_CONFLICT', '会话版本已变化，请刷新后重试', 409);
        }
        const updatedDetail = mapSessionRowInternal(updatedRow);
        return {
          sessionId,
          revisionNo: updatedDetail.revisionNo,
          mediaStage: 'preparing_media',
          job,
          pipelinePlan,
          replayed: false,
        };
      });
    },

    async retryProcessing(input: {
      authUserId: string;
      sessionId: string;
      idempotencyKey: string;
      expectedRevisionNo: number;
      failedJobId?: string;
    }): Promise<MultimodalRetryResult> {
      const sessionId = positiveId(input.sessionId, 'sessionId');
      const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
      const expectedRevisionNo = normalizeExpectedRevisionNo(
        input.expectedRevisionNo,
      );

      if (input.failedJobId === undefined) {
        const snapshot = await (
          deps.pipelineFailureResumer ?? createMultimodalPipelineStore()
        ).resumePipelineFailure({
          authUserId: input.authUserId,
          sessionId,
          expectedRevisionNo,
        });
        return {
          sessionId,
          revisionNo: snapshot.revisionNo,
          mediaStage: snapshot.mediaStage,
          retriedJobId: null,
          job: null,
          replayed: false,
        };
      }

      const failedJobId = positiveId(input.failedJobId, 'failedJobId');

      return withTransactionFn(async (db: Queryable) => {
        const sessionResult = await db.query<SessionRow>(
          `select id,
                  display_name,
                  status,
                  creation_mode,
                  media_stage,
                  media_state_json,
                  confirmed_stages_json,
                  revision_no,
                  created_at,
                  updated_at
             from skill_guided_creation_sessions
            where id = $1
              and user_id = $2
              and creation_mode = $3
              and deleted_at is null
            for update`,
          [sessionId, input.authUserId, CREATION_MODE],
        );
        const row = sessionResult.rows[0];
        if (!row) {
          fail('GUIDED_SESSION_NOT_FOUND', '没有找到这个多模态会话', 404);
        }
        const detail = mapSessionRowInternal(row);
        const isFreshRetry =
          detail.revisionNo === expectedRevisionNo &&
          detail.mediaStage === 'failed';
        const isReplayCandidate =
          detail.revisionNo === expectedRevisionNo + 1 &&
          detail.mediaStage !== 'failed';
        if (!isFreshRetry && !isReplayCandidate) {
          if (detail.revisionNo !== expectedRevisionNo) {
            fail('SESSION_REVISION_CONFLICT', '会话版本已变化，请刷新后重试', 409);
          }
          fail('INVALID_STATE_TRANSITION', '当前会话没有可重试的失败阶段', 409);
        }

        const jobResult = await db.query<JobRow>(
          `select id,
                  session_id,
                  job_type,
                  status,
                  idempotency_key,
                  request_hash,
                  attempt_no,
                  max_attempts,
                  progress_json,
                  input_manifest_json,
                  output_manifest_json,
                  result_hash,
                  error_json
             from skill_media_jobs
            where id = $1
              and session_id = $2
            for update`,
          [failedJobId, sessionId],
        );
        const failedJobRow = jobResult.rows[0];
        if (!failedJobRow) {
          fail('NOT_RETRYABLE', '失败任务不存在或不属于当前会话', 422);
        }
        const failedJob = parseJobRow(failedJobRow);
        const retryable =
          failedJob.error?.retryable === true ||
          RETRYABLE_AFTER_WORKER_UPGRADE.has(
            `${failedJob.jobType}:${failedJob.error?.code ?? ''}`,
          );
        const resumeFromStage = failedJob.error?.details &&
          typeof failedJob.error.details === 'object' &&
          !Array.isArray(failedJob.error.details)
          ? (failedJob.error.details as Record<string, unknown>).resumeFromStage
          : undefined;
        if (
          failedJob.status !== 'failed' ||
          !retryable ||
          typeof resumeFromStage !== 'string'
        ) {
          fail('NOT_RETRYABLE', '该失败任务不可重试', 422);
        }
        let resumeStage: MediaStage;
        try {
          resumeStage = readMediaStage(resumeFromStage);
          assertResumeFromFailed(resumeStage);
          assertMediaStageGate({
            targetStage: resumeStage,
            confirmedStages: parseConfirmedStages(row.confirmed_stages_json ?? []),
          });
        } catch {
          fail('NOT_RETRYABLE', '失败任务没有合法的恢复阶段', 422);
        }

        const requestHash = buildRetryRequestHash({
          sessionId,
          failedJobId,
          jobType: failedJob.jobType,
          inputManifest: failedJob.inputManifest,
        });
        if (isReplayCandidate) {
          if (detail.mediaStage !== resumeStage) {
            fail('SESSION_REVISION_CONFLICT', '会话版本已变化，请刷新后重试', 409);
          }
          const replayResult = await db.query<JobRow>(
            `select id,
                    session_id,
                    job_type,
                    status,
                    idempotency_key,
                    request_hash,
                    attempt_no,
                    max_attempts,
                    progress_json,
                    input_manifest_json,
                    output_manifest_json,
                    result_hash,
                    error_json
               from skill_media_jobs
              where session_id = $1
                and job_type = $2
                and idempotency_key = $3
              limit 1
              for update`,
            [sessionId, failedJob.jobType, idempotencyKey],
          );
          const replayRow = replayResult.rows[0];
          if (!replayRow) {
            fail('SESSION_REVISION_CONFLICT', '会话版本已变化，请刷新后重试', 409);
          }
          const replayJob = parseJobRow(replayRow);
          if (!safeCompareHexHash(replayJob.requestHash, requestHash)) {
            fail(
              'IDEMPOTENCY_KEY_REUSED',
              '相同 idempotencyKey 不能复用于不同请求',
              409,
            );
          }
          return {
            sessionId,
            revisionNo: detail.revisionNo,
            mediaStage: resumeStage,
            retriedJobId: failedJobId,
            job: toJobActionResult(replayJob),
            replayed: true,
          };
        }
        const job = await createMediaJobInTransactionFn({
          db,
          sessionId,
          jobType: failedJob.jobType,
          idempotencyKey,
          requestHash,
          inputManifest: failedJob.inputManifest,
          maxAttempts: failedJob.maxAttempts,
        });
        const updated = await db.query<SessionRow>(
          `update skill_guided_creation_sessions
              set status = $4,
                  media_stage = $5,
                  revision_no = revision_no + 1,
                  updated_at = $6
            where id = $1
              and user_id = $2
              and creation_mode = $3
              and deleted_at is null
              and revision_no = $7
              and media_stage = 'failed'
          returning id,
                    display_name,
                    status,
                    creation_mode,
                    media_stage,
                    media_state_json,
                    confirmed_stages_json,
                    revision_no,
                    created_at,
                    updated_at`,
          [
            sessionId,
            input.authUserId,
            CREATION_MODE,
            getGuidedCreationStatusForMediaStage(resumeStage),
            resumeStage,
            now().toISOString(),
            expectedRevisionNo,
          ],
        );
        const updatedRow = updated.rows[0];
        if (!updatedRow) {
          fail('SESSION_REVISION_CONFLICT', '会话版本已变化，请刷新后重试', 409);
        }
        return {
          sessionId,
          revisionNo: mapSessionRowInternal(updatedRow).revisionNo,
          mediaStage: resumeStage,
          retriedJobId: failedJobId,
          job,
          replayed: false,
        };
      });
    },

    async cancelProcessing(input: {
      authUserId: string;
      sessionId: string;
      expectedRevisionNo: number;
    }): Promise<{
      sessionId: string;
      revisionNo: number;
      mediaStage: 'cancelled';
      cancelledJobCount: number;
    }> {
      const sessionId = positiveId(input.sessionId, 'sessionId');
      const expectedRevisionNo = normalizeExpectedRevisionNo(
        input.expectedRevisionNo,
      );
      return withTransactionFn(async (db: Queryable) => {
        const sessionResult = await db.query<SessionRow>(
          `select id,
                  display_name,
                  status,
                  creation_mode,
                  media_stage,
                  media_state_json,
                  confirmed_stages_json,
                  revision_no,
                  created_at,
                  updated_at
             from skill_guided_creation_sessions
            where id = $1
              and user_id = $2
              and creation_mode = $3
              and deleted_at is null
            for update`,
          [sessionId, input.authUserId, CREATION_MODE],
        );
        const row = sessionResult.rows[0];
        if (!row) {
          fail('GUIDED_SESSION_NOT_FOUND', '没有找到这个多模态会话', 404);
        }
        const detail = mapSessionRowInternal(row);
        if (detail.revisionNo !== expectedRevisionNo) {
          fail('SESSION_REVISION_CONFLICT', '会话版本已变化，请刷新后重试', 409);
        }
        if (!canCancelMediaStage(detail.mediaStage)) {
          fail('INVALID_STATE_TRANSITION', '当前阶段不能取消', 409);
        }
        assertTransition(
          detail.mediaStage,
          'cancelled',
          parseConfirmedStages(row.confirmed_stages_json ?? []),
        );
        const timestamp = now().toISOString();
        const cancelledJobs = await db.query<{ id: unknown }>(
          `update skill_media_jobs
              set status = 'cancelled',
                  cancel_requested_at = coalesce(cancel_requested_at, $2),
                  finished_at = coalesce(finished_at, $2),
                  lease_owner = null,
                  lease_token_hash = null,
                  lease_expires_at = null,
                  heartbeat_at = null,
                  updated_at = $2
            where session_id = $1
              and status in ('queued', 'leased')
          returning id`,
          [sessionId, timestamp],
        );
        const updated = await db.query<SessionRow>(
          `update skill_guided_creation_sessions
              set status = 'cancelled',
                  media_stage = 'cancelled',
                  revision_no = revision_no + 1,
                  updated_at = $4
            where id = $1
              and user_id = $2
              and creation_mode = $3
              and deleted_at is null
              and revision_no = $5
          returning id,
                    display_name,
                    status,
                    creation_mode,
                    media_stage,
                    media_state_json,
                    confirmed_stages_json,
                    revision_no,
                    created_at,
                    updated_at`,
          [sessionId, input.authUserId, CREATION_MODE, timestamp, expectedRevisionNo],
        );
        const updatedRow = updated.rows[0];
        if (!updatedRow) {
          fail('SESSION_REVISION_CONFLICT', '会话版本已变化，请刷新后重试', 409);
        }
        return {
          sessionId,
          revisionNo: mapSessionRowInternal(updatedRow).revisionNo,
          mediaStage: 'cancelled',
          cancelledJobCount: cancelledJobs.rows.length,
        };
      });
    },

    async deleteSession(input: {
      authUserId: string;
      sessionId: string;
      expectedRevisionNo: number;
    }): Promise<{ sessionId: string; revisionNo: number; deletedAt: string }> {
      const sessionId = positiveId(input.sessionId, 'sessionId');
      const expectedRevisionNo = normalizeExpectedRevisionNo(
        input.expectedRevisionNo,
      );
      return withTransactionFn(async (db: Queryable) => {
        const sessionResult = await db.query<SessionRow>(
          `select id,
                  display_name,
                  status,
                  creation_mode,
                  media_stage,
                  media_state_json,
                  confirmed_stages_json,
                  revision_no,
                  package_version_id,
                  deleted_at,
                  created_at,
                  updated_at
             from skill_guided_creation_sessions
            where id = $1
              and user_id = $2
              and creation_mode = $3
              and deleted_at is null
            for update`,
          [sessionId, input.authUserId, CREATION_MODE],
        );
        const row = sessionResult.rows[0];
        if (!row) {
          fail('GUIDED_SESSION_NOT_FOUND', '没有找到这个多模态会话', 404);
        }
        const detail = mapSessionRowInternal(row);
        if (detail.revisionNo !== expectedRevisionNo) {
          fail('SESSION_REVISION_CONFLICT', '会话版本已变化，请刷新后重试', 409);
        }
        if (
          detail.mediaStage === 'published' ||
          detail.status === 'completed' ||
          row.package_version_id !== null && row.package_version_id !== undefined
        ) {
          fail('PUBLISHED_ASSET_IN_USE', '已发布资产不能通过工作区删除', 409);
        }
        const timestamp = now().toISOString();
        await db.query<{ id: unknown }>(
          `update skill_media_jobs
              set status = 'cancelled',
                  cancel_requested_at = coalesce(cancel_requested_at, $2),
                  finished_at = coalesce(finished_at, $2),
                  lease_owner = null,
                  lease_token_hash = null,
                  lease_expires_at = null,
                  heartbeat_at = null,
                  updated_at = $2
            where session_id = $1
              and status in ('queued', 'leased')
          returning id`,
          [sessionId, timestamp],
        );
        const deleted = await db.query<{
          id: unknown;
          revision_no: unknown;
          deleted_at: unknown;
        }>(
          `update skill_guided_creation_sessions
              set deleted_at = $4,
                  revision_no = revision_no + 1,
                  updated_at = $4
            where id = $1
              and user_id = $2
              and creation_mode = $3
              and deleted_at is null
              and revision_no = $5
          returning id, revision_no, deleted_at`,
          [sessionId, input.authUserId, CREATION_MODE, timestamp, expectedRevisionNo],
        );
        const deletedRow = deleted.rows[0];
        if (!deletedRow) {
          fail('SESSION_REVISION_CONFLICT', '会话版本已变化，请刷新后重试', 409);
        }
        return {
          sessionId: persistedPositiveId(String(deletedRow.id), 'sessionId'),
          revisionNo: readRevisionNo(deletedRow.revision_no, 'revisionNo'),
          deletedAt: asIso(deletedRow.deleted_at, 'deletedAt'),
        };
      });
    },

    async listSessions(input: {
      authUserId: string;
      limit?: number;
      cursor?: string;
    }): Promise<{ items: MultimodalSessionSummary[]; nextCursor: string | null }> {
      const limit = normalizeLimit(input.limit);
      const cursor = normalizeCursor(input.cursor);
      const values: unknown[] = [input.authUserId];
      const where = [
        'user_id = $1',
        `creation_mode = '${CREATION_MODE}'`,
        'deleted_at is null',
      ];

      if (cursor) {
        values.push(cursor);
        where.push(`updated_at < $${values.length}::timestamptz`);
      }

      values.push(limit + 1);
      const result = await queryFn<SessionRow>(
        `select id,
                display_name,
                status,
                creation_mode,
                media_stage,
                media_state_json,
                revision_no,
                created_at,
                updated_at
           from skill_guided_creation_sessions
          where ${where.join(' and ')}
          order by updated_at desc, id desc
          limit $${values.length}`,
        values,
      );
      const hasMore = result.rows.length > limit;
      const rows = result.rows.slice(0, limit);
      return {
        items: rows.map((row) => toSummary(mapSessionRow(row))),
        nextCursor: hasMore
          ? asIso(rows[rows.length - 1]?.updated_at, 'updatedAt')
          : null,
      };
    },

    async getSessionDetail(input: {
      authUserId: string;
      sessionId: string;
    }): Promise<MultimodalSessionDetail> {
      const result = await queryFn<SessionRow>(
        `select id,
                display_name,
                status,
                creation_mode,
                media_stage,
                media_state_json,
                error_json,
                validation_result_json,
                confirmation_json,
                revision_no,
                created_at,
                updated_at
           from skill_guided_creation_sessions
          where id = $1
            and user_id = $2
            and creation_mode = $3
            and deleted_at is null`,
        [positiveId(input.sessionId, 'sessionId'), input.authUserId, CREATION_MODE],
      );
      const row = result.rows[0];
      if (!row) {
        fail('GUIDED_SESSION_NOT_FOUND', '没有找到这个多模态会话', 404);
      }
      return {
        ...mapSessionRow(row),
        ...readMultimodalReleaseStatus({
          validationResult: row.validation_result_json,
          confirmation: row.confirmation_json,
        }),
      };
    },

    async createAssetPreview(input: {
      authUserId: string;
      sessionId: string;
      objectKey: string;
    }): Promise<{
      url: string;
      expiresAt: string;
      mimeType: string;
    }> {
      const objectKey = input.objectKey.trim();
      const detail = await this.getSessionDetail({
        authUserId: input.authUserId,
        sessionId: input.sessionId,
      });
      if (!collectReferencedAssetKeys(detail.mediaState).has(objectKey)) {
        fail('MEDIA_ASSET_NOT_FOUND', '没有找到这个会话中的媒体资产', 404);
      }
      if (!objectStorageService) {
        fail(
          'MULTIMODAL_PREVIEW_UNAVAILABLE',
          '媒体预览暂时不可用，请稍后重试。',
          503,
          true,
        );
      }
      const assetRefs = [
        detail.mediaState.primarySource?.assetRef,
        ...detail.mediaState.evidenceTimeline.evidenceItems.flatMap((item) => [
          item.assetRef,
          item.source.relatedAssetRef,
        ]),
      ];
      const asset = assetRefs.find((item) => item?.objectKey === objectKey);
      if (!asset) {
        fail('MEDIA_ASSET_NOT_FOUND', '没有找到这个会话中的媒体资产', 404);
      }
      try {
        const grant = await objectStorageService.createSignedGetGrant({
          objectKey,
          expiresInSeconds: 300,
        });
        return {
          url: grant.url,
          expiresAt: grant.expiresAt,
          mimeType: asset.mimeType,
        };
      } catch {
        fail(
          'MULTIMODAL_PREVIEW_UNAVAILABLE',
          '媒体预览暂时不可用，请稍后重试。',
          503,
          true,
        );
      }
    },

    async getSessionProgress(input: {
      authUserId: string;
      sessionId: string;
    }): Promise<MultimodalSessionProgress> {
      const detail = await this.getSessionDetail(input);
      const jobResult = await queryFn<JobRow>(
        `select id,
                session_id,
                job_type,
                status,
                idempotency_key,
                request_hash,
                attempt_no,
                max_attempts,
                progress_json,
                input_manifest_json,
                output_manifest_json,
                result_hash,
                error_json
           from skill_media_jobs
          where session_id = $1
          order by created_at desc, id desc
          limit 1`,
        [detail.sessionId],
      );
      const currentJob = jobResult.rows[0]
        ? (() => {
            const job = parseJobRow(jobResult.rows[0]);
            if (job.sessionId !== detail.sessionId) {
              fail('MULTIMODAL_SESSION_FAILED', '媒体任务归属漂移', 500);
            }
            return sanitizeProgress(job);
          })()
        : null;

      return {
        ...toSummary(detail),
        currentJob,
      };
    },
  };
}

export const __testing = {
  buildProcessStartRequestHash,
  buildRetryRequestHash,
  buildUploadIntentRequestHash,
  buildUploadConfirmRequestHash,
  buildUploadIntentClaimsHash,
  issueUploadIntentToken,
  verifyUploadIntentToken,
};
