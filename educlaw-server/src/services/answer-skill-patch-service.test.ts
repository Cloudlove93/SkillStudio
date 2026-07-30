import { describe, expect, it } from "vitest";
import type { PackageSkill } from "@educlaw/shared";
import {
  AnswerSkillPatchApplicationError,
  applyAnswerSkillPatch,
} from "./answer-skill-patch-service.js";
import type { AnswerSkillPatch } from "./answer-skill-optimization-contract.js";

const frontmatter = [
  "---",
  "name: classroom-response",
  "description: Use when a teacher needs a structured classroom response.",
  "---",
].join("\n");

function skillMarkdown(includeExamples = true): string {
  return [
    frontmatter,
    "",
    "## Instructions",
    "Understand the situation, preserve student safety, and avoid unsupported assumptions.",
    "",
    "## Workflow",
    "1. Gather the available facts.",
    "2. Explain the next safe action.",
    "",
    "## Output Format",
    "Return a situation summary, ordered actions, useful wording, risks, and follow-up.",
    ...(includeExamples
      ? [
          "",
          "## Examples",
          "Example: organize an urgent classroom concern into practical teacher actions.",
        ]
      : []),
    "",
    "## Common Issues",
    "Do not invent facts, skip safety checks, or present uncertain claims as confirmed.",
  ].join("\n");
}

function createSkill(includeExamples = true): PackageSkill {
  return {
    id: "skill-1",
    dirName: "classroom-response",
    name: "Classroom Response",
    description: "Use when a teacher needs a structured classroom response.",
    skillMd: skillMarkdown(includeExamples),
  };
}

function patch(overrides: Partial<AnswerSkillPatch> = {}): AnswerSkillPatch {
  return {
    section: "Workflow",
    operation: "replace",
    reason: "Make the workflow executable.",
    proposedContent:
      "1. Protect the student immediately.\n2. Verify facts separately.\n3. Record and follow up.",
    ...overrides,
  };
}

describe("applyAnswerSkillPatch", () => {
  it("replaces only the selected section", () => {
    const skill = createSkill();
    const result = applyAnswerSkillPatch(skill, patch());

    expect(result.draft.validation).toEqual({ valid: true, errors: [] });
    expect(result.diff.before).toContain("Gather the available facts");
    expect(result.diff.after).toContain("Protect the student immediately");
    expect(result.draft.skillMd).toContain(
      "Understand the situation, preserve student safety",
    );
    expect(result.draft.skillMd).toContain(
      "Return a situation summary, ordered actions",
    );
    expect(result.draft.skillMd).not.toContain("Gather the available facts");
  });

  it("appends content without deleting the existing section", () => {
    const result = applyAnswerSkillPatch(
      createSkill(),
      patch({ operation: "append", proposedContent: "4. Contact the family with verified facts." }),
    );

    expect(result.diff.after).toContain("Gather the available facts");
    expect(result.diff.after).toContain("Contact the family");
    expect(result.draft.validation.valid).toBe(true);
  });

  it("adds a missing section and validates the completed Skill", () => {
    const result = applyAnswerSkillPatch(
      createSkill(false),
      patch({
        section: "Examples",
        operation: "add_section",
        proposedContent:
          "Example: turn a classroom concern into ordered actions and a follow-up check.",
      }),
    );

    expect(result.diff.before).toBe("");
    expect(result.draft.skillMd).toContain("## Examples");
    expect(result.draft.validation.valid).toBe(true);
  });

  it("preserves YAML frontmatter exactly", () => {
    const result = applyAnswerSkillPatch(createSkill(), patch());

    expect(result.draft.skillMd.startsWith(`${frontmatter}\n`)).toBe(true);
  });

  it("rejects empty content and an existing add_section target", () => {
    expect(() =>
      applyAnswerSkillPatch(createSkill(), patch({ proposedContent: "   " })),
    ).toThrow(AnswerSkillPatchApplicationError);
    expect(() =>
      applyAnswerSkillPatch(createSkill(), patch({ operation: "add_section" })),
    ).toThrow("Section already exists");
  });

  it("rejects duplicate required sections", () => {
    const skill = createSkill();
    skill.skillMd += "\n\n## Workflow\nA duplicate workflow.";

    expect(() => applyAnswerSkillPatch(skill, patch())).toThrow(
      "duplicate section",
    );
  });

  it("returns validation errors instead of accepting an invalid final Skill", () => {
    const skill = createSkill();
    skill.skillMd = skill.skillMd.replace(
      "description: Use when a teacher needs a structured classroom response.",
      "description: vague",
    );
    const result = applyAnswerSkillPatch(skill, patch());

    expect(result.draft.validation.valid).toBe(false);
    expect(result.draft.validation.errors.length).toBeGreaterThan(0);
  });
});
