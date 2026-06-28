import { describe, expect, it } from "vitest";

import {
  buildAgentSystemPrompt,
  buildAgentUserPrompt,
  buildBaseMetadataSystemPrompt,
  buildBaseMetadataUserPrompt,
  buildRubricBoundaryReviewSystemPrompt,
  buildRubricBoundaryReviewUserPrompt,
  buildRubricSystemPrompt,
  buildRubricUserPrompt,
  buildSkillSystemPrompt,
  buildSkillUserPrompt,
} from "./package-generation.js";

describe("package-generation prompts", () => {
  it("builds the base metadata prompt with the schema instructions", () => {
    const prompt = buildBaseMetadataUserPrompt({
      hasInstruction: true,
      instruction:
        "\u4e3a\u4e61\u6751\u5b66\u6821\u8bbe\u8ba1\u4e00\u4e2a\u6210\u957f\u652f\u6301\u667a\u80fd\u4f53",
      documentContext: "[Document 1: notes]\ncontent",
      outputSchemaPrompt: "## JSON schema",
    });

    expect(prompt).toContain("Create a prompt package");
    expect(prompt).toContain("\u4e61\u6751\u5b66\u6821");
    expect(prompt).toContain("## JSON schema");
  });

  it("builds the rubric prompt with the package summary, agent excerpt, and source rubric excerpt", () => {
    const prompt = buildRubricUserPrompt({
      packageName: "EduSkill",
      packageDescription:
        "\u5e2e\u52a9\u6559\u5e08\u6574\u7406\u6280\u80fd\u7684\u667a\u80fd\u4f53",
      agentExcerpt: "# Agent",
      sourceRubricExcerpt:
        "## \u8bc4\u4f30\u6807\u51c6\n### \u6587\u6863\u4fdd\u771f\u5ea6",
    });

    expect(prompt).toContain("rubric.md");
    expect(prompt).toContain("EduSkill");
    expect(prompt).toContain("# Agent");
    expect(prompt).toContain("\u8bc4\u4f30\u6807\u51c6");
    expect(prompt).toContain("preserve its dimensions");
  });

  it("builds the rubric prompt in optimize mode without turning it into interactive optimization", () => {
    const prompt = buildRubricUserPrompt({
      packageName: "EduSkill",
      packageDescription: "帮助教师完成评估配置",
      agentExcerpt: "# Agent",
      rubricDraft: "## 评分维度\n### 角色贴合",
      mode: "optimize",
    });

    expect(prompt).toContain("Optimize the existing rubric.md");
    expect(prompt).toContain("Existing scorable rubric:");
    expect(prompt).toContain("rubric optimization pass");
    expect(prompt).toContain("not an interactive optimization request");
  });

  it("builds the agent prompt with skill metadata and source context", () => {
    const prompt = buildAgentUserPrompt({
      packageName: "EduSkill",
      packageDescription:
        "\u5e2e\u52a9\u6559\u5e08\u6574\u7406\u6280\u80fd\u7684\u667a\u80fd\u4f53",
      skillMetasJson: '[{"dirName":"coaching"}]',
      hasInstruction: false,
      sourceContext: "[Document 1]\ncontent",
    });

    expect(prompt).toContain("Core skills metadata");
    expect(prompt).toContain('[{"dirName":"coaching"}]');
    expect(prompt).toContain("[Document 1]");
  });

  it("builds the skill prompt with sibling metadata and template guidance", () => {
    const prompt = buildSkillUserPrompt({
      packageName: "EduSkill",
      packageDescription:
        "\u5e2e\u52a9\u6559\u5e08\u6574\u7406\u6280\u80fd\u7684\u667a\u80fd\u4f53",
      agentExcerpt: "# Agent",
      rubricExcerpt: "# Rubric",
      documentContext: "[Document 1]\ncontent",
      skillMetaJson: '{"dirName":"coaching"}',
      siblingSkillsJson: '[{"dirName":"planning"}]',
      skillTemplatePrompt: "## Skill template",
    });

    expect(prompt).toContain("Sibling skills metadata");
    expect(prompt).toContain('{"dirName":"coaching"}');
    expect(prompt).toContain("## Skill template");
  });

  it("exposes specialized system prompts for each generation step", () => {
    expect(buildBaseMetadataSystemPrompt()).toContain("strict JSON");
    expect(buildAgentSystemPrompt()).toContain("agent.md");
    expect(buildRubricSystemPrompt()).toContain("rubric");
    expect(buildSkillSystemPrompt()).toContain("SKILL.md");
  });

  it("builds a boundary-review prompt that checks extraction completeness without rewriting", () => {
    const prompt = buildRubricBoundaryReviewUserPrompt({
      documentName: "task.docx",
      extractedRubric:
        "5\u3001\u8bc4\u4ef7\u51c6\u5219\n\u6c9f\u901a\u7b56\u7565\u7684\u9488\u5bf9\u6027 30%",
      leadingContext:
        "\u4e0a\u65b9\u90bb\u8fd1\u6587\u672c\uff1a\u8fd9\u91cc\u8fd8\u6709\u4e00\u884c\u8bc4\u4f30\u8981\u70b9",
      trailingContext:
        "\u4e0b\u65b9\u90bb\u8fd1\u6587\u672c\uff1a\u5206\u7ea7\u63cf\u8ff0\uff08\u4ee5\u6c47\u62a5\u8d28\u91cf\u4e3a\u4f8b\uff09",
    });

    expect(buildRubricBoundaryReviewSystemPrompt()).toContain("boundary reviewer");
    expect(buildRubricBoundaryReviewSystemPrompt()).toContain("strict JSON only");
    expect(prompt).toContain("keep");
    expect(prompt).toContain("expand_up");
    expect(prompt).toContain("expand_down");
    expect(prompt).toContain("expand_both");
    expect(prompt).toContain("Do not rewrite");
    expect(prompt).toContain("boundary judge");
    expect(prompt).toContain("Nearby context above the excerpt");
    expect(prompt).toContain("Nearby context below the excerpt");
    expect(prompt).toContain("actual scoring body");
    expect(prompt).toContain("0 to 6");
    expect(prompt).toContain("\u5206\u7ea7\u63cf\u8ff0");
  });
});
