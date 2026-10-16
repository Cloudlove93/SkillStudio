import { afterEach, describe, expect, it, vi } from "vitest";
import { createProviderRuntime, probeProviderText } from "./provider-runtime.js";
import { fixtureSkillRoot } from "./paths.js";
import { runAgentSpike } from "./spike-runner.js";
import { runAbortProbe } from "./abort-probe.js";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function fixture(toolLoop = false) {
  vi.stubEnv("LLM_API_KEY", "fake-test-key");
  const requests: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    requests.push(body);
    const tool = toolLoop && requests.length === 1;
    if (toolLoop && requests.length === 2) {
      const toolResult = body.messages.find((message: { role: string }) => message.role === "tool");
      expect(toolResult?.content).toContain("EDU_PI_REFERENCE_7F31");
    }
    const delta = tool ? { tool_calls: [{ index: 0, id: "read-1", type: "function", function: {
      name: "read_skill_file", arguments: JSON.stringify({ path: "references/fact.md" }),
    } }] } : { content: toolLoop ? "Verified EDU_PI_REFERENCE_7F31." : "ok" };
    const chunks = [
      { delta, finish_reason: null },
      { delta: {}, finish_reason: tool ? "tool_calls" : "stop" },
    ];
    return new Response(chunks.map((choice) => `data: ${JSON.stringify({
      id: "fixture", model: "kimi-k2.6", choices: [{ index: 0, ...choice }],
    })}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
  });
  return requests;
}

describe("Spike SDK HTTP compatibility and tool-result evidence", () => {
  it("keeps the dedicated abort probe bounded and releases its Agent", async () => {
    vi.stubEnv("LLM_API_KEY", "fake-test-key");
    vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => new Promise((_resolve, reject) => {
      const abort = () => reject(new DOMException("Aborted", "AbortError"));
      if (init.signal?.aborted) abort();
      else init.signal?.addEventListener("abort", abort, { once: true });
    }));
    const result = await runAbortProbe(createProviderRuntime({ modelId: "kimi-k2.6", baseUrl: "https://provider.invalid/v1" }), 30);
    expect(result).toMatchObject({ status: "cancelled", errorCode: "RUN_CANCELLED", resourceCleaned: true });
  });

  it("preserves the sampling parameter for a non-Kimi model", async () => {
    const requests = fixture();
    await probeProviderText(createProviderRuntime({ modelId: "other-model", baseUrl: "https://provider.invalid/v1" }), "test");
    expect(requests[0]).toMatchObject({ temperature: 0 });
    expect(requests[0]).not.toHaveProperty("thinking");
  });
  it("keeps timeouts distinct from user cancellation and releases the Agent", async () => {
    vi.stubEnv("LLM_API_KEY", "fake-test-key");
    vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => new Promise((_resolve, reject) => {
      const abort = () => reject(new DOMException("Aborted", "AbortError"));
      if (init.signal?.aborted) abort();
      else init.signal?.addEventListener("abort", abort, { once: true });
    }));
    const result = await runAgentSpike({
      runtime: createProviderRuntime({ modelId: "kimi-k2.6", baseUrl: "https://provider.invalid/v1" }),
      skillRoot: fixtureSkillRoot(), timeoutMs: 30,
    });
    expect(result).toMatchObject({ status: "failed", errorCode: "RUN_TIMEOUT", resourceCleaned: true });
  });
  it("omits Kimi temperature and explicitly disables thinking", async () => {
    const requests = fixture();
    const result = await probeProviderText(createProviderRuntime({ modelId: "kimi-k2.6", baseUrl: "https://provider.invalid/v1" }), "test");
    expect(result.status).toBe("completed");
    expect(requests[0]).not.toHaveProperty("temperature");
    expect(requests[0]).toMatchObject({ thinking: { type: "disabled" } });
  });

  it("proves the reference is absent initially and enters the actual follow-up HTTP request", async () => {
    const requests = fixture(true);
    const result = await runAgentSpike({
      runtime: createProviderRuntime({ modelId: "kimi-k2.6", baseUrl: "https://provider.invalid/v1" }),
      skillRoot: fixtureSkillRoot(),
    });
    expect(JSON.stringify(requests[0])).not.toContain("EDU_PI_REFERENCE_7F31");
    expect(requests).toHaveLength(2);
    expect(result).toMatchObject({ status: "completed", markerObserved: true, toolResultInModelRequest: true, modelRequestCount: 2, resourceCleaned: true });
  });
});
