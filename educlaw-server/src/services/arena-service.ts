import type {
  AgentPackageSnapshot,
  ArenaChatResult,
  ArenaMessage,
  ArenaReport,
  ArenaReportSide,
  ArenaThread,
  ArenaThreadDetail,
} from "@educlaw/shared";
import { query } from "./db.js";
import { generateJson, resolveBaselineModel, streamText } from "./llm-service.js";
import { assertRubricConfigured, getPackage } from "./package-service.js";
import type { DbRowMessage, DbRowThread } from "../types.js";

export type ArenaStreamSide = "baseline" | "enhanced";
export type ArenaMode = "compare" | "agent" | "baseline";

export type ArenaChatStreamEvent =
  | { event: "phase"; data: { label: string } }
  | { event: "shared"; data: { message: ArenaMessage } }
  | { event: "side_start"; data: { side: ArenaStreamSide } }
  | { event: "delta"; data: { side: ArenaStreamSide; delta: string } }
  | { event: "side_done"; data: { side: ArenaStreamSide; content: string; ok: boolean; error?: string } }
  | { event: "done"; data: { thread: ArenaThread; messages: ArenaMessage[] } };

function clampNonNegativeNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function normalizeDimension(
  value: unknown,
  index: number,
): ArenaReportSide["dimensions"][number] {
  const record = value as Record<string, unknown> | undefined;
  return {
    key: String(record?.key || `dimension_${index + 1}`),
    name: String(record?.name || `维度 ${index + 1}`),
    score: clampNonNegativeNumber(record?.score),
    maxScore: clampNonNegativeNumber(record?.maxScore, 10) || 10,
    reason: String(record?.reason || "").trim(),
  };
}

function buildFallbackSideSummary(
  label: string,
  side: ArenaReportSide,
): string {
  const dimensions = side.dimensions;
  if (dimensions.length === 0) {
    return `${label}当前总分为 ${side.total.toFixed(2)}。这次报告没有返回足够的维度细节，建议结合对话内容再人工确认一次表现。`;
  }

  const sorted = [...dimensions].sort(
    (left, right) =>
      right.score / Math.max(right.maxScore, 1) -
      left.score / Math.max(left.maxScore, 1),
  );
  const strongest = sorted[0];
  const weakest = sorted[sorted.length - 1];
  const strongestReason = strongest?.reason || "这一项表现相对更稳。";
  const weakestReason =
    weakest && weakest !== strongest
      ? weakest.reason || "这一项还有进一步补强空间。"
      : "整体表现比较平均，没有明显短板。";

  const sentences = [
    `${label}当前总分为 ${side.total.toFixed(2)}，整体表现${dimensions.length >= 3 ? "已经覆盖多个评分维度" : "已能覆盖当前主要维度"}。`,
    `相对更强的是“${strongest?.name || "核心维度"}”：${strongestReason}`,
  ];

  if (weakest && weakest !== strongest) {
    sentences.push(`最需要继续打磨的是“${weakest.name}”：${weakestReason}`);
  } else {
    sentences.push(weakestReason);
  }

  return sentences.join("");
}

function buildFallbackRecommendation(
  report: Pick<ArenaReport, "baseline" | "enhanced" | "winningSide">,
  enhancedLabel: string,
): string {
  const baselineLabel = "Baseline";
  const winner =
    report.winningSide === "enhanced"
      ? enhancedLabel
      : report.winningSide === "baseline"
        ? baselineLabel
        : "两边";
  const loser =
    report.winningSide === "enhanced"
      ? baselineLabel
      : report.winningSide === "baseline"
        ? enhancedLabel
        : "两边";

  const firstSentence =
    report.winningSide === "tie"
      ? `这次对比里，两边总分接近，暂时没有明显拉开差距。`
      : `这次更推荐 ${winner}，因为它在当前 rubric 下的整体完成度更高。`;

  const secondSentence =
    report.winningSide === "tie"
      ? `如果要进一步区分，建议重点看各维度理由里是否真的贴合用户场景。`
      : `${winner}在关键维度上的得分更稳，说明它不仅回答到了点上，也更贴合当前场景要求。`;

  const thirdSentence =
    report.winningSide === "tie"
      ? `后续可以继续补充更细的 rubric 或再跑一轮对话，帮助报告给出更明确的判断。`
      : `${loser}并不是完全不可用，但在针对性、完整性或边界处理上还存在明显短板。`;

  const fourthSentence =
    report.winningSide === "tie"
      ? `下一步优先补充更能拉开差距的评分维度。`
      : `下一步最值得优先改进的方向，是把失分最多的维度补齐到可直接执行、可直接复用的程度。`;

  return [firstSentence, secondSentence, thirdSentence, fourthSentence].join("");
}

function toThread(row: DbRowThread): ArenaThread {
  return {
    id: row.id,
    packageId: row.package_id,
    title: row.title,
    model: row.model,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toMessage(row: DbRowMessage): ArenaMessage {
  return {
    id: row.id,
    threadId: row.thread_id,
    side: row.side as ArenaMessage["side"],
    role: row.role as ArenaMessage["role"],
    content: row.content,
    createdAt: row.created_at,
  };
}

function tokenize(text: string) {
  return Array.from(new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)));
}

function selectRelevantSkills(snapshot: AgentPackageSnapshot, prompt: string) {
  const tokens = tokenize(prompt);
  return snapshot.skills
    .map((skill) => {
      const haystack = `${skill.name} ${skill.description} ${skill.skillMd}`.toLowerCase();
      const score = tokens.reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0);
      return { skill, score };
    })
    .sort((a, b) => b.score - a.score)
    .filter((item) => item.score > 0)
    .slice(0, 3)
    .map((item: { skill: typeof snapshot.skills[0] }) => item.skill);
}

function buildHistory(messages: ArenaMessage[], side: ArenaStreamSide) {
  const lines: string[] = [];
  for (const message of messages) {
    if (message.side !== "shared" && message.side !== side) continue;
    const speaker = message.role === "user" ? "User" : "Assistant";
    lines.push(`${speaker}: ${message.content}`);
  }
  return lines.join("\n");
}

function buildEnhancedPrompt(snapshot: AgentPackageSnapshot, prompt: string) {
  const skills = selectRelevantSkills(snapshot, prompt);
  return [
    "你是一个基于可复用 Markdown 智能体工作的增强助手。",
    "请严格遵循智能体中的设定，同时保持回答自然流畅。",
    "",
    "[agent.md]",
    snapshot.agentMd,
    "",
    "[rubric.md]",
    snapshot.rubricMd,
    ...(skills.length > 0 ? ["", "[selected skills]"] : []),
    ...skills.flatMap((skill) => ["", `## ${skill.name}`, skill.skillMd]),
  ].join("\n");
}

const BASELINE_SYSTEM_PROMPT = [
  "你是一个有帮助的助手。",
  "除非用户明确要求使用其他语言，否则请用中文回答。",
  "回答要务实、清晰、简洁。",
].join("\n");

export async function listThreads(userId: string, packageId: string | number) {
  const result = await query<DbRowThread>(
    "select * from arena_threads where user_id = $1 and package_id = $2 order by updated_at desc",
    [userId, packageId],
  );
  return result.rows.map(toThread);
}

export async function createThread(userId: string, packageId: string | number, model?: string) {
  await getPackage(userId, packageId);

  const now = new Date().toISOString();
  const result = await query<{ id: number }>(
    "insert into arena_threads (user_id, package_id, title, model, created_at, updated_at) values ($1, $2, $3, $4, $5, $6) returning id",
    [userId, packageId, "New Arena Conversation", model || null, now, now],
  );

  const row: DbRowThread = {
    id: result.rows[0].id,
    user_id: userId,
    package_id: Number(packageId),
    title: "New Arena Conversation",
    model: model || null,
    created_at: now,
    updated_at: now,
  };

  return toThread(row);
}

export async function getThreadDetail(userId: string, threadId: string | number): Promise<ArenaThreadDetail> {
  const threadResult = await query<DbRowThread>(
    "select * from arena_threads where id = $1 and user_id = $2",
    [threadId, userId],
  );
  const thread = threadResult.rows[0];
  if (!thread) throw new Error("Arena thread not found");

  const messages = await query<DbRowMessage>(
    "select * from arena_messages where thread_id = $1 and user_id = $2 order by created_at asc",
    [threadId, userId],
  );

  return { thread: toThread(thread), messages: messages.rows.map(toMessage) };
}

export async function* streamMessage(
  userId: string,
  threadId: string | number,
  content: string,
  model?: string,
  mode: ArenaMode = "compare",
): AsyncGenerator<ArenaChatStreamEvent> {
  const prompt = content.trim();
  if (!prompt) throw new Error("Message content is required");
  const sides: ArenaStreamSide[] = mode === "agent"
    ? ["enhanced"]
    : mode === "baseline"
      ? ["baseline"]
      : ["baseline", "enhanced"];

  yield { event: "phase", data: { label: "Loading conversation context" } };
  const detail = await getThreadDetail(userId, threadId);
  const pkg = await getPackage(userId, detail.thread.packageId);
  const now = new Date().toISOString();

  const sharedResult = await query<{ id: number }>(
    "insert into arena_messages (thread_id, user_id, side, role, content, created_at) values ($1, $2, $3, $4, $5, $6) returning id",
    [threadId, userId, "shared", "user", prompt, now],
  );

  const shared: ArenaMessage = {
    id: sharedResult.rows[0].id,
    threadId: Number(threadId),
    side: "shared",
    role: "user",
    content: prompt,
    createdAt: now,
  };

  yield { event: "shared", data: { message: shared } };
  yield {
    event: "phase",
    data: { label: mode === "compare" ? "Generating baseline and enhanced answers" : "Generating answer" },
  };

  const fullHistory = [...detail.messages, shared];
  const queue: Array<Exclude<ArenaChatStreamEvent, { event: "done" }>> = [];
  let pending = sides.length;
  let wake: (() => void) | null = null;
  const sideContents: Record<ArenaStreamSide, string> = { baseline: "", enhanced: "" };

  const signal = () => {
    const current = wake;
    wake = null;
    current?.();
  };

  const push = (event: Exclude<ArenaChatStreamEvent, { event: "done" }>) => {
    queue.push(event);
    signal();
  };

  const runSide = async (side: ArenaStreamSide, systemPrompt: string, userPrompt: string, sideModel?: string) => {
    let sideContent = "";
    try {
      push({ event: "side_start", data: { side } });
      for await (const chunk of streamText({
        model: sideModel,
        systemPrompt,
        userPrompt,
        temperature: 0.3,
      })) {
        sideContent += chunk;
        push({ event: "delta", data: { side, delta: chunk } });
      }
      sideContent = sideContent.trim();
      sideContents[side] = sideContent;
      push({ event: "side_done", data: { side, content: sideContent, ok: true } });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Generation failed";
      const fallback = `Generation failed: ${message}`;
      sideContents[side] = fallback;
      push({ event: "side_done", data: { side, content: fallback, ok: false, error: message } });
    } finally {
      pending -= 1;
      signal();
    }
  };

  if (sides.includes("baseline")) {
    void runSide(
      "baseline",
      BASELINE_SYSTEM_PROMPT,
      buildHistory(fullHistory, "baseline"),
      resolveBaselineModel(model || detail.thread.model || undefined),
    );
  }
  if (sides.includes("enhanced")) {
    void runSide(
      "enhanced",
      buildEnhancedPrompt(pkg.snapshot, shared.content),
      buildHistory(fullHistory, "enhanced"),
      model || detail.thread.model || undefined,
    );
  }

  while (pending > 0 || queue.length > 0) {
    if (queue.length === 0) {
      await new Promise<void>((resolve) => { wake = resolve; });
      continue;
    }
    yield queue.shift()!;
  }

  const savedAt = new Date().toISOString();
  const assistantMessages: ArenaMessage[] = [];

  for (const side of sides) {
    const result = await query<{ id: number }>(
      "insert into arena_messages (thread_id, user_id, side, role, content, created_at) values ($1, $2, $3, $4, $5, $6) returning id",
      [threadId, userId, side, "assistant", sideContents[side], savedAt],
    );
    assistantMessages.push({
      id: result.rows[0].id,
      threadId: Number(threadId),
      side,
      role: "assistant",
      content: sideContents[side],
      createdAt: savedAt,
    });
  }

  await query(
    "update arena_threads set updated_at = $1 where id = $2 and user_id = $3",
    [savedAt, threadId, userId],
  );

  yield {
    event: "done",
    data: {
      thread: { ...detail.thread, updatedAt: savedAt },
      messages: [shared, ...assistantMessages],
    },
  };
}

export async function sendMessage(
  userId: string,
  threadId: string,
  content: string,
  model?: string,
  mode: ArenaMode = "compare",
): Promise<ArenaChatResult> {
  let finalResult: { thread: ArenaThread; messages: ArenaMessage[] } | null = null;
  for await (const event of streamMessage(userId, threadId, content, model, mode)) {
    if (event.event === "done") finalResult = event.data;
  }
  if (!finalResult) {
    throw new Error("Conversation generation returned no result");
  }
  return {
    thread: finalResult.thread,
    shared: finalResult.messages[0]!,
    baseline: finalResult.messages.find((message) => message.side === "baseline"),
    enhanced: finalResult.messages.find((message) => message.side === "enhanced"),
  };
}

export async function generateReport(userId: string, threadId: string | number, model?: string): Promise<ArenaReport> {
  const detail = await getThreadDetail(userId, threadId);
  const pkg = await getPackage(userId, detail.thread.packageId);
  assertRubricConfigured(pkg.snapshot.rubricMd, "评估报告");
  const enhancedLabel = pkg.snapshot.name || "Enhanced";
  const latestUser = [...detail.messages].reverse().find((message) => message.side === "shared" && message.role === "user");
  const latestBaseline = [...detail.messages].reverse().find((message) => message.side === "baseline");
  const latestEnhanced = [...detail.messages].reverse().find((message) => message.side === "enhanced");

  if (!latestUser || !latestBaseline || !latestEnhanced) {
    throw new Error("Run at least one Arena turn before generating a report");
  }

  const rawReport = await generateJson<Partial<ArenaReport>>({
    model,
    systemPrompt: [
      "你是一位 Arena 评估专家。",
      "只返回 JSON 格式。",
      "根据 rubric.md 的评分标准，对基础模型和增强模型进行评估对比。",
      "每一边都必须包含 summary、total 和 dimensions。",
      "summary 必须是 2-4 句完整说明，能让普通用户直接看懂强项、短板和适用性。",
      "recommendation 必须是 3-5 句完整结论，明确说明哪一边更好、为什么更好、还差什么。",
      "dimensions.reason 必须引用回答里的具体表现，不要只写空泛判断。",
    ].join("\n"),
    userPrompt: [
      "[rubric.md]",
      pkg.snapshot.rubricMd,
      "",
      "[用户问题]",
      latestUser.content,
      "",
      "[基础模型回答]",
      latestBaseline.content,
      "",
      "[增强模型回答]",
      latestEnhanced.content,
      "",
      "返回包含以下字段的 JSON：threadId、baseline、enhanced、recommendation、winningSide",
      "",
      "每一边（baseline 和 enhanced）必须包含：",
      "- summary：面向普通用户的评估总结，2-4 句完整中文",
      "- total：总分（数字）",
      "- dimensions：评分维度数组，每个维度包含：",
      "  - key：维度标识符（如 'accuracy'、'completeness'）",
      "  - name：维度显示名称",
      "  - score：得分（数字）",
      "  - maxScore：满分（数字，通常为 10 或 20）",
      "  - reason：2-3 句具体说明，要点名回答中做得好的地方或没做到的地方",
      "",
      "recommendation 需要单独给出一段更完整的综合判断：",
      "- 直接说清最终推荐哪一边",
      "- 说明胜出的关键原因",
      "- 说明另一边主要短板",
      "- 给出下一步最值得优先改进的方向",
    ].join("\n"),
    temperature: 0.2,
  });

  // Normalize with defaults to prevent frontend crashes
  const normalizeSide = (
    side: Partial<ArenaReportSide> | undefined,
    label: string,
  ): ArenaReportSide => {
    const dimensions = Array.isArray(side?.dimensions)
      ? (side.dimensions as unknown[]).map((dimension, index) =>
          normalizeDimension(dimension, index),
        )
      : [];
    const normalized: ArenaReportSide = {
      summary: String(side?.summary || "").trim(),
      total: clampNonNegativeNumber(side?.total),
      dimensions,
    };
    if (!normalized.summary) {
      normalized.summary = buildFallbackSideSummary(label, normalized);
    }
    return normalized;
  };

  const report: ArenaReport = {
    threadId: Number(threadId),
    baseline: normalizeSide(rawReport.baseline, "Baseline"),
    enhanced: normalizeSide(rawReport.enhanced, enhancedLabel),
    recommendation: String(rawReport.recommendation || "").trim(),
    winningSide: ["baseline", "enhanced", "tie"].includes(rawReport.winningSide as string)
      ? (rawReport.winningSide as "baseline" | "enhanced" | "tie")
      : "tie",
  };

  if (!report.recommendation) {
    report.recommendation = buildFallbackRecommendation(report, enhancedLabel);
  }

  return report;
}
