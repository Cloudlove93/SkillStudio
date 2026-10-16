import { randomUUID } from "node:crypto";
import { Agent, type AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { SpikeProviderRuntime } from "./provider-runtime.js";
import type { AgentSpikeResult } from "./types.js";

function lastAssistant(messages: AgentMessage[]): AssistantMessage | undefined {
  return [...messages].reverse().find(
    (message): message is AssistantMessage => message.role === "assistant",
  );
}

export async function runAbortProbe(
  runtime: SpikeProviderRuntime,
  abortAfterMs = 100,
): Promise<AgentSpikeResult> {
  const runId = randomUUID();
  const events: string[] = [];
  let modelRequestCount = 0;
  const agent = new Agent({
    initialState: {
      systemPrompt: "Answer normally without tools.",
      model: runtime.model,
      thinkingLevel: "off",
    },
    streamFn: (model, context, options) => {
      modelRequestCount += 1;
      return runtime.models.streamSimple(model, context, {
        ...options, ...runtime.requestOptions, maxRetries: 0,
      });
    },
    sessionId: runId,
  });
  const unsubscribe = agent.subscribe((event) => {
    events.push(event.type);
  });
  const timer = setTimeout(() => agent.abort(), abortAfterMs);
  const deadline = setTimeout(() => agent.abort(), 15_000);
  try {
    await agent.prompt("Produce a detailed response with many numbered paragraphs.");
    await agent.waitForIdle();
  } finally {
    agent.abort();
    await agent.waitForIdle().catch(() => undefined);
    clearTimeout(deadline);
    clearTimeout(timer);
    unsubscribe();
  }
  const message = lastAssistant(agent.state.messages);
  return {
    runId,
    status: message?.stopReason === "aborted" ? "cancelled" : "failed",
    providerId: message?.provider ?? runtime.providerId,
    modelId: message?.responseModel ?? message?.model ?? runtime.modelId,
    finalText: "",
    markerObserved: false,
    toolCallCount: 0,
    toolResultCount: 0,
    modelRequestCount,
    toolResultInModelRequest: false,
    toolResultInProviderPayload: false,
    toolNames: [],
    eventTypes: events,
    resourceCleaned: !agent.state.isStreaming && agent.signal === undefined,
    errorCode: message?.stopReason === "aborted" ? "RUN_CANCELLED" : "ABORT_NOT_OBSERVED",
  };
}
