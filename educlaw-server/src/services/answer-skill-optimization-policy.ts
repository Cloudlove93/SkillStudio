import type {
  AnswerOptimizationFailure,
  AnswerSkillOptimizationResult,
  AnswerSkillOptimizationStatus,
  AnswerSkillRefinementQualityEvidence,
  AnswerSkillRefinementTurn,
} from "./answer-skill-optimization-contract.js";

export type AnswerSkillConfirmIssue =
  | {
      kind: "conflict";
      message: string;
    }
  | {
      kind: "draft";
      message: string;
      failureCode?: AnswerOptimizationFailure["code"];
    };

export interface AnswerSkillConfirmPolicyInput {
  status: AnswerSkillOptimizationStatus;
  finalVersionId: number | null;
  answerSkillVersionId: number | null;
  targetSkillId: string | null;
  revision: number;
  result: AnswerSkillOptimizationResult;
}

export function getAnswerSkillConfirmIssue(
  input: AnswerSkillConfirmPolicyInput,
): AnswerSkillConfirmIssue | null {
  if (input.status === "completed") {
    return {
      kind: "conflict",
      message: "Optimization has already been confirmed",
    };
  }
  if (input.status !== "test_ready") {
    return {
      kind: "draft",
      message: `Cannot confirm an optimization in ${input.status} status`,
    };
  }
  if (input.finalVersionId !== null) {
    return {
      kind: "conflict",
      message: "Optimization already references a final Package version",
    };
  }

  const targetSkill = input.result.targetSkill;
  const patch = input.result.patch;
  const draft = input.result.draft;
  const testResult = input.result.testResult;
  if (!targetSkill || !patch || !draft || !testResult) {
    return {
      kind: "draft",
      message: "Optimization is missing a tested Skill draft",
    };
  }
  if (
    draft.skillId !== targetSkill.skillId ||
    input.targetSkillId !== targetSkill.skillId ||
    !draft.validation.valid ||
    draft.validation.errors.length > 0
  ) {
    return {
      kind: "draft",
      message: "Optimization Skill draft is invalid",
      failureCode: "skill_validation_failed",
    };
  }
  if (
    testResult.testedRevision !== input.revision ||
    testResult.replayMode !== "recorded_context"
  ) {
    return {
      kind: "draft",
      message: "Current optimization revision has not completed a faithful draft preview",
    };
  }
  const fixedSkillBindingMatches =
    input.answerSkillVersionId !== null &&
    testResult.usedSkillIds.includes(targetSkill.skillId);
  if (
    testResult.runtimeSelectionCheck.targetSkillId !== targetSkill.skillId ||
    (!testResult.runtimeSelectionCheck.targetSkillSelected &&
      !fixedSkillBindingMatches)
  ) {
    return {
      kind: "draft",
      message: "Normal Skill selection did not select the target Skill",
    };
  }
  return null;
}

export type AnswerSkillPreviewEvidenceResult =
  | {
      ok: true;
      evidence: AnswerSkillRefinementQualityEvidence;
    }
  | {
      ok: false;
      reason: "missing_current_preview" | "preview_has_no_issues";
    };

export function getAnswerSkillPreviewIssueEvidence(input: {
  status: AnswerSkillOptimizationStatus;
  revision: number;
  result: AnswerSkillOptimizationResult;
}): AnswerSkillPreviewEvidenceResult {
  const testResult = input.result.testResult;
  if (
    input.status !== "test_ready" ||
    !testResult ||
    testResult.testedRevision !== input.revision
  ) {
    return { ok: false, reason: "missing_current_preview" };
  }
  if (testResult.qualityGate.passed) {
    return { ok: false, reason: "preview_has_no_issues" };
  }
  return {
    ok: true,
    evidence: {
      testedRevision: testResult.testedRevision,
      overallSummary: testResult.qualityGate.overallSummary,
      failedSamples: testResult.samples.flatMap((sample, sampleIndex) =>
        !sample.passed || sample.criticalRisk
          ? [
              {
                sampleIndex,
                unmetRequirements: sample.unmetRequirements,
                riskNotes: sample.riskNotes,
                criticalRisk: sample.criticalRisk,
              },
            ]
          : [],
      ),
      runtimeSelectionPassed:
        testResult.runtimeSelectionCheck.targetSkillSelected,
    },
  };
}

export interface AnswerSkillRefinementTransition {
  revision: number;
  status: AnswerSkillOptimizationStatus;
  result: AnswerSkillOptimizationResult;
}

export function buildAnswerSkillRefinementTransition(input: {
  currentRevision: number;
  stableStatus: AnswerSkillOptimizationStatus;
  stableResult: AnswerSkillOptimizationResult;
  appliedResult: AnswerSkillOptimizationResult | null;
  refinementHistory: AnswerSkillRefinementTurn[];
}): AnswerSkillRefinementTransition {
  if (!input.appliedResult) {
    return {
      revision: input.currentRevision,
      status: input.stableStatus,
      result: {
        ...input.stableResult,
        refinementHistory: input.refinementHistory,
      },
    };
  }
  return {
    revision: input.currentRevision + 1,
    status: "draft_ready",
    result: {
      ...input.appliedResult,
      refinementHistory: input.refinementHistory,
      idempotencyResults: input.stableResult.idempotencyResults,
      testResult: null,
      testFailure: null,
    },
  };
}
