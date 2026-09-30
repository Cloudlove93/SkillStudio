import { describe, expect, it } from 'vitest';
import type { MediaPublishResult, MediaSessionDetail } from '../../api/lite-api';
import * as workbenchState from './multimodal-guided-creation-state';
import {
  applyMultimodalEvent,
  createMultimodalWorkbenchState,
  evidenceAlignmentAtTime,
  evidenceAtTime,
  hasMultimodalResumeState,
  limitMultimodalCandidateSelection,
  pendingConfirmationStage,
  mediaReconcileIntervalMs,
  serializeMultimodalResumeState,
  shouldReconcileMediaDetail,
  shouldStreamMediaProgress,
  toggleMultimodalCandidateSelection,
} from './multimodal-guided-creation-state';

function detail(overrides: Partial<MediaSessionDetail> = {}): MediaSessionDetail {
  return {
    sessionId: '101',
    displayName: '课堂视频提炼',
    status: 'collecting',
    mediaStage: 'building_evidence',
    revisionNo: 4,
    createdAt: '2026-08-22T08:00:00.000Z',
    updatedAt: '2026-08-22T08:01:00.000Z',
    mediaState: {
      schemaVersion: 1,
      primarySource: {
        sourceId: 'source-1',
        kind: 'audio',
        assetRef: {
          objectKey: 'skill-sessions/101/source/audio.mp3',
          mimeType: 'audio/mpeg',
          sizeBytes: 1024,
          sha256: 'a'.repeat(64),
        },
      },
      pendingUpload: null,
      transcript: { status: 'ready', editable: true, segments: [] },
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
    ...overrides,
  };
}

describe('multimodal guided creation workbench state', () => {
  it('hydrates refresh state and recognizes audio as a valid zero-frame source', () => {
    const state = applyMultimodalEvent(createMultimodalWorkbenchState(), {
      type: 'detail.received',
      detail: detail(),
    });

    expect(state.detail?.sessionId).toBe('101');
    expect(state.sourceKind).toBe('audio');
    expect(state.hasVisualTrack).toBe(false);
    expect(state.busyAction).toBeNull();
  });

  it('falls back from SSE to polling without losing progress', () => {
    let state = createMultimodalWorkbenchState();
    state = applyMultimodalEvent(state, {
      type: 'progress.received',
      progress: {
        ...detail(),
        currentJob: {
          jobId: '8',
          jobType: 'transcribe',
          status: 'leased',
          percent: 47,
          hint: 'transcribing',
        },
      },
    });
    state = applyMultimodalEvent(state, { type: 'connection.polling' });

    expect(state.connection).toBe('polling');
    expect(state.progress?.currentJob?.percent).toBe(47);
  });

  it('stops live synchronization at human gates and terminal stages', () => {
    expect(shouldStreamMediaProgress('preparing_media')).toBe(true);
    expect(shouldStreamMediaProgress('building_evidence')).toBe(true);
    expect(shouldStreamMediaProgress('awaiting_adler_overview')).toBe(false);
    expect(shouldStreamMediaProgress('awaiting_candidates')).toBe(false);
    expect(shouldStreamMediaProgress('ready_to_publish')).toBe(false);
    expect(shouldStreamMediaProgress('failed')).toBe(false);
    expect(shouldStreamMediaProgress('published')).toBe(false);
  });

  it('settles a cleanly ended stream instead of entering a reconnect loop', () => {
    const state = applyMultimodalEvent(
      { ...createMultimodalWorkbenchState(), connection: 'sse' },
      { type: 'stream.event', event: { event: 'stream_end', data: {} } },
    );

    expect(state.connection).toBe('settled');
  });

  it('keeps polling after an SSE error followed by stream_end', () => {
    let state = applyMultimodalEvent(
      { ...createMultimodalWorkbenchState(), connection: 'sse' },
      {
        type: 'stream.event',
        event: {
          event: 'error',
          data: {
            code: 'MULTIMODAL_PROGRESS_STREAM_FAILED',
            message: '多模态进度流暂时不可用，请稍后重试。',
            retryable: true,
          },
        },
      },
    );
    state = applyMultimodalEvent(state, {
      type: 'stream.event',
      event: { event: 'stream_end', data: {} },
    });

    expect(state.connection).toBe('polling');
    expect(state.error).toBeNull();
  });

  it('keeps the same state for unchanged revisions and preserves actionable errors on polling', () => {
    const currentDetail = detail();
    const hydrated = applyMultimodalEvent(createMultimodalWorkbenchState(), {
      type: 'detail.received',
      detail: currentDetail,
    });
    const unchanged = applyMultimodalEvent(hydrated, {
      type: 'detail.received',
      detail: { ...currentDetail },
    });
    const failed = applyMultimodalEvent(unchanged, {
      type: 'action.failed',
      error: {
        code: 'PROCESS_FAILED',
        message: '处理失败，请从失败步骤重试',
        retryable: true,
      },
    });
    const progress = {
      ...currentDetail,
      currentJob: null,
    };
    const polled = applyMultimodalEvent(failed, {
      type: 'progress.received',
      progress,
    });

    expect(unchanged).toBe(hydrated);
    expect(polled.error).toEqual(failed.error);
  });

  it('turns a revision conflict into a reload-required state', () => {
    const state = applyMultimodalEvent(createMultimodalWorkbenchState(), {
      type: 'action.failed',
      error: {
        code: 'REVISION_CONFLICT',
        message: '内容已被其他页面更新',
        retryable: false,
      },
    });

    expect(state.revisionConflict).toBe(true);
    expect(state.error?.message).toContain('其他页面');
  });

  it('treats the server session revision conflict as reload-required', () => {
    const state = applyMultimodalEvent(createMultimodalWorkbenchState(), {
      type: 'action.failed',
      error: {
        code: 'SESSION_REVISION_CONFLICT',
        message: '会话版本已变化，请刷新后重试',
        retryable: false,
      },
    });

    expect(state.revisionConflict).toBe(true);
  });

  it('provides a stable generation idempotency key for the same session revision', () => {
    const helper = (workbenchState as unknown as {
      mediaOperationIdempotencyKey?: (
        operation: string,
        sessionId: string,
        revisionNo: number,
      ) => string;
    }).mediaOperationIdempotencyKey;

    expect(typeof helper).toBe('function');
    if (!helper) return;
    expect(helper('generate-confirm', '33', 14)).toBe(
      helper('generate-confirm', '33', 14),
    );
    expect(helper('generate-confirm', '33', 14)).not.toBe(
      helper('generate-confirm', '33', 15),
    );
  });

  it('only reconciles confirmation as successful when a published receipt exists', () => {
    const helper = (workbenchState as unknown as {
      isMediaGenerationPublished?: (value: MediaSessionDetail) => boolean;
    }).isMediaGenerationPublished;
    const published = detail({
      status: 'completed',
      mediaStage: 'published',
      publishedPackage: {
        packageId: '14',
        packageVersionId: '40',
        packageVersionNumber: 1,
        skillVersionIds: { 'skill-1': '81' },
        publishedAt: '2026-08-27T09:12:37.052Z',
      },
    });

    expect(typeof helper).toBe('function');
    if (!helper) return;
    expect(helper(published)).toBe(true);
    expect(helper({ ...published, publishedPackage: null })).toBe(false);
  });

  it('hydrates the published session directly from a successful generation response', () => {
    const helper = (workbenchState as unknown as {
      applyMediaGenerationResult?: (
        current: MediaSessionDetail,
        result: MediaPublishResult,
      ) => MediaSessionDetail;
    }).applyMediaGenerationResult;

    expect(typeof helper).toBe('function');
    if (!helper) return;
    const next = helper(detail({ mediaStage: 'arena_testing', revisionNo: 14 }), {
      sessionId: '101',
      revisionNo: 15,
      mediaStage: 'published',
      packageId: '14',
      packageVersionId: '40',
      packageVersionNumber: 1,
      skillVersionIds: { 'skill-1': '81' },
      publishedAt: '2026-08-27T09:12:37.052Z',
      replayed: false,
    });

    expect(next.status).toBe('completed');
    expect(next.mediaStage).toBe('published');
    expect(next.revisionNo).toBe(15);
    expect(next.publishedPackage?.packageId).toBe('14');
  });

  it('replays an ambiguous generation request with the same operation until it succeeds', async () => {
    const helper = (workbenchState as unknown as {
      confirmMediaGenerationReliably?: (input: {
        confirm: () => Promise<MediaPublishResult>;
        getDetail: () => Promise<MediaSessionDetail>;
        wait: (delayMs: number) => Promise<void>;
        retryDelaysMs: number[];
      }) => Promise<{ kind: string; result?: MediaPublishResult }>;
    }).confirmMediaGenerationReliably;
    const result: MediaPublishResult = {
      sessionId: '101',
      revisionNo: 15,
      mediaStage: 'published',
      packageId: '14',
      packageVersionId: '40',
      packageVersionNumber: 1,
      skillVersionIds: { 'skill-1': '81' },
      publishedAt: '2026-08-27T09:12:37.052Z',
      replayed: true,
    };
    let confirmCalls = 0;
    const waits: number[] = [];

    expect(typeof helper).toBe('function');
    if (!helper) return;
    const resolution = await helper({
      confirm: async () => {
        confirmCalls += 1;
        if (confirmCalls === 1) throw new Error('response lost');
        return result;
      },
      getDetail: async () => detail({ mediaStage: 'arena_testing', revisionNo: 14 }),
      wait: async (delayMs) => {
        waits.push(delayMs);
      },
      retryDelaysMs: [0, 250],
    });

    expect(confirmCalls).toBe(2);
    expect(waits).toEqual([250]);
    expect(resolution).toEqual({ kind: 'result', result });
  });

  it('accepts a publication that becomes visible during bounded reconciliation', async () => {
    const helper = (workbenchState as unknown as {
      confirmMediaGenerationReliably?: (input: {
        confirm: () => Promise<MediaPublishResult>;
        getDetail: () => Promise<MediaSessionDetail>;
        wait: (delayMs: number) => Promise<void>;
        retryDelaysMs: number[];
      }) => Promise<{ kind: string; detail?: MediaSessionDetail }>;
    }).confirmMediaGenerationReliably;
    const published = detail({
      status: 'completed',
      mediaStage: 'published',
      revisionNo: 15,
      publishedPackage: {
        packageId: '14',
        packageVersionId: '40',
        packageVersionNumber: 1,
        skillVersionIds: { 'skill-1': '81' },
        publishedAt: '2026-08-27T09:12:37.052Z',
      },
    });
    let detailCalls = 0;

    expect(typeof helper).toBe('function');
    if (!helper) return;
    const resolution = await helper({
      confirm: async () => {
        throw new Error('network unavailable');
      },
      getDetail: async () => {
        detailCalls += 1;
        return detailCalls === 1
          ? detail({ mediaStage: 'arena_testing', revisionNo: 14 })
          : published;
      },
      wait: async () => undefined,
      retryDelaysMs: [0, 250],
    });

    expect(resolution).toEqual({ kind: 'detail', detail: published });
  });

  it('does not replay a definitive generation conflict after reconciliation', async () => {
    const helper = (workbenchState as unknown as {
      confirmMediaGenerationReliably?: (input: {
        confirm: () => Promise<MediaPublishResult>;
        getDetail: () => Promise<MediaSessionDetail>;
        wait: (delayMs: number) => Promise<void>;
        retryDelaysMs: number[];
      }) => Promise<unknown>;
    }).confirmMediaGenerationReliably;
    const conflict = Object.assign(new Error('revision changed'), {
      status: 409,
      code: 'SESSION_REVISION_CONFLICT',
    });
    let confirmCalls = 0;

    expect(typeof helper).toBe('function');
    if (!helper) return;
    await expect(
      helper({
        confirm: async () => {
          confirmCalls += 1;
          throw conflict;
        },
        getDetail: async () => detail({ mediaStage: 'arena_testing', revisionNo: 15 }),
        wait: async () => undefined,
        retryDelaysMs: [0, 250, 750],
      }),
    ).rejects.toBe(conflict);
    expect(confirmCalls).toBe(1);
  });

  it('does not let a stale reconciliation overwrite optimistic publication', () => {
    const published = detail({
      status: 'completed',
      mediaStage: 'published',
      revisionNo: 15,
      updatedAt: '2026-08-27T09:12:37.052Z',
      publishedPackage: {
        packageId: '14',
        packageVersionId: '40',
        packageVersionNumber: 1,
        skillVersionIds: { 'skill-1': '81' },
        publishedAt: '2026-08-27T09:12:37.052Z',
      },
    });
    const current = applyMultimodalEvent(createMultimodalWorkbenchState(), {
      type: 'detail.received',
      detail: published,
    });
    const next = applyMultimodalEvent(current, {
      type: 'detail.received',
      detail: detail({ mediaStage: 'arena_testing', revisionNo: 14 }),
    });

    expect(next.detail).toEqual(published);
  });

  it('keeps reconciling a settled stage while generation recovery is pending', () => {
    expect(shouldReconcileMediaDetail('arena_testing', 'polling', true)).toBe(true);
  });

  it('maps state-machine stages to the three explicit confirmation points', () => {
    expect(pendingConfirmationStage('awaiting_adler_overview')).toBe('adler_overview');
    expect(pendingConfirmationStage('awaiting_candidates')).toBe(
      'evidence_and_candidates',
    );
    expect(pendingConfirmationStage('ready_to_publish')).toBe('publish');
    expect(pendingConfirmationStage('arena_testing')).toBe('publish');
    expect(pendingConfirmationStage('building_evidence')).toBeNull();
  });

  it('settles progress streaming while waiting for direct generation confirmation', () => {
    expect(shouldStreamMediaProgress('arena_testing')).toBe(false);
    expect(shouldReconcileMediaDetail('arena_testing', 'polling')).toBe(false);
  });

  it('aligns evidence by player time and persists only the resumable session id', () => {
    const current = detail();
    current.mediaState.evidenceTimeline.evidenceItems = [
      {
        evidenceId: 'ev-1',
        kind: 'transcript',
        source: { primarySourceId: 'source-1' },
        timeRange: { startMs: 1_000, endMs: 3_000 },
        text: '第一条',
        provenance: {
          method: 'asr',
          processorVersion: '1.0.0',
          editedByUser: false,
        },
        claimType: 'sourceFact',
        selectionReason: '语义重点',
      },
      {
        evidenceId: 'ev-2',
        kind: 'frame',
        source: { primarySourceId: 'source-1' },
        timeRange: { startMs: 4_000, endMs: 4_000 },
        text: '第二条',
        provenance: {
          method: 'frame-selection',
          processorVersion: '1.0.0',
          editedByUser: false,
        },
        claimType: 'sourceFact',
        selectionReason: '视觉重点',
      },
    ];

    expect(evidenceAtTime(current, 2_000).map((item) => item.evidenceId)).toEqual([
      'ev-1',
    ]);
    const serialized = serializeMultimodalResumeState({
      sessionId: '101',
      signedUrl: 'https://storage.example/signed',
      uploadToken: 'secret',
    });
    expect(serialized).toBe('{"sessionId":"101"}');
    expect(serialized).not.toContain('signed');
    expect(serialized).not.toContain('secret');
  });

  it('falls forward to the first upcoming evidence before playback reaches it', () => {
    const current = detail();
    current.mediaState.evidenceTimeline.evidenceItems = [
      {
        evidenceId: 'ev-transcript',
        kind: 'transcript',
        source: { primarySourceId: 'source-1' },
        timeRange: { startMs: 820, endMs: 3_000 },
        text: '函数是从数集到数集的映射',
        provenance: {
          method: 'asr',
          processorVersion: '1.0.0',
          editedByUser: false,
        },
        claimType: 'sourceFact',
        selectionReason: '语义重点',
      },
      {
        evidenceId: 'ev-frame',
        kind: 'frame',
        source: { primarySourceId: 'source-1' },
        timeRange: { startMs: 820, endMs: 820 },
        text: '函数定义板书',
        provenance: {
          method: 'frame-selection',
          processorVersion: '1.0.0',
          editedByUser: false,
        },
        claimType: 'sourceFact',
        selectionReason: '视觉重点',
      },
    ];

    const alignment = evidenceAlignmentAtTime(current, 0);

    expect(alignment.relation).toBe('upcoming');
    expect(alignment.items.map((item) => item.evidenceId)).toEqual([
      'ev-transcript',
      'ev-frame',
    ]);
  });

  it('prefers an upcoming evidence group inside the forward context window', () => {
    const current = detail();
    const template = current.mediaState.evidenceTimeline.evidenceItems[0]!;
    current.mediaState.evidenceTimeline.evidenceItems = [
      {
        ...template,
        evidenceId: 'ev-previous',
        timeRange: { startMs: 0, endMs: 900 },
      },
      {
        ...template,
        evidenceId: 'ev-upcoming',
        timeRange: { startMs: 3_000, endMs: 4_000 },
      },
    ];

    const alignment = evidenceAlignmentAtTime(current, 1_000);

    expect(alignment.relation).toBe('upcoming');
    expect(alignment.items.map((item) => item.evidenceId)).toEqual(['ev-upcoming']);
  });

  it('selects multimodal mode only for a stored non-empty session id', () => {
    expect(hasMultimodalResumeState('{"sessionId":"101"}')).toBe(true);
    expect(hasMultimodalResumeState('{"sessionId":""}')).toBe(false);
    expect(hasMultimodalResumeState('{"signedUrl":"https://storage.example"}')).toBe(false);
    expect(hasMultimodalResumeState('not-json')).toBe(false);
    expect(hasMultimodalResumeState(null)).toBe(false);
  });

  it('keeps database reconciliation active even while SSE is connected', () => {
    expect(shouldReconcileMediaDetail('validating_candidates', 'sse')).toBe(true);
    expect(shouldReconcileMediaDetail('validating_candidates', 'polling')).toBe(true);
    expect(shouldReconcileMediaDetail('validating_candidates', 'offline')).toBe(true);
    expect(shouldReconcileMediaDetail('awaiting_candidates', 'settled')).toBe(false);
  });

  it('reconciles slowly during healthy SSE and backs off while offline', () => {
    expect(mediaReconcileIntervalMs('sse')).toBe(12_000);
    expect(mediaReconcileIntervalMs('polling')).toBe(4_000);
    expect(mediaReconcileIntervalMs('offline')).toBe(8_000);
    expect(mediaReconcileIntervalMs('settled')).toBe(12_000);
  });

  it('keeps candidate selection within the shared 16-skill pack limit', () => {
    const candidateIds = Array.from({ length: 20 }, (_, index) => `candidate-${index}`);
    const limited = limitMultimodalCandidateSelection(candidateIds);

    expect(limited).toEqual(candidateIds.slice(0, 16));
    expect(toggleMultimodalCandidateSelection(limited, 'candidate-17', true)).toEqual(limited);
    expect(toggleMultimodalCandidateSelection(limited, 'candidate-0', false)).toHaveLength(15);
    expect(
      toggleMultimodalCandidateSelection(
        toggleMultimodalCandidateSelection(limited, 'candidate-0', false),
        'candidate-17',
        true,
      ),
    ).toContain('candidate-17');
  });
});
