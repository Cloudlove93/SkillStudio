import { afterEach, describe, expect, it, vi } from 'vitest';

class MockMultimodalJobServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly retryable = false,
  ) {
    super(message);
  }
}

const claimMediaJobMock = vi.fn();
const refreshMediaJobRuntimeGrantsMock = vi.fn();
const heartbeatMediaJobMock = vi.fn();
const completeMediaJobMock = vi.fn();
const failMediaJobMock = vi.fn();

async function getHandlerModule() {
  vi.resetModules();
  vi.doMock('../services/multimodal-job-service.js', () => ({
    MultimodalJobServiceError: MockMultimodalJobServiceError,
    createMultimodalJobService: () => ({
      claimMediaJob: claimMediaJobMock,
      refreshMediaJobRuntimeGrants: refreshMediaJobRuntimeGrantsMock,
      heartbeatMediaJob: heartbeatMediaJobMock,
      completeMediaJob: completeMediaJobMock,
      failMediaJob: failMediaJobMock,
    }),
  }));

  return import('./media-job-actions.js');
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('../services/multimodal-job-service.js');
  claimMediaJobMock.mockReset();
  refreshMediaJobRuntimeGrantsMock.mockReset();
  heartbeatMediaJobMock.mockReset();
  completeMediaJobMock.mockReset();
  failMediaJobMock.mockReset();
});

describe('internal media job actions', () => {
  it('dispatches refreshGrants with only the active job lease binding', async () => {
    refreshMediaJobRuntimeGrantsMock.mockResolvedValueOnce({
      artifactWrites: { transcript: { method: 'PUT' } },
    });
    const { handleInternalMediaJobAction } = await getHandlerModule();

    await expect(
      handleInternalMediaJobAction({
        action: 'internal.mediaJob.refreshGrants',
        payload: { jobId: '17', leaseToken: 'lease-token' },
      }),
    ).resolves.toEqual({
      artifactWrites: { transcript: { method: 'PUT' } },
    });
    expect(refreshMediaJobRuntimeGrantsMock).toHaveBeenCalledWith({
      jobId: '17',
      leaseToken: 'lease-token',
    });
  });

  it('rejects unknown refreshGrants payload fields', async () => {
    const { handleInternalMediaJobAction } = await getHandlerModule();

    await expect(
      handleInternalMediaJobAction({
        action: 'internal.mediaJob.refreshGrants',
        payload: {
          jobId: '17',
          leaseToken: 'lease-token',
          objectKey: 'attacker-selected-key',
        },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT', status: 422 });
    expect(refreshMediaJobRuntimeGrantsMock).not.toHaveBeenCalled();
  });

  it('dispatches claim with the exact accepted job types payload', async () => {
    claimMediaJobMock.mockResolvedValueOnce({
      jobId: '9',
      sessionId: '5',
      jobType: 'media_quality_check',
      attemptNo: 1,
      maxAttempts: 3,
      inputManifest: { schemaVersion: 1, sessionId: '5', sourceId: 'source-1' },
      progress: {},
      leaseToken: 'lease-token',
      leaseExpiresAt: '2026-08-21T00:01:00.000Z',
      runtimeGrants: {
        sourceRead: {
          method: 'GET',
          objectKey: 'skill-sessions/5/source/file.mp4',
          url: 'https://signed.example/source',
          expiresAt: '2026-08-21T00:01:00.000Z',
          headers: {},
        },
        resultManifestWrite: {
          method: 'PUT',
          objectKey:
            'skill-sessions/5/manifest/media-quality-check/job-9-attempt-1.json',
          url: 'https://signed.example/manifest',
          expiresAt: '2026-08-21T00:01:00.000Z',
          headers: { 'content-type': 'application/json' },
        },
      },
    });
    const { handleInternalMediaJobAction } = await getHandlerModule();

    await expect(
      handleInternalMediaJobAction({
        action: 'internal.mediaJob.claim',
        payload: {
          workerIdentity: 'worker-a',
          acceptedJobTypes: ['transcribe', 'media_quality_check'],
        },
      }),
    ).resolves.toEqual({
      jobId: '9',
      sessionId: '5',
      jobType: 'media_quality_check',
      attemptNo: 1,
      maxAttempts: 3,
      inputManifest: { schemaVersion: 1, sessionId: '5', sourceId: 'source-1' },
      progress: {},
      leaseToken: 'lease-token',
      leaseExpiresAt: '2026-08-21T00:01:00.000Z',
      runtimeGrants: {
        sourceRead: {
          method: 'GET',
          objectKey: 'skill-sessions/5/source/file.mp4',
          url: 'https://signed.example/source',
          expiresAt: '2026-08-21T00:01:00.000Z',
          headers: {},
        },
        resultManifestWrite: {
          method: 'PUT',
          objectKey:
            'skill-sessions/5/manifest/media-quality-check/job-9-attempt-1.json',
          url: 'https://signed.example/manifest',
          expiresAt: '2026-08-21T00:01:00.000Z',
          headers: { 'content-type': 'application/json' },
        },
      },
    });
    expect(claimMediaJobMock).toHaveBeenCalledWith({
      workerIdentity: 'worker-a',
      acceptedJobTypes: ['transcribe', 'media_quality_check'],
    });
  });

  it('dispatches heartbeat with the exact progress payload', async () => {
    heartbeatMediaJobMock.mockResolvedValueOnce({ ok: true });
    const { handleInternalMediaJobAction } = await getHandlerModule();

    await expect(
      handleInternalMediaJobAction({
        action: 'internal.mediaJob.heartbeat',
        payload: {
          jobId: '9',
          leaseToken: 'lease-token',
          progress: { stage: 'running', percent: 50 },
        },
      }),
    ).resolves.toEqual({ ok: true });
    expect(heartbeatMediaJobMock).toHaveBeenCalledWith({
      jobId: '9',
      leaseToken: 'lease-token',
      progress: { stage: 'running', percent: 50 },
    });
  });

  it('dispatches complete with the exact result payload', async () => {
    completeMediaJobMock.mockResolvedValueOnce({ ok: true });
    const { handleInternalMediaJobAction } = await getHandlerModule();

    await expect(
      handleInternalMediaJobAction({
        action: 'internal.mediaJob.complete',
        payload: {
          jobId: '9',
          leaseToken: 'lease-token',
          resultHash: 'a'.repeat(64),
          outputManifest: { transcript: { objectKey: 'k' } },
        },
      }),
    ).resolves.toEqual({ ok: true });
    expect(completeMediaJobMock).toHaveBeenCalledWith({
      jobId: '9',
      leaseToken: 'lease-token',
      resultHash: 'a'.repeat(64),
      outputManifest: { transcript: { objectKey: 'k' } },
    });
  });

  it('dispatches fail with the exact error payload', async () => {
    failMediaJobMock.mockResolvedValueOnce({ ok: true });
    const { handleInternalMediaJobAction } = await getHandlerModule();

    await expect(
      handleInternalMediaJobAction({
        action: 'internal.mediaJob.fail',
        payload: {
          jobId: '9',
          leaseToken: 'lease-token',
          error: {
            code: 'WORKER_FAILED',
            message: 'transcribe failed',
            retryable: true,
            details: { attempt: 1 },
          },
        },
      }),
    ).resolves.toEqual({ ok: true });
    expect(failMediaJobMock).toHaveBeenCalledWith({
      jobId: '9',
      leaseToken: 'lease-token',
      error: {
        code: 'WORKER_FAILED',
        message: 'transcribe failed',
        retryable: true,
        details: { attempt: 1 },
      },
    });
  });

  it('rejects pkgId on the internal request body', async () => {
    const { handleInternalMediaJobAction } = await getHandlerModule();

    await expect(
      handleInternalMediaJobAction({
        action: 'internal.mediaJob.claim',
        pkgId: '1',
        payload: {
          workerIdentity: 'worker-a',
          acceptedJobTypes: ['transcribe'],
        },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT', status: 422 });
    expect(claimMediaJobMock).not.toHaveBeenCalled();
  });

  it('rejects userId on the internal request body', async () => {
    const { handleInternalMediaJobAction } = await getHandlerModule();

    await expect(
      handleInternalMediaJobAction({
        action: 'internal.mediaJob.claim',
        userId: 'forged-user',
        payload: {
          workerIdentity: 'worker-a',
          acceptedJobTypes: ['transcribe'],
        },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT', status: 422 });
    expect(claimMediaJobMock).not.toHaveBeenCalled();
  });

  it('rejects user_id on the internal request body', async () => {
    const { handleInternalMediaJobAction } = await getHandlerModule();

    await expect(
      handleInternalMediaJobAction({
        action: 'internal.mediaJob.claim',
        user_id: 'forged-user',
        payload: {
          workerIdentity: 'worker-a',
          acceptedJobTypes: ['transcribe'],
        },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT', status: 422 });
    expect(claimMediaJobMock).not.toHaveBeenCalled();
  });

  it('rejects userId on the internal payload', async () => {
    const { handleInternalMediaJobAction } = await getHandlerModule();

    await expect(
      handleInternalMediaJobAction({
        action: 'internal.mediaJob.claim',
        payload: {
          workerIdentity: 'worker-a',
          acceptedJobTypes: ['transcribe'],
          userId: 'forged-user',
        },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT', status: 422 });
    expect(claimMediaJobMock).not.toHaveBeenCalled();
  });

  it('rejects user_id on the internal payload', async () => {
    const { handleInternalMediaJobAction } = await getHandlerModule();

    await expect(
      handleInternalMediaJobAction({
        action: 'internal.mediaJob.claim',
        payload: {
          workerIdentity: 'worker-a',
          acceptedJobTypes: ['transcribe'],
          user_id: 'forged-user',
        },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT', status: 422 });
    expect(claimMediaJobMock).not.toHaveBeenCalled();
  });

  it('rejects empty or invalid accepted job types', async () => {
    const { handleInternalMediaJobAction } = await getHandlerModule();

    for (const payload of [
      { workerIdentity: 'worker-a', acceptedJobTypes: [] },
      { workerIdentity: 'worker-a', acceptedJobTypes: ['ingest_media'] },
    ]) {
      await expect(
        handleInternalMediaJobAction({
          action: 'internal.mediaJob.claim',
          payload,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT', status: 422 });
    }
    expect(claimMediaJobMock).not.toHaveBeenCalled();
  });

  it('rejects heartbeat progress that is not a plain object', async () => {
    const { handleInternalMediaJobAction } = await getHandlerModule();

    await expect(
      handleInternalMediaJobAction({
        action: 'internal.mediaJob.heartbeat',
        payload: {
          jobId: '9',
          leaseToken: 'lease-token',
          progress: ['not-an-object'],
        },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT', status: 422 });
    expect(heartbeatMediaJobMock).not.toHaveBeenCalled();
  });

  it('rejects a complete request with a malformed result hash', async () => {
    const { handleInternalMediaJobAction } = await getHandlerModule();

    await expect(
      handleInternalMediaJobAction({
        action: 'internal.mediaJob.complete',
        payload: {
          jobId: '9',
          leaseToken: 'lease-token',
          resultHash: 'abc123',
          outputManifest: {},
        },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT', status: 422 });
    expect(completeMediaJobMock).not.toHaveBeenCalled();
  });

  it('rejects fail payloads that let the worker smuggle status fields', async () => {
    const { handleInternalMediaJobAction } = await getHandlerModule();

    await expect(
      handleInternalMediaJobAction({
        action: 'internal.mediaJob.fail',
        payload: {
          jobId: '9',
          leaseToken: 'lease-token',
          error: {
            code: 'WORKER_FAILED',
            message: 'transcribe failed',
            retryable: true,
            status: 'failed',
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT', status: 422 });
    expect(failMediaJobMock).not.toHaveBeenCalled();
  });

  it('surfaces MultimodalJobServiceError instances with retryable preserved', async () => {
    failMediaJobMock.mockRejectedValueOnce(
      new MockMultimodalJobServiceError(
        'JOB_LEASE_CONFLICT',
        'Lease is no longer valid',
        409,
        false,
      ),
    );
    const { handleInternalMediaJobAction } = await getHandlerModule();

    await expect(
      handleInternalMediaJobAction({
        action: 'internal.mediaJob.fail',
        payload: {
          jobId: '9',
          leaseToken: 'lease-token',
          error: {
            code: 'WORKER_FAILED',
            message: 'transcribe failed',
            retryable: true,
          },
        },
      }),
    ).rejects.toMatchObject({
      code: 'JOB_LEASE_CONFLICT',
      status: 409,
      retryable: false,
    });
  });

  it('completes a media_quality_check job with the full output manifest through the route layer', async () => {
    const qualityOutput = {
      schemaVersion: 1,
      jobType: 'media_quality_check',
      sessionId: '5',
      sourceId: 'source-1',
      sourceKind: 'audio',
      sourceAsset: {
        objectKey: 'skill-sessions/5/source/file.wav',
        mimeType: 'audio/wav',
        sizeBytes: 1024,
        sha256: 'c'.repeat(64),
      },
      probe: {
        durationMs: 42000,
        formatName: 'wav',
        hasAudio: true,
        hasVideo: false,
        audioStreamCount: 1,
        videoStreamCount: 0,
        primaryAudioStreamIndex: 0,
        primaryVideoStreamIndex: null,
      },
      resultManifestRef: {
        objectKey: 'skill-sessions/5/manifest/media-quality-check/job-9-attempt-1.json',
        mimeType: 'application/json',
        sizeBytes: 256,
        sha256: 'd'.repeat(64),
      },
      processorVersion: 'media-quality-check-worker-v1',
      degradations: [],
    };
    completeMediaJobMock.mockResolvedValueOnce({
      status: 'succeeded',
      resultHash: 'a'.repeat(64),
      outputManifest: qualityOutput,
      replayed: false,
    });
    const { handleInternalMediaJobAction } = await getHandlerModule();

    await expect(
      handleInternalMediaJobAction({
        action: 'internal.mediaJob.complete',
        payload: {
          jobId: '9',
          leaseToken: 'lease-token',
          resultHash: 'a'.repeat(64),
          outputManifest: qualityOutput,
        },
      }),
    ).resolves.toEqual({
      status: 'succeeded',
      resultHash: 'a'.repeat(64),
      outputManifest: qualityOutput,
      replayed: false,
    });
    expect(completeMediaJobMock).toHaveBeenCalledWith({
      jobId: '9',
      leaseToken: 'lease-token',
      resultHash: 'a'.repeat(64),
      outputManifest: qualityOutput,
    });
  });
});
