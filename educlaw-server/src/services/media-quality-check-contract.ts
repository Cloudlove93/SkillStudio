import { createHash } from 'node:crypto';

export const QUALITY_CHECK_SCHEMA_VERSION = 1;
export const QUALITY_CHECK_JOB_TYPE = 'media_quality_check' as const;

export type MediaKind = 'video' | 'audio';

export const parseMediaQualityCheckJobInputManifest = parseQualityCheckInputManifest;
export const parseMediaQualityCheckOutputManifest = parseQualityCheckOutputManifest;
export const buildMediaQualityCheckResultHash = computeQualityCheckResultHash;

export interface QualityCheckInputManifest {
  schemaVersion: 1;
  sourceId: string;
  mediaKind: MediaKind;
  objectKey: string;
  fileName: string;
  expectedSizeBytes: number;
  expectedContentType: string;
  uploadMode: 'single_put' | 'multipart';
}

export interface QualityCheckSourceAsset {
  objectKey: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

export interface QualityCheckProbe {
  durationMs: number;
  formatName: string;
  hasAudio: boolean;
  hasVideo: boolean;
  audioStreamCount: number;
  videoStreamCount: number;
  primaryAudioStreamIndex: number | null;
  primaryVideoStreamIndex: number | null;
}

export interface QualityCheckResultManifestRef {
  objectKey: string;
  mimeType: 'application/json';
  sizeBytes: number;
  sha256: string;
}

export interface QualityCheckDegradation {
  code: string;
  message: string;
}

export interface QualityCheckOutputManifest {
  schemaVersion: 1;
  jobType: 'media_quality_check';
  sessionId: string;
  sourceId: string;
  sourceKind: MediaKind;
  sourceAsset: QualityCheckSourceAsset;
  probe: QualityCheckProbe;
  resultManifestRef: QualityCheckResultManifestRef;
  processorVersion: string;
  degradations: QualityCheckDegradation[];
}

const SHA256_HEX = /^[0-9a-f]{64}$/;
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{1,127}$/;
const SEMVER = /^\d+\.\d+\.\d+$/;

export class ContractValidationError extends Error {
  constructor(
    message: string,
    public readonly code = 'CONTRACT_VALIDATION_ERROR',
  ) {
    super(message);
  }
}

function fail(message: string): never {
  throw new ContractValidationError(message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readSafeId(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    fail(`${label} must be a string`);
  }
  if (!SAFE_ID.test(value)) {
    fail(`${label} is not a valid id`);
  }
  return value;
}

function readString(value: unknown, label: string, maxLength = 1024): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail(`${label} must be a non-empty string`);
  }
  if (value.length > maxLength) {
    fail(`${label} exceeds max length ${maxLength}`);
  }
  return value;
}

function readInteger(value: unknown, label: string, min = 0): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    fail(`${label} must be an integer`);
  }
  if (value < min) {
    fail(`${label} must be >= ${min}`);
  }
  if (!Number.isSafeInteger(value)) {
    fail(`${label} exceeds safe integer range`);
  }
  return value;
}

function readBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    fail(`${label} must be a boolean`);
  }
  return value;
}

function readSha256(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    fail(`${label} must be a 64-char hex SHA-256 string`);
  }
  if (!SHA256_HEX.test(value)) {
    fail(`${label} must be a 64-char hex SHA-256 string`);
  }
  return value;
}

function readEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value !== 'string') {
    fail(`${label} must be one of: ${allowed.join(', ')}`);
  }
  if (!allowed.includes(value as T)) {
    fail(`${label} must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

function rejectUnknownKeys(
  obj: Record<string, unknown>,
  allowed: Set<string>,
  label: string,
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      fail(`${label}: unknown key "${key}"`);
    }
  }
}

export function parseQualityCheckInputManifest(
  value: unknown,
): QualityCheckInputManifest {
  if (!isPlainObject(value)) {
    fail('inputManifest must be a plain object');
  }
  rejectUnknownKeys(
    value,
    new Set([
      'schemaVersion',
      'sourceId',
      'mediaKind',
      'objectKey',
      'fileName',
      'expectedSizeBytes',
      'expectedContentType',
      'uploadMode',
    ]),
    'inputManifest',
  );

  const schemaVersion = readInteger(value.schemaVersion, 'inputManifest.schemaVersion');
  if (schemaVersion !== QUALITY_CHECK_SCHEMA_VERSION) {
    fail('inputManifest.schemaVersion must be 1');
  }

  return {
    schemaVersion: 1,
    sourceId: readSafeId(value.sourceId, 'inputManifest.sourceId'),
    mediaKind: readEnum(value.mediaKind, ['video', 'audio'] as const, 'inputManifest.mediaKind'),
    objectKey: readString(value.objectKey, 'inputManifest.objectKey'),
    fileName: readString(value.fileName, 'inputManifest.fileName'),
    expectedSizeBytes: readInteger(value.expectedSizeBytes, 'inputManifest.expectedSizeBytes'),
    expectedContentType: readString(value.expectedContentType, 'inputManifest.expectedContentType'),
    uploadMode: readEnum(value.uploadMode, ['single_put', 'multipart'] as const, 'inputManifest.uploadMode'),
  };
}

export function parseQualityCheckOutputManifest(
  value: unknown,
): QualityCheckOutputManifest {
  if (!isPlainObject(value)) {
    fail('outputManifest must be a plain object');
  }
  rejectUnknownKeys(
    value,
    new Set([
      'schemaVersion',
      'jobType',
      'sessionId',
      'sourceId',
      'sourceKind',
      'sourceAsset',
      'probe',
      'resultManifestRef',
      'processorVersion',
      'degradations',
    ]),
    'outputManifest',
  );

  const schemaVersion = readInteger(value.schemaVersion, 'outputManifest.schemaVersion');
  if (schemaVersion !== QUALITY_CHECK_SCHEMA_VERSION) {
    fail('outputManifest.schemaVersion must be 1');
  }

  const jobType = readEnum(value.jobType, ['media_quality_check'] as const, 'outputManifest.jobType');
  if (jobType !== QUALITY_CHECK_JOB_TYPE) {
    fail('outputManifest.jobType must be media_quality_check');
  }

  const sessionId = readSafeId(value.sessionId, 'outputManifest.sessionId');
  const sourceId = readSafeId(value.sourceId, 'outputManifest.sourceId');
  const sourceKind = readEnum(value.sourceKind, ['video', 'audio'] as const, 'outputManifest.sourceKind');
  const processorVersion = readString(value.processorVersion, 'outputManifest.processorVersion');
  if (!SEMVER.test(processorVersion)) {
    fail('outputManifest.processorVersion must be semver');
  }

  const sourceAsset = parseSourceAsset(value.sourceAsset);
  const probe = parseProbe(value.probe);
  const resultManifestRef = parseResultManifestRef(value.resultManifestRef);
  const degradations = parseDegradations(value.degradations);
  validateProbeSemantics(sourceKind, probe);

  return {
    schemaVersion: 1,
    jobType: 'media_quality_check',
    sessionId,
    sourceId,
    sourceKind,
    sourceAsset,
    probe,
    resultManifestRef,
    processorVersion,
    degradations,
  };
}

function validateProbeSemantics(
  sourceKind: MediaKind,
  probe: QualityCheckProbe,
): void {
  if (probe.audioStreamCount === 0 && probe.primaryAudioStreamIndex !== null) {
    fail(
      'probe.primaryAudioStreamIndex must be null when probe.audioStreamCount is 0',
    );
  }
  if (
    probe.audioStreamCount > 0 &&
    probe.primaryAudioStreamIndex === null
  ) {
    fail(
      'probe.primaryAudioStreamIndex must be set when probe.audioStreamCount is greater than 0',
    );
  }
  if (probe.videoStreamCount === 0 && probe.primaryVideoStreamIndex !== null) {
    fail(
      'probe.primaryVideoStreamIndex must be null when probe.videoStreamCount is 0',
    );
  }
  if (
    probe.videoStreamCount > 0 &&
    probe.primaryVideoStreamIndex === null
  ) {
    fail(
      'probe.primaryVideoStreamIndex must be set when probe.videoStreamCount is greater than 0',
    );
  }
  if (probe.hasAudio !== (probe.audioStreamCount > 0)) {
    fail('probe.hasAudio must match probe.audioStreamCount');
  }
  if (probe.hasVideo !== (probe.videoStreamCount > 0)) {
    fail('probe.hasVideo must match probe.videoStreamCount');
  }
  if (
    probe.primaryAudioStreamIndex !== null &&
    probe.primaryVideoStreamIndex !== null &&
    probe.primaryAudioStreamIndex === probe.primaryVideoStreamIndex
  ) {
    fail(
      'probe.primaryAudioStreamIndex and probe.primaryVideoStreamIndex must differ when both are set',
    );
  }
  if (sourceKind === 'audio') {
    if (probe.audioStreamCount === 0) {
      fail('audio outputs must include at least one audio stream');
    }
    if (probe.videoStreamCount > 0) {
      fail('audio outputs must not report ordinary video streams');
    }
  }
  if (sourceKind === 'video' && probe.videoStreamCount === 0) {
    fail('video outputs must include at least one video stream');
  }
}

function parseSourceAsset(value: unknown): QualityCheckSourceAsset {
  if (!isPlainObject(value)) {
    fail('sourceAsset must be a plain object');
  }
  rejectUnknownKeys(
    value,
    new Set(['objectKey', 'mimeType', 'sizeBytes', 'sha256']),
    'sourceAsset',
  );
  return {
    objectKey: readString(value.objectKey, 'sourceAsset.objectKey'),
    mimeType: readString(value.mimeType, 'sourceAsset.mimeType'),
    sizeBytes: readInteger(value.sizeBytes, 'sourceAsset.sizeBytes'),
    sha256: readSha256(value.sha256, 'sourceAsset.sha256'),
  };
}

function parseProbe(value: unknown): QualityCheckProbe {
  if (!isPlainObject(value)) {
    fail('probe must be a plain object');
  }
  rejectUnknownKeys(
    value,
    new Set([
      'durationMs',
      'formatName',
      'hasAudio',
      'hasVideo',
      'audioStreamCount',
      'videoStreamCount',
      'primaryAudioStreamIndex',
      'primaryVideoStreamIndex',
    ]),
    'probe',
  );

  return {
    durationMs: readInteger(value.durationMs, 'probe.durationMs'),
    formatName: readString(value.formatName, 'probe.formatName'),
    hasAudio: readBoolean(value.hasAudio, 'probe.hasAudio'),
    hasVideo: readBoolean(value.hasVideo, 'probe.hasVideo'),
    audioStreamCount: readInteger(value.audioStreamCount, 'probe.audioStreamCount'),
    videoStreamCount: readInteger(value.videoStreamCount, 'probe.videoStreamCount'),
    primaryAudioStreamIndex: readOptionalInt(value.primaryAudioStreamIndex, 'probe.primaryAudioStreamIndex'),
    primaryVideoStreamIndex: readOptionalInt(value.primaryVideoStreamIndex, 'probe.primaryVideoStreamIndex'),
  };
}

function readOptionalInt(value: unknown, label: string): number | null {
  if (value === null) {
    return null;
  }
  return readInteger(value, label);
}

function parseResultManifestRef(value: unknown): QualityCheckResultManifestRef {
  if (!isPlainObject(value)) {
    fail('resultManifestRef must be a plain object');
  }
  rejectUnknownKeys(
    value,
    new Set(['objectKey', 'mimeType', 'sizeBytes', 'sha256']),
    'resultManifestRef',
  );

  const mimeType = readString(value.mimeType, 'resultManifestRef.mimeType');
  if (mimeType !== 'application/json') {
    fail('resultManifestRef.mimeType must be application/json');
  }

  return {
    objectKey: readString(value.objectKey, 'resultManifestRef.objectKey'),
    mimeType: 'application/json',
    sizeBytes: readInteger(value.sizeBytes, 'resultManifestRef.sizeBytes'),
    sha256: readSha256(value.sha256, 'resultManifestRef.sha256'),
  };
}

function parseDegradations(value: unknown): QualityCheckDegradation[] {
  if (!Array.isArray(value)) {
    fail('degradations must be an array');
  }
  return value.map((item, index) => parseDegradation(item, index));
}

function parseDegradation(value: unknown, index: number): QualityCheckDegradation {
  if (!isPlainObject(value)) {
    fail(`degradations[${index}] must be a plain object`);
  }
  rejectUnknownKeys(
    value,
    new Set(['code', 'message']),
    `degradations[${index}]`,
  );
  return {
    code: readString(value.code, `degradations[${index}].code`),
    message: readString(value.message, `degradations[${index}].message`),
  };
}

export function canonicalQualityCheckOutputJson(
  manifest: QualityCheckOutputManifest,
): string {
  return JSON.stringify(manifest, (_key, value) => {
    if (isPlainObject(value)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(value).sort()) {
        sorted[k] = value[k];
      }
      return sorted;
    }
    return value;
  });
}

export function computeQualityCheckResultHash(
  manifest: QualityCheckOutputManifest,
): string {
  const canonical = canonicalQualityCheckOutputJson(manifest);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
