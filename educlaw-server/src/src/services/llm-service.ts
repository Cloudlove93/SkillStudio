import { config } from "../config.js";
import { parseJsonObject } from "../utils/json.js";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatRequestInput {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  temperature?: number;
}

function buildMessages(input: ChatRequestInput): ChatMessage[] {
  return [
    { role: "system", content: input.systemPrompt },
    { role: "user", content: input.userPrompt },
  ];
}

async function createChatResponse(input: ChatRequestInput, stream: boolean): Promise<Response> {
  if (!config.llmApiKey) {
    throw new Error("尚未配置 LLM_API_KEY");
  }

  const response = await fetch(`${config.llmBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.llmApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model || config.llmModel,
      temperature: input.temperature ?? 0.3,
      messages: buildMessages(input),
      stream,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`模型请求失败：${response.status} ${text}`);
  }

  return response;
}

async function readChatText(response: Response): Promise<string> {
  const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content?.trim() || "";
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

export async function generateJson<T>(input: ChatRequestInput) {
  const raw = await generateText(input);
  return parseJsonObject<T>(raw);
}

export function resolveBaselineModel(preferred?: string) {
  return preferred || config.llmBaselineModel || config.llmModel;
}