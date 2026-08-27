import type {
  AdlerOverviewResult,
  MediaEvidenceDegradation,
  MultimodalSessionState,
} from '@educlaw/shared';
import {
  parseFrameMaterializeOutputManifest,
  parseMediaPrepareOutputManifest,
  parseTranscribeOutputManifest,
} from './media-distillation-contract.js';
import {
  MediaEvidenceService,
  type FrameRequestPlanItem,
} from './media-evidence.service.js';
import {
  createMultimodalDistillationPipelineStore,
  type MultimodalDistillationPipelineStore,
} from './multimodal-distillation-pipeline-store.js';
import type { MultimodalPipelineSnapshot } from './multimodal-pipeline-store.js';
import { GuidedCreationError } from './guided-creation-service.js';

interface SessionModelService {
  generateAdlerOverview(input: {
    primarySource: NonNullable<MultimodalSessionState['primarySource']>;
    transcript: MultimodalSessionState['transcript'];
    evidenceTimeline: MultimodalSessionState['evidenceTimeline']['evidenceItems'];
    degradations: readonly MediaEvidenceDegradation[];
  }): Promise<AdlerOverviewResult>;
}

interface Dependencies {
  store?: MultimodalDistillationPipelineStore;
  mediaEvidenceService: MediaEvidenceService;
  sessionService: SessionModelService;
}

const VISUAL_CUE = /(看这里|看图|观察|图表|曲线|坐标|板书|实验|示意图|受力图|电路图|光路图)/u;

function fail(code: string, message: string, statusCode: number, retryable = false): never {
  throw new GuidedCreationError(code, message, statusCode, retryable);
}

function mergeDegradations(
  ...groups: readonly MediaEvidenceDegradation[][]
): MediaEvidenceDegradation[] {
  const unique = new Map<string, MediaEvidenceDegradation>();
  for (const item of groups.flat()) {
    unique.set(`${item.code}\u0000${item.message}\u0000${item.semanticMomentId ?? ''}`, item);
  }
  return [...unique.values()];
}

function transcriptCueTimestamps(
  transcript: MultimodalSessionState['transcript'],
): number[] {
  return transcript.segments
    .filter((segment) => VISUAL_CUE.test(segment.text))
    .map((segment) => Math.min(segment.endMs - 1, segment.startMs + 500))
    .filter((timestamp) => timestamp >= 0);
}

function frameJobInput(input: {
  snapshot: MultimodalPipelineSnapshot;
  durationMs: number;
  requests: FrameRequestPlanItem[];
}): Record<string, unknown> {
  const source = input.snapshot.mediaState.primarySource;
  if (!source || source.kind !== 'video') {
    fail('MULTIMODAL_PIPELINE_FAILED', '视频抽帧前置状态损坏', 500);
  }
  return {
    schemaVersion: 1,
    sessionId: input.snapshot.sessionId,
    sourceId: source.sourceId,
    sourceAsset: source.assetRef,
    durationMs: input.durationMs,
    frameRequests: input.requests,
  };
}

export function createMultimodalDistillationPipelineOrchestrator(
  dependencies: Dependencies,
) {
  const store = dependencies.store ?? createMultimodalDistillationPipelineStore();
  const evidence = dependencies.mediaEvidenceService;
  const sessionService = dependencies.sessionService;

  async function loadPrepare(snapshot: MultimodalPipelineSnapshot) {
    const job = await store.loadLatestJob({
      sessionId: snapshot.sessionId,
      jobType: 'media_prepare',
    });
    if (!job || job.status !== 'succeeded' || !job.outputManifest) {
      fail('MULTIMODAL_PIPELINE_FAILED', '媒体预处理结果缺失', 500);
    }
    try {
      return parseMediaPrepareOutputManifest(job.outputManifest);
    } catch {
      fail('MULTIMODAL_PIPELINE_FAILED', '媒体预处理结果损坏', 500);
    }
  }

  async function runSemantic(
    authUserId: string,
    snapshot: MultimodalPipelineSnapshot,
  ) {
    const primarySource = snapshot.mediaState.primarySource;
    if (!primarySource) {
      fail('MULTIMODAL_PIPELINE_FAILED', '主要媒体源缺失', 500);
    }
    const prepare = await loadPrepare(snapshot);
    let transcriptAssetRef;
    if (prepare.hasAudio) {
      const job = await store.loadLatestJob({
        sessionId: snapshot.sessionId,
        jobType: 'transcribe',
      });
      if (!job || job.status !== 'succeeded' || !job.outputManifest) {
        fail('MULTIMODAL_PIPELINE_FAILED', '转录结果缺失', 500);
      }
      try {
        transcriptAssetRef = parseTranscribeOutputManifest(
          job.outputManifest,
        ).transcriptAssetRef;
      } catch {
        fail('MULTIMODAL_PIPELINE_FAILED', '转录结果损坏', 500);
      }
    }
    const transcriptCorrection = await evidence.correctTranscript({
      transcript: snapshot.mediaState.transcript,
    });
    const transcript =
      transcriptCorrection?.transcript ?? snapshot.mediaState.transcript;
    const semantic = await evidence.generateSemanticMoments({
      primarySource,
      durationMs: prepare.durationMs,
      transcript,
      ...(primarySource.kind === 'video'
        ? {
            visualContext: {
              mode: 'native_video',
              sourceAssetRef: primarySource.assetRef,
            },
          }
        : {}),
    });
    const plan = evidence.planFrameCandidates({
      sourceKind: primarySource.kind,
      durationMs: prepare.durationMs,
      semanticMoments: semantic.moments,
      transcriptCueTimestampsMs: transcriptCueTimestamps(transcript),
      slowVisualChangeTimestampsMs:
        prepare.visualSignals?.slowVisualChangeTimestampsMs,
      sceneChangeTimestampsMs: prepare.visualSignals?.sceneChangeTimestampsMs,
      hasAudio: prepare.hasAudio,
    });
    const degradations = mergeDegradations(
      snapshot.mediaState.degradations,
      transcriptCorrection?.degradations ?? [],
      prepare.degradations,
      plan.degradations,
    );
    if (primarySource.kind === 'audio') {
      const timeline = evidence.buildEvidenceTimeline({
        durationMs: prepare.durationMs,
        primarySource,
        transcript,
        semanticMoments: semantic.moments,
        selectedFrames: [],
        audioPlayableAssetRef: prepare.normalizedAudioAssetRef,
        transcriptAssetRef,
        sourceHasAudio: true,
      });
      return store.persistSemanticPlan({
        authUserId,
        sessionId: snapshot.sessionId,
        expectedRevisionNo: snapshot.revisionNo,
        semanticMoments: semantic.moments,
        evidenceItems: timeline.evidenceItems,
        degradations: mergeDegradations(degradations, timeline.degradations),
        ...(transcriptCorrection
          ? { transcript: transcriptCorrection.transcript }
          : {}),
      });
    }
    if (plan.frameRequests.length < 1) {
      fail('MULTIMODAL_PIPELINE_FAILED', '视频没有生成可用抽帧请求', 502, true);
    }
    return store.persistSemanticPlan({
      authUserId,
      sessionId: snapshot.sessionId,
      expectedRevisionNo: snapshot.revisionNo,
      semanticMoments: semantic.moments,
      degradations,
      frameJobInput: frameJobInput({
        snapshot,
        durationMs: prepare.durationMs,
        requests: plan.frameRequests,
      }),
      ...(transcriptCorrection
        ? { transcript: transcriptCorrection.transcript }
        : {}),
    });
  }

  async function runEvidence(
    authUserId: string,
    snapshot: MultimodalPipelineSnapshot,
    options: { repairBuildingAdler?: boolean } = {},
  ) {
    const primarySource = snapshot.mediaState.primarySource;
    if (!primarySource) {
      fail('MULTIMODAL_PIPELINE_FAILED', '主要媒体源缺失', 500);
    }
    const prepare = await loadPrepare(snapshot);
    if (primarySource.kind === 'audio') {
      if (snapshot.mediaState.evidenceTimeline.evidenceItems.length < 1) {
        fail('MULTIMODAL_PIPELINE_FAILED', '音频证据时间线缺失', 500);
      }
      return store.persistEvidence({
        authUserId,
        sessionId: snapshot.sessionId,
        expectedRevisionNo: snapshot.revisionNo,
        evidenceItems: snapshot.mediaState.evidenceTimeline.evidenceItems,
        degradations: snapshot.mediaState.degradations,
      });
    }
    const frameJob = await store.loadLatestJob({
      sessionId: snapshot.sessionId,
      jobType: 'frame_materialize',
    });
    if (!frameJob) {
      fail('MULTIMODAL_PIPELINE_FAILED', '视频抽帧任务缺失', 500);
    }
    if (frameJob.status === 'queued' || frameJob.status === 'leased') {
      return snapshot;
    }
    if (frameJob.status !== 'succeeded' || !frameJob.outputManifest) {
      fail('MULTIMODAL_PIPELINE_FAILED', '视频抽帧任务失败', 502, true);
    }
    let frameOutput;
    try {
      frameOutput = parseFrameMaterializeOutputManifest(frameJob.outputManifest);
    } catch {
      fail('MULTIMODAL_PIPELINE_FAILED', '视频抽帧结果损坏', 500);
    }
    const ranked = await evidence.rankVisualCandidates({
      sourceKind: primarySource.kind,
      durationMs: prepare.durationMs,
      semanticMoments: snapshot.mediaState.semanticMoments,
      frameCandidateManifest: frameOutput.candidates,
    });
    let transcriptAssetRef;
    if (prepare.hasAudio) {
      const job = await store.loadLatestJob({
        sessionId: snapshot.sessionId,
        jobType: 'transcribe',
      });
      if (job?.status === 'succeeded' && job.outputManifest) {
        transcriptAssetRef = parseTranscribeOutputManifest(
          job.outputManifest,
        ).transcriptAssetRef;
      }
    }
    const timeline = evidence.buildEvidenceTimeline({
      durationMs: prepare.durationMs,
      primarySource,
      transcript: snapshot.mediaState.transcript,
      semanticMoments: snapshot.mediaState.semanticMoments,
      selectedFrames: ranked.selectedFrames,
      audioPlayableAssetRef: prepare.normalizedAudioAssetRef ?? undefined,
      transcriptAssetRef,
      sourceHasAudio: prepare.hasAudio,
    });
    return store.persistEvidence({
      authUserId,
      sessionId: snapshot.sessionId,
      expectedRevisionNo: snapshot.revisionNo,
      evidenceItems: timeline.evidenceItems,
      degradations: mergeDegradations(
        snapshot.mediaState.degradations,
        frameOutput.degradations,
        ranked.degradations,
        timeline.degradations,
        options.repairBuildingAdler
          ? [
              {
                code: 'FRAME_EVIDENCE_REPAIR_ATTEMPTED',
                message:
                  'Rebuilt visual evidence after an earlier quality threshold removed every frame',
              },
            ]
          : [],
      ),
      repairBuildingAdler: options.repairBuildingAdler,
    });
  }

  async function runAdler(
    authUserId: string,
    snapshot: MultimodalPipelineSnapshot,
  ) {
    const primarySource = snapshot.mediaState.primarySource;
    if (!primarySource || snapshot.mediaState.evidenceTimeline.evidenceItems.length < 1) {
      fail('MULTIMODAL_PIPELINE_FAILED', 'Adler 生成前置证据损坏', 500);
    }
    const hasFrameEvidence = snapshot.mediaState.evidenceTimeline.evidenceItems.some(
      (item) => item.kind === 'frame',
    );
    const repairAlreadyAttempted = snapshot.mediaState.degradations.some(
      (item) => item.code === 'FRAME_EVIDENCE_REPAIR_ATTEMPTED',
    );
    if (
      primarySource.kind === 'video' &&
      !hasFrameEvidence &&
      !repairAlreadyAttempted
    ) {
      return runEvidence(authUserId, snapshot, { repairBuildingAdler: true });
    }
    const adlerOverview = await sessionService.generateAdlerOverview({
      primarySource,
      transcript: snapshot.mediaState.transcript,
      evidenceTimeline: snapshot.mediaState.evidenceTimeline.evidenceItems,
      degradations: snapshot.mediaState.degradations,
    });
    return store.persistAdler({
      authUserId,
      sessionId: snapshot.sessionId,
      expectedRevisionNo: snapshot.revisionNo,
      adlerOverview,
    });
  }

  return {
    async runDistillationPipeline(input: {
      authUserId: string;
      sessionId: string;
    }): Promise<MultimodalPipelineSnapshot> {
      const snapshot = await store.loadSnapshot(input);
      switch (snapshot.mediaStage) {
        case 'building_semantic_windows':
          return runSemantic(input.authUserId, snapshot);
        case 'building_evidence':
          return runEvidence(input.authUserId, snapshot);
        case 'building_adler':
          return runAdler(input.authUserId, snapshot);
        case 'awaiting_adler_overview':
          return snapshot;
        default:
          fail('INVALID_MEDIA_STAGE', '当前阶段不允许执行多模态蒸馏编排', 409);
      }
    },
  };
}
