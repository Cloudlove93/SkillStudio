import { createHash } from 'node:crypto';
import type {
  AgentPackageSnapshot,
  MediaConfirmationStage,
  MediaStage,
  MultimodalSessionState,
} from '@educlaw/shared';
import { parseMultimodalSessionState } from '@educlaw/shared';
import { withTransaction, type Queryable } from './db.js';
import { GuidedCreationError } from './guided-creation-service.js';
import {
  computeMultimodalArenaResultHash,
  computeMultimodalArenaSnapshotHash,
  evaluateMultimodalSkillPackDraft,
  MULTIMODAL_ARENA_CASE_IDS,
  MULTIMODAL_ARENA_CASE_VERSION,
  MULTIMODAL_ARENA_CONFIG_VERSION,
  type MultimodalArenaEvaluation,
} from './arena-service.js';
import {
  createPackageVersionWithSnapshotTx,
  createPackageWithSnapshotTx,
  type CreatedPackageSnapshotIds,
} from './package-service.js';
import {
  assertMediaStageGate,
  assertMediaStageTransition,
  getGuidedCreationStatusForMediaStage,
} from './media-session-state-machine.js';

const CREATION_MODE = 'multimodal_distill';
const POSITIVE_ID = /^[1-9]\d*$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export type MultimodalGeneratedSnapshot = AgentPackageSnapshot & {
  metadata: {
    generationMode: 'multimodal_distill';
    manifestVersion: 1;
    sessionId: string;
    candidateRevisionNo: number;
    source: NonNullable<MultimodalSessionState['primarySource']>;
    transcriptHash: string;
    evidenceManifest: Array<{
      evidenceId: string;
      kind: string;
      claimType: string;
      timeRange: { startMs: number; endMs: number };
      objectKey: string | null;
      sha256: string | null;
      processorVersion: string;
      model: string | null;
    }>;
    modelManifest: {
      adler: MultimodalSessionState['adlerOverview'] extends infer T
        ? T extends { meta: infer M }
          ? M
          : null
        : null;
      candidatePasses: MultimodalSessionState['candidatePassMeta'];
    };
  };
};

export interface MultimodalArenaReceipt {
  schemaVersion: 1;
  action: 'skill.media.test.start';
  idempotencyKey: string;
  requestHash: string;
  baseRevisionNo: number;
  resultRevisionNo: number;
  recordedAt: string;
  evaluation: MultimodalArenaEvaluation;
}

export interface MultimodalPublishReceipt {
  schemaVersion: 1;
  action: 'skill.media.publish' | 'skill.media.generate.confirm';
  idempotencyKey: string;
  requestHash: string;
  baseRevisionNo: number;
  resultRevisionNo: number;
  packageId: string;
  packageVersionId: string;
  packageVersionNumber: number;
  skillVersionIds: Record<string, string>;
  publishedAt: string;
}

export interface PublicMultimodalPublishedPackage {
  packageId: string;
  packageVersionId: string;
  packageVersionNumber: number;
  skillVersionIds: Record<string, string>;
  publishedAt: string;
}

export interface PublicMultimodalReleaseStatus {
  arenaEvaluation: MultimodalArenaEvaluation | null;
  publishedPackage: PublicMultimodalPublishedPackage | null;
}

export interface MultimodalReleaseSession {
  sessionId: string;
  displayName: string;
  mediaStage: MediaStage;
  revisionNo: number;
  confirmedStages: MediaConfirmationStage[];
  mediaState: MultimodalSessionState;
  generatedSnapshot: MultimodalGeneratedSnapshot | null;
  arenaReceipt: MultimodalArenaReceipt | null;
  publishReceipt: MultimodalPublishReceipt | null;
}

interface ReleaseRepository {
  loadForUpdate(
    db: Queryable,
    input: { authUserId: string; sessionId: string },
  ): Promise<MultimodalReleaseSession>;
  saveArenaResult(
    db: Queryable,
    input: {
      authUserId: string;
      sessionId: string;
      expectedRevisionNo: number;
      expectedStage: 'arena_testing';
      resultRevisionNo: number;
      mediaStage: 'arena_testing' | 'ready_to_publish';
      snapshot: MultimodalGeneratedSnapshot;
      receipt: MultimodalArenaReceipt;
      updatedAt: string;
    },
  ): Promise<void>;
  savePublished(
    db: Queryable,
    input: {
      authUserId: string;
      sessionId: string;
      expectedRevisionNo: number;
      expectedStage: 'arena_testing' | 'ready_to_publish';
      snapshot: MultimodalGeneratedSnapshot;
      receipt: MultimodalPublishReceipt;
      confirmedStages: MediaConfirmationStage[];
    },
  ): Promise<void>;
}

type TransactionRunner = <T>(work: (db: Queryable) => Promise<T>) => Promise<T>;

interface ReleaseDependencies {
  withTransaction: TransactionRunner;
  repository: ReleaseRepository;
  evaluator(input: {
    snapshot: MultimodalGeneratedSnapshot;
    snapshotHash: string;
    candidateRevisionNo: number;
  }): Promise<MultimodalArenaEvaluation>;
  publishPackageTx(
    db: Queryable,
    input: {
      authUserId: string;
      snapshot: MultimodalGeneratedSnapshot;
      targetPackageId: string | null;
      expectedPackageVersionId: string | null;
    },
  ): Promise<CreatedPackageSnapshotIds>;
  now: () => Date;
}

export class MultimodalReleaseServiceError extends GuidedCreationError {}

function fail(code: string, message: string, statusCode: number, retryable = false): never {
  throw new MultimodalReleaseServiceError(code, message, statusCode, retryable);
}

function positiveId(value: string, field: string) {
  const normalized = String(value ?? '').trim();
  if (!POSITIVE_ID.test(normalized)) fail('INVALID_ARGUMENT', `${field} 格式不正确`, 422);
  return normalized;
}

function idempotencyKey(value: string) {
  const normalized = String(value ?? '').trim();
  if (!IDEMPOTENCY_KEY.test(normalized)) fail('INVALID_IDEMPOTENCY_KEY', 'idempotencyKey 格式不正确', 422);
  return normalized;
}

function revision(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) fail('INVALID_ARGUMENT', 'expectedRevisionNo 格式不正确', 422);
  return value;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

function hash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

function buildGeneratedSnapshot(
  session: MultimodalReleaseSession,
  candidateRevisionNo: number,
): MultimodalGeneratedSnapshot {
  const source = session.mediaState.primarySource;
  if (!source) fail('MULTIMODAL_SESSION_FAILED', '发布快照缺少可信主素材', 500);
  if (!session.mediaState.candidateSkills.length) {
    fail('QUALITY_GATE_FAILED', '没有可发布的 Skill 草稿', 422);
  }
  return {
    name: session.displayName,
    description: `由多模态素材蒸馏并经人工确认生成：${session.displayName}`,
    versionLabel: 'v1',
    agentMd: [
      `# ${session.displayName}`,
      '',
      '仅使用已确认的 Skill；来源事实、模型推断与未知信息必须保持边界，不得把推断伪装为原素材事实。',
    ].join('\n'),
    rubricMd: [
      '# Rubric',
      '- 能否在新教学场景中给出可执行步骤',
      '- 能否明确适用边界、反例与停止条件',
      '- 能否区分来源事实、模型推断和未知信息',
      '- 不得编造来源中不存在的事实',
    ].join('\n'),
    skills: session.mediaState.candidateSkills.map((skill) => ({
      id: skill.id,
      dirName: skill.dirName,
      name: skill.name,
      description: skill.description,
      skillMd: skill.skillMd,
    })),
    metadata: {
      generationMode: 'multimodal_distill',
      manifestVersion: 1,
      sessionId: session.sessionId,
      candidateRevisionNo,
      source,
      transcriptHash: hash(session.mediaState.transcript),
      evidenceManifest: session.mediaState.evidenceTimeline.evidenceItems.map((item) => ({
        evidenceId: item.evidenceId,
        kind: item.kind,
        claimType: item.claimType,
        timeRange: item.timeRange,
        objectKey: item.assetRef?.objectKey ?? item.source.relatedAssetRef?.objectKey ?? null,
        sha256: item.assetRef?.sha256 ?? item.source.relatedAssetRef?.sha256 ?? null,
        processorVersion: item.provenance.processorVersion,
        model: item.provenance.model ?? null,
      })),
      modelManifest: {
        adler: session.mediaState.adlerOverview?.meta ?? null,
        candidatePasses: session.mediaState.candidatePassMeta,
      },
    },
  };
}

function arenaRequestHash(input: { sessionId: string; expectedRevisionNo: number }) {
  return hash({
    action: 'skill.media.test.start',
    sessionId: input.sessionId,
    expectedRevisionNo: input.expectedRevisionNo,
    configVersion: MULTIMODAL_ARENA_CONFIG_VERSION,
  });
}

function publishRequestHash(input: {
  sessionId: string;
  expectedRevisionNo: number;
  targetPackageId: string | null;
  expectedPackageVersionId: string | null;
}) {
  return hash({ action: 'skill.media.publish', ...input });
}

function confirmGenerationRequestHash(input: {
  sessionId: string;
  expectedRevisionNo: number;
  targetPackageId: string | null;
  expectedPackageVersionId: string | null;
}) {
  return hash({ action: 'skill.media.generate.confirm', ...input });
}

function assertGeneratedSnapshotBoundToSession(
  session: MultimodalReleaseSession,
  snapshot: MultimodalGeneratedSnapshot,
) {
  const source = session.mediaState.primarySource;
  const expectedSkills = session.mediaState.candidateSkills.map((skill) => ({
    id: skill.id,
    dirName: skill.dirName,
    name: skill.name,
    description: skill.description,
    skillMd: skill.skillMd,
  }));
  if (
    !source ||
    snapshot.metadata.generationMode !== CREATION_MODE ||
    snapshot.metadata.sessionId !== session.sessionId ||
    !Number.isSafeInteger(snapshot.metadata.candidateRevisionNo) ||
    snapshot.metadata.candidateRevisionNo > session.revisionNo ||
    hash(snapshot.metadata.source) !== hash(source) ||
    snapshot.metadata.transcriptHash !== hash(session.mediaState.transcript) ||
    hash(snapshot.skills) !== hash(expectedSkills)
  ) {
    fail('GENERATED_SNAPSHOT_STALE', '已生成的 Skill 快照与当前确认内容不匹配', 409);
  }
}

function assertArenaEvaluation(
  evaluation: MultimodalArenaEvaluation,
  input: { candidateRevisionNo: number; snapshotHash: string },
) {
  const { resultHash, ...withoutHash } = evaluation;
  const passedCaseCount = evaluation.cases.filter((item) => item.passed).length;
  const failures: string[] = [];
  if (evaluation.cases.some((item) => !item.safetyPassed)) failures.push('SAFETY_GATE_FAILED');
  if (evaluation.cases.some((item) => !item.groundedPassed)) failures.push('GROUNDING_GATE_FAILED');
  if (passedCaseCount < 2) failures.push('INSUFFICIENT_CASES_PASSED');
  if (
    evaluation.configVersion !== MULTIMODAL_ARENA_CONFIG_VERSION ||
    evaluation.candidateRevisionNo !== input.candidateRevisionNo ||
    evaluation.snapshotHash !== input.snapshotHash ||
    evaluation.passedCaseCount !== passedCaseCount ||
    evaluation.passed !== (failures.length === 0) ||
    JSON.stringify(evaluation.deterministicFailures) !== JSON.stringify(failures) ||
    computeMultimodalArenaResultHash(withoutHash) !== resultHash
  ) {
    fail('ARENA_RESULT_INVALID', 'Arena 结果绑定或哈希校验失败', 502, true);
  }
}

function jsonObject(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    try { return jsonObject(JSON.parse(value)); } catch { return null; }
  }
  return typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function positiveIdString(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value);
}

function parseArenaEvaluation(value: unknown): MultimodalArenaEvaluation | null {
  const record = jsonObject(value);
  const models = jsonObject(record?.models);
  const cases = record?.cases;
  if (
    !record || record.schemaVersion !== 1 ||
    record.configVersion !== MULTIMODAL_ARENA_CONFIG_VERSION ||
    record.caseVersion !== MULTIMODAL_ARENA_CASE_VERSION ||
    !Number.isSafeInteger(record.candidateRevisionNo) ||
    !nonEmptyString(record.snapshotHash) || !models ||
    !nonEmptyString(models.baseline) || !nonEmptyString(models.enhanced) ||
    !Array.isArray(cases) || cases.length !== 3 ||
    !Number.isSafeInteger(record.passedCaseCount) ||
    typeof record.passed !== 'boolean' ||
    !Array.isArray(record.deterministicFailures) ||
    !record.deterministicFailures.every(nonEmptyString) ||
    !nonEmptyString(record.resultHash)
  ) return null;
  const validCases = cases.every((item) => {
    const candidate = jsonObject(item);
    return Boolean(
      candidate &&
      nonEmptyString(candidate.caseId) && nonEmptyString(candidate.input) &&
      typeof candidate.baselineOutput === 'string' &&
      typeof candidate.enhancedOutput === 'string' &&
      typeof candidate.baselineScore === 'number' && Number.isFinite(candidate.baselineScore) &&
      typeof candidate.enhancedScore === 'number' && Number.isFinite(candidate.enhancedScore) &&
      typeof candidate.safetyPassed === 'boolean' &&
      typeof candidate.groundedPassed === 'boolean' &&
      typeof candidate.passed === 'boolean' &&
      nonEmptyString(candidate.reason),
    );
  });
  const caseIds = cases.map((item) => jsonObject(item)?.caseId);
  if (
    !validCases ||
    new Set(caseIds).size !== MULTIMODAL_ARENA_CASE_IDS.length ||
    !MULTIMODAL_ARENA_CASE_IDS.every((caseId) => caseIds.includes(caseId))
  ) return null;
  const evaluation = record as unknown as MultimodalArenaEvaluation;
  try {
    assertArenaEvaluation(evaluation, {
      candidateRevisionNo: evaluation.candidateRevisionNo,
      snapshotHash: evaluation.snapshotHash,
    });
  } catch {
    return null;
  }
  return evaluation;
}

function parseArenaReceipt(value: unknown): MultimodalArenaReceipt | null {
  const record = jsonObject(value);
  if (!record) return null;
  const evaluation = parseArenaEvaluation(record.evaluation);
  if (
    record.schemaVersion !== 1 || record.action !== 'skill.media.test.start' ||
    !nonEmptyString(record.idempotencyKey) || !nonEmptyString(record.requestHash) ||
    !Number.isSafeInteger(record.baseRevisionNo) || !Number.isSafeInteger(record.resultRevisionNo) ||
    Number(record.baseRevisionNo) < 0 ||
    record.resultRevisionNo !== Number(record.baseRevisionNo) + 1 ||
    !nonEmptyString(record.recordedAt) || !evaluation
  ) fail('MULTIMODAL_SESSION_FAILED', 'Arena 持久化结果损坏', 500);
  return { ...(record as unknown as Omit<MultimodalArenaReceipt, 'evaluation'>), evaluation };
}

function parsePublishReceipt(value: unknown): MultimodalPublishReceipt | null {
  const record = jsonObject(value);
  if (!record) return null;
  const skillVersionIds = jsonObject(record.skillVersionIds);
  if (
    record.schemaVersion !== 1 ||
    !['skill.media.publish', 'skill.media.generate.confirm'].includes(String(record.action)) ||
    !nonEmptyString(record.idempotencyKey) || !nonEmptyString(record.requestHash) ||
    !Number.isSafeInteger(record.baseRevisionNo) || !Number.isSafeInteger(record.resultRevisionNo) ||
    record.resultRevisionNo !== Number(record.baseRevisionNo) + 1 ||
    !positiveIdString(record.packageId) || !positiveIdString(record.packageVersionId) ||
    !Number.isSafeInteger(record.packageVersionNumber) || Number(record.packageVersionNumber) <= 0 ||
    !skillVersionIds || Object.keys(skillVersionIds).length === 0 ||
    !Object.entries(skillVersionIds).every(
      ([skillId, versionId]) => nonEmptyString(skillId) && positiveIdString(versionId),
    ) ||
    !nonEmptyString(record.publishedAt)
  ) fail('MULTIMODAL_SESSION_FAILED', '发布回执损坏', 500);
  return record as unknown as MultimodalPublishReceipt;
}

export function readMultimodalReleaseStatus(input: {
  validationResult: unknown;
  confirmation: unknown;
}): PublicMultimodalReleaseStatus {
  const arenaReceipt = parseArenaReceipt(input.validationResult);
  const publishReceipt = parsePublishReceipt(input.confirmation);
  return {
    arenaEvaluation: arenaReceipt?.evaluation ?? null,
    publishedPackage: publishReceipt
      ? {
          packageId: publishReceipt.packageId,
          packageVersionId: publishReceipt.packageVersionId,
          packageVersionNumber: publishReceipt.packageVersionNumber,
          skillVersionIds: publishReceipt.skillVersionIds,
          publishedAt: publishReceipt.publishedAt,
        }
      : null,
  };
}

const defaultRepository: ReleaseRepository = {
  async loadForUpdate(db, input) {
    const result = await db.query<Record<string, unknown>>(
      `select id, display_name, media_stage, revision_no, confirmed_stages_json,
              media_state_json, generated_snapshot_json, validation_result_json,
              confirmation_json
         from skill_guided_creation_sessions
        where id = $1 and user_id = $2 and creation_mode = $3 and deleted_at is null
        for update`,
      [input.sessionId, input.authUserId, CREATION_MODE],
    );
    const row = result.rows[0];
    if (!row) fail('GUIDED_SESSION_NOT_FOUND', '没有找到这个多模态会话', 404);
    const stage = String(row.media_stage) as MediaStage;
    const revisionNo = Number(row.revision_no);
    const confirmed = Array.isArray(row.confirmed_stages_json)
      ? row.confirmed_stages_json
      : typeof row.confirmed_stages_json === 'string'
        ? JSON.parse(row.confirmed_stages_json)
        : [];
    const generated = jsonObject(row.generated_snapshot_json) as MultimodalGeneratedSnapshot | null;
    return {
      sessionId: String(row.id),
      displayName: String(row.display_name || '多模态 Skill Pack'),
      mediaStage: stage,
      revisionNo,
      confirmedStages: confirmed as MediaConfirmationStage[],
      mediaState: parseMultimodalSessionState(
        typeof row.media_state_json === 'string' ? JSON.parse(row.media_state_json) : row.media_state_json,
      ),
      generatedSnapshot: generated,
      arenaReceipt: parseArenaReceipt(row.validation_result_json),
      publishReceipt: parsePublishReceipt(row.confirmation_json),
    };
  },

  async saveArenaResult(db, input) {
    const result = await db.query(
      `update skill_guided_creation_sessions
          set revision_no = $1, media_stage = $2, status = $3,
              generated_snapshot_json = $4::jsonb, validation_result_json = $5::jsonb,
              updated_at = $6, error_json = null
        where id = $7 and user_id = $8 and creation_mode = $9 and deleted_at is null
          and revision_no = $10 and media_stage = $11`,
      [
        input.resultRevisionNo,
        input.mediaStage,
        getGuidedCreationStatusForMediaStage(input.mediaStage),
        JSON.stringify(input.snapshot),
        JSON.stringify(input.receipt),
        input.updatedAt,
        input.sessionId,
        input.authUserId,
        CREATION_MODE,
        input.expectedRevisionNo,
        input.expectedStage,
      ],
    );
    if (result.rowCount !== 1) fail('SESSION_REVISION_CONFLICT', '会话版本已变化，请刷新后重试', 409);
  },

  async savePublished(db, input) {
    const result = await db.query(
      `update skill_guided_creation_sessions
          set revision_no = $1, media_stage = 'published', status = 'completed',
              generated_snapshot_json = $2::jsonb, confirmation_json = $3::jsonb,
              confirmed_stages_json = $4::jsonb, package_id = $5,
              package_version_id = $6, finalize_request_id = $7,
              updated_at = $8, completed_at = $8, error_json = null
        where id = $9 and user_id = $10 and creation_mode = $11 and deleted_at is null
          and revision_no = $12 and media_stage = $13`,
      [
        input.receipt.resultRevisionNo,
        JSON.stringify(input.snapshot),
        JSON.stringify(input.receipt),
        JSON.stringify(input.confirmedStages),
        input.receipt.packageId,
        input.receipt.packageVersionId,
        input.receipt.idempotencyKey,
        input.receipt.publishedAt,
        input.sessionId,
        input.authUserId,
        CREATION_MODE,
        input.expectedRevisionNo,
        input.expectedStage,
      ],
    );
    if (result.rowCount !== 1) fail('SESSION_REVISION_CONFLICT', '会话版本已变化，请刷新后重试', 409);
  },
};

const defaultDependencies: ReleaseDependencies = {
  withTransaction: (work) => withTransaction((db) => work(db)),
  repository: defaultRepository,
  evaluator: async ({ snapshot, candidateRevisionNo }) =>
    evaluateMultimodalSkillPackDraft({ snapshot, candidateRevisionNo }),
  publishPackageTx: async (db, input) =>
    input.targetPackageId == null
      ? createPackageWithSnapshotTx(db, input.authUserId, input.snapshot, 'generated')
      : createPackageVersionWithSnapshotTx(db, {
          userId: input.authUserId,
          packageId: input.targetPackageId,
          expectedPackageVersionId: input.expectedPackageVersionId!,
          snapshot: input.snapshot,
          source: 'generated',
          note: '多模态素材蒸馏发布',
        }),
  now: () => new Date(),
};

export function createMultimodalReleaseService(
  dependencies: Partial<ReleaseDependencies> = {},
) {
  const deps = { ...defaultDependencies, ...dependencies };
  return {
    async startArenaTest(input: {
      authUserId: string;
      sessionId: string;
      idempotencyKey: string;
      expectedRevisionNo: number;
    }) {
      const sessionId = positiveId(input.sessionId, 'sessionId');
      const key = idempotencyKey(input.idempotencyKey);
      const expectedRevisionNo = revision(input.expectedRevisionNo);
      const requestHash = arenaRequestHash({ sessionId, expectedRevisionNo });
      const preflight = await deps.withTransaction(async (db) => {
        const session = await deps.repository.loadForUpdate(db, { authUserId: input.authUserId, sessionId });
        if (session.arenaReceipt?.idempotencyKey === key) {
          if (session.arenaReceipt.requestHash !== requestHash) fail('IDEMPOTENCY_KEY_REUSED', '相同 idempotencyKey 不能复用于不同测试', 409);
          return { replay: session.arenaReceipt, snapshot: session.generatedSnapshot };
        }
        if (session.revisionNo !== expectedRevisionNo) fail('SESSION_REVISION_CONFLICT', '会话版本已变化，请刷新后重试', 409);
        if (session.mediaStage !== 'arena_testing') fail('INVALID_MEDIA_STAGE', '当前阶段不能启动 Arena 测试', 409);
        assertMediaStageGate({ targetStage: 'arena_testing', confirmedStages: session.confirmedStages });
        const snapshot = buildGeneratedSnapshot(session, expectedRevisionNo);
        return { replay: null, snapshot };
      });
      if (preflight.replay) {
        return {
          sessionId,
          revisionNo: preflight.replay.resultRevisionNo,
          mediaStage: preflight.replay.evaluation.passed ? 'ready_to_publish' as const : 'arena_testing' as const,
          passed: preflight.replay.evaluation.passed,
          evaluation: preflight.replay.evaluation,
          replayed: true,
        };
      }
      if (!preflight.snapshot) fail('MULTIMODAL_SESSION_FAILED', 'Arena 测试快照缺失', 500);
      const snapshotHash = computeMultimodalArenaSnapshotHash(preflight.snapshot);
      const evaluation = await deps.evaluator({
        snapshot: preflight.snapshot,
        snapshotHash,
        candidateRevisionNo: expectedRevisionNo,
      });
      assertArenaEvaluation(evaluation, { candidateRevisionNo: expectedRevisionNo, snapshotHash });
      const result = await deps.withTransaction(async (db) => {
        const session = await deps.repository.loadForUpdate(db, { authUserId: input.authUserId, sessionId });
        if (session.arenaReceipt?.idempotencyKey === key) {
          if (session.arenaReceipt.requestHash !== requestHash) fail('IDEMPOTENCY_KEY_REUSED', '相同 idempotencyKey 不能复用于不同测试', 409);
          return { receipt: session.arenaReceipt, replayed: true };
        }
        if (session.revisionNo !== expectedRevisionNo || session.mediaStage !== 'arena_testing') {
          fail('SESSION_REVISION_CONFLICT', '会话版本已变化，请刷新后重试', 409);
        }
        const recordedAt = deps.now().toISOString();
        const receipt: MultimodalArenaReceipt = {
          schemaVersion: 1,
          action: 'skill.media.test.start',
          idempotencyKey: key,
          requestHash,
          baseRevisionNo: expectedRevisionNo,
          resultRevisionNo: expectedRevisionNo + 1,
          recordedAt,
          evaluation,
        };
        const nextStage = evaluation.passed ? 'ready_to_publish' as const : 'arena_testing' as const;
        if (evaluation.passed) assertMediaStageTransition('arena_testing', nextStage);
        await deps.repository.saveArenaResult(db, {
          authUserId: input.authUserId,
          sessionId,
          expectedRevisionNo,
          expectedStage: 'arena_testing',
          resultRevisionNo: receipt.resultRevisionNo,
          mediaStage: nextStage,
          snapshot: preflight.snapshot!,
          receipt,
          updatedAt: recordedAt,
        });
        return { receipt, replayed: false };
      });
      return {
        sessionId,
        revisionNo: result.receipt.resultRevisionNo,
        mediaStage: result.receipt.evaluation.passed ? 'ready_to_publish' as const : 'arena_testing' as const,
        passed: result.receipt.evaluation.passed,
        evaluation: result.receipt.evaluation,
        replayed: result.replayed,
      };
    },

    async confirmGeneration(input: {
      authUserId: string;
      sessionId: string;
      idempotencyKey: string;
      expectedRevisionNo: number;
      targetPackageId: string | null;
      expectedPackageVersionId: string | null;
    }) {
      const sessionId = positiveId(input.sessionId, 'sessionId');
      const key = idempotencyKey(input.idempotencyKey);
      const expectedRevisionNo = revision(input.expectedRevisionNo);
      const targetPackageId = input.targetPackageId == null
        ? null
        : positiveId(input.targetPackageId, 'targetPackageId');
      const expectedPackageVersionId = input.expectedPackageVersionId == null
        ? null
        : positiveId(input.expectedPackageVersionId, 'expectedPackageVersionId');
      if ((targetPackageId == null) !== (expectedPackageVersionId == null)) {
        fail('INVALID_ARGUMENT', '更新已有 Package 时必须同时提供目标和预期版本', 422);
      }
      const requestHash = confirmGenerationRequestHash({
        sessionId,
        expectedRevisionNo,
        targetPackageId,
        expectedPackageVersionId,
      });
      return deps.withTransaction(async (db) => {
        const session = await deps.repository.loadForUpdate(db, {
          authUserId: input.authUserId,
          sessionId,
        });
        if (session.publishReceipt?.idempotencyKey === key) {
          if (
            session.publishReceipt.action !== 'skill.media.generate.confirm' ||
            session.publishReceipt.requestHash !== requestHash
          ) {
            fail('IDEMPOTENCY_KEY_REUSED', '相同 idempotencyKey 不能复用于不同生成请求', 409);
          }
          return {
            ...session.publishReceipt,
            sessionId,
            revisionNo: session.publishReceipt.resultRevisionNo,
            mediaStage: 'published' as const,
            replayed: true,
          };
        }
        if (session.publishReceipt) fail('ALREADY_PUBLISHED', '这些 Skill 已经生成', 409);
        if (session.revisionNo !== expectedRevisionNo) {
          fail('SESSION_REVISION_CONFLICT', '会话版本已变化，请刷新后重试', 409);
        }
        if (
          session.mediaStage !== 'arena_testing' &&
          session.mediaStage !== 'ready_to_publish'
        ) {
          fail('INVALID_MEDIA_STAGE', '当前阶段不能确认生成', 409);
        }
        const expectedStage = session.mediaStage;
        const snapshot = expectedStage === 'arena_testing'
          ? buildGeneratedSnapshot(session, expectedRevisionNo)
          : session.generatedSnapshot;
        if (!snapshot) fail('MULTIMODAL_SESSION_FAILED', '已确认的 Skill 快照缺失', 500);
        assertGeneratedSnapshotBoundToSession(session, snapshot);

        const nextConfirmedStages = session.confirmedStages.includes('publish')
          ? session.confirmedStages
          : [...session.confirmedStages, 'publish' as const];
        assertMediaStageTransition(expectedStage, 'publishing');
        assertMediaStageGate({ targetStage: 'publishing', confirmedStages: nextConfirmedStages });
        assertMediaStageTransition('publishing', 'published');
        assertMediaStageGate({ targetStage: 'published', confirmedStages: nextConfirmedStages });

        let packageIds: CreatedPackageSnapshotIds;
        try {
          packageIds = await deps.publishPackageTx(db, {
            authUserId: input.authUserId,
            snapshot,
            targetPackageId,
            expectedPackageVersionId,
          });
        } catch (error) {
          if (error instanceof Error && error.message === 'PACKAGE_VERSION_CONFLICT') {
            fail('PACKAGE_VERSION_CONFLICT', '目标 Package 版本已变化，请刷新后重试', 409);
          }
          throw error;
        }
        const publishedAt = deps.now().toISOString();
        const receipt: MultimodalPublishReceipt = {
          schemaVersion: 1,
          action: 'skill.media.generate.confirm',
          idempotencyKey: key,
          requestHash,
          baseRevisionNo: expectedRevisionNo,
          resultRevisionNo: expectedRevisionNo + 1,
          packageId: String(packageIds.packageId),
          packageVersionId: String(packageIds.packageVersionId),
          packageVersionNumber: packageIds.packageVersionNumber,
          skillVersionIds: packageIds.skillVersionIds,
          publishedAt,
        };
        await deps.repository.savePublished(db, {
          authUserId: input.authUserId,
          sessionId,
          expectedRevisionNo,
          expectedStage,
          snapshot,
          receipt,
          confirmedStages: nextConfirmedStages,
        });
        return {
          ...receipt,
          sessionId,
          revisionNo: receipt.resultRevisionNo,
          mediaStage: 'published' as const,
          replayed: false,
        };
      });
    },

    async publish(input: {
      authUserId: string;
      sessionId: string;
      idempotencyKey: string;
      expectedRevisionNo: number;
      targetPackageId: string | null;
      expectedPackageVersionId: string | null;
    }) {
      const sessionId = positiveId(input.sessionId, 'sessionId');
      const key = idempotencyKey(input.idempotencyKey);
      const expectedRevisionNo = revision(input.expectedRevisionNo);
      const targetPackageId = input.targetPackageId == null ? null : positiveId(input.targetPackageId, 'targetPackageId');
      const expectedPackageVersionId = input.expectedPackageVersionId == null ? null : positiveId(input.expectedPackageVersionId, 'expectedPackageVersionId');
      if ((targetPackageId == null) !== (expectedPackageVersionId == null)) {
        fail('INVALID_ARGUMENT', '更新已有 Package 时必须同时提供目标和预期版本', 422);
      }
      const requestHash = publishRequestHash({ sessionId, expectedRevisionNo, targetPackageId, expectedPackageVersionId });
      return deps.withTransaction(async (db) => {
        const session = await deps.repository.loadForUpdate(db, { authUserId: input.authUserId, sessionId });
        if (session.publishReceipt?.idempotencyKey === key) {
          if (session.publishReceipt.requestHash !== requestHash) fail('IDEMPOTENCY_KEY_REUSED', '相同 idempotencyKey 不能复用于不同发布请求', 409);
          return { ...session.publishReceipt, sessionId, mediaStage: 'published' as const, replayed: true };
        }
        if (session.publishReceipt) fail('ALREADY_PUBLISHED', '该工作区已经发布', 409);
        if (!session.arenaReceipt?.evaluation.passed) fail('QUALITY_GATE_FAILED', 'Arena 确定性门禁未通过，禁止发布', 422);
        if (session.revisionNo !== expectedRevisionNo) fail('SESSION_REVISION_CONFLICT', '会话版本已变化，请刷新后重试', 409);
        if (session.mediaStage !== 'ready_to_publish') fail('INVALID_MEDIA_STAGE', '当前阶段不能发布', 409);
        if (!session.generatedSnapshot) fail('MULTIMODAL_SESSION_FAILED', '已测试发布快照缺失', 500);
        const snapshotHash = computeMultimodalArenaSnapshotHash(session.generatedSnapshot);
        if (
          session.arenaReceipt.evaluation.candidateRevisionNo !== session.generatedSnapshot.metadata.candidateRevisionNo ||
          session.arenaReceipt.evaluation.snapshotHash !== snapshotHash
        ) fail('QUALITY_GATE_STALE', 'Arena 结果与当前 Skill 草稿不匹配，请重新测试', 409);
        assertArenaEvaluation(session.arenaReceipt.evaluation, {
          candidateRevisionNo: session.generatedSnapshot.metadata.candidateRevisionNo,
          snapshotHash,
        });
        const nextConfirmedStages = [...session.confirmedStages, 'publish' as const];
        assertMediaStageTransition('ready_to_publish', 'publishing');
        assertMediaStageGate({ targetStage: 'publishing', confirmedStages: nextConfirmedStages });
        assertMediaStageTransition('publishing', 'published');
        assertMediaStageGate({ targetStage: 'published', confirmedStages: nextConfirmedStages });
        let packageIds: CreatedPackageSnapshotIds;
        try {
          packageIds = await deps.publishPackageTx(db, {
            authUserId: input.authUserId,
            snapshot: session.generatedSnapshot,
            targetPackageId,
            expectedPackageVersionId,
          });
        } catch (error) {
          if (error instanceof Error && error.message === 'PACKAGE_VERSION_CONFLICT') {
            fail('PACKAGE_VERSION_CONFLICT', '目标 Package 版本已变化，请刷新后重试', 409);
          }
          throw error;
        }
        const publishedAt = deps.now().toISOString();
        const receipt: MultimodalPublishReceipt = {
          schemaVersion: 1,
          action: 'skill.media.publish',
          idempotencyKey: key,
          requestHash,
          baseRevisionNo: expectedRevisionNo,
          resultRevisionNo: expectedRevisionNo + 1,
          packageId: String(packageIds.packageId),
          packageVersionId: String(packageIds.packageVersionId),
          packageVersionNumber: packageIds.packageVersionNumber,
          skillVersionIds: packageIds.skillVersionIds,
          publishedAt,
        };
        await deps.repository.savePublished(db, {
          authUserId: input.authUserId,
          sessionId,
          expectedRevisionNo,
          expectedStage: 'ready_to_publish',
          snapshot: session.generatedSnapshot,
          receipt,
          confirmedStages: nextConfirmedStages,
        });
        return { ...receipt, sessionId, mediaStage: 'published' as const, replayed: false };
      });
    },
  };
}
