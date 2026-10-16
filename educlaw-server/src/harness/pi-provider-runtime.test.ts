import { describe, expect, it } from "vitest";
import { createPiProviderRuntime } from "./pi-provider-runtime.js";

describe("Pi provider runtime", () => {
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
