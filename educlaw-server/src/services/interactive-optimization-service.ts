import type { AgentPackageSnapshot } from "@educlaw/shared";
import { generateChat, type ChatMessage } from "./llm-service.js";
import { getPackage, applyOptimizedSnapshot } from "./package-service.js";
import { getThreadDetail } from "./arena-service.js";
import { query } from "./db.js";
import type { DbRowInteractiveOptimizationSession } from "../types.js";

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
  session?: InteractiveOptimizationSession;
}

export interface ChatOptimizeInput {
  sessionId?: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  adoptedChanges: AdoptedChange[];
}

export interface ChatOptimizeResult {
  reply: string;
  newAdoptions: AdoptedChange[];
  newRejections: string[];
  isDone: boolean;
  session?: InteractiveOptimizationSession;
}

export interface InteractiveOptimizationMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface InteractiveOptimizationSession {
  id: number;
  packageId: number;
  threadId: number;
  status: string;
  messages: InteractiveOptimizationMessage[];
  issues: DiagnosisIssue[];
  adoptedChanges: AdoptedChange[];
  summary: string;
  versionId?: number;
  versionNumber?: number;
  createdAt: string;
  updatedAt: string;
}

/* ── helpers ── */

function parseJsonArray<T>(value: string, fallback: T[] = []): T[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as T[] : fallback;
  } catch {
    return fallback;
  }
}

function toInteractiveSession(row: DbRowInteractiveOptimizationSession): InteractiveOptimizationSession {
  return {
    id: row.id,
    packageId: row.package_id,
    threadId: row.thread_id,
    status: row.status,
    messages: parseJsonArray<InteractiveOptimizationMessage>(row.messages_json),
    issues: parseJsonArray<DiagnosisIssue>(row.issues_json),
    adoptedChanges: parseJsonArray<AdoptedChange>(row.adopted_json),
    summary: row.summary || "",
    versionId: row.version_id || undefined,
    versionNumber: row.version_number || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildSessionSummary(
  messages: InteractiveOptimizationMessage[],
  adoptedChanges: AdoptedChange[],
  issues: DiagnosisIssue[],
) {
  const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant")?.content || "";
  const parts = [
    issues.length ? `发现 ${issues.length} 个问题` : "未记录诊断问题",
    adoptedChanges.length ? `已采纳 ${adoptedChanges.length} 项修改` : "暂无采纳修改",
  ];
  if (latestAssistant) {
    parts.push(latestAssistant.replace(/\s+/g, " ").slice(0, 80));
  }
  return parts.join("；");
}

async function createInteractiveSession(
  userId: string,
  packageId: string | number,
  threadId: string | number,
  messages: InteractiveOptimizationMessage[],
  issues: DiagnosisIssue[],
  adoptedChanges: AdoptedChange[] = [],
) {
  const now = new Date().toISOString();
  const summary = buildSessionSummary(messages, adoptedChanges, issues);

  const result = await query<{ id: number }>(
    `insert into interactive_optimization_sessions
      (user_id, package_id, thread_id, status, messages_json, issues_json, adopted_json, summary, version_id, version_number, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id`,
    [userId, packageId, threadId, "active", JSON.stringify(messages), JSON.stringify(issues), JSON.stringify(adoptedChanges), summary, null, null, now, now],
  );

  const row: DbRowInteractiveOptimizationSession = {
    id: result.rows[0].id,
    user_id: userId,
    package_id: Number(packageId),
    thread_id: Number(threadId),
    status: "active",
    messages_json: JSON.stringify(messages),
    issues_json: JSON.stringify(issues),
    adopted_json: JSON.stringify(adoptedChanges),
    summary,
    version_id: null,
    version_number: null,
    created_at: now,
    updated_at: now,
  };

  return toInteractiveSession(row);
}

export async function getInteractiveSession(userId: string, sessionId: string) {
  const result = await query<DbRowInteractiveOptimizationSession>(
    "select * from interactive_optimization_sessions where id = $1 and user_id = $2",
    [sessionId, userId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Optimization session not found");
  return toInteractiveSession(row);
}

async function updateInteractiveSession(
  userId: string,
  sessionId: string,
  values: {
    messages?: InteractiveOptimizationMessage[];
    issues?: DiagnosisIssue[];
    adoptedChanges?: AdoptedChange[];
    status?: string;
    versionId?: string | number;
    versionNumber?: number;
  },
) {
  const current = await getInteractiveSession(userId, sessionId);
  const messages = values.messages || current.messages;
  const issues = values.issues || current.issues;
  const adoptedChanges = values.adoptedChanges || current.adoptedChanges;
  const status = values.status || current.status;
  const summary = buildSessionSummary(messages, adoptedChanges, issues);
  const updatedAt = new Date().toISOString();

  const result = await query<DbRowInteractiveOptimizationSession>(
    `update interactive_optimization_sessions
       set messages_json = $1,
           issues_json = $2,
           adopted_json = $3,
           status = $4,
           summary = $5,
           version_id = $6,
           version_number = $7,
           updated_at = $8
     where id = $9 and user_id = $10
     returning *`,
    [
      JSON.stringify(messages),
      JSON.stringify(issues),
      JSON.stringify(adoptedChanges),
      status,
      summary,
      values.versionId || current.versionId || null,
      values.versionNumber || current.versionNumber || null,
      updatedAt,
      sessionId,
      userId,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Optimization session not found");
  return toInteractiveSession(row);
}

export async function listInteractiveSessions(userId: string, packageId: string | number) {
  await getPackage(userId, packageId);
  const result = await query<DbRowInteractiveOptimizationSession>(
    "select * from interactive_optimization_sessions where user_id = $1 and package_id = $2 order by updated_at desc",
    [userId, packageId],
  );
  return result.rows.map(toInteractiveSession);
}

function buildPackageContext(
  pkg: Awaited<ReturnType<typeof getPackage>>,
  adoptedChanges: AdoptedChange[] = [],
) {
  const current = buildCurrentEditableSnapshot(pkg, adoptedChanges);

  const skillBundle = Array.from(current.skills.values())
    .map((s) => `## ${s.dirName} (${s.name})\n${s.skillMd}`)
    .join("\n\n");

  return [
    "### agent.md",
    "```markdown",
    current.agentMd,
    "```",
    "",
    "### rubric.md",
    "```markdown",
    current.rubricMd,
    "```",
    "",
    "### skills",
    "```markdown",
    skillBundle || "（暂无技能）",
    "```",
  ].join("\n");
}

function buildCurrentEditableSnapshot(
  pkg: Awaited<ReturnType<typeof getPackage>>,
  adoptedChanges: AdoptedChange[] = [],
) {
  const current = {
    agentMd: pkg.snapshot.agentMd,
    rubricMd: pkg.snapshot.rubricMd,
    skills: new Map(pkg.snapshot.skills.map((s) => [s.dirName, { ...s }])),
  };

  for (const change of adoptedChanges) {
    const modified = String(change.modified || "").trim();
    if (!modified) continue;

    if (change.target === "agent") {
      current.agentMd = modified;
      continue;
    }

    if (change.target === "rubric") {
      current.rubricMd = modified;
      continue;
    }

    if (change.target === "skill" && change.targetId) {
      const skill = Array.from(current.skills.values()).find((item) => item.dirName === change.targetId || item.id === change.targetId);
      if (skill) {
        current.skills.set(skill.dirName, { ...skill, skillMd: modified });
      }
    }
  }

  return current;
}

function resolveCurrentContentForAdoption(
  pkg: Awaited<ReturnType<typeof getPackage>>,
  adoptedChanges: AdoptedChange[],
  target: AdoptedChange["target"],
  targetId?: string,
) {
  const current = buildCurrentEditableSnapshot(pkg, adoptedChanges);
  if (target === "agent") return { content: current.agentMd };
  if (target === "rubric") return { content: current.rubricMd };
  const skill = targetId
    ? Array.from(current.skills.values()).find((item) => item.dirName === targetId || item.id === targetId)
    : undefined;
  return { content: skill?.skillMd || "", targetName: skill?.name };
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

function extractFrontmatterValue(text: string, key: string): string | null {
  const match = text.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;
  const line = match[1].split("\n").find((item) => item.trim().startsWith(`${key}:`));
  if (!line) return null;
  const value = line.slice(line.indexOf(":") + 1).trim();
  return value.replace(/^["']|["']$/g, "");
}

function normalizeAdoptedSkillMarkdown(
  modified: string,
  currentSkill: AgentPackageSnapshot["skills"][number],
): { skillMd: string; frontmatterName: string; frontmatterDescription: string } {
  const trimmed = modified.trim();
  const currentFrontmatterMatch = currentSkill.skillMd.match(/^---\s*\n[\s\S]*?\n---\s*\n?/);
  const currentName = extractFrontmatterValue(currentSkill.skillMd, "name");
  const currentDescription = extractFrontmatterValue(currentSkill.skillMd, "description");

  const modifiedFrontmatterMatch = trimmed.match(/^---\s*\n[\s\S]*?\n---\s*\n?/);
  const modifiedBody = modifiedFrontmatterMatch
    ? trimmed.slice(modifiedFrontmatterMatch[0].length).trimStart()
    : trimmed;
  const modifiedName = extractFrontmatterValue(trimmed, "name");
  const modifiedDescription = extractFrontmatterValue(trimmed, "description");

  const frontmatterName = modifiedName || currentName;
  const frontmatterDescription = modifiedDescription || currentDescription;
  if (!frontmatterName || !frontmatterDescription) {
    throw new Error("SKILL.md 必须保留 YAML frontmatter，并包含 name 和 description");
  }

  const frontmatter = `---\nname: ${frontmatterName}\ndescription: ${frontmatterDescription}\n---`;
  const skillMd = (modifiedFrontmatterMatch || currentFrontmatterMatch)
    ? `${frontmatter}\n\n${modifiedBody}`.trim()
    : trimmed;

  if (!skillMd.startsWith("---")) {
    throw new Error("SKILL.md 必须保留 YAML frontmatter，并包含 name 和 description");
  }

  return {
    skillMd,
    frontmatterName,
    frontmatterDescription,
  };
}

function buildInteractiveSnapshotFromAdoptions(
  pkg: Awaited<ReturnType<typeof getPackage>>,
  adoptedChanges: AdoptedChange[],
): AgentPackageSnapshot {
  const nextSnapshot: AgentPackageSnapshot = {
    ...pkg.snapshot,
    name: pkg.snapshot.name,
    description: pkg.snapshot.description,
    versionLabel: pkg.snapshot.versionLabel,
    skills: pkg.snapshot.skills.map((skill) => ({ ...skill })),
  };

  let changed = false;

  for (const change of adoptedChanges) {
    const modified = String(change.modified || "").trim();
    if (!modified) continue;

    if (change.target === "agent") {
      if (modified !== nextSnapshot.agentMd.trim()) {
        nextSnapshot.agentMd = modified;
        changed = true;
      }
      continue;
    }

    if (change.target === "rubric") {
      if (modified !== nextSnapshot.rubricMd.trim()) {
        nextSnapshot.rubricMd = modified;
        changed = true;
      }
      continue;
    }

    if (change.target === "skill" && change.targetId) {
      const skillIndex = nextSnapshot.skills.findIndex((skill) => skill.id === change.targetId || skill.dirName === change.targetId);
      if (skillIndex === -1) continue;
      const currentSkill = nextSnapshot.skills[skillIndex]!;
      if (modified === currentSkill.skillMd.trim()) continue;

      const normalized = normalizeAdoptedSkillMarkdown(modified, currentSkill);

      nextSnapshot.skills[skillIndex] = {
        ...currentSkill,
        name: normalized.frontmatterName,
        description: normalized.frontmatterDescription,
        skillMd: normalized.skillMd,
      };
      changed = true;
    }
  }

  if (!changed) {
    throw new Error("采纳的修改没有产生实际差异，请确认已采纳的内容确实包含修改后的完整内容。");
  }

  return nextSnapshot;
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
  packageId: string | number,
  threadId: string | number,
  model?: string,
): Promise<DiagnosisResult> {
  const pkg = await getPackage(userId, packageId);
  const detail = await getThreadDetail(userId, threadId);

  if (Number(detail.thread.packageId) !== Number(packageId)) {
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

  const session = await createInteractiveSession(
    userId,
    packageId,
    threadId,
    [{ role: "assistant", content: welcomeMessage }],
    issues,
  );

  return { welcomeMessage, issues, session };
}

/* ── chat optimize ── */

export async function chatOptimize(
  userId: string,
  packageId: string | number,
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
    "6. 当你提出具体修改建议时，在回复末尾用 <MODIFIED> 标签包裹修改后的完整内容供系统内部使用（用户看不到这部分）。只修改被明确指出的部分，未被提及的内容必须保持原样，尤其不要随意压缩 package description 或其他概述性说明：",
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
    const current = resolveCurrentContentForAdoption(pkg, input.adoptedChanges, target, a.targetId);
    const original = current.content;

    // Use the full modified content from <MODIFIED> block if available, otherwise fallback to original
    const modified = a.modifiedContent !== undefined ? a.modifiedContent : original;

    return {
      id: `${target}-${a.targetId || ""}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      target,
      targetId: a.targetId,
      targetName: current.targetName || a.targetId,
      original,
      modified,
      reason: a.summary,
    };
  });

  const persistedMessages = [
    ...input.messages.filter((message) => message.role !== "system"),
    { role: "assistant" as const, content: parsed.cleanReply },
  ];
  const persistedAdoptions = [...input.adoptedChanges, ...newAdoptions];
  const session = input.sessionId
    ? await updateInteractiveSession(userId, input.sessionId, {
        messages: persistedMessages,
        adoptedChanges: persistedAdoptions,
      })
    : undefined;

  return {
    reply: parsed.cleanReply,
    newAdoptions,
    newRejections: parsed.rejections.map((r) => `${r.target}-${r.targetId || ""}`),
    isDone: parsed.isDone,
    session,
  };
}

/* ── apply changes ── */

export async function applyInteractiveChanges(
  userId: string,
  packageId: string | number,
  changes: AdoptedChange[],
  model?: string,
  note?: string,
  sessionId?: string,
): Promise<{ versionId: number; versionNumber: number }> {
  const pkg = await getPackage(userId, packageId);
  const normalizedSnapshot = buildInteractiveSnapshotFromAdoptions(pkg, changes);

  await applyOptimizedSnapshot(userId, packageId, normalizedSnapshot, "interactive", note);
  const { listVersions } = await import("./package-service.js");
  const versions = await listVersions(userId, packageId);
  const latest = versions[0]!;

  if (sessionId) {
    await updateInteractiveSession(userId, sessionId, {
      adoptedChanges: changes,
      status: "saved",
      versionId: latest.id,
      versionNumber: latest.versionNumber,
    });
  }

  return { versionId: latest.id, versionNumber: latest.versionNumber };
}
