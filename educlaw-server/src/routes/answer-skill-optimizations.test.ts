import type { Server } from "node:http";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createMock = vi.fn();
const getMock = vi.fn();
const reviseMock = vi.fn();
const testMock = vi.fn();
const confirmMock = vi.fn();
const cancelMock = vi.fn();
const suggestionsMock = vi.fn();
const resolveMock = vi.fn();

class MockValidationError extends Error {}
class MockNotFoundError extends Error {}
class MockConflictError extends Error {}
class MockAlreadyExistsError extends MockConflictError {
  code:
    | "answer_optimization_already_exists"
    | "answer_already_optimized";
  existingOptimizationId: number;
  status: string;
  finalVersionId: number | null;
  versionNumber: number | null;

  constructor(completed = false) {
    super("already exists");
    this.code = completed
      ? "answer_already_optimized"
      : "answer_optimization_already_exists";
    this.existingOptimizationId = 789;
    this.status = completed ? "completed" : "draft_ready";
    this.finalVersionId = completed ? 11 : null;
    this.versionNumber = completed ? 2 : null;
  }
}
class MockDraftError extends Error {}
class MockRefinementRejectedError extends Error {
  failureCode: "feedback_not_reusable" | "feedback_unclear";

  constructor(
    failureCode: "feedback_not_reusable" | "feedback_unclear",
  ) {
    super("private refinement detail");
    this.failureCode = failureCode;
  }
}
class MockRefinementTechnicalError extends Error {
  code:
    | "model_unavailable"
    | "invalid_model_output"
    | "patch_application_failed"
    | "skill_validation_failed"
    | "revision_conflict"
    | "unknown";

  constructor(code: MockRefinementTechnicalError["code"]) {
    super("private technical refinement detail");
    this.code = code;
  }
}
class MockReplayUnavailableError extends Error {
  reason:
    | "replay_context_unavailable"
    | "replay_model_unavailable";

  constructor(
    reason:
      | "replay_context_unavailable"
      | "replay_model_unavailable",
  ) {
    super("private replay detail");
    this.reason = reason;
  }
}
class MockUpstreamError extends Error {
  statusCode: 502 | 503;

  constructor(message: string, statusCode: 502 | 503 = 503) {
    super(message);
    this.statusCode = statusCode;
  }
}

class MockBadGatewayError extends MockUpstreamError {
  constructor(message: string) {
    super(message, 502);
  }
}
class MockSuggestionNotFoundError extends Error {}

const detail = {
  optimizationId: 789,
  packageId: 123,
  threadId: 456,
  baseVersionId: 10,
  status: "draft_ready",
  revision: 1,
  feedback: "Add concrete steps.",
  question: { messageId: 1001, content: "Question" },
  originalAnswer: { messageId: 1002, content: "Original answer" },
  baselineAnswer: null,
  diagnosis: {
    summary: "The answer lacks steps.",
    reusability: "reusable",
    riskNotes: [],
  },
  targetSkill: {
    skillId: "skill-one",
    name: "Skill One",
    selectionSource: "recorded",
  },
  candidateSkills: [],
  patch: {
    section: "Workflow",
    operation: "replace",
    reason: "Add steps.",
    proposedContent: "1. First step.\n2. Second step.",
  },
  draft: { skillId: "skill-one", validation: { valid: true, errors: [] } },
  diff: { before: "Old", after: "New" },
  testResult: null,
  refinementHistory: [],
  finalVersionId: null,
  replayAvailability: { available: true, reason: null },
  createdAt: "2026-07-22T08:00:00.000Z",
  updatedAt: "2026-07-22T08:01:00.000Z",
};

async function createApp() {
  vi.resetModules();
  vi.doMock("../services/answer-skill-optimization-service.js", () => ({
    AnswerSkillOptimizationAlreadyExistsError: MockAlreadyExistsError,
    AnswerSkillOptimizationValidationError: MockValidationError,
    AnswerSkillOptimizationNotFoundError: MockNotFoundError,
    AnswerSkillOptimizationReplayUnavailableError:
      MockReplayUnavailableError,
    AnswerSkillOptimizationConflictError: MockConflictError,
    AnswerSkillOptimizationDraftError: MockDraftError,
    AnswerSkillRefinementRejectedError: MockRefinementRejectedError,
    AnswerSkillRefinementTechnicalError: MockRefinementTechnicalError,
    AnswerSkillOptimizationUpstreamError: MockUpstreamError,
    createAnswerSkillOptimization: createMock,
    resolveAnswerSkillOptimizationReference: resolveMock,
    getAnswerSkillOptimizationDetail: getMock,
    reviseAnswerSkillOptimization: reviseMock,
    testAnswerSkillOptimization: testMock,
    confirmAnswerSkillOptimization: confirmMock,
    cancelAnswerSkillOptimization: cancelMock,
  }));
  vi.doMock("../services/answer-optimization-suggestion-service.js", () => ({
    AnswerOptimizationSuggestionNotFoundError: MockSuggestionNotFoundError,
    suggestAnswerOptimizationFeedback: suggestionsMock,
  }));
  const { withRequestContext } = await import("../middleware/request-context.js");
  const router = (await import("./answer-skill-optimizations.js")).default;
  const app = express();
  app.use(withRequestContext);
  app.use(express.json());
  app.use("/api", router);
  return app;
}

async function listen(app: express.Express): Promise<{ server: Server; url: string }> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected a TCP listener");
  }
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function postHeaders(key = "11111111-1111-4111-8111-111111111111") {
  return {
    "Content-Type": "application/json",
    "X-User-Id": "user-1",
    "Idempotency-Key": key,
    "x-request-id": "request-123",
  };
}

function createBody(overrides: Record<string, unknown> = {}) {
  return {
    packageId: 123,
    threadId: 456,
    questionMessageId: 1001,
    enhancedAnswerMessageId: 1002,
    baselineAnswerMessageId: null,
    feedback: "Add concrete steps.",
    ...overrides,
  };
}

beforeEach(() => {
  createMock.mockReset().mockResolvedValue(detail);
  resolveMock.mockReset().mockResolvedValue({
    optimizationId: 789,
    status: "draft_ready",
    versionNumber: null,
  });
  getMock.mockReset().mockResolvedValue(detail);
  reviseMock.mockReset().mockResolvedValue({
    ...detail,
    revision: 2,
    feedback: "Use ordered steps.",
  });
  testMock.mockReset().mockResolvedValue({
    optimizationId: 789,
    status: "test_ready",
    revision: 2,
    testResult: {
      testedRevision: 2,
      question: "Question",
      beforeAnswer: "Original answer",
      afterAnswer: "Improved answer",
      createdAt: detail.updatedAt,
    },
    updatedAt: detail.updatedAt,
  });
  confirmMock.mockReset().mockResolvedValue({
    optimizationId: 789,
    status: "completed",
    baseVersionId: 10,
    finalVersionId: 11,
    versionNumber: 2,
    source: "interactive",
    completedAt: detail.updatedAt,
  });
  cancelMock.mockReset().mockResolvedValue({
    optimizationId: 789,
    status: "cancelled",
    revision: 2,
    reason: "user_cancelled",
    cancelledAt: detail.updatedAt,
  });
  suggestionsMock.mockReset().mockResolvedValue({
    suggestions: [
      "先让学生表达预测和依据",
      "增加关键实验安全提醒",
      "明确观察记录与完成标准",
    ],
    source: "ai",
  });
});

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("../services/answer-skill-optimization-service.js");
  vi.doUnmock("../services/answer-optimization-suggestion-service.js");
});

describe("answer Skill optimization routes", () => {
  it("restores an existing optimization from trusted answer provenance", async () => {
    const { server, url } = await listen(await createApp());
    try {
      const response = await fetch(
        `${url}/api/arena/answer-optimizations/resolve`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-User-Id": "user-1",
          },
          body: JSON.stringify({
            packageId: 123,
            threadId: 456,
            questionMessageId: 1001,
            answerMessageId: 1002,
            answerSide: "enhanced",
          }),
        },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        data: { detail: { optimizationId: 789 }, versionNumber: null },
      });
      expect(resolveMock).toHaveBeenCalledWith({
        userId: "user-1",
        packageId: 123,
        threadId: 456,
        questionMessageId: 1001,
        answerMessageId: 1002,
        answerSide: "enhanced",
      });
    } finally {
      await close(server);
    }
  });

  it("returns answer-specific improvement suggestions from trusted IDs", async () => {
    const { server, url } = await listen(await createApp());
    try {
      const response = await fetch(
        `${url}/api/arena/answer-optimizations/suggestions`,
        {
          method: "POST",
          headers: postHeaders(),
          body: JSON.stringify({
            packageId: 123,
            threadId: 456,
            questionMessageId: 1001,
            answerMessageId: 1002,
            answerSide: "enhanced",
            answerVersionNumber: 2,
          }),
        },
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        data: {
          suggestions: [
            "先让学生表达预测和依据",
            "增加关键实验安全提醒",
            "明确观察记录与完成标准",
          ],
          source: "ai",
        },
        requestId: "request-123",
      });
      expect(suggestionsMock).toHaveBeenCalledWith({
        userId: "user-1",
        packageId: 123,
        threadId: 456,
        questionMessageId: 1001,
        answerMessageId: 1002,
        answerSide: "enhanced",
        answerVersionNumber: 2,
      });
    } finally {
      await close(server);
    }
  });

  it("rejects invalid suggestion fields before calling the service", async () => {
    const { server, url } = await listen(await createApp());
    try {
      const response = await fetch(
        `${url}/api/arena/answer-optimizations/suggestions`,
        {
          method: "POST",
          headers: postHeaders(),
          body: JSON.stringify({
            packageId: 123,
            threadId: 456,
            questionMessageId: 1001,
            answerMessageId: 1002,
            answerSide: "unknown",
            answerVersionNumber: 2,
            answer: "client supplied text",
          }),
        },
      );

      expect(response.status).toBe(400);
      expect(suggestionsMock).not.toHaveBeenCalled();
    } finally {
      await close(server);
    }
  });

  it("creates from IDs and trusted Kong identity with the success envelope", async () => {
    const { server, url } = await listen(await createApp());
    try {
      const response = await fetch(`${url}/api/arena/answer-optimizations`, {
        method: "POST",
        headers: postHeaders(),
        body: JSON.stringify(createBody()),
      });
      const payload = (await response.json()) as {
        data: typeof detail;
        requestId: string;
      };

      expect(response.status).toBe(200);
      expect(payload.data.optimizationId).toBe(789);
      expect(payload.requestId).toBe("request-123");
      expect(response.headers.get("x-request-id")).toBe("request-123");
      expect(createMock).toHaveBeenCalledWith({
        userId: "user-1",
        packageId: 123,
        threadId: 456,
        questionMessageId: 1001,
        enhancedAnswerMessageId: 1002,
        baselineAnswerMessageId: null,
        feedback: "Add concrete steps.",
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
      });
    } finally {
      await close(server);
    }
  });

  it("restores a task through the owner-scoped GET route", async () => {
    const { server, url } = await listen(await createApp());
    try {
      const response = await fetch(
        `${url}/api/arena/answer-optimizations/789`,
        { headers: { "X-User-Id": "user-1", "x-request-id": "get-123" } },
      );
      const payload = (await response.json()) as { data: typeof detail };

      expect(response.status).toBe(200);
      expect(payload.data.originalAnswer.content).toBe("Original answer");
      expect(getMock).toHaveBeenCalledWith("user-1", 789);
    } finally {
      await close(server);
    }
  });

  it("passes the exact revise and cancel contracts", async () => {
    const { server, url } = await listen(await createApp());
    try {
      const reviseResponse = await fetch(
        `${url}/api/arena/answer-optimizations/789/revise`,
        {
          method: "POST",
          headers: postHeaders("22222222-2222-4222-8222-222222222222"),
          body: JSON.stringify({
            expectedRevision: 1,
            feedback: "Use ordered steps.",
            targetSkillId: "skill-one",
          }),
        },
      );
      const cancelResponse = await fetch(
        `${url}/api/arena/answer-optimizations/789/cancel`,
        {
          method: "POST",
          headers: postHeaders("33333333-3333-4333-8333-333333333333"),
          body: JSON.stringify({ expectedRevision: 2, reason: "user_cancelled" }),
        },
      );

      expect(reviseResponse.status).toBe(200);
      expect(cancelResponse.status).toBe(200);
      expect(reviseMock).toHaveBeenCalledWith({
        userId: "user-1",
        optimizationId: 789,
        expectedRevision: 1,
        feedback: "Use ordered steps.",
        targetSkillId: "skill-one",
        idempotencyKey: "22222222-2222-4222-8222-222222222222",
      });
      expect(cancelMock).toHaveBeenCalledWith({
        userId: "user-1",
        optimizationId: 789,
        expectedRevision: 2,
        reason: "user_cancelled",
        idempotencyKey: "33333333-3333-4333-8333-333333333333",
      });
    } finally {
      await close(server);
    }
  });

  it("passes the exact additional-feedback refinement contract", async () => {
    const { server, url } = await listen(await createApp());
    try {
      const response = await fetch(
        `${url}/api/arena/answer-optimizations/789/revise`,
        {
          method: "POST",
          headers: postHeaders("55555555-5555-4555-8555-555555555555"),
          body: JSON.stringify({
            expectedRevision: 2,
            additionalFeedback:
              "Keep the five-step structure and make the wording neutral.",
            revisionSource: "test_failure",
          }),
        },
      );

      expect(response.status).toBe(200);
      expect(reviseMock).toHaveBeenCalledWith({
        userId: "user-1",
        optimizationId: 789,
        expectedRevision: 2,
        additionalFeedback:
          "Keep the five-step structure and make the wording neutral.",
        revisionSource: "test_failure",
        idempotencyKey: "55555555-5555-4555-8555-555555555555",
      });
    } finally {
      await close(server);
    }
  });

  it("accepts test-failure refinement without extra feedback and alternative regeneration without draft data", async () => {
    const { server, url } = await listen(await createApp());
    try {
      const testFailureResponse = await fetch(
        `${url}/api/arena/answer-optimizations/789/revise`,
        {
          method: "POST",
          headers: postHeaders("56565656-5656-4565-8565-565656565656"),
          body: JSON.stringify({
            expectedRevision: 2,
            revisionSource: "test_failure",
          }),
        },
      );
      const alternativeResponse = await fetch(
        `${url}/api/arena/answer-optimizations/789/revise`,
        {
          method: "POST",
          headers: postHeaders("67676767-6767-4676-8676-676767676767"),
          body: JSON.stringify({
            expectedRevision: 3,
            revisionSource: "alternative_regeneration",
          }),
        },
      );

      expect(testFailureResponse.status).toBe(200);
      expect(alternativeResponse.status).toBe(200);
      expect(reviseMock).toHaveBeenNthCalledWith(1, {
        userId: "user-1",
        optimizationId: 789,
        expectedRevision: 2,
        revisionSource: "test_failure",
        idempotencyKey: "56565656-5656-4565-8565-565656565656",
      });
      expect(reviseMock).toHaveBeenNthCalledWith(2, {
        userId: "user-1",
        optimizationId: 789,
        expectedRevision: 3,
        revisionSource: "alternative_regeneration",
        idempotencyKey: "67676767-6767-4676-8676-676767676767",
      });
    } finally {
      await close(server);
    }
  });

  it("normalizes whitespace-only test-failure feedback and returns the complete refreshed detail", async () => {
    const { server, url } = await listen(await createApp());
    try {
      const response = await fetch(
        `${url}/api/arena/answer-optimizations/789/revise`,
        {
          method: "POST",
          headers: postHeaders("58585858-5858-4585-8585-585858585858"),
          body: JSON.stringify({
            expectedRevision: 2,
            additionalFeedback: "   ",
            revisionSource: "test_failure",
          }),
        },
      );
      const payload = (await response.json()) as {
        data: typeof detail;
        requestId: string;
      };

      expect(response.status).toBe(200);
      expect(reviseMock).toHaveBeenCalledWith({
        userId: "user-1",
        optimizationId: 789,
        expectedRevision: 2,
        revisionSource: "test_failure",
        idempotencyKey: "58585858-5858-4585-8585-585858585858",
      });
      expect(payload.data).toMatchObject({
        optimizationId: 789,
        revision: 2,
        question: detail.question,
        originalAnswer: detail.originalAnswer,
        replayAvailability: detail.replayAvailability,
      });
      expect(payload.requestId).toBe("request-123");
    } finally {
      await close(server);
    }
  });

  it.each([
    {
      expectedRevision: 2,
      additionalFeedback: "Make it clearer.",
      revisionSource: "invalid_source",
    },
    {
      expectedRevision: 2,
      additionalFeedback: "Make it clearer.",
      revisionSource: "draft_review",
      feedback: "Forged replacement feedback.",
    },
    {
      expectedRevision: 2,
      additionalFeedback: "Make it clearer.",
      revisionSource: "draft_review",
      targetSkillId: "skill-one",
    },
    {
      expectedRevision: 2,
      revisionSource: "draft_review",
    },
    {
      expectedRevision: 2,
      revisionSource: "draft_review",
      additionalFeedback: "x".repeat(1501),
    },
    {
      expectedRevision: 2,
      revisionSource: "alternative_regeneration",
      additionalFeedback: "Forged current-draft instruction.",
    },
  ])("rejects an invalid refinement body", async (body) => {
    const { server, url } = await listen(await createApp());
    try {
      const response = await fetch(
        `${url}/api/arena/answer-optimizations/789/revise`,
        {
          method: "POST",
          headers: postHeaders("55555555-5555-4555-8555-555555555555"),
          body: JSON.stringify(body),
        },
      );

      expect(response.status).toBe(400);
      expect(reviseMock).not.toHaveBeenCalled();
    } finally {
      await close(server);
    }
  });

  it("maps a rejected refinement to a safe 422 response", async () => {
    reviseMock.mockRejectedValue(
      new MockRefinementRejectedError("feedback_unclear"),
    );
    const { server, url } = await listen(await createApp());
    try {
      const response = await fetch(
        `${url}/api/arena/answer-optimizations/789/revise`,
        {
          method: "POST",
          headers: postHeaders("55555555-5555-4555-8555-555555555555"),
          body: JSON.stringify({
            expectedRevision: 2,
            additionalFeedback: "Make it different.",
            revisionSource: "draft_review",
          }),
        },
      );

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({
        error: "feedback_unclear",
        requestId: "request-123",
      });
    } finally {
      await close(server);
    }
  });

  it.each([
    ["model_unavailable", 503],
    ["invalid_model_output", 422],
    ["patch_application_failed", 422],
    ["skill_validation_failed", 422],
    ["revision_conflict", 409],
    ["unknown", 500],
  ] as const)(
    "maps refinement technical failure %s to a safe %i response",
    async (code, status) => {
      reviseMock.mockRejectedValue(new MockRefinementTechnicalError(code));
      const { server, url } = await listen(await createApp());
      try {
        const response = await fetch(
          `${url}/api/arena/answer-optimizations/789/revise`,
          {
            method: "POST",
            headers: postHeaders("57575757-5757-4575-8575-575757575757"),
            body: JSON.stringify({
              expectedRevision: 2,
              additionalFeedback: "Make the existing rule more concrete.",
              revisionSource: "draft_review",
            }),
          },
        );

        expect(response.status).toBe(status);
        expect(await response.json()).toEqual({
          error: "refinement_technical_failure",
          code,
          requestId: "request-123",
        });
      } finally {
        await close(server);
      }
    },
  );

  it("tests only the expected revision and returns the REVIEW_SPEC envelope", async () => {
    const { server, url } = await listen(await createApp());
    try {
      const response = await fetch(
        `${url}/api/arena/answer-optimizations/789/test`,
        {
          method: "POST",
          headers: postHeaders("44444444-4444-4444-8444-444444444444"),
          body: JSON.stringify({ expectedRevision: 2 }),
        },
      );
      const payload = (await response.json()) as {
        data: {
          optimizationId: number;
          status: string;
          revision: number;
          testResult: {
            testedRevision: number;
            beforeAnswer: string;
            afterAnswer: string;
          };
        };
        requestId: string;
      };

      expect(response.status).toBe(200);
      expect(payload).toMatchObject({
        data: {
          optimizationId: 789,
          status: "test_ready",
          revision: 2,
          testResult: {
            testedRevision: 2,
            beforeAnswer: "Original answer",
            afterAnswer: "Improved answer",
          },
        },
        requestId: "request-123",
      });
      expect(testMock).toHaveBeenCalledWith({
        userId: "user-1",
        optimizationId: 789,
        expectedRevision: 2,
        idempotencyKey: "44444444-4444-4444-8444-444444444444",
      });
    } finally {
      await close(server);
    }
  });

  it("rejects invalid test headers, content types, and forbidden body fields", async () => {
    const { server, url } = await listen(await createApp());
    try {
      const endpoint = `${url}/api/arena/answer-optimizations/789/test`;
      const invalidKey = await fetch(endpoint, {
        method: "POST",
        headers: postHeaders("not-a-uuid"),
        body: JSON.stringify({ expectedRevision: 2 }),
      });
      const nonJson = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          "X-User-Id": "user-1",
          "Idempotency-Key": "44444444-4444-4444-8444-444444444444",
        },
        body: JSON.stringify({ expectedRevision: 2 }),
      });
      const forbiddenFields = [
        "userId",
        "ownerId",
        "question",
        "beforeAnswer",
        "afterAnswer",
        "skillMd",
        "draft",
        "patch",
        "snapshot",
        "baseVersionId",
        "targetSkillId",
        "result_json",
      ];
      for (const field of forbiddenFields) {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: postHeaders("44444444-4444-4444-8444-444444444444"),
          body: JSON.stringify({ expectedRevision: 2, [field]: "forged" }),
        });
        expect(response.status).toBe(400);
      }

      expect(invalidKey.status).toBe(400);
      expect(nonJson.status).toBe(400);
      expect(testMock).not.toHaveBeenCalled();
    } finally {
      await close(server);
    }
  });

  it("requires authentication for draft testing", async () => {
    const { server, url } = await listen(await createApp());
    try {
      const response = await fetch(
        `${url}/api/arena/answer-optimizations/789/test`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": "44444444-4444-4444-8444-444444444444",
          },
          body: JSON.stringify({ expectedRevision: 2 }),
        },
      );

      expect(response.status).toBe(401);
      expect(testMock).not.toHaveBeenCalled();
    } finally {
      await close(server);
    }
  });

  it("rejects body identity, snapshots, and missing idempotency headers", async () => {
    const { server, url } = await listen(await createApp());
    try {
      for (const forbidden of [
        { userId: "attacker" },
        { ownerId: "attacker" },
        { snapshot: {} },
        { skillMd: "forged" },
      ]) {
        const response = await fetch(`${url}/api/arena/answer-optimizations`, {
          method: "POST",
          headers: postHeaders(),
          body: JSON.stringify(createBody(forbidden)),
        });
        expect(response.status).toBe(400);
      }
      const missingKey = await fetch(`${url}/api/arena/answer-optimizations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Id": "user-1",
        },
        body: JSON.stringify(createBody()),
      });
      expect(missingKey.status).toBe(400);
      expect(createMock).not.toHaveBeenCalled();
    } finally {
      await close(server);
    }
  });

  it("returns requestId with a production-style authentication failure", async () => {
    const { server, url } = await listen(await createApp());
    try {
      const response = await fetch(`${url}/api/arena/answer-optimizations/789`, {
        headers: { "x-request-id": "unauthorized-123" },
      });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        error: "Authentication required",
        requestId: "unauthorized-123",
      });
    } finally {
      await close(server);
    }
  });

  it("returns a resumable task in the structured duplicate-create conflict", async () => {
    createMock.mockRejectedValue(new MockAlreadyExistsError(false));
    const { server, url } = await listen(await createApp());
    try {
      const response = await fetch(`${url}/api/arena/answer-optimizations`, {
        method: "POST",
        headers: postHeaders(),
        body: JSON.stringify(createBody()),
      });

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: "answer_optimization_already_exists",
        existingOptimizationId: 789,
        status: "draft_ready",
        requestId: "request-123",
      });
    } finally {
      await close(server);
    }
  });

  it("returns the final version in a completed-answer conflict", async () => {
    createMock.mockRejectedValue(new MockAlreadyExistsError(true));
    const { server, url } = await listen(await createApp());
    try {
      const response = await fetch(`${url}/api/arena/answer-optimizations`, {
        method: "POST",
        headers: postHeaders(),
        body: JSON.stringify(createBody()),
      });

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: "answer_already_optimized",
        existingOptimizationId: 789,
        status: "completed",
        finalVersionId: 11,
        versionNumber: 2,
        requestId: "request-123",
      });
    } finally {
      await close(server);
    }
  });

  it("returns a safe structured 422 when replay provenance is unavailable", async () => {
    createMock.mockRejectedValue(
      new MockReplayUnavailableError("replay_context_unavailable"),
    );
    const { server, url } = await listen(await createApp());
    try {
      const response = await fetch(`${url}/api/arena/answer-optimizations`, {
        method: "POST",
        headers: postHeaders(),
        body: JSON.stringify(createBody()),
      });

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({
        error: "replay_provenance_unavailable",
        reason: "replay_context_unavailable",
        requestId: "request-123",
      });
    } finally {
      await close(server);
    }
  });

  it.each([
    [MockValidationError, 400],
    [MockNotFoundError, 404],
    [MockConflictError, 409],
    [MockDraftError, 422],
    [MockBadGatewayError, 502],
    [MockUpstreamError, 503],
    [Error, 500],
  ])("maps service errors without exposing internals", async (ErrorType, status) => {
    createMock.mockRejectedValue(new ErrorType("private internal detail"));
    const { server, url } = await listen(await createApp());
    try {
      const response = await fetch(`${url}/api/arena/answer-optimizations`, {
        method: "POST",
        headers: postHeaders(),
        body: JSON.stringify(createBody()),
      });
      const payload = (await response.json()) as {
        error: string;
        requestId: string;
      };

      expect(response.status).toBe(status);
      expect(payload.requestId).toBe("request-123");
      if (status === 422 || status >= 500) {
        expect(payload.error).not.toContain("private internal detail");
      }
    } finally {
      await close(server);
    }
  });

  it.each([
    ["validation", MockValidationError, 400],
    ["not found", MockNotFoundError, 404],
    ["conflict", MockConflictError, 409],
    ["draft", MockDraftError, 422],
    ["upstream", MockUpstreamError, 503],
    ["unknown", Error, 500],
  ])("maps %s draft test errors to %i", async (_label, ErrorType, status) => {
    testMock.mockRejectedValue(new ErrorType("private test detail"));
    const { server, url } = await listen(await createApp());
    try {
      const response = await fetch(
        `${url}/api/arena/answer-optimizations/789/test`,
        {
          method: "POST",
          headers: postHeaders("44444444-4444-4444-8444-444444444444"),
          body: JSON.stringify({ expectedRevision: 2 }),
        },
      );
      const payload = (await response.json()) as { error: string };

      expect(response.status).toBe(status);
      if (status === 422 || status >= 500) {
        expect(payload.error).not.toContain("private test detail");
      }
    } finally {
      await close(server);
    }
  });

  it("confirms a tested revision with a server-controlled version", async () => {
    const { server, url } = await listen(await createApp());
    try {
      const response = await fetch(
        `${url}/api/arena/answer-optimizations/789/confirm`,
        {
          method: "POST",
          headers: postHeaders(),
          body: JSON.stringify({
            expectedRevision: 2,
            versionNote: "Add ordered response steps.",
          }),
        },
      );
      const payload = (await response.json()) as {
        data: {
          status: string;
          finalVersionId: number;
          versionNumber: number;
          source: string;
        };
        requestId: string;
      };

      expect(response.status).toBe(200);
      expect(payload.data).toMatchObject({
        status: "completed",
        finalVersionId: 11,
        versionNumber: 2,
        source: "interactive",
      });
      expect(payload.requestId).toBe("request-123");
      expect(confirmMock).toHaveBeenCalledWith({
        userId: "user-1",
        optimizationId: 789,
        expectedRevision: 2,
        versionNote: "Add ordered response steps.",
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
      });
    } finally {
      await close(server);
    }
  });

  it.each([
    [{ expectedRevision: 0 }, "expectedRevision"],
    [{ expectedRevision: 2, versionNote: null }, "versionNote"],
    [{ expectedRevision: 2, snapshot: {} }, "Unexpected request field"],
  ])("rejects an invalid confirm body", async (body, message) => {
    const { server, url } = await listen(await createApp());
    try {
      const response = await fetch(
        `${url}/api/arena/answer-optimizations/789/confirm`,
        {
          method: "POST",
          headers: postHeaders(),
          body: JSON.stringify(body),
        },
      );
      const payload = (await response.json()) as { error: string };

      expect(response.status).toBe(400);
      expect(payload.error).toContain(message);
      expect(confirmMock).not.toHaveBeenCalled();
    } finally {
      await close(server);
    }
  });
});
