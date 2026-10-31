import type {
  AgentEvent,
  AgentMessage,
  AgentOptions,
} from "@earendil-works/pi-agent-core";
import type {
  AssistantMessage,
  Model,
  StreamFn,
  Usage,
} from "@earendil-works/pi-ai";
import type { Logger } from "pino";
import { describe, expect, it, vi } from "vitest";
vi.mock("../config.js", () => ({ config: { llmApiKey: "fixture-only-key", llmBaseUrl: "https://provider.invalid/v1" } }));
import type {
  HarnessEvent,
  HarnessRunRequest,
} from "./contracts.js";
import {
  createPiCoreAdapter,
  DEFAULT_PI_RUN_TIMEOUT_MS,
  type PiAgentHandle,
  type PiCoreAdapterDependencies,
} from "./pi-core-adapter.js";
import type { PiProviderRuntime } from "./pi-provider-runtime.js";
import { PiProviderConfigurationError } from "./pi-provider-runtime.js";

const ZERO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function assistant(
  text: string,
  stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage {
  return {
    role: "assistant",
    content: text ? [{ type: "text", text }] : [],
    api: "openai-completions",
    provider: "provider-reported-registry",
    model: "requested-model",
    responseModel: "actual-response-model",
    usage: ZERO_USAGE,
    stopReason,
    timestamp: Date.now(),
  };
}

interface FakeAgentScenario {
  finalMessage?: AssistantMessage;
  omitFinalMessage?: boolean;
  promptError?: Error;
  waitForAbort?: boolean;
  extraEvents?: AgentEvent[];
  prepareRequestCount?: number;
}

class FakeAgent implements PiAgentHandle {
  readonly options: AgentOptions;
  readonly promptInputs: string[] = [];
  readonly state: { messages: AgentMessage[]; isStreaming: boolean };
  signal: AbortSignal | undefined;
  unsubscribeCalled = false;
  waitForIdleCalls = 0;
  private readonly scenario: FakeAgentScenario;
  private listener: ((event: AgentEvent, signal: AbortSignal) => void | Promise<void>) | null = null;
  private controller: AbortController | null = null;
  private resolveAbort: (() => void) | null = null;

  constructor(options: AgentOptions, scenario: FakeAgentScenario) {
    this.options = options;
    this.scenario = scenario;
    this.state = {
      messages: [...(options.initialState?.messages ?? [])],
      isStreaming: false,
    };
  }

  subscribe(
    listener: (event: AgentEvent, signal: AbortSignal) => void | Promise<void>,
  ): () => void {
    this.listener = listener;
    return () => {
      this.unsubscribeCalled = true;
      this.listener = null;
    };
  }

  async prompt(input: string): Promise<void> {
    this.promptInputs.push(input);
    this.controller = new AbortController();
    this.signal = this.controller.signal;
    this.state.isStreaming = true;
    try {
      await this.emit({ type: "agent_start" });
      for (let index = 0; index < (this.scenario.prepareRequestCount ?? 1); index += 1) {
        await this.options.prepareRequest?.({
          context: { messages: [...this.state.messages], tools: [] },
          model: this.options.initialState?.model as Model<"openai-completions">,
          thinkingLevel: this.options.initialState?.thinkingLevel ?? "off",
        }, this.signal);
      }
      if (this.scenario.waitForAbort) {
        await new Promise<void>((resolve) => {
          this.resolveAbort = resolve;
          if (this.signal?.aborted) resolve();
        });
      }
      if (this.scenario.promptError) throw this.scenario.promptError;
      for (const event of this.scenario.extraEvents ?? []) {
        await this.emit(event);
      }
      if (!this.scenario.omitFinalMessage) {
        const message = this.scenario.finalMessage
          ?? (this.signal?.aborted ? assistant("late text", "aborted") : assistant("final answer"));
        this.state.messages.push(message);
        await this.emit({ type: "message_end", message });
      }
      await this.emit({ type: "agent_end", messages: [...this.state.messages] });
    } finally {
      this.finishStreaming();
    }
  }

  async waitForIdle(): Promise<void> {
    this.waitForIdleCalls += 1;
  }

  abort(): void {
    this.controller?.abort();
    this.resolveAbort?.();
  }

  private async emit(event: AgentEvent): Promise<void> {
    if (this.listener && this.signal) {
      await this.listener(event, this.signal);
    }
  }

  private finishStreaming(): void {
    this.state.isStreaming = false;
    this.signal = undefined;
  }
}

function request(overrides: Partial<HarnessRunRequest> = {}): HarnessRunRequest {
  return {
    runId: "run-001",
    selectedSkill: {
      versionId: 42,
      skillMd: "# Skill\nUse the fixed classroom procedure.",
    },
    agentInstructions: "Answer as a careful teaching assistant.",
    history: [
      { role: "user", content: "Earlier question" },
      { role: "assistant", content: "Earlier answer" },
    ],
    currentInput: "Current question",
    model: {
      modelId: "requested-model",
      temperature: 0.3,
      maxOutputTokens: 2048,
      thinkingLevel: "off",
    },
    limits: { timeoutMs: 1000, maxModelCalls: 8 },
    ...overrides,
  };
}

function fakeRuntime(): PiProviderRuntime {
  return {
    model: {
      id: "requested-model",
      name: "requested-model",
      api: "openai-completions",
      provider: "configured-provider",
      baseUrl: "https://provider.invalid/v1",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128_000,
      maxTokens: 2048,
    },
    providerRegistryId: "configured-provider",
    requestedModelId: "requested-model",
    streamFn: vi.fn() as unknown as StreamFn,
  };
}

function testAdapter(
  scenario: FakeAgentScenario = {},
  runtimeError?: Error,
) {
  const agents: FakeAgent[] = [];
  const logEntries: unknown[] = [];
  const logger = {
    info: (entry: unknown) => logEntries.push(entry),
    warn: (entry: unknown) => logEntries.push(entry),
    error: (entry: unknown) => logEntries.push(entry),
  } as unknown as Logger;
  const dependencies: PiCoreAdapterDependencies = {
    createAgent: (options) => {
      const agent = new FakeAgent(options, scenario);
      agents.push(agent);
      return agent;
    },
    createProviderRuntime: () => {
      if (runtimeError) throw runtimeError;
      return fakeRuntime();
    },
    getLogger: () => logger,
    now: () => Date.now(),
  };
  return {
    agents,
    logEntries,
    run: createPiCoreAdapter(dependencies),
  };
}

describe("Pi Core adapter", () => {
  it("drops late thinking deltas after cancellation even if the Agent still emits them", async () => {
    const partial = assistant("");
    const thinking = (delta: string): AgentEvent => ({
      type: "message_update", message: partial,
      assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta, partial },
    });
    const harness = testAdapter({ extraEvents: [thinking("visible before stop"), thinking("late after stop")] });
    const controller = new AbortController();
    const events: HarnessEvent[] = [];
    const result = await harness.run(request({
      model: { modelId: "kimi-k2.6", thinkingLevel: "medium" }, signal: controller.signal,
    }), (event) => {
      events.push(event);
      if (event.type === "reasoning_delta") controller.abort();
    });
    expect(events.filter((event) => event.type === "reasoning_delta")).toEqual([{
      type: "reasoning_delta", runId: "run-001", delta: "visible before stop",
    }]);
    expect(result.status).toBe("cancelled");
    expect(events.filter((event) => event.type === "run_finished")).toHaveLength(1);
    expect(events.some((event) => event.type === "text_delta")).toBe(false);
  });

  it("injects the fixed Skill, keeps history separate, and adds the current question once", async () => {
    const harness = testAdapter();
    const events: HarnessEvent[] = [];
    const result = await harness.run(request(), (event) => events.push(event));

    expect(result.status).toBe("completed");
    const agent = harness.agents[0];
    expect(result.evidence.skillInjected).toBe(true);
    expect(agent.options.initialState?.systemPrompt).toContain("Fixed Skill Version 42");
    expect(agent.options.initialState?.systemPrompt).toContain("Use the fixed classroom procedure.");
    expect(agent.options.initialState?.systemPrompt).toContain("Answer as a careful teaching assistant.");
    expect(JSON.stringify(agent.options.initialState?.messages)).not.toContain("Current question");
    expect(agent.options.initialState?.messages).toHaveLength(2);
    expect(agent.promptInputs).toEqual(["Current question"]);
    expect(agent.options.initialState?.tools).toEqual([]);
    expect(events.filter((event) => event.type === "text_delta")).toHaveLength(1);
  });

  it("extracts the final answer and preserves the provider-reported response model", async () => {
    const harness = testAdapter({ finalMessage: assistant("  final answer from provider  ") });
    const events: HarnessEvent[] = [];
    const result = await harness.run(request(), (event) => events.push(event));

    expect(result).toMatchObject({
      status: "completed",
      text: "final answer from provider",
      providerRegistryId: "provider-reported-registry",
      responseModelId: "actual-response-model",
      requestedModelId: "requested-model",
    });
    expect(result.evidence.modelRequestCount).toBe(1);
    expect(events.filter((event) => event.type === "run_finished")).toHaveLength(1);
  });

  it("does not reuse a historical assistant when the current prompt adds no assistant", async () => {
    const harness = testAdapter({ omitFinalMessage: true });
    const events: HarnessEvent[] = [];
    const result = await harness.run(request(), (event) => events.push(event));

    expect(result.status).toBe("failed");
    expect(result.text).toBe("");
    expect(result.error?.code).toBe("MODEL_UNAVAILABLE");
    expect(events.some((event) => event.type === "text_delta")).toBe(false);
    expect(events.filter((event) => event.type === "run_finished")).toHaveLength(1);
  });

  it("fails closed for an unknown runtime stop reason", async () => {
    const finalMessage = {
      ...assistant("partial answer"),
      stopReason: "future-stop-reason" as AssistantMessage["stopReason"],
    };
    const harness = testAdapter({ finalMessage });
    const events: HarnessEvent[] = [];
    const result = await harness.run(request(), (event) => events.push(event));

    expect(result.status).toBe("failed");
    expect(result.text).toBe("");
    expect(result.error?.code).toBe("RUN_FAILED");
    expect(events.some((event) => event.type === "text_delta")).toBe(false);
    expect(events.filter((event) => event.type === "run_finished")).toHaveLength(1);
  });

  it.each([
    ["model error", assistant("", "error"), "MODEL_UNAVAILABLE"],
    ["empty body", assistant("", "stop"), "EMPTY_RESPONSE"],
    ["truncated output", assistant("partial", "length"), "OUTPUT_TRUNCATED"],
  ])("rejects %s as a failed run", async (_name, finalMessage, errorCode) => {
    const harness = testAdapter({ finalMessage });
    const events: HarnessEvent[] = [];
    const result = await harness.run(request(), (event) => events.push(event));

    expect(result.status).toBe("failed");
    expect(result.text).toBe("");
    expect(result.error?.code).toBe(errorCode);
    expect(events.some((event) => event.type === "text_delta")).toBe(false);
    expect(events.filter((event) => event.type === "run_finished")).toHaveLength(1);
  });

  it("logs only allow-listed provider failure metadata", async () => {
    const finalMessage: AssistantMessage = {
      ...assistant("", "error"),
      errorMessage: "Request failed with status 503: private provider detail",
    };
    const harness = testAdapter({ finalMessage });

    const result = await harness.run(request(), () => undefined);

    expect(result.error?.code).toBe("MODEL_UNAVAILABLE");
    expect(harness.logEntries).toContainEqual(expect.objectContaining({
      event: "pi_harness.model_unavailable",
      modelStopReason: "error",
      providerStatus: 503,
      providerFailureCategory: "provider_5xx",
    }));
    expect(JSON.stringify(harness.logEntries)).not.toContain("private provider detail");
  });

  it.each([
    ["pending", "pending", "failed", "RUN_FAILED"],
    ["toolUse", "toolUse", "failed", "TOOL_DENIED"],
    ["deferred", "deferred", "failed", "MODEL_UNAVAILABLE"],
    ["length", "length", "failed", "OUTPUT_TRUNCATED"],
    ["error", "error", "failed", "MODEL_UNAVAILABLE"],
    ["aborted", "aborted", "cancelled", "RUN_CANCELLED"],
  ] as const)(
    "fails closed for the %s stop reason even when text is present",
    async (_name, stopReason, status, errorCode) => {
      const harness = testAdapter({ finalMessage: assistant("partial answer", stopReason) });
      const events: HarnessEvent[] = [];
      const result = await harness.run(request(), (event) => events.push(event));

      expect(result.status).toBe(status);
      expect(result.text).toBe("");
      expect(result.error?.code).toBe(errorCode);
      expect(events.some((event) => event.type === "text_delta")).toBe(false);
      expect(events.filter((event) => event.type === "run_finished")).toHaveLength(1);
    },
  );

  it("does not create an Agent when the external signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const harness = testAdapter();
    const events: HarnessEvent[] = [];
    const result = await harness.run(
      request({ signal: controller.signal }),
      (event) => events.push(event),
    );

    expect(result.status).toBe("cancelled");
    expect(result.error?.code).toBe("RUN_CANCELLED");
    expect(harness.agents).toHaveLength(0);
    expect(result.evidence.skillInjected).toBe(false);
    expect(events.filter((event) => event.type === "run_finished")).toHaveLength(1);
  });

  it("lets cancellation win before the terminal outcome is locked", async () => {
    const controller = new AbortController();
    const harness = testAdapter();
    const events: HarnessEvent[] = [];
    const result = await harness.run(
      request({ signal: controller.signal }),
      (event) => {
        events.push(event);
        if (event.type === "text_delta") controller.abort();
      },
    );

    expect(result.status).toBe("cancelled");
    expect(result.text).toBe("");
    expect(result.error?.code).toBe("RUN_CANCELLED");
    expect(events.filter((event) => event.type === "run_finished")).toHaveLength(1);
    expect(events.find((event) => event.type === "run_finished")).toMatchObject({
      status: "cancelled",
    });
  });

  it("cancels deterministically while an async text delivery is in flight", async () => {
    const controller = new AbortController();
    const harness = testAdapter();
    const events: HarnessEvent[] = [];
    let markTextDeliveryStarted: (() => void) | undefined;
    let releaseTextDelivery: (() => void) | undefined;
    const textDeliveryStarted = new Promise<void>((resolve) => {
      markTextDeliveryStarted = resolve;
    });
    const textDeliveryReleased = new Promise<void>((resolve) => {
      releaseTextDelivery = resolve;
    });
    const pending = harness.run(
      request({ signal: controller.signal }),
      async (event) => {
        events.push(event);
        if (event.type === "text_delta") {
          markTextDeliveryStarted?.();
          await textDeliveryReleased;
        }
      },
    );

    await textDeliveryStarted;
    controller.abort();
    releaseTextDelivery?.();
    const result = await pending;

    expect(result.status).toBe("cancelled");
    expect(result.text).toBe("");
    expect(result.error?.code).toBe("RUN_CANCELLED");
    expect(events.filter((event) => event.type === "text_delta")).toHaveLength(1);
    expect(events.filter((event) => event.type === "run_finished")).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: "run_finished", status: "cancelled" });
  });

  it("does not let cancellation rewrite an already locked terminal outcome", async () => {
    const controller = new AbortController();
    const harness = testAdapter();
    const events: HarnessEvent[] = [];
    const result = await harness.run(
      request({ signal: controller.signal }),
      (event) => {
        events.push(event);
        if (event.type === "run_finished") controller.abort();
      },
    );

    expect(result.status).toBe("completed");
    expect(events.filter((event) => event.type === "run_finished")).toHaveLength(1);
    expect(events.find((event) => event.type === "run_finished")).toMatchObject({
      status: "completed",
    });
  });

  it("cancels an active run without emitting late text and emits one terminal event", async () => {
    const controller = new AbortController();
    const harness = testAdapter({ waitForAbort: true });
    const events: HarnessEvent[] = [];
    const pending = harness.run(
      request({ signal: controller.signal }),
      (event) => events.push(event),
    );
    await vi.waitFor(() => expect(harness.agents).toHaveLength(1));
    controller.abort();
    const result = await pending;

    expect(result.status).toBe("cancelled");
    expect(result.error?.code).toBe("RUN_CANCELLED");
    expect(events.some((event) => event.type === "text_delta")).toBe(false);
    expect(events.filter((event) => event.type === "run_finished")).toHaveLength(1);
  });

  it("distinguishes timeout from user cancellation", async () => {
    const harness = testAdapter({ waitForAbort: true });
    const events: HarnessEvent[] = [];
    const result = await harness.run(
      request({ limits: { timeoutMs: 5, maxModelCalls: 8 } }),
      (event) => events.push(event),
    );

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("RUN_TIMEOUT");
    expect(events.some((event) => event.type === "text_delta")).toBe(false);
  });

  it("maps prompt exceptions to a controlled failure and releases subscriptions", async () => {
    const harness = testAdapter({ promptError: new Error("provider payload secret") });
    const events: HarnessEvent[] = [];
    const result = await harness.run(request(), (event) => events.push(event));
    const agent = harness.agents[0];

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("RUN_FAILED");
    expect(agent.unsubscribeCalled).toBe(true);
    expect(agent.waitForIdleCalls).toBeGreaterThanOrEqual(1);
    expect(result.evidence.cleanupCompleted).toBe(true);
  });

  it("maps missing trusted provider configuration to MODEL_UNAVAILABLE", async () => {
    const harness = testAdapter(
      {},
      new PiProviderConfigurationError("secret provider configuration detail"),
    );
    const result = await harness.run(request(), () => undefined);

    expect(result.status).toBe("failed");
    expect(result.error).toMatchObject({
      code: "MODEL_UNAVAILABLE",
      retryable: false,
    });
    expect(result.evidence.skillInjected).toBe(false);
    expect(result.error?.userMessage).not.toContain("secret");
  });

  it("returns a controlled failure when run_started delivery fails", async () => {
    const harness = testAdapter();
    const events: HarnessEvent[] = [];
    const result = await harness.run(request(), (event) => {
      if (event.type === "run_started") throw new Error("transport closed with secret");
      events.push(event);
    });

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("RUN_FAILED");
    expect(result.evidence.skillInjected).toBe(false);
    expect(result.evidence.eventDeliveryFailureCount).toBe(1);
    expect(harness.agents).toHaveLength(0);
    expect(events.filter((event) => event.type === "run_finished")).toHaveLength(1);
  });

  it("returns a controlled failure and terminal event when text delivery fails", async () => {
    const harness = testAdapter();
    const events: HarnessEvent[] = [];
    const result = await harness.run(request(), (event) => {
      if (event.type === "text_delta") throw new Error("transport closed with secret");
      events.push(event);
    });

    expect(result.status).toBe("failed");
    expect(result.text).toBe("");
    expect(result.error?.code).toBe("RUN_FAILED");
    expect(result.evidence.cleanupCompleted).toBe(true);
    expect(result.evidence.eventDeliveryFailureCount).toBe(1);
    expect(events.filter((event) => event.type === "run_finished")).toHaveLength(1);
    expect(events.find((event) => event.type === "run_finished")).toMatchObject({
      status: "failed",
    });
  });

  it("does not claim Skill injection when request validation fails", async () => {
    const harness = testAdapter();
    const result = await harness.run(request({ currentInput: " " }), () => undefined);

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("INVALID_REQUEST");
    expect(result.evidence.skillInjected).toBe(false);
    expect(harness.agents).toHaveLength(0);
  });

  it("enforces the model call budget", async () => {
    const harness = testAdapter({ prepareRequestCount: 2 });
    const events: HarnessEvent[] = [];
    const result = await harness.run(
      request({ limits: { timeoutMs: 1000, maxModelCalls: 1 } }),
      (event) => events.push(event),
    );

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("RUN_LIMIT_EXCEEDED");
    expect(result.evidence.modelRequestAttemptCount).toBe(2);
    expect(result.evidence.modelRequestCount).toBe(1);
    expect(events.filter((event) => event.type === "run_finished")).toHaveLength(1);
  });

  it("uses the Phase 2 default timeout without changing the legacy LLM timeout", () => {
    expect(DEFAULT_PI_RUN_TIMEOUT_MS).toBe(180_000);
  });

  it("fails closed if an unexpected tool executes", async () => {
    const harness = testAdapter({
      extraEvents: [
        {
          type: "tool_execution_start",
          toolCallId: "call-1",
          toolName: "unexpected_tool",
          args: {},
        },
        {
          type: "tool_execution_end",
          toolCallId: "call-1",
          toolName: "unexpected_tool",
          result: {},
          isError: false,
        },
      ],
    });
    const result = await harness.run(request(), () => undefined);

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("TOOL_DENIED");
    expect(result.evidence.toolNames).toEqual(["unexpected_tool"]);
  });

  it("does not log the Skill, prompt, API key, or provider error body", async () => {
    const harness = testAdapter({ promptError: new Error("provider payload secret") });
    await harness.run(request({
      selectedSkill: { versionId: 42, skillMd: "SENSITIVE_SKILL_BODY" },
      agentInstructions: "SENSITIVE_AGENT_INSTRUCTIONS",
      currentInput: "SENSITIVE_USER_PROMPT",
    }), () => undefined);
    const logs = JSON.stringify(harness.logEntries);

    expect(logs).not.toContain("SENSITIVE_SKILL_BODY");
    expect(logs).not.toContain("SENSITIVE_AGENT_INSTRUCTIONS");
    expect(logs).not.toContain("SENSITIVE_USER_PROMPT");
    expect(logs).not.toContain("provider payload secret");
    expect(logs).not.toContain("LLM_API_KEY");
  });
});
