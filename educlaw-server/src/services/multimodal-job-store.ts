import {
  parseMediaJobRecord,
  type MediaJobStatus,
  type MediaJobType,
} from '@educlaw/shared';
import type { Queryable } from './db.js';

const SHA256_HEX = /^[0-9a-f]{64}$/;
const GUIDED_SESSION_STATUSES = [
  'collecting',
  'ready_for_confirmation',
  'finalizing',
  'completed',
  'failed',
  'cancelled',
] as const;
const GUIDED_SESSION_CREATION_MODES = ['guided', 'multimodal_distill'] as const;

type GuidedSessionStatus = (typeof GUIDED_SESSION_STATUSES)[number];
type GuidedSessionCreationMode = (typeof GUIDED_SESSION_CREATION_MODES)[number];

export class MultimodalJobStoreError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 409,
    public readonly retryable = false,
  ) {
    super(message);
  }
}

export interface MultimodalSessionCreateRow {
  id: string;
  status: GuidedSessionStatus;
  deletedAt: string | null;
  creationMode: GuidedSessionCreationMode;
}

export interface StoredMultimodalJob {
  id: string;
  sessionId: string;
  jobType: MediaJobType;
  status: MediaJobStatus;
  idempotencyKey: string;
  requestHash: string;
  attemptNo: number;
  maxAttempts: number;
  leaseOwner: string | null;
  leaseTokenHash: string | null;
  leaseExpiresAt: string | null;
  heartbeatAt: string | null;
  progress: Record<string, unknown>;
  inputManifest: Record<string, unknown>;
  outputManifest: Record<string, unknown> | null;
  resultHash: string | null;
  error: Record<string, unknown> | null;
  cancelRequestedAt: string | null;
  availableAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  sessionStatus?: GuidedSessionStatus;
  sessionDeletedAt?: string | null;
  sessionCreationMode?: GuidedSessionCreationMode;
}

interface DbMediaJobRow {
  id: string | number;
  session_id: string | number;
  job_type: unknown;
  status: unknown;
  idempotency_key: unknown;
  request_hash: unknown;
  attempt_no: unknown;
  max_attempts: unknown;
  lease_owner: unknown;
  lease_token_hash: unknown;
  lease_expires_at: string | Date | null;
  heartbeat_at: string | Date | null;
  progress_json: unknown;
  input_manifest_json: unknown;
  output_manifest_json: unknown;
  result_hash: unknown;
  error_json: unknown;
  cancel_requested_at: string | Date | null;
  available_at: string | Date;
  started_at: string | Date | null;
  finished_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
  session_status?: unknown;
  session_deleted_at?: string | Date | null;
  session_creation_mode?: unknown;
}

function dataIntegrity(message: string): never {
  throw new MultimodalJobStoreError('DATA_INTEGRITY_ERROR', message, 500);
}

function asIso(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function readGuidedSessionStatus(
  value: unknown,
  fieldName: string,
): GuidedSessionStatus {
  if (
    typeof value !== 'string' ||
    !GUIDED_SESSION_STATUSES.includes(value as GuidedSessionStatus)
  ) {
    dataIntegrity(`${fieldName} is invalid`);
  }
  return value as GuidedSessionStatus;
}

function readCreationMode(
  value: unknown,
  fieldName: string,
): GuidedSessionCreationMode {
  if (
    typeof value !== 'string' ||
    !GUIDED_SESSION_CREATION_MODES.includes(value as GuidedSessionCreationMode)
  ) {
    dataIntegrity(`${fieldName} is invalid`);
  }
  return value as GuidedSessionCreationMode;
}

function readOptionalString(value: unknown, fieldName: string): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    dataIntegrity(`${fieldName} is invalid`);
  }
  return value;
}

function readOptionalSha256(value: unknown, fieldName: string): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value !== 'string' || !SHA256_HEX.test(value)) {
    dataIntegrity(`${fieldName} is invalid`);
  }
  return value;
}

function expectSingleRow<T>(rows: T[], code = 'JOB_LEASE_CONFLICT'): T {
  const row = rows[0];
  if (!row) {
    throw new MultimodalJobStoreError(
      code,
      'Expected a single row update result',
    );
  }
  return row;
}

function mapJobRow(row: DbMediaJobRow): StoredMultimodalJob {
  let parsed;
  try {
    parsed = parseMediaJobRecord({
      id: String(row.id),
      sessionId: String(row.session_id),
      jobType: row.job_type,
      status: row.status,
      idempotencyKey: row.idempotency_key,
      requestHash: row.request_hash,
      attemptNo: row.attempt_no,
      maxAttempts: row.max_attempts,
      progress: row.progress_json,
      inputManifest: row.input_manifest_json,
      outputManifest: row.output_manifest_json,
      resultHash: row.result_hash,
      error: row.error_json,
    });
  } catch {
    dataIntegrity('skill_media_jobs row failed runtime validation');
  }

  const sessionStatus =
    row.session_status === undefined
      ? undefined
      : readGuidedSessionStatus(row.session_status, 'session_status');
  const sessionCreationMode =
    row.session_creation_mode === undefined
      ? undefined
      : readCreationMode(row.session_creation_mode, 'session_creation_mode');

  return {
    id: parsed.id,
    sessionId: parsed.sessionId,
    jobType: parsed.jobType,
    status: parsed.status,
    idempotencyKey: parsed.idempotencyKey,
    requestHash: parsed.requestHash,
    attemptNo: parsed.attemptNo,
    maxAttempts: parsed.maxAttempts,
    leaseOwner: readOptionalString(row.lease_owner, 'lease_owner'),
    leaseTokenHash: readOptionalSha256(
      row.lease_token_hash,
      'lease_token_hash',
    ),
    leaseExpiresAt: asIso(row.lease_expires_at),
    heartbeatAt: asIso(row.heartbeat_at),
    progress: parsed.progress,
    inputManifest: parsed.inputManifest,
    outputManifest: parsed.outputManifest ?? null,
    resultHash: parsed.resultHash ?? null,
    error: parsed.error ?? null,
    cancelRequestedAt: asIso(row.cancel_requested_at),
    availableAt: asIso(row.available_at) ?? new Date(0).toISOString(),
    startedAt: asIso(row.started_at),
    finishedAt: asIso(row.finished_at),
    createdAt: asIso(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: asIso(row.updated_at) ?? new Date(0).toISOString(),
    sessionStatus,
    sessionDeletedAt: asIso(row.session_deleted_at),
    sessionCreationMode,
  };
}

export function createMultimodalJobStore() {
  return {
    async loadSessionForCreate(input: {
      db: Queryable;
      sessionId: string;
    }): Promise<MultimodalSessionCreateRow | null> {
      const result = await input.db.query<{
        id: string | number;
        status: unknown;
        deleted_at: string | Date | null;
        creation_mode: unknown;
      }>(
        `select id, status, deleted_at, creation_mode
           from skill_guided_creation_sessions
          where id = $1`,
        [input.sessionId],
      );
      const row = result.rows[0];
      if (!row) return null;
      return {
        id: String(row.id),
        status: readGuidedSessionStatus(row.status, 'session.status'),
        deletedAt: asIso(row.deleted_at),
        creationMode: readCreationMode(
          row.creation_mode,
          'session.creation_mode',
        ),
      };
    },

    async tryInsertJob(input: {
      db: Queryable;
      sessionId: string;
      jobType: MediaJobType;
      idempotencyKey: string;
      requestHash: string;
      maxAttempts: number;
      progress: Record<string, unknown>;
      inputManifest: Record<string, unknown>;
      now: Date;
    }): Promise<StoredMultimodalJob | null> {
      const nowIso = input.now.toISOString();
      const result = await input.db.query<DbMediaJobRow>(
        `insert into skill_media_jobs (
           session_id,
           job_type,
           status,
           idempotency_key,
           request_hash,
           attempt_no,
           max_attempts,
           progress_json,
           input_manifest_json,
           available_at,
           created_at,
           updated_at
         ) values (
           $1,
           $2,
           'queued',
           $3,
           $4,
           0,
           $5,
           $6::jsonb,
           $7::jsonb,
           $8,
           $8,
           $8
         )
         on conflict (session_id, job_type, idempotency_key) do nothing
         returning *`,
        [
          input.sessionId,
          input.jobType,
          input.idempotencyKey,
          input.requestHash,
          input.maxAttempts,
          JSON.stringify(input.progress),
          JSON.stringify(input.inputManifest),
          nowIso,
        ],
      );
      const row = result.rows[0];
      return row ? mapJobRow(row) : null;
    },

    async findJobByIdempotencyKey(input: {
      db: Queryable;
      sessionId: string;
      jobType: MediaJobType;
      idempotencyKey: string;
    }): Promise<StoredMultimodalJob | null> {
      const result = await input.db.query<DbMediaJobRow>(
        `select *
           from skill_media_jobs
          where session_id = $1
            and job_type = $2
            and idempotency_key = $3
          order by created_at desc
          limit 1`,
        [input.sessionId, input.jobType, input.idempotencyKey],
      );
      const row = result.rows[0];
      return row ? mapJobRow(row) : null;
    },

    async claimNextJob(input: {
      db: Queryable;
      now: Date;
      acceptedJobTypes: readonly MediaJobType[];
      leaseOwner: string;
      leaseTokenHash: string;
      leaseExpiresAt: Date;
    }): Promise<StoredMultimodalJob | null> {
      const result = await input.db.query<DbMediaJobRow>(
        `with eligible as (
           select jobs.id
             from skill_media_jobs jobs
             join skill_guided_creation_sessions sessions
               on sessions.id = jobs.session_id
            where jobs.status = 'queued'
              and jobs.cancel_requested_at is null
              and jobs.available_at <= $1
              and jobs.job_type = any($2::text[])
              and jobs.attempt_no < jobs.max_attempts
              and sessions.deleted_at is null
              and sessions.creation_mode = 'multimodal_distill'
              and sessions.status = 'collecting'
            order by jobs.created_at asc
            limit 1
            for update of jobs skip locked
         )
         update skill_media_jobs jobs
            set status = 'leased',
                lease_owner = $3,
                lease_token_hash = $4,
                lease_expires_at = $5,
                heartbeat_at = $1,
                started_at = coalesce(jobs.started_at, $1),
                attempt_no = jobs.attempt_no + 1,
                updated_at = $1
           from eligible
          where jobs.id = eligible.id
          returning jobs.*`,
        [
          input.now.toISOString(),
          input.acceptedJobTypes,
          input.leaseOwner,
          input.leaseTokenHash,
          input.leaseExpiresAt.toISOString(),
        ],
      );
      const row = result.rows[0];
      return row ? mapJobRow(row) : null;
    },

    async loadJobForLeaseMutation(input: {
      db: Queryable;
      jobId: string;
    }): Promise<StoredMultimodalJob | null> {
      const result = await input.db.query<DbMediaJobRow>(
        `select jobs.*,
                sessions.status as session_status,
                sessions.deleted_at as session_deleted_at,
                sessions.creation_mode as session_creation_mode
           from skill_media_jobs jobs
          join skill_guided_creation_sessions sessions
            on sessions.id = jobs.session_id
         where jobs.id = $1
          for update of jobs`,
        [input.jobId],
      );
      const row = result.rows[0];
      return row ? mapJobRow(row) : null;
    },

    async updateHeartbeat(input: {
      db: Queryable;
      jobId: string;
      progress: Record<string, unknown>;
      heartbeatAt: Date;
      leaseExpiresAt: Date;
    }) {
      const result = await input.db.query<DbMediaJobRow>(
        `update skill_media_jobs
            set progress_json = $2::jsonb,
                heartbeat_at = $3,
                lease_expires_at = $4,
                updated_at = $3
          where id = $1
          returning *`,
        [
          input.jobId,
          JSON.stringify(input.progress),
          input.heartbeatAt.toISOString(),
          input.leaseExpiresAt.toISOString(),
        ],
      );
      const row = mapJobRow(expectSingleRow(result.rows));
      return {
        jobId: row.id,
        status: row.status,
        leaseExpiresAt: row.leaseExpiresAt,
        progress: row.progress,
      };
    },

    async completeJob(input: {
      db: Queryable;
      jobId: string;
      resultHash: string;
      outputManifest: Record<string, unknown>;
      finishedAt: Date;
    }) {
      const result = await input.db.query<DbMediaJobRow>(
        `update skill_media_jobs
            set status = 'succeeded',
                output_manifest_json = $2::jsonb,
                result_hash = $3,
                error_json = null,
                finished_at = $4,
                lease_owner = null,
                lease_token_hash = null,
                lease_expires_at = null,
                heartbeat_at = null,
                updated_at = $4
          where id = $1
          returning *`,
        [
          input.jobId,
          JSON.stringify(input.outputManifest),
          input.resultHash,
          input.finishedAt.toISOString(),
        ],
      );
      const row = mapJobRow(expectSingleRow(result.rows));
      return {
        jobId: row.id,
        status: row.status,
        resultHash: row.resultHash,
        outputManifest: row.outputManifest,
        finishedAt: row.finishedAt,
        replayed: false,
      };
    },

    async failJob(input: {
      db: Queryable;
      jobId: string;
      status: 'queued' | 'failed';
      error: Record<string, unknown>;
      now: Date;
      availableAt: Date | null;
      finishedAt: Date | null;
    }) {
      const result = await input.db.query<DbMediaJobRow>(
        `update skill_media_jobs
            set status = $2,
                error_json = $3::jsonb,
                available_at = coalesce($4, available_at),
                finished_at = $5,
                lease_owner = null,
                lease_token_hash = null,
                lease_expires_at = null,
                heartbeat_at = null,
                updated_at = $6
          where id = $1
          returning *`,
        [
          input.jobId,
          input.status,
          JSON.stringify(input.error),
          input.availableAt?.toISOString() ?? null,
          input.finishedAt?.toISOString() ?? null,
          input.now.toISOString(),
        ],
      );
      const row = mapJobRow(expectSingleRow(result.rows));
      return {
        jobId: row.id,
        status: row.status,
        availableAt: row.availableAt,
        finishedAt: row.finishedAt,
        retryScheduled: row.status === 'queued',
      };
    },

    async recycleExpiredLeases(input: { db: Queryable; now: Date }): Promise<
      Array<{
        jobId: string;
        sessionId: string;
        jobType: MediaJobType;
        status: MediaJobStatus;
        availableAt: string | null;
        finishedAt: string | null;
        retryScheduled: boolean;
      }>
    > {
      const result = await input.db.query<DbMediaJobRow>(
        `with expired as (
           select jobs.id, jobs.attempt_no, jobs.max_attempts, jobs.cancel_requested_at
             from skill_media_jobs jobs
            where jobs.status = 'leased'
              and jobs.lease_expires_at <= $1
            for update
         )
         update skill_media_jobs jobs
            set status = case
                  when expired.cancel_requested_at is not null then 'cancelled'
                  when jobs.attempt_no >= jobs.max_attempts then 'failed'
                  else 'queued'
                end,
                available_at = case
                  when expired.cancel_requested_at is not null then jobs.available_at
                  when jobs.attempt_no >= jobs.max_attempts then jobs.available_at
                  else (
                    $1::timestamptz
                    + make_interval(secs => least(300, greatest(15, jobs.attempt_no * 15)))
                  )
                end,
                finished_at = case
                  when expired.cancel_requested_at is not null then $1
                  when jobs.attempt_no >= jobs.max_attempts then $1
                  else null
                end,
                error_json = case
                  when expired.cancel_requested_at is not null then jobs.error_json
                  when jobs.attempt_no >= jobs.max_attempts then jsonb_build_object(
                    'code', 'WORKER_LEASE_EXPIRED',
                    'message', 'Worker lease expired before completion',
                    'retryable', false,
                    'details', jsonb_build_object(
                      'resumeFromStage', case jobs.job_type
                        when 'media_quality_check' then 'uploading'
                        when 'media_prepare' then 'preparing_media'
                        when 'transcribe' then 'transcribing'
                        when 'frame_materialize' then 'building_evidence'
                      end
                    )
                  )
                  else jsonb_build_object(
                    'code', 'WORKER_LEASE_EXPIRED',
                    'retryable', true
                  )
                end,
                lease_owner = null,
                lease_token_hash = null,
                lease_expires_at = null,
                heartbeat_at = null,
                updated_at = $1
           from expired
          where jobs.id = expired.id
          returning jobs.*`,
        [input.now.toISOString()],
      );
      return result.rows.map((row) => {
        const job = mapJobRow(row);
        return {
          jobId: job.id,
          sessionId: job.sessionId,
          jobType: job.jobType,
          status: job.status,
          availableAt: job.availableAt,
          finishedAt: job.finishedAt,
          retryScheduled: job.status === 'queued',
        };
      });
    },

    async cancelJob(input: {
      db: Queryable;
      jobId: string;
      now: Date;
    }): Promise<{
      jobId: string;
      status: MediaJobStatus;
      cancelRequestedAt: string | null;
      finishedAt: string | null;
    } | null> {
      const result = await input.db.query<DbMediaJobRow>(
        `with cancelled as (
           update skill_media_jobs
              set status = 'cancelled',
                  finished_at = $2,
                  lease_owner = null,
                  lease_token_hash = null,
                  lease_expires_at = null,
                  heartbeat_at = null,
                  updated_at = $2
            where id = $1
              and status = 'queued'
            returning *
         ), signalled as (
           update skill_media_jobs
              set cancel_requested_at = coalesce(cancel_requested_at, $2),
                  updated_at = $2
            where id = $1
              and status = 'leased'
            returning *
         )
         select * from cancelled
         union all
         select * from signalled
         limit 1`,
        [input.jobId, input.now.toISOString()],
      );
      const row = result.rows[0];
      if (!row) return null;
      const job = mapJobRow(row);
      return {
        jobId: job.id,
        status: job.status,
        cancelRequestedAt: job.cancelRequestedAt,
        finishedAt: job.finishedAt,
      };
    },
  };
}
