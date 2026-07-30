import { config } from "../config.js";
import { safeError, truncateForLog } from "../lib/logger.js";
import { getLogger } from "../lib/request-context.js";
import { parseJsonObject } from "../utils/json.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatRequestInput {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export class LlmInvalidJsonError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LlmInvalidJsonError";
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
      content: truncateForLog(message.content, 400),
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

function logLlmTextResult(kind: string, model: string, content: string) {
  llmLogger().info({
    event: "llm.response.text",
    kind,
    model,
    outputChars: content.length,
    outputPreview: truncateForLog(content, 500),
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

function buildChatCompletionBody(
  model: string,
  messages: ChatMessage[],
  stream: boolean,
  temperature?: number,
  maxTokens?: number,
) {
  const body: Record<string, unknown> = {
    model,
    messages,
    stream,
    ...(maxTokens ? { max_tokens: maxTokens } : {}),
  };

  if (usesKimiK26(model)) {
    body.thinking = { type: "disabled" };
    return body;
  }

  if (usesKimiK25(model)) {
    body.temperature = 1;
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
  logLlmRequestStart("prompt", messages, model, stream, input.maxTokens);

  const response = await fetchWithNetworkRetry(
    `${config.llmBaseUrl}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.llmApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildChatCompletionBody(model, messages, stream, input.temperature, input.maxTokens)),
      signal: createAbortSignal(config.llmTimeoutMs),
    },
    { kind: "prompt", model, stream },
  );

  logLlmResponseMeta("prompt", model, response);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM request failed: ${response.status} ${text}`);
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
    const text = await response.text();
    throw new Error(`LLM request failed: ${response.status} ${text}`);
  }

  return response;
}

async function readChatText(response: Response): Promise<string> {
  const json = await response.json() as {
    choices?: Array<{
      finish_reason?: string;
      message?: { content?: string | null; reasoning_content?: string | null };
    }>;
  };
  const choice = json.choices?.[0];
  const content = choice?.message?.content?.trim() || "";
  if (!content && choice?.finish_reason === "length") {
    throw new Error("LLM output hit the length limit without returning usable content");
  }
  return content;
}

export async function generateText(input: ChatRequestInput) {
  const response = await createChatResponse(input, false);
  const text = await readChatText(response);
  logLlmTextResult("prompt", input.model || config.llmModel, text);
  return text;
}

export async function* streamText(input: ChatRequestInput): AsyncGenerator<string> {
  const response = await createChatResponse(input, true);
  const contentType = response.headers.get("content-type") || "";
  const output: string[] = [];

  if (!contentType.includes("text/event-stream") || !response.body) {
    const text = await readChatText(response);
    if (text) {
      output.push(text);
      yield text;
    }
    logLlmTextResult("prompt-stream-fallback", input.model || config.llmModel, output.join(""));
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

  logLlmTextResult("prompt-stream", input.model || config.llmModel, output.join(""));
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
  retries = 1,
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
          preview: truncateForLog(raw, 500),
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
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }
  if (lastError instanceof LlmInvalidJsonError) throw lastError;
  throw new Error(`JSON generation failed: ${lastError?.message || "model did not return parseable JSON"}`);
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
  });

  try {
    return parseJsonObject<T>(repaired);
  } catch (repairError) {
    throw new Error(`Model returned invalid JSON and automatic repair also failed: ${repairError instanceof Error ? repairError.message : String(repairError)}`, { cause: repairError });
  }
}
