import { describe, expect, it, vi } from 'vitest';
import {
  parseMultimodalSessionState,
  type MultimodalSessionState,
} from '@educlaw/shared';
import { GuidedCreationError } from './guided-creation-service.js';
import {
  createMultimodalPipelineOrchestrator,
  type MultimodalPipelineSnapshot,
  type MultimodalPipelineStore,
} from './multimodal-pipeline-orchestrator';

function makeState(
  overrides?: Partial<MultimodalSessionState>,
): MultimodalSessionState {
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

function makeSnapshot(input?: {
  mediaStage?: MultimodalPipelineSnapshot['mediaStage'];
  revisionNo?: number;
  status?: MultimodalPipelineSnapshot['status'];
  confirmedStages?: MultimodalPipelineSnapshot['confirmedStages'];
  mediaState?: Partial<MultimodalSessionState>;
  error?: MultimodalPipelineSnapshot['error'];
}): MultimodalPipelineSnapshot {
  return {
    sessionId: '101',
    displayName: '多模态课程',
    status: input?.status ?? 'collecting',
    mediaStage: input?.mediaStage ?? 'extracting_candidates',
    revisionNo: input?.revisionNo ?? 3,
    createdAt: '2026-08-21T09:59:00.000Z',
    updatedAt: '2026-08-21T10:00:00.000Z',
    mediaState: makeState(input?.mediaState),
    confirmedStages: input?.confirmedStages ?? ['adler_overview'],
    error: input?.error ?? null,
  };
}

function makeStore(
  overrides: Partial<MultimodalPipelineStore>,
): MultimodalPipelineStore {
  return {
    loadSessionSnapshot: vi.fn(),
    persistCandidatePasses: vi.fn(),
    persistValidatedCandidates: vi.fn(),
    persistCandidateSkills: vi.fn(),
    persistPipelineFailure: vi.fn(),
    ...overrides,
  };
}

describe('multimodal pipeline orchestrator', () => {
  it('runs extracting to validating to awaiting with H calls outside persistence and carries review context', async () => {
    const events: string[] = [];
    const extracting = makeSnapshot();
    const validating = makeSnapshot({
      mediaStage: 'validating_candidates',
      revisionNo: 4,
      mediaState: {
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
          frameworks: {
            model: 'framework-model',
            promptVersion: 'framework-prompt',
          },
          principles: {
            model: 'principle-model',
            promptVersion: 'principle-prompt',
          },
          cases: { model: 'case-model', promptVersion: 'case-prompt' },
          counterexamples: {
            model: 'counter-model',
            promptVersion: 'counter-prompt',
          },
          terms: { model: 'term-model', promptVersion: 'term-prompt' },
        },
      },
    });
    const awaiting = makeSnapshot({
      mediaStage: 'awaiting_candidates',
      revisionNo: 5,
      status: 'ready_for_confirmation',
      mediaState: {
        candidatePasses: validating.mediaState.candidatePasses,
        candidatePassMeta: validating.mediaState.candidatePassMeta,
        candidateValidations: [
          {
            candidate: validating.mediaState.candidatePasses.frameworks[0]!,
            validation: {
              v1: {
                passed: true,
                reason: 'ok',
                reusableContexts: ['高一例题课', '高二错题课'],
                proofSatisfied: true,
              },
              v2: {
                passed: true,
                reason: 'ok',
                novelScenario: '晚自习追问',
                capability: 'guide',
                proofSatisfied: true,
              },
              v3: {
                passed: true,
                reason: 'ok',
                differentiators: ['区分定义与结论'],
                proofSatisfied: true,
              },
            },
            overallPassed: true,
            disposition: 'retain',
          },
        ],
      },
    });
    const store = makeStore({
      loadSessionSnapshot: vi.fn(async () => {
        events.push('load');
        return extracting;
      }),
      persistCandidatePasses: vi.fn(async () => {
        events.push('persist-pass');
        return validating;
      }),
      persistValidatedCandidates: vi.fn(async () => {
        events.push('persist-validation');
        return awaiting;
      }),
    });
    const sessionService = {
      extractCandidatePasses: vi.fn(async (input) => {
        events.push('extract');
        expect(input.adlerOverviewReview).toEqual({
          title: '教师确认标题',
          approved: true,
          userNotes: '',
        });
        return {
          candidatePasses: validating.mediaState.candidatePasses,
          passMeta: {
            frameworks: {
              model: 'framework-model',
              promptVersion: 'framework-prompt',
            },
            principles: {
              model: 'principle-model',
              promptVersion: 'principle-prompt',
            },
            cases: { model: 'case-model', promptVersion: 'case-prompt' },
            counterexamples: {
              model: 'counter-model',
              promptVersion: 'counter-prompt',
            },
            terms: { model: 'term-model', promptVersion: 'term-prompt' },
          },
        };
      }),
      validateCandidatePasses: vi.fn(async () => {
        events.push('validate');
        return { results: awaiting.mediaState.candidateValidations };
      }),
      fuseCandidatePasses: vi.fn(async () => ({
        candidates: [],
        validations: [],
        meta: null,
      })),
      buildRiaSkills: vi.fn(),
    };
    const orchestrator = createMultimodalPipelineOrchestrator({
      store,
      sessionService,
    });

    const result = await orchestrator.runCandidatePipeline({
      authUserId: 'user-1',
      sessionId: '101',
    });

    expect(result.mediaStage).toBe('awaiting_candidates');
    expect(events).toEqual([
      'load',
      'extract',
      'persist-pass',
      'validate',
      'persist-validation',
    ]);
  });

  it('resumes validating without repeating extraction and treats awaiting as a no-op', async () => {
    const validating = makeSnapshot({
      mediaStage: 'validating_candidates',
      revisionNo: 4,
      mediaState: {
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
          frameworks: {
            model: 'framework-model',
            promptVersion: 'framework-prompt',
          },
          principles: {
            model: 'principle-model',
            promptVersion: 'principle-prompt',
          },
          cases: { model: 'case-model', promptVersion: 'case-prompt' },
          counterexamples: {
            model: 'counter-model',
            promptVersion: 'counter-prompt',
          },
          terms: { model: 'term-model', promptVersion: 'term-prompt' },
        },
      },
    });
    const awaiting = makeSnapshot({
      mediaStage: 'awaiting_candidates',
      revisionNo: 5,
      status: 'ready_for_confirmation',
      mediaState: {
        candidatePasses: validating.mediaState.candidatePasses,
        candidatePassMeta: validating.mediaState.candidatePassMeta,
        candidateValidations: [
          {
            candidate: validating.mediaState.candidatePasses.frameworks[0]!,
            validation: {
              v1: {
                passed: true,
                reason: 'ok',
                reusableContexts: ['高一例题课', '高二错题课'],
                proofSatisfied: true,
              },
              v2: {
                passed: true,
                reason: 'ok',
                novelScenario: '晚自习追问',
                capability: 'guide',
                proofSatisfied: true,
              },
              v3: {
                passed: true,
                reason: 'ok',
                differentiators: ['区分定义与结论'],
                proofSatisfied: true,
              },
            },
            overallPassed: true,
            disposition: 'retain',
          },
        ],
      },
    });
    const store = makeStore({
      loadSessionSnapshot: vi
        .fn()
        .mockResolvedValueOnce(validating)
        .mockResolvedValueOnce(awaiting),
      persistValidatedCandidates: vi.fn(async () => awaiting),
    });
    const sessionService = {
      extractCandidatePasses: vi.fn(),
      validateCandidatePasses: vi.fn(async () => ({
        results: awaiting.mediaState.candidateValidations,
      })),
      fuseCandidatePasses: vi.fn(async () => ({
        candidates: [],
        validations: [],
        meta: null,
      })),
      buildRiaSkills: vi.fn(),
    };
    const orchestrator = createMultimodalPipelineOrchestrator({
      store,
      sessionService,
    });

    const resumed = await orchestrator.runCandidatePipeline({
      authUserId: 'user-1',
      sessionId: '101',
    });
    const noop = await orchestrator.runCandidatePipeline({
      authUserId: 'user-1',
      sessionId: '101',
    });

    expect(resumed.mediaStage).toBe('awaiting_candidates');
    expect(noop.mediaStage).toBe('awaiting_candidates');
    expect(sessionService.extractCandidatePasses).not.toHaveBeenCalled();
    expect(sessionService.validateCandidatePasses).toHaveBeenCalledTimes(1);

    const failed = makeSnapshot({
      mediaStage: 'failed',
      revisionNo: 5,
      status: 'failed',
      mediaState: validating.mediaState,
      error: {
        code: 'MULTIMODAL_PIPELINE_FAILED',
        stage: 'validating_candidates',
        retryable: true,
        message: '候选校验未完成',
        resumeStage: 'validating_candidates',
      },
    });
    const persistPipelineFailure = vi.fn(async () => failed);
    const persistenceFailureOrchestrator = createMultimodalPipelineOrchestrator(
      {
        store: makeStore({
          loadSessionSnapshot: vi.fn(async () => validating),
          persistValidatedCandidates: vi.fn(async () => {
            throw new Error('database serialization failed');
          }),
          persistPipelineFailure,
        }),
        sessionService,
      },
    );

    await expect(
      persistenceFailureOrchestrator.runCandidatePipeline({
        authUserId: 'user-1',
        sessionId: '101',
      }),
    ).rejects.toMatchObject({ code: 'MULTIMODAL_PIPELINE_FAILED' });
    expect(persistPipelineFailure).toHaveBeenCalledTimes(1);
  });

  it('runs building_skills to arena_testing and treats arena_testing as a no-op', async () => {
    const building = makeSnapshot({
      mediaStage: 'building_skills',
      revisionNo: 6,
      confirmedStages: ['adler_overview', 'evidence_and_candidates'],
      mediaState: {
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
          fused: [
            {
              candidateId: 'fused-1',
              passKey: 'fused',
              title: '融合主题',
              summary: 'fused summary',
              reusableRule: 'fused rule',
              evidenceIds: ['ev-transcript'],
              claimType: 'modelInference',
              visualAssertion: false,
            },
          ],
        },
        candidatePassMeta: {
          frameworks: {
            model: 'framework-model',
            promptVersion: 'framework-prompt',
          },
          principles: {
            model: 'principle-model',
            promptVersion: 'principle-prompt',
          },
          cases: { model: 'case-model', promptVersion: 'case-prompt' },
          counterexamples: {
            model: 'counter-model',
            promptVersion: 'counter-prompt',
          },
          terms: { model: 'term-model', promptVersion: 'term-prompt' },
          fused: { model: 'fusion-model', promptVersion: 'fusion-prompt' },
        },
        candidateValidations: [
          {
            candidate: {
              candidateId: 'c1',
              passKey: 'frameworks',
              title: '结构化框架',
              summary: 'summary',
              reusableRule: 'rule',
              evidenceIds: ['ev-transcript'],
              claimType: 'sourceFact',
              visualAssertion: false,
            },
            validation: {
              v1: {
                passed: true,
                reason: 'ok',
                reusableContexts: ['高一例题课', '高二错题课'],
                proofSatisfied: true,
              },
              v2: {
                passed: true,
                reason: 'ok',
                novelScenario: '晚自习追问',
                capability: 'guide',
                proofSatisfied: true,
              },
              v3: {
                passed: true,
                reason: 'ok',
                differentiators: ['区分定义与结论'],
                proofSatisfied: true,
              },
            },
            overallPassed: true,
            disposition: 'retain',
          },
          {
            candidate: {
              candidateId: 'fused-1',
              passKey: 'fused',
              title: '融合主题',
              summary: 'fused summary',
              reusableRule: 'fused rule',
              evidenceIds: ['ev-transcript'],
              claimType: 'modelInference',
              visualAssertion: false,
            },
            validation: {
              v1: {
                passed: true,
                reason: 'ok',
                reusableContexts: ['高一例题课', '高二错题课'],
                proofSatisfied: true,
              },
              v2: {
                passed: true,
                reason: 'ok',
                novelScenario: '晚自习追问',
                capability: 'guide',
                proofSatisfied: true,
              },
              v3: {
                passed: true,
                reason: 'ok',
                differentiators: ['区分定义与结论'],
                proofSatisfied: true,
              },
            },
            overallPassed: true,
            disposition: 'retain',
          },
        ],
        selectedCandidateIds: ['fused-1'],
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
          {
            action: 'skill.media.candidate.confirm',
            idempotencyKey: 'candidate-confirm-001',
            requestHash: 'c'.repeat(64),
            baseRevisionNo: 5,
            resultRevisionNo: 6,
            confirmedStage: 'evidence_and_candidates',
            recordedAt: '2026-08-21T10:05:00.000Z',
          },
        ],
      },
    });
    const arena = makeSnapshot({
      mediaStage: 'arena_testing',
      revisionNo: 7,
      confirmedStages: ['adler_overview', 'evidence_and_candidates'],
      mediaState: {
        ...building.mediaState,
        candidateSkills: [
          {
            candidateId: 'fused-1',
            id: 'skill-1',
            dirName: 'skill-1',
            name: '技能一',
            description: 'desc',
            skillMd: '# skill',
            ria: {
              sourceEvidenceIds: ['ev-transcript'],
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
            evidenceIds: ['ev-transcript'],
            relations: [],
            manifest: {
              model: 'ria-model',
              promptVersion: 'ria-prompt',
              generatorVersion: 'ria-generator',
            },
          },
        ],
      },
    });
    const store = makeStore({
      loadSessionSnapshot: vi
        .fn()
        .mockResolvedValueOnce(building)
        .mockResolvedValueOnce(arena),
      persistCandidateSkills: vi.fn(async () => arena),
    });
    const sessionService = {
      extractCandidatePasses: vi.fn(),
      validateCandidatePasses: vi.fn(),
      buildRiaSkills: vi.fn(async () => ({
        skills: arena.mediaState.candidateSkills,
      })),
    };
    const orchestrator = createMultimodalPipelineOrchestrator({
      store,
      sessionService,
    });

    const built = await orchestrator.runSkillBuildPipeline({
      authUserId: 'user-1',
      sessionId: '101',
    });
    const noop = await orchestrator.runSkillBuildPipeline({
      authUserId: 'user-1',
      sessionId: '101',
    });

    expect(built.mediaStage).toBe('arena_testing');
    expect(noop.mediaStage).toBe('arena_testing');
    expect(sessionService.buildRiaSkills).toHaveBeenCalledTimes(1);
  });

  it('persists bounded failed state on H errors without leaking raw secrets and preserves CAS conflicts', async () => {
    const extracting = makeSnapshot();
    const failed = makeSnapshot({
      mediaStage: 'failed',
      revisionNo: 4,
      status: 'failed',
      error: {
        code: 'MULTIMODAL_PIPELINE_FAILED',
        stage: 'extracting_candidates',
        retryable: true,
        message: '候选提取未完成',
        resumeStage: 'extracting_candidates',
      },
    });
    const store = makeStore({
      loadSessionSnapshot: vi.fn(async () => extracting),
      persistPipelineFailure: vi.fn(async ({ error }) => {
        expect(JSON.stringify(error)).not.toContain('secret-prompt-output');
        return failed;
      }),
    });
    const sessionService = {
      extractCandidatePasses: vi.fn(async () => {
        throw new Error('secret-prompt-output');
      }),
      validateCandidatePasses: vi.fn(),
      buildRiaSkills: vi.fn(),
    };
    const orchestrator = createMultimodalPipelineOrchestrator({
      store,
      sessionService,
    });

    await expect(
      orchestrator.runCandidatePipeline({
        authUserId: 'user-1',
        sessionId: '101',
      }),
    ).rejects.toMatchObject({
      code: 'MULTIMODAL_PIPELINE_FAILED',
      retryable: true,
    });

    const conflictStore = makeStore({
      loadSessionSnapshot: vi.fn(async () => extracting),
      persistPipelineFailure: vi.fn(async () => {
        throw new GuidedCreationError(
          'SESSION_REVISION_CONFLICT',
          '会话版本已变化，请刷新后重试',
          409,
          false,
        );
      }),
    });
    const conflictOrchestrator = createMultimodalPipelineOrchestrator({
      store: conflictStore,
      sessionService,
    });

    await expect(
      conflictOrchestrator.runCandidatePipeline({
        authUserId: 'user-1',
        sessionId: '101',
      }),
    ).rejects.toMatchObject({
      code: 'SESSION_REVISION_CONFLICT',
    });
  });

  it('persists the failed state even when diagnostic logging is unavailable', async () => {
    const extracting = makeSnapshot();
    const failed = makeSnapshot({
      mediaStage: 'failed',
      revisionNo: 4,
      status: 'failed',
      error: {
        code: 'MULTIMODAL_PIPELINE_FAILED',
        stage: 'extracting_candidates',
        retryable: true,
        message: '候选提取未完成',
        resumeStage: 'extracting_candidates',
      },
    });
    const persistPipelineFailure = vi.fn(async () => failed);
    const diagnosticLogger = {
      error: vi.fn(() => {
        throw new Error('logger unavailable');
      }),
    };
    const orchestrator = createMultimodalPipelineOrchestrator({
      store: makeStore({
        loadSessionSnapshot: vi.fn(async () => extracting),
        persistPipelineFailure,
      }),
      sessionService: {
        extractCandidatePasses: vi.fn(async () => {
          throw new Error('model adapter failed');
        }),
        validateCandidatePasses: vi.fn(),
        fuseCandidatePasses: vi.fn(),
        buildRiaSkills: vi.fn(),
      },
      logger: diagnosticLogger,
    });

    await expect(
      orchestrator.runCandidatePipeline({
        authUserId: 'user-1',
        sessionId: '101',
      }),
    ).rejects.toMatchObject({ code: 'MULTIMODAL_PIPELINE_FAILED' });
    expect(diagnosticLogger.error).toHaveBeenCalledTimes(1);
    expect(persistPipelineFailure).toHaveBeenCalledTimes(1);
  });

  it('allows only one concurrent CAS winner and supports audio-only candidate extraction without frames', async () => {
    const audioState = parseMultimodalSessionState({
      ...makeState(),
      primarySource: {
        sourceId: 'source-audio',
        kind: 'audio',
        assetRef: {
          objectKey: 'skill-sessions/101/source/audio.mp3',
          mimeType: 'audio/mpeg',
          sizeBytes: 4096,
          sha256: 'd'.repeat(64),
        },
      },
      evidenceTimeline: {
        evidenceItems: [
          {
            evidenceId: 'ev-transcript',
            kind: 'transcript',
            source: {
              primarySourceId: 'source-audio',
            },
            timeRange: { startMs: 0, endMs: 1200 },
            text: '纯音频讲解',
            provenance: {
              method: 'asr',
              processorVersion: 'asr-v1',
              confidence: 0.95,
              editedByUser: false,
            },
            claimType: 'sourceFact',
            selectionReason: '转录证据',
          },
        ],
      },
    });
    const extracting = makeSnapshot({
      mediaState: audioState,
    });
    const validating = makeSnapshot({
      mediaStage: 'validating_candidates',
      revisionNo: 4,
      mediaState: {
        ...audioState,
        candidatePasses: {
          frameworks: [
            {
              candidateId: 'c1',
              passKey: 'frameworks',
              title: '纯音频规则',
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
          frameworks: {
            model: 'framework-model',
            promptVersion: 'framework-prompt',
          },
          principles: {
            model: 'principle-model',
            promptVersion: 'principle-prompt',
          },
          cases: { model: 'case-model', promptVersion: 'case-prompt' },
          counterexamples: {
            model: 'counter-model',
            promptVersion: 'counter-prompt',
          },
          terms: { model: 'term-model', promptVersion: 'term-prompt' },
        },
      },
    });
    const awaiting = makeSnapshot({
      mediaStage: 'awaiting_candidates',
      revisionNo: 5,
      status: 'ready_for_confirmation',
      mediaState: {
        ...validating.mediaState,
        candidateValidations: [
          {
            candidate: validating.mediaState.candidatePasses.frameworks[0]!,
            validation: {
              v1: {
                passed: true,
                reason: 'ok',
                reusableContexts: ['高一例题课', '高二错题课'],
                proofSatisfied: true,
              },
              v2: {
                passed: true,
                reason: 'ok',
                novelScenario: '晚自习追问',
                capability: 'guide',
                proofSatisfied: true,
              },
              v3: {
                passed: true,
                reason: 'ok',
                differentiators: ['区分定义与结论'],
                proofSatisfied: true,
              },
            },
            overallPassed: true,
            disposition: 'retain',
          },
        ],
      },
    });
    let persistCalls = 0;
    const store = makeStore({
      loadSessionSnapshot: vi.fn(async () => extracting),
      persistCandidatePasses: vi.fn(async () => {
        persistCalls += 1;
        if (persistCalls === 1) {
          return validating;
        }
        throw new GuidedCreationError(
          'SESSION_REVISION_CONFLICT',
          '会话版本已变化，请刷新后重试',
          409,
          false,
        );
      }),
      persistValidatedCandidates: vi.fn(async () => awaiting),
    });
    const sessionService = {
      extractCandidatePasses: vi.fn(async () => ({
        candidatePasses: validating.mediaState.candidatePasses,
        passMeta: {
          frameworks: {
            model: 'framework-model',
            promptVersion: 'framework-prompt',
          },
          principles: {
            model: 'principle-model',
            promptVersion: 'principle-prompt',
          },
          cases: { model: 'case-model', promptVersion: 'case-prompt' },
          counterexamples: {
            model: 'counter-model',
            promptVersion: 'counter-prompt',
          },
          terms: { model: 'term-model', promptVersion: 'term-prompt' },
        },
      })),
      validateCandidatePasses: vi.fn(async () => ({
        results: awaiting.mediaState.candidateValidations,
      })),
      fuseCandidatePasses: vi.fn(async () => ({
        candidates: [],
        validations: [],
        meta: null,
      })),
      buildRiaSkills: vi.fn(),
    };
    const orchestrator = createMultimodalPipelineOrchestrator({
      store,
      sessionService,
    });

    const [first, second] = await Promise.allSettled([
      orchestrator.runCandidatePipeline({
        authUserId: 'user-1',
        sessionId: '101',
      }),
      orchestrator.runCandidatePipeline({
        authUserId: 'user-1',
        sessionId: '101',
      }),
    ]);

    expect(first.status === 'fulfilled' || second.status === 'fulfilled').toBe(
      true,
    );
    expect(first.status === 'rejected' || second.status === 'rejected').toBe(
      true,
    );
    const rejected = first.status === 'rejected' ? first.reason : second.reason;
    expect(rejected).toMatchObject({ code: 'SESSION_REVISION_CONFLICT' });
    expect(sessionService.extractCandidatePasses).toHaveBeenCalledTimes(2);
  });

  it('fails zero-candidate extraction during validation and persists bounded failed state instead of awaiting confirmation', async () => {
    const extracting = makeSnapshot();
    const validating = makeSnapshot({
      mediaStage: 'validating_candidates',
      revisionNo: 4,
      mediaState: {
        candidatePasses: {
          frameworks: [],
          principles: [],
          cases: [],
          counterexamples: [],
          terms: [],
        },
        candidatePassMeta: {
          frameworks: {
            model: 'framework-model',
            promptVersion: 'framework-prompt',
          },
          principles: {
            model: 'principle-model',
            promptVersion: 'principle-prompt',
          },
          cases: { model: 'case-model', promptVersion: 'case-prompt' },
          counterexamples: {
            model: 'counter-model',
            promptVersion: 'counter-prompt',
          },
          terms: { model: 'term-model', promptVersion: 'term-prompt' },
        },
      },
    });
    const failed = makeSnapshot({
      mediaStage: 'failed',
      revisionNo: 5,
      status: 'failed',
      mediaState: validating.mediaState,
      error: {
        code: 'MULTIMODAL_PIPELINE_FAILED',
        stage: 'validating_candidates',
        retryable: true,
        message: '候选校验未完成',
        resumeStage: 'validating_candidates',
      },
    });
    const store = makeStore({
      loadSessionSnapshot: vi.fn(async () => extracting),
      persistCandidatePasses: vi.fn(async () => validating),
      persistValidatedCandidates: vi.fn(),
      persistPipelineFailure: vi.fn(async () => failed),
    });
    const sessionService = {
      extractCandidatePasses: vi.fn(async () => ({
        candidatePasses: validating.mediaState.candidatePasses,
        passMeta: validating.mediaState.candidatePassMeta,
      })),
      validateCandidatePasses: vi.fn(),
      buildRiaSkills: vi.fn(),
    };
    const orchestrator = createMultimodalPipelineOrchestrator({
      store,
      sessionService,
    });

    await expect(
      orchestrator.runCandidatePipeline({
        authUserId: 'user-1',
        sessionId: '101',
      }),
    ).rejects.toMatchObject({ code: 'MULTIMODAL_PIPELINE_FAILED' });
    expect(store.persistValidatedCandidates).not.toHaveBeenCalled();
    expect(store.persistPipelineFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedStage: 'validating_candidates',
      }),
    );
  });

  it('rejects invalid stages and missing prerequisites before invoking H', async () => {
    const invalidStageStore = makeStore({
      loadSessionSnapshot: vi.fn(async () =>
        makeSnapshot({ mediaStage: 'draft' }),
      ),
    });
    const sessionService = {
      extractCandidatePasses: vi.fn(),
      validateCandidatePasses: vi.fn(),
      buildRiaSkills: vi.fn(),
    };
    const orchestrator = createMultimodalPipelineOrchestrator({
      store: invalidStageStore,
      sessionService,
    });

    await expect(
      orchestrator.runCandidatePipeline({
        authUserId: 'user-1',
        sessionId: '101',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_MEDIA_STAGE' });

    const missingReviewStore = makeStore({
      loadSessionSnapshot: vi.fn(async () => ({
        ...makeSnapshot(),
        mediaState: {
          ...makeState(),
          adlerOverviewReview: null,
        },
      })),
    });
    const missingReviewOrchestrator = createMultimodalPipelineOrchestrator({
      store: missingReviewStore,
      sessionService,
    });

    await expect(
      missingReviewOrchestrator.runCandidatePipeline({
        authUserId: 'user-1',
        sessionId: '101',
      }),
    ).rejects.toMatchObject({ code: 'MULTIMODAL_PIPELINE_FAILED' });
    expect(sessionService.extractCandidatePasses).not.toHaveBeenCalled();

    const buildingWithoutSelection = makeStore({
      loadSessionSnapshot: vi.fn(async () => ({
        ...makeSnapshot({
          mediaStage: 'building_skills',
          confirmedStages: ['adler_overview', 'evidence_and_candidates'],
        }),
        mediaState: {
          ...makeState(),
          selectedCandidateIds: [],
        },
      })),
    });
    const buildingOrchestrator = createMultimodalPipelineOrchestrator({
      store: buildingWithoutSelection,
      sessionService,
    });

    await expect(
      buildingOrchestrator.runSkillBuildPipeline({
        authUserId: 'user-1',
        sessionId: '101',
      }),
    ).rejects.toMatchObject({ code: 'MULTIMODAL_PIPELINE_FAILED' });
    expect(sessionService.buildRiaSkills).not.toHaveBeenCalled();
  });
});
