import { afterEach, describe, expect, it, vi } from "vitest";

const geminiModel = "gemini-2.5-flash";
const runIntegration = process.env.RUN_GEMINI_STREAMTEXT_TEST === "1";

async function loadService() {
  vi.resetModules();
  return import("../services/llm-service.js");
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("streamText gemini integration", () => {
  it.skipIf(!runIntegration)(
    "streams text from the configured LLM provider with a Gemini model",
    async () => {
      const { streamText } = await loadService();
      const chunks: string[] = [];

      for await (const chunk of streamText({
        systemPrompt: "你是测试助手。回答必须按照字数要求。",
        userPrompt: "只输出三百个汉字",
        model: geminiModel,
        temperature: 0.1,
        maxTokens: 16000,
      })) {
        // chunk 你好！我是一名专业的测试助手，致力于为您提供高效、全面的测试支持。在软件开发中，测试是确保产品质量和用户满意度的关键。我能协助您应对各类
        // chunk 测试挑战，提升效率。具体而言，我可以帮助您规划测试策略（如需求分析、风险评估、范围界定），制定详尽的测试计划；协助设计和编写高质量的测试用例，覆盖功能、性能、安全、兼容性及用户体验等多个维度，无论是手动还是自动化测试，都能提供最佳
        // chunk 实践指导，确保测试覆盖率和有效性。此外，我还能帮助您建立规范的缺陷报告流程，加速修复，并就测试工具选型、环境搭建、CI/CD中的测试集成提供专业建议。我的目标是帮助您的团队优化测试流程，降低发布风险，最终交付稳定、可靠
        // chunk 、用户满意的软件产品。期待与您携手，共同提升软件质量，实现卓越！

        console.log('chunk', chunk)
        chunks.push(chunk);
      }

      const text = chunks.join("").trim();
      expect(chunks.length).toBeGreaterThan(0);
      expect(text.length).toBeGreaterThan(0);
    },
    60_000,
  );
});
