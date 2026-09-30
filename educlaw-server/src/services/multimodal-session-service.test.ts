import { describe, expect, it, vi } from 'vitest';
import type {
  MultimodalEvidence,
  MultimodalPrimarySource,
  MultimodalTranscript,
} from '@educlaw/shared';
import {
  MULTIMODAL_CONFIRMATION_LABELS,
  MultimodalSessionServiceError,
  createMultimodalSessionService,
} from './multimodal-session-service';

function makePrimarySource(
  kind: 'audio' | 'video' = 'video',
): MultimodalPrimarySource {
  return {
    sourceId: `source-${kind}`,
    kind,
    assetRef: {
      objectKey: `skill-sessions/101/source/${kind}.${kind === 'audio' ? 'mp3' : 'mp4'}`,
      mimeType: kind === 'audio' ? 'audio/mpeg' : 'video/mp4',
      sizeBytes: 2048,
      sha256: 'a'.repeat(64),
    },
  };
}

function makeTranscript(
  status: MultimodalTranscript['status'] = 'ready',
): MultimodalTranscript {
  return {
    status,
    editable: true,
    segments: [
      {
        startMs: 0,
        endMs: 1200,
        text: '老师先给出定义，再解释适用边界',
        confidence: status === 'ready' ? 0.95 : 0.4,
        editedByUser: false,
      },
    ],
  };
}

function makeReview() {
  return {
    title: '教师确认标题',
    approved: true as const,
    userNotes: '',
  };
}

function makeEvidenceTimeline(
  sourceId = 'source-video',
  options?: {
    includeFrame?: boolean;
    transcriptConfidence?: number;
    transcriptEditedByUser?: boolean;
  },
): MultimodalEvidence[] {
  const includeFrame = options?.includeFrame ?? true;
  return [
    {
      evidenceId: 'ev-transcript',
      kind: 'transcript',
      source: { primarySourceId: sourceId },
      timeRange: { startMs: 0, endMs: 1200 },
      text: '老师先给出定义，再解释适用边界',
      provenance: {
        method: 'asr',
        processorVersion: 'asr-v1',
        confidence: options?.transcriptConfidence ?? 0.95,
        editedByUser: options?.transcriptEditedByUser ?? false,
      },
      claimType: 'sourceFact',
      selectionReason: '转录核心定义',
    },
    {
      evidenceId: 'ev-audio',
      kind: 'audio_segment',
      source: { primarySourceId: sourceId },
      timeRange: { startMs: 0, endMs: 1200 },
      text: '口头强调可迁移规则',
      assetRef: {
        objectKey: 'skill-sessions/101/audio/segment-1.wav',
        mimeType: 'audio/wav',
        sizeBytes: 1024,
        sha256: 'b'.repeat(64),
      },
      provenance: {
        method: 'audio-cut',
        processorVersion: 'audio-v1',
        confidence: 0.95,
        editedByUser: false,
      },
      claimType: 'sourceFact',
      selectionReason: '可回放音频证据',
    },
    ...(includeFrame
      ? [
          {
            evidenceId: 'ev-frame',
            kind: 'frame' as const,
            source: {
              primarySourceId: sourceId,
              relatedAssetRef: {
                objectKey: 'skill-sessions/101/source/video.mp4',
                mimeType: 'video/mp4',
                sizeBytes: 2048,
                sha256: 'a'.repeat(64),
              },
            },
            timeRange: { startMs: 500, endMs: 501 },
            text: '白板上写出规则和反例',
            assetRef: {
              objectKey: 'skill-sessions/101/frames/selected/frame-1.png',
              mimeType: 'image/png',
              sizeBytes: 512,
              sha256: 'c'.repeat(64),
            },
            provenance: {
              method: 'vision_soft_ranking',
              processorVersion: 'vision-v1',
              confidence: 0.8,
              editedByUser: false,
            },
            claimType: 'modelInference' as const,
            selectionReason: '呈现白板内容',
          },
        ]
      : []),
  ];
}

describe('multimodal session service', () => {
  it('exports the exact three confirmation labels and blocks candidate extraction without Adler confirmation', async () => {
    expect(MULTIMODAL_CONFIRMATION_LABELS).toEqual({
      adler_overview: 'Adler Overview',
      evidence_and_candidates: '证据与候选 Skill',
      publish: '发布',
    });

    const service = createMultimodalSessionService({
      adlerAdapter: { generate: vi.fn() },
      candidateAdapter: { extractPass: vi.fn() },
      validationAdapter: { validate: vi.fn() },
      riaAdapter: { buildSkills: vi.fn() },
    });

    await expect(
      service.extractCandidatePasses({
        primarySource: makePrimarySource(),
        transcript: makeTranscript(),
        evidenceTimeline: makeEvidenceTimeline(),
        confirmedStages: [],
        adlerOverview: {
          structure: [],
          interpretation: [],
          critique: [],
          application: [],
        },
        adlerOverviewReview: makeReview(),
      }),
    ).rejects.toMatchObject({ code: 'MULTIMODAL_SESSION_FAILED' });
  });

  it('parses Adler output into exact four layers and strips leaking model text from stable errors', async () => {
    const degradations = [
      {
        code: 'NO_AUDIO_TRACK',
        message: 'Video source has no audio track',
        semanticMomentId: 'moment-001',
      },
      {
        code: 'ASR_LOW_CONFIDENCE_UNCONFIRMED',
        message: 'ASR output needs human confirmation',
      },
    ] as const;

    const generate = vi.fn(async () => ({
      overview: {
        structure: [
          {
            text: '先定义再举例',
            evidenceIds: ['ev-transcript'],
            claimType: 'sourceFact',
          },
        ],
        interpretation: [
          {
            text: '白板内容补充了口头定义',
            evidenceIds: ['ev-frame'],
            claimType: 'modelInference',
          },
        ],
        critique: [],
        application: [],
      },
      model: 'test-model',
      promptVersion: 'prompt-v1',
      generatorVersion: 'generator-v1',
    }));

    const service = createMultimodalSessionService({
      adlerAdapter: {
        generate,
      },
      candidateAdapter: { extractPass: vi.fn() },
      validationAdapter: { validate: vi.fn() },
      riaAdapter: { buildSkills: vi.fn() },
    });

    const result = await service.generateAdlerOverview({
      primarySource: makePrimarySource(),
      transcript: makeTranscript(),
      evidenceTimeline: makeEvidenceTimeline(),
      degradations,
    });

    expect(result.overview.structure).toHaveLength(1);
    expect(result.meta.model).toBe('test-model');
    expect(result.meta.degradations).toEqual(degradations);
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        degradations,
      }),
    );

    const leakingService = createMultimodalSessionService({
      adlerAdapter: {
        generate: vi.fn(async () => {
          throw new Error('secret-prompt-output');
        }),
      },
      candidateAdapter: { extractPass: vi.fn() },
      validationAdapter: { validate: vi.fn() },
      riaAdapter: { buildSkills: vi.fn() },
    });

    let thrown: unknown;
    try {
      await leakingService.generateAdlerOverview({
        primarySource: makePrimarySource(),
        transcript: makeTranscript(),
        evidenceTimeline: makeEvidenceTimeline(),
        degradations,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(MultimodalSessionServiceError);
    expect(String(thrown)).not.toContain('secret-prompt-output');

    const invalidInputService = createMultimodalSessionService({
      adlerAdapter: { generate: vi.fn() },
      candidateAdapter: { extractPass: vi.fn() },
      validationAdapter: { validate: vi.fn() },
      riaAdapter: { buildSkills: vi.fn() },
    });

    await expect(
      invalidInputService.generateAdlerOverview({
        primarySource: makePrimarySource(),
        transcript: makeTranscript(),
        evidenceTimeline: makeEvidenceTimeline(),
        degradations: [
          {
            code: 'BAD_DEGRADATION',
            message: 'x'.repeat(513),
            extra: true,
          } as never,
        ],
      }),
    ).rejects.toMatchObject({ code: 'MULTIMODAL_SESSION_FAILED' });

    const forgedDegradationService = createMultimodalSessionService({
      adlerAdapter: {
        generate: vi.fn(async () => ({
          overview: {
            structure: [],
            interpretation: [],
            critique: [],
            application: [],
          },
          model: 'test-model',
          promptVersion: 'prompt-v1',
          generatorVersion: 'generator-v1',
          degradations: [],
        })),
      },
      candidateAdapter: { extractPass: vi.fn() },
      validationAdapter: { validate: vi.fn() },
      riaAdapter: { buildSkills: vi.fn() },
    });

    await expect(
      forgedDegradationService.generateAdlerOverview({
        primarySource: makePrimarySource(),
        transcript: makeTranscript(),
        evidenceTimeline: makeEvidenceTimeline(),
        degradations,
      }),
    ).rejects.toMatchObject({ code: 'MULTIMODAL_SESSION_FAILED' });
  });

  it('accepts the paired audio and transcript evidence volume from a long real-video transcript', async () => {
    const baseEvidence = makeEvidenceTimeline('source-video', {
      includeFrame: false,
    })[0]!;
    const evidenceTimeline = Array.from({ length: 488 }, (_, index) => ({
      ...baseEvidence,
      evidenceId: `ev-long-${index + 1}`,
    }));
    const generate = vi.fn(async () => ({
      overview: {
        structure: [
          {
            text: '长视频证据已纳入结构分析',
            evidenceIds: ['ev-long-1'],
            claimType: 'sourceFact',
          },
        ],
        interpretation: [],
        critique: [],
        application: [],
      },
      model: 'test-model',
      promptVersion: 'prompt-v1',
      generatorVersion: 'generator-v1',
    }));
    const service = createMultimodalSessionService({
      adlerAdapter: { generate },
      candidateAdapter: { extractPass: vi.fn() },
      validationAdapter: { validate: vi.fn() },
      riaAdapter: { buildSkills: vi.fn() },
    });

    const result = await service.generateAdlerOverview({
      primarySource: makePrimarySource(),
      transcript: makeTranscript(),
      evidenceTimeline,
      degradations: [],
    });

    expect(result.overview.structure[0]?.evidenceIds).toEqual(['ev-long-1']);
    expect(generate.mock.calls[0]?.[0].evidenceTimeline).toHaveLength(488);
    expect(
      generate.mock.calls[0]?.[0].sourceFactEligibleEvidenceIds,
    ).toHaveLength(488);
  });

  it('runtime-normalizes public inputs before calling adapters', async () => {
    const generate = vi.fn();
    const validate = vi.fn();
    const buildSkills = vi.fn();
    const service = createMultimodalSessionService({
      adlerAdapter: { generate },
      candidateAdapter: { extractPass: vi.fn() },
      validationAdapter: { validate },
      riaAdapter: { buildSkills },
    });

    await expect(
      service.generateAdlerOverview({
        primarySource: makePrimarySource(),
        transcript: makeTranscript(),
        evidenceTimeline: [
          ...makeEvidenceTimeline(),
          {
            ...makeEvidenceTimeline()[0]!,
            selectionReason: 'duplicate evidence id',
          },
        ],
        degradations: [],
      }),
    ).rejects.toMatchObject({ code: 'MULTIMODAL_SESSION_FAILED' });
    expect(generate).not.toHaveBeenCalled();

    await expect(
      service.validateCandidatePasses({
        primarySource: makePrimarySource(),
        transcript: makeTranscript(),
        confirmedStages: ['adler_overview'],
        evidenceTimeline: makeEvidenceTimeline('source-audio'),
        candidatePasses: {
          frameworks: [],
          principles: [],
          cases: [],
          counterexamples: [],
          terms: [],
        },
      }),
    ).rejects.toMatchObject({ code: 'MULTIMODAL_SESSION_FAILED' });
    expect(validate).not.toHaveBeenCalled();

    await expect(
      service.buildRiaSkills({
        primarySource: makePrimarySource(),
        transcript: makeTranscript(),
        confirmedStages: ['adler_overview', 'evidence_and_candidates'],
        evidenceTimeline: makeEvidenceTimeline(),
        validatedCandidates: [],
        selectedCandidateIds: ['candidate-keep'],
      }),
    ).rejects.toMatchObject({ code: 'MULTIMODAL_SESSION_FAILED' });
    expect(buildSkills).not.toHaveBeenCalled();
  });

  it('extracts five candidate passes with exact call order and rejects pass drift, duplicate ids, and unknown evidence', async () => {
    const extractPass = vi
      .fn()
      .mockImplementationOnce(async () => ({
        candidates: [
          {
            candidateId: 'candidate-framework',
            passKey: 'frameworks',
            title: '结构化框架',
            summary: '总结讲解框架',
            reusableRule: '先定义再例证',
            evidenceIds: ['ev-transcript'],
            claimType: 'sourceFact',
            visualAssertion: false,
          },
        ],
        model: 'framework-model',
        promptVersion: 'framework-prompt',
      }))
      .mockImplementationOnce(async () => ({
        candidates: [
          {
            candidateId: 'candidate-principle',
            passKey: 'principles',
            title: '核心原理',
            summary: '提炼原理',
            reusableRule: '解释原理再给边界',
            evidenceIds: ['ev-transcript'],
            claimType: 'sourceFact',
            visualAssertion: false,
          },
        ],
        model: 'principle-model',
        promptVersion: 'principle-prompt',
      }))
      .mockImplementationOnce(async () => ({
        candidates: [
          {
            candidateId: 'candidate-case',
            passKey: 'cases',
            title: '案例用法',
            summary: '对应案例',
            reusableRule: '先规则后案例',
            evidenceIds: ['ev-audio'],
            claimType: 'sourceFact',
            visualAssertion: false,
          },
        ],
        model: 'case-model',
        promptVersion: 'case-prompt',
      }))
      .mockImplementationOnce(async () => ({
        candidates: [
          {
            candidateId: 'candidate-counterexample',
            passKey: 'counterexamples',
            title: '反例边界',
            summary: '说明何时不适用',
            reusableRule: '给出误用场景',
            evidenceIds: ['ev-frame'],
            claimType: 'modelInference',
            visualAssertion: true,
          },
        ],
        model: 'counter-model',
        promptVersion: 'counter-prompt',
      }))
      .mockImplementationOnce(async () => ({
        candidates: [
          {
            candidateId: 'candidate-term',
            passKey: 'terms',
            title: '术语表',
            summary: '关键术语',
            reusableRule: '统一术语解释',
            evidenceIds: ['ev-transcript'],
            claimType: 'sourceFact',
            visualAssertion: false,
          },
        ],
        model: 'term-model',
        promptVersion: 'term-prompt',
      }));

    const service = createMultimodalSessionService({
      adlerAdapter: { generate: vi.fn() },
      candidateAdapter: { extractPass },
      validationAdapter: { validate: vi.fn() },
      riaAdapter: { buildSkills: vi.fn() },
    });

    const result = await service.extractCandidatePasses({
      primarySource: makePrimarySource(),
      transcript: makeTranscript(),
      evidenceTimeline: makeEvidenceTimeline(),
      confirmedStages: ['adler_overview'],
      adlerOverview: {
        structure: [],
        interpretation: [],
        critique: [],
        application: [],
      },
      adlerOverviewReview: makeReview(),
    });

    expect(extractPass.mock.calls.map(([input]) => input.passKey)).toEqual([
      'frameworks',
      'principles',
      'cases',
      'counterexamples',
      'terms',
    ]);
    expect(result.candidatePasses.counterexamples[0]?.visualAssertion).toBe(
      true,
    );

    const invalidService = createMultimodalSessionService({
      adlerAdapter: { generate: vi.fn() },
      candidateAdapter: {
        extractPass: vi
          .fn()
          .mockResolvedValueOnce({
            candidates: [
              {
                candidateId: 'dup-id',
                passKey: 'frameworks',
                title: 'ok',
                summary: 'ok',
                reusableRule: 'ok',
                evidenceIds: ['ev-transcript'],
                claimType: 'sourceFact',
                visualAssertion: false,
              },
            ],
          })
          .mockResolvedValueOnce({
            candidates: [
              {
                candidateId: 'dup-id',
                passKey: 'principles',
                title: 'secret-model-output',
                summary: 'ok',
                reusableRule: 'ok',
                evidenceIds: ['missing'],
                claimType: 'sourceFact',
                visualAssertion: false,
              },
            ],
            model: 'framework-model',
            promptVersion: 'framework-prompt',
          })
          .mockResolvedValue({
            candidates: [],
            model: 'empty-model',
            promptVersion: 'empty-prompt',
          }),
      },
      validationAdapter: { validate: vi.fn() },
      riaAdapter: { buildSkills: vi.fn() },
    });

    await expect(
      invalidService.extractCandidatePasses({
        primarySource: makePrimarySource(),
        transcript: makeTranscript(),
        evidenceTimeline: makeEvidenceTimeline(),
        confirmedStages: ['adler_overview'],
        adlerOverview: {
          structure: [],
          interpretation: [],
          critique: [],
          application: [],
        },
        adlerOverviewReview: makeReview(),
      }),
    ).rejects.toMatchObject({ code: 'MULTIMODAL_SESSION_FAILED' });
  });

  it('passes the normalized Adler review into all five candidate extraction calls and does not let adapters overwrite it', async () => {
    const extractPass = vi.fn().mockResolvedValue({
      candidates: [],
      model: 'candidate-model',
      promptVersion: 'candidate-prompt',
    });
    const service = createMultimodalSessionService({
      adlerAdapter: { generate: vi.fn() },
      candidateAdapter: { extractPass },
      validationAdapter: { validate: vi.fn() },
      riaAdapter: { buildSkills: vi.fn() },
    });

    await service.extractCandidatePasses({
      primarySource: makePrimarySource(),
      transcript: makeTranscript(),
      evidenceTimeline: makeEvidenceTimeline(),
      confirmedStages: ['adler_overview'],
      adlerOverview: {
        structure: [],
        interpretation: [],
        critique: [],
        application: [],
      },
      adlerOverviewReview: {
        ...makeReview(),
      },
    });

    expect(extractPass).toHaveBeenCalledTimes(5);
    for (const [input] of extractPass.mock.calls) {
      expect(input.sourceFactEligibleEvidenceIds).toEqual([
        'ev-transcript',
        'ev-audio',
      ]);
      expect(input.adlerOverviewReview).toEqual({
        title: '教师确认标题',
        approved: true,
        userNotes: '',
      });
    }

    const leakingReviewService = createMultimodalSessionService({
      adlerAdapter: { generate: vi.fn() },
      candidateAdapter: {
        extractPass: vi.fn().mockResolvedValue({
          candidates: [],
          model: 'candidate-model',
          promptVersion: 'candidate-prompt',
          adlerOverviewReview: {
            title: 'malicious',
            approved: true,
            userNotes: 'secret',
          },
        }),
      },
      validationAdapter: { validate: vi.fn() },
      riaAdapter: { buildSkills: vi.fn() },
    });

    await expect(
      leakingReviewService.extractCandidatePasses({
        primarySource: makePrimarySource(),
        transcript: makeTranscript(),
        evidenceTimeline: makeEvidenceTimeline(),
        confirmedStages: ['adler_overview'],
        adlerOverview: {
          structure: [],
          interpretation: [],
          critique: [],
          application: [],
        },
        adlerOverviewReview: {
          ...makeReview(),
        },
      }),
    ).rejects.toMatchObject({ code: 'MULTIMODAL_SESSION_FAILED' });
  });

  it('requires an Adler review before candidate extraction and passes it through as normalized context', async () => {
    const extractPass = vi.fn().mockResolvedValue({
      candidates: [],
      model: 'candidate-model',
      promptVersion: 'candidate-prompt',
    });
    const service = createMultimodalSessionService({
      adlerAdapter: { generate: vi.fn() },
      candidateAdapter: { extractPass },
      validationAdapter: { validate: vi.fn() },
      riaAdapter: { buildSkills: vi.fn() },
    });

    await expect(
      service.extractCandidatePasses({
        primarySource: makePrimarySource(),
        transcript: makeTranscript(),
        evidenceTimeline: makeEvidenceTimeline(),
        confirmedStages: ['adler_overview'],
        adlerOverview: {
          structure: [],
          interpretation: [],
          critique: [],
          application: [],
        },
      } as never),
    ).rejects.toMatchObject({ code: 'MULTIMODAL_SESSION_FAILED' });
    expect(extractPass).not.toHaveBeenCalled();

    await service.extractCandidatePasses({
      primarySource: makePrimarySource(),
      transcript: makeTranscript(),
      evidenceTimeline: makeEvidenceTimeline(),
      confirmedStages: ['adler_overview'],
      adlerOverview: {
        structure: [],
        interpretation: [],
        critique: [],
        application: [],
      },
      adlerOverviewReview: makeReview(),
    });

    for (const [input] of extractPass.mock.calls) {
      expect(input.adlerOverviewReview).toEqual(makeReview());
    }
  });

  it('enforces non-optional V1 V2 V3 proof structure and downgrade whitelist', async () => {
    const service = createMultimodalSessionService({
      adlerAdapter: { generate: vi.fn() },
      candidateAdapter: { extractPass: vi.fn() },
      validationAdapter: {
        validate: vi
          .fn()
          .mockResolvedValueOnce({
            candidateId: 'candidate-1',
            v1: {
              passed: true,
              reason: 'missing proof',
              reusableContexts: ['same context', 'same context'],
            },
            v2: {
              passed: true,
              reason: 'ok',
              novelScenario: '新班级复盘',
              capability: 'guide',
            },
            v3: {
              passed: true,
              reason: 'ok',
              differentiators: ['强调错误边界'],
            },
          })
          .mockResolvedValueOnce({
            candidateId: 'candidate-2',
            v1: {
              passed: true,
              reason: 'ok',
              reusableContexts: ['高一例题课', '高二错题课'],
            },
            v2: {
              passed: false,
              reason: '原材料直接出现',
              novelScenario: '原材料同场景',
              capability: 'guide',
            },
            v3: {
              passed: true,
              reason: 'ok',
              differentiators: ['强调错误边界'],
            },
          })
          .mockResolvedValueOnce({
            candidateId: 'candidate-3',
            v1: {
              passed: true,
              reason: 'ok',
              reusableContexts: ['高一例题课', '高二错题课'],
            },
            v2: {
              passed: true,
              reason: 'ok',
              novelScenario: '晚自习追问',
              capability: 'explain',
            },
            v3: {
              passed: true,
              reason: 'ok',
              differentiators: ['区分定义与结论'],
            },
          }),
      },
      riaAdapter: { buildSkills: vi.fn() },
    });

    const result = await service.validateCandidatePasses({
      primarySource: makePrimarySource(),
      transcript: makeTranscript(),
      confirmedStages: ['adler_overview'],
      evidenceTimeline: makeEvidenceTimeline(),
      candidatePasses: {
        frameworks: [
          {
            candidateId: 'candidate-1',
            passKey: 'frameworks',
            title: '候选一',
            summary: 'summary',
            reusableRule: 'rule',
            evidenceIds: ['ev-transcript'],
            claimType: 'sourceFact',
            visualAssertion: false,
          },
        ],
        principles: [
          {
            candidateId: 'candidate-2',
            passKey: 'principles',
            title: '候选二',
            summary: 'summary',
            reusableRule: 'rule',
            evidenceIds: ['ev-transcript'],
            claimType: 'sourceFact',
            visualAssertion: false,
          },
        ],
        cases: [
          {
            candidateId: 'candidate-3',
            passKey: 'cases',
            title: '候选三',
            summary: 'summary',
            reusableRule: 'rule',
            evidenceIds: ['ev-audio'],
            claimType: 'sourceFact',
            visualAssertion: false,
          },
        ],
        counterexamples: [],
        terms: [],
      },
      failureDispositions: {
        'candidate-1': 'reference',
        'candidate-2': 'discard',
      },
    });

    expect(
      result.results.find(
        (item) => item.candidate.candidateId === 'candidate-1',
      )?.overallPassed,
    ).toBe(false);
    expect(
      result.results.find(
        (item) => item.candidate.candidateId === 'candidate-1',
      )?.disposition,
    ).toBe('reference');
    expect(
      result.results.find(
        (item) => item.candidate.candidateId === 'candidate-2',
      )?.overallPassed,
    ).toBe(false);
    expect(
      result.results.find(
        (item) => item.candidate.candidateId === 'candidate-3',
      )?.overallPassed,
    ).toBe(true);

    await expect(
      service.validateCandidatePasses({
        primarySource: makePrimarySource(),
        transcript: makeTranscript(),
        confirmedStages: [],
        evidenceTimeline: makeEvidenceTimeline(),
        candidatePasses: {
          frameworks: [
            {
              candidateId: 'candidate-gated',
              passKey: 'frameworks',
              title: '候选 gate',
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
      }),
    ).rejects.toMatchObject({ code: 'MULTIMODAL_SESSION_FAILED' });

    await expect(
      service.validateCandidatePasses({
        primarySource: makePrimarySource(),
        transcript: makeTranscript(),
        confirmedStages: ['adler_overview'],
        evidenceTimeline: makeEvidenceTimeline(),
        candidatePasses: {
          frameworks: [
            {
              candidateId: 'candidate-4',
              passKey: 'frameworks',
              title: '候选四',
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
        failureDispositions: {
          'candidate-4': 'fix_and_retry',
        } as never,
      }),
    ).rejects.toMatchObject({ code: 'MULTIMODAL_SESSION_FAILED' });

    await expect(
      service.validateCandidatePasses({
        primarySource: makePrimarySource(),
        transcript: makeTranscript(),
        confirmedStages: ['adler_overview'],
        evidenceTimeline: makeEvidenceTimeline(),
        candidatePasses: {
          frameworks: [
            {
              candidateId: 'candidate-5',
              passKey: 'frameworks',
              title: '候选五',
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
        failureDispositions: {
          'candidate-missing': 'discard',
        },
      }),
    ).rejects.toMatchObject({ code: 'MULTIMODAL_SESSION_FAILED' });
  });

  it('requires second confirmation for RIA and only allows passed candidates with legal relations', async () => {
    const buildSkills = vi.fn(
      async (input: {
        skillDirectory: Array<{ candidateId: string; skillId: string }>;
      }) => ({
        skills: [
          {
            candidateId: 'candidate-keep',
            id: 'skill-1',
            dirName: 'skill-rule-1',
            name: '先定义再例证',
            description: '帮助老师结构化讲解',
            skillMd: '# skill',
            sourceEvidenceIds: ['ev-transcript'],
            mechanism: '先定义规则，再给例证',
            sourceExample: '原视频中的定义片段',
            futureApplicability: '适用于错题讲评',
            execution: {
              input: '教师目标与学生困惑',
              steps: ['提炼规则', '给出例证'],
              output: '结构化讲解话术',
              completionCriteria: '学生能复述规则',
              stopCriteria: '证据不足或场景不匹配',
            },
            boundaries: {
              counterexamples: ['概念未定义时不可直接套用'],
              failureModes: ['学生背景差异过大'],
              limits: ['不替代学科判断'],
              confusions: ['易与纯术语讲解混淆'],
            },
            evidenceIds: ['ev-transcript'],
            relations: [
              {
                type: 'depends-on',
                targetSkillId:
                  input.skillDirectory.find(
                    (entry) => entry.candidateId === 'candidate-support',
                  )?.skillId ?? 'missing-support-skill',
              },
            ],
            model: 'ria-model',
            promptVersion: 'ria-prompt',
            generatorVersion: 'ria-generator',
          },
          {
            candidateId: 'candidate-support',
            id: 'skill-2',
            dirName: 'skill-rule-2',
            name: '术语先行',
            description: '先统一术语',
            skillMd: '# support',
            sourceEvidenceIds: ['ev-transcript'],
            mechanism: '先对齐术语',
            sourceExample: '视频中的术语定义',
            futureApplicability: '适用于新单元导入',
            execution: {
              input: '术语混乱的课堂片段',
              steps: ['识别术语', '给出统一解释'],
              output: '术语对齐说明',
              completionCriteria: '学生使用同一术语',
              stopCriteria: '缺少定义证据',
            },
            boundaries: {
              counterexamples: ['概念尚未引入时不适合'],
              failureModes: ['学生已有错误先验'],
              limits: ['不替代完整例题'],
              confusions: ['易与概念框架混淆'],
            },
            evidenceIds: ['ev-transcript'],
            relations: [],
            model: 'ria-model',
            promptVersion: 'ria-prompt',
            generatorVersion: 'ria-generator',
          },
        ],
      }),
    );

    const service = createMultimodalSessionService({
      adlerAdapter: { generate: vi.fn() },
      candidateAdapter: { extractPass: vi.fn() },
      validationAdapter: { validate: vi.fn() },
      riaAdapter: { buildSkills },
    });

    await expect(
      service.buildRiaSkills({
        primarySource: makePrimarySource(),
        transcript: makeTranscript(),
        confirmedStages: ['adler_overview'],
        evidenceTimeline: makeEvidenceTimeline(),
        validatedCandidates: [
          {
            candidate: {
              candidateId: 'candidate-keep',
              passKey: 'frameworks',
              title: 'keep',
              summary: 'summary',
              reusableRule: 'rule',
              evidenceIds: ['ev-transcript'],
              claimType: 'sourceFact',
              visualAssertion: false,
            },
            validation: {
              candidateId: 'candidate-keep',
              v1: {
                passed: true,
                reason: 'ok',
                reusableContexts: ['高一例题课', '高二错题课'],
              },
              v2: {
                passed: true,
                reason: 'ok',
                novelScenario: '晚自习追问',
                capability: 'guide',
              },
              v3: {
                passed: true,
                reason: 'ok',
                differentiators: ['区分定义与结论'],
              },
            },
            overallPassed: true,
            disposition: 'retain',
          },
        ],
        selectedCandidateIds: ['candidate-keep'],
      }),
    ).rejects.toMatchObject({ code: 'MULTIMODAL_SESSION_FAILED' });

    const result = await service.buildRiaSkills({
      primarySource: makePrimarySource(),
      transcript: makeTranscript(),
      confirmedStages: ['adler_overview', 'evidence_and_candidates'],
      evidenceTimeline: makeEvidenceTimeline(),
      validatedCandidates: [
        {
          candidate: {
            candidateId: 'candidate-keep',
            passKey: 'frameworks',
            title: 'keep',
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
            candidateId: 'candidate-support',
            passKey: 'terms',
            title: 'support',
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
            candidateId: 'candidate-failed',
            passKey: 'cases',
            title: 'failed',
            summary: 'summary',
            reusableRule: 'rule',
            evidenceIds: ['ev-audio'],
            claimType: 'sourceFact',
            visualAssertion: false,
          },
          validation: {
            v1: {
              passed: false,
              reason: 'bad',
              reusableContexts: ['原场景', '原场景'],
              proofSatisfied: false,
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
          overallPassed: false,
          disposition: 'discard',
        },
      ],
      selectedCandidateIds: ['candidate-keep', 'candidate-support'],
    });

    expect(buildSkills).toHaveBeenCalledTimes(1);
    expect(buildSkills).toHaveBeenCalledWith(
      expect.objectContaining({
        evidenceTimeline: [
          expect.objectContaining({ evidenceId: 'ev-transcript' }),
        ],
      }),
    );
    expect(result.skills).toHaveLength(2);
    expect(result.skills[0]?.ria.execution.steps).toHaveLength(2);
    expect(result.skills[0]?.relations[0]?.type).toBe('depends-on');
    expect(
      result.skills.some((skill) => skill.candidateId === 'candidate-failed'),
    ).toBe(false);

    const unrelatedEvidenceService = createMultimodalSessionService({
      adlerAdapter: { generate: vi.fn() },
      candidateAdapter: { extractPass: vi.fn() },
      validationAdapter: { validate: vi.fn() },
      riaAdapter: {
        buildSkills: vi.fn(async () => ({
          skills: [
            {
              candidateId: 'candidate-keep',
              id: 'skill-1',
              dirName: 'skill-rule-1',
              name: '先定义再例证',
              description: '帮助老师结构化讲解',
              skillMd: '# skill',
              sourceEvidenceIds: ['ev-transcript'],
              mechanism: '先定义规则，再给例证',
              sourceExample: '原视频中的定义片段',
              futureApplicability: '适用于错题讲评',
              execution: {
                input: '教师目标与学生困惑',
                steps: ['提炼规则', '给出例证'],
                output: '结构化讲解话术',
                completionCriteria: '学生能复述规则',
                stopCriteria: '证据不足或场景不匹配',
              },
              boundaries: {
                counterexamples: ['概念未定义时不可直接套用'],
                failureModes: ['学生背景差异过大'],
                limits: ['不替代学科判断'],
                confusions: ['易与纯术语讲解混淆'],
              },
              evidenceIds: ['ev-transcript', 'ev-frame'],
              relations: [],
              model: 'ria-model',
              promptVersion: 'ria-prompt',
              generatorVersion: 'ria-generator',
            },
          ],
        })),
      },
    });

    await expect(
      unrelatedEvidenceService.buildRiaSkills({
        primarySource: makePrimarySource(),
        transcript: makeTranscript(),
        confirmedStages: ['adler_overview', 'evidence_and_candidates'],
        evidenceTimeline: makeEvidenceTimeline(),
        validatedCandidates: [
          {
            candidate: {
              candidateId: 'candidate-keep',
              passKey: 'frameworks',
              title: 'keep',
              summary: 'summary',
              reusableRule: 'rule',
              evidenceIds: ['ev-transcript'],
              claimType: 'sourceFact',
              visualAssertion: false,
            },
            validation: {
              candidateId: 'candidate-keep',
              v1: {
                passed: true,
                reason: 'ok',
                reusableContexts: ['高一例题课', '高二错题课'],
              },
              v2: {
                passed: true,
                reason: 'ok',
                novelScenario: '晚自习追问',
                capability: 'guide',
              },
              v3: {
                passed: true,
                reason: 'ok',
                differentiators: ['区分定义与结论'],
              },
            },
            overallPassed: true,
            disposition: 'retain',
          },
        ],
        selectedCandidateIds: ['candidate-keep'],
      }),
    ).rejects.toMatchObject({ code: 'MULTIMODAL_SESSION_FAILED' });

    await expect(
      service.buildRiaSkills({
        primarySource: makePrimarySource(),
        transcript: makeTranscript(),
        confirmedStages: ['adler_overview', 'evidence_and_candidates'],
        evidenceTimeline: makeEvidenceTimeline(),
        validatedCandidates: [
          {
            candidate: {
              candidateId: 'candidate-keep',
              passKey: 'frameworks',
              title: 'keep',
              summary: 'summary',
              reusableRule: 'rule',
              evidenceIds: ['ev-transcript'],
              claimType: 'sourceFact',
              visualAssertion: false,
            },
            validation: {
              candidateId: 'candidate-keep',
              v1: {
                passed: true,
                reason: 'ok',
                reusableContexts: ['同一场景', '同一场景'],
              },
              v2: {
                passed: true,
                reason: 'ok',
                novelScenario: '晚自习追问',
                capability: 'guide',
              },
              v3: {
                passed: true,
                reason: 'ok',
                differentiators: ['区分定义与结论'],
              },
            },
            overallPassed: true,
            disposition: 'retain',
          },
        ],
        selectedCandidateIds: ['candidate-keep'],
      }),
    ).rejects.toMatchObject({ code: 'MULTIMODAL_SESSION_FAILED' });

    await expect(
      service.buildRiaSkills({
        primarySource: makePrimarySource(),
        transcript: makeTranscript(),
        confirmedStages: ['adler_overview', 'evidence_and_candidates'],
        evidenceTimeline: makeEvidenceTimeline(),
        validatedCandidates: [
          {
            candidate: {
              candidateId: 'candidate-keep',
              passKey: 'frameworks',
              title: 'keep',
              summary: 'summary',
              reusableRule: 'rule',
              evidenceIds: ['ev-transcript'],
              claimType: 'sourceFact',
              visualAssertion: false,
            },
            validation: {
              candidateId: 'candidate-keep',
              v1: {
                passed: true,
                reason: 'ok',
                reusableContexts: ['高一例题课', '高二错题课'],
              },
              v2: {
                passed: true,
                reason: 'ok',
                novelScenario: '晚自习追问',
                capability: 'guide',
              },
              v3: {
                passed: true,
                reason: 'ok',
                differentiators: ['区分定义与结论'],
              },
            },
            overallPassed: true,
            disposition: 'retain',
          },
          {
            candidate: {
              candidateId: 'candidate-keep',
              passKey: 'frameworks',
              title: 'keep-dup',
              summary: 'summary',
              reusableRule: 'rule',
              evidenceIds: ['ev-transcript'],
              claimType: 'sourceFact',
              visualAssertion: false,
            },
            validation: {
              candidateId: 'candidate-keep',
              v1: {
                passed: true,
                reason: 'ok',
                reusableContexts: ['高一例题课', '高二错题课'],
              },
              v2: {
                passed: true,
                reason: 'ok',
                novelScenario: '晚自习追问',
                capability: 'guide',
              },
              v3: {
                passed: true,
                reason: 'ok',
                differentiators: ['区分定义与结论'],
              },
            },
            overallPassed: true,
            disposition: 'retain',
          },
        ],
        selectedCandidateIds: ['candidate-keep'],
      }),
    ).rejects.toMatchObject({ code: 'MULTIMODAL_SESSION_FAILED' });

    const invalidRiaService = createMultimodalSessionService({
      adlerAdapter: { generate: vi.fn() },
      candidateAdapter: { extractPass: vi.fn() },
      validationAdapter: { validate: vi.fn() },
      riaAdapter: {
        buildSkills: vi.fn(async () => ({
          skills: [
            {
              candidateId: 'candidate-unknown',
              id: 'skill-1',
              dirName: 'skill-rule-1',
              name: 'bad',
              description: 'bad',
              skillMd: '# bad',
              sourceEvidenceIds: ['ev-transcript'],
              mechanism: 'bad',
              sourceExample: 'bad',
              futureApplicability: 'bad',
              execution: {
                input: 'bad',
                steps: ['bad'],
                output: 'bad',
                completionCriteria: 'bad',
                stopCriteria: 'bad',
              },
              boundaries: {
                counterexamples: ['bad'],
                failureModes: ['bad'],
                limits: ['bad'],
                confusions: ['bad'],
              },
              evidenceIds: ['ev-transcript'],
              relations: [
                { type: 'depends-on', targetSkillId: 'skill-1' },
                { type: 'depends-on', targetSkillId: 'skill-1' },
              ],
              model: 'ria-model',
              promptVersion: 'ria-prompt',
              generatorVersion: 'ria-generator',
            },
            {
              candidateId: 'candidate-support',
              id: 'skill-1',
              dirName: 'skill-rule-1',
              name: 'dup',
              description: 'dup',
              skillMd: '# dup',
              sourceEvidenceIds: ['ev-transcript'],
              mechanism: 'dup',
              sourceExample: 'dup',
              futureApplicability: 'dup',
              execution: {
                input: 'dup',
                steps: ['dup'],
                output: 'dup',
                completionCriteria: 'dup',
                stopCriteria: 'dup',
              },
              boundaries: {
                counterexamples: ['dup'],
                failureModes: ['dup'],
                limits: ['dup'],
                confusions: ['dup'],
              },
              evidenceIds: ['ev-transcript'],
              relations: [],
              model: 'ria-model',
              promptVersion: 'ria-prompt',
              generatorVersion: 'ria-generator',
            },
          ],
        })),
      },
    });

    await expect(
      invalidRiaService.buildRiaSkills({
        primarySource: makePrimarySource(),
        transcript: makeTranscript(),
        confirmedStages: ['adler_overview', 'evidence_and_candidates'],
        evidenceTimeline: makeEvidenceTimeline(),
        validatedCandidates: [
          {
            candidate: {
              candidateId: 'candidate-keep',
              passKey: 'frameworks',
              title: 'keep',
              summary: 'summary',
              reusableRule: 'rule',
              evidenceIds: ['ev-transcript'],
              claimType: 'sourceFact',
              visualAssertion: false,
            },
            validation: {
              candidateId: 'candidate-keep',
              v1: {
                passed: true,
                reason: 'ok',
                reusableContexts: ['高一例题课', '高二错题课'],
              },
              v2: {
                passed: true,
                reason: 'ok',
                novelScenario: '晚自习追问',
                capability: 'guide',
              },
              v3: {
                passed: true,
                reason: 'ok',
                differentiators: ['区分定义与结论'],
              },
            },
            overallPassed: true,
            disposition: 'retain',
          },
          {
            candidate: {
              candidateId: 'candidate-support',
              passKey: 'terms',
              title: 'support',
              summary: 'summary',
              reusableRule: 'rule',
              evidenceIds: ['ev-transcript'],
              claimType: 'sourceFact',
              visualAssertion: false,
            },
            validation: {
              candidateId: 'candidate-support',
              v1: {
                passed: true,
                reason: 'ok',
                reusableContexts: ['高一例题课', '高二错题课'],
              },
              v2: {
                passed: true,
                reason: 'ok',
                novelScenario: '晚自习追问',
                capability: 'guide',
              },
              v3: {
                passed: true,
                reason: 'ok',
                differentiators: ['区分定义与结论'],
              },
            },
            overallPassed: true,
            disposition: 'retain',
          },
        ],
        selectedCandidateIds: ['candidate-keep', 'candidate-support'],
      }),
    ).rejects.toMatchObject({ code: 'MULTIMODAL_SESSION_FAILED' });

    await expect(
      service.buildRiaSkills({
        primarySource: makePrimarySource(),
        transcript: makeTranscript(),
        confirmedStages: ['adler_overview', 'evidence_and_candidates'],
        evidenceTimeline: makeEvidenceTimeline(),
        validatedCandidates: [
          {
            candidate: {
              candidateId: 'candidate-keep',
              passKey: 'frameworks',
              title: 'keep',
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
              },
              v2: {
                passed: true,
                reason: 'ok',
                novelScenario: '晚自习追问',
                capability: 'guide',
              },
              v3: {
                passed: true,
                reason: 'ok',
                differentiators: ['区分定义与结论'],
              },
            },
            overallPassed: true,
            disposition: 'retain',
          },
        ],
        selectedCandidateIds: [],
      }),
    ).rejects.toMatchObject({ code: 'MULTIMODAL_SESSION_FAILED' });

    const duplicateDirNameService = createMultimodalSessionService({
      adlerAdapter: { generate: vi.fn() },
      candidateAdapter: { extractPass: vi.fn() },
      validationAdapter: { validate: vi.fn() },
      riaAdapter: {
        buildSkills: vi.fn(async () => ({
          skills: [
            {
              candidateId: 'candidate-keep',
              id: 'skill-1',
              dirName: 'shared-dir',
              name: 'one',
              description: 'one',
              skillMd: '# one',
              sourceEvidenceIds: ['ev-transcript'],
              mechanism: 'one',
              sourceExample: 'one',
              futureApplicability: 'one',
              execution: {
                input: 'one',
                steps: ['one'],
                output: 'one',
                completionCriteria: 'one',
                stopCriteria: 'one',
              },
              boundaries: {
                counterexamples: ['one'],
                failureModes: ['one'],
                limits: ['one'],
                confusions: ['one'],
              },
              evidenceIds: ['ev-transcript'],
              relations: [],
              model: 'ria-model',
              promptVersion: 'ria-prompt',
              generatorVersion: 'ria-generator',
            },
            {
              candidateId: 'candidate-support',
              id: 'skill-2',
              dirName: 'shared-dir',
              name: 'two',
              description: 'two',
              skillMd: '# two',
              sourceEvidenceIds: ['ev-transcript'],
              mechanism: 'two',
              sourceExample: 'two',
              futureApplicability: 'two',
              execution: {
                input: 'two',
                steps: ['two'],
                output: 'two',
                completionCriteria: 'two',
                stopCriteria: 'two',
              },
              boundaries: {
                counterexamples: ['two'],
                failureModes: ['two'],
                limits: ['two'],
                confusions: ['two'],
              },
              evidenceIds: ['ev-transcript'],
              relations: [],
              model: 'ria-model',
              promptVersion: 'ria-prompt',
              generatorVersion: 'ria-generator',
            },
          ],
        })),
      },
    });

    await expect(
      duplicateDirNameService.buildRiaSkills({
        primarySource: makePrimarySource(),
        transcript: makeTranscript(),
        confirmedStages: ['adler_overview', 'evidence_and_candidates'],
        evidenceTimeline: makeEvidenceTimeline(),
        validatedCandidates: [
          {
            candidate: {
              candidateId: 'candidate-keep',
              passKey: 'frameworks',
              title: 'keep',
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
              },
              v2: {
                passed: true,
                reason: 'ok',
                novelScenario: '晚自习追问',
                capability: 'guide',
              },
              v3: {
                passed: true,
                reason: 'ok',
                differentiators: ['区分定义与结论'],
              },
            },
            overallPassed: true,
            disposition: 'retain',
          },
          {
            candidate: {
              candidateId: 'candidate-support',
              passKey: 'terms',
              title: 'support',
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
              },
              v2: {
                passed: true,
                reason: 'ok',
                novelScenario: '晚自习追问',
                capability: 'guide',
              },
              v3: {
                passed: true,
                reason: 'ok',
                differentiators: ['区分定义与结论'],
              },
            },
            overallPassed: true,
            disposition: 'retain',
          },
        ],
        selectedCandidateIds: ['candidate-keep', 'candidate-support'],
      }),
    ).rejects.toMatchObject({ code: 'MULTIMODAL_SESSION_FAILED' });
  });

  it('builds large Skill Packs in bounded RIA batches and merges them before strict validation', async () => {
    const candidates = Array.from({ length: 9 }, (_, index) => ({
      candidateId: `candidate-${index + 1}`,
      passKey: 'frameworks' as const,
      title: `候选 ${index + 1}`,
      summary: 'summary',
      reusableRule: 'rule',
      evidenceIds: ['ev-transcript'],
      claimType: 'sourceFact' as const,
      visualAssertion: false,
    }));
    const buildSkills = vi.fn(
      async (input: {
        candidates: typeof candidates;
        skillDirectory: Array<{
          candidateId: string;
          skillId: string;
          title: string;
          summary: string;
        }>;
      }) => ({
        skills: input.candidates.map((candidate, batchLocalIndex) => ({
          candidateId: candidate.candidateId,
          // Separate model batches can reuse identifiers that are only locally unique.
          id:
            candidate.candidateId === 'candidate-1'
              ? (input.skillDirectory.find(
                  (entry) => entry.candidateId === 'candidate-9',
                )?.skillId ?? 'missing-cross-batch-target')
              : `skill-${batchLocalIndex + 1}`,
          dirName: `skill-${batchLocalIndex + 1}`,
          name: candidate.title,
          description: 'desc',
          skillMd: '# skill',
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
          evidenceIds: ['ev-transcript'],
          relations:
            candidate.candidateId === 'candidate-1'
              ? [
                  {
                    type: 'depends-on' as const,
                    targetSkillId:
                      input.skillDirectory.find(
                        (entry) => entry.candidateId === 'candidate-9',
                      )?.skillId ?? 'missing-cross-batch-target',
                  },
                ]
              : [],
          model: 'ria-model',
          promptVersion: 'ria-prompt',
          generatorVersion: 'ria-generator',
        })),
      }),
    );
    const service = createMultimodalSessionService({
      adlerAdapter: { generate: vi.fn() },
      candidateAdapter: { extractPass: vi.fn() },
      validationAdapter: { validate: vi.fn() },
      riaAdapter: { buildSkills },
    });

    const result = await service.buildRiaSkills({
      primarySource: makePrimarySource(),
      transcript: makeTranscript(),
      confirmedStages: ['adler_overview', 'evidence_and_candidates'],
      evidenceTimeline: makeEvidenceTimeline(),
      validatedCandidates: candidates.map((candidate) => ({
        candidate,
        validation: {
          v1: {
            passed: true,
            reason: 'ok',
            reusableContexts: ['场景一', '场景二'],
            proofSatisfied: true,
          },
          v2: {
            passed: true,
            reason: 'ok',
            novelScenario: '新场景',
            capability: 'guide' as const,
            proofSatisfied: true,
          },
          v3: {
            passed: true,
            reason: 'ok',
            differentiators: ['差异点'],
            proofSatisfied: true,
          },
        },
        overallPassed: true,
        disposition: 'retain' as const,
      })),
      selectedCandidateIds: candidates.map(
        (candidate) => candidate.candidateId,
      ),
    });

    expect(buildSkills).toHaveBeenCalledTimes(5);
    expect(
      buildSkills.mock.calls.map(([input]) => input.candidates.length),
    ).toEqual([2, 2, 2, 2, 1]);
    expect(
      buildSkills.mock.calls.every(
        ([input]) => input.skillDirectory.length === 9,
      ),
    ).toBe(true);
    expect(result.skills).toHaveLength(9);
    expect(new Set(result.skills.map((skill) => skill.id))).toHaveLength(9);
    expect(new Set(result.skills.map((skill) => skill.dirName))).toHaveLength(
      9,
    );
    expect(result.skills[0].dirName).toMatch(
      /^skill-candidate-1-[a-f0-9]{16}$/,
    );
    expect(result.skills[0].relations[0]?.targetSkillId).toBe(
      result.skills[8].id,
    );
  });

  it('allows pure audio non-visual candidates but rejects visual assertions without frame evidence and low-confidence unedited sourceFact reuse', async () => {
    const service = createMultimodalSessionService({
      adlerAdapter: { generate: vi.fn() },
      candidateAdapter: {
        extractPass: vi
          .fn()
          .mockResolvedValueOnce({
            candidates: [
              {
                candidateId: 'audio-framework',
                passKey: 'frameworks',
                title: '纯音频候选',
                summary: 'summary',
                reusableRule: 'rule',
                evidenceIds: ['ev-transcript'],
                claimType: 'modelInference',
                visualAssertion: false,
              },
            ],
          })
          .mockResolvedValueOnce({
            candidates: [
              {
                candidateId: 'audio-principle',
                passKey: 'principles',
                title: '需要画面',
                summary: 'summary',
                reusableRule: 'rule',
                evidenceIds: ['ev-transcript'],
                claimType: 'modelInference',
                visualAssertion: true,
              },
            ],
          })
          .mockResolvedValue({ candidates: [] }),
      },
      validationAdapter: { validate: vi.fn() },
      riaAdapter: { buildSkills: vi.fn() },
    });

    await expect(
      service.extractCandidatePasses({
        primarySource: makePrimarySource('audio'),
        transcript: makeTranscript(),
        evidenceTimeline: makeEvidenceTimeline('source-audio', {
          includeFrame: false,
        }),
        confirmedStages: ['adler_overview'],
        adlerOverview: {
          structure: [],
          interpretation: [],
          critique: [],
          application: [],
        },
        adlerOverviewReview: makeReview(),
      }),
    ).rejects.toMatchObject({ code: 'MULTIMODAL_SESSION_FAILED' });

    await expect(
      service.extractCandidatePasses({
        primarySource: makePrimarySource('audio'),
        transcript: makeTranscript(),
        evidenceTimeline: makeEvidenceTimeline(),
        confirmedStages: ['adler_overview'],
        adlerOverview: {
          structure: [],
          interpretation: [],
          critique: [],
          application: [],
        },
        adlerOverviewReview: makeReview(),
      }),
    ).rejects.toMatchObject({ code: 'MULTIMODAL_SESSION_FAILED' });

    const lowConfidenceService = createMultimodalSessionService({
      adlerAdapter: { generate: vi.fn() },
      candidateAdapter: {
        extractPass: vi
          .fn()
          .mockResolvedValueOnce({
            candidates: [
              {
                candidateId: 'low-confidence',
                passKey: 'frameworks',
                title: '低置信转录',
                summary: 'summary',
                reusableRule: 'rule',
                evidenceIds: ['ev-transcript'],
                claimType: 'sourceFact',
                visualAssertion: false,
              },
            ],
          })
          .mockResolvedValue({ candidates: [] }),
      },
      validationAdapter: { validate: vi.fn() },
      riaAdapter: { buildSkills: vi.fn() },
    });

    await expect(
      lowConfidenceService.extractCandidatePasses({
        primarySource: makePrimarySource('audio'),
        transcript: makeTranscript('low_confidence'),
        evidenceTimeline: makeEvidenceTimeline('source-audio', {
          includeFrame: false,
          transcriptConfidence: 0.2,
          transcriptEditedByUser: false,
        }),
        confirmedStages: ['adler_overview'],
        adlerOverview: {
          structure: [],
          interpretation: [],
          critique: [],
          application: [],
        },
        adlerOverviewReview: makeReview(),
      }),
    ).rejects.toMatchObject({ code: 'MULTIMODAL_SESSION_FAILED' });

    const missingConfidenceService = createMultimodalSessionService({
      adlerAdapter: { generate: vi.fn() },
      candidateAdapter: {
        extractPass: vi
          .fn()
          .mockResolvedValueOnce({
            candidates: [
              {
                candidateId: 'missing-confidence',
                passKey: 'frameworks',
                title: '缺少置信度',
                summary: 'summary',
                reusableRule: 'rule',
                evidenceIds: ['ev-transcript'],
                claimType: 'sourceFact',
                visualAssertion: false,
              },
            ],
            model: 'framework-model',
            promptVersion: 'framework-prompt',
          })
          .mockResolvedValue({
            candidates: [],
            model: 'empty-model',
            promptVersion: 'empty-prompt',
          }),
      },
      validationAdapter: { validate: vi.fn() },
      riaAdapter: { buildSkills: vi.fn() },
    });

    const missingConfidenceEvidence = makeEvidenceTimeline('source-audio', {
      includeFrame: false,
      transcriptEditedByUser: false,
    }).map((item) =>
      item.evidenceId === 'ev-transcript'
        ? {
            ...item,
            provenance: {
              ...item.provenance,
              confidence: undefined,
            },
          }
        : item,
    ) as MultimodalEvidence[];

    await expect(
      missingConfidenceService.extractCandidatePasses({
        primarySource: makePrimarySource('audio'),
        transcript: makeTranscript('ready'),
        evidenceTimeline: missingConfidenceEvidence,
        confirmedStages: ['adler_overview'],
        adlerOverview: {
          structure: [],
          interpretation: [],
          critique: [],
          application: [],
        },
        adlerOverviewReview: makeReview(),
      }),
    ).rejects.toMatchObject({ code: 'MULTIMODAL_SESSION_FAILED' });

    const recoveredService = createMultimodalSessionService({
      adlerAdapter: { generate: vi.fn() },
      candidateAdapter: {
        extractPass: vi
          .fn()
          .mockResolvedValueOnce({
            candidates: [
              {
                candidateId: 'low-confidence',
                passKey: 'frameworks',
                title: '低置信转录',
                summary: 'summary',
                reusableRule: 'rule',
                evidenceIds: ['ev-transcript'],
                claimType: 'sourceFact',
                visualAssertion: false,
              },
            ],
            model: 'framework-model',
            promptVersion: 'framework-prompt',
          })
          .mockResolvedValue({
            candidates: [],
            model: 'empty-model',
            promptVersion: 'empty-prompt',
          }),
      },
      validationAdapter: { validate: vi.fn() },
      riaAdapter: { buildSkills: vi.fn() },
    });

    const recovered = await recoveredService.extractCandidatePasses({
      primarySource: makePrimarySource('audio'),
      transcript: makeTranscript('ready'),
      evidenceTimeline: makeEvidenceTimeline('source-audio', {
        includeFrame: false,
        transcriptConfidence: 0.2,
        transcriptEditedByUser: true,
      }),
      confirmedStages: ['adler_overview'],
      adlerOverview: {
        structure: [],
        interpretation: [],
        critique: [],
        application: [],
      },
      adlerOverviewReview: makeReview(),
    });
    expect(recovered.candidatePasses.frameworks[0]?.candidateId).toBe(
      'low-confidence',
    );
  });

  it('revalidates Adler input and requires non-empty manifest metadata for adler, candidate, and ria outputs', async () => {
    const extractPass = vi.fn();
    const service = createMultimodalSessionService({
      adlerAdapter: { generate: vi.fn() },
      candidateAdapter: { extractPass },
      validationAdapter: { validate: vi.fn() },
      riaAdapter: { buildSkills: vi.fn() },
    });

    await expect(
      service.extractCandidatePasses({
        primarySource: makePrimarySource('audio'),
        transcript: makeTranscript('low_confidence'),
        evidenceTimeline: makeEvidenceTimeline('source-audio', {
          includeFrame: false,
          transcriptConfidence: 0.95,
        }),
        confirmedStages: ['adler_overview'],
        adlerOverview: {
          structure: [
            {
              text: '伪造低置信 sourceFact',
              evidenceIds: ['ev-transcript'],
              claimType: 'sourceFact',
            },
          ],
          interpretation: [],
          critique: [],
          application: [],
        },
        adlerOverviewReview: makeReview(),
      }),
    ).rejects.toMatchObject({ code: 'MULTIMODAL_SESSION_FAILED' });
    expect(extractPass).not.toHaveBeenCalled();

    const invalidAdlerService = createMultimodalSessionService({
      adlerAdapter: {
        generate: vi.fn().mockResolvedValue({
          overview: {
            structure: [],
            interpretation: [],
            critique: [],
            application: [],
          },
          model: 'adler-model',
          promptVersion: 'adler-prompt',
          generatorVersion: '',
          degradations: [],
        }),
      },
      candidateAdapter: { extractPass: vi.fn() },
      validationAdapter: { validate: vi.fn() },
      riaAdapter: { buildSkills: vi.fn() },
    });

    await expect(
      invalidAdlerService.generateAdlerOverview({
        primarySource: makePrimarySource(),
        transcript: makeTranscript(),
        evidenceTimeline: makeEvidenceTimeline(),
        degradations: [],
      }),
    ).rejects.toMatchObject({ code: 'MULTIMODAL_SESSION_FAILED' });

    const invalidCandidateManifestService = createMultimodalSessionService({
      adlerAdapter: { generate: vi.fn() },
      candidateAdapter: {
        extractPass: vi
          .fn()
          .mockResolvedValueOnce({
            candidates: [
              {
                candidateId: 'candidate-1',
                passKey: 'frameworks',
                title: '候选',
                summary: 'summary',
                reusableRule: 'rule',
                evidenceIds: ['ev-transcript'],
                claimType: 'sourceFact',
                visualAssertion: false,
              },
            ],
            model: '',
            promptVersion: 'framework-prompt',
          })
          .mockResolvedValue({
            candidates: [],
            model: 'empty-model',
            promptVersion: 'empty-prompt',
          }),
      },
      validationAdapter: { validate: vi.fn() },
      riaAdapter: { buildSkills: vi.fn() },
    });

    await expect(
      invalidCandidateManifestService.extractCandidatePasses({
        primarySource: makePrimarySource(),
        transcript: makeTranscript(),
        evidenceTimeline: makeEvidenceTimeline(),
        confirmedStages: ['adler_overview'],
        adlerOverview: {
          structure: [],
          interpretation: [],
          critique: [],
          application: [],
        },
        adlerOverviewReview: makeReview(),
      }),
    ).rejects.toMatchObject({ code: 'MULTIMODAL_SESSION_FAILED' });

    const invalidRiaService = createMultimodalSessionService({
      adlerAdapter: { generate: vi.fn() },
      candidateAdapter: { extractPass: vi.fn() },
      validationAdapter: { validate: vi.fn() },
      riaAdapter: {
        buildSkills: vi.fn().mockResolvedValue({
          skills: [
            {
              candidateId: 'candidate-keep',
              id: 'skill-1',
              dirName: 'skill-1',
              name: '技能一',
              description: 'desc',
              skillMd: '# skill',
              sourceEvidenceIds: ['ev-audio'],
              mechanism: 'mechanism',
              sourceExample: 'source example',
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
              evidenceIds: ['ev-audio', 'ev-transcript'],
              relations: [],
              model: 'ria-model',
              promptVersion: 'ria-prompt',
              generatorVersion: '',
            },
          ],
        }),
      },
    });

    await expect(
      invalidRiaService.buildRiaSkills({
        primarySource: makePrimarySource(),
        transcript: makeTranscript(),
        confirmedStages: ['adler_overview', 'evidence_and_candidates'],
        evidenceTimeline: makeEvidenceTimeline(),
        validatedCandidates: [
          {
            candidate: {
              candidateId: 'candidate-keep',
              passKey: 'frameworks',
              title: 'keep',
              summary: 'summary',
              reusableRule: 'rule',
              evidenceIds: ['ev-transcript'],
              claimType: 'sourceFact',
              visualAssertion: false,
            },
            validation: {
              candidateId: 'candidate-keep',
              v1: {
                passed: true,
                reason: 'ok',
                reusableContexts: ['高一例题课', '高二错题课'],
              },
              v2: {
                passed: true,
                reason: 'ok',
                novelScenario: '晚自习追问',
                capability: 'guide',
              },
              v3: {
                passed: true,
                reason: 'ok',
                differentiators: ['区分定义与结论'],
              },
            },
            overallPassed: true,
            disposition: 'retain',
          },
        ],
        selectedCandidateIds: ['candidate-keep'],
      }),
    ).rejects.toMatchObject({ code: 'MULTIMODAL_SESSION_FAILED' });
  });

  it('bounds extraction and validation concurrency while preserving deterministic order', async () => {
    let extractionActive = 0;
    let extractionMax = 0;
    const candidateAdapter = {
      extractPass: vi.fn(async ({ passKey }: { passKey: string }) => {
        extractionActive += 1;
        extractionMax = Math.max(extractionMax, extractionActive);
        await new Promise((resolve) => setTimeout(resolve, 5));
        extractionActive -= 1;
        return {
          candidates: Array.from({ length: 6 }, (_, index) => ({
            candidateId: `${passKey}-${index + 1}`,
            passKey,
            title: `${passKey} ${index + 1}`,
            summary: 'summary',
            reusableRule: 'rule',
            evidenceIds: ['ev-transcript'],
            claimType: 'sourceFact' as const,
            visualAssertion: false,
          })),
          model: 'candidate-model',
          promptVersion: 'candidate-prompt',
        };
      }),
    };
    let validationActive = 0;
    let validationMax = 0;
    const validationAdapter = {
      validate: vi.fn(
        async ({ candidate }: { candidate: { candidateId: string } }) => {
          validationActive += 1;
          validationMax = Math.max(validationMax, validationActive);
          await new Promise((resolve) => setTimeout(resolve, 5));
          validationActive -= 1;
          return {
            candidateId: candidate.candidateId,
            v1: { passed: true, reason: 'ok', reusableContexts: ['课堂'] },
            v2: {
              passed: true,
              reason: 'ok',
              novelScenario: '新课堂',
              capability: 'guide',
            },
            v3: { passed: true, reason: 'ok', differentiators: ['证据'] },
          };
        },
      ),
    };
    const service = createMultimodalSessionService({
      adlerAdapter: { generate: vi.fn() },
      candidateAdapter,
      validationAdapter,
      riaAdapter: { buildSkills: vi.fn() },
    });

    const extracted = await service.extractCandidatePasses({
      primarySource: makePrimarySource(),
      transcript: makeTranscript(),
      evidenceTimeline: makeEvidenceTimeline(),
      confirmedStages: ['adler_overview'],
      adlerOverview: {
        structure: [],
        interpretation: [],
        critique: [],
        application: [],
      },
      adlerOverviewReview: makeReview(),
    });

    expect(extractionMax).toBe(3);
    expect(extracted.candidatePasses.frameworks).toHaveLength(4);
    expect(
      extracted.candidatePasses.terms.map((item) => item.candidateId),
    ).toEqual(['terms-1', 'terms-2', 'terms-3', 'terms-4']);

    const validated = await service.validateCandidatePasses({
      primarySource: makePrimarySource(),
      transcript: makeTranscript(),
      confirmedStages: ['adler_overview'],
      evidenceTimeline: makeEvidenceTimeline(),
      candidatePasses: extracted.candidatePasses,
    });

    expect(validationMax).toBe(3);
    expect(validated.results.map((item) => item.candidate.candidateId)).toEqual(
      ['frameworks', 'principles', 'cases', 'counterexamples', 'terms'].flatMap(
        (passKey) =>
          Array.from({ length: 4 }, (_, index) => `${passKey}-${index + 1}`),
      ),
    );
  });

  it('passes only retained-candidate evidence into fused topic generation', async () => {
    const generateFusedTopics = vi.fn().mockResolvedValue({
      candidates: [],
      model: 'fusion-model',
      promptVersion: 'fusion-prompt',
    });
    const service = createMultimodalSessionService({
      adlerAdapter: { generate: vi.fn() },
      candidateAdapter: { extractPass: vi.fn() },
      validationAdapter: { validate: vi.fn() },
      riaAdapter: { buildSkills: vi.fn() },
      fusedTopicAdapter: { generateFusedTopics },
    });

    await service.fuseCandidatePasses({
      evidenceTimeline: makeEvidenceTimeline(),
      retainedCandidates: [
        {
          candidateId: 'frameworks-functions',
          passKey: 'frameworks',
          title: '函数概念教学',
          summary: '函数定义教学框架',
          reusableRule: '先定义后举例',
          evidenceIds: ['ev-transcript'],
          claimType: 'sourceFact',
          visualAssertion: false,
        },
      ],
    });

    expect(generateFusedTopics).toHaveBeenCalledWith(
      expect.objectContaining({
        evidenceTimeline: [
          expect.objectContaining({ evidenceId: 'ev-transcript' }),
        ],
      }),
    );
  });

  it('validates fused topics with bounded concurrency and stable output order', async () => {
    let active = 0;
    let maxActive = 0;
    const fusedCandidates = Array.from({ length: 7 }, (_, index) => ({
      candidateId: `fused-${index + 1}`,
      passKey: 'fused' as const,
      title: `融合主题 ${index + 1}`,
      summary: 'summary',
      reusableRule: 'rule',
      evidenceIds: ['ev-transcript'],
      claimType: 'modelInference' as const,
      visualAssertion: false,
    }));
    const service = createMultimodalSessionService({
      adlerAdapter: { generate: vi.fn() },
      candidateAdapter: { extractPass: vi.fn() },
      validationAdapter: {
        validate: vi.fn(
          async ({ candidate }: { candidate: { candidateId: string } }) => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await new Promise((resolve) => setTimeout(resolve, 5));
            active -= 1;
            const passed = candidate.candidateId !== 'fused-7';
            return {
              candidateId: candidate.candidateId,
              v1: {
                passed,
                reason: passed ? 'ok' : '迁移证据不足',
                reusableContexts: passed ? ['课堂一', '课堂二'] : [],
              },
              v2: {
                passed,
                reason: passed ? 'ok' : '新场景能力不足',
                novelScenario: '新课堂',
                capability: 'guide',
              },
              v3: {
                passed,
                reason: passed ? 'ok' : '差异不明确',
                differentiators: passed ? ['证据'] : [],
              },
            };
          },
        ),
      },
      riaAdapter: { buildSkills: vi.fn() },
      fusedTopicAdapter: {
        generateFusedTopics: vi.fn().mockResolvedValue({
          candidates: fusedCandidates,
          model: 'fusion-model',
          promptVersion: 'fusion-prompt',
        }),
      },
    });

    const result = await service.fuseCandidatePasses({
      evidenceTimeline: makeEvidenceTimeline(),
      retainedCandidates: [
        {
          candidateId: 'frameworks-functions',
          passKey: 'frameworks',
          title: '函数概念教学',
          summary: '函数定义教学框架',
          reusableRule: '先定义后举例',
          evidenceIds: ['ev-transcript'],
          claimType: 'modelInference',
          visualAssertion: false,
        },
      ],
    });

    expect(maxActive).toBe(3);
    expect(
      result.validations.map((item) => item.candidate.candidateId),
    ).toEqual(fusedCandidates.map((candidate) => candidate.candidateId));
    expect(result.validations.at(-1)).toMatchObject({
      overallPassed: false,
      disposition: 'discard',
    });
  });
});
