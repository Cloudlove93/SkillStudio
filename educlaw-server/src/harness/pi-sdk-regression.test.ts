import { describe, expect, it, vi } from "vitest";
vi.mock("../config.js", () => ({ config: { llmApiKey: "fixture-only-key", llmBaseUrl: "https://provider.invalid/v1" } }));
import type { HarnessEvent, HarnessRunRequest } from "./contracts.js";
import { sdkFixture } from "../../test-utils/pi-sdk-fixture.js";

describe("locked Pi SDK HTTP boundary", () => {
  it.each(["kimi-k2.5", "kimi-k2.6"])("omits incompatible temperature for %s", async (modelId) => {
    const fixture = sdkFixture();
    await fixture.run(request(modelId, "off"), () => {});
    expect(fixture.payloads).toHaveLength(1);
    expect(fixture.payloads[0]).not.toHaveProperty("temperature");
  });

  it.each([
    ["kimi-k2.5", "off"], ["kimi-k2.5", "medium"],
    ["kimi-k2.6", "off"], ["kimi-k2.6", "medium"],
  ] as const)("sends explicit thinking for %s / %s", async (modelId, thinkingLevel) => {
    const fixture = sdkFixture();
    await fixture.run(request(modelId, thinkingLevel), () => {});
    expect(fixture.payloads[0]).toMatchObject({ thinking: {
      type: thinkingLevel === "off" ? "disabled" : "enabled",
    } });
    expect(fixture.payloads[0]).not.toHaveProperty("reasoning_effort");
    expect(fixture.payloads[0]).not.toHaveProperty("temperature");
  });

  it("defaults Kimi thinking to disabled when the caller omits a level", async () => {
    const fixture = sdkFixture();
    const input = request("kimi-k2.6", "off");
    delete input.model.thinkingLevel;
    await fixture.run(input, () => {});
    expect(fixture.payloads[0]).toMatchObject({ thinking: { type: "disabled" } });
  });

  it("preserves non-Kimi temperature without inventing thinking support", async () => {
    const fixture = sdkFixture();
    const events: HarnessEvent[] = [];
    await fixture.run(request("deepseek-chat", "medium"), (event) => { events.push(event); });
    expect(fixture.payloads[0]).toMatchObject({ temperature: 0.3 });
    expect(fixture.payloads[0]).not.toHaveProperty("thinking");
    expect(fixture.payloads[0]).not.toHaveProperty("reasoning_effort");
    expect(fixture.nativeEvents).toContain("thinking_delta");
    expect(events.some((event) => event.type === "reasoning_delta")).toBe(false);
  });

  it("stops delivering reasoning after cancellation and emits a single cancelled terminal", async () => {
    const fixture = sdkFixture();
    const controller = new AbortController();
    const events: HarnessEvent[] = [];
    const result = await fixture.run({ ...request("kimi-k2.6", "medium"), signal: controller.signal }, (event) => {
      events.push(event);
      if (event.type === "reasoning_delta") controller.abort();
    });
    expect(controller.signal.aborted).toBe(true);
    expect(result.status).toBe("cancelled");
    expect(result.text).toBe("");
    expect(events.filter((event) => event.type === "reasoning_delta")).toHaveLength(1);
    expect(events.some((event) => event.type === "text_delta")).toBe(false);
    expect(events.filter((event) => event.type === "run_finished")).toEqual([expect.objectContaining({ status: "cancelled" })]);
    expect(result.evidence.cleanupCompleted).toBe(true);
  });

  it("keeps provider text partial and never publishes success after a stream error", async () => {
    const fixture = sdkFixture({ failAfterReasoning: true });
    const events: HarnessEvent[] = [];
    const result = await fixture.run(request("kimi-k2.6", "medium"), (event) => { events.push(event); });
    expect(fixture.nativeEvents).toContain("thinking_delta");
    expect(fixture.nativeEvents).toContain("text_delta");
    expect(result.status).toBe("failed");
    expect(result.text).toBe("");
    expect(events.filter((event) => event.type === "text_delta")).toEqual([{
      type: "text_delta", runId: "sdk-regression", delta: "SDK final answer",
    }]);
    expect(events.filter((event) => event.type === "run_finished")).toEqual([expect.objectContaining({ status: "failed" })]);
    expect(result.evidence.cleanupCompleted).toBe(true);
  });

  it("does not require visible reasoning when thinking is enabled", async () => {
    const fixture = sdkFixture({ omitReasoning: true });
    const events: HarnessEvent[] = [];
    const result = await fixture.run(request("kimi-k2.6", "medium"), (event) => { events.push(event); });
    expect(result.status).toBe("completed");
    expect(result.text).toBe("SDK final answer");
    expect(events.some((event) => event.type === "reasoning_delta")).toBe(false);
  });

  it.each(["off", "medium"] as const)("gates native thinking deltas for %s", async (thinkingLevel) => {
    const fixture = sdkFixture();
    const events: HarnessEvent[] = [];
    const result = await fixture.run(request("kimi-k2.6", thinkingLevel), (event) => { events.push(event); });
    expect(result.status).toBe("completed");
    expect(fixture.nativeEvents).toContain("thinking_delta");
    const reasoning = events.filter((event) => event.type === "reasoning_delta");
    expect(reasoning).toEqual(thinkingLevel === "off" ? [] : [{
      type: "reasoning_delta", runId: "sdk-regression", delta: "Visible reasoning.",
    }]);
    expect(events.filter((event) => event.type === "run_finished")).toHaveLength(1);
    expect(events.filter((event) => event.type === "text_delta")).toEqual([{
      type: "text_delta", runId: "sdk-regression", delta: "SDK final answer",
    }]);
  });
});

function request(modelId: string, thinkingLevel: "off" | "medium"): HarnessRunRequest {
  return {
    runId: "sdk-regression", selectedSkill: { versionId: 1, skillMd: "# Fixed Skill" },
    agentInstructions: "Follow the skill", history: [], currentInput: "Question",
    model: { modelId, temperature: 0.3, thinkingLevel },
  };
}
