import type { AgentPackageSnapshot, OptimizationIssue, OptimizationResult, PackageSkill } from "@educlaw/shared";
import { generateJson } from "./llm-service.js";
import { applyOptimizedSnapshot, assertRubricConfigured, getPackage, listVersions } from "./package-service.js";
import { getThreadDetail } from "./arena-service.js";

type ProgressCallback = (label: string) => Promise<void> | void;

function isGeneratedSkill(value: unknown): value is Partial<PackageSkill> {
  return Boolean(value) && typeof value === "object";
}

export async function optimizePackage(
  userId: string,
  packageId: string | number,
  threadId: string | number,
  model?: string,
  onProgress?: ProgressCallback,
): Promise<OptimizationResult> {
  await onProgress?.("读取智能体与对话轨迹");
  const pkg = await getPackage(userId, packageId);
  assertRubricConfigured(pkg.snapshot.rubricMd, "报告驱动优化");
  const detail = await getThreadDetail(userId, threadId);
  if (Number(detail.thread.packageId) !== Number(packageId)) {
    throw new Error("当前 Arena 对话不属于这个智能体");
  }

  await onProgress?.("分析并生成优化方案");
  const transcript = detail.messages
    .map((message) => `${message.side}/${message.role}: ${message.content}`)
    .join("\n\n");

  const skillBundle = pkg.snapshot.skills
    .map((skill) => `## ${skill.dirName}\n${skill.skillMd}`)
    .join("\n\n");

  const prompt = [
    "你是一个智能体优化专家。请分析以下智能体和 Arena 对话轨迹，生成优化后的新版本。",
    "",
    "## 当前智能体",
    "",
    "### agent.md",
    "```markdown",
    pkg.snapshot.agentMd,
    "```",
    "",
    "### rubric.md",
    "```markdown",
    pkg.snapshot.rubricMd,
    "```",
    "",
    "### skills",
    "```markdown",
    skillBundle || "（暂无技能）",
    "```",
    "",
    "## Arena 对话轨迹",
    transcript.slice(0, 10000),
    "",
    "## 任务",
    "1. 分析当前智能体存在的问题（从 persona、skill、rubric 三个角度）",
    "2. 生成优化后的完整包内容",
    "3. 返回 JSON，格式如下：",
    "",
    "```json",
    "{",
    '  "issues": [',
    "    {",
    '      "expert": "persona|skill|rubric",',
    '      "target": "agent|rubric|skill",',
    '      "targetId": "skill-dir-name or empty string",',
    '      "title": "问题标题",',
    '      "reason": "详细原因",',
    '      "evidence": "支撑证据"',
    "    }",
    "  ],",
    '  "snapshot": {',
    '    "agentMd": "优化后的 agent.md",',
    '    "rubricMd": "优化后的 rubric.md",',
    '    "skills": [',
    "      {",
    '        "name": "技能名称",',
    '        "dirName": "目录名",',
    '        "skillMd": "优化后的 skill.md",',
    '        "version": "1.0.0"',
    "      }",
    "    ]",
    "  }",
    "}",
    "```",
    "",
    "注意：",
    "1. 保持原有结构，只修改需要优化的地方",
    "2. skills 数组必须包含所有原始技能（优化后的版本）",
    "3. 最多返回 8 个最重要的问题",
  ].join("\n");

  const merged = await generateJson<{
    issues: OptimizationIssue[];
    snapshot: AgentPackageSnapshot;
  }>({
    model,
    systemPrompt:
      "你是智能体优化专家。分析给定的智能体和 Arena 对话轨迹，生成优化后的新版本。只返回 JSON，不要其他内容。",
    userPrompt: prompt,
    temperature: 0.3,
  });

  await onProgress?.("保存优化后的新版本");

  // Normalize snapshot to guard against partial LLM output
  const normalizedSnapshot: AgentPackageSnapshot = {
    name: merged.snapshot?.name || pkg.snapshot.name,
    description: merged.snapshot?.description || pkg.snapshot.description,
    versionLabel: merged.snapshot?.versionLabel || pkg.snapshot.versionLabel,
    agentMd: typeof merged.snapshot?.agentMd === "string" ? merged.snapshot.agentMd : pkg.snapshot.agentMd,
    rubricMd: typeof merged.snapshot?.rubricMd === "string" ? merged.snapshot.rubricMd : pkg.snapshot.rubricMd,
    skills: Array.isArray(merged.snapshot?.skills)
      ? merged.snapshot.skills.map((skill, idx: number) => {
          const nextSkill: Partial<PackageSkill> = isGeneratedSkill(skill) ? skill : {};
          return {
            id: typeof nextSkill.id === "string" ? nextSkill.id : "",
            dirName:
              typeof nextSkill.dirName === "string"
                ? nextSkill.dirName
                : pkg.snapshot.skills[idx]?.dirName || `skill-${idx}`,
            name:
              typeof nextSkill.name === "string"
                ? nextSkill.name
                : pkg.snapshot.skills[idx]?.name || `Skill ${idx + 1}`,
            description:
              typeof nextSkill.description === "string"
                ? nextSkill.description
                : pkg.snapshot.skills[idx]?.description || "",
            skillMd:
              typeof nextSkill.skillMd === "string"
                ? nextSkill.skillMd
                : pkg.snapshot.skills[idx]?.skillMd || "",
          };
        })
      : pkg.snapshot.skills,
  };

  await applyOptimizedSnapshot(userId, packageId, normalizedSnapshot, "optimized");
  const versions = await listVersions(userId, packageId);
  const latest = versions[0]!;

  return {
    packageId: Number(packageId),
    versionId: latest.id,
    versionNumber: latest.versionNumber,
    issues: merged.issues,
    snapshot: latest.snapshot,
  };
}
