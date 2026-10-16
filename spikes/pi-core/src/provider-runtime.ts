import {
  contentText,
  createModels,
  createProvider,
  envApiKeyAuth,
  type Model,
  type MutableModels,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import type { SpikeLlmConfig } from "./env.js";
import type { ProviderProbeResult } from "./types.js";

const PROVIDER_ID = "educlaw-configured";

export interface SpikeProviderRuntime {
  models: MutableModels;
  model: Model<"openai-completions">;
  providerId: string;
  modelId: string;
}

export function createProviderRuntime(config: SpikeLlmConfig): SpikeProviderRuntime {
  const model: Model<"openai-completions"> = {
    id: config.modelId,
    name: config.modelId,
    api: "openai-completions",
    provider: PROVIDER_ID,
    baseUrl: config.baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8_192,
    samplingParams: { temperature: 0 },
  };
  const provider = createProvider({
    id: PROVIDER_ID,
    name: "EduSkill configured provider",
    baseUrl: config.baseUrl,
    auth: {
      apiKey: envApiKeyAuth("EduSkill Spike API key", ["LLM_API_KEY"]),
    },
    models: [model],
    api: openAICompletionsApi(),
  });
  const models = createModels();
  models.setProvider(provider);
  return { models, model, providerId: PROVIDER_ID, modelId: model.id };
}

export async function probeProviderText(
  runtime: SpikeProviderRuntime,
  runId: string,
  signal?: AbortSignal,
): Promise<ProviderProbeResult> {
  const response = await runtime.models.completeSimple(
    runtime.model,
    {
      messages: [
        {
          role: "user",
          content: "Reply with a short acknowledgement.",
          timestamp: Date.now(),
        },
      ],
    },
    { signal },
  );
  const text = contentText(response.content);
  const status = response.stopReason === "aborted"
    ? "cancelled"
    : response.stopReason === "error" || text.trim().length === 0
      ? "failed"
      : "completed";
  return {
    runId,
    status,
    providerId: response.provider,
    modelId: response.responseModel ?? response.model,
    outputChars: text.length,
  };
}
