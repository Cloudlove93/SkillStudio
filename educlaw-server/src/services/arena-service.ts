import type {
  AgentPackageSnapshot,
  ArenaChatResult,
  ArenaMessage,
  ArenaReport,
  ArenaReportSide,
  ArenaThread,
  ArenaThreadDetail,
} from "@educlaw/shared";
import { newId, query } from "./db.js";
import { generateJson, resolveBaselineModel, streamText } from "./llm-service.js";
import { getPackage } from "./package-service.js";
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

export async function listThreads(userId: string, packageId: string) {
  const result = await query<DbRowThread>(
    "select * from arena_threads where user_id = $1 and package_id = $2 order by updated_at desc",
    [userId, packageId],
  );
  return result.rows.map(toThread);
}

export async function createThread(userId: string, packageId: string, model?: string) {
  await getPackage(userId, packageId);

  const row: DbRowThread = {
    id: newId(),
    user_id: userId,
    package_id: packageId,
    title: "New Arena Conversation",
    model: model || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  await query(
    "insert into arena_threads (id, user_id, package_id, title, model, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7)",
    [row.id, row.user_id, row.package_id, row.title, row.model, row.created_at, row.updated_at],
  );

  return toThread(row);
}

export async function getThreadDetail(userId: string, threadId: string): Promise<ArenaThreadDetail> {
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
  threadId: string,
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

  const shared: ArenaMessage = {
    id: newId(),
    threadId,
    side: "shared",
    role: "user",
    content: prompt,
    createdAt: now,
  };

  await query(
    "insert into arena_messages (id, thread_id, user_id, side, role, content, created_at) values ($1, $2, $3, $4, $5, $6, $7)",
    [shared.id, threadId, userId, shared.side, shared.role, shared.content, shared.createdAt],
  );

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
  const assistantMessages: ArenaMessage[] = sides.map((side) => ({
    id: newId(),
    threadId,
    side,
    role: "assistant",
    content: sideContents[side],
    createdAt: savedAt,
  }));

  for (const message of assistantMessages) {
    await query(
      "insert into arena_messages (id, thread_id, user_id, side, role, content, created_at) values ($1, $2, $3, $4, $5, $6, $7)",
      [message.id, threadId, userId, message.side, message.role, message.content, message.createdAt],
    );
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

export async function generateReport(userId: string, threadId: string, model?: string): Promise<ArenaReport> {
  const detail = await getThreadDetail(userId, threadId);
  const pkg = await getPackage(userId, detail.thread.packageId);
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
      "- summary：简要评估总结",
      "- total：总分（数字）",
      "- dimensions：评分维度数组，每个维度包含：",
      "  - key：维度标识符（如 'accuracy'、'completeness'）",
      "  - name：维度显示名称",
      "  - score：得分（数字）",
      "  - maxScore：满分（数字，通常为 10 或 20）",
      "  - reason：得分的简要说明",
    ].join("\n"),
    temperature: 0.2,
  });

  // Normalize with defaults to prevent frontend crashes
  const normalizeSide = (side?: Partial<ArenaReportSide>): ArenaReportSide => ({
    summary: side?.summary || "",
    total: typeof side?.total === "number" ? side.total : 0,
    dimensions: Array.isArray(side?.dimensions)
      ? (side.dimensions as unknown[]).map((d) => ({
          key: String((d as Record<string, unknown>).key || ""),
          name: String((d as Record<string, unknown>).name || ""),
          score: typeof (d as Record<string, unknown>).score === "number" ? (d as Record<string, unknown>).score as number : 0,
          maxScore: typeof (d as Record<string, unknown>).maxScore === "number" ? (d as Record<string, unknown>).maxScore as number : 10,
          reason: String((d as Record<string, unknown>).reason || ""),
        }))
      : [],
  });

  const report: ArenaReport = {
    threadId,
    baseline: normalizeSide(rawReport.baseline),
    enhanced: normalizeSide(rawReport.enhanced),
    recommendation: rawReport.recommendation || "",
    winningSide: ["baseline", "enhanced", "tie"].includes(rawReport.winningSide as string)
      ? (rawReport.winningSide as "baseline" | "enhanced" | "tie")
      : "tie",
  };

  return report;
}
