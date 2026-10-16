import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import type { HarnessEvent } from "./contracts.js";
import { runPiAgent } from "./pi-core-adapter.js";

const SMOKE_SKILL_MD = `---
name: pi-adapter-smoke
description: Verifies the formal Pi Core adapter with one fixed Skill.
---

# Instructions

Answer the user's question in one concise sentence.
State that a teacher should confirm the facts and protect the student's immediate safety.
`;

async function main(): Promise<void> {
  if (!config.llmApiKey) {
    console.error(JSON.stringify({
      check: "formal_pi_adapter_provider_smoke",
      status: "blocked",
      reason: "LLM_API_KEY_NOT_CONFIGURED",
    }));
    process.exitCode = 2;
    return;
  }

  const runId = `pi-adapter-smoke-${randomUUID()}`;
  const eventTypes: HarnessEvent["type"][] = [];
  const result = await runPiAgent({
    runId,
    selectedSkill: {
      versionId: 1,
      skillMd: SMOKE_SKILL_MD,
    },
    agentInstructions: "Follow the fixed Skill and answer directly.",
    history: [],
    currentInput: "What should a teacher do first when a student asks for help?",
    model: {
      modelId: config.llmModel,
      temperature: 0,
      maxOutputTokens: 256,
      thinkingLevel: "off",
    },
    limits: {
      timeoutMs: 60_000,
      maxModelCalls: 2,
    },
  }, (event) => {
    eventTypes.push(event.type);
  });

  const passed = result.status === "completed"
    && result.text.trim().length > 0
    && result.providerRegistryId !== null
    && result.responseModelId !== null
    && result.evidence.skillInjected
    && result.evidence.cleanupCompleted;

  console.log(JSON.stringify({
    check: "formal_pi_adapter_provider_smoke",
    runId,
    status: result.status,
    requestedModelId: result.requestedModelId,
    providerRegistryId: result.providerRegistryId,
    responseModelId: result.responseModelId,
    outputChars: result.text.length,
    skillInjected: result.evidence.skillInjected,
    cleanupCompleted: result.evidence.cleanupCompleted,
    modelRequestAttemptCount: result.evidence.modelRequestAttemptCount,
    modelRequestCount: result.evidence.modelRequestCount,
    eventTypes,
    errorCode: result.error?.code ?? null,
    passed,
  }));

  if (!passed) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  console.error(JSON.stringify({
    check: "formal_pi_adapter_provider_smoke",
    status: "failed",
    reason: error instanceof Error ? error.name : "UNKNOWN_ERROR",
  }));
  process.exitCode = 1;
});
