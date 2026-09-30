import type { PackageSkill } from "@educlaw/shared";
import type {
  AnswerOptimizationDiff,
  AnswerOptimizationDraft,
  AnswerSkillPatch,
  AnswerSkillPatchSection,
} from "./answer-skill-optimization-contract.js";
import { validateSkillMdStandard } from "./package-service.js";

interface MarkdownHeading {
  lineIndex: number;
  level: number;
  title: string;
}

interface MarkdownSectionRange {
  heading: MarkdownHeading;
  contentStart: number;
  contentEnd: number;
}

export interface AppliedAnswerSkillPatch {
  draft: AnswerOptimizationDraft;
  diff: AnswerOptimizationDiff;
}

export class AnswerSkillPatchApplicationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnswerSkillPatchApplicationError";
  }
}

function normalizeProposedContent(content: string): string {
  const normalized = content
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .trim();
  if (!normalized) {
    throw new AnswerSkillPatchApplicationError(
      "Patch proposedContent cannot be empty",
    );
  }
  if (normalized.length > 12000) {
    throw new AnswerSkillPatchApplicationError(
      "Patch proposedContent is too long",
    );
  }
  if (/^#{1,2}\s+/m.test(normalized) || /^---\s*$/m.test(normalized)) {
    throw new AnswerSkillPatchApplicationError(
      "Patch content cannot introduce top-level sections or frontmatter",
    );
  }
  return normalized;
}

function parseHeadings(lines: string[]): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  let inFrontmatter = lines[0]?.trim() === "---";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (index > 0 && inFrontmatter && line.trim() === "---") {
      inFrontmatter = false;
      continue;
    }
    if (inFrontmatter) continue;
    const match = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (!match) continue;
    headings.push({
      lineIndex: index,
      level: match[1]!.length,
      title: match[2]!.trim(),
    });
  }
  return headings;
}

function findSectionRanges(
  lines: string[],
  section: AnswerSkillPatchSection,
): MarkdownSectionRange[] {
  const headings = parseHeadings(lines);
  const matches = headings.filter(
    (heading) => heading.title.toLowerCase() === section.toLowerCase(),
  );
  return matches.map((heading) => {
    const next = headings.find(
      (candidate) =>
        candidate.lineIndex > heading.lineIndex &&
        candidate.level <= heading.level,
    );
    return {
      heading,
      contentStart: heading.lineIndex + 1,
      contentEnd: next?.lineIndex ?? lines.length,
    };
  });
}

function trimBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start]!.trim()) start += 1;
  while (end > start && !lines[end - 1]!.trim()) end -= 1;
  return lines.slice(start, end);
}

function getFrontmatter(skillMd: string): string {
  const match = skillMd.match(/^---\s*\r?\n[\s\S]*?\r?\n---/);
  if (!match) {
    throw new AnswerSkillPatchApplicationError(
      "Original Skill must contain YAML frontmatter",
    );
  }
  return match[0].replace(/\r\n?/g, "\n");
}

function assertNoDuplicateRequiredSections(lines: string[]): void {
  const headings = parseHeadings(lines);
  const counts = new Map<string, number>();
  for (const heading of headings) {
    const key = heading.title.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const section of [
    "Instructions",
    "Workflow",
    "Output Format",
    "Examples",
    "Common Issues",
  ]) {
    if ((counts.get(section.toLowerCase()) ?? 0) > 1) {
      throw new AnswerSkillPatchApplicationError(
        `Skill contains duplicate section: ${section}`,
      );
    }
  }
}

function joinSkillLines(lines: string[]): string {
  return lines.join("\n").replace(/[ \t]+$/gm, "").trim();
}

export function applyAnswerSkillPatch(
  skill: PackageSkill,
  patch: AnswerSkillPatch,
): AppliedAnswerSkillPatch {
  const originalFrontmatter = getFrontmatter(skill.skillMd);
  const lines = skill.skillMd.replace(/\r\n?/g, "\n").split("\n");
  assertNoDuplicateRequiredSections(lines);
  const ranges = findSectionRanges(lines, patch.section);
  if (ranges.length > 1) {
    throw new AnswerSkillPatchApplicationError(
      `Skill contains duplicate target section: ${patch.section}`,
    );
  }
  const proposedContent = normalizeProposedContent(patch.proposedContent);
  const proposedLines = proposedContent.split("\n");
  let before = "";
  let nextLines: string[];

  if (patch.operation === "add_section") {
    if (ranges.length > 0) {
      throw new AnswerSkillPatchApplicationError(
        `Section already exists: ${patch.section}`,
      );
    }
    nextLines = [
      ...trimBlankLines(lines),
      "",
      `## ${patch.section}`,
      "",
      ...proposedLines,
    ];
  } else {
    const range = ranges[0];
    if (!range) {
      throw new AnswerSkillPatchApplicationError(
        `Section does not exist: ${patch.section}`,
      );
    }
    const existingLines = trimBlankLines(
      lines.slice(range.contentStart, range.contentEnd),
    );
    before = existingLines.join("\n");
    const nextContent =
      patch.operation === "append" && existingLines.length > 0
        ? [...existingLines, "", ...proposedLines]
        : proposedLines;
    nextLines = [
      ...lines.slice(0, range.contentStart),
      "",
      ...nextContent,
      "",
      ...lines.slice(range.contentEnd),
    ];
  }

  const skillMd = joinSkillLines(nextLines);
  if (getFrontmatter(skillMd) !== originalFrontmatter) {
    throw new AnswerSkillPatchApplicationError(
      "Patch changed protected Skill frontmatter",
    );
  }
  assertNoDuplicateRequiredSections(skillMd.split("\n"));
  const errors = validateSkillMdStandard(skillMd, skill.dirName);
  return {
    draft: {
      skillId: skill.id,
      skillMd,
      validation: { valid: errors.length === 0, errors },
    },
    diff: {
      before,
      after:
        patch.operation === "append" && before
          ? `${before}\n\n${proposedContent}`
          : proposedContent,
    },
  };
}
