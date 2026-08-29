import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { parseMultimodalSessionState } from '@educlaw/shared';
import {
  __testing,
  buildMultimodalSessionCreateRequestHash,
  createMultimodalGuidedCreationService,
  MultimodalGuidedCreationServiceError,
  stableRequestHashJson,
} from './multimodal-guided-creation-service.js';
import { createUploadSecurityService } from './upload-security.service.js';
import { computeMultimodalArenaResultHash } from './arena-service.js';

type QueryResultRow = Record<string, unknown>;

function createServiceHarness() {
  const query = vi.fn<
    (text: string, values?: unknown[]) => Promise<{
      rows: QueryResultRow[];
      rowCount: number | null;
    }>
  >();
  const withTransaction = vi.fn(
    async (
      work: (db: {
        query: typeof query;
      }) => Promise<unknown>,
    ) => work({ query }),
  );
  const now = new Date('2026-08-21T10:00:00.000Z');

  const service = createMultimodalGuidedCreationService({
    query,
    withTransaction,
    now: () => now,
  });

  return { service, query, withTransaction };
}

function createSessionRow(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: '101',
    user_id: 'user-1',
    display_name: '媒体草稿',
    status: 'collecting',
    creation_mode: 'multimodal_distill',
    media_stage: 'draft',
    media_state_json: {
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
    },
    confirmed_stages_json: [],
    revision_no: 0,
    start_client_message_id: 'media-create-key-1',
    start_request_hash:
      '18a7273f0f454e5e41b7c6f6c30788d182c1b66cbf7ba0dfee6a4a9a97fb8d2d',
    deleted_at: null,
    created_at: '2026-08-21T10:00:00.000Z',
    updated_at: '2026-08-21T10:00:00.000Z',
    ...overrides,
  };
}

function createJobRow(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: '701',
    session_id: '101',
    job_type: 'transcribe',
    status: 'leased',
    idempotency_key: 'job-key-1',
    request_hash:
      'a0e2dcf0453fc5d66a952c9d49e602dc265521ba66848948d366fccf8357a6f8',
    attempt_no: 1,
    max_attempts: 3,
    progress_json: {
      phase: 'transcribing',
      percent: 30,
      objectKey: 'should-not-leak',
      workerIdentity: 'should-not-leak',
      leaseToken: 'should-not-leak',
      internalPath: 'C:/secret',
      error: 'should-not-leak',
    },
    input_manifest_json: {},
    output_manifest_json: null,
    result_hash: null,
    error_json: null,
    available_at: '2026-08-21T10:00:00.000Z',
    started_at: '2026-08-21T10:00:01.000Z',
    finished_at: null,
    created_at: '2026-08-21T10:00:00.000Z',
    updated_at: '2026-08-21T10:00:02.000Z',
    ...overrides,
  };
}

function createAdlerOverview() {
  return {
    overview: {
      structure: [
        {
          text: '先定义，再说明适用边界',
          evidenceIds: ['ev-transcript-1'],
          claimType: 'sourceFact',
        },
      ],
      interpretation: [],
      critique: [],
      application: [],
    },
    meta: {
      model: 'adler-model',
      promptVersion: 'adler-prompt-v1',
      generatorVersion: 'adler-generator-v1',
      degradations: [],
    },
  };
}

function createAwaitingAdlerState() {
  return {
    schemaVersion: 1,
    primarySource: {
      sourceId: 'source-audio-1',
      kind: 'audio',
      assetRef: {
        objectKey: 'skill-sessions/501/source/audio.mp3',
        mimeType: 'audio/mpeg',
        sizeBytes: 8192,
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
          text: '先定义，再说明适用边界',
          speaker: null,
          confidence: 0.95,
          editedByUser: false,
        },
      ],
    },
    evidenceTimeline: {
      evidenceItems: [
        {
          evidenceId: 'ev-transcript-1',
          kind: 'transcript',
          source: {
            primarySourceId: 'source-audio-1',
          },
          timeRange: { startMs: 0, endMs: 1200 },
          text: '先定义，再说明适用边界',
          provenance: {
            method: 'asr',
            processorVersion: 'asr-v1',
            confidence: 0.95,
            editedByUser: false,
          },
          claimType: 'sourceFact',
          selectionReason: '原始转录证据',
        },
        {
          evidenceId: 'ev-audio-1',
          kind: 'audio_segment',
          source: {
            primarySourceId: 'source-audio-1',
          },
          timeRange: { startMs: 0, endMs: 1200 },
          text: '音频证据',
          assetRef: {
            objectKey: 'skill-sessions/501/audio/segment-1.wav',
            mimeType: 'audio/wav',
            sizeBytes: 4096,
            sha256: 'b'.repeat(64),
          },
          provenance: {
            method: 'media_quality_check',
            processorVersion: 'audio-v1',
            confidence: 0.95,
            editedByUser: false,
          },
          claimType: 'sourceFact',
          selectionReason: '可回放音频证据',
        },
      ],
    },
    candidatePasses: {
      frameworks: [
        {
          candidateId: 'candidate-framework-1',
          passKey: 'frameworks',
          title: '定义到边界的讲解框架',
          summary: '先定义，再说明适用边界',
          reusableRule: '先定义后边界',
          evidenceIds: ['ev-transcript-1', 'ev-audio-1'],
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
      frameworks: {
        model: 'framework-model',
        promptVersion: 'framework-prompt-v1',
      },
      principles: {
        model: 'principle-model',
        promptVersion: 'principle-prompt-v1',
      },
      cases: {
        model: 'case-model',
        promptVersion: 'case-prompt-v1',
      },
      counterexamples: {
        model: 'counterexample-model',
        promptVersion: 'counterexample-prompt-v1',
      },
      terms: {
        model: 'term-model',
        promptVersion: 'term-prompt-v1',
      },
    },
    semanticMoments: [],
    degradations: [],
    adlerOverview: createAdlerOverview(),
    adlerOverviewReview: null,
    selectedCandidateIds: [],
    candidateValidations: [],
    candidateSkills: [],
    operationReceipts: [],
  };
}

function createAwaitingCandidatesState() {
  return {
    ...createAwaitingAdlerState(),
    adlerOverviewReview: {
      title: 'Adler Overview',
      approved: true,
      userNotes: '',
    },
    candidateValidations: [
      {
        candidate: {
          candidateId: 'candidate-framework-1',
          passKey: 'frameworks',
          title: '定义到边界的讲解框架',
          summary: '先定义，再说明适用边界',
          reusableRule: '先定义后边界',
          evidenceIds: ['ev-transcript-1', 'ev-audio-1'],
          claimType: 'sourceFact',
          visualAssertion: false,
        },
        validation: {
          v1: {
            passed: true,
            reason: '可迁移',
            reusableContexts: ['课堂概念讲解', '课后答疑'],
            proofSatisfied: true,
          },
          v2: {
            passed: true,
            reason: '存在新场景',
            novelScenario: '课后答疑时先重述定义再补边界',
            capability: 'guide',
            proofSatisfied: true,
          },
          v3: {
            passed: true,
            reason: '强调边界',
            differentiators: ['必须说明适用边界'],
            proofSatisfied: true,
          },
        },
        overallPassed: true,
        disposition: 'retain',
      },
    ],
    operationReceipts: [
      {
        action: 'skill.media.overview.confirm',
        idempotencyKey: 'overview-confirm-001',
        requestHash: '1'.repeat(64),
        baseRevisionNo: 0,
        resultRevisionNo: 1,
        confirmedStage: 'adler_overview',
        recordedAt: '2026-08-21T10:01:00.000Z',
      },
    ],
  };
}

describe('multimodal guided creation service', () => {
  it('creates an initial multimodal session with a parseable initial state', async () => {
    const { service, query } = createServiceHarness();
    query.mockResolvedValueOnce({
      rows: [createSessionRow({ display_name: '多模态技能包' })],
      rowCount: 1,
    });

    const session = await service.createSession({
      authUserId: 'user-1',
      idempotencyKey: 'media-create-key-1',
      displayName: '  多模态技能包  ',
    });

    expect(session).toMatchObject({
      sessionId: '101',
      displayName: '多模态技能包',
      status: 'collecting',
      mediaStage: 'draft',
      revisionNo: 0,
    });
    expect(parseMultimodalSessionState(session.mediaState)).toEqual(
      session.mediaState,
    );
    expect(session.mediaState.semanticMoments).toEqual([]);
    expect(session.mediaState.degradations).toEqual([]);
    expect(session.mediaState.adlerOverview).toBeNull();
    expect(session.mediaState.adlerOverviewReview).toBeNull();
    expect(session.mediaState.selectedCandidateIds).toEqual([]);
    expect(session.mediaState.candidateValidations).toEqual([]);
    expect(session.mediaState.candidateSkills).toEqual([]);
    expect(session.mediaState.operationReceipts).toEqual([]);

    const [sql, values] = query.mock.calls[0] ?? [];
    expect(String(sql)).toContain('insert into skill_guided_creation_sessions');
    expect(values?.[0]).toBe('user-1');
    expect(values?.[1]).toBe('多模态技能包');
    expect(values?.[2]).toBe('multimodal_distill');
    expect(values?.[3]).toBe('media-create-key-1');
    expect(values?.[4]).toMatch(/^[a-f0-9]{64}$/);
    expect(values?.[5]).toBe('draft');
    expect(values?.[6]).toBe('collecting');
    expect(parseMultimodalSessionState(JSON.parse(String(values?.[7])))).toEqual(
      session.mediaState,
    );
    expect(JSON.parse(String(values?.[7]))).toMatchObject({
      semanticMoments: [],
      degradations: [],
      adlerOverview: null,
      adlerOverviewReview: null,
      selectedCandidateIds: [],
      candidateValidations: [],
      candidateSkills: [],
      operationReceipts: [],
    });
    expect(values?.[8]).toBe('2026-08-21T10:00:00.000Z');
  });

  it('replays the existing session for the same idempotency key and request hash', async () => {
    const { service, query } = createServiceHarness();
    query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({
        rows: [
          createSessionRow({
            display_name: '同一会话',
            start_request_hash: createHash('sha256')
              .update(
                JSON.stringify({
                  action: 'skill.media.session.create',
                  creationMode: 'multimodal_distill',
                  displayName: '同一会话',
                }),
                'utf8',
              )
              .digest('hex'),
          }),
        ],
        rowCount: 1,
      });

    const session = await service.createSession({
      authUserId: 'user-1',
      idempotencyKey: 'media-create-key-1',
      displayName: '同一会话',
    });

    expect(session.displayName).toBe('同一会话');
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('rejects idempotency key reuse with a different request hash', async () => {
    const { service, query } = createServiceHarness();
    query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({
        rows: [
          createSessionRow({
            display_name: '旧标题',
            start_request_hash:
              '2ad2cc4b69cb0dbe354552820379e3533dbf6fda0b282c790ef4ee2f1f795774',
          }),
        ],
        rowCount: 1,
      });

    await expect(
      service.createSession({
        authUserId: 'user-1',
        idempotencyKey: 'media-create-key-1',
        displayName: '新标题',
      }),
    ).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
      statusCode: 409,
    });
  });

  it('fails when a unique conflict cannot be read back', async () => {
    const { service, query } = createServiceHarness();
    query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(
      service.createSession({
        authUserId: 'user-1',
        idempotencyKey: 'media-create-key-1',
        displayName: '多模态技能包',
      }),
    ).rejects.toMatchObject({
      code: 'MULTIMODAL_SESSION_CREATE_FAILED',
      statusCode: 409,
    });
  });

  it('lists only visible multimodal sessions for the authenticated user', async () => {
    const { service, query } = createServiceHarness();
    query.mockResolvedValueOnce({
      rows: [
        createSessionRow({ id: '101', updated_at: '2026-08-21T10:00:00.000Z' }),
        createSessionRow({ id: '102', updated_at: '2026-08-21T09:00:00.000Z' }),
      ],
      rowCount: 2,
    });

    const result = await service.listSessions({
      authUserId: 'user-1',
      cursor: '2026-08-21T08:00:00.000Z',
      limit: 20,
    });

    expect(result).toEqual({
      items: [
        expect.objectContaining({ sessionId: '101' }),
        expect.objectContaining({ sessionId: '102' }),
      ],
      nextCursor: null,
    });
    expect(String(query.mock.calls[0]?.[0])).toContain(
      'user_id = $1',
    );
    expect(String(query.mock.calls[0]?.[0])).toContain(
      "creation_mode = 'multimodal_distill'",
    );
    expect(String(query.mock.calls[0]?.[0])).toContain('deleted_at is null');
  });

  it('rejects an invalid list cursor before reaching the database cast boundary', async () => {
    const { service, query } = createServiceHarness();

    await expect(
      service.listSessions({
        authUserId: 'user-1',
        cursor: 'not-a-timestamp',
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      statusCode: 422,
    });

    expect(query).not.toHaveBeenCalled();
  });

  it('returns detail with a parsed media state', async () => {
    const { service, query } = createServiceHarness();
    query.mockResolvedValueOnce({
      rows: [createSessionRow()],
      rowCount: 1,
    });

    const detail = await service.getSessionDetail({
      authUserId: 'user-1',
      sessionId: '101',
    });

    expect(detail.mediaState.transcript.status).toBe('pending');
    expect(detail.mediaState.candidatePasses.terms).toEqual([]);
    expect(String(query.mock.calls[0]?.[0])).toContain('id = $1');
    expect(String(query.mock.calls[0]?.[0])).toContain('user_id = $2');
    expect(String(query.mock.calls[0]?.[0])).toContain('creation_mode = $3');
    expect(String(query.mock.calls[0]?.[0])).toContain('deleted_at is null');
  });

  it('returns a sanitized persisted pipeline error with failed session detail', async () => {
    const { service, query } = createServiceHarness();
    query.mockResolvedValueOnce({
      rows: [createSessionRow({
        status: 'failed',
        media_stage: 'failed',
        error_json: {
          code: 'MULTIMODAL_PIPELINE_FAILED',
          stage: 'validating_candidates',
          resumeStage: 'validating_candidates',
          retryable: true,
          message: '候选校验失败，请重试',
          signedUrl: 'https://storage.example/secret',
        },
      })],
      rowCount: 1,
    });

    const detail = await service.getSessionDetail({
      authUserId: 'user-1',
      sessionId: '101',
    });

    expect(detail.error).toEqual({
      code: 'MULTIMODAL_PIPELINE_FAILED',
      stage: 'validating_candidates',
      resumeStage: 'validating_candidates',
      retryable: true,
      message: '候选校验失败，请重试',
    });
    expect(JSON.stringify(detail.error)).not.toContain('signedUrl');
  });

  it('restores the public Arena and publish receipts with session detail', async () => {
    const { service, query } = createServiceHarness();
    const evaluationWithoutHash = {
      schemaVersion: 1,
      configVersion: 'multimodal-arena-v1',
      caseVersion: '2026-08-23',
      candidateRevisionNo: 10,
      snapshotHash: 'a'.repeat(64),
      models: { baseline: 'baseline', enhanced: 'enhanced' },
      cases: [
        'novel-scenario-transfer',
        'boundary-and-stop',
        'evidence-grounding',
      ].map((caseId) => ({
        caseId,
        input: `input-${caseId}`,
        baselineOutput: 'baseline output',
        enhancedOutput: 'enhanced output',
        baselineScore: 0,
        enhancedScore: 0,
        safetyPassed: true,
        groundedPassed: true,
        passed: false,
        reason: 'deterministic failure',
      })),
      passedCaseCount: 0,
      passed: false,
      deterministicFailures: ['INSUFFICIENT_CASES_PASSED'],
    };
    const evaluation = {
      ...evaluationWithoutHash,
      resultHash: computeMultimodalArenaResultHash(evaluationWithoutHash),
    };
    query.mockResolvedValueOnce({
      rows: [createSessionRow({
        validation_result_json: {
          schemaVersion: 1,
          action: 'skill.media.test.start',
          idempotencyKey: 'arena-test-001',
          requestHash: 'c'.repeat(64),
          baseRevisionNo: 10,
          resultRevisionNo: 11,
          recordedAt: '2026-08-23T10:00:00.000Z',
          evaluation,
        },
        confirmation_json: {
          schemaVersion: 1,
          action: 'skill.media.publish',
          idempotencyKey: 'publish-test-001',
          requestHash: 'd'.repeat(64),
          baseRevisionNo: 11,
          resultRevisionNo: 12,
          packageId: '51',
          packageVersionId: '61',
          packageVersionNumber: 2,
          skillVersionIds: { 'skill-1': '71' },
          publishedAt: '2026-08-23T10:01:00.000Z',
        },
      })],
      rowCount: 1,
    });

    const detail = await service.getSessionDetail({ authUserId: 'user-1', sessionId: '101' });

    expect(detail.arenaEvaluation).toEqual(evaluation);
    expect(detail.publishedPackage).toEqual({
      packageId: '51',
      packageVersionId: '61',
      packageVersionNumber: 2,
      skillVersionIds: { 'skill-1': '71' },
      publishedAt: '2026-08-23T10:01:00.000Z',
    });
    expect(String(query.mock.calls[0]?.[0])).toContain('validation_result_json');
    expect(String(query.mock.calls[0]?.[0])).toContain('confirmation_json');
  });

  it('rejects invalid persisted media state or media stage drift', async () => {
    const { service, query } = createServiceHarness();
    query
      .mockResolvedValueOnce({
        rows: [createSessionRow({ media_state_json: { schemaVersion: 2 } })],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [createSessionRow({ media_stage: 'drifted_stage' })],
        rowCount: 1,
      });

    await expect(
      service.getSessionDetail({
        authUserId: 'user-1',
        sessionId: '101',
      }),
    ).rejects.toBeInstanceOf(MultimodalGuidedCreationServiceError);

    await expect(
      service.getSessionDetail({
        authUserId: 'user-1',
        sessionId: '101',
      }),
    ).rejects.toBeInstanceOf(MultimodalGuidedCreationServiceError);

    query.mockResolvedValueOnce({
      rows: [createSessionRow({ media_stage: 'published', status: 'collecting' })],
      rowCount: 1,
    });
    await expect(
      service.getSessionDetail({
        authUserId: 'user-1',
        sessionId: '101',
      }),
    ).rejects.toBeInstanceOf(MultimodalGuidedCreationServiceError);

    query.mockResolvedValueOnce({
      rows: [
        createSessionRow({
          media_stage: 'awaiting_adler_overview',
          status: 'collecting',
        }),
      ],
      rowCount: 1,
    });
    await expect(
      service.getSessionDetail({
        authUserId: 'user-1',
        sessionId: '101',
      }),
    ).rejects.toBeInstanceOf(MultimodalGuidedCreationServiceError);
  });

  it('rejects corrupted persisted session ids', async () => {
    const { service, query } = createServiceHarness();
    query.mockResolvedValueOnce({
      rows: [createSessionRow({ id: null })],
      rowCount: 1,
    });

    await expect(
      service.getSessionDetail({
        authUserId: 'user-1',
        sessionId: '101',
      }),
    ).rejects.toBeInstanceOf(MultimodalGuidedCreationServiceError);
  });

  it('returns redacted progress from the latest media job', async () => {
    const { service, query } = createServiceHarness();
    query
      .mockResolvedValueOnce({
        rows: [createSessionRow()],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [createJobRow()],
        rowCount: 1,
      });

    const progress = await service.getSessionProgress({
      authUserId: 'user-1',
      sessionId: '101',
    });

    expect(progress).toEqual({
      sessionId: '101',
      displayName: '媒体草稿',
      status: 'collecting',
      mediaStage: 'draft',
      revisionNo: 0,
      createdAt: '2026-08-21T10:00:00.000Z',
      updatedAt: '2026-08-21T10:00:00.000Z',
      currentJob: {
        jobId: '701',
        jobType: 'transcribe',
        status: 'leased',
        percent: 30,
        hint: '正在识别语音内容',
      },
    });
    expect(String(query.mock.calls[0]?.[0])).toContain('user_id = $2');
    expect(String(query.mock.calls[1]?.[0])).toContain('where session_id = $1');
    expect(String(query.mock.calls[1]?.[0])).not.toContain('user_id');
  });

  it('translates internal worker phases before returning progress', async () => {
    const { service, query } = createServiceHarness();
    query
      .mockResolvedValueOnce({
        rows: [createSessionRow()],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [
          createJobRow({
            job_type: 'transcribe',
            progress_json: { phase: 'downloading_audio', percent: 15 },
          }),
        ],
        rowCount: 1,
      });

    const progress = await service.getSessionProgress({
      authUserId: 'user-1',
      sessionId: '101',
    });

    expect(progress.currentJob).toMatchObject({
      percent: 15,
      hint: '正在读取音轨',
    });
    expect(JSON.stringify(progress)).not.toContain('downloading_audio');
  });

  it('falls back to a Chinese job label for unknown or mixed worker phases', async () => {
    const { service, query } = createServiceHarness();
    query
      .mockResolvedValueOnce({
        rows: [createSessionRow()],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [
          createJobRow({
            job_type: 'transcribe',
            progress_json: {
              phase: 'downloading_audio（重试）',
              percent: 15,
            },
          }),
        ],
        rowCount: 1,
      });

    const progress = await service.getSessionProgress({
      authUserId: 'user-1',
      sessionId: '101',
    });

    expect(progress.currentJob?.hint).toBe('正在进行语音转录');
    expect(JSON.stringify(progress)).not.toContain('downloading_audio');
  });

  it('reports a succeeded worker job as complete instead of retaining 95 percent', async () => {
    const { service, query } = createServiceHarness();
    query
      .mockResolvedValueOnce({
        rows: [createSessionRow()],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [
          createJobRow({
            job_type: 'media_quality_check',
            status: 'succeeded',
            progress_json: { phase: 'ready_to_complete', percent: 95 },
          }),
        ],
        rowCount: 1,
      });

    const progress = await service.getSessionProgress({
      authUserId: 'user-1',
      sessionId: '101',
    });

    expect(progress.currentJob).toMatchObject({
      status: 'succeeded',
      percent: 100,
      hint: '安全校验完成',
    });
    expect(JSON.stringify(progress)).not.toContain('ready_to_complete');
  });

  it('rejects corrupted media job ids or mismatched session ids during progress reads', async () => {
    const { service, query } = createServiceHarness();
    query
      .mockResolvedValueOnce({
        rows: [createSessionRow()],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [createJobRow({ id: undefined })],
        rowCount: 1,
      });

    await expect(
      service.getSessionProgress({
        authUserId: 'user-1',
        sessionId: '101',
      }),
    ).rejects.toBeInstanceOf(MultimodalGuidedCreationServiceError);

    query
      .mockResolvedValueOnce({
        rows: [createSessionRow()],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [createJobRow({ session_id: '999' })],
        rowCount: 1,
      });

    await expect(
      service.getSessionProgress({
        authUserId: 'user-1',
        sessionId: '101',
      }),
    ).rejects.toBeInstanceOf(MultimodalGuidedCreationServiceError);
  });

  it('hides deleted or foreign sessions from detail, list and progress reads', async () => {
    const { service, query } = createServiceHarness();
    query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(
      service.getSessionDetail({
        authUserId: 'user-2',
        sessionId: '101',
      }),
    ).rejects.toMatchObject({ code: 'GUIDED_SESSION_NOT_FOUND' });

    expect(
      await service.listSessions({
        authUserId: 'user-2',
      }),
    ).toEqual({ items: [], nextCursor: null });

    await expect(
      service.getSessionProgress({
        authUserId: 'user-2',
        sessionId: '101',
      }),
    ).rejects.toMatchObject({ code: 'GUIDED_SESSION_NOT_FOUND' });
  });

  it('computes a stable create-session request hash independent of object field order', () => {
    const ordered = stableRequestHashJson({
      action: 'skill.media.session.create',
      creationMode: 'multimodal_distill',
      displayName: '多模态技能包',
      nested: {
        b: 2,
        a: 1,
      },
    });
    const reordered = stableRequestHashJson({
      nested: {
        a: 1,
        b: 2,
      },
      displayName: '多模态技能包',
      creationMode: 'multimodal_distill',
      action: 'skill.media.session.create',
    });

    expect(ordered).toBe(reordered);
    expect(buildMultimodalSessionCreateRequestHash('多模态技能包')).toBe(
      createHash('sha256')
        .update(
          stableRequestHashJson({
            creationMode: 'multimodal_distill',
            action: 'skill.media.session.create',
            displayName: '多模态技能包',
          }),
          'utf8',
        )
        .digest('hex'),
    );
  });

  it('updates one transcript segment with segment CAS and invalidates every semantic downstream artifact', async () => {
    const { service, query } = createServiceHarness();
    const sessionState = createAwaitingAdlerState();
    const mutation = {
      segmentIndex: 0,
      expectedSegmentRevisionNo: 0,
      text: '人工修订后的定义与适用边界',
      speaker: '教师',
    };
    const requestHash = createHash('sha256')
      .update(
        stableRequestHashJson({
          action: 'skill.media.transcript.update',
          sessionId: '101',
          expectedRevisionNo: 0,
          mutation,
        }),
        'utf8',
      )
      .digest('hex');
    const updatedState = {
      ...sessionState,
      transcript: {
        ...sessionState.transcript,
        segments: [
          {
            ...sessionState.transcript.segments[0],
            text: mutation.text,
            speaker: mutation.speaker,
            editedByUser: true,
            revisionNo: 1,
          },
        ],
      },
      semanticMoments: [],
      evidenceTimeline: { evidenceItems: [] },
      candidatePasses: {
        frameworks: [],
        principles: [],
        cases: [],
        counterexamples: [],
        terms: [],
      },
      candidatePassMeta: null,
      degradations: [],
      adlerOverview: null,
      adlerOverviewReview: null,
      selectedCandidateIds: [],
      candidateValidations: [],
      candidateSkills: [],
      operationReceipts: [
        {
          action: 'skill.media.transcript.update',
          idempotencyKey: 'transcript-update-001',
          requestHash,
          baseRevisionNo: 0,
          resultRevisionNo: 1,
          confirmedStage: 'transcript',
          recordedAt: '2026-08-21T10:00:00.000Z',
        },
      ],
    };
    query
      .mockResolvedValueOnce({
        rows: [
          createSessionRow({
            status: 'ready_for_confirmation',
            media_stage: 'awaiting_adler_overview',
            media_state_json: sessionState,
          }),
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [
          createSessionRow({
            media_stage: 'building_semantic_windows',
            media_state_json: updatedState,
            revision_no: 1,
          }),
        ],
        rowCount: 1,
      });

    await expect(
      service.updateTranscriptSegment({
        authUserId: 'user-1',
        sessionId: '101',
        idempotencyKey: 'transcript-update-001',
        expectedRevisionNo: 0,
        mutation,
      }),
    ).resolves.toEqual({
      sessionId: '101',
      revisionNo: 1,
      mediaStage: 'building_semantic_windows',
      invalidatedFrom: 'semantic_moments',
      replayed: false,
    });

    const updateValues = query.mock.calls[1]?.[1] ?? [];
    const persisted = parseMultimodalSessionState(
      JSON.parse(String(updateValues[2])),
    );
    expect(persisted.transcript.segments[0]).toMatchObject({
      text: mutation.text,
      speaker: mutation.speaker,
      editedByUser: true,
      revisionNo: 1,
    });
    expect(persisted.evidenceTimeline.evidenceItems).toEqual([]);
    expect(persisted.adlerOverview).toBeNull();
    expect(persisted.candidatePasses.frameworks).toEqual([]);
    expect(String(query.mock.calls[0]?.[0]).toLowerCase()).toContain('for update');
    expect(String(query.mock.calls[1]?.[0]).toLowerCase()).toContain('revision_no = $9');
  });

  it('replays the same transcript edit but rejects a stale segment revision for a new edit', async () => {
    const base = createAwaitingAdlerState();
    const mutation = {
      segmentIndex: 0,
      expectedSegmentRevisionNo: 0,
      text: '人工修订后的定义',
      speaker: null,
    };
    const requestHash = createHash('sha256')
      .update(
        stableRequestHashJson({
          action: 'skill.media.transcript.update',
          sessionId: '101',
          expectedRevisionNo: 0,
          mutation,
        }),
        'utf8',
      )
      .digest('hex');
    const editedState = {
      ...base,
      transcript: {
        ...base.transcript,
        segments: [
          {
            ...base.transcript.segments[0],
            text: mutation.text,
            speaker: null,
            editedByUser: true,
            revisionNo: 1,
          },
        ],
      },
      evidenceTimeline: { evidenceItems: [] },
      candidatePasses: {
        frameworks: [],
        principles: [],
        cases: [],
        counterexamples: [],
        terms: [],
      },
      candidatePassMeta: null,
      adlerOverview: null,
      operationReceipts: [
        {
          action: 'skill.media.transcript.update',
          idempotencyKey: 'transcript-update-001',
          requestHash,
          baseRevisionNo: 0,
          resultRevisionNo: 1,
          confirmedStage: 'transcript',
          recordedAt: '2026-08-21T10:00:00.000Z',
        },
      ],
    };
    const replayHarness = createServiceHarness();
    replayHarness.query.mockResolvedValueOnce({
      rows: [
        createSessionRow({
          media_stage: 'building_semantic_windows',
          media_state_json: editedState,
          revision_no: 1,
        }),
      ],
      rowCount: 1,
    });
    await expect(
      replayHarness.service.updateTranscriptSegment({
        authUserId: 'user-1',
        sessionId: '101',
        idempotencyKey: 'transcript-update-001',
        expectedRevisionNo: 0,
        mutation,
      }),
    ).resolves.toMatchObject({ revisionNo: 1, replayed: true });
    expect(replayHarness.query).toHaveBeenCalledOnce();

    const conflictHarness = createServiceHarness();
    conflictHarness.query.mockResolvedValueOnce({
      rows: [
        createSessionRow({
          media_stage: 'building_semantic_windows',
          media_state_json: editedState,
          revision_no: 1,
        }),
      ],
      rowCount: 1,
    });
    await expect(
      conflictHarness.service.updateTranscriptSegment({
        authUserId: 'user-1',
        sessionId: '101',
        idempotencyKey: 'transcript-update-002',
        expectedRevisionNo: 1,
        mutation: {
          ...mutation,
          expectedSegmentRevisionNo: 0,
          text: '第二次修订',
        },
      }),
    ).rejects.toMatchObject({ code: 'SEGMENT_REVISION_CONFLICT', statusCode: 409 });
  });

  it('replaces the reviewed evidence set without deleting assets and restarts only Adler downstream work', async () => {
    const { service, query } = createServiceHarness();
    const sessionState = createAwaitingAdlerState();
    const evidenceItems = sessionState.evidenceTimeline.evidenceItems.map((item) =>
      item.evidenceId === 'ev-transcript-1'
        ? {
            ...item,
            text: '人工校正后的转写证据',
            provenance: { ...item.provenance, editedByUser: true },
          }
        : item,
    );
    const requestHash = createHash('sha256')
      .update(
        stableRequestHashJson({
          action: 'skill.media.evidence.update',
          sessionId: '101',
          expectedRevisionNo: 0,
          mutation: evidenceItems,
        }),
        'utf8',
      )
      .digest('hex');
    const updatedState = {
      ...sessionState,
      evidenceTimeline: { evidenceItems },
      candidatePasses: {
        frameworks: [],
        principles: [],
        cases: [],
        counterexamples: [],
        terms: [],
      },
      candidatePassMeta: null,
      adlerOverview: null,
      adlerOverviewReview: null,
      candidateValidations: [],
      candidateSkills: [],
      operationReceipts: [
        {
          action: 'skill.media.evidence.update',
          idempotencyKey: 'evidence-update-001',
          requestHash,
          baseRevisionNo: 0,
          resultRevisionNo: 1,
          confirmedStage: 'evidence',
          recordedAt: '2026-08-21T10:00:00.000Z',
        },
      ],
    };
    query
      .mockResolvedValueOnce({
        rows: [
          createSessionRow({
            status: 'ready_for_confirmation',
            media_stage: 'awaiting_adler_overview',
            media_state_json: sessionState,
          }),
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [
          createSessionRow({
            media_stage: 'building_adler',
            media_state_json: updatedState,
            revision_no: 1,
          }),
        ],
        rowCount: 1,
      });

    await expect(
      service.updateEvidence({
        authUserId: 'user-1',
        sessionId: '101',
        idempotencyKey: 'evidence-update-001',
        expectedRevisionNo: 0,
        evidenceItems,
      }),
    ).resolves.toEqual({
      sessionId: '101',
      revisionNo: 1,
      mediaStage: 'building_adler',
      invalidatedFrom: 'adler_overview',
      replayed: false,
    });
    const persisted = parseMultimodalSessionState(
      JSON.parse(String(query.mock.calls[1]?.[1]?.[2])),
    );
    expect(persisted.evidenceTimeline.evidenceItems[0]?.text).toBe(
      '人工校正后的转写证据',
    );
    expect(persisted.evidenceTimeline.evidenceItems[1]?.assetRef).toEqual(
      sessionState.evidenceTimeline.evidenceItems[1]?.assetRef,
    );
    expect(persisted.adlerOverview).toBeNull();
  });

  it('accepts an edited candidate set and invalidates validation while retaining the Overview gate', async () => {
    const { service, query } = createServiceHarness();
    const sessionState = createAwaitingCandidatesState();
    const candidatePasses = {
      ...sessionState.candidatePasses,
      frameworks: [
        {
          ...sessionState.candidatePasses.frameworks[0],
          title: '人工拆分后的定义—边界框架',
        },
      ],
    };
    const requestHash = createHash('sha256')
      .update(
        stableRequestHashJson({
          action: 'skill.media.candidate.update',
          sessionId: '101',
          expectedRevisionNo: 3,
          mutation: candidatePasses,
        }),
        'utf8',
      )
      .digest('hex');
    const updatedState = {
      ...sessionState,
      candidatePasses,
      selectedCandidateIds: [],
      candidateValidations: [],
      candidateSkills: [],
      operationReceipts: [
        ...sessionState.operationReceipts,
        {
          action: 'skill.media.candidate.update',
          idempotencyKey: 'candidate-update-001',
          requestHash,
          baseRevisionNo: 3,
          resultRevisionNo: 4,
          confirmedStage: 'candidate',
          recordedAt: '2026-08-21T10:00:00.000Z',
        },
      ],
    };
    query
      .mockResolvedValueOnce({
        rows: [
          createSessionRow({
            status: 'ready_for_confirmation',
            media_stage: 'awaiting_candidates',
            media_state_json: sessionState,
            confirmed_stages_json: ['adler_overview'],
            revision_no: 3,
          }),
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [
          createSessionRow({
            media_stage: 'validating_candidates',
            media_state_json: updatedState,
            confirmed_stages_json: ['adler_overview'],
            revision_no: 4,
          }),
        ],
        rowCount: 1,
      });

    await expect(
      service.updateCandidates({
        authUserId: 'user-1',
        sessionId: '101',
        idempotencyKey: 'candidate-update-001',
        expectedRevisionNo: 3,
        candidatePasses,
      }),
    ).resolves.toEqual({
      sessionId: '101',
      revisionNo: 4,
      mediaStage: 'validating_candidates',
      invalidatedFrom: 'candidate_validation',
      replayed: false,
    });
    const persisted = parseMultimodalSessionState(
      JSON.parse(String(query.mock.calls[1]?.[1]?.[2])),
    );
    expect(persisted.candidatePasses.frameworks[0]?.title).toBe(
      '人工拆分后的定义—边界框架',
    );
    expect(persisted.candidateValidations).toEqual([]);
    expect(persisted.adlerOverviewReview).not.toBeNull();
  });

  it('confirms overview atomically, records receipt, and advances to extracting_candidates without calling any model work', async () => {
    const { service, query, withTransaction } = createServiceHarness();
    const sessionState = createAwaitingAdlerState();
    query
      .mockResolvedValueOnce({
        rows: [
          createSessionRow({
            status: 'ready_for_confirmation',
            media_stage: 'awaiting_adler_overview',
            media_state_json: sessionState,
            confirmed_stages_json: [],
            revision_no: 0,
          }),
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [
          createSessionRow({
            status: 'collecting',
            media_stage: 'extracting_candidates',
            media_state_json: {
              ...sessionState,
              adlerOverviewReview: {
                title: 'Adler Overview',
                approved: true,
                userNotes: '',
              },
              operationReceipts: [
                {
                  action: 'skill.media.overview.confirm',
                  idempotencyKey: 'overview-confirm-001',
                  requestHash: createHash('sha256')
                    .update(
                      stableRequestHashJson({
                        action: 'skill.media.overview.confirm',
                        sessionId: '101',
                        expectedRevisionNo: 0,
                        overview: {
                          title: 'Adler Overview',
                          approved: true,
                          userNotes: '',
                        },
                      }),
                      'utf8',
                    )
                    .digest('hex'),
                  baseRevisionNo: 0,
                  resultRevisionNo: 1,
                  confirmedStage: 'adler_overview',
                  recordedAt: '2026-08-21T10:00:00.000Z',
                },
              ],
            },
            confirmed_stages_json: ['adler_overview'],
            revision_no: 1,
            updated_at: '2026-08-21T10:00:00.000Z',
          }),
        ],
        rowCount: 1,
      });

    const result = await service.confirmOverview({
      authUserId: 'user-1',
      sessionId: '101',
      idempotencyKey: 'overview-confirm-001',
      expectedRevisionNo: 0,
      overview: {
        title: '  Adler Overview  ',
        approved: true,
        userNotes: '',
      },
    });

    expect(result).toEqual({
      sessionId: '101',
      revisionNo: 1,
      mediaStage: 'extracting_candidates',
      confirmedStage: 'adler_overview',
      replayed: false,
    });
    expect(withTransaction).toHaveBeenCalledOnce();
    expect(String(query.mock.calls[0]?.[0]).toLowerCase()).toContain('for update');
    expect(String(query.mock.calls[0]?.[0]).toLowerCase()).toContain('user_id = $2');
    expect(String(query.mock.calls[0]?.[0]).toLowerCase()).toContain("creation_mode = $3");
    expect(String(query.mock.calls[0]?.[0]).toLowerCase()).toContain('deleted_at is null');
    expect(String(query.mock.calls[1]?.[0]).toLowerCase()).toContain('confirmed_stages_json = $');
    expect(String(query.mock.calls[1]?.[0]).toLowerCase()).toContain('revision_no = $');
    expect(String(query.mock.calls[1]?.[0]).toLowerCase()).toContain('media_stage = $');
    const updateValues = query.mock.calls[1]?.[1] ?? [];
    expect(updateValues).toContain('extracting_candidates');
    expect(updateValues).toContain('collecting');
    expect(
      parseMultimodalSessionState(JSON.parse(String(updateValues[3]))),
    ).toMatchObject({
      adlerOverviewReview: {
        title: 'Adler Overview',
        approved: true,
        userNotes: '',
      },
      operationReceipts: [
        expect.objectContaining({
          action: 'skill.media.overview.confirm',
          idempotencyKey: 'overview-confirm-001',
          confirmedStage: 'adler_overview',
          resultRevisionNo: 1,
        }),
      ],
    });
  });

  it('replays the original overview confirmation for the same action, key and hash, but rejects a different hash', async () => {
    const {
      service: seedService,
      query: seedQuery,
    } = createServiceHarness();
    const seedState = createAwaitingAdlerState();
    seedQuery
      .mockResolvedValueOnce({
        rows: [
          createSessionRow({
            status: 'ready_for_confirmation',
            media_stage: 'awaiting_adler_overview',
            media_state_json: seedState,
            confirmed_stages_json: [],
            revision_no: 0,
          }),
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [
          createSessionRow({
            status: 'collecting',
            media_stage: 'extracting_candidates',
            media_state_json: {
              ...seedState,
              adlerOverviewReview: {
                title: 'Adler Overview',
                approved: true,
                userNotes: '',
              },
              operationReceipts: [
                {
                  action: 'skill.media.overview.confirm',
                  idempotencyKey: 'overview-confirm-001',
                  requestHash: 'a'.repeat(64),
                  baseRevisionNo: 0,
                  resultRevisionNo: 1,
                  confirmedStage: 'adler_overview',
                  recordedAt: '2026-08-21T10:00:00.000Z',
                },
              ],
            },
            confirmed_stages_json: ['adler_overview'],
            revision_no: 1,
          }),
        ],
        rowCount: 1,
      });

    await seedService.confirmOverview({
      authUserId: 'user-1',
      sessionId: '101',
      idempotencyKey: 'overview-confirm-001',
      expectedRevisionNo: 0,
      overview: {
        title: 'Adler Overview',
        approved: true,
        userNotes: '',
      },
    });
    const seedUpdateValues = seedQuery.mock.calls[1]?.[1] ?? [];
    const replayHash = parseMultimodalSessionState(
      JSON.parse(String(seedUpdateValues[3])),
    ).operationReceipts[0]?.requestHash;
    expect(replayHash).toMatch(/^[a-f0-9]{64}$/);

    const { service, query } = createServiceHarness();
    query
      .mockResolvedValueOnce({
        rows: [
          createSessionRow({
            status: 'collecting',
            media_stage: 'building_skills',
            revision_no: 2,
            confirmed_stages_json: ['adler_overview', 'evidence_and_candidates'],
            media_state_json: {
              ...createAwaitingCandidatesState(),
              selectedCandidateIds: ['candidate-framework-1'],
              operationReceipts: [
                {
                  action: 'skill.media.overview.confirm',
                  idempotencyKey: 'overview-confirm-001',
                  requestHash: replayHash as string,
                  baseRevisionNo: 0,
                  resultRevisionNo: 1,
                  confirmedStage: 'adler_overview',
                  recordedAt: '2026-08-21T10:00:00.000Z',
                },
                {
                  action: 'skill.media.candidate.confirm',
                  idempotencyKey: 'candidate-confirm-001',
                  requestHash: '2'.repeat(64),
                  baseRevisionNo: 1,
                  resultRevisionNo: 2,
                  confirmedStage: 'evidence_and_candidates',
                  recordedAt: '2026-08-21T10:05:00.000Z',
                },
              ],
            },
          }),
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [
          createSessionRow({
            status: 'collecting',
            media_stage: 'extracting_candidates',
            revision_no: 1,
            confirmed_stages_json: ['adler_overview'],
            media_state_json: {
              ...createAwaitingAdlerState(),
              adlerOverviewReview: {
                title: 'Old Overview',
                approved: true,
                userNotes: '',
              },
              operationReceipts: [
                {
                  action: 'skill.media.overview.confirm',
                  idempotencyKey: 'overview-confirm-001',
                  requestHash: 'f'.repeat(64),
                  baseRevisionNo: 0,
                  resultRevisionNo: 1,
                  confirmedStage: 'adler_overview',
                  recordedAt: '2026-08-21T10:00:00.000Z',
                },
              ],
            },
          }),
        ],
        rowCount: 1,
      });

    await expect(
      service.confirmOverview({
        authUserId: 'user-1',
        sessionId: '101',
        idempotencyKey: 'overview-confirm-001',
        expectedRevisionNo: 0,
        overview: {
          title: 'Adler Overview',
          approved: true,
          userNotes: '',
        },
      }),
    ).resolves.toEqual({
      sessionId: '101',
      revisionNo: 1,
      mediaStage: 'extracting_candidates',
      confirmedStage: 'adler_overview',
      replayed: true,
    });
    expect(query).toHaveBeenCalledTimes(1);

    await expect(
      service.confirmOverview({
        authUserId: 'user-1',
        sessionId: '101',
        idempotencyKey: 'overview-confirm-001',
        expectedRevisionNo: 1,
        overview: {
          title: 'Adler Overview',
          approved: true,
          userNotes: '',
        },
      }),
    ).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
      statusCode: 409,
    });
  });

  it('confirms selected candidates atomically, records receipt, and allows the empty-skills building_skills intermediate state', async () => {
    const { service, query } = createServiceHarness();
    const baseState = createAwaitingCandidatesState();
    const fusedCandidate = {
      ...baseState.candidatePasses.frameworks[0],
      candidateId: 'fused-topic-1',
      passKey: 'fused' as const,
    };
    const state = {
      ...baseState,
      candidatePasses: {
        ...baseState.candidatePasses,
        fused: [fusedCandidate],
      },
      candidatePassMeta: {
        ...baseState.candidatePassMeta,
        fused: { model: 'fusion-model', promptVersion: 'fusion-prompt-v1' },
      },
      candidateValidations: [
        ...baseState.candidateValidations,
        {
          ...baseState.candidateValidations[0],
          candidate: fusedCandidate,
        },
      ],
    };
    query
      .mockResolvedValueOnce({
        rows: [
          createSessionRow({
            status: 'ready_for_confirmation',
            media_stage: 'awaiting_candidates',
            media_state_json: state,
            confirmed_stages_json: ['adler_overview'],
            revision_no: 1,
          }),
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [
          createSessionRow({
            status: 'collecting',
            media_stage: 'building_skills',
            media_state_json: {
              ...state,
              selectedCandidateIds: ['fused-topic-1'],
              operationReceipts: [
                ...state.operationReceipts,
                {
                  action: 'skill.media.candidate.confirm',
                  idempotencyKey: 'candidate-confirm-001',
                  requestHash: createHash('sha256')
                    .update(
                      stableRequestHashJson({
                        action: 'skill.media.candidate.confirm',
                        sessionId: '101',
                        expectedRevisionNo: 1,
                        selectedCandidateIds: ['fused-topic-1'],
                      }),
                      'utf8',
                    )
                    .digest('hex'),
                  baseRevisionNo: 1,
                  resultRevisionNo: 2,
                  confirmedStage: 'evidence_and_candidates',
                  recordedAt: '2026-08-21T10:00:00.000Z',
                },
              ],
            },
            confirmed_stages_json: ['adler_overview', 'evidence_and_candidates'],
            revision_no: 2,
            updated_at: '2026-08-21T10:00:00.000Z',
          }),
        ],
        rowCount: 1,
      });

    const result = await service.confirmCandidates({
      authUserId: 'user-1',
      sessionId: '101',
      idempotencyKey: 'candidate-confirm-001',
      expectedRevisionNo: 1,
      selectedCandidateIds: ['fused-topic-1'],
    });

    expect(result).toEqual({
      sessionId: '101',
      revisionNo: 2,
      mediaStage: 'building_skills',
      confirmedStage: 'evidence_and_candidates',
      replayed: false,
    });
    const updateValues = query.mock.calls[1]?.[1] ?? [];
    expect(
      parseMultimodalSessionState(JSON.parse(String(updateValues[3]))),
    ).toMatchObject({
      selectedCandidateIds: ['fused-topic-1'],
      candidateSkills: [],
      operationReceipts: [
        expect.objectContaining({
          action: 'skill.media.overview.confirm',
        }),
        expect.objectContaining({
          action: 'skill.media.candidate.confirm',
          idempotencyKey: 'candidate-confirm-001',
          confirmedStage: 'evidence_and_candidates',
        }),
      ],
    });
  });

  it('accepts short candidate IDs with SAFE_ID semantics in direct service calls', async () => {
    const { service, query } = createServiceHarness();
    const baseState = createAwaitingCandidatesState();
    const atomicCandidate = {
      ...baseState.candidatePasses.frameworks[0],
      candidateId: 'a1',
    };
    const fusedCandidate = {
      ...baseState.candidatePasses.frameworks[0],
      candidateId: 'c1',
      passKey: 'fused' as const,
    };
    const state = {
      ...baseState,
      candidatePasses: {
        frameworks: [atomicCandidate],
        principles: [],
        cases: [],
        counterexamples: [],
        terms: [],
        fused: [fusedCandidate],
      },
      candidatePassMeta: {
        ...baseState.candidatePassMeta,
        fused: { model: 'fusion-model', promptVersion: 'fusion-prompt-v1' },
      },
      candidateValidations: [
        {
          ...baseState.candidateValidations[0],
          candidate: atomicCandidate,
        },
        {
          ...baseState.candidateValidations[0],
          candidate: fusedCandidate,
        },
      ],
    };
    query
      .mockResolvedValueOnce({
        rows: [
          createSessionRow({
            status: 'ready_for_confirmation',
            media_stage: 'awaiting_candidates',
            media_state_json: state,
            confirmed_stages_json: ['adler_overview'],
            revision_no: 1,
          }),
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [
          createSessionRow({
            status: 'collecting',
            media_stage: 'building_skills',
            media_state_json: {
              ...state,
              selectedCandidateIds: ['c1'],
              operationReceipts: [
                ...state.operationReceipts,
                {
                  action: 'skill.media.candidate.confirm',
                  idempotencyKey: 'candidate-confirm-001',
                  requestHash: '3'.repeat(64),
                  baseRevisionNo: 1,
                  resultRevisionNo: 2,
                  confirmedStage: 'evidence_and_candidates',
                  recordedAt: '2026-08-21T10:00:00.000Z',
                },
              ],
            },
            confirmed_stages_json: ['adler_overview', 'evidence_and_candidates'],
            revision_no: 2,
            updated_at: '2026-08-21T10:00:00.000Z',
          }),
        ],
        rowCount: 1,
      });

    await expect(
      service.confirmCandidates({
        authUserId: 'user-1',
        sessionId: '101',
        idempotencyKey: 'candidate-confirm-001',
        expectedRevisionNo: 1,
        selectedCandidateIds: ['c1'],
      }),
    ).resolves.toMatchObject({
      sessionId: '101',
      confirmedStage: 'evidence_and_candidates',
      replayed: false,
    });
  });

  it('rejects candidate confirmation when validations are partial', async () => {
    const { service, query } = createServiceHarness();
    query.mockResolvedValueOnce({
      rows: [
        createSessionRow({
          status: 'ready_for_confirmation',
          media_stage: 'awaiting_candidates',
          media_state_json: {
            ...createAwaitingCandidatesState(),
            candidateValidations: [],
          },
          confirmed_stages_json: ['adler_overview'],
          revision_no: 1,
        }),
      ],
      rowCount: 1,
    });

    await expect(
      service.confirmCandidates({
        authUserId: 'user-1',
        sessionId: '101',
        idempotencyKey: 'candidate-partial-001',
        expectedRevisionNo: 1,
        selectedCandidateIds: ['candidate-framework-1'],
      }),
    ).rejects.toMatchObject({
      code: 'MULTIMODAL_SESSION_FAILED',
      statusCode: 500,
    });
  });

  it('rejects candidate confirmation when selected ids fail the quality gate', async () => {
    const { service, query } = createServiceHarness();
    query.mockResolvedValueOnce({
      rows: [
        createSessionRow({
          status: 'ready_for_confirmation',
          media_stage: 'awaiting_candidates',
          media_state_json: {
            ...createAwaitingCandidatesState(),
            candidateValidations: [
              {
                ...createAwaitingCandidatesState().candidateValidations[0],
                overallPassed: false,
                disposition: 'case',
                validation: {
                  ...createAwaitingCandidatesState().candidateValidations[0].validation,
                  v1: {
                    ...createAwaitingCandidatesState().candidateValidations[0]
                      .validation.v1,
                    passed: false,
                  },
                },
              },
            ],
          },
          confirmed_stages_json: ['adler_overview'],
          revision_no: 1,
        }),
      ],
      rowCount: 1,
    });

    await expect(
      service.confirmCandidates({
        authUserId: 'user-1',
        sessionId: '101',
        idempotencyKey: 'candidate-failed-001',
        expectedRevisionNo: 1,
        selectedCandidateIds: ['candidate-framework-1'],
      }),
    ).rejects.toMatchObject({
      code: 'QUALITY_GATE_FAILED',
      statusCode: 422,
    });
  });

  it('rejects candidate confirmation when skills already exist', async () => {
    const { service, query } = createServiceHarness();
    query.mockResolvedValueOnce({
      rows: [
        createSessionRow({
          status: 'ready_for_confirmation',
          media_stage: 'awaiting_candidates',
          media_state_json: {
            ...createAwaitingCandidatesState(),
            candidateSkills: [
              {
                candidateId: 'candidate-framework-1',
                id: 'skill-1',
                dirName: 'skill-1',
                name: 'skill-1',
                description: 'desc',
                skillMd: '# skill',
                ria: {
                  sourceEvidenceIds: ['ev-transcript-1'],
                  mechanism: 'mechanism',
                  sourceExample: 'example',
                  futureApplicability: 'future',
                  execution: {
                    input: 'input',
                    steps: ['step'],
                    output: 'output',
                    completionCriteria: 'done',
                    stopCriteria: 'stop',
                  },
                  boundaries: {
                    counterexamples: ['counter'],
                    failureModes: ['failure'],
                    limits: ['limit'],
                    confusions: ['confusion'],
                  },
                },
                evidenceIds: ['ev-transcript-1', 'ev-audio-1'],
                relations: [],
                manifest: {
                  model: 'ria-model',
                  promptVersion: 'ria-prompt-v1',
                  generatorVersion: 'ria-generator-v1',
                },
              },
            ],
          },
          confirmed_stages_json: ['adler_overview'],
          revision_no: 1,
        }),
      ],
      rowCount: 1,
    });

    await expect(
      service.confirmCandidates({
        authUserId: 'user-1',
        sessionId: '101',
        idempotencyKey: 'candidate-skills-001',
        expectedRevisionNo: 1,
        selectedCandidateIds: ['candidate-framework-1'],
      }),
    ).rejects.toMatchObject({
      code: 'MULTIMODAL_SESSION_FAILED',
      statusCode: 500,
    });
  });

  it('rejects corrupted confirmed stages, wrong stages, revision drift, update CAS misses, and malicious direct inputs', async () => {
    const { service, query } = createServiceHarness();
    query
      .mockResolvedValueOnce({
        rows: [
          createSessionRow({
            status: 'ready_for_confirmation',
            media_stage: 'awaiting_adler_overview',
            media_state_json: createAwaitingAdlerState(),
            confirmed_stages_json: ['evidence_and_candidates'],
            revision_no: 0,
          }),
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [
          createSessionRow({
            status: 'collecting',
            media_stage: 'extracting_candidates',
            media_state_json: {
              ...createAwaitingAdlerState(),
              adlerOverviewReview: {
                title: 'Adler Overview',
                approved: true,
                userNotes: '',
              },
              operationReceipts: [
                {
                  action: 'skill.media.overview.confirm',
                  idempotencyKey: 'other-key',
                  requestHash: '1'.repeat(64),
                  baseRevisionNo: 0,
                  resultRevisionNo: 1,
                  confirmedStage: 'adler_overview',
                  recordedAt: '2026-08-21T10:00:00.000Z',
                },
              ],
            },
            confirmed_stages_json: ['adler_overview'],
            revision_no: 1,
          }),
        ],
        rowCount: 0,
      })
      .mockResolvedValueOnce({
        rows: [
          createSessionRow({
            status: 'collecting',
            media_stage: 'extracting_candidates',
            media_state_json: {
              ...createAwaitingAdlerState(),
              adlerOverviewReview: {
                title: 'Adler Overview',
                approved: true,
                userNotes: '',
              },
              operationReceipts: [
                {
                  action: 'skill.media.overview.confirm',
                  idempotencyKey: 'other-key',
                  requestHash: '1'.repeat(64),
                  baseRevisionNo: 0,
                  resultRevisionNo: 1,
                  confirmedStage: 'adler_overview',
                  recordedAt: '2026-08-21T10:00:00.000Z',
                },
              ],
            },
            confirmed_stages_json: ['adler_overview'],
            revision_no: 1,
          }),
        ],
        rowCount: 1,
      });

    await expect(
      service.confirmOverview({
        authUserId: 'user-1',
        sessionId: '101',
        idempotencyKey: 'overview-confirm-001',
        expectedRevisionNo: 1,
        overview: {
          title: 'Adler Overview',
          approved: true,
          userNotes: '',
        },
      }),
    ).rejects.toMatchObject({
      code: 'MULTIMODAL_SESSION_FAILED',
      statusCode: 500,
    });

    await expect(
      service.confirmOverview({
        authUserId: 'user-1',
        sessionId: '101',
        idempotencyKey: 'overview-confirm-001',
        expectedRevisionNo: 0,
        overview: {
          title: 'Adler Overview',
          approved: true,
          userNotes: '',
        },
      }),
    ).rejects.toMatchObject({
      code: 'SESSION_REVISION_CONFLICT',
      statusCode: 409,
    });

    await expect(
      service.confirmOverview({
        authUserId: 'user-1',
        sessionId: '101',
        idempotencyKey: 'overview-confirm-001',
        expectedRevisionNo: 1,
        overview: {
          title: 'Adler Overview',
          approved: true,
          userNotes: '',
        },
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_MEDIA_STAGE',
      statusCode: 409,
    });

    await expect(
      service.confirmOverview({
        authUserId: 'user-1',
        sessionId: '101',
        idempotencyKey: 'bad',
        expectedRevisionNo: 0,
        overview: {
          title: 'Adler Overview',
          approved: true,
          userNotes: 12 as unknown as string,
        },
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_IDEMPOTENCY_KEY',
      statusCode: 422,
    });
  });

  it('replays overview and candidate receipts after publish without requiring a publish operation receipt', async () => {
    const { service, query } = createServiceHarness();
    const publishedState = {
      ...createAwaitingCandidatesState(),
      selectedCandidateIds: ['candidate-framework-1'],
      operationReceipts: [
        {
          action: 'skill.media.overview.confirm',
          idempotencyKey: 'overview-confirm-001',
          requestHash:
            '7ffe79e973638c6fbbc67a63f3cce1a9611f5158d21e618ff87155d8e0aba2e2',
          baseRevisionNo: 0,
          resultRevisionNo: 1,
          confirmedStage: 'adler_overview',
          recordedAt: '2026-08-21T10:00:00.000Z',
        },
        {
          action: 'skill.media.candidate.confirm',
          idempotencyKey: 'candidate-confirm-001',
          requestHash: createHash('sha256')
            .update(
              stableRequestHashJson({
                action: 'skill.media.candidate.confirm',
                sessionId: '101',
                expectedRevisionNo: 1,
                selectedCandidateIds: ['candidate-framework-1'],
              }),
              'utf8',
            )
            .digest('hex'),
          baseRevisionNo: 1,
          resultRevisionNo: 2,
          confirmedStage: 'evidence_and_candidates',
          recordedAt: '2026-08-21T10:05:00.000Z',
        },
      ],
    };

    query
      .mockResolvedValueOnce({
        rows: [
          createSessionRow({
            status: 'completed',
            media_stage: 'published',
            media_state_json: publishedState,
            confirmed_stages_json: [
              'adler_overview',
              'evidence_and_candidates',
              'publish',
            ],
            revision_no: 3,
          }),
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [
          createSessionRow({
            status: 'completed',
            media_stage: 'published',
            media_state_json: publishedState,
            confirmed_stages_json: [
              'adler_overview',
              'evidence_and_candidates',
              'publish',
            ],
            revision_no: 3,
          }),
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [
          createSessionRow({
            status: 'completed',
            media_stage: 'published',
            media_state_json: publishedState,
            confirmed_stages_json: [
              'evidence_and_candidates',
              'adler_overview',
              'publish',
            ],
            revision_no: 3,
          }),
        ],
        rowCount: 1,
      });

    await expect(
      service.confirmOverview({
        authUserId: 'user-1',
        sessionId: '101',
        idempotencyKey: 'overview-confirm-001',
        expectedRevisionNo: 0,
        overview: {
          title: 'Adler Overview',
          approved: true,
          userNotes: '',
        },
      }),
    ).resolves.toEqual({
      sessionId: '101',
      revisionNo: 1,
      mediaStage: 'extracting_candidates',
      confirmedStage: 'adler_overview',
      replayed: true,
    });

    await expect(
      service.confirmCandidates({
        authUserId: 'user-1',
        sessionId: '101',
        idempotencyKey: 'candidate-confirm-001',
        expectedRevisionNo: 1,
        selectedCandidateIds: ['candidate-framework-1'],
      }),
    ).resolves.toEqual({
      sessionId: '101',
      revisionNo: 2,
      mediaStage: 'building_skills',
      confirmedStage: 'evidence_and_candidates',
      replayed: true,
    });

    await expect(
      service.confirmOverview({
        authUserId: 'user-1',
        sessionId: '101',
        idempotencyKey: 'overview-confirm-001',
        expectedRevisionNo: 0,
        overview: {
          title: 'Adler Overview',
          approved: true,
          userNotes: '',
        },
      }),
    ).rejects.toMatchObject({
      code: 'MULTIMODAL_SESSION_FAILED',
      statusCode: 500,
    });
  });

  describe('upload intent', () => {
    function createUploadConfirmReceipt(overrides: Record<string, unknown> = {}) {
      return {
        action: 'skill.media.upload.confirm',
        idempotencyKey: 'upload-confirm-001',
        requestHash: 'c'.repeat(64),
        baseRevisionNo: 1,
        resultRevisionNo: 2,
        confirmedStage: 'uploading',
        recordedAt: '2026-08-22T10:00:00.000Z',
        ...overrides,
      };
    }

    function createPendingUpload(overrides: Record<string, unknown> = {}) {
      return {
        sourceId: 'source-upload-1',
        mediaKind: 'video',
        fileName: 'lesson.mp4',
        declaredMimeType: 'video/mp4',
        sizeBytes: 1024,
        uploadMode: 'single_put',
        materialStatus: 'uploading',
        verification: null,
        objectKey:
          'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
        idempotencyKey: 'upload-intent-001',
        requestHash: 'a'.repeat(64),
        intentClaimsHash: 'b'.repeat(64),
        intentRevisionNo: 1,
        expiresAt: '2026-08-22T10:05:00.000Z',
        ...overrides,
      };
    }

    it('creates a first upload intent, transitions draft to uploading, and redacts pending upload secrets from detail responses', async () => {
      const queryMock = vi.fn();
      const draftRow = createSessionRow();
      const updatedRow = createSessionRow({
        media_stage: 'uploading',
        revision_no: 1,
        updated_at: '2026-08-22T10:00:00.000Z',
        media_state_json: {
          ...draftRow.media_state_json,
          pendingUpload: createPendingUpload({
            requestHash: 'f'.repeat(64),
            intentClaimsHash: 'e'.repeat(64),
          }),
        },
      });
      queryMock
        .mockResolvedValueOnce({ rows: [draftRow], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [updatedRow], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [updatedRow], rowCount: 1 });

      const objectStorageService = {
        createSessionObjectKey: vi
          .fn()
          .mockReturnValue(
            'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
          ),
        createSignedPutGrant: vi.fn().mockResolvedValue({
          method: 'PUT',
          objectKey:
            'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
          url: 'https://signed.example/upload',
          expiresAt: '2026-08-22T10:05:00.000Z',
          requiredHeaders: {
            'content-type': 'video/mp4',
            'if-none-match': '*',
          },
        }),
      };
      const uploadSecurityService = {
        validateUploadIntent: vi.fn().mockReturnValue({
          normalizedFileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4',
          extension: 'mp4',
          mediaKind: 'video',
        }),
      };
      const service = createMultimodalGuidedCreationService({
        query: queryMock,
        withTransaction: async (callback) => callback({ query: queryMock }),
        now: () => new Date('2026-08-22T10:00:00.000Z'),
        objectStorageService,
        uploadSecurityService,
        uploadTokenSecret: 'x'.repeat(32),
        createSourceId: () => 'source-upload-1',
      });

      const result = await service.createUploadIntent({
        authUserId: 'user-1',
        sessionId: '101',
        idempotencyKey: 'upload-intent-001',
        fileName: 'lesson.mp4',
        declaredMimeType: 'video/mp4',
        sizeBytes: 1024,
      });

      expect(result).toMatchObject({
        sessionId: '101',
        revisionNo: 1,
        mediaStage: 'uploading',
        uploadMode: 'single_put',
        expiresAt: '2026-08-22T10:05:00.000Z',
        replayed: false,
        upload: {
          method: 'PUT',
          url: 'https://signed.example/upload',
          requiredHeaders: {
            'content-type': 'video/mp4',
            'if-none-match': '*',
          },
        },
      });
      expect(result.uploadToken).toMatch(/\./);
      expect(queryMock.mock.calls[0]?.[0]).toContain('for update');
      expect(queryMock.mock.calls[1]?.[0]).toContain('where id = $6');
      expect(queryMock.mock.calls[1]?.[0]).toContain('and user_id = $7');
      expect(queryMock.mock.calls[1]?.[0]).toContain('and creation_mode = $8');
      expect(queryMock.mock.calls[1]?.[0]).toContain('and deleted_at is null');
      expect(queryMock.mock.calls[1]?.[0]).toContain('and revision_no = $9');
      expect(queryMock.mock.calls[1]?.[0]).toContain('and media_stage = $10');

      const persistedState = JSON.parse(queryMock.mock.calls[1]?.[1]?.[2] as string);
      expect(persistedState.pendingUpload.objectKey).toBe(
        'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
      );
      expect(persistedState.pendingUpload.intentClaimsHash).toMatch(
        /^[a-f0-9]{64}$/,
      );

      const detail = await service.getSessionDetail({
        authUserId: 'user-1',
        sessionId: '101',
      });
      expect(detail.mediaState.pendingUpload).toMatchObject({
        sourceId: 'source-upload-1',
        mediaKind: 'video',
        fileName: 'lesson.mp4',
        declaredMimeType: 'video/mp4',
        sizeBytes: 1024,
        uploadMode: 'single_put',
        materialStatus: 'uploading',
        expiresAt: '2026-08-22T10:05:00.000Z',
      });
      expect(detail.mediaState.pendingUpload).not.toHaveProperty('objectKey');
      expect(detail.mediaState.pendingUpload).not.toHaveProperty(
        'intentClaimsHash',
      );
      expect(detail.mediaState.pendingUpload).not.toHaveProperty('requestHash');
    });

    it('creates a multipart upload intent above the single-put threshold and redacts internal multipart secrets from detail responses', async () => {
      const queryMock = vi.fn();
      const draftRow = createSessionRow();
      const updatedRow = createSessionRow({
        media_stage: 'uploading',
        revision_no: 1,
        updated_at: '2026-08-22T10:00:00.000Z',
        media_state_json: {
          ...draftRow.media_state_json,
          pendingUpload: createPendingUpload({
            sizeBytes: 20 * 1024 * 1024,
            uploadMode: 'multipart',
            multipartUploadId: 'multipart-upload-123',
            partSizeBytes: 8 * 1024 * 1024,
            partCount: 3,
          }),
        },
      });
      queryMock
        .mockResolvedValueOnce({ rows: [draftRow], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [updatedRow], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [updatedRow], rowCount: 1 });

      const objectStorageService = {
        createSessionObjectKey: vi
          .fn()
          .mockReturnValue(
            'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
          ),
        createSignedPutGrant: vi.fn(),
        createMultipartUpload: vi.fn().mockResolvedValue({
          multipartUploadId: 'multipart-upload-123',
        }),
        createSignedUploadPartGrant: vi
          .fn()
          .mockImplementation(
            async ({ partNumber }: { partNumber: number }) => ({
              method: 'PUT',
              partNumber,
              url: `https://signed.example/parts/${partNumber}`,
              expiresAt: '2026-08-22T10:05:00.000Z',
              requiredHeaders: {},
            }),
          ),
        abortIncompleteMultipartUpload: vi.fn(),
      };
      const uploadSecurityService = {
        validateUploadIntent: vi.fn().mockReturnValue({
          normalizedFileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4',
          extension: 'mp4',
          mediaKind: 'video',
        }),
      };
      const service = createMultimodalGuidedCreationService({
        query: queryMock,
        withTransaction: async (callback) => callback({ query: queryMock }),
        now: () => new Date('2026-08-22T10:00:00.000Z'),
        objectStorageService,
        uploadSecurityService,
        uploadTokenSecret: 'x'.repeat(32),
        createSourceId: () => 'source-upload-1',
        multimodalUploadMaxBytes: 1024 * 1024 * 1024,
        multimodalSinglePutMaxBytes: 10 * 1024 * 1024,
        multimodalMultipartPartBytes: 8 * 1024 * 1024,
      });

      const intent = await service.createUploadIntent({
        authUserId: 'user-1',
        sessionId: '101',
        idempotencyKey: 'upload-intent-001',
        fileName: 'lesson.mp4',
        declaredMimeType: 'video/mp4',
        sizeBytes: 20 * 1024 * 1024,
      });

      expect(intent).toMatchObject({
        sessionId: '101',
        revisionNo: 1,
        mediaStage: 'uploading',
        uploadMode: 'multipart',
        replayed: false,
        multipart: {
          partSizeBytes: 8 * 1024 * 1024,
          partCount: 3,
          parts: [
            expect.objectContaining({ partNumber: 1 }),
            expect.objectContaining({ partNumber: 2 }),
            expect.objectContaining({ partNumber: 3 }),
          ],
        },
      });
      expect(objectStorageService.createMultipartUpload).toHaveBeenCalledWith({
        objectKey:
          'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
        contentType: 'video/mp4',
      });
      expect(objectStorageService.abortIncompleteMultipartUpload).not.toHaveBeenCalled();

      const detail = await service.getSessionDetail({
        authUserId: 'user-1',
        sessionId: '101',
      });
      expect(detail.mediaState.pendingUpload).toMatchObject({
        uploadMode: 'multipart',
        materialStatus: 'uploading',
        partSizeBytes: 8 * 1024 * 1024,
        partCount: 3,
      });
      expect(detail.mediaState.pendingUpload).not.toHaveProperty('objectKey');
      expect(detail.mediaState.pendingUpload).not.toHaveProperty(
        'multipartUploadId',
      );
      expect(detail.mediaState.pendingUpload).not.toHaveProperty(
        'intentClaimsHash',
      );
    });

    it('replays the same upload intent key/hash but rejects same key with different normalized arguments', async () => {
      const requestHash =
        __testing.buildUploadIntentRequestHash({
          sessionId: '101',
          fileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 1024,
          mediaKind: 'video',
          uploadMode: 'single_put',
        });
      const intentClaimsHash =
        __testing.buildUploadIntentClaimsHash({
          sessionId: '101',
          authUserId: 'user-1',
          sourceId: 'source-upload-1',
          objectKey:
            'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 1024,
          uploadMode: 'single_put',
          intentRevisionNo: 1,
        });
      const queryMock = vi.fn().mockResolvedValue({
        rows: [
          createSessionRow({
            media_stage: 'uploading',
            revision_no: 1,
            media_state_json: {
              ...createSessionRow().media_state_json,
              pendingUpload: createPendingUpload({
                requestHash,
                intentClaimsHash,
              }),
            },
          }),
        ],
        rowCount: 1,
      });
      const objectStorageService = {
        createSessionObjectKey: vi.fn(),
        createSignedPutGrant: vi.fn().mockResolvedValue({
          method: 'PUT',
          objectKey:
            'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
          url: 'https://signed.example/replay',
          expiresAt: '2026-08-22T10:06:00.000Z',
          requiredHeaders: {
            'content-type': 'video/mp4',
            'if-none-match': '*',
          },
        }),
      };
      const uploadSecurityService = {
        validateUploadIntent: vi.fn().mockReturnValue({
          normalizedFileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4',
          extension: 'mp4',
          mediaKind: 'video',
        }),
      };
      const service = createMultimodalGuidedCreationService({
        query: queryMock,
        withTransaction: async (callback) => callback({ query: queryMock }),
        now: () => new Date('2026-08-22T10:01:00.000Z'),
        objectStorageService,
        uploadSecurityService,
        uploadTokenSecret: 'x'.repeat(32),
      });

      const replayed = await service.createUploadIntent({
        authUserId: 'user-1',
        sessionId: '101',
        idempotencyKey: 'upload-intent-001',
        fileName: 'lesson.mp4',
        declaredMimeType: 'video/mp4',
        sizeBytes: 1024,
      });
      expect(replayed).toMatchObject({
        sessionId: '101',
        revisionNo: 1,
        mediaStage: 'uploading',
        replayed: true,
      });
      expect(objectStorageService.createSessionObjectKey).not.toHaveBeenCalled();
      expect(objectStorageService.createSignedPutGrant).toHaveBeenCalledWith({
        objectKey:
          'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
        contentType: 'video/mp4',
      });
      expect(queryMock).toHaveBeenCalledTimes(1);

      await expect(
        service.createUploadIntent({
          authUserId: 'user-1',
          sessionId: '101',
          idempotencyKey: 'upload-intent-001',
          fileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 2048,
        }),
      ).rejects.toMatchObject({
        code: 'IDEMPOTENCY_KEY_REUSED',
        statusCode: 409,
      });
    });

    it('replays multipart intents with the original object key and multipart upload id', async () => {
      const requestHash =
        __testing.buildUploadIntentRequestHash({
          sessionId: '101',
          fileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 20 * 1024 * 1024,
          mediaKind: 'video',
        });
      const intentClaimsHash =
        __testing.buildUploadIntentClaimsHash({
          sessionId: '101',
          authUserId: 'user-1',
          sourceId: 'source-upload-1',
          objectKey:
            'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 20 * 1024 * 1024,
          uploadMode: 'multipart',
          multipartUploadId: 'multipart-upload-123',
          partSizeBytes: 8 * 1024 * 1024,
          partCount: 3,
          intentRevisionNo: 1,
        });
      const queryMock = vi.fn().mockResolvedValue({
        rows: [
          createSessionRow({
            media_stage: 'uploading',
            revision_no: 1,
            media_state_json: {
              ...createSessionRow().media_state_json,
              pendingUpload: createPendingUpload({
                sizeBytes: 20 * 1024 * 1024,
                uploadMode: 'multipart',
                requestHash,
                intentClaimsHash,
                multipartUploadId: 'multipart-upload-123',
                partSizeBytes: 8 * 1024 * 1024,
                partCount: 3,
              }),
            },
          }),
        ],
        rowCount: 1,
      });
      const objectStorageService = {
        createSessionObjectKey: vi.fn(),
        createSignedPutGrant: vi.fn(),
        createMultipartUpload: vi.fn(),
        createSignedUploadPartGrant: vi
          .fn()
          .mockImplementation(
            async ({ partNumber }: { partNumber: number }) => ({
              method: 'PUT',
              partNumber,
              url: `https://signed.example/parts/${partNumber}`,
              expiresAt: '2026-08-22T10:06:00.000Z',
              requiredHeaders: {},
            }),
          ),
        abortIncompleteMultipartUpload: vi.fn(),
      };
      const uploadSecurityService = {
        validateUploadIntent: vi.fn().mockReturnValue({
          normalizedFileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4',
          extension: 'mp4',
          mediaKind: 'video',
        }),
      };
      const service = createMultimodalGuidedCreationService({
        query: queryMock,
        withTransaction: async (callback) => callback({ query: queryMock }),
        now: () => new Date('2026-08-22T10:01:00.000Z'),
        objectStorageService,
        uploadSecurityService,
        uploadTokenSecret: 'x'.repeat(32),
        multimodalUploadMaxBytes: 10 * 1024 * 1024,
        multimodalSinglePutMaxBytes: 64 * 1024 * 1024,
        multimodalMultipartPartBytes: 8 * 1024 * 1024,
      });

      const replayed = await service.createUploadIntent({
        authUserId: 'user-1',
        sessionId: '101',
        idempotencyKey: 'upload-intent-001',
        fileName: 'lesson.mp4',
        declaredMimeType: 'video/mp4',
        sizeBytes: 20 * 1024 * 1024,
      });

      expect(replayed).toMatchObject({
        uploadMode: 'multipart',
        replayed: true,
        multipart: {
          partSizeBytes: 8 * 1024 * 1024,
          partCount: 3,
          parts: [
            expect.objectContaining({ partNumber: 1 }),
            expect.objectContaining({ partNumber: 2 }),
            expect.objectContaining({ partNumber: 3 }),
          ],
        },
      });
      expect(objectStorageService.createSessionObjectKey).not.toHaveBeenCalled();
      expect(objectStorageService.createMultipartUpload).not.toHaveBeenCalled();
      expect(
        objectStorageService.abortIncompleteMultipartUpload,
      ).not.toHaveBeenCalled();
      expect(objectStorageService.createSignedUploadPartGrant).toHaveBeenNthCalledWith(
        1,
        {
          objectKey:
            'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
          multipartUploadId: 'multipart-upload-123',
          partNumber: 1,
        },
      );

      await expect(
        service.createUploadIntent({
          authUserId: 'user-1',
          sessionId: '101',
          idempotencyKey: 'upload-intent-001',
          fileName: 'lesson-2.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 20 * 1024 * 1024,
        }),
      ).rejects.toMatchObject({
        code: 'IDEMPOTENCY_KEY_REUSED',
        statusCode: 409,
      });

      await expect(
        service.createUploadIntent({
          authUserId: 'user-1',
          sessionId: '101',
          idempotencyKey: 'upload-intent-001',
          fileName: ' lesson.mp4 ',
          declaredMimeType: 'video/mp4',
          sizeBytes: 20 * 1024 * 1024,
        }),
      ).rejects.toMatchObject({
        code: 'INVALID_UPLOAD_INTENT',
        statusCode: 422,
      });
    });

    it('rejects second primary source attempts and CAS write conflicts', async () => {
      const queryPrimarySource = vi.fn().mockResolvedValue({
        rows: [
          createSessionRow({
            media_state_json: {
              ...createSessionRow().media_state_json,
              primarySource: {
                sourceId: 'source-1',
                kind: 'video',
                assetRef: {
                  objectKey:
                    'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
                  mimeType: 'video/mp4',
                  sizeBytes: 1024,
                  sha256: 'd'.repeat(64),
                },
              },
            },
          }),
        ],
        rowCount: 1,
      });
      const uploadSecurityService = {
        validateUploadIntent: vi.fn().mockReturnValue({
          normalizedFileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4',
          extension: 'mp4',
          mediaKind: 'video',
        }),
      };
      const objectStorageService = {
        createSessionObjectKey: vi.fn(),
        createSignedPutGrant: vi.fn(),
      };
      const service = createMultimodalGuidedCreationService({
        query: queryPrimarySource,
        withTransaction: async (callback) => callback({ query: queryPrimarySource }),
        now: () => new Date('2026-08-22T10:00:00.000Z'),
        objectStorageService,
        uploadSecurityService,
        uploadTokenSecret: 'x'.repeat(32),
      });

      await expect(
        service.createUploadIntent({
          authUserId: 'user-1',
          sessionId: '101',
          idempotencyKey: 'upload-intent-001',
          fileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 1024,
        }),
      ).rejects.toMatchObject({
        code: 'PRIMARY_SOURCE_ALREADY_EXISTS',
      });

      const draftRow = createSessionRow();
      const casQuery = vi
        .fn()
        .mockResolvedValueOnce({ rows: [draftRow], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const casService = createMultimodalGuidedCreationService({
        query: casQuery,
        withTransaction: async (callback) => callback({ query: casQuery }),
        now: () => new Date('2026-08-22T10:00:00.000Z'),
        objectStorageService: {
          createSessionObjectKey: vi
            .fn()
            .mockReturnValue(
              'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
            ),
          createSignedPutGrant: vi.fn().mockResolvedValue({
            method: 'PUT',
            objectKey:
              'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
            url: 'https://signed.example/upload',
            expiresAt: '2026-08-22T10:05:00.000Z',
            requiredHeaders: {
              'content-type': 'video/mp4',
              'if-none-match': '*',
            },
          }),
        },
        uploadSecurityService,
        uploadTokenSecret: 'x'.repeat(32),
        createSourceId: () => 'source-upload-1',
      });

      await expect(
        casService.createUploadIntent({
          authUserId: 'user-1',
          sessionId: '101',
          idempotencyKey: 'upload-intent-001',
          fileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 1024,
        }),
      ).rejects.toMatchObject({
        code: 'SESSION_REVISION_CONFLICT',
        statusCode: 409,
      });
    });

    it('rejects replay when the stored pending intent is no longer in uploading stage', async () => {
      const intentClaimsHash =
        __testing.buildUploadIntentClaimsHash({
          sessionId: '101',
          authUserId: 'user-1',
          sourceId: 'source-upload-1',
          objectKey:
            'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 1024,
          uploadMode: 'single_put',
          intentRevisionNo: 1,
        });
      const queryMock = vi.fn().mockResolvedValue({
        rows: [
          createSessionRow({
            status: 'cancelled',
            media_stage: 'cancelled',
            revision_no: 1,
            media_state_json: {
              ...createSessionRow().media_state_json,
              pendingUpload: createPendingUpload({
                requestHash:
                  __testing.buildUploadIntentRequestHash({
                    sessionId: '101',
                    fileName: 'lesson.mp4',
                    declaredMimeType: 'video/mp4',
                    sizeBytes: 1024,
                    mediaKind: 'video',
                    uploadMode: 'single_put',
                  }),
                intentClaimsHash,
              }),
            },
          }),
        ],
        rowCount: 1,
      });
      const objectStorageService = {
        createSessionObjectKey: vi.fn(),
        createSignedPutGrant: vi.fn(),
      };
      const service = createMultimodalGuidedCreationService({
        query: queryMock,
        withTransaction: async (callback) => callback({ query: queryMock }),
        now: () => new Date('2026-08-22T10:01:00.000Z'),
        objectStorageService,
        uploadSecurityService: createUploadSecurityService({
          maxUploadBytes: 1024 * 1024 * 1024,
        }),
        uploadTokenSecret: 'x'.repeat(32),
      });

      await expect(
        service.createUploadIntent({
          authUserId: 'user-1',
          sessionId: '101',
          idempotencyKey: 'upload-intent-001',
          fileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 1024,
        }),
      ).rejects.toMatchObject({
        code: 'INVALID_MEDIA_STAGE',
        statusCode: 409,
      });
      expect(objectStorageService.createSignedPutGrant).not.toHaveBeenCalled();
    });

    it('maps verifying pending uploads to public whitelists only', async () => {
      const queryMock = vi.fn()
        .mockResolvedValueOnce({
          rows: [
            createSessionRow({
              media_stage: 'uploading',
              revision_no: 2,
              media_state_json: {
                ...createSessionRow().media_state_json,
                operationReceipts: [
                  createUploadConfirmReceipt({
                    idempotencyKey: 'confirm-upload-123',
                    requestHash: 'c'.repeat(64),
                    recordedAt: '2026-08-22T10:03:00.000Z',
                  }),
                ],
                pendingUpload: createPendingUpload({
                  materialStatus: 'verifying',
                  intentRevisionNo: 1,
                  verification: {
                    jobId: 'job-verify-1',
                    idempotencyKey: 'confirm-upload-123',
                    requestHash: 'c'.repeat(64),
                    observedSizeBytes: 1024,
                    observedContentType: 'video/mp4',
                    confirmedAt: '2026-08-22T10:03:00.000Z',
                  },
                }),
              },
            }),
          ],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [
            createSessionRow({
              media_stage: 'uploading',
              revision_no: 2,
              media_state_json: {
                ...createSessionRow().media_state_json,
                operationReceipts: [
                  createUploadConfirmReceipt({
                    idempotencyKey: 'confirm-upload-456',
                    requestHash: 'd'.repeat(64),
                    recordedAt: '2026-08-22T10:04:00.000Z',
                  }),
                ],
                pendingUpload: createPendingUpload({
                  sizeBytes: 20 * 1024 * 1024,
                  uploadMode: 'multipart',
                  materialStatus: 'verifying',
                  intentRevisionNo: 1,
                  multipartUploadId: 'multipart-upload-123',
                  partSizeBytes: 8 * 1024 * 1024,
                  partCount: 3,
                  verification: {
                    jobId: 'job-verify-2',
                    idempotencyKey: 'confirm-upload-456',
                    requestHash: 'd'.repeat(64),
                    observedSizeBytes: 20 * 1024 * 1024,
                    observedContentType: 'video/mp4',
                    confirmedAt: '2026-08-22T10:04:00.000Z',
                  },
                }),
              },
            }),
          ],
          rowCount: 1,
        });

      const service = createMultimodalGuidedCreationService({
        query: queryMock,
      });

      const singleDetail = await service.getSessionDetail({
        authUserId: 'user-1',
        sessionId: '101',
      });
      expect(singleDetail.mediaState.pendingUpload).toEqual({
        sourceId: 'source-upload-1',
        mediaKind: 'video',
        fileName: 'lesson.mp4',
        declaredMimeType: 'video/mp4',
        sizeBytes: 1024,
        uploadMode: 'single_put',
        materialStatus: 'verifying',
        verification: {
          jobId: 'job-verify-1',
          observedSizeBytes: 1024,
          observedContentType: 'video/mp4',
          confirmedAt: '2026-08-22T10:03:00.000Z',
        },
      });
      expect(Object.keys(singleDetail.mediaState.pendingUpload ?? {})).toEqual([
        'sourceId',
        'mediaKind',
        'fileName',
        'declaredMimeType',
        'sizeBytes',
        'uploadMode',
        'materialStatus',
        'verification',
      ]);
      const singleSerialized = JSON.parse(
        JSON.stringify(singleDetail.mediaState.pendingUpload),
      );
      expect(singleSerialized).not.toHaveProperty('objectKey');
      expect(singleSerialized).not.toHaveProperty('expiresAt');
      expect(singleSerialized).not.toHaveProperty('requestHash');
      expect(singleSerialized).not.toHaveProperty('intentClaimsHash');
      expect(singleSerialized.verification).not.toHaveProperty('idempotencyKey');
      expect(singleSerialized.verification).not.toHaveProperty('requestHash');

      const multipartDetail = await service.getSessionDetail({
        authUserId: 'user-1',
        sessionId: '101',
      });
      expect(multipartDetail.mediaState.pendingUpload).toEqual({
        sourceId: 'source-upload-1',
        mediaKind: 'video',
        fileName: 'lesson.mp4',
        declaredMimeType: 'video/mp4',
        sizeBytes: 20 * 1024 * 1024,
        uploadMode: 'multipart',
        materialStatus: 'verifying',
        partSizeBytes: 8 * 1024 * 1024,
        partCount: 3,
        verification: {
          jobId: 'job-verify-2',
          observedSizeBytes: 20 * 1024 * 1024,
          observedContentType: 'video/mp4',
          confirmedAt: '2026-08-22T10:04:00.000Z',
        },
      });
      expect(Object.keys(multipartDetail.mediaState.pendingUpload ?? {})).toEqual([
        'sourceId',
        'mediaKind',
        'fileName',
        'declaredMimeType',
        'sizeBytes',
        'uploadMode',
        'materialStatus',
        'partSizeBytes',
        'partCount',
        'verification',
      ]);
      const multipartSerialized = JSON.parse(
        JSON.stringify(multipartDetail.mediaState.pendingUpload),
      );
      expect(multipartSerialized).not.toHaveProperty('objectKey');
      expect(multipartSerialized).not.toHaveProperty('expiresAt');
      expect(multipartSerialized).not.toHaveProperty('multipartUploadId');
      expect(multipartSerialized).not.toHaveProperty('requestHash');
      expect(multipartSerialized).not.toHaveProperty('intentClaimsHash');
      expect(multipartSerialized.verification).not.toHaveProperty('idempotencyKey');
      expect(multipartSerialized.verification).not.toHaveProperty('requestHash');
    });

    it('rejects replay when pending upload is already verifying without side effects', async () => {
      const requestHash = __testing.buildUploadIntentRequestHash({
        sessionId: '101',
        fileName: 'lesson.mp4',
        declaredMimeType: 'video/mp4',
        sizeBytes: 1024,
        mediaKind: 'video',
        uploadMode: 'single_put',
      });
      const queryMock = vi.fn().mockResolvedValue({
        rows: [
          createSessionRow({
            media_stage: 'uploading',
            revision_no: 1,
            media_state_json: {
              ...createSessionRow().media_state_json,
              operationReceipts: [
                {
                  action: 'skill.media.upload.confirm',
                  idempotencyKey: 'confirm-upload-123',
                  requestHash: 'c'.repeat(64),
                  baseRevisionNo: 1,
                  resultRevisionNo: 2,
                  confirmedStage: 'uploading',
                  recordedAt: '2026-08-22T10:03:00.000Z',
                },
              ],
              pendingUpload: createPendingUpload({
                materialStatus: 'verifying',
                requestHash,
                verification: {
                  jobId: 'job-verify-1',
                  idempotencyKey: 'confirm-upload-123',
                  requestHash: 'c'.repeat(64),
                  observedSizeBytes: 1024,
                  observedContentType: 'video/mp4',
                  confirmedAt: '2026-08-22T10:03:00.000Z',
                },
              }),
            },
          }),
        ],
        rowCount: 1,
      });
      const objectStorageService = {
        createSessionObjectKey: vi.fn(),
        createSignedPutGrant: vi.fn(),
        createMultipartUpload: vi.fn(),
        createSignedUploadPartGrant: vi.fn(),
        abortIncompleteMultipartUpload: vi.fn(),
      };
      const service = createMultimodalGuidedCreationService({
        query: queryMock,
        withTransaction: async (callback) => callback({ query: queryMock }),
        now: () => new Date('2026-08-22T10:01:00.000Z'),
        objectStorageService,
        uploadSecurityService: createUploadSecurityService({
          maxUploadBytes: 1024 * 1024 * 1024,
        }),
        uploadTokenSecret: 'x'.repeat(32),
      });

      await expect(
        service.createUploadIntent({
          authUserId: 'user-1',
          sessionId: '101',
          idempotencyKey: 'upload-intent-001',
          fileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 1024,
        }),
      ).rejects.toMatchObject({
        code: 'UPLOAD_ALREADY_CONFIRMED',
        statusCode: 409,
      });
      expect(objectStorageService.createSignedPutGrant).not.toHaveBeenCalled();
      expect(objectStorageService.createSessionObjectKey).not.toHaveBeenCalled();
      expect(objectStorageService.createMultipartUpload).not.toHaveBeenCalled();
      expect(objectStorageService.abortIncompleteMultipartUpload).not.toHaveBeenCalled();
      expect(queryMock).toHaveBeenCalledTimes(1);
    });

    it('rejects replay when persisted intentClaimsHash does not match the stored binding', async () => {
      const queryMock = vi.fn().mockResolvedValue({
        rows: [
          createSessionRow({
            media_stage: 'uploading',
            revision_no: 1,
            media_state_json: {
              ...createSessionRow().media_state_json,
              pendingUpload: createPendingUpload({
                requestHash:
                  __testing.buildUploadIntentRequestHash({
                    sessionId: '101',
                    fileName: 'lesson.mp4',
                    declaredMimeType: 'video/mp4',
                    sizeBytes: 1024,
                    mediaKind: 'video',
                    uploadMode: 'single_put',
                  }),
                intentClaimsHash: 'f'.repeat(64),
              }),
            },
          }),
        ],
        rowCount: 1,
      });
      const objectStorageService = {
        createSessionObjectKey: vi.fn(),
        createSignedPutGrant: vi.fn(),
      };
      const service = createMultimodalGuidedCreationService({
        query: queryMock,
        withTransaction: async (callback) => callback({ query: queryMock }),
        now: () => new Date('2026-08-22T10:01:00.000Z'),
        objectStorageService,
        uploadSecurityService: createUploadSecurityService({
          maxUploadBytes: 1024 * 1024 * 1024,
        }),
        uploadTokenSecret: 'x'.repeat(32),
      });

      await expect(
        service.createUploadIntent({
          authUserId: 'user-1',
          sessionId: '101',
          idempotencyKey: 'upload-intent-001',
          fileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 1024,
        }),
      ).rejects.toMatchObject({
        code: 'MULTIMODAL_SESSION_FAILED',
        statusCode: 500,
      });
      expect(objectStorageService.createSignedPutGrant).not.toHaveBeenCalled();
    });

    it('uses the real upload-security validator for accepted audio and mapped rejection paths', async () => {
      const makeService = () =>
        createMultimodalGuidedCreationService({
          query: vi.fn().mockResolvedValue({
            rows: [createSessionRow()],
            rowCount: 1,
          }),
          withTransaction: async (callback) =>
            callback({
              query: vi
                .fn()
                .mockResolvedValueOnce({
                  rows: [createSessionRow()],
                  rowCount: 1,
                })
                .mockResolvedValueOnce({
                  rows: [
                    createSessionRow({
                      media_stage: 'uploading',
                      revision_no: 1,
                      media_state_json: {
                        ...createSessionRow().media_state_json,
                        pendingUpload: createPendingUpload(),
                      },
                    }),
                  ],
                  rowCount: 1,
                }),
            }),
          now: () => new Date('2026-08-22T10:00:00.000Z'),
          objectStorageService: {
            createSessionObjectKey: vi
              .fn()
              .mockReturnValue(
                'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
              ),
            createSignedPutGrant: vi.fn().mockResolvedValue({
              method: 'PUT',
              objectKey:
                'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
              url: 'https://signed.example/upload',
              expiresAt: '2026-08-22T10:05:00.000Z',
              requiredHeaders: {
                'content-type': 'audio/mpeg',
                'if-none-match': '*',
              },
            }),
            createMultipartUpload: vi.fn().mockResolvedValue({
              multipartUploadId: 'multipart-upload-123',
            }),
            createSignedUploadPartGrant: vi
              .fn()
              .mockImplementation(
                async ({ partNumber }: { partNumber: number }) => ({
                  method: 'PUT',
                  partNumber,
                  url: `https://signed.example/parts/${partNumber}`,
                  expiresAt: '2026-08-22T10:05:00.000Z',
                  requiredHeaders: {},
                }),
              ),
            abortIncompleteMultipartUpload: vi.fn().mockResolvedValue(undefined),
          },
          uploadSecurityService: createUploadSecurityService({
            maxUploadBytes: 1024 * 1024 * 1024,
          }),
          uploadTokenSecret: 'x'.repeat(32),
          createSourceId: () => 'source-upload-1',
          multimodalUploadMaxBytes: 1024 * 1024 * 1024,
          multimodalSinglePutMaxBytes: 10 * 1024 * 1024,
        });

      for (const media of [
        { fileName: 'lesson.mp3', declaredMimeType: 'audio/mpeg' },
        { fileName: 'lesson.m4a', declaredMimeType: 'audio/mp4' },
        { fileName: 'lesson.wav', declaredMimeType: 'audio/wav' },
      ]) {
        await expect(
          makeService().createUploadIntent({
            authUserId: 'user-1',
            sessionId: '101',
            idempotencyKey: `upload-${media.fileName.replace('.', '-')}-001`,
            fileName: media.fileName,
            declaredMimeType: media.declaredMimeType,
            sizeBytes: 1024,
          }),
        ).resolves.toMatchObject({
          mediaStage: 'uploading',
          replayed: false,
        });
      }

      await expect(
        makeService().createUploadIntent({
          authUserId: 'user-1',
          sessionId: '101',
          idempotencyKey: 'upload-single-boundary-001',
          fileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 10 * 1024 * 1024,
        }),
      ).resolves.toMatchObject({
        uploadMode: 'single_put',
      });

      await expect(
        makeService().createUploadIntent({
          authUserId: 'user-1',
          sessionId: '101',
          idempotencyKey: 'upload-bad-ext-001',
          fileName: 'lesson.exe.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 1024,
        }),
      ).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE', statusCode: 415 });

      await expect(
        makeService().createUploadIntent({
          authUserId: 'user-1',
          sessionId: '101',
          idempotencyKey: 'upload-too-large-001',
          fileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 2 * 1024 * 1024 * 1024,
        }),
      ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE', statusCode: 413 });

      await expect(
        makeService().createUploadIntent({
          authUserId: 'user-1',
          sessionId: '101',
          idempotencyKey: 'upload-multipart-001',
          fileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 32 * 1024 * 1024,
        }),
      ).resolves.toMatchObject({
        uploadMode: 'multipart',
      });

      await expect(
        makeService().createUploadIntent({
          authUserId: 'user-1',
          sessionId: '101',
          idempotencyKey: 'upload-audio-multipart-001',
          fileName: 'lesson.mp3',
          declaredMimeType: 'audio/mpeg',
          sizeBytes: 32 * 1024 * 1024,
        }),
      ).resolves.toMatchObject({
        uploadMode: 'multipart',
      });
    });

    it('rejects multipart plans that would exceed the 10000-part ceiling', async () => {
      const queryMock = vi.fn().mockResolvedValue({
        rows: [createSessionRow()],
        rowCount: 1,
      });
      const uploadSecurityService = {
        validateUploadIntent: vi.fn().mockReturnValue({
          normalizedFileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4',
          extension: 'mp4',
          mediaKind: 'video',
        }),
      };
      const service = createMultimodalGuidedCreationService({
        query: queryMock,
        withTransaction: async (callback) => callback({ query: queryMock }),
        now: () => new Date('2026-08-22T10:00:00.000Z'),
        objectStorageService: {
          createSessionObjectKey: vi.fn(),
          createSignedPutGrant: vi.fn(),
          createMultipartUpload: vi.fn(),
          createSignedUploadPartGrant: vi.fn(),
          abortIncompleteMultipartUpload: vi.fn(),
        },
        uploadSecurityService,
        uploadTokenSecret: 'x'.repeat(32),
        multimodalUploadMaxBytes: 60 * 1024 * 1024 * 1024,
        multimodalSinglePutMaxBytes: 10 * 1024 * 1024,
        multimodalMultipartPartBytes: 5 * 1024 * 1024,
      });

      await expect(
        service.createUploadIntent({
          authUserId: 'user-1',
          sessionId: '101',
          idempotencyKey: 'upload-too-many-parts-001',
          fileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 50_001 * 1024 * 1024,
        }),
      ).rejects.toMatchObject({
        code: 'MULTIMODAL_UPLOAD_UNAVAILABLE',
        statusCode: 503,
      });
    });

    it('aborts incomplete multipart uploads when signing or CAS persistence fails', async () => {
      const draftRow = createSessionRow();
      const uploadSecurityService = {
        validateUploadIntent: vi.fn().mockReturnValue({
          normalizedFileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4',
          extension: 'mp4',
          mediaKind: 'video',
        }),
      };

      const signingFailureQuery = vi.fn().mockResolvedValue({
        rows: [draftRow],
        rowCount: 1,
      });
      const signingFailureObjectStorage = {
        createSessionObjectKey: vi
          .fn()
          .mockReturnValue(
            'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
          ),
        createSignedPutGrant: vi.fn(),
        createMultipartUpload: vi.fn().mockResolvedValue({
          multipartUploadId: 'multipart-upload-123',
        }),
        createSignedUploadPartGrant: vi
          .fn()
          .mockResolvedValueOnce({
            method: 'PUT',
            partNumber: 1,
            url: 'https://signed.example/parts/1',
            expiresAt: '2026-08-22T10:05:00.000Z',
            requiredHeaders: {},
          })
          .mockRejectedValueOnce(new Error('sign failed')),
        abortIncompleteMultipartUpload: vi.fn().mockResolvedValue(undefined),
      };
      const signingFailureService = createMultimodalGuidedCreationService({
        query: signingFailureQuery,
        withTransaction: async (callback) =>
          callback({ query: signingFailureQuery }),
        now: () => new Date('2026-08-22T10:00:00.000Z'),
        objectStorageService: signingFailureObjectStorage,
        uploadSecurityService,
        uploadTokenSecret: 'x'.repeat(32),
        createSourceId: () => 'source-upload-1',
        multimodalUploadMaxBytes: 1024 * 1024 * 1024,
        multimodalSinglePutMaxBytes: 10 * 1024 * 1024,
        multimodalMultipartPartBytes: 8 * 1024 * 1024,
      });

      await expect(
        signingFailureService.createUploadIntent({
          authUserId: 'user-1',
          sessionId: '101',
          idempotencyKey: 'upload-intent-001',
          fileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 20 * 1024 * 1024,
        }),
      ).rejects.toBeInstanceOf(MultimodalGuidedCreationServiceError);
      expect(
        signingFailureObjectStorage.abortIncompleteMultipartUpload,
      ).toHaveBeenCalledWith({
        objectKey:
          'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
        multipartUploadId: 'multipart-upload-123',
      });

      const casFailureQuery = vi
        .fn()
        .mockResolvedValueOnce({ rows: [draftRow], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const casFailureObjectStorage = {
        createSessionObjectKey: vi
          .fn()
          .mockReturnValue(
            'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
          ),
        createSignedPutGrant: vi.fn(),
        createMultipartUpload: vi.fn().mockResolvedValue({
          multipartUploadId: 'multipart-upload-123',
        }),
        createSignedUploadPartGrant: vi
          .fn()
          .mockImplementation(
            async ({ partNumber }: { partNumber: number }) => ({
              method: 'PUT',
              partNumber,
              url: `https://signed.example/parts/${partNumber}`,
              expiresAt: '2026-08-22T10:05:00.000Z',
              requiredHeaders: {},
            }),
          ),
        abortIncompleteMultipartUpload: vi.fn().mockResolvedValue(undefined),
      };
      const casFailureService = createMultimodalGuidedCreationService({
        query: casFailureQuery,
        withTransaction: async (callback) =>
          callback({ query: casFailureQuery }),
        now: () => new Date('2026-08-22T10:00:00.000Z'),
        objectStorageService: casFailureObjectStorage,
        uploadSecurityService,
        uploadTokenSecret: 'x'.repeat(32),
        createSourceId: () => 'source-upload-1',
        multimodalUploadMaxBytes: 1024 * 1024 * 1024,
        multimodalSinglePutMaxBytes: 10 * 1024 * 1024,
        multimodalMultipartPartBytes: 8 * 1024 * 1024,
      });

      await expect(
        casFailureService.createUploadIntent({
          authUserId: 'user-1',
          sessionId: '101',
          idempotencyKey: 'upload-intent-001',
          fileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 20 * 1024 * 1024,
        }),
      ).rejects.toMatchObject({
        code: 'SESSION_REVISION_CONFLICT',
        statusCode: 409,
      });
      expect(
        casFailureObjectStorage.abortIncompleteMultipartUpload,
      ).toHaveBeenCalledWith({
        objectKey:
          'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
        multipartUploadId: 'multipart-upload-123',
      });
    });

    it('aborts a newly created multipart upload when the transaction wrapper fails after the callback resolves, but not on success', async () => {
      const draftRow = createSessionRow();
      const uploadSecurityService = {
        validateUploadIntent: vi.fn().mockReturnValue({
          normalizedFileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4',
          extension: 'mp4',
          mediaKind: 'video',
        }),
      };
      const objectKey =
        'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4';

      const commitFailureQuery = vi
        .fn()
        .mockResolvedValueOnce({ rows: [draftRow], rowCount: 1 })
        .mockResolvedValueOnce({
          rows: [
            createSessionRow({
              media_stage: 'uploading',
              revision_no: 1,
              media_state_json: {
                ...createSessionRow().media_state_json,
                pendingUpload: createPendingUpload({
                  sizeBytes: 20 * 1024 * 1024,
                  uploadMode: 'multipart',
                  requestHash: __testing.buildUploadIntentRequestHash({
                    sessionId: '101',
                    fileName: 'lesson.mp4',
                    declaredMimeType: 'video/mp4',
                    sizeBytes: 20 * 1024 * 1024,
                    mediaKind: 'video',
                  }),
                  intentClaimsHash: '0'.repeat(64),
                  multipartUploadId: 'multipart-upload-123',
                  partSizeBytes: 8 * 1024 * 1024,
                  partCount: 3,
                }),
              },
            }),
          ],
          rowCount: 1,
        });
      const commitFailureObjectStorage = {
        createSessionObjectKey: vi.fn().mockReturnValue(objectKey),
        createSignedPutGrant: vi.fn(),
        createMultipartUpload: vi.fn().mockResolvedValue({
          multipartUploadId: 'multipart-upload-123',
        }),
        createSignedUploadPartGrant: vi
          .fn()
          .mockImplementation(
            async ({ partNumber }: { partNumber: number }) => ({
              method: 'PUT',
              partNumber,
              url: `https://signed.example/parts/${partNumber}`,
              expiresAt: '2026-08-22T10:05:00.000Z',
              requiredHeaders: {},
            }),
          ),
        abortIncompleteMultipartUpload: vi.fn().mockResolvedValue(undefined),
      };
      const commitFailureService = createMultimodalGuidedCreationService({
        query: commitFailureQuery,
        withTransaction: async (callback) => {
          await callback({ query: commitFailureQuery });
          throw new Error('commit secret failure');
        },
        now: () => new Date('2026-08-22T10:00:00.000Z'),
        objectStorageService: commitFailureObjectStorage,
        uploadSecurityService,
        uploadTokenSecret: 'x'.repeat(32),
        createSourceId: () => 'source-upload-1',
        multimodalUploadMaxBytes: 1024 * 1024 * 1024,
        multimodalSinglePutMaxBytes: 10 * 1024 * 1024,
        multimodalMultipartPartBytes: 8 * 1024 * 1024,
      });

      await expect(
        commitFailureService.createUploadIntent({
          authUserId: 'user-1',
          sessionId: '101',
          idempotencyKey: 'upload-intent-001',
          fileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 20 * 1024 * 1024,
        }),
      ).rejects.toMatchObject({
        code: 'MULTIMODAL_UPLOAD_UNAVAILABLE',
        statusCode: 503,
      });
      expect(
        commitFailureObjectStorage.abortIncompleteMultipartUpload,
      ).toHaveBeenCalledTimes(1);
      expect(
        commitFailureObjectStorage.abortIncompleteMultipartUpload,
      ).toHaveBeenCalledWith({
        objectKey,
        multipartUploadId: 'multipart-upload-123',
      });

      const successQuery = vi
        .fn()
        .mockResolvedValueOnce({ rows: [draftRow], rowCount: 1 })
        .mockResolvedValueOnce({
          rows: [
            createSessionRow({
              media_stage: 'uploading',
              revision_no: 1,
              media_state_json: {
                ...createSessionRow().media_state_json,
                pendingUpload: createPendingUpload({
                  sizeBytes: 20 * 1024 * 1024,
                  uploadMode: 'multipart',
                  requestHash: __testing.buildUploadIntentRequestHash({
                    sessionId: '101',
                    fileName: 'lesson.mp4',
                    declaredMimeType: 'video/mp4',
                    sizeBytes: 20 * 1024 * 1024,
                    mediaKind: 'video',
                  }),
                  intentClaimsHash: '0'.repeat(64),
                  multipartUploadId: 'multipart-upload-123',
                  partSizeBytes: 8 * 1024 * 1024,
                  partCount: 3,
                }),
              },
            }),
          ],
          rowCount: 1,
        });
      const successObjectStorage = {
        createSessionObjectKey: vi.fn().mockReturnValue(objectKey),
        createSignedPutGrant: vi.fn(),
        createMultipartUpload: vi.fn().mockResolvedValue({
          multipartUploadId: 'multipart-upload-123',
        }),
        createSignedUploadPartGrant: vi
          .fn()
          .mockImplementation(
            async ({ partNumber }: { partNumber: number }) => ({
              method: 'PUT',
              partNumber,
              url: `https://signed.example/parts/${partNumber}`,
              expiresAt: '2026-08-22T10:05:00.000Z',
              requiredHeaders: {},
            }),
          ),
        abortIncompleteMultipartUpload: vi.fn().mockResolvedValue(undefined),
      };
      const successService = createMultimodalGuidedCreationService({
        query: successQuery,
        withTransaction: async (callback) => callback({ query: successQuery }),
        now: () => new Date('2026-08-22T10:00:00.000Z'),
        objectStorageService: successObjectStorage,
        uploadSecurityService,
        uploadTokenSecret: 'x'.repeat(32),
        createSourceId: () => 'source-upload-1',
        multimodalUploadMaxBytes: 1024 * 1024 * 1024,
        multimodalSinglePutMaxBytes: 10 * 1024 * 1024,
        multimodalMultipartPartBytes: 8 * 1024 * 1024,
      });

      await expect(
        successService.createUploadIntent({
          authUserId: 'user-1',
          sessionId: '101',
          idempotencyKey: 'upload-intent-001',
          fileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 20 * 1024 * 1024,
        }),
      ).resolves.toMatchObject({
        uploadMode: 'multipart',
        replayed: false,
      });
      expect(
        successObjectStorage.abortIncompleteMultipartUpload,
      ).not.toHaveBeenCalled();
    });

    it('rejects upload intent for other users without leaking the session', async () => {
      const queryMock = vi.fn().mockResolvedValue({
        rows: [],
        rowCount: 0,
      });
      const service = createMultimodalGuidedCreationService({
        query: queryMock,
        withTransaction: async (callback) => callback({ query: queryMock }),
        now: () => new Date('2026-08-22T10:00:00.000Z'),
        objectStorageService: {
          createSessionObjectKey: vi.fn(),
          createSignedPutGrant: vi.fn(),
        },
        uploadSecurityService: createUploadSecurityService({
          maxUploadBytes: 1024 * 1024 * 1024,
        }),
        uploadTokenSecret: 'x'.repeat(32),
      });

      await expect(
        service.createUploadIntent({
          authUserId: 'user-2',
          sessionId: '101',
          idempotencyKey: 'upload-intent-001',
          fileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 1024,
        }),
      ).rejects.toMatchObject({
        code: 'GUIDED_SESSION_NOT_FOUND',
        statusCode: 404,
      });
    });

    it('rejects non-string upload identity fields with a stable INVALID_UPLOAD_INTENT error', async () => {
      const service = createMultimodalGuidedCreationService({
        query: vi.fn(),
        withTransaction: async (callback) =>
          callback({
            query: vi.fn(),
          }),
        now: () => new Date('2026-08-22T10:00:00.000Z'),
        objectStorageService: {
          createSessionObjectKey: vi.fn(),
          createSignedPutGrant: vi.fn(),
          createMultipartUpload: vi.fn(),
          createSignedUploadPartGrant: vi.fn(),
          abortIncompleteMultipartUpload: vi.fn(),
        },
        uploadSecurityService: {
          validateUploadIntent: vi.fn(),
        },
        uploadTokenSecret: 'x'.repeat(32),
      });

      await expect(
        service.createUploadIntent({
          authUserId: 'user-1',
          sessionId: '101',
          idempotencyKey: 'upload-intent-001',
          fileName: 123 as unknown as string,
          declaredMimeType: 'video/mp4',
          sizeBytes: 1024,
        }),
      ).rejects.toMatchObject({
        code: 'INVALID_UPLOAD_INTENT',
        statusCode: 422,
      });

      await expect(
        service.createUploadIntent({
          authUserId: 'user-1',
          sessionId: '101',
          idempotencyKey: 'upload-intent-001',
          fileName: 'lesson.mp4',
          declaredMimeType: 123 as unknown as string,
          sizeBytes: 1024,
        }),
      ).rejects.toMatchObject({
        code: 'INVALID_UPLOAD_INTENT',
        statusCode: 422,
      });
    });

    it('issues opaque upload tokens that expire and fail binding checks when tampered', () => {
      const token = __testing.issueUploadIntentToken({
        secret: 'x'.repeat(32),
        binding: {
          sessionId: '101',
          authUserId: 'user-1',
          sourceId: 'source-upload-1',
          objectKey:
            'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 1024,
          uploadMode: 'single_put',
          intentRevisionNo: 1,
        },
        expiresAt: '2026-08-22T10:05:00.000Z',
      });

      expect(
        __testing.verifyUploadIntentToken({
          token,
          secret: 'x'.repeat(32),
          binding: {
            sessionId: '101',
            authUserId: 'user-1',
            sourceId: 'source-upload-1',
            objectKey:
              'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
            declaredMimeType: 'video/mp4',
            sizeBytes: 1024,
            uploadMode: 'single_put',
            intentRevisionNo: 1,
          },
          now: () => new Date('2026-08-22T10:01:00.000Z'),
        }),
      ).toBe(true);

      expect(
        __testing.verifyUploadIntentToken({
          token,
          secret: 'x'.repeat(32),
          binding: {
            sessionId: '101',
            authUserId: 'user-1',
            sourceId: 'source-upload-1',
            objectKey:
              'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
            declaredMimeType: 'video/mp4',
            sizeBytes: 2048,
            uploadMode: 'single_put',
            intentRevisionNo: 1,
          },
          now: () => new Date('2026-08-22T10:01:00.000Z'),
        }),
      ).toBe(false);

      expect(
        __testing.verifyUploadIntentToken({
          token,
          secret: 'x'.repeat(32),
          binding: {
            sessionId: '101',
            authUserId: 'user-1',
            sourceId: 'source-upload-1',
            objectKey:
              'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
            declaredMimeType: 'video/mp4',
            sizeBytes: 1024,
            uploadMode: 'single_put',
            intentRevisionNo: 1,
          },
          now: () => new Date('2026-08-22T10:05:00.000Z'),
        }),
      ).toBe(false);

      const [encodedPayload, encodedSignature] = token.split('.');
      const tamperedPayload = `${encodedPayload?.slice(0, -1)}A.${encodedSignature}`;
      const tamperedSignature = `${encodedPayload}.${encodedSignature?.slice(0, -1)}A`;

      expect(
        __testing.verifyUploadIntentToken({
          token: tamperedPayload,
          secret: 'x'.repeat(32),
          binding: {
            sessionId: '101',
            authUserId: 'user-1',
            sourceId: 'source-upload-1',
            objectKey:
              'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
            declaredMimeType: 'video/mp4',
            sizeBytes: 1024,
            uploadMode: 'single_put',
            intentRevisionNo: 1,
          },
          now: () => new Date('2026-08-22T10:01:00.000Z'),
        }),
      ).toBe(false);
      expect(
        __testing.verifyUploadIntentToken({
          token: tamperedSignature,
          secret: 'x'.repeat(32),
          binding: {
            sessionId: '101',
            authUserId: 'user-1',
            sourceId: 'source-upload-1',
            objectKey:
              'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
            declaredMimeType: 'video/mp4',
            sizeBytes: 1024,
            uploadMode: 'single_put',
            intentRevisionNo: 1,
          },
          now: () => new Date('2026-08-22T10:01:00.000Z'),
        }),
      ).toBe(false);

      const multipartToken = __testing.issueUploadIntentToken({
        secret: 'x'.repeat(32),
        binding: {
          sessionId: '101',
          authUserId: 'user-1',
          sourceId: 'source-upload-1',
          objectKey:
            'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 20 * 1024 * 1024,
          uploadMode: 'multipart',
          multipartUploadId: 'multipart-upload-123',
          partSizeBytes: 8 * 1024 * 1024,
          partCount: 3,
          intentRevisionNo: 1,
        },
        expiresAt: '2026-08-22T10:05:00.000Z',
      });
      expect(
        __testing.verifyUploadIntentToken({
          token: multipartToken,
          secret: 'x'.repeat(32),
          binding: {
            sessionId: '101',
            authUserId: 'user-1',
            sourceId: 'source-upload-1',
            objectKey:
              'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
            declaredMimeType: 'video/mp4',
            sizeBytes: 20 * 1024 * 1024,
            uploadMode: 'single_put',
            intentRevisionNo: 1,
          },
          now: () => new Date('2026-08-22T10:01:00.000Z'),
        }),
      ).toBe(false);
      expect(
        __testing.verifyUploadIntentToken({
          token: multipartToken,
          secret: 'x'.repeat(32),
          binding: {
            sessionId: '101',
            authUserId: 'user-1',
            sourceId: 'source-upload-1',
            objectKey:
              'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
            declaredMimeType: 'video/mp4',
            sizeBytes: 20 * 1024 * 1024,
            uploadMode: 'multipart',
            multipartUploadId: 'multipart-upload-456',
            partSizeBytes: 8 * 1024 * 1024,
            partCount: 3,
            intentRevisionNo: 1,
          },
          now: () => new Date('2026-08-22T10:01:00.000Z'),
        }),
      ).toBe(false);
    });

    it('forces a server-managed URL import to single-put above the client threshold', async () => {
      const queryMock = vi.fn();
      const draftRow = createSessionRow();
      const sizeBytes = 20 * 1024 * 1024;
      const updatedRow = createSessionRow({
        media_stage: 'uploading',
        revision_no: 1,
        media_state_json: {
          ...draftRow.media_state_json,
          pendingUpload: createPendingUpload({
            sizeBytes,
            uploadMode: 'single_put',
          }),
        },
      });
      queryMock
        .mockResolvedValueOnce({ rows: [draftRow], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [updatedRow], rowCount: 1 });
      const objectStorageService = {
        createSessionObjectKey: vi
          .fn()
          .mockReturnValue(
            'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
          ),
        createSignedPutGrant: vi.fn().mockResolvedValue({
          method: 'PUT',
          objectKey:
            'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
          url: 'https://signed.example/upload',
          expiresAt: '2026-08-22T10:05:00.000Z',
          requiredHeaders: {},
        }),
        createMultipartUpload: vi.fn(),
        abortIncompleteMultipartUpload: vi.fn(),
      };
      const service = createMultimodalGuidedCreationService({
        query: queryMock,
        withTransaction: async (callback) => callback({ query: queryMock }),
        objectStorageService,
        uploadSecurityService: {
          validateUploadIntent: vi.fn().mockReturnValue({
            normalizedFileName: 'lesson.mp4',
            declaredMimeType: 'video/mp4',
            extension: 'mp4',
            mediaKind: 'video',
          }),
        },
        uploadTokenSecret: 'x'.repeat(32),
        createSourceId: () => 'source-upload-1',
        multimodalUploadMaxBytes: 1024 * 1024 * 1024,
        multimodalSinglePutMaxBytes: 10 * 1024 * 1024,
      });

      const result = await service.createUploadIntent({
        authUserId: 'user-1',
        sessionId: '101',
        idempotencyKey: 'url-intent-001',
        fileName: 'lesson.mp4',
        declaredMimeType: 'video/mp4',
        sizeBytes,
        serverManaged: true,
      });

      expect(result.uploadMode).toBe('single_put');
      expect(objectStorageService.createSignedPutGrant).toHaveBeenCalledOnce();
      expect(objectStorageService.createMultipartUpload).not.toHaveBeenCalled();
    });

    it('returns the private pending object binding only through an owner-scoped server method', async () => {
      const queryMock = vi.fn().mockResolvedValue({
        rows: [
          createSessionRow({
            media_stage: 'uploading',
            revision_no: 4,
            media_state_json: {
              ...createSessionRow().media_state_json,
              pendingUpload: createPendingUpload({
                idempotencyKey: 'url-intent-001',
              }),
            },
          }),
        ],
        rowCount: 1,
      });
      const service = createMultimodalGuidedCreationService({
        query: queryMock,
        objectStorageService: {} as never,
      });

      await expect(
        service.getServerPendingUpload({
          authUserId: 'user-1',
          sessionId: '101',
          idempotencyKey: 'url-intent-001',
        }),
      ).resolves.toMatchObject({
        sessionId: '101',
        revisionNo: 4,
        uploadMode: 'single_put',
        objectKey:
          'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
      });
      expect(String(queryMock.mock.calls[0]?.[0])).toContain('user_id = $2');
      expect(String(queryMock.mock.calls[0]?.[0])).toContain(
        'deleted_at is null',
      );
    });

    it('finds a durable URL-import receipt through the owner-scoped quality-check job', async () => {
      const queryMock = vi.fn().mockResolvedValue({
        rows: [
          createJobRow({
            job_type: 'media_quality_check',
            status: 'succeeded',
            idempotency_key: 'url-confirm-001',
            input_manifest_json: {
              schemaVersion: 1,
              sourceId: 'source-upload-1',
              mediaKind: 'video',
              objectKey:
                'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
              fileName: 'lesson.mp4',
              expectedSizeBytes: 1024,
              expectedContentType: 'video/mp4',
              uploadMode: 'single_put',
            },
            revision_no: 5,
            media_stage: 'ready_to_process',
          }),
        ],
        rowCount: 1,
      });
      const service = createMultimodalGuidedCreationService({
        query: queryMock,
        objectStorageService: {} as never,
      });

      await expect(
        service.findMediaQualityCheckByIdempotency({
          authUserId: 'user-1',
          sessionId: '101',
          idempotencyKey: 'url-confirm-001',
        }),
      ).resolves.toEqual({
        sessionId: '101',
        revisionNo: 5,
        mediaStage: 'ready_to_process',
        jobId: '701',
        jobStatus: 'succeeded',
        expectedSizeBytes: 1024,
        expectedContentType: 'video/mp4',
      });
      expect(String(queryMock.mock.calls[0]?.[0])).toContain('s.user_id = $4');
      expect(String(queryMock.mock.calls[0]?.[0])).toContain(
        's.deleted_at is null',
      );
    });
  });

  it('allows confirming any non-empty subset of retained fused topics', async () => {
    const { service, query } = createServiceHarness();
    const baseState = createAwaitingCandidatesState();
    const atomicCandidate = baseState.candidatePasses.frameworks[0];
    const fusedOne = {
      ...atomicCandidate,
      candidateId: 'fused-topic-1',
      passKey: 'fused' as const,
      title: '融合主题一',
    };
    const fusedTwo = {
      ...atomicCandidate,
      candidateId: 'fused-topic-2',
      passKey: 'fused' as const,
      title: '融合主题二',
    };
    const state = {
      ...baseState,
      candidatePasses: {
        ...baseState.candidatePasses,
        fused: [fusedOne, fusedTwo],
      },
      candidatePassMeta: {
        ...baseState.candidatePassMeta,
        fused: { model: 'fusion-model', promptVersion: 'fusion-prompt-v1' },
      },
      candidateValidations: [
        ...baseState.candidateValidations,
        {
          ...baseState.candidateValidations[0],
          candidate: fusedOne,
        },
        {
          ...baseState.candidateValidations[0],
          candidate: fusedTwo,
        },
      ],
    };
    query
      .mockResolvedValueOnce({
        rows: [
          createSessionRow({
            status: 'ready_for_confirmation',
            media_stage: 'awaiting_candidates',
            media_state_json: state,
            confirmed_stages_json: ['adler_overview'],
            revision_no: 1,
          }),
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [
          createSessionRow({
            status: 'collecting',
            media_stage: 'building_skills',
            media_state_json: {
              ...state,
              selectedCandidateIds: ['fused-topic-1'],
              operationReceipts: [
                ...state.operationReceipts,
                {
                  action: 'skill.media.candidate.confirm',
                  idempotencyKey: 'candidate-confirm-subset-001',
                  requestHash: '2'.repeat(64),
                  baseRevisionNo: 1,
                  resultRevisionNo: 2,
                  confirmedStage: 'evidence_and_candidates',
                  recordedAt: '2026-08-21T10:00:00.000Z',
                },
              ],
            },
            confirmed_stages_json: [
              'adler_overview',
              'evidence_and_candidates',
            ],
            revision_no: 2,
          }),
        ],
        rowCount: 1,
      });

    await expect(
      service.confirmCandidates({
        authUserId: 'user-1',
        sessionId: '101',
        idempotencyKey: 'candidate-confirm-subset-001',
        expectedRevisionNo: 1,
        selectedCandidateIds: ['fused-topic-1'],
      }),
    ).resolves.toMatchObject({
      mediaStage: 'building_skills',
      confirmedStage: 'evidence_and_candidates',
    });
  });

  it('rejects an atomic candidate even when its validation passed', async () => {
    const { service, query } = createServiceHarness();
    const baseState = createAwaitingCandidatesState();
    const atomicCandidate = baseState.candidatePasses.frameworks[0];
    const fusedCandidate = {
      ...atomicCandidate,
      candidateId: 'fused-topic-1',
      passKey: 'fused' as const,
    };
    query.mockResolvedValueOnce({
      rows: [
        createSessionRow({
          status: 'ready_for_confirmation',
          media_stage: 'awaiting_candidates',
          media_state_json: {
            ...baseState,
            candidatePasses: {
              ...baseState.candidatePasses,
              fused: [fusedCandidate],
            },
            candidatePassMeta: {
              ...baseState.candidatePassMeta,
              fused: {
                model: 'fusion-model',
                promptVersion: 'fusion-prompt-v1',
              },
            },
            candidateValidations: [
              ...baseState.candidateValidations,
              {
                ...baseState.candidateValidations[0],
                candidate: fusedCandidate,
              },
            ],
          },
          confirmed_stages_json: ['adler_overview'],
          revision_no: 1,
        }),
      ],
      rowCount: 1,
    });

    await expect(
      service.confirmCandidates({
        authUserId: 'user-1',
        sessionId: '101',
        idempotencyKey: 'candidate-confirm-atomic-001',
        expectedRevisionNo: 1,
        selectedCandidateIds: [atomicCandidate.candidateId],
      }),
    ).rejects.toMatchObject({
      code: 'QUALITY_GATE_FAILED',
      statusCode: 422,
    });
  });

  describe('upload confirm', () => {
    function createUploadingSessionRow(
      pendingUploadOverrides: Record<string, unknown> = {},
      rowOverrides: Record<string, unknown> = {},
      mediaStateOverrides: Record<string, unknown> = {},
    ): Record<string, unknown> {
      const baseRow = createSessionRow();
      return {
        ...baseRow,
        status: 'collecting',
        media_stage: 'uploading',
        revision_no: 1,
        updated_at: '2026-08-21T10:05:00.000Z',
        media_state_json: {
          ...baseRow.media_state_json,
          ...mediaStateOverrides,
          pendingUpload: {
            sourceId: 'source-upload-1',
            mediaKind: 'video',
            fileName: 'lesson.mp4',
            declaredMimeType: 'video/mp4',
            sizeBytes: 1024,
            uploadMode: 'single_put',
            materialStatus: 'uploading',
            verification: null,
            objectKey:
              'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
            idempotencyKey: 'upload-intent-001',
            requestHash: 'a'.repeat(64),
            intentClaimsHash: 'b'.repeat(64),
            intentRevisionNo: 1,
            expiresAt: '2026-08-22T10:05:00.000Z',
            ...pendingUploadOverrides,
          },
        },
        ...rowOverrides,
      };
    }

    function createUploadConfirmReceipt(overrides: Record<string, unknown> = {}) {
      return {
        action: 'skill.media.upload.confirm',
        idempotencyKey: 'upload-confirm-001',
        requestHash: 'c'.repeat(64),
        baseRevisionNo: 1,
        resultRevisionNo: 2,
        confirmedStage: 'uploading',
        recordedAt: '2026-08-22T10:00:00.000Z',
        ...overrides,
      };
    }

    function createUploadConfirmToken(binding: {
      sessionId: string;
      authUserId: string;
      sourceId: string;
      objectKey: string;
      declaredMimeType: string;
      sizeBytes: number;
      uploadMode: 'single_put' | 'multipart';
      multipartUploadId?: string;
      partSizeBytes?: number;
      partCount?: number;
      intentRevisionNo: number;
    }): string {
      return __testing.issueUploadIntentToken({
        secret: 'x'.repeat(32),
        binding: binding as Parameters<typeof __testing.issueUploadIntentToken>[0]['binding'],
        expiresAt: '2026-08-22T10:05:00.000Z',
      });
    }

    function createDefaultConfirmToken(overrides: Partial<{
      sessionId: string;
      authUserId: string;
      sourceId: string;
      objectKey: string;
      declaredMimeType: string;
      sizeBytes: number;
      uploadMode: 'single_put' | 'multipart';
      multipartUploadId?: string;
      partSizeBytes?: number;
      partCount?: number;
      intentRevisionNo: number;
    }> = {}): string {
      return createUploadConfirmToken({
        sessionId: '101',
        authUserId: 'user-1',
        sourceId: 'source-upload-1',
        objectKey: 'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
        declaredMimeType: 'video/mp4',
        sizeBytes: 1024,
        uploadMode: 'single_put',
        intentRevisionNo: 1,
        ...overrides,
      });
    }

    it('rejects confirm for sessions not owned by the authenticated user', async () => {
      const queryMock = vi.fn();
      queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const objectStorageService = {
        headObject: vi.fn(),
      };
      const createMediaJobInTransaction = vi.fn();

      const service = createMultimodalGuidedCreationService({
        query: queryMock,
        withTransaction: async (callback) => callback({ query: queryMock }),
        now: () => new Date('2026-08-22T10:00:00.000Z'),
        objectStorageService,
        uploadTokenSecret: 'x'.repeat(32),
        createMediaJobInTransaction,
      });

      const token = createDefaultConfirmToken();

      await expect(
        service.createUploadConfirm({
          authUserId: 'user-other',
          sessionId: '101',
          idempotencyKey: 'upload-confirm-001',
          uploadToken: token,
          expectedRevisionNo: 1,
        }),
      ).rejects.toThrow(MultimodalGuidedCreationServiceError);

      expect(String(queryMock.mock.calls[0]?.[0]).toLowerCase()).toContain(
        'user_id = $2',
      );
    });

    it('rejects confirm when the upload token is bound to a different session', async () => {
      const queryMock = vi.fn();
      const uploadingRow = createUploadingSessionRow();
      queryMock.mockResolvedValueOnce({ rows: [uploadingRow], rowCount: 1 });

      const objectStorageService = {
        headObject: vi.fn(),
      };
      const createMediaJobInTransaction = vi.fn();

      const service = createMultimodalGuidedCreationService({
        query: queryMock,
        withTransaction: async (callback) => callback({ query: queryMock }),
        now: () => new Date('2026-08-22T10:00:00.000Z'),
        objectStorageService,
        uploadTokenSecret: 'x'.repeat(32),
        createMediaJobInTransaction,
      });

      const token = createDefaultConfirmToken({ sessionId: '999' });

      await expect(
        service.createUploadConfirm({
          authUserId: 'user-1',
          sessionId: '101',
          idempotencyKey: 'upload-confirm-001',
          uploadToken: token,
          expectedRevisionNo: 1,
        }),
      ).rejects.toThrow(MultimodalGuidedCreationServiceError);
    });

    it('rejects confirm when the upload token is bound to a different object key', async () => {
      const queryMock = vi.fn();
      const uploadingRow = createUploadingSessionRow();
      queryMock.mockResolvedValueOnce({ rows: [uploadingRow], rowCount: 1 });

      const objectStorageService = {
        headObject: vi.fn(),
      };
      const createMediaJobInTransaction = vi.fn();

      const service = createMultimodalGuidedCreationService({
        query: queryMock,
        withTransaction: async (callback) => callback({ query: queryMock }),
        now: () => new Date('2026-08-22T10:00:00.000Z'),
        objectStorageService,
        uploadTokenSecret: 'x'.repeat(32),
        createMediaJobInTransaction,
      });

      const token = createDefaultConfirmToken({
        objectKey: 'skill-sessions/101/source/different-key.mp4',
      });

      await expect(
        service.createUploadConfirm({
          authUserId: 'user-1',
          sessionId: '101',
          idempotencyKey: 'upload-confirm-001',
          uploadToken: token,
          expectedRevisionNo: 1,
        }),
      ).rejects.toThrow(MultimodalGuidedCreationServiceError);
    });

    it('rejects confirm when the session is not in uploading stage', async () => {
      const queryMock = vi.fn();
      const draftRow = createSessionRow();
      queryMock.mockResolvedValueOnce({ rows: [draftRow], rowCount: 1 });

      const objectStorageService = {
        headObject: vi.fn(),
      };
      const createMediaJobInTransaction = vi.fn();

      const service = createMultimodalGuidedCreationService({
        query: queryMock,
        withTransaction: async (callback) => callback({ query: queryMock }),
        now: () => new Date('2026-08-22T10:00:00.000Z'),
        objectStorageService,
        uploadTokenSecret: 'x'.repeat(32),
        createMediaJobInTransaction,
      });

      const token = createDefaultConfirmToken();

      await expect(
        service.createUploadConfirm({
          authUserId: 'user-1',
          sessionId: '101',
          idempotencyKey: 'upload-confirm-001',
          uploadToken: token,
          expectedRevisionNo: 1,
        }),
      ).rejects.toThrow(MultimodalGuidedCreationServiceError);
    });

    it('rejects confirm when pending upload is already in verifying state', async () => {
      const queryMock = vi.fn();
      const verifyingRow = createUploadingSessionRow({
        materialStatus: 'verifying',
        verification: {
          jobId: 'job-quality-1',
          idempotencyKey: 'upload-confirm-001',
          requestHash: 'c'.repeat(64),
          observedSizeBytes: 1024,
          observedContentType: 'video/mp4',
          confirmedAt: '2026-08-22T10:00:00.000Z',
        },
      });
      queryMock.mockResolvedValueOnce({ rows: [verifyingRow], rowCount: 1 });

      const objectStorageService = {
        headObject: vi.fn(),
      };
      const createMediaJobInTransaction = vi.fn();

      const service = createMultimodalGuidedCreationService({
        query: queryMock,
        withTransaction: async (callback) => callback({ query: queryMock }),
        now: () => new Date('2026-08-22T10:00:00.000Z'),
        objectStorageService,
        uploadTokenSecret: 'x'.repeat(32),
        createMediaJobInTransaction,
      });

      const token = createDefaultConfirmToken();

      await expect(
        service.createUploadConfirm({
          authUserId: 'user-1',
          sessionId: '101',
          idempotencyKey: 'upload-confirm-002',
          uploadToken: token,
          expectedRevisionNo: 1,
        }),
      ).rejects.toThrow(MultimodalGuidedCreationServiceError);
    });

    it('rejects confirm when revision does not match', async () => {
      const queryMock = vi.fn();
      const uploadingRow = createUploadingSessionRow();
      queryMock.mockResolvedValueOnce({ rows: [uploadingRow], rowCount: 1 });

      const objectStorageService = {
        headObject: vi.fn(),
      };
      const createMediaJobInTransaction = vi.fn();

      const service = createMultimodalGuidedCreationService({
        query: queryMock,
        withTransaction: async (callback) => callback({ query: queryMock }),
        now: () => new Date('2026-08-22T10:00:00.000Z'),
        objectStorageService,
        uploadTokenSecret: 'x'.repeat(32),
        createMediaJobInTransaction,
      });

      const token = createDefaultConfirmToken();

      await expect(
        service.createUploadConfirm({
          authUserId: 'user-1',
          sessionId: '101',
          idempotencyKey: 'upload-confirm-001',
          uploadToken: token,
          expectedRevisionNo: 5,
        }),
      ).rejects.toThrow(MultimodalGuidedCreationServiceError);
    });

    it('heads the single-put object and transitions to verifying with a media_quality_check job', async () => {
      const queryMock = vi.fn();
      const uploadingRow = createUploadingSessionRow();
      const token = createDefaultConfirmToken();
      const expectedHash = __testing.buildUploadConfirmRequestHash({
        action: 'skill.media.upload.confirm',
        sessionId: '101',
        sourceId: 'source-upload-1',
        objectKey:
          'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
        declaredMimeType: 'video/mp4',
        sizeBytes: 1024,
        uploadMode: 'single_put',
        intentRevisionNo: 1,
      });
      const verifyingRow = createUploadingSessionRow(
        {
          materialStatus: 'verifying',
          verification: {
            jobId: 'job-quality-1',
            idempotencyKey: 'upload-confirm-001',
            requestHash: expectedHash,
            observedSizeBytes: 1024,
            observedContentType: 'video/mp4',
            confirmedAt: '2026-08-22T10:00:00.000Z',
          },
        },
        { revision_no: 2, updated_at: '2026-08-22T10:00:00.000Z' },
        { operationReceipts: [createUploadConfirmReceipt({ requestHash: expectedHash })] },
      );
      queryMock
        .mockResolvedValueOnce({ rows: [uploadingRow], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [uploadingRow], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [verifyingRow], rowCount: 1 });

      const objectStorageService = {
        headObject: vi.fn().mockResolvedValue({
          objectKey:
            'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
          sizeBytes: 1024,
          contentType: 'video/mp4',
          etag: '"etag-abc"',
          lastModified: new Date('2026-08-22T09:00:00.000Z'),
        }),
      };
      const createMediaJobInTransaction = vi.fn().mockResolvedValue({
        jobId: 'job-quality-1',
        jobType: 'media_quality_check',
        status: 'queued',
        attemptNo: 1,
      });

      const service = createMultimodalGuidedCreationService({
        query: queryMock,
        withTransaction: async (callback) => callback({ query: queryMock }),
        now: () => new Date('2026-08-22T10:00:00.000Z'),
        objectStorageService,
        uploadTokenSecret: 'x'.repeat(32),
        createMediaJobInTransaction,
      });

      const result = await service.createUploadConfirm({
        authUserId: 'user-1',
        sessionId: '101',
        idempotencyKey: 'upload-confirm-001',
        uploadToken: token,
        expectedRevisionNo: 1,
      });

      expect(result).toMatchObject({
        sessionId: '101',
        revisionNo: 2,
        mediaStage: 'uploading',
        materialStatus: 'verifying',
        jobId: 'job-quality-1',
        observedSizeBytes: 1024,
        observedContentType: 'video/mp4',
        replayed: false,
      });
      expect(objectStorageService.headObject).toHaveBeenCalledWith({
        objectKey:
          'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
      });
      expect(createMediaJobInTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: '101',
          jobType: 'media_quality_check',
          idempotencyKey: 'upload-confirm-001',
        }),
      );
      expect(String(queryMock.mock.calls[0]?.[0]).toLowerCase()).toContain(
        'for update',
      );
      expect(String(queryMock.mock.calls[0]?.[0]).toLowerCase()).toContain(
        'user_id = $2',
      );
    });

    it('rejects single-put when HEAD returns size mismatch', async () => {
      const queryMock = vi.fn();
      const uploadingRow = createUploadingSessionRow();
      queryMock.mockResolvedValueOnce({ rows: [uploadingRow], rowCount: 1 });

      const objectStorageService = {
        headObject: vi.fn().mockResolvedValue({
          objectKey:
            'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
          sizeBytes: 9999,
          contentType: 'video/mp4',
          etag: '"etag-abc"',
          lastModified: new Date('2026-08-22T09:00:00.000Z'),
        }),
      };
      const createMediaJobInTransaction = vi.fn();

      const service = createMultimodalGuidedCreationService({
        query: queryMock,
        withTransaction: async (callback) => callback({ query: queryMock }),
        now: () => new Date('2026-08-22T10:00:00.000Z'),
        objectStorageService,
        uploadTokenSecret: 'x'.repeat(32),
        createMediaJobInTransaction,
      });

      const token = createDefaultConfirmToken();

      await expect(
        service.createUploadConfirm({
          authUserId: 'user-1',
          sessionId: '101',
          idempotencyKey: 'upload-confirm-001',
          uploadToken: token,
          expectedRevisionNo: 1,
        }),
      ).rejects.toThrow(MultimodalGuidedCreationServiceError);

      expect(createMediaJobInTransaction).not.toHaveBeenCalled();
    });

    it('rejects single-put when HEAD returns MIME mismatch', async () => {
      const queryMock = vi.fn();
      const uploadingRow = createUploadingSessionRow();
      queryMock.mockResolvedValueOnce({ rows: [uploadingRow], rowCount: 1 });

      const objectStorageService = {
        headObject: vi.fn().mockResolvedValue({
          objectKey:
            'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
          sizeBytes: 1024,
          contentType: 'audio/mpeg',
          etag: '"etag-abc"',
          lastModified: new Date('2026-08-22T09:00:00.000Z'),
        }),
      };
      const createMediaJobInTransaction = vi.fn();

      const service = createMultimodalGuidedCreationService({
        query: queryMock,
        withTransaction: async (callback) => callback({ query: queryMock }),
        now: () => new Date('2026-08-22T10:00:00.000Z'),
        objectStorageService,
        uploadTokenSecret: 'x'.repeat(32),
        createMediaJobInTransaction,
      });

      const token = createDefaultConfirmToken();

      await expect(
        service.createUploadConfirm({
          authUserId: 'user-1',
          sessionId: '101',
          idempotencyKey: 'upload-confirm-001',
          uploadToken: token,
          expectedRevisionNo: 1,
        }),
      ).rejects.toThrow(MultimodalGuidedCreationServiceError);

      expect(createMediaJobInTransaction).not.toHaveBeenCalled();
    });

    it('rejects multipart with missing part numbers', async () => {
      const queryMock = vi.fn();
      const uploadingRow = createUploadingSessionRow({
        uploadMode: 'multipart',
        sizeBytes: 20 * 1024 * 1024,
        multipartUploadId: 'multipart-upload-123',
        partSizeBytes: 8 * 1024 * 1024,
        partCount: 3,
      });
      queryMock.mockResolvedValueOnce({ rows: [uploadingRow], rowCount: 1 });

      const objectStorageService = {
        headObject: vi.fn(),
        completeMultipartUpload: vi.fn(),
      };
      const createMediaJobInTransaction = vi.fn();

      const service = createMultimodalGuidedCreationService({
        query: queryMock,
        withTransaction: async (callback) => callback({ query: queryMock }),
        now: () => new Date('2026-08-22T10:00:00.000Z'),
        objectStorageService,
        uploadTokenSecret: 'x'.repeat(32),
        createMediaJobInTransaction,
      });

      const token = createDefaultConfirmToken({
        uploadMode: 'multipart',
        sizeBytes: 20 * 1024 * 1024,
        multipartUploadId: 'multipart-upload-123',
        partSizeBytes: 8 * 1024 * 1024,
        partCount: 3,
      });

      await expect(
        service.createUploadConfirm({
          authUserId: 'user-1',
          sessionId: '101',
          idempotencyKey: 'upload-confirm-001',
          uploadToken: token,
          expectedRevisionNo: 1,
          parts: [
            { partNumber: 1, etag: '"etag-1"' },
            { partNumber: 3, etag: '"etag-3"' },
          ],
        }),
      ).rejects.toThrow(MultimodalGuidedCreationServiceError);

      expect(createMediaJobInTransaction).not.toHaveBeenCalled();
    });

    it('rejects multipart with empty ETags', async () => {
      const queryMock = vi.fn();
      const uploadingRow = createUploadingSessionRow({
        uploadMode: 'multipart',
        sizeBytes: 20 * 1024 * 1024,
        multipartUploadId: 'multipart-upload-123',
        partSizeBytes: 8 * 1024 * 1024,
        partCount: 3,
      });
      queryMock.mockResolvedValueOnce({ rows: [uploadingRow], rowCount: 1 });

      const objectStorageService = {
        headObject: vi.fn(),
        completeMultipartUpload: vi.fn(),
      };
      const createMediaJobInTransaction = vi.fn();

      const service = createMultimodalGuidedCreationService({
        query: queryMock,
        withTransaction: async (callback) => callback({ query: queryMock }),
        now: () => new Date('2026-08-22T10:00:00.000Z'),
        objectStorageService,
        uploadTokenSecret: 'x'.repeat(32),
        createMediaJobInTransaction,
      });

      const token = createDefaultConfirmToken({
        uploadMode: 'multipart',
        sizeBytes: 20 * 1024 * 1024,
        multipartUploadId: 'multipart-upload-123',
        partSizeBytes: 8 * 1024 * 1024,
        partCount: 3,
      });

      await expect(
        service.createUploadConfirm({
          authUserId: 'user-1',
          sessionId: '101',
          idempotencyKey: 'upload-confirm-001',
          uploadToken: token,
          expectedRevisionNo: 1,
          parts: [
            { partNumber: 1, etag: '"etag-1"' },
            { partNumber: 2, etag: '' },
            { partNumber: 3, etag: '"etag-3"' },
          ],
        }),
      ).rejects.toThrow(MultimodalGuidedCreationServiceError);

      expect(createMediaJobInTransaction).not.toHaveBeenCalled();
    });

    it('rejects multipart with duplicate ETags', async () => {
      const queryMock = vi.fn();
      const uploadingRow = createUploadingSessionRow({
        uploadMode: 'multipart',
        sizeBytes: 20 * 1024 * 1024,
        multipartUploadId: 'multipart-upload-123',
        partSizeBytes: 8 * 1024 * 1024,
        partCount: 3,
      });
      queryMock.mockResolvedValueOnce({ rows: [uploadingRow], rowCount: 1 });

      const objectStorageService = {
        headObject: vi.fn(),
        completeMultipartUpload: vi.fn(),
      };
      const createMediaJobInTransaction = vi.fn();

      const service = createMultimodalGuidedCreationService({
        query: queryMock,
        withTransaction: async (callback) => callback({ query: queryMock }),
        now: () => new Date('2026-08-22T10:00:00.000Z'),
        objectStorageService,
        uploadTokenSecret: 'x'.repeat(32),
        createMediaJobInTransaction,
      });

      const token = createDefaultConfirmToken({
        uploadMode: 'multipart',
        sizeBytes: 20 * 1024 * 1024,
        multipartUploadId: 'multipart-upload-123',
        partSizeBytes: 8 * 1024 * 1024,
        partCount: 3,
      });

      await expect(
        service.createUploadConfirm({
          authUserId: 'user-1',
          sessionId: '101',
          idempotencyKey: 'upload-confirm-001',
          uploadToken: token,
          expectedRevisionNo: 1,
          parts: [
            { partNumber: 1, etag: '"etag-1"' },
            { partNumber: 2, etag: '"etag-1"' },
            { partNumber: 3, etag: '"etag-3"' },
          ],
        }),
      ).rejects.toThrow(MultimodalGuidedCreationServiceError);

      expect(createMediaJobInTransaction).not.toHaveBeenCalled();
    });

    it('completes multipart upload, heads the result, and transitions to verifying', async () => {
      const queryMock = vi.fn();
      const uploadingRow = createUploadingSessionRow({
        uploadMode: 'multipart',
        sizeBytes: 20 * 1024 * 1024,
        multipartUploadId: 'multipart-upload-123',
        partSizeBytes: 8 * 1024 * 1024,
        partCount: 3,
      });
      const verifyingRow = createUploadingSessionRow(
        {
          uploadMode: 'multipart',
          sizeBytes: 20 * 1024 * 1024,
          multipartUploadId: 'multipart-upload-123',
          partSizeBytes: 8 * 1024 * 1024,
          partCount: 3,
          materialStatus: 'verifying',
          verification: {
            jobId: 'job-quality-1',
            idempotencyKey: 'upload-confirm-001',
            requestHash: 'c'.repeat(64),
            observedSizeBytes: 20 * 1024 * 1024,
            observedContentType: 'video/mp4',
            confirmedAt: '2026-08-22T10:00:00.000Z',
          },
        },
        { revision_no: 2, updated_at: '2026-08-22T10:00:00.000Z' },
        { operationReceipts: [createUploadConfirmReceipt()] },
      );
      queryMock
        .mockResolvedValueOnce({ rows: [uploadingRow], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [uploadingRow], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [verifyingRow], rowCount: 1 });

      const objectStorageService = {
        headObject: vi.fn().mockResolvedValue({
          objectKey:
            'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
          sizeBytes: 20 * 1024 * 1024,
          contentType: 'video/mp4',
          etag: '"final-etag"',
          lastModified: new Date('2026-08-22T09:00:00.000Z'),
        }),
        completeMultipartUpload: vi.fn().mockResolvedValue({
          objectKey:
            'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
          etag: '"final-etag"',
          versionId: 'version-1',
        }),
      };
      const createMediaJobInTransaction = vi.fn().mockResolvedValue({
        jobId: 'job-quality-1',
        jobType: 'media_quality_check',
        status: 'queued',
        attemptNo: 1,
      });

      const service = createMultimodalGuidedCreationService({
        query: queryMock,
        withTransaction: async (callback) => callback({ query: queryMock }),
        now: () => new Date('2026-08-22T10:00:00.000Z'),
        objectStorageService,
        uploadTokenSecret: 'x'.repeat(32),
        createMediaJobInTransaction,
      });

      const token = createDefaultConfirmToken({
        uploadMode: 'multipart',
        sizeBytes: 20 * 1024 * 1024,
        multipartUploadId: 'multipart-upload-123',
        partSizeBytes: 8 * 1024 * 1024,
        partCount: 3,
      });

      const result = await service.createUploadConfirm({
        authUserId: 'user-1',
        sessionId: '101',
        idempotencyKey: 'upload-confirm-001',
        uploadToken: token,
        expectedRevisionNo: 1,
        parts: [
          { partNumber: 1, etag: '"etag-1"' },
          { partNumber: 2, etag: '"etag-2"' },
          { partNumber: 3, etag: '"etag-3"' },
        ],
      });

      expect(result).toMatchObject({
        sessionId: '101',
        revisionNo: 2,
        materialStatus: 'verifying',
        jobId: 'job-quality-1',
        observedSizeBytes: 20 * 1024 * 1024,
        observedContentType: 'video/mp4',
        replayed: false,
      });
      expect(objectStorageService.completeMultipartUpload).toHaveBeenCalledWith(
        {
          objectKey:
            'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
          multipartUploadId: 'multipart-upload-123',
          parts: [
            { partNumber: 1, etag: '"etag-1"' },
            { partNumber: 2, etag: '"etag-2"' },
            { partNumber: 3, etag: '"etag-3"' },
          ],
        },
      );
      expect(objectStorageService.headObject).toHaveBeenCalled();
      expect(createMediaJobInTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: '101',
          jobType: 'media_quality_check',
        }),
      );
    });

    it('recovers idempotently when Complete response is lost but HEAD shows object exists', async () => {
      const queryMock = vi.fn();
      const uploadingRow = createUploadingSessionRow({
        uploadMode: 'multipart',
        sizeBytes: 20 * 1024 * 1024,
        multipartUploadId: 'multipart-upload-123',
        partSizeBytes: 8 * 1024 * 1024,
        partCount: 3,
      });
      const verifyingRow = createUploadingSessionRow(
        {
          uploadMode: 'multipart',
          sizeBytes: 20 * 1024 * 1024,
          multipartUploadId: 'multipart-upload-123',
          partSizeBytes: 8 * 1024 * 1024,
          partCount: 3,
          materialStatus: 'verifying',
          verification: {
            jobId: 'job-quality-1',
            idempotencyKey: 'upload-confirm-001',
            requestHash: 'c'.repeat(64),
            observedSizeBytes: 20 * 1024 * 1024,
            observedContentType: 'video/mp4',
            confirmedAt: '2026-08-22T10:00:00.000Z',
          },
        },
        { revision_no: 2, updated_at: '2026-08-22T10:00:00.000Z' },
        { operationReceipts: [createUploadConfirmReceipt()] },
      );
      queryMock
        .mockResolvedValueOnce({ rows: [uploadingRow], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [uploadingRow], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [verifyingRow], rowCount: 1 });

      const objectStorageService = {
        headObject: vi.fn().mockResolvedValue({
          objectKey:
            'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
          sizeBytes: 20 * 1024 * 1024,
          contentType: 'video/mp4',
          etag: '"final-etag"',
          lastModified: new Date('2026-08-22T09:00:00.000Z'),
        }),
        completeMultipartUpload: vi.fn().mockRejectedValue(
          new Error('network error'),
        ),
      };
      const createMediaJobInTransaction = vi.fn().mockResolvedValue({
        jobId: 'job-quality-1',
        jobType: 'media_quality_check',
        status: 'queued',
        attemptNo: 1,
      });

      const service = createMultimodalGuidedCreationService({
        query: queryMock,
        withTransaction: async (callback) => callback({ query: queryMock }),
        now: () => new Date('2026-08-22T10:00:00.000Z'),
        objectStorageService,
        uploadTokenSecret: 'x'.repeat(32),
        createMediaJobInTransaction,
      });

      const token = createDefaultConfirmToken({
        uploadMode: 'multipart',
        sizeBytes: 20 * 1024 * 1024,
        multipartUploadId: 'multipart-upload-123',
        partSizeBytes: 8 * 1024 * 1024,
        partCount: 3,
      });

      const result = await service.createUploadConfirm({
        authUserId: 'user-1',
        sessionId: '101',
        idempotencyKey: 'upload-confirm-001',
        uploadToken: token,
        expectedRevisionNo: 1,
        parts: [
          { partNumber: 1, etag: '"etag-1"' },
          { partNumber: 2, etag: '"etag-2"' },
          { partNumber: 3, etag: '"etag-3"' },
        ],
      });

      expect(result).toMatchObject({
        sessionId: '101',
        revisionNo: 2,
        materialStatus: 'verifying',
        jobId: 'job-quality-1',
        replayed: false,
      });
      expect(objectStorageService.completeMultipartUpload).toHaveBeenCalled();
      expect(objectStorageService.headObject).toHaveBeenCalled();
      expect(createMediaJobInTransaction).toHaveBeenCalled();
    });

    it('replays the same upload confirm for the same key and hash', async () => {
      const queryMock = vi.fn();
      const token = createDefaultConfirmToken();
      const expectedHash = __testing.buildUploadConfirmRequestHash({
        action: 'skill.media.upload.confirm',
        sessionId: '101',
        sourceId: 'source-upload-1',
        objectKey:
          'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
        declaredMimeType: 'video/mp4',
        sizeBytes: 1024,
        uploadMode: 'single_put',
        intentRevisionNo: 1,
      });
      const verifyingRow = createUploadingSessionRow(
        {
          materialStatus: 'verifying',
          verification: {
            jobId: 'job-quality-1',
            idempotencyKey: 'upload-confirm-001',
            requestHash: expectedHash,
            observedSizeBytes: 1024,
            observedContentType: 'video/mp4',
            confirmedAt: '2026-08-22T10:00:00.000Z',
          },
        },
        { revision_no: 2, updated_at: '2026-08-22T10:00:00.000Z' },
        { operationReceipts: [createUploadConfirmReceipt({ requestHash: expectedHash })] },
      );
      queryMock.mockResolvedValueOnce({ rows: [verifyingRow], rowCount: 1 });

      const objectStorageService = {
        headObject: vi.fn(),
      };
      const createMediaJobInTransaction = vi.fn();

      const service = createMultimodalGuidedCreationService({
        query: queryMock,
        withTransaction: async (callback) => callback({ query: queryMock }),
        now: () => new Date('2026-08-22T10:00:00.000Z'),
        objectStorageService,
        uploadTokenSecret: 'x'.repeat(32),
        createMediaJobInTransaction,
      });

      const result = await service.createUploadConfirm({
        authUserId: 'user-1',
        sessionId: '101',
        idempotencyKey: 'upload-confirm-001',
        uploadToken: token,
        expectedRevisionNo: 1,
      });

      expect(result).toMatchObject({
        sessionId: '101',
        revisionNo: 2,
        materialStatus: 'verifying',
        jobId: 'job-quality-1',
        replayed: true,
      });
      expect(objectStorageService.headObject).not.toHaveBeenCalled();
      expect(createMediaJobInTransaction).not.toHaveBeenCalled();
    });

    it('rejects idempotency key reuse with a different hash', async () => {
      const queryMock = vi.fn();
      const differentHash = 'different-hash'.repeat(4).slice(0, 64);
      const verifyingRow = createUploadingSessionRow(
        {
          materialStatus: 'verifying',
          verification: {
            jobId: 'job-quality-1',
            idempotencyKey: 'upload-confirm-001',
            requestHash: differentHash,
            observedSizeBytes: 1024,
            observedContentType: 'video/mp4',
            confirmedAt: '2026-08-22T10:00:00.000Z',
          },
        },
        { revision_no: 2, updated_at: '2026-08-22T10:00:00.000Z' },
        { operationReceipts: [createUploadConfirmReceipt({ requestHash: differentHash })] },
      );
      queryMock.mockResolvedValueOnce({ rows: [verifyingRow], rowCount: 1 });

      const objectStorageService = {
        headObject: vi.fn(),
      };
      const createMediaJobInTransaction = vi.fn();

      const service = createMultimodalGuidedCreationService({
        query: queryMock,
        withTransaction: async (callback) => callback({ query: queryMock }),
        now: () => new Date('2026-08-22T10:00:00.000Z'),
        objectStorageService,
        uploadTokenSecret: 'x'.repeat(32),
        createMediaJobInTransaction,
      });

      const token = createDefaultConfirmToken();

      await expect(
        service.createUploadConfirm({
          authUserId: 'user-1',
          sessionId: '101',
          idempotencyKey: 'upload-confirm-001',
          uploadToken: token,
          expectedRevisionNo: 1,
        }),
      ).rejects.toThrow(MultimodalGuidedCreationServiceError);
    });

    it('allows replay with expired token when result already exists', async () => {
      const queryMock = vi.fn();
      const expiredToken = __testing.issueUploadIntentToken({
        secret: 'x'.repeat(32),
        binding: {
          sessionId: '101',
          authUserId: 'user-1',
          sourceId: 'source-upload-1',
          objectKey:
            'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 1024,
          uploadMode: 'single_put',
          intentRevisionNo: 1,
        },
        expiresAt: '2020-01-01T00:00:00.000Z',
      });
      const expectedHash = __testing.buildUploadConfirmRequestHash({
        action: 'skill.media.upload.confirm',
        sessionId: '101',
        sourceId: 'source-upload-1',
        objectKey:
          'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
        declaredMimeType: 'video/mp4',
        sizeBytes: 1024,
        uploadMode: 'single_put',
        intentRevisionNo: 1,
      });
      const verifyingRow = createUploadingSessionRow(
        {
          materialStatus: 'verifying',
          verification: {
            jobId: 'job-quality-1',
            idempotencyKey: 'upload-confirm-001',
            requestHash: expectedHash,
            observedSizeBytes: 1024,
            observedContentType: 'video/mp4',
            confirmedAt: '2026-08-22T10:00:00.000Z',
          },
        },
        { revision_no: 2, updated_at: '2026-08-22T10:00:00.000Z' },
        { operationReceipts: [createUploadConfirmReceipt({ requestHash: expectedHash })] },
      );
      queryMock.mockResolvedValueOnce({ rows: [verifyingRow], rowCount: 1 });

      const objectStorageService = {
        headObject: vi.fn(),
      };
      const createMediaJobInTransaction = vi.fn();

      const service = createMultimodalGuidedCreationService({
        query: queryMock,
        withTransaction: async (callback) => callback({ query: queryMock }),
        now: () => new Date('2026-08-22T10:00:00.000Z'),
        objectStorageService,
        uploadTokenSecret: 'x'.repeat(32),
        createMediaJobInTransaction,
      });

      const result = await service.createUploadConfirm({
        authUserId: 'user-1',
        sessionId: '101',
        idempotencyKey: 'upload-confirm-001',
        uploadToken: expiredToken,
        expectedRevisionNo: 1,
      });

      expect(result).toMatchObject({
        sessionId: '101',
        materialStatus: 'verifying',
        jobId: 'job-quality-1',
        replayed: true,
      });
    });

    it('performs S3 operations outside the database transaction', async () => {
      const queryMock = vi.fn();
      const uploadingRow = createUploadingSessionRow();
      const verifyingRow = createUploadingSessionRow(
        {
          materialStatus: 'verifying',
          verification: {
            jobId: 'job-quality-1',
            idempotencyKey: 'upload-confirm-001',
            requestHash: 'c'.repeat(64),
            observedSizeBytes: 1024,
            observedContentType: 'video/mp4',
            confirmedAt: '2026-08-22T10:00:00.000Z',
          },
        },
        { revision_no: 2, updated_at: '2026-08-22T10:00:00.000Z' },
        { operationReceipts: [createUploadConfirmReceipt()] },
      );
      queryMock
        .mockResolvedValueOnce({ rows: [uploadingRow], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [uploadingRow], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [verifyingRow], rowCount: 1 });

      const headObject = vi.fn().mockResolvedValue({
        objectKey:
          'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
        sizeBytes: 1024,
        contentType: 'video/mp4',
        etag: '"etag-abc"',
        lastModified: new Date('2026-08-22T09:00:00.000Z'),
      });
      const createMediaJobInTransaction = vi.fn().mockResolvedValue({
        jobId: 'job-quality-1',
        jobType: 'media_quality_check',
        status: 'queued',
        attemptNo: 1,
      });

      const callOrder: string[] = [];
      const wrappedHeadObject = vi.fn().mockImplementation(async (...args: unknown[]) => {
        callOrder.push('headObject');
        return headObject(...args);
      });
      const withTransaction = vi.fn(
        async (callback: (db: { query: typeof queryMock }) => Promise<unknown>) => {
          callOrder.push('transaction-start');
          const result = await callback({ query: queryMock });
          callOrder.push('transaction-end');
          return result;
        },
      );

      const service = createMultimodalGuidedCreationService({
        query: queryMock,
        withTransaction,
        now: () => new Date('2026-08-22T10:00:00.000Z'),
        objectStorageService: { headObject: wrappedHeadObject },
        uploadTokenSecret: 'x'.repeat(32),
        createMediaJobInTransaction,
      });

      const token = createDefaultConfirmToken();

      await service.createUploadConfirm({
        authUserId: 'user-1',
        sessionId: '101',
        idempotencyKey: 'upload-confirm-001',
        uploadToken: token,
        expectedRevisionNo: 1,
      });

      const headObjectIndex = callOrder.indexOf('headObject');
      expect(headObjectIndex).toBeGreaterThan(-1);
      const firstTransactionEnd = callOrder.indexOf('transaction-end');
      const secondTransactionStart = callOrder.lastIndexOf('transaction-start');
      expect(headObjectIndex).toBeGreaterThan(firstTransactionEnd);
      expect(headObjectIndex).toBeLessThan(secondTransactionStart);
      expect(callOrder.filter((e) => e === 'transaction-start').length).toBe(2);
    });

    it('re-reads session inside the transaction for CAS', async () => {
      const queryMock = vi.fn();
      const uploadingRow = createUploadingSessionRow();
      const verifyingRow = createUploadingSessionRow(
        {
          materialStatus: 'verifying',
          verification: {
            jobId: 'job-quality-1',
            idempotencyKey: 'upload-confirm-001',
            requestHash: 'c'.repeat(64),
            observedSizeBytes: 1024,
            observedContentType: 'video/mp4',
            confirmedAt: '2026-08-22T10:00:00.000Z',
          },
        },
        { revision_no: 2, updated_at: '2026-08-22T10:00:00.000Z' },
        { operationReceipts: [createUploadConfirmReceipt()] },
      );
      queryMock
        .mockResolvedValueOnce({ rows: [uploadingRow], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [uploadingRow], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [verifyingRow], rowCount: 1 });

      const objectStorageService = {
        headObject: vi.fn().mockResolvedValue({
          objectKey:
            'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
          sizeBytes: 1024,
          contentType: 'video/mp4',
          etag: '"etag-abc"',
          lastModified: new Date('2026-08-22T09:00:00.000Z'),
        }),
      };
      const createMediaJobInTransaction = vi.fn().mockResolvedValue({
        jobId: 'job-quality-1',
        jobType: 'media_quality_check',
        status: 'queued',
        attemptNo: 1,
      });

      const service = createMultimodalGuidedCreationService({
        query: queryMock,
        withTransaction: async (callback) => callback({ query: queryMock }),
        now: () => new Date('2026-08-22T10:00:00.000Z'),
        objectStorageService,
        uploadTokenSecret: 'x'.repeat(32),
        createMediaJobInTransaction,
      });

      const token = createDefaultConfirmToken();

      await service.createUploadConfirm({
        authUserId: 'user-1',
        sessionId: '101',
        idempotencyKey: 'upload-confirm-001',
        uploadToken: token,
        expectedRevisionNo: 1,
      });

      const firstQuery = String(queryMock.mock.calls[0]?.[0]);
      expect(firstQuery.toLowerCase()).toContain('for update');
      expect(firstQuery.toLowerCase()).toContain('user_id = $2');
      expect(firstQuery.toLowerCase()).toContain('creation_mode = $3');
      expect(firstQuery.toLowerCase()).toContain('deleted_at is null');

      const secondQuery = String(queryMock.mock.calls[2]?.[0]);
      expect(secondQuery.toLowerCase()).toContain('revision_no = $');
      expect(secondQuery.toLowerCase()).toContain('media_stage = $');
    });
  });
});

describe('upload confirm media quality job contract', () => {
  it('builds confirm request hashes from stable persisted upload facts rather than token or confirm key', () => {
    const first = __testing.buildUploadConfirmRequestHash({
      action: 'skill.media.upload.confirm',
      sessionId: '42',
      sourceId: 'source-1',
      objectKey:
        'skill-sessions/42/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
      declaredMimeType: 'video/mp4',
      sizeBytes: 1024,
      uploadMode: 'single_put',
      intentRevisionNo: 1,
    });

    const replay = __testing.buildUploadConfirmRequestHash({
      action: 'skill.media.upload.confirm',
      sessionId: '42',
      sourceId: 'source-1',
      objectKey:
        'skill-sessions/42/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
      declaredMimeType: 'video/mp4',
      sizeBytes: 1024,
      uploadMode: 'single_put',
      intentRevisionNo: 1,
    });

    const drift = __testing.buildUploadConfirmRequestHash({
      action: 'skill.media.upload.confirm',
      sessionId: '42',
      sourceId: 'source-1',
      objectKey:
        'skill-sessions/42/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
      declaredMimeType: 'video/mp4',
      sizeBytes: 2048,
      uploadMode: 'single_put',
      intentRevisionNo: 1,
    });

    expect(replay).toBe(first);
    expect(drift).not.toBe(first);
  });
});

function createReadyAudioState() {
  return {
    ...createSessionRow().media_state_json as Record<string, unknown>,
    primarySource: {
      sourceId: 'source-audio-1',
      kind: 'audio',
      assetRef: {
        objectKey: 'skill-sessions/101/source/audio.wav',
        mimeType: 'audio/wav',
        sizeBytes: 32_078,
        sha256: 'a'.repeat(64),
      },
    },
    pendingUpload: null,
  };
}

function createQualityCheckJobRow() {
  return createJobRow({
    id: '700',
    job_type: 'media_quality_check',
    status: 'succeeded',
    attempt_no: 1,
    input_manifest_json: {
      schemaVersion: 1,
      sourceId: 'source-audio-1',
      mediaKind: 'audio',
      objectKey: 'skill-sessions/101/source/audio.wav',
      fileName: 'lesson.wav',
      expectedSizeBytes: 32_078,
      expectedContentType: 'audio/wav',
      uploadMode: 'single_put',
    },
    output_manifest_json: {
      schemaVersion: 1,
      jobType: 'media_quality_check',
      sessionId: '101',
      sourceId: 'source-audio-1',
      sourceKind: 'audio',
      sourceAsset: {
        objectKey: 'skill-sessions/101/source/audio.wav',
        mimeType: 'audio/wav',
        sizeBytes: 32_078,
        sha256: 'a'.repeat(64),
      },
      probe: {
        durationMs: 1_000,
        formatName: 'wav',
        hasAudio: true,
        hasVideo: false,
        audioStreamCount: 1,
        videoStreamCount: 0,
        primaryAudioStreamIndex: 0,
        primaryVideoStreamIndex: null,
      },
      resultManifestRef: {
        objectKey:
          'skill-sessions/101/manifest/media-quality-check/job-700-attempt-1.json',
        mimeType: 'application/json',
        sizeBytes: 512,
        sha256: 'b'.repeat(64),
      },
      processorVersion: '0.1.0',
      degradations: [],
    },
    result_hash: 'c'.repeat(64),
  });
}

describe('multimodal processing controls', () => {
  it('starts only an accepted primary source and records an audio ASR path atomically', async () => {
    const queryMock = vi.fn();
    const readyRow = createSessionRow({
      media_stage: 'ready_to_process',
      revision_no: 2,
      media_state_json: createReadyAudioState(),
    });
    const preparingRow = createSessionRow({
      media_stage: 'preparing_media',
      revision_no: 3,
      media_state_json: createReadyAudioState(),
      updated_at: '2026-08-21T10:01:00.000Z',
    });
    queryMock
      .mockResolvedValueOnce({ rows: [readyRow], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [createQualityCheckJobRow()], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [preparingRow], rowCount: 1 });
    const createMediaJobInTransaction = vi.fn().mockResolvedValue({
      jobId: '701',
      jobType: 'media_prepare',
      status: 'queued',
      attemptNo: 0,
    });
    const service = createMultimodalGuidedCreationService({
      query: queryMock,
      withTransaction: async (callback) => callback({ query: queryMock }),
      now: () => new Date('2026-08-21T10:01:00.000Z'),
      createMediaJobInTransaction,
    });

    const result = await service.startProcessing({
      authUserId: 'user-1',
      sessionId: '101',
      idempotencyKey: 'process-start-001',
      expectedRevisionNo: 2,
      understandingMode: 'auto',
      transcriptionMode: 'deploymentDefault',
    });

    expect(result).toMatchObject({
      sessionId: '101',
      revisionNo: 3,
      mediaStage: 'preparing_media',
      job: { jobId: '701', jobType: 'media_prepare', status: 'queued' },
      pipelinePlan: { transcribe: true, frameMaterialize: false },
      replayed: false,
    });
    expect(createMediaJobInTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: '101',
        jobType: 'media_prepare',
        idempotencyKey: 'process-start-001',
        inputManifest: expect.objectContaining({
          schemaVersion: 1,
          sourceId: 'source-audio-1',
          sourceKind: 'audio',
          pipelinePlan: {
            transcribe: true,
            frameMaterialize: false,
            visualOnly: false,
          },
        }),
      }),
    );
    expect(String(queryMock.mock.calls[0]?.[0]).toLowerCase()).toContain('for update');
  });

  it('replays process.start after the original transaction committed without creating another job', async () => {
    const inputManifest = {
      schemaVersion: 1,
      sessionId: '101',
      sourceId: 'source-audio-1',
      sourceKind: 'audio',
      sourceAsset: {
        objectKey: 'skill-sessions/101/source/audio.wav',
        mimeType: 'audio/wav',
        sizeBytes: 32_078,
        sha256: 'a'.repeat(64),
      },
      sourceProbe: {
        durationMs: 1_000,
        formatName: 'wav',
        hasAudio: true,
        hasVideo: false,
        audioStreamCount: 1,
        videoStreamCount: 0,
        primaryAudioStreamIndex: 0,
        primaryVideoStreamIndex: null,
      },
      qualityManifestRef: {
        objectKey:
          'skill-sessions/101/manifest/media-quality-check/job-700-attempt-1.json',
        mimeType: 'application/json',
        sizeBytes: 512,
        sha256: 'b'.repeat(64),
      },
      processingConfig: {
        understandingMode: 'auto',
        transcriptionMode: 'deploymentDefault',
      },
      pipelinePlan: {
        transcribe: true,
        frameMaterialize: false,
        visualOnly: false,
      },
    };
    const requestHash = __testing.buildProcessStartRequestHash({
      sessionId: '101',
      expectedRevisionNo: 2,
      inputManifest,
    });
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          createSessionRow({
            media_stage: 'preparing_media',
            revision_no: 3,
            media_state_json: createReadyAudioState(),
          }),
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [
          createJobRow({
            id: '701',
            job_type: 'media_prepare',
            status: 'queued',
            idempotency_key: 'process-start-001',
            request_hash: requestHash,
            attempt_no: 0,
            input_manifest_json: inputManifest,
          }),
        ],
        rowCount: 1,
      });
    const createMediaJobInTransaction = vi.fn();
    const service = createMultimodalGuidedCreationService({
      query: queryMock,
      withTransaction: async (callback) => callback({ query: queryMock }),
      createMediaJobInTransaction,
    });

    const result = await service.startProcessing({
      authUserId: 'user-1',
      sessionId: '101',
      idempotencyKey: 'process-start-001',
      expectedRevisionNo: 2,
      understandingMode: 'auto',
      transcriptionMode: 'deploymentDefault',
    });

    expect(result).toMatchObject({
      sessionId: '101',
      revisionNo: 3,
      mediaStage: 'preparing_media',
      job: { jobId: '701', jobType: 'media_prepare', status: 'queued' },
      pipelinePlan: { transcribe: true, frameMaterialize: false },
      replayed: true,
    });
    expect(createMediaJobInTransaction).not.toHaveBeenCalled();
  });

  it('retries only a retryable terminal job by creating a new job row and restoring its stage', async () => {
    const queryMock = vi.fn();
    const failedRow = createSessionRow({
      status: 'failed',
      media_stage: 'failed',
      revision_no: 4,
      media_state_json: createReadyAudioState(),
    });
    const resumedRow = createSessionRow({
      media_stage: 'transcribing',
      revision_no: 5,
      media_state_json: createReadyAudioState(),
    });
    queryMock
      .mockResolvedValueOnce({ rows: [failedRow], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [
          createJobRow({
            id: '701',
            session_id: '101',
            job_type: 'transcribe',
            status: 'failed',
            attempt_no: 3,
            max_attempts: 3,
            input_manifest_json: { schemaVersion: 1, sourceId: 'source-audio-1' },
            error_json: {
              code: 'ASR_FAILED',
              message: 'Transcription failed',
              retryable: true,
              details: { resumeFromStage: 'transcribing' },
            },
          }),
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [resumedRow], rowCount: 1 });
    const createMediaJobInTransaction = vi.fn().mockResolvedValue({
      jobId: '702',
      jobType: 'transcribe',
      status: 'queued',
      attemptNo: 0,
    });
    const service = createMultimodalGuidedCreationService({
      query: queryMock,
      withTransaction: async (callback) => callback({ query: queryMock }),
      now: () => new Date('2026-08-21T10:02:00.000Z'),
      createMediaJobInTransaction,
    });

    const result = await service.retryProcessing({
      authUserId: 'user-1',
      sessionId: '101',
      idempotencyKey: 'process-retry-001',
      expectedRevisionNo: 4,
      failedJobId: '701',
    });

    expect(result).toMatchObject({
      sessionId: '101',
      revisionNo: 5,
      mediaStage: 'transcribing',
      retriedJobId: '701',
      job: { jobId: '702', jobType: 'transcribe', status: 'queued' },
    });
    expect(createMediaJobInTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        jobType: 'transcribe',
        idempotencyKey: 'process-retry-001',
        inputManifest: { schemaVersion: 1, sourceId: 'source-audio-1' },
        requestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(
      queryMock.mock.calls.some(([sql]) =>
        /update\s+skill_media_jobs/i.test(String(sql)),
      ),
    ).toBe(false);
  });

  it('resumes a retryable pipeline failure without requiring a worker job id', async () => {
    const resumePipelineFailure = vi.fn().mockResolvedValue({
      sessionId: '101',
      revisionNo: 15,
      mediaStage: 'building_skills',
    });
    const service = createMultimodalGuidedCreationService({
      pipelineFailureResumer: { resumePipelineFailure },
    });

    const result = await service.retryProcessing({
      authUserId: 'user-1',
      sessionId: '101',
      idempotencyKey: 'pipeline-retry-001',
      expectedRevisionNo: 14,
    });

    expect(resumePipelineFailure).toHaveBeenCalledWith({
      authUserId: 'user-1',
      sessionId: '101',
      expectedRevisionNo: 14,
    });
    expect(result).toEqual({
      sessionId: '101',
      revisionNo: 15,
      mediaStage: 'building_skills',
      retriedJobId: null,
      job: null,
      replayed: false,
    });
  });

  it('retries the legacy visual detector parser failure after the worker upgrade', async () => {
    const queryMock = vi.fn();
    const failedRow = createSessionRow({
      status: 'failed',
      media_stage: 'failed',
      revision_no: 5,
      media_state_json: createReadyAudioState(),
    });
    const resumedRow = createSessionRow({
      media_stage: 'preparing_media',
      revision_no: 6,
      media_state_json: createReadyAudioState(),
    });
    const failedInputManifest = {
      schemaVersion: 1,
      sourceId: 'source-video-1',
      sourceKind: 'video',
    };
    queryMock
      .mockResolvedValueOnce({ rows: [failedRow], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [
          createJobRow({
            id: '702',
            session_id: '101',
            job_type: 'media_prepare',
            status: 'failed',
            attempt_no: 1,
            max_attempts: 3,
            input_manifest_json: failedInputManifest,
            error_json: {
              code: 'VISUAL_SIGNAL_DETECT_FAILED',
              message: 'Media processing failed',
              retryable: false,
              details: { resumeFromStage: 'preparing_media' },
            },
          }),
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [resumedRow], rowCount: 1 });
    const createMediaJobInTransaction = vi.fn().mockResolvedValue({
      jobId: '703',
      jobType: 'media_prepare',
      status: 'queued',
      attemptNo: 0,
    });
    const service = createMultimodalGuidedCreationService({
      query: queryMock,
      withTransaction: async (callback) => callback({ query: queryMock }),
      now: () => new Date('2026-08-23T15:30:00.000Z'),
      createMediaJobInTransaction,
    });

    const result = await service.retryProcessing({
      authUserId: 'user-1',
      sessionId: '101',
      idempotencyKey: 'process-retry-visual-parser-001',
      expectedRevisionNo: 5,
      failedJobId: '702',
    });

    expect(result).toMatchObject({
      sessionId: '101',
      revisionNo: 6,
      mediaStage: 'preparing_media',
      retriedJobId: '702',
      job: { jobId: '703', jobType: 'media_prepare', status: 'queued' },
    });
    expect(createMediaJobInTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        jobType: 'media_prepare',
        inputManifest: failedInputManifest,
      }),
    );
  });

  it.each(['WORKER_LEASE_EXPIRED', 'OBJECT_STORAGE_WRITE_FAILED'])(
    'retries a legacy transcription %s failure after the worker upgrade',
    async (errorCode) => {
    const queryMock = vi.fn();
    const failedInputManifest = {
      schemaVersion: 1,
      sourceId: 'source-video-1',
      durationMs: 741_077,
    };
    queryMock
      .mockResolvedValueOnce({
        rows: [
          createSessionRow({
            status: 'failed',
            media_stage: 'failed',
            revision_no: 8,
            media_state_json: createReadyAudioState(),
          }),
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [
          createJobRow({
            id: '704',
            session_id: '101',
            job_type: 'transcribe',
            status: 'failed',
            attempt_no: 3,
            max_attempts: 3,
            input_manifest_json: failedInputManifest,
            error_json: {
              code: errorCode,
              message: 'Legacy worker failed before completion',
              retryable: false,
              details: { resumeFromStage: 'transcribing' },
            },
          }),
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [
          createSessionRow({
            media_stage: 'transcribing',
            revision_no: 9,
            media_state_json: createReadyAudioState(),
          }),
        ],
        rowCount: 1,
      });
    const createMediaJobInTransaction = vi.fn().mockResolvedValue({
      jobId: '705',
      jobType: 'transcribe',
      status: 'queued',
      attemptNo: 0,
    });
    const service = createMultimodalGuidedCreationService({
      query: queryMock,
      withTransaction: async (callback) => callback({ query: queryMock }),
      createMediaJobInTransaction,
    });

    const result = await service.retryProcessing({
      authUserId: 'user-1',
      sessionId: '101',
      idempotencyKey: `process-retry-${errorCode.toLowerCase()}-upgrade-001`,
      expectedRevisionNo: 8,
      failedJobId: '704',
    });

    expect(result).toMatchObject({
      revisionNo: 9,
      mediaStage: 'transcribing',
      retriedJobId: '704',
      job: { jobId: '705', jobType: 'transcribe', status: 'queued' },
    });
    },
  );

  it.each([
    ['FRAME_MATERIALIZE_FAILED', 'output-token'],
    ['DATA_INTEGRITY_ERROR', 'canonical-hash'],
  ])(
    'retries the legacy frame %s failure after the worker upgrade (%s)',
    async (errorCode) => {
    const failedInputManifest = {
      schemaVersion: 1,
      sourceId: 'source-video-1',
      frameRequests: [
        {
          candidateId: 'frame-001',
          semanticMomentId: 'moment-001',
          timestampMs: 1_000,
          sourceSignal: 'semantic_moment',
          selectionReason: 'semantic anchor',
        },
      ],
    };
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          createSessionRow({
            status: 'failed',
            media_stage: 'failed',
            revision_no: 14,
            media_state_json: createReadyAudioState(),
          }),
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [
          createJobRow({
            id: '707',
            session_id: '101',
            job_type: 'frame_materialize',
            status: 'failed',
            attempt_no: 1,
            max_attempts: 3,
            input_manifest_json: failedInputManifest,
            error_json: {
              code: errorCode,
              message: 'Media processing failed',
              retryable: false,
              details: { resumeFromStage: 'building_evidence' },
            },
          }),
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [
          createSessionRow({
            media_stage: 'building_evidence',
            revision_no: 15,
            media_state_json: createReadyAudioState(),
          }),
        ],
        rowCount: 1,
      });
    const createMediaJobInTransaction = vi.fn().mockResolvedValue({
      jobId: '708',
      jobType: 'frame_materialize',
      status: 'queued',
      attemptNo: 0,
    });
    const service = createMultimodalGuidedCreationService({
      query: queryMock,
      withTransaction: async (callback) => callback({ query: queryMock }),
      createMediaJobInTransaction,
    });

    const result = await service.retryProcessing({
      authUserId: 'user-1',
      sessionId: '101',
      idempotencyKey: 'process-retry-frame-token-upgrade-001',
      expectedRevisionNo: 14,
      failedJobId: '707',
    });

    expect(result).toMatchObject({
      revisionNo: 15,
      mediaStage: 'building_evidence',
      retriedJobId: '707',
      job: { jobId: '708', jobType: 'frame_materialize', status: 'queued' },
    });
    },
  );

  it('replays retry after its session transition committed without mutating the failed job', async () => {
    const failedInputManifest = {
      schemaVersion: 1,
      sourceId: 'source-audio-1',
    };
    const requestHash = __testing.buildRetryRequestHash({
      sessionId: '101',
      failedJobId: '701',
      jobType: 'transcribe',
      inputManifest: failedInputManifest,
    });
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          createSessionRow({
            media_stage: 'transcribing',
            revision_no: 5,
            media_state_json: createReadyAudioState(),
          }),
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [
          createJobRow({
            id: '701',
            job_type: 'transcribe',
            status: 'failed',
            attempt_no: 3,
            max_attempts: 3,
            input_manifest_json: failedInputManifest,
            error_json: {
              code: 'ASR_FAILED',
              message: 'Transcription failed',
              retryable: true,
              details: { resumeFromStage: 'transcribing' },
            },
          }),
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [
          createJobRow({
            id: '702',
            job_type: 'transcribe',
            status: 'queued',
            idempotency_key: 'process-retry-001',
            request_hash: requestHash,
            attempt_no: 0,
            input_manifest_json: failedInputManifest,
          }),
        ],
        rowCount: 1,
      });
    const createMediaJobInTransaction = vi.fn();
    const service = createMultimodalGuidedCreationService({
      query: queryMock,
      withTransaction: async (callback) => callback({ query: queryMock }),
      createMediaJobInTransaction,
    });

    const result = await service.retryProcessing({
      authUserId: 'user-1',
      sessionId: '101',
      idempotencyKey: 'process-retry-001',
      expectedRevisionNo: 4,
      failedJobId: '701',
    });

    expect(result).toMatchObject({
      sessionId: '101',
      revisionNo: 5,
      mediaStage: 'transcribing',
      retriedJobId: '701',
      job: { jobId: '702', jobType: 'transcribe', status: 'queued' },
      replayed: true,
    });
    expect(createMediaJobInTransaction).not.toHaveBeenCalled();
    expect(
      queryMock.mock.calls.some(([sql]) => /update\s+/i.test(String(sql))),
    ).toBe(false);
  });

  it('cancels the session and every queued or leased job with revision CAS', async () => {
    const queryMock = vi.fn();
    queryMock
      .mockResolvedValueOnce({
        rows: [
          createSessionRow({
            media_stage: 'transcribing',
            revision_no: 5,
            media_state_json: createReadyAudioState(),
          }),
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [{ id: '701' }, { id: '702' }], rowCount: 2 })
      .mockResolvedValueOnce({
        rows: [
          createSessionRow({
            status: 'cancelled',
            media_stage: 'cancelled',
            revision_no: 6,
            media_state_json: createReadyAudioState(),
          }),
        ],
        rowCount: 1,
      });
    const service = createMultimodalGuidedCreationService({
      query: queryMock,
      withTransaction: async (callback) => callback({ query: queryMock }),
      now: () => new Date('2026-08-21T10:03:00.000Z'),
    });

    const result = await service.cancelProcessing({
      authUserId: 'user-1',
      sessionId: '101',
      expectedRevisionNo: 5,
    });

    expect(result).toEqual({
      sessionId: '101',
      revisionNo: 6,
      mediaStage: 'cancelled',
      cancelledJobCount: 2,
    });
    expect(String(queryMock.mock.calls[1]?.[0]).toLowerCase()).toContain(
      "status in ('queued', 'leased')",
    );
  });

  it('logically deletes an unpublished workspace without calling object storage deletion', async () => {
    const queryMock = vi.fn();
    queryMock
      .mockResolvedValueOnce({
        rows: [
          createSessionRow({
            media_stage: 'ready_to_process',
            revision_no: 2,
            media_state_json: createReadyAudioState(),
            package_version_id: null,
          }),
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [{ id: '701' }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [
          {
            id: '101',
            revision_no: 3,
            deleted_at: '2026-08-21T10:04:00.000Z',
          },
        ],
        rowCount: 1,
      });
    const objectStorageService = { deleteObject: vi.fn() };
    const service = createMultimodalGuidedCreationService({
      query: queryMock,
      withTransaction: async (callback) => callback({ query: queryMock }),
      now: () => new Date('2026-08-21T10:04:00.000Z'),
      objectStorageService: objectStorageService as never,
    });

    const result = await service.deleteSession({
      authUserId: 'user-1',
      sessionId: '101',
      expectedRevisionNo: 2,
    });

    expect(result).toEqual({
      sessionId: '101',
      revisionNo: 3,
      deletedAt: '2026-08-21T10:04:00.000Z',
    });
    expect(objectStorageService.deleteObject).not.toHaveBeenCalled();
    expect(String(queryMock.mock.calls[2]?.[0]).toLowerCase()).toContain(
      'set deleted_at =',
    );
  });

  it('signs only assets referenced by an owned media session', async () => {
    const objectKey =
      'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4';
    const queryMock = vi.fn().mockResolvedValue({
      rows: [
        createSessionRow({
          media_stage: 'ready_to_process',
          media_state_json: {
            ...createReadyAudioState(),
            primarySource: {
              sourceId: 'source-1',
              kind: 'video',
              assetRef: {
                objectKey,
                mimeType: 'video/mp4',
                sizeBytes: 1024,
                sha256: 'a'.repeat(64),
              },
            },
          },
        }),
      ],
      rowCount: 1,
    });
    const createSignedGetGrant = vi.fn().mockResolvedValue({
      method: 'GET',
      objectKey,
      url: 'https://storage.example/signed-preview',
      expiresAt: '2026-08-21T10:05:00.000Z',
      requiredHeaders: {},
    });
    const service = createMultimodalGuidedCreationService({
      query: queryMock,
      objectStorageService: { createSignedGetGrant } as never,
    });

    await expect(
      service.createAssetPreview({
        authUserId: 'user-1',
        sessionId: '101',
        objectKey,
      }),
    ).resolves.toEqual({
      url: 'https://storage.example/signed-preview',
      expiresAt: '2026-08-21T10:05:00.000Z',
      mimeType: 'video/mp4',
    });
    await expect(
      service.createAssetPreview({
        authUserId: 'user-1',
        sessionId: '101',
        objectKey: 'skill-sessions/101/source/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.mp4',
      }),
    ).rejects.toMatchObject({ code: 'MEDIA_ASSET_NOT_FOUND' });
    expect(createSignedGetGrant).toHaveBeenCalledTimes(1);
  });
});
