import { createHash } from 'node:crypto';
import {
  MULTIMODAL_FRAME_SOURCE_SIGNALS,
  parseAssetRef,
  parseFrameDHash64,
  parseMultimodalTranscript,
  type MediaEvidenceDegradation,
  type MultimodalAssetRef,
  type MultimodalFrameSourceSignal,
  type MultimodalTranscript,
} from '@educlaw/shared';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const SEMVER = /^\d+\.\d+\.\d+$/;
const MAX_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_TIMESTAMPS = 512;
const MAX_FRAMES = 48;
const HARD_REJECTED_REASONS = new Set([
  'blurry',
  'black_screen',
  'white_screen',
  'low_information',
]);

export class MediaDistillationContractError extends Error {}

function fail(message: string): never {
  throw new MediaDistillationContractError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) fail(`${path} must be an object`);
  return value;
}

function exact(
  value: Record<string, unknown>,
  path: string,
  keys: readonly string[],
): void {
  const allowed = new Set(keys);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    fail(`${path} has unknown fields`);
  }
}

function text(value: unknown, path: string, maximum = 1024): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > maximum ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code < 0x20 || code === 0x7f;
    })
  ) {
    fail(`${path} must be a safe string`);
  }
  return value;
}

function safeId(value: unknown, path: string): string {
  const normalized = text(value, path, 128);
  if (!SAFE_ID.test(normalized)) fail(`${path} must be a safe id`);
  return normalized;
}

function integer(
  value: unknown,
  path: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    fail(`${path} must be an integer in range`);
  }
  return value;
}

function ratio(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    fail(`${path} must be a ratio`);
  }
  return value;
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(`${path} must be boolean`);
  return value;
}

function array(value: unknown, path: string, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    fail(`${path} must be an array`);
  }
  return value;
}

function processorVersion(value: unknown): string {
  const version = text(value, 'processorVersion', 64);
  if (!SEMVER.test(version)) fail('processorVersion must be semver');
  return version;
}

function assetRef(value: unknown, path: string): MultimodalAssetRef {
  const parsed = parseAssetRef(value, path);
  if (!parsed || parsed.sizeBytes < 1 || !SHA256_HEX.test(parsed.sha256)) {
    fail(`${path} is invalid`);
  }
  return parsed;
}

function jsonManifestRef(value: unknown, path: string): MultimodalAssetRef {
  const parsed = assetRef(value, path);
  if (parsed.mimeType !== 'application/json') fail(`${path} must be JSON`);
  return parsed;
}

function degradations(value: unknown): MediaEvidenceDegradation[] {
  return array(value, 'degradations', 32).map((item, index) => {
    const parsed = record(item, `degradations[${index}]`);
    exact(parsed, `degradations[${index}]`, [
      'code',
      'message',
      'semanticMomentId',
    ]);
    return {
      code: safeId(parsed.code, `degradations[${index}].code`),
      message: text(parsed.message, `degradations[${index}].message`, 512),
      ...(parsed.semanticMomentId == null
        ? {}
        : {
            semanticMomentId: safeId(
              parsed.semanticMomentId,
              `degradations[${index}].semanticMomentId`,
            ),
          }),
    };
  });
}

function timestampList(value: unknown, path: string, durationMs: number): number[] {
  const values = array(value, path, MAX_TIMESTAMPS).map((item, index) =>
    integer(item, `${path}[${index}]`, 0, durationMs - 1),
  );
  if (
    new Set(values).size !== values.length ||
    values.some((item, index) => index > 0 && item <= values[index - 1])
  ) {
    fail(`${path} must be unique and ordered`);
  }
  return values;
}

export interface MediaPrepareOutputManifest {
  schemaVersion: 1;
  jobType: 'media_prepare';
  sessionId: string;
  sourceId: string;
  sourceKind: 'video' | 'audio';
  durationMs: number;
  hasAudio: boolean;
  hasVideo: boolean;
  normalizedAudioAssetRef: MultimodalAssetRef | null;
  visualSignals: {
    sceneChangeTimestampsMs: number[];
    slowVisualChangeTimestampsMs: number[];
    sampledFrameCount: number;
    detectorVersion: string;
  } | null;
  resultManifestRef: MultimodalAssetRef;
  processorVersion: string;
  degradations: MediaEvidenceDegradation[];
}

export function parseMediaPrepareOutputManifest(
  value: unknown,
): MediaPrepareOutputManifest {
  const parsed = record(value, 'mediaPrepareOutput');
  exact(parsed, 'mediaPrepareOutput', [
    'schemaVersion',
    'jobType',
    'sessionId',
    'sourceId',
    'sourceKind',
    'durationMs',
    'hasAudio',
    'hasVideo',
    'normalizedAudioAssetRef',
    'visualSignals',
    'resultManifestRef',
    'processorVersion',
    'degradations',
  ]);
  if (parsed.schemaVersion !== 1 || parsed.jobType !== 'media_prepare') {
    fail('mediaPrepareOutput identity is invalid');
  }
  const sourceKind = parsed.sourceKind;
  if (sourceKind !== 'video' && sourceKind !== 'audio') {
    fail('sourceKind is invalid');
  }
  const durationMs = integer(parsed.durationMs, 'durationMs', 1, MAX_DURATION_MS);
  const hasAudio = bool(parsed.hasAudio, 'hasAudio');
  const hasVideo = bool(parsed.hasVideo, 'hasVideo');
  if ((sourceKind === 'audio' && (!hasAudio || hasVideo)) || (sourceKind === 'video' && !hasVideo)) {
    fail('media tracks do not match sourceKind');
  }
  const normalizedAudioAssetRef =
    parsed.normalizedAudioAssetRef == null
      ? null
      : assetRef(parsed.normalizedAudioAssetRef, 'normalizedAudioAssetRef');
  if (hasAudio !== (normalizedAudioAssetRef !== null)) {
    fail('normalizedAudioAssetRef does not match hasAudio');
  }
  if (normalizedAudioAssetRef && normalizedAudioAssetRef.mimeType !== 'audio/wav') {
    fail('normalizedAudioAssetRef must be WAV');
  }
  let visualSignals: MediaPrepareOutputManifest['visualSignals'] = null;
  if (sourceKind === 'video') {
    const signals = record(parsed.visualSignals, 'visualSignals');
    exact(signals, 'visualSignals', [
      'sceneChangeTimestampsMs',
      'slowVisualChangeTimestampsMs',
      'sampledFrameCount',
      'detectorVersion',
    ]);
    visualSignals = {
      sceneChangeTimestampsMs: timestampList(
        signals.sceneChangeTimestampsMs,
        'visualSignals.sceneChangeTimestampsMs',
        durationMs,
      ),
      slowVisualChangeTimestampsMs: timestampList(
        signals.slowVisualChangeTimestampsMs,
        'visualSignals.slowVisualChangeTimestampsMs',
        durationMs,
      ),
      sampledFrameCount: integer(
        signals.sampledFrameCount,
        'visualSignals.sampledFrameCount',
        0,
        10_000,
      ),
      detectorVersion: processorVersion(signals.detectorVersion),
    };
  } else if (parsed.visualSignals !== null) {
    fail('audio must not contain visualSignals');
  }
  return {
    schemaVersion: 1,
    jobType: 'media_prepare',
    sessionId: safeId(parsed.sessionId, 'sessionId'),
    sourceId: safeId(parsed.sourceId, 'sourceId'),
    sourceKind,
    durationMs,
    hasAudio,
    hasVideo,
    normalizedAudioAssetRef,
    visualSignals,
    resultManifestRef: jsonManifestRef(parsed.resultManifestRef, 'resultManifestRef'),
    processorVersion: processorVersion(parsed.processorVersion),
    degradations: degradations(parsed.degradations),
  };
}

export interface TranscribeOutputManifest {
  schemaVersion: 1;
  jobType: 'transcribe';
  sessionId: string;
  sourceId: string;
  durationMs: number;
  transcript: MultimodalTranscript;
  transcriptAssetRef: MultimodalAssetRef;
  resultManifestRef: MultimodalAssetRef;
  processorVersion: string;
  degradations: MediaEvidenceDegradation[];
}

export function parseTranscribeOutputManifest(value: unknown): TranscribeOutputManifest {
  const parsed = record(value, 'transcribeOutput');
  exact(parsed, 'transcribeOutput', [
    'schemaVersion',
    'jobType',
    'sessionId',
    'sourceId',
    'durationMs',
    'transcript',
    'transcriptAssetRef',
    'resultManifestRef',
    'processorVersion',
    'degradations',
  ]);
  if (parsed.schemaVersion !== 1 || parsed.jobType !== 'transcribe') {
    fail('transcribeOutput identity is invalid');
  }
  const durationMs = integer(parsed.durationMs, 'durationMs', 1, MAX_DURATION_MS);
  const transcript = parseMultimodalTranscript(parsed.transcript, 'transcript', {
    durationMs,
    maxSegments: 10_000,
  });
  if (transcript.status !== 'ready' && transcript.status !== 'low_confidence') {
    fail('transcript status is invalid');
  }
  for (let index = 1; index < transcript.segments.length; index += 1) {
    if (transcript.segments[index].startMs < transcript.segments[index - 1].endMs) {
      fail('transcript segments must be ordered and non-overlapping');
    }
  }
  const transcriptAssetRef = assetRef(parsed.transcriptAssetRef, 'transcriptAssetRef');
  if (transcriptAssetRef.mimeType !== 'application/json') {
    fail('transcriptAssetRef must be JSON');
  }
  return {
    schemaVersion: 1,
    jobType: 'transcribe',
    sessionId: safeId(parsed.sessionId, 'sessionId'),
    sourceId: safeId(parsed.sourceId, 'sourceId'),
    durationMs,
    transcript,
    transcriptAssetRef,
    resultManifestRef: jsonManifestRef(parsed.resultManifestRef, 'resultManifestRef'),
    processorVersion: processorVersion(parsed.processorVersion),
    degradations: degradations(parsed.degradations),
  };
}

interface FrameQualityMetrics {
  analysisWidth: number;
  analysisHeight: number;
  brightnessMeanNormalized: number;
  blackPixelRatio: number;
  whitePixelRatio: number;
  entropyNormalized: number;
  sharpness: { algorithm: string; normalized: true; value: number };
  duplicateHash: { algorithm: 'dhash_64'; value: string };
}

export interface FrameCandidateManifest {
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

export interface FrameMaterializeOutputManifest {
  schemaVersion: 1;
  jobType: 'frame_materialize';
  sessionId: string;
  sourceId: string;
  candidates: FrameCandidateManifest[];
  resultManifestRef: MultimodalAssetRef;
  processorVersion: string;
  degradations: MediaEvidenceDegradation[];
}

function parseMetrics(value: unknown): FrameQualityMetrics {
  const parsed = record(value, 'metrics');
  exact(parsed, 'metrics', [
    'analysisWidth',
    'analysisHeight',
    'brightnessMeanNormalized',
    'blackPixelRatio',
    'whitePixelRatio',
    'entropyNormalized',
    'sharpness',
    'duplicateHash',
  ]);
  const sharpness = record(parsed.sharpness, 'metrics.sharpness');
  exact(sharpness, 'metrics.sharpness', ['algorithm', 'normalized', 'value']);
  const duplicateHash = record(parsed.duplicateHash, 'metrics.duplicateHash');
  exact(duplicateHash, 'metrics.duplicateHash', ['algorithm', 'value']);
  if (
    sharpness.algorithm !== 'laplacian_variance_4_neighbour_normalized' ||
    sharpness.normalized !== true ||
    duplicateHash.algorithm !== 'dhash_64'
  ) {
    fail('frame quality algorithms are invalid');
  }
  return {
    analysisWidth: integer(parsed.analysisWidth, 'metrics.analysisWidth', 1, 1024),
    analysisHeight: integer(parsed.analysisHeight, 'metrics.analysisHeight', 1, 1024),
    brightnessMeanNormalized: ratio(
      parsed.brightnessMeanNormalized,
      'metrics.brightnessMeanNormalized',
    ),
    blackPixelRatio: ratio(parsed.blackPixelRatio, 'metrics.blackPixelRatio'),
    whitePixelRatio: ratio(parsed.whitePixelRatio, 'metrics.whitePixelRatio'),
    entropyNormalized: ratio(parsed.entropyNormalized, 'metrics.entropyNormalized'),
    sharpness: {
      algorithm: 'laplacian_variance_4_neighbour_normalized',
      normalized: true,
      value: ratio(sharpness.value, 'metrics.sharpness.value'),
    },
    duplicateHash: {
      algorithm: 'dhash_64',
      value: parseFrameDHash64(duplicateHash.value, 'metrics.duplicateHash.value'),
    },
  };
}

export function parseFrameMaterializeOutputManifest(
  value: unknown,
): FrameMaterializeOutputManifest {
  const parsed = record(value, 'frameMaterializeOutput');
  exact(parsed, 'frameMaterializeOutput', [
    'schemaVersion',
    'jobType',
    'sessionId',
    'sourceId',
    'candidates',
    'resultManifestRef',
    'processorVersion',
    'degradations',
  ]);
  if (parsed.schemaVersion !== 1 || parsed.jobType !== 'frame_materialize') {
    fail('frameMaterializeOutput identity is invalid');
  }
  const seen = new Set<string>();
  const candidates = array(parsed.candidates, 'candidates', MAX_FRAMES).map(
    (item, index): FrameCandidateManifest => {
      const candidate = record(item, `candidates[${index}]`);
      exact(candidate, `candidates[${index}]`, [
        'candidateId',
        'semanticMomentId',
        'timestampMs',
        'sourceSignal',
        'selectionReason',
        'assetRef',
        'metrics',
        'hardRejectedReasons',
        'suppressed',
        'duplicateOf',
        'frameExtractorVersion',
        'qualityProcessorVersion',
      ]);
      const candidateId = safeId(candidate.candidateId, `candidates[${index}].candidateId`);
      if (seen.has(candidateId)) fail('candidateId must be unique');
      seen.add(candidateId);
      const sourceSignal = candidate.sourceSignal;
      if (
        typeof sourceSignal !== 'string' ||
        !MULTIMODAL_FRAME_SOURCE_SIGNALS.includes(
          sourceSignal as MultimodalFrameSourceSignal,
        )
      ) {
        fail('sourceSignal is invalid');
      }
      const frameAssetRef = assetRef(candidate.assetRef, `candidates[${index}].assetRef`);
      if (frameAssetRef.mimeType !== 'image/png') fail('frame asset must be PNG');
      const hardRejectedReasons = array(
        candidate.hardRejectedReasons,
        `candidates[${index}].hardRejectedReasons`,
        4,
      ).map((reason) => text(reason, 'hardRejectedReason', 64));
      if (
        new Set(hardRejectedReasons).size !== hardRejectedReasons.length ||
        hardRejectedReasons.some((reason) => !HARD_REJECTED_REASONS.has(reason))
      ) {
        fail('hardRejectedReasons are invalid');
      }
      const suppressed = bool(candidate.suppressed, `candidates[${index}].suppressed`);
      const duplicateOf =
        candidate.duplicateOf == null
          ? null
          : safeId(candidate.duplicateOf, `candidates[${index}].duplicateOf`);
      if (suppressed !== (duplicateOf !== null)) fail('duplicate suppression is invalid');
      return {
        candidateId,
        semanticMomentId: safeId(
          candidate.semanticMomentId,
          `candidates[${index}].semanticMomentId`,
        ),
        timestampMs: integer(candidate.timestampMs, `candidates[${index}].timestampMs`),
        sourceSignal: sourceSignal as MultimodalFrameSourceSignal,
        selectionReason: text(
          candidate.selectionReason,
          `candidates[${index}].selectionReason`,
          512,
        ),
        assetRef: frameAssetRef,
        metrics: parseMetrics(candidate.metrics),
        hardRejectedReasons,
        suppressed,
        duplicateOf,
        frameExtractorVersion: processorVersion(candidate.frameExtractorVersion),
        qualityProcessorVersion: processorVersion(candidate.qualityProcessorVersion),
      };
    },
  );
  if (candidates.length < 1) fail('candidates must not be empty');
  for (const candidate of candidates) {
    if (candidate.duplicateOf && !seen.has(candidate.duplicateOf)) {
      fail('duplicateOf must reference a candidate');
    }
  }
  return {
    schemaVersion: 1,
    jobType: 'frame_materialize',
    sessionId: safeId(parsed.sessionId, 'sessionId'),
    sourceId: safeId(parsed.sourceId, 'sourceId'),
    candidates,
    resultManifestRef: jsonManifestRef(parsed.resultManifestRef, 'resultManifestRef'),
    processorVersion: processorVersion(parsed.processorVersion),
    degradations: degradations(parsed.degradations),
  };
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function buildDistillationResultHash(value: unknown): string {
  return createHash('sha256').update(canonicalize(value)).digest('hex');
}

interface AttemptKeyInput {
  sessionId: string;
  jobId: string;
  attemptNo: number;
}

function artifactPrefix(input: AttemptKeyInput): string {
  return `skill-sessions/${safeId(input.sessionId, 'sessionId')}/jobs/${safeId(
    input.jobId,
    'jobId',
  )}/attempt-${integer(input.attemptNo, 'attemptNo', 1, 100)}`;
}

export function buildNormalizedAudioKey(input: AttemptKeyInput): string {
  return `${artifactPrefix(input)}/normalized-audio.wav`;
}

export function buildTranscriptAssetKey(input: AttemptKeyInput): string {
  return `${artifactPrefix(input)}/transcript.json`;
}

export function buildTranscriptChunkManifestKey(
  input: AttemptKeyInput & { chunkIndex: number },
): string {
  const chunkIndex = integer(input.chunkIndex, 'chunkIndex', 0, 9_999);
  return `${artifactPrefix(input)}/transcript-chunks/chunk-${String(
    chunkIndex,
  ).padStart(4, '0')}.json`;
}

export function buildJobResultManifestKey(input: AttemptKeyInput): string {
  return `${artifactPrefix(input)}/result.json`;
}

export function buildFrameAssetKey(
  input: AttemptKeyInput & { candidateId: string },
): string {
  return `${artifactPrefix(input)}/frames/${safeId(
    input.candidateId,
    'candidateId',
  )}.png`;
}
