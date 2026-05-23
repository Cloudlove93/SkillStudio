import { afterEach, describe, expect, it, vi } from "vitest";

const baseConfig = {
  llmTimeoutMs: 1_000,
  llmBaseUrl: "https://llm.example.test/v1",
  llmApiKey: "test-api-key",
  llmModel: "test-model",
  llmNetworkRetries: 0,
  llmBaselineModel: "baseline-model",
};

async function loadService(configOverrides: Partial<typeof baseConfig> = {}) {
  vi.resetModules();
  vi.doMock("../config.js", () => ({
    config: {
      ...baseConfig,
      ...configOverrides,
    },
  }));
  return import("./llm-service.js");
}

function mockChatResponse(content: string, init: ResponseInit = {}) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
      ...init,
    },
  );
}

function mockStreamResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.doUnmock("../config.js");
});


describe("llm-service", () => {

  it("streamText falls back to a normal JSON response when the response is not SSE", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockChatResponse("fallback text")));
    const { streamText } = await loadService();

    const chunks: string[] = [];
    for await (const chunk of streamText({
      systemPrompt: "System",
      userPrompt: "User",
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["fallback text"]);
  });

  it("generateText posts chat completion request and returns trimmed content", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockChatResponse("  Hello EduClaw  "));
    vi.stubGlobal("fetch", fetchMock);
    const { generateText } = await loadService();

    const result = await generateText({
      systemPrompt: "System prompt",
      userPrompt: "User prompt",
      model: "custom-model",
      temperature: 0.7,
      maxTokens: 123,
    });

    expect(result).toBe("Hello EduClaw");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://llm.example.test/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer test-api-key",
          "Content-Type": "application/json",
        },
      }),
    );

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body).toMatchObject({
      model: "custom-model",
      stream: false,
      temperature: 0.7,
      max_tokens: 123,
      messages: [
        { role: "system", content: "System prompt" },
        { role: "user", content: "User prompt" },
      ],
    });
  });

  it("streamText yields content deltas from server-sent event chunks", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockStreamResponse([
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: malformed-json\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
      "data: [DONE]\n\n",
    ])));
    const { streamText } = await loadService();

    const chunks: string[] = [];
    for await (const chunk of streamText({
      systemPrompt: "System",
      userPrompt: "User",
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["Hel", "lo"]);
  });


  it("generateJson parses strict JSON returned by the model", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockChatResponse('{"ok":true,"count":2}'));
    vi.stubGlobal("fetch", fetchMock);
    const { generateJson } = await loadService();

    const result = await generateJson<{ ok: boolean; count: number }>({
      systemPrompt: "Return JSON",
      userPrompt: "Give me data",
    });

    expect(result).toEqual({ ok: true, count: 2 });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.messages[0].content).toContain("Strict JSON output contract");
    expect(body.messages[1].content).toContain("Before sending the final answer");
  });

  it("throws before fetch when LLM_API_KEY is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { generateText } = await loadService({ llmApiKey: "" });

    await expect(generateText({
      systemPrompt: "System",
      userPrompt: "User",
    })).rejects.toThrow("尚未配置 LLM_API_KEY");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws with response details when the provider returns a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad request", { status: 400 })));
    const { generateText } = await loadService();

    await expect(generateText({
      systemPrompt: "System",
      userPrompt: "User",
    })).rejects.toThrow("模型请求失败：400 bad request");
  });

  it("resolveBaselineModel prefers explicit model, then baseline model, then default model", async () => {
    const { resolveBaselineModel } = await loadService();
    expect(resolveBaselineModel("chosen-model")).toBe("chosen-model");
    expect(resolveBaselineModel()).toBe("baseline-model");

    const fallbackService = await loadService({ llmBaselineModel: "" });
    expect(fallbackService.resolveBaselineModel()).toBe("test-model");
  });

  it("uses special request body fields for Kimi models", async () => {
    const fetchMock = vi.fn().mockImplementation(() => mockChatResponse("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const { generateText } = await loadService();

    await generateText({
      systemPrompt: "System",
      userPrompt: "User",
      model: "kimi-k2.6",
      temperature: 0.9,
    });
    let body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.temperature).toBeUndefined();
    expect(body.thinking).toEqual({ type: "disabled" });

    await generateText({
      systemPrompt: "System",
      userPrompt: "User",
      model: "kimi-k2.5",
      temperature: 0.2,
    });
    body = JSON.parse(fetchMock.mock.calls[1]![1].body as string);
    expect(body.temperature).toBe(1);
    expect(body.thinking).toBeUndefined();
  });
});
