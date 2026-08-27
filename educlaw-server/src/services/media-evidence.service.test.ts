import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type {
  MultimodalAssetRef,
  MultimodalPrimarySource,
  MultimodalTranscript,
  NormalizedSemanticMoment,
} from '@educlaw/shared';
import { MediaEvidenceService, MediaEvidenceServiceError } from './media-evidence.service';

function assetRef(
  objectKey: string,
  mimeType: string,
  shaSeed: string,
): MultimodalAssetRef {
  return {
    objectKey,
    mimeType,
    sizeBytes: 1024,
    sha256: shaSeed.repeat(64).slice(0, 64),
  };
}

function primarySource(kind: 'video' | 'audio'): MultimodalPrimarySource {
  return {
    sourceId: `${kind}-source-1`,
    kind,
    assetRef: assetRef(
      `skill-sessions/1/source/${kind}.${kind === 'video' ? 'mp4' : 'wav'}`,
      kind === 'video' ? 'video/mp4' : 'audio/wav',
      kind === 'video' ? 'a' : 'b',
    ),
  };
}

function nativeVideoContext() {
  return {
    mode: 'native_video',
    sourceAssetRef: primarySource('video').assetRef,
  };
}

function transcript(): MultimodalTranscript {
  return {
    status: 'ready',
    editable: true,
    segments: [
      {
        startMs: 0,
        endMs: 900,
        text: '高置信讲解片段',
        confidence: 0.93,
      },
      {
        startMs: 900,
        endMs: 1800,
        text: '低置信自动转录片段',
        confidence: 0.42,
      },
      {
        startMs: 1800,
        endMs: 2600,
        text: '教师人工修订片段',
        confidence: 0.31,
        editedByUser: true,
      },
    ],
  };
}

function semanticMoment(
  overrides?: Partial<NormalizedSemanticMoment>,
): NormalizedSemanticMoment {
  return {
    semanticMomentId: 'moment-1',
    startMs: 1000,
    endMs: 1800,
    importance: 0.9,
    type: 'concept',
    summary: '定义关键概念',
    visualTarget: 'slide title and diagram',
    transcriptEvidence: {
      timeRange: { startMs: 1000, endMs: 1500 },
      text: '这里定义了关键概念',
      confidence: 0.94,
    },
    selectionReason: '概念被首次完整定义',
    ...overrides,
  };
}

function buildService(overrides?: ConstructorParameters<typeof MediaEvidenceService>[0]) {
  return new MediaEvidenceService({
    lowConfidenceThreshold: 0.8,
    minFrameSpacingMs: 80,
    maxFramesPerMoment: 6,
    maxSelectedFramesPerMoment: 2,
    ...overrides,
  });
}

function frameCandidateManifest(overrides?: Record<string, unknown>) {
  return {
    candidateId: 'candidate-1',
    semanticMomentId: 'moment-1',
    timestampMs: 1200,
    sourceSignal: 'semantic_moment',
    selectionReason: 'semantic front anchor',
    assetRef: assetRef('skill-sessions/1/frames/selected/frame-1.png', 'image/png', 'c'),
    metrics: {
      analysisWidth: 320,
      analysisHeight: 180,
      brightnessMeanNormalized: 0.5,
      blackPixelRatio: 0.1,
      whitePixelRatio: 0.1,
      entropyNormalized: 0.75,
      sharpness: {
        algorithm: 'laplacian_variance_4_neighbour_normalized',
        normalized: true,
        value: 0.72,
      },
      duplicateHash: {
        algorithm: 'dhash_64',
        value: '0f0f0f0f0f0f0f0f',
      },
    },
    hardRejectedReasons: [],
    suppressed: false,
    duplicateOf: null,
    frameExtractorVersion: 'frame-materializer-v1',
    qualityProcessorVersion: 'frame-quality-v1',
    ...overrides,
  };
}

describe('MediaEvidenceService', () => {
  it('normalizes semantic moments with deterministic ids and rejects invalid model drafts', async () => {
    const service = buildService({
      semanticMomentModelAdapter: {
        async generateSemanticMoments() {
          return {
            model: 'stub-model',
            promptVersion: 'v1',
            moments: [
              {
                startMs: 1800,
                endMs: 2600,
                importance: 0.7,
                type: 'summary',
                summary: '课堂小结',
                selectionReason: '收束本节内容',
              },
              {
                startMs: 1000,
                endMs: 1800,
                importance: 0.9,
                type: 'concept',
                summary: '定义关键概念',
                visualTarget: 'slide title and diagram',
                selectionReason: '概念被首次完整定义',
              },
            ],
          };
        },
      },
    });

    const first = await service.generateSemanticMoments({
      primarySource: primarySource('video'),
      durationMs: 4000,
      transcript: transcript(),
      visualContext: nativeVideoContext(),
    });
    const second = await service.generateSemanticMoments({
      primarySource: primarySource('video'),
      durationMs: 4000,
      transcript: transcript(),
      visualContext: nativeVideoContext(),
    });

    expect(first.moments.map((moment) => moment.semanticMomentId)).toEqual(
      second.moments.map((moment) => moment.semanticMomentId),
    );
    expect(first.moments.map((moment) => moment.startMs)).toEqual([1000, 1800]);
    expect(first.provenance.model).toBe('stub-model');

    const invalidService = buildService({
      semanticMomentModelAdapter: {
        async generateSemanticMoments() {
          return { moments: [] };
        },
      },
    });
    await expect(
      invalidService.generateSemanticMoments({
        primarySource: primarySource('audio'),
        durationMs: 4000,
        transcript: transcript(),
      }),
    ).rejects.toMatchObject({ code: 'MEDIA_EVIDENCE_FAILED' satisfies MediaEvidenceServiceError['code'] });

    await expect(
      service.generateSemanticMoments({
        primarySource: primarySource('video'),
        durationMs: 4000,
        transcript: transcript(),
      }),
    ).rejects.toMatchObject({ code: 'MEDIA_EVIDENCE_FAILED' satisfies MediaEvidenceServiceError['code'] });
  });

  it('plans deterministic video frame requests with anchor priorities and explicit degradations', () => {
    const service = buildService();
    const plan = service.planFrameCandidates({
      sourceKind: 'video',
      durationMs: 5000,
      hasAudio: false,
      semanticMoments: [semanticMoment()],
      transcriptCueTimestampsMs: [1200],
      slowVisualChangeTimestampsMs: undefined,
      sceneChangeTimestampsMs: undefined,
    });

    expect(plan.degradations.map((item) => item.code)).toContain('VISUAL_SIGNAL_DETECTOR_UNAVAILABLE');
    expect(plan.degradations.map((item) => item.code)).toContain('NO_AUDIO_TRACK');
    expect(plan.frameRequests.length).toBeGreaterThanOrEqual(3);
    expect(plan.frameRequests.length).toBeLessThanOrEqual(6);
    expect(plan.frameRequests.some((item) => item.sourceSignal === 'semantic_moment')).toBe(true);
    expect(new Set(plan.frameRequests.map((item) => item.timestampMs)).size).toBe(
      plan.frameRequests.length,
    );
    expect(plan.frameRequests.map((item) => item.timestampMs)).toEqual(
      expect.arrayContaining([1000, 1399, 1799]),
    );
    expect(
      plan.frameRequests.every(
        (item) => item.timestampMs >= 1000 && item.timestampMs < 1800,
      ),
    ).toBe(true);

    const saturatedPlan = service.planFrameCandidates({
      sourceKind: 'video',
      durationMs: 5000,
      semanticMoments: [
        semanticMoment({
          startMs: 0,
          endMs: 1000,
        }),
      ],
      sceneChangeTimestampsMs: [100, 200, 300, 400, 500, 600, 700, 800, 900],
      transcriptCueTimestampsMs: [],
      slowVisualChangeTimestampsMs: [],
    });
    expect(saturatedPlan.frameRequests).toHaveLength(6);
    expect(
      saturatedPlan.frameRequests
        .filter((item) => item.sourceSignal === 'semantic_moment')
        .map((item) => item.timestampMs),
    ).toEqual([0, 499, 999]);
    expect(
      saturatedPlan.frameRequests
        .filter((item) => item.sourceSignal === 'scene_change')
        .map((item) => item.timestampMs),
    ).toEqual([100, 200, 300]);

    const threeFramePlan = buildService({ maxFramesPerMoment: 3 }).planFrameCandidates({
      sourceKind: 'video',
      durationMs: 5000,
      semanticMoments: [
        semanticMoment({
          startMs: 0,
          endMs: 1000,
        }),
      ],
      sceneChangeTimestampsMs: [100, 200, 300],
      transcriptCueTimestampsMs: [],
      slowVisualChangeTimestampsMs: [],
    });
    expect(threeFramePlan.frameRequests.map((item) => item.timestampMs)).toEqual([0, 499, 999]);

    const tightSpacingPlan = buildService({
      minFrameSpacingMs: 80,
      maxFramesPerMoment: 3,
    }).planFrameCandidates({
      sourceKind: 'video',
      durationMs: 1000,
      semanticMoments: [
        semanticMoment({
          startMs: 0,
          endMs: 100,
          transcriptEvidence: undefined,
          audioEvidence: undefined,
        }),
      ],
      transcriptCueTimestampsMs: [],
      slowVisualChangeTimestampsMs: [],
      sceneChangeTimestampsMs: [],
    });
    expect(tightSpacingPlan.frameRequests.map((item) => item.timestampMs)).toEqual([0, 49, 99]);
  });

  it('rejects short semantic windows and treats audio as frame-not-applicable', () => {
    const service = buildService();
    expect(() =>
      service.planFrameCandidates({
        sourceKind: 'video',
        durationMs: 5000,
        semanticMoments: [
          semanticMoment({
            semanticMomentId: 'moment-short',
            startMs: 1000,
            endMs: 1002,
          }),
        ],
      }),
    ).toThrowError(MediaEvidenceServiceError);

    const audioPlan = service.planFrameCandidates({
      sourceKind: 'audio',
      durationMs: 5000,
      semanticMoments: [semanticMoment()],
    });
    expect(audioPlan.frameRequests).toEqual([]);
    expect(audioPlan.degradations.map((item) => item.code)).toContain('FRAME_NOT_APPLICABLE');

    expect(() =>
      service.planFrameCandidates({
        sourceKind: 'document',
        durationMs: 5000,
        semanticMoments: [semanticMoment()],
      }),
    ).toThrowError(MediaEvidenceServiceError);
  });

  it('soft-ranks visual candidates with deterministic fallback and never revives suppressed or rejected frames', async () => {
    const adapterCalls: unknown[] = [];
    const service = buildService({
      visionRankingAdapter: {
        async rankVisualCandidates(input) {
          adapterCalls.push(input);
          return {
            rankings: [
              { candidateId: 'candidate-suppressed', score: 0.99, reason: 'invalid' },
              { candidateId: 'candidate-2', score: Number.NaN, reason: 'bad-score' },
            ],
          };
        },
      },
    });

    const result = await service.rankVisualCandidates({
      sourceKind: 'video',
      durationMs: 5000,
      semanticMoments: [semanticMoment()],
      frameCandidateManifest: [
        frameCandidateManifest({
          candidateId: 'candidate-1',
          timestampMs: 1200,
        }),
        frameCandidateManifest({
          candidateId: 'candidate-2',
          timestampMs: 1400,
          metrics: {
            analysisWidth: 320,
            analysisHeight: 180,
            brightnessMeanNormalized: 0.5,
            blackPixelRatio: 0.1,
            whitePixelRatio: 0.1,
            entropyNormalized: 0.65,
            sharpness: {
              algorithm: 'laplacian_variance_4_neighbour_normalized',
              normalized: true,
              value: 0.45,
            },
            duplicateHash: {
              algorithm: 'dhash_64',
              value: '00ff00ff00ff00ff',
            },
          },
        }),
        frameCandidateManifest({
          candidateId: 'candidate-suppressed',
          timestampMs: 1500,
          suppressed: true,
          duplicateOf: 'candidate-1',
        }),
        frameCandidateManifest({
          candidateId: 'candidate-rejected',
          timestampMs: 1600,
          hardRejectedReasons: ['blurry'],
        }),
      ],
    });

    expect(adapterCalls).toHaveLength(1);
    expect(result.degradations.map((item) => item.code)).toContain(
      'VISION_RANKING_OUTPUT_INVALID',
    );
    expect(result.selectedFrames.map((item) => item.candidateId)).toEqual([
      'candidate-1',
      'candidate-2',
    ]);
    expect(result.selectedFrames.every((item) => item.score >= 0 && item.score <= 1)).toBe(true);
    expect(result.selectedFrames.every((item) => item.rankingMethod === 'deterministic_quality_fallback')).toBe(
      true,
    );
  });

  it('does not call vision for audio and reports no usable visual evidence deterministically', async () => {
    const visionAdapter = {
      rankVisualCandidates: vi.fn(),
    };
    const service = buildService({ visionRankingAdapter: visionAdapter });

    const audioResult = await service.rankVisualCandidates({
      sourceKind: 'audio',
      durationMs: 5000,
      semanticMoments: [semanticMoment()],
      frameCandidateManifest: [],
    });
    expect(audioResult.selectedFrames).toEqual([]);
    expect(audioResult.degradations.map((item) => item.code)).toContain('FRAME_NOT_APPLICABLE');
    expect(visionAdapter.rankVisualCandidates).not.toHaveBeenCalled();

    const noUsable = await service.rankVisualCandidates({
      sourceKind: 'video',
      durationMs: 5000,
      semanticMoments: [semanticMoment({ visualTarget: undefined })],
      frameCandidateManifest: [
        frameCandidateManifest({
          candidateId: 'candidate-1',
          suppressed: true,
          duplicateOf: 'candidate-2',
        }),
        frameCandidateManifest({
          candidateId: 'candidate-2',
          hardRejectedReasons: ['black_screen'],
        }),
      ],
    });
    expect(noUsable.selectedFrames).toEqual([]);
    expect(noUsable.degradations.map((item) => item.code)).toContain(
      'NO_USABLE_VISUAL_EVIDENCE',
    );

    const relaxedSharpness = await buildService().rankVisualCandidates({
      sourceKind: 'video',
      durationMs: 5000,
      semanticMoments: [semanticMoment()],
      frameCandidateManifest: [
        frameCandidateManifest({
          candidateId: 'candidate-blurry',
          hardRejectedReasons: ['blurry'],
        }),
      ],
    });
    expect(relaxedSharpness.selectedFrames.map((item) => item.candidateId)).toEqual([
      'candidate-blurry',
    ]);
    expect(relaxedSharpness.degradations.map((item) => item.code)).toContain(
      'FRAME_SHARPNESS_THRESHOLD_RELAXED',
    );

    const fallbackFromEmptyRanking = await buildService({
      visionRankingAdapter: {
        async rankVisualCandidates() {
          return { rankings: [] };
        },
      },
    }).rankVisualCandidates({
      sourceKind: 'video',
      durationMs: 5000,
      semanticMoments: [semanticMoment()],
      frameCandidateManifest: [frameCandidateManifest()],
    });
    expect(fallbackFromEmptyRanking.degradations.map((item) => item.code)).toContain(
      'VISION_RANKING_OUTPUT_INVALID',
    );
    expect(fallbackFromEmptyRanking.selectedFrames[0]?.rankingMethod).toBe(
      'deterministic_quality_fallback',
    );
  });

  it('builds a deterministic evidence timeline for audio and frame evidence with claim-type rules', () => {
    const service = buildService();
    const source = primarySource('video');
    const selectedFrames = [
      {
        candidateId: 'candidate-b',
        semanticMomentId: 'moment-1',
        timestampMs: 1450,
        sourceSignal: 'scene_change' as const,
        selectionReason: 'scene change fallback after quality ranking',
        assetRef: assetRef('skill-sessions/1/frames/selected/frame-b.png', 'image/png', 'd'),
        score: 0.51,
        rankingReason: 'quality fallback',
        rankingMethod: 'deterministic_quality_fallback' as const,
        qualitySummary: frameCandidateManifest({
          candidateId: 'candidate-b',
          timestampMs: 1450,
        }).metrics,
      },
      {
        candidateId: 'candidate-a',
        semanticMomentId: 'moment-1',
        timestampMs: 1200,
        sourceSignal: 'semantic_moment' as const,
        selectionReason: 'semantic midpoint selected by ranking',
        assetRef: assetRef('skill-sessions/1/frames/selected/frame-a.png', 'image/png', 'c'),
        score: 0.81,
        rankingReason: 'visual target match',
        rankingMethod: 'vision_model' as const,
        rankingModel: 'vision-ranker-v1',
        qualitySummary: frameCandidateManifest().metrics,
      },
    ];

    const first = service.buildEvidenceTimeline({
      durationMs: 5000,
      primarySource: source,
      transcript: transcript(),
      semanticMoments: [semanticMoment()],
      selectedFrames: [selectedFrames[0], selectedFrames[1]],
      audioPlayableAssetRef: assetRef('skill-sessions/1/audio/lesson.wav', 'audio/wav', 'e'),
      transcriptAssetRef: assetRef('skill-sessions/1/transcript/lesson.json', 'application/json', 'f'),
      sourceHasAudio: true,
    });
    const second = service.buildEvidenceTimeline({
      durationMs: 5000,
      primarySource: source,
      transcript: transcript(),
      semanticMoments: [semanticMoment()],
      selectedFrames: [selectedFrames[1], selectedFrames[0]],
      audioPlayableAssetRef: assetRef('skill-sessions/1/audio/lesson.wav', 'audio/wav', 'e'),
      transcriptAssetRef: assetRef('skill-sessions/1/transcript/lesson.json', 'application/json', 'f'),
      sourceHasAudio: true,
    });

    expect(first.evidenceItems.map((item) => item.evidenceId)).toEqual(
      second.evidenceItems.map((item) => item.evidenceId),
    );
    expect(first.evidenceItems.every((item) => item.timeRange.endMs > item.timeRange.startMs)).toBe(true);
    expect(
      first.evidenceItems.find(
        (item) => item.kind === 'transcript' && item.text.includes('高置信'),
      )?.claimType,
    ).toBe('sourceFact');
    expect(
      first.evidenceItems.find(
        (item) => item.kind === 'transcript' && item.text.includes('高置信'),
      )?.assetRef?.objectKey,
    ).toContain('/transcript/');
    expect(
      first.evidenceItems.find(
        (item) => item.kind === 'transcript' && item.text.includes('低置信'),
      )?.claimType,
    ).toBe('modelInference');
    expect(
      first.evidenceItems.find(
        (item) => item.kind === 'transcript' && item.text.includes('人工修订'),
      )?.claimType,
    ).toBe('userInput');
    expect(
      first.evidenceItems.filter((item) => item.kind === 'frame').map((item) => item.claimType),
    ).toEqual(['modelInference', 'modelInference']);
    expect(
      first.evidenceItems.find(
        (item) => item.kind === 'frame' && item.selectionReason.includes('quality fallback'),
      )?.provenance.confidence,
    ).toBeNull();
    expect(
      first.evidenceItems.find(
        (item) => item.kind === 'frame' && item.selectionReason.includes('quality fallback'),
      )?.provenance.method,
    ).toBe('deterministic_quality_fallback');
    expect(
      first.evidenceItems.every(
        (item) =>
          item.source.primarySourceId === source.sourceId &&
          JSON.stringify(item).includes(source.sourceId),
      ),
    ).toBe(true);
    expect(JSON.stringify(first.evidenceItems)).not.toContain('localPath');
  });

  it('preserves pure audio evidence and marks no-audio video with explicit degradation', () => {
    const service = buildService();

    const audioTimeline = service.buildEvidenceTimeline({
      durationMs: 5000,
      primarySource: primarySource('audio'),
      transcript: transcript(),
      semanticMoments: [semanticMoment({ visualTarget: undefined })],
      selectedFrames: [],
      sourceHasAudio: true,
    });
    expect(audioTimeline.evidenceItems.some((item) => item.kind === 'audio_segment')).toBe(true);
    expect(audioTimeline.evidenceItems.some((item) => item.kind === 'frame')).toBe(false);
    expect(audioTimeline.degradations.map((item) => item.code)).toContain('FRAME_NOT_APPLICABLE');

    expect(() =>
      service.buildEvidenceTimeline({
        durationMs: 5000,
        primarySource: primarySource('audio'),
        transcript: transcript(),
        semanticMoments: [],
        selectedFrames: [],
        sourceHasAudio: false,
      }),
    ).toThrowError(MediaEvidenceServiceError);

    const noAudioVideo = service.buildEvidenceTimeline({
      durationMs: 5000,
      primarySource: primarySource('video'),
      transcript: {
        status: 'not_applicable',
        editable: true,
        segments: [],
      },
      semanticMoments: [semanticMoment()],
      selectedFrames: [
        {
          candidateId: 'candidate-a',
          semanticMomentId: 'moment-1',
          timestampMs: 1200,
          sourceSignal: 'semantic_moment' as const,
          selectionReason: 'semantic midpoint selected by ranking',
          assetRef: assetRef('skill-sessions/1/frames/selected/frame-a.png', 'image/png', 'c'),
          score: 0.81,
          rankingReason: 'visual target match',
          rankingMethod: 'vision_model' as const,
          rankingModel: 'vision-ranker-v1',
          qualitySummary: frameCandidateManifest().metrics,
        },
      ],
      sourceHasAudio: false,
    });

    expect(noAudioVideo.evidenceItems.some((item) => item.kind === 'frame')).toBe(true);
    expect(noAudioVideo.degradations.map((item) => item.code)).toContain('NO_AUDIO_TRACK');
  });

  it('rejects invalid Python frame manifest and selected frame inputs strictly', async () => {
    const service = buildService();

    await expect(
      service.rankVisualCandidates({
        sourceKind: 'video',
        durationMs: 5000,
        semanticMoments: [semanticMoment()],
        frameCandidateManifest: [
          frameCandidateManifest({
            localPath: 'should-not-pass',
          }),
        ],
      }),
    ).rejects.toMatchObject({ code: 'MEDIA_EVIDENCE_FAILED' satisfies MediaEvidenceServiceError['code'] });

    await expect(
      service.rankVisualCandidates({
        sourceKind: 'video',
        durationMs: 5000,
        semanticMoments: [semanticMoment()],
        frameCandidateManifest: [
          frameCandidateManifest({
            candidateId: 'candidate-keeper',
          }),
          frameCandidateManifest({
            candidateId: 'candidate-cross',
            semanticMomentId: 'moment-2',
            duplicateOf: 'candidate-keeper',
            suppressed: true,
          }),
        ],
      }),
    ).rejects.toMatchObject({ code: 'MEDIA_EVIDENCE_FAILED' satisfies MediaEvidenceServiceError['code'] });

    await expect(
      service.rankVisualCandidates({
        sourceKind: 'video',
        durationMs: 5000,
        semanticMoments: [semanticMoment()],
        frameCandidateManifest: [
          frameCandidateManifest({
            assetRef: {
              ...assetRef('skill-sessions/1/frames/selected/frame-1.png', 'image/png', 'c'),
              localPath: 'C:/secret/frame.png',
            },
          }),
        ],
      }),
    ).rejects.toMatchObject({ code: 'MEDIA_EVIDENCE_FAILED' satisfies MediaEvidenceServiceError['code'] });

    expect(() =>
      service.buildEvidenceTimeline({
        durationMs: 5000,
        primarySource: primarySource('video'),
        transcript: {
          status: 'pending',
          editable: true,
          segments: [
            {
              startMs: 0,
              endMs: 100,
              text: '高置信但未确认',
              confidence: 0.99,
            },
          ],
        },
        semanticMoments: [semanticMoment()],
        selectedFrames: [
          {
            candidateId: 'candidate-a',
            semanticMomentId: 'moment-1',
            timestampMs: 999,
            sourceSignal: 'semantic_moment',
            selectionReason: 'too early',
            assetRef: assetRef('skill-sessions/1/frames/selected/frame-a.png', 'image/png', 'c'),
            score: 0.81,
            rankingReason: 'visual target match',
            rankingMethod: 'vision_model',
            rankingModel: 'vision-ranker-v1',
            qualitySummary: frameCandidateManifest().metrics,
          },
        ],
        sourceHasAudio: false,
      }),
    ).toThrowError(MediaEvidenceServiceError);

    const pendingTimeline = service.buildEvidenceTimeline({
      durationMs: 5000,
      primarySource: primarySource('audio'),
      transcript: {
        status: 'pending',
        editable: true,
        segments: [
          {
            startMs: 0,
            endMs: 100,
            text: '高置信但未确认',
            confidence: 0.99,
          },
        ],
      },
      semanticMoments: [],
      selectedFrames: [],
      sourceHasAudio: true,
    });
    expect(pendingTimeline.evidenceItems[0]?.claimType).toBe('modelInference');

    const lowConfidenceTimeline = service.buildEvidenceTimeline({
      durationMs: 5000,
      primarySource: primarySource('audio'),
      transcript: {
        status: 'low_confidence',
        editable: true,
        segments: [
          {
            startMs: 0,
            endMs: 100,
            text: '低置信未确认',
            confidence: 0.4,
          },
        ],
      },
      semanticMoments: [],
      selectedFrames: [],
      sourceHasAudio: true,
    });
    expect(pendingTimeline.degradations.map((item) => item.code)).toContain(
      'FRAME_NOT_APPLICABLE',
    );
    expect(lowConfidenceTimeline.degradations.map((item) => item.code)).toContain(
      'ASR_LOW_CONFIDENCE_UNCONFIRMED',
    );

    expect(() =>
      service.buildEvidenceTimeline({
        durationMs: 5000,
        primarySource: primarySource('video'),
        transcript: transcript(),
        semanticMoments: [semanticMoment()],
        selectedFrames: [],
        sourceHasAudio: true,
        audioPlayableAssetRef: assetRef('skill-sessions/1/audio/not-audio.png', 'image/png', 'e'),
      }),
    ).toThrowError(MediaEvidenceServiceError);
  });

  it('generates deterministic semantic moment ids from canonical content', async () => {
    const service = buildService({
      semanticMomentModelAdapter: {
        async generateSemanticMoments() {
          return {
            model: 'stub-model',
            promptVersion: 'v1',
            moments: [
              {
                startMs: 1000,
                endMs: 1800,
                importance: 0.9,
                type: 'concept',
                summary: '定义关键概念',
                visualTarget: 'slide title and diagram',
                selectionReason: '概念被首次完整定义',
              },
            ],
          };
        },
      },
    });

    const result = await service.generateSemanticMoments({
      primarySource: primarySource('video'),
      durationMs: 4000,
      transcript: transcript(),
      visualContext: nativeVideoContext(),
    });

    const expectedPrefix = createHash('sha256')
      .update(
        JSON.stringify({
          startMs: 1000,
          endMs: 1800,
          importance: 0.9,
          type: 'concept',
          summary: '定义关键概念',
          visualTarget: 'slide title and diagram',
          transcriptEvidence: null,
          audioEvidence: null,
          selectionReason: '概念被首次完整定义',
        }),
      )
      .digest('hex')
      .slice(0, 16);

    expect(result.moments[0]?.semanticMomentId).toContain(expectedPrefix);
  });

  it('corrects ASR transcript segments and marks correctedByModel', async () => {
    const corrections = vi.fn(async () => ({
      corrections: [
        { index: 0, text: '高置信讲解片段：函数的定义' },
        { index: 1, text: '低置信自动转录片段：韩树应为函数' },
      ],
    }));
    const service = buildService({
      transcriptCorrectionModelAdapter: { generateTranscriptCorrections: corrections },
    });

    const result = await service.correctTranscript({ transcript: transcript() });

    expect(result).not.toBeNull();
    expect(result?.transcript.segments[0]?.text).toBe('高置信讲解片段：函数的定义');
    expect(result?.transcript.segments[0]?.correctedByModel).toBe(true);
    expect(result?.transcript.segments[1]?.text).toBe('低置信自动转录片段：韩树应为函数');
    expect(result?.transcript.segments[1]?.correctedByModel).toBe(true);
    expect(result?.transcript.segments[2]?.text).toBe('教师人工修订片段');
    expect(result?.transcript.segments[2]?.correctedByModel).toBeUndefined();
    expect(result?.correctedCount).toBe(2);
    expect(result?.degradations).toEqual([]);
  });

  it('never overwrites user-edited or already-corrected transcript segments', async () => {
    const corrections = vi.fn(async () => ({
      corrections: [
        { index: 0, text: '新的修正' },
        { index: 1, text: '已纠错片段的二次修正' },
        { index: 2, text: '试图覆盖用户修订' },
      ],
    }));
    const service = buildService({
      transcriptCorrectionModelAdapter: { generateTranscriptCorrections: corrections },
    });
    const input: MultimodalTranscript = {
      status: 'ready',
      editable: true,
      segments: [
        { startMs: 0, endMs: 900, text: '普通片段', confidence: 0.9 },
        {
          startMs: 900,
          endMs: 1800,
          text: '已纠错片段',
          confidence: 0.4,
          correctedByModel: true,
        },
        {
          startMs: 1800,
          endMs: 2600,
          text: '教师人工修订片段',
          confidence: 0.3,
          editedByUser: true,
        },
      ],
    };

    const result = await service.correctTranscript({ transcript: input });

    expect(result?.transcript.segments[0]?.text).toBe('普通片段');
    expect(result?.transcript.segments[1]?.text).toBe('已纠错片段');
    expect(result?.transcript.segments[2]?.text).toBe('教师人工修订片段');
    expect(result?.correctedCount).toBe(0);
  });

  it('rejects malformed model corrections with a stable error', async () => {
    const invalid = buildService({
      transcriptCorrectionModelAdapter: {
        async generateTranscriptCorrections() {
          return { corrections: [{ index: 99, text: '越界' }] };
        },
      },
    });
    await expect(
      invalid.correctTranscript({ transcript: transcript() }),
    ).rejects.toMatchObject({ code: 'MEDIA_EVIDENCE_FAILED' satisfies MediaEvidenceServiceError['code'] });

    const emptyText = buildService({
      transcriptCorrectionModelAdapter: {
        async generateTranscriptCorrections() {
          return { corrections: [{ index: 0, text: '   ' }] };
        },
      },
    });
    await expect(
      emptyText.correctTranscript({ transcript: transcript() }),
    ).rejects.toMatchObject({ code: 'MEDIA_EVIDENCE_FAILED' satisfies MediaEvidenceServiceError['code'] });
  });

  it('degrades gracefully when transcript correction is unavailable or unnecessary', async () => {
    const noAdapter = buildService();
    expect(await noAdapter.correctTranscript({ transcript: transcript() })).toBeNull();

    const allLocked = buildService({
      transcriptCorrectionModelAdapter: {
        async generateTranscriptCorrections() {
          throw new Error('model unavailable');
        },
      },
    });
    const locked: MultimodalTranscript = {
      status: 'ready',
      editable: true,
      segments: [
        { startMs: 0, endMs: 900, text: '用户已编辑', editedByUser: true },
      ],
    };
    expect(await allLocked.correctTranscript({ transcript: locked })).toBeNull();

    const failing = buildService({
      transcriptCorrectionModelAdapter: {
        async generateTranscriptCorrections() {
          throw new Error('model unavailable');
        },
      },
    });
    const degraded = await failing.correctTranscript({ transcript: transcript() });
    expect(degraded?.transcript).toEqual(transcript());
    expect(degraded?.correctedCount).toBe(0);
    expect(degraded?.degradations.map((item) => item.code)).toContain(
      'ASR_TRANSCRIPT_CORRECTION_FAILED',
    );
  });
});
