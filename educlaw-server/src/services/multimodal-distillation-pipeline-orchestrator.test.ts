import { describe, expect, it, vi } from 'vitest';
import {
  parseMultimodalSessionState,
  type MultimodalSessionState,
} from '@educlaw/shared';
import { MediaEvidenceService } from './media-evidence.service.js';
import {
  createMultimodalDistillationPipelineOrchestrator,
} from './multimodal-distillation-pipeline-orchestrator.js';
import type { MultimodalDistillationPipelineStore } from './multimodal-distillation-pipeline-store.js';
import type { MultimodalPipelineSnapshot } from './multimodal-pipeline-store.js';

const audioSource = {
  sourceId: 'source-audio-1',
  kind: 'audio' as const,
  assetRef: {
    objectKey: 'skill-sessions/101/source/audio.mp3',
    mimeType: 'audio/mpeg',
    sizeBytes: 4096,
    sha256: 'a'.repeat(64),
  },
};

const videoSource = {
  sourceId: 'source-video-1',
  kind: 'video' as const,
  assetRef: {
    objectKey: 'skill-sessions/101/source/video.mp4',
    mimeType: 'video/mp4',
    sizeBytes: 8192,
    sha256: 'b'.repeat(64),
  },
};

function makeState(
  source: typeof audioSource | typeof videoSource,
  overrides: Partial<MultimodalSessionState> = {},
): MultimodalSessionState {
  return parseMultimodalSessionState({
    schemaVersion: 1,
    primarySource: source,
    transcript: {
      status: 'ready',
      editable: true,
      segments: [
        {
          startMs: 0,
          endMs: 10_000,
          text: '看这里，先定义概念，再演示步骤',
          confidence: 0.96,
          editedByUser: false,
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
    semanticMoments: [],
    degradations: [],
    adlerOverview: null,
    adlerOverviewReview: null,
    selectedCandidateIds: [],
    candidateValidations: [],
    candidateSkills: [],
    operationReceipts: [],
    ...overrides,
  });
}

function makeSnapshot(input: {
  source: typeof audioSource | typeof videoSource;
  mediaStage: MultimodalPipelineSnapshot['mediaStage'];
  revisionNo?: number;
  state?: Partial<MultimodalSessionState>;
}): MultimodalPipelineSnapshot {
  return {
    sessionId: '101',
    displayName: '蒸馏课程',
    status: 'collecting',
    mediaStage: input.mediaStage,
    revisionNo: input.revisionNo ?? 4,
    createdAt: '2026-08-23T10:00:00.000Z',
    updatedAt: '2026-08-23T10:01:00.000Z',
    mediaState: makeState(input.source, input.state),
    confirmedStages: [],
    error: null,
  };
}

function prepareOutput(source: typeof audioSource | typeof videoSource) {
  const video = source.kind === 'video';
  return {
    schemaVersion: 1,
    jobType: 'media_prepare',
    sessionId: '101',
    sourceId: source.sourceId,
    sourceKind: source.kind,
    durationMs: 10_000,
    hasAudio: true,
    hasVideo: video,
    normalizedAudioAssetRef: {
      objectKey: 'skill-sessions/101/jobs/701/attempt-1/normalized-audio.wav',
      mimeType: 'audio/wav',
      sizeBytes: 16_000,
      sha256: 'c'.repeat(64),
    },
    visualSignals: video
      ? {
          sceneChangeTimestampsMs: [2500],
          slowVisualChangeTimestampsMs: [6500],
          sampledFrameCount: 12,
          detectorVersion: '1.0.0',
        }
      : null,
    resultManifestRef: {
      objectKey: 'skill-sessions/101/jobs/701/attempt-1/result.json',
      mimeType: 'application/json',
      sizeBytes: 512,
      sha256: 'd'.repeat(64),
    },
    processorVersion: '1.0.0',
    degradations: [],
  };
}

function transcribeOutput(source: typeof audioSource | typeof videoSource) {
  return {
    schemaVersion: 1,
    jobType: 'transcribe',
    sessionId: '101',
    sourceId: source.sourceId,
    durationMs: 10_000,
    transcript: makeState(source).transcript,
    transcriptAssetRef: {
      objectKey: 'skill-sessions/101/jobs/702/attempt-1/transcript.json',
      mimeType: 'application/json',
      sizeBytes: 1024,
      sha256: 'e'.repeat(64),
    },
    resultManifestRef: {
      objectKey: 'skill-sessions/101/jobs/702/attempt-1/result.json',
      mimeType: 'application/json',
      sizeBytes: 512,
      sha256: 'f'.repeat(64),
    },
    processorVersion: '1.0.0',
    degradations: [],
  };
}

function frameOutput() {
  return {
    schemaVersion: 1,
    jobType: 'frame_materialize',
    sessionId: '101',
    sourceId: videoSource.sourceId,
    candidates: [
      {
        candidateId: 'frame-001',
        semanticMomentId: 'moment-001',
        timestampMs: 500,
        sourceSignal: 'semantic_moment',
        selectionReason: '核心画面',
        assetRef: {
          objectKey: 'skill-sessions/101/jobs/703/attempt-1/frames/frame-001.png',
          mimeType: 'image/png',
          sizeBytes: 512,
          sha256: '1'.repeat(64),
        },
        metrics: {
          analysisWidth: 320,
          analysisHeight: 180,
          brightnessMeanNormalized: 0.5,
          blackPixelRatio: 0,
          whitePixelRatio: 0.1,
          entropyNormalized: 0.7,
          sharpness: {
            algorithm: 'laplacian_variance_4_neighbour_normalized',
            normalized: true,
            value: 0.0002,
          },
          duplicateHash: { algorithm: 'dhash_64', value: '0123456789abcdef' },
        },
        hardRejectedReasons: ['blurry'],
        suppressed: false,
        duplicateOf: null,
        frameExtractorVersion: '1.0.0',
        qualityProcessorVersion: '1.0.0',
      },
    ],
    resultManifestRef: {
      objectKey: 'skill-sessions/101/jobs/703/attempt-1/result.json',
      mimeType: 'application/json',
      sizeBytes: 512,
      sha256: '2'.repeat(64),
    },
    processorVersion: '1.0.0',
    degradations: [],
  };
}

function evidenceService(): MediaEvidenceService {
  return new MediaEvidenceService({
    semanticMomentModelAdapter: {
      generateSemanticMoments: () => ({
        moments: [
          {
            startMs: 0,
            endMs: 10_000,
            importance: 0.9,
            type: 'demonstration',
            summary: '定义并演示步骤',
            visualTarget: '板书与步骤变化',
            audioEvidence: null,
            transcriptEvidence: null,
            selectionReason: '核心教学步骤',
          },
        ],
        model: 'semantic-model',
        promptVersion: 'semantic-v1',
      }),
    },
  });
}

function storeFrom(
  methods: Partial<MultimodalDistillationPipelineStore>,
): MultimodalDistillationPipelineStore {
  return {
    loadSnapshot: vi.fn(),
    loadLatestJob: vi.fn(),
    persistSemanticPlan: vi.fn(),
    persistEvidence: vi.fn(),
    persistAdler: vi.fn(),
    ...methods,
  } as MultimodalDistillationPipelineStore;
}

describe('multimodal distillation pipeline orchestrator', () => {
  it('builds timestamp evidence for audio while explicitly creating no frame job', async () => {
    const snapshot = makeSnapshot({
      source: audioSource,
      mediaStage: 'building_semantic_windows',
    });
    const persisted = { ...snapshot, mediaStage: 'building_evidence' as const };
    const persistSemanticPlan = vi.fn().mockResolvedValue(persisted);
    const store = storeFrom({
      loadSnapshot: vi.fn().mockResolvedValue(snapshot),
      loadLatestJob: vi
        .fn()
        .mockResolvedValueOnce({
          jobId: '701',
          jobType: 'media_prepare',
          status: 'succeeded',
          attemptNo: 1,
          inputManifest: {},
          outputManifest: prepareOutput(audioSource),
        })
        .mockResolvedValueOnce({
          jobId: '702',
          jobType: 'transcribe',
          status: 'succeeded',
          attemptNo: 1,
          inputManifest: {},
          outputManifest: transcribeOutput(audioSource),
        }),
      persistSemanticPlan,
    });
    const orchestrator = createMultimodalDistillationPipelineOrchestrator({
      store,
      mediaEvidenceService: evidenceService(),
      sessionService: { generateAdlerOverview: vi.fn() },
    });

    const result = await orchestrator.runDistillationPipeline({
      authUserId: 'user-1',
      sessionId: '101',
    });

    expect(result).toBe(persisted);
    expect(persistSemanticPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        authUserId: 'user-1',
        sessionId: '101',
        expectedRevisionNo: 4,
        evidenceItems: expect.arrayContaining([
          expect.objectContaining({ kind: 'audio_segment' }),
        ]),
      }),
    );
    expect(persistSemanticPlan.mock.calls[0]?.[0]).not.toHaveProperty(
      'frameJobInput',
    );
  });

  it('runs the ASR transcript correction pass before semantic analysis and persists the fixed transcript', async () => {
    const snapshot = makeSnapshot({
      source: audioSource,
      mediaStage: 'building_semantic_windows',
      state: {
        transcript: {
          status: 'ready',
          editable: true,
          segments: [
            {
              startMs: 0,
              endMs: 10_000,
              text: '看这里，先定义韩树概念，再演示步骤',
              confidence: 0.61,
            },
          ],
        },
      },
    });
    const persisted = { ...snapshot, mediaStage: 'building_evidence' as const };
    const persistSemanticPlan = vi.fn().mockResolvedValue(persisted);
    const store = storeFrom({
      loadSnapshot: vi.fn().mockResolvedValue(snapshot),
      loadLatestJob: vi
        .fn()
        .mockResolvedValueOnce({
          jobId: '701',
          jobType: 'media_prepare',
          status: 'succeeded',
          attemptNo: 1,
          inputManifest: {},
          outputManifest: prepareOutput(audioSource),
        })
        .mockResolvedValueOnce({
          jobId: '702',
          jobType: 'transcribe',
          status: 'succeeded',
          attemptNo: 1,
          inputManifest: {},
          outputManifest: transcribeOutput(audioSource),
        }),
      persistSemanticPlan,
    });
    const generateSemanticMoments = vi.fn().mockReturnValue({
      moments: [
        {
          startMs: 0,
          endMs: 10_000,
          importance: 0.9,
          type: 'concept',
          summary: '定义函数概念',
          visualTarget: '板书定义',
          audioEvidence: null,
          transcriptEvidence: null,
          selectionReason: '核心概念定义',
        },
      ],
      model: 'semantic-model',
      promptVersion: 'semantic-v1',
    });
    const service = new MediaEvidenceService({
      semanticMomentModelAdapter: { generateSemanticMoments },
      transcriptCorrectionModelAdapter: {
        generateTranscriptCorrections: async () => ({
          corrections: [
            { index: 0, text: '看这里，先定义函数概念，再演示步骤' },
          ],
        }),
      },
    });
    const orchestrator = createMultimodalDistillationPipelineOrchestrator({
      store,
      mediaEvidenceService: service,
      sessionService: { generateAdlerOverview: vi.fn() },
    });

    const result = await orchestrator.runDistillationPipeline({
      authUserId: 'user-1',
      sessionId: '101',
    });

    expect(result).toBe(persisted);
    expect(generateSemanticMoments).toHaveBeenCalledWith(
      expect.objectContaining({
        transcript: expect.objectContaining({
          segments: [
            expect.objectContaining({
              text: '看这里，先定义函数概念，再演示步骤',
              correctedByModel: true,
            }),
          ],
        }),
      }),
    );
    expect(persistSemanticPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        transcript: expect.objectContaining({
          segments: [
            expect.objectContaining({
              text: '看这里，先定义函数概念，再演示步骤',
              correctedByModel: true,
            }),
          ],
        }),
      }),
    );
  });

  it('treats a missing frame job after semantic persistence as state corruption', async () => {
    const snapshot = makeSnapshot({
      source: videoSource,
      mediaStage: 'building_evidence',
      state: {
        semanticMoments: [
          {
            semanticMomentId: 'moment-001',
            startMs: 0,
            endMs: 10_000,
            importance: 0.9,
            type: 'demonstration',
            summary: '演示步骤',
            visualTarget: '板书',
            audioEvidence: null,
            transcriptEvidence: null,
            selectionReason: '核心步骤',
          },
        ],
      },
    });
    const store = storeFrom({
      loadSnapshot: vi.fn().mockResolvedValue(snapshot),
      loadLatestJob: vi
        .fn()
        .mockResolvedValueOnce({
          jobId: '701',
          jobType: 'media_prepare',
          status: 'succeeded',
          attemptNo: 1,
          inputManifest: {},
          outputManifest: prepareOutput(videoSource),
        })
        .mockResolvedValueOnce(null),
    });
    const orchestrator = createMultimodalDistillationPipelineOrchestrator({
      store,
      mediaEvidenceService: evidenceService(),
      sessionService: { generateAdlerOverview: vi.fn() },
    });

    await expect(
      orchestrator.runDistillationPipeline({
        authUserId: 'user-1',
        sessionId: '101',
      }),
    ).rejects.toMatchObject({
      code: 'MULTIMODAL_PIPELINE_FAILED',
      statusCode: 500,
    });
  });

  it('repairs a video evidence timeline that an older sharpness threshold left without frames', async () => {
    const snapshot = makeSnapshot({
      source: videoSource,
      mediaStage: 'building_adler',
      state: {
        semanticMoments: [
          {
            semanticMomentId: 'moment-001',
            startMs: 0,
            endMs: 10_000,
            importance: 0.9,
            type: 'demonstration',
            summary: '演示步骤',
            visualTarget: '板书',
            audioEvidence: null,
            transcriptEvidence: null,
            selectionReason: '核心步骤',
          },
        ],
        evidenceTimeline: {
          evidenceItems: [
            {
              evidenceId: 'ev-transcript',
              kind: 'transcript',
              source: { primarySourceId: videoSource.sourceId },
              timeRange: { startMs: 0, endMs: 10_000 },
              text: '看这里，先定义概念，再演示步骤',
              provenance: {
                method: 'asr',
                processorVersion: '1.0.0',
                confidence: 0.96,
                editedByUser: false,
              },
              claimType: 'sourceFact',
              selectionReason: '转录证据',
            },
          ],
        },
      },
    });
    const persisted = { ...snapshot, revisionNo: 5 };
    const persistEvidence = vi.fn().mockResolvedValue(persisted);
    const store = storeFrom({
      loadSnapshot: vi.fn().mockResolvedValue(snapshot),
      loadLatestJob: vi
        .fn()
        .mockResolvedValueOnce({
          jobId: '701',
          jobType: 'media_prepare',
          status: 'succeeded',
          attemptNo: 1,
          inputManifest: {},
          outputManifest: prepareOutput(videoSource),
        })
        .mockResolvedValueOnce({
          jobId: '703',
          jobType: 'frame_materialize',
          status: 'succeeded',
          attemptNo: 1,
          inputManifest: {},
          outputManifest: frameOutput(),
        })
        .mockResolvedValueOnce({
          jobId: '702',
          jobType: 'transcribe',
          status: 'succeeded',
          attemptNo: 1,
          inputManifest: {},
          outputManifest: transcribeOutput(videoSource),
        }),
      persistEvidence,
    });
    const generateAdlerOverview = vi.fn();
    const orchestrator = createMultimodalDistillationPipelineOrchestrator({
      store,
      mediaEvidenceService: evidenceService(),
      sessionService: { generateAdlerOverview },
    });

    await orchestrator.runDistillationPipeline({
      authUserId: 'user-1',
      sessionId: '101',
    });

    expect(persistEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevisionNo: 4,
        repairBuildingAdler: true,
        evidenceItems: expect.arrayContaining([
          expect.objectContaining({ kind: 'frame' }),
        ]),
        degradations: expect.arrayContaining([
          expect.objectContaining({ code: 'FRAME_EVIDENCE_REPAIR_ATTEMPTED' }),
        ]),
      }),
    );
    expect(generateAdlerOverview).not.toHaveBeenCalled();
  });
});
