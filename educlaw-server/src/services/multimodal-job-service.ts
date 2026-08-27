import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  MEDIA_JOB_TYPES,
  parseMultimodalSessionState,
  type MediaJobType,
  type MediaStage,
  type MultimodalPrimarySource,
  type MultimodalSessionState,
} from '@educlaw/shared';
import { withTransaction, type Queryable } from './db.js';
import { config } from '../config.js';
import { createObjectStorageService } from './object-storage/object-storage.service.js';
import { getGuidedCreationStatusForMediaStage } from './media-session-state-machine.js';
import {
  createMultimodalJobStore,
  type MultimodalSessionCreateRow,
  type StoredMultimodalJob,
} from './multimodal-job-store.js';
import {
  buildMediaQualityCheckResultHash,
  parseMediaQualityCheckJobInputManifest,
  parseMediaQualityCheckOutputManifest,
} from './media-quality-check-contract.js';
import {
  buildFrameAssetKey,
  buildDistillationResultHash,
  buildJobResultManifestKey,
  buildNormalizedAudioKey,
  buildTranscriptAssetKey,
  buildTranscriptChunkManifestKey,
  parseFrameMaterializeOutputManifest,
  parseMediaPrepareOutputManifest,
  parseTranscribeOutputManifest,
} from './media-distillation-contract.js';
import { readObjectStorageConfig } from '../config/object-storage-config.js';

const REQUEST_HASH_HEX = /^[0-9a-f]{64}$/;
const MAX_ATTEMPTS_LIMIT = 10;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_LEASE_MS = 60_000;
const MAX_TRANSCRIPT_CHUNKS = 256;
const SESSION_STATUSES = [
  'collecting',
  'ready_for_confirmation',
  'finalizing',
  'completed',
  'failed',
  'cancelled',
] as const;
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

type TransactionClient = Parameters<Parameters<typeof withTransaction>[0]>[0];

interface JobStoreContract {
  loadSessionForCreate(input: {
    db: Queryable;
    sessionId: string;
  }): Promise<MultimodalSessionCreateRow | null>;
  tryInsertJob(input: {
    db: Queryable;
    sessionId: string;
    jobType: MediaJobType;
    idempotencyKey: string;
    requestHash: string;
    maxAttempts: number;
    progress: Record<string, unknown>;
    inputManifest: Record<string, unknown>;
    now: Date;
  }): Promise<StoredMultimodalJob | null>;
  findJobByIdempotencyKey(input: {
    db: Queryable;
    sessionId: string;
    jobType: MediaJobType;
    idempotencyKey: string;
  }): Promise<StoredMultimodalJob | null>;
  claimNextJob(input: {
    db: Queryable;
    now: Date;
    acceptedJobTypes: readonly MediaJobType[];
    leaseOwner: string;
    leaseTokenHash: string;
    leaseExpiresAt: Date;
  }): Promise<StoredMultimodalJob | null>;
  loadJobForLeaseMutation(input: {
    db: Queryable;
    jobId: string;
  }): Promise<StoredMultimodalJob | null>;
  updateHeartbeat(input: {
    db: Queryable;
    jobId: string;
    progress: Record<string, unknown>;
    heartbeatAt: Date;
    leaseExpiresAt: Date;
  }): Promise<{
    jobId: string;
    status: StoredMultimodalJob['status'];
    leaseExpiresAt: string | null;
    progress: Record<string, unknown>;
  }>;
  completeJob(input: {
    db: Queryable;
    jobId: string;
    resultHash: string;
    outputManifest: Record<string, unknown>;
    finishedAt: Date;
  }): Promise<{
    jobId: string;
    status: StoredMultimodalJob['status'];
    resultHash: string | null;
    outputManifest: Record<string, unknown> | null;
    finishedAt: string | null;
    replayed: boolean;
  }>;
  failJob(input: {
    db: Queryable;
    jobId: string;
    status: 'queued' | 'failed';
    error: Record<string, unknown>;
    now: Date;
    availableAt: Date | null;
    finishedAt: Date | null;
  }): Promise<{
    jobId: string;
    status: StoredMultimodalJob['status'];
    availableAt: string | null;
    finishedAt: string | null;
    retryScheduled: boolean;
  }>;
  recycleExpiredLeases(input: { db: Queryable; now: Date }): Promise<
    Array<{
      jobId: string;
      sessionId: string;
      jobType: MediaJobType;
      status: StoredMultimodalJob['status'];
      availableAt: string | null;
      finishedAt: string | null;
      retryScheduled: boolean;
    }>
  >;
  cancelJob(input: { db: Queryable; jobId: string; now: Date }): Promise<{
    jobId: string;
    status: StoredMultimodalJob['status'];
    cancelRequestedAt: string | null;
    finishedAt: string | null;
  } | null>;
}

interface JobServiceDeps {
  withTransaction: <T>(
    work: (client: TransactionClient) => Promise<T>,
  ) => Promise<T>;
  store: JobStoreContract;
  now: () => Date;
  generateLeaseToken: () => string;
  hashLeaseToken: (token: string) => string;
  objectStorageService?: {
    createSignedGetGrant(input: {
      objectKey: string;
      expiresInSeconds?: number;
    }): Promise<{
      method: string;
      objectKey: string;
      url: string;
      expiresAt: string;
      requiredHeaders: Record<string, string>;
    }>;
    createSignedPutGrant(input: {
      objectKey: string;
      contentType: string;
      expiresInSeconds?: number;
    }): Promise<{
      method: string;
      objectKey: string;
      url: string;
      expiresAt: string;
      requiredHeaders: Record<string, string>;
    }>;
  };
}

interface MediaSessionMutationRow {
  id: unknown;
  status: unknown;
  creation_mode: unknown;
  media_stage: unknown;
  media_state_json: unknown;
  revision_no: unknown;
  updated_at?: unknown;
}

interface CreateMediaJobInput {
  sessionId: string;
  jobType: MediaJobType;
  idempotencyKey: string;
  requestHash: string;
  inputManifest: unknown;
  maxAttempts?: number;
}

interface NormalizedCreateMediaJobInput {
  sessionId: string;
  jobType: MediaJobType;
  idempotencyKey: string;
  requestHash: string;
  inputManifest: Record<string, unknown>;
  maxAttempts: number;
}

interface RuntimeGrantJob {
  jobId: string;
  sessionId: string;
  jobType: MediaJobType;
  attemptNo: number;
  inputManifest: Record<string, unknown>;
}

export class MultimodalJobServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly retryable = false,
  ) {
    super(message);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new MultimodalJobServiceError(
      'INVALID_ARGUMENT',
      `${fieldName} must be a non-empty string`,
      422,
    );
  }
  return value;
}

function assertPositiveId(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new MultimodalJobServiceError(
      'INVALID_ARGUMENT',
      `${fieldName} must be a positive integer string`,
      422,
    );
  }
  return value;
}

function assertHexHash(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !REQUEST_HASH_HEX.test(value)) {
    throw new MultimodalJobServiceError(
      'INVALID_ARGUMENT',
      `${fieldName} must be a 64-character lowercase sha256 hex string`,
      422,
    );
  }
  return value;
}

function assertNonNegativeInteger(value: unknown, fieldName: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    !Number.isSafeInteger(value)
  ) {
    throw createDataIntegrityError(`${fieldName} must be a non-negative integer`);
  }
  return value;
}

function assertJobType(value: unknown, fieldName: string): MediaJobType {
  if (
    typeof value !== 'string' ||
    !MEDIA_JOB_TYPES.includes(value as MediaJobType)
  ) {
    throw new MultimodalJobServiceError(
      'INVALID_ARGUMENT',
      `${fieldName} must be a supported media job type`,
      422,
    );
  }
  return value as MediaJobType;
}

function assertAcceptedJobTypes(value: unknown): MediaJobType[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new MultimodalJobServiceError(
      'INVALID_ARGUMENT',
      'acceptedJobTypes must be a non-empty array',
      422,
    );
  }
  return value.map((item, index) =>
    assertJobType(item, `acceptedJobTypes[${index}]`),
  );
}

function assertObject(
  value: unknown,
  fieldName: string,
): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new MultimodalJobServiceError(
      'INVALID_ARGUMENT',
      `${fieldName} must be an object`,
      422,
    );
  }
  return value;
}

const SENSITIVE_TEXT_PATTERN =
  /(https?:\/\/|authorization|bearer\s|token|grant|lease-|\/tmp\/|\\tmp\\|[A-Za-z]:\\|file:)/i;

function assertSafeWorkerText(
  value: unknown,
  fieldName: string,
  maxLength = 256,
): string {
  const text = assertNonEmptyString(value, fieldName);
  if (text.length > maxLength || SENSITIVE_TEXT_PATTERN.test(text)) {
    throw new MultimodalJobServiceError(
      'INVALID_ARGUMENT',
      `${fieldName} contains sensitive or invalid text`,
      422,
    );
  }
  return text;
}

function sanitizeHeartbeatProgress(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const allowedKeys = new Set([
    'phase',
    'percent',
    'bytesDownloaded',
    'bytesTotal',
    'chunkIndex',
    'chunkCount',
  ]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new MultimodalJobServiceError(
        'INVALID_ARGUMENT',
        `progress.${key} is not allowed`,
        422,
      );
    }
  }
  const sanitized: Record<string, unknown> = {};
  if (value.phase !== undefined) {
    sanitized.phase = assertSafeWorkerText(value.phase, 'progress.phase', 64);
  }
  if (value.percent !== undefined) {
    const percent = assertNonNegativeInteger(value.percent, 'progress.percent');
    if (percent > 100) {
      throw new MultimodalJobServiceError(
        'INVALID_ARGUMENT',
        'progress.percent must be <= 100',
        422,
      );
    }
    sanitized.percent = percent;
  }
  if (value.bytesDownloaded !== undefined) {
    sanitized.bytesDownloaded = assertNonNegativeInteger(
      value.bytesDownloaded,
      'progress.bytesDownloaded',
    );
  }
  if (value.bytesTotal !== undefined) {
    sanitized.bytesTotal = assertNonNegativeInteger(
      value.bytesTotal,
      'progress.bytesTotal',
    );
  }
  if (value.chunkIndex !== undefined || value.chunkCount !== undefined) {
    const chunkIndex = assertNonNegativeInteger(
      value.chunkIndex,
      'progress.chunkIndex',
    );
    const chunkCount = assertNonNegativeInteger(
      value.chunkCount,
      'progress.chunkCount',
    );
    if (
      chunkCount < 1 ||
      chunkCount > MAX_TRANSCRIPT_CHUNKS ||
      chunkIndex >= chunkCount
    ) {
      throw new MultimodalJobServiceError(
        'INVALID_ARGUMENT',
        'progress chunk position is invalid',
        422,
      );
    }
    sanitized.chunkIndex = chunkIndex;
    sanitized.chunkCount = chunkCount;
  }
  return sanitized;
}

function sanitizeFailureDetails(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const allowedKeys = new Set(['phase', 'reason', 'statusCode', 'retryAfterMs']);
  const sanitized: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new MultimodalJobServiceError(
        'INVALID_ARGUMENT',
        `error.details.${key} is not allowed`,
        422,
      );
    }
  }
  if (value.phase !== undefined) {
    sanitized.phase = assertSafeWorkerText(value.phase, 'error.details.phase', 64);
  }
  if (value.reason !== undefined) {
    sanitized.reason = assertSafeWorkerText(
      value.reason,
      'error.details.reason',
      256,
    );
  }
  if (value.statusCode !== undefined) {
    sanitized.statusCode = assertNonNegativeInteger(
      value.statusCode,
      'error.details.statusCode',
    );
  }
  if (value.retryAfterMs !== undefined) {
    sanitized.retryAfterMs = assertNonNegativeInteger(
      value.retryAfterMs,
      'error.details.retryAfterMs',
    );
  }
  return sanitized;
}

function assertMaxAttempts(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_ATTEMPTS_LIMIT
  ) {
    throw new MultimodalJobServiceError(
      'INVALID_ARGUMENT',
      `maxAttempts must be an integer from 1 to ${MAX_ATTEMPTS_LIMIT}`,
      422,
    );
  }
  return value;
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function createLeaseConflict(message: string): MultimodalJobServiceError {
  return new MultimodalJobServiceError('JOB_LEASE_CONFLICT', message, 409);
}

function createDataIntegrityError(message: string): MultimodalJobServiceError {
  return new MultimodalJobServiceError('DATA_INTEGRITY_ERROR', message, 500);
}

function buildMediaQualityCheckResultManifestKey(input: {
  sessionId: string;
  jobId: string;
  attemptNo: number;
}): string {
  return `skill-sessions/${input.sessionId}/manifest/media-quality-check/job-${input.jobId}-attempt-${input.attemptNo}.json`;
}

function readManifestObjectKey(
  manifest: Record<string, unknown>,
  fieldName: string,
): string {
  const value = manifest[fieldName];
  if (!isPlainObject(value)) {
    throw createDataIntegrityError(`Claimed job ${fieldName} is invalid`);
  }
  const objectKey = value.objectKey;
  if (typeof objectKey !== 'string' || objectKey.trim().length === 0) {
    throw createDataIntegrityError(`Claimed job ${fieldName}.objectKey is invalid`);
  }
  return objectKey;
}

interface TranscriptionChunkPlanItem {
  chunkIndex: number;
  startMs: number;
  endMs: number;
}

function buildTranscriptionChunkPlan(
  durationMs: number,
): TranscriptionChunkPlanItem[] {
  const chunks: TranscriptionChunkPlanItem[] = [];
  for (
    let startMs = 0, chunkIndex = 0;
    startMs < durationMs;
    startMs += config.multimodalAsrChunkDurationMs, chunkIndex += 1
  ) {
    if (chunkIndex >= MAX_TRANSCRIPT_CHUNKS) {
      throw createDataIntegrityError('Transcription chunk plan is too large');
    }
    chunks.push({
      chunkIndex,
      startMs,
      endMs: Math.min(durationMs, startMs + config.multimodalAsrChunkDurationMs),
    });
  }
  return chunks;
}

function readTranscriptionChunkPlan(
  manifest: Record<string, unknown>,
): TranscriptionChunkPlanItem[] {
  const durationMs = manifestInteger(manifest, 'durationMs');
  const value = manifest.chunkPlan;
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > MAX_TRANSCRIPT_CHUNKS
  ) {
    throw createDataIntegrityError('Claimed transcribe chunkPlan is invalid');
  }
  let previousEndMs = 0;
  const chunks = value.map((raw, index) => {
    if (
      !isPlainObject(raw) ||
      Object.keys(raw).some(
        (key) => !['chunkIndex', 'startMs', 'endMs'].includes(key),
      )
    ) {
      throw createDataIntegrityError('Claimed transcribe chunkPlan is invalid');
    }
    const chunkIndex = raw.chunkIndex;
    const startMs = raw.startMs;
    const endMs = manifestInteger(raw, 'endMs');
    if (
      typeof chunkIndex !== 'number' ||
      !Number.isSafeInteger(chunkIndex) ||
      chunkIndex < 0 ||
      typeof startMs !== 'number' ||
      !Number.isSafeInteger(startMs) ||
      startMs < 0 ||
      chunkIndex !== index ||
      startMs !== previousEndMs ||
      endMs <= startMs ||
      endMs > durationMs
    ) {
      throw createDataIntegrityError('Claimed transcribe chunkPlan is invalid');
    }
    previousEndMs = endMs;
    return { chunkIndex, startMs, endMs };
  });
  if (previousEndMs !== durationMs) {
    throw createDataIntegrityError('Claimed transcribe chunkPlan is invalid');
  }
  return chunks;
}

function runtimeGrant(grant: {
  method: string;
  objectKey: string;
  url: string;
  expiresAt: string;
  requiredHeaders: Record<string, string>;
}) {
  return {
    method: grant.method,
    objectKey: grant.objectKey,
    url: grant.url,
    expiresAt: grant.expiresAt,
    headers: grant.requiredHeaders,
  };
}

function manifestText(
  manifest: Record<string, unknown>,
  fieldName: string,
): string {
  const value = manifest[fieldName];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw createDataIntegrityError(`Job input ${fieldName} is invalid`);
  }
  return value;
}

function manifestInteger(
  manifest: Record<string, unknown>,
  fieldName: string,
): number {
  const value = manifest[fieldName];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw createDataIntegrityError(`Job input ${fieldName} is invalid`);
  }
  return value;
}

function assertMediaStage(value: unknown): MediaStage {
  if (typeof value !== 'string' || !MEDIA_STAGES.includes(value as MediaStage)) {
    throw createDataIntegrityError('Stored media stage is invalid');
  }
  return value as MediaStage;
}

function assertSessionStatus(value: unknown): (typeof SESSION_STATUSES)[number] {
  if (
    typeof value !== 'string' ||
    !SESSION_STATUSES.includes(value as (typeof SESSION_STATUSES)[number])
  ) {
    throw createDataIntegrityError('Stored session status is invalid');
  }
  return value as (typeof SESSION_STATUSES)[number];
}

function parseMediaSessionMutationRow(
  row: MediaSessionMutationRow | null | undefined,
  { expectedSessionId }: { expectedSessionId: string },
): {
  sessionId: string;
  mediaStage: MediaStage;
  status: (typeof SESSION_STATUSES)[number];
  revisionNo: number;
  mediaState: MultimodalSessionState;
} {
  if (!row) {
    throw createLeaseConflict('Upload verification session is no longer available');
  }
  const sessionId = assertPositiveId(row.id, 'session.id');
  if (sessionId !== expectedSessionId) {
    throw createDataIntegrityError('Stored session row does not match job session');
  }
  const mediaStage = assertMediaStage(row.media_stage);
  const status = assertSessionStatus(row.status);
  if (status !== getGuidedCreationStatusForMediaStage(mediaStage)) {
    throw createDataIntegrityError('Stored session status drifted from media stage');
  }
  return {
    sessionId,
    mediaStage,
    status,
    revisionNo: assertNonNegativeInteger(row.revision_no, 'session.revision_no'),
    mediaState: parseMultimodalSessionState(row.media_state_json),
  };
}

async function lockMediaSession(
  db: Queryable,
  sessionId: string,
): Promise<ReturnType<typeof parseMediaSessionMutationRow>> {
  const result = await db.query<MediaSessionMutationRow>(
    `select id,
            status,
            creation_mode,
            media_stage,
            media_state_json,
            revision_no,
            updated_at
       from skill_guided_creation_sessions
      where id = $1
        and creation_mode = $2
        and deleted_at is null
      for update`,
    [sessionId, 'multimodal_distill'],
  );
  return parseMediaSessionMutationRow(result.rows[0], {
    expectedSessionId: sessionId,
  });
}

async function updateMediaSession(input: {
  db: Queryable;
  now: Date;
  session: ReturnType<typeof parseMediaSessionMutationRow>;
  nextStage: MediaStage;
  nextState: MultimodalSessionState;
}): Promise<void> {
  const { db, now, session, nextStage, nextState } = input;
  const result = await db.query<MediaSessionMutationRow>(
    `update skill_guided_creation_sessions
        set updated_at = $1,
            revision_no = $2,
            media_state_json = $3::jsonb,
            media_stage = $4,
            status = $5
      where id = $6
        and creation_mode = $7
        and deleted_at is null
        and revision_no = $8
        and media_stage = $9
      returning id,
                status,
                creation_mode,
                media_stage,
                media_state_json,
                revision_no,
                updated_at`,
    [
      now.toISOString(),
      session.revisionNo + 1,
      JSON.stringify(nextState),
      nextStage,
      getGuidedCreationStatusForMediaStage(nextStage),
      session.sessionId,
      'multimodal_distill',
      session.revisionNo,
      session.mediaStage,
    ],
  );
  if (result.rowCount !== 1) {
    throw new MultimodalJobServiceError(
      'SESSION_REVISION_CONFLICT',
      'Session changed before the worker result could be recorded',
      409,
      true,
    );
  }
  parseMediaSessionMutationRow(result.rows[0], {
    expectedSessionId: session.sessionId,
  });
}

function validateSessionForCreate(session: MultimodalSessionCreateRow | null) {
  if (!session) {
    throw new MultimodalJobServiceError(
      'SESSION_NOT_FOUND',
      'Session not found',
      404,
    );
  }
  if (
    session.deletedAt !== null ||
    session.creationMode !== 'multimodal_distill' ||
    session.status === 'completed' ||
    session.status === 'cancelled'
  ) {
    throw new MultimodalJobServiceError(
      'INVALID_SESSION_STATE',
      'Session is not eligible for multimodal jobs',
      409,
    );
  }
  return session;
}

function normalizeCreateMediaJobInput(
  input: CreateMediaJobInput,
): NormalizedCreateMediaJobInput {
  return {
    sessionId: assertPositiveId(input.sessionId, 'sessionId'),
    jobType: assertJobType(input.jobType, 'jobType'),
    idempotencyKey: assertNonEmptyString(
      input.idempotencyKey,
      'idempotencyKey',
    ),
    requestHash: assertHexHash(input.requestHash, 'requestHash'),
    inputManifest: assertObject(input.inputManifest, 'inputManifest'),
    maxAttempts: assertMaxAttempts(input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS),
  };
}

function validateLeasedJob(
  job: StoredMultimodalJob | null,
  leaseTokenHash: string,
  now: Date,
): StoredMultimodalJob {
  if (!job) {
    throw createLeaseConflict('Job lease is no longer valid');
  }
  if (job.status !== 'leased') {
    throw createLeaseConflict('Job is not currently leased');
  }
  if (!job.leaseTokenHash || !secureEqual(job.leaseTokenHash, leaseTokenHash)) {
    throw createLeaseConflict('Lease token does not match the active lease');
  }
  if (
    !job.leaseExpiresAt ||
    new Date(job.leaseExpiresAt).getTime() <= now.getTime()
  ) {
    throw createLeaseConflict('Lease has expired');
  }
  if (
    job.cancelRequestedAt ||
    job.sessionDeletedAt !== null ||
    job.sessionStatus !== 'collecting'
  ) {
    throw createLeaseConflict('Job lease can no longer be updated');
  }
  return job;
}

function resumeStageForJobType(jobType: MediaJobType): MediaStage {
  switch (jobType) {
    case 'media_quality_check':
      return 'uploading';
    case 'media_prepare':
      return 'preparing_media';
    case 'transcribe':
      return 'transcribing';
    case 'frame_materialize':
      return 'building_evidence';
  }
}

export function createMultimodalJobService(
  overrides: Partial<JobServiceDeps> = {},
) {
  const deps: JobServiceDeps = {
    withTransaction,
    store: createMultimodalJobStore(),
    now: () => new Date(),
    generateLeaseToken: () => randomBytes(32).toString('base64url'),
    hashLeaseToken: (token: string) =>
      createHash('sha256').update(token).digest('hex'),
    ...overrides,
  };

  async function recycleExpiredLeasesCore(db: Queryable, now: Date) {
    const recycled = await deps.store.recycleExpiredLeases({ db, now });
    const terminalSessions = new Map<
      string,
      { sessionId: string; resumeFromStage: MediaStage }
    >();
    for (const job of recycled) {
      if (job.status === 'failed' && !terminalSessions.has(job.sessionId)) {
        terminalSessions.set(job.sessionId, {
          sessionId: job.sessionId,
          resumeFromStage: resumeStageForJobType(job.jobType),
        });
      }
    }
    for (const terminal of terminalSessions.values()) {
      const sessionUpdate = await db.query<{ id: string }>(
        `update skill_guided_creation_sessions
            set status = 'failed',
                media_stage = 'failed',
                revision_no = revision_no + 1,
                updated_at = $3
          where id = $1
            and creation_mode = 'multimodal_distill'
            and deleted_at is null
            and status = 'collecting'
            and media_stage = $2
          returning id`,
        [terminal.sessionId, terminal.resumeFromStage, now.toISOString()],
      );
      if (sessionUpdate.rowCount !== 1) {
        throw createLeaseConflict(
          'Session changed before the expired worker lease was recorded',
        );
      }
    }
    return recycled;
  }

  async function createMediaJobCore(input: {
    db: Queryable;
    now: Date;
    job: NormalizedCreateMediaJobInput;
  }) {
    const { db, now, job } = input;
    validateSessionForCreate(await deps.store.loadSessionForCreate({ db, sessionId: job.sessionId }));
    const inserted = await deps.store.tryInsertJob({
      db,
      sessionId: job.sessionId,
      jobType: job.jobType,
      idempotencyKey: job.idempotencyKey,
      requestHash: job.requestHash,
      maxAttempts: job.maxAttempts,
      progress: {},
      inputManifest: job.inputManifest,
      now,
    });
    if (inserted) {
      return inserted;
    }
    const existing = await deps.store.findJobByIdempotencyKey({
      db,
      sessionId: job.sessionId,
      jobType: job.jobType,
      idempotencyKey: job.idempotencyKey,
    });
    if (!existing) {
      throw new MultimodalJobServiceError(
        'JOB_IDEMPOTENCY_RACE',
        'Job creation raced with another writer',
        409,
        true,
      );
    }
    if (!secureEqual(existing.requestHash, job.requestHash)) {
      throw new MultimodalJobServiceError(
        'IDEMPOTENCY_KEY_REUSED',
        'Idempotency key already exists for a different request',
        409,
      );
    }
    return existing;
  }

  async function createRuntimeGrants(job: RuntimeGrantJob) {
    try {
      const objectStorageService =
        deps.objectStorageService ??
        (() => {
          const storageConfig = readObjectStorageConfig();
          if (!storageConfig) {
            throw new Error('missing object storage config');
          }
          return createObjectStorageService({ config: storageConfig });
        })();
      const attempt = {
        sessionId: job.sessionId,
        jobId: job.jobId,
        attemptNo: job.attemptNo,
      };

      if (job.jobType === 'media_prepare') {
        const objectKey = readManifestObjectKey(job.inputManifest, 'sourceAsset');
        const pipelinePlan = job.inputManifest.pipelinePlan;
        if (
          !isPlainObject(pipelinePlan) ||
          typeof pipelinePlan.transcribe !== 'boolean'
        ) {
          throw createDataIntegrityError(
            'Claimed media_prepare job pipelinePlan is invalid',
          );
        }
        const sourceRead = await objectStorageService.createSignedGetGrant({
          objectKey,
        });
        const resultManifestWrite =
          await objectStorageService.createSignedPutGrant({
            objectKey: buildJobResultManifestKey(attempt),
            contentType: 'application/json',
          });
        const normalizedAudio = pipelinePlan.transcribe
          ? await objectStorageService.createSignedPutGrant({
              objectKey: buildNormalizedAudioKey(attempt),
              contentType: 'audio/wav',
            })
          : null;
        return {
          sourceRead: runtimeGrant(sourceRead),
          artifactWrites: normalizedAudio
            ? { normalizedAudio: runtimeGrant(normalizedAudio) }
            : {},
          resultManifestWrite: runtimeGrant(resultManifestWrite),
        };
      }

      if (job.jobType === 'transcribe') {
        const objectKey = readManifestObjectKey(
          job.inputManifest,
          'audioAssetRef',
        );
        const chunkPlan = readTranscriptionChunkPlan(job.inputManifest);
        const [sourceRead, transcript, resultManifestWrite, ...chunkGrants] =
          await Promise.all([
            objectStorageService.createSignedGetGrant({ objectKey }),
            objectStorageService.createSignedPutGrant({
              objectKey: buildTranscriptAssetKey(attempt),
              contentType: 'application/json',
            }),
            objectStorageService.createSignedPutGrant({
              objectKey: buildJobResultManifestKey(attempt),
              contentType: 'application/json',
            }),
            ...chunkPlan.map((chunk) =>
              objectStorageService.createSignedPutGrant({
                objectKey: buildTranscriptChunkManifestKey({
                  ...attempt,
                  chunkIndex: chunk.chunkIndex,
                }),
                contentType: 'application/json',
              }),
            ),
            ...Array.from(
              { length: Math.max(0, job.attemptNo - 1) },
              (_, priorAttemptIndex) => priorAttemptIndex + 1,
            ).flatMap((priorAttemptNo) =>
              chunkPlan.map((chunk) =>
                objectStorageService.createSignedGetGrant({
                  objectKey: buildTranscriptChunkManifestKey({
                    sessionId: job.sessionId,
                    jobId: job.jobId,
                    attemptNo: priorAttemptNo,
                    chunkIndex: chunk.chunkIndex,
                  }),
                }),
              ),
            ),
          ]);
        const currentChunkGrants = chunkGrants.slice(0, chunkPlan.length);
        const recoveryChunkGrants = chunkGrants.slice(chunkPlan.length);
        return {
          sourceRead: runtimeGrant(sourceRead),
          artifactWrites: {
            transcript: runtimeGrant(transcript),
            transcriptChunks: currentChunkGrants.map((grant, index) => ({
              chunkIndex: chunkPlan[index].chunkIndex,
              ...runtimeGrant(grant),
            })),
          },
          recoveryReads: {
            transcriptChunks: recoveryChunkGrants.map((grant, index) => ({
              attemptNo: Math.floor(index / chunkPlan.length) + 1,
              chunkIndex: chunkPlan[index % chunkPlan.length].chunkIndex,
              ...runtimeGrant(grant),
            })),
          },
          resultManifestWrite: runtimeGrant(resultManifestWrite),
        };
      }

      if (job.jobType === 'frame_materialize') {
        const objectKey = readManifestObjectKey(job.inputManifest, 'sourceAsset');
        const requests = job.inputManifest.frameRequests;
        if (
          !Array.isArray(requests) ||
          requests.length < 1 ||
          requests.length > 48
        ) {
          throw createDataIntegrityError(
            'Claimed frame_materialize job frameRequests are invalid',
          );
        }
        const candidateIds = requests.map((request) => {
          if (!isPlainObject(request)) {
            throw createDataIntegrityError(
              'Claimed frame_materialize request is invalid',
            );
          }
          const candidateId = request.candidateId;
          if (typeof candidateId !== 'string' || candidateId.length === 0) {
            throw createDataIntegrityError(
              'Claimed frame_materialize candidateId is invalid',
            );
          }
          return candidateId;
        });
        if (new Set(candidateIds).size !== candidateIds.length) {
          throw createDataIntegrityError(
            'Claimed frame_materialize candidateId must be unique',
          );
        }
        const [sourceRead, resultManifestWrite, ...frameWrites] =
          await Promise.all([
            objectStorageService.createSignedGetGrant({ objectKey }),
            objectStorageService.createSignedPutGrant({
              objectKey: buildJobResultManifestKey(attempt),
              contentType: 'application/json',
            }),
            ...candidateIds.map((candidateId) =>
              objectStorageService.createSignedPutGrant({
                objectKey: buildFrameAssetKey({ ...attempt, candidateId }),
                contentType: 'image/png',
              }),
            ),
          ]);
        return {
          sourceRead: runtimeGrant(sourceRead),
          artifactWrites: {
            frames: frameWrites.map((grant, index) => ({
              candidateId: candidateIds[index],
              ...runtimeGrant(grant),
            })),
          },
          resultManifestWrite: runtimeGrant(resultManifestWrite),
        };
      }

      const objectKey = job.inputManifest.objectKey;
      if (typeof objectKey !== 'string' || objectKey.trim().length === 0) {
        throw createDataIntegrityError(
          'Claimed media_quality_check job manifest is invalid',
        );
      }
      const sourceRead = await objectStorageService.createSignedGetGrant({
        objectKey,
      });
      const resultManifestWrite =
        await objectStorageService.createSignedPutGrant({
          objectKey: buildMediaQualityCheckResultManifestKey(attempt),
          contentType: 'application/json',
        });
      return {
        sourceRead: runtimeGrant(sourceRead),
        resultManifestWrite: runtimeGrant(resultManifestWrite),
      };
    } catch (error) {
      if (error instanceof MultimodalJobServiceError) {
        throw error;
      }
      throw new MultimodalJobServiceError(
        'MEDIA_RUNTIME_GRANT_UNAVAILABLE',
        'Runtime object-storage grants are unavailable',
        503,
        true,
      );
    }
  }

  return {
    async createMediaJob(input: CreateMediaJobInput) {
      const job = normalizeCreateMediaJobInput(input);
      const requestNow = deps.now();
      return deps.withTransaction(async (db) => {
        return createMediaJobCore({
          db,
          now: requestNow,
          job,
        });
      });
    },

    async createMediaJobInTransaction(input: CreateMediaJobInput & { db: Queryable }) {
      const job = normalizeCreateMediaJobInput(input);
      const requestNow = deps.now();
      return createMediaJobCore({
        db: input.db,
        now: requestNow,
        job,
      });
    },

    async claimMediaJob(input: {
      workerIdentity: string;
      acceptedJobTypes: MediaJobType[];
    }) {
      const workerIdentity = assertNonEmptyString(
        input.workerIdentity,
        'workerIdentity',
      );
      const acceptedJobTypes = assertAcceptedJobTypes(input.acceptedJobTypes);
      const claimed = await deps.withTransaction(async (db) => {
        const now = deps.now();
        await recycleExpiredLeasesCore(db, now);
        const leaseToken = deps.generateLeaseToken();
        const claimedJob = await deps.store.claimNextJob({
          db,
          now,
          acceptedJobTypes,
          leaseOwner: workerIdentity,
          leaseTokenHash: deps.hashLeaseToken(leaseToken),
          leaseExpiresAt: new Date(now.getTime() + DEFAULT_LEASE_MS),
        });
        if (!claimedJob) {
          return null;
        }
        return {
          jobId: claimedJob.id,
          sessionId: claimedJob.sessionId,
          jobType: claimedJob.jobType,
          attemptNo: claimedJob.attemptNo,
          maxAttempts: claimedJob.maxAttempts,
          inputManifest: claimedJob.inputManifest,
          progress: claimedJob.progress,
          leaseToken,
          leaseExpiresAt: claimedJob.leaseExpiresAt,
        };
      });
      if (!claimed) {
        return claimed;
      }

      return {
        ...claimed,
        runtimeGrants: await createRuntimeGrants(claimed),
      };
    },

    async refreshMediaJobRuntimeGrants(input: {
      jobId: string;
      leaseToken: string;
    }) {
      const jobId = assertPositiveId(input.jobId, 'jobId');
      const leaseToken = assertNonEmptyString(input.leaseToken, 'leaseToken');
      const leasedJob = await deps.withTransaction(async (db) => {
        const now = deps.now();
        return validateLeasedJob(
          await deps.store.loadJobForLeaseMutation({ db, jobId }),
          deps.hashLeaseToken(leaseToken),
          now,
        );
      });
      return createRuntimeGrants({
        jobId: leasedJob.id,
        sessionId: leasedJob.sessionId,
        jobType: leasedJob.jobType,
        attemptNo: leasedJob.attemptNo,
        inputManifest: leasedJob.inputManifest,
      });
    },

    async heartbeatMediaJob(input: {
      jobId: string;
      leaseToken: string;
      progress: Record<string, unknown>;
    }) {
      const jobId = assertPositiveId(input.jobId, 'jobId');
      const leaseToken = assertNonEmptyString(input.leaseToken, 'leaseToken');
      const progress = sanitizeHeartbeatProgress(
        assertObject(input.progress, 'progress'),
      );
      return deps.withTransaction(async (db) => {
        const now = deps.now();
        const leaseTokenHash = deps.hashLeaseToken(leaseToken);
        validateLeasedJob(
          await deps.store.loadJobForLeaseMutation({ db, jobId }),
          leaseTokenHash,
          now,
        );
        return deps.store.updateHeartbeat({
          db,
          jobId,
          progress,
          heartbeatAt: now,
          leaseExpiresAt: new Date(now.getTime() + DEFAULT_LEASE_MS),
        });
      });
    },

    async completeMediaJob(input: {
      jobId: string;
      leaseToken: string;
      resultHash: string;
      outputManifest: Record<string, unknown>;
    }) {
      const jobId = assertPositiveId(input.jobId, 'jobId');
      const leaseToken = assertNonEmptyString(input.leaseToken, 'leaseToken');
      const resultHash = assertHexHash(input.resultHash, 'resultHash');
      const outputManifest = assertObject(
        input.outputManifest,
        'outputManifest',
      );
      let parsedQualityOutput:
        | ReturnType<typeof parseMediaQualityCheckOutputManifest>
        | null = null;
      try {
        parsedQualityOutput = parseMediaQualityCheckOutputManifest(outputManifest);
      } catch {
        parsedQualityOutput = null;
      }
      return deps.withTransaction(async (db) => {
        const now = deps.now();
        const leaseTokenHash = deps.hashLeaseToken(leaseToken);
        const job = await deps.store.loadJobForLeaseMutation({ db, jobId });
        if (job?.status === 'succeeded') {
          if (job.resultHash && secureEqual(job.resultHash, resultHash)) {
            return {
              jobId: job.id,
              status: 'succeeded' as const,
              resultHash: job.resultHash,
              outputManifest: job.outputManifest,
              replayed: true,
            };
          }
          throw new MultimodalJobServiceError(
            'JOB_RESULT_CONFLICT',
            'Job was already completed with a different result hash',
            409,
          );
        }
        const leasedJob = validateLeasedJob(job, leaseTokenHash, now);
        if (leasedJob.jobType === 'media_quality_check') {
          if (!parsedQualityOutput) {
            throw createDataIntegrityError(
              'media_quality_check output manifest is invalid',
            );
          }
          const parsedQualityInput = (() => {
            try {
              return parseMediaQualityCheckJobInputManifest(
                leasedJob.inputManifest,
              );
            } catch {
              return null;
            }
          })();
          if (!parsedQualityInput) {
            throw createDataIntegrityError(
              'media_quality_check input manifest is invalid',
            );
          }
          const expectedResultHash =
            buildMediaQualityCheckResultHash(parsedQualityOutput);
          if (!secureEqual(expectedResultHash, resultHash)) {
            throw createDataIntegrityError(
              'media_quality_check resultHash does not match output manifest',
            );
          }
          const sessionResult = await db.query<MediaSessionMutationRow>(
            `select id,
                    status,
                    creation_mode,
                    media_stage,
                    media_state_json,
                    revision_no,
                    updated_at
               from skill_guided_creation_sessions
              where id = $1
                and creation_mode = $2
                and deleted_at is null
              for update`,
            [leasedJob.sessionId, 'multimodal_distill'],
          );
          const session = parseMediaSessionMutationRow(sessionResult.rows[0], {
            expectedSessionId: leasedJob.sessionId,
          });
          if (session.mediaStage !== 'uploading') {
            throw createLeaseConflict(
              'Upload verification session is no longer accepting results',
            );
          }
          const pendingUpload = session.mediaState.pendingUpload;
          if (
            !pendingUpload ||
            pendingUpload.materialStatus !== 'verifying' ||
            !pendingUpload.verification ||
            pendingUpload.verification.jobId !== leasedJob.id
          ) {
            throw createLeaseConflict(
              'Upload verification session is no longer accepting results',
            );
          }
          const expectedManifestKey = buildMediaQualityCheckResultManifestKey({
            sessionId: session.sessionId,
            jobId: leasedJob.id,
            attemptNo: leasedJob.attemptNo,
          });
          if (
            parsedQualityOutput.sessionId !== session.sessionId ||
            parsedQualityInput.sourceId !== pendingUpload.sourceId ||
            parsedQualityInput.mediaKind !== pendingUpload.mediaKind ||
            parsedQualityInput.objectKey !== pendingUpload.objectKey ||
            parsedQualityInput.fileName !== pendingUpload.fileName ||
            parsedQualityInput.expectedSizeBytes !== pendingUpload.sizeBytes ||
            parsedQualityInput.expectedContentType !==
              pendingUpload.declaredMimeType ||
            parsedQualityInput.uploadMode !== pendingUpload.uploadMode ||
            parsedQualityOutput.sourceId !== pendingUpload.sourceId ||
            parsedQualityOutput.sourceKind !== pendingUpload.mediaKind ||
            parsedQualityOutput.sourceAsset.objectKey !== pendingUpload.objectKey ||
            parsedQualityOutput.sourceAsset.sizeBytes !== pendingUpload.sizeBytes ||
            parsedQualityOutput.sourceAsset.sizeBytes !==
              pendingUpload.verification.observedSizeBytes ||
            parsedQualityOutput.sourceAsset.sizeBytes !==
              parsedQualityInput.expectedSizeBytes ||
            parsedQualityOutput.sourceAsset.mimeType !==
              pendingUpload.declaredMimeType ||
            parsedQualityOutput.sourceAsset.mimeType !==
              pendingUpload.verification.observedContentType ||
            parsedQualityOutput.sourceAsset.mimeType !==
              parsedQualityInput.expectedContentType ||
            parsedQualityOutput.resultManifestRef.objectKey !==
              expectedManifestKey
          ) {
            throw createDataIntegrityError(
              'media_quality_check result does not match pending upload binding',
            );
          }
          const primarySource: MultimodalPrimarySource = {
            sourceId: parsedQualityOutput.sourceId,
            kind: parsedQualityOutput.sourceKind,
            assetRef: parsedQualityOutput.sourceAsset,
          };
          const nextState = parseMultimodalSessionState({
            ...session.mediaState,
            primarySource,
            pendingUpload: null,
          });
          const nextRevisionNo = session.revisionNo + 1;
          const nextStage = 'ready_to_process' as const;
          const updateResult = await db.query<MediaSessionMutationRow>(
            `update skill_guided_creation_sessions
                set updated_at = $1,
                    revision_no = $2,
                    media_state_json = $3::jsonb,
                    media_stage = $4,
                    status = $5
              where id = $6
                and creation_mode = $7
                and deleted_at is null
                and revision_no = $8
                and media_stage = $9
              returning id,
                        status,
                        creation_mode,
                        media_stage,
                        media_state_json,
                        revision_no,
                        updated_at`,
            [
              now.toISOString(),
              nextRevisionNo,
              JSON.stringify(nextState),
              nextStage,
              getGuidedCreationStatusForMediaStage(nextStage),
              session.sessionId,
              'multimodal_distill',
              session.revisionNo,
              session.mediaStage,
            ],
          );
          if (updateResult.rowCount !== 1) {
            throw new MultimodalJobServiceError(
              'SESSION_REVISION_CONFLICT',
              'Session changed before upload verification could be recorded',
              409,
              true,
            );
          }
          parseMediaSessionMutationRow(updateResult.rows[0], {
            expectedSessionId: session.sessionId,
          });
        } else if (leasedJob.jobType === 'media_prepare') {
          let output;
          try {
            output = parseMediaPrepareOutputManifest(outputManifest);
          } catch {
            throw createDataIntegrityError(
              'media_prepare output manifest is invalid',
            );
          }
          if (!secureEqual(buildDistillationResultHash(output), resultHash)) {
            throw createDataIntegrityError(
              'media_prepare resultHash does not match output manifest',
            );
          }
          const sourceId = manifestText(leasedJob.inputManifest, 'sourceId');
          const sourceKind = manifestText(
            leasedJob.inputManifest,
            'sourceKind',
          );
          const sourceAsset = leasedJob.inputManifest.sourceAsset;
          const sourceProbe = leasedJob.inputManifest.sourceProbe;
          const pipelinePlan = leasedJob.inputManifest.pipelinePlan;
          if (
            !isPlainObject(sourceAsset) ||
            !isPlainObject(sourceProbe) ||
            !isPlainObject(pipelinePlan) ||
            typeof sourceProbe.hasAudio !== 'boolean' ||
            typeof sourceProbe.hasVideo !== 'boolean' ||
            typeof pipelinePlan.transcribe !== 'boolean'
          ) {
            throw createDataIntegrityError('media_prepare input manifest is invalid');
          }
          const durationMs = manifestInteger(sourceProbe, 'durationMs');
          const expectedAttempt = {
            sessionId: leasedJob.sessionId,
            jobId: leasedJob.id,
            attemptNo: leasedJob.attemptNo,
          };
          if (
            output.sessionId !== leasedJob.sessionId ||
            output.sourceId !== sourceId ||
            output.sourceKind !== sourceKind ||
            output.durationMs !== durationMs ||
            output.hasAudio !== sourceProbe.hasAudio ||
            output.hasVideo !== sourceProbe.hasVideo ||
            output.hasAudio !== pipelinePlan.transcribe ||
            output.resultManifestRef.objectKey !==
              buildJobResultManifestKey(expectedAttempt) ||
            (output.normalizedAudioAssetRef !== null &&
              output.normalizedAudioAssetRef.objectKey !==
                buildNormalizedAudioKey(expectedAttempt)) ||
            output.degradations.some(
              (degradation) => degradation.semanticMomentId !== undefined,
            )
          ) {
            throw createDataIntegrityError(
              'media_prepare result does not match its job binding',
            );
          }
          const session = await lockMediaSession(db, leasedJob.sessionId);
          if (session.mediaStage !== 'preparing_media') {
            throw createLeaseConflict(
              'Media preparation session is no longer accepting results',
            );
          }
          if (
            !session.mediaState.primarySource ||
            session.mediaState.primarySource.sourceId !== sourceId ||
            session.mediaState.primarySource.kind !== sourceKind ||
            buildDistillationResultHash(
              session.mediaState.primarySource.assetRef,
            ) !== buildDistillationResultHash(sourceAsset)
          ) {
            throw createDataIntegrityError(
              'media_prepare input does not match the session source',
            );
          }

          let nextStage: MediaStage;
          let nextState: MultimodalSessionState;
          if (output.hasAudio && output.normalizedAudioAssetRef) {
            const transcribeInput = {
              schemaVersion: 1,
              sessionId: leasedJob.sessionId,
              sourceId,
              sourceKind,
              durationMs: output.durationMs,
              audioAssetRef: output.normalizedAudioAssetRef,
              mediaPrepareJobId: leasedJob.id,
              chunkPlan: buildTranscriptionChunkPlan(output.durationMs),
            };
            await createMediaJobCore({
              db,
              now,
              job: normalizeCreateMediaJobInput({
                sessionId: leasedJob.sessionId,
                jobType: 'transcribe',
                idempotencyKey: `media-prepare-${leasedJob.id}-transcribe`,
                requestHash: buildDistillationResultHash(transcribeInput),
                inputManifest: transcribeInput,
              }),
            });
            nextStage = 'transcribing';
            nextState = parseMultimodalSessionState({
              ...session.mediaState,
              degradations: [
                ...session.mediaState.degradations,
                ...output.degradations,
              ],
            });
          } else {
            nextStage = 'building_semantic_windows';
            nextState = parseMultimodalSessionState({
              ...session.mediaState,
              transcript: {
                status: 'not_applicable',
                editable: true,
                segments: [],
              },
              degradations: [
                ...session.mediaState.degradations,
                ...output.degradations,
                {
                  code: 'AUDIO_TRACK_MISSING',
                  message: '视频没有可转录的音轨，后续将仅使用视觉证据。',
                },
              ],
            });
          }
          await updateMediaSession({ db, now, session, nextStage, nextState });
        } else if (leasedJob.jobType === 'transcribe') {
          let output;
          try {
            output = parseTranscribeOutputManifest(outputManifest);
          } catch {
            throw createDataIntegrityError(
              'transcribe output manifest is invalid',
            );
          }
          if (!secureEqual(buildDistillationResultHash(output), resultHash)) {
            throw createDataIntegrityError(
              'transcribe resultHash does not match output manifest',
            );
          }
          const sourceId = manifestText(leasedJob.inputManifest, 'sourceId');
          const durationMs = manifestInteger(
            leasedJob.inputManifest,
            'durationMs',
          );
          const expectedAttempt = {
            sessionId: leasedJob.sessionId,
            jobId: leasedJob.id,
            attemptNo: leasedJob.attemptNo,
          };
          if (
            output.sessionId !== leasedJob.sessionId ||
            output.sourceId !== sourceId ||
            output.durationMs !== durationMs ||
            output.transcriptAssetRef.objectKey !==
              buildTranscriptAssetKey(expectedAttempt) ||
            output.resultManifestRef.objectKey !==
              buildJobResultManifestKey(expectedAttempt) ||
            output.degradations.some(
              (degradation) => degradation.semanticMomentId !== undefined,
            )
          ) {
            throw createDataIntegrityError(
              'transcribe result does not match its job binding',
            );
          }
          const session = await lockMediaSession(db, leasedJob.sessionId);
          if (session.mediaStage !== 'transcribing') {
            throw createLeaseConflict(
              'Transcription session is no longer accepting results',
            );
          }
          if (session.mediaState.primarySource?.sourceId !== sourceId) {
            throw createDataIntegrityError(
              'transcribe input does not match the session source',
            );
          }
          const nextState = parseMultimodalSessionState({
            ...session.mediaState,
            transcript: output.transcript,
            degradations: [
              ...session.mediaState.degradations,
              ...output.degradations,
            ],
          });
          await updateMediaSession({
            db,
            now,
            session,
            nextStage: 'building_semantic_windows',
            nextState,
          });
        } else if (leasedJob.jobType === 'frame_materialize') {
          let output;
          try {
            output = parseFrameMaterializeOutputManifest(outputManifest);
          } catch {
            throw createDataIntegrityError(
              'frame_materialize output manifest is invalid',
            );
          }
          if (!secureEqual(buildDistillationResultHash(output), resultHash)) {
            throw createDataIntegrityError(
              'frame_materialize resultHash does not match output manifest',
            );
          }
          const sourceId = manifestText(leasedJob.inputManifest, 'sourceId');
          const sourceAsset = leasedJob.inputManifest.sourceAsset;
          const requests = leasedJob.inputManifest.frameRequests;
          const expectedAttempt = {
            sessionId: leasedJob.sessionId,
            jobId: leasedJob.id,
            attemptNo: leasedJob.attemptNo,
          };
          if (
            !isPlainObject(sourceAsset) ||
            !Array.isArray(requests) ||
            requests.length !== output.candidates.length
          ) {
            throw createDataIntegrityError(
              'frame_materialize input requests are invalid',
            );
          }
          const requestById = new Map(
            requests.map((request) => {
              if (!isPlainObject(request)) {
                throw createDataIntegrityError(
                  'frame_materialize request is invalid',
                );
              }
              return [manifestText(request, 'candidateId'), request] as const;
            }),
          );
          const candidatesMatch = output.candidates.every((candidate) => {
            const request = requestById.get(candidate.candidateId);
            return (
              request !== undefined &&
              candidate.semanticMomentId === request.semanticMomentId &&
              candidate.timestampMs === request.timestampMs &&
              candidate.sourceSignal === request.sourceSignal &&
              candidate.selectionReason === request.selectionReason &&
              candidate.assetRef.objectKey ===
                buildFrameAssetKey({
                  ...expectedAttempt,
                  candidateId: candidate.candidateId,
                })
            );
          });
          if (
            output.sessionId !== leasedJob.sessionId ||
            output.sourceId !== sourceId ||
            output.resultManifestRef.objectKey !==
              buildJobResultManifestKey(expectedAttempt) ||
            requestById.size !== requests.length ||
            !candidatesMatch
          ) {
            throw createDataIntegrityError(
              'frame_materialize result does not match its job binding',
            );
          }
          const session = await lockMediaSession(db, leasedJob.sessionId);
          if (
            session.mediaStage !== 'building_evidence' ||
            session.mediaState.primarySource?.sourceId !== sourceId
          ) {
            throw createLeaseConflict(
              'Evidence session is no longer accepting frame results',
            );
          }
          if (
            session.mediaState.primarySource.kind !== 'video' ||
            buildDistillationResultHash(
              session.mediaState.primarySource.assetRef,
            ) !== buildDistillationResultHash(sourceAsset)
          ) {
            throw createDataIntegrityError(
              'frame_materialize input does not match the session source',
            );
          }
        }
        return deps.store.completeJob({
          db,
          jobId,
          resultHash,
          outputManifest,
          finishedAt: now,
        });
      });
    },

    async failMediaJob(input: {
      jobId: string;
      leaseToken: string;
      error: {
        code: string;
        message: string;
        retryable: boolean;
        details?: Record<string, unknown>;
      };
    }) {
      const jobId = assertPositiveId(input.jobId, 'jobId');
      const leaseToken = assertNonEmptyString(input.leaseToken, 'leaseToken');
      const errorCode = assertNonEmptyString(input.error?.code, 'error.code');
      const errorMessage = assertSafeWorkerText(
        input.error?.message,
        'error.message',
        512,
      );
      if (typeof input.error?.retryable !== 'boolean') {
        throw new MultimodalJobServiceError(
          'INVALID_ARGUMENT',
          'error.retryable must be boolean',
          422,
        );
      }
      const details =
        input.error.details === undefined
          ? undefined
          : sanitizeFailureDetails(
              assertObject(input.error.details, 'error.details'),
            );
      return deps.withTransaction(async (db) => {
        const now = deps.now();
        const leaseTokenHash = deps.hashLeaseToken(leaseToken);
        const job = validateLeasedJob(
          await deps.store.loadJobForLeaseMutation({ db, jobId }),
          leaseTokenHash,
          now,
        );
        const shouldRetry =
          input.error.retryable && job.attemptNo < job.maxAttempts;
        const resumeFromStage = resumeStageForJobType(job.jobType);
        const failedJob = await deps.store.failJob({
          db,
          jobId,
          status: shouldRetry ? 'queued' : 'failed',
          error: {
            code: errorCode,
            message: errorMessage,
            retryable: input.error.retryable,
            ...(!shouldRetry
              ? {
                  details: {
                    ...(details ?? {}),
                    resumeFromStage,
                  },
                }
              : details
                ? { details }
                : {}),
          },
          now,
          availableAt: shouldRetry
            ? new Date(
                now.getTime() +
                  Math.min(300_000, Math.max(15_000, job.attemptNo * 15_000)),
              )
            : null,
          finishedAt: shouldRetry ? null : now,
        });
        if (!shouldRetry) {
          const sessionUpdate = await db.query<{ id: string }>(
            `update skill_guided_creation_sessions
                set status = 'failed',
                    media_stage = 'failed',
                    revision_no = revision_no + 1,
                    updated_at = $3
              where id = $1
                and creation_mode = 'multimodal_distill'
                and deleted_at is null
                and status = 'collecting'
                and media_stage = $2
              returning id`,
            [job.sessionId, resumeFromStage, now.toISOString()],
          );
          if (sessionUpdate.rowCount !== 1) {
            throw createLeaseConflict(
              'Session changed before the terminal job failure was recorded',
            );
          }
        }
        return failedJob;
      });
    },

    async cancelMediaJob(input: { jobId: string }) {
      const jobId = assertPositiveId(input.jobId, 'jobId');
      return deps.withTransaction(async (db) => {
        const cancelled = await deps.store.cancelJob({
          db,
          jobId,
          now: deps.now(),
        });
        if (!cancelled) {
          throw new MultimodalJobServiceError(
            'JOB_NOT_FOUND',
            'Job not found or not cancellable',
            404,
          );
        }
        return cancelled;
      });
    },

    async recycleExpiredLeases() {
      return deps.withTransaction(async (db) => {
        const now = deps.now();
        return recycleExpiredLeasesCore(db, now);
      });
    },
  };
}
