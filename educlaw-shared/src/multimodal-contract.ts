const INVALID_MULTIMODAL_CONTRACT = 'INVALID_MULTIMODAL_CONTRACT';
const SHA256_HEX = /^[0-9a-f]{64}$/;
const DHASH64_HEX = /^[0-9a-f]{16}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const OBJECT_KEY =
  /^(?!\/)(?!.*\/$)(?!.*\/\/)(?!.*\.\.)(?:[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*)$/;
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const MAX_SEMANTIC_MOMENTS = 8;
const MAX_TRANSCRIPT_SEGMENTS = 10_000;
const MAX_TEXT_LENGTH = 2000;
const MAX_SHORT_TEXT_LENGTH = 512;
const MAX_DEGRADATIONS = 32;
const MAX_ADLER_STATEMENTS_PER_LAYER = 24;
const MAX_CANDIDATES_PER_PASS = 24;
const MAX_CANDIDATE_EVIDENCE_IDS = 16;
const MAX_VALIDATED_CANDIDATES = 120;
const MAX_RIA_SKILL_DRAFTS = 16;
const MAX_OPERATION_RECEIPTS = 64;
const MAX_REUSABLE_CONTEXTS = 8;
const MAX_DIFFERENTIATORS = 8;
const MAX_RELATIONS = 16;
const MAX_EXECUTION_STEPS = 16;
const MAX_BOUNDARY_ITEMS = 8;
const MAX_ADLER_REVIEW_TITLE_LENGTH = 200;
const MAX_ADLER_REVIEW_NOTES_LENGTH = 2000;
export const MULTIMODAL_MAX_SELECTED_CANDIDATE_IDS = 16;
const MAX_SELECTED_CANDIDATE_IDS = MULTIMODAL_MAX_SELECTED_CANDIDATE_IDS;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export const MULTIMODAL_PRIMARY_SOURCE_KINDS = ['video', 'audio'] as const;
export const MULTIMODAL_EVIDENCE_KINDS = [
  'transcript',
  'audio_segment',
  'frame',
] as const;
export const MULTIMODAL_CLAIM_TYPES = [
  'sourceFact',
  'modelInference',
  'userInput',
] as const;
export const MULTIMODAL_TRANSCRIPT_STATUSES = [
  'pending',
  'ready',
  'low_confidence',
  'failed',
  'not_applicable',
] as const;
export const MULTIMODAL_SEMANTIC_MOMENT_TYPES = [
  'concept',
  'step',
  'worked_example',
  'counterexample',
  'demonstration',
  'limitation',
  'summary',
] as const;
export const MULTIMODAL_FRAME_SOURCE_SIGNALS = [
  'semantic_moment',
  'slow_visual_change',
  'transcript_visual_cue',
  'scene_change',
  'periodic_fallback',
] as const;
export const MULTIMODAL_UPLOAD_MODES = ['single_put', 'multipart'] as const;
export const MULTIMODAL_UPLOAD_MATERIAL_STATUSES = [
  'uploading',
  'verifying',
] as const;
export const MEDIA_JOB_TYPES = [
  'media_prepare',
  'transcribe',
  'frame_materialize',
  'media_quality_check',
] as const;
export const MEDIA_JOB_STATUSES = [
  'queued',
  'leased',
  'succeeded',
  'failed',
  'cancelled',
] as const;
export const MEDIA_STAGES = [
  'draft',
  'uploading',
  'ready_to_process',
  'preparing_media',
  'transcribing',
  'reviewing_transcript',
  'building_semantic_windows',
  'building_evidence',
  'building_adler',
  'awaiting_adler_overview',
  'extracting_candidates',
  'validating_candidates',
  'awaiting_candidates',
  'building_skills',
  'arena_testing',
  'ready_to_publish',
  'publishing',
  'published',
  'failed',
  'cancelled',
] as const;
export const MEDIA_CONFIRMATION_STAGES = [
  'adler_overview',
  'evidence_and_candidates',
  'publish',
] as const;
export const CANDIDATE_PASS_KEYS = [
  'frameworks',
  'principles',
  'cases',
  'counterexamples',
  'terms',
] as const;
// 融合主题通道：由 LLM 把同主题的原子候选合并为更少、更完整的候选，作为面向用户的默认选择集合。
export const CANDIDATE_FUSED_PASS_KEY = 'fused' as const;
export const CANDIDATE_ALL_PASS_KEYS = [
  ...CANDIDATE_PASS_KEYS,
  CANDIDATE_FUSED_PASS_KEY,
] as const;

export type MultimodalPrimarySourceKind =
  (typeof MULTIMODAL_PRIMARY_SOURCE_KINDS)[number];
export type MultimodalEvidenceKind = (typeof MULTIMODAL_EVIDENCE_KINDS)[number];
export type MultimodalClaimType = (typeof MULTIMODAL_CLAIM_TYPES)[number];
export type MultimodalTranscriptStatus =
  (typeof MULTIMODAL_TRANSCRIPT_STATUSES)[number];
export type MultimodalSemanticMomentType =
  (typeof MULTIMODAL_SEMANTIC_MOMENT_TYPES)[number];
export type MultimodalFrameSourceSignal =
  (typeof MULTIMODAL_FRAME_SOURCE_SIGNALS)[number];
export type MultimodalUploadMode = (typeof MULTIMODAL_UPLOAD_MODES)[number];
export type MultimodalUploadMaterialStatus =
  (typeof MULTIMODAL_UPLOAD_MATERIAL_STATUSES)[number];
export type MediaJobType = (typeof MEDIA_JOB_TYPES)[number];
export type MediaJobStatus = (typeof MEDIA_JOB_STATUSES)[number];
export type MediaStage = (typeof MEDIA_STAGES)[number];
export type MediaConfirmationStage = (typeof MEDIA_CONFIRMATION_STAGES)[number];
export type CandidatePassKey = (typeof CANDIDATE_ALL_PASS_KEYS)[number];

export const ADLER_LAYER_KEYS = [
  'structure',
  'interpretation',
  'critique',
  'application',
] as const;
export type AdlerLayerKey = (typeof ADLER_LAYER_KEYS)[number];

export const VALIDATION_CAPABILITIES = ['guide', 'explain', 'predict'] as const;
export type ValidationCapability = (typeof VALIDATION_CAPABILITIES)[number];

export const FAILED_CANDIDATE_DISPOSITIONS = [
  'case',
  'term',
  'reference',
  'discard',
] as const;
export type FailedCandidateDisposition =
  (typeof FAILED_CANDIDATE_DISPOSITIONS)[number];
export type CandidateDisposition = FailedCandidateDisposition | 'retain';

export const RIA_SKILL_RELATION_TYPES = [
  'depends-on',
  'contrasts-with',
  'composes-with',
] as const;
export type RiaSkillRelationType = (typeof RIA_SKILL_RELATION_TYPES)[number];

export const MEDIA_OPERATION_RECEIPT_ACTIONS = [
  'skill.media.upload.confirm',
  'skill.media.transcript.update',
  'skill.media.evidence.update',
  'skill.media.candidate.update',
  'skill.media.overview.confirm',
  'skill.media.candidate.confirm',
] as const;
export type MediaOperationReceiptAction =
  (typeof MEDIA_OPERATION_RECEIPT_ACTIONS)[number];

export const MEDIA_OPERATION_RECEIPT_STAGES = [
  'uploading',
  'transcript',
  'evidence',
  'candidate',
  'adler_overview',
  'evidence_and_candidates',
] as const;
export type MediaOperationReceiptStage =
  (typeof MEDIA_OPERATION_RECEIPT_STAGES)[number];

export interface MultimodalAssetRef {
  objectKey: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

export interface MultimodalPrimarySource {
  sourceId: string;
  kind: MultimodalPrimarySourceKind;
  assetRef: MultimodalAssetRef;
}

export interface MultimodalEvidenceSource {
  primarySourceId: string;
  relatedAssetRef?: MultimodalAssetRef | null;
}

export interface MultimodalTimeRange {
  startMs: number;
  endMs: number;
}

export interface MultimodalEvidenceProvenance {
  method: string;
  processorVersion: string;
  model?: string | null;
  confidence?: number | null;
  editedByUser: boolean;
}

export interface MultimodalEvidence {
  evidenceId: string;
  kind: MultimodalEvidenceKind;
  source: MultimodalEvidenceSource;
  timeRange: MultimodalTimeRange;
  text: string;
  assetRef?: MultimodalAssetRef | null;
  provenance: MultimodalEvidenceProvenance;
  claimType: MultimodalClaimType;
  selectionReason: string;
}

export interface MultimodalTranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
  speaker?: string | null;
  confidence?: number | null;
  editedByUser?: boolean;
  correctedByModel?: boolean;
  revisionNo?: number;
}

export interface MultimodalTranscript {
  status: MultimodalTranscriptStatus;
  editable: true;
  segments: MultimodalTranscriptSegment[];
}

export interface AdlerOverviewStatement {
  text: string;
  evidenceIds: string[];
  claimType: MultimodalClaimType;
}

export interface AdlerOverview {
  structure: AdlerOverviewStatement[];
  interpretation: AdlerOverviewStatement[];
  critique: AdlerOverviewStatement[];
  application: AdlerOverviewStatement[];
}

export interface MultimodalCandidateSuggestion {
  candidateId: string;
  passKey: CandidatePassKey;
  title: string;
  summary: string;
  reusableRule: string;
  evidenceIds: string[];
  claimType: MultimodalClaimType;
  visualAssertion: boolean;
}

export interface MultimodalCandidatePasses {
  frameworks: MultimodalCandidateSuggestion[];
  principles: MultimodalCandidateSuggestion[];
  cases: MultimodalCandidateSuggestion[];
  counterexamples: MultimodalCandidateSuggestion[];
  terms: MultimodalCandidateSuggestion[];
  fused: MultimodalCandidateSuggestion[];
}

export type CandidatePassMeta = Record<
  CandidatePassKey,
  {
    model: string;
    promptVersion: string;
  }
>;

export interface AdlerOverviewResult {
  overview: AdlerOverview;
  meta: {
    model: string;
    promptVersion: string;
    generatorVersion: string;
    degradations: MediaEvidenceDegradation[];
  };
}

export interface AdlerOverviewReview {
  title: string;
  approved: true;
  userNotes: string;
}

export interface CandidateValidationV1 {
  passed: boolean;
  reason: string;
  reusableContexts: string[];
  proofSatisfied: boolean;
}

export interface CandidateValidationV2 {
  passed: boolean;
  reason: string;
  novelScenario: string;
  capability: ValidationCapability;
  proofSatisfied: boolean;
}

export interface CandidateValidationV3 {
  passed: boolean;
  reason: string;
  differentiators: string[];
  proofSatisfied: boolean;
}

export interface CandidateValidationProofs {
  v1: CandidateValidationV1;
  v2: CandidateValidationV2;
  v3: CandidateValidationV3;
}

export interface ValidatedCandidateResult {
  candidate: MultimodalCandidateSuggestion;
  validation: CandidateValidationProofs;
  overallPassed: boolean;
  disposition: CandidateDisposition;
}

export interface RiaSkillDraft {
  candidateId: string;
  id: string;
  dirName: string;
  name: string;
  description: string;
  skillMd: string;
  ria: {
    sourceEvidenceIds: string[];
    mechanism: string;
    sourceExample: string;
    futureApplicability: string;
    execution: {
      input: string;
      steps: string[];
      output: string;
      completionCriteria: string;
      stopCriteria: string;
    };
    boundaries: {
      counterexamples: string[];
      failureModes: string[];
      limits: string[];
      confusions: string[];
    };
  };
  evidenceIds: string[];
  relations: Array<{
    type: RiaSkillRelationType;
    targetSkillId: string;
  }>;
  manifest: {
    model: string;
    promptVersion: string;
    generatorVersion: string;
  };
}

export interface MediaOperationReceipt {
  action: MediaOperationReceiptAction;
  idempotencyKey: string;
  requestHash: string;
  baseRevisionNo: number;
  resultRevisionNo: number;
  confirmedStage: MediaOperationReceiptStage;
  recordedAt: string;
}

export interface PersistedPendingUploadVerification {
  jobId: string;
  idempotencyKey: string;
  requestHash: string;
  observedSizeBytes: number;
  observedContentType: string;
  confirmedAt: string;
}

export interface PublicPendingUploadVerification {
  jobId: string;
  observedSizeBytes: number;
  observedContentType: string;
  confirmedAt: string;
}

interface PersistedPendingUploadBase {
  sourceId: string;
  mediaKind: MultimodalPrimarySourceKind;
  fileName: string;
  declaredMimeType: string;
  sizeBytes: number;
  objectKey: string;
  idempotencyKey: string;
  requestHash: string;
  intentClaimsHash: string;
  intentRevisionNo: number;
  expiresAt: string;
}

interface PublicPendingUploadBase {
  sourceId: string;
  mediaKind: MultimodalPrimarySourceKind;
  fileName: string;
  declaredMimeType: string;
  sizeBytes: number;
}

export interface PersistedUploadingSinglePutPendingUpload extends PersistedPendingUploadBase {
  uploadMode: 'single_put';
  materialStatus: 'uploading';
  verification: null;
}

export interface PersistedVerifyingSinglePutPendingUpload extends PersistedPendingUploadBase {
  uploadMode: 'single_put';
  materialStatus: 'verifying';
  verification: PersistedPendingUploadVerification;
}

interface PersistedMultipartPendingUploadBase extends PersistedPendingUploadBase {
  sourceId: string;
  mediaKind: MultimodalPrimarySourceKind;
  fileName: string;
  declaredMimeType: string;
  sizeBytes: number;
  uploadMode: 'multipart';
  multipartUploadId: string;
  partSizeBytes: number;
  partCount: number;
}

export interface PersistedUploadingMultipartPendingUpload extends PersistedMultipartPendingUploadBase {
  materialStatus: 'uploading';
  verification: null;
}

export interface PersistedVerifyingMultipartPendingUpload extends PersistedMultipartPendingUploadBase {
  materialStatus: 'verifying';
  verification: PersistedPendingUploadVerification;
}

export type PersistedMultimodalPendingUpload =
  | PersistedUploadingSinglePutPendingUpload
  | PersistedVerifyingSinglePutPendingUpload
  | PersistedUploadingMultipartPendingUpload
  | PersistedVerifyingMultipartPendingUpload;

export interface PublicUploadingSinglePutPendingUpload extends PublicPendingUploadBase {
  uploadMode: 'single_put';
  materialStatus: 'uploading';
  expiresAt: string;
}

export interface PublicVerifyingSinglePutPendingUpload extends PublicPendingUploadBase {
  uploadMode: 'single_put';
  materialStatus: 'verifying';
  verification: PublicPendingUploadVerification;
}

interface PublicMultipartPendingUploadBase extends PublicPendingUploadBase {
  uploadMode: 'multipart';
  partSizeBytes: number;
  partCount: number;
}

export interface PublicUploadingMultipartPendingUpload extends PublicMultipartPendingUploadBase {
  materialStatus: 'uploading';
  expiresAt: string;
}

export interface PublicVerifyingMultipartPendingUpload extends PublicMultipartPendingUploadBase {
  materialStatus: 'verifying';
  verification: PublicPendingUploadVerification;
}

export type PublicMultimodalPendingUpload =
  | PublicUploadingSinglePutPendingUpload
  | PublicVerifyingSinglePutPendingUpload
  | PublicUploadingMultipartPendingUpload
  | PublicVerifyingMultipartPendingUpload;

export interface PersistedSinglePutPendingUpload extends PersistedUploadingSinglePutPendingUpload {}

export interface PersistedMultipartPendingUpload extends PersistedUploadingMultipartPendingUpload {}

export interface PublicSinglePutPendingUpload extends PublicUploadingSinglePutPendingUpload {}

export interface PublicMultipartPendingUpload extends PublicUploadingMultipartPendingUpload {}

export interface MultimodalSessionState {
  schemaVersion: 1;
  primarySource?: MultimodalPrimarySource | null;
  pendingUpload: PersistedMultimodalPendingUpload | null;
  transcript: MultimodalTranscript;
  evidenceTimeline: {
    evidenceItems: MultimodalEvidence[];
  };
  candidatePasses: MultimodalCandidatePasses;
  candidatePassMeta: CandidatePassMeta | null;
  semanticMoments: NormalizedSemanticMoment[];
  degradations: MediaEvidenceDegradation[];
  adlerOverview: AdlerOverviewResult | null;
  adlerOverviewReview: AdlerOverviewReview | null;
  selectedCandidateIds: string[];
  candidateValidations: ValidatedCandidateResult[];
  candidateSkills: RiaSkillDraft[];
  operationReceipts: MediaOperationReceipt[];
}

export type PublicMultimodalSessionState = Omit<
  MultimodalSessionState,
  'pendingUpload'
> & {
  pendingUpload: PublicMultimodalPendingUpload | null;
};

export interface MultimodalSemanticMomentEvidenceSnippet {
  timeRange: MultimodalTimeRange;
  text: string;
  confidence?: number | null;
}

export interface SemanticMomentDraft {
  startMs: number;
  endMs: number;
  importance: number;
  type: MultimodalSemanticMomentType;
  summary: string;
  visualTarget?: string | null;
  audioEvidence?: MultimodalSemanticMomentEvidenceSnippet | null;
  transcriptEvidence?: MultimodalSemanticMomentEvidenceSnippet | null;
  selectionReason: string;
}

export interface NormalizedSemanticMoment extends SemanticMomentDraft {
  semanticMomentId: string;
}

export interface MediaEvidenceDegradation {
  code: string;
  message: string;
  semanticMomentId?: string;
}

export interface MediaJobRecord {
  id: string;
  sessionId: string;
  jobType: MediaJobType;
  status: MediaJobStatus;
  idempotencyKey: string;
  requestHash: string;
  attemptNo: number;
  maxAttempts: number;
  progress: Record<string, unknown>;
  inputManifest: Record<string, unknown>;
  outputManifest?: Record<string, unknown> | null;
  resultHash?: string | null;
  error?: Record<string, unknown> | null;
}

function fail(_message?: string): never {
  throw new Error(INVALID_MULTIMODAL_CONTRACT);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    fail(`${path} must be an object`);
  }
  return value;
}

function ensureExactKeys(
  value: Record<string, unknown>,
  path: string,
  allowedKeys: readonly string[],
): void {
  const allowed = new Set(allowedKeys);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    fail(`${path} has unknown or missing fields`);
  }
}

function readString(
  value: unknown,
  path: string,
  maximum = MAX_TEXT_LENGTH,
): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`${path} must be a non-empty string`);
  }
  if (value.length > maximum) {
    fail(`${path} is too long`);
  }
  return value;
}

function readPossiblyEmptyString(
  value: unknown,
  path: string,
  maximum = MAX_TEXT_LENGTH,
): string {
  if (typeof value !== 'string') {
    fail(`${path} must be a string`);
  }
  if (value.length > maximum) {
    fail(`${path} is too long`);
  }
  return value;
}

function readOptionalNullableString(
  value: unknown,
  path: string,
  maximum = MAX_TEXT_LENGTH,
): string | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }
  return readString(value, path, maximum);
}

function readBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    fail(`${path} must be a boolean`);
  }
  return value;
}

function readLiteralTrue(value: unknown, path: string): true {
  if (value !== true) {
    fail(`${path} must be true`);
  }
  return true;
}

function readFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${path} must be a finite number`);
  }
  return value;
}

function readInteger(
  value: unknown,
  path: string,
  options?: { min?: number; max?: number },
): number {
  const numberValue = readFiniteNumber(value, path);
  if (!Number.isInteger(numberValue)) {
    fail(`${path} must be an integer`);
  }
  if (options?.min !== undefined && numberValue < options.min) {
    fail(`${path} must be greater than or equal to ${options.min}`);
  }
  if (options?.max !== undefined && numberValue > options.max) {
    fail(`${path} must be less than or equal to ${options.max}`);
  }
  return numberValue;
}

function readDenseArray(
  value: unknown,
  path: string,
  options?: { minLength?: number; maxLength?: number },
): unknown[] {
  if (!Array.isArray(value)) {
    fail(`${path} must be an array`);
  }
  if (options?.minLength !== undefined && value.length < options.minLength) {
    fail(`${path} is too short`);
  }
  if (options?.maxLength !== undefined && value.length > options.maxLength) {
    fail(`${path} is too long`);
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      fail(`${path} must not be sparse`);
    }
  }
  return value;
}

function readUniqueIdArray(
  value: unknown,
  path: string,
  options?: {
    minLength?: number;
    maxLength?: number;
    allowedIds?: ReadonlySet<string>;
  },
): string[] {
  const items = readDenseArray(value, path, options);
  const seen = new Set<string>();
  return items.map((item, index) => {
    const parsed = readSafeId(item, `${path}[${index}]`);
    if (seen.has(parsed)) {
      fail(`${path}[${index}] must be unique`);
    }
    if (options?.allowedIds && !options.allowedIds.has(parsed)) {
      fail(`${path}[${index}] must reference existing evidence`);
    }
    seen.add(parsed);
    return parsed;
  });
}

function readHexHash(value: unknown, path: string): string {
  const hash = readString(value, path, 64);
  if (!SHA256_HEX.test(hash)) {
    fail(`${path} must be a 64-character lowercase sha256 string`);
  }
  return hash;
}

function readIsoTimestamp(value: unknown, path: string): string {
  const timestamp = readString(value, path, MAX_SHORT_TEXT_LENGTH);
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== timestamp) {
    fail(`${path} must be a strict ISO-8601 timestamp`);
  }
  return timestamp;
}

function readOptionalConfidence(
  value: unknown,
  path: string,
): number | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }
  const confidence = readFiniteNumber(value, path);
  if (confidence < 0 || confidence > 1) {
    fail(`${path} must be between 0 and 1`);
  }
  return confidence;
}

function readEnumValue<const T extends readonly string[]>(
  value: unknown,
  path: string,
  allowed: T,
): T[number] {
  const stringValue = readString(value, path, MAX_SHORT_TEXT_LENGTH);
  if (!allowed.includes(stringValue)) {
    fail(`${path} must be one of ${allowed.join(', ')}`);
  }
  return stringValue as T[number];
}

function readSafeId(value: unknown, path: string): string {
  const text = readString(value, path, 128);
  if (!SAFE_ID.test(text)) {
    fail(`${path} is invalid`);
  }
  return text;
}

function readIdempotencyKey(value: unknown, path: string): string {
  const text = readString(value, path, 128);
  if (!IDEMPOTENCY_KEY.test(text)) {
    fail(`${path} is invalid`);
  }
  return text;
}

function normalizeTextKey(value: string): string {
  return value.trim().toLowerCase();
}

function readObjectKey(value: unknown, path: string): string {
  const text = readString(value, path, MAX_TEXT_LENGTH);
  if (text.trim() !== text || !OBJECT_KEY.test(text)) {
    fail(`${path} is invalid`);
  }
  return text;
}

function readNormalizedMimeType(value: unknown, path: string): string {
  const mimeType = readString(value, path, MAX_SHORT_TEXT_LENGTH);
  const normalized = normalizeTextKey(mimeType);
  if (normalized.length === 0) {
    fail(`${path} must be a non-empty string`);
  }
  return normalized;
}

export function parseAssetRef(
  value: unknown,
  path = 'assetRef',
): MultimodalAssetRef {
  const record = readRecord(value, path);
  ensureExactKeys(record, path, [
    'objectKey',
    'mimeType',
    'sizeBytes',
    'sha256',
  ]);
  return {
    objectKey: readObjectKey(record.objectKey, `${path}.objectKey`),
    mimeType: readString(
      record.mimeType,
      `${path}.mimeType`,
      MAX_SHORT_TEXT_LENGTH,
    ),
    sizeBytes: readInteger(record.sizeBytes, `${path}.sizeBytes`, {
      min: 0,
      max: MAX_SAFE_INTEGER,
    }),
    sha256: readHexHash(record.sha256, `${path}.sha256`),
  };
}

export function parseMultimodalPrimarySource(
  value: unknown,
  path = 'primarySource',
): MultimodalPrimarySource | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    fail(`${path} must be a single object or null`);
  }
  const record = readRecord(value, path);
  ensureExactKeys(record, path, ['sourceId', 'kind', 'assetRef']);
  const kind = readEnumValue(
    record.kind,
    `${path}.kind`,
    MULTIMODAL_PRIMARY_SOURCE_KINDS,
  );
  const assetRef = parseAssetRef(record.assetRef, `${path}.assetRef`);
  if (assetRef.sizeBytes < 1) {
    fail(`${path}.assetRef.sizeBytes must be greater than or equal to 1`);
  }
  if (
    (kind === 'audio' && !assetRef.mimeType.startsWith('audio/')) ||
    (kind === 'video' && !assetRef.mimeType.startsWith('video/'))
  ) {
    fail(`${path}.assetRef.mimeType is invalid for ${kind}`);
  }
  return {
    sourceId: readSafeId(record.sourceId, `${path}.sourceId`),
    kind,
    assetRef,
  };
}

function validateRangeBounds(
  startMs: number,
  endMs: number,
  path: string,
  options?: { durationMs?: number },
): void {
  if (endMs <= startMs) {
    fail(`${path}.endMs must be greater than ${path}.startMs`);
  }
  if (options?.durationMs !== undefined && endMs > options.durationMs) {
    fail(`${path}.endMs must be less than or equal to durationMs`);
  }
}

export function parseTimeRange(
  value: unknown,
  path = 'timeRange',
): MultimodalTimeRange {
  const record = readRecord(value, path);
  ensureExactKeys(record, path, ['startMs', 'endMs']);
  const startMs = readInteger(record.startMs, `${path}.startMs`, {
    min: 0,
    max: MAX_SAFE_INTEGER,
  });
  const endMs = readInteger(record.endMs, `${path}.endMs`, {
    min: 0,
    max: MAX_SAFE_INTEGER,
  });
  validateRangeBounds(startMs, endMs, path);
  return { startMs, endMs };
}

function parseEvidenceSource(
  value: unknown,
  path: string,
): MultimodalEvidenceSource {
  const record = readRecord(value, path);
  ensureExactKeys(record, path, ['primarySourceId', 'relatedAssetRef']);
  const relatedAssetRef =
    record.relatedAssetRef === undefined || record.relatedAssetRef === null
      ? (record.relatedAssetRef ?? undefined)
      : parseAssetRef(record.relatedAssetRef, `${path}.relatedAssetRef`);
  return {
    primarySourceId: readSafeId(
      record.primarySourceId,
      `${path}.primarySourceId`,
    ),
    relatedAssetRef,
  };
}

function parseEvidenceProvenance(
  value: unknown,
  path: string,
): MultimodalEvidenceProvenance {
  const record = readRecord(value, path);
  ensureExactKeys(record, path, [
    'method',
    'processorVersion',
    'model',
    'confidence',
    'editedByUser',
  ]);
  return {
    method: readString(record.method, `${path}.method`, MAX_SHORT_TEXT_LENGTH),
    processorVersion: readString(
      record.processorVersion,
      `${path}.processorVersion`,
      MAX_SHORT_TEXT_LENGTH,
    ),
    model: readOptionalNullableString(
      record.model,
      `${path}.model`,
      MAX_SHORT_TEXT_LENGTH,
    ),
    confidence: readOptionalConfidence(record.confidence, `${path}.confidence`),
    editedByUser: readBoolean(record.editedByUser, `${path}.editedByUser`),
  };
}

export function parseEvidenceCard(value: unknown): MultimodalEvidence {
  const path = 'multimodalSessionState.evidenceTimeline.evidenceItems[]';
  const record = readRecord(value, path);
  ensureExactKeys(record, path, [
    'evidenceId',
    'kind',
    'source',
    'timeRange',
    'text',
    'assetRef',
    'provenance',
    'claimType',
    'selectionReason',
  ]);
  const kind = readEnumValue(
    record.kind,
    `${path}.kind`,
    MULTIMODAL_EVIDENCE_KINDS,
  );
  const assetRef =
    record.assetRef === undefined || record.assetRef === null
      ? (record.assetRef ?? undefined)
      : parseAssetRef(record.assetRef, `${path}.assetRef`);
  if ((kind === 'audio_segment' || kind === 'frame') && assetRef == null) {
    fail(`${path}.assetRef is required for ${kind}`);
  }
  if (assetRef != null && assetRef.sizeBytes < 1) {
    fail(`${path}.assetRef.sizeBytes must be greater than or equal to 1`);
  }
  return {
    evidenceId: readSafeId(record.evidenceId, `${path}.evidenceId`),
    kind,
    source: parseEvidenceSource(record.source, `${path}.source`),
    timeRange: parseTimeRange(record.timeRange, `${path}.timeRange`),
    text: readString(record.text, `${path}.text`, MAX_TEXT_LENGTH),
    assetRef,
    provenance: parseEvidenceProvenance(
      record.provenance,
      `${path}.provenance`,
    ),
    claimType: readEnumValue(
      record.claimType,
      `${path}.claimType`,
      MULTIMODAL_CLAIM_TYPES,
    ),
    selectionReason: readString(
      record.selectionReason,
      `${path}.selectionReason`,
      MAX_SHORT_TEXT_LENGTH,
    ),
  };
}

function parseTranscriptSegment(
  value: unknown,
  path: string,
): MultimodalTranscriptSegment {
  const record = readRecord(value, path);
  ensureExactKeys(record, path, [
    'startMs',
    'endMs',
    'text',
    'speaker',
    'confidence',
    'editedByUser',
    'correctedByModel',
    'revisionNo',
  ]);
  const startMs = readInteger(record.startMs, `${path}.startMs`, {
    min: 0,
    max: MAX_SAFE_INTEGER,
  });
  const endMs = readInteger(record.endMs, `${path}.endMs`, {
    min: 0,
    max: MAX_SAFE_INTEGER,
  });
  validateRangeBounds(startMs, endMs, path);
  return {
    startMs,
    endMs,
    text: readString(record.text, `${path}.text`, MAX_TEXT_LENGTH),
    speaker: readOptionalNullableString(
      record.speaker,
      `${path}.speaker`,
      MAX_SHORT_TEXT_LENGTH,
    ),
    confidence: readOptionalConfidence(record.confidence, `${path}.confidence`),
    editedByUser:
      record.editedByUser === undefined
        ? undefined
        : readBoolean(record.editedByUser, `${path}.editedByUser`),
    correctedByModel:
      record.correctedByModel === undefined
        ? undefined
        : readBoolean(record.correctedByModel, `${path}.correctedByModel`),
    revisionNo:
      record.revisionNo === undefined
        ? undefined
        : readInteger(record.revisionNo, `${path}.revisionNo`, {
            min: 0,
            max: MAX_SAFE_INTEGER,
          }),
  };
}

export function parseMultimodalTranscript(
  value: unknown,
  path = 'transcript',
  options?: { durationMs?: number; maxSegments?: number },
): MultimodalTranscript {
  const record = readRecord(value, path);
  ensureExactKeys(record, path, ['status', 'editable', 'segments']);
  const segments = readDenseArray(record.segments, `${path}.segments`, {
    maxLength: options?.maxSegments ?? MAX_TRANSCRIPT_SEGMENTS,
  }).map((segment, index) =>
    parseTranscriptSegment(segment, `${path}.segments[${index}]`),
  );
  if (options?.durationMs !== undefined) {
    for (const [index, segment] of segments.entries()) {
      validateRangeBounds(
        segment.startMs,
        segment.endMs,
        `${path}.segments[${index}]`,
        {
          durationMs: readDurationMs(options.durationMs),
        },
      );
    }
  }
  return {
    status: readEnumValue(
      record.status,
      `${path}.status`,
      MULTIMODAL_TRANSCRIPT_STATUSES,
    ),
    editable: readLiteralTrue(record.editable, `${path}.editable`),
    segments,
  };
}

function parseCandidateSuggestion(
  candidate: unknown,
  candidatePath: string,
  options: {
    expectedPassKey?: CandidatePassKey;
    seenCandidateIds?: Set<string>;
    evidenceIds?: ReadonlySet<string>;
    frameEvidenceIds?: ReadonlySet<string>;
    sourceFactEligibleEvidenceIds?: ReadonlySet<string>;
  },
): MultimodalCandidateSuggestion {
  const candidateRecord = readRecord(candidate, candidatePath);
  ensureExactKeys(candidateRecord, candidatePath, [
    'candidateId',
    'passKey',
    'title',
    'summary',
    'reusableRule',
    'evidenceIds',
    'claimType',
    'visualAssertion',
  ]);
  const candidateId = readSafeId(
    candidateRecord.candidateId,
    `${candidatePath}.candidateId`,
  );
  if (options.seenCandidateIds?.has(candidateId)) {
    fail(`${candidatePath}.candidateId must be unique`);
  }
  const passKey = readEnumValue(
    candidateRecord.passKey,
    `${candidatePath}.passKey`,
    CANDIDATE_ALL_PASS_KEYS,
  );
  if (
    options.expectedPassKey !== undefined &&
    passKey !== options.expectedPassKey
  ) {
    fail(`${candidatePath}.passKey must equal ${options.expectedPassKey}`);
  }
  const evidenceIds = readUniqueIdArray(
    candidateRecord.evidenceIds,
    `${candidatePath}.evidenceIds`,
    {
      minLength: 1,
      maxLength: MAX_CANDIDATE_EVIDENCE_IDS,
      allowedIds: options.evidenceIds,
    },
  );
  const claimType = readEnumValue(
    candidateRecord.claimType,
    `${candidatePath}.claimType`,
    MULTIMODAL_CLAIM_TYPES,
  );
  if (
    claimType === 'sourceFact' &&
    options.sourceFactEligibleEvidenceIds !== undefined &&
    evidenceIds.some(
      (evidenceId) => !options.sourceFactEligibleEvidenceIds?.has(evidenceId),
    )
  ) {
    fail(`${candidatePath}.claimType cannot use non-eligible source evidence`);
  }
  const visualAssertion = readBoolean(
    candidateRecord.visualAssertion,
    `${candidatePath}.visualAssertion`,
  );
  if (
    visualAssertion &&
    evidenceIds.every(
      (evidenceId) => !options.frameEvidenceIds?.has(evidenceId),
    )
  ) {
    fail(`${candidatePath}.visualAssertion requires frame evidence`);
  }
  options.seenCandidateIds?.add(candidateId);
  return {
    candidateId,
    passKey,
    title: readString(
      candidateRecord.title,
      `${candidatePath}.title`,
      MAX_SHORT_TEXT_LENGTH,
    ),
    summary: readString(
      candidateRecord.summary,
      `${candidatePath}.summary`,
      MAX_SHORT_TEXT_LENGTH,
    ),
    reusableRule: readString(
      candidateRecord.reusableRule,
      `${candidatePath}.reusableRule`,
      MAX_SHORT_TEXT_LENGTH,
    ),
    evidenceIds,
    claimType,
    visualAssertion,
  };
}

function parseCandidatePasses(
  value: unknown,
  options?: {
    path?: string;
    evidenceIds?: readonly string[];
    frameEvidenceIds?: readonly string[];
    sourceFactEligibleEvidenceIds?: readonly string[];
  },
): MultimodalCandidatePasses {
  const path = options?.path ?? 'candidatePasses';
  const record = readRecord(value, path);
  const keys = Object.keys(record).sort();
  const required: string[] = [...CANDIDATE_PASS_KEYS].sort();
  // 兼容旧数据：5 个原子通道必须存在，融合通道 fused 可缺省（缺省视为空）。
  const allowed: string[] = [...CANDIDATE_ALL_PASS_KEYS].sort();
  if (
    keys.some((key) => !allowed.includes(key)) ||
    required.some((key) => !keys.includes(key))
  ) {
    fail(`${path} must contain exactly ${allowed.join(', ')}`);
  }
  const allowedEvidenceIds = options?.evidenceIds
    ? new Set(options.evidenceIds)
    : undefined;
  const frameEvidenceIds = new Set(options?.frameEvidenceIds ?? []);
  const sourceFactEligibleEvidenceIds = options?.sourceFactEligibleEvidenceIds
    ? new Set(options.sourceFactEligibleEvidenceIds)
    : undefined;
  const seenCandidateIds = new Set<string>();

  return {
    frameworks: readDenseArray(record.frameworks, `${path}.frameworks`, {
      maxLength: MAX_CANDIDATES_PER_PASS,
    }).map((candidate, index) =>
      parseCandidateSuggestion(candidate, `${path}.frameworks[${index}]`, {
        expectedPassKey: 'frameworks',
        seenCandidateIds,
        evidenceIds: allowedEvidenceIds,
        frameEvidenceIds,
        sourceFactEligibleEvidenceIds,
      }),
    ),
    principles: readDenseArray(record.principles, `${path}.principles`, {
      maxLength: MAX_CANDIDATES_PER_PASS,
    }).map((candidate, index) =>
      parseCandidateSuggestion(candidate, `${path}.principles[${index}]`, {
        expectedPassKey: 'principles',
        seenCandidateIds,
        evidenceIds: allowedEvidenceIds,
        frameEvidenceIds,
        sourceFactEligibleEvidenceIds,
      }),
    ),
    cases: readDenseArray(record.cases, `${path}.cases`, {
      maxLength: MAX_CANDIDATES_PER_PASS,
    }).map((candidate, index) =>
      parseCandidateSuggestion(candidate, `${path}.cases[${index}]`, {
        expectedPassKey: 'cases',
        seenCandidateIds,
        evidenceIds: allowedEvidenceIds,
        frameEvidenceIds,
        sourceFactEligibleEvidenceIds,
      }),
    ),
    counterexamples: readDenseArray(
      record.counterexamples,
      `${path}.counterexamples`,
      {
        maxLength: MAX_CANDIDATES_PER_PASS,
      },
    ).map((candidate, index) =>
      parseCandidateSuggestion(candidate, `${path}.counterexamples[${index}]`, {
        expectedPassKey: 'counterexamples',
        seenCandidateIds,
        evidenceIds: allowedEvidenceIds,
        frameEvidenceIds,
        sourceFactEligibleEvidenceIds,
      }),
    ),
    terms: readDenseArray(record.terms, `${path}.terms`, {
      maxLength: MAX_CANDIDATES_PER_PASS,
    }).map((candidate, index) =>
      parseCandidateSuggestion(candidate, `${path}.terms[${index}]`, {
        expectedPassKey: 'terms',
        seenCandidateIds,
        evidenceIds: allowedEvidenceIds,
        frameEvidenceIds,
        sourceFactEligibleEvidenceIds,
      }),
    ),
    fused:
      record.fused === undefined
        ? []
        : readDenseArray(record.fused, `${path}.fused`, {
            maxLength: MAX_CANDIDATES_PER_PASS,
          }).map((candidate, index) =>
            parseCandidateSuggestion(candidate, `${path}.fused[${index}]`, {
              expectedPassKey: CANDIDATE_FUSED_PASS_KEY,
              seenCandidateIds,
              evidenceIds: allowedEvidenceIds,
              frameEvidenceIds,
              sourceFactEligibleEvidenceIds,
            }),
          ),
  };
}

export { parseCandidatePasses };

function readMetaField(
  value: unknown,
  path: string,
  allowEmpty: boolean,
): string {
  if (typeof value !== 'string') {
    fail(`${path} must be a string`);
  }
  if (!allowEmpty && value.trim().length === 0) {
    fail(`${path} must be a non-empty string`);
  }
  if (value.length > 200) {
    fail(`${path} is too long`);
  }
  return value;
}

function parseCandidatePassMetaEntry(
  value: unknown,
  path: string,
  allowEmpty: boolean,
): CandidatePassMeta[CandidatePassKey] {
  const record = readRecord(value, path);
  ensureExactKeys(record, path, ['model', 'promptVersion']);
  return {
    model: readMetaField(record.model, `${path}.model`, allowEmpty),
    promptVersion: readMetaField(
      record.promptVersion,
      `${path}.promptVersion`,
      allowEmpty,
    ),
  };
}

export function parseCandidatePassMeta(
  value: unknown,
  path = 'candidatePassMeta',
): CandidatePassMeta {
  const record = readRecord(value, path);
  const keys = Object.keys(record).sort();
  const allowed: string[] = [...CANDIDATE_ALL_PASS_KEYS].sort();
  // 兼容旧数据：5 个原子通道必须存在，融合通道 fused 可缺省（缺省视为空）。
  const required: string[] = [...CANDIDATE_PASS_KEYS].sort();
  if (
    keys.some((key) => !allowed.includes(key)) ||
    required.some((key) => !keys.includes(key))
  ) {
    fail(`${path} must contain exactly ${allowed.join(', ')}`);
  }
  return {
    frameworks: parseCandidatePassMetaEntry(
      record.frameworks,
      `${path}.frameworks`,
      false,
    ),
    principles: parseCandidatePassMetaEntry(
      record.principles,
      `${path}.principles`,
      false,
    ),
    cases: parseCandidatePassMetaEntry(record.cases, `${path}.cases`, false),
    counterexamples: parseCandidatePassMetaEntry(
      record.counterexamples,
      `${path}.counterexamples`,
      false,
    ),
    terms: parseCandidatePassMetaEntry(record.terms, `${path}.terms`, false),
    fused:
      record.fused === undefined
        ? { model: '', promptVersion: '' }
        : parseCandidatePassMetaEntry(record.fused, `${path}.fused`, true),
  };
}

export function parseAdlerOverview(
  value: unknown,
  options: {
    evidenceIds: readonly string[];
    sourceFactEligibleEvidenceIds?: readonly string[];
  },
): AdlerOverview {
  const path = 'adlerOverview';
  const record = readRecord(value, path);
  ensureExactKeys(record, path, ADLER_LAYER_KEYS);
  const allowedEvidenceIds = new Set(options.evidenceIds);
  const sourceFactEligibleEvidenceIds = options.sourceFactEligibleEvidenceIds
    ? new Set(options.sourceFactEligibleEvidenceIds)
    : undefined;

  const parseStatement = (
    statement: unknown,
    statementPath: string,
  ): AdlerOverviewStatement => {
    const statementRecord = readRecord(statement, statementPath);
    ensureExactKeys(statementRecord, statementPath, [
      'text',
      'evidenceIds',
      'claimType',
    ]);
    const evidenceIds = readUniqueIdArray(
      statementRecord.evidenceIds,
      `${statementPath}.evidenceIds`,
      {
        minLength: 1,
        maxLength: MAX_CANDIDATE_EVIDENCE_IDS,
        allowedIds: allowedEvidenceIds,
      },
    );
    const claimType = readEnumValue(
      statementRecord.claimType,
      `${statementPath}.claimType`,
      MULTIMODAL_CLAIM_TYPES,
    );
    if (
      claimType === 'sourceFact' &&
      sourceFactEligibleEvidenceIds !== undefined &&
      evidenceIds.some(
        (evidenceId) => !sourceFactEligibleEvidenceIds.has(evidenceId),
      )
    ) {
      fail(
        `${statementPath}.claimType cannot use non-eligible source evidence`,
      );
    }
    return {
      text: readString(
        statementRecord.text,
        `${statementPath}.text`,
        MAX_TEXT_LENGTH,
      ),
      evidenceIds,
      claimType,
    };
  };

  const parseLayer = (
    layerValue: unknown,
    layerPath: string,
  ): AdlerOverviewStatement[] =>
    readDenseArray(layerValue, layerPath, {
      maxLength: MAX_ADLER_STATEMENTS_PER_LAYER,
    }).map((statement, index) =>
      parseStatement(statement, `${layerPath}[${index}]`),
    );

  return {
    structure: parseLayer(record.structure, `${path}.structure`),
    interpretation: parseLayer(record.interpretation, `${path}.interpretation`),
    critique: parseLayer(record.critique, `${path}.critique`),
    application: parseLayer(record.application, `${path}.application`),
  };
}

function sameStringArray(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sameCandidateSuggestion(
  left: MultimodalCandidateSuggestion,
  right: MultimodalCandidateSuggestion,
): boolean {
  return (
    left.candidateId === right.candidateId &&
    left.passKey === right.passKey &&
    left.title === right.title &&
    left.summary === right.summary &&
    left.reusableRule === right.reusableRule &&
    left.claimType === right.claimType &&
    left.visualAssertion === right.visualAssertion &&
    sameStringArray(left.evidenceIds, right.evidenceIds)
  );
}

function computeV1ProofSatisfied(reusableContexts: readonly string[]): boolean {
  if (reusableContexts.length < 2) {
    return false;
  }
  return new Set(reusableContexts.map(normalizeTextKey)).size >= 2;
}

function computeV2ProofSatisfied(novelScenario: string): boolean {
  return novelScenario.trim().length > 0;
}

function computeV3ProofSatisfied(differentiators: readonly string[]): boolean {
  return differentiators.length >= 1;
}

function parseCandidateValidationV1(
  value: unknown,
  path: string,
): CandidateValidationV1 {
  const record = readRecord(value, path);
  ensureExactKeys(record, path, [
    'passed',
    'reason',
    'reusableContexts',
    'proofSatisfied',
  ]);
  const reusableContexts = readDenseArray(
    record.reusableContexts,
    `${path}.reusableContexts`,
    { minLength: 0, maxLength: MAX_REUSABLE_CONTEXTS },
  ).map((item, index) =>
    readString(
      item,
      `${path}.reusableContexts[${index}]`,
      MAX_SHORT_TEXT_LENGTH,
    ),
  );
  const computedProofSatisfied = computeV1ProofSatisfied(reusableContexts);
  const proofSatisfied = readBoolean(
    record.proofSatisfied,
    `${path}.proofSatisfied`,
  );
  if (proofSatisfied !== computedProofSatisfied) {
    fail(`${path}.proofSatisfied is inconsistent`);
  }
  return {
    passed: readBoolean(record.passed, `${path}.passed`),
    reason: readString(record.reason, `${path}.reason`, MAX_SHORT_TEXT_LENGTH),
    reusableContexts,
    proofSatisfied,
  };
}

function parseCandidateValidationV2(
  value: unknown,
  path: string,
): CandidateValidationV2 {
  const record = readRecord(value, path);
  ensureExactKeys(record, path, [
    'passed',
    'reason',
    'novelScenario',
    'capability',
    'proofSatisfied',
  ]);
  const novelScenario = readString(
    record.novelScenario,
    `${path}.novelScenario`,
    MAX_SHORT_TEXT_LENGTH,
  );
  const computedProofSatisfied = computeV2ProofSatisfied(novelScenario);
  const proofSatisfied = readBoolean(
    record.proofSatisfied,
    `${path}.proofSatisfied`,
  );
  if (proofSatisfied !== computedProofSatisfied) {
    fail(`${path}.proofSatisfied is inconsistent`);
  }
  return {
    passed: readBoolean(record.passed, `${path}.passed`),
    reason: readString(record.reason, `${path}.reason`, MAX_SHORT_TEXT_LENGTH),
    novelScenario,
    capability: readEnumValue(
      record.capability,
      `${path}.capability`,
      VALIDATION_CAPABILITIES,
    ),
    proofSatisfied,
  };
}

function parseCandidateValidationV3(
  value: unknown,
  path: string,
): CandidateValidationV3 {
  const record = readRecord(value, path);
  ensureExactKeys(record, path, [
    'passed',
    'reason',
    'differentiators',
    'proofSatisfied',
  ]);
  const differentiators = readDenseArray(
    record.differentiators,
    `${path}.differentiators`,
    { minLength: 0, maxLength: MAX_DIFFERENTIATORS },
  ).map((item, index) =>
    readString(
      item,
      `${path}.differentiators[${index}]`,
      MAX_SHORT_TEXT_LENGTH,
    ),
  );
  const computedProofSatisfied = computeV3ProofSatisfied(differentiators);
  const proofSatisfied = readBoolean(
    record.proofSatisfied,
    `${path}.proofSatisfied`,
  );
  if (proofSatisfied !== computedProofSatisfied) {
    fail(`${path}.proofSatisfied is inconsistent`);
  }
  return {
    passed: readBoolean(record.passed, `${path}.passed`),
    reason: readString(record.reason, `${path}.reason`, MAX_SHORT_TEXT_LENGTH),
    differentiators,
    proofSatisfied,
  };
}

export function parseAdlerOverviewResult(
  value: unknown,
  options: {
    evidenceIds: readonly string[];
    sourceFactEligibleEvidenceIds?: readonly string[];
  },
  path = 'adlerOverview',
): AdlerOverviewResult {
  const record = readRecord(value, path);
  ensureExactKeys(record, path, ['overview', 'meta']);
  const metaRecord = readRecord(record.meta, `${path}.meta`);
  ensureExactKeys(metaRecord, `${path}.meta`, [
    'model',
    'promptVersion',
    'generatorVersion',
    'degradations',
  ]);
  return {
    overview: parseAdlerOverview(record.overview, {
      evidenceIds: options.evidenceIds,
      sourceFactEligibleEvidenceIds: options.sourceFactEligibleEvidenceIds,
    }),
    meta: {
      model: readString(
        metaRecord.model,
        `${path}.meta.model`,
        MAX_SHORT_TEXT_LENGTH,
      ),
      promptVersion: readString(
        metaRecord.promptVersion,
        `${path}.meta.promptVersion`,
        MAX_SHORT_TEXT_LENGTH,
      ),
      generatorVersion: readString(
        metaRecord.generatorVersion,
        `${path}.meta.generatorVersion`,
        MAX_SHORT_TEXT_LENGTH,
      ),
      degradations: parseMediaEvidenceDegradations(
        metaRecord.degradations,
        `${path}.meta.degradations`,
      ),
    },
  };
}

export function parseValidatedCandidateResults(
  value: unknown,
  options: {
    candidatePasses?: MultimodalCandidatePasses;
    evidenceIds: readonly string[];
    frameEvidenceIds?: readonly string[];
    sourceFactEligibleEvidenceIds?: readonly string[];
  },
  path = 'candidateValidations',
): ValidatedCandidateResult[] {
  const candidateById = new Map<string, MultimodalCandidateSuggestion>();
  if (options.candidatePasses !== undefined) {
    for (const passKey of CANDIDATE_ALL_PASS_KEYS) {
      for (const candidate of options.candidatePasses[passKey]) {
        candidateById.set(candidate.candidateId, candidate);
      }
    }
  }
  const seenCandidateIds = new Set<string>();
  return readDenseArray(value, path, {
    maxLength: MAX_VALIDATED_CANDIDATES,
  }).map((item, index) => {
    const itemPath = `${path}[${index}]`;
    const record = readRecord(item, itemPath);
    ensureExactKeys(record, itemPath, [
      'candidate',
      'validation',
      'overallPassed',
      'disposition',
    ]);
    const candidate = parseCandidateSuggestion(
      record.candidate,
      `${itemPath}.candidate`,
      {
        seenCandidateIds,
        evidenceIds: new Set(options.evidenceIds),
        frameEvidenceIds: new Set(options.frameEvidenceIds ?? []),
        sourceFactEligibleEvidenceIds: options.sourceFactEligibleEvidenceIds
          ? new Set(options.sourceFactEligibleEvidenceIds)
          : undefined,
      },
    );
    const expectedCandidate = candidateById.get(candidate.candidateId);
    if (
      options.candidatePasses !== undefined &&
      (!expectedCandidate ||
        !sameCandidateSuggestion(candidate, expectedCandidate))
    ) {
      fail(`${itemPath}.candidate must match candidatePasses`);
    }
    const validationRecord = readRecord(
      record.validation,
      `${itemPath}.validation`,
    );
    ensureExactKeys(validationRecord, `${itemPath}.validation`, [
      'v1',
      'v2',
      'v3',
    ]);
    const validation = {
      v1: parseCandidateValidationV1(
        validationRecord.v1,
        `${itemPath}.validation.v1`,
      ),
      v2: parseCandidateValidationV2(
        validationRecord.v2,
        `${itemPath}.validation.v2`,
      ),
      v3: parseCandidateValidationV3(
        validationRecord.v3,
        `${itemPath}.validation.v3`,
      ),
    };
    const computedOverallPassed =
      validation.v1.passed &&
      validation.v1.proofSatisfied &&
      validation.v2.passed &&
      validation.v2.proofSatisfied &&
      validation.v3.passed &&
      validation.v3.proofSatisfied;
    const overallPassed = readBoolean(
      record.overallPassed,
      `${itemPath}.overallPassed`,
    );
    if (overallPassed !== computedOverallPassed) {
      fail(`${itemPath}.overallPassed is inconsistent`);
    }
    const disposition = readString(
      record.disposition,
      `${itemPath}.disposition`,
      MAX_SHORT_TEXT_LENGTH,
    );
    if (overallPassed) {
      if (disposition !== 'retain') {
        fail(`${itemPath}.disposition must be retain for passing candidates`);
      }
    } else if (
      !FAILED_CANDIDATE_DISPOSITIONS.includes(
        disposition as FailedCandidateDisposition,
      )
    ) {
      fail(`${itemPath}.disposition must be a valid downgrade`);
    }
    return {
      candidate,
      validation,
      overallPassed,
      disposition: disposition as CandidateDisposition,
    };
  });
}

export function parseRiaSkillDrafts(
  value: unknown,
  options: {
    validatedCandidates: readonly ValidatedCandidateResult[];
    evidenceIds: readonly string[];
  },
  path = 'candidateSkills',
): RiaSkillDraft[] {
  const eligibleCandidates = new Map<string, ValidatedCandidateResult>();
  for (const result of options.validatedCandidates) {
    if (result.overallPassed && result.disposition === 'retain') {
      eligibleCandidates.set(result.candidate.candidateId, result);
    }
  }
  const allowedEvidenceIds = new Set(options.evidenceIds);
  const seenCandidateIds = new Set<string>();
  const seenSkillIds = new Set<string>();
  const seenDirNames = new Set<string>();

  const skills = readDenseArray(value, path, {
    maxLength: MAX_RIA_SKILL_DRAFTS,
  }).map((item, index) => {
    const itemPath = `${path}[${index}]`;
    const record = readRecord(item, itemPath);
    ensureExactKeys(record, itemPath, [
      'candidateId',
      'id',
      'dirName',
      'name',
      'description',
      'skillMd',
      'ria',
      'evidenceIds',
      'relations',
      'manifest',
    ]);
    const candidateId = readSafeId(
      record.candidateId,
      `${itemPath}.candidateId`,
    );
    const candidateResult = eligibleCandidates.get(candidateId);
    if (!candidateResult || seenCandidateIds.has(candidateId)) {
      fail(
        `${itemPath}.candidateId must reference a retained validated candidate`,
      );
    }
    seenCandidateIds.add(candidateId);

    const skillId = readSafeId(record.id, `${itemPath}.id`);
    if (seenSkillIds.has(skillId)) {
      fail(`${itemPath}.id must be unique`);
    }
    seenSkillIds.add(skillId);

    const dirName = readString(record.dirName, `${itemPath}.dirName`, 128);
    if (
      !/^[a-z0-9][a-z0-9-]{0,127}$/.test(dirName) ||
      seenDirNames.has(dirName)
    ) {
      fail(`${itemPath}.dirName must be unique and valid`);
    }
    seenDirNames.add(dirName);

    const riaRecord = readRecord(record.ria, `${itemPath}.ria`);
    ensureExactKeys(riaRecord, `${itemPath}.ria`, [
      'sourceEvidenceIds',
      'mechanism',
      'sourceExample',
      'futureApplicability',
      'execution',
      'boundaries',
    ]);
    const execution = readRecord(
      riaRecord.execution,
      `${itemPath}.ria.execution`,
    );
    ensureExactKeys(execution, `${itemPath}.ria.execution`, [
      'input',
      'steps',
      'output',
      'completionCriteria',
      'stopCriteria',
    ]);
    const boundaries = readRecord(
      riaRecord.boundaries,
      `${itemPath}.ria.boundaries`,
    );
    ensureExactKeys(boundaries, `${itemPath}.ria.boundaries`, [
      'counterexamples',
      'failureModes',
      'limits',
      'confusions',
    ]);
    const evidenceIds = readUniqueIdArray(
      record.evidenceIds,
      `${itemPath}.evidenceIds`,
      {
        minLength: 1,
        maxLength: MAX_CANDIDATE_EVIDENCE_IDS,
        allowedIds: allowedEvidenceIds,
      },
    );
    const sourceEvidenceIds = readUniqueIdArray(
      riaRecord.sourceEvidenceIds,
      `${itemPath}.ria.sourceEvidenceIds`,
      {
        minLength: 1,
        maxLength: MAX_CANDIDATE_EVIDENCE_IDS,
        allowedIds: allowedEvidenceIds,
      },
    );
    const candidateEvidenceIds = new Set(candidateResult.candidate.evidenceIds);
    if (
      evidenceIds.some((evidenceId) => !candidateEvidenceIds.has(evidenceId)) ||
      sourceEvidenceIds.some(
        (evidenceId) =>
          !evidenceIds.includes(evidenceId) ||
          !candidateEvidenceIds.has(evidenceId),
      )
    ) {
      fail(
        `${itemPath}.ria.sourceEvidenceIds must stay within candidate evidence`,
      );
    }

    const manifestRecord = readRecord(record.manifest, `${itemPath}.manifest`);
    ensureExactKeys(manifestRecord, `${itemPath}.manifest`, [
      'model',
      'promptVersion',
      'generatorVersion',
    ]);

    return {
      candidateId,
      id: skillId,
      dirName,
      name: readString(record.name, `${itemPath}.name`, MAX_SHORT_TEXT_LENGTH),
      description: readString(
        record.description,
        `${itemPath}.description`,
        MAX_SHORT_TEXT_LENGTH,
      ),
      skillMd: readString(record.skillMd, `${itemPath}.skillMd`, 50_000),
      ria: {
        sourceEvidenceIds,
        mechanism: readString(
          riaRecord.mechanism,
          `${itemPath}.ria.mechanism`,
          MAX_TEXT_LENGTH,
        ),
        sourceExample: readString(
          riaRecord.sourceExample,
          `${itemPath}.ria.sourceExample`,
          MAX_TEXT_LENGTH,
        ),
        futureApplicability: readString(
          riaRecord.futureApplicability,
          `${itemPath}.ria.futureApplicability`,
          MAX_TEXT_LENGTH,
        ),
        execution: {
          input: readString(
            execution.input,
            `${itemPath}.ria.execution.input`,
            MAX_SHORT_TEXT_LENGTH,
          ),
          steps: readDenseArray(
            execution.steps,
            `${itemPath}.ria.execution.steps`,
            { minLength: 1, maxLength: MAX_EXECUTION_STEPS },
          ).map((step, stepIndex) =>
            readString(
              step,
              `${itemPath}.ria.execution.steps[${stepIndex}]`,
              MAX_SHORT_TEXT_LENGTH,
            ),
          ),
          output: readString(
            execution.output,
            `${itemPath}.ria.execution.output`,
            MAX_SHORT_TEXT_LENGTH,
          ),
          completionCriteria: readString(
            execution.completionCriteria,
            `${itemPath}.ria.execution.completionCriteria`,
            MAX_SHORT_TEXT_LENGTH,
          ),
          stopCriteria: readString(
            execution.stopCriteria,
            `${itemPath}.ria.execution.stopCriteria`,
            MAX_SHORT_TEXT_LENGTH,
          ),
        },
        boundaries: {
          counterexamples: readDenseArray(
            boundaries.counterexamples,
            `${itemPath}.ria.boundaries.counterexamples`,
            { minLength: 1, maxLength: MAX_BOUNDARY_ITEMS },
          ).map((entry, entryIndex) =>
            readString(
              entry,
              `${itemPath}.ria.boundaries.counterexamples[${entryIndex}]`,
              MAX_SHORT_TEXT_LENGTH,
            ),
          ),
          failureModes: readDenseArray(
            boundaries.failureModes,
            `${itemPath}.ria.boundaries.failureModes`,
            { minLength: 1, maxLength: MAX_BOUNDARY_ITEMS },
          ).map((entry, entryIndex) =>
            readString(
              entry,
              `${itemPath}.ria.boundaries.failureModes[${entryIndex}]`,
              MAX_SHORT_TEXT_LENGTH,
            ),
          ),
          limits: readDenseArray(
            boundaries.limits,
            `${itemPath}.ria.boundaries.limits`,
            { minLength: 1, maxLength: MAX_BOUNDARY_ITEMS },
          ).map((entry, entryIndex) =>
            readString(
              entry,
              `${itemPath}.ria.boundaries.limits[${entryIndex}]`,
              MAX_SHORT_TEXT_LENGTH,
            ),
          ),
          confusions: readDenseArray(
            boundaries.confusions,
            `${itemPath}.ria.boundaries.confusions`,
            { minLength: 1, maxLength: MAX_BOUNDARY_ITEMS },
          ).map((entry, entryIndex) =>
            readString(
              entry,
              `${itemPath}.ria.boundaries.confusions[${entryIndex}]`,
              MAX_SHORT_TEXT_LENGTH,
            ),
          ),
        },
      },
      evidenceIds,
      relations: readDenseArray(record.relations, `${itemPath}.relations`, {
        maxLength: MAX_RELATIONS,
      }).map((relation, relationIndex) => {
        const relationPath = `${itemPath}.relations[${relationIndex}]`;
        const relationRecord = readRecord(relation, relationPath);
        ensureExactKeys(relationRecord, relationPath, [
          'type',
          'targetSkillId',
        ]);
        return {
          type: readEnumValue(
            relationRecord.type,
            `${relationPath}.type`,
            RIA_SKILL_RELATION_TYPES,
          ),
          targetSkillId: readSafeId(
            relationRecord.targetSkillId,
            `${relationPath}.targetSkillId`,
          ),
        };
      }),
      manifest: {
        model: readString(
          manifestRecord.model,
          `${itemPath}.manifest.model`,
          MAX_SHORT_TEXT_LENGTH,
        ),
        promptVersion: readString(
          manifestRecord.promptVersion,
          `${itemPath}.manifest.promptVersion`,
          MAX_SHORT_TEXT_LENGTH,
        ),
        generatorVersion: readString(
          manifestRecord.generatorVersion,
          `${itemPath}.manifest.generatorVersion`,
          MAX_SHORT_TEXT_LENGTH,
        ),
      },
    } satisfies RiaSkillDraft;
  });

  const skillIds = new Set(skills.map((skill) => skill.id));
  for (const [index, skill] of skills.entries()) {
    const seenRelations = new Set<string>();
    for (const relation of skill.relations) {
      if (
        relation.targetSkillId === skill.id ||
        !skillIds.has(relation.targetSkillId)
      ) {
        fail(`${path}[${index}].relations target is invalid`);
      }
      const relationKey = `${skill.id}:${relation.type}:${relation.targetSkillId}`;
      if (seenRelations.has(relationKey)) {
        fail(`${path}[${index}].relations must be unique`);
      }
      seenRelations.add(relationKey);
    }
  }
  return skills;
}

export function parseMediaOperationReceipts(
  value: unknown,
  path = 'operationReceipts',
): MediaOperationReceipt[] {
  const seenReceiptKeys = new Set<string>();
  let previousRevisionNo = -1;
  let seenOverviewConfirmation = false;
  return readDenseArray(value, path, {
    maxLength: MAX_OPERATION_RECEIPTS,
  }).map((item, index) => {
    const itemPath = `${path}[${index}]`;
    const record = readRecord(item, itemPath);
    ensureExactKeys(record, itemPath, [
      'action',
      'idempotencyKey',
      'requestHash',
      'baseRevisionNo',
      'resultRevisionNo',
      'confirmedStage',
      'recordedAt',
    ]);
    const action = readEnumValue(
      record.action,
      `${itemPath}.action`,
      MEDIA_OPERATION_RECEIPT_ACTIONS,
    );
    const idempotencyKey = readString(
      record.idempotencyKey,
      `${itemPath}.idempotencyKey`,
      MAX_SHORT_TEXT_LENGTH,
    );
    if (!IDEMPOTENCY_KEY.test(idempotencyKey)) {
      fail(`${itemPath}.idempotencyKey is invalid`);
    }
    const uniqueKey = `${action}:${idempotencyKey}`;
    if (seenReceiptKeys.has(uniqueKey)) {
      fail(`${itemPath} must be unique by action and idempotencyKey`);
    }
    seenReceiptKeys.add(uniqueKey);

    const baseRevisionNo = readInteger(
      record.baseRevisionNo,
      `${itemPath}.baseRevisionNo`,
      {
        min: 0,
        max: MAX_SAFE_INTEGER,
      },
    );
    const resultRevisionNo = readInteger(
      record.resultRevisionNo,
      `${itemPath}.resultRevisionNo`,
      { min: 1, max: MAX_SAFE_INTEGER },
    );
    if (resultRevisionNo !== baseRevisionNo + 1) {
      fail(`${itemPath}.resultRevisionNo must equal baseRevisionNo + 1`);
    }
    if (resultRevisionNo <= previousRevisionNo) {
      fail(`${itemPath}.resultRevisionNo must be strictly increasing`);
    }
    previousRevisionNo = resultRevisionNo;

    const confirmedStage = readEnumValue(
      record.confirmedStage,
      `${itemPath}.confirmedStage`,
      MEDIA_OPERATION_RECEIPT_STAGES,
    );
    const stageByAction: Record<
      MediaOperationReceiptAction,
      MediaOperationReceiptStage
    > = {
      'skill.media.upload.confirm': 'uploading',
      'skill.media.transcript.update': 'transcript',
      'skill.media.evidence.update': 'evidence',
      'skill.media.candidate.update': 'candidate',
      'skill.media.overview.confirm': 'adler_overview',
      'skill.media.candidate.confirm': 'evidence_and_candidates',
    };
    if (confirmedStage !== stageByAction[action]) {
      fail(`${itemPath}.confirmedStage does not match action`);
    }
    if (action === 'skill.media.overview.confirm') {
      seenOverviewConfirmation = true;
    } else if (action === 'skill.media.upload.confirm') {
      if (seenOverviewConfirmation) {
        fail(
          `${itemPath}.upload confirm cannot appear after overview confirmation`,
        );
      }
    } else if (
      action === 'skill.media.candidate.confirm' &&
      !seenOverviewConfirmation
    ) {
      fail(
        `${itemPath}.candidate confirmation cannot appear before overview confirmation`,
      );
    }

    return {
      action,
      idempotencyKey,
      requestHash: readHexHash(record.requestHash, `${itemPath}.requestHash`),
      baseRevisionNo,
      resultRevisionNo,
      confirmedStage,
      recordedAt: readIsoTimestamp(record.recordedAt, `${itemPath}.recordedAt`),
    };
  });
}

function parsePendingUploadVerification(
  value: unknown,
  path: string,
): PersistedPendingUploadVerification {
  const record = readRecord(value, path);
  ensureExactKeys(record, path, [
    'jobId',
    'idempotencyKey',
    'requestHash',
    'observedSizeBytes',
    'observedContentType',
    'confirmedAt',
  ]);
  return {
    jobId: readSafeId(record.jobId, `${path}.jobId`),
    idempotencyKey: readIdempotencyKey(
      record.idempotencyKey,
      `${path}.idempotencyKey`,
    ),
    requestHash: readHexHash(record.requestHash, `${path}.requestHash`),
    observedSizeBytes: readInteger(
      record.observedSizeBytes,
      `${path}.observedSizeBytes`,
      { min: 1, max: MAX_SAFE_INTEGER },
    ),
    observedContentType: readNormalizedMimeType(
      record.observedContentType,
      `${path}.observedContentType`,
    ),
    confirmedAt: readIsoTimestamp(record.confirmedAt, `${path}.confirmedAt`),
  };
}

function parsePendingUploadStrict(
  value: unknown,
  path: string,
): PersistedMultimodalPendingUpload {
  const record = readRecord(value, path);
  const uploadMode = readEnumValue(
    record.uploadMode,
    `${path}.uploadMode`,
    MULTIMODAL_UPLOAD_MODES,
  );
  const materialStatus = readEnumValue(
    record.materialStatus,
    `${path}.materialStatus`,
    MULTIMODAL_UPLOAD_MATERIAL_STATUSES,
  );

  const base = {
    sourceId: readSafeId(record.sourceId, `${path}.sourceId`),
    mediaKind: readEnumValue(
      record.mediaKind,
      `${path}.mediaKind`,
      MULTIMODAL_PRIMARY_SOURCE_KINDS,
    ),
    fileName: readString(
      record.fileName,
      `${path}.fileName`,
      MAX_SHORT_TEXT_LENGTH,
    ),
    declaredMimeType: readNormalizedMimeType(
      record.declaredMimeType,
      `${path}.declaredMimeType`,
    ),
    sizeBytes: readInteger(record.sizeBytes, `${path}.sizeBytes`, {
      min: 1,
      max: MAX_SAFE_INTEGER,
    }),
    objectKey: (() => {
      const objectKey = readObjectKey(record.objectKey, `${path}.objectKey`);
      if (
        !objectKey.startsWith('skill-sessions/') ||
        !objectKey.includes('/source/')
      ) {
        fail(`${path}.objectKey is invalid`);
      }
      return objectKey;
    })(),
    idempotencyKey: readIdempotencyKey(
      record.idempotencyKey,
      `${path}.idempotencyKey`,
    ),
    requestHash: readHexHash(record.requestHash, `${path}.requestHash`),
    intentClaimsHash: readHexHash(
      record.intentClaimsHash,
      `${path}.intentClaimsHash`,
    ),
    intentRevisionNo: readInteger(
      record.intentRevisionNo,
      `${path}.intentRevisionNo`,
      { min: 0, max: MAX_SAFE_INTEGER },
    ),
    expiresAt: readIsoTimestamp(record.expiresAt, `${path}.expiresAt`),
  };

  if (uploadMode === 'single_put') {
    ensureExactKeys(record, path, [
      'sourceId',
      'mediaKind',
      'fileName',
      'declaredMimeType',
      'sizeBytes',
      'uploadMode',
      'materialStatus',
      'verification',
      'objectKey',
      'idempotencyKey',
      'requestHash',
      'intentClaimsHash',
      'intentRevisionNo',
      'expiresAt',
    ]);
    if (materialStatus === 'uploading') {
      if (record.verification !== null) {
        fail(`${path}.verification must be null while uploading`);
      }
      return {
        ...base,
        uploadMode: 'single_put',
        materialStatus: 'uploading',
        verification: null,
      };
    }
    return {
      ...base,
      uploadMode: 'single_put',
      materialStatus: 'verifying',
      verification: parsePendingUploadVerification(
        record.verification,
        `${path}.verification`,
      ),
    };
  }

  ensureExactKeys(record, path, [
    'sourceId',
    'mediaKind',
    'fileName',
    'declaredMimeType',
    'sizeBytes',
    'uploadMode',
    'materialStatus',
    'verification',
    'objectKey',
    'idempotencyKey',
    'requestHash',
    'intentClaimsHash',
    'intentRevisionNo',
    'expiresAt',
    'multipartUploadId',
    'partSizeBytes',
    'partCount',
  ]);

  const multipartBase = {
    ...base,
    uploadMode: 'multipart' as const,
    multipartUploadId: readSafeId(
      record.multipartUploadId,
      `${path}.multipartUploadId`,
    ),
    partSizeBytes: readInteger(record.partSizeBytes, `${path}.partSizeBytes`, {
      min: 5 * 1024 * 1024,
      max: MAX_SAFE_INTEGER,
    }),
    partCount: readInteger(record.partCount, `${path}.partCount`, {
      min: 1,
      max: 10_000,
    }),
  };
  if (materialStatus === 'uploading') {
    if (record.verification !== null) {
      fail(`${path}.verification must be null while uploading`);
    }
    return {
      ...multipartBase,
      materialStatus: 'uploading',
      verification: null,
    };
  }
  return {
    ...multipartBase,
    materialStatus: 'verifying',
    verification: parsePendingUploadVerification(
      record.verification,
      `${path}.verification`,
    ),
  };
}

function deriveSourceFactEligibleEvidenceIds(
  transcript: MultimodalTranscript,
  evidenceItems: readonly MultimodalEvidence[],
  confidenceThreshold = 0.85,
): Set<string> {
  const eligible = new Set<string>();
  for (const evidence of evidenceItems) {
    if (evidence.claimType !== 'sourceFact') {
      continue;
    }
    if (evidence.kind !== 'transcript') {
      eligible.add(evidence.evidenceId);
      continue;
    }
    if (evidence.provenance.editedByUser) {
      eligible.add(evidence.evidenceId);
      continue;
    }
    if (transcript.status !== 'ready') {
      continue;
    }
    if (
      typeof evidence.provenance.confidence === 'number' &&
      Number.isFinite(evidence.provenance.confidence) &&
      evidence.provenance.confidence >= confidenceThreshold
    ) {
      eligible.add(evidence.evidenceId);
    }
  }
  return eligible;
}

export function parseMultimodalSessionState(
  value: unknown,
): MultimodalSessionState {
  const path = 'multimodalSessionState';
  const record = readRecord(value, path);
  ensureExactKeys(record, path, [
    'schemaVersion',
    'primarySource',
    'pendingUpload',
    'transcript',
    'evidenceTimeline',
    'candidatePasses',
    'candidatePassMeta',
    'semanticMoments',
    'degradations',
    'adlerOverview',
    'adlerOverviewReview',
    'selectedCandidateIds',
    'candidateValidations',
    'candidateSkills',
    'operationReceipts',
  ]);
  const schemaVersion = readInteger(
    record.schemaVersion,
    `${path}.schemaVersion`,
  );
  if (schemaVersion !== 1) {
    fail(`${path}.schemaVersion must equal 1`);
  }

  const evidenceTimeline = readRecord(
    record.evidenceTimeline,
    `${path}.evidenceTimeline`,
  );
  ensureExactKeys(evidenceTimeline, `${path}.evidenceTimeline`, [
    'evidenceItems',
  ]);

  const parsedEvidenceItems = readDenseArray(
    evidenceTimeline.evidenceItems,
    `${path}.evidenceTimeline.evidenceItems`,
  ).map(parseEvidenceCard);
  const parsedPrimarySource = parseMultimodalPrimarySource(
    record.primarySource,
    `${path}.primarySource`,
  );
  const parsedPendingUpload =
    record.pendingUpload === undefined || record.pendingUpload === null
      ? null
      : parsePendingUploadStrict(record.pendingUpload, `${path}.pendingUpload`);
  const parsedTranscript = parseMultimodalTranscript(
    record.transcript,
    `${path}.transcript`,
  );
  const evidenceIds = new Set<string>();
  const frameEvidenceIds = new Set<string>();
  let inferredDurationMs = 0;
  for (const evidence of parsedEvidenceItems) {
    if (evidenceIds.has(evidence.evidenceId)) {
      fail(
        `${path}.evidenceTimeline.evidenceItems must have unique evidenceId`,
      );
    }
    evidenceIds.add(evidence.evidenceId);
    if (
      parsedPrimarySource != null &&
      evidence.source.primarySourceId !== parsedPrimarySource.sourceId
    ) {
      fail(`${path}.evidenceTimeline.evidenceItems must match primarySource`);
    }
    if (evidence.kind === 'frame') {
      frameEvidenceIds.add(evidence.evidenceId);
    }
    inferredDurationMs = Math.max(inferredDurationMs, evidence.timeRange.endMs);
  }
  if (parsedPrimarySource == null && parsedEvidenceItems.length > 0) {
    fail(`${path}.primarySource is required when evidence exists`);
  }
  for (const segment of parsedTranscript.segments) {
    inferredDurationMs = Math.max(inferredDurationMs, segment.endMs);
  }
  const sourceFactEligibleEvidenceIds = [
    ...deriveSourceFactEligibleEvidenceIds(
      parsedTranscript,
      parsedEvidenceItems,
    ),
  ];
  const parsedCandidatePasses = parseCandidatePasses(record.candidatePasses, {
    path: `${path}.candidatePasses`,
    evidenceIds: [...evidenceIds],
    frameEvidenceIds: [...frameEvidenceIds],
    sourceFactEligibleEvidenceIds,
  });
  const candidatePassCount = CANDIDATE_PASS_KEYS.reduce(
    (count, passKey) => count + parsedCandidatePasses[passKey].length,
    0,
  );
  const parsedCandidatePassMeta =
    record.candidatePassMeta === undefined || record.candidatePassMeta === null
      ? candidatePassCount === 0
        ? null
        : fail(
            `${path}.candidatePassMeta is required when candidatePasses are non-empty`,
          )
      : parseCandidatePassMeta(
          record.candidatePassMeta,
          `${path}.candidatePassMeta`,
        );
  const parsedSemanticMoments = parseNormalizedSemanticMoments(
    record.semanticMoments === undefined ? [] : record.semanticMoments,
    {
      durationMs: inferredDurationMs > 0 ? inferredDurationMs : undefined,
    },
  );
  const parsedDegradations = parseMediaEvidenceDegradations(
    record.degradations === undefined ? [] : record.degradations,
    `${path}.degradations`,
  );
  const parsedAdlerOverview =
    record.adlerOverview === undefined || record.adlerOverview === null
      ? null
      : parseAdlerOverviewResult(
          record.adlerOverview,
          {
            evidenceIds: [...evidenceIds],
            sourceFactEligibleEvidenceIds,
          },
          `${path}.adlerOverview`,
        );
  if (
    parsedAdlerOverview != null &&
    JSON.stringify(parsedAdlerOverview.meta.degradations) !==
      JSON.stringify(parsedDegradations)
  ) {
    fail(`${path}.adlerOverview.meta.degradations must match degradations`);
  }
  const parsedAdlerOverviewReview =
    record.adlerOverviewReview === undefined ||
    record.adlerOverviewReview === null
      ? null
      : parseAdlerOverviewReview(
          record.adlerOverviewReview,
          `${path}.adlerOverviewReview`,
        );
  if (parsedAdlerOverviewReview !== null && parsedAdlerOverview === null) {
    fail(`${path}.adlerOverviewReview requires adlerOverview`);
  }
  const parsedCandidateValidations = parseValidatedCandidateResults(
    record.candidateValidations === undefined
      ? []
      : record.candidateValidations,
    {
      candidatePasses: parsedCandidatePasses,
      evidenceIds: [...evidenceIds],
      frameEvidenceIds: [...frameEvidenceIds],
      sourceFactEligibleEvidenceIds,
    },
    `${path}.candidateValidations`,
  );
  if (
    parsedCandidateValidations.length > 0 &&
    parsedCandidatePassMeta === null
  ) {
    fail(
      `${path}.candidatePassMeta is required when candidateValidations are non-empty`,
    );
  }
  const eligibleSelectedCandidateIds = new Set(
    parsedCandidateValidations
      .filter(
        (item) => item.overallPassed === true && item.disposition === 'retain',
      )
      .map((item) => item.candidate.candidateId),
  );
  const parsedSelectedCandidateIds =
    record.selectedCandidateIds === undefined
      ? []
      : readUniqueIdArray(
          record.selectedCandidateIds,
          `${path}.selectedCandidateIds`,
          {
            maxLength: MAX_SELECTED_CANDIDATE_IDS,
          },
        );
  for (const candidateId of parsedSelectedCandidateIds) {
    if (!eligibleSelectedCandidateIds.has(candidateId)) {
      fail(
        `${path}.selectedCandidateIds must reference retained passing candidates`,
      );
    }
  }
  const parsedCandidateSkills = parseRiaSkillDrafts(
    record.candidateSkills === undefined ? [] : record.candidateSkills,
    {
      validatedCandidates: parsedCandidateValidations,
      evidenceIds: [...evidenceIds],
    },
    `${path}.candidateSkills`,
  );
  if (
    parsedSelectedCandidateIds.length === 0 &&
    parsedCandidateSkills.length > 0
  ) {
    fail(`${path}.candidateSkills require selectedCandidateIds`);
  }
  if (parsedCandidateSkills.length > 0) {
    const selectedCandidateIdsSet = new Set(parsedSelectedCandidateIds);
    if (parsedCandidateSkills.length !== parsedSelectedCandidateIds.length) {
      fail(`${path}.candidateSkills must match selectedCandidateIds exactly`);
    }
    for (const skill of parsedCandidateSkills) {
      if (!selectedCandidateIdsSet.has(skill.candidateId)) {
        fail(`${path}.candidateSkills must match selectedCandidateIds exactly`);
      }
    }
  }
  const parsedOperationReceipts = parseMediaOperationReceipts(
    record.operationReceipts === undefined ? [] : record.operationReceipts,
    `${path}.operationReceipts`,
  );
  const hasOverviewConfirmationReceipt = parsedOperationReceipts.some(
    (receipt) => receipt.action === 'skill.media.overview.confirm',
  );
  const hasCandidateConfirmationReceipt = parsedOperationReceipts.some(
    (receipt) => receipt.action === 'skill.media.candidate.confirm',
  );
  if (parsedAdlerOverviewReview !== null && !hasOverviewConfirmationReceipt) {
    fail(`${path}.adlerOverviewReview requires overview confirmation receipt`);
  }
  if (hasOverviewConfirmationReceipt && parsedAdlerOverviewReview === null) {
    fail(
      `${path}.operationReceipts overview confirmation requires adlerOverviewReview`,
    );
  }
  if (
    parsedSelectedCandidateIds.length > 0 &&
    !hasCandidateConfirmationReceipt
  ) {
    fail(`${path}.selectedCandidateIds require candidate confirmation receipt`);
  }
  if (
    hasCandidateConfirmationReceipt &&
    (!hasOverviewConfirmationReceipt ||
      parsedAdlerOverviewReview === null ||
      parsedSelectedCandidateIds.length === 0)
  ) {
    fail(
      `${path}.operationReceipts candidate confirmation requires review and selected candidates`,
    );
  }
  const semanticMomentIds = new Set(
    parsedSemanticMoments.map((moment) => moment.semanticMomentId),
  );
  for (const degradation of parsedDegradations) {
    if (
      degradation.semanticMomentId !== undefined &&
      !semanticMomentIds.has(degradation.semanticMomentId)
    ) {
      fail(`${path}.degradations must reference existing semantic moments`);
    }
  }
  if (parsedPendingUpload !== null) {
    const hasCandidatePasses = CANDIDATE_PASS_KEYS.some(
      (passKey) => parsedCandidatePasses[passKey].length > 0,
    );
    if (
      parsedPrimarySource !== null ||
      parsedTranscript.status !== 'pending' ||
      parsedTranscript.segments.length > 0 ||
      parsedEvidenceItems.length > 0 ||
      parsedSemanticMoments.length > 0 ||
      parsedDegradations.length > 0 ||
      parsedAdlerOverview !== null ||
      parsedAdlerOverviewReview !== null ||
      parsedSelectedCandidateIds.length > 0 ||
      parsedCandidateValidations.length > 0 ||
      parsedCandidateSkills.length > 0 ||
      parsedCandidatePassMeta !== null ||
      hasCandidatePasses
    ) {
      fail(`${path}.pendingUpload is only allowed for an empty upload state`);
    }

    const uploadConfirmReceipts = parsedOperationReceipts.filter(
      (receipt) => receipt.action === 'skill.media.upload.confirm',
    );
    const nonUploadReceipts = parsedOperationReceipts.filter(
      (receipt) => receipt.action !== 'skill.media.upload.confirm',
    );

    if (nonUploadReceipts.length > 0) {
      fail(
        `${path}.pendingUpload cannot coexist with human confirmation receipts`,
      );
    }

    if (parsedPendingUpload.materialStatus === 'uploading') {
      if (uploadConfirmReceipts.length !== 0) {
        fail(
          `${path}.uploading pendingUpload cannot have upload confirmation receipt`,
        );
      }
    } else {
      if (uploadConfirmReceipts.length !== 1) {
        fail(
          `${path}.verifying pendingUpload requires exactly one upload confirmation receipt`,
        );
      }
      const receipt = uploadConfirmReceipts[0];
      const verification = parsedPendingUpload.verification;
      if (
        receipt.idempotencyKey !== verification.idempotencyKey ||
        receipt.requestHash !== verification.requestHash ||
        receipt.baseRevisionNo !== parsedPendingUpload.intentRevisionNo ||
        receipt.resultRevisionNo !== parsedPendingUpload.intentRevisionNo + 1 ||
        receipt.recordedAt !== verification.confirmedAt
      ) {
        fail(
          `${path}.upload confirmation receipt must match pendingUpload verification`,
        );
      }
    }
  } else if (parsedPrimarySource == null) {
    const hasCandidatePasses = CANDIDATE_PASS_KEYS.some(
      (passKey) => parsedCandidatePasses[passKey].length > 0,
    );
    if (
      parsedTranscript.segments.length > 0 ||
      parsedEvidenceItems.length > 0 ||
      parsedSemanticMoments.length > 0 ||
      parsedDegradations.length > 0 ||
      parsedAdlerOverview !== null ||
      parsedAdlerOverviewReview !== null ||
      parsedSelectedCandidateIds.length > 0 ||
      parsedCandidateValidations.length > 0 ||
      parsedCandidateSkills.length > 0 ||
      parsedOperationReceipts.length > 0 ||
      parsedCandidatePassMeta !== null ||
      hasCandidatePasses
    ) {
      fail(`${path}.primarySource may be null only for empty draft state`);
    }
  }

  return {
    schemaVersion: 1,
    primarySource: parsedPrimarySource ?? null,
    pendingUpload: parsedPendingUpload ?? null,
    transcript: parsedTranscript,
    evidenceTimeline: {
      evidenceItems: parsedEvidenceItems,
    },
    candidatePasses: parsedCandidatePasses,
    candidatePassMeta: parsedCandidatePassMeta,
    semanticMoments: parsedSemanticMoments,
    degradations: parsedDegradations,
    adlerOverview: parsedAdlerOverview,
    adlerOverviewReview: parsedAdlerOverviewReview,
    selectedCandidateIds: parsedSelectedCandidateIds,
    candidateValidations: parsedCandidateValidations,
    candidateSkills: parsedCandidateSkills,
    operationReceipts: parsedOperationReceipts,
  };
}

function parseSemanticMomentEvidenceSnippet(
  value: unknown,
  path: string,
  durationMs?: number,
): MultimodalSemanticMomentEvidenceSnippet | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }
  const record = readRecord(value, path);
  ensureExactKeys(record, path, ['timeRange', 'text', 'confidence']);
  const timeRange = parseTimeRange(record.timeRange, `${path}.timeRange`);
  if (durationMs !== undefined) {
    validateRangeBounds(
      timeRange.startMs,
      timeRange.endMs,
      `${path}.timeRange`,
      {
        durationMs,
      },
    );
  }
  return {
    timeRange,
    text: readString(record.text, `${path}.text`, MAX_TEXT_LENGTH),
    confidence: readOptionalConfidence(record.confidence, `${path}.confidence`),
  };
}

function readDurationMs(durationMs: number): number {
  return readInteger(durationMs, 'durationMs', {
    min: 1,
    max: MAX_SAFE_INTEGER,
  });
}

function parseSemanticMomentRecord(
  value: unknown,
  path: string,
  durationMs?: number,
): SemanticMomentDraft {
  const record = readRecord(value, path);
  ensureExactKeys(record, path, [
    'startMs',
    'endMs',
    'importance',
    'type',
    'summary',
    'visualTarget',
    'audioEvidence',
    'transcriptEvidence',
    'selectionReason',
  ]);
  const startMs = readInteger(record.startMs, `${path}.startMs`, {
    min: 0,
    max: MAX_SAFE_INTEGER,
  });
  const endMs = readInteger(record.endMs, `${path}.endMs`, {
    min: 0,
    max: MAX_SAFE_INTEGER,
  });
  if (durationMs !== undefined) {
    validateRangeBounds(startMs, endMs, path, { durationMs });
  } else {
    validateRangeBounds(startMs, endMs, path);
  }
  const importance = readFiniteNumber(record.importance, `${path}.importance`);
  if (importance < 0 || importance > 1) {
    fail(`${path}.importance must be between 0 and 1`);
  }
  return {
    startMs,
    endMs,
    importance,
    type: readEnumValue(
      record.type,
      `${path}.type`,
      MULTIMODAL_SEMANTIC_MOMENT_TYPES,
    ),
    summary: readString(
      record.summary,
      `${path}.summary`,
      MAX_SHORT_TEXT_LENGTH,
    ),
    visualTarget: readOptionalNullableString(
      record.visualTarget,
      `${path}.visualTarget`,
      MAX_SHORT_TEXT_LENGTH,
    ),
    audioEvidence: parseSemanticMomentEvidenceSnippet(
      record.audioEvidence,
      `${path}.audioEvidence`,
      durationMs,
    ),
    transcriptEvidence: parseSemanticMomentEvidenceSnippet(
      record.transcriptEvidence,
      `${path}.transcriptEvidence`,
      durationMs,
    ),
    selectionReason: readString(
      record.selectionReason,
      `${path}.selectionReason`,
      MAX_SHORT_TEXT_LENGTH,
    ),
  };
}

export function parseSemanticMomentDrafts(
  value: unknown,
  options: { durationMs?: number },
): SemanticMomentDraft[] {
  const durationMs =
    options.durationMs === undefined
      ? undefined
      : readDurationMs(options.durationMs);
  return readDenseArray(value, 'semanticMoments', {
    maxLength: MAX_SEMANTIC_MOMENTS,
  }).map((item, index) =>
    parseSemanticMomentRecord(item, `semanticMoments[${index}]`, durationMs),
  );
}

export function parseNormalizedSemanticMoments(
  value: unknown,
  options: { durationMs?: number },
): NormalizedSemanticMoment[] {
  const durationMs =
    options.durationMs === undefined
      ? undefined
      : readDurationMs(options.durationMs);
  const seenSemanticMomentIds = new Set<string>();
  return readDenseArray(value, 'normalizedSemanticMoments', {
    maxLength: MAX_SEMANTIC_MOMENTS,
  }).map((item, index) => {
    const record = readRecord(item, `normalizedSemanticMoments[${index}]`);
    ensureExactKeys(record, `normalizedSemanticMoments[${index}]`, [
      'semanticMomentId',
      'startMs',
      'endMs',
      'importance',
      'type',
      'summary',
      'visualTarget',
      'audioEvidence',
      'transcriptEvidence',
      'selectionReason',
    ]);
    const { semanticMomentId, ...momentRecord } = record;
    const parsedSemanticMomentId = readSafeId(
      semanticMomentId,
      `normalizedSemanticMoments[${index}].semanticMomentId`,
    );
    if (seenSemanticMomentIds.has(parsedSemanticMomentId)) {
      fail(
        `normalizedSemanticMoments[${index}].semanticMomentId must be unique`,
      );
    }
    seenSemanticMomentIds.add(parsedSemanticMomentId);
    return {
      semanticMomentId: parsedSemanticMomentId,
      ...parseSemanticMomentRecord(
        momentRecord,
        `normalizedSemanticMoments[${index}]`,
        durationMs,
      ),
    };
  });
}

export function parseMediaEvidenceDegradations(
  value: unknown,
  path = 'degradations',
): MediaEvidenceDegradation[] {
  return readDenseArray(value, path, {
    maxLength: MAX_DEGRADATIONS,
  }).map((item, index) => {
    const itemPath = `${path}[${index}]`;
    const record = readRecord(item, itemPath);
    ensureExactKeys(record, itemPath, ['code', 'message', 'semanticMomentId']);
    return {
      code: readSafeId(record.code, `${itemPath}.code`),
      message: readString(
        record.message,
        `${itemPath}.message`,
        MAX_SHORT_TEXT_LENGTH,
      ),
      semanticMomentId:
        record.semanticMomentId === undefined
          ? undefined
          : readSafeId(record.semanticMomentId, `${itemPath}.semanticMomentId`),
    };
  });
}

export function parseAdlerOverviewReview(
  value: unknown,
  path: string,
): AdlerOverviewReview {
  const record = readRecord(value, path);
  ensureExactKeys(record, path, ['title', 'approved', 'userNotes']);
  return {
    title: readString(
      record.title,
      `${path}.title`,
      MAX_ADLER_REVIEW_TITLE_LENGTH,
    ),
    approved: readLiteralTrue(record.approved, `${path}.approved`),
    userNotes: readPossiblyEmptyString(
      record.userNotes,
      `${path}.userNotes`,
      MAX_ADLER_REVIEW_NOTES_LENGTH,
    ),
  };
}

export function parseMediaJobRecord(value: unknown): MediaJobRecord {
  const path = 'mediaJobRecord';
  const record = readRecord(value, path);
  const attemptNo = readInteger(record.attemptNo, `${path}.attemptNo`, {
    min: 0,
  });
  const maxAttempts = readInteger(record.maxAttempts, `${path}.maxAttempts`, {
    min: 1,
    max: 10,
  });
  if (attemptNo > maxAttempts) {
    fail(`${path}.attemptNo must be less than or equal to ${path}.maxAttempts`);
  }

  return {
    id: readSafeId(record.id, `${path}.id`),
    sessionId: readSafeId(record.sessionId, `${path}.sessionId`),
    jobType: readEnumValue(record.jobType, `${path}.jobType`, MEDIA_JOB_TYPES),
    status: readEnumValue(record.status, `${path}.status`, MEDIA_JOB_STATUSES),
    idempotencyKey: readString(
      record.idempotencyKey,
      `${path}.idempotencyKey`,
      MAX_SHORT_TEXT_LENGTH,
    ),
    requestHash: readHexHash(record.requestHash, `${path}.requestHash`),
    attemptNo,
    maxAttempts,
    progress: readRecord(record.progress, `${path}.progress`),
    inputManifest: readRecord(record.inputManifest, `${path}.inputManifest`),
    outputManifest:
      record.outputManifest == null
        ? record.outputManifest
        : readRecord(record.outputManifest, `${path}.outputManifest`),
    resultHash:
      record.resultHash == null
        ? record.resultHash
        : readHexHash(record.resultHash, `${path}.resultHash`),
    error:
      record.error == null
        ? record.error
        : readRecord(record.error, `${path}.error`),
  };
}

export function parseFrameDHash64(value: unknown, path: string): string {
  const hash = readString(value, path, 16);
  if (!DHASH64_HEX.test(hash)) {
    fail(`${path} must be a 16-character lowercase hex string`);
  }
  return hash;
}
