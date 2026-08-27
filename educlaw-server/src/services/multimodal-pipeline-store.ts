import type {
  CandidatePassMeta,
  GuidedCreationStatus,
  MultimodalCandidatePasses,
  MultimodalCandidateSuggestion,
  MultimodalSessionState,
  RiaSkillDraft,
  ValidatedCandidateResult,
} from '@educlaw/shared';
import {
  CANDIDATE_FUSED_PASS_KEY,
  parseMultimodalSessionState,
} from '@educlaw/shared';
import {
  query,
  withAdvisoryConnection,
  withTransaction,
  type Queryable,
} from './db.js';
import { GuidedCreationError } from './guided-creation-service.js';
import {
  assertMediaStageGate,
  assertMediaStageTransition,
  getGuidedCreationStatusForMediaStage,
  type MediaConfirmationStage,
  type MediaStage,
} from './media-session-state-machine.js';
import { stableRequestHashJson } from './multimodal-guided-creation-service.js';

const CREATION_MODE = 'multimodal_distill';
const POSITIVE_INTEGER_ID = /^[1-9]\d*$/;
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
const CONFIRMED_STAGES = [
  'adler_overview',
  'evidence_and_candidates',
  'publish',
] as const satisfies readonly MediaConfirmationStage[];
const PIPELINE_STAGES = [
  'extracting_candidates',
  'validating_candidates',
  'building_skills',
] as const;
const RUNNABLE_PIPELINE_STAGES = [
  'building_semantic_windows',
  'building_evidence',
  'building_adler',
  ...PIPELINE_STAGES,
] as const;
const SAFE_CODE_PATTERN = /^[A-Z0-9_:-]+$/;
const MAX_ERROR_MESSAGE_LENGTH = 512;
const MAX_SCAN_LIMIT = 64;

type SessionStatus = (typeof SESSION_STATUSES)[number];
type PipelineStage = (typeof PIPELINE_STAGES)[number];
type RunnablePipelineStage = (typeof RUNNABLE_PIPELINE_STAGES)[number];

interface SessionRow {
  id: unknown;
  display_name: unknown;
  status: unknown;
  creation_mode: unknown;
  media_stage: unknown;
  media_state_json: unknown;
  confirmed_stages_json: unknown;
  revision_no: unknown;
  error_json: unknown;
  created_at: unknown;
  updated_at: unknown;
}

interface ServiceDependencies {
  query?: typeof query;
  withAdvisoryConnection?: typeof withAdvisoryConnection;
  withTransaction?: typeof withTransaction;
  now?: () => Date;
}

export interface PersistedPipelineError {
  code: string;
  stage: PipelineStage;
  retryable: boolean;
  message: string;
  resumeStage: PipelineStage;
}

export interface MultimodalPipelineSnapshot {
  sessionId: string;
  displayName: string;
  status: GuidedCreationStatus;
  mediaStage: MediaStage;
  revisionNo: number;
  createdAt: string;
  updatedAt: string;
  mediaState: MultimodalSessionState;
  confirmedStages: MediaConfirmationStage[];
  error: PersistedPipelineError | null;
}

export interface RunnablePipelineSession {
  sessionId: string;
  authUserId: string;
  mediaStage: RunnablePipelineStage;
}

export interface MultimodalPipelineStore {
  scanRunnableSessions(input: { limit: number }): Promise<RunnablePipelineSession[]>;
  runWithPipelineLease<T>(
    input: { sessionId: string },
    work: () => Promise<T>,
  ): Promise<{ acquired: false } | { acquired: true; result: T }>;
  loadSessionSnapshot(input: {
    authUserId: string;
    sessionId: string;
  }): Promise<MultimodalPipelineSnapshot>;
  resumePipelineFailure(input: {
    authUserId: string;
    sessionId: string;
    expectedRevisionNo: number;
  }): Promise<MultimodalPipelineSnapshot>;
  persistCandidatePasses(input: {
    authUserId: string;
    sessionId: string;
    expectedRevisionNo: number;
    expectedStage: 'extracting_candidates';
    candidatePasses: MultimodalCandidatePasses;
    candidatePassMeta: MultimodalSessionState['candidatePassMeta'];
  }): Promise<MultimodalPipelineSnapshot>;
  persistValidatedCandidates(input: {
    authUserId: string;
    sessionId: string;
    expectedRevisionNo: number;
    expectedStage: 'validating_candidates';
    candidateValidations: ValidatedCandidateResult[];
    fusedCandidates?: MultimodalCandidateSuggestion[];
    fusedMeta?: CandidatePassMeta[typeof CANDIDATE_FUSED_PASS_KEY];
    fusedValidations?: ValidatedCandidateResult[];
  }): Promise<MultimodalPipelineSnapshot>;
  persistCandidateSkills(input: {
    authUserId: string;
    sessionId: string;
    expectedRevisionNo: number;
    expectedStage: 'building_skills';
    candidateSkills: RiaSkillDraft[];
  }): Promise<MultimodalPipelineSnapshot>;
  persistPipelineFailure(input: {
    authUserId: string;
    sessionId: string;
    expectedRevisionNo: number;
    expectedStage: PipelineStage;
    error: PersistedPipelineError;
  }): Promise<MultimodalPipelineSnapshot>;
}

export class MultimodalPipelineStoreError extends GuidedCreationError {}

function fail(
  code: string,
  message: string,
  statusCode: number,
  retryable = false,
): never {
  throw new MultimodalPipelineStoreError(code, message, statusCode, retryable);
}

function safeString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    fail('MULTIMODAL_PIPELINE_FAILED', `${fieldName} 无效`, 500);
  }
  return value;
}

function asIso(value: unknown, fieldName: string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value !== 'string' || !value.trim()) {
    fail('MULTIMODAL_PIPELINE_FAILED', `${fieldName} 无效`, 500);
  }
  return value;
}

function persistedPositiveId(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !POSITIVE_INTEGER_ID.test(value)) {
    fail('MULTIMODAL_PIPELINE_FAILED', `${fieldName} 无效`, 500);
  }
  return value;
}

function readRevisionNo(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    fail('MULTIMODAL_PIPELINE_FAILED', `${fieldName} 无效`, 500);
  }
  return value;
}

function readSessionStatus(value: unknown): SessionStatus {
  if (
    typeof value !== 'string' ||
    !SESSION_STATUSES.includes(value as SessionStatus)
  ) {
    fail('MULTIMODAL_PIPELINE_FAILED', 'status 无效', 500);
  }
  return value as SessionStatus;
}

function readMediaStage(value: unknown): MediaStage {
  if (
    typeof value !== 'string' ||
    !MEDIA_STAGES.includes(value as MediaStage)
  ) {
    fail('MULTIMODAL_PIPELINE_FAILED', 'mediaStage 无效', 500);
  }
  return value as MediaStage;
}

function readCreationMode(value: unknown): typeof CREATION_MODE {
  if (value !== CREATION_MODE) {
    fail('MULTIMODAL_PIPELINE_FAILED', 'creationMode 无效', 500);
  }
  return CREATION_MODE;
}

function readPipelineStage(value: unknown, fieldName: string): PipelineStage {
  if (
    typeof value !== 'string' ||
    !PIPELINE_STAGES.includes(value as PipelineStage)
  ) {
    fail('MULTIMODAL_PIPELINE_FAILED', `${fieldName} 无效`, 500);
  }
  return value as PipelineStage;
}

function readRunnablePipelineStage(
  value: unknown,
  fieldName: string,
): RunnablePipelineStage {
  if (
    typeof value !== 'string' ||
    !RUNNABLE_PIPELINE_STAGES.includes(value as RunnablePipelineStage)
  ) {
    fail('MULTIMODAL_PIPELINE_FAILED', `${fieldName} 无效`, 500);
  }
  return value as RunnablePipelineStage;
}

function parseStoredJson(value: unknown, fieldName: string): unknown {
  try {
    if (typeof value === 'string') {
      return JSON.parse(value);
    }
    return structuredClone(value);
  } catch {
    fail('MULTIMODAL_PIPELINE_FAILED', `${fieldName} 无效`, 500);
  }
}

function parseSessionState(value: unknown): MultimodalSessionState {
  try {
    return parseMultimodalSessionState(parseStoredJson(value, 'mediaState'));
  } catch {
    fail('MULTIMODAL_PIPELINE_FAILED', '媒体会话状态损坏', 500);
  }
}

function parseConfirmedStages(value: unknown): MediaConfirmationStage[] {
  const parsed = parseStoredJson(value, 'confirmedStages');
  if (!Array.isArray(parsed)) {
    fail('MULTIMODAL_PIPELINE_FAILED', 'confirmedStages 损坏', 500);
  }
  const stages = parsed.map((item) => {
    if (
      typeof item !== 'string' ||
      !CONFIRMED_STAGES.includes(item as MediaConfirmationStage)
    ) {
      fail('MULTIMODAL_PIPELINE_FAILED', 'confirmedStages 损坏', 500);
    }
    return item as MediaConfirmationStage;
  });
  if (new Set(stages).size !== stages.length) {
    fail('MULTIMODAL_PIPELINE_FAILED', 'confirmedStages 损坏', 500);
  }
  let previousIndex = -1;
  for (const stage of stages) {
    const index = CONFIRMED_STAGES.indexOf(stage);
    if (index <= previousIndex) {
      fail('MULTIMODAL_PIPELINE_FAILED', 'confirmedStages 顺序非法', 500);
    }
    previousIndex = index;
  }
  return stages;
}

function parsePipelineError(value: unknown): PersistedPipelineError | null {
  if (value === null || value === undefined) {
    return null;
  }
  const record = parseStoredJson(value, 'error');
  if (
    typeof record !== 'object' ||
    record === null ||
    Array.isArray(record)
  ) {
    fail('MULTIMODAL_PIPELINE_FAILED', 'errorJson 损坏', 500);
  }
  const errorRecord = record as Record<string, unknown>;
  const allowedKeys = new Set([
    'code',
    'stage',
    'retryable',
    'message',
    'resumeStage',
  ]);
  if (Object.keys(errorRecord).some((key) => !allowedKeys.has(key))) {
    fail('MULTIMODAL_PIPELINE_FAILED', 'errorJson 损坏', 500);
  }
  const code = safeString(errorRecord.code, 'error.code');
  const stage = readPipelineStage(errorRecord.stage, 'error.stage');
  if (typeof errorRecord.retryable !== 'boolean') {
    fail('MULTIMODAL_PIPELINE_FAILED', 'error.retryable 无效', 500);
  }
  const message = safeString(errorRecord.message, 'error.message');
  if (message.length > MAX_ERROR_MESSAGE_LENGTH) {
    fail('MULTIMODAL_PIPELINE_FAILED', 'error.message 无效', 500);
  }
  const resumeStage = readPipelineStage(
    errorRecord.resumeStage,
    'error.resumeStage',
  );
  if (resumeStage !== stage) {
    fail('MULTIMODAL_PIPELINE_FAILED', 'error.resumeStage 无效', 500);
  }
  return {
    code,
    stage,
    retryable: errorRecord.retryable,
    message,
    resumeStage,
  };
}

function normalizeSessionId(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    fail('INVALID_ARGUMENT', 'sessionId 必须是正整数字符串', 422);
  }
  return value;
}

function normalizeExpectedRevisionNo(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    fail('INVALID_ARGUMENT', 'expectedRevisionNo 必须是非负整数', 422);
  }
  return value;
}

function normalizeExpectedStage<TStage extends PipelineStage>(
  value: unknown,
  expected: TStage,
): TStage {
  if (value !== expected) {
    fail('INVALID_ARGUMENT', 'expectedStage 不合法', 422);
  }
  return expected;
}

function normalizePipelineStage(value: unknown): PipelineStage {
  if (
    typeof value !== 'string' ||
    !PIPELINE_STAGES.includes(value as PipelineStage)
  ) {
    fail('INVALID_ARGUMENT', 'expectedStage 不合法', 422);
  }
  return value as PipelineStage;
}

function normalizeScanLimit(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_SCAN_LIMIT
  ) {
    fail(
      'INVALID_ARGUMENT',
      `scan limit 必须是 1 到 ${MAX_SCAN_LIMIT} 之间的整数`,
      422,
    );
  }
  return value;
}

function countCandidatePasses(candidatePasses: MultimodalCandidatePasses): number {
  return (
    candidatePasses.frameworks.length +
    candidatePasses.principles.length +
    candidatePasses.cases.length +
    candidatePasses.counterexamples.length +
    candidatePasses.terms.length
  );
}

function assertCandidateValidationCoverage(
  candidatePasses: MultimodalCandidatePasses,
  candidateValidations: ValidatedCandidateResult[],
): void {
  const candidateIds = [
    ...candidatePasses.frameworks,
    ...candidatePasses.principles,
    ...candidatePasses.cases,
    ...candidatePasses.counterexamples,
    ...candidatePasses.terms,
  ].map((candidate) => candidate.candidateId);
  if (candidateIds.length === 0) {
    fail('MULTIMODAL_PIPELINE_FAILED', '当前没有可校验的候选 Skill', 502, true);
  }
  const validationIds = candidateValidations.map(
    (validation) => validation.candidate.candidateId,
  );
  if (
    candidateIds.length !== validationIds.length ||
    candidateIds.some((candidateId) => !validationIds.includes(candidateId))
  ) {
    fail('MULTIMODAL_PIPELINE_FAILED', '候选校验覆盖不完整', 502, true);
  }
}

function normalizeFailureInput(
  value: unknown,
  expectedStage: PipelineStage,
): PersistedPipelineError {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value)
  ) {
    fail('INVALID_ARGUMENT', 'pipeline error 格式不正确', 422);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expectedKeys = ['code', 'message', 'resumeStage', 'retryable', 'stage'];
  if (
    keys.length !== expectedKeys.length ||
    expectedKeys.some((key) => !keys.includes(key))
  ) {
    fail('INVALID_ARGUMENT', 'pipeline error 格式不正确', 422);
  }
  if (
    typeof record.code !== 'string' ||
    !SAFE_CODE_PATTERN.test(record.code) ||
    record.code.length > 128
  ) {
    fail('INVALID_ARGUMENT', 'pipeline error.code 格式不正确', 422);
  }
  if (
    typeof record.message !== 'string' ||
    !record.message.trim() ||
    record.message.length > 512
  ) {
    fail('INVALID_ARGUMENT', 'pipeline error.message 格式不正确', 422);
  }
  if (record.retryable !== true && record.retryable !== false) {
    fail('INVALID_ARGUMENT', 'pipeline error.retryable 格式不正确', 422);
  }
  const stage = normalizePipelineStage(record.stage);
  const resumeStage = normalizePipelineStage(record.resumeStage);
  if (stage !== expectedStage || resumeStage !== expectedStage) {
    fail('INVALID_ARGUMENT', 'pipeline error stage 不匹配', 422);
  }
  return {
    code: record.code,
    stage,
    retryable: record.retryable,
    message: record.message.trim(),
    resumeStage,
  };
}

function mapSessionRow(row: SessionRow): MultimodalPipelineSnapshot {
  readCreationMode(row.creation_mode);
  const sessionId = persistedPositiveId(String(row.id), 'sessionId');
  const mediaStage = readMediaStage(row.media_stage);
  const status = readSessionStatus(row.status);
  if (status !== getGuidedCreationStatusForMediaStage(mediaStage)) {
    fail('MULTIMODAL_PIPELINE_FAILED', 'status 与 mediaStage 不一致', 500);
  }
  const mediaState = parseSessionState(row.media_state_json);
  const confirmedStages = parseConfirmedStages(row.confirmed_stages_json ?? []);
  const receiptStages = mediaState.operationReceipts
    .filter(
      (receipt) =>
        receipt.confirmedStage === 'adler_overview' ||
        receipt.confirmedStage === 'evidence_and_candidates',
    )
    .map((receipt) => receipt.confirmedStage);
  const expectedReceiptStages = confirmedStages.filter(
    (stage) => stage !== 'publish',
  );
  if (
    receiptStages.length !== expectedReceiptStages.length ||
    receiptStages.some((stage, index) => stage !== expectedReceiptStages[index])
  ) {
    fail('MULTIMODAL_PIPELINE_FAILED', 'confirmedStages 与工作态不一致', 500);
  }
  return {
    sessionId,
    displayName: safeString(row.display_name, 'displayName'),
    status,
    mediaStage,
    revisionNo: readRevisionNo(row.revision_no, 'revisionNo'),
    createdAt: asIso(row.created_at, 'createdAt'),
    updatedAt: asIso(row.updated_at, 'updatedAt'),
    mediaState,
    confirmedStages,
    error: parsePipelineError(row.error_json),
  };
}

function assertExpectedSnapshot(
  snapshot: MultimodalPipelineSnapshot,
  expectedRevisionNo: number,
  expectedStage: MediaStage,
): void {
  if (
    snapshot.revisionNo !== expectedRevisionNo ||
    snapshot.mediaStage !== expectedStage
  ) {
    fail('SESSION_REVISION_CONFLICT', '会话版本已变化，请刷新后重试', 409);
  }
}

function loadSelectSql() {
  return `select id,
                 display_name,
                 status,
                 creation_mode,
                 media_stage,
                 media_state_json,
                 confirmed_stages_json,
                 revision_no,
                 error_json,
                 created_at,
                 updated_at
            from skill_guided_creation_sessions
           where id = $1
             and user_id = $2
             and creation_mode = $3
             and deleted_at is null`;
}

function loadRunnableSessionsSql() {
  return `select id,
                 user_id,
                 media_stage
            from skill_guided_creation_sessions
           where creation_mode = '${CREATION_MODE}'
             and deleted_at is null
             and media_stage in ('building_semantic_windows', 'building_evidence', 'building_adler', 'extracting_candidates', 'validating_candidates', 'building_skills')
        order by updated_at asc, id asc
           limit $1`;
}

async function selectSnapshotForUpdate(
  db: Queryable,
  input: { authUserId: string; sessionId: string },
): Promise<MultimodalPipelineSnapshot> {
  const result = await db.query<SessionRow>(
    `${loadSelectSql()}
           for update`,
    [input.sessionId, input.authUserId, CREATION_MODE],
  );
  const row = result.rows[0];
  if (!row) {
    fail('GUIDED_SESSION_NOT_FOUND', '没有找到这个多模态会话', 404);
  }
  return mapSessionRow(row);
}

export function createMultimodalPipelineStore(
  deps: ServiceDependencies = {},
): MultimodalPipelineStore {
  const queryFn = deps.query ?? query;
  const withAdvisoryConnectionFn =
    deps.withAdvisoryConnection ?? withAdvisoryConnection;
  const withTransactionFn = deps.withTransaction ?? withTransaction;
  const now = deps.now ?? (() => new Date());

  return {
    async runWithPipelineLease(input, work) {
      const sessionId = normalizeSessionId(input.sessionId);
      const lockKey = `educlaw:multimodal-pipeline:${sessionId}`;
      return withAdvisoryConnectionFn(async (db) => {
        const lockResult = await db.query<{ acquired: boolean }>(
          'select pg_try_advisory_lock(hashtextextended($1, 0)) as acquired',
          [lockKey],
        );
        if (lockResult.rows[0]?.acquired !== true) {
          return { acquired: false } as const;
        }
        try {
          return { acquired: true, result: await work() } as const;
        } finally {
          await db.query(
            'select pg_advisory_unlock(hashtextextended($1, 0)) as released',
            [lockKey],
          );
        }
      });
    },

    async scanRunnableSessions(input) {
      const result = await queryFn<{
        id: unknown;
        user_id: unknown;
        media_stage: unknown;
      }>(loadRunnableSessionsSql(), [normalizeScanLimit(input.limit)]);
      return result.rows.map((row) => ({
        sessionId: persistedPositiveId(row.id, 'sessionId'),
        authUserId: safeString(row.user_id, 'authUserId'),
        mediaStage: readRunnablePipelineStage(row.media_stage, 'mediaStage'),
      }));
    },

    async loadSessionSnapshot(input) {
      const sessionId = normalizeSessionId(input.sessionId);
      const result = await queryFn<SessionRow>(loadSelectSql(), [
        sessionId,
        input.authUserId,
        CREATION_MODE,
      ]);
      const row = result.rows[0];
      if (!row) {
        fail('GUIDED_SESSION_NOT_FOUND', '没有找到这个多模态会话', 404);
      }
      return mapSessionRow(row);
    },

    async resumePipelineFailure(input) {
      const sessionId = normalizeSessionId(input.sessionId);
      const expectedRevisionNo = normalizeExpectedRevisionNo(
        input.expectedRevisionNo,
      );
      return withTransactionFn(async (db) => {
        const snapshot = await selectSnapshotForUpdate(db, {
          ...input,
          sessionId,
        });
        if (snapshot.revisionNo !== expectedRevisionNo) {
          fail('SESSION_REVISION_CONFLICT', '会话版本已变化，请刷新后重试', 409);
        }
        if (
          snapshot.mediaStage !== 'failed' ||
          snapshot.error === null ||
          snapshot.error.retryable !== true
        ) {
          fail('NOT_RETRYABLE', '当前会话没有可恢复的 pipeline 失败', 422);
        }
        const resumeStage = snapshot.error.resumeStage;
        assertMediaStageTransition('failed', resumeStage);
        assertMediaStageGate({
          targetStage: resumeStage,
          confirmedStages: snapshot.confirmedStages,
        });
        const nextRevisionNo = snapshot.revisionNo + 1;
        const updatedAt = now().toISOString();
        const nextStatus = getGuidedCreationStatusForMediaStage(resumeStage);
        const result = await db.query<SessionRow>(
          `update skill_guided_creation_sessions
              set updated_at = $1,
                  revision_no = $2,
                  media_stage = $3,
                  status = $4,
                  error_json = null
            where id = $5
              and user_id = $6
              and creation_mode = $7
              and deleted_at is null
              and revision_no = $8
              and media_stage = 'failed'
            returning id,
                      display_name,
                      status,
                      creation_mode,
                      media_stage,
                      media_state_json,
                      confirmed_stages_json,
                      revision_no,
                      error_json,
                      created_at,
                      updated_at`,
          [
            updatedAt,
            nextRevisionNo,
            resumeStage,
            nextStatus,
            sessionId,
            input.authUserId,
            CREATION_MODE,
            expectedRevisionNo,
          ],
        );
        const updatedRow = result.rows[0];
        if (!result.rowCount || !updatedRow) {
          fail('SESSION_REVISION_CONFLICT', '会话版本已变化，请刷新后重试', 409);
        }
        return mapSessionRow(updatedRow);
      });
    },

    async persistCandidatePasses(input) {
      const sessionId = normalizeSessionId(input.sessionId);
      const expectedRevisionNo = normalizeExpectedRevisionNo(
        input.expectedRevisionNo,
      );
      const expectedStage = normalizeExpectedStage(
        input.expectedStage,
        'extracting_candidates',
      );
      if (
        input.candidatePassMeta === null &&
        countCandidatePasses(input.candidatePasses) > 0
      ) {
        fail('INVALID_ARGUMENT', 'candidatePassMeta 不能为空', 422);
      }
      return withTransactionFn(async (db) => {
        const snapshot = await selectSnapshotForUpdate(db, {
          ...input,
          sessionId,
        });
        assertExpectedSnapshot(
          snapshot,
          expectedRevisionNo,
          expectedStage,
        );
        if (snapshot.mediaState.selectedCandidateIds.length > 0) {
          fail('MULTIMODAL_SESSION_FAILED', '候选选择残留，不能覆盖候选提取结果', 500);
        }
        const nextStage: MediaStage = 'validating_candidates';
        const nextState = parseMultimodalSessionState({
          ...snapshot.mediaState,
          candidatePasses: input.candidatePasses,
          candidatePassMeta: input.candidatePassMeta,
          candidateValidations: [],
          candidateSkills: [],
        });
        assertMediaStageTransition(snapshot.mediaStage, nextStage);
        assertMediaStageGate({
          targetStage: nextStage,
          confirmedStages: snapshot.confirmedStages,
        });
        const nextRevisionNo = snapshot.revisionNo + 1;
        const updatedAt = now().toISOString();
        const nextStatus = getGuidedCreationStatusForMediaStage(nextStage);
        const result = await db.query<SessionRow>(
          `update skill_guided_creation_sessions
              set updated_at = $1,
                  revision_no = $2,
                  media_state_json = $3::jsonb,
                  media_stage = $4,
                  status = $5,
                  error_json = null
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
                      error_json,
                      created_at,
                      updated_at`,
          [
            updatedAt,
            nextRevisionNo,
            stableRequestHashJson(nextState),
            nextStage,
            nextStatus,
            sessionId,
            input.authUserId,
            CREATION_MODE,
            expectedRevisionNo,
            expectedStage,
          ],
        );
        const updatedRow = result.rows[0];
        if (!result.rowCount || !updatedRow) {
          fail('SESSION_REVISION_CONFLICT', '会话版本已变化，请刷新后重试', 409);
        }
        return mapSessionRow(updatedRow);
      });
    },

    async persistValidatedCandidates(input) {
      const sessionId = normalizeSessionId(input.sessionId);
      const expectedRevisionNo = normalizeExpectedRevisionNo(
        input.expectedRevisionNo,
      );
      const expectedStage = normalizeExpectedStage(
        input.expectedStage,
        'validating_candidates',
      );
      return withTransactionFn(async (db) => {
        const snapshot = await selectSnapshotForUpdate(db, {
          ...input,
          sessionId,
        });
        assertExpectedSnapshot(
          snapshot,
          expectedRevisionNo,
          expectedStage,
        );
        assertCandidateValidationCoverage(
          snapshot.mediaState.candidatePasses,
          input.candidateValidations,
        );
        const fusedCandidates = input.fusedCandidates ?? [];
        const fusedValidations = input.fusedValidations ?? [];
        const nextState = parseMultimodalSessionState({
          ...snapshot.mediaState,
          candidatePasses: {
            ...snapshot.mediaState.candidatePasses,
            [CANDIDATE_FUSED_PASS_KEY]: fusedCandidates,
          },
          candidatePassMeta:
            snapshot.mediaState.candidatePassMeta === null
              ? null
              : input.fusedMeta !== undefined
                ? {
                    ...snapshot.mediaState.candidatePassMeta,
                    [CANDIDATE_FUSED_PASS_KEY]: input.fusedMeta,
                  }
                : snapshot.mediaState.candidatePassMeta,
          candidateValidations: [
            ...input.candidateValidations,
            ...fusedValidations,
          ],
        });
        const nextStage: MediaStage = 'awaiting_candidates';
        assertMediaStageTransition(snapshot.mediaStage, nextStage);
        assertMediaStageGate({
          targetStage: nextStage,
          confirmedStages: snapshot.confirmedStages,
        });
        const nextRevisionNo = snapshot.revisionNo + 1;
        const updatedAt = now().toISOString();
        const nextStatus = getGuidedCreationStatusForMediaStage(nextStage);
        const result = await db.query<SessionRow>(
          `update skill_guided_creation_sessions
              set updated_at = $1,
                  revision_no = $2,
                  media_state_json = $3::jsonb,
                  media_stage = $4,
                  status = $5,
                  error_json = null
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
                      error_json,
                      created_at,
                      updated_at`,
          [
            updatedAt,
            nextRevisionNo,
            stableRequestHashJson(nextState),
            nextStage,
            nextStatus,
            sessionId,
            input.authUserId,
            CREATION_MODE,
            expectedRevisionNo,
            expectedStage,
          ],
        );
        const updatedRow = result.rows[0];
        if (!result.rowCount || !updatedRow) {
          fail('SESSION_REVISION_CONFLICT', '会话版本已变化，请刷新后重试', 409);
        }
        return mapSessionRow(updatedRow);
      });
    },

    async persistCandidateSkills(input) {
      const sessionId = normalizeSessionId(input.sessionId);
      const expectedRevisionNo = normalizeExpectedRevisionNo(
        input.expectedRevisionNo,
      );
      const expectedStage = normalizeExpectedStage(
        input.expectedStage,
        'building_skills',
      );
      if (input.candidateSkills.length === 0) {
        fail('INVALID_ARGUMENT', 'candidateSkills 不能为空', 422);
      }
      return withTransactionFn(async (db) => {
        const snapshot = await selectSnapshotForUpdate(db, {
          ...input,
          sessionId,
        });
        assertExpectedSnapshot(
          snapshot,
          expectedRevisionNo,
          expectedStage,
        );
        if (snapshot.mediaState.selectedCandidateIds.length === 0) {
          fail(
            'MULTIMODAL_PIPELINE_FAILED',
            '缺少候选选择，不能推进到 arena_testing',
            502,
            true,
          );
        }
        const nextStage: MediaStage = 'arena_testing';
        const nextState = parseMultimodalSessionState({
          ...snapshot.mediaState,
          candidateSkills: input.candidateSkills,
        });
        assertMediaStageTransition(snapshot.mediaStage, nextStage);
        assertMediaStageGate({
          targetStage: nextStage,
          confirmedStages: snapshot.confirmedStages,
        });
        const nextRevisionNo = snapshot.revisionNo + 1;
        const updatedAt = now().toISOString();
        const nextStatus = getGuidedCreationStatusForMediaStage(nextStage);
        const result = await db.query<SessionRow>(
          `update skill_guided_creation_sessions
              set updated_at = $1,
                  revision_no = $2,
                  media_state_json = $3::jsonb,
                  media_stage = $4,
                  status = $5,
                  error_json = null
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
                      error_json,
                      created_at,
                      updated_at`,
          [
            updatedAt,
            nextRevisionNo,
            stableRequestHashJson(nextState),
            nextStage,
            nextStatus,
            sessionId,
            input.authUserId,
            CREATION_MODE,
            expectedRevisionNo,
            expectedStage,
          ],
        );
        const updatedRow = result.rows[0];
        if (!result.rowCount || !updatedRow) {
          fail('SESSION_REVISION_CONFLICT', '会话版本已变化，请刷新后重试', 409);
        }
        return mapSessionRow(updatedRow);
      });
    },

    async persistPipelineFailure(input) {
      const sessionId = normalizeSessionId(input.sessionId);
      const expectedRevisionNo = normalizeExpectedRevisionNo(
        input.expectedRevisionNo,
      );
      const expectedStage = normalizePipelineStage(input.expectedStage);
      const normalizedError = normalizeFailureInput(input.error, expectedStage);
      return withTransactionFn(async (db) => {
        const snapshot = await selectSnapshotForUpdate(db, {
          ...input,
          sessionId,
        });
        assertExpectedSnapshot(
          snapshot,
          expectedRevisionNo,
          expectedStage,
        );
        const nextStage: MediaStage = 'failed';
        assertMediaStageTransition(snapshot.mediaStage, nextStage);
        assertMediaStageGate({
          targetStage: nextStage,
          confirmedStages: snapshot.confirmedStages,
        });
        const nextRevisionNo = snapshot.revisionNo + 1;
        const updatedAt = now().toISOString();
        const nextStatus = getGuidedCreationStatusForMediaStage(nextStage);
        const result = await db.query<SessionRow>(
          `update skill_guided_creation_sessions
              set updated_at = $1,
                  revision_no = $2,
                  media_stage = $3,
                  status = $4,
                  error_json = $5::jsonb
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
                      error_json,
                      created_at,
                      updated_at`,
          [
            updatedAt,
            nextRevisionNo,
            nextStage,
            nextStatus,
            stableRequestHashJson(normalizedError),
            sessionId,
            input.authUserId,
            CREATION_MODE,
            expectedRevisionNo,
            expectedStage,
          ],
        );
        const updatedRow = result.rows[0];
        if (!result.rowCount || !updatedRow) {
          fail('SESSION_REVISION_CONFLICT', '会话版本已变化，请刷新后重试', 409);
        }
        return mapSessionRow(updatedRow);
      });
    },
  };
}
