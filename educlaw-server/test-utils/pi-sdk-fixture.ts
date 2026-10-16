import { Agent } from "@earendil-works/pi-agent-core";
import type { StreamOptions } from "@earendil-works/pi-ai";
import pino from "pino";
import { createPiCoreAdapter } from "../src/harness/pi-core-adapter.js";
import { createPiProviderRuntime } from "../src/harness/pi-provider-runtime.js";

/** Runs the locked SDK end to end; only HTTP and logging are replaced. */
export function sdkFixture(options: { failAfterReasoning?: boolean; omitReasoning?: boolean } = {}) {
  const payloads: Record<string, unknown>[] = [];
  const nativeEvents: string[] = [];
  const fetch: NonNullable<StreamOptions["fetch"]> = async (_url, init) => {
    payloads.push(JSON.parse(String(init?.body)));
    const chunks = [
      { delta: { role: "assistant", reasoning_content: "Visible reasoning." }, finish_reason: null },
      { delta: { content: "SDK final answer" }, finish_reason: null },
      { delta: {}, finish_reason: "stop" },
    ];
    const responseChunks = options.failAfterReasoning
      ? chunks.slice(0, 2)
      : options.omitReasoning ? chunks.slice(1) : chunks;
    const ending = options.failAfterReasoning
      ? `data: ${JSON.stringify({ error: { message: "Controlled stream error", code: "fixture_error" } })}\n\n`
      : "data: [DONE]\n\n";
    return new Response(responseChunks.map((choice) => `data: ${JSON.stringify({
      id: "fixture", model: "fixture-response-model", choices: [{ index: 0, ...choice }],
    })}\n\n`).join("") + ending, {
      headers: { "Content-Type": "text/event-stream" },
    });
  };
  const run = createPiCoreAdapter({
    createAgent(options) {
      const agent = new Agent(options);
      agent.subscribe((event) => {
        if (event.type === "message_update") nativeEvents.push(event.assistantMessageEvent.type);
      });
      return agent;
    },
    createProviderRuntime(request) {
      const runtime = createPiProviderRuntime(request, {
        apiKey: "fake-test-key", baseUrl: "https://api.moonshot.ai/v1",
      });
      return {
        ...runtime,
        streamFn: (model, context, options) => runtime.streamFn(model, context, { ...options, fetch }),
      };
    },
    getLogger: () => pino({ level: "silent" }),
    now: Date.now,
  });
  return { run, payloads, nativeEvents };
}
