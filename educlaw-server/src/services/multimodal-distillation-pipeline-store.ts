import {
  MEDIA_JOB_STATUSES,
  parseMultimodalSessionState,
  type AdlerOverviewResult,
  type MediaEvidenceDegradation,
  type MediaJobType,
  type MediaJobStatus,
  type MultimodalEvidence,
  type MultimodalSessionState,
  type MultimodalTranscript,
  type NormalizedSemanticMoment,
} from '@educlaw/shared';
import { query, withTransaction, type Queryable } from './db.js';
import { GuidedCreationError } from './guided-creation-service.js';
import { buildDistillationResultHash } from './media-distillation-contract.js';
import { getGuidedCreationStatusForMediaStage } from './media-session-state-machine.js';
import { createMultimodalJobService } from './multimodal-job-service.js';
import {
  createMultimodalPipelineStore,
  type MultimodalPipelineSnapshot,
} from './multimodal-pipeline-store.js';

type DistillationStage =
  | 'building_semantic_windows'
  | 'building_evidence'
  | 'building_adler';

interface StoredJobResult {
  jobId: string;
  jobType: MediaJobType;
  status: MediaJobStatus;
  attemptNo: number;
  inputManifest: Record<string, unknown>;
  outputManifest: Record<string, unknown> | null;
}

interface Dependencies {
  query?: typeof query;
  withTransaction?: typeof withTransaction;
  now?: () => Date;
  pipelineStore?: Pick<
    ReturnType<typeof createMultimodalPipelineStore>,
    'loadSessionSnapshot'
  >;
  createMediaJobInTransaction?: ReturnType<
    typeof createMultimodalJobService
  >['createMediaJobInTransaction'];
}

interface SessionMutationRow {
  id: unknown;
  user_id: unknown;
  media_stage: unknown;
  revision_no: unknown;
  media_state_json: unknown;
}

function fail(code: string, message: string, statusCode: number): never {
  throw new GuidedCreationError(code, message, statusCode, code === 'SESSION_REVISION_CONFLICT');
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('MULTIMODAL_PIPELINE_FAILED', `${field} 损坏`, 500);
  }
  return value as Record<string, unknown>;
}

function positiveId(value: unknown, field: string): string {
  const normalized = String(value);
  if (!/^[1-9]\d*$/.test(normalized)) {
    fail('MULTIMODAL_PIPELINE_FAILED', `${field} 损坏`, 500);
  }
  return normalized;
}

function integer(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    fail('MULTIMODAL_PIPELINE_FAILED', `${field} 损坏`, 500);
  }
  return value;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return structuredClone(value);
  try {
    return JSON.parse(value);
  } catch {
    fail('MULTIMODAL_PIPELINE_FAILED', '持久化 JSON 损坏', 500);
  }
}

function parseJobRow(row: Record<string, unknown> | undefined): StoredJobResult | null {
  if (!row) return null;
  const jobType = row.job_type;
  if (
    jobType !== 'media_prepare' &&
    jobType !== 'transcribe' &&
    jobType !== 'frame_materialize' &&
    jobType !== 'media_quality_check'
  ) {
    fail('MULTIMODAL_PIPELINE_FAILED', '媒体任务类型损坏', 500);
  }
  const status = row.status;
  if (
    typeof status !== 'string' ||
    !MEDIA_JOB_STATUSES.includes(status as MediaJobStatus)
  ) {
    fail('MULTIMODAL_PIPELINE_FAILED', '媒体任务状态损坏', 500);
  }
  return {
    jobId: positiveId(row.id, 'jobId'),
    jobType,
    status: status as MediaJobStatus,
    attemptNo: integer(row.attempt_no, 'attemptNo'),
    inputManifest: record(parseJson(row.input_manifest_json), 'inputManifest'),
    outputManifest:
      row.output_manifest_json == null
        ? null
        : record(parseJson(row.output_manifest_json), 'outputManifest'),
  };
}

export function createMultimodalDistillationPipelineStore(
  dependencies: Dependencies = {},
) {
  const queryFn = dependencies.query ?? query;
  const transaction = dependencies.withTransaction ?? withTransaction;
  const now = dependencies.now ?? (() => new Date());
  const pipelineStore =
    dependencies.pipelineStore ?? createMultimodalPipelineStore({ query: queryFn });
  const createJob =
    dependencies.createMediaJobInTransaction ??
    createMultimodalJobService().createMediaJobInTransaction;

  async function lockSession(
    db: Queryable,
    input: {
      authUserId: string;
      sessionId: string;
      expectedRevisionNo: number;
      expectedStage: DistillationStage;
    },
  ): Promise<MultimodalSessionState> {
    const result = await db.query<SessionMutationRow>(
      `select id, user_id, media_stage, revision_no, media_state_json
         from skill_guided_creation_sessions
        where id = $1
          and user_id = $2
          and creation_mode = 'multimodal_distill'
          and deleted_at is null
        for update`,
      [input.sessionId, input.authUserId],
    );
    const row = result.rows[0];
    if (!row) fail('GUIDED_SESSION_NOT_FOUND', '没有找到这个多模态会话', 404);
    if (
      positiveId(row.id, 'sessionId') !== input.sessionId ||
      integer(row.revision_no, 'revisionNo') !== input.expectedRevisionNo ||
      row.media_stage !== input.expectedStage
    ) {
      fail('SESSION_REVISION_CONFLICT', '会话版本已变化，请刷新后重试', 409);
    }
    try {
      return parseMultimodalSessionState(parseJson(row.media_state_json));
    } catch {
      fail('MULTIMODAL_PIPELINE_FAILED', '媒体会话状态损坏', 500);
    }
  }

  async function updateSession(
    db: Queryable,
    input: {
      authUserId: string;
      sessionId: string;
      expectedRevisionNo: number;
      expectedStage: DistillationStage;
      nextStage: DistillationStage | 'awaiting_adler_overview';
      nextState: MultimodalSessionState;
    },
  ): Promise<void> {
    const result = await db.query(
      `update skill_guided_creation_sessions
          set media_stage = $1,
              status = $2,
              media_state_json = $3::jsonb,
              revision_no = revision_no + 1,
              error_json = null,
              updated_at = $4
        where id = $5
          and user_id = $6
          and creation_mode = 'multimodal_distill'
          and deleted_at is null
          and revision_no = $7
          and media_stage = $8`,
      [
        input.nextStage,
        getGuidedCreationStatusForMediaStage(input.nextStage),
        JSON.stringify(input.nextState),
        now().toISOString(),
        input.sessionId,
        input.authUserId,
        input.expectedRevisionNo,
        input.expectedStage,
      ],
    );
    if (result.rowCount !== 1) {
      fail('SESSION_REVISION_CONFLICT', '会话版本已变化，请刷新后重试', 409);
    }
  }

  async function loadSnapshot(input: {
    authUserId: string;
    sessionId: string;
  }): Promise<MultimodalPipelineSnapshot> {
    return pipelineStore.loadSessionSnapshot(input);
  }

  return {
    loadSnapshot,

    async loadLatestJob(input: {
      sessionId: string;
      jobType: 'media_prepare' | 'transcribe' | 'frame_materialize';
    }): Promise<StoredJobResult | null> {
      const result = await queryFn<Record<string, unknown>>(
        `select id, job_type, status, attempt_no,
                input_manifest_json, output_manifest_json
           from skill_media_jobs
          where session_id = $1
            and job_type = $2
          order by created_at desc, id desc
          limit 1`,
        [input.sessionId, input.jobType],
      );
      return parseJobRow(result.rows[0]);
    },

    async persistSemanticPlan(input: {
      authUserId: string;
      sessionId: string;
      expectedRevisionNo: number;
      semanticMoments: NormalizedSemanticMoment[];
      degradations: MediaEvidenceDegradation[];
      evidenceItems?: MultimodalEvidence[];
      frameJobInput?: Record<string, unknown>;
      transcript?: MultimodalTranscript;
    }): Promise<MultimodalPipelineSnapshot> {
      await transaction(async (db) => {
        const state = await lockSession(db, {
          ...input,
          expectedStage: 'building_semantic_windows',
        });
        if (input.frameJobInput) {
          await createJob({
            db,
            sessionId: input.sessionId,
            jobType: 'frame_materialize',
            idempotencyKey: `semantic-${input.expectedRevisionNo}-frames`,
            requestHash: buildDistillationResultHash(input.frameJobInput),
            inputManifest: input.frameJobInput,
          });
        }
        const nextState = parseMultimodalSessionState({
          ...state,
          semanticMoments: input.semanticMoments,
          ...(input.transcript ? { transcript: input.transcript } : {}),
          evidenceTimeline: {
            evidenceItems: input.evidenceItems ?? state.evidenceTimeline.evidenceItems,
          },
          degradations: input.degradations,
        });
        await updateSession(db, {
          ...input,
          expectedStage: 'building_semantic_windows',
          nextStage: 'building_evidence',
          nextState,
        });
      });
      return loadSnapshot(input);
    },

    async persistEvidence(input: {
      authUserId: string;
      sessionId: string;
      expectedRevisionNo: number;
      evidenceItems: MultimodalEvidence[];
      degradations: MediaEvidenceDegradation[];
      repairBuildingAdler?: boolean;
    }): Promise<MultimodalPipelineSnapshot> {
      await transaction(async (db) => {
        const expectedStage: DistillationStage = input.repairBuildingAdler
          ? 'building_adler'
          : 'building_evidence';
        const state = await lockSession(db, {
          ...input,
          expectedStage,
        });
        if (
          input.repairBuildingAdler &&
          (state.primarySource?.kind !== 'video' ||
            state.evidenceTimeline.evidenceItems.some(
              (item) => item.kind === 'frame',
            ))
        ) {
          fail(
            'MULTIMODAL_PIPELINE_FAILED',
            '当前会话不需要修复视觉证据',
            409,
          );
        }
        const nextState = parseMultimodalSessionState({
          ...state,
          evidenceTimeline: { evidenceItems: input.evidenceItems },
          degradations: input.degradations,
        });
        await updateSession(db, {
          ...input,
          expectedStage,
          nextStage: 'building_adler',
          nextState,
        });
      });
      return loadSnapshot(input);
    },

    async persistAdler(input: {
      authUserId: string;
      sessionId: string;
      expectedRevisionNo: number;
      adlerOverview: AdlerOverviewResult;
    }): Promise<MultimodalPipelineSnapshot> {
      await transaction(async (db) => {
        const state = await lockSession(db, {
          ...input,
          expectedStage: 'building_adler',
        });
        const nextState = parseMultimodalSessionState({
          ...state,
          adlerOverview: input.adlerOverview,
        });
        await updateSession(db, {
          ...input,
          expectedStage: 'building_adler',
          nextStage: 'awaiting_adler_overview',
          nextState,
        });
      });
      return loadSnapshot(input);
    },
  };
}

export type MultimodalDistillationPipelineStore = ReturnType<
  typeof createMultimodalDistillationPipelineStore
>;
