import { config } from "../config.js";
import { safeError, truncateForLog } from "../lib/logger.js";
import { getLogger } from "../lib/request-context.js";
import { parseJsonObject } from "../utils/json.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type ThinkingMode = "enabled" | "disabled";

export type LlmStreamPart =
  | { type: "reasoning"; delta: string }
  | { type: "content"; delta: string };

interface ChatRequestInput {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  hidePromptContentInLogs?: boolean;
  thinkingMode?: ThinkingMode;
}

export interface MultimodalJsonRequestInput {
  systemPrompt: string;
  userPrompt: string;
  images: Array<{
    imageUrl: string;
    detail?: "low" | "high" | "auto";
  }>;
  model?: string;
  maxTokens?: number;
}

const MAX_INLINE_IMAGE_BYTES = 8 * 1024 * 1024;
const INLINE_IMAGE_PATTERN = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

function isValidMultimodalImageUrl(value: string): boolean {
  const inlineMatch = INLINE_IMAGE_PATTERN.exec(value);
  if (inlineMatch) {
    const base64 = inlineMatch[1]!;
    if (base64.length % 4 !== 0) return false;
    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
    const decodedBytes = (base64.length / 4) * 3 - padding;
    return decodedBytes > 0 && decodedBytes <= MAX_INLINE_IMAGE_BYTES;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === 'https:' || parsed.protocol === 'http:';
}

export class LlmInvalidJsonError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LlmInvalidJsonError";
  }
}

export class LlmOutputTruncatedError extends Error {
  constructor(message = "LLM output token limit was exhausted before usable content was returned") {
    super(message);
    this.name = "LlmOutputTruncatedError";
  }
}

const STRICT_JSON_CONTRACT = [
  "Strict JSON output contract:",
  "1. Return exactly one JSON object and nothing else.",
  "2. Do not wrap the JSON in Markdown fences.",
  "3. Do not include comments, explanatory text, or trailing commas.",
  "4. Use double quotes for every key and string value.",
  "5. Inside string values, escape newlines as \\n, quotes as \\\", and backslashes as \\\\.",
  "6. Never place raw multi-line Markdown directly inside JSON strings.",
].join("\n");

function buildMessages(input: ChatRequestInput): ChatMessage[] {
  return [
    { role: "system", content: input.systemPrompt },
    { role: "user", content: input.userPrompt },
  ];
}

function withStrictJsonContract(input: ChatRequestInput): ChatRequestInput {
  return {
    ...input,
    systemPrompt: [STRICT_JSON_CONTRACT, input.systemPrompt].join("\n\n"),
    userPrompt: [
      input.userPrompt,
      "",
      "Before sending the final answer, validate mentally that it is accepted by JSON.parse.",
      STRICT_JSON_CONTRACT,
    ].join("\n"),
  };
}

function llmLogger(bindings?: Record<string, unknown>) {
  return getLogger({ component: "llm", ...(bindings || {}) });
}

function logLlmRequestStart(
  kind: string,
  messages: ChatMessage[],
  model: string,
  stream: boolean,
  maxTokens?: number,
  hidePromptContentInLogs = false,
) {
  llmLogger().info({
    event: "llm.request.start",
    kind,
    model,
    stream,
    maxTokens,
    timeoutMs: config.llmTimeoutMs,
    messageCount: messages.length,
    totalChars: messages.reduce((sum, message) => sum + message.content.length, 0),
    baseUrl: config.llmBaseUrl,
    messages: messages.map((message, index) => ({
      index,
      role: message.role,
      content: hidePromptContentInLogs ? "[redacted]" : truncateForLog(message.content, 400),
    })),
  });
}

function logLlmResponseMeta(kind: string, model: string, response: Response) {
  llmLogger().info({
    event: "llm.response.meta",
    kind,
    model,
    status: response.status,
    ok: response.ok,
  });
}

function logLlmTextResult(
  kind: string,
  model: string,
  content: string,
  hidePromptContentInLogs = false,
) {
  llmLogger().info({
    event: "llm.response.text",
    kind,
    model,
    outputChars: content.length,
    outputPreview: hidePromptContentInLogs ? "[redacted]" : truncateForLog(content, 500),
  });
}

function createAbortSignal(timeoutMs: number): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signal = controller.signal;
  signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
  return signal;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorCause(error: unknown): { message?: string; code?: string } {
  const cause = error instanceof Error ? error.cause : undefined;
  if (cause && typeof cause === "object") {
    const record = cause as { message?: unknown; code?: unknown };
    return {
      message: typeof record.message === "string" ? record.message : undefined,
      code: typeof record.code === "string" ? record.code : undefined,
    };
  }
  return {};
}

function describeFetchFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const cause = getErrorCause(error);
  const detail = [cause.code, cause.message].filter(Boolean).join(" ");
  return detail ? `${message} (${detail})` : message;
}

function shouldRetryFetchFailure(error: unknown): boolean {
  if (error instanceof Error && error.name === "AbortError") return false;
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  const cause = getErrorCause(error);
  const code = cause.code || "";
  return (
    message.includes("fetch failed") ||
    message.includes("network") ||
    ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN", "ENOTFOUND", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET"].includes(code)
  );
}

async function fetchWithNetworkRetry(
  url: string,
  init: RequestInit,
  context: { kind: string; model: string; stream: boolean },
): Promise<Response> {
  const retries = Math.max(0, config.llmNetworkRetries);
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetch(url, init);
    } catch (error) {
      lastError = error;
      if (error instanceof Error && error.name === "AbortError") {
        llmLogger().error({
          event: "llm.request.timeout",
          ...context,
          timeoutMs: config.llmTimeoutMs,
          error: safeError(error),
        });
        throw new Error(`LLM request timed out after ${Math.round(config.llmTimeoutMs / 1000)} seconds`, { cause: error });
      }

      const retryable = shouldRetryFetchFailure(error);
      llmLogger().warn({
        event: "llm.request.retry",
        ...context,
        attempt: attempt + 1,
        retries,
        retryable,
        error: describeFetchFailure(error),
        detail: safeError(error),
      });

      if (!retryable || attempt >= retries) break;
      await sleep(750 * (attempt + 1));
    }
  }

  throw new Error(`LLM network request failed: ${describeFetchFailure(lastError)}. Please verify LLM_BASE_URL, LLM_MODEL, and network connectivity.`);
}

function usesKimiK25(model: string): boolean {
  return model.toLowerCase() === "kimi-k2.5";
}

function usesKimiK26(model: string): boolean {
  return model.toLowerCase() === "kimi-k2.6";
}

export function supportsExplicitThinking(model?: string): boolean {
  const resolvedModel = model || config.llmModel;
  return usesKimiK25(resolvedModel) || usesKimiK26(resolvedModel);
}

function buildChatCompletionBody(
  model: string,
  messages: ChatMessage[],
  stream: boolean,
  temperature?: number,
  maxTokens?: number,
  thinkingMode?: ThinkingMode,
) {
  const body: Record<string, unknown> = {
    model,
    messages,
    stream,
    ...(maxTokens ? { max_tokens: maxTokens } : {}),
  };

  if (usesKimiK25(model) || usesKimiK26(model)) {
    body.thinking = { type: thinkingMode ?? "disabled" };
    return body;
  }

  body.temperature = temperature ?? 0.3;
  return body;
}

async function createChatResponse(input: ChatRequestInput, stream: boolean): Promise<Response> {
  if (!config.llmApiKey) {
    throw new Error("LLM_API_KEY is not configured");
  }

  const messages = buildMessages(input);
  const model = input.model || config.llmModel;
  logLlmRequestStart(
    "prompt",
    messages,
    model,
    stream,
    input.maxTokens,
    input.hidePromptContentInLogs,
  );

  const response = await fetchWithNetworkRetry(
    `${config.llmBaseUrl}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.llmApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildChatCompletionBody(
        model,
        messages,
        stream,
        input.temperature,
        input.maxTokens,
        input.thinkingMode,
      )),
      signal: createAbortSignal(config.llmTimeoutMs),
    },
    { kind: "prompt", model, stream },
  );

  logLlmResponseMeta("prompt", model, response);

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`LLM request failed: ${response.status}`);
  }

  return response;
}

async function createChatResponseMessages(messages: ChatMessage[], model?: string, temperature?: number, stream = false): Promise<Response> {
  if (!config.llmApiKey) {
    throw new Error("LLM_API_KEY is not configured");
  }

  const resolvedModel = model || config.llmModel;
  logLlmRequestStart("messages", messages, resolvedModel, stream);

  const response = await fetchWithNetworkRetry(
    `${config.llmBaseUrl}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.llmApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildChatCompletionBody(resolvedModel, messages, stream, temperature)),
      signal: createAbortSignal(config.llmTimeoutMs),
    },
    { kind: "messages", model: resolvedModel, stream },
  );

  logLlmResponseMeta("messages", resolvedModel, response);

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`LLM request failed: ${response.status}`);
  }

  return response;
}

async function readChatParts(response: Response): Promise<{
  content: string;
  reasoningContent: string;
  finishReason?: string;
}> {
  const json = await response.json() as {
    choices?: Array<{
      finish_reason?: string;
      message?: { content?: string | null; reasoning_content?: string | null };
    }>;
  };
  const choice = json.choices?.[0];
  return {
    content: choice?.message?.content?.trim() || "",
    reasoningContent: choice?.message?.reasoning_content?.trim() || "",
    finishReason: choice?.finish_reason,
  };
}

async function readChatText(response: Response): Promise<string> {
  const result = await readChatParts(response);
  const content = result.content;
  if (!content && result.finishReason === "length") {
    throw new LlmOutputTruncatedError();
  }
  return content;
}

export async function generateText(input: ChatRequestInput) {
  const response = await createChatResponse(input, false);
  const text = await readChatText(response);
  logLlmTextResult("prompt", input.model || config.llmModel, text, input.hidePromptContentInLogs);
  return text;
}

export async function* streamTextParts(
  input: ChatRequestInput,
): AsyncGenerator<LlmStreamPart> {
  const response = await createChatResponse(input, true);
  const contentType = response.headers.get("content-type") || "";
  const output: string[] = [];

  if (!contentType.includes("text/event-stream") || !response.body) {
    const result = await readChatParts(response);
    if (!result.content && result.finishReason === "length") {
      throw new LlmOutputTruncatedError();
    }
    if (result.reasoningContent) {
      yield { type: "reasoning", delta: result.reasoningContent };
    }
    if (result.content) {
      output.push(result.content);
      yield { type: "content", delta: result.content };
    }
    logLlmTextResult(
      "prompt-stream-fallback",
      input.model || config.llmModel,
      output.join(""),
      input.hidePromptContentInLogs,
    );
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";

    for (const part of parts) {
      for (const line of part.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const parsed = JSON.parse(payload) as {
            choices?: Array<{
              delta?: {
                content?: unknown;
                reasoning_content?: unknown;
              };
            }>;
          };
          const delta = parsed.choices?.[0]?.delta;
          if (
            typeof delta?.reasoning_content === "string"
            && delta.reasoning_content.length > 0
          ) {
            yield { type: "reasoning", delta: delta.reasoning_content };
          }
          if (typeof delta?.content === "string" && delta.content.length > 0) {
            output.push(delta.content);
            yield { type: "content", delta: delta.content };
          }
        } catch {
          // ignore malformed chunks
        }
      }
    }
  }

  logLlmTextResult(
    "prompt-stream",
    input.model || config.llmModel,
    output.join(""),
    input.hidePromptContentInLogs,
  );
}

export async function* streamText(input: ChatRequestInput): AsyncGenerator<string> {
  for await (const part of streamTextParts(input)) {
    if (part.type === "content") yield part.delta;
  }
}

export async function generateChat(messages: ChatMessage[], model?: string, temperature?: number): Promise<string> {
  const response = await createChatResponseMessages(messages, model, temperature, false);
  const text = await readChatText(response);
  logLlmTextResult("messages", model || config.llmModel, text);
  return text;
}

export async function* streamChat(messages: ChatMessage[], model?: string, temperature?: number): AsyncGenerator<string> {
  const response = await createChatResponseMessages(messages, model, temperature, true);
  const contentType = response.headers.get("content-type") || "";
  const output: string[] = [];

  if (!contentType.includes("text/event-stream") || !response.body) {
    const text = await readChatText(response);
    if (text) {
      output.push(text);
      yield text;
    }
    logLlmTextResult("messages-stream-fallback", model || config.llmModel, output.join(""));
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";

    for (const part of parts) {
      for (const line of part.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const parsed = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const delta = parsed.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) {
            output.push(delta);
            yield delta;
          }
        } catch {
          // ignore malformed chunks
        }
      }
    }
  }

  logLlmTextResult("messages-stream", model || config.llmModel, output.join(""));
}

export async function generateJson<T>(
  input: ChatRequestInput,
  retries = 0,
  repairInvalidJson = true,
): Promise<T> {
  let lastError: Error | undefined;
  const jsonInput = withStrictJsonContract(input);
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const raw = await generateText(jsonInput);
      try {
        return parseJsonObject<T>(raw);
      } catch (parseError) {
        llmLogger().warn({
          event: "llm.response.invalid_json",
          model: jsonInput.model || config.llmModel,
          attempt: attempt + 1,
          error: parseError instanceof Error ? parseError.message : String(parseError),
          preview: jsonInput.hidePromptContentInLogs ? "[redacted]" : truncateForLog(raw, 500),
        });
        if (!repairInvalidJson) {
          throw new LlmInvalidJsonError("Model returned invalid JSON", {
            cause: parseError,
          });
        }
        return await repairJsonOutput<T>(jsonInput, raw, parseError);
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (lastError instanceof LlmOutputTruncatedError) {
        throw lastError;
      }
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }
  if (lastError instanceof LlmInvalidJsonError) throw lastError;
  throw new Error(`JSON generation failed: ${lastError?.message || "model did not return parseable JSON"}`);
}

export async function generateMultimodalJson<T>(
  input: MultimodalJsonRequestInput,
): Promise<T> {
  if (!config.llmApiKey) {
    throw new Error("LLM_API_KEY is not configured");
  }
  if (input.images.length < 1 || input.images.length > 16) {
    throw new Error("Multimodal image count is invalid");
  }
  for (const image of input.images) {
    if (!isValidMultimodalImageUrl(image.imageUrl)) {
      throw new Error("Multimodal image URL is invalid");
    }
  }

  const model = input.model || config.llmModel;
  const userText = [
    input.userPrompt,
    "",
    "Before sending the final answer, validate mentally that it is accepted by JSON.parse.",
    STRICT_JSON_CONTRACT,
  ].join("\n");
  const messages = [
    {
      role: "system",
      content: [STRICT_JSON_CONTRACT, input.systemPrompt].join("\n\n"),
    },
    {
      role: "user",
      content: [
        { type: "text", text: userText },
        ...input.images.map((image) => ({
          type: "image_url",
          image_url: {
            url: image.imageUrl,
            detail: image.detail ?? "high",
          },
        })),
      ],
    },
  ];

  llmLogger().info({
    event: "llm.request.start",
    kind: "multimodal-json",
    model,
    stream: false,
    maxTokens: input.maxTokens,
    timeoutMs: config.llmTimeoutMs,
    messageCount: messages.length,
    imageCount: input.images.length,
    baseUrl: config.llmBaseUrl,
    messages: "[redacted]",
  });

  const body: Record<string, unknown> = {
    model,
    messages,
    stream: false,
    ...(input.maxTokens ? { max_tokens: input.maxTokens } : {}),
  };
  if (usesKimiK25(model) || usesKimiK26(model)) {
    body.thinking = { type: "disabled" };
  } else {
    body.temperature = 0;
  }

  const response = await fetchWithNetworkRetry(
    `${config.llmBaseUrl}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.llmApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: createAbortSignal(config.llmTimeoutMs),
    },
    { kind: "multimodal-json", model, stream: false },
  );
  logLlmResponseMeta("multimodal-json", model, response);
  if (!response.ok) {
    throw new Error(`LLM multimodal request failed: ${response.status}`);
  }
  const raw = await readChatText(response);
  logLlmTextResult("multimodal-json", model, raw, true);
  try {
    return parseJsonObject<T>(raw);
  } catch (error) {
    throw new LlmInvalidJsonError("Model returned invalid multimodal JSON", {
      cause: error,
    });
  }
}

export function resolveBaselineModel(preferred?: string) {
  return preferred || config.llmBaselineModel || config.llmModel;
}

export function resolveEnhancedModel(preferred?: string) {
  return preferred || config.llmModel;
}

async function repairJsonOutput<T>(
  input: ChatRequestInput,
  raw: string,
  parseError: unknown,
): Promise<T> {
  const repaired = await generateText({
    model: input.model,
    temperature: 0,
    maxTokens: input.maxTokens,
    systemPrompt: [
      "You repair invalid JSON.",
      "Return one strict JSON object only.",
      "Do not add Markdown fences, comments, or explanation.",
      "Preserve the original keys and content.",
      "Escape all newlines, quotes, and backslashes inside string values.",
      STRICT_JSON_CONTRACT,
    ].join("\n"),
    userPrompt: [
      "The following model output was expected to be JSON, but JSON.parse failed.",
      `Parse error: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
      "",
      "Repair it into strict JSON:",
      raw,
    ].join("\n"),
    hidePromptContentInLogs: input.hidePromptContentInLogs,
  });

  try {
    return parseJsonObject<T>(repaired);
  } catch (repairError) {
    throw new Error(`Model returned invalid JSON and automatic repair also failed: ${repairError instanceof Error ? repairError.message : String(repairError)}`, { cause: repairError });
  }
}
