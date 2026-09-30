import { describe, expect, it } from "vitest";
import type {
  AnswerOptimizationTestResult,
  AnswerSkillOptimizationResult,
  AnswerSkillRefinementTurn,
} from "./answer-skill-optimization-contract.js";
import {
  buildAnswerSkillRefinementTransition,
  getAnswerSkillConfirmIssue,
  getAnswerSkillPreviewIssueEvidence,
} from "./answer-skill-optimization-policy.js";

function testResult(overrides: {
  passed?: boolean;
  targetSkillSelected?: boolean;
  testedRevision?: number;
} = {}): AnswerOptimizationTestResult {
  const previewPassed = overrides.passed ?? true;
  const samples = [0, 1, 2].map((index) => ({
    answer: `answer-${index}`,
    passed: previewPassed ? index < 2 : index === 0,
    score: previewPassed
      ? (index < 2 ? 80 : 55)
      : (index === 0 ? 80 : 55),
    satisfiedRequirements:
      previewPassed
        ? (index < 2 ? ["requirement met"] : [])
        : (index === 0 ? ["requirement met"] : []),
    unmetRequirements:
      previewPassed
        ? (index === 2 ? ["missing detail"] : [])
        : (index > 0 ? ["missing detail"] : []),
    riskNotes: [],
    criticalRisk: false,
  })) as AnswerOptimizationTestResult["samples"];
  return {
    testedRevision: overrides.testedRevision ?? 2,
    question: "question",
    beforeAnswer: "before",
    afterAnswer: "answer-0",
    samples,
    qualityGate: {
      passed: previewPassed,
      passedCount: previewPassed ? 2 : 1,
      sampleCount: 3,
      bestSampleIndex: 0,
      overallSummary: "Two samples are stable.",
    },
    runtimeSelectionCheck: {
      targetSkillId: "skill-one",
      selectedSkillIds: overrides.targetSkillSelected === false
        ? ["skill-two"]
        : ["skill-one"],
      targetSkillSelected: overrides.targetSkillSelected ?? true,
    },
    usedSkillIds: ["skill-one"],
    contextMessageIds: [],
    model: "model-one",
    replayMode: "recorded_context",
    createdAt: "2026-07-28T00:00:00.000Z",
  };
}

function result(
  preview: AnswerOptimizationTestResult = testResult(),
): AnswerSkillOptimizationResult {
  return {
    targetSkill: {
      skillId: "skill-one",
      name: "Skill One",
      selectionSource: "recorded",
    },
    patch: {
      section: "Workflow",
      operation: "replace",
      reason: "Make it actionable.",
      proposedContent: "1. First step",
    },
    draft: {
      skillId: "skill-one",
      skillMd: "valid",
      validation: { valid: true, errors: [] },
    },
    diff: { before: "before", after: "after" },
    testResult: preview,
  };
}

it("treats an advisory preview with concerns as confirmable", () => {
  expect(
    getAnswerSkillConfirmIssue({
      status: "test_ready",
      finalVersionId: null,
      answerSkillVersionId: null,
      targetSkillId: "skill-one",
      revision: 2,
      result: result(testResult({ passed: false })),
    }),
  ).toBeNull();
});

it("still blocks confirmation when the runtime selector misses the target", () => {
  expect(
    getAnswerSkillConfirmIssue({
      status: "test_ready",
      finalVersionId: null,
      answerSkillVersionId: null,
      targetSkillId: "skill-one",
      revision: 2,
      result: result(testResult({ passed: false, targetSkillSelected: false })),
    }),
  ).toMatchObject({
    kind: "draft",
    message: "Normal Skill selection did not select the target Skill",
  });
});

it("accepts a recorded fixed Skill run even when an old preview stored an auto-route miss", () => {
  expect(
    getAnswerSkillConfirmIssue({
      status: "test_ready",
      finalVersionId: null,
      answerSkillVersionId: 20,
      targetSkillId: "skill-one",
      revision: 2,
      result: result(testResult({ passed: false, targetSkillSelected: false })),
    }),
  ).toBeNull();
});

it("still requires a faithful preview of the current revision", () => {
  const missingPreview = result();
  missingPreview.testResult = null;
  expect(
    getAnswerSkillConfirmIssue({
      status: "test_ready",
      finalVersionId: null,
      answerSkillVersionId: null,
      targetSkillId: "skill-one",
      revision: 2,
      result: missingPreview,
    }),
  ).toMatchObject({
    kind: "draft",
    message: "Optimization is missing a tested Skill draft",
  });

  expect(
    getAnswerSkillConfirmIssue({
      status: "test_ready",
      finalVersionId: null,
      answerSkillVersionId: null,
      targetSkillId: "skill-one",
      revision: 3,
      result: result(testResult({ testedRevision: 2, passed: false })),
    }),
  ).toMatchObject({
    kind: "draft",
    message: expect.stringMatching(/current optimization revision/i),
  });
});

it("builds server-owned evidence only from the current preview", () => {
  const evidence = getAnswerSkillPreviewIssueEvidence({
    status: "test_ready",
    revision: 2,
    result: result(testResult({ passed: false })),
  });
  expect(evidence).toMatchObject({
    ok: true,
    evidence: {
      testedRevision: 2,
      failedSamples: [
        {
          sampleIndex: 1,
          unmetRequirements: ["missing detail"],
        },
        {
          sampleIndex: 2,
          unmetRequirements: ["missing detail"],
        },
      ],
    },
  });
});

describe("buildAnswerSkillRefinementTransition", () => {
  const history = [
    {
      id: "turn-one",
      source: "test_failure",
      fromRevision: 2,
      toRevision: 3,
      userMessage: "Use the preview issues.",
      status: "succeeded",
      createdAt: "2026-07-28T00:00:00.000Z",
      completedAt: "2026-07-28T00:00:01.000Z",
      assistantSummary: "Updated the draft.",
      qualityEvidence: null,
      outcome: {
        kind: "applied",
        assistantSummary: "Updated the draft.",
      },
    },
  ] satisfies AnswerSkillRefinementTurn[];

  it("atomically describes the next successful draft revision", () => {
    const transition = buildAnswerSkillRefinementTransition({
      currentRevision: 2,
      stableStatus: "test_ready",
      stableResult: result(testResult({ passed: false })),
      appliedResult: {
        ...result(testResult({ passed: false })),
        diff: { before: "before", after: "new draft" },
      },
      refinementHistory: history,
    });

    expect(transition).toMatchObject({
      revision: 3,
      status: "draft_ready",
      result: {
        diff: { before: "before", after: "new draft" },
        testResult: null,
        testFailure: null,
      },
    });
  });

  it("preserves the successful draft and preview for a non-applied outcome", () => {
    const stableResult = result(testResult({ passed: false }));
    const transition = buildAnswerSkillRefinementTransition({
      currentRevision: 2,
      stableStatus: "test_ready",
      stableResult,
      appliedResult: null,
      refinementHistory: history,
    });

    expect(transition.revision).toBe(2);
    expect(transition.status).toBe("test_ready");
    expect(transition.result.draft).toEqual(stableResult.draft);
    expect(transition.result.diff).toEqual(stableResult.diff);
    expect(transition.result.testResult).toEqual(stableResult.testResult);
  });
});
