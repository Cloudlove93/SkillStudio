import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Agent, type AgentEvent, type AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { createReadSkillFileTool } from "./read-skill-file-tool.js";
import { logSafeEvent } from "./safe-logger.js";
import type { SpikeProviderRuntime } from "./provider-runtime.js";
import type { AgentSpikeResult, SpikeStatus } from "./types.js";

export interface AgentSpikeOptions {
  runtime: SpikeProviderRuntime;
  skillRoot: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxModelCalls?: number;
  logEvents?: boolean;
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

export async function buildAgentInstructions(skillRoot: string): Promise<string> {
  const skillMd = await readFile(join(skillRoot, "SKILL.md"), "utf8");
  return [
    "You are executing one fixed EduSkill Skill.",
    "Follow the Skill exactly and use only the registered tools.",
    "Do not guess file contents or invent a successful tool result.",
    "",
    "<skill>",
    skillMd,
    "</skill>",
  ].join("\n");
}

function classifyStatus(message: AssistantMessage | undefined): SpikeStatus {
  if (message?.stopReason === "aborted") return "cancelled";
  if (!message || message.stopReason !== "stop" || !assistantText(message).trim()) return "failed";
  return "completed";
}

function collectEvent(
  event: AgentEvent,
  evidence: { events: string[]; toolCalls: number; toolResults: number; tools: Set<string> },
): void {
  evidence.events.push(event.type);
  if (event.type === "tool_execution_start") {
    evidence.toolCalls += 1;
    evidence.tools.add(event.toolName);
  }
  if (event.type === "message_end" && event.message.role === "toolResult") {
    evidence.toolResults += 1;
  }
}

export async function runAgentSpike(options: AgentSpikeOptions): Promise<AgentSpikeResult> {
  const runId = randomUUID();
  const instructions = await buildAgentInstructions(options.skillRoot);
  const expectedMarker = (await readFile(join(options.skillRoot, "references/fact.md"), "utf8")).trim();
  const toolHandle = createReadSkillFileTool(options.skillRoot);
  const cancellation: { cause: "external" | "timeout" | null } = { cause: options.signal?.aborted ? "external" : null };
  let limitExceeded = false;
  let modelRequestCount = 0;
  let toolResultInModelRequest = false;
  let toolResultInProviderPayload = false;
  let unexpectedFailure = false;
  const evidence = { events: [] as string[], toolCalls: 0, toolResults: 0, tools: new Set<string>() };
  const agent = new Agent({
    initialState: {
      systemPrompt: instructions,
      model: options.runtime.model,
      thinkingLevel: "off",
      tools: [toolHandle.tool],
    },
    streamFn: (model, context, requestOptions) => {
      if (cancellation.cause || options.signal?.aborted) throw new Error("RUN_CANCELLED");
      if (modelRequestCount >= (options.maxModelCalls ?? 8)) {
        limitExceeded = true;
        throw new Error("RUN_LIMIT_EXCEEDED");
      }
      modelRequestCount += 1;
      toolResultInModelRequest ||= context.messages.some((message) => message.role === "toolResult"
        && !message.isError && message.content.some((item) => item.type === "text" && item.text.includes(expectedMarker)));
      return options.runtime.models.streamSimple(model, context, {
        ...requestOptions,
        ...options.runtime.requestOptions,
        maxRetries: 0,
        onPayload: async (payload, selectedModel) => {
          const body = await options.runtime.requestOptions?.onPayload?.(payload, selectedModel) ?? payload;
          const messages = (body as { messages?: { role: string; content?: unknown }[] }).messages ?? [];
          toolResultInProviderPayload ||= messages.some((message) => message.role === "tool"
            && typeof message.content === "string" && message.content.includes(expectedMarker));
          return body;
        },
      });
    },
    toolExecution: "sequential",
    sessionId: runId,
  });
  const unsubscribe = agent.subscribe((event) => {
    collectEvent(event, evidence);
    if (options.logEvents && ["agent_start", "tool_execution_start", "tool_execution_end", "agent_end"].includes(event.type)) {
      logSafeEvent(`agent.${event.type}`, runId);
    }
  });
  const abort = (cause: "external" | "timeout") => {
    cancellation.cause ??= cause;
    agent.abort();
  };
  const externalAbort = () => abort("external");
  options.signal?.addEventListener("abort", externalAbort, { once: true });
  const timer = setTimeout(() => abort("timeout"), options.timeoutMs ?? 180_000);
  try {
    logSafeEvent("agent.run.start", runId, {
      modelId: options.runtime.modelId,
      providerId: options.runtime.providerId,
    });
    if (options.signal?.aborted) cancellation.cause ??= "external";
    if (!cancellation.cause) await agent.prompt("Follow the loaded Skill and complete its verification task.");
    await agent.waitForIdle();
  } catch {
    unexpectedFailure = true;
    agent.abort();
    await agent.waitForIdle().catch(() => undefined);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", externalAbort);
    unsubscribe();
  }
  const message = finalAssistant(agent.state.messages);
  const finalText = assistantText(message);
  const audit = toolHandle.getAudit();
  const status = cancellation.cause === "external" ? "cancelled"
    : cancellation.cause === "timeout" || limitExceeded || unexpectedFailure ? "failed" : classifyStatus(message);
  const result: AgentSpikeResult = {
    runId,
    status,
    providerId: message?.provider ?? options.runtime.providerId,
    modelId: message?.responseModel ?? message?.model ?? options.runtime.modelId,
    finalText: status === "completed" ? finalText : "",
    markerObserved: finalText.includes(expectedMarker),
    toolCallCount: evidence.toolCalls,
    toolResultCount: evidence.toolResults,
    modelRequestCount,
    toolResultInModelRequest,
    toolResultInProviderPayload,
    toolNames: [...evidence.tools],
    eventTypes: evidence.events,
    resourceCleaned: !agent.state.isStreaming && agent.signal === undefined,
    errorCode: cancellation.cause === "timeout" ? "RUN_TIMEOUT"
      : cancellation.cause === "external" ? "RUN_CANCELLED"
      : limitExceeded ? "RUN_LIMIT_EXCEEDED"
      : unexpectedFailure ? "RUN_FAILED"
      : message?.stopReason === "error"
      ? "MODEL_ERROR"
      : message?.stopReason === "aborted"
        ? "RUN_CANCELLED"
        : status === "failed" ? "RUN_FAILED" : null,
  };
  logSafeEvent("agent.run.end", runId, {
    markerObserved: result.markerObserved,
    modelId: result.modelId,
    outputChars: result.finalText.length,
    providerId: result.providerId,
    readBytes: audit.totalBytes,
    resourceCleaned: result.resourceCleaned,
    status: result.status,
    errorCode: result.errorCode,
    toolCallCount: result.toolCallCount,
    toolResultCount: result.toolResultCount,
    modelRequestCount,
    toolResultInModelRequest,
    toolResultInProviderPayload,
  });
  return result;
}
