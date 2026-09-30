import { describe, expect, it } from "vitest";
import type { PackageSkill } from "@educlaw/shared";
import {
  AnswerSkillOptimizationContractError,
  parseAnswerOptimizationModelOutput,
  parseAnswerSkillRefinementModelOutput,
  parseAnswerSkillOptimizationResult,
} from "./answer-skill-optimization-contract.js";

const skills: PackageSkill[] = [
  {
    id: "skill-one",
    dirName: "skill-one",
    name: "Skill One",
    description: "Use when the user needs a structured response workflow.",
    skillMd: "skill one markdown",
  },
  {
    id: "skill-two",
    dirName: "skill-two",
    name: "Skill Two",
    description: "Use when the user needs communication guidance.",
    skillMd: "skill two markdown",
  },
];

function modelOutput(overrides: Record<string, unknown> = {}) {
  return {
    diagnosis: {
      summary: "The answer lacks concrete steps.",
      reusability: "reusable",
      riskNotes: [],
    },
    targetSkillId: "skill-one",
    candidateSkills: [],
    patch: {
      section: "Workflow",
      operation: "replace",
      reason: "Provide executable steps.",
      proposedContent: "1. Verify the situation.\n2. Take the next action.",
    },
    ...overrides,
  };
}

describe("parseAnswerOptimizationModelOutput", () => {
  it("accepts a valid structured model result", () => {
    const parsed = parseAnswerOptimizationModelOutput(modelOutput(), {
      skills,
      usedSkillIds: ["skill-one"],
    });

    expect(parsed.targetSkillId).toBe("skill-one");
    expect(parsed.patch?.section).toBe("Workflow");
  });

  it.each([
    "not-json",
    null,
    [],
    { targetSkillId: "skill-one", candidateSkills: [], patch: null },
  ])("rejects non-object or incomplete output", (value) => {
    expect(() =>
      parseAnswerOptimizationModelOutput(value, {
        skills,
        usedSkillIds: ["skill-one"],
      }),
    ).toThrow(AnswerSkillOptimizationContractError);
  });

  it("rejects invalid reusability and riskNotes", () => {
    expect(() =>
      parseAnswerOptimizationModelOutput(
        modelOutput({
          diagnosis: {
            summary: "summary",
            reusability: "sometimes",
            riskNotes: "not-an-array",
          },
        }),
        { skills, usedSkillIds: ["skill-one"] },
      ),
    ).toThrow(AnswerSkillOptimizationContractError);
  });

  it.each([
    ["Unknown", "replace"],
    ["Workflow", "rewrite_everything"],
  ])("rejects an invalid section or operation", (section, operation) => {
    expect(() =>
      parseAnswerOptimizationModelOutput(
        modelOutput({
          patch: {
            section,
            operation,
            reason: "reason",
            proposedContent: "content",
          },
        }),
        { skills, usedSkillIds: ["skill-one"] },
      ),
    ).toThrow(AnswerSkillOptimizationContractError);
  });

  it("rejects a target outside the recorded used Skills", () => {
    expect(() =>
      parseAnswerOptimizationModelOutput(
        modelOutput({ targetSkillId: "skill-two" }),
        { skills, usedSkillIds: ["skill-one"] },
      ),
    ).toThrow("targetSkillId is not allowed");
  });

  it("rejects a candidate outside the base version", () => {
    expect(() =>
      parseAnswerOptimizationModelOutput(
        modelOutput({
          targetSkillId: null,
          patch: null,
          candidateSkills: [{ skillId: "missing", reason: "maybe relevant" }],
        }),
        { skills, usedSkillIds: ["skill-one", "skill-two"] },
      ),
    ).toThrow("Candidate Skill is not allowed");
  });

  it("keeps an answer without recorded Skills in candidate selection", () => {
    const parsed = parseAnswerOptimizationModelOutput(
      modelOutput({
        targetSkillId: null,
        patch: null,
        candidateSkills: [
          { skillId: "skill-two", reason: "The feedback concerns communication." },
        ],
      }),
      { skills, usedSkillIds: [] },
    );

    expect(parsed.targetSkillId).toBeNull();
    expect(parsed.candidateSkills[0]?.skillId).toBe("skill-two");
  });

  it("allows a user-selected candidate when no Skill was recorded", () => {
    const parsed = parseAnswerOptimizationModelOutput(
      modelOutput({ targetSkillId: "skill-two" }),
      {
        skills,
        usedSkillIds: [],
        selectedTargetSkillId: "skill-two",
      },
    );

    expect(parsed.targetSkillId).toBe("skill-two");
  });

  it("rejects extra database control fields", () => {
    expect(() =>
      parseAnswerOptimizationModelOutput(
        modelOutput({ status: "completed", finalVersionId: 99 }),
        { skills, usedSkillIds: ["skill-one"] },
      ),
    ).toThrow("unsupported field");
  });
});

describe("parseAnswerSkillRefinementModelOutput", () => {
  it("accepts one consolidated refinement patch", () => {
    const parsed = parseAnswerSkillRefinementModelOutput({
      kind: "applied",
      assistantSummary: "已保留原有步骤，并加强了中性沟通要求。",
      patch: {
        section: "Workflow",
        operation: "replace",
        reason: "把补充意见合并到现有工作流程中。",
        proposedContent: "1. 核实事实。\n2. 使用中性表述联系家长。",
      },
    });

    expect(parsed.kind).toBe("applied");
    expect(parsed.kind === "applied" && parsed.patch.section).toBe("Workflow");
  });

  it("accepts clarification and one-off outcomes without a patch", () => {
    expect(
      parseAnswerSkillRefinementModelOutput({
        kind: "needs_clarification",
        message: "需要确认你希望保留哪部分。",
        clarificationQuestion: "你希望保留五步结构吗？",
        suggestedFeedback: ["保留五步结构，只加强家长沟通。"],
      }).kind,
    ).toBe("needs_clarification");
    expect(
      parseAnswerSkillRefinementModelOutput({
        kind: "not_suitable_for_shared_rule",
        message: "姓名只适用于本次回答。",
        suggestedReusableFeedback: "以后统一使用中性占位称呼。",
      }).kind,
    ).toBe("not_suitable_for_shared_rule");
  });

  it("rejects extra fields and incomplete outcomes", () => {
    expect(() =>
      parseAnswerSkillRefinementModelOutput({
        kind: "applied",
        assistantSummary: "说明",
        patch: {
          section: "Workflow",
          operation: "replace",
          reason: "说明",
          proposedContent: "新内容",
        },
        targetSkillId: "skill-one",
      }),
    ).toThrow("unsupported field");
    expect(() =>
      parseAnswerSkillRefinementModelOutput({
        kind: "needs_clarification",
        message: "需要确认。",
        clarificationQuestion: "具体修改哪里？",
        suggestedFeedback: [],
      }),
    ).toThrow(AnswerSkillOptimizationContractError);
  });
});

describe("parseAnswerSkillOptimizationResult test data", () => {
  const testResult = {
    testedRevision: 2,
    question: "Original question",
    beforeAnswer: "Original enhanced answer",
    afterAnswer: "Draft-based answer",
    samples: [
      {
        answer: "Draft-based answer",
        passed: true,
        score: 90,
        satisfiedRequirements: ["Clear steps"],
        unmetRequirements: [],
        riskNotes: [],
        criticalRisk: false,
      },
      {
        answer: "Second draft answer",
        passed: true,
        score: 82,
        satisfiedRequirements: ["Usable wording"],
        unmetRequirements: [],
        riskNotes: [],
        criticalRisk: false,
      },
      {
        answer: "Third draft answer",
        passed: false,
        score: 60,
        satisfiedRequirements: [],
        unmetRequirements: ["Follow-up is vague"],
        riskNotes: [],
        criticalRisk: false,
      },
    ],
    qualityGate: {
      passed: true,
      passedCount: 2,
      sampleCount: 3,
      bestSampleIndex: 0,
      overallSummary: "Two samples satisfy the reusable feedback.",
    },
    runtimeSelectionCheck: {
      targetSkillId: "skill-one",
      selectedSkillIds: ["skill-one"],
      targetSkillSelected: true,
    },
    usedSkillIds: ["skill-one"],
    contextMessageIds: [901, 903],
    model: "enhanced-model",
    replayMode: "recorded_context",
    createdAt: "2026-07-23T08:00:00.000Z",
  };

  it("validates internal test metadata and succeeded idempotency replay data", () => {
    const parsed = parseAnswerSkillOptimizationResult({
      testResult,
      testFailure: null,
      idempotencyResults: {
        "test:44444444-4444-4444-8444-444444444444": {
          action: "test",
          key: "44444444-4444-4444-8444-444444444444",
          requestHash: "hash",
          resultingRevision: 2,
          responseSummary: {
            status: "test_ready",
            testOutcome: "succeeded",
            testResult,
          },
        },
      },
    });

    expect(parsed.testResult?.usedSkillIds).toEqual(["skill-one"]);
    expect(parsed.testResult?.contextMessageIds).toEqual([901, 903]);
    expect(parsed.testResult?.model).toBe("enhanced-model");
    expect(parsed.testResult?.replayMode).toBe("recorded_context");
    expect(
      parsed.idempotencyResults?.[
        "test:44444444-4444-4444-8444-444444444444"
      ]?.responseSummary.testResult?.afterAnswer,
    ).toBe("Draft-based answer");
  });

  it("parses strict refinement history and treats an absent history as compatible", () => {
    const parsed = parseAnswerSkillOptimizationResult({
      refinementHistory: [
        {
          id: "turn-1",
          source: "test_failure",
          fromRevision: 2,
          toRevision: 3,
          userMessage: "请保留步骤，并加强中性家长沟通。",
          status: "succeeded",
          createdAt: "2026-07-27T08:00:00.000Z",
          completedAt: "2026-07-27T08:00:01.000Z",
          assistantSummary: "已保留步骤并加强中性沟通规则。",
          qualityEvidence: {
            testedRevision: 2,
            overallSummary: "两个样本仍使用了指责性表达。",
            failedSamples: [
              {
                sampleIndex: 1,
                unmetRequirements: ["家长沟通不够中性"],
                riskNotes: ["可能把未核实信息当成事实"],
                criticalRisk: false,
              },
            ],
            runtimeSelectionPassed: true,
          },
          outcome: {
            kind: "applied",
            assistantSummary: "已保留步骤并加强中性沟通规则。",
          },
        },
      ],
    });

    expect(parsed.refinementHistory?.[0]).toMatchObject({
      source: "test_failure",
      fromRevision: 2,
      toRevision: 3,
      status: "succeeded",
      outcome: { kind: "applied" },
    });
    expect(parseAnswerSkillOptimizationResult({}).refinementHistory).toBeUndefined();
  });

  it("parses non-applied and technical outcomes without inventing a new draft revision", () => {
    const parsed = parseAnswerSkillOptimizationResult({
      refinementHistory: [
        {
          id: "turn-clarify",
          source: "draft_review",
          fromRevision: 2,
          toRevision: null,
          userMessage: "把话术改一下。",
          status: "succeeded",
          createdAt: "2026-07-27T08:00:00.000Z",
          completedAt: "2026-07-27T08:00:01.000Z",
          assistantSummary: null,
          qualityEvidence: null,
          outcome: {
            kind: "needs_clarification",
            message: "还需要确认希望加强哪一种话术。",
            clarificationQuestion: "更希望加强学生沟通还是家长沟通？",
            suggestedFeedback: ["保留步骤，重点加强家长沟通话术。"],
          },
        },
        {
          id: "turn-failed",
          source: "draft_review",
          fromRevision: 2,
          toRevision: null,
          userMessage: "重点加强家长沟通话术。",
          status: "failed",
          createdAt: "2026-07-27T08:01:00.000Z",
          completedAt: "2026-07-27T08:01:01.000Z",
          assistantSummary: null,
          qualityEvidence: null,
          outcome: {
            kind: "technical_failure",
            code: "invalid_model_output",
            userMessage: "模型生成的规则格式不符合要求。",
          },
        },
      ],
    });

    expect(parsed.refinementHistory?.map((turn) => turn.toRevision)).toEqual([
      null,
      null,
    ]);
    expect(parsed.refinementHistory?.map((turn) => turn.outcome?.kind)).toEqual([
      "needs_clarification",
      "technical_failure",
    ]);
  });

  it("normalizes older refinement turns that predate the explicit outcome field", () => {
    const parsed = parseAnswerSkillOptimizationResult({
      refinementHistory: [
        {
          id: "legacy-turn",
          source: "draft_review",
          fromRevision: 1,
          toRevision: 2,
          userMessage: "保留步骤并加强话术。",
          status: "succeeded",
          createdAt: "2026-07-26T08:00:00.000Z",
          completedAt: "2026-07-26T08:00:01.000Z",
          assistantSummary: "已保留步骤并加强话术。",
          qualityEvidence: null,
        },
      ],
    });

    expect(parsed.refinementHistory?.[0]?.outcome).toEqual({
      kind: "applied",
      assistantSummary: "已保留步骤并加强话术。",
    });
  });

  it("rejects malformed refinement history instead of trusting JSONB", () => {
    expect(() =>
      parseAnswerSkillOptimizationResult({
        refinementHistory: [
          {
            id: "turn-1",
            source: "test_failure",
            fromRevision: 2,
            toRevision: null,
            userMessage: "请修改。",
            status: "pending",
            createdAt: "2026-07-27T08:00:00.000Z",
            completedAt: null,
            assistantSummary: null,
            qualityEvidence: null,
          },
        ],
      }),
    ).toThrow("qualityEvidence must match");
  });

  it("rejects invalid test metadata and incomplete succeeded replay data", () => {
    expect(() =>
      parseAnswerSkillOptimizationResult({
        testResult: {
          ...testResult,
          usedSkillIds: ["skill-one", "skill-one"],
        },
      }),
    ).toThrow(AnswerSkillOptimizationContractError);

    expect(() =>
      parseAnswerSkillOptimizationResult({
        testResult: {
          ...testResult,
          contextMessageIds: [901, 901],
        },
      }),
    ).toThrow(AnswerSkillOptimizationContractError);

    expect(() =>
      parseAnswerSkillOptimizationResult({
        testResult: {
          ...testResult,
          replayMode: "question_only",
        },
      }),
    ).toThrow(AnswerSkillOptimizationContractError);

    expect(() =>
      parseAnswerSkillOptimizationResult({
        idempotencyResults: {
          "test:key": {
            action: "test",
            key: "key",
            requestHash: "hash",
            resultingRevision: 2,
            responseSummary: {
              status: "test_ready",
              testOutcome: "succeeded",
            },
          },
        },
      }),
    ).toThrow(AnswerSkillOptimizationContractError);
  });

  it("validates a completed confirm idempotency result", () => {
    const confirmResult = {
      baseVersionId: 10,
      finalVersionId: 11,
      versionNumber: 2,
      source: "interactive",
      completedAt: "2026-07-24T09:00:00.000Z",
    } as const;
    const parsed = parseAnswerSkillOptimizationResult({
      idempotencyResults: {
        "confirm:66666666-6666-4666-8666-666666666666": {
          action: "confirm",
          key: "66666666-6666-4666-8666-666666666666",
          requestHash: "confirm-hash",
          resultingRevision: 2,
          responseSummary: {
            status: "completed",
            confirmResult,
          },
        },
      },
    });

    expect(
      parsed.idempotencyResults?.[
        "confirm:66666666-6666-4666-8666-666666666666"
      ]?.responseSummary.confirmResult,
    ).toEqual(confirmResult);

    expect(() =>
      parseAnswerSkillOptimizationResult({
        idempotencyResults: {
          "confirm:66666666-6666-4666-8666-666666666666": {
            action: "confirm",
            key: "66666666-6666-4666-8666-666666666666",
            requestHash: "confirm-hash",
            resultingRevision: 2,
            responseSummary: {
              status: "test_ready",
              confirmResult,
            },
          },
        },
      }),
    ).toThrow(AnswerSkillOptimizationContractError);
  });

  it("accepts the safe interrupted-operation recovery failure", () => {
    const parsed = parseAnswerSkillOptimizationResult({
      failure: {
        code: "operation_interrupted",
        message:
          "The previous operation was interrupted and can be retried.",
      },
    });

    expect(parsed.failure?.code).toBe("operation_interrupted");
  });
});
