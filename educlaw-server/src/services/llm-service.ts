import { config } from "../config.js";
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

function logLlmRequestStart(
  kind: string,
  messages: ChatMessage[],
  model: string,
  stream: boolean,
  maxTokens?: number,
) {
  console.log("[llm] request start", {
    kind,
    model,
    stream,
    maxTokens,
    timeoutMs: config.llmTimeoutMs,
    messageCount: messages.length,
    totalChars: messages.reduce((sum, message) => sum + message.content.length, 0),
    baseUrl: config.llmBaseUrl,
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
        console.error("[llm] request timeout", {
          ...context,
          timeoutMs: config.llmTimeoutMs,
        });
        throw new Error(`模型请求超时：超过 ${Math.round(config.llmTimeoutMs / 1000)} 秒未返回`);
      }

      const retryable = shouldRetryFetchFailure(error);
      console.warn("[llm] network request failed", {
        ...context,
        attempt: attempt + 1,
        retries,
        retryable,
        error: describeFetchFailure(error),
      });

      if (!retryable || attempt >= retries) break;
      await sleep(750 * (attempt + 1));
    }
  }

  throw new Error(`模型网络请求失败：${describeFetchFailure(lastError)}。请稍后重试，或在服务器运行 scripts/test-llm-api.sh 检查 LLM_BASE_URL / LLM_MODEL / 网络连通性。`);
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
    throw new Error("尚未配置 LLM_API_KEY");
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

  console.log("[llm] response received", { kind: "prompt", model, status: response.status, ok: response.ok });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`模型请求失败：${response.status} ${text}`);
  }

  return response;
}

async function createChatResponseMessages(messages: ChatMessage[], model?: string, temperature?: number, stream = false): Promise<Response> {
  if (!config.llmApiKey) {
    throw new Error("尚未配置 LLM_API_KEY");
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

  console.log("[llm] response received", { kind: "messages", model: resolvedModel, status: response.status, ok: response.ok });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`模型请求失败：${response.status} ${text}`);
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
    throw new Error("模型输出达到长度限制但没有返回正文，请减少生成内容或提高 max_tokens");
  }
  return content;
}

export async function generateText(input: ChatRequestInput) {
  const response = await createChatResponse(input, false);
  return readChatText(response);
}

export async function* streamText(input: ChatRequestInput): AsyncGenerator<string> {
  const response = await createChatResponse(input, true);
  const contentType = response.headers.get("content-type") || "";

  if (!contentType.includes("text/event-stream") || !response.body) {
    const text = await readChatText(response);
    if (text) yield text;
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
            yield delta;
          }
        } catch {
          // ignore malformed chunks
        }
      }
    }
  }
}

export async function generateChat(messages: ChatMessage[], model?: string, temperature?: number): Promise<string> {
  const response = await createChatResponseMessages(messages, model, temperature, false);
  return readChatText(response);
}

export async function* streamChat(messages: ChatMessage[], model?: string, temperature?: number): AsyncGenerator<string> {
  const response = await createChatResponseMessages(messages, model, temperature, true);
  const contentType = response.headers.get("content-type") || "";

  if (!contentType.includes("text/event-stream") || !response.body) {
    const text = await readChatText(response);
    if (text) yield text;
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
            yield delta;
          }
        } catch {
          // ignore malformed chunks
        }
      }
    }
  }
}

export async function generateJson<T>(input: ChatRequestInput, retries = 1): Promise<T> {
  let lastError: Error | undefined;
  const jsonInput = withStrictJsonContract(input);
  for (let attempt = 0; attempt <= retries; attempt++) {
    let raw = "";
    try {
      raw = await generateText(jsonInput);
      try {
        return parseJsonObject<T>(raw);
      } catch (parseError) {
        console.warn("[llm] invalid json output", {
          model: jsonInput.model || config.llmModel,
          attempt: attempt + 1,
          error: parseError instanceof Error ? parseError.message : String(parseError),
          preview: raw.slice(0, 500),
        });
        return await repairJsonOutput<T>(jsonInput, raw, parseError);
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < retries) {
        // Brief delay before retry
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }
  throw new Error(`JSON 生成失败：${lastError?.message || "模型未返回可解析的 JSON"}`);
}

export function resolveBaselineModel(preferred?: string) {
  return preferred || config.llmBaselineModel || config.llmModel;
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
    throw new Error(
      `模型返回的 JSON 格式无效，自动修复也失败：${repairError instanceof Error ? repairError.message : String(repairError)}`,
    );
  }
}
