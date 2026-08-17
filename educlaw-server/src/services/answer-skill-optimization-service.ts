import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type {
  AgentPackageSnapshot,
  ArenaAnswerOptimizationUnavailableReason,
  ArenaAnswerOptimizationSummary,
  ArenaMessage,
  PackageSkill,
  PackageVersion,
} from "@educlaw/shared";
import { config } from "../config.js";
import {
  buildAnswerSkillAlternativeRegenerationPrompt,
  buildAnswerSkillOptimizationLocalizationPrompt,
  buildAnswerSkillOptimizationPrompt,
  buildAnswerSkillRepairPrompt,
  buildAnswerSkillRefinementLocalizationPrompt,
  buildAnswerSkillRefinementPrompt,
} from "../prompts/answer-skill-optimization.js";
import {
  AnswerSkillTestEvaluationContractError,
  buildAnswerSkillTestEvaluationLocalizationPrompt,
  buildAnswerSkillTestEvaluationPrompt,
  parseAnswerSkillTestEvaluationOutput,
  type AnswerSkillTestEvaluationOutput,
} from "../prompts/answer-skill-test-evaluation.js";
import { parseJsonObject } from "../utils/json.js";
import {
  ArenaAnswerRunNotFoundError,
  buildArenaSidePromptContext,
  buildEnhancedPrompt,
  getAnswerOptimizationAvailability,
  getArenaAnswerRunByMessage,
  getArenaAnswerRunByEnhancedMessage,
  parseArenaAnswerContextMessageIds,
  parseArenaAnswerEnhancedModel,
  selectRelevantSkills,
  type ArenaAnswerRun,
  type ArenaSidePromptContext,
} from "./arena-service.js";
import { query, withTransaction } from "./db.js";
import {
  generateJson,
  generateText,
  LlmInvalidJsonError,
} from "./llm-service.js";
import {
  getVersion,
  validateSkillMdStandard,
} from "./package-service.js";
import {
  getSkillVersionDetail,
  syncPackageVersionSkillsFromSnapshot,
} from "./skill-version-service.js";
import {
  applyAnswerSkillPatch,
  AnswerSkillPatchApplicationError,
  type AppliedAnswerSkillPatch,
} from "./answer-skill-patch-service.js";
import {
  buildAnswerSkillRefinementTransition,
  getAnswerSkillConfirmIssue,
  getAnswerSkillPreviewIssueEvidence,
} from "./answer-skill-optimization-policy.js";
import {
  ANSWER_OPTIMIZATION_CANCEL_REASONS,
  ANSWER_SKILL_OPTIMIZATION_STATUSES,
  AnswerSkillOptimizationContractError,
  MAX_ANSWER_SKILL_REFINEMENT_TURNS,
  MAX_PLANNED_TARGETS,
  parseAnswerOptimizationModelOutput,
  parseAnswerSkillRefinementModelOutput,
  parseAnswerSkillOptimizationResult,
  type AnswerOptimizationCancelReason,
  type AnswerOptimizationCandidateSkill,
  type AnswerOptimizationConfirmResult,
  type AnswerOptimizationDiagnosis,
  type AnswerOptimizationDiff,
  type AnswerOptimizationDraft,
  type AnswerOptimizationFailure,
  type AnswerOptimizationIdempotencyRecord,
  type AnswerOptimizationModelOutput,
  type AnswerOptimizationPlannedTarget,
  type AnswerOptimizationTargetSkill,
  type AnswerOptimizationTestFailure,
  type AnswerOptimizationTestResult,
  type AnswerSkillRefinementModelOutput,
  type AnswerSkillRefinementOutcome,
  type AnswerSkillRefinementFailureCode,
  type AnswerSkillRefinementQualityEvidence,
  type AnswerSkillRefinementSource,
  type AnswerSkillRefinementTechnicalFailureCode,
  type AnswerSkillRefinementTurn,
  type AnswerSkillOptimizationResult,
  type AnswerSkillOptimizationStatus,
  type AnswerSkillPatch,
  type ParseAnswerOptimizationModelOutputOptions,
  type PublicAnswerOptimizationTestResult,
} from "./answer-skill-optimization-contract.js";
import type {
  DbRowAnswerSkillOptimizationRun,
  DbRowMessage,
  DbRowPackage,
  DbRowPackageVersion,
  DbRowThread,
} from "../types.js";

export {
  ANSWER_OPTIMIZATION_CANCEL_REASONS,
  ANSWER_SKILL_OPTIMIZATION_STATUSES,
};
export type {
  AnswerOptimizationCancelReason,
  AnswerSkillOptimizationResult,
  AnswerSkillOptimizationStatus,
};

export interface AnswerSkillOptimizationRun {
  id: number;
  userId: string;
  packageId: number;
  threadId: number;
  baseVersionId: number;
  questionMessageId: number;
  enhancedAnswerMessageId: number;
  baselineAnswerMessageId: number | null;
  answerSide: "baseline" | "enhanced";
  answerMessageId: number;
  evidenceVersionId: number;
  answerSkillVersionId: number | null;
  workingSkillVersionId: number | null;
  userFeedback: string;
  targetSkillId: string | null;
  result: AnswerSkillOptimizationResult;
  status: AnswerSkillOptimizationStatus;
  revision: number;
  finalVersionId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAnswerSkillOptimizationRunInput {
  userId: string;
  packageId: number;
  threadId: number;
  questionMessageId: number;
  enhancedAnswerMessageId: number;
  baselineAnswerMessageId?: number | null;
  answerSide?: "baseline" | "enhanced";
  answerMessageId?: number;
  feedback: string;
  idempotencyKey: string;
}

export class AnswerSkillOptimizationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnswerSkillOptimizationValidationError";
  }
}

export class AnswerSkillOptimizationNotFoundError extends Error {
  constructor(message = "Answer skill optimization run not found") {
    super(message);
    this.name = "AnswerSkillOptimizationNotFoundError";
  }
}

export class AnswerSkillOptimizationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnswerSkillOptimizationConflictError";
  }
}

export class AnswerSkillOptimizationAlreadyExistsError extends AnswerSkillOptimizationConflictError {
  readonly code:
    | "answer_optimization_already_exists"
    | "answer_already_optimized";
  readonly existingOptimizationId: number;
  readonly status: AnswerSkillOptimizationStatus;
  readonly finalVersionId: number | null;
  readonly versionNumber: number | null;

  constructor(
    run: AnswerSkillOptimizationRun,
    versionNumber: number | null,
  ) {
    const completed = run.status === "completed";
    super(
      completed
        ? "This answer has already been optimized"
        : "An optimization already exists for this answer",
    );
    this.name = "AnswerSkillOptimizationAlreadyExistsError";
    this.code = completed
      ? "answer_already_optimized"
      : "answer_optimization_already_exists";
    this.existingOptimizationId = run.id;
    this.status = run.status;
    this.finalVersionId = run.finalVersionId;
    this.versionNumber = versionNumber;
  }
}

export class AnswerSkillOptimizationDraftError extends Error {
  readonly failureCode: AnswerOptimizationFailure["code"];

  constructor(
    message: string,
    failureCode: AnswerOptimizationFailure["code"] = "model_output_invalid",
  ) {
    super(message);
    this.name = "AnswerSkillOptimizationDraftError";
    this.failureCode = failureCode;
  }
}

export class AnswerSkillRefinementRejectedError extends AnswerSkillOptimizationDraftError {
  constructor(
    message: string,
    failureCode: "feedback_not_reusable" | "feedback_unclear",
  ) {
    super(message, failureCode);
    this.name = "AnswerSkillRefinementRejectedError";
  }
}

export class AnswerSkillRefinementTechnicalError extends Error {
  readonly code: AnswerSkillRefinementTechnicalFailureCode;

  constructor(
    code: AnswerSkillRefinementTechnicalFailureCode,
    message: string,
  ) {
    super(message);
    this.name = "AnswerSkillRefinementTechnicalError";
    this.code = code;
  }
}

export class AnswerSkillOptimizationReplayUnavailableError extends Error {
  readonly reason: Exclude<
    ArenaAnswerOptimizationUnavailableReason,
    "missing_answer_run"
  >;

  constructor(
    reason: Exclude<
      ArenaAnswerOptimizationUnavailableReason,
      "missing_answer_run"
    >,
  ) {
    super("The answer does not contain reliable replay provenance");
    this.name = "AnswerSkillOptimizationReplayUnavailableError";
    this.reason = reason;
  }
}

export class AnswerSkillOptimizationUpstreamError extends Error {
  readonly statusCode: 502 | 503;

  constructor(message: string, statusCode: 502 | 503 = 503) {
    super(message);
    this.name = "AnswerSkillOptimizationUpstreamError";
    this.statusCode = statusCode;
  }
}

export interface CreateAnswerSkillOptimizationOutcome {
  run: AnswerSkillOptimizationRun;
  created: boolean;
}

interface ReviseAnswerSkillOptimizationBaseInput {
  userId: string;
  optimizationId: number;
  expectedRevision: number;
  idempotencyKey: string;
}

export interface RegenerateAnswerSkillOptimizationInput
  extends ReviseAnswerSkillOptimizationBaseInput {
  feedback: string;
  targetSkillId?: string;
  targetSkillIds?: string[];
}

export type RefineAnswerSkillOptimizationInput =
  | (ReviseAnswerSkillOptimizationBaseInput & {
      additionalFeedback: string;
      revisionSource: "draft_review";
    })
  | (ReviseAnswerSkillOptimizationBaseInput & {
      additionalFeedback?: string;
      revisionSource: "test_failure";
    })
  | (ReviseAnswerSkillOptimizationBaseInput & {
      revisionSource: "alternative_regeneration";
    });

export type ReviseAnswerSkillOptimizationInput =
  | RegenerateAnswerSkillOptimizationInput
  | RefineAnswerSkillOptimizationInput;

export interface CancelAnswerSkillOptimizationInput {
  userId: string;
  optimizationId: number;
  expectedRevision: number;
  reason: AnswerOptimizationCancelReason;
  idempotencyKey: string;
}

export interface TestAnswerSkillOptimizationInput {
  userId: string;
  optimizationId: number;
  expectedRevision: number;
  idempotencyKey: string;
}

export interface ConfirmAnswerSkillOptimizationInput {
  userId: string;
  optimizationId: number;
  expectedRevision: number;
  versionNote?: string;
  idempotencyKey: string;
}

export interface AnswerOptimizationMessageDto {
  messageId: number;
  content: string;
}

export interface AnswerSkillOptimizationDetailDto {
  optimizationId: number;
  packageId: number;
  threadId: number;
  baseVersionId: number;
  evidenceVersionId: number;
  answerSide: "baseline" | "enhanced";
  answerMessageId: number;
  answerSkillVersionId: number | null;
  workingSkillVersionId: number | null;
  status: AnswerSkillOptimizationStatus;
  revision: number;
  feedback: string;
  question: AnswerOptimizationMessageDto;
  originalAnswer: AnswerOptimizationMessageDto;
  baselineAnswer: AnswerOptimizationMessageDto | null;
  diagnosis: AnswerOptimizationDiagnosis | null;
  targetSkill: AnswerOptimizationTargetSkill | null;
  candidateSkills: AnswerOptimizationCandidateSkill[];
  patch: AnswerSkillPatch | null;
  draft: PublicAnswerOptimizationDraft | null;
  diff: AnswerOptimizationDiff | null;
  testResult: PublicAnswerOptimizationTestResult | null;
  refinementHistory: AnswerSkillRefinementTurn[];
  failureCode: AnswerOptimizationFailure["code"] | null;
  finalVersionId: number | null;
  plannedTargets: AnswerOptimizationPlannedTarget[];
  replayAvailability: {
    available: boolean;
    reason: ArenaAnswerOptimizationUnavailableReason | null;
  };
  createdAt: string;
  updatedAt: string;
}

export interface TestAnswerSkillOptimizationDto {
  optimizationId: number;
  status: "test_ready";
  revision: number;
  testResult: PublicAnswerOptimizationTestResult;
  updatedAt: string;
}

export interface ConfirmAnswerSkillOptimizationDto {
  optimizationId: number;
  status: "completed" | "draft_ready";
  baseVersionId: number;
  finalVersionId: number;
  versionNumber: number;
  skillVersionNumber: number;
  source: "interactive";
  completedAt: string;
  advancedToNextTarget?: boolean;
}

export interface ReviseAnswerSkillOptimizationDto {
  optimizationId: number;
  status: AnswerSkillOptimizationStatus;
  revision: number;
  feedback: string;
  diagnosis: AnswerOptimizationDiagnosis | null;
  targetSkill: AnswerOptimizationTargetSkill | null;
  candidateSkills: AnswerOptimizationCandidateSkill[];
  patch: AnswerSkillPatch | null;
  draft: PublicAnswerOptimizationDraft | null;
  diff: AnswerOptimizationDiff | null;
  testResult: null;
  refinementHistory: AnswerSkillRefinementTurn[];
  plannedTargets: AnswerOptimizationPlannedTarget[];
  updatedAt: string;
}

export interface CancelAnswerSkillOptimizationDto {
  optimizationId: number;
  status: "cancelled";
  revision: number;
  reason: AnswerOptimizationCancelReason;
  cancelledAt: string;
}

interface AnswerSkillOptimizationContext {
  run: AnswerSkillOptimizationRun;
  answerRun: ArenaAnswerRun;
  version: PackageVersion;
  question: ArenaMessage;
  originalAnswer: ArenaMessage;
  baselineAnswer: ArenaMessage | null;
  skills: PackageSkill[];
  usedSkillIds: string[];
}

interface AnswerSkillOptimizationTestContext {
  snapshot: AgentPackageSnapshot;
  selectedSkills: PackageSkill[];
  usedSkillIds: string[];
  targetSkillId: string;
}

interface AnswerSkillOptimizationReplayContext {
  promptContext: ArenaSidePromptContext;
  enhancedModel: string;
}

interface TestClaim {
  claimed: AnswerSkillOptimizationRun;
  previousStatus: "draft_ready" | "test_ready";
  previousResult: AnswerSkillOptimizationResult;
  idempotencySlot: string;
}

interface AnalysisResult {
  status: "draft_ready" | "target_selection_required" | "failed";
  targetSkillId: string | null;
  result: AnswerSkillOptimizationResult;
}

interface DbRowExistingAnswerOptimization
  extends DbRowAnswerSkillOptimizationRun {
  final_version_number: number | string | null;
}

interface DbRowAnswerOptimizationSummary {
  enhanced_answer_message_id: number | string;
  answer_run_id: number | string | null;
  context_message_ids: unknown | null;
  enhanced_model: string | null;
  optimization_id: number | string | null;
  status: unknown | null;
  final_version_id: number | string | null;
  version_number: number | string | null;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CREATE_REQUEST_KEY_UNIQUE_CONSTRAINT =
  "answer_skill_optimization_runs_user_create_key_unique";
const NON_CANCELLED_ANSWER_UNIQUE_CONSTRAINT =
  "uq_answer_skill_optimization_runs_non_cancelled_answer";
const TEST_REPLAY_POLL_INTERVAL_MS = 50;
export const ANSWER_SKILL_OPTIMIZATION_PROCESSING_STALE_AFTER_MS =
  15 * 60 * 1000;
const INTERRUPTED_OPERATION_MESSAGE =
  "The previous operation was interrupted and can be retried.";

const CREATE_INPUT_FIELDS = new Set([
  "userId",
  "packageId",
  "threadId",
  "questionMessageId",
  "enhancedAnswerMessageId",
  "baselineAnswerMessageId",
  "answerSide",
  "answerMessageId",
  "feedback",
  "idempotencyKey",
]);

function assertKnownCreateFields(
  input: CreateAnswerSkillOptimizationRunInput,
): void {
  const unexpected = Object.keys(input).find(
    (field) => !CREATE_INPUT_FIELDS.has(field),
  );
  if (unexpected) {
    throw new AnswerSkillOptimizationValidationError(
      `Unexpected create field: ${unexpected}`,
    );
  }
}

function toPositiveSafeInteger(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new AnswerSkillOptimizationValidationError(
      `${field} must be a positive safe integer`,
    );
  }
  return parsed;
}

function toNullablePositiveSafeInteger(
  value: unknown,
  field: string,
): number | null {
  return value === null ? null : toPositiveSafeInteger(value, field);
}

function normalizeUserId(userId: unknown): string {
  if (typeof userId !== "string" || !userId.trim()) {
    throw new AnswerSkillOptimizationValidationError("userId is required");
  }
  return userId;
}

function normalizeFeedback(feedback: unknown): string {
  if (typeof feedback !== "string") {
    throw new AnswerSkillOptimizationValidationError(
      "feedback must be a string",
    );
  }
  const normalized = feedback.trim();
  if (normalized.length < 1 || normalized.length > 2000) {
    throw new AnswerSkillOptimizationValidationError(
      "feedback must contain 1 to 2000 characters after trimming",
    );
  }
  return normalized;
}

function normalizeAdditionalFeedback(
  feedback: unknown,
  required: boolean,
): string | null {
  if (feedback === undefined && !required) return null;
  if (typeof feedback !== "string") {
    throw new AnswerSkillOptimizationValidationError(
      "additionalFeedback must be a string",
    );
  }
  const normalized = feedback.trim();
  if ((!normalized && required) || normalized.length > 1500) {
    throw new AnswerSkillOptimizationValidationError(
      required
        ? "additionalFeedback must contain 1 to 1500 characters after trimming"
        : "additionalFeedback must contain at most 1500 characters after trimming",
    );
  }
  return normalized || null;
}

function normalizeIdempotencyKey(value: unknown): string {
  if (typeof value !== "string") {
    throw new AnswerSkillOptimizationValidationError(
      "idempotencyKey must be a UUID",
    );
  }
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw new AnswerSkillOptimizationValidationError(
      "idempotencyKey must be a UUID",
    );
  }
  return normalized;
}

function isOptimizationStatus(
  value: unknown,
): value is AnswerSkillOptimizationStatus {
  return (
    typeof value === "string" &&
    ANSWER_SKILL_OPTIMIZATION_STATUSES.some((status) => status === value)
  );
}

function parseResultObject(value: unknown): AnswerSkillOptimizationResult {
  try {
    return parseAnswerSkillOptimizationResult(value);
  } catch (error) {
    if (error instanceof AnswerSkillOptimizationContractError) {
      throw new AnswerSkillOptimizationValidationError(error.message);
    }
    throw error;
  }
}

function normalizeNullableTargetSkillId(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !value.trim()) {
    throw new AnswerSkillOptimizationValidationError(
      "target_skill_id must be null or a non-empty string",
    );
  }
  return value;
}

function normalizeTimestamp(value: unknown, field: string): string {
  const timestamp =
    value instanceof Date
      ? value
      : typeof value === "string" && value.trim()
        ? new Date(value)
        : null;
  if (!timestamp || Number.isNaN(timestamp.getTime())) {
    throw new AnswerSkillOptimizationValidationError(`${field} is invalid`);
  }
  return timestamp.toISOString();
}

function toAnswerSkillOptimizationRun(
  row: DbRowAnswerSkillOptimizationRun,
): AnswerSkillOptimizationRun {
  if (!isOptimizationStatus(row.status)) {
    throw new AnswerSkillOptimizationValidationError(
      "Stored optimization status is invalid",
    );
  }
  const revision = toPositiveSafeInteger(row.revision, "revision");
  return {
    id: toPositiveSafeInteger(row.id, "id"),
    userId: normalizeUserId(row.user_id),
    packageId: toPositiveSafeInteger(row.package_id, "package_id"),
    threadId: toPositiveSafeInteger(row.thread_id, "thread_id"),
    baseVersionId: toPositiveSafeInteger(
      row.base_version_id,
      "base_version_id",
    ),
    questionMessageId: toPositiveSafeInteger(
      row.question_message_id,
      "question_message_id",
    ),
    enhancedAnswerMessageId: toPositiveSafeInteger(
      row.enhanced_answer_message_id,
      "enhanced_answer_message_id",
    ),
    baselineAnswerMessageId: toNullablePositiveSafeInteger(
      row.baseline_answer_message_id,
      "baseline_answer_message_id",
    ),
    answerSide:
      row.answer_side === "baseline" ? "baseline" : "enhanced",
    answerMessageId: toPositiveSafeInteger(
      row.answer_message_id ?? row.enhanced_answer_message_id,
      "answer_message_id",
    ),
    evidenceVersionId: toPositiveSafeInteger(
      row.evidence_version_id ?? row.base_version_id,
      "evidence_version_id",
    ),
    answerSkillVersionId: toNullablePositiveSafeInteger(
      row.answer_skill_version_id ?? null,
      "answer_skill_version_id",
    ),
    workingSkillVersionId: toNullablePositiveSafeInteger(
      row.working_skill_version_id ?? null,
      "working_skill_version_id",
    ),
    userFeedback: normalizeFeedback(row.user_feedback),
    targetSkillId: normalizeNullableTargetSkillId(row.target_skill_id),
    result: parseResultObject(row.result_json),
    status: row.status,
    revision,
    finalVersionId: toNullablePositiveSafeInteger(
      row.final_version_id,
      "final_version_id",
    ),
    createdAt: normalizeTimestamp(row.created_at, "created_at"),
    updatedAt: normalizeTimestamp(row.updated_at, "updated_at"),
  };
}

function answerRunSideProvenance(
  answerRun: ArenaAnswerRun,
  side: "baseline" | "enhanced",
) {
  return side === "baseline"
    ? {
        answerMessageId: answerRun.baselineAnswerMessageId,
        usedSkillIds: answerRun.baselineUsedSkillIds ?? [],
        contextMessageIds: answerRun.baselineContextMessageIds ?? null,
        model: answerRun.baselineModel ?? null,
        skillVersionId: answerRun.baselineSkillVersionId ?? null,
      }
    : {
        answerMessageId: answerRun.enhancedAnswerMessageId,
        usedSkillIds: answerRun.usedSkillIds,
        contextMessageIds: answerRun.contextMessageIds,
        model: answerRun.enhancedModel,
        skillVersionId: answerRun.enhancedSkillVersionId ?? null,
      };
}

export interface ResolveAnswerSkillOptimizationInput {
  userId: string;
  packageId: number;
  threadId: number;
  questionMessageId: number;
  answerMessageId: number;
  answerSide: "baseline" | "enhanced";
}

export interface AnswerSkillOptimizationReference {
  optimizationId: number;
  status: AnswerSkillOptimizationStatus;
  versionNumber: number | null;
}

export interface RebaseAnswerSkillOptimizationInput {
  userId: string;
  optimizationId: number;
  expectedRevision: number;
}

function assertAnswerOptimizationReplayAvailable(
  answerRun: ArenaAnswerRun,
  side: "baseline" | "enhanced" = "enhanced",
): void {
  const provenance = answerRunSideProvenance(answerRun, side);
  const availability = getAnswerOptimizationAvailability({
    contextMessageIds: provenance.contextMessageIds,
    enhancedModel: provenance.model,
  });
  if (availability.available) return;
  if (availability.reason === "missing_answer_run" || availability.reason === null) {
    throw new AnswerSkillOptimizationNotFoundError(
      "Arena answer run not found",
    );
  }
  throw new AnswerSkillOptimizationReplayUnavailableError(
    availability.reason,
  );
}

export function isAnswerSkillOptimizationProcessingStale(
  run: Pick<AnswerSkillOptimizationRun, "status" | "updatedAt">,
  nowMs = Date.now(),
): boolean {
  if (run.status !== "processing") return false;
  const updatedAtMs = Date.parse(run.updatedAt);
  return (
    Number.isFinite(updatedAtMs) &&
    updatedAtMs <=
      nowMs - ANSWER_SKILL_OPTIMIZATION_PROCESSING_STALE_AFTER_MS
  );
}

function withoutPendingIdempotencyRecords(
  result: AnswerSkillOptimizationResult,
): AnswerSkillOptimizationResult {
  const entries = Object.entries(result.idempotencyResults ?? {}).filter(
    ([, record]) =>
      record.responseSummary.status !== "processing" &&
      record.responseSummary.testOutcome !== "pending",
  );
  return {
    ...result,
    idempotencyResults: Object.fromEntries(entries),
    failure: {
      code: "operation_interrupted",
      message: INTERRUPTED_OPERATION_MESSAGE,
    },
  };
}

export async function recoverStaleAnswerSkillOptimizationRun(
  run: AnswerSkillOptimizationRun,
  now = new Date(),
): Promise<AnswerSkillOptimizationRun> {
  if (!isAnswerSkillOptimizationProcessingStale(run, now.getTime())) {
    return run;
  }
  const recoveredResult = withoutPendingIdempotencyRecords(run.result);
  const recoveredAt = now.toISOString();
  const updated = await query<DbRowAnswerSkillOptimizationRun>(
    `update answer_skill_optimization_runs
       set result_json = $1, status = 'failed', updated_at = $2
     where id = $3 and user_id = $4
       and status = 'processing' and revision = $5
       and updated_at = $6::timestamptz
     returning *`,
    [
      JSON.stringify(recoveredResult),
      recoveredAt,
      run.id,
      run.userId,
      run.revision,
      run.updatedAt,
    ],
  );
  const row = updated.rows[0];
  if (row) return toAnswerSkillOptimizationRun(row);
  return getAnswerSkillOptimizationRun(run.userId, run.id);
}

async function recoverStaleAnswerSkillOptimizationsForThread(
  userId: string,
  threadId: number,
  now = new Date(),
): Promise<void> {
  const recoveredAt = now.toISOString();
  const cutoff = new Date(
    now.getTime() - ANSWER_SKILL_OPTIMIZATION_PROCESSING_STALE_AFTER_MS,
  ).toISOString();
  const failure = JSON.stringify({
    code: "operation_interrupted",
    message: INTERRUPTED_OPERATION_MESSAGE,
  });
  await query(
    `update answer_skill_optimization_runs o
       set result_json = jsonb_set(
             jsonb_set(o.result_json, '{failure}', $3::jsonb, true),
             '{idempotencyResults}',
             coalesce(
               (
                 select jsonb_object_agg(entry.key, entry.value)
                 from jsonb_each(
                   coalesce(o.result_json -> 'idempotencyResults', '{}'::jsonb)
                 ) as entry
                 where coalesce(
                         entry.value #>> '{responseSummary,status}',
                         ''
                       ) <> 'processing'
                   and coalesce(
                         entry.value #>> '{responseSummary,testOutcome}',
                         ''
                       ) <> 'pending'
               ),
               '{}'::jsonb
             ),
             true
           ),
           status = 'failed',
           updated_at = $4
     where o.user_id = $1 and o.thread_id = $2
       and o.status = 'processing'
       and o.updated_at <= $5::timestamptz`,
    [userId, threadId, failure, recoveredAt, cutoff],
  );
}

function buildCreateRequestHash(input: {
  packageId: number;
  threadId: number;
  questionMessageId: number;
  answerSide: "baseline" | "enhanced";
  answerMessageId: number;
  baselineAnswerMessageId: number | null;
  feedback: string;
}): string {
  const stableRequest = JSON.stringify({
    packageId: input.packageId,
    threadId: input.threadId,
    questionMessageId: input.questionMessageId,
    answerSide: input.answerSide,
    answerMessageId: input.answerMessageId,
    baselineAnswerMessageId: input.baselineAnswerMessageId,
    feedback: input.feedback,
  });
  return createHash("sha256").update(stableRequest, "utf8").digest("hex");
}

function isCreateRequestKeyUniqueViolation(error: unknown): boolean {
  if (
    error === null ||
    typeof error !== "object" ||
    !("code" in error) ||
    !("constraint" in error)
  ) {
    return false;
  }
  const databaseError = error as { code?: unknown; constraint?: unknown };
  return (
    databaseError.code === "23505" &&
    databaseError.constraint === CREATE_REQUEST_KEY_UNIQUE_CONSTRAINT
  );
}

function isNonCancelledAnswerUniqueViolation(error: unknown): boolean {
  if (
    error === null ||
    typeof error !== "object" ||
    !("code" in error) ||
    !("constraint" in error)
  ) {
    return false;
  }
  const databaseError = error as { code?: unknown; constraint?: unknown };
  return (
    databaseError.code === "23505" &&
    databaseError.constraint === NON_CANCELLED_ANSWER_UNIQUE_CONSTRAINT
  );
}

async function findByCreateRequestKey(
  userId: string,
  createRequestKey: string,
): Promise<DbRowAnswerSkillOptimizationRun | null> {
  const result = await query<DbRowAnswerSkillOptimizationRun>(
    `select * from answer_skill_optimization_runs
     where user_id = $1 and create_request_key = $2`,
    [userId, createRequestKey],
  );
  return result.rows[0] ?? null;
}

async function findNonCancelledByAnswer(
  userId: string,
  answerMessageId: number,
): Promise<DbRowExistingAnswerOptimization | null> {
  const result = await query<DbRowExistingAnswerOptimization>(
    `select r.*, sv.version_number as final_version_number
       from answer_skill_optimization_runs r
       left join agent_package_skills ps
         on ps.package_id = r.package_id and ps.skill_uid = r.target_skill_id
       left join agent_package_version_skills pvs
         on pvs.package_version_id = r.final_version_id and pvs.skill_id = ps.id
       left join agent_skill_versions sv on sv.id = pvs.skill_version_id
      where r.user_id = $1
        and (
          r.answer_message_id = $2
          or (r.answer_message_id is null and r.enhanced_answer_message_id = $2)
        )
        and r.status <> 'cancelled'
      order by r.id desc
      limit 1`,
    [userId, answerMessageId],
  );
  return result.rows[0] ?? null;
}

function existingOptimizationError(
  row: DbRowExistingAnswerOptimization,
): AnswerSkillOptimizationAlreadyExistsError {
  return new AnswerSkillOptimizationAlreadyExistsError(
    toAnswerSkillOptimizationRun(row),
    toNullablePositiveSafeInteger(
      row.final_version_number,
      "final_version_number",
    ),
  );
}

function assertMatchingId(
  field: string,
  requested: number,
  recorded: number,
): void {
  if (requested !== recorded) {
    throw new AnswerSkillOptimizationValidationError(
      `${field} does not match the recorded Arena answer run`,
    );
  }
}

export async function createAnswerSkillOptimizationRun(
  input: CreateAnswerSkillOptimizationRunInput,
): Promise<AnswerSkillOptimizationRun> {
  return (await createAnswerSkillOptimizationRunWithOutcome(input)).run;
}

export async function createAnswerSkillOptimizationRunWithOutcome(
  input: CreateAnswerSkillOptimizationRunInput,
): Promise<CreateAnswerSkillOptimizationOutcome> {
  assertKnownCreateFields(input);
  const userId = normalizeUserId(input.userId);
  const packageId = toPositiveSafeInteger(input.packageId, "packageId");
  const threadId = toPositiveSafeInteger(input.threadId, "threadId");
  const questionMessageId = toPositiveSafeInteger(
    input.questionMessageId,
    "questionMessageId",
  );
  const enhancedAnswerMessageId = toPositiveSafeInteger(
    input.enhancedAnswerMessageId,
    "enhancedAnswerMessageId",
  );
  const requestedBaselineAnswerMessageId =
    input.baselineAnswerMessageId === undefined
      ? undefined
      : toNullablePositiveSafeInteger(
          input.baselineAnswerMessageId,
          "baselineAnswerMessageId",
        );
  const answerSide = input.answerSide ?? "enhanced";
  if (answerSide !== "baseline" && answerSide !== "enhanced") {
    throw new AnswerSkillOptimizationValidationError(
      "answerSide must be baseline or enhanced",
    );
  }
  const answerMessageId = toPositiveSafeInteger(
    input.answerMessageId
      ?? (answerSide === "baseline"
        ? requestedBaselineAnswerMessageId
        : enhancedAnswerMessageId),
    "answerMessageId",
  );
  const feedback = normalizeFeedback(input.feedback);
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);

  let answerRun: ArenaAnswerRun;
  try {
    answerRun = answerSide === "enhanced"
      ? await getArenaAnswerRunByEnhancedMessage(userId, answerMessageId)
      : await getArenaAnswerRunByMessage(userId, answerMessageId);
  } catch (error) {
    if (error instanceof ArenaAnswerRunNotFoundError) {
      throw new AnswerSkillOptimizationNotFoundError(
        "Arena answer run not found",
      );
    }
    throw error;
  }

  if (answerRun.userId !== userId) {
    throw new AnswerSkillOptimizationNotFoundError("Arena answer run not found");
  }
  const recordedPackageId = toPositiveSafeInteger(
    answerRun.packageId,
    "arenaAnswerRun.packageId",
  );
  const recordedThreadId = toPositiveSafeInteger(
    answerRun.threadId,
    "arenaAnswerRun.threadId",
  );
  const recordedQuestionMessageId = toPositiveSafeInteger(
    answerRun.questionMessageId,
    "arenaAnswerRun.questionMessageId",
  );
  const recordedEnhancedAnswerMessageId = toPositiveSafeInteger(
    answerRun.enhancedAnswerMessageId,
    "arenaAnswerRun.enhancedAnswerMessageId",
  );
  const recordedBaselineAnswerMessageId = toNullablePositiveSafeInteger(
    answerRun.baselineAnswerMessageId,
    "arenaAnswerRun.baselineAnswerMessageId",
  );
  const baseVersionId = toPositiveSafeInteger(
    answerRun.packageVersionId,
    "arenaAnswerRun.packageVersionId",
  );
  const sideProvenance = answerRunSideProvenance(answerRun, answerSide);

  assertMatchingId("packageId", packageId, recordedPackageId);
  assertMatchingId("threadId", threadId, recordedThreadId);
  assertMatchingId(
    "questionMessageId",
    questionMessageId,
    recordedQuestionMessageId,
  );
  assertMatchingId(
    "answerMessageId",
    answerMessageId,
    toPositiveSafeInteger(
      sideProvenance.answerMessageId,
      "arenaAnswerRun.answerMessageId",
    ),
  );
  assertMatchingId(
    "enhancedAnswerMessageId",
    enhancedAnswerMessageId,
    recordedEnhancedAnswerMessageId,
  );
  if (
    requestedBaselineAnswerMessageId !== undefined &&
    requestedBaselineAnswerMessageId !== recordedBaselineAnswerMessageId
  ) {
    throw new AnswerSkillOptimizationValidationError(
      "baselineAnswerMessageId does not match the recorded Arena answer run",
    );
  }

  const requestHash = buildCreateRequestHash({
    packageId,
    threadId,
    questionMessageId,
    answerSide,
    answerMessageId,
    baselineAnswerMessageId: recordedBaselineAnswerMessageId,
    feedback,
  });
  const now = new Date().toISOString();
  let existingForAnswer = await findNonCancelledByAnswer(
    userId,
    answerMessageId,
  );
  if (existingForAnswer) {
    const existingRun = toAnswerSkillOptimizationRun(existingForAnswer);
    if (existingRun.status === "completed") {
      if (existingForAnswer.create_request_key === idempotencyKey) {
        if (existingForAnswer.create_request_hash !== requestHash) {
          throw new AnswerSkillOptimizationConflictError(
            "Idempotency key was already used for a different create request",
          );
        }
        return { run: existingRun, created: false };
      }
      throw existingOptimizationError(existingForAnswer);
    }
  }

  assertAnswerOptimizationReplayAvailable(answerRun, answerSide);

  if (existingForAnswer) {
    const existingRun = toAnswerSkillOptimizationRun(existingForAnswer);
    if (isAnswerSkillOptimizationProcessingStale(existingRun)) {
      await recoverStaleAnswerSkillOptimizationRun(existingRun);
      existingForAnswer =
        (await findNonCancelledByAnswer(
          userId,
          answerMessageId,
        )) ?? existingForAnswer;
    }
    if (existingForAnswer.create_request_key === idempotencyKey) {
      if (existingForAnswer.create_request_hash !== requestHash) {
        throw new AnswerSkillOptimizationConflictError(
          "Idempotency key was already used for a different create request",
        );
      }
      return {
        run: toAnswerSkillOptimizationRun(existingForAnswer),
        created: false,
      };
    }
    throw existingOptimizationError(existingForAnswer);
  }

  try {
    const result = await query<DbRowAnswerSkillOptimizationRun>(
      `insert into answer_skill_optimization_runs
         (user_id, package_id, thread_id, base_version_id,
           question_message_id, enhanced_answer_message_id,
           baseline_answer_message_id, user_feedback, target_skill_id,
           result_json, status, revision, create_request_key,
           create_request_hash, final_version_id, created_at, updated_at,
           answer_side, answer_message_id, evidence_version_id,
           answer_skill_version_id, working_skill_version_id)
       values
         ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
          $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
       returning *`,
      [
        userId,
        packageId,
        threadId,
        baseVersionId,
        questionMessageId,
        enhancedAnswerMessageId,
        recordedBaselineAnswerMessageId,
        feedback,
        null,
        JSON.stringify({}),
        "processing",
        1,
        idempotencyKey,
        requestHash,
        null,
        now,
        now,
        answerSide,
        answerMessageId,
        baseVersionId,
        sideProvenance.skillVersionId,
        sideProvenance.skillVersionId,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Optimization insert returned no row");
    return { run: toAnswerSkillOptimizationRun(row), created: true };
  } catch (error) {
    if (isCreateRequestKeyUniqueViolation(error)) {
      const existing = await findByCreateRequestKey(userId, idempotencyKey);
      if (!existing) throw error;
      if (existing.create_request_hash !== requestHash) {
        throw new AnswerSkillOptimizationConflictError(
          "Idempotency key was already used for a different create request",
        );
      }
      return { run: toAnswerSkillOptimizationRun(existing), created: false };
    }
    if (!isNonCancelledAnswerUniqueViolation(error)) throw error;

    const concurrent = await findNonCancelledByAnswer(
      userId,
      answerMessageId,
    );
    if (!concurrent) throw error;
    if (concurrent.create_request_key === idempotencyKey) {
      if (concurrent.create_request_hash !== requestHash) {
        throw new AnswerSkillOptimizationConflictError(
          "Idempotency key was already used for a different create request",
        );
      }
      return {
        run: toAnswerSkillOptimizationRun(concurrent),
        created: false,
      };
    }
    throw existingOptimizationError(concurrent);
  }
}

export async function getAnswerSkillOptimizationRun(
  userIdInput: string,
  optimizationIdInput: number,
): Promise<AnswerSkillOptimizationRun> {
  const userId = normalizeUserId(userIdInput);
  const optimizationId = toPositiveSafeInteger(
    optimizationIdInput,
    "optimizationId",
  );
  const result = await query<DbRowAnswerSkillOptimizationRun>(
    `select * from answer_skill_optimization_runs
     where user_id = $1 and id = $2`,
    [userId, optimizationId],
  );
  const row = result.rows[0];
  if (!row) throw new AnswerSkillOptimizationNotFoundError();
  return toAnswerSkillOptimizationRun(row);
}

export async function listAnswerOptimizationSummariesForThread(
  userIdInput: string,
  threadIdInput: number,
): Promise<ArenaAnswerOptimizationSummary[]> {
  const userId = normalizeUserId(userIdInput);
  const threadId = toPositiveSafeInteger(threadIdInput, "threadId");
  await recoverStaleAnswerSkillOptimizationsForThread(userId, threadId);
  const result = await query<DbRowAnswerOptimizationSummary>(
    `select
       m.id as enhanced_answer_message_id,
       ar.id as answer_run_id,
       ar.context_message_ids,
       ar.enhanced_model,
       o.id as optimization_id,
       o.status,
       o.final_version_id,
       v.version_number
     from arena_messages m
     left join arena_answer_runs ar
       on ar.user_id = m.user_id
      and ar.thread_id = m.thread_id
      and ar.enhanced_answer_message_id = m.id
     left join lateral (
       select r.id, r.status, r.final_version_id
       from answer_skill_optimization_runs r
       where r.user_id = m.user_id
         and r.enhanced_answer_message_id = m.id
       order by (r.status = 'cancelled') asc, r.id desc
       limit 1
     ) o on true
     left join agent_package_versions v on v.id = o.final_version_id
     where m.user_id = $1
       and m.thread_id = $2
       and m.side = 'enhanced'
       and m.role = 'assistant'
     order by m.created_at asc, m.id asc`,
    [userId, threadId],
  );

  return result.rows.map((row) => {
    const enhancedAnswerMessageId = toPositiveSafeInteger(
      row.enhanced_answer_message_id,
      "enhanced_answer_message_id",
    );
    const availability =
      row.answer_run_id === null
        ? getAnswerOptimizationAvailability(null)
        : getAnswerOptimizationAvailability({
            contextMessageIds: parseArenaAnswerContextMessageIds(
              row.context_message_ids,
            ),
            enhancedModel: parseArenaAnswerEnhancedModel(row.enhanced_model),
          });
    const status =
      row.optimization_id === null
        ? null
        : isOptimizationStatus(row.status)
          ? row.status
          : (() => {
              throw new AnswerSkillOptimizationValidationError(
                "Stored optimization summary status is invalid",
              );
            })();
    const optimizationId =
      row.optimization_id === null
        ? null
        : toPositiveSafeInteger(row.optimization_id, "optimization_id");
    const finalVersionId = toNullablePositiveSafeInteger(
      row.final_version_id,
      "final_version_id",
    );
    const versionNumber = toNullablePositiveSafeInteger(
      row.version_number,
      "version_number",
    );

    if (status === "completed") {
      return {
        enhancedAnswerMessageId,
        optimizationId,
        status,
        finalVersionId,
        versionNumber,
        canOptimize: false,
        action: "completed",
        unavailableReason: null,
      };
    }
    if (!availability.available) {
      return {
        enhancedAnswerMessageId,
        optimizationId,
        status,
        finalVersionId,
        versionNumber,
        canOptimize: false,
        action: "unavailable",
        unavailableReason: availability.reason,
      };
    }
    if (optimizationId === null || status === null) {
      return {
        enhancedAnswerMessageId,
        optimizationId: null,
        status: null,
        finalVersionId: null,
        versionNumber: null,
        canOptimize: true,
        action: "create",
        unavailableReason: null,
      };
    }
    const cancelled = status === "cancelled";
    return {
      enhancedAnswerMessageId,
      optimizationId,
      status,
      finalVersionId,
      versionNumber,
      canOptimize: true,
      action: cancelled ? "restart" : "resume",
      unavailableReason: null,
    };
  });
}

const REVISE_ALLOWED_STATUSES: readonly AnswerSkillOptimizationStatus[] = [
  "target_selection_required",
  "draft_ready",
  "test_ready",
  "failed",
];

const CANCEL_ALLOWED_STATUSES: readonly AnswerSkillOptimizationStatus[] = [
  "processing",
  "target_selection_required",
  "draft_ready",
  "test_ready",
  "failed",
];

const TEST_ALLOWED_STATUSES = ["draft_ready", "test_ready"] as const;

function assertKnownFields(
  input: object,
  fields: readonly string[],
  operation: string,
): void {
  const allowed = new Set(fields);
  const unexpected = Object.keys(input).find((field) => !allowed.has(field));
  if (unexpected) {
    throw new AnswerSkillOptimizationValidationError(
      `Unexpected ${operation} field: ${unexpected}`,
    );
  }
}

function normalizeOptionalSkillId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new AnswerSkillOptimizationValidationError(
      "targetSkillId must be a string",
    );
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > 128) {
    throw new AnswerSkillOptimizationValidationError(
      "targetSkillId must contain 1 to 128 characters",
    );
  }
  return normalized;
}

function normalizeTargetSkillIds(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new AnswerSkillOptimizationValidationError(
      "targetSkillIds must be an array of strings",
    );
  }
  if (value.length === 0 || value.length > MAX_PLANNED_TARGETS) {
    throw new AnswerSkillOptimizationValidationError(
      `targetSkillIds must contain 1 to ${MAX_PLANNED_TARGETS} items`,
    );
  }
  const normalized = value.map((item, index) => {
    if (typeof item !== "string") {
      throw new AnswerSkillOptimizationValidationError(
        `targetSkillIds[${index}] must be a string`,
      );
    }
    const trimmed = item.trim();
    if (!trimmed || trimmed.length > 128) {
      throw new AnswerSkillOptimizationValidationError(
        `targetSkillIds[${index}] must contain 1 to 128 characters`,
      );
    }
    return trimmed;
  });
  const seen = new Set<string>();
  for (const id of normalized) {
    if (seen.has(id)) {
      throw new AnswerSkillOptimizationValidationError(
        "targetSkillIds contains duplicate skillId",
      );
    }
    seen.add(id);
  }
  return normalized;
}

function normalizeCancelReason(value: unknown): AnswerOptimizationCancelReason {
  if (
    typeof value !== "string" ||
    !ANSWER_OPTIMIZATION_CANCEL_REASONS.some((reason) => reason === value)
  ) {
    throw new AnswerSkillOptimizationValidationError(
      "reason must be user_cancelled, no_longer_needed, or restart_required",
    );
  }
  return value as AnswerOptimizationCancelReason;
}

function createMutationHash(value: Record<string, unknown>): string {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

function toArenaMessage(row: DbRowMessage): ArenaMessage {
  const id = toPositiveSafeInteger(row.id, "message.id");
  const threadId = toPositiveSafeInteger(row.thread_id, "message.thread_id");
  if (
    (row.side !== "shared" &&
      row.side !== "baseline" &&
      row.side !== "enhanced") ||
    (row.role !== "user" && row.role !== "assistant")
  ) {
    throw new AnswerSkillOptimizationDraftError(
      "Stored Arena message has an invalid role or side",
      "context_invalid",
    );
  }
  if (typeof row.content !== "string" || !row.content.trim()) {
    throw new AnswerSkillOptimizationDraftError(
      "Stored Arena message content is empty",
      "context_invalid",
    );
  }
  return {
    id,
    threadId,
    side: row.side,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
  };
}

async function getOwnedArenaMessage(
  userId: string,
  threadId: number,
  messageId: number,
  expectedSide: ArenaMessage["side"],
  expectedRole: ArenaMessage["role"],
): Promise<ArenaMessage> {
  const result = await query<DbRowMessage>(
    `select * from arena_messages
     where id = $1 and thread_id = $2 and user_id = $3`,
    [messageId, threadId, userId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new AnswerSkillOptimizationNotFoundError("Arena message not found");
  }
  const message = toArenaMessage(row);
  if (message.side !== expectedSide || message.role !== expectedRole) {
    throw new AnswerSkillOptimizationDraftError(
      "Arena message does not match the recorded answer role",
      "context_invalid",
    );
  }
  return message;
}

function validateBaseSkills(skills: PackageSkill[]): PackageSkill[] {
  if (!Array.isArray(skills) || skills.length === 0) {
    throw new AnswerSkillOptimizationDraftError(
      "Base version does not contain any Skills",
      "context_invalid",
    );
  }
  const ids = new Set<string>();
  for (const skill of skills) {
    if (
      typeof skill.id !== "string" ||
      !skill.id.trim() ||
      typeof skill.dirName !== "string" ||
      !skill.dirName.trim() ||
      typeof skill.name !== "string" ||
      !skill.name.trim() ||
      typeof skill.description !== "string" ||
      !skill.description.trim() ||
      typeof skill.skillMd !== "string" ||
      !skill.skillMd.trim()
    ) {
      throw new AnswerSkillOptimizationDraftError(
        "Base version contains an invalid Skill",
        "context_invalid",
      );
    }
    if (ids.has(skill.id)) {
      throw new AnswerSkillOptimizationDraftError(
        "Base version contains duplicate Skill IDs",
        "context_invalid",
      );
    }
    ids.add(skill.id);
  }
  return skills;
}

function assertRunMatchesProvenance(
  run: AnswerSkillOptimizationRun,
  answerRun: ArenaAnswerRun,
): void {
  const matches =
    answerRun.userId === run.userId &&
    answerRun.packageId === run.packageId &&
    answerRun.threadId === run.threadId &&
    answerRun.packageVersionId === run.evidenceVersionId &&
    answerRun.questionMessageId === run.questionMessageId &&
    answerRun.enhancedAnswerMessageId === run.enhancedAnswerMessageId &&
    answerRun.baselineAnswerMessageId === run.baselineAnswerMessageId;
  if (!matches) {
    throw new AnswerSkillOptimizationDraftError(
      "Optimization task no longer matches its Arena answer provenance",
      "context_invalid",
    );
  }
}

async function getVerifiedArenaAnswerRun(
  run: AnswerSkillOptimizationRun,
): Promise<ArenaAnswerRun> {
  let answerRun: ArenaAnswerRun;
  try {
    answerRun = run.answerSide === "enhanced"
      ? await getArenaAnswerRunByEnhancedMessage(run.userId, run.answerMessageId)
      : await getArenaAnswerRunByMessage(run.userId, run.answerMessageId);
  } catch (error) {
    if (error instanceof ArenaAnswerRunNotFoundError) {
      throw new AnswerSkillOptimizationNotFoundError(
        "Arena answer run not found",
      );
    }
    throw error;
  }
  assertRunMatchesProvenance(run, answerRun);
  return answerRun;
}

async function loadAnswerSkillOptimizationContext(
  run: AnswerSkillOptimizationRun,
): Promise<AnswerSkillOptimizationContext> {
  const answerRun = await getVerifiedArenaAnswerRun(run);
  const threadResult = await query<DbRowThread>(
    `select * from arena_threads
     where id = $1 and user_id = $2 and package_id = $3`,
    [run.threadId, run.userId, run.packageId],
  );
  const thread = threadResult.rows[0];
  if (!thread) {
    throw new AnswerSkillOptimizationNotFoundError("Arena thread not found");
  }
  let version: PackageVersion;
  try {
    version = await getVersion(
      run.userId,
      run.packageId,
      String(run.baseVersionId),
    );
  } catch {
    throw new AnswerSkillOptimizationNotFoundError(
      "Base Package version not found",
    );
  }
  version = {
    ...version,
    id: toPositiveSafeInteger(version.id, "version.id"),
    packageId: toPositiveSafeInteger(version.packageId, "version.package_id"),
  };
  if (
    run.answerSkillVersionId !== null
    && run.baseVersionId === run.evidenceVersionId
  ) {
    const skillVersion = await getSkillVersionDetail({
      authUserId: run.userId,
      packageId: String(run.packageId),
      versionId: String(run.answerSkillVersionId),
    });
    const evidenceSkill = skillVersion.skill;
    version = {
      ...version,
      snapshot: {
        ...version.snapshot,
        skills: version.snapshot.skills.map((skill) =>
          skill.id === evidenceSkill.id ? evidenceSkill : skill,
        ),
      },
    };
  }
  if (version.id !== run.baseVersionId || version.packageId !== run.packageId) {
    throw new AnswerSkillOptimizationDraftError(
      "Loaded Package version does not match the optimization base version",
      "context_invalid",
    );
  }
  const skills = validateBaseSkills(version.snapshot.skills);
  const skillIds = new Set(skills.map((skill) => skill.id));
  const sideProvenance = answerRunSideProvenance(
    answerRun,
    run.answerSide,
  );
  if (sideProvenance.usedSkillIds.some((skillId) => !skillIds.has(skillId))) {
    throw new AnswerSkillOptimizationDraftError(
      "Recorded Skill is missing from the base Package version",
      "context_invalid",
    );
  }

  const question = await getOwnedArenaMessage(
    run.userId,
    run.threadId,
    run.questionMessageId,
    "shared",
    "user",
  );
  const originalAnswer = await getOwnedArenaMessage(
    run.userId,
    run.threadId,
    run.answerMessageId,
    run.answerSide,
    "assistant",
  );
  const comparisonMessageId = run.answerSide === "baseline"
    ? run.enhancedAnswerMessageId
    : run.baselineAnswerMessageId;
  const baselineAnswer =
    comparisonMessageId === null
      ? null
      : await getOwnedArenaMessage(
          run.userId,
          run.threadId,
          comparisonMessageId,
          run.answerSide === "baseline" ? "enhanced" : "baseline",
          "assistant",
        );

  return {
    run,
    answerRun,
    version,
    question,
    originalAnswer,
    baselineAnswer,
    skills,
    usedSkillIds: [...sideProvenance.usedSkillIds],
  };
}

interface PublicAnswerOptimizationDraft
  extends Pick<AnswerOptimizationDraft, "skillId" | "validation"> {
  previewContent: string;
}

export function publicDraft(
  draft: AnswerOptimizationDraft | null | undefined,
): PublicAnswerOptimizationDraft | null {
  return draft
    ? {
        skillId: draft.skillId,
        validation: draft.validation,
        previewContent: draft.skillMd,
      }
    : null;
}

function publicTestResult(
  run: Pick<AnswerSkillOptimizationRun, "answerSkillVersionId">,
  result: AnswerOptimizationTestResult | null | undefined,
): PublicAnswerOptimizationTestResult | null {
  if (!result) return null;
  const hasRecordedFixedSkill =
    run.answerSkillVersionId !== null &&
    result.usedSkillIds.includes(result.runtimeSelectionCheck.targetSkillId);
  const runtimeSelectionCheck = hasRecordedFixedSkill
    ? {
        targetSkillId: result.runtimeSelectionCheck.targetSkillId,
        selectedSkillIds: [...result.usedSkillIds],
        targetSkillSelected: true,
      }
    : result.runtimeSelectionCheck;
  const passedCount = result.samples.filter((sample) => sample.passed).length;
  const qualityGate = hasRecordedFixedSkill
    ? {
        ...result.qualityGate,
        passed:
          passedCount >= 2 &&
          !result.samples.some((sample) => sample.criticalRisk),
        passedCount,
      }
    : result.qualityGate;
  return {
    testedRevision: result.testedRevision,
    question: result.question,
    beforeAnswer: result.beforeAnswer,
    afterAnswer: result.afterAnswer,
    samples: result.samples,
    qualityGate,
    runtimeSelectionCheck,
    createdAt: result.createdAt,
  };
}

function syncPlannedTargetsForView(
  run: AnswerSkillOptimizationRun,
): AnswerOptimizationPlannedTarget[] {
  const planned = run.result.plannedTargets ?? [];
  if (planned.length === 0) return [];
  const topPatch = run.result.patch ?? null;
  const topTarget = run.result.targetSkill ?? null;
  if (!topPatch || !topTarget) return planned;
  return planned.map((target) =>
    target.status === "active" && target.skillId === topTarget.skillId
      ? { ...target, patch: topPatch }
      : target,
  );
}

function toDetailDto(
  run: AnswerSkillOptimizationRun,
  context: AnswerSkillOptimizationContext,
): AnswerSkillOptimizationDetailDto {
  const replayProvenance = answerRunSideProvenance(
    context.answerRun,
    run.answerSide,
  );
  const replayAvailability = getAnswerOptimizationAvailability({
    contextMessageIds: replayProvenance.contextMessageIds,
    enhancedModel: replayProvenance.model,
  });
  return {
    optimizationId: run.id,
    packageId: run.packageId,
    threadId: run.threadId,
    baseVersionId: run.baseVersionId,
    evidenceVersionId: run.evidenceVersionId,
    answerSide: run.answerSide,
    answerMessageId: run.answerMessageId,
    answerSkillVersionId: run.answerSkillVersionId,
    workingSkillVersionId: run.workingSkillVersionId,
    status: run.status,
    revision: run.revision,
    feedback: run.userFeedback,
    question: { messageId: context.question.id, content: context.question.content },
    originalAnswer: {
      messageId: context.originalAnswer.id,
      content: context.originalAnswer.content,
    },
    baselineAnswer: context.baselineAnswer
      ? {
          messageId: context.baselineAnswer.id,
          content: context.baselineAnswer.content,
        }
      : null,
    diagnosis: run.result.diagnosis ?? null,
    targetSkill: run.result.targetSkill ?? null,
    candidateSkills: run.result.candidateSkills ?? [],
    patch: run.result.patch ?? null,
    draft: publicDraft(run.result.draft),
    diff: run.result.diff ?? null,
    testResult: publicTestResult(run, run.result.testResult),
    refinementHistory: run.result.refinementHistory ?? [],
    failureCode: run.result.failure?.code ?? null,
    finalVersionId: run.finalVersionId,
    plannedTargets: syncPlannedTargetsForView(run),
    replayAvailability,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

function toReviseDto(
  run: AnswerSkillOptimizationRun,
): ReviseAnswerSkillOptimizationDto {
  return {
    optimizationId: run.id,
    status: run.status,
    revision: run.revision,
    feedback: run.userFeedback,
    diagnosis: run.result.diagnosis ?? null,
    targetSkill: run.result.targetSkill ?? null,
    candidateSkills: run.result.candidateSkills ?? [],
    patch: run.result.patch ?? null,
    draft: publicDraft(run.result.draft),
    diff: run.result.diff ?? null,
    testResult: null,
    refinementHistory: run.result.refinementHistory ?? [],
    plannedTargets: syncPlannedTargetsForView(run),
    updatedAt: run.updatedAt,
  };
}

function parseRepairProposedContent(value: unknown): string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new AnswerSkillOptimizationDraftError(
      "Skill repair output must be an object",
      "skill_validation_failed",
    );
  }
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object);
  if (keys.length !== 1 || keys[0] !== "proposedContent") {
    throw new AnswerSkillOptimizationDraftError(
      "Skill repair output contains unsupported fields",
      "skill_validation_failed",
    );
  }
  if (typeof object.proposedContent !== "string") {
    throw new AnswerSkillOptimizationDraftError(
      "Skill repair proposedContent must be a string",
      "skill_validation_failed",
    );
  }
  const proposedContent = object.proposedContent.trim();
  if (!proposedContent || proposedContent.length > 12000) {
    throw new AnswerSkillOptimizationDraftError(
      "Skill repair proposedContent is invalid",
      "skill_validation_failed",
    );
  }
  return proposedContent;
}

const HAN_CHARACTER_PATTERN = /\p{Script=Han}/u;
const UPPERCASE_IDENTIFIER_PATTERN = /^[A-Z0-9][A-Z0-9_.:/+-]{1,31}$/;

function containsHanCharacter(value: string): boolean {
  return HAN_CHARACTER_PATTERN.test(value);
}

function userFacingTextNeedsChinese(value: string): boolean {
  const normalized = value.trim();
  if (!normalized || containsHanCharacter(normalized)) return false;
  return !UPPERCASE_IDENTIFIER_PATTERN.test(normalized);
}

function isPrimarilyChineseSkill(skill: PackageSkill): boolean {
  const hanCount = skill.skillMd.match(/\p{Script=Han}/gu)?.length ?? 0;
  const latinCount = skill.skillMd.match(/[A-Za-z]/g)?.length ?? 0;
  return hanCount >= 8 && hanCount * 2 >= latinCount;
}

function optimizationUserFacingTexts(
  output: AnswerOptimizationModelOutput,
  translateProposedContent: boolean,
): string[] {
  return [
    output.diagnosis.summary,
    ...output.diagnosis.riskNotes,
    ...output.candidateSkills.map((candidate) => candidate.reason),
    ...(output.patch
      ? [
          output.patch.reason,
          ...(translateProposedContent
            ? [output.patch.proposedContent]
            : []),
        ]
      : []),
  ];
}

function optimizationOutputNeedsChineseLocalization(
  output: AnswerOptimizationModelOutput,
  translateProposedContent: boolean,
): boolean {
  return optimizationUserFacingTexts(
    output,
    translateProposedContent,
  ).some(userFacingTextNeedsChinese);
}

function assertOptimizationLocalizationPreservesStructure(
  original: AnswerOptimizationModelOutput,
  localized: AnswerOptimizationModelOutput,
  translateProposedContent: boolean,
): void {
  const invalid =
    localized.diagnosis.reusability !== original.diagnosis.reusability ||
    localized.diagnosis.riskNotes.length !==
      original.diagnosis.riskNotes.length ||
    localized.targetSkillId !== original.targetSkillId ||
    localized.candidateSkills.length !== original.candidateSkills.length ||
    localized.candidateSkills.some(
      (candidate, index) =>
        candidate.skillId !== original.candidateSkills[index]?.skillId,
    ) ||
    Boolean(localized.patch) !== Boolean(original.patch) ||
    (localized.patch !== null &&
      original.patch !== null &&
      (localized.patch.section !== original.patch.section ||
        localized.patch.operation !== original.patch.operation ||
        (!translateProposedContent &&
          localized.patch.proposedContent !==
            original.patch.proposedContent)));
  if (invalid) {
    throw new AnswerSkillOptimizationContractError(
      "Localization changed protected optimization fields",
    );
  }
}

async function localizeOptimizationModelOutput(
  output: AnswerOptimizationModelOutput,
  options: ParseAnswerOptimizationModelOutputOptions,
): Promise<AnswerOptimizationModelOutput> {
  const targetSkill =
    output.targetSkillId === null
      ? null
      : options.skills.find((skill) => skill.id === output.targetSkillId) ??
        null;
  const translateProposedContent =
    targetSkill !== null && isPrimarilyChineseSkill(targetSkill);
  if (
    !optimizationOutputNeedsChineseLocalization(
      output,
      translateProposedContent,
    )
  ) {
    return output;
  }

  const prompt = buildAnswerSkillOptimizationLocalizationPrompt({
    output,
    translateProposedContent,
  });
  let localized: AnswerOptimizationModelOutput;
  try {
    const raw = await generateJson<unknown>(
      {
        ...prompt,
        temperature: 0,
        maxTokens: 4000,
      },
      0,
      false,
    );
    localized = parseAnswerOptimizationModelOutput(raw, options);
    assertOptimizationLocalizationPreservesStructure(
      output,
      localized,
      translateProposedContent,
    );
  } catch (error) {
    if (error instanceof AnswerSkillOptimizationUpstreamError) throw error;
    if (
      error instanceof LlmInvalidJsonError ||
      error instanceof AnswerSkillOptimizationContractError
    ) {
      throw new AnswerSkillOptimizationDraftError(
        "模型返回的用户可见文本无法安全转换为简体中文",
        "model_output_invalid",
      );
    }
    throw new AnswerSkillOptimizationUpstreamError(
      `Optimization localization model is temporarily unavailable: ${
        error instanceof Error ? error.message : "unknown upstream error"
      }`,
    );
  }
  if (
    optimizationOutputNeedsChineseLocalization(
      localized,
      translateProposedContent,
    )
  ) {
    throw new AnswerSkillOptimizationDraftError(
      "模型返回的用户可见文本未使用简体中文",
      "model_output_invalid",
    );
  }
  return localized;
}

async function callOptimizationModel(
  context: AnswerSkillOptimizationContext,
  feedback: string,
  selectedTargetSkillId?: string,
): Promise<unknown> {
  const prompt = buildAnswerSkillOptimizationPrompt({
    question: context.question.content,
    enhancedAnswer: context.originalAnswer.content,
    baselineAnswer: context.baselineAnswer?.content ?? null,
    feedback,
    rubricMd: context.version.snapshot.rubricMd,
    skills: context.skills,
    usedSkillIds: context.usedSkillIds,
    selectedTargetSkillId,
  });
  try {
    return await generateJson<unknown>(
      {
        ...prompt,
        temperature: 0,
        maxTokens: 4000,
      },
      0,
      false,
    );
  } catch (error) {
    if (error instanceof LlmInvalidJsonError) {
      throw new AnswerSkillOptimizationDraftError(
        "Optimization model returned invalid JSON",
        "model_output_invalid",
      );
    }
    throw new AnswerSkillOptimizationUpstreamError(
      `Optimization model is temporarily unavailable: ${
        error instanceof Error ? error.message : "unknown upstream error"
      }`,
    );
  }
}

async function repairRejectedPatch(
  skill: PackageSkill,
  patch: AnswerSkillPatch,
  validationErrors: string[],
): Promise<AnswerSkillPatch> {
  const prompt = buildAnswerSkillRepairPrompt({
    originalSkillMd: skill.skillMd,
    patch,
    validationErrors,
  });
  let text: string;
  try {
    text = await generateText({
      ...prompt,
      temperature: 0,
      maxTokens: 2500,
    });
  } catch (error) {
    throw new AnswerSkillOptimizationUpstreamError(
      `Skill repair model is temporarily unavailable: ${
        error instanceof Error ? error.message : "unknown upstream error"
      }`,
    );
  }
  let raw: unknown;
  try {
    raw = parseJsonObject<unknown>(text);
  } catch {
    throw new AnswerSkillOptimizationDraftError(
      "Skill repair model returned invalid JSON",
      "skill_validation_failed",
    );
  }
  return { ...patch, proposedContent: parseRepairProposedContent(raw) };
}

function createCandidateSkills(
  context: AnswerSkillOptimizationContext,
  candidates: Array<{ skillId: string; reason: string }>,
): AnswerOptimizationCandidateSkill[] {
  const byId = new Map(context.skills.map((skill) => [skill.id, skill]));
  return candidates.map((candidate) => {
    const skill = byId.get(candidate.skillId);
    if (!skill) {
      throw new AnswerSkillOptimizationDraftError(
        "Candidate Skill does not exist in the base version",
      );
    }
    return {
      skillId: skill.id,
      name: skill.name,
      description: skill.description,
      reason: candidate.reason,
    };
  });
}

function businessFailure(
  diagnosis: AnswerOptimizationDiagnosis,
): AnalysisResult | null {
  if (diagnosis.reusability === "single_turn") {
    return {
      status: "failed",
      targetSkillId: null,
      result: {
        diagnosis,
        candidateSkills: [],
        targetSkill: null,
        patch: null,
        draft: null,
        diff: null,
        testResult: null,
        failure: {
          code: "feedback_not_reusable",
          message: "The feedback only applies to this turn and was not written into a Skill.",
        },
      },
    };
  }
  if (diagnosis.reusability === "unclear") {
    return {
      status: "failed",
      targetSkillId: null,
      result: {
        diagnosis,
        candidateSkills: [],
        targetSkill: null,
        patch: null,
        draft: null,
        diff: null,
        testResult: null,
        failure: {
          code: "feedback_unclear",
          message: "The feedback is not clear enough to create a reusable Skill change.",
        },
      },
    };
  }
  return null;
}

async function analyzeAnswerSkillOptimization(
  context: AnswerSkillOptimizationContext,
  feedback: string,
  selectedTargetSkillId?: string,
): Promise<AnalysisResult> {
  const raw = await callOptimizationModel(
    context,
    feedback,
    selectedTargetSkillId,
  );
  const parseOptions: ParseAnswerOptimizationModelOutputOptions = {
    skills: context.skills,
    usedSkillIds: context.usedSkillIds,
    selectedTargetSkillId,
  };
  let modelOutput: AnswerOptimizationModelOutput;
  try {
    modelOutput = parseAnswerOptimizationModelOutput(raw, parseOptions);
  } catch (error) {
    if (error instanceof AnswerSkillOptimizationContractError) {
      throw new AnswerSkillOptimizationDraftError(error.message);
    }
    throw error;
  }
  modelOutput = await localizeOptimizationModelOutput(
    modelOutput,
    parseOptions,
  );

  const nonReusable = businessFailure(modelOutput.diagnosis);
  if (nonReusable) return nonReusable;

  if (modelOutput.targetSkillId === null) {
    return {
      status: "target_selection_required",
      targetSkillId: null,
      result: {
        diagnosis: modelOutput.diagnosis,
        candidateSkills: createCandidateSkills(
          context,
          modelOutput.candidateSkills,
        ),
        targetSkill: null,
        patch: null,
        draft: null,
        diff: null,
        testResult: null,
        failure: null,
      },
    };
  }

  const skill = context.skills.find(
    (candidate) => candidate.id === modelOutput.targetSkillId,
  );
  if (!skill || !modelOutput.patch) {
    throw new AnswerSkillOptimizationDraftError(
      "Optimization model did not return a valid target Skill and patch",
    );
  }

  let applied;
  try {
    applied = applyAnswerSkillPatch(skill, modelOutput.patch);
  } catch (error) {
    if (error instanceof AnswerSkillPatchApplicationError) {
      throw new AnswerSkillOptimizationDraftError(
        error.message,
        "skill_validation_failed",
      );
    }
    throw error;
  }

  let finalPatch = modelOutput.patch;
  if (!applied.draft.validation.valid) {
    finalPatch = await repairRejectedPatch(
      skill,
      modelOutput.patch,
      applied.draft.validation.errors,
    );
    if (
      isPrimarilyChineseSkill(skill) &&
      userFacingTextNeedsChinese(finalPatch.proposedContent)
    ) {
      throw new AnswerSkillOptimizationDraftError(
        "模型修复后的 Skill 内容未保持简体中文",
        "skill_validation_failed",
      );
    }
    try {
      applied = applyAnswerSkillPatch(skill, finalPatch);
    } catch (error) {
      if (error instanceof AnswerSkillPatchApplicationError) {
        throw new AnswerSkillOptimizationDraftError(
          error.message,
          "skill_validation_failed",
        );
      }
      throw error;
    }
  }
  if (!applied.draft.validation.valid) {
    throw new AnswerSkillOptimizationDraftError(
      `Skill draft validation failed: ${applied.draft.validation.errors
        .slice(0, 5)
        .join("; ")}`,
      "skill_validation_failed",
    );
  }

  return {
    status: "draft_ready",
    targetSkillId: skill.id,
    result: {
      diagnosis: modelOutput.diagnosis,
      candidateSkills: [],
      targetSkill: {
        skillId: skill.id,
        name: skill.name,
        selectionSource: selectedTargetSkillId ? "user_selected" : "recorded",
      },
      patch: finalPatch,
      draft: applied.draft,
      diff: applied.diff,
      testResult: null,
      failure: null,
    },
  };
}

interface MultiTargetAnalysisEntry {
  skillId: string;
  name: string;
  patch: AnswerSkillPatch;
  draft: AnswerOptimizationDraft;
  diff: AnswerOptimizationDiff;
}

async function analyzeAnswerSkillOptimizationMultiTarget(
  context: AnswerSkillOptimizationContext,
  feedback: string,
  targetSkillIds: string[],
): Promise<AnalysisResult> {
  const entries: MultiTargetAnalysisEntry[] = [];
  let firstDiagnosis: AnswerOptimizationDiagnosis | null = null;

  for (const skillId of targetSkillIds) {
    const analysis = await analyzeAnswerSkillOptimization(
      context,
      feedback,
      skillId,
    );
    if (
      analysis.status !== "draft_ready" ||
      !analysis.result.targetSkill ||
      !analysis.result.patch ||
      !analysis.result.draft
    ) {
      // 任一 skill 未生成可用草稿则短路返回（target_selection_required / failed）
      return analysis;
    }
    if (!firstDiagnosis && analysis.result.diagnosis) {
      firstDiagnosis = analysis.result.diagnosis;
    }
    entries.push({
      skillId: analysis.result.targetSkill.skillId,
      name: analysis.result.targetSkill.name,
      patch: analysis.result.patch,
      draft: analysis.result.draft,
      diff: analysis.result.diff ?? { before: "", after: "" },
    });
  }

  if (entries.length === 0) {
    throw new AnswerSkillOptimizationDraftError(
      "Multi-target analysis produced no viable Skill patches",
    );
  }

  const plannedTargets: AnswerOptimizationPlannedTarget[] = entries.map(
    (entry, index) => ({
      skillId: entry.skillId,
      name: entry.name,
      status: index === 0 ? "active" : "pending",
      patch: entry.patch,
    }),
  );

  const first = entries[0]!;
  return {
    status: "draft_ready",
    targetSkillId: first.skillId,
    result: {
      diagnosis: firstDiagnosis ?? undefined,
      candidateSkills: [],
      targetSkill: {
        skillId: first.skillId,
        name: first.name,
        selectionSource: "user_selected",
      },
      patch: first.patch,
      draft: first.draft,
      diff: first.diff,
      testResult: null,
      failure: null,
      plannedTargets,
    },
  };
}

function failureFromError(error: unknown): AnswerOptimizationFailure {
  if (error instanceof AnswerSkillOptimizationUpstreamError) {
    return {
      code: "model_unavailable",
      message: "The optimization model is temporarily unavailable.",
    };
  }
  if (error instanceof AnswerSkillOptimizationDraftError) {
    return { code: error.failureCode, message: error.message.slice(0, 1000) };
  }
  if (error instanceof AnswerSkillOptimizationNotFoundError) {
    return {
      code: "context_invalid",
      message: "The saved answer context is no longer available.",
    };
  }
  return {
    code: "context_invalid",
    message: "The optimization could not be completed.",
  };
}

async function finishCreateProcessing(
  run: AnswerSkillOptimizationRun,
  analysis: AnalysisResult,
): Promise<AnswerSkillOptimizationRun> {
  const updatedAt = new Date().toISOString();
  const result = await query<DbRowAnswerSkillOptimizationRun>(
    `update answer_skill_optimization_runs
       set target_skill_id = $1,
           result_json = $2,
           status = $3,
           updated_at = $4
     where id = $5 and user_id = $6
       and status = 'processing' and revision = $7
     returning *`,
    [
      analysis.targetSkillId,
      JSON.stringify(analysis.result),
      analysis.status,
      updatedAt,
      run.id,
      run.userId,
      run.revision,
    ],
  );
  const row = result.rows[0];
  if (row) return toAnswerSkillOptimizationRun(row);

  const current = await getAnswerSkillOptimizationRun(run.userId, run.id);
  if (current.status === "cancelled") return current;
  throw new AnswerSkillOptimizationConflictError(
    "Optimization task changed while the draft was being generated",
  );
}

async function markCreateProcessingFailed(
  run: AnswerSkillOptimizationRun,
  error: unknown,
): Promise<void> {
  const failure = failureFromError(error);
  const result: AnswerSkillOptimizationResult = {
    ...run.result,
    patch: null,
    draft: null,
    diff: null,
    testResult: null,
    failure,
  };
  await query(
    `update answer_skill_optimization_runs
       set result_json = $1, status = 'failed', updated_at = $2
     where id = $3 and user_id = $4
       and status = 'processing' and revision = $5`,
    [
      JSON.stringify(result),
      new Date().toISOString(),
      run.id,
      run.userId,
      run.revision,
    ],
  );
}

export async function createAnswerSkillOptimization(
  input: CreateAnswerSkillOptimizationRunInput,
): Promise<AnswerSkillOptimizationDetailDto> {
  const outcome = await createAnswerSkillOptimizationRunWithOutcome(input);
  const initialRun = outcome.run;
  if (!outcome.created) {
    const existingContext = await loadAnswerSkillOptimizationContext(initialRun);
    return toDetailDto(initialRun, existingContext);
  }

  let context: AnswerSkillOptimizationContext;
  try {
    context = await loadAnswerSkillOptimizationContext(initialRun);
    const analysis = await analyzeAnswerSkillOptimization(
      context,
      initialRun.userFeedback,
    );
    const updated = await finishCreateProcessing(initialRun, analysis);
    return toDetailDto(updated, context);
  } catch (error) {
    try {
      await markCreateProcessingFailed(initialRun, error);
    } catch {
      // Preserve the original domain/upstream error if failure persistence also fails.
    }
    throw error;
  }
}

export async function getAnswerSkillOptimizationDetail(
  userId: string,
  optimizationId: number,
): Promise<AnswerSkillOptimizationDetailDto> {
  const storedRun = await getAnswerSkillOptimizationRun(userId, optimizationId);
  const run = await recoverStaleAnswerSkillOptimizationRun(storedRun);
  const context = await loadAnswerSkillOptimizationContext(run);
  return toDetailDto(run, context);
}

export async function resolveAnswerSkillOptimizationReference(
  input: ResolveAnswerSkillOptimizationInput,
): Promise<AnswerSkillOptimizationReference | null> {
  const userId = normalizeUserId(input.userId);
  const packageId = toPositiveSafeInteger(input.packageId, "packageId");
  const threadId = toPositiveSafeInteger(input.threadId, "threadId");
  const questionMessageId = toPositiveSafeInteger(
    input.questionMessageId,
    "questionMessageId",
  );
  const answerMessageId = toPositiveSafeInteger(
    input.answerMessageId,
    "answerMessageId",
  );
  if (input.answerSide !== "baseline" && input.answerSide !== "enhanced") {
    throw new AnswerSkillOptimizationValidationError(
      "answerSide must be baseline or enhanced",
    );
  }

  let answerRun: ArenaAnswerRun;
  try {
    answerRun = await getArenaAnswerRunByMessage(userId, answerMessageId);
  } catch (error) {
    if (error instanceof ArenaAnswerRunNotFoundError) {
      throw new AnswerSkillOptimizationNotFoundError("Answer context not found");
    }
    throw error;
  }
  const recordedAnswerId = input.answerSide === "baseline"
    ? answerRun.baselineAnswerMessageId
    : answerRun.enhancedAnswerMessageId;
  if (
    answerRun.packageId !== packageId ||
    answerRun.threadId !== threadId ||
    answerRun.questionMessageId !== questionMessageId ||
    recordedAnswerId !== answerMessageId
  ) {
    throw new AnswerSkillOptimizationNotFoundError("Answer context not found");
  }

  const row = await findNonCancelledByAnswer(userId, answerMessageId);
  if (!row) return null;
  const run = await recoverStaleAnswerSkillOptimizationRun(
    toAnswerSkillOptimizationRun(row),
  );
  if (
    run.packageId !== packageId ||
    run.threadId !== threadId ||
    run.questionMessageId !== questionMessageId ||
    run.answerMessageId !== answerMessageId ||
    run.answerSide !== input.answerSide
  ) {
    throw new AnswerSkillOptimizationNotFoundError("Answer context not found");
  }
  return {
    optimizationId: run.id,
    status: run.status,
    versionNumber: toNullablePositiveSafeInteger(
      row.final_version_number,
      "final_version_number",
    ),
  };
}

export async function rebaseAnswerSkillOptimization(
  input: RebaseAnswerSkillOptimizationInput,
): Promise<AnswerSkillOptimizationDetailDto> {
  const userId = normalizeUserId(input.userId);
  const optimizationId = toPositiveSafeInteger(
    input.optimizationId,
    "optimizationId",
  );
  const expectedRevision = toPositiveSafeInteger(
    input.expectedRevision,
    "expectedRevision",
  );
  const run = await getAnswerSkillOptimizationRun(userId, optimizationId);
  assertRevision(run, expectedRevision);
  if (run.status !== "draft_ready" && run.status !== "test_ready") {
    throw new AnswerSkillOptimizationDraftError(
      `Cannot apply an optimization in ${run.status} status to the current version`,
    );
  }
  const patch = run.result.patch;
  const targetSkill = run.result.targetSkill;
  if (!patch || !targetSkill) {
    throw new AnswerSkillOptimizationDraftError(
      "Optimization draft is unavailable for applying to the current version",
    );
  }

  const packageResult = await query<{ current_version_id: number | string }>(
    `select current_version_id from agent_packages
     where id = $1 and user_id = $2`,
    [run.packageId, userId],
  );
  const currentVersionId = toPositiveSafeInteger(
    packageResult.rows[0]?.current_version_id,
    "Package current version ID",
  );
  if (currentVersionId === run.baseVersionId) {
    return getAnswerSkillOptimizationDetail(userId, optimizationId);
  }

  const currentVersion = await getVersion(
    userId,
    run.packageId,
    String(currentVersionId),
  );
  const currentSkill = currentVersion.snapshot.skills.find(
    (skill) => skill.id === targetSkill.skillId,
  );
  if (!currentSkill) {
    throw new AnswerSkillOptimizationConflictError(
      "The Skill used by this answer is not available in the current version",
    );
  }
  let applied: AppliedAnswerSkillPatch;
  try {
    applied = applyAnswerSkillPatch(currentSkill, patch);
  } catch (error) {
    if (error instanceof AnswerSkillPatchApplicationError) {
      throw new AnswerSkillOptimizationConflictError(
        "The current version has conflicting changes. Review the improvement again before saving.",
      );
    }
    throw error;
  }
  if (!applied.draft.validation.valid) {
    throw new AnswerSkillOptimizationDraftError(
      "The improvement is not valid when applied to the current Skill version",
      "skill_validation_failed",
    );
  }
  const workingSkillVersionResult = await query<{
    skill_version_id: number | string;
  }>(
    `select pvs.skill_version_id
       from agent_package_version_skills pvs
       join agent_package_skills s on s.id = pvs.skill_id
      where pvs.package_version_id = $1
        and pvs.package_id = $2
        and s.skill_uid = $3`,
    [currentVersionId, run.packageId, targetSkill.skillId],
  );
  const workingSkillVersionId = workingSkillVersionResult.rows[0]
    ? toPositiveSafeInteger(
        workingSkillVersionResult.rows[0].skill_version_id,
        "working Skill version ID",
      )
    : null;
  const nextRevision = run.revision + 1;
  const updatedResult: AnswerSkillOptimizationResult = {
    ...run.result,
    draft: applied.draft,
    diff: applied.diff,
    testResult: null,
    testFailure: null,
    failure: null,
  };
  const updated = await query<DbRowAnswerSkillOptimizationRun>(
    `update answer_skill_optimization_runs
        set base_version_id = $1, working_skill_version_id = $2,
            result_json = $3, status = 'draft_ready', revision = $4,
            updated_at = $5
      where id = $6 and user_id = $7 and revision = $8
        and status in ('draft_ready', 'test_ready')
      returning *`,
    [
      currentVersionId,
      workingSkillVersionId,
      JSON.stringify(updatedResult),
      nextRevision,
      new Date().toISOString(),
      optimizationId,
      userId,
      run.revision,
    ],
  );
  const row = updated.rows[0];
  if (!row) {
    throw new AnswerSkillOptimizationConflictError(
      "Optimization changed while it was being applied to the current version",
    );
  }
  const rebasedRun = toAnswerSkillOptimizationRun(row);
  const context = await loadAnswerSkillOptimizationContext(rebasedRun);
  return toDetailDto(rebasedRun, context);
}

type AnswerOptimizationMutationAction =
  | "revise"
  | "test"
  | "confirm"
  | "cancel";

function mutationSlot(
  action: AnswerOptimizationMutationAction,
  key: string,
): string {
  return `${action}:${key}`;
}

function getMutationRecord(
  run: AnswerSkillOptimizationRun,
  action: AnswerOptimizationMutationAction,
  key: string,
): AnswerOptimizationIdempotencyRecord | undefined {
  return run.result.idempotencyResults?.[mutationSlot(action, key)];
}

function assertMatchingMutationRecord(
  record: AnswerOptimizationIdempotencyRecord,
  requestHash: string,
): void {
  if (record.requestHash !== requestHash) {
    throw new AnswerSkillOptimizationConflictError(
      "Idempotency key was already used for a different request",
    );
  }
}

function withMutationRecord(
  result: AnswerSkillOptimizationResult,
  record: AnswerOptimizationIdempotencyRecord,
): AnswerSkillOptimizationResult {
  return {
    ...result,
    idempotencyResults: {
      ...(result.idempotencyResults ?? {}),
      [mutationSlot(record.action, record.key)]: record,
    },
  };
}

function createIdempotencyRecord(input: {
  action: AnswerOptimizationMutationAction;
  key: string;
  requestHash: string;
  resultingRevision: number;
  status: AnswerSkillOptimizationStatus;
  reason?: AnswerOptimizationCancelReason;
  testOutcome?: "pending" | "succeeded" | "failed";
  testResult?: AnswerOptimizationTestResult;
  testFailureCode?: AnswerOptimizationTestFailure["code"];
  confirmResult?: AnswerOptimizationConfirmResult;
  refinementOutcome?: "pending" | "succeeded" | "failed";
  refinementTurnId?: string;
  refinementFailureCode?: AnswerSkillRefinementFailureCode;
}): AnswerOptimizationIdempotencyRecord {
  return {
    action: input.action,
    key: input.key,
    requestHash: input.requestHash,
    resultingRevision: input.resultingRevision,
    responseSummary: {
      status: input.status,
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.testOutcome ? { testOutcome: input.testOutcome } : {}),
      ...(input.testResult ? { testResult: input.testResult } : {}),
      ...(input.testFailureCode
        ? { testFailureCode: input.testFailureCode }
        : {}),
      ...(input.confirmResult ? { confirmResult: input.confirmResult } : {}),
      ...(input.refinementOutcome
        ? { refinementOutcome: input.refinementOutcome }
        : {}),
      ...(input.refinementTurnId
        ? { refinementTurnId: input.refinementTurnId }
        : {}),
      ...(input.refinementFailureCode
        ? { refinementFailureCode: input.refinementFailureCode }
        : {}),
    },
  };
}

function assertRevision(run: AnswerSkillOptimizationRun, expected: number): void {
  if (run.revision !== expected) {
    throw new AnswerSkillOptimizationConflictError(
      `Optimization revision changed from ${expected} to ${run.revision}`,
    );
  }
}

function validateSelectedTarget(
  run: AnswerSkillOptimizationRun,
  context: AnswerSkillOptimizationContext,
  targetSkillId: string | undefined,
): void {
  if (!targetSkillId) return;
  if (!context.skills.some((skill) => skill.id === targetSkillId)) {
    throw new AnswerSkillOptimizationNotFoundError(
      "Target Skill not found in the base Package version",
    );
  }
  const candidates = run.result.candidateSkills ?? [];
  if (
    candidates.length > 0 &&
    !candidates.some((candidate) => candidate.skillId === targetSkillId)
  ) {
    throw new AnswerSkillOptimizationValidationError(
      "targetSkillId is not one of the proposed candidate Skills",
    );
  }
}

function validateSelectedTargets(
  run: AnswerSkillOptimizationRun,
  context: AnswerSkillOptimizationContext,
  targetSkillIds: string[] | undefined,
): void {
  if (!targetSkillIds || targetSkillIds.length === 0) return;
  const candidates = run.result.candidateSkills ?? [];
  for (const skillId of targetSkillIds) {
    if (!context.skills.some((skill) => skill.id === skillId)) {
      throw new AnswerSkillOptimizationNotFoundError(
        "Target Skill not found in the base Package version",
      );
    }
    if (
      candidates.length > 0 &&
      !candidates.some((candidate) => candidate.skillId === skillId)
    ) {
      throw new AnswerSkillOptimizationValidationError(
        "targetSkillIds contains a Skill that is not one of the proposed candidate Skills",
      );
    }
  }
}

async function claimRevisionForAnalysis(input: {
  run: AnswerSkillOptimizationRun;
  feedback: string;
  selectedTargetSkillId?: string;
  idempotencyKey: string;
  requestHash: string;
}): Promise<{ run: AnswerSkillOptimizationRun; claimed: boolean }> {
  const pendingRecord = createIdempotencyRecord({
    action: "revise",
    key: input.idempotencyKey,
    requestHash: input.requestHash,
    resultingRevision: input.run.revision,
    status: "processing",
  });
  const pendingResult = withMutationRecord(
    {
      ...input.run.result,
      testResult: null,
      testFailure: null,
      failure: null,
    },
    pendingRecord,
  );
  const updatedAt = new Date().toISOString();
  const result = await query<DbRowAnswerSkillOptimizationRun>(
    `update answer_skill_optimization_runs
       set user_feedback = $1,
           target_skill_id = $2,
           result_json = $3,
           status = 'processing',
           updated_at = $4
     where id = $5 and user_id = $6 and revision = $7
       and status in ('target_selection_required', 'draft_ready', 'test_ready', 'failed')
     returning *`,
    [
      input.feedback,
      input.selectedTargetSkillId ?? null,
      JSON.stringify(pendingResult),
      updatedAt,
      input.run.id,
      input.run.userId,
      input.run.revision,
    ],
  );
  const row = result.rows[0];
  if (row) {
    return { run: toAnswerSkillOptimizationRun(row), claimed: true };
  }

  const current = await getAnswerSkillOptimizationRun(
    input.run.userId,
    input.run.id,
  );
  const replay = getMutationRecord(current, "revise", input.idempotencyKey);
  if (replay) {
    assertMatchingMutationRecord(replay, input.requestHash);
    return { run: current, claimed: false };
  }
  throw new AnswerSkillOptimizationConflictError(
    "Optimization changed before revise could start",
  );
}

async function finishRevisionAnalysis(input: {
  claimed: AnswerSkillOptimizationRun;
  feedback: string;
  idempotencyKey: string;
  requestHash: string;
  analysis: AnalysisResult;
}): Promise<AnswerSkillOptimizationRun> {
  const nextRevision = input.claimed.revision + 1;
  const record = createIdempotencyRecord({
    action: "revise",
    key: input.idempotencyKey,
    requestHash: input.requestHash,
    resultingRevision: nextRevision,
    status: input.analysis.status,
  });
  const resultJson = withMutationRecord(
    {
      ...input.analysis.result,
      testResult: null,
      testFailure: null,
    },
    record,
  );
  const result = await query<DbRowAnswerSkillOptimizationRun>(
    `update answer_skill_optimization_runs
       set user_feedback = $1,
           target_skill_id = $2,
           result_json = $3,
           status = $4,
           revision = $5,
           updated_at = $6
     where id = $7 and user_id = $8
       and status = 'processing' and revision = $9
     returning *`,
    [
      input.feedback,
      input.analysis.targetSkillId,
      JSON.stringify(resultJson),
      input.analysis.status,
      nextRevision,
      new Date().toISOString(),
      input.claimed.id,
      input.claimed.userId,
      input.claimed.revision,
    ],
  );
  const row = result.rows[0];
  if (row) return toAnswerSkillOptimizationRun(row);

  const current = await getAnswerSkillOptimizationRun(
    input.claimed.userId,
    input.claimed.id,
  );
  const replay = getMutationRecord(current, "revise", input.idempotencyKey);
  if (replay && replay.resultingRevision === current.revision) {
    assertMatchingMutationRecord(replay, input.requestHash);
    return current;
  }
  throw new AnswerSkillOptimizationConflictError(
    "Optimization changed while revise was being generated",
  );
}

async function finishRevisionFailure(input: {
  claimed: AnswerSkillOptimizationRun;
  feedback: string;
  idempotencyKey: string;
  requestHash: string;
  error: unknown;
}): Promise<void> {
  const nextRevision = input.claimed.revision + 1;
  const record = createIdempotencyRecord({
    action: "revise",
    key: input.idempotencyKey,
    requestHash: input.requestHash,
    resultingRevision: nextRevision,
    status: "failed",
  });
  const resultJson = withMutationRecord(
    {
      ...input.claimed.result,
      patch: null,
      draft: null,
      diff: null,
      testResult: null,
      testFailure: null,
      failure: failureFromError(input.error),
      plannedTargets: [],
    },
    record,
  );
  await query(
    `update answer_skill_optimization_runs
       set user_feedback = $1,
           target_skill_id = null,
           result_json = $2,
           status = 'failed',
           revision = $3,
           updated_at = $4
     where id = $5 and user_id = $6
       and status = 'processing' and revision = $7`,
    [
      input.feedback,
      JSON.stringify(resultJson),
      nextRevision,
      new Date().toISOString(),
      input.claimed.id,
      input.claimed.userId,
      input.claimed.revision,
    ],
  );
}

type AnswerSkillRefinementAnalysis =
  | {
      kind: "applied";
      analysis: AnalysisResult;
      outcome: Extract<AnswerSkillRefinementOutcome, { kind: "applied" }>;
    }
  | {
      kind: "not_applied";
      outcome: Extract<
        AnswerSkillRefinementOutcome,
        {
          kind:
            | "needs_clarification"
            | "not_suitable_for_shared_rule";
        }
      >;
    };

interface AnswerSkillRefinementClaim {
  run: AnswerSkillOptimizationRun;
  claimed: boolean;
  stableStatus: AnswerSkillOptimizationStatus;
  turnId: string;
  idempotencySlot: string;
}

function normalizeRefinementSource(value: unknown): AnswerSkillRefinementSource {
  if (
    value !== "draft_review" &&
    value !== "test_failure" &&
    value !== "alternative_regeneration"
  ) {
    throw new AnswerSkillOptimizationValidationError(
      "revisionSource must be draft_review, test_failure, or alternative_regeneration",
    );
  }
  return value;
}

function getRefinementHistory(
  result: AnswerSkillOptimizationResult,
): AnswerSkillRefinementTurn[] {
  return result.refinementHistory ?? [];
}

function requireRefinementPreviewEvidence(
  run: AnswerSkillOptimizationRun,
  source: AnswerSkillRefinementSource,
): AnswerSkillRefinementQualityEvidence | null {
  if (source !== "test_failure") return null;
  const preview = getAnswerSkillPreviewIssueEvidence({
    status: run.status,
    revision: run.revision,
    result: run.result,
  });
  if (!preview.ok && preview.reason === "missing_current_preview") {
    throw new AnswerSkillOptimizationDraftError(
      "当前草稿没有可用于定向修订的最新效果预览",
      "context_invalid",
    );
  }
  if (!preview.ok) {
    throw new AnswerSkillOptimizationValidationError(
      "没有预览问题的草稿应使用 draft_review 提交补充意见",
    );
  }
  return preview.evidence;
}

function failedSamplesForRefinementPrompt(
  run: AnswerSkillOptimizationRun,
  evidence: AnswerSkillRefinementQualityEvidence | null,
): Array<{
  sampleIndex: number;
  answer: string;
  unmetRequirements: string[];
  riskNotes: string[];
  criticalRisk: boolean;
}> {
  const testResult = run.result.testResult;
  if (!evidence || !testResult) return [];
  return evidence.failedSamples.map((sample) => ({
    ...sample,
    answer: testResult.samples[sample.sampleIndex].answer,
  }));
}

function refinementUserFacingTexts(
  output: AnswerSkillRefinementModelOutput,
  translateProposedContent: boolean,
): string[] {
  if (output.kind === "applied") {
    return [
      output.assistantSummary,
      output.patch.reason,
      ...(translateProposedContent ? [output.patch.proposedContent] : []),
    ];
  }
  if (output.kind === "needs_clarification") {
    return [
      output.message,
      output.clarificationQuestion,
      ...output.suggestedFeedback,
    ];
  }
  return [
    output.message,
    ...(output.suggestedReusableFeedback
      ? [output.suggestedReusableFeedback]
      : []),
  ];
}

function refinementOutputNeedsChineseLocalization(
  output: AnswerSkillRefinementModelOutput,
  translateProposedContent: boolean,
): boolean {
  return refinementUserFacingTexts(
    output,
    translateProposedContent,
  ).some(userFacingTextNeedsChinese);
}

function assertRefinementLocalizationPreservesStructure(
  original: AnswerSkillRefinementModelOutput,
  localized: AnswerSkillRefinementModelOutput,
  translateProposedContent: boolean,
): void {
  let invalid = localized.kind !== original.kind;
  if (!invalid && original.kind === "applied" && localized.kind === "applied") {
    invalid =
      localized.patch.section !== original.patch.section ||
      localized.patch.operation !== original.patch.operation ||
      (!translateProposedContent &&
        localized.patch.proposedContent !== original.patch.proposedContent);
  } else if (
    !invalid &&
    original.kind === "needs_clarification" &&
    localized.kind === "needs_clarification"
  ) {
    invalid =
      localized.suggestedFeedback.length !==
      original.suggestedFeedback.length;
  } else if (
    !invalid &&
    original.kind === "not_suitable_for_shared_rule" &&
    localized.kind === "not_suitable_for_shared_rule"
  ) {
    invalid =
      (localized.suggestedReusableFeedback === null) !==
      (original.suggestedReusableFeedback === null);
  }
  if (invalid) {
    throw new AnswerSkillOptimizationContractError(
      "Localization changed protected refinement fields",
    );
  }
}

async function localizeRefinementModelOutput(
  output: AnswerSkillRefinementModelOutput,
  targetSkill: PackageSkill,
): Promise<AnswerSkillRefinementModelOutput> {
  const translateProposedContent = isPrimarilyChineseSkill(targetSkill);
  if (
    !refinementOutputNeedsChineseLocalization(
      output,
      translateProposedContent,
    )
  ) {
    return output;
  }
  const prompt = buildAnswerSkillRefinementLocalizationPrompt({
    output,
    translateProposedContent,
  });
  let localized: AnswerSkillRefinementModelOutput;
  try {
    const raw = await generateJson<unknown>(
      {
        ...prompt,
        temperature: 0,
        maxTokens: 4000,
      },
      0,
      false,
    );
    localized = parseAnswerSkillRefinementModelOutput(raw);
    assertRefinementLocalizationPreservesStructure(
      output,
      localized,
      translateProposedContent,
    );
  } catch (error) {
    if (error instanceof AnswerSkillOptimizationUpstreamError) throw error;
    if (
      error instanceof LlmInvalidJsonError ||
      error instanceof AnswerSkillOptimizationContractError
    ) {
      throw new AnswerSkillRefinementTechnicalError(
        "invalid_model_output",
        "模型返回的草稿修订说明无法安全转换为简体中文",
      );
    }
    throw new AnswerSkillRefinementTechnicalError(
      "model_unavailable",
      "草稿修订说明暂时无法完成本地化，请稍后重试。",
    );
  }
  if (
    refinementOutputNeedsChineseLocalization(
      localized,
      translateProposedContent,
    )
  ) {
    throw new AnswerSkillRefinementTechnicalError(
      "invalid_model_output",
      "模型返回的草稿修订说明未使用简体中文",
    );
  }
  return localized;
}

async function callRefinementModel(input: {
  run: AnswerSkillOptimizationRun;
  context: AnswerSkillOptimizationContext;
  additionalFeedback: string | null;
  source: Exclude<AnswerSkillRefinementSource, "alternative_regeneration">;
  qualityEvidence: AnswerSkillRefinementQualityEvidence | null;
}): Promise<AnswerSkillRefinementModelOutput> {
  const diagnosis = input.run.result.diagnosis;
  const targetSkill = input.run.result.targetSkill;
  const currentPatch = input.run.result.patch;
  const currentDiff = input.run.result.diff;
  const currentDraft = validateStoredTestDraft(input.run, input.context);
  if (!diagnosis || !targetSkill || !currentPatch || !currentDiff) {
    throw new AnswerSkillOptimizationDraftError(
      "当前任务没有可继续修改的完整草稿",
      "context_invalid",
    );
  }
  const baseSkill = input.context.skills.find(
    (skill) => skill.id === targetSkill.skillId,
  );
  if (!baseSkill) {
    throw new AnswerSkillOptimizationNotFoundError(
      "Target Skill not found in the base Package version",
    );
  }
  const prompt = buildAnswerSkillRefinementPrompt({
    source: input.source,
    question: input.context.question.content,
    enhancedAnswer: input.context.originalAnswer.content,
    initialFeedback: input.run.userFeedback,
    previousSuccessfulTurns: getRefinementHistory(input.run.result).filter(
      (turn) => turn.outcome?.kind === "applied",
    ),
    additionalFeedback: input.additionalFeedback,
    diagnosis,
    targetSkill,
    currentPatch,
    currentDraftSkillMd: currentDraft.skillMd,
    currentDiff,
    baseSkill,
    rubricMd: input.context.version.snapshot.rubricMd,
    qualityEvidence: input.qualityEvidence,
    failedSamples: failedSamplesForRefinementPrompt(
      input.run,
      input.qualityEvidence,
    ),
  });
  let raw: unknown;
  try {
    raw = await generateJson<unknown>(
      {
        ...prompt,
        temperature: 0,
        maxTokens: 5000,
      },
      0,
      false,
    );
  } catch (error) {
    if (error instanceof LlmInvalidJsonError) {
      throw new AnswerSkillRefinementTechnicalError(
        "invalid_model_output",
        "模型返回的草稿修订结果不是有效 JSON",
      );
    }
    throw new AnswerSkillRefinementTechnicalError(
      "model_unavailable",
      "模型服务暂时不可用，请稍后使用相同意见重试。",
    );
  }
  let output: AnswerSkillRefinementModelOutput;
  try {
    output = parseAnswerSkillRefinementModelOutput(raw);
  } catch (error) {
    if (error instanceof AnswerSkillOptimizationContractError) {
      throw new AnswerSkillRefinementTechnicalError(
        "invalid_model_output",
        "模型生成的规则格式不符合要求，请使用相同意见重试。",
      );
    }
    throw error;
  }
  return localizeRefinementModelOutput(output, baseSkill);
}

function confirmedRefinementFeedback(
  run: AnswerSkillOptimizationRun,
): string[] {
  return getRefinementHistory(run.result).flatMap((turn) =>
    turn.outcome?.kind === "applied" &&
    turn.source !== "alternative_regeneration"
      ? [turn.userMessage]
      : [],
  );
}

async function callAlternativeRegenerationModel(input: {
  run: AnswerSkillOptimizationRun;
  context: AnswerSkillOptimizationContext;
}): Promise<AnswerSkillRefinementModelOutput> {
  const diagnosis = input.run.result.diagnosis;
  const targetSkill = input.run.result.targetSkill;
  if (!diagnosis || !targetSkill) {
    throw new AnswerSkillOptimizationDraftError(
      "当前任务没有可重新生成的目标规则",
      "context_invalid",
    );
  }
  const baseSkill = input.context.skills.find(
    (skill) => skill.id === targetSkill.skillId,
  );
  if (!baseSkill) {
    throw new AnswerSkillOptimizationNotFoundError(
      "Target Skill not found in the base Package version",
    );
  }
  const prompt = buildAnswerSkillAlternativeRegenerationPrompt({
    question: input.context.question.content,
    enhancedAnswer: input.context.originalAnswer.content,
    initialFeedback: input.run.userFeedback,
    confirmedRefinementFeedback: confirmedRefinementFeedback(input.run),
    diagnosis,
    targetSkill,
    baseSkill,
    rubricMd: input.context.version.snapshot.rubricMd,
  });
  let raw: unknown;
  try {
    raw = await generateJson<unknown>(
      {
        ...prompt,
        temperature: 0,
        maxTokens: 5000,
      },
      0,
      false,
    );
  } catch (error) {
    if (error instanceof LlmInvalidJsonError) {
      throw new AnswerSkillRefinementTechnicalError(
        "invalid_model_output",
        "模型返回的另一版草稿不是有效 JSON。",
      );
    }
    throw new AnswerSkillRefinementTechnicalError(
      "model_unavailable",
      "模型服务暂时不可用，请稍后重新生成另一版草稿。",
    );
  }
  let output: AnswerSkillRefinementModelOutput;
  try {
    output = parseAnswerSkillRefinementModelOutput(raw);
  } catch (error) {
    if (error instanceof AnswerSkillOptimizationContractError) {
      throw new AnswerSkillRefinementTechnicalError(
        "invalid_model_output",
        "模型生成的另一版规则格式不符合要求，请重试。",
      );
    }
    throw error;
  }
  if (output.kind !== "applied") {
    throw new AnswerSkillRefinementTechnicalError(
      "invalid_model_output",
      "模型没有返回可应用的另一版规则草稿。",
    );
  }
  return localizeRefinementModelOutput(output, baseSkill);
}

async function analyzeAnswerSkillRefinement(input: {
  run: AnswerSkillOptimizationRun;
  context: AnswerSkillOptimizationContext;
  additionalFeedback: string | null;
  source: AnswerSkillRefinementSource;
  qualityEvidence: AnswerSkillRefinementQualityEvidence | null;
}): Promise<AnswerSkillRefinementAnalysis> {
  const targetSkill = input.run.result.targetSkill;
  const diagnosis = input.run.result.diagnosis;
  if (!targetSkill || !diagnosis) {
    throw new AnswerSkillOptimizationDraftError(
      "当前任务没有可继续修改的目标规则",
      "context_invalid",
    );
  }
  const baseSkill = input.context.skills.find(
    (skill) => skill.id === targetSkill.skillId,
  );
  if (!baseSkill) {
    throw new AnswerSkillOptimizationNotFoundError(
      "Target Skill not found in the base Package version",
    );
  }
  const output =
    input.source === "alternative_regeneration"
      ? await callAlternativeRegenerationModel(input)
      : await callRefinementModel({
          ...input,
          source: input.source,
        });
  if (output.kind === "needs_clarification") {
    return {
      kind: "not_applied",
      outcome: {
        kind: "needs_clarification",
        message: output.message,
        clarificationQuestion: output.clarificationQuestion,
        suggestedFeedback: output.suggestedFeedback,
      },
    };
  }
  if (output.kind === "not_suitable_for_shared_rule") {
    return {
      kind: "not_applied",
      outcome: {
        kind: "not_suitable_for_shared_rule",
        message: output.message,
        suggestedReusableFeedback: output.suggestedReusableFeedback,
      },
    };
  }

  let finalPatch = output.patch;
  let applied;
  try {
    applied = applyAnswerSkillPatch(baseSkill, finalPatch);
  } catch (error) {
    if (error instanceof AnswerSkillPatchApplicationError) {
      throw new AnswerSkillRefinementTechnicalError(
        "patch_application_failed",
        "模型生成的修改无法安全应用到当前规则，请使用相同意见重试。",
      );
    }
    throw error;
  }
  if (!applied.draft.validation.valid) {
    try {
      finalPatch = await repairRejectedPatch(
        baseSkill,
        finalPatch,
        applied.draft.validation.errors,
      );
    } catch (error) {
      if (error instanceof AnswerSkillOptimizationUpstreamError) {
        throw new AnswerSkillRefinementTechnicalError(
          "model_unavailable",
          "模型服务暂时无法修复草稿格式，请稍后重试。",
        );
      }
      throw new AnswerSkillRefinementTechnicalError(
        "skill_validation_failed",
        "修改后的规则未通过格式校验，当前成功草稿保持不变。",
      );
    }
    try {
      applied = applyAnswerSkillPatch(baseSkill, finalPatch);
    } catch (error) {
      if (error instanceof AnswerSkillPatchApplicationError) {
        throw new AnswerSkillRefinementTechnicalError(
          "patch_application_failed",
          "修复后的修改仍无法安全应用到当前规则。",
        );
      }
      throw error;
    }
  }
  if (
    !applied.draft.validation.valid ||
    validateSkillMdStandard(applied.draft.skillMd, baseSkill.dirName).length > 0
  ) {
    throw new AnswerSkillRefinementTechnicalError(
      "skill_validation_failed",
      "修订后的 Skill 草稿未通过格式校验",
    );
  }

  return {
    kind: "applied",
    outcome: {
      kind: "applied",
      assistantSummary: output.assistantSummary,
    },
    analysis: {
      status: "draft_ready",
      targetSkillId: targetSkill.skillId,
      result: {
        diagnosis,
        candidateSkills: [],
        targetSkill,
        patch: finalPatch,
        draft: applied.draft,
        diff: applied.diff,
        testResult: null,
        failure: null,
      },
    },
  };
}

function updateRefinementTurn(
  history: AnswerSkillRefinementTurn[],
  turnId: string,
  update: Pick<
    AnswerSkillRefinementTurn,
    | "status"
    | "toRevision"
    | "completedAt"
    | "assistantSummary"
    | "outcome"
  >,
): AnswerSkillRefinementTurn[] {
  let matched = false;
  const updated = history.map((turn) => {
    if (turn.id !== turnId) return turn;
    if (turn.status !== "pending") {
      throw new AnswerSkillOptimizationConflictError(
        "Refinement turn is no longer pending",
      );
    }
    matched = true;
    return { ...turn, ...update };
  });
  if (!matched) {
    throw new AnswerSkillOptimizationConflictError(
      "Pending refinement turn was not found",
    );
  }
  return updated;
}

function refinementTechnicalOutcome(
  error: unknown,
): Extract<AnswerSkillRefinementOutcome, { kind: "technical_failure" }> {
  if (error instanceof AnswerSkillRefinementTechnicalError) {
    return {
      kind: "technical_failure",
      code: error.code,
      userMessage: error.message,
    };
  }
  if (error instanceof AnswerSkillOptimizationUpstreamError) {
    return {
      kind: "technical_failure",
      code: "model_unavailable",
      userMessage: "模型服务暂时不可用，请稍后使用相同意见重试。",
    };
  }
  if (error instanceof AnswerSkillOptimizationConflictError) {
    return {
      kind: "technical_failure",
      code: "revision_conflict",
      userMessage: "草稿已被其他操作更新，请刷新后基于最新草稿重试。",
    };
  }
  if (error instanceof AnswerSkillOptimizationDraftError) {
    const code: AnswerSkillRefinementTechnicalFailureCode =
      error.failureCode === "skill_validation_failed"
        ? "skill_validation_failed"
        : "invalid_model_output";
    return {
      kind: "technical_failure",
      code,
      userMessage:
        code === "skill_validation_failed"
          ? "修改后的规则未通过格式校验，当前成功草稿保持不变。"
          : "模型生成的规则格式不符合要求，当前成功草稿保持不变。",
    };
  }
  return {
    kind: "technical_failure",
    code: "unknown",
    userMessage: "这次没有生成新草稿，当前成功草稿和重测结果保持不变。",
  };
}

function asRefinementTechnicalError(
  error: unknown,
): AnswerSkillRefinementTechnicalError {
  if (error instanceof AnswerSkillRefinementTechnicalError) return error;
  const outcome = refinementTechnicalOutcome(error);
  return new AnswerSkillRefinementTechnicalError(
    outcome.code,
    outcome.userMessage,
  );
}

function throwStoredRefinementFailure(
  failureCode: AnswerSkillRefinementFailureCode | undefined,
): never {
  const code: AnswerSkillRefinementTechnicalFailureCode =
    failureCode === "model_unavailable"
      ? "model_unavailable"
      : failureCode === "skill_validation_failed"
        ? "skill_validation_failed"
        : failureCode === "patch_application_failed"
          ? "patch_application_failed"
          : failureCode === "revision_conflict"
            ? "revision_conflict"
            : failureCode === "invalid_model_output" ||
                failureCode === "model_output_invalid"
              ? "invalid_model_output"
              : "unknown";
  throw new AnswerSkillRefinementTechnicalError(
    code,
    refinementTechnicalOutcome(
      new AnswerSkillRefinementTechnicalError(
        code,
        "这次没有生成新草稿，当前成功草稿保持不变。",
      ),
    ).userMessage,
  );
}

function replayRefinementMutation(
  run: AnswerSkillOptimizationRun,
  idempotencyKey: string,
  requestHash: string,
): ReviseAnswerSkillOptimizationDto | null {
  const record = getMutationRecord(run, "revise", idempotencyKey);
  if (!record) return null;
  assertMatchingMutationRecord(record, requestHash);
  if (record.responseSummary.refinementOutcome === "failed") {
    throwStoredRefinementFailure(
      record.responseSummary.refinementFailureCode,
    );
  }
  return toReviseDto(run);
}

async function claimAnswerSkillRefinement(input: {
  run: AnswerSkillOptimizationRun;
  source: AnswerSkillRefinementSource;
  userMessage: string;
  qualityEvidence: AnswerSkillRefinementQualityEvidence | null;
  idempotencyKey: string;
  requestHash: string;
}): Promise<AnswerSkillRefinementClaim> {
  const history = getRefinementHistory(input.run.result);
  if (history.length >= MAX_ANSWER_SKILL_REFINEMENT_TURNS) {
    throw new AnswerSkillOptimizationDraftError(
      `草稿补充意见最多保留 ${MAX_ANSWER_SKILL_REFINEMENT_TURNS} 轮`,
      "context_invalid",
    );
  }
  const turnId = randomUUID();
  const createdAt = new Date().toISOString();
  const turn: AnswerSkillRefinementTurn = {
    id: turnId,
    source: input.source,
    fromRevision: input.run.revision,
    toRevision: null,
    userMessage: input.userMessage,
    status: "pending",
    createdAt,
    completedAt: null,
    assistantSummary: null,
    qualityEvidence: input.qualityEvidence,
    outcome: null,
  };
  const pendingRecord = createIdempotencyRecord({
    action: "revise",
    key: input.idempotencyKey,
    requestHash: input.requestHash,
    resultingRevision: input.run.revision,
    status: "processing",
    refinementOutcome: "pending",
    refinementTurnId: turnId,
  });
  const pendingResult = withMutationRecord(
    {
      ...input.run.result,
      refinementHistory: [...history, turn],
    },
    pendingRecord,
  );
  const idempotencySlot = mutationSlot("revise", input.idempotencyKey);
  const result = await query<DbRowAnswerSkillOptimizationRun>(
    `update answer_skill_optimization_runs
       set result_json = $1,
           status = 'processing',
           updated_at = $2
     where id = $3 and user_id = $4
       and revision = $5 and status = $6
     returning *`,
    [
      JSON.stringify(pendingResult),
      createdAt,
      input.run.id,
      input.run.userId,
      input.run.revision,
      input.run.status,
    ],
  );
  const row = result.rows[0];
  if (row) {
    return {
      run: toAnswerSkillOptimizationRun(row),
      claimed: true,
      stableStatus: input.run.status,
      turnId,
      idempotencySlot,
    };
  }

  const current = await getAnswerSkillOptimizationRun(
    input.run.userId,
    input.run.id,
  );
  const replay = replayRefinementMutation(
    current,
    input.idempotencyKey,
    input.requestHash,
  );
  if (replay) {
    const record = getMutationRecord(
      current,
      "revise",
      input.idempotencyKey,
    );
    return {
      run: current,
      claimed: false,
      stableStatus: input.run.status,
      turnId: record?.responseSummary.refinementTurnId ?? turnId,
      idempotencySlot,
    };
  }
  throw new AnswerSkillOptimizationConflictError(
    "Optimization changed before refinement could start",
  );
}

async function finishAnswerSkillRefinement(input: {
  claim: AnswerSkillRefinementClaim;
  idempotencyKey: string;
  requestHash: string;
  refinement: AnswerSkillRefinementAnalysis;
}): Promise<AnswerSkillOptimizationRun> {
  const appliedRefinement =
    input.refinement.kind === "applied" ? input.refinement : null;
  const completedAt = new Date().toISOString();
  const expectedNextRevision = appliedRefinement
    ? input.claim.run.revision + 1
    : input.claim.run.revision;
  const refinementHistory = updateRefinementTurn(
    getRefinementHistory(input.claim.run.result),
    input.claim.turnId,
    {
      status: "succeeded",
      toRevision: appliedRefinement ? expectedNextRevision : null,
      completedAt,
      assistantSummary:
        appliedRefinement?.outcome.assistantSummary ?? null,
      outcome: input.refinement.outcome,
    },
  );
  const transition = buildAnswerSkillRefinementTransition({
    currentRevision: input.claim.run.revision,
    stableStatus: input.claim.stableStatus,
    stableResult: input.claim.run.result,
    appliedResult: appliedRefinement?.analysis.result ?? null,
    refinementHistory,
  });
  const record = createIdempotencyRecord({
    action: "revise",
    key: input.idempotencyKey,
    requestHash: input.requestHash,
    resultingRevision: transition.revision,
    status: transition.status,
    refinementOutcome: "succeeded",
    refinementTurnId: input.claim.turnId,
  });
  const resultJson = withMutationRecord(
    transition.result,
    record,
  );
  const result = await query<DbRowAnswerSkillOptimizationRun>(
    `update answer_skill_optimization_runs
       set target_skill_id = $1,
           result_json = $2,
           status = $3,
           revision = $4,
           updated_at = $5
     where id = $6 and user_id = $7
       and status = 'processing' and revision = $8
       and result_json -> 'idempotencyResults' -> $9 ->> 'requestHash' = $10
     returning *`,
    [
      appliedRefinement
        ? appliedRefinement.analysis.targetSkillId
        : input.claim.run.targetSkillId,
      JSON.stringify(resultJson),
      transition.status,
      transition.revision,
      completedAt,
      input.claim.run.id,
      input.claim.run.userId,
      input.claim.run.revision,
      input.claim.idempotencySlot,
      input.requestHash,
    ],
  );
  const row = result.rows[0];
  if (row) return toAnswerSkillOptimizationRun(row);
  const current = await getAnswerSkillOptimizationRun(
    input.claim.run.userId,
    input.claim.run.id,
  );
  const replay = replayRefinementMutation(
    current,
    input.idempotencyKey,
    input.requestHash,
  );
  if (replay) return current;
  throw new AnswerSkillOptimizationConflictError(
    "Optimization changed while refinement was being generated",
  );
}

async function finishAnswerSkillRefinementFailure(input: {
  claim: AnswerSkillRefinementClaim;
  idempotencyKey: string;
  requestHash: string;
  error: unknown;
}): Promise<AnswerSkillOptimizationRun> {
  const completedAt = new Date().toISOString();
  const outcome = refinementTechnicalOutcome(input.error);
  const failureCode = outcome.code;
  const refinementHistory = updateRefinementTurn(
    getRefinementHistory(input.claim.run.result),
    input.claim.turnId,
    {
      status: "failed",
      toRevision: null,
      completedAt,
      assistantSummary: null,
      outcome,
    },
  );
  const record = createIdempotencyRecord({
    action: "revise",
    key: input.idempotencyKey,
    requestHash: input.requestHash,
    resultingRevision: input.claim.run.revision,
    status: input.claim.stableStatus,
    refinementOutcome: "failed",
    refinementTurnId: input.claim.turnId,
    refinementFailureCode: failureCode,
  });
  const resultJson = withMutationRecord(
    {
      ...input.claim.run.result,
      refinementHistory,
    },
    record,
  );
  const result = await query<DbRowAnswerSkillOptimizationRun>(
    `update answer_skill_optimization_runs
       set result_json = $1,
           status = $2,
           updated_at = $3
     where id = $4 and user_id = $5
       and status = 'processing' and revision = $6
       and result_json -> 'idempotencyResults' -> $7 ->> 'requestHash' = $8
     returning *`,
    [
      JSON.stringify(resultJson),
      input.claim.stableStatus,
      completedAt,
      input.claim.run.id,
      input.claim.run.userId,
      input.claim.run.revision,
      input.claim.idempotencySlot,
      input.requestHash,
    ],
  );
  const row = result.rows[0];
  if (row) return toAnswerSkillOptimizationRun(row);
  const current = await getAnswerSkillOptimizationRun(
    input.claim.run.userId,
    input.claim.run.id,
  );
  const replay = getMutationRecord(
    current,
    "revise",
    input.idempotencyKey,
  );
  if (replay) {
    assertMatchingMutationRecord(replay, input.requestHash);
    return current;
  }
  throw new AnswerSkillOptimizationConflictError(
    "Optimization changed while refinement failure was being saved",
  );
}

async function refineAnswerSkillOptimization(
  input: RefineAnswerSkillOptimizationInput,
): Promise<ReviseAnswerSkillOptimizationDto> {
  assertKnownFields(
    input,
    [
      "userId",
      "optimizationId",
      "expectedRevision",
      "additionalFeedback",
      "revisionSource",
      "idempotencyKey",
    ],
    "refine",
  );
  const userId = normalizeUserId(input.userId);
  const optimizationId = toPositiveSafeInteger(
    input.optimizationId,
    "optimizationId",
  );
  const expectedRevision = toPositiveSafeInteger(
    input.expectedRevision,
    "expectedRevision",
  );
  const requestedSource = normalizeRefinementSource(input.revisionSource);
  const hasAdditionalFeedback = "additionalFeedback" in input;
  if (
    requestedSource === "alternative_regeneration" &&
    hasAdditionalFeedback
  ) {
    throw new AnswerSkillOptimizationValidationError(
      "alternative_regeneration cannot include additionalFeedback",
    );
  }
  const additionalFeedback =
    requestedSource === "alternative_regeneration"
      ? null
      : normalizeAdditionalFeedback(
          hasAdditionalFeedback ? input.additionalFeedback : undefined,
          requestedSource === "draft_review",
        );
  const userMessage =
    requestedSource === "alternative_regeneration"
      ? "根据目前所有要求重新生成另一版草稿"
      : additionalFeedback ?? "按预览问题修改当前草稿";
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const requestHash = createMutationHash({
    action: "refine",
    optimizationId,
    expectedRevision,
    source: requestedSource,
    additionalFeedback,
  });

  const run = await getAnswerSkillOptimizationRun(userId, optimizationId);
  const replay = replayRefinementMutation(run, idempotencyKey, requestHash);
  if (replay) return replay;
  assertRevision(run, expectedRevision);
  if (!["draft_ready", "test_ready", "failed"].includes(run.status)) {
    throw new AnswerSkillOptimizationDraftError(
      `Cannot refine an optimization in ${run.status} status`,
    );
  }
  if (
    requestedSource === "alternative_regeneration" &&
    run.status !== "draft_ready"
  ) {
    throw new AnswerSkillOptimizationDraftError(
      "只有尚未重测的成功草稿可以重新生成另一套方案",
      "context_invalid",
    );
  }
  if (
    requestedSource === "test_failure" &&
    run.status !== "test_ready"
  ) {
    throw new AnswerSkillOptimizationDraftError(
      "只有当前效果预览发现问题时才能按预览问题修改草稿",
      "context_invalid",
    );
  }
  const context = await loadAnswerSkillOptimizationContext(run);
  assertAnswerOptimizationReplayAvailable(context.answerRun, context.run.answerSide);
  validateStoredTestDraft(run, context);
  const source = requestedSource;
  const qualityEvidence = requireRefinementPreviewEvidence(run, source);
  const claim = await claimAnswerSkillRefinement({
    run,
    source,
    userMessage,
    qualityEvidence,
    idempotencyKey,
    requestHash,
  });
  if (!claim.claimed) return toReviseDto(claim.run);

  try {
    const refinement = await analyzeAnswerSkillRefinement({
      run,
      context,
      additionalFeedback,
      source,
      qualityEvidence,
    });
    const updated = await finishAnswerSkillRefinement({
      claim,
      idempotencyKey,
      requestHash,
      refinement,
    });
    return toReviseDto(updated);
  } catch (error) {
    const technicalError = asRefinementTechnicalError(error);
    try {
      await finishAnswerSkillRefinementFailure({
        claim,
        idempotencyKey,
        requestHash,
        error: technicalError,
      });
    } catch {
      // Preserve the original model/domain error if failure persistence loses a race.
    }
    throw technicalError;
  }
}

async function regenerateAnswerSkillOptimization(
  input: RegenerateAnswerSkillOptimizationInput,
): Promise<ReviseAnswerSkillOptimizationDto> {
  assertKnownFields(
    input,
    [
      "userId",
      "optimizationId",
      "expectedRevision",
      "feedback",
      "targetSkillId",
      "targetSkillIds",
      "idempotencyKey",
    ],
    "revise",
  );
  const userId = normalizeUserId(input.userId);
  const optimizationId = toPositiveSafeInteger(
    input.optimizationId,
    "optimizationId",
  );
  const expectedRevision = toPositiveSafeInteger(
    input.expectedRevision,
    "expectedRevision",
  );
  const feedback = normalizeFeedback(input.feedback);
  const targetSkillId = normalizeOptionalSkillId(input.targetSkillId);
  const targetSkillIds = normalizeTargetSkillIds(input.targetSkillIds);
  if (targetSkillIds && targetSkillId) {
    throw new AnswerSkillOptimizationValidationError(
      "targetSkillId and targetSkillIds cannot be provided at the same time",
    );
  }
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const requestHash = createMutationHash({
    optimizationId,
    expectedRevision,
    feedback,
    targetSkillId: targetSkillId ?? null,
    targetSkillIds: targetSkillIds ?? null,
  });

  const run = await getAnswerSkillOptimizationRun(userId, optimizationId);
  const replay = getMutationRecord(run, "revise", idempotencyKey);
  if (replay) {
    assertMatchingMutationRecord(replay, requestHash);
    return toReviseDto(run);
  }
  assertRevision(run, expectedRevision);
  if (!REVISE_ALLOWED_STATUSES.includes(run.status)) {
    throw new AnswerSkillOptimizationDraftError(
      `Cannot revise an optimization in ${run.status} status`,
    );
  }

  const context = await loadAnswerSkillOptimizationContext(run);
  assertAnswerOptimizationReplayAvailable(context.answerRun, context.run.answerSide);
  const isMultiTarget = Boolean(targetSkillIds && targetSkillIds.length > 0);
  if (isMultiTarget) {
    validateSelectedTargets(run, context, targetSkillIds);
  } else {
    validateSelectedTarget(run, context, targetSkillId);
  }
  const activeTargetSkillId = isMultiTarget
    ? targetSkillIds![0]
    : targetSkillId;
  const claim = await claimRevisionForAnalysis({
    run,
    feedback,
    selectedTargetSkillId: activeTargetSkillId,
    idempotencyKey,
    requestHash,
  });
  if (!claim.claimed) return toReviseDto(claim.run);
  const claimed = claim.run;

  try {
    const analysis = isMultiTarget
      ? await analyzeAnswerSkillOptimizationMultiTarget(
          context,
          feedback,
          targetSkillIds!,
        )
      : await analyzeAnswerSkillOptimization(
          context,
          feedback,
          targetSkillId,
        );
    const updated = await finishRevisionAnalysis({
      claimed,
      feedback,
      idempotencyKey,
      requestHash,
      analysis,
    });
    return toReviseDto(updated);
  } catch (error) {
    try {
      await finishRevisionFailure({
        claimed,
        feedback,
        idempotencyKey,
        requestHash,
        error,
      });
    } catch {
      // Preserve the model/domain error if the conditional failure update loses a race.
    }
    throw error;
  }
}

export async function reviseAnswerSkillOptimization(
  input: ReviseAnswerSkillOptimizationInput,
): Promise<AnswerSkillOptimizationDetailDto> {
  const revised = await ("revisionSource" in input
    ? refineAnswerSkillOptimization(input)
    : regenerateAnswerSkillOptimization(input));
  return getAnswerSkillOptimizationDetail(input.userId, revised.optimizationId);
}

function validateStoredTestDraft(
  run: AnswerSkillOptimizationRun,
  context: AnswerSkillOptimizationContext,
): AnswerOptimizationDraft {
  const targetSkill = run.result.targetSkill;
  const patch = run.result.patch;
  const draft = run.result.draft;
  if (!targetSkill || !patch || !draft) {
    throw new AnswerSkillOptimizationDraftError(
      "Optimization does not contain a complete Skill draft",
    );
  }
  if (
    run.targetSkillId !== targetSkill.skillId ||
    draft.skillId !== targetSkill.skillId
  ) {
    throw new AnswerSkillOptimizationDraftError(
      "Stored target Skill and draft do not match",
    );
  }
  if (!draft.validation.valid || draft.validation.errors.length > 0) {
    throw new AnswerSkillOptimizationDraftError(
      "Stored Skill draft has not passed validation",
      "skill_validation_failed",
    );
  }

  const baseSkill = context.skills.find(
    (skill) => skill.id === targetSkill.skillId,
  );
  if (!baseSkill) {
    throw new AnswerSkillOptimizationNotFoundError(
      "Target Skill not found in the base Package version",
    );
  }

  let reapplied;
  try {
    reapplied = applyAnswerSkillPatch(baseSkill, patch);
  } catch (error) {
    if (error instanceof AnswerSkillPatchApplicationError) {
      throw new AnswerSkillOptimizationDraftError(
        error.message,
        "skill_validation_failed",
      );
    }
    throw error;
  }
  if (
    !reapplied.draft.validation.valid ||
    reapplied.draft.skillMd !== draft.skillMd
  ) {
    throw new AnswerSkillOptimizationDraftError(
      "Stored Skill draft does not match its validated patch",
      "skill_validation_failed",
    );
  }

  const validationErrors = validateSkillMdStandard(
    draft.skillMd,
    baseSkill.dirName,
  );
  if (validationErrors.length > 0) {
    throw new AnswerSkillOptimizationDraftError(
      `Stored Skill draft validation failed: ${validationErrors
        .slice(0, 5)
        .join("; ")}`,
      "skill_validation_failed",
    );
  }
  return draft;
}

function compareArenaMessageOrder(
  left: ArenaMessage,
  right: ArenaMessage,
): number {
  const leftTime = Date.parse(left.createdAt);
  const rightTime = Date.parse(right.createdAt);
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) {
    throw new AnswerSkillOptimizationDraftError(
      "Recorded Arena message timestamp is invalid",
      "replay_context_unavailable",
    );
  }
  return leftTime === rightTime ? left.id - right.id : leftTime - rightTime;
}

function isReplayHistoryMessage(
  message: ArenaMessage,
  side: "baseline" | "enhanced",
): boolean {
  return (
    (message.side === "shared" && message.role === "user") ||
    (message.side === side && message.role === "assistant")
  );
}

async function loadRecordedAnswerReplayContext(
  context: AnswerSkillOptimizationContext,
): Promise<AnswerSkillOptimizationReplayContext> {
  const sideProvenance = answerRunSideProvenance(
    context.answerRun,
    context.run.answerSide,
  );
  const contextMessageIds = sideProvenance.contextMessageIds;
  if (contextMessageIds === null) {
    throw new AnswerSkillOptimizationDraftError(
      "The original enhanced answer does not have recorded replay context",
      "replay_context_unavailable",
    );
  }
  const enhancedModel = sideProvenance.model;
  if (!enhancedModel?.trim()) {
    throw new AnswerSkillOptimizationDraftError(
      "The original enhanced answer does not have a recorded model",
      "replay_model_unavailable",
    );
  }

  let historyMessages: ArenaMessage[] = [];
  if (contextMessageIds.length > 0) {
    const result = await query<DbRowMessage>(
      `select * from arena_messages
       where user_id = $1 and thread_id = $2
         and id = any($3::bigint[])
       order by created_at asc, id asc`,
      [context.run.userId, context.run.threadId, contextMessageIds],
    );
    historyMessages = result.rows.map(toArenaMessage);
    const loadedIds = historyMessages.map((message) => message.id);
    if (
      loadedIds.length !== contextMessageIds.length ||
      loadedIds.some((messageId, index) => messageId !== contextMessageIds[index])
    ) {
      throw new AnswerSkillOptimizationDraftError(
        "Recorded Arena replay messages are missing or out of order",
        "replay_context_unavailable",
      );
    }
  }

  for (let index = 0; index < historyMessages.length; index += 1) {
    const message = historyMessages[index];
    if (!message || !isReplayHistoryMessage(message, context.run.answerSide)) {
      throw new AnswerSkillOptimizationDraftError(
        "Recorded Arena replay context contains an invalid message",
        "replay_context_unavailable",
      );
    }
    if (
      message.id === context.question.id ||
      message.id === context.originalAnswer.id ||
      compareArenaMessageOrder(message, context.question) >= 0
    ) {
      throw new AnswerSkillOptimizationDraftError(
        "Recorded Arena replay context contains a message outside the original history",
        "replay_context_unavailable",
      );
    }
    const previous = historyMessages[index - 1];
    if (previous && compareArenaMessageOrder(previous, message) >= 0) {
      throw new AnswerSkillOptimizationDraftError(
        "Recorded Arena replay context order is invalid",
        "replay_context_unavailable",
      );
    }
  }

  const promptContext = buildArenaSidePromptContext(
    historyMessages,
    context.run.answerSide,
    context.question,
  );
  if (
    promptContext.contextMessageIds.length !== contextMessageIds.length ||
    promptContext.contextMessageIds.some(
      (messageId, index) => messageId !== contextMessageIds[index],
    )
  ) {
    throw new AnswerSkillOptimizationDraftError(
      "Recorded Arena replay context does not match the enhanced prompt",
      "replay_context_unavailable",
    );
  }
  return { promptContext, enhancedModel };
}

function buildAnswerOptimizationTestContext(
  context: AnswerSkillOptimizationContext,
  draft: AnswerOptimizationDraft,
): AnswerSkillOptimizationTestContext {
  const targetSkill = context.run.result.targetSkill;
  if (!targetSkill || targetSkill.skillId !== draft.skillId) {
    throw new AnswerSkillOptimizationDraftError(
      "Target Skill is unavailable for draft testing",
    );
  }
  if (
    new Set(context.usedSkillIds).size !== context.usedSkillIds.length
  ) {
    throw new AnswerSkillOptimizationDraftError(
      "Recorded used Skill IDs contain duplicates",
      "context_invalid",
    );
  }
  if (
    context.usedSkillIds.length > 0 &&
    !context.usedSkillIds.includes(targetSkill.skillId)
  ) {
    throw new AnswerSkillOptimizationDraftError(
      "Target Skill was not part of the recorded enhanced answer context",
      "context_invalid",
    );
  }
  if (
    context.usedSkillIds.length === 0 &&
    targetSkill.selectionSource !== "user_selected"
  ) {
    throw new AnswerSkillOptimizationDraftError(
      "A target Skill must be selected before testing an answer with no recorded Skill",
    );
  }

  const skills = context.version.snapshot.skills.map((skill) =>
    skill.id === draft.skillId ? { ...skill, skillMd: draft.skillMd } : skill,
  );
  const snapshot: AgentPackageSnapshot = {
    ...context.version.snapshot,
    skills,
  };
  const usedSkillIds =
    context.usedSkillIds.length > 0
      ? [...context.usedSkillIds]
      : [targetSkill.skillId];
  const byId = new Map(skills.map((skill) => [skill.id, skill]));
  const selectedSkills = usedSkillIds.map((skillId) => {
    const skill = byId.get(skillId);
    if (!skill) {
      throw new AnswerSkillOptimizationDraftError(
        "A recorded Skill is missing from the test snapshot",
        "context_invalid",
      );
    }
    return skill;
  });

  return {
    snapshot,
    selectedSkills,
    usedSkillIds,
    targetSkillId: targetSkill.skillId,
  };
}

function buildAnswerOptimizationTestPrompt(
  testContext: AnswerSkillOptimizationTestContext,
  replayContext: AnswerSkillOptimizationReplayContext,
): {
  systemPrompt: string;
  userPrompt: string;
  model: string;
  temperature: number;
} {
  return {
    systemPrompt: buildEnhancedPrompt(
      testContext.snapshot,
      testContext.selectedSkills,
    ),
    userPrompt: replayContext.promptContext.userPrompt,
    model: replayContext.enhancedModel,
    temperature: 0.3,
  };
}

const ANSWER_OPTIMIZATION_TEST_SAMPLE_COUNT = 3;

async function generateAnswerOptimizationTestSamples(
  prompt: ReturnType<typeof buildAnswerOptimizationTestPrompt>,
): Promise<[string, string, string]> {
  const settled = await Promise.allSettled(
    Array.from(
      { length: ANSWER_OPTIMIZATION_TEST_SAMPLE_COUNT },
      () => generateText(prompt),
    ),
  );
  const rejected = settled.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (rejected) throw rejected.reason;
  const samples = settled.map((result) =>
    result.status === "fulfilled" ? result.value.trim() : "",
  );
  if (samples.some((sample) => !sample)) {
    throw new Error("Model returned an empty answer sample");
  }
  return samples as [string, string, string];
}

function buildRuntimeSelectionCheck(
  testContext: AnswerSkillOptimizationTestContext,
  question: string,
  fixedSkillVersionId: number | null,
): {
  targetSkillId: string;
  selectedSkillIds: string[];
  targetSkillSelected: boolean;
} {
  const selectedSkillIds = fixedSkillVersionId !== null
    ? [...testContext.usedSkillIds]
    : selectRelevantSkills(testContext.snapshot, question).map(
        (skill) => skill.id,
      );
  return {
    targetSkillId: testContext.targetSkillId,
    selectedSkillIds,
    targetSkillSelected: selectedSkillIds.includes(
      testContext.targetSkillId,
    ),
  };
}

function evaluationUserFacingTexts(
  output: AnswerSkillTestEvaluationOutput,
): string[] {
  return [
    output.overallSummary,
    ...output.samples.flatMap((sample) => [
      ...sample.satisfiedRequirements,
      ...sample.unmetRequirements,
      ...sample.riskNotes,
    ]),
  ];
}

function evaluationNeedsChineseLocalization(
  output: AnswerSkillTestEvaluationOutput,
): boolean {
  return evaluationUserFacingTexts(output).some(
    userFacingTextNeedsChinese,
  );
}

function assertEvaluationLocalizationPreservesStructure(
  original: AnswerSkillTestEvaluationOutput,
  localized: AnswerSkillTestEvaluationOutput,
): void {
  const invalid =
    localized.bestSampleIndex !== original.bestSampleIndex ||
    localized.samples.some((sample, index) => {
      const originalSample = original.samples[index];
      return (
        !originalSample ||
        sample.sampleIndex !== originalSample.sampleIndex ||
        sample.passed !== originalSample.passed ||
        sample.score !== originalSample.score ||
        sample.criticalRisk !== originalSample.criticalRisk ||
        sample.satisfiedRequirements.length !==
          originalSample.satisfiedRequirements.length ||
        sample.unmetRequirements.length !==
          originalSample.unmetRequirements.length ||
        sample.riskNotes.length !== originalSample.riskNotes.length
      );
    });
  if (invalid) {
    throw new AnswerSkillTestEvaluationContractError(
      "Evaluation localization changed protected fields",
    );
  }
}

async function localizeAnswerSkillTestEvaluation(
  output: AnswerSkillTestEvaluationOutput,
  model: string,
): Promise<AnswerSkillTestEvaluationOutput> {
  if (!evaluationNeedsChineseLocalization(output)) return output;
  const prompt = buildAnswerSkillTestEvaluationLocalizationPrompt({
    output,
  });
  const raw = await generateJson<unknown>(
    {
      ...prompt,
      model,
      temperature: 0,
    },
    0,
    false,
  );
  const localized = parseAnswerSkillTestEvaluationOutput(raw);
  assertEvaluationLocalizationPreservesStructure(output, localized);
  if (evaluationNeedsChineseLocalization(localized)) {
    throw new AnswerSkillTestEvaluationContractError(
      "评估模型返回的用户可见文本未使用简体中文",
    );
  }
  return localized;
}

async function evaluateAnswerOptimizationTestSamples(input: {
  context: AnswerSkillOptimizationContext;
  replayContext: AnswerSkillOptimizationReplayContext;
  samples: [string, string, string];
}): Promise<ReturnType<typeof parseAnswerSkillTestEvaluationOutput>> {
  const diagnosis = input.context.run.result.diagnosis;
  if (!diagnosis) {
    throw new AnswerSkillOptimizationDraftError(
      "Optimization diagnosis is unavailable for draft testing",
    );
  }
  const refinementFeedback = (
    input.context.run.result.refinementHistory ?? []
  )
    .filter(
      (turn) =>
        turn.outcome?.kind === "applied" &&
        turn.source !== "alternative_regeneration" &&
        turn.toRevision !== null &&
        turn.toRevision <= input.context.run.revision,
    )
    .map((turn) => turn.userMessage);
  const prompt = buildAnswerSkillTestEvaluationPrompt({
    question: input.context.question.content,
    conversationContext: input.replayContext.promptContext.userPrompt,
    userFeedback: input.context.run.userFeedback,
    refinementFeedback,
    diagnosis,
    rubricMd: input.context.version.snapshot.rubricMd,
    beforeAnswer: input.context.originalAnswer.content,
    afterSamples: input.samples,
  });
  const raw = await generateJson<unknown>(
    {
      ...prompt,
      model: input.replayContext.enhancedModel,
    },
    0,
    false,
  );
  const evaluation = parseAnswerSkillTestEvaluationOutput(raw);
  return localizeAnswerSkillTestEvaluation(
    evaluation,
    input.replayContext.enhancedModel,
  );
}

function buildQualityGatedTestResult(input: {
  revision: number;
  context: AnswerSkillOptimizationContext;
  replayContext: AnswerSkillOptimizationReplayContext;
  testContext: AnswerSkillOptimizationTestContext;
  answers: [string, string, string];
  evaluation: ReturnType<typeof parseAnswerSkillTestEvaluationOutput>;
  runtimeSelectionCheck: {
    targetSkillId: string;
    selectedSkillIds: string[];
    targetSkillSelected: boolean;
  };
}): AnswerOptimizationTestResult {
  const samples = input.evaluation.samples.map((evaluation) => ({
    answer: input.answers[evaluation.sampleIndex],
    passed: evaluation.passed,
    score: evaluation.score,
    satisfiedRequirements: evaluation.satisfiedRequirements,
    unmetRequirements: evaluation.unmetRequirements,
    riskNotes: evaluation.riskNotes,
    criticalRisk: evaluation.criticalRisk,
  })) as AnswerOptimizationTestResult["samples"];
  const passedCount = samples.filter((sample) => sample.passed).length;
  const hasCriticalRisk = samples.some((sample) => sample.criticalRisk);
  const passed =
    passedCount >= 2 &&
    !hasCriticalRisk &&
    input.runtimeSelectionCheck.targetSkillSelected;
  const bestSample = samples[input.evaluation.bestSampleIndex];
  if (!bestSample) {
    throw new AnswerSkillOptimizationDraftError(
      "Draft test evaluation selected an invalid sample",
    );
  }
  return {
    testedRevision: input.revision,
    question: input.context.question.content,
    beforeAnswer: input.context.originalAnswer.content,
    afterAnswer: bestSample.answer,
    samples,
    qualityGate: {
      passed,
      passedCount,
      sampleCount: 3,
      bestSampleIndex: input.evaluation.bestSampleIndex,
      overallSummary: input.evaluation.overallSummary,
    },
    runtimeSelectionCheck: input.runtimeSelectionCheck,
    usedSkillIds: input.testContext.usedSkillIds,
    contextMessageIds:
      input.replayContext.promptContext.contextMessageIds,
    model: input.replayContext.enhancedModel,
    replayMode: "recorded_context",
    createdAt: new Date().toISOString(),
  };
}

function toTestDtoFromResult(
  run: Pick<
    AnswerSkillOptimizationRun,
    "id" | "revision" | "updatedAt" | "answerSkillVersionId"
  >,
  testResult: AnswerOptimizationTestResult,
): TestAnswerSkillOptimizationDto {
  const publicResult = publicTestResult(run, testResult);
  if (!publicResult) {
    throw new AnswerSkillOptimizationConflictError(
      "Draft test result is unavailable",
    );
  }
  return {
    optimizationId: run.id,
    status: "test_ready",
    revision: run.revision,
    testResult: publicResult,
    updatedAt: run.updatedAt,
  };
}

function toTestDto(
  run: AnswerSkillOptimizationRun,
): TestAnswerSkillOptimizationDto {
  const testResult = run.result.testResult;
  if (
    run.status !== "test_ready" ||
    !testResult ||
    testResult.testedRevision !== run.revision
  ) {
    throw new AnswerSkillOptimizationConflictError(
      "Draft test result is unavailable",
    );
  }
  return toTestDtoFromResult(run, testResult);
}

function testReplayDto(
  run: AnswerSkillOptimizationRun,
  record: AnswerOptimizationIdempotencyRecord,
): TestAnswerSkillOptimizationDto {
  const testResult = record.responseSummary.testResult;
  if (
    record.action !== "test" ||
    record.responseSummary.testOutcome !== "succeeded" ||
    !testResult
  ) {
    throw new AnswerSkillOptimizationConflictError(
      "Completed draft test result is unavailable",
    );
  }
  return toTestDtoFromResult(
    {
      id: run.id,
      revision: record.resultingRevision,
      updatedAt: testResult.createdAt,
      answerSkillVersionId: run.answerSkillVersionId,
    },
    testResult,
  );
}

function testFailureError(
  failureCode: AnswerOptimizationTestFailure["code"] = "model_unavailable",
): AnswerSkillOptimizationUpstreamError | AnswerSkillOptimizationDraftError {
  if (failureCode === "evaluation_invalid") {
    return new AnswerSkillOptimizationDraftError(
      "重测评估结果无效，请重新重测",
      "model_output_invalid",
    );
  }
  return new AnswerSkillOptimizationUpstreamError(
    "Draft answer generation was temporarily unavailable",
    503,
  );
}

async function replayTestMutation(
  initialRun: AnswerSkillOptimizationRun,
  idempotencyKey: string,
  requestHash: string,
  waitForPending = true,
): Promise<TestAnswerSkillOptimizationDto | null> {
  let run = initialRun;
  const deadline = Date.now() + config.llmTimeoutMs + 1_000;

  while (true) {
    const record = getMutationRecord(run, "test", idempotencyKey);
    if (!record) return null;
    assertMatchingMutationRecord(record, requestHash);
    if (record.responseSummary.testOutcome === "succeeded") {
      return testReplayDto(run, record);
    }
    if (record.responseSummary.testOutcome === "failed") {
      throw testFailureError(record.responseSummary.testFailureCode);
    }
    if (record.responseSummary.testOutcome !== "pending") {
      throw new AnswerSkillOptimizationConflictError(
        "Stored test idempotency result is invalid",
      );
    }
    if (run.status !== "processing") {
      throw new AnswerSkillOptimizationDraftError(
        `Cannot continue a draft test in ${run.status} status`,
      );
    }
    if (!waitForPending) {
      throw new AnswerSkillOptimizationConflictError(
        "Draft test completion could not be persisted",
      );
    }
    if (Date.now() >= deadline) {
      throw new AnswerSkillOptimizationConflictError(
        "Draft test is still processing",
      );
    }
    await new Promise((resolve) =>
      setTimeout(resolve, TEST_REPLAY_POLL_INTERVAL_MS),
    );
    run = await getAnswerSkillOptimizationRun(run.userId, run.id);
  }
}

async function claimAnswerSkillOptimizationTest(input: {
  run: AnswerSkillOptimizationRun;
  idempotencyKey: string;
  requestHash: string;
}): Promise<TestClaim | TestAnswerSkillOptimizationDto> {
  if (
    input.run.status !== "draft_ready" &&
    input.run.status !== "test_ready"
  ) {
    throw new AnswerSkillOptimizationDraftError(
      `Cannot test an optimization in ${input.run.status} status`,
    );
  }
  const previousStatus = input.run.status;
  const idempotencySlot = mutationSlot("test", input.idempotencyKey);
  const record = createIdempotencyRecord({
    action: "test",
    key: input.idempotencyKey,
    requestHash: input.requestHash,
    resultingRevision: input.run.revision,
    status: "processing",
    testOutcome: "pending",
  });
  const pendingResult = withMutationRecord(
    {
      ...input.run.result,
      testFailure: null,
    },
    record,
  );
  const updatedAt = new Date().toISOString();
  const updated = await query<DbRowAnswerSkillOptimizationRun>(
    `update answer_skill_optimization_runs
       set result_json = $1, status = 'processing', updated_at = $2
     where id = $3 and user_id = $4 and revision = $5
       and status in ('draft_ready', 'test_ready')
     returning *`,
    [
      JSON.stringify(pendingResult),
      updatedAt,
      input.run.id,
      input.run.userId,
      input.run.revision,
    ],
  );
  const row = updated.rows[0];
  if (row) {
    return {
      claimed: toAnswerSkillOptimizationRun(row),
      previousStatus,
      previousResult: input.run.result,
      idempotencySlot,
    };
  }

  const current = await getAnswerSkillOptimizationRun(
    input.run.userId,
    input.run.id,
  );
  const replay = await replayTestMutation(
    current,
    input.idempotencyKey,
    input.requestHash,
  );
  if (replay) return replay;
  throw new AnswerSkillOptimizationConflictError(
    "Optimization changed before draft testing could start",
  );
}

async function finishAnswerSkillOptimizationTest(input: {
  claim: TestClaim;
  idempotencyKey: string;
  requestHash: string;
  testResult: AnswerOptimizationTestResult;
}): Promise<TestAnswerSkillOptimizationDto> {
  const record = createIdempotencyRecord({
    action: "test",
    key: input.idempotencyKey,
    requestHash: input.requestHash,
    resultingRevision: input.claim.claimed.revision,
    status: "test_ready",
    testOutcome: "succeeded",
    testResult: input.testResult,
  });
  const resultJson = withMutationRecord(
    {
      ...input.claim.claimed.result,
      testResult: input.testResult,
      testFailure: null,
    },
    record,
  );
  const completedAt = input.testResult.createdAt;
  const updated = await query<DbRowAnswerSkillOptimizationRun>(
    `update answer_skill_optimization_runs
       set result_json = $1, status = 'test_ready', updated_at = $2
     where id = $3 and user_id = $4 and revision = $5
       and status = 'processing'
       and result_json -> 'idempotencyResults' -> $6 ->> 'requestHash' = $7
     returning *`,
    [
      JSON.stringify(resultJson),
      completedAt,
      input.claim.claimed.id,
      input.claim.claimed.userId,
      input.claim.claimed.revision,
      input.claim.idempotencySlot,
      input.requestHash,
    ],
  );
  const row = updated.rows[0];
  if (row) return toTestDto(toAnswerSkillOptimizationRun(row));

  const current = await getAnswerSkillOptimizationRun(
    input.claim.claimed.userId,
    input.claim.claimed.id,
  );
  const replay = await replayTestMutation(
    current,
    input.idempotencyKey,
    input.requestHash,
    false,
  );
  if (replay) return replay;
  throw new AnswerSkillOptimizationConflictError(
    "Optimization changed while the draft answer was being generated",
  );
}

async function restoreAnswerSkillOptimizationTestFailure(input: {
  claim: TestClaim;
  idempotencyKey: string;
  requestHash: string;
  failure: Pick<AnswerOptimizationTestFailure, "code" | "message">;
}): Promise<void> {
  const failedAt = new Date().toISOString();
  const record = createIdempotencyRecord({
    action: "test",
    key: input.idempotencyKey,
    requestHash: input.requestHash,
    resultingRevision: input.claim.claimed.revision,
    status: input.claim.previousStatus,
    testOutcome: "failed",
    testFailureCode: input.failure.code,
  });
  const resultJson = withMutationRecord(
    {
      ...input.claim.previousResult,
      testFailure: {
        code: input.failure.code,
        message: input.failure.message,
        failedAt,
      },
    },
    record,
  );
  await query(
    `update answer_skill_optimization_runs
       set result_json = $1, status = $2, updated_at = $3
     where id = $4 and user_id = $5 and revision = $6
       and status = 'processing'
       and result_json -> 'idempotencyResults' -> $7 ->> 'requestHash' = $8`,
    [
      JSON.stringify(resultJson),
      input.claim.previousStatus,
      failedAt,
      input.claim.claimed.id,
      input.claim.claimed.userId,
      input.claim.claimed.revision,
      input.claim.idempotencySlot,
      input.requestHash,
    ],
  );
}

export async function testAnswerSkillOptimization(
  input: TestAnswerSkillOptimizationInput,
): Promise<TestAnswerSkillOptimizationDto> {
  assertKnownFields(
    input,
    ["userId", "optimizationId", "expectedRevision", "idempotencyKey"],
    "test",
  );
  const userId = normalizeUserId(input.userId);
  const optimizationId = toPositiveSafeInteger(
    input.optimizationId,
    "optimizationId",
  );
  const expectedRevision = toPositiveSafeInteger(
    input.expectedRevision,
    "expectedRevision",
  );
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const requestHash = createMutationHash({
    action: "test",
    optimizationId,
    expectedRevision,
  });

  const run = await getAnswerSkillOptimizationRun(userId, optimizationId);
  if (run.status === "cancelled" || run.status === "completed") {
    throw new AnswerSkillOptimizationDraftError(
      `Cannot test an optimization in ${run.status} status`,
    );
  }
  const replay = await replayTestMutation(
    run,
    idempotencyKey,
    requestHash,
  );
  if (replay) return replay;
  assertRevision(run, expectedRevision);
  if (run.status === "processing") {
    throw new AnswerSkillOptimizationConflictError(
      "Optimization is already processing another operation",
    );
  }
  if (!TEST_ALLOWED_STATUSES.some((status) => status === run.status)) {
    throw new AnswerSkillOptimizationDraftError(
      `Cannot test an optimization in ${run.status} status`,
    );
  }

  const context = await loadAnswerSkillOptimizationContext(run);
  assertAnswerOptimizationReplayAvailable(context.answerRun, context.run.answerSide);
  const replayContext = await loadRecordedAnswerReplayContext(context);
  const draft = validateStoredTestDraft(run, context);
  const testContext = buildAnswerOptimizationTestContext(context, draft);
  const prompt = buildAnswerOptimizationTestPrompt(
    testContext,
    replayContext,
  );
  if (!run.result.diagnosis) {
    throw new AnswerSkillOptimizationDraftError(
      "Optimization diagnosis is unavailable for draft testing",
    );
  }
  const runtimeSelectionCheck = buildRuntimeSelectionCheck(
    testContext,
    context.question.content,
    answerRunSideProvenance(context.answerRun, context.run.answerSide)
      .skillVersionId,
  );
  const claimResult = await claimAnswerSkillOptimizationTest({
    run,
    idempotencyKey,
    requestHash,
  });
  if (!("claimed" in claimResult)) return claimResult;
  const claim = claimResult;

  let testResult: AnswerOptimizationTestResult;
  try {
    const answers = await generateAnswerOptimizationTestSamples(prompt);
    const evaluation = await evaluateAnswerOptimizationTestSamples({
      context,
      replayContext,
      samples: answers,
    });
    testResult = buildQualityGatedTestResult({
      revision: claim.claimed.revision,
      context,
      replayContext,
      testContext,
      answers,
      evaluation,
      runtimeSelectionCheck,
    });
  } catch (error) {
    const evaluationInvalid =
      error instanceof AnswerSkillTestEvaluationContractError ||
      error instanceof LlmInvalidJsonError;
    const failure: Pick<
      AnswerOptimizationTestFailure,
      "code" | "message"
    > = evaluationInvalid
      ? {
          code: "evaluation_invalid",
          message: "重测评估结果无效，请重新重测。",
        }
      : {
          code: "model_unavailable",
          message: "Draft answer generation was temporarily unavailable.",
        };
    try {
      await restoreAnswerSkillOptimizationTestFailure({
        claim,
        idempotencyKey,
        requestHash,
        failure,
      });
    } catch {
      // Preserve the upstream error if restoring the stable state also fails.
    }
    throw testFailureError(failure.code);
  }

  return finishAnswerSkillOptimizationTest({
    claim,
    idempotencyKey,
    requestHash,
    testResult,
  });
}

function normalizeVersionNote(value: string | undefined): string {
  if (value === undefined) return "";
  if (typeof value !== "string") {
    throw new AnswerSkillOptimizationValidationError(
      "versionNote must be a string",
    );
  }
  const normalized = value.trim();
  if (normalized.length > 500) {
    throw new AnswerSkillOptimizationValidationError(
      "versionNote must contain at most 500 characters",
    );
  }
  return normalized;
}

function parsePackageSnapshot(value: unknown): AgentPackageSnapshot {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      throw new AnswerSkillOptimizationDraftError(
        "Base Package snapshot contains invalid JSON",
        "context_invalid",
      );
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AnswerSkillOptimizationDraftError(
      "Base Package snapshot is invalid",
      "context_invalid",
    );
  }
  const object = parsed as Record<string, unknown>;
  for (const field of [
    "name",
    "description",
    "versionLabel",
    "agentMd",
    "rubricMd",
  ] as const) {
    if (typeof object[field] !== "string") {
      throw new AnswerSkillOptimizationDraftError(
        `Base Package snapshot ${field} is invalid`,
        "context_invalid",
      );
    }
  }
  if (!Array.isArray(object.skills)) {
    throw new AnswerSkillOptimizationDraftError(
      "Base Package snapshot skills are invalid",
      "context_invalid",
    );
  }
  const skills = object.skills.map((value, index): PackageSkill => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new AnswerSkillOptimizationDraftError(
        `Base Package Skill ${index} is invalid`,
        "context_invalid",
      );
    }
    const skill = value as Record<string, unknown>;
    for (const field of [
      "id",
      "dirName",
      "name",
      "description",
      "skillMd",
    ] as const) {
      if (typeof skill[field] !== "string") {
        throw new AnswerSkillOptimizationDraftError(
          `Base Package Skill ${index} ${field} is invalid`,
          "context_invalid",
        );
      }
    }
    return {
      id: skill.id as string,
      dirName: skill.dirName as string,
      name: skill.name as string,
      description: skill.description as string,
      skillMd: skill.skillMd as string,
    };
  });
  return {
    name: object.name as string,
    description: object.description as string,
    versionLabel: object.versionLabel as string,
    agentMd: object.agentMd as string,
    rubricMd: object.rubricMd as string,
    skills,
  };
}

function validateFinalPackageSnapshot(snapshot: AgentPackageSnapshot): void {
  if (
    !snapshot.name.trim() ||
    !snapshot.agentMd.trim() ||
    snapshot.skills.length === 0
  ) {
    throw new AnswerSkillOptimizationDraftError(
      "Final Package snapshot is incomplete",
      "skill_validation_failed",
    );
  }
  const skillIds = new Set<string>();
  const dirNames = new Set<string>();
  for (const skill of snapshot.skills) {
    if (
      !skill.id.trim() ||
      !skill.dirName.trim() ||
      !skill.name.trim() ||
      !skill.description.trim()
    ) {
      throw new AnswerSkillOptimizationDraftError(
        "Final Package contains incomplete Skill metadata",
        "skill_validation_failed",
      );
    }
    if (skillIds.has(skill.id) || dirNames.has(skill.dirName)) {
      throw new AnswerSkillOptimizationDraftError(
        "Final Package contains duplicate Skill identifiers",
        "skill_validation_failed",
      );
    }
    skillIds.add(skill.id);
    dirNames.add(skill.dirName);
    const errors = validateSkillMdStandard(skill.skillMd, skill.dirName);
    if (errors.length > 0) {
      throw new AnswerSkillOptimizationDraftError(
        `Final Skill validation failed: ${errors.slice(0, 5).join("; ")}`,
        "skill_validation_failed",
      );
    }
  }
}

function rebuildConfirmedSnapshot(input: {
  baseSnapshot: AgentPackageSnapshot;
  run: AnswerSkillOptimizationRun;
  versionNumber: number;
}): AgentPackageSnapshot {
  const targetSkill = input.run.result.targetSkill;
  const patch = input.run.result.patch;
  const storedDraft = input.run.result.draft;
  if (!targetSkill || !patch || !storedDraft) {
    throw new AnswerSkillOptimizationDraftError(
      "Optimization does not contain a complete confirmed Skill draft",
    );
  }
  if (
    input.run.targetSkillId !== targetSkill.skillId ||
    storedDraft.skillId !== targetSkill.skillId ||
    !storedDraft.validation.valid ||
    storedDraft.validation.errors.length > 0
  ) {
    throw new AnswerSkillOptimizationDraftError(
      "Confirmed target Skill and draft are inconsistent",
      "skill_validation_failed",
    );
  }
  const baseSkill = input.baseSnapshot.skills.find(
    (skill) => skill.id === targetSkill.skillId,
  );
  if (!baseSkill) {
    throw new AnswerSkillOptimizationNotFoundError(
      "Target Skill not found in the base Package version",
    );
  }
  let reapplied;
  try {
    reapplied = applyAnswerSkillPatch(baseSkill, patch);
  } catch (error) {
    if (error instanceof AnswerSkillPatchApplicationError) {
      throw new AnswerSkillOptimizationDraftError(
        error.message,
        "skill_validation_failed",
      );
    }
    throw error;
  }
  if (
    !reapplied.draft.validation.valid ||
    reapplied.draft.validation.errors.length > 0 ||
    reapplied.draft.skillMd !== storedDraft.skillMd
  ) {
    throw new AnswerSkillOptimizationDraftError(
      "Stored Skill draft no longer matches its validated Patch",
      "skill_validation_failed",
    );
  }
  const finalSnapshot: AgentPackageSnapshot = {
    ...input.baseSnapshot,
    versionLabel: `v${input.versionNumber}`,
    skills: input.baseSnapshot.skills.map((skill) =>
      skill.id === targetSkill.skillId
        ? { ...skill, skillMd: reapplied.draft.skillMd }
        : skill,
    ),
  };
  validateFinalPackageSnapshot(finalSnapshot);
  return finalSnapshot;
}

interface NextTargetApplication {
  draft: AnswerOptimizationDraft;
  diff: AnswerOptimizationDiff;
}

function applyNextTargetPatch(
  baseSnapshot: AgentPackageSnapshot,
  nextTarget: AnswerOptimizationPlannedTarget,
): NextTargetApplication {
  if (!nextTarget.patch) {
    throw new AnswerSkillOptimizationDraftError(
      `Planned target ${nextTarget.name} does not have a patch`,
      "context_invalid",
    );
  }
  const baseSkill = baseSnapshot.skills.find(
    (skill) => skill.id === nextTarget.skillId,
  );
  if (!baseSkill) {
    throw new AnswerSkillOptimizationNotFoundError(
      "Next target Skill not found in the confirmed Package version",
    );
  }
  let applied: AppliedAnswerSkillPatch;
  try {
    applied = applyAnswerSkillPatch(baseSkill, nextTarget.patch);
  } catch (error) {
    if (error instanceof AnswerSkillPatchApplicationError) {
      throw new AnswerSkillOptimizationDraftError(
        error.message,
        "skill_validation_failed",
      );
    }
    throw error;
  }
  if (
    !applied.draft.validation.valid ||
    applied.draft.validation.errors.length > 0
  ) {
    throw new AnswerSkillOptimizationDraftError(
      `Next target Skill draft validation failed: ${applied.draft.validation.errors
        .slice(0, 5)
        .join("; ")}`,
      "skill_validation_failed",
    );
  }
  if (
    isPrimarilyChineseSkill(baseSkill) &&
    userFacingTextNeedsChinese(nextTarget.patch.proposedContent)
  ) {
    throw new AnswerSkillOptimizationDraftError(
      "下一个目标 Skill 的修改内容未保持简体中文",
      "skill_validation_failed",
    );
  }
  return { draft: applied.draft, diff: applied.diff };
}

function toConfirmDto(
  optimizationId: number,
  result: AnswerOptimizationConfirmResult,
): ConfirmAnswerSkillOptimizationDto {
  const advanced = result.advancedToNextTarget === true;
  return {
    optimizationId,
    status: advanced ? "draft_ready" : "completed",
    baseVersionId: result.baseVersionId,
    finalVersionId: result.finalVersionId,
    versionNumber: result.versionNumber,
    skillVersionNumber: result.skillVersionNumber ?? result.versionNumber,
    source: result.source,
    completedAt: result.completedAt,
    ...(advanced ? { advancedToNextTarget: true } : {}),
  };
}

function replayConfirmMutation(
  run: AnswerSkillOptimizationRun,
  idempotencyKey: string,
  requestHash: string,
): ConfirmAnswerSkillOptimizationDto | null {
  const record = getMutationRecord(run, "confirm", idempotencyKey);
  if (!record) return null;
  assertMatchingMutationRecord(record, requestHash);
  const confirmResult = record.responseSummary.confirmResult;
  if (!confirmResult) {
    throw new AnswerSkillOptimizationConflictError(
      "Stored confirm result is unavailable",
    );
  }
  const advanced = confirmResult.advancedToNextTarget === true;
  const expectedStatus = advanced ? "draft_ready" : "completed";
  if (run.status !== expectedStatus) {
    throw new AnswerSkillOptimizationConflictError(
      "Stored confirm result is unavailable",
    );
  }
  return toConfirmDto(run.id, confirmResult);
}

function assertConfirmPreconditions(run: AnswerSkillOptimizationRun): void {
  const issue = getAnswerSkillConfirmIssue(run);
  if (!issue) return;
  if (issue.kind === "conflict") {
    throw new AnswerSkillOptimizationConflictError(issue.message);
  }
  if (issue.failureCode) {
    throw new AnswerSkillOptimizationDraftError(
      issue.message,
      issue.failureCode,
    );
  }
  throw new AnswerSkillOptimizationDraftError(issue.message);
}

async function confirmAnswerSkillOptimizationTransaction(
  client: PoolClient,
  input: {
    userId: string;
    optimizationId: number;
    expectedRevision: number;
    idempotencyKey: string;
    requestHash: string;
    versionNote: string;
  },
): Promise<ConfirmAnswerSkillOptimizationDto> {
  const lockedOptimization = await client.query<DbRowAnswerSkillOptimizationRun>(
    `select * from answer_skill_optimization_runs
     where id = $1 and user_id = $2
     for update`,
    [input.optimizationId, input.userId],
  );
  const optimizationRow = lockedOptimization.rows[0];
  if (!optimizationRow) throw new AnswerSkillOptimizationNotFoundError();
  const run = toAnswerSkillOptimizationRun(optimizationRow);
  const replay = replayConfirmMutation(
    run,
    input.idempotencyKey,
    input.requestHash,
  );
  if (replay) return replay;
  assertRevision(run, input.expectedRevision);
  assertConfirmPreconditions(run);

  const lockedPackage = await client.query<DbRowPackage>(
    `select * from agent_packages
     where id = $1 and user_id = $2
     for update`,
    [run.packageId, input.userId],
  );
  const packageRow = lockedPackage.rows[0];
  if (!packageRow) {
    throw new AnswerSkillOptimizationNotFoundError("Package not found");
  }
  const currentVersionId = toPositiveSafeInteger(
    packageRow.current_version_id,
    "Package current version ID",
  );
  if (currentVersionId !== run.baseVersionId) {
    throw new AnswerSkillOptimizationConflictError(
      "Package current version has changed since optimization started",
    );
  }

  const baseVersionResult = await client.query<DbRowPackageVersion>(
    `select * from agent_package_versions
     where id = $1 and package_id = $2`,
    [run.baseVersionId, run.packageId],
  );
  const baseVersionRow = baseVersionResult.rows[0];
  if (!baseVersionRow) {
    throw new AnswerSkillOptimizationNotFoundError(
      "Base Package version not found",
    );
  }
  const nextVersionResult = await client.query<{
    next_version_number: number | string;
  }>(
    `select coalesce(max(version_number), 0) + 1 as next_version_number
     from agent_package_versions
     where package_id = $1`,
    [run.packageId],
  );
  const versionNumber = toPositiveSafeInteger(
    nextVersionResult.rows[0]?.next_version_number,
    "next Package version number",
  );
  const finalSnapshot = rebuildConfirmedSnapshot({
    baseSnapshot: parsePackageSnapshot(baseVersionRow.snapshot_json),
    run,
    versionNumber,
  });
  const completedAt = new Date().toISOString();
  const insertedVersion = await client.query<{ id: number | string }>(
    `insert into agent_package_versions
       (package_id, version_number, source, snapshot_json, note, created_at)
     values ($1, $2, 'interactive', $3, $4, $5)
     returning id`,
    [
      run.packageId,
      versionNumber,
      JSON.stringify(finalSnapshot),
      input.versionNote,
      completedAt,
    ],
  );
  const finalVersionId = toPositiveSafeInteger(
    insertedVersion.rows[0]?.id,
    "final Package version ID",
  );
  const confirmedTargetSkillId = run.result.targetSkill?.skillId;
  const syncedSkillVersions = await syncPackageVersionSkillsFromSnapshot(client, {
    packageId: run.packageId,
    packageVersionId: finalVersionId,
    packageVersionNumber: versionNumber,
    source: "interactive",
    snapshot: finalSnapshot,
    note: input.versionNote,
    forcedSkillVersions: confirmedTargetSkillId
      ? new Map([
          [
            confirmedTargetSkillId,
            {
              source: "interactive" as const,
              ...(run.workingSkillVersionId === null
                ? {}
                : { basedOnVersionId: run.workingSkillVersionId }),
              note: input.versionNote,
            },
          ],
        ])
      : undefined,
  });
  const skillVersionNumber = confirmedTargetSkillId
    ? syncedSkillVersions?.get(confirmedTargetSkillId)?.versionNumber ?? versionNumber
    : versionNumber;
  const packageUpdate = await client.query(
    `update agent_packages
     set current_version_id = $1, updated_at = $2
     where id = $3 and user_id = $4 and current_version_id = $5`,
    [
      finalVersionId,
      completedAt,
      run.packageId,
      input.userId,
      run.baseVersionId,
    ],
  );
  if (packageUpdate.rowCount !== 1) {
    throw new AnswerSkillOptimizationConflictError(
      "Package current version changed during confirmation",
    );
  }

  const plannedTargets = run.result.plannedTargets ?? [];
  const nextPendingIndex = plannedTargets.findIndex(
    (target) => target.status === "pending",
  );
  const advanced = nextPendingIndex !== -1;
  const completedPlannedTargets = plannedTargets.map((target) =>
    target.status === "active"
      ? {
          ...target,
          status: "completed" as const,
          confirmedVersionId: finalVersionId,
          confirmedVersionNumber: versionNumber,
        }
      : target,
  );

  if (advanced) {
    const nextTarget = plannedTargets[nextPendingIndex]!;
    const nextApplication = applyNextTargetPatch(finalSnapshot, nextTarget);
    const advancedPlannedTargets = completedPlannedTargets.map((target, index) =>
      index === nextPendingIndex
        ? { ...target, status: "active" as const }
        : target,
    );
    const advancedResult: AnswerSkillOptimizationResult = {
      ...run.result,
      targetSkill: {
        skillId: nextTarget.skillId,
        name: nextTarget.name,
        selectionSource: "user_selected",
      },
      patch: nextTarget.patch,
      draft: nextApplication.draft,
      diff: nextApplication.diff,
      testResult: null,
      testFailure: null,
      failure: null,
      plannedTargets: advancedPlannedTargets,
    };
    const nextRevision = run.revision + 1;
    const advancedConfirmResult: AnswerOptimizationConfirmResult = {
      baseVersionId: run.baseVersionId,
      finalVersionId,
      versionNumber,
      skillVersionNumber,
      source: "interactive",
      completedAt,
      advancedToNextTarget: true,
    };
    const advancedRecord = createIdempotencyRecord({
      action: "confirm",
      key: input.idempotencyKey,
      requestHash: input.requestHash,
      resultingRevision: nextRevision,
      status: "draft_ready",
      confirmResult: advancedConfirmResult,
    });
    const advancedResultJson = withMutationRecord(advancedResult, advancedRecord);
    const advancedOptimizationUpdate =
      await client.query<DbRowAnswerSkillOptimizationRun>(
        `update answer_skill_optimization_runs
         set result_json = $1, status = 'draft_ready', revision = $2,
             base_version_id = $3, target_skill_id = $4,
             updated_at = $5
         where id = $6 and user_id = $7 and revision = $8
           and status = 'test_ready' and final_version_id is null
         returning *`,
        [
          JSON.stringify(advancedResultJson),
          nextRevision,
          finalVersionId,
          nextTarget.skillId,
          completedAt,
          run.id,
          input.userId,
          run.revision,
        ],
      );
    if (advancedOptimizationUpdate.rowCount !== 1) {
      throw new AnswerSkillOptimizationConflictError(
        "Optimization changed during confirmation",
      );
    }
    return toConfirmDto(run.id, advancedConfirmResult);
  }

  const confirmResult: AnswerOptimizationConfirmResult = {
    baseVersionId: run.baseVersionId,
    finalVersionId,
    versionNumber,
    skillVersionNumber,
    source: "interactive",
    completedAt,
  };
  const record = createIdempotencyRecord({
    action: "confirm",
    key: input.idempotencyKey,
    requestHash: input.requestHash,
    resultingRevision: run.revision,
    status: "completed",
    confirmResult,
  });
  const resultJson = withMutationRecord(
    {
      ...run.result,
      plannedTargets: completedPlannedTargets,
    },
    record,
  );
  const optimizationUpdate =
    await client.query<DbRowAnswerSkillOptimizationRun>(
      `update answer_skill_optimization_runs
       set result_json = $1, status = 'completed', final_version_id = $2,
           updated_at = $3
       where id = $4 and user_id = $5 and revision = $6
         and status = 'test_ready' and final_version_id is null
       returning *`,
      [
        JSON.stringify(resultJson),
        finalVersionId,
        completedAt,
        run.id,
        input.userId,
        run.revision,
      ],
    );
  if (optimizationUpdate.rowCount !== 1) {
    throw new AnswerSkillOptimizationConflictError(
      "Optimization changed during confirmation",
    );
  }
  return toConfirmDto(run.id, confirmResult);
}

export async function confirmAnswerSkillOptimization(
  input: ConfirmAnswerSkillOptimizationInput,
): Promise<ConfirmAnswerSkillOptimizationDto> {
  assertKnownFields(
    input,
    [
      "userId",
      "optimizationId",
      "expectedRevision",
      "versionNote",
      "idempotencyKey",
    ],
    "confirm",
  );
  const userId = normalizeUserId(input.userId);
  const optimizationId = toPositiveSafeInteger(
    input.optimizationId,
    "optimizationId",
  );
  const expectedRevision = toPositiveSafeInteger(
    input.expectedRevision,
    "expectedRevision",
  );
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const versionNote = normalizeVersionNote(input.versionNote);
  const requestHash = createMutationHash({
    action: "confirm",
    optimizationId,
    expectedRevision,
    versionNote,
  });
  const current = await getAnswerSkillOptimizationRun(userId, optimizationId);
  if (current.status !== "completed") {
    const answerRun = await getVerifiedArenaAnswerRun(current);
    assertAnswerOptimizationReplayAvailable(answerRun, current.answerSide);
  }
  return withTransaction((client) =>
    confirmAnswerSkillOptimizationTransaction(client, {
      userId,
      optimizationId,
      expectedRevision,
      idempotencyKey,
      requestHash,
      versionNote,
    }),
  );
}

function toCancelDto(
  run: AnswerSkillOptimizationRun,
): CancelAnswerSkillOptimizationDto {
  const cancel = run.result.cancel;
  if (run.status !== "cancelled" || !cancel) {
    throw new AnswerSkillOptimizationConflictError(
      "Cancelled optimization result is unavailable",
    );
  }
  return {
    optimizationId: run.id,
    status: "cancelled",
    revision: run.revision,
    reason: cancel.reason,
    cancelledAt: cancel.cancelledAt,
  };
}

export async function cancelAnswerSkillOptimization(
  input: CancelAnswerSkillOptimizationInput,
): Promise<CancelAnswerSkillOptimizationDto> {
  assertKnownFields(
    input,
    ["userId", "optimizationId", "expectedRevision", "reason", "idempotencyKey"],
    "cancel",
  );
  const userId = normalizeUserId(input.userId);
  const optimizationId = toPositiveSafeInteger(
    input.optimizationId,
    "optimizationId",
  );
  const expectedRevision = toPositiveSafeInteger(
    input.expectedRevision,
    "expectedRevision",
  );
  const reason = normalizeCancelReason(input.reason);
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const requestHash = createMutationHash({
    optimizationId,
    expectedRevision,
    reason,
  });

  const run = await getAnswerSkillOptimizationRun(userId, optimizationId);
  const replay = getMutationRecord(run, "cancel", idempotencyKey);
  if (replay) {
    assertMatchingMutationRecord(replay, requestHash);
    return toCancelDto(run);
  }
  if (run.status === "cancelled") return toCancelDto(run);
  assertRevision(run, expectedRevision);
  if (!CANCEL_ALLOWED_STATUSES.includes(run.status)) {
    throw new AnswerSkillOptimizationDraftError(
      `Cannot cancel an optimization in ${run.status} status`,
    );
  }

  const cancelledAt = new Date().toISOString();
  const record = createIdempotencyRecord({
    action: "cancel",
    key: idempotencyKey,
    requestHash,
    resultingRevision: run.revision,
    status: "cancelled",
    reason,
  });
  const resultJson = withMutationRecord(
    {
      ...run.result,
      cancel: { reason, cancelledAt },
    },
    record,
  );
  const updated = await query<DbRowAnswerSkillOptimizationRun>(
    `update answer_skill_optimization_runs
       set result_json = $1, status = 'cancelled', updated_at = $2
     where id = $3 and user_id = $4 and revision = $5
       and status in ('processing', 'target_selection_required', 'draft_ready', 'test_ready', 'failed')
     returning *`,
    [JSON.stringify(resultJson), cancelledAt, run.id, run.userId, run.revision],
  );
  const row = updated.rows[0];
  if (row) return toCancelDto(toAnswerSkillOptimizationRun(row));

  const current = await getAnswerSkillOptimizationRun(userId, optimizationId);
  const currentReplay = getMutationRecord(current, "cancel", idempotencyKey);
  if (currentReplay) {
    assertMatchingMutationRecord(currentReplay, requestHash);
    return toCancelDto(current);
  }
  if (current.status === "cancelled") return toCancelDto(current);
  throw new AnswerSkillOptimizationConflictError(
    "Optimization changed before it could be cancelled",
  );
}
