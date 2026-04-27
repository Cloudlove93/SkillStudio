import type { AgentPackageSnapshot } from "@educlaw/shared";
import { generateChat, generateJson, type ChatMessage } from "./llm-service.js";
import { getPackage, applyOptimizedSnapshot } from "./package-service.js";
import { getThreadDetail } from "./arena-service.js";

export interface DiagnosisIssue {
  id: string;
  target: "agent" | "rubric" | "skill";
  targetId?: string;
  targetName?: string;
  title: string;
  reason: string;
  suggestion: string;
}

export interface AdoptedChange {
  id: string;
  target: "agent" | "rubric" | "skill";
  targetId?: string;
  targetName?: string;
  original: string;
  modified: string;
  reason: string;
}

export interface DiagnosisResult {
  welcomeMessage: string;
  issues: DiagnosisIssue[];
}

export interface ChatOptimizeInput {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  adoptedChanges: AdoptedChange[];
}

export interface ChatOptimizeResult {
  reply: string;
  newAdoptions: AdoptedChange[];
  newRejections: string[];
  isDone: boolean;
}

/* ── helpers ── */

function buildPackageContext(
  pkg: Awaited<ReturnType<typeof getPackage>>,
  adoptedChanges: AdoptedChange[] = [],
) {
  // Start with original snapshot
  let currentAgentMd = pkg.snapshot.agentMd;
  let currentRubricMd = pkg.snapshot.rubricMd;
  const currentSkills = new Map(pkg.snapshot.skills.map((s) => [s.dirName, { ...s }]));

  // Apply adopted changes in order to get current state
  for (const change of adoptedChanges) {
    if (change.target === "agent") {
      currentAgentMd = change.modified;
    } else if (change.target === "rubric") {
      currentRubricMd = change.modified;
    } else if (change.target === "skill" && change.targetId) {
      const skill = currentSkills.get(change.targetId);
      if (skill) {
        skill.skillMd = change.modified;
      }
    }
  }

  const skillBundle = Array.from(currentSkills.values())
    .map((s) => `## ${s.dirName} (${s.name})\n${s.skillMd}`)
    .join("\n\n");

  return [
    "### agent.md",
    "```markdown",
    currentAgentMd,
    "```",
    "",
    "### rubric.md",
    "```markdown",
    currentRubricMd,
    "```",
    "",
    "### skills",
    "```markdown",
    skillBundle || "（暂无技能）",
    "```",
  ].join("\n");
}

function stripInternalMarkers(text: string): string {
  // Remove <MODIFIED> blocks and their content
  return text
    .replace(/<MODIFIED[^>]*>[\s\S]*?<\/MODIFIED>/gi, "")
    .replace(/\[ADOPT:[^\]]*\]/g, "")
    .replace(/\[REJECT:[^\]]*\]/g, "")
    .replace(/\[NEXT\]/g, "")
    .replace(/\[DONE\]/g, "")
    .trim();
}

function buildAdoptedContext(changes: AdoptedChange[]) {
  if (changes.length === 0) return "（暂无已采纳的修改）";

  return changes
    .map(
      (c, i) =>
        [
          `[已采纳修改 ${i + 1}]`,
          `目标: ${c.target}${c.targetId ? ` / ${c.targetId}` : ""}`,
          `原因: ${c.reason}`,
          `修改后的内容:`,
          "```markdown",
          stripInternalMarkers(c.modified),
          "```",
        ].join("\n"),
    )
    .join("\n\n");
}

function parseModifiedBlocks(reply: string): Array<{
  target: string;
  targetId?: string;
  content: string;
}> {
  const blocks: Array<{ target: string; targetId?: string; content: string }> = [];
  const regex = /<MODIFIED\s+target="([^"]*)"(?:\s+targetId="([^"]*)")?\s*>([\s\S]*?)<\/MODIFIED>/gi;
  let match;
  while ((match = regex.exec(reply)) !== null) {
    let content = match[3].trim();
    // Strip surrounding markdown code block if present
    const mdBlock = content.match(/^```(?:markdown)?\s*\n?([\s\S]*?)\n?```\s*$/);
    if (mdBlock) {
      content = mdBlock[1].trim();
    }
    blocks.push({
      target: match[1] || "",
      targetId: match[2] || undefined,
      content,
    });
  }
  return blocks;
}

function parseMarkers(reply: string): {
  cleanReply: string;
  adoptions: Array<{ target: string; targetId?: string; summary: string; modifiedContent?: string }>;
  rejections: Array<{ target: string; targetId?: string }>;
  isDone: boolean;
  isNext: boolean;
} {
  const lines = reply.split("\n");
  const cleanLines: string[] = [];
  const adoptions: Array<{ target: string; targetId?: string; summary: string; modifiedContent?: string }> = [];
  const rejections: Array<{ target: string; targetId?: string }> = [];
  let isDone = false;
  let isNext = false;

  let inModifiedBlock = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[ADOPT:")) {
      const inner = trimmed.slice(7, -1); // remove [ADOPT: and ]
      const firstColon = inner.indexOf(":");
      const secondColon = inner.indexOf(":", firstColon + 1);
      const target = firstColon > -1 ? inner.slice(0, firstColon) : inner;
      const targetId = secondColon > -1 ? inner.slice(firstColon + 1, secondColon) : (firstColon > -1 ? inner.slice(firstColon + 1) : "");
      const summary = secondColon > -1 ? inner.slice(secondColon + 1) : "";
      adoptions.push({
        target: target || "",
        targetId: targetId || undefined,
        summary: summary || "",
      });
      continue;
    }
    if (trimmed.startsWith("[REJECT:")) {
      const inner = trimmed.slice(8, -1);
      const firstColon = inner.indexOf(":");
      const target = firstColon > -1 ? inner.slice(0, firstColon) : inner;
      const targetId = firstColon > -1 ? inner.slice(firstColon + 1) : "";
      rejections.push({
        target: target || "",
        targetId: targetId || undefined,
      });
      continue;
    }
    if (trimmed === "[DONE]") {
      isDone = true;
      continue;
    }
    if (trimmed === "[NEXT]") {
      isNext = true;
      continue;
    }
    // Skip entire <MODIFIED> block (wrapper lines + inner content) from user-facing reply
    if (trimmed.startsWith("<MODIFIED")) {
      inModifiedBlock = true;
      continue;
    }
    if (trimmed === "</MODIFIED>") {
      inModifiedBlock = false;
      continue;
    }
    if (inModifiedBlock) continue;
    cleanLines.push(line);
  }

  // Attach modified content from <MODIFIED> blocks to matching adoptions
  const modifiedBlocks = parseModifiedBlocks(reply);
  for (const adoption of adoptions) {
    const match = modifiedBlocks.find(
      (b) => b.target === adoption.target && (b.targetId || "") === (adoption.targetId || ""),
    );
    if (match) {
      adoption.modifiedContent = match.content;
    }
  }

  return {
    cleanReply: cleanLines.join("\n").trim(),
    adoptions,
    rejections,
    isDone,
    isNext,
  };
}

/* ── diagnose ── */

export async function diagnosePackage(
  userId: string,
  packageId: string,
  threadId: string,
  model?: string,
): Promise<DiagnosisResult> {
  const pkg = await getPackage(userId, packageId);
  const detail = await getThreadDetail(userId, threadId);

  if (detail.thread.packageId !== packageId) {
    throw new Error("当前 Arena 对话不属于这个智能体");
  }

  const transcript = detail.messages
    .map((m) => `${m.side}/${m.role}: ${m.content}`)
    .join("\n\n");

  const systemPrompt = [
    "你是 EduClaw-lite 智能体诊断专家。",
    "分析给定的智能体和 Arena 对话轨迹，找出需要优化的问题。",
    "返回严格符合格式的 JSON。",
  ].join("\n");

  const userPrompt = [
    "请分析以下智能体和对话轨迹，返回 JSON 格式的问题列表。",
    "",
    "## 智能体内容",
    "",
    buildPackageContext(pkg),
    "",
    "## Arena 对话轨迹（最近部分）",
    transcript.slice(0, 12000),
    "",
    "## 输出格式",
    "返回 JSON:",
    "```json",
    "{",
    '  "issues": [',
    "    {",
    '      "id": "1",',
    '      "target": "agent|rubric|skill",',
    '      "targetId": "skill-dir-name 或空字符串",',
    '      "targetName": "显示名称",',
    '      "title": "问题标题",',
    '      "reason": "详细原因",',
    '      "suggestion": "修改建议"',
    "    }",
    "  ]",
    "}",
    "```",
    "",
    "注意：",
    "1. target 必须是 agent、rubric 或 skill 之一",
    "2. 对于 agent 和 rubric，targetId 为空字符串",
    "3. 对于 skill，targetId 填 skill 的 dirName",
    "4. 最多返回 4 个最重要的问题",
    "5. 每个问题务必简短：title 不超过 15 字，reason 不超过 50 字，suggestion 不超过 50 字",
    "6. 优先聚焦最关键、最影响效果的 1-2 个问题，不要面面俱到",
  ].join("\n");

  const raw = await generateChat(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    model,
    0.3,
  );

  let issues: DiagnosisIssue[] = [];

  // Try to parse JSON
  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const jsonText = jsonMatch ? jsonMatch[1] : raw;

  try {
    const parsed = JSON.parse(jsonText);
    if (Array.isArray(parsed.issues)) {
      issues = parsed.issues.map((issue: Record<string, unknown>) => ({
        id: String(issue.id || Math.random().toString(36).slice(2)),
        target: String(issue.target || "agent") as "agent" | "rubric" | "skill",
        targetId: issue.targetId ? String(issue.targetId) : undefined,
        targetName: issue.targetName ? String(issue.targetName) : undefined,
        title: String(issue.title || ""),
        reason: String(issue.reason || ""),
        suggestion: String(issue.suggestion || ""),
      }));
    }
  } catch {
    // fallback: empty issues with a warning
  }

  const welcomeMessage = [
    "👋 你好！我是智能体优化专家。",
    "",
    issues.length > 0
      ? `我已经分析了您的智能体「${pkg.name}」，发现了 **${issues.length}** 个可优化的问题：`
      : `我已经分析了您的智能体「${pkg.name}」。当前分析未能识别出明确的问题，但我们可以一起探讨优化方向：`,
    "",
    ...issues.map(
      (issue, i) =>
        `${i + 1}. **${issue.title}** — ${issue.target}${issue.targetId ? ` (${issue.targetId})` : ""}`,
    ),
    "",
    issues.length > 0
      ? "我们可以逐个讨论这些问题。你想从哪里开始？或者让我从第一个问题开始？"
      : "当前智能体看起来很完善！如果有任何想调整的地方，随时告诉我。",
  ].join("\n");

  return { welcomeMessage, issues };
}

/* ── chat optimize ── */

export async function chatOptimize(
  userId: string,
  packageId: string,
  input: ChatOptimizeInput,
  model?: string,
): Promise<ChatOptimizeResult> {
  const pkg = await getPackage(userId, packageId);

  const systemPrompt = [
    "你是 EduClaw-lite 智能体优化专家。你正在与用户对话，帮助优化智能体。",
    "",
    "## 当前智能体内容（已应用已采纳的修改）",
    "",
    buildPackageContext(pkg, input.adoptedChanges),
    "",
    "## 已采纳的修改",
    buildAdoptedContext(input.adoptedChanges),
    "",
    "## 你的职责",
    "1. 专业、亲切地讨论优化方案",
    "2. 除非用户明确要求同时修改多个地方，否则每次只提出一个具体的修改建议",
    "3. 修改建议要简短聚焦，不要在一次回复中罗列多个问题或大量细节",
    "4. 说明修改的原因和预期效果（每段不超过 3 句话）",
    "5. 向用户说明修改建议时，用通俗、口语化的方式解释，就像跟朋友聊天一样。只说明改了什么、为什么改、预期效果如何。不要展示完整的技术文档，不要贴大段代码或 markdown 原文。",
    "6. 当你提出具体修改建议时，在回复末尾用 <MODIFIED> 标签包裹修改后的完整内容供系统内部使用（用户看不到这部分）：",
    "   <MODIFIED target=\"agent\" targetId=\"\">",
    "   ```markdown",
    "   修改后的完整内容",
    "   ```",
    "   </MODIFIED>",
    "7. 如果用户确认采纳某个修改建议，你必须在回复末尾同时输出 <MODIFIED> 块（包含完整修改后内容）和 [ADOPT] 标记。两者缺一不可。",
    "8. 如果用户拒绝，输出：[REJECT:target:targetId]",
    "9. 当前话题结束后，输出：[NEXT] 继续下一个",
    "10. 所有修改完成后，输出：[DONE]",
    "",
    "## 标记格式示例",
    "- [ADOPT:agent::优化了角色定义]",
    "- [ADOPT:skill:grammar:优化了语法检查逻辑]",
    "- [REJECT:rubric:]",
    "- [NEXT]",
    "- [DONE]",
    "",
    "## 重要",
    "- 回复正文必须是自然的中文对话，不要提及、解释或暴露 <MODIFIED>、[ADOPT]、[REJECT]、[NEXT]、[DONE] 这些标记的存在",
    "- 不要在对话正文中说\"我会标记\"、\"请确认 adop\"、\"输出 adopt\"之类的话",
    "- 只有当用户明确同意采纳某个具体修改时，才在回复末尾输出 [ADOPT] 标记；用户没有同意时，绝不输出任何标记",
    "- 输出 [ADOPT] 时必须同时输出 <MODIFIED> 块，确保系统能获取完整的修改后内容",
    "- <MODIFIED> 代码块只在真正提出具体修改预览时使用，普通讨论时不要出现",
    "- 所有标记必须单独一行，严格位于回复最末尾，正文里绝对不要出现",
    "- 如果用户要求修改已采纳的内容，可以再次输出 [ADOPT] 覆盖",
  ].join("\n");

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...input.messages.filter((m) => m.role !== "system"),
  ];

  const reply = await generateChat(messages, model, 0.5);
  const parsed = parseMarkers(reply);

  // 将 adoptions 转换为 AdoptedChange
  const newAdoptions: AdoptedChange[] = parsed.adoptions.map((a) => {
    const target = a.target as "agent" | "rubric" | "skill";
    let original = "";
    let modified = "";

    if (target === "agent") {
      original = pkg.snapshot.agentMd;
    } else if (target === "rubric") {
      original = pkg.snapshot.rubricMd;
    } else if (target === "skill" && a.targetId) {
      const skill = pkg.snapshot.skills.find((s) => s.dirName === a.targetId);
      original = skill?.skillMd || "";
    }

    // Use the full modified content from <MODIFIED> block if available, otherwise fallback to original
    modified = a.modifiedContent !== undefined ? a.modifiedContent : original;

    return {
      id: `${target}-${a.targetId || ""}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      target,
      targetId: a.targetId,
      targetName: a.targetId,
      original,
      modified,
      reason: a.summary,
    };
  });

  return {
    reply: parsed.cleanReply,
    newAdoptions,
    newRejections: parsed.rejections.map((r) => `${r.target}-${r.targetId || ""}`),
    isDone: parsed.isDone,
  };
}

/* ── apply changes ── */

export async function applyInteractiveChanges(
  userId: string,
  packageId: string,
  changes: AdoptedChange[],
  model?: string,
  note?: string,
): Promise<{ versionId: string; versionNumber: number }> {
  const pkg = await getPackage(userId, packageId);

  // Build detailed changes context with full original content
  const changesText = changes
    .map((c, i) => {
      const lines: string[] = [
        `${i + 1}. [${c.target}${c.targetId ? ` / ${c.targetId}` : ""}] ${c.reason}`,
        `   原始文件内容：`,
        `   \`\`\`markdown`,
        `   ${c.original.slice(0, 6000)}`,
        `   \`\`\``,
      ];
      // If modified contains actual content (not just a summary), include it as reference
      if (c.modified && c.modified !== c.original && c.modified.length > c.reason.length + 10) {
        lines.push(
          `   期望的修改方向（参考）：`,
          `   \`\`\`markdown`,
          `   ${c.modified.slice(0, 6000)}`,
          `   \`\`\``,
        );
      } else {
        lines.push(
          `   ⚠️ 修改要求：请根据以下原因对原始内容做出明确、实质性的修改`,
          `   原因：${c.reason}`,
          `   注意：必须输出与原始内容有明显差异的修改结果，不能只复述原始内容`,
        );
      }
      return lines.join("\n");
    })
    .join("\n\n");

  const skillBundle = pkg.snapshot.skills
    .map((s) => `## ${s.dirName} (${s.name})\n${s.skillMd}`)
    .join("\n\n");

  const prompt = [
    "你是一个智能体优化专家。请根据以下已确认的修改意图，对原始文件做出实质性修改，生成完整的优化后智能体。",
    "",
    "## 已确认的修改意图（含原始文件内容）",
    "对于每个修改意图，请执行以下操作：",
    "1. 读取对应的原始文件内容（已附在每个修改意图下方）",
    "2. 根据修改原因，对原始内容做出明确、实质性的修改",
    "3. 确保修改后的内容与原始内容有可见差异",
    "4. 返回修改后的完整文件内容（不要只返回修改摘要）",
    "",
    changesText,
    "",
    "## 任务",
    "1. 根据上述修改意图，对原始文件逐一做出实质性修改",
    "2. 生成完整的优化后包内容（保持原有结构，技能列表顺序不变）",
    "3. 返回 JSON，包含完整的 snapshot（skills 数组必须与原始技能一一对应，顺序不变，数量相同）",
    "",
    "```json",
    "{",
    '  "snapshot": {',
    '    "name": "智能体名称",',
    '    "description": "智能体描述",',
    '    "agentMd": "优化后的完整 agent.md 内容",',
    '    "rubricMd": "优化后的完整 rubric.md 内容",',
    '    "skills": [',
    "      {",
    '        "id": "技能ID（保持原值或留空）",',
    '        "name": "技能名称",',
    '        "dirName": "目录名",',
    '        "description": "技能描述",',
    '        "skillMd": "优化后的完整 skill.md 内容"',
    "      }",
    "    ]",
    "  }",
    "}",
    "```",
  ].join("\n");

  const result = await generateJson<{ snapshot: AgentPackageSnapshot }>({
    model,
    systemPrompt:
      "你是智能体优化专家。每个修改意图都附带了完整的原始文件内容，你必须根据修改原因对原始内容做出明确、实质性的改动，返回完整的优化后内容。只返回 JSON，不要其他内容。",
    userPrompt: prompt,
    temperature: 0.3,
  });

  // Normalize snapshot to guard against partial LLM output
  const normalizedSnapshot: AgentPackageSnapshot = {
    name: result.snapshot?.name || pkg.snapshot.name,
    description: result.snapshot?.description || pkg.snapshot.description,
    versionLabel: result.snapshot?.versionLabel || pkg.snapshot.versionLabel,
    agentMd: typeof result.snapshot?.agentMd === "string" ? result.snapshot.agentMd : pkg.snapshot.agentMd,
    rubricMd: typeof result.snapshot?.rubricMd === "string" ? result.snapshot.rubricMd : pkg.snapshot.rubricMd,
    skills: Array.isArray(result.snapshot?.skills)
      ? result.snapshot.skills.map((s: any, idx: number) => ({
          id: s?.id || ``,
          dirName: s?.dirName || pkg.snapshot.skills[idx]?.dirName || `skill-${idx}`,
          name: s?.name || pkg.snapshot.skills[idx]?.name || `技能${idx + 1}`,
          description: s?.description || pkg.snapshot.skills[idx]?.description || "",
          skillMd: typeof s?.skillMd === "string" ? s.skillMd : (pkg.snapshot.skills[idx]?.skillMd || ""),
        }))
      : pkg.snapshot.skills,
  };

  // Verify the snapshot actually changed
  const isSameAgent = normalizedSnapshot.agentMd === pkg.snapshot.agentMd;
  const isSameRubric = normalizedSnapshot.rubricMd === pkg.snapshot.rubricMd;
  const isSameSkills = normalizedSnapshot.skills.length === pkg.snapshot.skills.length &&
    normalizedSnapshot.skills.every((s, i) =>
      s.skillMd === (pkg.snapshot.skills[i]?.skillMd || "")
    );
  if (isSameAgent && isSameRubric && isSameSkills) {
    throw new Error("优化后的内容与原始内容没有差异，请确保每次修改建议都包含具体的修改内容（<MODIFIED> 块）后再保存。");
  }

  await applyOptimizedSnapshot(userId, packageId, normalizedSnapshot, "interactive", note);
  const { listVersions } = await import("./package-service.js");
  const versions = await listVersions(userId, packageId);
  const latest = versions[0]!;

  return { versionId: latest.id, versionNumber: latest.versionNumber };
}
