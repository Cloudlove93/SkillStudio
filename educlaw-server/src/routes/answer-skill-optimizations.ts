import { Router, type Request, type Response } from "express";
import { ANSWER_SKILL_OPTIMIZATION_ROUTES } from "@educlaw/shared";
import { getLogger, getRequestId } from "../lib/request-context.js";
import { safeError } from "../lib/logger.js";
import { requireAuth } from "../middleware/auth.js";
import {
  AnswerSkillOptimizationAlreadyExistsError,
  AnswerSkillOptimizationConflictError,
  AnswerSkillOptimizationDraftError,
  AnswerSkillOptimizationNotFoundError,
  AnswerSkillOptimizationReplayUnavailableError,
  AnswerSkillOptimizationUpstreamError,
  AnswerSkillOptimizationValidationError,
  AnswerSkillRefinementRejectedError,
  AnswerSkillRefinementTechnicalError,
  cancelAnswerSkillOptimization,
  confirmAnswerSkillOptimization,
  createAnswerSkillOptimization,
  getAnswerSkillOptimizationDetail,
  rebaseAnswerSkillOptimization,
  resolveAnswerSkillOptimizationReference,
  reviseAnswerSkillOptimization,
  testAnswerSkillOptimization,
  type CancelAnswerSkillOptimizationInput,
  type ConfirmAnswerSkillOptimizationInput,
  type CreateAnswerSkillOptimizationRunInput,
  type ReviseAnswerSkillOptimizationInput,
  type TestAnswerSkillOptimizationInput,
} from "../services/answer-skill-optimization-service.js";
import type { AuthedRequest } from "../types.js";
import {
  AnswerOptimizationSuggestionNotFoundError,
  suggestAnswerOptimizationFeedback,
} from "../services/answer-optimization-suggestion-service.js";

const router: import("express").Router = Router();
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new AnswerSkillOptimizationValidationError(
      "Request body must be a JSON object",
    );
  }
  return value as Record<string, unknown>;
}

function assertOnlyKeys(
  body: Record<string, unknown>,
  allowedFields: readonly string[],
): void {
  const allowed = new Set(allowedFields);
  const unexpected = Object.keys(body).find((field) => !allowed.has(field));
  if (unexpected) {
    throw new AnswerSkillOptimizationValidationError(
      `Unexpected request field: ${unexpected}`,
    );
  }
}

function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new AnswerSkillOptimizationValidationError(
      `${field} must be a positive integer`,
    );
  }
  return value;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new AnswerSkillOptimizationValidationError(`${field} must be a string`);
  }
  return value;
}

function optionalBaselineMessageId(value: unknown): number | null | undefined {
  if (value === undefined || value === null) return value;
  return positiveInteger(value, "baselineAnswerMessageId");
}

function parseCreateBody(
  value: unknown,
  userId: string,
  idempotencyKey: string,
): CreateAnswerSkillOptimizationRunInput {
  const body = asObject(value);
  assertOnlyKeys(body, [
    "packageId",
    "threadId",
    "questionMessageId",
    "enhancedAnswerMessageId",
    "baselineAnswerMessageId",
    "answerSide",
    "answerMessageId",
    "feedback",
  ]);
  return {
    userId,
    packageId: positiveInteger(body.packageId, "packageId"),
    threadId: positiveInteger(body.threadId, "threadId"),
    questionMessageId: positiveInteger(
      body.questionMessageId,
      "questionMessageId",
    ),
    enhancedAnswerMessageId: positiveInteger(
      body.enhancedAnswerMessageId,
      "enhancedAnswerMessageId",
    ),
    baselineAnswerMessageId: optionalBaselineMessageId(
      body.baselineAnswerMessageId,
    ),
    answerSide:
      body.answerSide === undefined
        ? undefined
        : body.answerSide === "baseline" || body.answerSide === "enhanced"
          ? body.answerSide
          : (() => {
              throw new AnswerSkillOptimizationValidationError(
                "answerSide must be baseline or enhanced",
              );
            })(),
    answerMessageId:
      body.answerMessageId === undefined
        ? undefined
        : positiveInteger(body.answerMessageId, "answerMessageId"),
    feedback: requiredString(body.feedback, "feedback"),
    idempotencyKey,
  };
}

function parseSuggestionsBody(value: unknown, userId: string) {
  const body = asObject(value);
  assertOnlyKeys(body, [
    "packageId",
    "threadId",
    "questionMessageId",
    "answerMessageId",
    "answerSide",
    "answerVersionNumber",
  ]);
  if (body.answerSide !== "baseline" && body.answerSide !== "enhanced") {
    throw new AnswerSkillOptimizationValidationError(
      "answerSide must be baseline or enhanced",
    );
  }
  const answerSide: "baseline" | "enhanced" = body.answerSide;
  return {
    userId,
    packageId: positiveInteger(body.packageId, "packageId"),
    threadId: positiveInteger(body.threadId, "threadId"),
    questionMessageId: positiveInteger(body.questionMessageId, "questionMessageId"),
    answerMessageId: positiveInteger(body.answerMessageId, "answerMessageId"),
    answerSide,
    answerVersionNumber: positiveInteger(body.answerVersionNumber, "answerVersionNumber"),
  };
}

function parseResolveBody(value: unknown, userId: string) {
  const body = asObject(value);
  assertOnlyKeys(body, [
    "packageId",
    "threadId",
    "questionMessageId",
    "answerMessageId",
    "answerSide",
  ]);
  if (body.answerSide !== "baseline" && body.answerSide !== "enhanced") {
    throw new AnswerSkillOptimizationValidationError(
      "answerSide must be baseline or enhanced",
    );
  }
  const answerSide: "baseline" | "enhanced" = body.answerSide;
  return {
    userId,
    packageId: positiveInteger(body.packageId, "packageId"),
    threadId: positiveInteger(body.threadId, "threadId"),
    questionMessageId: positiveInteger(body.questionMessageId, "questionMessageId"),
    answerMessageId: positiveInteger(body.answerMessageId, "answerMessageId"),
    answerSide,
  };
}

function parseReviseBody(
  value: unknown,
  userId: string,
  optimizationId: number,
  idempotencyKey: string,
): ReviseAnswerSkillOptimizationInput {
  const body = asObject(value);
  assertOnlyKeys(body, [
    "expectedRevision",
    "feedback",
    "targetSkillId",
    "targetSkillIds",
    "additionalFeedback",
    "revisionSource",
  ]);
  const expectedRevision = positiveInteger(
    body.expectedRevision,
    "expectedRevision",
  );
  const usesRefinementMode =
    body.additionalFeedback !== undefined || body.revisionSource !== undefined;
  if (usesRefinementMode) {
    if (
      body.feedback !== undefined ||
      body.targetSkillId !== undefined ||
      body.targetSkillIds !== undefined
    ) {
      throw new AnswerSkillOptimizationValidationError(
        "Refinement input cannot include feedback, targetSkillId, or targetSkillIds",
      );
    }
    if (
      body.revisionSource !== "draft_review" &&
      body.revisionSource !== "test_failure" &&
      body.revisionSource !== "alternative_regeneration"
    ) {
      throw new AnswerSkillOptimizationValidationError(
        "revisionSource must be draft_review, test_failure, or alternative_regeneration",
      );
    }
    if (body.revisionSource === "alternative_regeneration") {
      if (body.additionalFeedback !== undefined) {
        throw new AnswerSkillOptimizationValidationError(
          "alternative_regeneration cannot include additionalFeedback",
        );
      }
      return {
        userId,
        optimizationId,
        expectedRevision,
        revisionSource: "alternative_regeneration",
        idempotencyKey,
      };
    }
    if (
      body.revisionSource === "test_failure" &&
      body.additionalFeedback === undefined
    ) {
      return {
        userId,
        optimizationId,
        expectedRevision,
        revisionSource: "test_failure",
        idempotencyKey,
      };
    }
    const additionalFeedback = requiredString(
      body.additionalFeedback,
      "additionalFeedback",
    ).trim();
    if (additionalFeedback.length > 1500) {
      throw new AnswerSkillOptimizationValidationError(
        "additionalFeedback must contain at most 1500 characters after trimming",
      );
    }
    if (!additionalFeedback) {
      if (body.revisionSource === "test_failure") {
        return {
          userId,
          optimizationId,
          expectedRevision,
          revisionSource: "test_failure",
          idempotencyKey,
        };
      }
      throw new AnswerSkillOptimizationValidationError(
        "additionalFeedback must contain 1 to 1500 characters after trimming",
      );
    }
    return {
      userId,
      optimizationId,
      expectedRevision,
      additionalFeedback,
      revisionSource: body.revisionSource,
      idempotencyKey,
    };
  }
  if (
    body.targetSkillId !== undefined &&
    body.targetSkillIds !== undefined
  ) {
    throw new AnswerSkillOptimizationValidationError(
      "targetSkillId and targetSkillIds cannot be provided at the same time",
    );
  }
  const targetSkillId =
    body.targetSkillId === undefined
      ? undefined
      : requiredString(body.targetSkillId, "targetSkillId");
  let targetSkillIds: string[] | undefined;
  if (body.targetSkillIds !== undefined) {
    if (!Array.isArray(body.targetSkillIds) || body.targetSkillIds.length === 0) {
      throw new AnswerSkillOptimizationValidationError(
        "targetSkillIds must be a non-empty array of strings",
      );
    }
    targetSkillIds = body.targetSkillIds.map((item, index) => {
      if (typeof item !== "string" || !item.trim()) {
        throw new AnswerSkillOptimizationValidationError(
          `targetSkillIds[${index}] must be a non-empty string`,
        );
      }
      return item.trim();
    });
    const seen = new Set<string>();
    for (const id of targetSkillIds) {
      if (seen.has(id)) {
        throw new AnswerSkillOptimizationValidationError(
          "targetSkillIds contains duplicate skillId",
        );
      }
      seen.add(id);
    }
  }
  return {
    userId,
    optimizationId,
    expectedRevision,
    feedback: requiredString(body.feedback, "feedback"),
    ...(targetSkillId === undefined ? {} : { targetSkillId }),
    ...(targetSkillIds === undefined ? {} : { targetSkillIds }),
    idempotencyKey,
  };
}

function parseCancelBody(
  value: unknown,
  userId: string,
  optimizationId: number,
  idempotencyKey: string,
): CancelAnswerSkillOptimizationInput {
  const body = asObject(value);
  assertOnlyKeys(body, ["expectedRevision", "reason"]);
  return {
    userId,
    optimizationId,
    expectedRevision: positiveInteger(
      body.expectedRevision,
      "expectedRevision",
    ),
    reason: requiredString(
      body.reason,
      "reason",
    ) as CancelAnswerSkillOptimizationInput["reason"],
    idempotencyKey,
  };
}

function parseTestBody(
  value: unknown,
  userId: string,
  optimizationId: number,
  idempotencyKey: string,
): TestAnswerSkillOptimizationInput {
  const body = asObject(value);
  assertOnlyKeys(body, ["expectedRevision"]);
  return {
    userId,
    optimizationId,
    expectedRevision: positiveInteger(
      body.expectedRevision,
      "expectedRevision",
    ),
    idempotencyKey,
  };
}

function parseConfirmBody(
  value: unknown,
  userId: string,
  optimizationId: number,
  idempotencyKey: string,
): ConfirmAnswerSkillOptimizationInput {
  const body = asObject(value);
  assertOnlyKeys(body, ["expectedRevision", "versionNote"]);
  const versionNote =
    body.versionNote === undefined
      ? undefined
      : requiredString(body.versionNote, "versionNote");
  return {
    userId,
    optimizationId,
    expectedRevision: positiveInteger(
      body.expectedRevision,
      "expectedRevision",
    ),
    ...(versionNote === undefined ? {} : { versionNote }),
    idempotencyKey,
  };
}

function requestId(): string {
  return getRequestId() ?? "";
}

function authenticatedUserId(req: Request): string {
  const userId = (req as AuthedRequest).userId;
  if (!userId) {
    throw new AnswerSkillOptimizationValidationError(
      "Authenticated user is unavailable",
    );
  }
  return userId;
}

function idempotencyKey(req: Request): string {
  const value = req.header("Idempotency-Key");
  if (!value || !UUID_PATTERN.test(value.trim())) {
    throw new AnswerSkillOptimizationValidationError(
      "Idempotency-Key header must be a UUID",
    );
  }
  return value;
}

function assertJsonRequest(req: Request): void {
  if (!req.is("application/json")) {
    throw new AnswerSkillOptimizationValidationError(
      "Content-Type must be application/json",
    );
  }
}

function sendError(res: Response, error: unknown): void {
  if (error instanceof AnswerSkillOptimizationAlreadyExistsError) {
    res.status(409).json({
      error: error.code,
      existingOptimizationId: error.existingOptimizationId,
      status: error.status,
      ...(error.code === "answer_already_optimized"
        ? {
            finalVersionId: error.finalVersionId,
            versionNumber: error.versionNumber,
          }
        : {}),
      requestId: requestId(),
    });
    return;
  }
  if (error instanceof AnswerSkillOptimizationReplayUnavailableError) {
    res.status(422).json({
      error: "replay_provenance_unavailable",
      reason: error.reason,
      requestId: requestId(),
    });
    return;
  }
  if (error instanceof AnswerSkillRefinementRejectedError) {
    res.status(422).json({
      error: error.failureCode,
      requestId: requestId(),
    });
    return;
  }
  if (error instanceof AnswerSkillRefinementTechnicalError) {
    const status =
      error.code === "model_unavailable"
        ? 503
        : error.code === "revision_conflict"
          ? 409
          : error.code === "unknown"
            ? 500
            : 422;
    res.status(status).json({
      error: "refinement_technical_failure",
      code: error.code,
      requestId: requestId(),
    });
    return;
  }
  let status = 500;
  let message = "Internal server error";
  if (error instanceof AnswerSkillOptimizationValidationError) {
    status = 400;
    message = error.message;
  } else if (error instanceof AnswerSkillOptimizationNotFoundError) {
    status = 404;
    message = error.message;
  } else if (error instanceof AnswerOptimizationSuggestionNotFoundError) {
    status = 404;
    message = error.message;
  } else if (error instanceof AnswerSkillOptimizationConflictError) {
    status = 409;
    message = error.message;
  } else if (error instanceof AnswerSkillOptimizationDraftError) {
    status = 422;
    message = "optimization_not_ready";
  } else if (error instanceof AnswerSkillOptimizationUpstreamError) {
    status = error.statusCode;
    message = "Optimization model is temporarily unavailable";
  } else {
    getLogger({ component: "answer-skill-optimization-route" }).error({
      event: "answer_optimization.request_failed",
      error: safeError(error),
    });
  }
  res.status(status).json({ error: message, requestId: requestId() });
}

router.post(
  ANSWER_SKILL_OPTIMIZATION_ROUTES.SUGGESTIONS,
  requireAuth,
  async (req, res) => {
    try {
      assertJsonRequest(req);
      const data = await suggestAnswerOptimizationFeedback(
        parseSuggestionsBody(req.body as unknown, authenticatedUserId(req)),
      );
      res.json({ data, requestId: requestId() });
    } catch (error) {
      sendError(res, error);
    }
  },
);

router.post(
  ANSWER_SKILL_OPTIMIZATION_ROUTES.RESOLVE,
  requireAuth,
  async (req, res) => {
    try {
      assertJsonRequest(req);
      const reference = await resolveAnswerSkillOptimizationReference(
        parseResolveBody(req.body as unknown, authenticatedUserId(req)),
      );
      const detail = reference
        ? await getAnswerSkillOptimizationDetail(
            authenticatedUserId(req),
            reference.optimizationId,
          )
        : null;
      res.json({
        data: {
          detail,
          versionNumber: reference?.versionNumber ?? null,
        },
        requestId: requestId(),
      });
    } catch (error) {
      sendError(res, error);
    }
  },
);

router.post(
  ANSWER_SKILL_OPTIMIZATION_ROUTES.CREATE,
  requireAuth,
  async (req, res) => {
    try {
      assertJsonRequest(req);
      const data = await createAnswerSkillOptimization(
        parseCreateBody(
          req.body as unknown,
          authenticatedUserId(req),
          idempotencyKey(req),
        ),
      );
      res.json({ data, requestId: requestId() });
    } catch (error) {
      sendError(res, error);
    }
  },
);

router.get(
  ANSWER_SKILL_OPTIMIZATION_ROUTES.DETAIL,
  requireAuth,
  async (req, res) => {
    try {
      const data = await getAnswerSkillOptimizationDetail(
        authenticatedUserId(req),
        positiveInteger(Number(req.params.optimizationId), "optimizationId"),
      );
      res.json({ data, requestId: requestId() });
    } catch (error) {
      sendError(res, error);
    }
  },
);

router.post(
  ANSWER_SKILL_OPTIMIZATION_ROUTES.REVISE,
  requireAuth,
  async (req, res) => {
    try {
      assertJsonRequest(req);
      const data = await reviseAnswerSkillOptimization(
        parseReviseBody(
          req.body as unknown,
          authenticatedUserId(req),
          positiveInteger(Number(req.params.optimizationId), "optimizationId"),
          idempotencyKey(req),
        ),
      );
      res.json({ data, requestId: requestId() });
    } catch (error) {
      sendError(res, error);
    }
  },
);

router.post(
  ANSWER_SKILL_OPTIMIZATION_ROUTES.TEST,
  requireAuth,
  async (req, res) => {
    try {
      assertJsonRequest(req);
      const data = await testAnswerSkillOptimization(
        parseTestBody(
          req.body as unknown,
          authenticatedUserId(req),
          positiveInteger(Number(req.params.optimizationId), "optimizationId"),
          idempotencyKey(req),
        ),
      );
      res.json({ data, requestId: requestId() });
    } catch (error) {
      sendError(res, error);
    }
  },
);

router.post(
  ANSWER_SKILL_OPTIMIZATION_ROUTES.REBASE,
  requireAuth,
  async (req, res) => {
    try {
      assertJsonRequest(req);
      const body = asObject(req.body);
      assertOnlyKeys(body, ["expectedRevision"]);
      const data = await rebaseAnswerSkillOptimization({
        userId: authenticatedUserId(req),
        optimizationId: positiveInteger(
          Number(req.params.optimizationId),
          "optimizationId",
        ),
        expectedRevision: positiveInteger(
          body.expectedRevision,
          "expectedRevision",
        ),
      });
      res.json({ data, requestId: requestId() });
    } catch (error) {
      sendError(res, error);
    }
  },
);

router.post(
  ANSWER_SKILL_OPTIMIZATION_ROUTES.CANCEL,
  requireAuth,
  async (req, res) => {
    try {
      assertJsonRequest(req);
      const data = await cancelAnswerSkillOptimization(
        parseCancelBody(
          req.body as unknown,
          authenticatedUserId(req),
          positiveInteger(Number(req.params.optimizationId), "optimizationId"),
          idempotencyKey(req),
        ),
      );
      res.json({ data, requestId: requestId() });
    } catch (error) {
      sendError(res, error);
    }
  },
);

router.post(
  ANSWER_SKILL_OPTIMIZATION_ROUTES.CONFIRM,
  requireAuth,
  async (req, res) => {
    try {
      assertJsonRequest(req);
      const data = await confirmAnswerSkillOptimization(
        parseConfirmBody(
          req.body as unknown,
          authenticatedUserId(req),
          positiveInteger(Number(req.params.optimizationId), "optimizationId"),
          idempotencyKey(req),
        ),
      );
      res.json({ data, requestId: requestId() });
    } catch (error) {
      sendError(res, error);
    }
  },
);

export default router;
