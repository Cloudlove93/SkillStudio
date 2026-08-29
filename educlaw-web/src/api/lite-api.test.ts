import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArenaMessageStreamEvent } from './lite-api';
import { LiteApiError, liteApi } from './lite-api';

const encoder = new TextEncoder();
const localStorageMock = {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

function createSseResponse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
    },
  });
}

describe('liteApi multimodal media progress helpers', () => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageMock,
    configurable: true,
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorageMock.getItem.mockReset();
    localStorageMock.getItem.mockReturnValue(null);
  });

  it('posts media detail and progress JSON actions with auth headers', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        createJsonResponse({
          data: {
            sessionId: '101',
            displayName: '多模态技能包',
            status: 'collecting',
            mediaStage: 'extracting_candidates',
            revisionNo: 2,
            createdAt: '2026-08-22T08:00:00.000Z',
            updatedAt: '2026-08-22T08:01:00.000Z',
            mediaState: {
              schemaVersion: 1,
              primarySource: null,
              transcript: { status: 'pending', editable: true, segments: [] },
              evidenceTimeline: { evidenceItems: [] },
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
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          data: {
            sessionId: '101',
            displayName: '多模态技能包',
            status: 'collecting',
            mediaStage: 'extracting_candidates',
            revisionNo: 2,
            createdAt: '2026-08-22T08:00:00.000Z',
            updatedAt: '2026-08-22T08:01:00.000Z',
            currentJob: {
              jobId: 'job-1',
              jobType: 'transcribe',
              status: 'leased',
              percent: 42,
              hint: 'processing',
            },
          },
        }),
      );

    const detail = await liteApi.getMediaSessionDetail('token-1', { sessionId: '101' });
    const progress = await liteApi.getMediaProgress('token-1', { sessionId: '101' });

    expect(detail.sessionId).toBe('101');
    expect(progress.currentJob?.percent).toBe(42);
    const [detailUrl, detailInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [progressUrl, progressInit] = fetchMock.mock.calls[1] as [string, RequestInit];

    expect(detailUrl).toBe('/api');
    expect(detailInit.method).toBe('POST');
    expect(new Headers(detailInit.headers).get('Authorization')).toBe('Bearer token-1');
    expect(new Headers(detailInit.headers).get('Content-Type')).toBe('application/json');
    expect(detailInit.body).toBe(
      JSON.stringify({
        action: 'skill.media.session.detail',
        payload: {
          sessionId: '101',
        },
      }),
    );

    expect(progressUrl).toBe('/api');
    expect(progressInit.method).toBe('POST');
    expect(new Headers(progressInit.headers).get('Authorization')).toBe('Bearer token-1');
    expect(new Headers(progressInit.headers).get('Content-Type')).toBe('application/json');
    expect(progressInit.body).toBe(
      JSON.stringify({
        action: 'skill.media.progress',
        payload: {
          sessionId: '101',
        },
      }),
    );
  });

  it('streams multimodal progress confirmation SSE events through the typed helper', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createSseResponse([
        'event: progress\ndata: {"progress":{"sessionId":"101","displayName":"多模态技能包","status":"collecting","mediaStage":"extracting_candidates","revisionNo":2,"createdAt":"2026-08-22T08:00:00.000Z","updatedAt":"2026-08-22T08:01:00.000Z","currentJob":{"jobId":"job-1","jobType":"transcribe","status":"leased","percent":42,"hint":"processing"}}}\n\n',
        'event: confirmation\ndata: {"session":{"sessionId":"101","displayName":"多模态技能包","status":"ready_for_confirmation","mediaStage":"awaiting_candidates","revisionNo":3,"createdAt":"2026-08-22T08:00:00.000Z","updatedAt":"2026-08-22T08:02:00.000Z","mediaState":{"schemaVersion":1,"primarySource":null,"transcript":{"status":"pending","editable":true,"segments":[]},"evidenceTimeline":{"evidenceItems":[]},"candidatePasses":{"frameworks":[],"principles":[],"cases":[],"counterexamples":[],"terms":[]},"candidatePassMeta":null,"semanticMoments":[],"degradations":[],"adlerOverview":null,"adlerOverviewReview":null,"selectedCandidateIds":[],"candidateValidations":[],"candidateSkills":[],"operationReceipts":[]}},"confirmationStage":"evidence_and_candidates"}\n\n',
        'event: stream_end\ndata: {}\n\n',
      ]),
    );

    const events: Array<{ event: string; data: unknown }> = [];
    await liteApi.streamMediaProgress('token-2', { sessionId: '101' }, (event) => {
      events.push(event as { event: string; data: unknown });
    });

    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe('/api');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer token-2');
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
    expect(init.body).toBe(
      JSON.stringify({
        action: 'skill.media.progress.stream',
        payload: {
          sessionId: '101',
        },
      }),
    );
    expect(events).toEqual([
      {
        event: 'progress',
        data: {
          progress: {
            sessionId: '101',
            displayName: '多模态技能包',
            status: 'collecting',
            mediaStage: 'extracting_candidates',
            revisionNo: 2,
            createdAt: '2026-08-22T08:00:00.000Z',
            updatedAt: '2026-08-22T08:01:00.000Z',
            currentJob: {
              jobId: 'job-1',
              jobType: 'transcribe',
              status: 'leased',
              percent: 42,
              hint: 'processing',
            },
          },
        },
      },
      {
        event: 'confirmation',
        data: {
          session: expect.objectContaining({
            sessionId: '101',
            mediaStage: 'awaiting_candidates',
          }),
          confirmationStage: 'evidence_and_candidates',
        },
      },
      {
        event: 'stream_end',
        data: {},
      },
    ]);
  });

  it('streams multimodal progress terminal SSE events through the typed helper', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createSseResponse([
        'event: done\ndata: {"session":{"sessionId":"101","displayName":"多模态技能包","status":"completed","mediaStage":"published","revisionNo":4,"createdAt":"2026-08-22T08:00:00.000Z","updatedAt":"2026-08-22T08:03:00.000Z","mediaState":{"schemaVersion":1,"primarySource":null,"transcript":{"status":"pending","editable":true,"segments":[]},"evidenceTimeline":{"evidenceItems":[]},"candidatePasses":{"frameworks":[],"principles":[],"cases":[],"counterexamples":[],"terms":[]},"candidatePassMeta":null,"semanticMoments":[],"degradations":[],"adlerOverview":null,"adlerOverviewReview":null,"selectedCandidateIds":[],"candidateValidations":[],"candidateSkills":[],"operationReceipts":[]}}}\n\n',
        'event: stream_end\ndata: {}\n\n',
      ]),
    );

    const events: Array<{ event: string; data: unknown }> = [];
    await liteApi.streamMediaProgress('token-2', { sessionId: '101' }, (event) => {
      events.push(event as { event: string; data: unknown });
    });

    expect(events).toEqual([
      {
        event: 'done',
        data: {
          session: expect.objectContaining({
            sessionId: '101',
            mediaStage: 'published',
          }),
        },
      },
      {
        event: 'stream_end',
        data: {},
      },
    ]);
  });

  it('keeps guided and media stream callbacks precisely typed through the shared helper', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        createSseResponse([
          'event: phase\ndata: {"phase":"understanding"}\n\n',
          'event: stream_end\ndata: {}\n\n',
        ]),
      )
      .mockResolvedValueOnce(
        createSseResponse([
          'event: progress\ndata: {"progress":{"sessionId":"101","displayName":"多模态技能包","status":"collecting","mediaStage":"extracting_candidates","revisionNo":2,"createdAt":"2026-08-22T08:00:00.000Z","updatedAt":"2026-08-22T08:01:00.000Z","currentJob":null}}\n\n',
          'event: stream_end\ndata: {}\n\n',
        ]),
      );

    const guidedEvents: string[] = [];
    await liteApi.sendGuidedCreationMessageStream(
      'token-guided',
      {
        session_id: '12',
        client_message_id: 'client-message-1',
        revision_no: 2,
        content: '继续',
      },
      (event) => {
        guidedEvents.push(event.event);
      },
    );

    const mediaEvents: string[] = [];
    await liteApi.streamMediaProgress('token-media', { sessionId: '101' }, (event) => {
      mediaEvents.push(event.event);
    });

    expect(guidedEvents).toEqual(['phase', 'stream_end']);
    expect(mediaEvents).toEqual(['progress', 'stream_end']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('surfaces SSE error events with the existing stream parser contract', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createSseResponse([
        'event: error\ndata: {"code":"MULTIMODAL_PROGRESS_STREAM_FAILED","message":"多模态进度流暂时不可用，请稍后重试。","retryable":true}\n\n',
        'event: stream_end\ndata: {}\n\n',
      ]),
    );

    const events: Array<{ event: string; data: unknown }> = [];
    await liteApi.streamMediaProgress('token-3', { sessionId: '101' }, (event) => {
      events.push(event as { event: string; data: unknown });
    });

    expect(events).toEqual([
      {
        event: 'error',
        data: {
          code: 'MULTIMODAL_PROGRESS_STREAM_FAILED',
          message: '多模态进度流暂时不可用，请稍后重试。',
          retryable: true,
        },
      },
      {
        event: 'stream_end',
        data: {},
      },
    ]);
  });

  it('keeps the existing LiteApiError behavior for JSON progress failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createJsonResponse(
        {
          code: 'IDEMPOTENCY_KEY_REUSED',
          message: 'conflict',
          retryable: false,
        },
        409,
      ),
    );

    await expect(
      liteApi.getMediaProgress('token-4', { sessionId: '101' }),
    ).rejects.toBeInstanceOf(LiteApiError);
  });

  it('sends the thinking preference and parses reasoning stream events', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createSseResponse([
        'event: thinking_status\ndata: {"requested":true,"enabled":true,"supported":true}\n\n',
        'event: reasoning_delta\ndata: {"side":"enhanced","delta":"分析"}\n\n',
        'event: delta\ndata: {"side":"enhanced","delta":"答案"}\n\n',
        'event: stream_end\ndata: {"ok":true}\n\n',
      ]),
    );
    const controller = new AbortController();
    const events: ArenaMessageStreamEvent[] = [];

    await liteApi.sendMessageStream(
      'token-arena',
      '91',
      '问题',
      undefined,
      'agent',
      true,
      (event) => events.push(event),
      controller.signal,
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      content: '问题',
      mode: 'agent',
      thinkingEnabled: true,
    });
    expect(init.signal).toBe(controller.signal);
    expect(events[1]).toEqual({
      event: 'reasoning_delta',
      data: { side: 'enhanced', delta: '分析' },
    });
  });

  it('keeps media mutation routing fields at the server envelope top level', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createJsonResponse({
        data: {
          sessionId: '101',
          revisionNo: 3,
          mediaStage: 'preparing_media',
          job: { jobId: '9', jobType: 'media_prepare', status: 'queued', attemptNo: 1 },
          pipelinePlan: {
            transcribe: true,
            frameMaterialize: true,
            visualOnly: false,
          },
          replayed: false,
        },
      }),
    );

    await liteApi.startMediaProcessing('token-5', {
      sessionId: '101',
      idempotencyKey: 'idem-process-1',
      expectedRevisionNo: 2,
      understandingMode: 'auto',
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      action: 'skill.media.process.start',
      sessionId: '101',
      idempotencyKey: 'idem-process-1',
      payload: {
        expectedRevisionNo: 2,
        understandingMode: 'auto',
        transcriptionMode: 'deploymentDefault',
      },
    });
  });

  it('retries a pipeline failure without inventing a failed worker job id', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createJsonResponse({
        data: {
          sessionId: '101',
          revisionNo: 15,
          mediaStage: 'building_skills',
          retriedJobId: null,
          job: null,
          replayed: false,
        },
      }),
    );

    await liteApi.retryMediaProcessing('token-5', {
      sessionId: '101',
      idempotencyKey: 'pipeline-retry-001',
      expectedRevisionNo: 14,
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      action: 'skill.media.retry',
      sessionId: '101',
      idempotencyKey: 'pipeline-retry-001',
      payload: { expectedRevisionNo: 14 },
    });
  });

  it('never embeds upload URLs or tokens in subsequent confirmation payload fields', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createJsonResponse({
        data: {
          sessionId: '101',
          revisionNo: 3,
          mediaStage: 'uploading',
          materialStatus: 'verifying',
          jobId: '7',
          observedSizeBytes: 4,
          observedContentType: 'audio/mpeg',
          jobType: 'media_quality_check',
          replayed: false,
        },
      }),
    );

    await liteApi.confirmMediaUpload('token-6', {
      sessionId: '101',
      idempotencyKey: 'idem-confirm-1',
      uploadToken: 'opaque-upload-token',
      expectedRevisionNo: 2,
      parts: [{ partNumber: 1, etag: 'etag-1' }],
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({
      action: 'skill.media.upload.confirm',
      sessionId: '101',
      idempotencyKey: 'idem-confirm-1',
      payload: {
        uploadToken: 'opaque-upload-token',
        expectedRevisionNo: 2,
        parts: [{ partNumber: 1, etag: 'etag-1' }],
      },
    });
    expect(JSON.stringify(body)).not.toContain('https://');
  });

  it('posts strict Arena and publish actions with revision and package CAS fields', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(createJsonResponse({ data: { sessionId: '101', revisionNo: 11, mediaStage: 'ready_to_publish', passed: true, evaluation: {}, replayed: false } }))
      .mockResolvedValueOnce(createJsonResponse({ data: { sessionId: '101', revisionNo: 12, mediaStage: 'published', packageId: '51', packageVersionId: '61', packageVersionNumber: 1, skillVersionIds: { 'skill-1': '71' }, replayed: false } }));

    await liteApi.startMediaArenaTest('token-7', { sessionId: '101', idempotencyKey: 'arena-test-001', expectedRevisionNo: 10 });
    await liteApi.publishMediaSkillPack('token-7', { sessionId: '101', idempotencyKey: 'media-publish-001', expectedRevisionNo: 11, targetPackageId: null, expectedPackageVersionId: null });

    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual({
      action: 'skill.media.test.start', sessionId: '101', idempotencyKey: 'arena-test-001', payload: { expectedRevisionNo: 10 },
    });
    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toEqual({
      action: 'skill.media.publish', sessionId: '101', idempotencyKey: 'media-publish-001',
      payload: { expectedRevisionNo: 11, targetPackageId: null, expectedPackageVersionId: null },
    });
  });

  it('posts direct multimodal generation confirmation without an Arena request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      createJsonResponse({
        data: {
          sessionId: '101',
          revisionNo: 11,
          mediaStage: 'published',
          packageId: '51',
          packageVersionId: '61',
          packageVersionNumber: 1,
          skillVersionIds: { 'skill-1': '71' },
          replayed: false,
        },
      }),
    );

    await liteApi.confirmGeneratedMediaSkills('token-8', {
      sessionId: '101',
      idempotencyKey: 'generate-confirm-001',
      expectedRevisionNo: 10,
      targetPackageId: null,
      expectedPackageVersionId: null,
    });

    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual({
      action: 'skill.media.generate.confirm',
      sessionId: '101',
      idempotencyKey: 'generate-confirm-001',
      payload: {
        expectedRevisionNo: 10,
        targetPackageId: null,
        expectedPackageVersionId: null,
      },
    });
  });

  it('surfaces the global API error message for direct generation failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      createJsonResponse(
        {
          error: '数据库事务未完成',
          requestId: 'request-generate-500',
        },
        500,
      ),
    );

    await expect(
      liteApi.confirmGeneratedMediaSkills('token-8', {
        sessionId: '101',
        idempotencyKey: 'generate-confirm-error-001',
        expectedRevisionNo: 10,
        targetPackageId: null,
        expectedPackageVersionId: null,
      }),
    ).rejects.toMatchObject({
      message: '数据库事务未完成',
      status: 500,
      details: {
        error: '数据库事务未完成',
        requestId: 'request-generate-500',
      },
    });
  });
});

describe('liteApi Skill repository pagination', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requests one authenticated repository page instead of enumerating packages', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      createJsonResponse({
        items: [{
          id: '11',
          packageId: '7',
          skillUid: 'function-teaching',
          dirName: 'function-teaching',
          name: '函数教学',
          description: '函数概念课',
          updatedAt: '2026-08-29T08:00:00.000Z',
          packageName: '高等数学',
          packageDescription: '课程技能',
        }],
        nextCursor: 'next-page',
      }),
    );

    const page = await liteApi.listRepositorySkills('token-3', {
      cursor: 'current-page',
      limit: 25,
    });

    expect(page.nextCursor).toBe('next-page');
    expect(page.items[0]?.name).toBe('函数教学');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/skills/repository?cursor=current-page&limit=25');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer token-3');
  });
});

describe('liteApi Skill conversation pagination', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requests a server-filtered conversation page for one Skill', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      createJsonResponse({
        items: [],
        nextCursor: 'next-page',
      }),
    );

    const page = await liteApi.listThreadPage('token-4', {
      packageId: '7',
      skillId: '42',
      cursor: 'current-page',
      limit: 25,
    });

    expect(page).toEqual({ items: [], nextCursor: 'next-page' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      '/api/arena/threads/page?packageId=7&skillId=42&cursor=current-page&limit=25',
    );
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer token-4');
  });
});
