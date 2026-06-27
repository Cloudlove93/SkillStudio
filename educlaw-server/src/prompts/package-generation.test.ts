import { describe, expect, it } from "vitest";

import {
  buildAgentSystemPrompt,
  buildAgentUserPrompt,
  buildBaseMetadataSystemPrompt,
  buildBaseMetadataUserPrompt,
  buildRubricSystemPrompt,
  buildRubricUserPrompt,
  buildSkillSystemPrompt,
  buildSkillUserPrompt,
} from "./package-generation.js";

describe("package-generation prompts", () => {
  it("builds the base metadata prompt with the schema instructions", () => {
    const prompt = buildBaseMetadataUserPrompt({
      hasInstruction: true,
      instruction: "为乡村学校设计一个成长支持智能体",
      documentContext: "[Document 1: notes]\ncontent",
      outputSchemaPrompt: "## JSON schema",
    });

    expect(prompt).toContain("Create a prompt package");
    expect(prompt).toContain("乡村学校");
    expect(prompt).toContain("## JSON schema");
  });

  it("builds the rubric prompt with the package summary, agent excerpt, and source rubric excerpt", () => {
    const prompt = buildRubricUserPrompt({
      packageName: "EduSkill",
      packageDescription: "帮助老师整理技能",
      agentExcerpt: "# Agent",
      sourceRubricExcerpt: "## 评估标准\n### 文档保真度",
    });

    expect(prompt).toContain("rubric.md");
    expect(prompt).toContain("EduSkill");
    expect(prompt).toContain("# Agent");
    expect(prompt).toContain("## 评估标准");
    expect(prompt).toContain("优先复用");
  });

  it("builds the agent prompt with skill metadata and source context", () => {
    const prompt = buildAgentUserPrompt({
      packageName: "EduSkill",
      packageDescription: "帮助老师整理技能",
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
      packageDescription: "帮助老师整理技能",
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
});
