import { describe, expect, it, vi } from "vitest";
vi.mock("../config.js", () => ({ config: { llmApiKey: "fixture-only-key", llmBaseUrl: "https://provider.invalid/v1" } }));
import { createPiProviderRuntime } from "./pi-provider-runtime.js";

describe("Pi provider runtime", () => {
  it.each(["off", "medium"] as const)("keeps Kimi capability independent of the requested %s mode", (thinkingLevel) => {
    const runtime = createPiProviderRuntime({ modelId: "kimi-k2.6", thinkingLevel }, {
      apiKey: "test-key", baseUrl: "https://api.moonshot.ai/v1",
    });
    expect(runtime.model.reasoning).toBe(true);
  });
  it("uses the trusted server settings and requested generation parameters", () => {
    const runtime = createPiProviderRuntime(
      {
        modelId: "deepseek-chat",
        temperature: 0.25,
        maxOutputTokens: 4096,
        thinkingLevel: "off",
      },
      {
        apiKey: "test-key-not-used-for-network",
        baseUrl: "https://provider.invalid/v1",
      },
    );

    expect(runtime.providerRegistryId).toBe("educlaw-configured");
    expect(runtime.requestedModelId).toBe("deepseek-chat");
    expect(runtime.model).toMatchObject({
      id: "deepseek-chat",
      baseUrl: "https://provider.invalid/v1",
      maxTokens: 4096,
      samplingParams: { temperature: 0.25 },
    });
  });

  it("refuses to create a runtime without the trusted API key", () => {
    expect(() => createPiProviderRuntime(
      { modelId: "deepseek-chat" },
      { apiKey: "", baseUrl: "https://provider.invalid/v1" },
    )).toThrow("LLM_API_KEY is not configured");
  });
});
