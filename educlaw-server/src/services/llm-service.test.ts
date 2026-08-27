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

async function loadServiceWithLogger(
  configOverrides: Partial<typeof baseConfig> = {},
) {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  vi.resetModules();
  vi.doMock("../config.js", () => ({
    config: {
      ...baseConfig,
      ...configOverrides,
    },
  }));
  vi.doMock("../lib/request-context.js", () => ({
    getLogger: vi.fn(() => logger),
  }));
  return {
    logger,
    service: await import("./llm-service.js"),
  };
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

function mockTruncatedThinkingResponse() {
  return new Response(
    JSON.stringify({
      choices: [{
        finish_reason: "length",
        message: { content: null, reasoning_content: "internal reasoning" },
      }],
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
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
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.doUnmock("../config.js");
  vi.doUnmock("../lib/request-context.js");
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
      "data: malformed-json\n\n",
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

  it("automatically recovers from two transient network resets", async () => {
    vi.useFakeTimers();
    const resetError = () => new Error("fetch failed", {
      cause: { code: "ECONNRESET" },
    });
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(resetError())
      .mockRejectedValueOnce(resetError())
      .mockResolvedValueOnce(mockChatResponse('{"ok":true}'));
    vi.stubGlobal("fetch", fetchMock);
    const { generateJson } = await loadService({ llmNetworkRetries: 2 });

    const resultPromise = generateJson<{ ok: boolean }>({
      systemPrompt: "Return JSON",
      userPrompt: "Give me data",
    });
    await vi.runAllTimersAsync();

    await expect(resultPromise).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("stops automatic network recovery after three total attempts", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockRejectedValue(new Error("fetch failed", {
      cause: { code: "ECONNRESET" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { generateJson } = await loadService({ llmNetworkRetries: 2 });

    const resultPromise = generateJson<{ ok: boolean }>({
      systemPrompt: "Return JSON",
      userPrompt: "Give me data",
    });
    const rejection = expect(resultPromise).rejects.toThrow(
      "LLM network request failed",
    );
    await vi.runAllTimersAsync();

    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("can hide prompt content from logs for multimodal adapters without changing default behavior", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockChatResponse('{"ok":true}')));
    const { logger, service } = await loadServiceWithLogger();

    await service.generateJson<{ ok: boolean }>({
      systemPrompt: "SYSTEM SECRET SENTINEL",
      userPrompt: "TRANSCRIPT SECRET SENTINEL",
      hidePromptContentInLogs: true,
    });

    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("SYSTEM SECRET SENTINEL");
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("TRANSCRIPT SECRET SENTINEL");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockChatResponse('{"ok":true}')));
    const second = await loadServiceWithLogger();
    await second.service.generateJson<{ ok: boolean }>({
      systemPrompt: "VISIBLE SYSTEM SENTINEL",
      userPrompt: "VISIBLE USER SENTINEL",
    });

    expect(JSON.stringify(second.logger.info.mock.calls)).toContain("VISIBLE USER SENTINEL");
  });

  it("sends image URLs as ephemeral multimodal content without logging signed URLs", async () => {
    const signedUrl =
      "https://storage.example.test/frame.png?X-Amz-Signature=secret-sentinel";
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockChatResponse('{"rankings":[]}'));
    vi.stubGlobal("fetch", fetchMock);
    const { logger, service } = await loadServiceWithLogger();

    const result = await service.generateMultimodalJson<{ rankings: unknown[] }>({
      systemPrompt: "Return rankings as JSON",
      userPrompt: "Rank this teaching frame",
      images: [{ imageUrl: signedUrl }],
      model: "kimi-k2.5",
      maxTokens: 512,
    });

    expect(result).toEqual({ rankings: [] });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body).toMatchObject({
      model: "kimi-k2.5",
      stream: false,
      thinking: { type: "disabled" },
      max_tokens: 512,
    });
    expect(body.messages[1].content).toEqual([
      expect.objectContaining({ type: "text" }),
      {
        type: "image_url",
        image_url: { url: signedUrl, detail: "high" },
      },
    ]);
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(signedUrl);
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(signedUrl);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(signedUrl);
  });

  it("accepts a bounded inline teaching image without logging its contents", async () => {
    const dataUrl = `data:image/png;base64,${Buffer.from("small-png-fixture").toString("base64")}`;
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockChatResponse('{"rankings":[]}'));
    vi.stubGlobal("fetch", fetchMock);
    const { logger, service } = await loadServiceWithLogger();

    await service.generateMultimodalJson<{ rankings: unknown[] }>({
      systemPrompt: "Return rankings as JSON",
      userPrompt: "Rank this teaching frame",
      images: [{ imageUrl: dataUrl, detail: "low" }],
      model: "kimi-k2.5",
      maxTokens: 512,
    });

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.messages[1].content[1]).toEqual({
      type: "image_url",
      image_url: { url: dataUrl, detail: "low" },
    });
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(dataUrl);
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(dataUrl);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(dataUrl);
  });

  it("does not repeat a JSON request that exhausted its output limit", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockTruncatedThinkingResponse());
    vi.stubGlobal("fetch", fetchMock);
    const { generateJson } = await loadService();

    await expect(generateJson({
      systemPrompt: "Return JSON",
      userPrompt: "Give me data",
    })).rejects.toThrow("output token limit");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("throws before fetch when LLM_API_KEY is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { generateText } = await loadService({ llmApiKey: "" });

    await expect(generateText({
      systemPrompt: "System",
      userPrompt: "User",
    })).rejects.toThrow("LLM_API_KEY is not configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws with response details when the provider returns a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad request", { status: 400 })));
    const { generateText } = await loadService();

    await expect(generateText({
      systemPrompt: "System",
      userPrompt: "User",
    })).rejects.toThrow("LLM request failed: 400 bad request");
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
    expect(body.temperature).toBeUndefined();
    expect(body.thinking).toEqual({ type: "disabled" });
  });
});
