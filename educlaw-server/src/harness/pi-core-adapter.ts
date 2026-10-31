import {
  Agent,
  type AgentEvent,
  type AgentMessage,
  type AgentOptions,
} from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Message, Usage } from "@earendil-works/pi-ai";
import type { Logger } from "pino";
import { getLogger } from "../lib/request-context.js";
import { supportsModelExplicitThinking } from "../lib/llm-model-capabilities.js";
import type {
  HarnessErrorCode,
  HarnessEvent,
  HarnessEventEmitter,
  HarnessExecutionEvidence,
  HarnessHistoryMessage,
  HarnessResult,
  HarnessRunError,
  HarnessRunRequest,
  HarnessRunStatus,
} from "./contracts.js";
import {
  createPiProviderRuntime,
  PiProviderConfigurationError,
  type PiProviderRuntime,
} from "./pi-provider-runtime.js";

const DEFAULT_MAX_MODEL_CALLS = 8;
export const DEFAULT_PI_RUN_TIMEOUT_MS = 180_000;
const MAX_RECORDED_EVENTS = 200;
const MAX_RECORDED_TOOL_NAMES = 16;
const ZERO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

type AbortCause = "external" | "timeout" | null;

export interface PiAgentHandle {
  readonly state: {
    messages: AgentMessage[];
    isStreaming: boolean;
  };
  readonly signal: AbortSignal | undefined;
  subscribe(
    listener: (event: AgentEvent, signal: AbortSignal) => void | Promise<void>,
  ): () => void;
  prompt(input: string): Promise<void>;
  waitForIdle(): Promise<void>;
  abort(): void;
}

export interface PiCoreAdapterDependencies {
  createAgent(options: AgentOptions): PiAgentHandle;
  createProviderRuntime(request: HarnessRunRequest["model"]): PiProviderRuntime;
  getLogger(bindings: Record<string, unknown>): Logger;
  now(): number;
}

interface MutableRunState {
  abortCause: AbortCause;
  agent: PiAgentHandle | null;
  cleanupCompleted: boolean;
  eventDeliveryFailureCount: number;
  eventDeliveryFailed: boolean;
  limitExceeded: boolean;
  modelRequestAttemptCount: number;
  modelRequestCount: number;
  skillInjected: boolean;
  terminalOutcome: RunOutcome | null;
  terminalEmitted: boolean;
  toolCallCount: number;
  toolNames: Set<string>;
  eventTypes: string[];
}

interface RunOutcome {
  status: HarnessRunStatus;
  text: string;
  providerRegistryId: string | null;
  responseModelId: string | null;
  error: HarnessRunError | null;
}

class HarnessEventDeliveryError extends Error {
  constructor(readonly eventType: HarnessEvent["type"]) {
    super(`Harness event delivery failed: ${eventType}`);
    this.name = "HarnessEventDeliveryError";
  }
}

function runError(
  code: HarnessErrorCode,
  userMessage: string,
  retryable = false,
): HarnessRunError {
  return { code, retryable, userMessage };
}

function failedOutcome(error: HarnessRunError): RunOutcome {
  return {
    status: error.code === "RUN_CANCELLED" ? "cancelled" : "failed",
    text: "",
    providerRegistryId: null,
    responseModelId: null,
    error,
  };
}

function failedMessageOutcome(
  error: HarnessRunError,
  message: AssistantMessage | undefined,
  runtime: PiProviderRuntime,
): RunOutcome {
  return {
    ...failedOutcome(error),
    providerRegistryId: message?.provider ?? runtime.providerRegistryId,
    responseModelId: message?.responseModel ?? message?.model ?? null,
  };
}

function validateRequest(request: HarnessRunRequest): HarnessRunError | null {
  if (!request.runId.trim() || !request.currentInput.trim()) {
    return runError("INVALID_REQUEST", "运行标识和用户问题不能为空。");
  }
  if (!Number.isSafeInteger(request.selectedSkill.versionId) || request.selectedSkill.versionId < 1) {
    return runError("INVALID_REQUEST", "Skill 版本标识无效。");
  }
  if (!request.selectedSkill.skillMd.trim()) {
    return runError("SKILL_INVALID", "当前 Skill 版本没有可执行的规则正文。");
  }
  if (!request.agentInstructions.trim() || !request.model.modelId.trim()) {
    return runError("INVALID_REQUEST", "Agent 指令或模型配置无效。");
  }
  if (request.history.some((message) => !message.content.trim())) {
    return runError("INVALID_REQUEST", "历史消息包含空正文。");
  }
  const timeoutMs = request.limits?.timeoutMs;
  const maxModelCalls = request.limits?.maxModelCalls;
  if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)) {
    return runError("INVALID_REQUEST", "运行超时配置无效。");
  }
  if (maxModelCalls !== undefined && (!Number.isSafeInteger(maxModelCalls) || maxModelCalls < 1)) {
    return runError("INVALID_REQUEST", "模型调用预算无效。");
  }
  const maxOutputTokens = request.model.maxOutputTokens;
  if (maxOutputTokens !== undefined && (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1)) {
    return runError("INVALID_REQUEST", "模型输出长度配置无效。");
  }
  const temperature = request.model.temperature;
  if (temperature !== undefined && (!Number.isFinite(temperature) || temperature < 0 || temperature > 2)) {
    return runError("INVALID_REQUEST", "模型温度配置无效。");
  }
  return null;
}

export function buildPiSystemPrompt(request: HarnessRunRequest): string {
  return [
    "# EduSkill Agent Instructions",
    request.agentInstructions.trim(),
    "",
    `# Fixed Skill Version ${request.selectedSkill.versionId}`,
    "The following Skill is fixed for this run. Follow it as behavioral instructions.",
    "Do not claim access to tools or resources that are not explicitly registered.",
    "",
    "<skill-md>",
    request.selectedSkill.skillMd.trim(),
    "</skill-md>",
  ].join("\n");
}

function messageTimestamp(message: HarnessHistoryMessage, fallback: number): number {
  if (!message.createdAt) return fallback;
  const parsed = Date.parse(message.createdAt);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toPiHistory(
  history: readonly HarnessHistoryMessage[],
  runtime: PiProviderRuntime,
  now: number,
): Message[] {
  return history.map((message, index) => {
    const timestamp = messageTimestamp(message, now - (history.length - index) * 1000);
    if (message.role === "user") {
      return { role: "user", content: message.content, timestamp };
    }
    return {
      role: "assistant",
      content: [{ type: "text", text: message.content }],
      api: "openai-completions",
      provider: runtime.providerRegistryId,
      model: runtime.requestedModelId,
      usage: ZERO_USAGE,
      stopReason: "stop",
      timestamp,
    };
  });
}

function finalAssistant(messages: AgentMessage[]): AssistantMessage | undefined {
  return [...messages].reverse().find(
    (message): message is AssistantMessage => message.role === "assistant",
  );
}

function assistantText(message: AssistantMessage | undefined): string {
  return message?.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("") ?? "";
}

type ProviderFailureCategory =
  | "missing_response"
  | "rate_limited"
  | "provider_timeout"
  | "provider_conflict"
  | "provider_5xx"
  | "transport_or_stream"
  | "provider_error";

function safeProviderFailureMetadata(message: AssistantMessage | undefined): {
  modelStopReason: AssistantMessage["stopReason"] | "missing";
  providerStatus: number | null;
  providerFailureCategory: ProviderFailureCategory;
} {
  if (!message) {
    return {
      modelStopReason: "missing",
      providerStatus: null,
      providerFailureCategory: "missing_response",
    };
  }

  // The provider message may contain response bodies, so never log it. Only
  // derive a small allow-listed diagnostic classification from the text.
  const detail = message.errorMessage || "";
  const statusMatch = detail.match(/\b(408|409|429|5\d{2})\b/u);
  const providerStatus = statusMatch ? Number(statusMatch[1]) : null;
  let providerFailureCategory: ProviderFailureCategory = "provider_error";
  if (providerStatus === 429) providerFailureCategory = "rate_limited";
  else if (providerStatus === 408 || /tim(?:e|ed)\s*out/iu.test(detail)) {
    providerFailureCategory = "provider_timeout";
  } else if (providerStatus === 409) providerFailureCategory = "provider_conflict";
  else if (providerStatus !== null && providerStatus >= 500) {
    providerFailureCategory = "provider_5xx";
  } else if (/network|fetch|socket|econn|stream ended|connection/iu.test(detail)) {
    providerFailureCategory = "transport_or_stream";
  }
  return {
    modelStopReason: message.stopReason,
    providerStatus,
    providerFailureCategory,
  };
}

function createRunState(): MutableRunState {
  return {
    abortCause: null,
    agent: null,
    cleanupCompleted: true,
    eventDeliveryFailureCount: 0,
    eventDeliveryFailed: false,
    limitExceeded: false,
    modelRequestAttemptCount: 0,
    modelRequestCount: 0,
    skillInjected: false,
    terminalOutcome: null,
    terminalEmitted: false,
    toolCallCount: 0,
    toolNames: new Set<string>(),
    eventTypes: [],
  };
}

async function emitRequiredEvent(
  event: HarnessEvent,
  state: MutableRunState,
  emit: HarnessEventEmitter,
  logger: Logger,
): Promise<void> {
  try {
    await emit(event);
  } catch {
    state.eventDeliveryFailed = true;
    state.eventDeliveryFailureCount += 1;
    logger.warn({
      event: "pi_harness.event_delivery_failed",
      eventType: event.type,
    });
    throw new HarnessEventDeliveryError(event.type);
  }
}

function recordAgentEvent(state: MutableRunState, event: AgentEvent): void {
  if (state.eventTypes.length < MAX_RECORDED_EVENTS) {
    state.eventTypes.push(event.type);
  }
  if (event.type === "tool_execution_start") {
    state.toolCallCount += 1;
    if (state.toolNames.size < MAX_RECORDED_TOOL_NAMES) {
      state.toolNames.add(event.toolName);
    }
  }
}

async function handleAgentEvent(
  request: HarnessRunRequest,
  state: MutableRunState,
  event: AgentEvent,
  emit: HarnessEventEmitter,
  logger: Logger,
): Promise<void> {
  recordAgentEvent(state, event);
  if (state.abortCause !== null || request.signal?.aborted || state.terminalOutcome) return;
  if (
    event.type === "message_update"
    && event.assistantMessageEvent.type === "thinking_delta"
    && supportsModelExplicitThinking(request.model.modelId)
    && request.model.thinkingLevel !== undefined
    && request.model.thinkingLevel !== "off"
  ) {
    await emitRequiredEvent({
      type: "reasoning_delta",
      runId: request.runId,
      delta: event.assistantMessageEvent.delta,
    }, state, emit, logger);
  }
  if (event.type === "tool_execution_start") {
    logger.warn({ event: "pi_harness.tool.started", toolName: event.toolName });
    await emitRequiredEvent(
      { type: "tool_started", runId: request.runId, toolName: event.toolName },
      state,
      emit,
      logger,
    );
  }
  if (event.type === "tool_execution_end") {
    logger.info({ event: "pi_harness.tool.finished", toolName: event.toolName, ok: !event.isError });
    await emitRequiredEvent(
      {
        type: "tool_finished",
        runId: request.runId,
        toolName: event.toolName,
        ok: !event.isError,
      },
      state,
      emit,
      logger,
    );
  }
}

function classifyFinalMessage(
  message: AssistantMessage | undefined,
  state: MutableRunState,
  runtime: PiProviderRuntime,
): RunOutcome {
  if (state.abortCause === "timeout") {
    return failedMessageOutcome(
      runError("RUN_TIMEOUT", "本次运行超时，请重试。", true),
      message,
      runtime,
    );
  }
  if (state.abortCause === "external" || message?.stopReason === "aborted") {
    return failedMessageOutcome(
      runError("RUN_CANCELLED", "本次运行已取消。", true),
      message,
      runtime,
    );
  }
  if (state.limitExceeded) {
    return failedMessageOutcome(
      runError("RUN_LIMIT_EXCEEDED", "本次运行超过模型调用限制。", true),
      message,
      runtime,
    );
  }
  if (state.eventDeliveryFailed) {
    return failedMessageOutcome(
      runError("RUN_FAILED", "运行事件未能安全送达，请重试。", true),
      message,
      runtime,
    );
  }
  if (state.toolCallCount > 0) {
    return failedMessageOutcome(
      runError("TOOL_DENIED", "模型尝试使用本阶段未授权的工具。"),
      message,
      runtime,
    );
  }
  if (!message) {
    return failedMessageOutcome(
      runError("MODEL_UNAVAILABLE", "模型服务暂时不可用，请稍后重试。", true),
      message,
      runtime,
    );
  }
  switch (message.stopReason) {
    case "stop":
      break;
    case "length":
      return failedMessageOutcome(
        runError("OUTPUT_TRUNCATED", "模型输出达到长度限制，请缩小任务后重试。", true),
        message,
        runtime,
      );
    case "toolUse":
      return failedMessageOutcome(
        runError("TOOL_DENIED", "模型尝试使用本阶段未授权的工具。"),
        message,
        runtime,
      );
    case "error":
    case "deferred":
      return failedMessageOutcome(
        runError("MODEL_UNAVAILABLE", "模型服务暂时不可用，请稍后重试。", true),
        message,
        runtime,
      );
    case "pending":
      return failedMessageOutcome(
        runError("RUN_FAILED", "模型运行未产生明确终态，请重试。", true),
        message,
        runtime,
      );
    default:
      return failedMessageOutcome(
        runError("RUN_FAILED", "模型返回了无法识别的结束状态，请重试。", true),
        message,
        runtime,
      );
  }
  const text = assistantText(message).trim();
  if (!text) {
    return failedMessageOutcome(
      runError("EMPTY_RESPONSE", "模型没有返回有效正文，请重试。", true),
      message,
      runtime,
    );
  }
  return {
    status: "completed",
    text,
    providerRegistryId: message.provider || runtime.providerRegistryId,
    responseModelId: message.responseModel ?? message.model ?? runtime.requestedModelId,
    error: null,
  };
}

function unexpectedFailure(state: MutableRunState, error: unknown): RunOutcome {
  if (state.abortCause === "timeout") {
    return failedOutcome(runError("RUN_TIMEOUT", "本次运行超时，请重试。", true));
  }
  if (state.abortCause === "external") {
    return failedOutcome(runError("RUN_CANCELLED", "本次运行已取消。", true));
  }
  if (state.limitExceeded) {
    return failedOutcome(runError("RUN_LIMIT_EXCEEDED", "本次运行超过模型调用限制。", true));
  }
  if (error instanceof HarnessEventDeliveryError || state.eventDeliveryFailed) {
    return failedOutcome(runError("RUN_FAILED", "运行事件未能安全送达，请重试。", true));
  }
  if (error instanceof PiProviderConfigurationError) {
    return failedOutcome(runError("MODEL_UNAVAILABLE", "模型服务尚未正确配置。"));
  }
  return failedOutcome(runError("RUN_FAILED", "本次运行未能完成，请重试。", true));
}

function buildEvidence(
  request: HarnessRunRequest,
  state: MutableRunState,
  outcome: RunOutcome,
  durationMs: number,
): HarnessExecutionEvidence {
  return {
    skillInjected: state.skillInjected,
    historyMessageCount: request.history.length,
    modelRequestAttemptCount: state.modelRequestAttemptCount,
    modelRequestCount: state.modelRequestCount,
    toolCallCount: state.toolCallCount,
    toolNames: [...state.toolNames],
    eventTypes: [...state.eventTypes],
    eventDeliveryFailureCount: state.eventDeliveryFailureCount,
    outputChars: outcome.text.length,
    durationMs,
    cleanupCompleted: state.cleanupCompleted,
  };
}

function buildResult(
  request: HarnessRunRequest,
  state: MutableRunState,
  outcome: RunOutcome,
  durationMs: number,
): HarnessResult {
  return {
    runId: request.runId,
    status: outcome.status,
    text: outcome.text,
    requestedModelId: request.model.modelId,
    providerRegistryId: outcome.providerRegistryId,
    responseModelId: outcome.responseModelId,
    selectedSkillVersionId: request.selectedSkill.versionId,
    error: outcome.error,
    evidence: buildEvidence(request, state, outcome, durationMs),
  };
}

async function emitTerminalOnce(
  result: HarnessResult,
  state: MutableRunState,
  emit: HarnessEventEmitter,
  logger: Logger,
): Promise<void> {
  if (state.terminalEmitted) return;
  state.terminalEmitted = true;
  const event: HarnessEvent = {
    type: "run_finished",
    runId: result.runId,
    status: result.status,
    errorCode: result.error?.code ?? null,
    outputChars: result.text.length,
  };
  try {
    await emit(event);
  } catch {
    state.eventDeliveryFailureCount += 1;
    logger.warn({ event: "pi_harness.terminal_event_delivery_failed" });
  }
}

function lockTerminalOutcome(
  request: HarnessRunRequest,
  state: MutableRunState,
  outcome: RunOutcome,
): RunOutcome {
  if (state.terminalOutcome) return state.terminalOutcome;
  const externalCancellationWon = outcome.status === "completed"
    && (state.abortCause === "external" || request.signal?.aborted === true);
  state.terminalOutcome = externalCancellationWon
    ? failedOutcome(runError("RUN_CANCELLED", "本次运行已取消。", true))
    : outcome;
  return state.terminalOutcome;
}

async function executeAgentRun(
  request: HarnessRunRequest,
  state: MutableRunState,
  emit: HarnessEventEmitter,
  logger: Logger,
  dependencies: PiCoreAdapterDependencies,
): Promise<RunOutcome> {
  const runtime = dependencies.createProviderRuntime(request.model);
  const maxModelCalls = request.limits?.maxModelCalls ?? DEFAULT_MAX_MODEL_CALLS;
  const agent = dependencies.createAgent({
    initialState: {
      systemPrompt: buildPiSystemPrompt(request),
      messages: toPiHistory(request.history, runtime, dependencies.now()),
      model: runtime.model,
      thinkingLevel: request.model.thinkingLevel ?? "off",
      tools: [],
    },
    streamFn: runtime.streamFn,
    sessionId: request.runId,
    toolExecution: "sequential",
    prepareRequest: async () => {
      state.modelRequestAttemptCount += 1;
      if (state.modelRequestAttemptCount > maxModelCalls) {
        state.limitExceeded = true;
        throw new Error("Pi model call budget exceeded");
      }
      const requestNumber = state.modelRequestCount + 1;
      await emitRequiredEvent({
        type: "model_request_started",
        runId: request.runId,
        requestNumber,
      }, state, emit, logger);
      state.modelRequestCount = requestNumber;
      logger.info({ event: "pi_harness.model_request.started", requestNumber });
    },
  });
  state.agent = agent;
  state.skillInjected = true;
  logger.info({ event: "pi_harness.agent.created", toolCount: 0 });
  const messageCountBeforePrompt = agent.state.messages.length;
  const unsubscribe = agent.subscribe((event) => handleAgentEvent(request, state, event, emit, logger));
  const abort = (cause: Exclude<AbortCause, null>) => {
    if (state.abortCause !== null) return;
    state.abortCause = cause;
    agent.abort();
  };
  const externalAbort = () => abort("external");
  request.signal?.addEventListener("abort", externalAbort, { once: true });
  const timeout = setTimeout(
    () => abort("timeout"),
    request.limits?.timeoutMs ?? DEFAULT_PI_RUN_TIMEOUT_MS,
  );
  try {
    if (request.signal?.aborted) abort("external");
    await agent.prompt(request.currentInput);
    await agent.waitForIdle();
    const currentRunMessages = agent.state.messages.slice(messageCountBeforePrompt);
    const finalMessage = finalAssistant(currentRunMessages);
    const outcome = classifyFinalMessage(finalMessage, state, runtime);
    if (outcome.error?.code === "MODEL_UNAVAILABLE") {
      logger.warn({
        event: "pi_harness.model_unavailable",
        ...safeProviderFailureMetadata(finalMessage),
      });
    }
    return outcome;
  } finally {
    clearTimeout(timeout);
    request.signal?.removeEventListener("abort", externalAbort);
    unsubscribe();
    state.cleanupCompleted = !agent.state.isStreaming && agent.signal === undefined;
  }
}

async function runWithDependencies(
  request: HarnessRunRequest,
  emit: HarnessEventEmitter,
  dependencies: PiCoreAdapterDependencies,
): Promise<HarnessResult> {
  const startedAt = dependencies.now();
  const state = createRunState();
  const logger = dependencies.getLogger({ component: "pi-harness", runId: request.runId });
  let outcome: RunOutcome;
  logger.info({
    event: "pi_harness.run.started",
    requestedModelId: request.model.modelId,
    selectedSkillVersionId: request.selectedSkill.versionId,
  });
  try {
    await emitRequiredEvent({
      type: "run_started",
      runId: request.runId,
      requestedModelId: request.model.modelId,
      selectedSkillVersionId: request.selectedSkill.versionId,
    }, state, emit, logger);
    const validationError = validateRequest(request);
    if (validationError) {
      outcome = failedOutcome(validationError);
    } else if (request.signal?.aborted) {
      state.abortCause = "external";
      outcome = failedOutcome(runError("RUN_CANCELLED", "本次运行已取消。", true));
    } else {
      outcome = await executeAgentRun(request, state, emit, logger, dependencies);
    }
  } catch (error) {
    state.agent?.abort();
    await state.agent?.waitForIdle().catch(() => undefined);
    outcome = unexpectedFailure(state, error);
  }
  state.cleanupCompleted = state.agent
    ? !state.agent.state.isStreaming && state.agent.signal === undefined
    : true;
  if (outcome.status === "completed" && !request.signal?.aborted && state.abortCause === null) {
    try {
      await emitRequiredEvent(
        { type: "text_delta", runId: request.runId, delta: outcome.text },
        state,
        emit,
        logger,
      );
    } catch (error) {
      outcome = unexpectedFailure(state, error);
    }
  }
  outcome = lockTerminalOutcome(request, state, outcome);
  const durationMs = dependencies.now() - startedAt;
  let result = buildResult(request, state, outcome, durationMs);
  await emitTerminalOnce(result, state, emit, logger);
  result = buildResult(request, state, outcome, durationMs);
  logger[result.status === "completed" ? "info" : result.status === "cancelled" ? "warn" : "error"]({
    event: "pi_harness.run.finished",
    status: result.status,
    errorCode: result.error?.code ?? null,
    durationMs: result.evidence.durationMs,
    outputChars: result.evidence.outputChars,
    modelRequestCount: result.evidence.modelRequestCount,
    toolCallCount: result.evidence.toolCallCount,
    cleanupCompleted: result.evidence.cleanupCompleted,
  });
  return result;
}

const defaultDependencies: PiCoreAdapterDependencies = {
  createAgent: (options) => new Agent(options),
  createProviderRuntime: createPiProviderRuntime,
  getLogger,
  now: Date.now,
};

export function createPiCoreAdapter(
  dependencies: PiCoreAdapterDependencies = defaultDependencies,
): (request: HarnessRunRequest, emit: HarnessEventEmitter) => Promise<HarnessResult> {
  return (request, emit) => runWithDependencies(request, emit, dependencies);
}

export async function runPiAgent(
  request: HarnessRunRequest,
  emit: HarnessEventEmitter,
): Promise<HarnessResult> {
  return runWithDependencies(request, emit, defaultDependencies);
}
