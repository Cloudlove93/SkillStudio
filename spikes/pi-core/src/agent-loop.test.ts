import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { fixtureSkillRoot } from "./paths.js";
import type { SpikeProviderRuntime } from "./provider-runtime.js";
import { buildAgentInstructions, runAgentSpike } from "./spike-runner.js";

function fauxRuntime(responses: ReturnType<typeof fauxAssistantMessage>[]): SpikeProviderRuntime {
  const faux = fauxProvider({ tokensPerSecond: 10_000 });
  faux.setResponses(responses);
  const models = createModels();
  models.setProvider(faux.provider);
  return {
    models,
    model: faux.getModel() as SpikeProviderRuntime["model"],
    providerId: faux.getModel().provider,
    modelId: faux.getModel().id,
  };
}

describe("Pi Core Agent spike", () => {
  it("does not preload the reference marker into Agent instructions", async () => {
    const marker = (await readFile(join(fixtureSkillRoot(), "references/fact.md"), "utf8")).trim();
    const instructions = await buildAgentInstructions(fixtureSkillRoot());
    expect(instructions).not.toContain(marker);
  });

  it("executes Tool Call, Tool Result, and a follow-up model turn", async () => {
    const marker = (await readFile(join(fixtureSkillRoot(), "references/fact.md"), "utf8")).trim();
    const runtime = fauxRuntime([
      fauxAssistantMessage(
        fauxToolCall("read_skill_file", { path: "references/fact.md" }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(`Verified ${marker}.`),
    ]);
    const result = await runAgentSpike({ runtime, skillRoot: fixtureSkillRoot() });
    expect(result.status).toBe("completed");
    expect(result.markerObserved).toBe(true);
    expect(result.toolCallCount).toBe(1);
    expect(result.toolResultCount).toBe(1);
    expect(result.eventTypes).toContain("tool_execution_start");
    expect(result.eventTypes.at(-1)).toBe("agent_end");
    expect(result.resourceCleaned).toBe(true);
  });

  it("ends in an error terminal state without leaving the Agent active", async () => {
    const runtime = fauxRuntime([
      fauxAssistantMessage([], { stopReason: "error", errorMessage: "synthetic provider failure" }),
    ]);
    const agent = new Agent({
      initialState: { model: runtime.model, systemPrompt: "Test terminal errors." },
      streamFn: runtime.models.streamSimple.bind(runtime.models),
    });
    const events: string[] = [];
    agent.subscribe((event) => {
      events.push(event.type);
    });
    await agent.prompt("Run the error test.");
    await agent.waitForIdle();
    expect(agent.state.errorMessage).toBe("synthetic provider failure");
    expect(events.at(-1)).toBe("agent_end");
    expect(agent.state.isStreaming).toBe(false);
  });

  it("aborts an active Agent run and settles all events", async () => {
    const faux = fauxProvider({ tokensPerSecond: 1, tokenSize: { min: 1, max: 1 } });
    faux.setResponses([fauxAssistantMessage("A".repeat(200))]);
    const models = createModels();
    models.setProvider(faux.provider);
    const agent = new Agent({
      initialState: { model: faux.getModel(), systemPrompt: "Test cancellation." },
      streamFn: models.streamSimple.bind(models),
    });
    const events: string[] = [];
    agent.subscribe((event) => {
      events.push(event.type);
    });
    const prompt = agent.prompt("Start.");
    await new Promise((resolve) => setTimeout(resolve, 20));
    agent.abort();
    await prompt;
    await agent.waitForIdle();
    const assistants = agent.state.messages.filter((message) => message.role === "assistant");
    expect(assistants.at(-1)?.stopReason).toBe("aborted");
    expect(events.at(-1)).toBe("agent_end");
    expect(agent.state.isStreaming).toBe(false);
  });
});
