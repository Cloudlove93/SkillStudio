import {
  createModels,
  createProvider,
  type ApiKeyAuth,
  type Model,
} from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { config } from "../config.js";
import { supportsModelExplicitThinking } from "../lib/llm-model-capabilities.js";
import type { HarnessModelRequest } from "./contracts.js";

const PROVIDER_ID = "educlaw-configured";
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 8_192;
const MAX_PROVIDER_RETRIES = 3;

export function resolveProviderMaxRetries(
  value: unknown = config.llmNetworkRetries,
): number {
  const parsed = typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : 2;
  return Math.min(MAX_PROVIDER_RETRIES, Math.max(0, parsed));
}

export interface PiProviderRuntime {
  model: Model<"openai-completions">;
  /** Internal Pi provider registry identifier, not the upstream vendor name. */
  providerRegistryId: string;
  requestedModelId: string;
  streamFn: StreamFn;
}

export interface PiProviderSettings {
  apiKey: string;
  baseUrl: string;
}

export class PiProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PiProviderConfigurationError";
  }
}

function createServerApiKeyAuth(apiKey: string): ApiKeyAuth {
  return {
    name: "EduSkill server API key",
    check: async () => apiKey ? { source: "server-config", type: "api_key" } : undefined,
    resolve: async () => apiKey
      ? { auth: { apiKey }, source: "server-config" }
      : undefined,
  };
}

function createModel(
  request: HarnessModelRequest,
  baseUrl: string,
): Model<"openai-completions"> {
  return {
    id: request.modelId,
    name: request.modelId,
    api: "openai-completions",
    provider: PROVIDER_ID,
    baseUrl,
    reasoning: supportsModelExplicitThinking(request.modelId),
    compat: { supportsReasoningEffort: false },
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    samplingParams: supportsModelExplicitThinking(request.modelId) || request.temperature === undefined
      ? undefined
      : { temperature: request.temperature },
  };
}

export function createPiProviderRuntime(
  request: HarnessModelRequest,
  settings: PiProviderSettings = {
    apiKey: config.llmApiKey,
    baseUrl: config.llmBaseUrl,
  },
): PiProviderRuntime {
  if (!settings.apiKey) {
    throw new PiProviderConfigurationError("LLM_API_KEY is not configured");
  }
  const model = createModel(request, settings.baseUrl);
  const provider = createProvider({
    id: PROVIDER_ID,
    name: "EduSkill configured provider",
    baseUrl: settings.baseUrl,
    auth: { apiKey: createServerApiKeyAuth(settings.apiKey) },
    models: [model],
    api: openAICompletionsApi(),
  });
  const models = createModels();
  models.setProvider(provider);
  const streamSimple = models.streamSimple.bind(models);
  const providerMaxRetries = resolveProviderMaxRetries();
  const streamFn: StreamFn = (selectedModel, context, options) => streamSimple(
    selectedModel,
    context,
    {
      ...options,
      // The Pi SDK retries only transport failures plus 408/409/429/5xx.
      // It also honors AbortSignal while waiting between attempts, so user
      // cancellation and the outer run timeout remain authoritative.
      maxRetries: providerMaxRetries,
      onPayload: async (payload, model) => {
        const transformed = await options?.onPayload?.(payload, model) ?? payload;
        if (!supportsModelExplicitThinking(model.id)) return transformed;
        // Kimi defaults to thinking and rejects the shared temperature. Apply
        // compatibility after SDK serialization and any upstream payload hook.
        const body = { ...(transformed as Record<string, unknown>) };
        delete body.temperature;
        delete body.reasoning_effort;
        body.thinking = {
          type: request.thinkingLevel && request.thinkingLevel !== "off" ? "enabled" : "disabled",
        };
        return body;
      },
    },
  );
  return {
    model,
    providerRegistryId: PROVIDER_ID,
    requestedModelId: model.id,
    streamFn,
  };
}
