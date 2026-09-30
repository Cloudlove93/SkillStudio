import { describe, expect, it, vi } from 'vitest';
import {
  createMultimodalJobService,
  MultimodalJobServiceError,
} from './multimodal-job-service.js';
import {
  buildMediaQualityCheckResultHash,
  parseMediaQualityCheckOutputManifest,
} from './media-quality-check-contract.js';
import {
  buildDistillationResultHash,
  parseFrameMaterializeOutputManifest,
  parseMediaPrepareOutputManifest,
  parseTranscribeOutputManifest,
} from './media-distillation-contract.js';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import * as fs from 'node:fs';
import { createServer } from 'node:http';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REAL_MEDIA_INTEGRATION_TIMEOUT_MS = 30_000;

function resolveMediaWorkerPython(): string {
  const configured = process.env.MEDIA_WORKER_PYTHON?.trim();
  if (configured) {
    return configured;
  }
  const venvPython = path.resolve(
    __dirname,
    process.platform === 'win32'
      ? '../../../python/media_worker/.venv/Scripts/python.exe'
      : '../../../python/media_worker/.venv/bin/python',
  );
  if (fs.existsSync(venvPython)) {
    return venvPython;
  }
  return process.platform === 'win32' ? 'python' : 'python3';
}

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: '301',
    sessionId: '91',
    jobType: 'transcribe',
    status: 'queued',
    idempotencyKey: 'job-key-1',
    requestHash: 'a'.repeat(64),
    attemptNo: 0,
    maxAttempts: 3,
    progress: {},
    inputManifest: { source: 'audio' },
    outputManifest: null,
    resultHash: null,
    error: null,
    leaseOwner: null,
    leaseTokenHash: null,
    leaseExpiresAt: null,
    heartbeatAt: null,
    cancelRequestedAt: null,
    availableAt: '2026-08-21T00:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:00.000Z',
    sessionStatus: 'collecting',
    sessionDeletedAt: null,
    ...overrides,
  };
}

function makeDeps() {
  const db = { query: vi.fn() };
  const withTransaction = vi.fn(async (work: (client: typeof db) => unknown) =>
    work(db),
  );
  return {
    db,
    withTransaction,
    now: vi.fn(() => new Date('2026-08-21T00:00:00.000Z')),
    generateLeaseToken: vi.fn(() => 'opaque-lease-token'),
    hashLeaseToken: vi.fn(() => 'b'.repeat(64)),
    store: {
      loadSessionForCreate: vi.fn(),
      tryInsertJob: vi.fn(),
      findJobByIdempotencyKey: vi.fn(),
      claimNextJob: vi.fn(),
      loadJobForLeaseMutation: vi.fn(),
      updateHeartbeat: vi.fn(),
      completeJob: vi.fn(),
      failJob: vi.fn(),
      recycleExpiredLeases: vi.fn().mockResolvedValue([]),
      cancelJob: vi.fn(),
    },
  };
}

function makeObjectStorageGrants() {
  return {
    createSignedGetGrant: vi.fn(async ({ objectKey }: { objectKey: string }) => ({
      method: 'GET',
      objectKey,
      url: 'https://signed.example/read',
      expiresAt: '2026-08-22T10:01:00.000Z',
      requiredHeaders: {},
    })),
    createSignedPutGrant: vi.fn(
      async ({ objectKey, contentType }: { objectKey: string; contentType: string }) => ({
        method: 'PUT',
        objectKey,
        url: 'https://signed.example/write',
        expiresAt: '2026-08-22T10:01:00.000Z',
        requiredHeaders: { 'content-type': contentType, 'if-none-match': '*' },
      }),
    ),
  };
}

function makePendingUpload(
  overrides: Record<string, unknown> = {},
  verificationOverrides: Record<string, unknown> = {},
) {
  const baseVerification = {
    jobId: '301',
    idempotencyKey: 'confirm-key-1',
    requestHash: 'f'.repeat(64),
    observedSizeBytes: 1024,
    observedContentType: 'audio/mpeg',
    confirmedAt: '2026-08-21T00:00:00.000Z',
  };
  return {
    sourceId: 'source-upload-1',
    mediaKind: 'audio',
    fileName: 'lesson.mp3',
    declaredMimeType: 'audio/mpeg',
    sizeBytes: 1024,
    uploadMode: 'single_put',
    materialStatus: 'verifying',
    verification: {
      ...baseVerification,
      ...verificationOverrides,
    },
    objectKey:
      'skill-sessions/91/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp3',
    idempotencyKey: 'intent-key-1',
    requestHash: 'a'.repeat(64),
    intentClaimsHash: 'b'.repeat(64),
    intentRevisionNo: 1,
    expiresAt: '2026-08-21T01:00:00.000Z',
    ...overrides,
  };
}

function makeMediaState(overrides: Record<string, unknown> = {}) {
  const pendingUpload = makePendingUpload();
  return {
    schemaVersion: 1,
    primarySource: null,
    pendingUpload,
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
    operationReceipts: [
      {
        action: 'skill.media.upload.confirm',
        idempotencyKey: String(pendingUpload.verification?.idempotencyKey),
        requestHash: String(pendingUpload.verification?.requestHash),
        baseRevisionNo: 1,
        resultRevisionNo: 2,
        confirmedStage: 'uploading',
        recordedAt: String(pendingUpload.verification?.confirmedAt),
      },
    ],
    ...overrides,
  };
}

function makeSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '91',
    status: 'collecting',
    creation_mode: 'multimodal_distill',
    media_stage: 'uploading',
    media_state_json: makeMediaState(),
    revision_no: 2,
    updated_at: '2026-08-21T00:00:00.000Z',
    ...overrides,
  };
}

function makeQualityCheckOutputManifest(
  overrides: Record<string, unknown> = {},
  sourceAssetOverrides: Record<string, unknown> = {},
  probeOverrides: Record<string, unknown> = {},
  manifestRefOverrides: Record<string, unknown> = {},
) {
  return {
    schemaVersion: 1,
    jobType: 'media_quality_check',
    sessionId: '91',
    sourceId: 'source-upload-1',
    sourceKind: 'audio',
    sourceAsset: {
      objectKey:
        'skill-sessions/91/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp3',
      mimeType: 'audio/mpeg',
      sizeBytes: 1024,
      sha256: 'c'.repeat(64),
      ...sourceAssetOverrides,
    },
    probe: {
      durationMs: 42_000,
      formatName: 'mp3',
      hasAudio: true,
      hasVideo: false,
      audioStreamCount: 1,
      videoStreamCount: 0,
      primaryAudioStreamIndex: 0,
      primaryVideoStreamIndex: null,
      ...probeOverrides,
    },
    resultManifestRef: {
      objectKey:
        'skill-sessions/91/manifest/media-quality-check/job-301-attempt-1.json',
      mimeType: 'application/json',
      sizeBytes: 256,
      sha256: 'd'.repeat(64),
      ...manifestRefOverrides,
    },
    processorVersion: '1.0.0',
    degradations: [],
    ...overrides,
  };
}

function makeQualityCheckInputManifest(
  overrides: Record<string, unknown> = {},
) {
  return {
    schemaVersion: 1,
    sourceId: 'source-upload-1',
    mediaKind: 'audio',
    objectKey:
      'skill-sessions/91/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp3',
    fileName: 'lesson.mp3',
    expectedSizeBytes: 1024,
    expectedContentType: 'audio/mpeg',
    uploadMode: 'single_put',
    ...overrides,
  };
}

async function runRealPythonQualityCheckFixture(options: {
  fixtureName: string;
  sessionId: string;
  jobId: string;
  sourceId: string;
  mediaKind: 'audio' | 'video';
  objectKey: string;
  fileName: string;
  expectedContentType: string;
  manifestObjectKey: string;
}) {
  const fixturePath = path.resolve(
    __dirname,
    '../../../python/media_worker/tests/fixtures',
    options.fixtureName,
  );
  const fixtureBytes = fs.readFileSync(fixturePath);
  let uploadedManifestBytes = Buffer.alloc(0);
  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/source') {
      response.writeHead(200, {
        'Content-Type': options.expectedContentType,
        'Content-Length': fixtureBytes.byteLength.toString(),
      });
      response.end(fixtureBytes);
      return;
    }
    if (request.method === 'PUT' && request.url === '/manifest') {
      const chunks: Buffer[] = [];
      request.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      request.on('end', () => {
        uploadedManifestBytes = Buffer.concat(chunks);
        response.writeHead(200, { ETag: '"manifest-etag"' });
        response.end();
      });
      return;
    }
    response.writeHead(404);
    response.end();
  });

  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address == null || typeof address === 'string') {
      throw new Error('Expected TCP test server address');
    }

    const claim = {
      jobType: 'media_quality_check',
      jobId: options.jobId,
      sessionId: options.sessionId,
      attemptNo: 1,
      leaseToken: 'opaque-lease-token',
      inputManifest: {
        schemaVersion: 1,
        sourceId: options.sourceId,
        mediaKind: options.mediaKind,
        objectKey: options.objectKey,
        fileName: options.fileName,
        expectedSizeBytes: fixtureBytes.byteLength,
        expectedContentType: options.expectedContentType,
        uploadMode: 'single_put',
      },
      runtimeGrants: {
        sourceRead: {
          method: 'GET',
          objectKey: options.objectKey,
          url: `http://127.0.0.1:${address.port}/source`,
          expiresAt: '2026-08-23T00:05:00.000Z',
          headers: {},
        },
        resultManifestWrite: {
          method: 'PUT',
          objectKey: options.manifestObjectKey,
          url: `http://127.0.0.1:${address.port}/manifest`,
          expiresAt: '2026-08-23T00:05:00.000Z',
          headers: {
            'content-type': 'application/json',
          },
        },
      },
    };

    const pythonPath = resolveMediaWorkerPython();
    const python = spawn(
      pythonPath,
      [
        '-c',
        [
          'import json, sys',
          'sys.path.insert(0, sys.argv[2])',
          'from media_worker.quality_check_executor import QualityCheckExecutor',
          'job = json.loads(sys.argv[1])',
          'result = QualityCheckExecutor().run(job)',
          'json.dump({"resultHash": result.result_hash, "outputManifest": result.output_manifest}, sys.stdout, separators=(",",":"))',
        ].join('\n'),
        JSON.stringify(claim),
        path.resolve(__dirname, '../../../python/media_worker/src'),
      ],
      {
        cwd: path.resolve(__dirname, '../../..'),
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    python.stdout.on('data', (chunk) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    python.stderr.on('data', (chunk) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    const [exitCode] = (await once(python, 'close')) as [number | null];
    const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
    const stderr = Buffer.concat(stderrChunks).toString('utf-8');

    if (exitCode !== 0) {
      throw new Error(
        `Python quality check failed: ${stderr || stdout}`,
      );
    }

    return {
      resultHash: JSON.parse(stdout).resultHash as string,
      outputManifest: JSON.parse(stdout).outputManifest as Record<
        string,
        unknown
      >,
      uploadedFullManifest:
        uploadedManifestBytes.length === 0
          ? null
          : JSON.parse(uploadedManifestBytes.toString('utf-8')),
      observedSizeBytes: fixtureBytes.byteLength,
    };
  } finally {
    server.close();
    await once(server, 'close');
  }
}

describe('multimodal job service', () => {
  it('creates a media job inside an existing transaction without opening a nested transaction', async () => {
    const deps = makeDeps();
    deps.store.loadSessionForCreate.mockResolvedValue({
      id: '91',
      status: 'collecting',
      deletedAt: null,
      creationMode: 'multimodal_distill',
    });
    deps.store.tryInsertJob.mockResolvedValue(makeJob());
    const service = createMultimodalJobService(deps);

    const result = await service.createMediaJobInTransaction({
      db: deps.db,
      sessionId: '91',
      jobType: 'transcribe',
      idempotencyKey: 'job-key-1',
      requestHash: 'a'.repeat(64),
      inputManifest: { source: 'audio' },
    });

    expect(deps.withTransaction).not.toHaveBeenCalled();
    expect(deps.store.loadSessionForCreate).toHaveBeenCalledWith({
      db: deps.db,
      sessionId: '91',
    });
    expect(deps.store.tryInsertJob).toHaveBeenCalledWith(
      expect.objectContaining({
        db: deps.db,
        sessionId: '91',
        jobType: 'transcribe',
        idempotencyKey: 'job-key-1',
        requestHash: 'a'.repeat(64),
        maxAttempts: 3,
        inputManifest: { source: 'audio' },
      }),
    );
    expect(result.id).toBe('301');
  });

  it('returns an existing job for a tx-local idempotent create race with the same hash', async () => {
    const deps = makeDeps();
    deps.store.loadSessionForCreate.mockResolvedValue({
      id: '91',
      status: 'collecting',
      deletedAt: null,
      creationMode: 'multimodal_distill',
    });
    deps.store.tryInsertJob.mockResolvedValue(null);
    deps.store.findJobByIdempotencyKey.mockResolvedValue(makeJob());
    const service = createMultimodalJobService(deps);

    const result = await service.createMediaJobInTransaction({
      db: deps.db,
      sessionId: '91',
      jobType: 'transcribe',
      idempotencyKey: 'job-key-1',
      requestHash: 'a'.repeat(64),
      inputManifest: { source: 'audio' },
    });

    expect(deps.withTransaction).not.toHaveBeenCalled();
    expect(deps.store.findJobByIdempotencyKey).toHaveBeenCalledWith({
      db: deps.db,
      sessionId: '91',
      jobType: 'transcribe',
      idempotencyKey: 'job-key-1',
    });
    expect(result.id).toBe('301');
  });

  it('rejects tx-local idempotency-key reuse when the hash changes', async () => {
    const deps = makeDeps();
    deps.store.loadSessionForCreate.mockResolvedValue({
      id: '91',
      status: 'collecting',
      deletedAt: null,
      creationMode: 'multimodal_distill',
    });
    deps.store.tryInsertJob.mockResolvedValue(null);
    deps.store.findJobByIdempotencyKey.mockResolvedValue(
      makeJob({ requestHash: 'c'.repeat(64) }),
    );
    const service = createMultimodalJobService(deps);

    await expect(
      service.createMediaJobInTransaction({
        db: deps.db,
        sessionId: '91',
        jobType: 'transcribe',
        idempotencyKey: 'job-key-1',
        requestHash: 'a'.repeat(64),
        inputManifest: { source: 'audio' },
      }),
    ).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
      status: 409,
    } satisfies Partial<MultimodalJobServiceError>);
  });

  it('rejects invalid sessions before tx-local job creation', async () => {
    const deps = makeDeps();
    deps.store.loadSessionForCreate.mockResolvedValue({
      id: '91',
      status: 'completed',
      deletedAt: null,
      creationMode: 'multimodal_distill',
    });
    const service = createMultimodalJobService(deps);

    await expect(
      service.createMediaJobInTransaction({
        db: deps.db,
        sessionId: '91',
        jobType: 'transcribe',
        idempotencyKey: 'job-key-1',
        requestHash: 'a'.repeat(64),
        inputManifest: { source: 'audio' },
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_SESSION_STATE',
      status: 409,
    } satisfies Partial<MultimodalJobServiceError>);
    expect(deps.withTransaction).not.toHaveBeenCalled();
  });

  it('returns the existing job when an idempotent create repeats with the same hash after a null insert race', async () => {
    const deps = makeDeps();
    deps.store.loadSessionForCreate.mockResolvedValue({
      id: '91',
      status: 'collecting',
      deletedAt: null,
      creationMode: 'multimodal_distill',
    });
    deps.store.tryInsertJob.mockResolvedValue(null);
    deps.store.findJobByIdempotencyKey.mockResolvedValue(makeJob());
    const service = createMultimodalJobService(deps);

    const result = await service.createMediaJob({
      sessionId: '91',
      jobType: 'transcribe',
      idempotencyKey: 'job-key-1',
      requestHash: 'a'.repeat(64),
      inputManifest: { source: 'audio' },
    });

    expect(deps.withTransaction).toHaveBeenCalledTimes(1);
    expect(result.id).toBe('301');
  });

  it('rejects idempotency-key reuse when the hash changes after a null insert race', async () => {
    const deps = makeDeps();
    deps.store.loadSessionForCreate.mockResolvedValue({
      id: '91',
      status: 'collecting',
      deletedAt: null,
      creationMode: 'multimodal_distill',
    });
    deps.store.tryInsertJob.mockResolvedValue(null);
    deps.store.findJobByIdempotencyKey.mockResolvedValue(
      makeJob({ requestHash: 'c'.repeat(64) }),
    );
    const service = createMultimodalJobService(deps);

    await expect(
      service.createMediaJob({
        sessionId: '91',
        jobType: 'transcribe',
        idempotencyKey: 'job-key-1',
        requestHash: 'a'.repeat(64),
        inputManifest: { source: 'audio' },
      }),
    ).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
      status: 409,
    } satisfies Partial<MultimodalJobServiceError>);
  });

  it('raises a stable conflict when an insert returns null and no existing job is visible yet', async () => {
    const deps = makeDeps();
    deps.store.loadSessionForCreate.mockResolvedValue({
      id: '91',
      status: 'collecting',
      deletedAt: null,
      creationMode: 'multimodal_distill',
    });
    deps.store.tryInsertJob.mockResolvedValue(null);
    deps.store.findJobByIdempotencyKey.mockResolvedValue(null);
    const service = createMultimodalJobService(deps);

    await expect(
      service.createMediaJob({
        sessionId: '91',
        jobType: 'transcribe',
        idempotencyKey: 'job-key-1',
        requestHash: 'a'.repeat(64),
        inputManifest: { source: 'audio' },
      }),
    ).rejects.toMatchObject({
      code: 'JOB_IDEMPOTENCY_RACE',
      status: 409,
    } satisfies Partial<MultimodalJobServiceError>);
  });

  it('rejects invalid sessions before creating a job', async () => {
    const deps = makeDeps();
    deps.store.loadSessionForCreate.mockResolvedValue({
      id: '91',
      status: 'completed',
      deletedAt: null,
      creationMode: 'multimodal_distill',
    });
    const service = createMultimodalJobService(deps);

    await expect(
      service.createMediaJob({
        sessionId: '91',
        jobType: 'transcribe',
        idempotencyKey: 'job-key-1',
        requestHash: 'a'.repeat(64),
        inputManifest: { source: 'audio' },
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_SESSION_STATE',
      status: 409,
    } satisfies Partial<MultimodalJobServiceError>);
  });

  it('rejects create requests whose maxAttempts is outside 1..10 or not an integer', async () => {
    const service = createMultimodalJobService(makeDeps());

    for (const maxAttempts of [0, 11, 1.5]) {
      await expect(
        service.createMediaJob({
          sessionId: '91',
          jobType: 'transcribe',
          idempotencyKey: `job-key-${maxAttempts}`,
          requestHash: 'a'.repeat(64),
          inputManifest: { source: 'audio' },
          maxAttempts,
        }),
      ).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
        status: 422,
      } satisfies Partial<MultimodalJobServiceError>);
    }
  });

  it('returns a raw lease token to the worker while storing only the hash', async () => {
    const deps = makeDeps();
    deps.store.claimNextJob.mockResolvedValue(
      makeJob({
        status: 'leased',
        attemptNo: 1,
        leaseOwner: 'worker-a',
        leaseTokenHash: 'b'.repeat(64),
        leaseExpiresAt: '2026-08-21T00:01:00.000Z',
        inputManifest: {
          audioAssetRef: { objectKey: 'skill-sessions/91/audio.wav' },
          durationMs: 42_000,
          chunkPlan: [{ chunkIndex: 0, startMs: 0, endMs: 42_000 }],
        },
      }),
    );
    const service = createMultimodalJobService({
      ...deps,
      objectStorageService: makeObjectStorageGrants(),
    });

    const result = await service.claimMediaJob({
      workerIdentity: 'worker-a',
      acceptedJobTypes: ['transcribe'],
    });

    expect(deps.store.claimNextJob).toHaveBeenCalledWith(
      expect.objectContaining({
        leaseTokenHash: 'b'.repeat(64),
        leaseOwner: 'worker-a',
      }),
    );
    expect(result?.leaseToken).toBe('opaque-lease-token');
  });

  it('returns null from claim when no job is available and does not expose a token', async () => {
    const deps = makeDeps();
    deps.store.claimNextJob.mockResolvedValue(null);
    const service = createMultimodalJobService(deps);

    const result = await service.claimMediaJob({
      workerIdentity: 'worker-a',
      acceptedJobTypes: ['transcribe'],
    });

    expect(result).toBeNull();
  });

  it('uses a crypto-backed default lease token generator instead of Math.random', async () => {
    const randomSpy = vi.spyOn(Math, 'random');
    const deps = makeDeps();
    deps.store.claimNextJob.mockResolvedValue(
      makeJob({
        status: 'leased',
        attemptNo: 1,
        leaseOwner: 'worker-a',
        leaseTokenHash: 'b'.repeat(64),
        leaseExpiresAt: '2026-08-21T00:01:00.000Z',
        inputManifest: {
          audioAssetRef: { objectKey: 'skill-sessions/91/audio.wav' },
          durationMs: 42_000,
          chunkPlan: [{ chunkIndex: 0, startMs: 0, endMs: 42_000 }],
        },
      }),
    );
    const service = createMultimodalJobService({
      withTransaction: deps.withTransaction,
      store: deps.store,
      now: deps.now,
      hashLeaseToken: deps.hashLeaseToken,
      objectStorageService: makeObjectStorageGrants(),
    });

    const result = await service.claimMediaJob({
      workerIdentity: 'worker-a',
      acceptedJobTypes: ['transcribe'],
    });

    expect(result?.leaseToken).toBeTruthy();
    expect(randomSpy).not.toHaveBeenCalled();
    randomSpy.mockRestore();
  });

  it('rejects a claimed transcribe job whose persisted chunk plan is missing', async () => {
    const deps = makeDeps();
    deps.store.claimNextJob.mockResolvedValue(
      makeJob({
        status: 'leased',
        attemptNo: 1,
        leaseOwner: 'worker-a',
        leaseTokenHash: 'b'.repeat(64),
        leaseExpiresAt: '2026-08-21T00:01:00.000Z',
        inputManifest: {
          audioAssetRef: { objectKey: 'skill-sessions/91/audio.wav' },
          durationMs: 42_000,
        },
      }),
    );
    const service = createMultimodalJobService({
      ...deps,
      objectStorageService: makeObjectStorageGrants(),
    });

    await expect(
      service.claimMediaJob({
        workerIdentity: 'worker-a',
        acceptedJobTypes: ['transcribe'],
      }),
    ).rejects.toMatchObject({
      code: 'DATA_INTEGRITY_ERROR',
      status: 500,
    } satisfies Partial<MultimodalJobServiceError>);
  });

  it('adds runtime grants only for media_quality_check claims after the claim transaction completes', async () => {
    const deps = makeDeps();
    const events: string[] = [];
    deps.withTransaction = vi.fn(async (work: (client: typeof deps.db) => unknown) => {
      events.push('tx:start');
      const result = await work(deps.db);
      events.push('tx:commit');
      return result;
    });
    deps.store.claimNextJob.mockResolvedValue(
      makeJob({
        id: '777',
        sessionId: '91',
        jobType: 'media_quality_check',
        attemptNo: 2,
        inputManifest: {
          schemaVersion: 1,
          sourceId: 'source-upload-1',
          mediaKind: 'video',
          objectKey:
            'skill-sessions/91/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
          fileName: 'lesson.mp4',
          expectedSizeBytes: 1024,
          expectedContentType: 'video/mp4',
          uploadMode: 'single_put',
        },
      }),
    );
    const objectStorageService = {
      createSignedGetGrant: vi.fn(async ({ objectKey }: { objectKey: string }) => {
        events.push('grant:get');
        return {
          method: 'GET',
          objectKey,
          url: 'https://signed.example/source',
          expiresAt: '2026-08-22T10:01:00.000Z',
          requiredHeaders: {},
        };
      }),
      createSignedPutGrant: vi.fn(async ({ objectKey }: { objectKey: string }) => {
        events.push('grant:put');
        return {
          method: 'PUT',
          objectKey,
          url: 'https://signed.example/manifest',
          expiresAt: '2026-08-22T10:01:00.000Z',
          requiredHeaders: {
            'content-type': 'application/json',
            'if-none-match': '*',
          },
        };
      }),
    };
    const service = createMultimodalJobService({
      ...deps,
      objectStorageService,
    });

    const result = await service.claimMediaJob({
      workerIdentity: 'worker-a',
      acceptedJobTypes: ['media_quality_check'],
    });

    expect(result).toMatchObject({
      jobId: '777',
      sessionId: '91',
      jobType: 'media_quality_check',
      inputManifest: {
        schemaVersion: 1,
        sourceId: 'source-upload-1',
      },
      runtimeGrants: {
        sourceRead: {
          method: 'GET',
          objectKey:
            'skill-sessions/91/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
          headers: {},
        },
        resultManifestWrite: {
          method: 'PUT',
          objectKey:
            'skill-sessions/91/manifest/media-quality-check/job-777-attempt-2.json',
          headers: {
            'content-type': 'application/json',
            'if-none-match': '*',
          },
        },
      },
    });
    expect(events).toEqual(['tx:start', 'tx:commit', 'grant:get', 'grant:put']);
  });

  it('surfaces a retryable runtime grant error for media_quality_check claims', async () => {
    const deps = makeDeps();
    deps.store.claimNextJob.mockResolvedValue(
      makeJob({
        id: '777',
        sessionId: '91',
        jobType: 'media_quality_check',
        attemptNo: 1,
        inputManifest: {
          schemaVersion: 1,
          sourceId: 'source-upload-1',
          mediaKind: 'audio',
          objectKey:
            'skill-sessions/91/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.wav',
          fileName: 'lesson.wav',
          expectedSizeBytes: 1024,
          expectedContentType: 'audio/wav',
          uploadMode: 'single_put',
        },
      }),
    );
    const objectStorageService = {
      createSignedGetGrant: vi.fn(async () => {
        throw new Error('https://signed.example/secret');
      }),
      createSignedPutGrant: vi.fn(),
    };
    const service = createMultimodalJobService({
      ...deps,
      objectStorageService,
    });

    await expect(
      service.claimMediaJob({
        workerIdentity: 'worker-a',
        acceptedJobTypes: ['media_quality_check'],
      }),
    ).rejects.toMatchObject({
      code: 'MEDIA_RUNTIME_GRANT_UNAVAILABLE',
      status: 503,
      retryable: true,
    } satisfies Partial<MultimodalJobServiceError>);
    expect(objectStorageService.createSignedPutGrant).not.toHaveBeenCalled();
  });

  it('issues attempt-scoped source, audio, and result grants for media_prepare', async () => {
    const deps = makeDeps();
    deps.store.claimNextJob.mockResolvedValue(
      makeJob({
        id: '801',
        sessionId: '91',
        jobType: 'media_prepare',
        attemptNo: 2,
        inputManifest: {
          schemaVersion: 1,
          sessionId: '91',
          sourceId: 'source-video-1',
          sourceKind: 'video',
          sourceAsset: {
            objectKey: 'skill-sessions/91/source/video.mp4',
            mimeType: 'video/mp4',
            sizeBytes: 1024,
            sha256: 'a'.repeat(64),
          },
          pipelinePlan: {
            transcribe: true,
            frameMaterialize: true,
            visualOnly: false,
          },
        },
      }),
    );
    const objectStorageService = {
      createSignedGetGrant: vi.fn(async ({ objectKey }: { objectKey: string }) => ({
        method: 'GET',
        objectKey,
        url: 'https://signed.example/read',
        expiresAt: '2026-08-22T10:01:00.000Z',
        requiredHeaders: {},
      })),
      createSignedPutGrant: vi.fn(
        async ({ objectKey, contentType }: { objectKey: string; contentType: string }) => ({
          method: 'PUT',
          objectKey,
          url: 'https://signed.example/write',
          expiresAt: '2026-08-22T10:01:00.000Z',
          requiredHeaders: { 'content-type': contentType, 'if-none-match': '*' },
        }),
      ),
    };
    const service = createMultimodalJobService({ ...deps, objectStorageService });

    const result = await service.claimMediaJob({
      workerIdentity: 'worker-a',
      acceptedJobTypes: ['media_prepare'],
    });

    expect(result).toMatchObject({
      jobId: '801',
      runtimeGrants: {
        sourceRead: {
          objectKey: 'skill-sessions/91/source/video.mp4',
        },
        artifactWrites: {
          normalizedAudio: {
            objectKey:
              'skill-sessions/91/jobs/801/attempt-2/normalized-audio.wav',
          },
        },
        resultManifestWrite: {
          objectKey: 'skill-sessions/91/jobs/801/attempt-2/result.json',
        },
      },
    });
  });

  it('issues current chunk writes and prior-attempt recovery reads for transcription', async () => {
    const deps = makeDeps();
    deps.store.claimNextJob.mockResolvedValue(
      makeJob({
        id: '802',
        sessionId: '91',
        jobType: 'transcribe',
        attemptNo: 2,
        inputManifest: {
          schemaVersion: 1,
          sessionId: '91',
          sourceId: 'source-video-1',
          sourceKind: 'video',
          durationMs: 1_800_000,
          audioAssetRef: {
            objectKey:
              'skill-sessions/91/jobs/801/attempt-1/normalized-audio.wav',
            mimeType: 'audio/wav',
            sizeBytes: 64_000,
            sha256: 'a'.repeat(64),
          },
          mediaPrepareJobId: '801',
          chunkPlan: [
            { chunkIndex: 0, startMs: 0, endMs: 1_200_000 },
            { chunkIndex: 1, startMs: 1_200_000, endMs: 1_800_000 },
          ],
        },
      }),
    );
    const objectStorageService = makeObjectStorageGrants();
    const service = createMultimodalJobService({
      ...deps,
      objectStorageService,
    });

    const result = await service.claimMediaJob({
      workerIdentity: 'worker-a',
      acceptedJobTypes: ['transcribe'],
    });

    expect(result).toMatchObject({
      jobId: '802',
      runtimeGrants: {
        artifactWrites: {
          transcript: {
            objectKey: 'skill-sessions/91/jobs/802/attempt-2/transcript.json',
          },
          transcriptChunks: [
            {
              chunkIndex: 0,
              objectKey:
                'skill-sessions/91/jobs/802/attempt-2/transcript-chunks/chunk-0000.json',
            },
            {
              chunkIndex: 1,
              objectKey:
                'skill-sessions/91/jobs/802/attempt-2/transcript-chunks/chunk-0001.json',
            },
          ],
        },
        recoveryReads: {
          transcriptChunks: [
            {
              attemptNo: 1,
              chunkIndex: 0,
              objectKey:
                'skill-sessions/91/jobs/802/attempt-1/transcript-chunks/chunk-0000.json',
            },
            {
              attemptNo: 1,
              chunkIndex: 1,
              objectKey:
                'skill-sessions/91/jobs/802/attempt-1/transcript-chunks/chunk-0001.json',
            },
          ],
        },
      },
    });
  });

  it('advances a completed media_quality_check upload session to ready_to_process before completing the job', async () => {
    const deps = makeDeps();
    const events: string[] = [];
    deps.store.loadJobForLeaseMutation.mockImplementation(async () => {
      events.push('loadJob');
      return makeJob({
        id: '301',
        sessionId: '91',
        jobType: 'media_quality_check',
        status: 'leased',
        attemptNo: 1,
        inputManifest: makeQualityCheckInputManifest(),
        leaseTokenHash: 'b'.repeat(64),
        leaseExpiresAt: '2026-08-21T00:01:00.000Z',
      });
    });
    const outputManifest = makeQualityCheckOutputManifest();
    deps.db.query.mockImplementation(async (sql: string) => {
      if (sql.includes('from skill_guided_creation_sessions')) {
        events.push('selectSession');
        return {
          rowCount: 1,
          rows: [makeSessionRow()],
        };
      }
      if (sql.includes('update skill_guided_creation_sessions')) {
        events.push('updateSession');
        return {
          rowCount: 1,
          rows: [
            makeSessionRow({
              media_stage: 'ready_to_process',
              media_state_json: makeMediaState({
                primarySource: {
                  sourceId: 'source-upload-1',
                  kind: 'audio',
                  assetRef: {
                    objectKey:
                      'skill-sessions/91/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp3',
                    mimeType: 'audio/mpeg',
                    sizeBytes: 1024,
                    sha256: 'c'.repeat(64),
                  },
                },
                pendingUpload: null,
              }),
              revision_no: 3,
            }),
          ],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    deps.store.completeJob.mockImplementation(async (input) => {
      events.push('completeJob');
      return {
        jobId: String(input.jobId),
        status: 'succeeded',
        resultHash: buildMediaQualityCheckResultHash(outputManifest),
        outputManifest,
        finishedAt: '2026-08-21T00:00:00.000Z',
        replayed: false,
      };
    });
    const service = createMultimodalJobService(deps);

    const result = await service.completeMediaJob({
      jobId: '301',
      leaseToken: 'opaque-lease-token',
      resultHash: buildMediaQualityCheckResultHash(outputManifest),
      outputManifest,
    });

    expect(result.status).toBe('succeeded');
    expect(events).toEqual([
      'loadJob',
      'selectSession',
      'updateSession',
      'completeJob',
    ]);
    expect(deps.db.query.mock.calls[0]?.[0]).toContain('for update');
    expect(deps.db.query.mock.calls[1]?.[0]).toContain(
      'update skill_guided_creation_sessions',
    );
    expect(deps.db.query.mock.calls[1]?.[0]).toContain('revision_no = $8');
    expect(deps.db.query.mock.calls[1]?.[0]).toContain('media_stage = $9');
    const persistedState = JSON.parse(String(deps.db.query.mock.calls[1]?.[1]?.[2]));
    expect(persistedState.pendingUpload).toBeNull();
    expect(persistedState.primarySource).toEqual({
      sourceId: 'source-upload-1',
      kind: 'audio',
      assetRef: {
        objectKey:
          'skill-sessions/91/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp3',
        mimeType: 'audio/mpeg',
        sizeBytes: 1024,
        sha256: 'c'.repeat(64),
      },
    });
    expect(deps.store.completeJob).toHaveBeenCalledWith(
      expect.objectContaining({
        db: deps.db,
        jobId: '301',
        resultHash: buildMediaQualityCheckResultHash(outputManifest),
      }),
    );
  });

  it('rejects media_quality_check completion when the session CAS update loses the race', async () => {
    const deps = makeDeps();
    deps.store.loadJobForLeaseMutation.mockResolvedValue(
      makeJob({
        id: '301',
        sessionId: '91',
        jobType: 'media_quality_check',
        status: 'leased',
        attemptNo: 1,
        inputManifest: makeQualityCheckInputManifest(),
        leaseTokenHash: 'b'.repeat(64),
        leaseExpiresAt: '2026-08-21T00:01:00.000Z',
      }),
    );
    const outputManifest = makeQualityCheckOutputManifest();
    deps.db.query
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [makeSessionRow()],
      })
      .mockResolvedValueOnce({
        rowCount: 0,
        rows: [],
      });
    const service = createMultimodalJobService(deps);

    await expect(
      service.completeMediaJob({
        jobId: '301',
        leaseToken: 'opaque-lease-token',
        resultHash: buildMediaQualityCheckResultHash(outputManifest),
        outputManifest,
      }),
    ).rejects.toMatchObject({
      code: 'SESSION_REVISION_CONFLICT',
      status: 409,
      retryable: true,
    } satisfies Partial<MultimodalJobServiceError>);
    expect(deps.store.completeJob).not.toHaveBeenCalled();
  });

  it('replays identical complete requests and rejects conflicting result hashes', async () => {
    const deps = makeDeps();
    deps.store.loadJobForLeaseMutation.mockResolvedValue(
      makeJob({
        status: 'succeeded',
        resultHash: 'd'.repeat(64),
        outputManifest: { ok: true },
      }),
    );
    const service = createMultimodalJobService(deps);

    const replay = await service.completeMediaJob({
      jobId: '301',
      leaseToken: 'opaque-lease-token',
      resultHash: 'd'.repeat(64),
      outputManifest: { ok: true },
    });

    expect(replay.replayed).toBe(true);

    await expect(
      service.completeMediaJob({
        jobId: '301',
        leaseToken: 'opaque-lease-token',
        resultHash: 'e'.repeat(64),
        outputManifest: { ok: true },
      }),
    ).rejects.toMatchObject({
      code: 'JOB_RESULT_CONFLICT',
      status: 409,
    } satisfies Partial<MultimodalJobServiceError>);
  });

  it('writes a successful completion and clears stale error state', async () => {
    const deps = makeDeps();
    const outputManifest = {
      schemaVersion: 1 as const,
      jobType: 'transcribe' as const,
      sessionId: '91',
      sourceId: 'source-audio-1',
      durationMs: 42_000,
      transcript: {
        status: 'ready' as const,
        editable: true as const,
        segments: [
          { startMs: 0, endMs: 42_000, text: '课程内容', confidence: 0.95 },
        ],
      },
      transcriptAssetRef: {
        objectKey: 'skill-sessions/91/jobs/301/attempt-1/transcript.json',
        mimeType: 'application/json',
        sizeBytes: 512,
        sha256: 'c'.repeat(64),
      },
      resultManifestRef: {
        objectKey: 'skill-sessions/91/jobs/301/attempt-1/result.json',
        mimeType: 'application/json',
        sizeBytes: 512,
        sha256: 'd'.repeat(64),
      },
      processorVersion: '1.0.0',
      degradations: [],
    };
    const resultHash = buildDistillationResultHash(
      parseTranscribeOutputManifest(outputManifest),
    );
    deps.store.loadJobForLeaseMutation.mockResolvedValue(
      makeJob({
        status: 'leased',
        attemptNo: 1,
        leaseTokenHash: 'b'.repeat(64),
        leaseExpiresAt: '2026-08-21T00:01:00.000Z',
        error: { code: 'OLD_ERROR' },
        inputManifest: {
          sourceId: 'source-audio-1',
          durationMs: 42_000,
          audioAssetRef: { objectKey: 'skill-sessions/91/audio.wav' },
        },
      }),
    );
    const transcribingState = makeMediaState({
      primarySource: {
        sourceId: 'source-audio-1',
        kind: 'audio',
        assetRef: {
          objectKey: 'skill-sessions/91/source/audio.mp3',
          mimeType: 'audio/mpeg',
          sizeBytes: 1024,
          sha256: 'a'.repeat(64),
        },
      },
      pendingUpload: null,
      operationReceipts: [],
    });
    deps.db.query
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          makeSessionRow({
            media_stage: 'transcribing',
            media_state_json: transcribingState,
          }),
        ],
      })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          makeSessionRow({
            media_stage: 'building_semantic_windows',
            media_state_json: {
              ...transcribingState,
              transcript: outputManifest.transcript,
            },
            revision_no: 3,
          }),
        ],
      });
    deps.store.completeJob.mockResolvedValue({
      jobId: '301',
      status: 'succeeded',
      resultHash,
      outputManifest,
      finishedAt: '2026-08-21T00:00:00.000Z',
      replayed: false,
    });
    const service = createMultimodalJobService(deps);

    const result = await service.completeMediaJob({
      jobId: '301',
      leaseToken: 'opaque-lease-token',
      resultHash,
      outputManifest,
    });

    expect(result.status).toBe('succeeded');
    expect(deps.store.completeJob).toHaveBeenCalledWith(
      expect.objectContaining({
        outputManifest,
      }),
    );
  });

  it('rejects frame completion when the queued source asset no longer matches the session source', async () => {
    const deps = makeDeps();
    const outputManifest = {
      schemaVersion: 1 as const,
      jobType: 'frame_materialize' as const,
      sessionId: '91',
      sourceId: 'source-video-1',
      candidates: [
        {
          candidateId: 'frame-001',
          semanticMomentId: 'moment-001',
          timestampMs: 1000,
          sourceSignal: 'slow_visual_change' as const,
          selectionReason: 'board writing accumulated',
          assetRef: {
            objectKey:
              'skill-sessions/91/jobs/301/attempt-1/frames/frame-001.png',
            mimeType: 'image/png',
            sizeBytes: 2048,
            sha256: 'c'.repeat(64),
          },
          metrics: {
            analysisWidth: 320,
            analysisHeight: 180,
            brightnessMeanNormalized: 0.5,
            blackPixelRatio: 0.01,
            whitePixelRatio: 0.2,
            entropyNormalized: 0.7,
            sharpness: {
              algorithm: 'laplacian_variance_4_neighbour_normalized',
              normalized: true as const,
              value: 0.8,
            },
            duplicateHash: {
              algorithm: 'dhash_64' as const,
              value: '0123456789abcdef',
            },
          },
          hardRejectedReasons: [],
          suppressed: false,
          duplicateOf: null,
          frameExtractorVersion: '1.0.0',
          qualityProcessorVersion: '1.0.0',
        },
      ],
      resultManifestRef: {
        objectKey: 'skill-sessions/91/jobs/301/attempt-1/result.json',
        mimeType: 'application/json',
        sizeBytes: 512,
        sha256: 'd'.repeat(64),
      },
      processorVersion: '1.0.0',
      degradations: [],
    };
    const resultHash = buildDistillationResultHash(
      parseFrameMaterializeOutputManifest(outputManifest),
    );
    deps.store.loadJobForLeaseMutation.mockResolvedValue(
      makeJob({
        jobType: 'frame_materialize',
        status: 'leased',
        attemptNo: 1,
        leaseTokenHash: 'b'.repeat(64),
        leaseExpiresAt: '2026-08-21T00:01:00.000Z',
        inputManifest: {
          sourceId: 'source-video-1',
          sourceAsset: {
            objectKey: 'skill-sessions/91/source/wrong-video.mp4',
            mimeType: 'video/mp4',
            sizeBytes: 999,
            sha256: 'e'.repeat(64),
          },
          frameRequests: [
            {
              candidateId: 'frame-001',
              semanticMomentId: 'moment-001',
              timestampMs: 1000,
              sourceSignal: 'slow_visual_change',
              selectionReason: 'board writing accumulated',
            },
          ],
        },
      }),
    );
    deps.db.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        makeSessionRow({
          media_stage: 'building_evidence',
          media_state_json: makeMediaState({
            primarySource: {
              sourceId: 'source-video-1',
              kind: 'video',
              assetRef: {
                objectKey: 'skill-sessions/91/source/trusted-video.mp4',
                mimeType: 'video/mp4',
                sizeBytes: 8192,
                sha256: 'a'.repeat(64),
              },
            },
            pendingUpload: null,
            transcript: {
              status: 'ready',
              editable: true,
              segments: [],
            },
            operationReceipts: [],
          }),
        }),
      ],
    });
    const service = createMultimodalJobService(deps);

    await expect(
      service.completeMediaJob({
        jobId: '301',
        leaseToken: 'opaque-lease-token',
        resultHash,
        outputManifest,
      }),
    ).rejects.toMatchObject({
      code: 'DATA_INTEGRITY_ERROR',
      status: 500,
    });
    expect(deps.store.completeJob).not.toHaveBeenCalled();
  });

  it('atomically queues transcription and advances the session after media preparation', async () => {
    const deps = makeDeps();
    const trustedSource = {
      objectKey: 'skill-sessions/91/source/trusted-video.mp4',
      mimeType: 'video/mp4',
      sizeBytes: 8192,
      sha256: 'a'.repeat(64),
    };
    const outputManifest = {
      schemaVersion: 1 as const,
      jobType: 'media_prepare' as const,
      sessionId: '91',
      sourceId: 'source-video-1',
      sourceKind: 'video' as const,
      durationMs: 42_000,
      hasAudio: true,
      hasVideo: true,
      normalizedAudioAssetRef: {
        objectKey:
          'skill-sessions/91/jobs/801/attempt-2/normalized-audio.wav',
        mimeType: 'audio/wav',
        sizeBytes: 64_000,
        sha256: 'b'.repeat(64),
      },
      visualSignals: {
        sceneChangeTimestampsMs: [10_000],
        slowVisualChangeTimestampsMs: [30_000],
        sampledFrameCount: 21,
        detectorVersion: '1.0.0',
      },
      resultManifestRef: {
        objectKey: 'skill-sessions/91/jobs/801/attempt-2/result.json',
        mimeType: 'application/json',
        sizeBytes: 512,
        sha256: 'c'.repeat(64),
      },
      processorVersion: '1.0.0',
      degradations: [],
    };
    const resultHash = buildDistillationResultHash(
      parseMediaPrepareOutputManifest(outputManifest),
    );
    deps.store.loadJobForLeaseMutation.mockResolvedValue(
      makeJob({
        id: '801',
        jobType: 'media_prepare',
        status: 'leased',
        attemptNo: 2,
        leaseTokenHash: 'b'.repeat(64),
        leaseExpiresAt: '2026-08-21T00:01:00.000Z',
        inputManifest: {
          schemaVersion: 1,
          sessionId: '91',
          sourceId: 'source-video-1',
          sourceKind: 'video',
          sourceAsset: trustedSource,
          sourceProbe: {
            durationMs: 42_000,
            hasAudio: true,
            hasVideo: true,
          },
          pipelinePlan: {
            transcribe: true,
            frameMaterialize: true,
            visualOnly: false,
          },
        },
      }),
    );
    const preparingState = makeMediaState({
      primarySource: {
        sourceId: 'source-video-1',
        kind: 'video',
        assetRef: trustedSource,
      },
      pendingUpload: null,
      operationReceipts: [],
    });
    deps.db.query
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          makeSessionRow({
            media_stage: 'preparing_media',
            media_state_json: preparingState,
          }),
        ],
      })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          makeSessionRow({
            media_stage: 'transcribing',
            media_state_json: preparingState,
            revision_no: 3,
          }),
        ],
      });
    deps.store.loadSessionForCreate.mockResolvedValue({
      id: '91',
      status: 'collecting',
      deletedAt: null,
      creationMode: 'multimodal_distill',
    });
    deps.store.tryInsertJob.mockResolvedValue(
      makeJob({ id: '802', jobType: 'transcribe' }),
    );
    deps.store.completeJob.mockResolvedValue({
      jobId: '801',
      status: 'succeeded',
      resultHash,
      outputManifest,
      finishedAt: '2026-08-21T00:00:00.000Z',
      replayed: false,
    });
    const service = createMultimodalJobService(deps);

    const result = await service.completeMediaJob({
      jobId: '801',
      leaseToken: 'opaque-lease-token',
      resultHash,
      outputManifest,
    });

    expect(result.status).toBe('succeeded');
    expect(deps.store.tryInsertJob).toHaveBeenCalledWith(
      expect.objectContaining({
        db: deps.db,
        sessionId: '91',
        jobType: 'transcribe',
        inputManifest: expect.objectContaining({
          sourceId: 'source-video-1',
          durationMs: 42_000,
          audioAssetRef: outputManifest.normalizedAudioAssetRef,
          mediaPrepareJobId: '801',
          chunkPlan: [{ chunkIndex: 0, startMs: 0, endMs: 42_000 }],
        }),
      }),
    );
    expect(deps.db.query.mock.calls[1]?.[1]?.[3]).toBe('transcribing');
    expect(deps.store.completeJob).toHaveBeenCalledAfter(
      deps.store.tryInsertJob,
    );
  });

  it('rejects invalid token, expired lease, cancel requested, and cancelled or deleted sessions with JOB_LEASE_CONFLICT', async () => {
    const scenarios = [
      makeJob({
        status: 'leased',
        leaseTokenHash: 'c'.repeat(64),
        leaseExpiresAt: '2026-08-21T00:01:00.000Z',
      }),
      makeJob({
        status: 'leased',
        leaseTokenHash: 'b'.repeat(64),
        leaseExpiresAt: '2026-08-20T23:59:59.000Z',
      }),
      makeJob({
        status: 'leased',
        leaseTokenHash: 'b'.repeat(64),
        leaseExpiresAt: '2026-08-21T00:01:00.000Z',
        cancelRequestedAt: '2026-08-21T00:00:30.000Z',
      }),
      makeJob({
        status: 'leased',
        leaseTokenHash: 'b'.repeat(64),
        leaseExpiresAt: '2026-08-21T00:01:00.000Z',
        sessionStatus: 'cancelled',
      }),
      makeJob({
        status: 'leased',
        leaseTokenHash: 'b'.repeat(64),
        leaseExpiresAt: '2026-08-21T00:01:00.000Z',
        sessionStatus: 'completed',
      }),
      makeJob({
        status: 'leased',
        leaseTokenHash: 'b'.repeat(64),
        leaseExpiresAt: '2026-08-21T00:01:00.000Z',
        sessionStatus: 'failed',
      }),
      makeJob({
        status: 'leased',
        leaseTokenHash: 'b'.repeat(64),
        leaseExpiresAt: '2026-08-21T00:01:00.000Z',
        sessionDeletedAt: '2026-08-21T00:00:10.000Z',
      }),
    ];

    for (const scenario of scenarios) {
      const deps = makeDeps();
      deps.store.loadJobForLeaseMutation.mockResolvedValue(scenario);
      const service = createMultimodalJobService(deps);

      await expect(
        service.heartbeatMediaJob({
          jobId: '301',
          leaseToken: 'opaque-lease-token',
          progress: { phase: 'transcribe', percent: 10 },
        }),
      ).rejects.toMatchObject({
        code: 'JOB_LEASE_CONFLICT',
        status: 409,
      } satisfies Partial<MultimodalJobServiceError>);

      await expect(
        service.completeMediaJob({
          jobId: '301',
          leaseToken: 'opaque-lease-token',
          resultHash: 'd'.repeat(64),
          outputManifest: { processorVersion: 'media-v1' },
        }),
      ).rejects.toMatchObject({
        code: 'JOB_LEASE_CONFLICT',
        status: 409,
      } satisfies Partial<MultimodalJobServiceError>);

      await expect(
        service.failMediaJob({
          jobId: '301',
          leaseToken: 'opaque-lease-token',
          error: {
            code: 'REMOTE_DOWNLOAD_FAILED',
            message: 'download failed',
            retryable: true,
          },
        }),
      ).rejects.toMatchObject({
        code: 'JOB_LEASE_CONFLICT',
        status: 409,
      } satisfies Partial<MultimodalJobServiceError>);
    }
  });

  it('rejects heartbeat progress that contains signed URLs or unknown fields', async () => {
    const deps = makeDeps();
    const service = createMultimodalJobService(deps);

    await expect(
      service.heartbeatMediaJob({
        jobId: '301',
        leaseToken: 'opaque-lease-token',
        progress: {
          phase: 'downloading_source',
          percent: 10,
          sourceUrl: 'https://signed.example/source?token=secret',
        },
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      status: 422,
    } satisfies Partial<MultimodalJobServiceError>);

    expect(deps.store.loadJobForLeaseMutation).not.toHaveBeenCalled();
    expect(deps.store.updateHeartbeat).not.toHaveBeenCalled();
  });

  it('accepts bounded transcription chunk progress and persists it with the heartbeat', async () => {
    const deps = makeDeps();
    deps.store.loadJobForLeaseMutation.mockResolvedValue(
      makeJob({
        status: 'leased',
        leaseTokenHash: 'b'.repeat(64),
        leaseExpiresAt: '2026-08-21T00:01:00.000Z',
      }),
    );
    deps.store.updateHeartbeat.mockResolvedValue({
      jobId: '301',
      status: 'leased',
      leaseExpiresAt: '2026-08-21T00:01:00.000Z',
      progress: {},
    });
    const service = createMultimodalJobService(deps);

    await service.heartbeatMediaJob({
      jobId: '301',
      leaseToken: 'opaque-lease-token',
      progress: {
        phase: 'transcribing_audio',
        percent: 20,
        chunkIndex: 0,
        chunkCount: 7,
      },
    });

    expect(deps.store.updateHeartbeat).toHaveBeenCalledWith(
      expect.objectContaining({
        progress: {
          phase: 'transcribing_audio',
          percent: 20,
          chunkIndex: 0,
          chunkCount: 7,
        },
      }),
    );
  });

  it('rejects failure details that contain temporary paths or token-bearing URLs', async () => {
    const deps = makeDeps();
    const service = createMultimodalJobService(deps);

    await expect(
      service.failMediaJob({
        jobId: '301',
        leaseToken: 'opaque-lease-token',
        error: {
          code: 'REMOTE_DOWNLOAD_FAILED',
          message: 'download failed',
          retryable: true,
          details: {
            reason:
              'https://signed.example/source?token=worker-secret-token',
          },
        },
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      status: 422,
    } satisfies Partial<MultimodalJobServiceError>);

    expect(deps.store.loadJobForLeaseMutation).not.toHaveBeenCalled();
    expect(deps.store.failJob).not.toHaveBeenCalled();
  });

  it('routes retryable and terminal fail outcomes based on attemptNo and maxAttempts', async () => {
    const retryDeps = makeDeps();
    retryDeps.store.loadJobForLeaseMutation.mockResolvedValue(
      makeJob({
        status: 'leased',
        leaseTokenHash: 'b'.repeat(64),
        leaseExpiresAt: '2026-08-21T00:01:00.000Z',
        attemptNo: 1,
        maxAttempts: 3,
      }),
    );
    retryDeps.store.failJob.mockResolvedValue({
      jobId: '301',
      status: 'queued',
      availableAt: '2026-08-21T00:00:15.000Z',
      finishedAt: null,
      retryScheduled: true,
    });
    const retryService = createMultimodalJobService(retryDeps);
    const retryResult = await retryService.failMediaJob({
      jobId: '301',
      leaseToken: 'opaque-lease-token',
      error: {
        code: 'REMOTE_DOWNLOAD_FAILED',
        message: 'download failed',
        retryable: true,
      },
    });
    expect(retryResult.status).toBe('queued');
    expect(retryDeps.store.failJob).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'queued', finishedAt: null }),
    );

    const terminalDeps = makeDeps();
    terminalDeps.store.loadJobForLeaseMutation.mockResolvedValue(
      makeJob({
        status: 'leased',
        leaseTokenHash: 'b'.repeat(64),
        leaseExpiresAt: '2026-08-21T00:01:00.000Z',
        attemptNo: 3,
        maxAttempts: 3,
      }),
    );
    terminalDeps.store.failJob.mockResolvedValue({
      jobId: '301',
      status: 'failed',
      availableAt: '2026-08-21T00:00:00.000Z',
      finishedAt: '2026-08-21T00:00:00.000Z',
      retryScheduled: false,
    });
    terminalDeps.db.query.mockResolvedValue({
      rowCount: 1,
      rows: [{ id: '91' }],
    });
    const terminalService = createMultimodalJobService(terminalDeps);
    const terminalResult = await terminalService.failMediaJob({
      jobId: '301',
      leaseToken: 'opaque-lease-token',
      error: {
        code: 'REMOTE_DOWNLOAD_FAILED',
        message: 'download failed',
        retryable: true,
      },
    });
    expect(terminalResult.status).toBe('failed');
    expect(terminalDeps.store.failJob).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        error: expect.objectContaining({
          details: { resumeFromStage: 'transcribing' },
        }),
      }),
    );
    expect(String(terminalDeps.db.query.mock.calls[0]?.[0]).toLowerCase()).toContain(
      "media_stage = 'failed'",
    );
  });

  it('wraps cancel and recycle in transactions', async () => {
    const deps = makeDeps();
    deps.store.cancelJob
      .mockResolvedValueOnce({ jobId: '301', status: 'cancelled' })
      .mockResolvedValueOnce({
        jobId: '301',
        status: 'leased',
        cancelRequestedAt: '2026-08-21T00:00:00.000Z',
        finishedAt: null,
      });
    deps.store.recycleExpiredLeases.mockResolvedValue([
      { jobId: '301', status: 'cancelled', retryScheduled: false },
    ]);
    const service = createMultimodalJobService(deps);

    const cancelled = await service.cancelMediaJob({ jobId: '301' });
    const signalled = await service.cancelMediaJob({ jobId: '301' });
    const recycled = await service.recycleExpiredLeases();

    expect(cancelled.status).toBe('cancelled');
    expect(signalled.status).toBe('leased');
    expect(signalled.cancelRequestedAt).toBe('2026-08-21T00:00:00.000Z');
    expect(recycled[0]?.status).toBe('cancelled');
    expect(recycled).toHaveLength(1);
    expect(deps.withTransaction).toHaveBeenCalledTimes(3);
  });

  it('requeues a crashed worker lease, then fails the session after attempts are exhausted', async () => {
    const deps = makeDeps();
    deps.store.recycleExpiredLeases
      .mockResolvedValueOnce([
        {
          jobId: '501',
          sessionId: '91',
          jobType: 'transcribe',
          status: 'queued',
          availableAt: '2026-08-21T00:00:15.000Z',
          finishedAt: null,
          retryScheduled: true,
        },
      ])
      .mockResolvedValueOnce([
        {
          jobId: '501',
          sessionId: '91',
          jobType: 'transcribe',
          status: 'failed',
          availableAt: '2026-08-21T00:00:15.000Z',
          finishedAt: '2026-08-21T00:00:00.000Z',
          retryScheduled: false,
        },
      ]);
    deps.db.query.mockResolvedValue({ rows: [{ id: '91' }], rowCount: 1 });
    const service = createMultimodalJobService(deps);

    const reclaimed = await service.recycleExpiredLeases();
    const exhausted = await service.recycleExpiredLeases();

    expect(reclaimed[0]).toMatchObject({
      status: 'queued',
      retryScheduled: true,
    });
    expect(exhausted[0]).toMatchObject({
      status: 'failed',
      retryScheduled: false,
    });
    expect(deps.db.query).toHaveBeenCalledTimes(1);
    expect(deps.db.query).toHaveBeenCalledWith(
      expect.stringContaining("media_stage = 'failed'"),
      ['91', 'transcribing', '2026-08-21T00:00:00.000Z'],
    );
  });

  it('advances a completed media_quality_check video session to ready_to_process', async () => {
    const deps = makeDeps();
    deps.store.loadJobForLeaseMutation.mockResolvedValue(
      makeJob({
        id: '302',
        sessionId: '92',
        jobType: 'media_quality_check',
        status: 'leased',
        attemptNo: 1,
        leaseTokenHash: 'b'.repeat(64),
        leaseExpiresAt: '2026-08-21T00:01:00.000Z',
        inputManifest: {
          schemaVersion: 1,
          sourceId: 'source-upload-2',
          mediaKind: 'video',
          objectKey:
            'skill-sessions/92/source/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.mp4',
          fileName: 'lesson.mp4',
          expectedSizeBytes: 2048,
          expectedContentType: 'video/mp4',
          uploadMode: 'single_put',
        },
      }),
    );
    const videoVerification = {
      jobId: '302',
      idempotencyKey: 'confirm-key-2',
      requestHash: 'e'.repeat(64),
      observedSizeBytes: 2048,
      observedContentType: 'video/mp4',
      confirmedAt: '2026-08-21T00:00:00.000Z',
    };
    const videoOperationReceipts = [
      {
        action: 'skill.media.upload.confirm',
        idempotencyKey: videoVerification.idempotencyKey,
        requestHash: videoVerification.requestHash,
        baseRevisionNo: 1,
        resultRevisionNo: 2,
        confirmedStage: 'uploading',
        recordedAt: videoVerification.confirmedAt,
      },
    ];
    deps.db.query
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          makeSessionRow({
            id: '92',
            media_state_json: makeMediaState({
              pendingUpload: makePendingUpload(
                {
                  sourceId: 'source-upload-2',
                  mediaKind: 'video',
                  fileName: 'lesson.mp4',
                  declaredMimeType: 'video/mp4',
                  sizeBytes: 2048,
                  objectKey:
                    'skill-sessions/92/source/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.mp4',
                },
                videoVerification,
              ),
              operationReceipts: videoOperationReceipts,
            }),
          }),
        ],
      })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          makeSessionRow({
            id: '92',
            media_stage: 'ready_to_process',
            media_state_json: makeMediaState({
              primarySource: {
                sourceId: 'source-upload-2',
                kind: 'video',
                assetRef: {
                  objectKey:
                    'skill-sessions/92/source/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.mp4',
                  mimeType: 'video/mp4',
                  sizeBytes: 2048,
                  sha256: 'e'.repeat(64),
                },
              },
              pendingUpload: null,
              operationReceipts: videoOperationReceipts,
            }),
            revision_no: 3,
          }),
        ],
      });
    const videoOutputManifest = makeQualityCheckOutputManifest(
      { sessionId: '92', sourceId: 'source-upload-2', sourceKind: 'video' },
      {
        objectKey:
          'skill-sessions/92/source/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 2048,
        sha256: 'e'.repeat(64),
      },
      {
        hasAudio: true,
        hasVideo: true,
        audioStreamCount: 1,
        videoStreamCount: 1,
        primaryAudioStreamIndex: 1,
        primaryVideoStreamIndex: 0,
      },
      {
        objectKey:
          'skill-sessions/92/manifest/media-quality-check/job-302-attempt-1.json',
      },
    );
    deps.store.completeJob.mockResolvedValue({
      jobId: '302',
      status: 'succeeded',
      resultHash: buildMediaQualityCheckResultHash(videoOutputManifest),
      outputManifest: videoOutputManifest,
      finishedAt: '2026-08-21T00:00:00.000Z',
      replayed: false,
    });
    const service = createMultimodalJobService(deps);

    const result = await service.completeMediaJob({
      jobId: '302',
      leaseToken: 'opaque-lease-token',
      resultHash: buildMediaQualityCheckResultHash(videoOutputManifest),
      outputManifest: videoOutputManifest,
    });

    expect(result.status).toBe('succeeded');
    const persistedState = JSON.parse(
      String(deps.db.query.mock.calls[1]?.[1]?.[2]),
    );
    expect(persistedState.pendingUpload).toBeNull();
    expect(persistedState.primarySource.kind).toBe('video');
    expect(persistedState.primarySource.assetRef.sha256).toBe('e'.repeat(64));
  });

  it('rejects media_quality_check completion when resultHash does not match the canonical output manifest hash', async () => {
    const deps = makeDeps();
    const outputManifest = makeQualityCheckOutputManifest();
    deps.store.loadJobForLeaseMutation.mockResolvedValue(
      makeJob({
        id: '301',
        jobType: 'media_quality_check',
        status: 'leased',
        attemptNo: 1,
        inputManifest: makeQualityCheckInputManifest(),
        leaseTokenHash: 'b'.repeat(64),
        leaseExpiresAt: '2026-08-21T00:01:00.000Z',
      }),
    );
    deps.db.query
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [makeSessionRow()],
      });
    const service = createMultimodalJobService(deps);

    await expect(
      service.completeMediaJob({
        jobId: '301',
        leaseToken: 'opaque-lease-token',
        resultHash: 'f'.repeat(64),
        outputManifest,
      }),
    ).rejects.toMatchObject({
      code: 'DATA_INTEGRITY_ERROR',
    });

    expect(
      buildMediaQualityCheckResultHash(outputManifest),
    ).not.toBe('f'.repeat(64));
    expect(deps.db.query).toHaveBeenCalledTimes(0);
    expect(deps.store.completeJob).not.toHaveBeenCalled();
  });

  it('accepts real python audio output and advances the session to ready_to_process', async () => {
    const fixture = await runRealPythonQualityCheckFixture({
      fixtureName: 'audio-short.wav',
      sessionId: '91',
      jobId: '301',
      sourceId: 'source-upload-1',
      mediaKind: 'audio',
      objectKey:
        'skill-sessions/91/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.wav',
      fileName: 'lesson.wav',
      expectedContentType: 'audio/wav',
      manifestObjectKey:
        'skill-sessions/91/manifest/media-quality-check/job-301-attempt-1.json',
    });
    const deps = makeDeps();
    const outputManifest = fixture.outputManifest;
    const parsedOutputManifest = parseMediaQualityCheckOutputManifest(outputManifest);
    deps.store.loadJobForLeaseMutation.mockResolvedValue(
      makeJob({
        id: '301',
        jobType: 'media_quality_check',
        status: 'leased',
        attemptNo: 1,
        inputManifest: makeQualityCheckInputManifest({
          objectKey:
            'skill-sessions/91/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.wav',
          fileName: 'lesson.wav',
          expectedSizeBytes: fixture.observedSizeBytes,
          expectedContentType: 'audio/wav',
        }),
        leaseTokenHash: 'b'.repeat(64),
        leaseExpiresAt: '2026-08-21T00:01:00.000Z',
      }),
    );
    deps.db.query
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          makeSessionRow({
            media_state_json: makeMediaState({
              pendingUpload: makePendingUpload(
                {
                  fileName: 'lesson.wav',
                  declaredMimeType: 'audio/wav',
                  sizeBytes: fixture.observedSizeBytes,
                  objectKey:
                    'skill-sessions/91/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.wav',
                },
                {
                  observedSizeBytes: fixture.observedSizeBytes,
                  observedContentType: 'audio/wav',
                },
              ),
            }),
          }),
        ],
      })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          (() => {
            const sourceAsset = (outputManifest as {
              sourceAsset: Record<string, unknown>;
            }).sourceAsset;
            return makeSessionRow({
              media_stage: 'ready_to_process',
              media_state_json: makeMediaState({
                primarySource: {
                  sourceId: 'source-upload-1',
                  kind: 'audio',
                  assetRef: sourceAsset,
                },
                pendingUpload: null,
              }),
              revision_no: 3,
            });
          })(),
        ],
      });
    deps.store.completeJob.mockResolvedValue({
      jobId: '301',
      status: 'succeeded',
      resultHash: fixture.resultHash,
      outputManifest,
      finishedAt: '2026-08-21T00:00:00.000Z',
      replayed: false,
    });
    const service = createMultimodalJobService(deps);

    const result = await service.completeMediaJob({
      jobId: '301',
      leaseToken: 'opaque-lease-token',
      resultHash: fixture.resultHash,
      outputManifest,
    });

    expect(result.status).toBe('succeeded');
    const persistedState = JSON.parse(String(deps.db.query.mock.calls[1]?.[1]?.[2]));
    expect(persistedState.mediaStage).toBeUndefined();
    expect(persistedState.pendingUpload).toBeNull();
    expect(persistedState.primarySource.kind).toBe('audio');
    expect(persistedState.primarySource.assetRef.mimeType).toBe('audio/wav');
    expect(persistedState.primarySource.assetRef.sizeBytes).toBe(
      fixture.observedSizeBytes,
    );
    expect(buildMediaQualityCheckResultHash(parsedOutputManifest)).toBe(
      fixture.resultHash,
    );
    expect(fixture.uploadedFullManifest?.processorVersion).toBe('0.1.0');
  }, REAL_MEDIA_INTEGRATION_TIMEOUT_MS);

  it('accepts real python video output and advances the session to ready_to_process', async () => {
    const fixture = await runRealPythonQualityCheckFixture({
      fixtureName: 'video-with-audio.mp4',
      sessionId: '92',
      jobId: '302',
      sourceId: 'source-upload-2',
      mediaKind: 'video',
      objectKey:
        'skill-sessions/92/source/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.mp4',
      fileName: 'lesson.mp4',
      expectedContentType: 'video/mp4',
      manifestObjectKey:
        'skill-sessions/92/manifest/media-quality-check/job-302-attempt-1.json',
    });
    const deps = makeDeps();
    const outputManifest = fixture.outputManifest;
    const parsedOutputManifest = parseMediaQualityCheckOutputManifest(outputManifest);
    deps.store.loadJobForLeaseMutation.mockResolvedValue(
      makeJob({
        id: '302',
        sessionId: '92',
        jobType: 'media_quality_check',
        status: 'leased',
        attemptNo: 1,
        inputManifest: makeQualityCheckInputManifest({
          sourceId: 'source-upload-2',
          mediaKind: 'video',
          objectKey:
            'skill-sessions/92/source/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.mp4',
          fileName: 'lesson.mp4',
          expectedSizeBytes: fixture.observedSizeBytes,
          expectedContentType: 'video/mp4',
        }),
        leaseTokenHash: 'b'.repeat(64),
        leaseExpiresAt: '2026-08-21T00:01:00.000Z',
      }),
    );
    deps.db.query
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          makeSessionRow({
            id: '92',
            revision_no: 2,
            media_state_json: makeMediaState({
              pendingUpload: makePendingUpload(
                {
                  sourceId: 'source-upload-2',
                  mediaKind: 'video',
                  fileName: 'lesson.mp4',
                  declaredMimeType: 'video/mp4',
                  sizeBytes: fixture.observedSizeBytes,
                  objectKey:
                    'skill-sessions/92/source/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.mp4',
                },
                {
                  jobId: '302',
                  observedSizeBytes: fixture.observedSizeBytes,
                  observedContentType: 'video/mp4',
                },
              ),
            }),
          }),
        ],
      })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          (() => {
            const sourceAsset = (outputManifest as {
              sourceAsset: Record<string, unknown>;
            }).sourceAsset;
            return makeSessionRow({
              id: '92',
              media_stage: 'ready_to_process',
              media_state_json: makeMediaState({
                primarySource: {
                  sourceId: 'source-upload-2',
                  kind: 'video',
                  assetRef: sourceAsset,
                },
                pendingUpload: null,
              }),
              revision_no: 3,
            });
          })(),
        ],
      });
    deps.store.completeJob.mockResolvedValue({
      jobId: '302',
      status: 'succeeded',
      resultHash: fixture.resultHash,
      outputManifest,
      finishedAt: '2026-08-21T00:00:00.000Z',
      replayed: false,
    });
    const service = createMultimodalJobService(deps);

    const result = await service.completeMediaJob({
      jobId: '302',
      leaseToken: 'opaque-lease-token',
      resultHash: fixture.resultHash,
      outputManifest,
    });

    expect(result.status).toBe('succeeded');
    const persistedState = JSON.parse(String(deps.db.query.mock.calls[1]?.[1]?.[2]));
    expect(persistedState.pendingUpload).toBeNull();
    expect(persistedState.primarySource.kind).toBe('video');
    expect(persistedState.primarySource.assetRef.mimeType).toBe('video/mp4');
    expect(persistedState.primarySource.assetRef.sizeBytes).toBe(
      fixture.observedSizeBytes,
    );
    expect(buildMediaQualityCheckResultHash(parsedOutputManifest)).toBe(
      fixture.resultHash,
    );
    expect(fixture.uploadedFullManifest?.processorVersion).toBe('0.1.0');
  }, REAL_MEDIA_INTEGRATION_TIMEOUT_MS);

  it('rejects tampered real python output without advancing the transaction state', async () => {
    const fixture = await runRealPythonQualityCheckFixture({
      fixtureName: 'audio-short.wav',
      sessionId: '91',
      jobId: '301',
      sourceId: 'source-upload-1',
      mediaKind: 'audio',
      objectKey:
        'skill-sessions/91/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.wav',
      fileName: 'lesson.wav',
      expectedContentType: 'audio/wav',
      manifestObjectKey:
        'skill-sessions/91/manifest/media-quality-check/job-301-attempt-1.json',
    });
    const deps = makeDeps();
    const tamperedManifest = {
      ...(fixture.outputManifest as Record<string, unknown>),
      sourceAsset: {
        ...((fixture.outputManifest as { sourceAsset: Record<string, unknown> }).sourceAsset),
        objectKey:
          'skill-sessions/91/source/ffffffff-ffff-4fff-8fff-ffffffffffff.wav',
      },
    };
    const tamperedHash = buildMediaQualityCheckResultHash(
      parseMediaQualityCheckOutputManifest(tamperedManifest),
    );
    deps.store.loadJobForLeaseMutation.mockResolvedValue(
      makeJob({
        id: '301',
        jobType: 'media_quality_check',
        status: 'leased',
        attemptNo: 1,
        inputManifest: makeQualityCheckInputManifest({
          objectKey:
            'skill-sessions/91/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.wav',
          fileName: 'lesson.wav',
          expectedSizeBytes: fixture.observedSizeBytes,
          expectedContentType: 'audio/wav',
        }),
        leaseTokenHash: 'b'.repeat(64),
        leaseExpiresAt: '2026-08-21T00:01:00.000Z',
      }),
    );
    deps.db.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        makeSessionRow({
          media_state_json: makeMediaState({
            pendingUpload: makePendingUpload(
              {
                fileName: 'lesson.wav',
                declaredMimeType: 'audio/wav',
                sizeBytes: fixture.observedSizeBytes,
                objectKey:
                  'skill-sessions/91/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.wav',
              },
              {
                observedSizeBytes: fixture.observedSizeBytes,
                observedContentType: 'audio/wav',
              },
            ),
          }),
        }),
      ],
    });
    const service = createMultimodalJobService(deps);

    await expect(
      service.completeMediaJob({
        jobId: '301',
        leaseToken: 'opaque-lease-token',
        resultHash: tamperedHash,
        outputManifest: tamperedManifest,
      }),
    ).rejects.toMatchObject({
      code: 'DATA_INTEGRITY_ERROR',
    });

    expect(deps.store.completeJob).not.toHaveBeenCalled();
    expect(deps.db.query).toHaveBeenCalledTimes(1);
  }, REAL_MEDIA_INTEGRATION_TIMEOUT_MS);

  it('rejects media_quality_check completion when output bindings drift from the original upload intent', async () => {
    const deps = makeDeps();
    const outputManifest = makeQualityCheckOutputManifest(
      {},
      {
        sizeBytes: 2048,
      },
    );
    deps.store.loadJobForLeaseMutation.mockResolvedValue(
      makeJob({
        id: '301',
        jobType: 'media_quality_check',
        status: 'leased',
        attemptNo: 1,
        inputManifest: makeQualityCheckInputManifest(),
        leaseTokenHash: 'b'.repeat(64),
        leaseExpiresAt: '2026-08-21T00:01:00.000Z',
      }),
    );
    deps.db.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [makeSessionRow()],
    });
    const service = createMultimodalJobService(deps);

    await expect(
      service.completeMediaJob({
        jobId: '301',
        leaseToken: 'opaque-lease-token',
        resultHash: buildMediaQualityCheckResultHash(outputManifest),
        outputManifest,
      }),
    ).rejects.toMatchObject({
      code: 'DATA_INTEGRITY_ERROR',
    });

    expect(deps.store.completeJob).not.toHaveBeenCalled();
  });

  it('fails terminal when media_quality_check reaches maxAttempts regardless of error retryable flag', async () => {
    const deps = makeDeps();
    deps.store.loadJobForLeaseMutation.mockResolvedValue(
      makeJob({
        id: '303',
        jobType: 'media_quality_check',
        status: 'leased',
        attemptNo: 3,
        maxAttempts: 3,
        leaseTokenHash: 'b'.repeat(64),
        leaseExpiresAt: '2026-08-21T00:01:00.000Z',
      }),
    );
    deps.store.failJob.mockResolvedValue({
      jobId: '303',
      status: 'failed',
      availableAt: '2026-08-21T00:00:00.000Z',
      finishedAt: '2026-08-21T00:00:00.000Z',
      retryScheduled: false,
    });
    deps.db.query.mockResolvedValue({ rows: [{ id: '91' }], rowCount: 1 });
    const service = createMultimodalJobService(deps);

    const result = await service.failMediaJob({
      jobId: '303',
      leaseToken: 'opaque-lease-token',
      error: {
        code: 'QUALITY_RESULT_MANIFEST_UPLOAD_FAILED',
        message: 'Result manifest upload failed',
        retryable: true,
      },
    });

    expect(result.status).toBe('failed');
    expect(deps.store.failJob).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        error: expect.objectContaining({
          details: { resumeFromStage: 'uploading' },
        }),
      }),
    );
    expect(deps.db.query).toHaveBeenCalledWith(
      expect.stringContaining("media_stage = 'failed'"),
      ['91', 'uploading', '2026-08-21T00:00:00.000Z'],
    );
  });

  it('two workers concurrently claim only one gets the quality_check job', async () => {
    const deps = makeDeps();
    deps.store.claimNextJob
      .mockResolvedValueOnce(
        makeJob({
          id: '401',
          sessionId: '91',
          jobType: 'media_quality_check',
          status: 'leased',
          attemptNo: 1,
          leaseOwner: 'worker-a',
          leaseTokenHash: 'b'.repeat(64),
          leaseExpiresAt: '2026-08-21T00:01:00.000Z',
          inputManifest: {
            schemaVersion: 1,
            sourceId: 'source-upload-1',
            mediaKind: 'audio',
            objectKey:
              'skill-sessions/91/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp3',
            fileName: 'lesson.mp3',
            expectedSizeBytes: 1024,
            expectedContentType: 'audio/mpeg',
            uploadMode: 'single_put',
          },
        }),
      )
      .mockResolvedValueOnce(null);
    const service = createMultimodalJobService({
      ...deps,
      objectStorageService: {
        createSignedGetGrant: vi.fn(async ({ objectKey }: { objectKey: string }) => ({
          method: 'GET',
          objectKey,
          url: 'https://signed.example/source',
          expiresAt: '2026-08-22T10:01:00.000Z',
          requiredHeaders: {},
        })),
        createSignedPutGrant: vi.fn(async ({ objectKey }: { objectKey: string }) => ({
          method: 'PUT',
          objectKey,
          url: 'https://signed.example/manifest',
          expiresAt: '2026-08-22T10:01:00.000Z',
          requiredHeaders: {},
        })),
      },
    });

    const [claimA, claimB] = await Promise.all([
      service.claimMediaJob({
        workerIdentity: 'worker-a',
        acceptedJobTypes: ['media_quality_check'],
      }),
      service.claimMediaJob({
        workerIdentity: 'worker-b',
        acceptedJobTypes: ['media_quality_check'],
      }),
    ]);

    expect(claimA).not.toBeNull();
    expect(claimA?.jobId).toBe('401');
    expect(claimB).toBeNull();
    expect(deps.store.claimNextJob).toHaveBeenCalledTimes(2);
  });

  it('refreshes attempt-scoped transcribe grants without mutating the leased job', async () => {
    const deps = makeDeps();
    deps.store.loadJobForLeaseMutation.mockResolvedValue(
      makeJob({
        id: '17',
        sessionId: '21',
        jobType: 'transcribe',
        status: 'leased',
        attemptNo: 2,
        leaseTokenHash: 'b'.repeat(64),
        leaseExpiresAt: '2026-08-21T00:01:00.000Z',
        inputManifest: {
          audioAssetRef: { objectKey: 'skill-sessions/21/audio.wav' },
          durationMs: 42_000,
          chunkPlan: [{ chunkIndex: 0, startMs: 0, endMs: 42_000 }],
        },
      }),
    );
    const service = createMultimodalJobService({
      ...deps,
      objectStorageService: makeObjectStorageGrants(),
    });

    await expect(
      service.refreshMediaJobRuntimeGrants({
        jobId: '17',
        leaseToken: 'opaque-lease-token',
      }),
    ).resolves.toMatchObject({
      artifactWrites: {
        transcript: {
          method: 'PUT',
          objectKey:
            'skill-sessions/21/jobs/17/attempt-2/transcript.json',
        },
        transcriptChunks: [
          {
            chunkIndex: 0,
            objectKey:
              'skill-sessions/21/jobs/17/attempt-2/transcript-chunks/chunk-0000.json',
          },
        ],
      },
      resultManifestWrite: {
        objectKey:
          'skill-sessions/21/jobs/17/attempt-2/result.json',
      },
    });
    expect(deps.hashLeaseToken).toHaveBeenCalledWith('opaque-lease-token');
    expect(deps.store.updateHeartbeat).not.toHaveBeenCalled();
    expect(deps.store.completeJob).not.toHaveBeenCalled();
    expect(deps.store.failJob).not.toHaveBeenCalled();
  });

  it('rejects runtime grant refresh for a wrong or expired lease', async () => {
    for (const leasedJob of [
      makeJob({
        id: '17',
        status: 'leased',
        leaseTokenHash: 'c'.repeat(64),
        leaseExpiresAt: '2026-08-21T00:01:00.000Z',
      }),
      makeJob({
        id: '17',
        status: 'leased',
        leaseTokenHash: 'b'.repeat(64),
        leaseExpiresAt: '2026-08-20T23:59:59.000Z',
      }),
    ]) {
      const deps = makeDeps();
      deps.store.loadJobForLeaseMutation.mockResolvedValue(leasedJob);
      const objectStorageService = makeObjectStorageGrants();
      const service = createMultimodalJobService({
        ...deps,
        objectStorageService,
      });

      await expect(
        service.refreshMediaJobRuntimeGrants({
          jobId: '17',
          leaseToken: 'opaque-lease-token',
        }),
      ).rejects.toMatchObject({
        code: 'JOB_LEASE_CONFLICT',
        status: 409,
      } satisfies Partial<MultimodalJobServiceError>);
      expect(objectStorageService.createSignedGetGrant).not.toHaveBeenCalled();
      expect(objectStorageService.createSignedPutGrant).not.toHaveBeenCalled();
    }
  });

  it('media job service source files do not contain DeleteObject calls', () => {
    const serviceFiles = [
      'multimodal-job-service.ts',
      'multimodal-guided-creation-service.ts',
      'multimodal-job-store.ts',
      'multimodal-pipeline-store.ts',
      'multimodal-pipeline-runtime.ts',
    ];

    const forbiddenPatterns = [
      /DeleteObject\b/,
      /deleteObject\b/,
      /delete_object\b/,
      /\.delete\(\s*['"`]/,
      /\.deleteObject\(\s*['"`]/,
    ];

    for (const fileName of serviceFiles) {
      const filePath = path.resolve(__dirname, fileName);
      const content = fs.readFileSync(filePath, 'utf-8');

      for (const pattern of forbiddenPatterns) {
        const match = pattern.exec(content);
        if (match) {
          throw new Error(
            `Forbidden pattern "${pattern.source}" found in ${fileName} at line containing: ${match[0]}`,
          );
        }
      }
    }
  });
});
