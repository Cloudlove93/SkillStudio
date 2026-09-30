import { describe, expect, it, vi } from 'vitest';
import { createMultimodalJobStore } from './multimodal-job-store.js';

function makeJobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '301',
    session_id: '91',
    job_type: 'transcribe',
    status: 'leased',
    idempotency_key: 'job-key-1',
    request_hash: 'a'.repeat(64),
    attempt_no: 1,
    max_attempts: 3,
    lease_owner: 'worker-a',
    lease_token_hash: 'b'.repeat(64),
    lease_expires_at: '2026-08-21T00:01:00.000Z',
    heartbeat_at: '2026-08-21T00:00:30.000Z',
    progress_json: { stage: 'transcribe', percent: 25 },
    input_manifest_json: { source: 'audio' },
    output_manifest_json: null,
    result_hash: null,
    error_json: null,
    cancel_requested_at: null,
    available_at: '2026-08-21T00:00:00.000Z',
    started_at: '2026-08-21T00:00:00.000Z',
    finished_at: null,
    created_at: '2026-08-21T00:00:00.000Z',
    updated_at: '2026-08-21T00:00:00.000Z',
    ...overrides,
  };
}

describe('multimodal job store', () => {
  it('loads validated session creation preconditions and inserts multimodal jobs with the exact idempotency key scope', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              id: '91',
              status: 'collecting',
              deleted_at: null,
              creation_mode: 'multimodal_distill',
            },
          ],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [makeJobRow({ status: 'queued', attempt_no: 0 })],
        }),
    };
    const store = createMultimodalJobStore();

    const session = await store.loadSessionForCreate({ db, sessionId: '91' });
    const inserted = await store.tryInsertJob({
      db,
      sessionId: '91',
      jobType: 'transcribe',
      idempotencyKey: 'job-key-1',
      requestHash: 'a'.repeat(64),
      maxAttempts: 3,
      progress: {},
      inputManifest: { source: 'audio' },
      now: new Date('2026-08-21T00:00:00.000Z'),
    });

    const [loadSql] = db.query.mock.calls[0] ?? [];
    const [insertSql] = db.query.mock.calls[1] ?? [];
    expect(String(loadSql).toLowerCase()).toContain(
      'from skill_guided_creation_sessions',
    );
    expect(String(insertSql).toLowerCase()).toContain(
      'on conflict (session_id, job_type, idempotency_key)',
    );
    expect(session).toEqual({
      id: '91',
      status: 'collecting',
      deletedAt: null,
      creationMode: 'multimodal_distill',
    });
    expect(inserted?.status).toBe('queued');
  });

  it('rejects invalid session rows and malformed job rows from the database', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              id: '91',
              status: 'mystery',
              deleted_at: null,
              creation_mode: 'multimodal_distill',
            },
          ],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [makeJobRow({ status: 'processing' })],
        }),
    };
    const store = createMultimodalJobStore();

    await expect(
      store.loadSessionForCreate({ db, sessionId: '91' }),
    ).rejects.toMatchObject({
      code: 'DATA_INTEGRITY_ERROR',
    });

    await expect(
      store.claimNextJob({
        db,
        now: new Date('2026-08-21T00:00:00.000Z'),
        acceptedJobTypes: ['transcribe'],
        leaseOwner: 'worker-a',
        leaseTokenHash: 'b'.repeat(64),
        leaseExpiresAt: new Date('2026-08-21T00:01:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'DATA_INTEGRITY_ERROR' });
  });

  it('returns null when the insert loses the idempotency race instead of faking 23505', async () => {
    const db = {
      query: vi.fn().mockResolvedValue({ rowCount: 0, rows: [] }),
    };
    const store = createMultimodalJobStore();

    const inserted = await store.tryInsertJob({
      db,
      sessionId: '91',
      jobType: 'transcribe',
      idempotencyKey: 'job-key-1',
      requestHash: 'a'.repeat(64),
      maxAttempts: 3,
      progress: {},
      inputManifest: { source: 'audio' },
      now: new Date('2026-08-21T00:00:00.000Z'),
    });

    expect(inserted).toBeNull();
  });

  it('claims jobs with a skip-locked lease query that filters to live multimodal collecting sessions', async () => {
    const db = {
      query: vi.fn().mockResolvedValue({ rowCount: 1, rows: [makeJobRow()] }),
    };
    const store = createMultimodalJobStore();

    const result = await store.claimNextJob({
      db,
      now: new Date('2026-08-21T00:00:00.000Z'),
      acceptedJobTypes: ['transcribe'],
      leaseOwner: 'worker-a',
      leaseTokenHash: 'b'.repeat(64),
      leaseExpiresAt: new Date('2026-08-21T00:01:00.000Z'),
    });

    const [sql, values] = db.query.mock.calls[0] ?? [];
    const normalizedSql = String(sql).toLowerCase();
    expect(normalizedSql).toContain('join skill_guided_creation_sessions');
    expect(normalizedSql).toContain(
      "sessions.creation_mode = 'multimodal_distill'",
    );
    expect(normalizedSql).toContain("sessions.status = 'collecting'");
    expect(normalizedSql).toContain('sessions.deleted_at is null');
    expect(normalizedSql).toContain('cancel_requested_at is null');
    expect(normalizedSql).toContain('limit 1');
    expect(normalizedSql).toContain('for update of jobs skip locked');
    expect(normalizedSql).toContain('jobs.attempt_no < jobs.max_attempts');
    expect(normalizedSql).toContain('available_at <= $1');
    expect(values?.[1]).toEqual(['transcribe']);
    expect(result?.status).toBe('leased');
    expect(result?.attemptNo).toBe(1);
  });

  it('locks only the job row for lease mutation', async () => {
    const db = {
      query: vi.fn().mockResolvedValue({
        rowCount: 1,
        rows: [
          makeJobRow({
            session_status: 'collecting',
            session_creation_mode: 'multimodal_distill',
          }),
        ],
      }),
    };
    const store = createMultimodalJobStore();

    const result = await store.loadJobForLeaseMutation({
      db,
      jobId: '301',
    });

    const [sql] = db.query.mock.calls[0] ?? [];
    expect(String(sql).toLowerCase()).toContain('for update of jobs');
    expect(result?.id).toBe('301');
  });

  it('recycles expired leases exactly at expiry and distinguishes retry, terminal, and cancel-requested outcomes', async () => {
    const db = {
      query: vi.fn().mockResolvedValue({
        rowCount: 3,
        rows: [
          makeJobRow({
            id: '401',
            status: 'queued',
            available_at: '2026-08-21T00:00:15.000Z',
            error_json: { code: 'WORKER_LEASE_EXPIRED' },
          }),
          makeJobRow({
            id: '402',
            status: 'failed',
            finished_at: '2026-08-21T00:00:00.000Z',
            error_json: { code: 'WORKER_LEASE_EXPIRED' },
          }),
          makeJobRow({
            id: '403',
            status: 'cancelled',
            cancel_requested_at: '2026-08-21T00:00:30.000Z',
            finished_at: '2026-08-21T00:01:00.000Z',
          }),
        ],
      }),
    };
    const store = createMultimodalJobStore();

    const result = await store.recycleExpiredLeases({
      db,
      now: new Date('2026-08-21T00:01:00.000Z'),
    });

    const [sql] = db.query.mock.calls[0] ?? [];
    const normalizedSql = String(sql).toLowerCase();
    expect(normalizedSql).toContain("status = 'leased'");
    expect(normalizedSql).toContain('lease_expires_at <= $1');
    expect(normalizedSql).toContain('jobs.attempt_no >= jobs.max_attempts');
    expect(normalizedSql).toContain('cancel_requested_at');
    expect(normalizedSql).toContain('worker_lease_expired');
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ status: 'queued', retryScheduled: true });
    expect(result[1]).toMatchObject({
      status: 'failed',
      retryScheduled: false,
    });
    expect(result[2]).toMatchObject({
      status: 'cancelled',
      retryScheduled: false,
      finishedAt: '2026-08-21T00:01:00.000Z',
    });
  });

  it('cancels queued jobs immediately and only signals leased jobs', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            makeJobRow({
              status: 'cancelled',
              finished_at: '2026-08-21T00:00:00.000Z',
            }),
          ],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            makeJobRow({
              status: 'leased',
              cancel_requested_at: '2026-08-21T00:00:00.000Z',
            }),
          ],
        }),
    };
    const store = createMultimodalJobStore();

    const cancelled = await store.cancelJob({
      db,
      jobId: '301',
      now: new Date('2026-08-21T00:00:00.000Z'),
    });
    const signalled = await store.cancelJob({
      db,
      jobId: '301',
      now: new Date('2026-08-21T00:00:00.000Z'),
    });

    const [sql] = db.query.mock.calls[0] ?? [];
    expect(String(sql).toLowerCase()).toContain('cancel_requested_at');
    expect(String(sql).toLowerCase()).toContain("status = 'cancelled'");
    expect(cancelled?.status).toBe('cancelled');
    expect(signalled?.status).toBe('leased');
    expect(signalled?.cancelRequestedAt).toBe('2026-08-21T00:00:00.000Z');
  });

  it('writes completion with cleared stale error and cleared lease fields', async () => {
    const db = {
      query: vi.fn().mockResolvedValue({
        rowCount: 1,
        rows: [
          makeJobRow({
            status: 'succeeded',
            result_hash: 'd'.repeat(64),
            output_manifest_json: { processorVersion: 'media-v1' },
            finished_at: '2026-08-21T00:00:00.000Z',
            lease_owner: null,
            lease_token_hash: null,
            lease_expires_at: null,
            heartbeat_at: null,
            error_json: null,
          }),
        ],
      }),
    };
    const store = createMultimodalJobStore();

    const result = await store.completeJob({
      db,
      jobId: '301',
      resultHash: 'd'.repeat(64),
      outputManifest: { processorVersion: 'media-v1' },
      finishedAt: new Date('2026-08-21T00:00:00.000Z'),
    });

    const [sql] = db.query.mock.calls[0] ?? [];
    const normalizedSql = String(sql).toLowerCase();
    expect(normalizedSql).toContain('error_json = null');
    expect(normalizedSql).toContain('lease_owner = null');
    expect(normalizedSql).toContain('lease_token_hash = null');
    expect(normalizedSql).toContain('lease_expires_at = null');
    expect(normalizedSql).toContain('heartbeat_at = null');
    expect(result.status).toBe('succeeded');
  });

  it('throws a stable conflict instead of crashing when heartbeat affects no rows', async () => {
    const db = {
      query: vi.fn().mockResolvedValue({ rowCount: 0, rows: [] }),
    };
    const store = createMultimodalJobStore();

    await expect(
      store.updateHeartbeat({
        db,
        jobId: '301',
        progress: {},
        heartbeatAt: new Date('2026-08-21T00:00:00.000Z'),
        leaseExpiresAt: new Date('2026-08-21T00:01:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'JOB_LEASE_CONFLICT' });
  });

  it('throws a stable conflict instead of crashing when complete affects no rows', async () => {
    const db = {
      query: vi.fn().mockResolvedValue({ rowCount: 0, rows: [] }),
    };
    const store = createMultimodalJobStore();

    await expect(
      store.completeJob({
        db,
        jobId: '301',
        resultHash: 'd'.repeat(64),
        outputManifest: { processorVersion: 'media-v1' },
        finishedAt: new Date('2026-08-21T00:00:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'JOB_LEASE_CONFLICT' });
  });

  it('throws a stable conflict instead of crashing when fail affects no rows', async () => {
    const db = {
      query: vi.fn().mockResolvedValue({ rowCount: 0, rows: [] }),
    };
    const store = createMultimodalJobStore();

    await expect(
      store.failJob({
        db,
        jobId: '301',
        status: 'failed',
        error: { code: 'REMOTE_DOWNLOAD_FAILED', retryable: false },
        now: new Date('2026-08-21T00:00:00.000Z'),
        availableAt: null,
        finishedAt: new Date('2026-08-21T00:00:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'JOB_LEASE_CONFLICT' });
  });
});
