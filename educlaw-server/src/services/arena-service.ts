import type {
  AgentPackageSnapshot,
  ArenaChatResult,
  ArenaMessage,
  ArenaReport,
  ArenaThread,
  ArenaThreadDetail,
} from "@educlaw/shared";
import { newId, query } from "./db.js";
import { generateJson, resolveBaselineModel, streamText } from "./llm-service.js";
import { getPackage } from "./package-service.js";
import type { DbRowMessage, DbRowThread } from "../types.js";

export type ArenaStreamSide = "baseline" | "enhanced";

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
    .map((item) => item.skill);
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
    "你是一个基于可复用 Markdown 智能体包工作的增强助手。",
    "请严格遵循智能体包中的设定，同时保持回答自然流畅。",
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
): AsyncGenerator<ArenaChatStreamEvent> {
  const prompt = content.trim();
  if (!prompt) throw new Error("Message content is required");

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
  yield { event: "phase", data: { label: "Generating baseline and enhanced answers" } };

  const fullHistory = [...detail.messages, shared];
  const queue: Array<Exclude<ArenaChatStreamEvent, { event: "done" }>> = [];
  let pending = 2;
  let wake: (() => void) | null = null;
  let baselineContent = "";
  let enhancedContent = "";

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
      if (side === "baseline") baselineContent = sideContent;
      else enhancedContent = sideContent;
      push({ event: "side_done", data: { side, content: sideContent, ok: true } });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Generation failed";
      const fallback = `Generation failed: ${message}`;
      if (side === "baseline") baselineContent = fallback;
      else enhancedContent = fallback;
      push({ event: "side_done", data: { side, content: fallback, ok: false, error: message } });
    } finally {
      pending -= 1;
      signal();
    }
  };

  void runSide(
    "baseline",
    BASELINE_SYSTEM_PROMPT,
    buildHistory(fullHistory, "baseline"),
    resolveBaselineModel(model || detail.thread.model || undefined),
  );
  void runSide(
    "enhanced",
    buildEnhancedPrompt(pkg.snapshot, shared.content),
    buildHistory(fullHistory, "enhanced"),
    model || detail.thread.model || undefined,
  );

  while (pending > 0 || queue.length > 0) {
    if (queue.length === 0) {
      await new Promise<void>((resolve) => { wake = resolve; });
      continue;
    }
    yield queue.shift()!;
  }

  const savedAt = new Date().toISOString();
  const baselineMessage: ArenaMessage = {
    id: newId(),
    threadId,
    side: "baseline",
    role: "assistant",
    content: baselineContent,
    createdAt: savedAt,
  };
  const enhancedMessage: ArenaMessage = {
    id: newId(),
    threadId,
    side: "enhanced",
    role: "assistant",
    content: enhancedContent,
    createdAt: savedAt,
  };

  await query(
    "insert into arena_messages (id, thread_id, user_id, side, role, content, created_at) values ($1, $2, $3, $4, $5, $6, $7), ($8, $9, $10, $11, $12, $13, $14)",
    [
      baselineMessage.id, threadId, userId, baselineMessage.side, baselineMessage.role, baselineMessage.content, baselineMessage.createdAt,
      enhancedMessage.id, threadId, userId, enhancedMessage.side, enhancedMessage.role, enhancedMessage.content, enhancedMessage.createdAt,
    ],
  );

  await query(
    "update arena_threads set updated_at = $1 where id = $2 and user_id = $3",
    [savedAt, threadId, userId],
  );

  yield {
    event: "done",
    data: {
      thread: { ...detail.thread, updatedAt: savedAt },
      messages: [shared, baselineMessage, enhancedMessage],
    },
  };
}

export async function sendMessage(
  userId: string,
  threadId: string,
  content: string,
  model?: string,
): Promise<ArenaChatResult> {
  let finalResult: { thread: ArenaThread; messages: ArenaMessage[] } | null = null;
  for await (const event of streamMessage(userId, threadId, content, model)) {
    if (event.event === "done") finalResult = event.data;
  }
  if (!finalResult) {
    throw new Error("Conversation generation returned no result");
  }
  return {
    thread: finalResult.thread,
    shared: finalResult.messages[0]!,
    baseline: finalResult.messages[1]!,
    enhanced: finalResult.messages[2]!,
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

  const report = await generateJson<ArenaReport>({
    model,
    systemPrompt: [
      "You are an arena evaluator.",
      "Return JSON only.",
      "Evaluate baseline vs enhanced using the rubric markdown.",
      "Each side should include summary, total, and dimensions.",
    ].join("\n"),
    userPrompt: [
      "[rubric.md]",
      pkg.snapshot.rubricMd,
      "",
      "[user question]",
      latestUser.content,
      "",
      "[baseline answer]",
      latestBaseline.content,
      "",
      "[enhanced answer]",
      latestEnhanced.content,
      "",
      "Return JSON with keys: threadId, baseline, enhanced, recommendation, winningSide",
    ].join("\n"),
    temperature: 0.2,
  });

  return { ...report, threadId };
}