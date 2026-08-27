import { describe, expect, it, vi } from 'vitest';
import { parseMultimodalSessionState, type MultimodalSessionState } from '@educlaw/shared';
import { createMultimodalPipelineStore } from './multimodal-pipeline-store';

function makeState(overrides?: Partial<MultimodalSessionState>): MultimodalSessionState {
  const base = parseMultimodalSessionState({
    schemaVersion: 1,
    primarySource: {
      sourceId: 'source-video',
      kind: 'video',
      assetRef: {
        objectKey: 'skill-sessions/101/source/video.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 4096,
        sha256: 'a'.repeat(64),
      },
    },
    transcript: {
      status: 'ready',
      editable: true,
      segments: [
        {
          startMs: 0,
          endMs: 1200,
          text: '老师先定义，再解释适用边界',
          confidence: 0.95,
          editedByUser: false,
        },
      ],
    },
    evidenceTimeline: {
      evidenceItems: [
        {
          evidenceId: 'ev-transcript',
          kind: 'transcript',
          source: {
            primarySourceId: 'source-video',
          },
          timeRange: {
            startMs: 0,
            endMs: 1200,
          },
          text: '老师先定义，再解释适用边界',
          provenance: {
            method: 'asr',
            processorVersion: 'asr-v1',
            confidence: 0.95,
            editedByUser: false,
          },
          claimType: 'sourceFact',
          selectionReason: '核心定义',
        },
      ],
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
    adlerOverview: {
      overview: {
        structure: [],
        interpretation: [],
        critique: [],
        application: [],
      },
      meta: {
        model: 'adler-model',
        promptVersion: 'adler-prompt',
        generatorVersion: 'adler-generator',
        degradations: [],
      },
    },
    adlerOverviewReview: {
      title: '教师确认标题',
      approved: true,
      userNotes: '',
    },
    selectedCandidateIds: [],
    candidateValidations: [],
    candidateSkills: [],
    operationReceipts: [
      {
        action: 'skill.media.overview.confirm',
        idempotencyKey: 'overview-confirm-001',
        requestHash: 'b'.repeat(64),
        baseRevisionNo: 2,
        resultRevisionNo: 3,
        confirmedStage: 'adler_overview',
        recordedAt: '2026-08-21T10:00:00.000Z',
      },
    ],
    ...overrides,
  });

  return parseMultimodalSessionState(base);
}

function makeRow(overrides?: Record<string, unknown>) {
  const state = makeState(overrides?.media_state_json as Partial<MultimodalSessionState> | undefined);
  return {
    id: '101',
    display_name: '多模态课程',
    status: 'collecting',
    creation_mode: 'multimodal_distill',
    media_stage: 'extracting_candidates',
    media_state_json: state,
    confirmed_stages_json: ['adler_overview'],
    revision_no: 3,
    error_json: null,
    created_at: '2026-08-21T09:59:00.000Z',
    updated_at: '2026-08-21T10:00:00.000Z',
    ...overrides,
  };
}

describe('multimodal pipeline store', () => {
  it('holds a database advisory lease for the whole model pipeline operation', async () => {
    const connectionQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ acquired: true }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ released: true }], rowCount: 1 });
    const withAdvisoryConnection = vi.fn(async (work) =>
      work({ query: connectionQuery }),
    );
    const work = vi.fn().mockResolvedValue('done');
    const store = createMultimodalPipelineStore({
      query: vi.fn(),
      withTransaction: vi.fn(),
      withAdvisoryConnection,
    });

    const result = await store.runWithPipelineLease({ sessionId: '101' }, work);

    expect(result).toEqual({ acquired: true, result: 'done' });
    expect(work).toHaveBeenCalledOnce();
    expect(String(connectionQuery.mock.calls[0]?.[0])).toContain('pg_try_advisory_lock');
    expect(String(connectionQuery.mock.calls[1]?.[0])).toContain('pg_advisory_unlock');
    expect(connectionQuery.mock.calls[0]?.[1]).toEqual([
      'educlaw:multimodal-pipeline:101',
    ]);
    expect(withAdvisoryConnection).toHaveBeenCalledOnce();
  });

  it('does not execute model work when another process owns the pipeline lease', async () => {
    const connectionQuery = vi.fn().mockResolvedValue({
      rows: [{ acquired: false }],
      rowCount: 1,
    });
    const store = createMultimodalPipelineStore({
      query: vi.fn(),
      withTransaction: vi.fn(),
      withAdvisoryConnection: async (work) => work({ query: connectionQuery }),
    });
    const work = vi.fn();

    await expect(
      store.runWithPipelineLease({ sessionId: '101' }, work),
    ).resolves.toEqual({ acquired: false });
    expect(work).not.toHaveBeenCalled();
    expect(connectionQuery).toHaveBeenCalledOnce();
  });

  it('scans runnable sessions with scoped creation mode, deleted filters, and stable ordering', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: '101',
          user_id: 'user-1',
          media_stage: 'extracting_candidates',
        },
        {
          id: '102',
          user_id: 'user-2',
          media_stage: 'building_skills',
        },
      ],
    });
    const store = createMultimodalPipelineStore({
      query,
      withTransaction: vi.fn(),
    });

    const runnable = await store.scanRunnableSessions({ limit: 5 });

    expect(runnable).toEqual([
      {
        sessionId: '101',
        authUserId: 'user-1',
        mediaStage: 'extracting_candidates',
      },
      {
        sessionId: '102',
        authUserId: 'user-2',
        mediaStage: 'building_skills',
      },
    ]);
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toContain("creation_mode = 'multimodal_distill'");
    expect(sql).toContain('deleted_at is null');
    expect(sql).toContain('media_stage in (');
    expect(sql).toContain('order by updated_at asc, id asc');
    expect(sql).toContain('limit $1');
    expect(values).toEqual([5]);
  });

  it('rejects malformed runnable scan rows and invalid limits before widening recovery scope', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ id: 'bad', user_id: 'user-1', media_stage: 'extracting_candidates' }],
      });
    const store = createMultimodalPipelineStore({
      query,
      withTransaction: vi.fn(),
    });

    await expect(store.scanRunnableSessions({ limit: 0 })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      statusCode: 422,
    });
    await expect(store.scanRunnableSessions({ limit: 1 })).rejects.toMatchObject({
      code: 'MULTIMODAL_PIPELINE_FAILED',
      statusCode: 500,
    });
  });

  it('loads scoped snapshots with strict user, mode, and deleted filters', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [makeRow()],
    });
    const store = createMultimodalPipelineStore({
      query,
      withTransaction: vi.fn(),
    });

    const snapshot = await store.loadSessionSnapshot({
      authUserId: 'user-1',
      sessionId: '101',
    });

    expect(snapshot.sessionId).toBe('101');
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toContain('where id = $1');
    expect(sql).toContain('and user_id = $2');
    expect(sql).toContain('and creation_mode = $3');
    expect(sql).toContain('and deleted_at is null');
    expect(values).toEqual(['101', 'user-1', 'multimodal_distill']);
  });

  it('does not treat upload receipts as human confirmation-stage receipts', async () => {
    const uploadReceipt = {
      action: 'skill.media.upload.confirm' as const,
      idempotencyKey: 'upload-confirm-001',
      requestHash: 'c'.repeat(64),
      baseRevisionNo: 1,
      resultRevisionNo: 2,
      confirmedStage: 'uploading' as const,
      recordedAt: '2026-08-21T09:59:30.000Z',
    };
    const query = vi.fn().mockResolvedValue({
      rows: [
        makeRow({
          status: 'collecting',
          media_stage: 'building_semantic_windows',
          revision_no: 12,
          confirmed_stages_json: [],
          media_state_json: makeState({
            adlerOverview: null,
            adlerOverviewReview: null,
            operationReceipts: [uploadReceipt],
          }),
        }),
      ],
    });
    const store = createMultimodalPipelineStore({
      query,
      withTransaction: vi.fn(),
    });

    await expect(
      store.loadSessionSnapshot({
        authUserId: 'user-1',
        sessionId: '101',
      }),
    ).resolves.toMatchObject({
      mediaStage: 'building_semantic_windows',
      confirmedStages: [],
    });
  });

  it('persists candidate passes with FOR UPDATE and CAS update conditions', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [makeRow()] })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            makeRow({
              media_stage: 'validating_candidates',
              revision_no: 4,
              updated_at: '2026-08-21T10:01:00.000Z',
              media_state_json: {
                ...makeState(),
                candidatePasses: {
                  frameworks: [
                    {
                      candidateId: 'c1',
                      passKey: 'frameworks',
                      title: '结构化框架',
                      summary: 'summary',
                      reusableRule: 'rule',
                      evidenceIds: ['ev-transcript'],
                      claimType: 'sourceFact',
                      visualAssertion: false,
                    },
                  ],
                  principles: [],
                  cases: [],
                  counterexamples: [],
                  terms: [],
                },
                candidatePassMeta: {
                  frameworks: { model: 'framework-model', promptVersion: 'framework-prompt' },
                  principles: { model: 'principle-model', promptVersion: 'principle-prompt' },
                  cases: { model: 'case-model', promptVersion: 'case-prompt' },
                  counterexamples: { model: 'counter-model', promptVersion: 'counter-prompt' },
                  terms: { model: 'term-model', promptVersion: 'term-prompt' },
                },
              },
            }),
          ],
        }),
    };
    const withTransaction = vi.fn(async (callback) => callback(db));
    const store = createMultimodalPipelineStore({
      query: vi.fn(),
      withTransaction,
      now: () => new Date('2026-08-21T10:01:00.000Z'),
    });

    const snapshot = await store.persistCandidatePasses({
      authUserId: 'user-1',
      sessionId: '101',
      expectedRevisionNo: 3,
      expectedStage: 'extracting_candidates',
      candidatePasses: {
        frameworks: [
          {
            candidateId: 'c1',
            passKey: 'frameworks',
            title: '结构化框架',
            summary: 'summary',
            reusableRule: 'rule',
            evidenceIds: ['ev-transcript'],
            claimType: 'sourceFact',
            visualAssertion: false,
          },
        ],
        principles: [],
        cases: [],
        counterexamples: [],
        terms: [],
      },
      candidatePassMeta: {
        frameworks: { model: 'framework-model', promptVersion: 'framework-prompt' },
        principles: { model: 'principle-model', promptVersion: 'principle-prompt' },
        cases: { model: 'case-model', promptVersion: 'case-prompt' },
        counterexamples: { model: 'counter-model', promptVersion: 'counter-prompt' },
        terms: { model: 'term-model', promptVersion: 'term-prompt' },
      },
    });

    expect(snapshot.mediaStage).toBe('validating_candidates');
    const [selectSql] = db.query.mock.calls[0]!;
    const [updateSql] = db.query.mock.calls[1]!;
    expect(selectSql).toContain('for update');
    expect(updateSql).toContain('and user_id = $7');
    expect(updateSql).toContain('and creation_mode = $8');
    expect(updateSql).toContain('and deleted_at is null');
    expect(updateSql).toContain('and revision_no = $9');
    expect(updateSql).toContain('and media_stage = $10');
    expect(updateSql).toContain('error_json = null');
    expect(snapshot.mediaState.candidatePassMeta?.frameworks.model).toBe('framework-model');
  });

  it('rejects invalid store inputs before SQL and keeps direct-write invariants', async () => {
    const query = vi.fn();
    const withTransaction = vi.fn();
    const store = createMultimodalPipelineStore({
      query,
      withTransaction,
    });

    await expect(
      store.persistCandidatePasses({
        authUserId: 'user-1',
        sessionId: 'bad',
        expectedRevisionNo: 3,
        expectedStage: 'extracting_candidates',
        candidatePasses: {
          frameworks: [],
          principles: [],
          cases: [],
          counterexamples: [],
          terms: [],
        },
        candidatePassMeta: null,
      } as never),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT', statusCode: 422 });

    await expect(
      store.persistPipelineFailure({
        authUserId: 'user-1',
        sessionId: '101',
        expectedRevisionNo: 3,
        expectedStage: 'extracting_candidates',
        error: {
          code: 'x'.repeat(129),
          stage: 'extracting_candidates',
          retryable: true,
          message: 'x',
          resumeStage: 'validating_candidates',
          raw: 'secret',
        },
      } as never),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT', statusCode: 422 });

    expect(withTransaction).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('persists bounded pipeline failures with FOR UPDATE and CAS guards', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [makeRow()] })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            makeRow({
              media_stage: 'failed',
              status: 'failed',
              revision_no: 4,
              updated_at: '2026-08-21T10:01:00.000Z',
              error_json: {
                code: 'MULTIMODAL_PIPELINE_FAILED',
                stage: 'extracting_candidates',
                retryable: true,
                message: '候选提取失败，请稍后重试',
                resumeStage: 'extracting_candidates',
              },
            }),
          ],
        }),
    };
    const withTransaction = vi.fn(async (callback) => callback(db));
    const store = createMultimodalPipelineStore({
      query: vi.fn(),
      withTransaction,
      now: () => new Date('2026-08-21T10:01:00.000Z'),
    });

    const snapshot = await store.persistPipelineFailure({
      authUserId: 'user-1',
      sessionId: '101',
      expectedRevisionNo: 3,
      expectedStage: 'extracting_candidates',
      error: {
        code: 'MULTIMODAL_PIPELINE_FAILED',
        stage: 'extracting_candidates',
        retryable: true,
        message: '候选提取失败，请稍后重试',
        resumeStage: 'extracting_candidates',
      },
    });

    expect(snapshot.mediaStage).toBe('failed');
    const [selectSql] = db.query.mock.calls[0]!;
    const [updateSql] = db.query.mock.calls[1]!;
    expect(selectSql).toContain('for update');
    expect(updateSql).toContain('error_json = $5::jsonb');
    expect(updateSql).toContain('and revision_no = $9');
    expect(updateSql).toContain('and media_stage = $10');
  });

  it('resumes a retryable session-level pipeline failure with state-machine and CAS guards', async () => {
    const failedError = {
      code: 'MULTIMODAL_PIPELINE_FAILED',
      stage: 'extracting_candidates',
      retryable: true,
      message: '候选提取失败，请稍后重试',
      resumeStage: 'extracting_candidates',
    };
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [
            makeRow({
              media_stage: 'failed',
              status: 'failed',
              revision_no: 4,
              error_json: failedError,
            }),
          ],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            makeRow({
              media_stage: 'extracting_candidates',
              status: 'collecting',
              revision_no: 5,
              error_json: null,
            }),
          ],
        }),
    };
    const store = createMultimodalPipelineStore({
      query: vi.fn(),
      withTransaction: vi.fn(async (callback) => callback(db)),
      now: () => new Date('2026-08-21T10:02:00.000Z'),
    });

    const snapshot = await store.resumePipelineFailure({
      authUserId: 'user-1',
      sessionId: '101',
      expectedRevisionNo: 4,
    });

    expect(snapshot.mediaStage).toBe('extracting_candidates');
    expect(snapshot.revisionNo).toBe(5);
    expect(snapshot.error).toBeNull();
    const [selectSql] = db.query.mock.calls[0]!;
    const [updateSql] = db.query.mock.calls[1]!;
    expect(selectSql).toContain('for update');
    expect(updateSql).toContain('error_json = null');
    expect(updateSql).toContain("and media_stage = 'failed'");
    expect(updateSql).toContain('and revision_no = $8');
  });
});
