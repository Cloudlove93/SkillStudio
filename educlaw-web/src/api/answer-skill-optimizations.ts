import type {
  AnswerOptimizationSuggestionsRequest,
  AnswerOptimizationSuggestionsResult,
  ArenaAnswerOptimizationStatus,
  ArenaAnswerOptimizationUnavailableReason,
} from '@educlaw/shared';
import { ANSWER_SKILL_OPTIMIZATION_ROUTES } from '@educlaw/shared';
import { apiFetch } from './client';

export interface AnswerOptimizationDiagnosis {
  summary: string;
  reusability: 'reusable' | 'single_turn' | 'unclear';
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
  selectionSource: 'recorded' | 'user_selected';
}

export interface AnswerOptimizationPatch {
  section:
    | 'Instructions'
    | 'Workflow'
    | 'Output Format'
    | 'Examples'
    | 'Common Issues';
  operation: 'replace' | 'append' | 'add_section';
  reason: string;
  proposedContent: string;
}

export type AnswerOptimizationPlannedTargetStatus =
  | 'pending'
  | 'active'
  | 'completed'
  | 'failed';

export interface AnswerOptimizationPlannedTarget {
  skillId: string;
  name: string;
  status: AnswerOptimizationPlannedTargetStatus;
  patch: AnswerOptimizationPatch | null;
  failureCode?: string;
  failureMessage?: string;
  confirmedVersionId?: number;
  confirmedVersionNumber?: number;
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
  qualityGate: {
    passed: boolean;
    passedCount: number;
    sampleCount: 3;
    bestSampleIndex: number;
    overallSummary: string;
  };
  runtimeSelectionCheck: {
    targetSkillId: string;
    selectedSkillIds: string[];
    targetSkillSelected: boolean;
  };
  createdAt: string;
}

export interface AnswerSkillRefinementQualityEvidence {
  testedRevision: number;
  overallSummary: string;
  failedSamples: Array<{
    sampleIndex: number;
    unmetRequirements: string[];
    riskNotes: string[];
    criticalRisk: boolean;
  }>;
  runtimeSelectionPassed: boolean;
}

export type AnswerSkillRefinementTechnicalFailureCode =
  | 'model_unavailable'
  | 'invalid_model_output'
  | 'patch_application_failed'
  | 'skill_validation_failed'
  | 'revision_conflict'
  | 'unknown';

export type AnswerSkillRefinementOutcome =
  | {
      kind: 'applied';
      assistantSummary: string;
    }
  | {
      kind: 'needs_clarification';
      message: string;
      clarificationQuestion: string;
      suggestedFeedback: string[];
    }
  | {
      kind: 'not_suitable_for_shared_rule';
      message: string;
      suggestedReusableFeedback: string | null;
    }
  | {
      kind: 'technical_failure';
      code: AnswerSkillRefinementTechnicalFailureCode;
      userMessage: string;
    };

export interface AnswerSkillRefinementTurn {
  id: string;
  source: 'draft_review' | 'test_failure' | 'alternative_regeneration';
  fromRevision: number;
  toRevision: number | null;
  userMessage: string;
  status: 'pending' | 'succeeded' | 'failed';
  createdAt: string;
  completedAt: string | null;
  assistantSummary: string | null;
  qualityEvidence: AnswerSkillRefinementQualityEvidence | null;
  outcome: AnswerSkillRefinementOutcome | null;
}

export type AnswerOptimizationFailureCode =
  | 'feedback_not_reusable'
  | 'feedback_unclear'
  | 'model_output_invalid'
  | 'model_unavailable'
  | 'skill_validation_failed'
  | 'context_invalid'
  | 'replay_context_unavailable'
  | 'replay_model_unavailable'
  | 'operation_interrupted';

export interface AnswerSkillOptimizationDetail {
  optimizationId: number;
  packageId: number;
  threadId: number;
  baseVersionId: number;
  evidenceVersionId: number;
  answerSide: 'baseline' | 'enhanced';
  answerMessageId: number;
  answerSkillVersionId: number | null;
  workingSkillVersionId: number | null;
  status: ArenaAnswerOptimizationStatus;
  revision: number;
  feedback: string;
  question: { messageId: number; content: string };
  originalAnswer: { messageId: number; content: string };
  baselineAnswer: { messageId: number; content: string } | null;
  diagnosis: AnswerOptimizationDiagnosis | null;
  targetSkill: AnswerOptimizationTargetSkill | null;
  candidateSkills: AnswerOptimizationCandidateSkill[];
  patch: AnswerOptimizationPatch | null;
  draft: {
    skillId: string;
    validation: { valid: boolean; errors: string[] };
    previewContent: string;
  } | null;
  diff: { before: string; after: string } | null;
  testResult: AnswerOptimizationTestResult | null;
  refinementHistory: AnswerSkillRefinementTurn[];
  failureCode: AnswerOptimizationFailureCode | null;
  finalVersionId: number | null;
  plannedTargets: AnswerOptimizationPlannedTarget[];
  replayAvailability: {
    available: boolean;
    reason: ArenaAnswerOptimizationUnavailableReason | null;
  };
  createdAt: string;
  updatedAt: string;
}

export interface CreateAnswerOptimizationInput {
  packageId: number;
  threadId: number;
  questionMessageId: number;
  enhancedAnswerMessageId: number;
  baselineAnswerMessageId: number | null;
  answerSide?: 'baseline' | 'enhanced';
  answerMessageId?: number;
  feedback: string;
}

export interface ResolveAnswerOptimizationInput {
  packageId: number;
  threadId: number;
  questionMessageId: number;
  answerMessageId: number;
  answerSide: 'baseline' | 'enhanced';
}

export interface ResolveAnswerOptimizationResult {
  detail: AnswerSkillOptimizationDetail | null;
  versionNumber: number | null;
}

export type ReviseAnswerOptimizationResult = AnswerSkillOptimizationDetail;

export interface ConfirmAnswerOptimizationResult {
  optimizationId: number;
  status: 'completed' | 'draft_ready';
  baseVersionId: number;
  finalVersionId: number;
  versionNumber: number;
  skillVersionNumber: number;
  source: 'interactive';
  completedAt: string;
  advancedToNextTarget?: boolean;
}

export interface CancelAnswerOptimizationResult {
  optimizationId: number;
  status: 'cancelled';
  revision: number;
  reason: 'user_cancelled' | 'no_longer_needed' | 'restart_required';
  cancelledAt: string;
}

interface ApiEnvelope<T> {
  data: T;
  requestId: string;
}

export interface AnswerOptimizationErrorPayload {
  error?: string;
  requestId?: string;
  existingOptimizationId?: number;
  status?: ArenaAnswerOptimizationStatus;
  finalVersionId?: number | null;
  versionNumber?: number | null;
  reason?: ArenaAnswerOptimizationUnavailableReason;
  code?: AnswerSkillRefinementTechnicalFailureCode;
}

export class AnswerOptimizationApiError extends Error {
  readonly statusCode: number;
  readonly requestId: string | null;
  readonly payload: AnswerOptimizationErrorPayload;

  constructor(statusCode: number, payload: AnswerOptimizationErrorPayload) {
    super(payload.error || `HTTP ${statusCode}`);
    this.name = 'AnswerOptimizationApiError';
    this.statusCode = statusCode;
    this.requestId = payload.requestId || null;
    this.payload = payload;
  }
}

function optimizationPath(
  template: string,
  optimizationId: number,
): string {
  return template.replace(':optimizationId', String(optimizationId));
}

async function request<T>(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<ApiEnvelope<T>> {
  const response = await apiFetch(`/api${path}`, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });
  const payload = (await response.json().catch(() => null)) as
    | ApiEnvelope<T>
    | AnswerOptimizationErrorPayload
    | null;
  if (!response.ok) {
    throw new AnswerOptimizationApiError(
      response.status,
      payload && typeof payload === 'object'
        ? (payload as AnswerOptimizationErrorPayload)
        : {},
    );
  }
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('data' in payload) ||
    !('requestId' in payload)
  ) {
    throw new AnswerOptimizationApiError(500, {
      error: '优化服务返回了无法识别的数据',
    });
  }
  return payload as ApiEnvelope<T>;
}

function post<T>(
  token: string,
  path: string,
  body: object,
  idempotencyKey: string,
): Promise<ApiEnvelope<T>> {
  return request<T>(token, path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(body),
  });
}

export const answerSkillOptimizationApi = {
  resolve(token: string, input: ResolveAnswerOptimizationInput) {
    return request<ResolveAnswerOptimizationResult>(
      token,
      ANSWER_SKILL_OPTIMIZATION_ROUTES.RESOLVE,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    );
  },
  suggestions(
    token: string,
    input: AnswerOptimizationSuggestionsRequest,
  ) {
    return request<AnswerOptimizationSuggestionsResult>(
      token,
      ANSWER_SKILL_OPTIMIZATION_ROUTES.SUGGESTIONS,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    );
  },
  create(
    token: string,
    input: CreateAnswerOptimizationInput,
    idempotencyKey: string,
  ) {
    return post<AnswerSkillOptimizationDetail>(
      token,
      ANSWER_SKILL_OPTIMIZATION_ROUTES.CREATE,
      input,
      idempotencyKey,
    );
  },
  get(token: string, optimizationId: number) {
    return request<AnswerSkillOptimizationDetail>(
      token,
      optimizationPath(
        ANSWER_SKILL_OPTIMIZATION_ROUTES.DETAIL,
        optimizationId,
      ),
    );
  },
  revise(
    token: string,
    optimizationId: number,
    input:
      | {
          expectedRevision: number;
          feedback: string;
          targetSkillId?: string;
          targetSkillIds?: string[];
        }
      | {
          expectedRevision: number;
          additionalFeedback: string;
          revisionSource: 'draft_review';
        }
      | {
          expectedRevision: number;
          additionalFeedback?: string;
          revisionSource: 'test_failure';
        }
      | {
          expectedRevision: number;
          revisionSource: 'alternative_regeneration';
        },
    idempotencyKey: string,
  ) {
    return post<ReviseAnswerOptimizationResult>(
      token,
      optimizationPath(
        ANSWER_SKILL_OPTIMIZATION_ROUTES.REVISE,
        optimizationId,
      ),
      input,
      idempotencyKey,
    );
  },
  test(
    token: string,
    optimizationId: number,
    expectedRevision: number,
    idempotencyKey: string,
  ) {
    return post<{
      optimizationId: number;
      status: 'test_ready';
      revision: number;
      testResult: AnswerOptimizationTestResult;
      updatedAt: string;
    }>(
      token,
      optimizationPath(
        ANSWER_SKILL_OPTIMIZATION_ROUTES.TEST,
        optimizationId,
      ),
      { expectedRevision },
      idempotencyKey,
    );
  },
  rebase(
    token: string,
    optimizationId: number,
    expectedRevision: number,
  ) {
    return request<AnswerSkillOptimizationDetail>(
      token,
      optimizationPath(
        ANSWER_SKILL_OPTIMIZATION_ROUTES.REBASE,
        optimizationId,
      ),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision }),
      },
    );
  },
  confirm(
    token: string,
    optimizationId: number,
    input: { expectedRevision: number; versionNote?: string },
    idempotencyKey: string,
  ) {
    return post<ConfirmAnswerOptimizationResult>(
      token,
      optimizationPath(
        ANSWER_SKILL_OPTIMIZATION_ROUTES.CONFIRM,
        optimizationId,
      ),
      input,
      idempotencyKey,
    );
  },
  cancel(
    token: string,
    optimizationId: number,
    input: {
      expectedRevision: number;
      reason: CancelAnswerOptimizationResult['reason'];
    },
    idempotencyKey: string,
  ) {
    return post<CancelAnswerOptimizationResult>(
      token,
      optimizationPath(
        ANSWER_SKILL_OPTIMIZATION_ROUTES.CANCEL,
        optimizationId,
      ),
      input,
      idempotencyKey,
    );
  },
};
