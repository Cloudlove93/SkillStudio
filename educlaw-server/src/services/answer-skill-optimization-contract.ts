import type { PackageSkill } from "@educlaw/shared";

export const ANSWER_SKILL_OPTIMIZATION_STATUSES = [
  "processing",
  "target_selection_required",
  "draft_ready",
  "test_ready",
  "completed",
  "cancelled",
  "failed",
] as const;

export type AnswerSkillOptimizationStatus =
  (typeof ANSWER_SKILL_OPTIMIZATION_STATUSES)[number];

export const ANSWER_OPTIMIZATION_REUSABILITY_VALUES = [
  "reusable",
  "single_turn",
  "unclear",
] as const;

export type AnswerOptimizationReusability =
  (typeof ANSWER_OPTIMIZATION_REUSABILITY_VALUES)[number];

export const ANSWER_SKILL_PATCH_SECTIONS = [
  "Instructions",
  "Workflow",
  "Output Format",
  "Examples",
  "Common Issues",
] as const;

export type AnswerSkillPatchSection =
  (typeof ANSWER_SKILL_PATCH_SECTIONS)[number];

export const ANSWER_SKILL_PATCH_OPERATIONS = [
  "replace",
  "append",
  "add_section",
] as const;

export type AnswerSkillPatchOperation =
  (typeof ANSWER_SKILL_PATCH_OPERATIONS)[number];

export const ANSWER_OPTIMIZATION_CANCEL_REASONS = [
  "user_cancelled",
  "no_longer_needed",
  "restart_required",
] as const;

export type AnswerOptimizationCancelReason =
  (typeof ANSWER_OPTIMIZATION_CANCEL_REASONS)[number];

export interface AnswerOptimizationDiagnosis {
  summary: string;
  reusability: AnswerOptimizationReusability;
  riskNotes: string[];
}

export interface AnswerOptimizationCandidateSkill {
  skillId: string;
  name: string;
  description: string;
  reason: string;
}

export interface AnswerOptimizationTargetSkill {
  skillId: string;
  name: string;
  selectionSource: "recorded" | "user_selected";
}

export interface AnswerSkillPatch {
  section: AnswerSkillPatchSection;
  operation: AnswerSkillPatchOperation;
  reason: string;
  proposedContent: string;
}

export interface AnswerOptimizationDraft {
  skillId: string;
  skillMd: string;
  validation: {
    valid: boolean;
    errors: string[];
  };
}

export interface AnswerOptimizationDiff {
  before: string;
  after: string;
}

export interface AnswerOptimizationTestSample {
  answer: string;
  passed: boolean;
  score: number;
  satisfiedRequirements: string[];
  unmetRequirements: string[];
  riskNotes: string[];
  criticalRisk: boolean;
}

export interface AnswerOptimizationQualityGate {
  passed: boolean;
  passedCount: number;
  sampleCount: 3;
  bestSampleIndex: number;
  overallSummary: string;
}

export interface AnswerOptimizationRuntimeSelectionCheck {
  targetSkillId: string;
  selectedSkillIds: string[];
  targetSkillSelected: boolean;
}

export interface AnswerOptimizationTestResult {
  testedRevision: number;
  question: string;
  beforeAnswer: string;
  afterAnswer: string;
  samples: [
    AnswerOptimizationTestSample,
    AnswerOptimizationTestSample,
    AnswerOptimizationTestSample,
  ];
  qualityGate: AnswerOptimizationQualityGate;
  runtimeSelectionCheck: AnswerOptimizationRuntimeSelectionCheck;
  usedSkillIds: string[];
  contextMessageIds: number[];
  model: string;
  replayMode: "recorded_context";
  createdAt: string;
}

export type PublicAnswerOptimizationTestResult = Omit<
  AnswerOptimizationTestResult,
  "usedSkillIds" | "contextMessageIds" | "model" | "replayMode"
>;

export interface AnswerOptimizationTestFailure {
  code: "model_unavailable" | "evaluation_invalid";
  message: string;
  failedAt: string;
}

export type AnswerOptimizationFailureCode =
  | "feedback_not_reusable"
  | "feedback_unclear"
  | "model_output_invalid"
  | "model_unavailable"
  | "skill_validation_failed"
  | "context_invalid"
  | "replay_context_unavailable"
  | "replay_model_unavailable"
  | "operation_interrupted";

export interface AnswerOptimizationFailure {
  code: AnswerOptimizationFailureCode;
  message: string;
}

export interface AnswerOptimizationCancelResult {
  reason: AnswerOptimizationCancelReason;
  cancelledAt: string;
}

export interface AnswerOptimizationConfirmResult {
  baseVersionId: number;
  finalVersionId: number;
  versionNumber: number;
  skillVersionNumber?: number;
  source: "interactive";
  completedAt: string;
  advancedToNextTarget?: boolean;
}

export const ANSWER_OPTIMIZATION_PLANNED_TARGET_STATUSES = [
  "pending",
  "active",
  "completed",
  "failed",
] as const;

export type AnswerOptimizationPlannedTargetStatus =
  (typeof ANSWER_OPTIMIZATION_PLANNED_TARGET_STATUSES)[number];

export interface AnswerOptimizationPlannedTarget {
  skillId: string;
  name: string;
  status: AnswerOptimizationPlannedTargetStatus;
  patch: AnswerSkillPatch | null;
  failureCode?: AnswerOptimizationFailureCode;
  failureMessage?: string;
  confirmedVersionId?: number;
  confirmedVersionNumber?: number;
}

export const ANSWER_SKILL_REFINEMENT_SOURCES = [
  "draft_review",
  "test_failure",
  "alternative_regeneration",
] as const;

export type AnswerSkillRefinementSource =
  (typeof ANSWER_SKILL_REFINEMENT_SOURCES)[number];

export const ANSWER_SKILL_REFINEMENT_STATUSES = [
  "pending",
  "succeeded",
  "failed",
] as const;

export type AnswerSkillRefinementStatus =
  (typeof ANSWER_SKILL_REFINEMENT_STATUSES)[number];

export const ANSWER_SKILL_REFINEMENT_TECHNICAL_FAILURE_CODES = [
  "model_unavailable",
  "invalid_model_output",
  "patch_application_failed",
  "skill_validation_failed",
  "revision_conflict",
  "unknown",
] as const;

export type AnswerSkillRefinementTechnicalFailureCode =
  (typeof ANSWER_SKILL_REFINEMENT_TECHNICAL_FAILURE_CODES)[number];

export type AnswerSkillRefinementOutcome =
  | {
      kind: "applied";
      assistantSummary: string;
    }
  | {
      kind: "needs_clarification";
      message: string;
      clarificationQuestion: string;
      suggestedFeedback: string[];
    }
  | {
      kind: "not_suitable_for_shared_rule";
      message: string;
      suggestedReusableFeedback: string | null;
    }
  | {
      kind: "technical_failure";
      code: AnswerSkillRefinementTechnicalFailureCode;
      userMessage: string;
    };

export interface AnswerSkillRefinementFailedSample {
  sampleIndex: number;
  unmetRequirements: string[];
  riskNotes: string[];
  criticalRisk: boolean;
}

export interface AnswerSkillRefinementQualityEvidence {
  testedRevision: number;
  overallSummary: string;
  failedSamples: AnswerSkillRefinementFailedSample[];
  runtimeSelectionPassed: boolean;
}

export interface AnswerSkillRefinementTurn {
  id: string;
  source: AnswerSkillRefinementSource;
  fromRevision: number;
  toRevision: number | null;
  userMessage: string;
  status: AnswerSkillRefinementStatus;
  createdAt: string;
  completedAt: string | null;
  assistantSummary: string | null;
  qualityEvidence: AnswerSkillRefinementQualityEvidence | null;
  outcome: AnswerSkillRefinementOutcome | null;
}

export type AnswerSkillRefinementModelOutput =
  | {
      kind: "applied";
      assistantSummary: string;
      patch: AnswerSkillPatch;
    }
  | {
      kind: "needs_clarification";
      message: string;
      clarificationQuestion: string;
      suggestedFeedback: string[];
    }
  | {
      kind: "not_suitable_for_shared_rule";
      message: string;
      suggestedReusableFeedback: string | null;
    };

export type AnswerSkillRefinementFailureCode =
  | AnswerOptimizationFailureCode
  | AnswerSkillRefinementTechnicalFailureCode;

export interface AnswerOptimizationIdempotencyRecord {
  action: "revise" | "test" | "confirm" | "cancel";
  key: string;
  requestHash: string;
  resultingRevision: number;
  responseSummary: {
    status: AnswerSkillOptimizationStatus;
    reason?: AnswerOptimizationCancelReason;
    testOutcome?: "pending" | "succeeded" | "failed";
    testResult?: AnswerOptimizationTestResult;
    testFailureCode?: AnswerOptimizationTestFailure["code"];
    confirmResult?: AnswerOptimizationConfirmResult;
    refinementOutcome?: "pending" | "succeeded" | "failed";
    refinementTurnId?: string;
    refinementFailureCode?: AnswerSkillRefinementFailureCode;
  };
}

export interface AnswerSkillOptimizationResult {
  diagnosis?: AnswerOptimizationDiagnosis;
  candidateSkills?: AnswerOptimizationCandidateSkill[];
  targetSkill?: AnswerOptimizationTargetSkill | null;
  patch?: AnswerSkillPatch | null;
  draft?: AnswerOptimizationDraft | null;
  diff?: AnswerOptimizationDiff | null;
  testResult?: AnswerOptimizationTestResult | null;
  testFailure?: AnswerOptimizationTestFailure | null;
  failure?: AnswerOptimizationFailure | null;
  cancel?: AnswerOptimizationCancelResult | null;
  refinementHistory?: AnswerSkillRefinementTurn[];
  idempotencyResults?: Record<string, AnswerOptimizationIdempotencyRecord>;
  plannedTargets?: AnswerOptimizationPlannedTarget[];
}

export interface AnswerOptimizationModelOutput {
  diagnosis: AnswerOptimizationDiagnosis;
  targetSkillId: string | null;
  candidateSkills: Array<{ skillId: string; reason: string }>;
  patch: AnswerSkillPatch | null;
}

export interface ParseAnswerOptimizationModelOutputOptions {
  skills: PackageSkill[];
  usedSkillIds: string[];
  selectedTargetSkillId?: string;
}

export class AnswerSkillOptimizationContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnswerSkillOptimizationContractError";
  }
}

const FAILURE_CODES: readonly AnswerOptimizationFailureCode[] = [
  "feedback_not_reusable",
  "feedback_unclear",
  "model_output_invalid",
  "model_unavailable",
  "skill_validation_failed",
  "context_invalid",
  "replay_context_unavailable",
  "replay_model_unavailable",
  "operation_interrupted",
];

const REFINEMENT_FAILURE_CODES: readonly AnswerSkillRefinementFailureCode[] = [
  ...FAILURE_CODES,
  ...ANSWER_SKILL_REFINEMENT_TECHNICAL_FAILURE_CODES,
];

const IDEMPOTENCY_ACTIONS = ["revise", "test", "confirm", "cancel"] as const;
const TEST_IDEMPOTENCY_OUTCOMES = ["pending", "succeeded", "failed"] as const;
const REFINEMENT_IDEMPOTENCY_OUTCOMES = [
  "pending",
  "succeeded",
  "failed",
] as const;
const MAX_RISK_NOTES = 8;
const MAX_CANDIDATE_SKILLS = 3;
export const MAX_ANSWER_SKILL_REFINEMENT_TURNS = 20;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asObject(value: unknown, field: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new AnswerSkillOptimizationContractError(`${field} must be an object`);
  }
  return value;
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  field: string,
): void {
  const allowed = new Set(allowedKeys);
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));
  if (unexpected) {
    throw new AnswerSkillOptimizationContractError(
      `${field} contains unsupported field: ${unexpected}`,
    );
  }
}

function asBoundedString(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  if (typeof value !== "string") {
    throw new AnswerSkillOptimizationContractError(`${field} must be a string`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new AnswerSkillOptimizationContractError(
      `${field} must contain 1 to ${maxLength} characters`,
    );
  }
  return normalized;
}

function asPositiveInteger(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new AnswerSkillOptimizationContractError(
      `${field} must be a positive safe integer`,
    );
  }
  return parsed;
}

function asIntegerInRange(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < minimum ||
    parsed > maximum
  ) {
    throw new AnswerSkillOptimizationContractError(
      `${field} must be an integer from ${minimum} through ${maximum}`,
    );
  }
  return parsed;
}

function asStringArray(
  value: unknown,
  field: string,
  maxItems: number,
  maxItemLength: number,
): string[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new AnswerSkillOptimizationContractError(
      `${field} must be an array with at most ${maxItems} items`,
    );
  }
  return value.map((item, index) =>
    asBoundedString(item, `${field}[${index}]`, maxItemLength),
  );
}

function isOneOf<T extends string>(
  value: unknown,
  values: readonly T[],
): value is T {
  return typeof value === "string" && values.some((item) => item === value);
}

function parseDiagnosis(value: unknown): AnswerOptimizationDiagnosis {
  const object = asObject(value, "diagnosis");
  assertOnlyKeys(object, ["summary", "reusability", "riskNotes"], "diagnosis");
  if (!isOneOf(object.reusability, ANSWER_OPTIMIZATION_REUSABILITY_VALUES)) {
    throw new AnswerSkillOptimizationContractError(
      "diagnosis.reusability is invalid",
    );
  }
  return {
    summary: asBoundedString(object.summary, "diagnosis.summary", 2000),
    reusability: object.reusability,
    riskNotes: asStringArray(
      object.riskNotes,
      "diagnosis.riskNotes",
      MAX_RISK_NOTES,
      500,
    ),
  };
}

function parsePatch(value: unknown): AnswerSkillPatch | null {
  if (value === null) return null;
  const object = asObject(value, "patch");
  assertOnlyKeys(
    object,
    ["section", "operation", "reason", "proposedContent"],
    "patch",
  );
  if (!isOneOf(object.section, ANSWER_SKILL_PATCH_SECTIONS)) {
    throw new AnswerSkillOptimizationContractError("patch.section is invalid");
  }
  if (!isOneOf(object.operation, ANSWER_SKILL_PATCH_OPERATIONS)) {
    throw new AnswerSkillOptimizationContractError("patch.operation is invalid");
  }
  return {
    section: object.section,
    operation: object.operation,
    reason: asBoundedString(object.reason, "patch.reason", 1000),
    proposedContent: asBoundedString(
      object.proposedContent,
      "patch.proposedContent",
      12000,
    ),
  };
}

function parseStoredCandidate(
  value: unknown,
  field: string,
): AnswerOptimizationCandidateSkill {
  const object = asObject(value, field);
  assertOnlyKeys(object, ["skillId", "name", "description", "reason"], field);
  return {
    skillId: asBoundedString(object.skillId, `${field}.skillId`, 128),
    name: asBoundedString(object.name, `${field}.name`, 200),
    description: asBoundedString(
      object.description,
      `${field}.description`,
      1000,
    ),
    reason: asBoundedString(object.reason, `${field}.reason`, 1000),
  };
}

function parseStoredTarget(value: unknown): AnswerOptimizationTargetSkill | null {
  if (value === null) return null;
  const object = asObject(value, "targetSkill");
  assertOnlyKeys(object, ["skillId", "name", "selectionSource"], "targetSkill");
  if (
    object.selectionSource !== "recorded" &&
    object.selectionSource !== "user_selected"
  ) {
    throw new AnswerSkillOptimizationContractError(
      "targetSkill.selectionSource is invalid",
    );
  }
  return {
    skillId: asBoundedString(object.skillId, "targetSkill.skillId", 128),
    name: asBoundedString(object.name, "targetSkill.name", 200),
    selectionSource: object.selectionSource,
  };
}

function parseDraft(value: unknown): AnswerOptimizationDraft | null {
  if (value === null) return null;
  const object = asObject(value, "draft");
  assertOnlyKeys(object, ["skillId", "skillMd", "validation"], "draft");
  const validation = asObject(object.validation, "draft.validation");
  assertOnlyKeys(validation, ["valid", "errors"], "draft.validation");
  if (typeof validation.valid !== "boolean") {
    throw new AnswerSkillOptimizationContractError(
      "draft.validation.valid must be boolean",
    );
  }
  return {
    skillId: asBoundedString(object.skillId, "draft.skillId", 128),
    skillMd: asBoundedString(object.skillMd, "draft.skillMd", 100000),
    validation: {
      valid: validation.valid,
      errors: asStringArray(
        validation.errors,
        "draft.validation.errors",
        20,
        1000,
      ),
    },
  };
}

function parseDiff(value: unknown): AnswerOptimizationDiff | null {
  if (value === null) return null;
  const object = asObject(value, "diff");
  assertOnlyKeys(object, ["before", "after"], "diff");
  return {
    before: typeof object.before === "string" ? object.before : "",
    after: asBoundedString(object.after, "diff.after", 20000),
  };
}

function parseTestResult(value: unknown): AnswerOptimizationTestResult | null {
  if (value === null) return null;
  const object = asObject(value, "testResult");
  assertOnlyKeys(
    object,
    [
      "testedRevision",
      "question",
      "beforeAnswer",
      "afterAnswer",
      "samples",
      "qualityGate",
      "runtimeSelectionCheck",
      "usedSkillIds",
      "contextMessageIds",
      "model",
      "replayMode",
      "createdAt",
    ],
    "testResult",
  );
  const usedSkillIds = asStringArray(
    object.usedSkillIds,
    "testResult.usedSkillIds",
    10,
    128,
  );
  if (new Set(usedSkillIds).size !== usedSkillIds.length) {
    throw new AnswerSkillOptimizationContractError(
      "testResult.usedSkillIds must not contain duplicates",
    );
  }
  if (!Array.isArray(object.contextMessageIds)) {
    throw new AnswerSkillOptimizationContractError(
      "testResult.contextMessageIds must be an array",
    );
  }
  if (object.contextMessageIds.length > 500) {
    throw new AnswerSkillOptimizationContractError(
      "testResult.contextMessageIds must contain at most 500 items",
    );
  }
  const contextMessageIds = object.contextMessageIds.map((value, index) =>
    asPositiveInteger(value, `testResult.contextMessageIds[${index}]`),
  );
  if (new Set(contextMessageIds).size !== contextMessageIds.length) {
    throw new AnswerSkillOptimizationContractError(
      "testResult.contextMessageIds must not contain duplicates",
    );
  }
  if (object.replayMode !== "recorded_context") {
    throw new AnswerSkillOptimizationContractError(
      "testResult.replayMode is invalid",
    );
  }
  if (!Array.isArray(object.samples) || object.samples.length !== 3) {
    throw new AnswerSkillOptimizationContractError(
      "testResult.samples must contain exactly three items",
    );
  }
  const samples = object.samples.map((sample, index) => {
    const field = `testResult.samples[${index}]`;
    const sampleObject = asObject(sample, field);
    assertOnlyKeys(
      sampleObject,
      [
        "answer",
        "passed",
        "score",
        "satisfiedRequirements",
        "unmetRequirements",
        "riskNotes",
        "criticalRisk",
      ],
      field,
    );
    if (typeof sampleObject.passed !== "boolean") {
      throw new AnswerSkillOptimizationContractError(
        `${field}.passed must be boolean`,
      );
    }
    if (typeof sampleObject.criticalRisk !== "boolean") {
      throw new AnswerSkillOptimizationContractError(
        `${field}.criticalRisk must be boolean`,
      );
    }
    return {
      answer: asBoundedString(sampleObject.answer, `${field}.answer`, 50000),
      passed: sampleObject.passed,
      score: asIntegerInRange(sampleObject.score, `${field}.score`, 0, 100),
      satisfiedRequirements: asStringArray(
        sampleObject.satisfiedRequirements,
        `${field}.satisfiedRequirements`,
        12,
        500,
      ),
      unmetRequirements: asStringArray(
        sampleObject.unmetRequirements,
        `${field}.unmetRequirements`,
        12,
        500,
      ),
      riskNotes: asStringArray(
        sampleObject.riskNotes,
        `${field}.riskNotes`,
        12,
        500,
      ),
      criticalRisk: sampleObject.criticalRisk,
    };
  }) as AnswerOptimizationTestResult["samples"];
  const qualityGateObject = asObject(
    object.qualityGate,
    "testResult.qualityGate",
  );
  assertOnlyKeys(
    qualityGateObject,
    [
      "passed",
      "passedCount",
      "sampleCount",
      "bestSampleIndex",
      "overallSummary",
    ],
    "testResult.qualityGate",
  );
  if (typeof qualityGateObject.passed !== "boolean") {
    throw new AnswerSkillOptimizationContractError(
      "testResult.qualityGate.passed must be boolean",
    );
  }
  const sampleCount = asIntegerInRange(
    qualityGateObject.sampleCount,
    "testResult.qualityGate.sampleCount",
    3,
    3,
  );
  const passedCount = asIntegerInRange(
    qualityGateObject.passedCount,
    "testResult.qualityGate.passedCount",
    0,
    sampleCount,
  );
  const bestSampleIndex = asIntegerInRange(
    qualityGateObject.bestSampleIndex,
    "testResult.qualityGate.bestSampleIndex",
    0,
    2,
  );
  const computedPassedCount = samples.filter((sample) => sample.passed).length;
  if (passedCount !== computedPassedCount) {
    throw new AnswerSkillOptimizationContractError(
      "testResult.qualityGate.passedCount does not match samples",
    );
  }
  const selectionObject = asObject(
    object.runtimeSelectionCheck,
    "testResult.runtimeSelectionCheck",
  );
  assertOnlyKeys(
    selectionObject,
    ["targetSkillId", "selectedSkillIds", "targetSkillSelected"],
    "testResult.runtimeSelectionCheck",
  );
  if (typeof selectionObject.targetSkillSelected !== "boolean") {
    throw new AnswerSkillOptimizationContractError(
      "testResult.runtimeSelectionCheck.targetSkillSelected must be boolean",
    );
  }
  const selectedSkillIds = asStringArray(
    selectionObject.selectedSkillIds,
    "testResult.runtimeSelectionCheck.selectedSkillIds",
    10,
    128,
  );
  if (new Set(selectedSkillIds).size !== selectedSkillIds.length) {
    throw new AnswerSkillOptimizationContractError(
      "testResult.runtimeSelectionCheck.selectedSkillIds must not contain duplicates",
    );
  }
  const targetSkillId = asBoundedString(
    selectionObject.targetSkillId,
    "testResult.runtimeSelectionCheck.targetSkillId",
    128,
  );
  if (
    selectionObject.targetSkillSelected !==
    selectedSkillIds.includes(targetSkillId)
  ) {
    throw new AnswerSkillOptimizationContractError(
      "testResult.runtimeSelectionCheck does not match selected Skill IDs",
    );
  }
  const hasCriticalRisk = samples.some((sample) => sample.criticalRisk);
  const deterministicPassed =
    passedCount >= 2 &&
    !hasCriticalRisk &&
    selectionObject.targetSkillSelected;
  if (qualityGateObject.passed !== deterministicPassed) {
    throw new AnswerSkillOptimizationContractError(
      "testResult.qualityGate.passed does not match the deterministic rule",
    );
  }
  const afterAnswer = asBoundedString(
    object.afterAnswer,
    "testResult.afterAnswer",
    50000,
  );
  if (afterAnswer !== samples[bestSampleIndex]?.answer) {
    throw new AnswerSkillOptimizationContractError(
      "testResult.afterAnswer must match the best sample",
    );
  }
  return {
    testedRevision: asPositiveInteger(
      object.testedRevision,
      "testResult.testedRevision",
    ),
    question: asBoundedString(object.question, "testResult.question", 20000),
    beforeAnswer: asBoundedString(
      object.beforeAnswer,
      "testResult.beforeAnswer",
      50000,
    ),
    afterAnswer,
    samples,
    qualityGate: {
      passed: qualityGateObject.passed,
      passedCount,
      sampleCount: sampleCount as 3,
      bestSampleIndex,
      overallSummary: asBoundedString(
        qualityGateObject.overallSummary,
        "testResult.qualityGate.overallSummary",
        3000,
      ),
    },
    runtimeSelectionCheck: {
      targetSkillId,
      selectedSkillIds,
      targetSkillSelected: selectionObject.targetSkillSelected,
    },
    usedSkillIds,
    contextMessageIds,
    model: asBoundedString(object.model, "testResult.model", 256),
    replayMode: object.replayMode,
    createdAt: asBoundedString(object.createdAt, "testResult.createdAt", 100),
  };
}

function parseTestFailure(
  value: unknown,
): AnswerOptimizationTestFailure | null {
  if (value === null) return null;
  const object = asObject(value, "testFailure");
  assertOnlyKeys(object, ["code", "message", "failedAt"], "testFailure");
  if (
    object.code !== "model_unavailable" &&
    object.code !== "evaluation_invalid"
  ) {
    throw new AnswerSkillOptimizationContractError(
      "testFailure.code is invalid",
    );
  }
  return {
    code: object.code,
    message: asBoundedString(object.message, "testFailure.message", 1000),
    failedAt: asBoundedString(object.failedAt, "testFailure.failedAt", 100),
  };
}

function parseFailure(value: unknown): AnswerOptimizationFailure | null {
  if (value === null) return null;
  const object = asObject(value, "failure");
  assertOnlyKeys(object, ["code", "message"], "failure");
  if (!isOneOf(object.code, FAILURE_CODES)) {
    throw new AnswerSkillOptimizationContractError("failure.code is invalid");
  }
  return {
    code: object.code,
    message: asBoundedString(object.message, "failure.message", 1000),
  };
}

function parseCancel(value: unknown): AnswerOptimizationCancelResult | null {
  if (value === null) return null;
  const object = asObject(value, "cancel");
  assertOnlyKeys(object, ["reason", "cancelledAt"], "cancel");
  if (!isOneOf(object.reason, ANSWER_OPTIMIZATION_CANCEL_REASONS)) {
    throw new AnswerSkillOptimizationContractError("cancel.reason is invalid");
  }
  return {
    reason: object.reason,
    cancelledAt: asBoundedString(object.cancelledAt, "cancel.cancelledAt", 100),
  };
}

function parseConfirmResult(
  value: unknown,
  field: string,
): AnswerOptimizationConfirmResult {
  const object = asObject(value, field);
  assertOnlyKeys(
    object,
    [
      "baseVersionId",
      "finalVersionId",
      "versionNumber",
      "skillVersionNumber",
      "source",
      "completedAt",
      "advancedToNextTarget",
    ],
    field,
  );
  if (object.source !== "interactive") {
    throw new AnswerSkillOptimizationContractError(
      `${field}.source must be interactive`,
    );
  }
  const result: AnswerOptimizationConfirmResult = {
    baseVersionId: asPositiveInteger(
      object.baseVersionId,
      `${field}.baseVersionId`,
    ),
    finalVersionId: asPositiveInteger(
      object.finalVersionId,
      `${field}.finalVersionId`,
    ),
    versionNumber: asPositiveInteger(
      object.versionNumber,
      `${field}.versionNumber`,
    ),
    source: object.source,
    completedAt: asBoundedString(
      object.completedAt,
      `${field}.completedAt`,
      100,
    ),
  };
  if (object.skillVersionNumber !== undefined) {
    result.skillVersionNumber = asPositiveInteger(
      object.skillVersionNumber,
      `${field}.skillVersionNumber`,
    );
  }
  if (object.advancedToNextTarget !== undefined) {
    if (typeof object.advancedToNextTarget !== "boolean") {
      throw new AnswerSkillOptimizationContractError(
        `${field}.advancedToNextTarget must be boolean`,
      );
    }
    result.advancedToNextTarget = object.advancedToNextTarget;
  }
  return result;
}

export const MAX_PLANNED_TARGETS = 5;

function parsePlannedTarget(
  value: unknown,
  field: string,
): AnswerOptimizationPlannedTarget {
  const object = asObject(value, field);
  assertOnlyKeys(
    object,
    [
      "skillId",
      "name",
      "status",
      "patch",
      "failureCode",
      "failureMessage",
      "confirmedVersionId",
      "confirmedVersionNumber",
    ],
    field,
  );
  if (!isOneOf(object.status, ANSWER_OPTIMIZATION_PLANNED_TARGET_STATUSES)) {
    throw new AnswerSkillOptimizationContractError(
      `${field}.status is invalid`,
    );
  }
  const patch = parsePatch(object.patch);
  const result: AnswerOptimizationPlannedTarget = {
    skillId: asBoundedString(object.skillId, `${field}.skillId`, 128),
    name: asBoundedString(object.name, `${field}.name`, 200),
    status: object.status,
    patch,
  };
  if (object.failureCode !== undefined) {
    if (!isOneOf(object.failureCode, FAILURE_CODES)) {
      throw new AnswerSkillOptimizationContractError(
        `${field}.failureCode is invalid`,
      );
    }
    result.failureCode = object.failureCode;
  }
  if (object.failureMessage !== undefined) {
    result.failureMessage = asBoundedString(
      object.failureMessage,
      `${field}.failureMessage`,
      1000,
    );
  }
  if (object.confirmedVersionId !== undefined) {
    result.confirmedVersionId = asPositiveInteger(
      object.confirmedVersionId,
      `${field}.confirmedVersionId`,
    );
  }
  if (object.confirmedVersionNumber !== undefined) {
    result.confirmedVersionNumber = asPositiveInteger(
      object.confirmedVersionNumber,
      `${field}.confirmedVersionNumber`,
    );
  }
  return result;
}

function parseRefinementQualityEvidence(
  value: unknown,
  field: string,
): AnswerSkillRefinementQualityEvidence | null {
  if (value === null) return null;
  const object = asObject(value, field);
  assertOnlyKeys(
    object,
    [
      "testedRevision",
      "overallSummary",
      "failedSamples",
      "runtimeSelectionPassed",
    ],
    field,
  );
  if (
    !Array.isArray(object.failedSamples) ||
    object.failedSamples.length > 3
  ) {
    throw new AnswerSkillOptimizationContractError(
      `${field}.failedSamples must contain at most three items`,
    );
  }
  const failedSamples = object.failedSamples.map((sample, index) => {
    const sampleField = `${field}.failedSamples[${index}]`;
    const sampleObject = asObject(sample, sampleField);
    assertOnlyKeys(
      sampleObject,
      [
        "sampleIndex",
        "unmetRequirements",
        "riskNotes",
        "criticalRisk",
      ],
      sampleField,
    );
    if (typeof sampleObject.criticalRisk !== "boolean") {
      throw new AnswerSkillOptimizationContractError(
        `${sampleField}.criticalRisk must be boolean`,
      );
    }
    return {
      sampleIndex: asIntegerInRange(
        sampleObject.sampleIndex,
        `${sampleField}.sampleIndex`,
        0,
        2,
      ),
      unmetRequirements: asStringArray(
        sampleObject.unmetRequirements,
        `${sampleField}.unmetRequirements`,
        12,
        500,
      ),
      riskNotes: asStringArray(
        sampleObject.riskNotes,
        `${sampleField}.riskNotes`,
        12,
        500,
      ),
      criticalRisk: sampleObject.criticalRisk,
    };
  });
  if (
    new Set(failedSamples.map((sample) => sample.sampleIndex)).size !==
    failedSamples.length
  ) {
    throw new AnswerSkillOptimizationContractError(
      `${field}.failedSamples contains duplicate sampleIndex values`,
    );
  }
  if (typeof object.runtimeSelectionPassed !== "boolean") {
    throw new AnswerSkillOptimizationContractError(
      `${field}.runtimeSelectionPassed must be boolean`,
    );
  }
  return {
    testedRevision: asPositiveInteger(
      object.testedRevision,
      `${field}.testedRevision`,
    ),
    overallSummary: asBoundedString(
      object.overallSummary,
      `${field}.overallSummary`,
      2000,
    ),
    failedSamples,
    runtimeSelectionPassed: object.runtimeSelectionPassed,
  };
}

function parseRefinementOutcome(
  value: unknown,
  field: string,
): AnswerSkillRefinementOutcome {
  const object = asObject(value, field);
  if (object.kind === "applied") {
    assertOnlyKeys(object, ["kind", "assistantSummary"], field);
    return {
      kind: "applied",
      assistantSummary: asBoundedString(
        object.assistantSummary,
        `${field}.assistantSummary`,
        1000,
      ),
    };
  }
  if (object.kind === "needs_clarification") {
    assertOnlyKeys(
      object,
      ["kind", "message", "clarificationQuestion", "suggestedFeedback"],
      field,
    );
    const suggestedFeedback = asStringArray(
      object.suggestedFeedback,
      `${field}.suggestedFeedback`,
      3,
      500,
    );
    if (suggestedFeedback.length === 0) {
      throw new AnswerSkillOptimizationContractError(
        `${field}.suggestedFeedback must contain 1 to 3 items`,
      );
    }
    return {
      kind: "needs_clarification",
      message: asBoundedString(object.message, `${field}.message`, 1000),
      clarificationQuestion: asBoundedString(
        object.clarificationQuestion,
        `${field}.clarificationQuestion`,
        1000,
      ),
      suggestedFeedback,
    };
  }
  if (object.kind === "not_suitable_for_shared_rule") {
    assertOnlyKeys(
      object,
      ["kind", "message", "suggestedReusableFeedback"],
      field,
    );
    return {
      kind: "not_suitable_for_shared_rule",
      message: asBoundedString(object.message, `${field}.message`, 1000),
      suggestedReusableFeedback:
        object.suggestedReusableFeedback === null
          ? null
          : asBoundedString(
              object.suggestedReusableFeedback,
              `${field}.suggestedReusableFeedback`,
              1000,
            ),
    };
  }
  if (object.kind === "technical_failure") {
    assertOnlyKeys(object, ["kind", "code", "userMessage"], field);
    if (
      !isOneOf(
        object.code,
        ANSWER_SKILL_REFINEMENT_TECHNICAL_FAILURE_CODES,
      )
    ) {
      throw new AnswerSkillOptimizationContractError(
        `${field}.code is invalid`,
      );
    }
    return {
      kind: "technical_failure",
      code: object.code,
      userMessage: asBoundedString(
        object.userMessage,
        `${field}.userMessage`,
        1000,
      ),
    };
  }
  throw new AnswerSkillOptimizationContractError(`${field}.kind is invalid`);
}

function parseRefinementTurn(
  value: unknown,
  field: string,
): AnswerSkillRefinementTurn {
  const object = asObject(value, field);
  assertOnlyKeys(
    object,
    [
      "id",
      "source",
      "fromRevision",
      "toRevision",
      "userMessage",
      "status",
      "createdAt",
      "completedAt",
      "assistantSummary",
      "qualityEvidence",
      "outcome",
    ],
    field,
  );
  if (!isOneOf(object.source, ANSWER_SKILL_REFINEMENT_SOURCES)) {
    throw new AnswerSkillOptimizationContractError(
      `${field}.source is invalid`,
    );
  }
  if (!isOneOf(object.status, ANSWER_SKILL_REFINEMENT_STATUSES)) {
    throw new AnswerSkillOptimizationContractError(
      `${field}.status is invalid`,
    );
  }
  const fromRevision = asPositiveInteger(
    object.fromRevision,
    `${field}.fromRevision`,
  );
  const toRevision =
    object.toRevision === null
      ? null
      : asPositiveInteger(object.toRevision, `${field}.toRevision`);
  const completedAt =
    object.completedAt === null
      ? null
      : asBoundedString(object.completedAt, `${field}.completedAt`, 100);
  const assistantSummary =
    object.assistantSummary === null
      ? null
      : asBoundedString(
          object.assistantSummary,
          `${field}.assistantSummary`,
          1000,
        );
  const qualityEvidence = parseRefinementQualityEvidence(
    object.qualityEvidence,
    `${field}.qualityEvidence`,
  );
  let outcome =
    object.outcome === undefined || object.outcome === null
      ? null
      : parseRefinementOutcome(object.outcome, `${field}.outcome`);

  // Older persisted turns predate the explicit outcome. Normalize them while
  // keeping their original revision and user-visible summary intact.
  if (object.outcome === undefined && object.status === "succeeded") {
    if (assistantSummary === null) {
      throw new AnswerSkillOptimizationContractError(
        `${field} legacy succeeded turn requires assistantSummary`,
      );
    }
    outcome = { kind: "applied", assistantSummary };
  } else if (object.outcome === undefined && object.status === "failed") {
    outcome = {
      kind: "technical_failure",
      code: "unknown",
      userMessage:
        assistantSummary ?? "本次修改未生成新草稿，当前成功草稿保持不变。",
    };
  }

  if (
    object.source === "test_failure" &&
    (qualityEvidence === null ||
      qualityEvidence.testedRevision !== fromRevision)
  ) {
    throw new AnswerSkillOptimizationContractError(
      `${field}.qualityEvidence must match a test_failure turn`,
    );
  }
  if (object.source !== "test_failure" && qualityEvidence !== null) {
    throw new AnswerSkillOptimizationContractError(
      `${field}.qualityEvidence is only valid for test_failure`,
    );
  }
  if (
    object.status === "pending" &&
    (toRevision !== null ||
      completedAt !== null ||
      assistantSummary !== null ||
      outcome !== null)
  ) {
    throw new AnswerSkillOptimizationContractError(
      `${field} pending fields are inconsistent`,
    );
  }
  if (
    object.status === "succeeded" &&
    (completedAt === null ||
      outcome === null ||
      outcome.kind === "technical_failure" ||
      (outcome.kind === "applied" &&
        (toRevision !== fromRevision + 1 ||
          assistantSummary !== outcome.assistantSummary)) ||
      (outcome.kind !== "applied" &&
        (toRevision !== null || assistantSummary !== null)))
  ) {
    throw new AnswerSkillOptimizationContractError(
      `${field} succeeded fields are inconsistent`,
    );
  }
  if (
    object.status === "failed" &&
    (toRevision !== null ||
      completedAt === null ||
      outcome?.kind !== "technical_failure")
  ) {
    throw new AnswerSkillOptimizationContractError(
      `${field} failed fields are inconsistent`,
    );
  }

  return {
    id: asBoundedString(object.id, `${field}.id`, 100),
    source: object.source,
    fromRevision,
    toRevision,
    userMessage: asBoundedString(
      object.userMessage,
      `${field}.userMessage`,
      1500,
    ),
    status: object.status,
    createdAt: asBoundedString(object.createdAt, `${field}.createdAt`, 100),
    completedAt,
    assistantSummary,
    qualityEvidence,
    outcome,
  };
}

function parseIdempotencyRecord(
  value: unknown,
  field: string,
): AnswerOptimizationIdempotencyRecord {
  const object = asObject(value, field);
  assertOnlyKeys(
    object,
    ["action", "key", "requestHash", "resultingRevision", "responseSummary"],
    field,
  );
  if (!isOneOf(object.action, IDEMPOTENCY_ACTIONS)) {
    throw new AnswerSkillOptimizationContractError(`${field}.action is invalid`);
  }
  const summary = asObject(object.responseSummary, `${field}.responseSummary`);
  assertOnlyKeys(
    summary,
    [
      "status",
      "reason",
      "testOutcome",
      "testResult",
      "testFailureCode",
      "confirmResult",
      "refinementOutcome",
      "refinementTurnId",
      "refinementFailureCode",
    ],
    `${field}.responseSummary`,
  );
  if (!isOneOf(summary.status, ANSWER_SKILL_OPTIMIZATION_STATUSES)) {
    throw new AnswerSkillOptimizationContractError(
      `${field}.responseSummary.status is invalid`,
    );
  }
  let reason: AnswerOptimizationCancelReason | undefined;
  if (summary.reason !== undefined) {
    if (!isOneOf(summary.reason, ANSWER_OPTIMIZATION_CANCEL_REASONS)) {
      throw new AnswerSkillOptimizationContractError(
        `${field}.responseSummary.reason is invalid`,
      );
    }
    reason = summary.reason;
  }
  let testOutcome: "pending" | "succeeded" | "failed" | undefined;
  if (summary.testOutcome !== undefined) {
    if (!isOneOf(summary.testOutcome, TEST_IDEMPOTENCY_OUTCOMES)) {
      throw new AnswerSkillOptimizationContractError(
        `${field}.responseSummary.testOutcome is invalid`,
      );
    }
    testOutcome = summary.testOutcome;
  }
  if (object.action === "test" && testOutcome === undefined) {
    throw new AnswerSkillOptimizationContractError(
      `${field}.responseSummary.testOutcome is required for test`,
    );
  }
  if (object.action !== "test" && testOutcome !== undefined) {
    throw new AnswerSkillOptimizationContractError(
      `${field}.responseSummary.testOutcome is only valid for test`,
    );
  }
  const testResult =
    summary.testResult === undefined
      ? undefined
      : parseTestResult(summary.testResult) ?? undefined;
  if (
    object.action === "test" &&
    testOutcome === "succeeded" &&
    testResult === undefined
  ) {
    throw new AnswerSkillOptimizationContractError(
      `${field}.responseSummary.testResult is required for a succeeded test`,
    );
  }
  if (
    (object.action !== "test" || testOutcome !== "succeeded") &&
    testResult !== undefined
  ) {
    throw new AnswerSkillOptimizationContractError(
      `${field}.responseSummary.testResult is only valid for a succeeded test`,
    );
  }
  let testFailureCode: AnswerOptimizationTestFailure["code"] | undefined;
  if (summary.testFailureCode !== undefined) {
    if (
      summary.testFailureCode !== "model_unavailable" &&
      summary.testFailureCode !== "evaluation_invalid"
    ) {
      throw new AnswerSkillOptimizationContractError(
        `${field}.responseSummary.testFailureCode is invalid`,
      );
    }
    testFailureCode = summary.testFailureCode;
  }
  if (
    testFailureCode !== undefined &&
    (object.action !== "test" || testOutcome !== "failed")
  ) {
    throw new AnswerSkillOptimizationContractError(
      `${field}.responseSummary.testFailureCode is only valid for a failed test`,
    );
  }
  const confirmResult =
    summary.confirmResult === undefined
      ? undefined
      : parseConfirmResult(
          summary.confirmResult,
          `${field}.responseSummary.confirmResult`,
        );
  if (object.action === "confirm" && confirmResult === undefined) {
    throw new AnswerSkillOptimizationContractError(
      `${field}.responseSummary.confirmResult is required for confirm`,
    );
  }
  if (object.action === "confirm" && summary.status !== "completed") {
    throw new AnswerSkillOptimizationContractError(
      `${field}.responseSummary.status must be completed for confirm`,
    );
  }
  if (object.action !== "confirm" && confirmResult !== undefined) {
    throw new AnswerSkillOptimizationContractError(
      `${field}.responseSummary.confirmResult is only valid for confirm`,
    );
  }
  let refinementOutcome: "pending" | "succeeded" | "failed" | undefined;
  if (summary.refinementOutcome !== undefined) {
    if (
      !isOneOf(summary.refinementOutcome, REFINEMENT_IDEMPOTENCY_OUTCOMES)
    ) {
      throw new AnswerSkillOptimizationContractError(
        `${field}.responseSummary.refinementOutcome is invalid`,
      );
    }
    refinementOutcome = summary.refinementOutcome;
  }
  const refinementTurnId =
    summary.refinementTurnId === undefined
      ? undefined
      : asBoundedString(
          summary.refinementTurnId,
          `${field}.responseSummary.refinementTurnId`,
          100,
        );
  let refinementFailureCode: AnswerSkillRefinementFailureCode | undefined;
  if (summary.refinementFailureCode !== undefined) {
    if (!isOneOf(summary.refinementFailureCode, REFINEMENT_FAILURE_CODES)) {
      throw new AnswerSkillOptimizationContractError(
        `${field}.responseSummary.refinementFailureCode is invalid`,
      );
    }
    refinementFailureCode = summary.refinementFailureCode;
  }
  if (
    refinementOutcome !== undefined &&
    (object.action !== "revise" || refinementTurnId === undefined)
  ) {
    throw new AnswerSkillOptimizationContractError(
      `${field}.responseSummary refinement fields are only valid for revise`,
    );
  }
  if (
    refinementTurnId !== undefined &&
    (object.action !== "revise" || refinementOutcome === undefined)
  ) {
    throw new AnswerSkillOptimizationContractError(
      `${field}.responseSummary.refinementTurnId is incomplete`,
    );
  }
  if (
    refinementFailureCode !== undefined &&
    (object.action !== "revise" || refinementOutcome !== "failed")
  ) {
    throw new AnswerSkillOptimizationContractError(
      `${field}.responseSummary.refinementFailureCode is only valid for a failed refinement`,
    );
  }
  return {
    action: object.action,
    key: asBoundedString(object.key, `${field}.key`, 100),
    requestHash: asBoundedString(
      object.requestHash,
      `${field}.requestHash`,
      128,
    ),
    resultingRevision: asPositiveInteger(
      object.resultingRevision,
      `${field}.resultingRevision`,
    ),
    responseSummary: {
      status: summary.status,
      ...(reason ? { reason } : {}),
      ...(testOutcome ? { testOutcome } : {}),
      ...(testResult ? { testResult } : {}),
      ...(testFailureCode ? { testFailureCode } : {}),
      ...(confirmResult ? { confirmResult } : {}),
      ...(refinementOutcome ? { refinementOutcome } : {}),
      ...(refinementTurnId ? { refinementTurnId } : {}),
      ...(refinementFailureCode ? { refinementFailureCode } : {}),
    },
  };
}

export function parseAnswerSkillOptimizationResult(
  value: unknown,
): AnswerSkillOptimizationResult {
  let parsed: unknown = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      throw new AnswerSkillOptimizationContractError(
        "result_json must contain valid JSON",
      );
    }
  }
  const object = asObject(parsed, "result_json");
  assertOnlyKeys(
    object,
    [
      "diagnosis",
      "candidateSkills",
      "targetSkill",
      "patch",
      "draft",
      "diff",
      "testResult",
      "testFailure",
      "failure",
      "cancel",
      "refinementHistory",
      "idempotencyResults",
      "plannedTargets",
    ],
    "result_json",
  );

  const result: AnswerSkillOptimizationResult = {};
  if (object.diagnosis !== undefined) result.diagnosis = parseDiagnosis(object.diagnosis);
  if (object.candidateSkills !== undefined) {
    if (
      !Array.isArray(object.candidateSkills) ||
      object.candidateSkills.length > MAX_CANDIDATE_SKILLS
    ) {
      throw new AnswerSkillOptimizationContractError(
        `candidateSkills must contain at most ${MAX_CANDIDATE_SKILLS} items`,
      );
    }
    result.candidateSkills = object.candidateSkills.map((candidate, index) =>
      parseStoredCandidate(candidate, `candidateSkills[${index}]`),
    );
  }
  if (object.targetSkill !== undefined) result.targetSkill = parseStoredTarget(object.targetSkill);
  if (object.patch !== undefined) result.patch = parsePatch(object.patch);
  if (object.draft !== undefined) result.draft = parseDraft(object.draft);
  if (object.diff !== undefined) result.diff = parseDiff(object.diff);
  if (object.testResult !== undefined) result.testResult = parseTestResult(object.testResult);
  if (object.testFailure !== undefined) {
    result.testFailure = parseTestFailure(object.testFailure);
  }
  if (object.failure !== undefined) result.failure = parseFailure(object.failure);
  if (object.cancel !== undefined) result.cancel = parseCancel(object.cancel);
  if (object.refinementHistory !== undefined) {
    if (
      !Array.isArray(object.refinementHistory) ||
      object.refinementHistory.length > MAX_ANSWER_SKILL_REFINEMENT_TURNS
    ) {
      throw new AnswerSkillOptimizationContractError(
        `refinementHistory must contain at most ${MAX_ANSWER_SKILL_REFINEMENT_TURNS} turns`,
      );
    }
    result.refinementHistory = object.refinementHistory.map((turn, index) =>
      parseRefinementTurn(turn, `refinementHistory[${index}]`),
    );
    if (
      new Set(result.refinementHistory.map((turn) => turn.id)).size !==
      result.refinementHistory.length
    ) {
      throw new AnswerSkillOptimizationContractError(
        "refinementHistory contains duplicate turn IDs",
      );
    }
  }
  if (object.idempotencyResults !== undefined) {
    const records = asObject(object.idempotencyResults, "idempotencyResults");
    if (Object.keys(records).length > 100) {
      throw new AnswerSkillOptimizationContractError(
        "idempotencyResults contains too many entries",
      );
    }
    result.idempotencyResults = Object.fromEntries(
      Object.entries(records).map(([key, record]) => [
        key,
        parseIdempotencyRecord(record, `idempotencyResults.${key}`),
      ]),
    );
  }
  if (object.plannedTargets !== undefined) {
    if (
      !Array.isArray(object.plannedTargets) ||
      object.plannedTargets.length > MAX_PLANNED_TARGETS
    ) {
      throw new AnswerSkillOptimizationContractError(
        `plannedTargets must contain at most ${MAX_PLANNED_TARGETS} items`,
      );
    }
    result.plannedTargets = object.plannedTargets.map((target, index) =>
      parsePlannedTarget(target, `plannedTargets[${index}]`),
    );
    const seenIds = new Set<string>();
    for (const target of result.plannedTargets) {
      if (seenIds.has(target.skillId)) {
        throw new AnswerSkillOptimizationContractError(
          `plannedTargets contains duplicate skillId: ${target.skillId}`,
        );
      }
      seenIds.add(target.skillId);
    }
  }
  return result;
}

export function parseAnswerOptimizationModelOutput(
  value: unknown,
  options: ParseAnswerOptimizationModelOutputOptions,
): AnswerOptimizationModelOutput {
  const object = asObject(value, "modelOutput");
  assertOnlyKeys(
    object,
    ["diagnosis", "targetSkillId", "candidateSkills", "patch"],
    "modelOutput",
  );
  const diagnosis = parseDiagnosis(object.diagnosis);
  const targetSkillId =
    object.targetSkillId === null
      ? null
      : asBoundedString(object.targetSkillId, "targetSkillId", 128);
  if (!Array.isArray(object.candidateSkills)) {
    throw new AnswerSkillOptimizationContractError(
      "candidateSkills must be an array",
    );
  }
  if (object.candidateSkills.length > MAX_CANDIDATE_SKILLS) {
    throw new AnswerSkillOptimizationContractError(
      `candidateSkills must contain at most ${MAX_CANDIDATE_SKILLS} items`,
    );
  }
  const candidateSkills = object.candidateSkills.map((candidate, index) => {
    const item = asObject(candidate, `candidateSkills[${index}]`);
    assertOnlyKeys(item, ["skillId", "reason"], `candidateSkills[${index}]`);
    return {
      skillId: asBoundedString(
        item.skillId,
        `candidateSkills[${index}].skillId`,
        128,
      ),
      reason: asBoundedString(
        item.reason,
        `candidateSkills[${index}].reason`,
        1000,
      ),
    };
  });
  const patch = parsePatch(object.patch);

  const skillsById = new Map(options.skills.map((skill) => [skill.id, skill]));
  if (skillsById.size !== options.skills.length) {
    throw new AnswerSkillOptimizationContractError(
      "Base version contains duplicate Skill IDs",
    );
  }
  const usedSkillIds = Array.from(new Set(options.usedSkillIds));
  for (const skillId of usedSkillIds) {
    if (!skillsById.has(skillId)) {
      throw new AnswerSkillOptimizationContractError(
        `Recorded Skill does not exist in base version: ${skillId}`,
      );
    }
  }
  const allowedIds = new Set(
    options.selectedTargetSkillId
      ? [options.selectedTargetSkillId]
      : usedSkillIds.length > 0
        ? usedSkillIds
        : options.skills.map((skill) => skill.id),
  );
  if (
    options.selectedTargetSkillId &&
    !skillsById.has(options.selectedTargetSkillId)
  ) {
    throw new AnswerSkillOptimizationContractError(
      "Selected target Skill does not exist in base version",
    );
  }

  if (targetSkillId !== null && !allowedIds.has(targetSkillId)) {
    throw new AnswerSkillOptimizationContractError(
      "targetSkillId is not allowed for this answer run",
    );
  }
  if (
    usedSkillIds.length === 0 &&
    targetSkillId !== null &&
    !options.selectedTargetSkillId
  ) {
    throw new AnswerSkillOptimizationContractError(
      "An answer without recorded Skills cannot claim a recorded target Skill",
    );
  }
  if (
    options.selectedTargetSkillId &&
    targetSkillId !== options.selectedTargetSkillId
  ) {
    throw new AnswerSkillOptimizationContractError(
      "Model did not use the user-selected target Skill",
    );
  }
  const seenCandidates = new Set<string>();
  for (const candidate of candidateSkills) {
    if (!allowedIds.has(candidate.skillId) || !skillsById.has(candidate.skillId)) {
      throw new AnswerSkillOptimizationContractError(
        `Candidate Skill is not allowed: ${candidate.skillId}`,
      );
    }
    if (seenCandidates.has(candidate.skillId)) {
      throw new AnswerSkillOptimizationContractError(
        `Candidate Skill is duplicated: ${candidate.skillId}`,
      );
    }
    seenCandidates.add(candidate.skillId);
  }

  if (diagnosis.reusability !== "reusable") {
    if (patch !== null || targetSkillId !== null) {
      throw new AnswerSkillOptimizationContractError(
        "Non-reusable feedback cannot contain a target Skill or patch",
      );
    }
  } else if (targetSkillId === null) {
    if (patch !== null || candidateSkills.length === 0) {
      throw new AnswerSkillOptimizationContractError(
        "Reusable feedback without a target requires candidates and no patch",
      );
    }
  } else if (patch === null) {
    throw new AnswerSkillOptimizationContractError(
      "A selected target Skill requires one patch",
    );
  }

  return { diagnosis, targetSkillId, candidateSkills, patch };
}

export function parseAnswerSkillRefinementModelOutput(
  value: unknown,
): AnswerSkillRefinementModelOutput {
  const object = asObject(value, "refinementOutput");
  if (object.kind === "applied") {
    assertOnlyKeys(
      object,
      ["kind", "assistantSummary", "patch"],
      "refinementOutput",
    );
    const patch = parsePatch(object.patch);
    if (patch === null) {
      throw new AnswerSkillOptimizationContractError(
        "Applied refinement requires one patch",
      );
    }
    return {
      kind: "applied",
      assistantSummary: asBoundedString(
        object.assistantSummary,
        "refinementOutput.assistantSummary",
        1000,
      ),
      patch,
    };
  }
  if (object.kind === "needs_clarification") {
    assertOnlyKeys(
      object,
      ["kind", "message", "clarificationQuestion", "suggestedFeedback"],
      "refinementOutput",
    );
    const suggestedFeedback = asStringArray(
      object.suggestedFeedback,
      "refinementOutput.suggestedFeedback",
      3,
      500,
    );
    if (suggestedFeedback.length === 0) {
      throw new AnswerSkillOptimizationContractError(
        "needs_clarification requires at least one suggested feedback item",
      );
    }
    return {
      kind: "needs_clarification",
      message: asBoundedString(
        object.message,
        "refinementOutput.message",
        1000,
      ),
      clarificationQuestion: asBoundedString(
        object.clarificationQuestion,
        "refinementOutput.clarificationQuestion",
        1000,
      ),
      suggestedFeedback,
    };
  }
  if (object.kind === "not_suitable_for_shared_rule") {
    assertOnlyKeys(
      object,
      ["kind", "message", "suggestedReusableFeedback"],
      "refinementOutput",
    );
    const suggestedReusableFeedback =
      object.suggestedReusableFeedback === null
        ? null
        : asBoundedString(
            object.suggestedReusableFeedback,
            "refinementOutput.suggestedReusableFeedback",
            1000,
          );
    return {
      kind: "not_suitable_for_shared_rule",
      message: asBoundedString(
        object.message,
        "refinementOutput.message",
        1000,
      ),
      suggestedReusableFeedback,
    };
  }
  throw new AnswerSkillOptimizationContractError(
    "refinementOutput.kind is invalid",
  );
}
