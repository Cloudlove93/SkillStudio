import type { AgentPackageDetail, AgentPackageSnapshot, PackageSkill } from "@educlaw/shared";
import { generateChat, generateJson, generateText, type ChatMessage } from "./llm-service.js";
import {
  assertRubricConfigured,
  getPackage,
  applyOptimizedSnapshot,
  listVersions,
  normalizeAndRepairSkillMd,
  validatePackageSkillMd,
} from "./package-service.js";
import { getThreadDetail } from "./arena-service.js";
import { query } from "./db.js";
import type { DbRowInteractiveOptimizationSession } from "../types.js";
import { parseDbJson } from "../utils/json.js";

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
  targetSkillDirName?: string;
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
  targetSkillDirName?: string;
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

function parseJsonArray<T>(value: unknown, fallback: T[] = []): T[] {
  const parsed = parseDbJson<unknown>(value, fallback);
  return Array.isArray(parsed) ? parsed as T[] : fallback;
}

function toInteractiveSession(row: DbRowInteractiveOptimizationSession): InteractiveOptimizationSession {
  return {
    id: row.id,
    packageId: row.package_id,
    threadId: row.thread_id,
    targetSkillDirName: row.target_skill_dir_name || undefined,
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
  targetSkillDirName?: string,
) {
  const now = new Date().toISOString();
  const summary = buildSessionSummary(messages, adoptedChanges, issues);

  const result = await query<{ id: number }>(
    `insert into interactive_optimization_sessions
      (user_id, package_id, thread_id, target_skill_dir_name, status, messages_json, issues_json, adopted_json, summary, version_id, version_number, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning id`,
    [userId, packageId, threadId, targetSkillDirName || null, "active", JSON.stringify(messages), JSON.stringify(issues), JSON.stringify(adoptedChanges), summary, null, null, now, now],
  );

  const row: DbRowInteractiveOptimizationSession = {
    id: result.rows[0].id,
    user_id: userId,
    package_id: Number(packageId),
    thread_id: Number(threadId),
    target_skill_dir_name: targetSkillDirName || null,
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

function buildSkillOnlyContext(
  pkg: Awaited<ReturnType<typeof getPackage>>,
  targetSkillDirName: string,
  adoptedChanges: AdoptedChange[] = [],
) {
  const current = buildCurrentEditableSnapshot(pkg, adoptedChanges);
  const skill = current.skills.get(targetSkillDirName);
  if (!skill) {
    throw new Error(`Skill ${targetSkillDirName} 不存在`);
  }
  return [
    `### Skill: ${skill.dirName} (${skill.name})`,
    "```markdown",
    skill.skillMd,
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

function assertSkillOnlyChanges(
  changes: AdoptedChange[],
  targetSkillDirName: string,
) {
  const hasOutOfScopeChange = changes.some(
    (change) => change.target !== "skill" || change.targetId !== targetSkillDirName,
  );
  if (hasOutOfScopeChange) {
    throw new Error(`Skill 专用优化只能修改 ${targetSkillDirName}`);
  }
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
        // 注意:不要用 frontmatterName 覆盖 skill 的显示名。
        // frontmatter 的 name 字段是目录名格式(如 immediate-control),
        // 而 snapshot.skills[].name 是中文显示名(如"即时控场与秩序恢复"),
        // 两者语义不同,混用会导致前端版本列表名字错乱。
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

  // Attach modified content from <MODIFIED> blocks to matching adoptions.
  // LLM 经常只输出 <MODIFIED> 块而漏掉 [ADOPT] 标记,导致 skill 修改被静默丢弃。
  // 这里对没有对应 [ADOPT] 的 <MODIFIED> 块自动补一条 adoption,保证修改能被采纳。
  const modifiedBlocks = parseModifiedBlocks(reply);
  for (const adoption of adoptions) {
    const match = modifiedBlocks.find(
      (b) => b.target === adoption.target && (b.targetId || "") === (adoption.targetId || ""),
    );
    if (match) {
      adoption.modifiedContent = match.content;
    }
  }
  for (const block of modifiedBlocks) {
    const hasAdoption = adoptions.some(
      (a) => a.target === block.target && (a.targetId || "") === (block.targetId || ""),
    );
    if (!hasAdoption) {
      adoptions.push({
        target: block.target,
        targetId: block.targetId,
        summary: "",
        modifiedContent: block.content,
      });
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
  targetSkillDirName?: string,
): Promise<DiagnosisResult> {
  const pkg = await getPackage(userId, packageId);
  const normalizedTargetSkillDirName = targetSkillDirName?.trim();
  if (!normalizedTargetSkillDirName) {
    assertRubricConfigured(pkg.snapshot.rubricMd, "交互式优化");
  }
  const diagnosisContext = normalizedTargetSkillDirName
    ? buildSkillOnlyContext(pkg, normalizedTargetSkillDirName)
    : buildPackageContext(pkg);
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
    diagnosisContext,
    ...(normalizedTargetSkillDirName ? [
      "",
      `只诊断 target="skill" 且 targetId="${normalizedTargetSkillDirName}" 的问题，不分析 agent、rubric 或其他 Skill。`,
    ] : []),
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

  if (normalizedTargetSkillDirName) {
    issues = issues.filter(
      (issue) => issue.target === "skill" && issue.targetId === normalizedTargetSkillDirName,
    );
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
    [],
    normalizedTargetSkillDirName,
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
  let targetSkillDirName = input.targetSkillDirName?.trim();
  if (input.sessionId) {
    const persistedSession = await getInteractiveSession(userId, input.sessionId);
    if (Number(persistedSession.packageId) !== Number(packageId)) {
      throw new Error("Optimization session does not belong to this package");
    }
    if (
      persistedSession.targetSkillDirName &&
      targetSkillDirName &&
      persistedSession.targetSkillDirName !== targetSkillDirName
    ) {
      throw new Error("Optimization session is bound to a different Skill");
    }
    targetSkillDirName = persistedSession.targetSkillDirName || targetSkillDirName;
  }
  if (!targetSkillDirName) {
    assertRubricConfigured(pkg.snapshot.rubricMd, "交互式优化");
  } else {
    assertSkillOnlyChanges(input.adoptedChanges, targetSkillDirName);
  }
  const editableContext = targetSkillDirName
    ? buildSkillOnlyContext(pkg, targetSkillDirName, input.adoptedChanges)
    : buildPackageContext(pkg, input.adoptedChanges);

  const systemPrompt = [
    "你是 EduClaw-lite 智能体优化专家。你正在与用户对话，帮助优化智能体。",
    "",
    "## 当前智能体内容（已应用已采纳的修改）",
    "",
    editableContext,
    ...(targetSkillDirName ? [
      "",
      `当前是 Skill 专用优化模式。只能修改 target="skill" 且 targetId="${targetSkillDirName}" 的内容。`,
      "禁止修改 agent、rubric 或其他 Skill。",
    ] : []),
    "",
    "## 已采纳的修改",
    buildAdoptedContext(input.adoptedChanges),
    "",
    "## 你的职责",
    "1. 专业、亲切地讨论优化方案",
    "2. 除非用户明确要求同时修改多个地方，否则每次只提出一个具体的修改建议",
    "3. 修改建议要简短聚焦，不要在一次回复中罗列多个问题或大量细节",
    "4. 说明修改的原因和预期效果（每段不超过 3 句话）",
    "5. 向用户说明修改建议时，用通俗、口语化的方式解释，就像跟朋友聊天一样。只说明改了什么、为什么改、预期效果如何。不要在对话正文里贴大段代码或 markdown 原文（修改后的完整内容必须通过 <MODIFIED> 块提交，见规则 6）。",
    "6. 【强制】只要你提出了具体的修改建议（即描述了改什么），就必须在回复末尾用 <MODIFIED> 标签包裹修改后的完整内容供系统内部使用（用户看不到这部分）。缺了 <MODIFIED> 块，你的修改建议会被系统丢弃，等于没改。只修改被明确指出的部分，未被提及的内容必须保持原样，尤其不要随意压缩 package description 或其他概述性说明：",
    "   <MODIFIED target=\"agent\" targetId=\"\">",
    "   ```markdown",
    "   修改后的完整内容（含 frontmatter）",
    "   ```",
    "   </MODIFIED>",
    "   修改 skill 时 target=\"skill\" targetId=\"skill的dirName\"，修改 rubric 时 target=\"rubric\" targetId=\"\"。",
    "7. 如果用户确认采纳某个修改建议，你必须在回复末尾同时输出 <MODIFIED> 块（包含完整修改后内容）和 [ADOPT] 标记。两者缺一不可。即使你之前已经输出过 <MODIFIED> 块，用户确认采纳时也要再次输出，确保系统能拿到最终版本。",
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
    "## <MODIFIED> 块示例（必须严格遵守）",
    "<MODIFIED target=\"skill\" targetId=\"immediate-control\">",
    "```markdown",
    "---",
    "name: immediate-control",
    "description: ...",
    "---",
    "# Skill",
    "修改后的完整正文",
    "```",
    "</MODIFIED>",
    "",
    "## 重要",
    "- 回复正文必须是自然的中文对话，不要提及、解释或暴露 <MODIFIED>、[ADOPT]、[REJECT]、[NEXT]、[DONE] 这些标记的存在",
    "- 不要在对话正文中说\"我会标记\"、\"请确认 adop\"、\"输出 adopt\"之类的话",
    "- 只有当用户明确同意采纳某个具体修改时，才在回复末尾输出 [ADOPT] 标记；用户没有同意时，绝不输出任何标记",
    "- 输出 [ADOPT] 时必须同时输出 <MODIFIED> 块，确保系统能获取完整的修改后内容",
    "- 【最关键】只要你在正文里描述了具体改了什么，就必须在末尾输出对应的 <MODIFIED> 块。没有 <MODIFIED> 块的修改建议会被系统静默丢弃，用户保存时不会生效。",
    "- 所有标记必须单独一行，严格位于回复最末尾，正文里绝对不要出现",
    "- 如果用户要求修改已采纳的内容，可以再次输出 [ADOPT] 覆盖",
  ].join("\n");

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...input.messages.filter((m) => m.role !== "system"),
  ];

  const reply = await generateChat(messages, model, 0.5);
  const parsed = parseMarkers(reply);

  // 将 adoptions 转换为 AdoptedChange。
  // 跳过没有 <MODIFIED> 块的 [ADOPT] 标记:LLM 偶尔只输出 [ADOPT] 而漏掉内容,
  // 此时 modified 会等于 original,属于无效采纳,不应写入 session.adoptedChanges。
  const newAdoptions: AdoptedChange[] = [];
  for (const a of parsed.adoptions) {
    const target = a.target as "agent" | "rubric" | "skill";
    if (targetSkillDirName && (target !== "skill" || a.targetId !== targetSkillDirName)) {
      continue;
    }
    const current = resolveCurrentContentForAdoption(pkg, input.adoptedChanges, target, a.targetId);
    const original = current.content;

    if (a.modifiedContent === undefined) {
      continue;
    }
    const modified = a.modifiedContent;
    if (modified.trim() === original.trim()) {
      continue;
    }

    newAdoptions.push({
      id: `${target}-${a.targetId || ""}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      target,
      targetId: a.targetId,
      targetName: current.targetName || a.targetId,
      original,
      modified,
      reason: a.summary || `修改 ${target}${a.targetId ? `/${a.targetId}` : ""}`,
    });
  }

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
  targetSkillDirName?: string,
): Promise<{ versionId: number; versionNumber: number }> {
  const pkg = await getPackage(userId, packageId);
  let boundTargetSkillDirName = targetSkillDirName?.trim();
  if (sessionId) {
    const persistedSession = await getInteractiveSession(userId, sessionId);
    if (Number(persistedSession.packageId) !== Number(packageId)) {
      throw new Error("Optimization session does not belong to this package");
    }
    if (
      persistedSession.targetSkillDirName &&
      boundTargetSkillDirName &&
      persistedSession.targetSkillDirName !== boundTargetSkillDirName
    ) {
      throw new Error("Optimization session is bound to a different Skill");
    }
    boundTargetSkillDirName = persistedSession.targetSkillDirName || boundTargetSkillDirName;
  }
  if (boundTargetSkillDirName) {
    assertSkillOnlyChanges(changes, boundTargetSkillDirName);
  }
  const normalizedSnapshot = buildInteractiveSnapshotFromAdoptions(pkg, changes);

  await applyOptimizedSnapshot(userId, packageId, normalizedSnapshot, "interactive", note);
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

/* ── feedback optimization（反馈式优化：基于对单条回答的反馈生成 Skill 草稿） ── */
/* 与诊断式优化（diagnosePackage → chatOptimize → applyInteractiveChanges）互补：
   诊断式面向整段对话轨迹做多轮多目标优化；反馈式面向单条回答做一次性 Skill 草稿，
   可测试后直接落盘为新版本，不进入交互会话表。 */

export type FeedbackScope =
  | "reusable_preference"
  | "single_turn_feedback"
  | "unsafe_or_unclear";
export type FeedbackPatchOp =
  | "append_to_section"
  | "replace_in_section"
  | "add_section";

export interface FeedbackPatchOperation {
  op: FeedbackPatchOp;
  targetSection: string;
  oldText?: string;
  content: string;
  rationale?: string;
}

export interface FeedbackOptimizationInput {
  threadId?: string;
  turnIndex?: number;
  userQuestion?: string;
  agentAnswer?: string;
  baselineAnswer?: string;
  userFeedback: string;
  targetSkillId?: string;
}

interface FeedbackLineDiff {
  type: "same" | "removed" | "added";
  text: string;
}

export interface FeedbackOptimizationResult {
  issueSummary: string;
  feedbackScope: FeedbackScope;
  targetSkillId: string;
  targetSkillName: string;
  targetSections: string[];
  patchOperations: FeedbackPatchOperation[];
  rationale: string;
  evidenceFromAnswer: string[];
  riskNotes: string[];
  originalSkillMd: string;
  optimizedSkillMd: string;
  optimizedSnapshot: AgentPackageSnapshot;
  validationErrors: string[];
  diff: FeedbackLineDiff[];
}

export interface FeedbackDraftTestResult {
  optimizedAnswer: string;
}

export interface FeedbackDraftApplyResult {
  versionId: string;
  versionNumber: number;
  package: AgentPackageDetail;
}

interface FeedbackTurnContext {
  threadId?: string;
  turnIndex?: number;
  userQuestion: string;
  agentAnswer: string;
  baselineAnswer?: string;
  userFeedback: string;
}

function computeFeedbackLineDiff(
  oldText: string,
  newText: string,
): FeedbackLineDiff[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const result: FeedbackLineDiff[] = [];
  let i = 0;
  let j = 0;

  while (i < oldLines.length || j < newLines.length) {
    const oldLine = i < oldLines.length ? oldLines[i] : undefined;
    const newLine = j < newLines.length ? newLines[j] : undefined;
    if (oldLine === newLine) {
      result.push({ type: "same", text: oldLine || "" });
      i += 1;
      j += 1;
      continue;
    }

    if (oldLine !== undefined && newLine !== undefined) {
      const newIndexAhead = newLines.slice(j + 1).indexOf(oldLine);
      const oldIndexAhead = oldLines.slice(i + 1).indexOf(newLine);
      if (
        newIndexAhead !== -1 &&
        (oldIndexAhead === -1 || newIndexAhead <= oldIndexAhead)
      ) {
        result.push({ type: "removed", text: oldLine });
        i += 1;
      } else if (
        oldIndexAhead !== -1 &&
        (newIndexAhead === -1 || oldIndexAhead < newIndexAhead)
      ) {
        result.push({ type: "added", text: newLine });
        j += 1;
      } else {
        result.push({ type: "removed", text: oldLine });
        result.push({ type: "added", text: newLine });
        i += 1;
        j += 1;
      }
      continue;
    }

    if (oldLine !== undefined) {
      result.push({ type: "removed", text: oldLine });
      i += 1;
    } else if (newLine !== undefined) {
      result.push({ type: "added", text: newLine });
      j += 1;
    }
  }

  return result;
}

function normalizeFeedbackScope(value: unknown): FeedbackScope {
  return value === "single_turn_feedback" || value === "unsafe_or_unclear"
    ? value
    : "reusable_preference";
}

function normalizePatchOperations(
  value: unknown,
): FeedbackPatchOperation[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const raw =
        item && typeof item === "object"
          ? (item as Record<string, unknown>)
          : {};
      const op: FeedbackPatchOp =
        raw.op === "replace_in_section" || raw.op === "add_section"
          ? raw.op
          : "append_to_section";
      return {
        op,
        targetSection:
          String(raw.targetSection || raw.section || "Workflow").trim() ||
          "Workflow",
        oldText: typeof raw.oldText === "string" ? raw.oldText : undefined,
        content: String(raw.content || "").trim(),
        rationale:
          typeof raw.rationale === "string" ? raw.rationale : undefined,
      };
    })
    .filter((item) => item.content.trim().length > 0);
}

function arrayOfStrings(value: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) return fallback;
  return value
    .map(String)
    .map((item) => item.trim())
    .filter(Boolean);
}

function compactText(value: string, maxChars: number) {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
}

function findSkillByIdOrName(
  skills: PackageSkill[],
  value?: string,
): PackageSkill | undefined {
  if (!value) return undefined;
  const lowered = value.toLowerCase();
  return skills.find(
    (skill) =>
      skill.id === value ||
      skill.dirName === value ||
      skill.name === value ||
      skill.id.toLowerCase() === lowered ||
      skill.dirName.toLowerCase() === lowered ||
      skill.name.toLowerCase() === lowered,
  );
}

async function resolveFeedbackTurnContext(
  userId: string,
  packageId: string | number,
  input: FeedbackOptimizationInput,
): Promise<FeedbackTurnContext> {
  let userQuestion = String(input.userQuestion || "").trim();
  let agentAnswer = String(input.agentAnswer || "").trim();
  let baselineAnswer =
    String(input.baselineAnswer || "").trim() || undefined;
  const userFeedback = String(input.userFeedback || "").trim();
  if (!userFeedback) throw new Error("缺少用户反馈");

  if (input.threadId) {
    const detail = await getThreadDetail(userId, input.threadId);
    if (String(detail.thread.packageId) !== String(packageId)) {
      throw new Error("当前 Arena 对话不属于这个智能体");
    }
    const userMessages = detail.messages.filter(
      (m) => m.side === "shared" && m.role === "user",
    );
    const baselineMessages = detail.messages.filter(
      (m) => m.side === "baseline" && m.role === "assistant",
    );
    const enhancedMessages = detail.messages.filter(
      (m) => m.side === "enhanced" && m.role === "assistant",
    );
    const turnIndex = Number.isFinite(input.turnIndex)
      ? Number(input.turnIndex)
      : userMessages.length - 1;
    if (!userQuestion) userQuestion = userMessages[turnIndex]?.content || "";
    if (!agentAnswer) agentAnswer = enhancedMessages[turnIndex]?.content || "";
    if (!baselineAnswer)
      baselineAnswer =
        baselineMessages[turnIndex]?.content || undefined;
    return {
      threadId: input.threadId,
      turnIndex,
      userQuestion,
      agentAnswer,
      baselineAnswer,
      userFeedback,
    };
  }

  if (!userQuestion || !agentAnswer) {
    throw new Error("缺少当前轮次的问题或智能体回答");
  }
  return { userQuestion, agentAnswer, baselineAnswer, userFeedback };
}

function skillBundleForPrompt(skills: PackageSkill[]) {
  return skills
    .map((skill, index) =>
      [
        `### Skill ${index + 1}`,
        `id: ${skill.id}`,
        `dirName: ${skill.dirName}`,
        `name: ${skill.name}`,
        `description: ${skill.description}`,
        "SKILL.md:",
        "```markdown",
        skill.skillMd.slice(0, 7000),
        "```",
      ].join("\n"),
    )
    .join("\n\n");
}

function buildDraftEnhancedPrompt(snapshot: AgentPackageSnapshot) {
  return [
    "You are an EduClaw agent answering a teacher's question.",
    "Strictly follow the provided agent.md and SKILL.md content. Prefer Chinese unless the user asks otherwise.",
    "",
    "[agent.md]",
    snapshot.agentMd,
    ...(snapshot.skills.length > 0 ? ["", "[available skills]"] : []),
    ...snapshot.skills.flatMap((skill) => [
      "",
      `### ${skill.name}`,
      `Trigger scenario: ${skill.description}`,
      "",
      skill.skillMd,
    ]),
  ].join("\n");
}

function getSectionHeader(sectionName: string) {
  const trimmed = sectionName.trim();
  return trimmed.startsWith("#") ? trimmed : `## ${trimmed}`;
}

function findMarkdownSectionBounds(
  lines: string[],
  sectionName: string,
): [number, number] | null {
  const normalized = sectionName.replace(/^#{1,6}\s+/, "").trim();
  const headerRe = new RegExp(
    `^#{1,6}\\s+${normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`,
    "i",
  );
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (headerRe.test(lines[i]!.trim())) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;
  const level = lines[start]!.match(/^(#{1,6})/)?.[1]?.length || 2;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const match = lines[i]!.match(/^(#{1,6})\s+/);
    if (match && match[1]!.length <= level) {
      end = i;
      break;
    }
  }
  return [start, end];
}

function appendToMarkdownSection(
  markdown: string,
  sectionName: string,
  content: string,
) {
  const lines = markdown.split("\n");
  const bounds = findMarkdownSectionBounds(lines, sectionName);
  if (!bounds)
    return `${markdown.trimEnd()}\n\n${getSectionHeader(sectionName)}\n\n${content.trim()}`.trim();
  const [start, end] = bounds;
  let insertAt = end;
  while (insertAt > start + 1 && !lines[insertAt - 1]!.trim()) insertAt -= 1;
  return [
    ...lines.slice(0, insertAt),
    "",
    content.trim(),
    ...lines.slice(insertAt),
  ]
    .join("\n")
    .trim();
}

function replaceInMarkdownSection(
  markdown: string,
  sectionName: string,
  oldText: string | undefined,
  content: string,
) {
  const lines = markdown.split("\n");
  const bounds = findMarkdownSectionBounds(lines, sectionName);
  if (!bounds)
    return `${markdown.trimEnd()}\n\n${getSectionHeader(sectionName)}\n\n${content.trim()}`.trim();
  const [start, end] = bounds;
  const sectionText = lines.slice(start, end).join("\n");
  if (oldText && sectionText.includes(oldText)) {
    return [
      ...lines.slice(0, start),
      ...sectionText.replace(oldText, content.trim()).split("\n"),
      ...lines.slice(end),
    ]
      .join("\n")
      .trim();
  }
  const nextSection = content.trim().startsWith("#")
    ? content.trim()
    : `${getSectionHeader(sectionName)}\n\n${content.trim()}`;
  return [...lines.slice(0, start), ...nextSection.split("\n"), ...lines.slice(end)].join("\n").trim();
}

function applyFeedbackPatchOperations(
  originalSkillMd: string,
  operations: FeedbackPatchOperation[],
) {
  let current = originalSkillMd;
  for (const operation of operations) {
    if (operation.op === "replace_in_section") {
      current = replaceInMarkdownSection(
        current,
        operation.targetSection,
        operation.oldText,
        operation.content,
      );
    } else if (operation.op === "add_section") {
      const section = operation.content.trim().startsWith("#")
        ? operation.content.trim()
        : `${getSectionHeader(operation.targetSection)}\n\n${operation.content.trim()}`;
      current = `${current.trimEnd()}\n\n${section}`.trim();
    } else {
      current = appendToMarkdownSection(
        current,
        operation.targetSection,
        operation.content,
      );
    }
  }
  return current;
}

function normalizeDraftSnapshot(
  input: unknown,
  fallback: AgentPackageSnapshot,
): AgentPackageSnapshot {
  const raw =
    input && typeof input === "object"
      ? (input as Partial<AgentPackageSnapshot>)
      : {};
  return {
    name: String(raw.name || fallback.name || ""),
    description: String(raw.description || fallback.description || ""),
    versionLabel: String(raw.versionLabel || fallback.versionLabel || "draft"),
    agentMd: typeof raw.agentMd === "string" ? raw.agentMd : fallback.agentMd,
    rubricMd:
      typeof raw.rubricMd === "string" ? raw.rubricMd : fallback.rubricMd,
    skills: Array.isArray(raw.skills)
      ? raw.skills.map((skill, index) => {
          const fallbackSkill = fallback.skills[index];
          const record =
            skill && typeof skill === "object"
              ? (skill as Partial<PackageSkill>)
              : {};
          return {
            id: String(
              record.id || fallbackSkill?.id || `skill-${index + 1}`,
            ),
            dirName: String(
              record.dirName ||
                fallbackSkill?.dirName ||
                `skill-${index + 1}`,
            ),
            name: String(
              record.name || fallbackSkill?.name || `Skill ${index + 1}`,
            ),
            description: String(
              record.description || fallbackSkill?.description || "",
            ),
            skillMd:
              typeof record.skillMd === "string"
                ? record.skillMd
                : fallbackSkill?.skillMd || "",
          };
        })
      : fallback.skills.map((skill) => ({ ...skill })),
  };
}

function validateSnapshotSkills(snapshot: AgentPackageSnapshot) {
  const errors: string[] = [];
  snapshot.skills.forEach((skill, index) => {
    const skillErrors = validatePackageSkillMd(skill.skillMd, skill.dirName);
    skillErrors.forEach((error) => errors.push(`skills[${index}] ${error}`));
  });
  return errors;
}

/**
 * 基于用户对单条回答的反馈，生成一份 Skill 优化草稿。
 * 与诊断式优化（diagnosePackage）的区别：
 * - 诊断式分析整段对话轨迹找问题，多轮讨论后采纳多处修改；
 * - 反馈式只看当前一问一答 + 用户反馈，一次性生成单个 Skill 的优化草稿，
 *   不写入 interactive_optimization_sessions，可测试后直接落盘。
 */
export async function createFeedbackOptimization(
  userId: string,
  packageId: string | number,
  input: FeedbackOptimizationInput,
  model?: string,
): Promise<FeedbackOptimizationResult> {
  const pkg = await getPackage(userId, packageId);
  const turn = await resolveFeedbackTurnContext(userId, packageId, input);
  if (!turn.userQuestion.trim()) throw new Error("缺少当前轮次的问题");
  if (!turn.agentAnswer.trim()) throw new Error("缺少当前轮次的智能体回答");

  const preferredSkill = findSkillByIdOrName(
    pkg.snapshot.skills,
    input.targetSkillId,
  );
  const llmResult = await generateJson<{
    issueSummary?: string;
    feedbackScope?: FeedbackScope;
    targetSkillId?: string;
    targetSkillName?: string;
    targetSections?: string[];
    patchOperations?: FeedbackPatchOperation[];
    rationale?: string;
    evidenceFromAnswer?: string[];
    riskNotes?: string[];
    optimizedSkillMd?: string;
  }>({
    model,
    systemPrompt: [
      "你是 EduClaw 的交互式 Skill 优化专家。",
      "给定一个用户问题、当前智能体回答、教师反馈、package rubric 和所有 SKILL.md 文件，产出一份最小化的可复用 Skill 改进草稿。",
      "本 MVP 阶段不修改 agent.md 或 rubric.md。选择最相关的一个 Skill，返回该 Skill 完整的优化后 SKILL.md。",
      "优先做章节级修改。保留 Skill frontmatter 的 name/description。优化后的 SKILL.md 必须保留这些精确的英文标题：## Instructions, ## Workflow, ## Output Format, ## Examples, ## Common Issues。",
      "反馈分类规则：reusable_preference（应影响未来类似回答）、single_turn_feedback（仅针对本次情况）、unsafe_or_unclear（要求不安全、不可能或模糊的行为）。",
      "所有诊断文本（issueSummary、rationale、evidenceFromAnswer、riskNotes、patchOperations.rationale）必须用中文输出，不要用英文。",
      "SKILL.md 正文在英文标题下使用中文内容。",
      "只返回严格的 JSON，不要额外说明。",
    ].join("\n"),
    userPrompt: [
      "## Package",
      `packageId: ${pkg.id}`,
      `name: ${pkg.name}`,
      `description: ${pkg.description}`,
      "",
      "## Current Turn",
      `turnIndex: ${turn.turnIndex ?? ""}`,
      "User question:",
      turn.userQuestion,
      "",
      "Agent answer:",
      turn.agentAnswer.slice(0, 6000),
      "",
      "Baseline answer:",
      turn.baselineAnswer?.slice(0, 4000) || "(none)",
      "",
      "User feedback:",
      turn.userFeedback,
      "",
      "## Preferred Target Skill",
      preferredSkill
        ? `${preferredSkill.dirName} / ${preferredSkill.name}`
        : "(none; infer from all skills)",
      "",
      "## Rubric",
      pkg.snapshot.rubricMd.slice(0, 5000),
      "",
      "## Skills",
      skillBundleForPrompt(pkg.snapshot.skills),
      "",
      "## JSON Output Shape",
      JSON.stringify(
        {
          issueSummary: "一段简洁的中文诊断说明",
          feedbackScope:
            "reusable_preference | single_turn_feedback | unsafe_or_unclear",
          targetSkillId: "skill id 或 dirName",
          targetSkillName: "显示名",
          targetSections: ["Workflow", "Output Format"],
          patchOperations: [
            {
              op: "append_to_section | replace_in_section | add_section",
              targetSection: "Workflow",
              oldText: "可选，replace_in_section 时需要精确匹配的原文",
              content: "最小化的新章节内容或替换内容（中文）",
              rationale: "为什么这个修改有帮助（中文）",
            },
          ],
          rationale: "为什么这个 Skill 和章节需要修改（中文）",
          evidenceFromAnswer: ["来自回答的简短证据或缺失行为（中文）"],
          riskNotes: ["风险或安全提示（中文）"],
          optimizedSkillMd: "目标 Skill 的完整优化后 SKILL.md",
        },
        null,
        2,
      ),
      "",
      "规则：",
      "- 保持优化后的 SKILL.md 简洁且可复用。不要硬编码特定学生姓名或一次性事实，除非反馈是可复用的。",
      "- 如果反馈要求输出结构，通常更新 Workflow、Output Format 和 Examples。",
      "- 如果回答遗漏了安全边界，更新 Common Issues。",
      "- 所有诊断文本必须用中文，SKILL.md 正文在英文标题下使用中文内容。",
    ].join("\n"),
    temperature: 0.25,
    maxTokens: 8000,
  });

  const targetSkill =
    preferredSkill ||
    findSkillByIdOrName(pkg.snapshot.skills, llmResult.targetSkillId) ||
    findSkillByIdOrName(pkg.snapshot.skills, llmResult.targetSkillName) ||
    pkg.snapshot.skills[0];
  if (!targetSkill) throw new Error("当前智能体没有可优化的 Skill");

  const patchOperations = normalizePatchOperations(llmResult.patchOperations);
  const rawOptimizedSkillMd =
    String(llmResult.optimizedSkillMd || "").trim() ||
    applyFeedbackPatchOperations(targetSkill.skillMd, patchOperations);
  if (!rawOptimizedSkillMd.trim()) {
    throw new Error("模型没有返回可用的 optimizedSkillMd");
  }

  const optimizedSkillMd = normalizeAndRepairSkillMd(
    rawOptimizedSkillMd,
    targetSkill.dirName,
    targetSkill.description,
    {
      name: targetSkill.name,
      sourceContext: [
        `User question: ${turn.userQuestion}`,
        `Agent answer: ${turn.agentAnswer}`,
        `User feedback: ${turn.userFeedback}`,
      ]
        .join("\n")
        .slice(0, 2000),
    },
  );
  const validationErrors = validatePackageSkillMd(
    optimizedSkillMd,
    targetSkill.dirName,
  );
  if (validationErrors.length > 0) {
    console.warn("[interactive.feedback] optimized skill validation failed", {
      packageId,
      targetSkillId: targetSkill.id,
      targetSkillDirName: targetSkill.dirName,
      validationErrors,
    });
    throw new Error(
      `优化草稿未通过 Skill 校验：\n${validationErrors.map((error) => `- ${error}`).join("\n")}`,
    );
  }

  const optimizedSnapshot: AgentPackageSnapshot = {
    ...pkg.snapshot,
    skills: pkg.snapshot.skills.map((skill) =>
      skill.id === targetSkill.id || skill.dirName === targetSkill.dirName
        ? { ...skill, skillMd: optimizedSkillMd }
        : { ...skill },
    ),
  };

  return {
    issueSummary: String(
      llmResult.issueSummary || "根据当前回答和用户反馈生成了 Skill 优化建议。",
    ).trim(),
    feedbackScope: normalizeFeedbackScope(llmResult.feedbackScope),
    targetSkillId: targetSkill.id || targetSkill.dirName,
    targetSkillName: targetSkill.name,
    targetSections: arrayOfStrings(
      llmResult.targetSections,
      patchOperations.map((op) => op.targetSection),
    ),
    patchOperations,
    rationale: String(llmResult.rationale || "").trim(),
    evidenceFromAnswer: arrayOfStrings(llmResult.evidenceFromAnswer, [
      compactText(turn.agentAnswer, 160),
    ]),
    riskNotes: arrayOfStrings(llmResult.riskNotes),
    originalSkillMd: targetSkill.skillMd,
    optimizedSkillMd,
    optimizedSnapshot,
    validationErrors: [],
    diff: computeFeedbackLineDiff(targetSkill.skillMd, optimizedSkillMd),
  };
}

/** 用草稿快照重测当前问题，对比优化前后回答。 */
export async function testFeedbackOptimizationDraft(
  userId: string,
  packageId: string | number,
  input: {
    draftSnapshot?: unknown;
    userQuestion?: string;
    model?: string;
  },
): Promise<FeedbackDraftTestResult> {
  const pkg = await getPackage(userId, packageId);
  const draftSnapshot = normalizeDraftSnapshot(input.draftSnapshot, pkg.snapshot);
  const validationErrors = validateSnapshotSkills(draftSnapshot);
  if (validationErrors.length > 0) {
    throw new Error(
      `优化草稿未通过 Skill 校验：\n${validationErrors.map((error) => `- ${error}`).join("\n")}`,
    );
  }
  const userQuestion = String(input.userQuestion || "").trim();
  if (!userQuestion) throw new Error("缺少用于重测的问题");

  const optimizedAnswer = await generateText({
    model: input.model,
    systemPrompt: buildDraftEnhancedPrompt(draftSnapshot),
    userPrompt: userQuestion,
    temperature: 0.3,
    maxTokens: 3000,
  });

  return { optimizedAnswer: optimizedAnswer.trim() };
}

/** 将反馈式优化草稿落盘为新版本（source = interactive）。 */
export async function applyFeedbackOptimizationDraft(
  userId: string,
  packageId: string | number,
  input: { draftSnapshot?: unknown; changeSummary?: string },
): Promise<FeedbackDraftApplyResult> {
  const pkg = await getPackage(userId, packageId);
  const draftSnapshot = normalizeDraftSnapshot(input.draftSnapshot, pkg.snapshot);
  const validationErrors = validateSnapshotSkills(draftSnapshot);
  if (validationErrors.length > 0) {
    throw new Error(
      `优化草稿未通过 Skill 校验：\n${validationErrors.map((error) => `- ${error}`).join("\n")}`,
    );
  }

  const detail = await applyOptimizedSnapshot(
    userId,
    packageId,
    draftSnapshot,
    "interactive",
    String(input.changeSummary || "交互式反馈优化").trim() ||
      "交互式反馈优化",
  );
  const versions = await listVersions(userId, packageId);
  const latest = versions[0]!;
  return {
    versionId: String(latest.id),
    versionNumber: latest.versionNumber,
    package: detail,
  };
}
