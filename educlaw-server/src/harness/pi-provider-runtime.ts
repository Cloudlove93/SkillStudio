import {
  createModels,
  createProvider,
  type ApiKeyAuth,
  type Model,
} from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { config } from "../config.js";
import type { HarnessModelRequest } from "./contracts.js";

const PROVIDER_ID = "educlaw-configured";
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 8_192;
const PROVIDER_MAX_RETRIES = 0;

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
    reasoning: request.thinkingLevel !== undefined && request.thinkingLevel !== "off",
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    samplingParams: request.temperature === undefined
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
  const streamFn: StreamFn = (selectedModel, context, options) => streamSimple(
    selectedModel,
    context,
    { ...options, maxRetries: PROVIDER_MAX_RETRIES },
  );
  return {
    model,
    providerRegistryId: PROVIDER_ID,
    requestedModelId: model.id,
    streamFn,
  };
}
