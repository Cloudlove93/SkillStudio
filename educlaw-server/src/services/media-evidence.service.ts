import { createHash } from "node:crypto";
import {
  MULTIMODAL_FRAME_SOURCE_SIGNALS,
  MULTIMODAL_PRIMARY_SOURCE_KINDS,
  parseAssetRef,
  parseEvidenceCard,
  parseFrameDHash64,
  parseMultimodalPrimarySource,
  parseMultimodalTranscript,
  parseNormalizedSemanticMoments,
  parseSemanticMomentDrafts,
  type MultimodalAssetRef,
  type MultimodalClaimType,
  type MultimodalEvidence,
  type MultimodalFrameSourceSignal,
  type MultimodalPrimarySource,
  type MultimodalPrimarySourceKind,
  type MultimodalTranscript,
  type NormalizedSemanticMoment,
  type SemanticMomentDraft,
} from "@educlaw/shared";

const SERVICE_ERROR = "MEDIA_EVIDENCE_FAILED";
const SERVICE_PROCESSOR_VERSION = "media-evidence-service-v1";
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_METADATA_LENGTH = 128;
const MAX_VISUAL_CONTEXT_FRAMES = 16;
const MAX_VISUAL_SIGNAL_TIMESTAMPS = 512;
const MAX_FRAME_CANDIDATES = 48;
const MAX_FRAME_ASSET_BYTES = 64 * 1024 * 1024;
const MAX_ANALYSIS_DIMENSION = 1024;
const MAX_TRANSCRIPT_SEGMENTS = 10_000;
const MAX_TRANSCRIPT_CORRECTION_TEXT_LENGTH = 2000;
const HARD_REJECTED_REASONS = [
  "blurry",
  "black_screen",
  "white_screen",
  "low_information",
] as const;
const VISUAL_SIGNAL_PRIORITY: Record<MultimodalFrameSourceSignal, number> = {
  semantic_moment: 0,
  slow_visual_change: 1,
  transcript_visual_cue: 2,
  scene_change: 3,
  periodic_fallback: 4,
};
const VISUAL_SIGNAL_DEGRADATION_CODES = {
  slow_visual_change: "VISUAL_SIGNAL_DETECTOR_UNAVAILABLE",
  scene_change: "VISUAL_SIGNAL_DETECTOR_UNAVAILABLE",
} as const;

export interface MediaEvidenceDegradation {
  code: string;
  message: string;
  semanticMomentId?: string;
}

export interface SemanticMomentGenerationResult {
  moments: NormalizedSemanticMoment[];
  provenance: {
    model: string | null;
    promptVersion: string | null;
  };
}

export interface FrameRequestPlanItem {
  candidateId: string;
  semanticMomentId: string;
  timestampMs: number;
  sourceSignal: MultimodalFrameSourceSignal;
  selectionReason: string;
}

export interface FrameCandidatePlanResult {
  frameRequests: FrameRequestPlanItem[];
  degradations: MediaEvidenceDegradation[];
}

export interface RankedVisualFrame {
  candidateId: string;
  semanticMomentId: string;
  timestampMs: number;
  sourceSignal: MultimodalFrameSourceSignal;
  selectionReason: string;
  assetRef: MultimodalAssetRef;
  score: number;
  rankingReason: string;
  rankingMethod: "vision_model" | "deterministic_quality_fallback";
  rankingModel?: string | null;
  qualitySummary: FrameQualityMetrics;
}

export interface VisualRankingResult {
  selectedFrames: RankedVisualFrame[];
  degradations: MediaEvidenceDegradation[];
}

export interface EvidenceTimelineResult {
  evidenceItems: MultimodalEvidence[];
  degradations: MediaEvidenceDegradation[];
}

export interface SemanticMomentModelAdapter {
  generateSemanticMoments(input: {
    primarySource: MultimodalPrimarySource;
    durationMs: number;
    transcript: MultimodalTranscript;
    visualContext?: SemanticVisualContext | null;
  }): Promise<unknown> | unknown;
}

export interface VisionRankingAdapter {
  rankVisualCandidates(input: {
    semanticMoment: NormalizedSemanticMoment;
    candidates: Array<{
      candidateId: string;
      timestampMs: number;
      assetRef: MultimodalAssetRef;
      selectionReason: string;
      qualityMetrics: FrameQualityMetrics;
    }>;
  }): Promise<unknown> | unknown;
}

export interface TranscriptCorrectionRequestSegment {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
  confidence: number | null;
}

export interface TranscriptCorrectionModelAdapter {
  generateTranscriptCorrections(input: {
    transcript: MultimodalTranscript;
    correctable: TranscriptCorrectionRequestSegment[];
  }): Promise<unknown> | unknown;
}

export interface TranscriptCorrectionResult {
  transcript: MultimodalTranscript;
  correctedCount: number;
  degradations: MediaEvidenceDegradation[];
}

export interface MediaEvidenceServiceOptions {
  semanticMomentModelAdapter?: SemanticMomentModelAdapter | null;
  visionRankingAdapter?: VisionRankingAdapter | null;
  transcriptCorrectionModelAdapter?: TranscriptCorrectionModelAdapter | null;
  lowConfidenceThreshold?: number;
  minFrameSpacingMs?: number;
  maxFramesPerMoment?: number;
  maxSelectedFramesPerMoment?: number;
}

interface FrameQualityMetrics {
  analysisWidth: number;
  analysisHeight: number;
  brightnessMeanNormalized: number;
  blackPixelRatio: number;
  whitePixelRatio: number;
  entropyNormalized: number;
  sharpness: {
    algorithm: string;
    normalized: true;
    value: number;
  };
  duplicateHash: {
    algorithm: string;
    value: string;
  };
}

interface ParsedFrameCandidate {
  candidateId: string;
  semanticMomentId: string;
  timestampMs: number;
  sourceSignal: MultimodalFrameSourceSignal;
  selectionReason: string;
  assetRef: MultimodalAssetRef;
  metrics: FrameQualityMetrics;
  hardRejectedReasons: string[];
  suppressed: boolean;
  duplicateOf: string | null;
  frameExtractorVersion: string;
  qualityProcessorVersion: string;
}

interface RankingOutputItem {
  candidateId: string;
  score: number;
  reason: string;
}

type SelectedMomentFrame = RankedVisualFrame;

interface CompatibilityFrameContext {
  timestampMs: number;
  assetRef: MultimodalAssetRef;
  caption?: string | null;
}

type SemanticVisualContext =
  | {
      mode: "native_video";
      sourceAssetRef: MultimodalAssetRef;
    }
  | {
      mode: "compatibility_frames";
      frames: CompatibilityFrameContext[];
    };

function stableError(
  message = "Media evidence processing failed",
): MediaEvidenceServiceError {
  return new MediaEvidenceServiceError(SERVICE_ERROR, message, false);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw stableError(`${path} must be an object`);
  }
  return value;
}

function assertExactKeys(
  record: Record<string, unknown>,
  path: string,
  allowedKeys: readonly string[],
): void {
  const allowed = new Set(allowedKeys);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw stableError(`${path} has unknown fields`);
  }
}

function readString(value: unknown, path: string, maximum = 512): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximum) {
    throw stableError(`${path} must be a non-empty string`);
  }
  return value;
}

function readSafeId(value: unknown, path: string): string {
  const text = readString(value, path, MAX_METADATA_LENGTH);
  if (!SAFE_ID.test(text)) {
    throw stableError(`${path} is invalid`);
  }
  return text;
}

function readOptionalString(value: unknown, path: string, maximum = 512): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return readString(value, path, maximum);
}

function readBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw stableError(`${path} must be a boolean`);
  }
  return value;
}

function readFiniteNumber(
  value: unknown,
  path: string,
  options?: { min?: number; max?: number },
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw stableError(`${path} must be a finite number`);
  }
  if (options?.min !== undefined && value < options.min) {
    throw stableError(`${path} is out of range`);
  }
  if (options?.max !== undefined && value > options.max) {
    throw stableError(`${path} is out of range`);
  }
  return value;
}

function readInteger(
  value: unknown,
  path: string,
  options?: { min?: number; max?: number },
): number {
  const numberValue = readFiniteNumber(value, path, options);
  if (!Number.isInteger(numberValue)) {
    throw stableError(`${path} must be an integer`);
  }
  return numberValue;
}

function readArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw stableError(`${path} must be an array`);
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      throw stableError(`${path} must not be sparse`);
    }
  }
  return value;
}

function readSourceKind(value: unknown, path: string): MultimodalPrimarySourceKind {
  const sourceKind = readString(value, path, 16);
  if (!MULTIMODAL_PRIMARY_SOURCE_KINDS.includes(sourceKind as MultimodalPrimarySourceKind)) {
    throw stableError(`${path} is invalid`);
  }
  return sourceKind as MultimodalPrimarySourceKind;
}

function readMetadataString(value: unknown, path: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return readString(value, path, MAX_METADATA_LENGTH);
}

function readFrameSourceSignal(
  value: unknown,
  path: string,
): MultimodalFrameSourceSignal {
  const signal = readString(value, path, 64);
  if (!MULTIMODAL_FRAME_SOURCE_SIGNALS.includes(signal as MultimodalFrameSourceSignal)) {
    throw stableError(`${path} is invalid`);
  }
  return signal as MultimodalFrameSourceSignal;
}

function readDuration(durationMs: number): number {
  return readInteger(durationMs, "durationMs", {
    min: 1,
    max: Number.MAX_SAFE_INTEGER,
  });
}

function longestCommonSubsequenceLength(left: string, right: string): number {
  let previous = new Array<number>(right.length + 1).fill(0);
  for (let i = 1; i <= left.length; i += 1) {
    const current = new Array<number>(right.length + 1).fill(0);
    for (let j = 1; j <= right.length; j += 1) {
      current[j] =
        left.charCodeAt(i - 1) === right.charCodeAt(j - 1)
          ? previous[j - 1] + 1
          : Math.max(previous[j], current[j - 1]);
    }
    previous = current;
  }
  return previous[right.length];
}

function isGroundedCorrection(originalText: string, correctedText: string): boolean {
  const minimumOverlap = Math.floor(originalText.length / 2);
  if (minimumOverlap === 0) {
    return true;
  }
  return longestCommonSubsequenceLength(originalText, correctedText) >= minimumOverlap;
}

function pushDegradation(
  degradations: MediaEvidenceDegradation[],
  degradation: MediaEvidenceDegradation,
): void {
  const key = `${degradation.code}:${degradation.semanticMomentId ?? ""}`;
  if (!degradations.some((item) => `${item.code}:${item.semanticMomentId ?? ""}` === key)) {
    degradations.push(degradation);
  }
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function makeDeterministicId(prefix: string, payload: unknown): string {
  return `${prefix}-${createHash("sha256").update(canonicalize(payload)).digest("hex").slice(0, 16)}`;
}

function compareMoments(
  left: NormalizedSemanticMoment,
  right: NormalizedSemanticMoment,
): number {
  return (
    left.startMs - right.startMs ||
    left.endMs - right.endMs ||
    left.semanticMomentId.localeCompare(right.semanticMomentId)
  );
}

function compareRankedFrames(left: RankedVisualFrame, right: RankedVisualFrame): number {
  return (
    right.score - left.score ||
    right.qualitySummary.sharpness.value - left.qualitySummary.sharpness.value ||
    right.qualitySummary.entropyNormalized - left.qualitySummary.entropyNormalized ||
    left.timestampMs - right.timestampMs ||
    left.candidateId.localeCompare(right.candidateId)
  );
}

function compareEvidence(left: MultimodalEvidence, right: MultimodalEvidence): number {
  const kindOrder: Record<MultimodalEvidence["kind"], number> = {
    transcript: 0,
    audio_segment: 1,
    frame: 2,
  };
  return (
    left.timeRange.startMs - right.timeRange.startMs ||
    left.timeRange.endMs - right.timeRange.endMs ||
    kindOrder[left.kind] - kindOrder[right.kind] ||
    left.evidenceId.localeCompare(right.evidenceId)
  );
}

export class MediaEvidenceServiceError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = "MediaEvidenceServiceError";
    this.code = code;
    this.retryable = retryable;
  }
}

export class MediaEvidenceService {
  private readonly semanticMomentModelAdapter: SemanticMomentModelAdapter | null;
  private readonly visionRankingAdapter: VisionRankingAdapter | null;
  private readonly transcriptCorrectionModelAdapter: TranscriptCorrectionModelAdapter | null;
  private readonly lowConfidenceThreshold: number;
  private readonly minFrameSpacingMs: number;
  private readonly maxFramesPerMoment: number;
  private readonly maxSelectedFramesPerMoment: number;

  constructor(options: MediaEvidenceServiceOptions = {}) {
    this.semanticMomentModelAdapter = options.semanticMomentModelAdapter ?? null;
    this.visionRankingAdapter = options.visionRankingAdapter ?? null;
    this.transcriptCorrectionModelAdapter =
      options.transcriptCorrectionModelAdapter ?? null;
    this.lowConfidenceThreshold =
      options.lowConfidenceThreshold === undefined
        ? 0.8
        : readFiniteNumber(options.lowConfidenceThreshold, "lowConfidenceThreshold", {
            min: 0,
            max: 1,
          });
    this.minFrameSpacingMs =
      options.minFrameSpacingMs === undefined
        ? 80
        : readInteger(options.minFrameSpacingMs, "minFrameSpacingMs", { min: 1, max: 10_000 });
    this.maxFramesPerMoment =
      options.maxFramesPerMoment === undefined
        ? 6
        : readInteger(options.maxFramesPerMoment, "maxFramesPerMoment", { min: 3, max: 6 });
    this.maxSelectedFramesPerMoment =
      options.maxSelectedFramesPerMoment === undefined
        ? 2
        : readInteger(options.maxSelectedFramesPerMoment, "maxSelectedFramesPerMoment", {
            min: 1,
            max: 2,
          });
  }

  async generateSemanticMoments(args: {
    primarySource: unknown;
    durationMs: number;
    transcript: unknown;
    visualContext?: unknown;
  }): Promise<SemanticMomentGenerationResult> {
    try {
      const durationMs = readDuration(args.durationMs);
      const primarySource =
        parseMultimodalPrimarySource(args.primarySource, "primarySource") ?? null;
      if (primarySource == null) {
        throw stableError();
      }
      const transcript = parseMultimodalTranscript(args.transcript, "transcript", {
        durationMs,
        maxSegments: MAX_TRANSCRIPT_SEGMENTS,
      });
      const visualContext = this.parseSemanticVisualContext(
        args.visualContext,
        primarySource,
        durationMs,
      );
      if (this.semanticMomentModelAdapter === null) {
        throw stableError();
      }
      let adapterResult: unknown;
      try {
        adapterResult = await this.semanticMomentModelAdapter.generateSemanticMoments({
          primarySource,
          durationMs,
          transcript,
          visualContext,
        });
      } catch {
        throw stableError();
      }

      const record = readRecord(adapterResult, "semanticMomentModelResult");
      assertExactKeys(record, "semanticMomentModelResult", ["moments", "model", "promptVersion"]);
      const drafts = parseSemanticMomentDrafts(record.moments, { durationMs });
      if (drafts.length === 0) {
        throw stableError();
      }

      const normalized = this.normalizeSemanticMoments(drafts).sort(compareMoments);
      return {
        moments: normalized,
        provenance: {
          model: readMetadataString(record.model, "semanticMomentModelResult.model"),
          promptVersion: readMetadataString(
            record.promptVersion,
            "semanticMomentModelResult.promptVersion",
          ),
        },
      };
    } catch (error) {
      if (error instanceof MediaEvidenceServiceError) {
        throw error;
      }
      throw stableError();
    }
  }

  async correctTranscript(args: {
    transcript: unknown;
  }): Promise<TranscriptCorrectionResult | null> {
    try {
      const transcript = parseMultimodalTranscript(args.transcript, "transcript", {
        maxSegments: MAX_TRANSCRIPT_SEGMENTS,
      });
      const correctable = transcript.segments
        .map((segment, index) => ({ segment, index }))
        .filter(
          (item) => !item.segment.editedByUser && !item.segment.correctedByModel,
        );
      if (
        this.transcriptCorrectionModelAdapter === null ||
        correctable.length === 0
      ) {
        return null;
      }

      let adapterResult: unknown;
      try {
        adapterResult =
          await this.transcriptCorrectionModelAdapter.generateTranscriptCorrections({
            transcript,
            correctable: correctable.map((item) => ({
              index: item.index,
              startMs: item.segment.startMs,
              endMs: item.segment.endMs,
              text: item.segment.text,
              confidence: item.segment.confidence ?? null,
            })),
          });
      } catch {
        return {
          transcript,
          correctedCount: 0,
          degradations: [
            {
              code: "ASR_TRANSCRIPT_CORRECTION_FAILED",
              message: "ASR 转录纠错未能完成，已保留原始转录文本。",
            },
          ],
        };
      }

      const record = readRecord(adapterResult, "transcriptCorrectionModelResult");
      assertExactKeys(record, "transcriptCorrectionModelResult", ["corrections"]);
      const correctionItems = readArray(
        record.corrections,
        "transcriptCorrectionModelResult.corrections",
      );
      const segments = transcript.segments.map((segment) => ({ ...segment }));
      let correctedCount = 0;
      for (const item of correctionItems) {
        const correction = readRecord(
          item,
          "transcriptCorrectionModelResult.corrections[]",
        );
        assertExactKeys(
          correction,
          "transcriptCorrectionModelResult.corrections[]",
          ["index", "text"],
        );
        const index = readInteger(
          correction.index,
          "transcriptCorrectionModelResult.corrections[].index",
          { min: 0, max: segments.length - 1 },
        );
        const text = readString(
          correction.text,
          "transcriptCorrectionModelResult.corrections[].text",
          MAX_TRANSCRIPT_CORRECTION_TEXT_LENGTH,
        );
        const target = segments[index];
        if (
          !target ||
          target.editedByUser ||
          target.correctedByModel ||
          text === target.text ||
          !isGroundedCorrection(target.text, text)
        ) {
          continue;
        }
        segments[index] = { ...target, text, correctedByModel: true };
        correctedCount += 1;
      }
      return {
        transcript: { ...transcript, segments },
        correctedCount,
        degradations: [],
      };
    } catch (error) {
      if (error instanceof MediaEvidenceServiceError) {
        throw error;
      }
      throw stableError();
    }
  }

  planFrameCandidates(args: {
    sourceKind: unknown;
    durationMs: number;
    semanticMoments: unknown;
    transcriptCueTimestampsMs?: unknown;
    slowVisualChangeTimestampsMs?: unknown;
    sceneChangeTimestampsMs?: unknown;
    hasAudio?: boolean;
  }): FrameCandidatePlanResult {
    try {
      const durationMs = readDuration(args.durationMs);
      const sourceKind = readSourceKind(args.sourceKind, "sourceKind");
      if (args.hasAudio !== undefined) {
        readBoolean(args.hasAudio, "hasAudio");
      }
      const moments = parseNormalizedSemanticMoments(args.semanticMoments, { durationMs }).sort(compareMoments);
      const degradations: MediaEvidenceDegradation[] = [];

      if (sourceKind === "audio") {
        pushDegradation(degradations, {
          code: "FRAME_NOT_APPLICABLE",
          message: "纯音频素材不包含画面内容，无法抽取关键帧。",
        });
        return { frameRequests: [], degradations };
      }

      if (args.hasAudio === false) {
        pushDegradation(degradations, {
          code: "NO_AUDIO_TRACK",
          message: "视频素材中未检测到音轨，语音识别相关功能不可用。",
        });
      }
      if (args.slowVisualChangeTimestampsMs === undefined) {
        pushDegradation(degradations, {
          code: VISUAL_SIGNAL_DEGRADATION_CODES.slow_visual_change,
          message: "画面变化检测数据缺失，已按等时间隔采样关键帧。",
        });
      }
      if (args.sceneChangeTimestampsMs === undefined) {
        pushDegradation(degradations, {
          code: VISUAL_SIGNAL_DEGRADATION_CODES.scene_change,
          message: "场景切换检测数据缺失，已按等时间隔采样关键帧。",
        });
      }

      const transcriptCueTimestampsMs = this.normalizeTimestampList(
        args.transcriptCueTimestampsMs,
        durationMs,
      );
      const slowVisualChangeTimestampsMs = this.normalizeTimestampList(
        args.slowVisualChangeTimestampsMs,
        durationMs,
      );
      const sceneChangeTimestampsMs = this.normalizeTimestampList(
        args.sceneChangeTimestampsMs,
        durationMs,
      );

      const frameRequests: FrameRequestPlanItem[] = [];
      for (const moment of moments) {
        const windowDuration = moment.endMs - moment.startMs;
        if (windowDuration < 3) {
          throw stableError();
        }
        const anchorCandidates = new Map<number, FrameRequestPlanItem & { priority: number }>();
        const supplementalCandidates = new Map<number, FrameRequestPlanItem & { priority: number }>();
        const anchorTimes = this.buildSemanticAnchors(moment);
        for (const [index, timestampMs] of anchorTimes.entries()) {
          const positionLabel = index === 0 ? "front" : index === 1 ? "middle" : "back";
          anchorCandidates.set(timestampMs, {
            candidateId: this.makeFrameCandidateId(moment.semanticMomentId, timestampMs, "semantic_moment"),
            semanticMomentId: moment.semanticMomentId,
            timestampMs,
            sourceSignal: "semantic_moment",
            selectionReason: `${positionLabel} semantic anchor: ${moment.selectionReason}`,
            priority: VISUAL_SIGNAL_PRIORITY.semantic_moment,
          });
        }
        this.insertSignalCandidates(
          supplementalCandidates,
          anchorCandidates,
          transcriptCueTimestampsMs,
          moment,
          "transcript_visual_cue",
          "transcript cue aligned with semantic moment",
        );
        this.insertSignalCandidates(
          supplementalCandidates,
          anchorCandidates,
          slowVisualChangeTimestampsMs,
          moment,
          "slow_visual_change",
          "slow visual change within semantic moment",
        );
        this.insertSignalCandidates(
          supplementalCandidates,
          anchorCandidates,
          sceneChangeTimestampsMs,
          moment,
          "scene_change",
          "scene change within semantic moment",
        );

        if (anchorCandidates.size + supplementalCandidates.size < 3) {
          const fallbackTimestamps = this.buildPeriodicFallbackTimestamps(moment, durationMs);
          for (const timestampMs of fallbackTimestamps) {
            this.insertCandidate(supplementalCandidates, {
              candidateId: this.makeFrameCandidateId(moment.semanticMomentId, timestampMs, "periodic_fallback"),
              semanticMomentId: moment.semanticMomentId,
              timestampMs,
              sourceSignal: "periodic_fallback",
              selectionReason: "periodic fallback within semantic moment window",
              priority: VISUAL_SIGNAL_PRIORITY.periodic_fallback,
            }, anchorCandidates);
            if (anchorCandidates.size + supplementalCandidates.size >= 3) {
              break;
            }
          }
        }

        const guaranteedAnchors = [...anchorCandidates.values()].sort(
          (left, right) =>
            left.timestampMs - right.timestampMs || left.candidateId.localeCompare(right.candidateId),
        );
        const supplemental = [...supplementalCandidates.values()]
          .sort(
            (left, right) =>
              left.priority - right.priority ||
              left.timestampMs - right.timestampMs ||
              left.candidateId.localeCompare(right.candidateId),
          )
          .slice(0, Math.max(0, this.maxFramesPerMoment - guaranteedAnchors.length));
        const orderedCandidates = [...guaranteedAnchors, ...supplemental].sort(
          (left, right) =>
            left.timestampMs - right.timestampMs ||
            left.priority - right.priority ||
            left.candidateId.localeCompare(right.candidateId),
        );
        if (orderedCandidates.length < 3) {
          throw stableError();
        }
        frameRequests.push(
          ...orderedCandidates.map((candidate) => candidate),
        );
      }

      return { frameRequests, degradations };
    } catch (error) {
      if (error instanceof MediaEvidenceServiceError) {
        throw error;
      }
      throw stableError();
    }
  }

  async rankVisualCandidates(args: {
    sourceKind: unknown;
    durationMs: number;
    semanticMoments: unknown;
    frameCandidateManifest: unknown;
  }): Promise<VisualRankingResult> {
    try {
      const degradations: MediaEvidenceDegradation[] = [];
      const sourceKind = readSourceKind(args.sourceKind, "sourceKind");
      const durationMs = readDuration(args.durationMs);
      if (sourceKind === "audio") {
        pushDegradation(degradations, {
          code: "FRAME_NOT_APPLICABLE",
          message: "纯音频素材不包含画面内容，无法抽取关键帧。",
        });
        return { selectedFrames: [], degradations };
      }

      const moments = parseNormalizedSemanticMoments(args.semanticMoments, {
        durationMs,
      }).sort(compareMoments);
      const momentById = new Map(moments.map((moment) => [moment.semanticMomentId, moment]));
      const parsedCandidates = this.parseFrameCandidateManifest(args.frameCandidateManifest, momentById);
      const grouped = new Map<string, ParsedFrameCandidate[]>();
      for (const candidate of parsedCandidates) {
        const list = grouped.get(candidate.semanticMomentId);
        if (list) {
          list.push(candidate);
        } else {
          grouped.set(candidate.semanticMomentId, [candidate]);
        }
      }

      const selectedFrames: SelectedMomentFrame[] = [];
      for (const moment of moments) {
        const allCandidates = [...(grouped.get(moment.semanticMomentId) ?? [])].sort(
          (left, right) =>
            left.timestampMs - right.timestampMs || left.candidateId.localeCompare(right.candidateId),
        );
        let usableCandidates = allCandidates.filter(
          (candidate) => !candidate.suppressed && candidate.hardRejectedReasons.length === 0,
        );
        if (usableCandidates.length === 0) {
          const blurryOnlyCandidates = allCandidates.filter(
            (candidate) =>
              !candidate.suppressed &&
              candidate.hardRejectedReasons.length > 0 &&
              candidate.hardRejectedReasons.every((reason) => reason === "blurry"),
          );
          if (blurryOnlyCandidates.length > 0) {
            usableCandidates = blurryOnlyCandidates;
            pushDegradation(degradations, {
              code: "FRAME_SHARPNESS_THRESHOLD_RELAXED",
              message:
                "清晰度高于标定阈值的候选已用完，保留了最清晰的剩余候选并在此标注降级。",
              semanticMomentId: moment.semanticMomentId,
            });
          } else {
            pushDegradation(degradations, {
              code: "NO_USABLE_VISUAL_EVIDENCE",
              message: "经过确定性画面质量筛选后，已无可用的关键帧候选。",
              semanticMomentId: moment.semanticMomentId,
            });
            continue;
          }
        }

        const fallbackSelected = this.selectByDeterministicQuality(moment, usableCandidates);
        if (moment.visualTarget == null) {
          pushDegradation(degradations, {
            code: "VISION_RANKING_FALLBACK",
            message: "缺少语义目标描述，已退化为按画面质量确定性排序。",
            semanticMomentId: moment.semanticMomentId,
          });
          selectedFrames.push(...fallbackSelected);
          continue;
        }
        if (this.visionRankingAdapter == null) {
          pushDegradation(degradations, {
            code: "VISION_RANKING_FALLBACK",
            message: "画面语义排序服务不可用，已退化为按画面质量确定性排序。",
            semanticMomentId: moment.semanticMomentId,
          });
          selectedFrames.push(...fallbackSelected);
          continue;
        }

        let rankedFrames: SelectedMomentFrame[] | null = null;
        let rankingModel: string | null = null;
        try {
          const adapterResult = await this.visionRankingAdapter.rankVisualCandidates({
            semanticMoment: moment,
            candidates: usableCandidates.map((candidate) => ({
              candidateId: candidate.candidateId,
              timestampMs: candidate.timestampMs,
              assetRef: candidate.assetRef,
              selectionReason: candidate.selectionReason,
              qualityMetrics: candidate.metrics,
            })),
          });
          const applied = this.applyVisionRankingOutput(moment, usableCandidates, adapterResult);
          rankedFrames = applied?.selectedFrames ?? null;
          rankingModel = applied?.rankingModel ?? null;
        } catch {
          rankedFrames = null;
        }

        if (rankedFrames === null || (usableCandidates.length > 0 && rankedFrames.length === 0)) {
          pushDegradation(degradations, {
            code: "VISION_RANKING_OUTPUT_INVALID",
            message: "画面语义排序结果无效，已退化为按画面质量确定性排序。",
            semanticMomentId: moment.semanticMomentId,
          });
          selectedFrames.push(...fallbackSelected);
        } else {
          selectedFrames.push(
            ...rankedFrames.map((frame) => ({
              ...frame,
              rankingModel,
            })),
          );
        }
      }

      return {
        selectedFrames: selectedFrames.sort(compareRankedFrames),
        degradations,
      };
    } catch (error) {
      if (error instanceof MediaEvidenceServiceError) {
        throw error;
      }
      throw stableError();
    }
  }

  buildEvidenceTimeline(args: {
    durationMs: number;
    primarySource: unknown;
    transcript: unknown;
    semanticMoments: unknown;
    selectedFrames: unknown;
    audioPlayableAssetRef?: unknown;
    transcriptAssetRef?: unknown;
    sourceHasAudio?: boolean;
  }): EvidenceTimelineResult {
    try {
      const durationMs = readDuration(args.durationMs);
      const primarySource =
        parseMultimodalPrimarySource(args.primarySource, "primarySource") ?? null;
      if (primarySource == null) {
        throw stableError();
      }
      const transcript = parseMultimodalTranscript(args.transcript, "transcript", {
        durationMs,
        maxSegments: MAX_TRANSCRIPT_SEGMENTS,
      });
      const semanticMoments = parseNormalizedSemanticMoments(args.semanticMoments, {
        durationMs,
      }).sort(compareMoments);
      const momentById = new Map(semanticMoments.map((moment) => [moment.semanticMomentId, moment]));
      const selectedFrames = this.parseSelectedFrames(args.selectedFrames, momentById);
      const evidenceItems: MultimodalEvidence[] = [];
      const degradations: MediaEvidenceDegradation[] = [];
      const sourceHasAudio = args.sourceHasAudio ?? primarySource.kind === "audio";
      if (args.sourceHasAudio !== undefined) {
        readBoolean(args.sourceHasAudio, "sourceHasAudio");
      }
      if (primarySource.kind === "audio" && sourceHasAudio === false) {
        throw stableError();
      }
      const transcriptAssetRef =
        args.transcriptAssetRef == null
          ? null
          : parseAssetRef(args.transcriptAssetRef, "transcriptAssetRef");
      const audioPlayableAssetRef =
        args.audioPlayableAssetRef == null
          ? primarySource.kind === "audio" && primarySource.assetRef.mimeType.startsWith("audio/")
            ? primarySource.assetRef
            : null
          : parseAssetRef(args.audioPlayableAssetRef, "audioPlayableAssetRef");
      if (audioPlayableAssetRef != null) {
        if (!audioPlayableAssetRef.mimeType.startsWith("audio/") || audioPlayableAssetRef.sizeBytes < 1) {
          throw stableError();
        }
      }
      if (transcriptAssetRef != null) {
        if (
          transcriptAssetRef.sizeBytes < 1 ||
          (transcriptAssetRef.mimeType !== "application/json" &&
            transcriptAssetRef.mimeType !== "text/plain")
        ) {
          throw stableError();
        }
      }

      if (primarySource.kind === "audio") {
        pushDegradation(degradations, {
          code: "FRAME_NOT_APPLICABLE",
          message: "纯音频素材不包含画面内容，无法抽取关键帧。",
        });
      } else if (!sourceHasAudio) {
        pushDegradation(degradations, {
          code: "NO_AUDIO_TRACK",
          message: "视频素材中未检测到音轨，语音识别相关功能不可用。",
        });
      } else if (audioPlayableAssetRef == null) {
        pushDegradation(degradations, {
          code: "AUDIO_PLAYBACK_UNAVAILABLE",
          message: "缺少可播放音轨，无法按转录定位到对应音频片段回放。",
        });
      }
      if (primarySource.kind === "audio" && !primarySource.assetRef.mimeType.startsWith("audio/")) {
        throw stableError();
      }
      if (
        transcript.status === "low_confidence" ||
        transcript.segments.some(
          (segment) => segment.editedByUser !== true && (segment.confidence ?? 0) < this.lowConfidenceThreshold,
        )
      ) {
        pushDegradation(degradations, {
          code: "ASR_LOW_CONFIDENCE_UNCONFIRMED",
          message: "语音识别置信度偏低，相关片段请在人工确认后再作为依据使用。",
        });
      }

      for (const segment of [...transcript.segments].sort((left, right) => left.startMs - right.startMs)) {
        const claimType = this.claimTypeForTranscriptSegment(transcript.status, segment);
        evidenceItems.push(
          this.buildEvidence({
            kind: "transcript",
            source: {
              primarySourceId: primarySource.sourceId,
              relatedAssetRef: transcriptAssetRef ?? undefined,
            },
            timeRange: { startMs: segment.startMs, endMs: segment.endMs },
            text: segment.text,
            assetRef: transcriptAssetRef,
            claimType,
            selectionReason: "Transcript segment aligned with source playback",
            provenance: {
              method: "transcript_segment_binding",
              processorVersion: SERVICE_PROCESSOR_VERSION,
              confidence: segment.confidence ?? null,
              editedByUser: segment.editedByUser === true,
            },
          }),
        );
        if (sourceHasAudio && audioPlayableAssetRef != null) {
          evidenceItems.push(
            this.buildEvidence({
              kind: "audio_segment",
              source: {
                primarySourceId: primarySource.sourceId,
                relatedAssetRef: audioPlayableAssetRef,
              },
              timeRange: { startMs: segment.startMs, endMs: segment.endMs },
              text: segment.text,
              assetRef: audioPlayableAssetRef,
              claimType,
              selectionReason: "Playable audio segment aligned with transcript",
              provenance: {
                method: "audio_segment_binding",
                processorVersion: SERVICE_PROCESSOR_VERSION,
                confidence: segment.confidence ?? null,
                editedByUser: segment.editedByUser === true,
              },
            }),
          );
        }
      }

      const sortedFrames = [...selectedFrames].sort(compareRankedFrames);
      if (primarySource.kind === "video" && sortedFrames.length === 0) {
        pushDegradation(degradations, {
          code: "NO_USABLE_VISUAL_EVIDENCE",
          message: "经过画面语义排序筛选后，未保留到可用的关键帧证据。",
        });
      }
      for (const frame of sortedFrames) {
        const moment = momentById.get(frame.semanticMomentId);
        if (!moment) {
          throw stableError();
        }
        const frameEndMs = Math.min(moment.endMs, frame.timestampMs + 1);
        if (frameEndMs <= frame.timestampMs) {
          throw stableError();
        }
        const nearbyTranscript = moment.transcriptEvidence?.text ?? moment.summary;
        evidenceItems.push(
          this.buildEvidence({
            kind: "frame",
            source: {
              primarySourceId: primarySource.sourceId,
              relatedAssetRef: frame.assetRef,
            },
            timeRange: { startMs: frame.timestampMs, endMs: frameEndMs },
            text: nearbyTranscript,
            assetRef: frame.assetRef,
            claimType: "modelInference",
            selectionReason: `${frame.selectionReason}; ${frame.rankingReason}`,
            provenance: {
              method:
                frame.rankingMethod === "vision_model"
                  ? "vision_soft_ranking"
                  : "deterministic_quality_fallback",
              processorVersion: SERVICE_PROCESSOR_VERSION,
              model: frame.rankingMethod === "vision_model" ? frame.rankingModel ?? null : null,
              confidence: frame.rankingMethod === "vision_model" ? frame.score : null,
              editedByUser: false,
            },
          }),
        );
      }

      const sortedEvidence = evidenceItems.sort(compareEvidence);
      const seenEvidenceIds = new Set<string>();
      for (const item of sortedEvidence) {
        if (item.timeRange.endMs <= item.timeRange.startMs) {
          throw stableError();
        }
        if (seenEvidenceIds.has(item.evidenceId)) {
          throw stableError();
        }
        seenEvidenceIds.add(item.evidenceId);
      }

      return {
        evidenceItems: sortedEvidence,
        degradations,
      };
    } catch (error) {
      if (error instanceof MediaEvidenceServiceError) {
        throw error;
      }
      throw stableError();
    }
  }

  private normalizeSemanticMoments(drafts: SemanticMomentDraft[]): NormalizedSemanticMoment[] {
    const seen = new Map<string, number>();
    return drafts.map((draft) => {
      const hashPayload = {
        startMs: draft.startMs,
        endMs: draft.endMs,
        importance: draft.importance,
        type: draft.type,
        summary: draft.summary,
        visualTarget: draft.visualTarget ?? null,
        transcriptEvidence: draft.transcriptEvidence ?? null,
        audioEvidence: draft.audioEvidence ?? null,
        selectionReason: draft.selectionReason,
      };
      const prefix = createHash("sha256").update(JSON.stringify(hashPayload)).digest("hex").slice(0, 16);
      const occurrence = (seen.get(prefix) ?? 0) + 1;
      seen.set(prefix, occurrence);
      return {
        semanticMomentId: occurrence === 1 ? `moment-${prefix}` : `moment-${prefix}-${occurrence}`,
        ...draft,
      };
    });
  }

  private parseSemanticVisualContext(
    value: unknown,
    primarySource: MultimodalPrimarySource,
    durationMs: number,
  ): SemanticVisualContext | null {
    if (primarySource.kind === "audio") {
      if (value === undefined || value === null) {
        return null;
      }
    } else if (value === undefined || value === null) {
      throw stableError();
    }

    if (value === undefined || value === null) {
      return null;
    }
    const record = readRecord(value, "visualContext");
    const mode = readString(record.mode, "visualContext.mode", 64);
    if (mode === "native_video") {
      assertExactKeys(record, "visualContext", ["mode", "sourceAssetRef"]);
      const sourceAssetRef = parseAssetRef(record.sourceAssetRef, "visualContext.sourceAssetRef");
      if (canonicalize(sourceAssetRef) !== canonicalize(primarySource.assetRef)) {
        throw stableError();
      }
      return { mode, sourceAssetRef };
    }
    if (mode === "compatibility_frames") {
      assertExactKeys(record, "visualContext", ["mode", "frames"]);
      const frames = readArray(record.frames, "visualContext.frames");
      if (frames.length === 0 || frames.length > MAX_VISUAL_CONTEXT_FRAMES) {
        throw stableError();
      }
      return {
        mode,
        frames: frames.map((item, index) => {
          const frameRecord = readRecord(item, `visualContext.frames[${index}]`);
          assertExactKeys(frameRecord, `visualContext.frames[${index}]`, [
            "timestampMs",
            "assetRef",
            "caption",
          ]);
          const assetRef = parseAssetRef(
            frameRecord.assetRef,
            `visualContext.frames[${index}].assetRef`,
          );
          if (assetRef.mimeType !== "image/png" || assetRef.sizeBytes < 1) {
            throw stableError();
          }
          return {
            timestampMs: readInteger(
              frameRecord.timestampMs,
              `visualContext.frames[${index}].timestampMs`,
              { min: 0, max: durationMs - 1 },
            ),
            assetRef,
            caption: readOptionalString(
              frameRecord.caption,
              `visualContext.frames[${index}].caption`,
              256,
            ),
          };
        }),
      };
    }
    throw stableError();
  }

  private normalizeTimestampList(
    timestamps: unknown,
    durationMs: number,
  ): number[] {
    if (timestamps === undefined) {
      return [];
    }
    const values = readArray(timestamps, "timestamps");
    if (values.length > MAX_VISUAL_SIGNAL_TIMESTAMPS) {
      throw stableError();
    }
    return [...new Set(values.map((value, index) =>
      readInteger(value, `timestamps[${index}]`, {
        min: 0,
        max: durationMs - 1,
      }),
    ))]
      .sort((left, right) => left - right);
  }

  private buildSemanticAnchors(moment: NormalizedSemanticMoment): number[] {
    const start = moment.startMs;
    const endExclusive = moment.endMs;
    const middle = start + Math.floor((endExclusive - start - 1) / 2);
    const last = endExclusive - 1;
    const anchors = [start, middle, last];
    if (new Set(anchors).size < 3) {
      throw stableError();
    }
    return anchors;
  }

  private insertSignalCandidates(
    candidatesByTimestamp: Map<number, FrameRequestPlanItem & { priority: number }>,
    anchorCandidates: Map<number, FrameRequestPlanItem & { priority: number }>,
    timestamps: number[],
    moment: NormalizedSemanticMoment,
    sourceSignal: MultimodalFrameSourceSignal,
    reason: string,
  ): void {
    for (const timestampMs of timestamps) {
      if (timestampMs < moment.startMs || timestampMs >= moment.endMs) {
        continue;
      }
      this.insertCandidate(candidatesByTimestamp, {
        candidateId: this.makeFrameCandidateId(moment.semanticMomentId, timestampMs, sourceSignal),
        semanticMomentId: moment.semanticMomentId,
        timestampMs,
        sourceSignal,
        selectionReason: reason,
        priority: VISUAL_SIGNAL_PRIORITY[sourceSignal],
      }, anchorCandidates);
    }
  }

  private insertCandidate(
    candidatesByTimestamp: Map<number, FrameRequestPlanItem & { priority: number }>,
    candidate: FrameRequestPlanItem & { priority: number },
    protectedCandidates?: Map<number, FrameRequestPlanItem & { priority: number }>,
  ): void {
    const conflicts = [
      ...(protectedCandidates?.values() ?? []),
      ...candidatesByTimestamp.values(),
    ].filter(
      (item) => Math.abs(item.timestampMs - candidate.timestampMs) < this.minFrameSpacingMs,
    );
    if (conflicts.length === 0) {
      candidatesByTimestamp.set(candidate.timestampMs, candidate);
      return;
    }
    if (conflicts.some((item) => protectedCandidates?.has(item.timestampMs))) {
      return;
    }
    if (conflicts.some((item) => item.priority <= candidate.priority)) {
      return;
    }
    for (const conflict of conflicts) {
      candidatesByTimestamp.delete(conflict.timestampMs);
    }
    candidatesByTimestamp.set(candidate.timestampMs, candidate);
  }

  private buildPeriodicFallbackTimestamps(
    moment: NormalizedSemanticMoment,
    durationMs: number,
  ): number[] {
    const candidates: number[] = [];
    const windowDuration = moment.endMs - moment.startMs;
    for (let fraction = 0.2; fraction < 1 && candidates.length < 6; fraction += 0.2) {
      const timestampMs = Math.min(
        durationMs - 1,
        Math.max(moment.startMs, Math.floor(moment.startMs + windowDuration * fraction)),
      );
      if (timestampMs >= moment.startMs && timestampMs < moment.endMs) {
        candidates.push(timestampMs);
      }
    }
    return candidates;
  }

  private makeFrameCandidateId(
    semanticMomentId: string,
    timestampMs: number,
    sourceSignal: MultimodalFrameSourceSignal,
  ): string {
    return makeDeterministicId("frame-candidate", {
      semanticMomentId,
      timestampMs,
      sourceSignal,
    });
  }

  private maxSemanticMomentEnd(moments: unknown): number {
    const items = readArray(moments, "semanticMoments");
    return Math.max(
      1,
      ...items.map((moment, index) =>
        readInteger(
          readRecord(moment, `semanticMoments[${index}]`).endMs,
          `semanticMoments[${index}].endMs`,
          { min: 1, max: Number.MAX_SAFE_INTEGER },
        ),
      ),
    );
  }

  private parseFrameCandidateManifest(
    value: unknown,
    momentById: Map<string, NormalizedSemanticMoment>,
  ): ParsedFrameCandidate[] {
    const items = readArray(value, "frameCandidateManifest");
    if (items.length === 0 || items.length > MAX_FRAME_CANDIDATES) {
      throw stableError();
    }
    const seenCandidateIds = new Set<string>();
    const parsed = items.map((item, index) => {
      const record = readRecord(item, `frameCandidateManifest[${index}]`);
      assertExactKeys(record, `frameCandidateManifest[${index}]`, [
        "candidateId",
        "semanticMomentId",
        "timestampMs",
        "sourceSignal",
        "selectionReason",
        "assetRef",
        "metrics",
        "hardRejectedReasons",
        "suppressed",
        "duplicateOf",
        "frameExtractorVersion",
        "qualityProcessorVersion",
      ]);
      const candidateId = readSafeId(
        record.candidateId,
        `frameCandidateManifest[${index}].candidateId`,
      );
      if (seenCandidateIds.has(candidateId)) {
        throw stableError();
      }
      seenCandidateIds.add(candidateId);
      const semanticMomentId = readSafeId(
        record.semanticMomentId,
        `frameCandidateManifest[${index}].semanticMomentId`,
      );
      const moment = momentById.get(semanticMomentId);
      if (!moment) {
        throw stableError();
      }
      const metrics = this.parseFrameQualityMetrics(record.metrics);
      const hardRejectedReasons = readArray(
        record.hardRejectedReasons,
        `frameCandidateManifest[${index}].hardRejectedReasons`,
      ).map((reason, reasonIndex) => {
        const text = readString(
          reason,
          `frameCandidateManifest[${index}].hardRejectedReasons[${reasonIndex}]`,
          64,
        );
        if (!HARD_REJECTED_REASONS.includes(text as (typeof HARD_REJECTED_REASONS)[number])) {
          throw stableError();
        }
        return text;
      });
      if (new Set(hardRejectedReasons).size !== hardRejectedReasons.length) {
        throw stableError();
      }
      const duplicateOf =
        record.duplicateOf === null || record.duplicateOf === undefined
          ? null
          : readSafeId(
              record.duplicateOf,
              `frameCandidateManifest[${index}].duplicateOf`,
            );
      const suppressed = readBoolean(
        record.suppressed,
        `frameCandidateManifest[${index}].suppressed`,
      );
      if (suppressed !== (duplicateOf !== null)) {
        throw stableError();
      }
      const timestampMs = readInteger(
        record.timestampMs,
        `frameCandidateManifest[${index}].timestampMs`,
        { min: moment.startMs, max: moment.endMs - 1 },
      );
      const assetRef = parseAssetRef(record.assetRef, `frameCandidateManifest[${index}].assetRef`);
      if (
        assetRef.mimeType !== "image/png" ||
        assetRef.sizeBytes < 1 ||
        assetRef.sizeBytes > MAX_FRAME_ASSET_BYTES
      ) {
        throw stableError();
      }
      const parsed: ParsedFrameCandidate = {
        candidateId,
        semanticMomentId,
        timestampMs,
        sourceSignal: readFrameSourceSignal(
          record.sourceSignal,
          `frameCandidateManifest[${index}].sourceSignal`,
        ),
        selectionReason: readString(
          record.selectionReason,
          `frameCandidateManifest[${index}].selectionReason`,
          512,
        ),
        assetRef,
        metrics,
        hardRejectedReasons,
        suppressed,
        duplicateOf,
        frameExtractorVersion: readString(
          record.frameExtractorVersion,
          `frameCandidateManifest[${index}].frameExtractorVersion`,
          128,
        ),
        qualityProcessorVersion: readString(
          record.qualityProcessorVersion,
          `frameCandidateManifest[${index}].qualityProcessorVersion`,
          128,
        ),
      };
      return parsed;
    });
    const candidateById = new Map(parsed.map((candidate) => [candidate.candidateId, candidate]));
    for (const candidate of parsed) {
      if (candidate.duplicateOf == null) {
        continue;
      }
      const keeper = candidateById.get(candidate.duplicateOf);
      if (
        !keeper ||
        keeper.candidateId === candidate.candidateId ||
        keeper.semanticMomentId !== candidate.semanticMomentId ||
        keeper.suppressed
      ) {
        throw stableError();
      }
    }
    return parsed;
  }

  private parseFrameQualityMetrics(value: unknown): FrameQualityMetrics {
    const record = readRecord(value, "frameQualityMetrics");
    assertExactKeys(record, "frameQualityMetrics", [
      "analysisWidth",
      "analysisHeight",
      "brightnessMeanNormalized",
      "blackPixelRatio",
      "whitePixelRatio",
      "entropyNormalized",
      "sharpness",
      "duplicateHash",
    ]);
    const sharpnessRecord = readRecord(record.sharpness, "frameQualityMetrics.sharpness");
    const duplicateHashRecord = readRecord(
      record.duplicateHash,
      "frameQualityMetrics.duplicateHash",
    );
    assertExactKeys(sharpnessRecord, "frameQualityMetrics.sharpness", [
      "algorithm",
      "normalized",
      "value",
    ]);
    assertExactKeys(duplicateHashRecord, "frameQualityMetrics.duplicateHash", [
      "algorithm",
      "value",
    ]);
    if (sharpnessRecord.normalized !== true) {
      throw stableError();
    }
    return {
      analysisWidth: readInteger(record.analysisWidth, "frameQualityMetrics.analysisWidth", {
        min: 1,
        max: MAX_ANALYSIS_DIMENSION,
      }),
      analysisHeight: readInteger(record.analysisHeight, "frameQualityMetrics.analysisHeight", {
        min: 1,
        max: MAX_ANALYSIS_DIMENSION,
      }),
      brightnessMeanNormalized: readFiniteNumber(
        record.brightnessMeanNormalized,
        "frameQualityMetrics.brightnessMeanNormalized",
        { min: 0, max: 1 },
      ),
      blackPixelRatio: readFiniteNumber(
        record.blackPixelRatio,
        "frameQualityMetrics.blackPixelRatio",
        { min: 0, max: 1 },
      ),
      whitePixelRatio: readFiniteNumber(
        record.whitePixelRatio,
        "frameQualityMetrics.whitePixelRatio",
        { min: 0, max: 1 },
      ),
      entropyNormalized: readFiniteNumber(
        record.entropyNormalized,
        "frameQualityMetrics.entropyNormalized",
        { min: 0, max: 1 },
      ),
      sharpness: {
        algorithm:
          readString(
            sharpnessRecord.algorithm,
            "frameQualityMetrics.sharpness.algorithm",
            128,
          ) === "laplacian_variance_4_neighbour_normalized"
            ? "laplacian_variance_4_neighbour_normalized"
            : (() => {
                throw stableError();
              })(),
        normalized: true,
        value: readFiniteNumber(sharpnessRecord.value, "frameQualityMetrics.sharpness.value", {
          min: 0,
          max: 1,
        }),
      },
      duplicateHash: {
        algorithm:
          readString(
            duplicateHashRecord.algorithm,
            "frameQualityMetrics.duplicateHash.algorithm",
            128,
          ) === "dhash_64"
            ? "dhash_64"
            : (() => {
                throw stableError();
              })(),
        value: parseFrameDHash64(
          duplicateHashRecord.value,
          "frameQualityMetrics.duplicateHash.value",
        ),
      },
    };
  }

  private selectByDeterministicQuality(
    moment: NormalizedSemanticMoment,
    usableCandidates: ParsedFrameCandidate[],
  ): SelectedMomentFrame[] {
    return [...usableCandidates]
      .sort(
        (left, right) =>
          right.metrics.sharpness.value - left.metrics.sharpness.value ||
          right.metrics.entropyNormalized - left.metrics.entropyNormalized ||
          Math.abs(left.metrics.brightnessMeanNormalized - 0.5) -
            Math.abs(right.metrics.brightnessMeanNormalized - 0.5) ||
          left.timestampMs - right.timestampMs ||
          left.candidateId.localeCompare(right.candidateId),
      )
      .slice(0, this.maxSelectedFramesPerMoment)
      .map((candidate, index) => ({
        candidateId: candidate.candidateId,
        semanticMomentId: moment.semanticMomentId,
        timestampMs: candidate.timestampMs,
        sourceSignal: candidate.sourceSignal,
        selectionReason: candidate.selectionReason,
        assetRef: candidate.assetRef,
        score: Math.max(0, Math.min(1, 1 - index * 0.1)),
        rankingReason: "deterministic quality fallback",
        rankingMethod: "deterministic_quality_fallback",
        rankingModel: null,
        qualitySummary: candidate.metrics,
      }));
  }

  private applyVisionRankingOutput(
    moment: NormalizedSemanticMoment,
    usableCandidates: ParsedFrameCandidate[],
    value: unknown,
  ): { selectedFrames: SelectedMomentFrame[]; rankingModel: string | null } | null {
    const record = readRecord(value, "visionRankingOutput");
    assertExactKeys(record, "visionRankingOutput", ["rankings", "model"]);
    const rankings = readArray(record.rankings, "visionRankingOutput.rankings").map(
      (item, index) => {
        const rankingRecord = readRecord(item, `visionRankingOutput.rankings[${index}]`);
        assertExactKeys(rankingRecord, `visionRankingOutput.rankings[${index}]`, [
          "candidateId",
          "score",
          "reason",
        ]);
        return {
          candidateId: readSafeId(
            rankingRecord.candidateId,
            `visionRankingOutput.rankings[${index}].candidateId`,
          ),
          score: readFiniteNumber(
            rankingRecord.score,
            `visionRankingOutput.rankings[${index}].score`,
            { min: 0, max: 1 },
          ),
          reason: readString(
            rankingRecord.reason,
            `visionRankingOutput.rankings[${index}].reason`,
            512,
          ),
        } satisfies RankingOutputItem;
      },
    );
    const byId = new Map(usableCandidates.map((candidate) => [candidate.candidateId, candidate]));
    const seen = new Set<string>();
    if (rankings.length > usableCandidates.length) {
      return null;
    }
    for (const ranking of rankings) {
      if (seen.has(ranking.candidateId) || !byId.has(ranking.candidateId)) {
        return null;
      }
      seen.add(ranking.candidateId);
    }

    return {
      rankingModel: readMetadataString(record.model, "visionRankingOutput.model"),
      selectedFrames: rankings
        .map((ranking): SelectedMomentFrame | null => {
        const candidate = byId.get(ranking.candidateId);
        if (!candidate) {
          return null;
        }
        return {
          candidateId: candidate.candidateId,
          semanticMomentId: moment.semanticMomentId,
          timestampMs: candidate.timestampMs,
          sourceSignal: candidate.sourceSignal,
          selectionReason: candidate.selectionReason,
          assetRef: candidate.assetRef,
          score: ranking.score,
          rankingReason: ranking.reason,
          rankingMethod: "vision_model",
          rankingModel: null,
          qualitySummary: candidate.metrics,
        };
      })
      .filter((candidate): candidate is SelectedMomentFrame => candidate !== null)
      .sort(compareRankedFrames)
        .slice(0, this.maxSelectedFramesPerMoment),
    };
  }

  private parseSelectedFrames(
    value: unknown,
    momentById: Map<string, NormalizedSemanticMoment>,
  ): SelectedMomentFrame[] {
    const items = readArray(value, "selectedFrames");
    const seenCandidateIds = new Set<string>();
    const selectedCountByMoment = new Map<string, number>();
    return items.map((item, index) => {
      const record = readRecord(item, `selectedFrames[${index}]`);
      assertExactKeys(record, `selectedFrames[${index}]`, [
        "candidateId",
        "semanticMomentId",
        "timestampMs",
        "sourceSignal",
        "selectionReason",
        "assetRef",
        "score",
        "rankingReason",
        "rankingMethod",
        "rankingModel",
        "qualitySummary",
      ]);
      const candidateId = readSafeId(record.candidateId, `selectedFrames[${index}].candidateId`);
      if (seenCandidateIds.has(candidateId)) {
        throw stableError();
      }
      seenCandidateIds.add(candidateId);
      const semanticMomentId = readSafeId(
        record.semanticMomentId,
        `selectedFrames[${index}].semanticMomentId`,
      );
      const moment = momentById.get(semanticMomentId);
      if (!moment) {
        throw stableError();
      }
      const timestampMs = readInteger(record.timestampMs, `selectedFrames[${index}].timestampMs`, {
        min: moment.startMs,
        max: moment.endMs - 1,
      });
      const assetRef = parseAssetRef(record.assetRef, `selectedFrames[${index}].assetRef`);
      if (
        assetRef.mimeType !== "image/png" ||
        assetRef.sizeBytes < 1 ||
        assetRef.sizeBytes > MAX_FRAME_ASSET_BYTES
      ) {
        throw stableError();
      }
      const rankingMethod = readString(
        record.rankingMethod,
        `selectedFrames[${index}].rankingMethod`,
        64,
      );
      if (
        rankingMethod !== "vision_model" &&
        rankingMethod !== "deterministic_quality_fallback"
      ) {
        throw stableError();
      }
      const rankingModel = readMetadataString(
        record.rankingModel,
        `selectedFrames[${index}].rankingModel`,
      );
      if (rankingMethod === "deterministic_quality_fallback" && rankingModel !== null) {
        throw stableError();
      }
      const selectedCount = (selectedCountByMoment.get(semanticMomentId) ?? 0) + 1;
      if (selectedCount > this.maxSelectedFramesPerMoment) {
        throw stableError();
      }
      selectedCountByMoment.set(semanticMomentId, selectedCount);
      return {
        candidateId,
        semanticMomentId,
        timestampMs,
        sourceSignal: readFrameSourceSignal(
          record.sourceSignal,
          `selectedFrames[${index}].sourceSignal`,
        ),
        selectionReason: readString(
          record.selectionReason,
          `selectedFrames[${index}].selectionReason`,
          512,
        ),
        assetRef,
        score: readFiniteNumber(record.score, `selectedFrames[${index}].score`, {
          min: 0,
          max: 1,
        }),
        rankingReason: readString(
          record.rankingReason,
          `selectedFrames[${index}].rankingReason`,
          512,
        ),
        rankingMethod,
        rankingModel,
        qualitySummary: this.parseFrameQualityMetrics(record.qualitySummary),
      };
    });
  }

  private claimTypeForTranscriptSegment(
    transcriptStatus: MultimodalTranscript["status"],
    segment: MultimodalTranscript["segments"][number],
  ): MultimodalClaimType {
    if (segment.editedByUser === true) {
      return "userInput";
    }
    if (transcriptStatus !== "ready") {
      return "modelInference";
    }
    if ((segment.confidence ?? 0) < this.lowConfidenceThreshold) {
      return "modelInference";
    }
    return "sourceFact";
  }

  private buildEvidence(args: {
    kind: MultimodalEvidence["kind"];
    source: MultimodalEvidence["source"];
    timeRange: MultimodalEvidence["timeRange"];
    text: string;
    assetRef: MultimodalEvidence["assetRef"];
    claimType: MultimodalClaimType;
    selectionReason: string;
    provenance: MultimodalEvidence["provenance"];
  }): MultimodalEvidence {
    return parseEvidenceCard({
      evidenceId: makeDeterministicId("evidence", {
        kind: args.kind,
        source: args.source,
        timeRange: args.timeRange,
        text: args.text,
        assetRef: args.assetRef ?? null,
        claimType: args.claimType,
        selectionReason: args.selectionReason,
      }),
      kind: args.kind,
      source: args.source,
      timeRange: args.timeRange,
      text: args.text,
      assetRef: args.assetRef,
      provenance: args.provenance,
      claimType: args.claimType,
      selectionReason: args.selectionReason,
    });
  }
}
