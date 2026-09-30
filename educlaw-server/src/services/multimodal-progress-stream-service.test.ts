import { describe, expect, it, vi } from 'vitest';
import type { MultimodalSessionState } from '@educlaw/shared';
import { createMultimodalProgressStreamService } from './multimodal-progress-stream-service.js';

type ProgressEvent =
  | {
      event: 'progress';
      data: {
        progress: {
          sessionId: string;
          displayName: string | null;
          status: string;
          mediaStage: string;
          revisionNo: number;
          createdAt: string;
          updatedAt: string;
          currentJob: {
            jobId: string;
            jobType: string;
            status: string;
            percent: number | null;
            hint: string | null;
          } | null;
        };
      };
    }
  | {
      event: 'confirmation';
      data: {
        session: {
          sessionId: string;
          displayName: string | null;
          status: string;
          mediaStage: string;
          revisionNo: number;
          createdAt: string;
          updatedAt: string;
          mediaState: MultimodalSessionState;
        };
        confirmationStage: 'adler_overview' | 'evidence_and_candidates' | 'publish';
      };
    }
  | {
      event: 'done';
      data: {
        session: {
          sessionId: string;
          displayName: string | null;
          status: string;
          mediaStage: string;
          revisionNo: number;
          createdAt: string;
          updatedAt: string;
          mediaState: MultimodalSessionState;
        };
      };
    }
  | {
      event: 'stream_end';
      data: {
        reason?: string;
      };
    };

function createEmptyState(): MultimodalSessionState {
  return {
    schemaVersion: 1,
    primarySource: null,
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
  };
}

function createProgress(
  overrides: Partial<{
    status: string;
    mediaStage: string;
    revisionNo: number;
    updatedAt: string;
    currentJob: {
      jobId: string;
      jobType: string;
      status: string;
      percent: number | null;
      hint: string | null;
    } | null;
  }> = {},
) {
  return {
    sessionId: '101',
    displayName: '多模态技能包',
    status: overrides.status ?? 'collecting',
    mediaStage: overrides.mediaStage ?? 'extracting_candidates',
    revisionNo: overrides.revisionNo ?? 2,
    createdAt: '2026-08-22T08:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-08-22T08:01:00.000Z',
    currentJob:
      overrides.currentJob === undefined
        ? {
            jobId: 'job-1',
            jobType: 'transcribe',
            status: 'leased',
            percent: 10,
            hint: 'processing',
          }
        : overrides.currentJob,
  };
}

function createDetail(
  overrides: Partial<{
    status: string;
    mediaStage: string;
    revisionNo: number;
  }> = {},
) {
  return {
    sessionId: '101',
    displayName: '多模态技能包',
    status: overrides.status ?? 'ready_for_confirmation',
    mediaStage: overrides.mediaStage ?? 'awaiting_candidates',
    revisionNo: overrides.revisionNo ?? 3,
    createdAt: '2026-08-22T08:00:00.000Z',
    updatedAt: '2026-08-22T08:02:00.000Z',
    mediaState: createEmptyState(),
  };
}

describe('multimodal progress stream service', () => {
  it('emits immediately, skips unchanged fingerprints, and pushes changed job progress before terminal done', async () => {
    const getSessionProgress = vi
      .fn()
      .mockResolvedValueOnce(createProgress({ currentJob: { jobId: 'job-1', jobType: 'transcribe', status: 'leased', percent: 10, hint: 'processing' } }))
      .mockResolvedValueOnce(createProgress({ currentJob: { jobId: 'job-1', jobType: 'transcribe', status: 'leased', percent: 10, hint: 'processing' } }))
      .mockResolvedValueOnce(createProgress({ currentJob: { jobId: 'job-1', jobType: 'transcribe', status: 'leased', percent: 20, hint: 'processing' } }))
      .mockResolvedValueOnce(createProgress({ status: 'completed', mediaStage: 'published', revisionNo: 4, currentJob: null }));
    const getSessionDetail = vi
      .fn()
      .mockResolvedValue(createDetail({ status: 'completed', mediaStage: 'published', revisionNo: 4 }));
    const wait = vi.fn().mockResolvedValue(undefined);
    const events: ProgressEvent[] = [];

    const service = createMultimodalProgressStreamService({
      getSessionProgress,
      getSessionDetail,
      wait,
      pollIntervalMs: 25,
    });

    await service.streamProgress({
      authUserId: 'user-1',
      sessionId: '101',
      emit: async (event, data) => {
        events.push(data === undefined ? { event } : { event, data } as ProgressEvent);
      },
      isClosed: () => false,
    });

    expect(getSessionProgress).toHaveBeenCalledTimes(4);
    expect(getSessionDetail).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledTimes(3);
    expect(events).toEqual([
      { event: 'progress', data: { progress: createProgress({ currentJob: { jobId: 'job-1', jobType: 'transcribe', status: 'leased', percent: 10, hint: 'processing' } }) } },
      { event: 'progress', data: { progress: createProgress({ currentJob: { jobId: 'job-1', jobType: 'transcribe', status: 'leased', percent: 20, hint: 'processing' } }) } },
      { event: 'done', data: { session: createDetail({ status: 'completed', mediaStage: 'published', revisionNo: 4 }) } },
      { event: 'stream_end', data: {} },
    ]);
  });

  it('emits confirmation and ends on awaiting confirmation stages', async () => {
    const getSessionProgress = vi
      .fn()
      .mockResolvedValue(
        createProgress({
          status: 'ready_for_confirmation',
          mediaStage: 'awaiting_candidates',
          revisionNo: 6,
          currentJob: null,
        }),
      );
    const getSessionDetail = vi
      .fn()
      .mockResolvedValue(
        createDetail({
          status: 'ready_for_confirmation',
          mediaStage: 'awaiting_candidates',
          revisionNo: 6,
        }),
      );
    const wait = vi.fn().mockResolvedValue(undefined);
    const events: ProgressEvent[] = [];

    const service = createMultimodalProgressStreamService({
      getSessionProgress,
      getSessionDetail,
      wait,
      pollIntervalMs: 25,
    });

    await service.streamProgress({
      authUserId: 'user-1',
      sessionId: '101',
      emit: async (event, data) => {
        events.push(data === undefined ? { event } : { event, data } as ProgressEvent);
      },
      isClosed: () => false,
    });

    expect(wait).not.toHaveBeenCalled();
    expect(events).toEqual([
      {
        event: 'progress',
        data: {
          progress: createProgress({
            status: 'ready_for_confirmation',
            mediaStage: 'awaiting_candidates',
            revisionNo: 6,
            currentJob: null,
          }),
        },
      },
      {
        event: 'confirmation',
        data: {
          session: createDetail({
            status: 'ready_for_confirmation',
            mediaStage: 'awaiting_candidates',
            revisionNo: 6,
          }),
          confirmationStage: 'evidence_and_candidates',
        },
      },
      { event: 'stream_end', data: {} },
    ]);
  });

  it('hydrates the session and ends when upload verification reaches ready_to_process', async () => {
    const readyProgress = createProgress({
      status: 'collecting',
      mediaStage: 'ready_to_process',
      revisionNo: 3,
      currentJob: null,
    });
    const readyDetail = createDetail({
      status: 'collecting',
      mediaStage: 'ready_to_process',
      revisionNo: 3,
    });
    const getSessionDetail = vi.fn().mockResolvedValue(readyDetail);
    const wait = vi.fn().mockRejectedValue(
      new Error('ready_to_process must not keep the SSE request open'),
    );
    const events: ProgressEvent[] = [];

    const service = createMultimodalProgressStreamService({
      getSessionProgress: vi.fn().mockResolvedValue(readyProgress),
      getSessionDetail,
      wait,
      pollIntervalMs: 25,
    });

    await service.streamProgress({
      authUserId: 'user-1',
      sessionId: '101',
      emit: async (event, data) => {
        events.push(data === undefined ? { event } : { event, data } as ProgressEvent);
      },
      isClosed: () => false,
    });

    expect(wait).not.toHaveBeenCalled();
    expect(getSessionDetail).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      { event: 'progress', data: { progress: readyProgress } },
      { event: 'done', data: { session: readyDetail } },
      { event: 'stream_end', data: {} },
    ]);
  });

  it('preserves the guided service receiver when using its default methods', async () => {
    const readyProgress = createProgress({
      status: 'collecting',
      mediaStage: 'ready_to_process',
      revisionNo: 3,
      currentJob: null,
    });
    const readyDetail = createDetail({
      status: 'collecting',
      mediaStage: 'ready_to_process',
      revisionNo: 3,
    });
    const guidedService = {
      async getSessionProgress() {
        expect(this).toBe(guidedService);
        return readyProgress;
      },
      async getSessionDetail() {
        expect(this).toBe(guidedService);
        return readyDetail;
      },
    };
    const events: ProgressEvent[] = [];

    await createMultimodalProgressStreamService({
      guidedService,
      wait: vi.fn(),
    }).streamProgress({
      authUserId: 'user-1',
      sessionId: '101',
      emit: async (event, data) => {
        events.push(data === undefined ? { event } : { event, data } as ProgressEvent);
      },
      isClosed: () => false,
    });

    expect(events.map((event) => event.event)).toEqual([
      'progress',
      'done',
      'stream_end',
    ]);
  });

  it('does not load confirmation detail after the client closes immediately after progress emit', async () => {
    const getSessionProgress = vi.fn().mockResolvedValue(
      createProgress({
        status: 'ready_for_confirmation',
        mediaStage: 'awaiting_candidates',
        revisionNo: 6,
        currentJob: null,
      }),
    );
    const getSessionDetail = vi.fn();
    let closed = false;

    const service = createMultimodalProgressStreamService({
      getSessionProgress,
      getSessionDetail,
      wait: vi.fn(),
      pollIntervalMs: 25,
    });

    await service.streamProgress({
      authUserId: 'user-1',
      sessionId: '101',
      emit: async (event) => {
        if (event === 'progress') {
          closed = true;
        }
      },
      isClosed: () => closed,
    });

    expect(getSessionDetail).not.toHaveBeenCalled();
  });

  it.each([
    ['failed', 'failed'],
    ['cancelled', 'cancelled'],
    ['published', 'completed'],
  ] as const)(
    'does not load terminal detail after close for media stage %s',
    async (mediaStage, status) => {
      let closed = false;
      const getSessionProgress = vi.fn().mockImplementation(async () => {
        closed = true;
        return createProgress({
          status,
          mediaStage,
          revisionNo: 7,
          currentJob: null,
        });
      });
      const getSessionDetail = vi.fn();

      const service = createMultimodalProgressStreamService({
        getSessionProgress,
        getSessionDetail,
        wait: vi.fn(),
        pollIntervalMs: 25,
      });

      await service.streamProgress({
        authUserId: 'user-1',
        sessionId: '101',
        emit: async () => {},
        isClosed: () => closed,
      });

      expect(getSessionDetail).not.toHaveBeenCalled();
    },
  );

  it('emits progress and not_started for draft subscriptions', async () => {
    const getSessionProgress = vi
      .fn()
      .mockResolvedValue(
        createProgress({
          mediaStage: 'draft',
          status: 'collecting',
          revisionNo: 0,
          currentJob: null,
        }),
      );
    const getSessionDetail = vi.fn();
    const events: ProgressEvent[] = [];

    const service = createMultimodalProgressStreamService({
      getSessionProgress,
      getSessionDetail,
      wait: vi.fn(),
      pollIntervalMs: 25,
    });

    await service.streamProgress({
      authUserId: 'user-1',
      sessionId: '101',
      emit: async (event, data) => {
        events.push(data === undefined ? { event } : { event, data } as ProgressEvent);
      },
      isClosed: () => false,
    });

    expect(getSessionDetail).not.toHaveBeenCalled();
    expect(events).toEqual([
      {
        event: 'progress',
        data: {
          progress: createProgress({
            mediaStage: 'draft',
            status: 'collecting',
            revisionNo: 0,
            currentJob: null,
          }),
        },
      },
      {
        event: 'stream_end',
        data: {
          reason: 'not_started',
        },
      },
    ]);
  });

  it('stops polling after the client closes the stream', async () => {
    const getSessionProgress = vi
      .fn()
      .mockResolvedValue(createProgress({ currentJob: { jobId: 'job-1', jobType: 'transcribe', status: 'leased', percent: 33, hint: 'processing' } }));
    let closed = false;
    const wait = vi.fn().mockImplementation(async () => {
      closed = true;
    });
    const events: ProgressEvent[] = [];

    const service = createMultimodalProgressStreamService({
      getSessionProgress,
      getSessionDetail: vi.fn(),
      wait,
      pollIntervalMs: 25,
    });

    await service.streamProgress({
      authUserId: 'user-1',
      sessionId: '101',
      emit: async (event, data) => {
        events.push(data === undefined ? { event } : { event, data } as ProgressEvent);
      },
      isClosed: () => closed,
    });

    expect(getSessionProgress).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      {
        event: 'progress',
        data: {
          progress: createProgress({
            currentJob: {
              jobId: 'job-1',
              jobType: 'transcribe',
              status: 'leased',
              percent: 33,
              hint: 'processing',
            },
          }),
        },
      },
    ]);
  });

  it('maps ready_to_publish to the publish confirmation stage', async () => {
    const getSessionProgress = vi
      .fn()
      .mockResolvedValue(
        createProgress({
          status: 'ready_for_confirmation',
          mediaStage: 'ready_to_publish',
          revisionNo: 9,
          currentJob: null,
        }),
      );
    const getSessionDetail = vi
      .fn()
      .mockResolvedValue(
        createDetail({
          status: 'ready_for_confirmation',
          mediaStage: 'ready_to_publish',
          revisionNo: 9,
        }),
      );
    const events: ProgressEvent[] = [];

    const service = createMultimodalProgressStreamService({
      getSessionProgress,
      getSessionDetail,
      wait: vi.fn(),
      pollIntervalMs: 25,
    });

    await service.streamProgress({
      authUserId: 'user-1',
      sessionId: '101',
      emit: async (event, data) => {
        events.push(data === undefined ? { event } : { event, data } as ProgressEvent);
      },
      isClosed: () => false,
    });

    expect(events[1]).toEqual({
      event: 'confirmation',
      data: {
        session: createDetail({
          status: 'ready_for_confirmation',
          mediaStage: 'ready_to_publish',
          revisionNo: 9,
        }),
        confirmationStage: 'publish',
      },
    });
  });
});
