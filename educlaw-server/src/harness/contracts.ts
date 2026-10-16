export type HarnessRunStatus = "completed" | "failed" | "cancelled";

export type HarnessThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export type HarnessErrorCode =
  | "INVALID_REQUEST"
  | "SKILL_INVALID"
  | "MODEL_UNAVAILABLE"
  | "OUTPUT_TRUNCATED"
  | "EMPTY_RESPONSE"
  | "TOOL_DENIED"
  | "RUN_LIMIT_EXCEEDED"
  | "RUN_TIMEOUT"
  | "RUN_CANCELLED"
  | "RUN_FAILED";

export interface HarnessHistoryMessage {
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
}

export interface HarnessModelRequest {
  modelId: string;
  temperature?: number;
  maxOutputTokens?: number;
  thinkingLevel?: HarnessThinkingLevel;
}

export interface HarnessRunLimits {
  timeoutMs?: number;
  maxModelCalls?: number;
}

export interface HarnessRunRequest {
  runId: string;
  selectedSkill: {
    versionId: number;
    skillMd: string;
  };
  agentInstructions: string;
  history: readonly HarnessHistoryMessage[];
  currentInput: string;
  model: HarnessModelRequest;
  limits?: HarnessRunLimits;
  signal?: AbortSignal;
}

export interface HarnessRunError {
  code: HarnessErrorCode;
  retryable: boolean;
  userMessage: string;
}

export interface HarnessExecutionEvidence {
  skillInjected: boolean;
  historyMessageCount: number;
  /** Number of times Pi prepared a conversational model request, including a rejected over-budget attempt. */
  modelRequestAttemptCount: number;
  /** Number of model requests admitted by the Adapter budget and event boundary. */
  modelRequestCount: number;
  toolCallCount: number;
  toolNames: string[];
  eventTypes: string[];
  eventDeliveryFailureCount: number;
  outputChars: number;
  durationMs: number;
  cleanupCompleted: boolean;
}

export interface HarnessResult {
  runId: string;
  status: HarnessRunStatus;
  text: string;
  requestedModelId: string;
  /** Internal Pi provider registry identifier; it is not an asserted upstream vendor identity. */
  providerRegistryId: string | null;
  responseModelId: string | null;
  selectedSkillVersionId: number;
  error: HarnessRunError | null;
  evidence: HarnessExecutionEvidence;
}

export type HarnessEvent =
  | {
      type: "run_started";
      runId: string;
      requestedModelId: string;
      selectedSkillVersionId: number;
    }
  | {
      type: "model_request_started";
      runId: string;
      requestNumber: number;
    }
  | {
      type: "tool_started";
      runId: string;
      toolName: string;
    }
  | {
      type: "tool_finished";
      runId: string;
      toolName: string;
      ok: boolean;
    }
  | {
      type: "text_delta";
      runId: string;
      delta: string;
    }
  | {
      type: "run_finished";
      runId: string;
      status: HarnessRunStatus;
      errorCode: HarnessErrorCode | null;
      outputChars: number;
    };

export type HarnessEventEmitter = (
  event: HarnessEvent,
) => void | Promise<void>;
