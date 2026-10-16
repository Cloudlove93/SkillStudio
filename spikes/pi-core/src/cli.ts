import { randomUUID } from "node:crypto";
import { runAbortProbe } from "./abort-probe.js";
import { loadEduclawLlmEnvironment, readSpikeLlmConfig } from "./env.js";
import { fixtureSkillRoot } from "./paths.js";
import { createProviderRuntime, probeProviderText } from "./provider-runtime.js";
import { logSafeEvent } from "./safe-logger.js";
import { runAgentSpike } from "./spike-runner.js";

type Mode = "abort" | "agent" | "provider";

function parseMode(value: string | undefined): Mode {
  if (value === "abort" || value === "agent" || value === "provider") return value;
  throw new Error("USAGE: provider | agent | abort");
}

async function main(): Promise<void> {
  const mode = parseMode(process.argv[2]);
  await loadEduclawLlmEnvironment();
  const config = readSpikeLlmConfig();
  const runtime = createProviderRuntime(config);
  if (mode === "provider") {
    const result = await probeProviderText(runtime, randomUUID());
    logSafeEvent("provider.probe.end", result.runId, {
      modelId: result.modelId,
      outputChars: result.outputChars,
      providerId: result.providerId,
      status: result.status,
    });
    if (result.status !== "completed") process.exitCode = 1;
    return;
  }
  if (mode === "abort") {
    const result = await runAbortProbe(runtime);
    logSafeEvent("agent.abort.end", result.runId, {
      errorCode: result.errorCode,
      resourceCleaned: result.resourceCleaned,
      status: result.status,
    });
    if (result.status !== "cancelled" || !result.resourceCleaned) process.exitCode = 1;
    return;
  }
  const result = await runAgentSpike({
    runtime,
    skillRoot: fixtureSkillRoot(),
    logEvents: true,
  });
  if (
    result.status !== "completed" ||
    !result.markerObserved ||
    result.toolCallCount < 1 ||
    result.toolResultCount < 1 ||
    !result.resourceCleaned
  ) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  const code = error instanceof Error && /^[A-Z0-9_:-]+$/u.test(error.message)
    ? error.message
    : "SPIKE_UNEXPECTED_FAILURE";
  logSafeEvent("spike.failed", randomUUID(), { code });
  process.exitCode = 1;
});
