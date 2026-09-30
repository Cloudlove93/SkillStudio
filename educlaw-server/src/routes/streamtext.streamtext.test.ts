import { afterEach, describe, expect, it, vi } from "vitest";

const testConfig = {
  llmTimeoutMs: 1_000,
  llmBaseUrl: "https://api.innospark.cn/v1",
  llmApiKey: "test-api-key",
  llmModel: "test-model",
  llmNetworkRetries: 0,
  llmBaselineModel: "baseline-model",
};

async function loadService() {
  vi.resetModules();
  vi.doMock("../config.js", () => ({
    config: testConfig,
  }));
  return import("../services/llm-service.js");
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

describe("streamText", () => {
  it("posts a streaming chat completion request and yields SSE content deltas", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockStreamResponse([
      'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
      "data: [DONE]\n\n",
    ]));
    vi.stubGlobal("fetch", fetchMock);

    const { streamText } = await loadService();
    const chunks: string[] = [];
    for await (const chunk of streamText({
      systemPrompt: "你是测试助手",
      userPrompt: "打招呼",
      model: "custom-model",
      temperature: 0.5,
      maxTokens: 128,
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["你", "好"]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      `${testConfig.llmBaseUrl}/chat/completions`,
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: `Bearer ${testConfig.llmApiKey}`,
          "Content-Type": "application/json",
        },
      }),
    );

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body).toMatchObject({
      model: "custom-model",
      stream: true,
      temperature: 0.5,
      max_tokens: 128,
      messages: [
        { role: "system", content: "你是测试助手" },
        { role: "user", content: "打招呼" },
      ],
    });
  });
});
