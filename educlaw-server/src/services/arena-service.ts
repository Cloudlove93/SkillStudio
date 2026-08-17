import { createHash } from "node:crypto";
import type {
  AgentPackageSnapshot,
  ArenaAnswerOptimizationUnavailableReason,
  ArenaChatResult,
  ArenaKind,
  ArenaMessage,
  ArenaReport,
  ArenaReportSide,
  ArenaThread,
  ArenaThreadDetail,
  PackageSkill,
  SkillArenaConfig,
} from "@educlaw/shared";
import { query, type Queryable, withTransaction } from "./db.js";
import {
  generateJson,
  resolveBaselineModel,
  resolveEnhancedModel,
  streamText,
} from "./llm-service.js";
import {
  assertRubricConfigured,
  getPackage,
  getPackageWithVersionId,
} from "./package-service.js";
import type {
  DbRowArenaAnswerRun,
  DbRowArenaThreadVariant,
  DbRowMessage,
  DbRowPackageVersion,
  DbRowThread,
} from "../types.js";
import { parseDbJson } from "../utils/json.js";

export type ArenaStreamSide = "baseline" | "enhanced";
export type ArenaMode = "compare" | "agent" | "baseline";

export interface ArenaAnswerRun {
  id: number;
  userId: string;
  threadId: number;
  packageId: number;
  packageVersionId: number;
  questionMessageId: number;
  enhancedAnswerMessageId: number;
  baselineAnswerMessageId: number | null;
  usedSkillIds: string[];
  contextMessageIds: number[] | null;
  enhancedModel: string | null;
  baselineUsedSkillIds: string[];
  baselineContextMessageIds: number[] | null;
  baselineModel: string | null;
  baselineSkillVersionId: number | null;
  enhancedSkillVersionId: number | null;
  createdAt: string;
}

export type ArenaAnswerReplayProvenance = Pick<
  ArenaAnswerRun,
  "contextMessageIds" | "enhancedModel"
>;

export interface ArenaAnswerOptimizationAvailability {
  available: boolean;
  reason: ArenaAnswerOptimizationUnavailableReason | null;
}

export interface ArenaSidePromptContext {
  historyMessages: ArenaMessage[];
  contextMessageIds: number[];
  question: ArenaMessage;
  userPrompt: string;
}

export class ArenaAnswerRunNotFoundError extends Error {
  constructor() {
    super("Arena answer run not found");
    this.name = "ArenaAnswerRunNotFoundError";
  }
}

export type ArenaChatStreamEvent =
  | { event: "phase"; data: { label: string } }
  | { event: "shared"; data: { message: ArenaMessage } }
  | { event: "side_start"; data: { side: ArenaStreamSide } }
  | { event: "delta"; data: { side: ArenaStreamSide; delta: string } }
  | { event: "side_done"; data: { side: ArenaStreamSide; content: string; ok: boolean; error?: string } }
  | { event: "done"; data: { thread: ArenaThread; messages: ArenaMessage[] } };

interface SkillArenaVariantSelection {
  skillId: string;
  skillVersionId: string;
}

interface CreateArenaThreadInput {
  authUserId: string;
  packageId: string;
  arenaKind?: ArenaKind;
  basePackageVersionId?: string;
  left?: SkillArenaVariantSelection | null;
  right?: SkillArenaVariantSelection | null;
  model?: string;
  idempotencyKey?: string;
  surface?: "run" | "test" | "arena" | "optimize";
}

interface GetArenaThreadDetailInput {
  authUserId: string;
  packageId: string;
  threadId: string;
}

interface DbSkillArenaVariantRow {
  id: number;
  skill_id: number;
  package_id: number;
  version_number: number;
  skill_uid: string;
  skill_snapshot_json: unknown;
}

interface DbResolvedArenaThreadVariantRow extends DbRowArenaThreadVariant {
  version_number: number;
  skill_uid: string;
  skill_snapshot_json: unknown;
}

interface ArenaRuntimeContext {
  arenaKind: ArenaKind;
  packageSnapshot: AgentPackageSnapshot;
  packageVersionId: number;
  baselineSnapshot: AgentPackageSnapshot | null;
  enhancedSnapshot: AgentPackageSnapshot | null;
  labels: {
    baseline: string;
    enhanced: string;
  };
  skillVersions: {
    baseline: { id: number; versionNumber: number; skillUid: string } | null;
    enhanced: { id: number; versionNumber: number; skillUid: string } | null;
  } | null;
}

export interface ArenaAnswerRunSideProvenance {
  answerMessageId: number;
  usedSkillIds: string[];
  contextMessageIds: number[] | null;
  model: string | null;
  skillVersionId: number | null;
}

export function getArenaAnswerRunSideProvenance(
  answerRun: ArenaAnswerRun,
  side: ArenaStreamSide,
): ArenaAnswerRunSideProvenance {
  return side === "baseline"
    ? {
        answerMessageId: answerRun.baselineAnswerMessageId ?? 0,
        usedSkillIds: [...answerRun.baselineUsedSkillIds],
        contextMessageIds: answerRun.baselineContextMessageIds === null
          ? null
          : [...answerRun.baselineContextMessageIds],
        model: answerRun.baselineModel,
        skillVersionId: answerRun.baselineSkillVersionId,
      }
    : {
        answerMessageId: answerRun.enhancedAnswerMessageId,
        usedSkillIds: [...answerRun.usedSkillIds],
        contextMessageIds: answerRun.contextMessageIds === null
          ? null
          : [...answerRun.contextMessageIds],
        model: answerRun.enhancedModel,
        skillVersionId: answerRun.enhancedSkillVersionId,
      };
}

export class ArenaServiceError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly code = "ARENA_ERROR",
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

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

function toPositiveSafeInteger(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid ${field}`);
  }
  return parsed;
}

function toThread(row: DbRowThread): ArenaThread {
  const arenaKind: ArenaKind =
    row.arena_kind === "skill_arena" ? "skill_arena" : "package_arena";
  return {
    id: row.id,
    packageId: row.package_id,
    title: row.title,
    model: row.model,
    arenaKind,
    basePackageVersionId:
      row.base_package_version_id == null
        ? null
        : String(row.base_package_version_id),
    skillArenaConfig:
      arenaKind === "skill_arena"
        ? parseDbJson<SkillArenaConfig | null>(row.arena_config_jsonb, null)
        : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toMessage(row: DbRowMessage): ArenaMessage {
  return {
    id: toPositiveSafeInteger(row.id, "arena message ID"),
    threadId: toPositiveSafeInteger(row.thread_id, "arena thread ID"),
    side: row.side as ArenaMessage["side"],
    role: row.role as ArenaMessage["role"],
    content: row.content,
    createdAt: row.created_at,
  };
}

function parseUsedSkillIds(value: unknown): string[] {
  const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error("Invalid arena answer run skill IDs");
  }
  return parsed;
}

export function parseArenaAnswerContextMessageIds(
  value: unknown,
): number[] | null {
  if (value === null) return null;
  const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
  if (
    !Array.isArray(parsed) ||
    parsed.some(
      (item) =>
        typeof item !== "number" ||
        !Number.isSafeInteger(item) ||
        item < 1,
    )
  ) {
    throw new Error("Invalid arena answer run context message IDs");
  }
  const ids = parsed.map((item) => Number(item));
  if (new Set(ids).size !== ids.length) {
    throw new Error("Duplicate arena answer run context message IDs");
  }
  return ids;
}

export function parseArenaAnswerEnhancedModel(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new Error("Invalid arena answer run enhanced model");
  }
  return value.trim();
}

export function getAnswerOptimizationAvailability(
  answerRun: ArenaAnswerReplayProvenance | null,
): ArenaAnswerOptimizationAvailability {
  if (!answerRun) {
    return { available: false, reason: "missing_answer_run" };
  }
  if (answerRun.contextMessageIds === null) {
    return { available: false, reason: "replay_context_unavailable" };
  }
  if (!answerRun.enhancedModel?.trim()) {
    return { available: false, reason: "replay_model_unavailable" };
  }
  return { available: true, reason: null };
}

function toAnswerRun(row: DbRowArenaAnswerRun): ArenaAnswerRun {
  return {
    id: Number(row.id),
    userId: row.user_id,
    threadId: Number(row.thread_id),
    packageId: Number(row.package_id),
    packageVersionId: Number(row.package_version_id),
    questionMessageId: Number(row.question_message_id),
    enhancedAnswerMessageId: Number(row.enhanced_answer_message_id),
    baselineAnswerMessageId:
      row.baseline_answer_message_id === null
        ? null
        : Number(row.baseline_answer_message_id),
    usedSkillIds: parseUsedSkillIds(row.used_skill_ids),
    contextMessageIds: parseArenaAnswerContextMessageIds(
      row.context_message_ids,
    ),
    enhancedModel: parseArenaAnswerEnhancedModel(row.enhanced_model),
    baselineUsedSkillIds:
      row.baseline_used_skill_ids == null
        ? []
        : parseUsedSkillIds(row.baseline_used_skill_ids),
    baselineContextMessageIds:
      row.baseline_context_message_ids === undefined
        ? null
        : parseArenaAnswerContextMessageIds(row.baseline_context_message_ids),
    baselineModel:
      row.baseline_model === undefined
        ? null
        : parseArenaAnswerEnhancedModel(row.baseline_model),
    baselineSkillVersionId:
      row.baseline_skill_version_id == null
        ? null
        : Number(row.baseline_skill_version_id),
    enhancedSkillVersionId:
      row.enhanced_skill_version_id == null
        ? null
        : Number(row.enhanced_skill_version_id),
    createdAt: row.created_at,
  };
}

function tokenize(text: string) {
  const tokens = new Set<string>();
  const segments = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  for (const segment of segments) {
    tokens.add(segment);
    for (const match of segment.matchAll(/[\p{Script=Han}]+/gu)) {
      const run = match[0];
      if (run.length === 1) {
        tokens.add(run);
        continue;
      }
      for (let index = 0; index < run.length - 1; index += 1) {
        tokens.add(run.slice(index, index + 2));
      }
    }
  }
  return Array.from(tokens);
}

function buildRequestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function claimIdempotencyKey(
  client: Queryable,
  input: {
    authUserId: string;
    action: string;
    packageId: string;
    idempotencyKey: string;
    requestHash: string;
  },
) {
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString();
  await client.query(
    `delete from api_idempotency_keys
     where user_id = $1
       and action = $2
       and package_id = $3
       and status = 'pending'
       and expires_at < $4`,
    [input.authUserId, input.action, input.packageId, nowIso],
  );
  const insertResult = await client.query<{ id: string }>(
    `insert into api_idempotency_keys
      (user_id, action, package_id, idempotency_key, request_hash, status,
       response_status, response_json, created_at, expires_at)
     values ($1, $2, $3, $4, $5, 'pending', null, null, $6, $7)
     on conflict (user_id, action, package_id, idempotency_key) do nothing
     returning id`,
    [
      input.authUserId,
      input.action,
      input.packageId,
      input.idempotencyKey,
      input.requestHash,
      nowIso,
      expiresAt,
    ],
  );
  if (insertResult.rows[0]) {
    return { kind: "claimed" as const };
  }
  const result = await client.query<{
    request_hash: string;
    status: "pending" | "completed";
    response_status: number | null;
    response_json: unknown;
    expires_at: string;
  }>(
    `select request_hash, status, response_status, response_json, expires_at
     from api_idempotency_keys
     where user_id = $1 and action = $2 and package_id = $3 and idempotency_key = $4
     for update`,
    [input.authUserId, input.action, input.packageId, input.idempotencyKey],
  );
  const row = result.rows[0];
  if (!row) {
    return { kind: "claimed" as const };
  }
  if (row.request_hash !== input.requestHash) {
    throw new ArenaServiceError(
      "Idempotency key was reused with different request data",
      409,
      "IDEMPOTENCY_CONFLICT",
    );
  }
  if (row.status === "completed" && row.response_json) {
    return {
      kind: "replayed" as const,
      responseJson: row.response_json,
    };
  }
  if (new Date(row.expires_at).getTime() > now.getTime()) {
    throw new ArenaServiceError(
      "Idempotency request is already in progress",
      409,
      "IDEMPOTENCY_IN_PROGRESS",
    );
  }
  await client.query(
    `update api_idempotency_keys
     set request_hash = $5,
         status = 'pending',
         response_status = null,
         response_json = null,
         created_at = $6,
         expires_at = $7
     where user_id = $1 and action = $2 and package_id = $3 and idempotency_key = $4`,
    [
      input.authUserId,
      input.action,
      input.packageId,
      input.idempotencyKey,
      input.requestHash,
      nowIso,
      expiresAt,
    ],
  );
  return { kind: "claimed" as const };
}

async function completeIdempotencyKey(
  client: Queryable,
  input: {
    authUserId: string;
    action: string;
    packageId: string;
    idempotencyKey: string;
    requestHash: string;
    responseJson: unknown;
  },
) {
  await client.query(
    `update api_idempotency_keys
     set request_hash = $5,
         status = 'completed',
         response_status = 200,
         response_json = $6
     where user_id = $1 and action = $2 and package_id = $3 and idempotency_key = $4`,
    [
      input.authUserId,
      input.action,
      input.packageId,
      input.idempotencyKey,
      input.requestHash,
      JSON.stringify(input.responseJson),
    ],
  );
}

export function selectRelevantSkills(
  snapshot: AgentPackageSnapshot,
  prompt: string,
): PackageSkill[] {
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

function isHistoryMessageForSide(
  message: ArenaMessage,
  side: ArenaStreamSide,
): boolean {
  return (
    (message.side === "shared" && message.role === "user") ||
    (message.side === side && message.role === "assistant")
  );
}

function formatArenaMessages(messages: ArenaMessage[]): string {
  return messages
    .map((message) => {
      const speaker = message.role === "user" ? "User" : "Assistant";
      return `${speaker}: ${message.content}`;
    })
    .join("\n");
}

export function buildArenaSidePromptContext(
  messages: ArenaMessage[],
  side: ArenaStreamSide,
  question: ArenaMessage,
): ArenaSidePromptContext {
  if (question.side !== "shared" || question.role !== "user") {
    throw new Error("Arena prompt question must be a shared user message");
  }
  const historyMessages = messages.filter((message) =>
    isHistoryMessageForSide(message, side),
  );
  if (historyMessages.some((message) => message.id === question.id)) {
    throw new Error("Arena prompt history must not contain the current question");
  }
  const contextMessageIds = historyMessages.map((message) => message.id);
  if (new Set(contextMessageIds).size !== contextMessageIds.length) {
    throw new Error("Arena prompt history contains duplicate messages");
  }
  return {
    historyMessages,
    contextMessageIds,
    question,
    userPrompt: formatArenaMessages([...historyMessages, question]),
  };
}

export function buildEnhancedPrompt(
  snapshot: AgentPackageSnapshot,
  selectedSkills: PackageSkill[],
) {
  return [
    "你是一个基于可复用 Markdown 智能体工作的增强助手。",
    "请严格遵循智能体中的设定，同时保持回答自然流畅。",
    "",
    "[agent.md]",
    snapshot.agentMd,
    "",
    "[rubric.md]",
    snapshot.rubricMd,
    ...(selectedSkills.length > 0 ? ["", "[selected skills]"] : []),
    ...selectedSkills.flatMap((skill) => ["", `## ${skill.name}`, skill.skillMd]),
  ].join("\n");
}

function buildSkillArenaPrompt(snapshot: AgentPackageSnapshot) {
  const skill = snapshot.skills[0];
  const skillName = skill?.name || skill?.dirName || "未命名技能";
  const skillMd = skill?.skillMd || "";
  return [
    "你是一个基于可复用 Markdown 技能工作的助手。",
    "请严格遵循下方技能（SKILL.md）中的设定进行回答，不要自行扩展技能未描述的内容。",
    "如果技能内容过于简短或缺少具体指令，请如实说明该技能当前无法支撑完整回复，而不是自行编造详细流程。",
    "",
    `[SKILL.md: ${skillName}]`,
    skillMd,
  ].join("\n");
}

const BASELINE_SYSTEM_PROMPT = [
  "你是一个有帮助的助手。",
  "除非用户明确要求使用其他语言，否则请用中文回答。",
  "回答要务实、清晰、简洁。",
].join("\n");

function positiveId(value: string | number, fieldName: string) {
  const text = String(value || "").trim();
  if (!/^[1-9]\d*$/.test(text)) {
    throw new ArenaServiceError(
      `${fieldName} must be a positive integer string`,
      422,
      "INVALID_ARGUMENT",
    );
  }
  return text;
}

async function getOwnedPackageRow(
  client: Queryable,
  authUserId: string,
  packageId: string,
) {
  const result = await client.query<{ id: number; user_id: string }>(
    "select * from agent_packages where id = $1 and user_id = $2",
    [packageId, authUserId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ArenaServiceError("Package not found", 404, "PACKAGE_NOT_FOUND");
  }
  return row;
}

async function getOwnedPackageVersionRow(
  client: Queryable,
  packageId: string,
  versionId: string,
) {
  const result = await client.query<DbRowPackageVersion>(
    "select * from agent_package_versions where id = $1 and package_id = $2",
    [versionId, packageId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ArenaServiceError(
      "Package version not found",
      404,
      "PACKAGE_VERSION_NOT_FOUND",
    );
  }
  return row;
}

async function getOwnedSkillArenaVariant(
  client: Queryable,
  input: {
    authUserId: string;
    packageId: string;
    skillId: string;
    skillVersionId: string;
  },
) {
  const result = await client.query<DbSkillArenaVariantRow>(
    `select sv.*, s.skill_uid
     from agent_skill_versions sv
     join agent_package_skills s
       on s.id = sv.skill_id
      and s.package_id = sv.package_id
     join agent_packages p
       on p.id = s.package_id
     where sv.id = $1
       and sv.skill_id = $2
       and sv.package_id = $3
       and p.user_id = $4`,
    [
      input.skillVersionId,
      input.skillId,
      input.packageId,
      input.authUserId,
    ],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ArenaServiceError(
      "Skill version not found",
      404,
      "SKILL_VERSION_NOT_FOUND",
    );
  }
  return row;
}

/**
 * 根据会话用途生成统一的默认标题。
 * - run / test / optimize：单版本场景，标题带功能前缀，等待前端用首条 prompt 重命名
 * - arena：双版本对比，标题保留左右 Skill 名称
 * - 未指定 surface：兼容旧逻辑
 */
function buildArenaThreadTitle(input: {
  surface?: "run" | "test" | "arena" | "optimize";
  leftSkillName: string;
  rightSkillName: string;
  warning: string | null;
}): string {
  switch (input.surface) {
    case "run":
      return `Skill 使用：${input.leftSkillName}`;
    case "test":
      return `Skill 测试：${input.leftSkillName}`;
    case "optimize":
      return `Skill 优化：${input.leftSkillName}`;
    case "arena":
      return input.warning
        ? `Skill Arena: ${input.leftSkillName}`
        : `Skill Arena: ${input.leftSkillName} vs ${input.rightSkillName}`;
    default:
      return input.warning
        ? `Skill Arena: ${input.leftSkillName}`
        : `Skill Arena: ${input.leftSkillName} vs ${input.rightSkillName}`;
  }
}

function buildSkillArenaConfig(input: {
  basePackageVersionId: string;
  left: DbSkillArenaVariantRow | null;
  right: DbSkillArenaVariantRow | null;
  surface?: "run" | "test" | "arena" | "optimize";
}) {
  const toVariant = (
    side: "left" | "right",
    row: DbSkillArenaVariantRow | null,
  ): SkillArenaConfig["left"] => {
    if (!row) return null;
    const skill = parseDbJson<AgentPackageSnapshot["skills"][number]>(
      row.skill_snapshot_json,
      {
        id: row.skill_uid,
        dirName: "",
        name: row.skill_uid,
        description: "",
        skillMd: "",
      },
    );
    return {
      side,
      skillId: String(row.skill_id),
      skillVersionId: String(row.id),
      skillUid: row.skill_uid,
      skillName: skill.name || row.skill_uid,
      versionNumber: row.version_number,
    };
  };

  return {
    mode: "skill_arena" as const,
    compositionMode: "skill_only" as const,
    ...(input.surface ? { surface: input.surface } : {}),
    basePackageVersionId: input.basePackageVersionId,
    left: toVariant("left", input.left),
    right: toVariant("right", input.right),
  };
}

function cloneSnapshotWithSkill(
  snapshot: AgentPackageSnapshot,
  skill: AgentPackageSnapshot["skills"][number],
): AgentPackageSnapshot {
  return {
    ...snapshot,
    skills: [{ ...skill }],
  };
}

async function getResolvedSkillArenaVariants(
  threadId: string | number,
  packageId: string | number,
) {
  const result = await query<DbResolvedArenaThreadVariantRow>(
    `select atv.*, sv.version_number, s.skill_uid, sv.skill_snapshot_json
     from arena_thread_variants atv
     join agent_skill_versions sv
       on sv.id = atv.skill_version_id
      and sv.skill_id = atv.skill_id
      and sv.package_id = atv.package_id
     join agent_package_skills s
       on s.id = atv.skill_id
      and s.package_id = atv.package_id
     where atv.thread_id = $1
       and atv.package_id = $2
     order by atv.side asc`,
    [threadId, packageId],
  );
  const left = result.rows.find((row) => row.side === "left") ?? null;
  const right = result.rows.find((row) => row.side === "right") ?? null;
  if (!left && !right) {
    throw new ArenaServiceError(
      "Skill arena thread is missing bound skill variants",
      500,
      "ARENA_VARIANTS_MISSING",
    );
  }
  return { left, right };
}

// 查询 Skill Arena 线程绑定的版本号与对应 skill 的最新 active 版本号
// 用于前端显示"已过期"提示，引导用户用最新版本重建
async function getSkillArenaVersionInfo(
  threadId: string | number,
  packageId: string | number,
): Promise<{
  left: { boundSkillVersionNumber: number; latestSkillVersionNumber: number } | null;
  right: { boundSkillVersionNumber: number; latestSkillVersionNumber: number } | null;
} | null> {
  const result = await query<{
    side: string;
    bound_version_number: number;
    latest_version_number: number;
  }>(
    `select atv.side,
       sv.version_number as bound_version_number,
       coalesce((
         select max(sv2.version_number)
         from agent_skill_versions sv2
         where sv2.skill_id = atv.skill_id
           and sv2.package_id = atv.package_id
           and sv2.status = 'active'
       ), sv.version_number) as latest_version_number
     from arena_thread_variants atv
     join agent_skill_versions sv
       on sv.id = atv.skill_version_id
       and sv.skill_id = atv.skill_id
       and sv.package_id = atv.package_id
     where atv.thread_id = $1
       and atv.package_id = $2`,
    [threadId, packageId],
  );
  const left = result.rows.find((row) => row.side === "left");
  const right = result.rows.find((row) => row.side === "right");
  if (!left && !right) return null;
  return {
    left: left ? {
      boundSkillVersionNumber: left.bound_version_number,
      latestSkillVersionNumber: left.latest_version_number,
    } : null,
    right: right ? {
      boundSkillVersionNumber: right.bound_version_number,
      latestSkillVersionNumber: right.latest_version_number,
    } : null,
  };
}

async function resolveThreadRuntime(
  userId: string,
  thread: ArenaThread,
): Promise<ArenaRuntimeContext> {
  if (thread.arenaKind !== "skill_arena") {
    const packageContext = await getPackageWithVersionId(
      userId,
      thread.packageId,
    );
    const pkg = packageContext.package;
    return {
      arenaKind: "package_arena",
      packageSnapshot: pkg.snapshot,
      packageVersionId: packageContext.versionId,
      baselineSnapshot: null,
      enhancedSnapshot: pkg.snapshot,
      labels: {
        baseline: "Baseline",
        enhanced: pkg.snapshot.name || "Enhanced",
      },
      skillVersions: null,
    };
  }

  const basePackageVersionId = positiveId(
    thread.basePackageVersionId || "",
    "basePackageVersionId",
  );
  const baseVersion = await getOwnedPackageVersionRow(
    { query },
    String(thread.packageId),
    basePackageVersionId,
  );
  const baseSnapshot = parseDbJson<AgentPackageSnapshot>(
    baseVersion.snapshot_json,
    {
      name: "",
      description: "",
      versionLabel: "",
      agentMd: "",
      rubricMd: "",
      skills: [],
    },
  );
  const { left, right } = await getResolvedSkillArenaVariants(
    thread.id,
    thread.packageId,
  );
  const leftSkill = left ? parseDbJson<AgentPackageSnapshot["skills"][number]>(
    left.skill_snapshot_json,
    {
      id: left.skill_uid,
      dirName: "",
      name: left.skill_uid,
      description: "",
      skillMd: "",
    },
  ) : null;
  const rightSkill = right ? parseDbJson<AgentPackageSnapshot["skills"][number]>(
    right.skill_snapshot_json,
    {
      id: right.skill_uid,
      dirName: "",
      name: right.skill_uid,
      description: "",
      skillMd: "",
    },
  ) : null;

  return {
    arenaKind: "skill_arena",
    packageSnapshot: baseSnapshot,
    packageVersionId: Number(basePackageVersionId),
    baselineSnapshot: leftSkill ? cloneSnapshotWithSkill(baseSnapshot, leftSkill) : baseSnapshot,
    enhancedSnapshot: rightSkill ? cloneSnapshotWithSkill(baseSnapshot, rightSkill) : baseSnapshot,
    labels: {
      baseline: leftSkill ? `${leftSkill.name || left!.skill_uid} v${left!.version_number}` : "不使用 Skill",
      enhanced: rightSkill ? `${rightSkill.name || right!.skill_uid} v${right!.version_number}` : "不使用 Skill",
    },
    skillVersions: {
      baseline: left ? {
        id: Number(left.skill_version_id),
        versionNumber: Number(left.version_number),
        skillUid: left.skill_uid,
      } : null,
      enhanced: right ? {
        id: Number(right.skill_version_id),
        versionNumber: Number(right.version_number),
        skillUid: right.skill_uid,
      } : null,
    },
  };
}

export async function listThreads(userId: string, packageId: string | number) {
  const result = await query<DbRowThread>(
    "select * from arena_threads where user_id = $1 and package_id = $2 order by updated_at desc",
    [userId, packageId],
  );
  return result.rows.map(toThread);
}

export async function renameArenaThread(input: {
  authUserId: string;
  packageId: string;
  threadId: string;
  title: string;
}) {
  const title = input.title.trim().replace(/\s+/g, " ").slice(0, 120);
  if (!title) {
    throw new ArenaServiceError("Thread title is required", 422, "INVALID_ARGUMENT");
  }
  const result = await query<DbRowThread>(
    "update arena_threads set title = $1, updated_at = now() where id = $2 and user_id = $3 and package_id = $4 returning *",
    [title, input.threadId, input.authUserId, input.packageId],
  );
  const row = result.rows[0];
  if (!row) throw new ArenaServiceError("Arena thread not found", 404, "THREAD_NOT_FOUND");
  return toThread(row);
}

export async function deleteArenaThread(input: {
  authUserId: string;
  packageId: string;
  threadId: string;
}) {
  return withTransaction(async (client) => {
    // These legacy tables do not all have a thread foreign key, so clean the
    // dependent records explicitly before removing the conversation itself.
    await client.query(
      "delete from answer_skill_optimization_runs where thread_id = $1 and user_id = $2 and package_id = $3",
      [input.threadId, input.authUserId, input.packageId],
    );
    await client.query(
      "delete from arena_answer_runs where thread_id = $1 and user_id = $2 and package_id = $3",
      [input.threadId, input.authUserId, input.packageId],
    );
    await client.query(
      "delete from arena_messages where thread_id = $1 and user_id = $2",
      [input.threadId, input.authUserId],
    );
    const result = await client.query<{ id: number }>(
      "delete from arena_threads where id = $1 and user_id = $2 and package_id = $3 returning id",
      [input.threadId, input.authUserId, input.packageId],
    );
    if (result.rows.length === 0) {
      throw new ArenaServiceError("Arena thread not found", 404, "THREAD_NOT_FOUND");
    }
    return { ok: true };
  });
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

export async function createArenaThread(
  input: CreateArenaThreadInput,
): Promise<ArenaThread> {
  const packageId = positiveId(input.packageId, "packageId");
  const arenaKind = input.arenaKind || "package_arena";
  if (arenaKind !== "skill_arena") {
    return createThread(input.authUserId, packageId, input.model);
  }

  const basePackageVersionId = positiveId(
    input.basePackageVersionId || "",
    "basePackageVersionId",
  );
  const leftSelection = input.left;
  const rightSelection = input.right;
  if (!leftSelection && !rightSelection) {
    throw new ArenaServiceError(
      "At least one of left or right skill selection is required",
      422,
      "INVALID_ARGUMENT",
    );
  }
  const leftSkillId = leftSelection ? positiveId(leftSelection.skillId, "left.skillId") : null;
  const leftSkillVersionId = leftSelection ? positiveId(
    leftSelection.skillVersionId,
    "left.skillVersionId",
  ) : null;
  const rightSkillId = rightSelection ? positiveId(rightSelection.skillId, "right.skillId") : null;
  const rightSkillVersionId = rightSelection ? positiveId(
    rightSelection.skillVersionId,
    "right.skillVersionId",
  ) : null;
  const idempotencyKey = String(input.idempotencyKey || "").trim();
  if (!idempotencyKey || idempotencyKey.length > 120) {
    throw new ArenaServiceError(
      "idempotencyKey is required",
      422,
      "INVALID_ARGUMENT",
    );
  }
  const requestHash = buildRequestHash({
    packageId,
    arenaKind: "skill_arena",
    basePackageVersionId,
    left: {
      skillId: leftSkillId,
      skillVersionId: leftSkillVersionId,
    },
    right: {
      skillId: rightSkillId,
      skillVersionId: rightSkillVersionId,
    },
    model: input.model || null,
    surface: input.surface || null,
  });

  return withTransaction(async (client) => {
    const idempotency = await claimIdempotencyKey(client, {
      authUserId: input.authUserId,
      action: "arena.thread.create",
      packageId,
      idempotencyKey,
      requestHash,
    });
    if (idempotency.kind === "replayed") {
      return idempotency.responseJson as ArenaThread;
    }

    await getOwnedPackageRow(client, input.authUserId, packageId);
    await getOwnedPackageVersionRow(client, packageId, basePackageVersionId);
    const [left, right] = await Promise.all([
      leftSkillId && leftSkillVersionId
        ? getOwnedSkillArenaVariant(client, {
            authUserId: input.authUserId,
            packageId,
            skillId: leftSkillId,
            skillVersionId: leftSkillVersionId,
          })
        : null,
      rightSkillId && rightSkillVersionId
        ? getOwnedSkillArenaVariant(client, {
            authUserId: input.authUserId,
            packageId,
            skillId: rightSkillId,
            skillVersionId: rightSkillVersionId,
          })
        : null,
    ]);

    const skillArenaConfig = buildSkillArenaConfig({
      basePackageVersionId,
      left,
      right,
      surface: input.surface,
    });
    const warning =
      leftSkillId && rightSkillId &&
      leftSkillId === rightSkillId &&
      leftSkillVersionId === rightSkillVersionId
        ? "Selected versions are identical"
        : null;
    const now = new Date().toISOString();
    const leftSkillName = skillArenaConfig.left?.skillName ?? "不使用 Skill";
    const rightSkillName = skillArenaConfig.right?.skillName ?? "不使用 Skill";
    const title = buildArenaThreadTitle({
      surface: input.surface,
      leftSkillName,
      rightSkillName,
      warning,
    });
    const threadResult = await client.query<{ id: number }>(
      `insert into arena_threads
        (user_id, package_id, title, model, arena_kind, base_package_version_id, arena_config_jsonb, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $8)
       returning id`,
      [
        input.authUserId,
        packageId,
        title,
        input.model || null,
        "skill_arena",
        basePackageVersionId,
        JSON.stringify(skillArenaConfig),
        now,
      ],
    );
    const threadId = threadResult.rows[0]?.id;
    if (!threadId) {
      throw new ArenaServiceError(
        "Failed to create arena thread",
        500,
        "THREAD_CREATE_FAILED",
      );
    }

    const variants: Array<["left" | "right", DbSkillArenaVariantRow]> = [];
    if (left) variants.push(["left", left]);
    if (right) variants.push(["right", right]);
    for (const [side, variant] of variants) {
      await client.query(
        `insert into arena_thread_variants
          (thread_id, package_id, side, skill_id, skill_version_id, created_at)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          threadId,
          packageId,
          side,
          variant.skill_id,
          variant.id,
          now,
        ],
      );
    }

    const thread: ArenaThread = {
      id: threadId,
      packageId: Number(packageId),
      title,
      model: input.model || null,
      arenaKind: "skill_arena",
      basePackageVersionId,
      skillArenaConfig,
      warning,
      createdAt: now,
      updatedAt: now,
    };
    await completeIdempotencyKey(client, {
      authUserId: input.authUserId,
      action: "arena.thread.create",
      packageId,
      idempotencyKey,
      requestHash,
      responseJson: thread,
    });
    return thread;
  });
}

export async function getThreadDetail(
  userId: string,
  threadId: string | number,
  includeAnswerVersions = false,
): Promise<Omit<ArenaThreadDetail, "answerOptimizations">> {
  const threadResult = await query<DbRowThread>(
    "select * from arena_threads where id = $1 and user_id = $2",
    [threadId, userId],
  );
  const thread = threadResult.rows[0];
  if (!thread) throw new Error("Arena thread not found");

  const messages = await query<DbRowMessage>(
    "select * from arena_messages where thread_id = $1 and user_id = $2 order by created_at asc, id asc",
    [threadId, userId],
  );

  const detail: Omit<ArenaThreadDetail, "answerOptimizations"> = {
    thread: toThread(thread),
    messages: messages.rows.map(toMessage),
  };
  // Skill Arena 线程：附带绑定版本号与最新 active 版本号，供前端显示过期提示
  if (detail.thread.arenaKind === "skill_arena" && includeAnswerVersions) {
    const answerRuns = await query<
      DbRowArenaAnswerRun & {
        baseline_version_number: number | null;
        enhanced_version_number: number | null;
      }
    >(
      `select ar.*,
              bsv.version_number as baseline_version_number,
              esv.version_number as enhanced_version_number
         from arena_answer_runs ar
         left join agent_skill_versions bsv
           on bsv.id = ar.baseline_skill_version_id
         left join agent_skill_versions esv
           on esv.id = ar.enhanced_skill_version_id
        where ar.user_id = $1 and ar.thread_id = $2`,
      [userId, threadId],
    );
    const versionByMessageId = new Map<
      number,
      { id: number; versionNumber: number }
    >();
    for (const row of answerRuns.rows) {
      if (row.baseline_answer_message_id && row.baseline_skill_version_id) {
        versionByMessageId.set(Number(row.baseline_answer_message_id), {
          id: Number(row.baseline_skill_version_id),
          versionNumber: Number(row.baseline_version_number),
        });
      }
      if (row.enhanced_skill_version_id) {
        versionByMessageId.set(Number(row.enhanced_answer_message_id), {
          id: Number(row.enhanced_skill_version_id),
          versionNumber: Number(row.enhanced_version_number),
        });
      }
    }
    detail.messages = detail.messages.map((message) => {
      const version = versionByMessageId.get(message.id);
      return version && Number.isSafeInteger(version.versionNumber)
        ? {
            ...message,
            skillVersionId: String(version.id),
            skillVersionNumber: version.versionNumber,
          }
        : message;
    });
    detail.skillVersionInfo = await getSkillArenaVersionInfo(
      threadId,
      thread.package_id,
    );
  }
  return detail;
}

export async function getArenaAnswerRunByEnhancedMessage(
  userId: string,
  enhancedAnswerMessageId: string | number,
): Promise<ArenaAnswerRun> {
  const result = await query<DbRowArenaAnswerRun>(
    `select * from arena_answer_runs
     where user_id = $1 and enhanced_answer_message_id = $2`,
    [userId, enhancedAnswerMessageId],
  );
  const row = result.rows[0];
  if (!row) throw new ArenaAnswerRunNotFoundError();
  return toAnswerRun(row);
}

export async function getArenaAnswerRunByMessage(
  userId: string,
  answerMessageId: string | number,
): Promise<ArenaAnswerRun> {
  const result = await query<DbRowArenaAnswerRun>(
    `select * from arena_answer_runs
     where user_id = $1
       and (
         enhanced_answer_message_id = $2
         or baseline_answer_message_id = $2
       )`,
    [userId, answerMessageId],
  );
  const row = result.rows[0];
  if (!row) throw new ArenaAnswerRunNotFoundError();
  return toAnswerRun(row);
}

export async function getArenaThreadDetail(
  input: GetArenaThreadDetailInput,
): Promise<Omit<ArenaThreadDetail, "answerOptimizations">> {
  const packageId = positiveId(input.packageId, "packageId");
  const threadId = positiveId(input.threadId, "threadId");
  const detail = await getThreadDetail(input.authUserId, threadId, true);
  if (String(detail.thread.packageId) !== packageId) {
    throw new ArenaServiceError(
      "Arena thread not found",
      404,
      "ARENA_THREAD_NOT_FOUND",
    );
  }
  return detail;
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
  const runtime = await resolveThreadRuntime(userId, detail.thread);
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
  const packageArenaEnhanced =
    runtime.arenaKind !== "skill_arena" && sides.includes("enhanced");
  const enhancedSelectedSkills = packageArenaEnhanced
    ? selectRelevantSkills(runtime.packageSnapshot, prompt)
    : [];
  const usedSkillIds = enhancedSelectedSkills.map((skill) => skill.id);
  const enhancedPromptContext = packageArenaEnhanced
    ? buildArenaSidePromptContext(detail.messages, "enhanced", shared)
    : null;
  const enhancedModel = packageArenaEnhanced
    ? resolveEnhancedModel(model || detail.thread.model || undefined)
    : null;
  const skillArenaPromptContexts = runtime.arenaKind === "skill_arena"
    ? {
        baseline: buildArenaSidePromptContext(detail.messages, "baseline", shared),
        enhanced: buildArenaSidePromptContext(detail.messages, "enhanced", shared),
      }
    : null;
  const skillArenaModel = runtime.arenaKind === "skill_arena"
    ? model || detail.thread.model || resolveEnhancedModel(undefined)
    : null;
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
      runtime.arenaKind === "skill_arena"
        ? buildSkillArenaPrompt(
            runtime.baselineSnapshot || runtime.packageSnapshot,
          )
        : BASELINE_SYSTEM_PROMPT,
       skillArenaPromptContexts?.baseline.userPrompt
         || buildHistory(fullHistory, "baseline"),
      runtime.arenaKind === "skill_arena"
         ? skillArenaModel || undefined
        : resolveBaselineModel(model || detail.thread.model || undefined),
    );
  }
  if (sides.includes("enhanced")) {
    if (runtime.arenaKind === "skill_arena") {
      void runSide(
        "enhanced",
        buildSkillArenaPrompt(
          runtime.enhancedSnapshot || runtime.packageSnapshot,
        ),
         skillArenaPromptContexts?.enhanced.userPrompt
           || buildHistory(fullHistory, "enhanced"),
         skillArenaModel || undefined,
      );
    } else {
      void runSide(
        "enhanced",
        buildEnhancedPrompt(
          runtime.enhancedSnapshot || runtime.packageSnapshot,
          enhancedSelectedSkills,
        ),
        enhancedPromptContext!.userPrompt,
        enhancedModel!,
      );
    }
  }

  while (pending > 0 || queue.length > 0) {
    if (queue.length === 0) {
      await new Promise<void>((resolve) => { wake = resolve; });
      continue;
    }
    yield queue.shift()!;
  }

  const savedAt = new Date().toISOString();
  const assistantMessages = await withTransaction(async (client) => {
    const messages: ArenaMessage[] = [];
    let baselineAnswerMessageId: number | null = null;
    let enhancedAnswerMessageId: number | null = null;

    for (const side of sides) {
      const result = await client.query<{ id: number | string }>(
        "insert into arena_messages (thread_id, user_id, side, role, content, created_at) values ($1, $2, $3, $4, $5, $6) returning id",
        [threadId, userId, side, "assistant", sideContents[side], savedAt],
      );
      const messageId = toPositiveSafeInteger(
        result.rows[0].id,
        "arena message ID",
      );
      if (side === "baseline") baselineAnswerMessageId = messageId;
      if (side === "enhanced") enhancedAnswerMessageId = messageId;
      messages.push({
        id: messageId,
        threadId: Number(threadId),
        side,
        role: "assistant",
        content: sideContents[side],
        createdAt: savedAt,
        ...(runtime.skillVersions && runtime.skillVersions[side]
          ? {
              skillVersionId: String(runtime.skillVersions[side]!.id),
              skillVersionNumber: runtime.skillVersions[side]!.versionNumber,
            }
          : {}),
      });
    }

    if (packageArenaEnhanced || runtime.arenaKind === "skill_arena") {
      if (enhancedAnswerMessageId === null) {
        throw new Error("Enhanced answer was not saved");
      }
      const recordedEnhancedContext = enhancedPromptContext
        || skillArenaPromptContexts?.enhanced;
      const recordedEnhancedModel = enhancedModel || skillArenaModel;
      if (!recordedEnhancedContext || !recordedEnhancedModel) {
        throw new Error("Enhanced answer provenance is unavailable");
      }
      const baselineContext = skillArenaPromptContexts?.baseline ?? null;
      const enhancedUsedSkillIds = runtime.skillVersions?.enhanced
        ? [runtime.skillVersions.enhanced.skillUid]
        : usedSkillIds;
      const baselineUsedSkillIds = runtime.skillVersions?.baseline
        ? [runtime.skillVersions.baseline.skillUid]
        : [];
      await client.query(
        `insert into arena_answer_runs
           (user_id, thread_id, package_id, package_version_id,
            question_message_id, enhanced_answer_message_id,
            baseline_answer_message_id, used_skill_ids,
            context_message_ids, enhanced_model,
            baseline_used_skill_ids, baseline_context_message_ids,
            baseline_model, baseline_skill_version_id,
            enhanced_skill_version_id, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                 $11, $12, $13, $14, $15, $16)`,
        [
          userId,
          threadId,
          detail.thread.packageId,
          runtime.packageVersionId,
          shared.id,
          enhancedAnswerMessageId,
          baselineAnswerMessageId,
          JSON.stringify(enhancedUsedSkillIds),
          JSON.stringify(recordedEnhancedContext.contextMessageIds),
          recordedEnhancedModel,
          JSON.stringify(baselineUsedSkillIds),
          baselineContext
            ? JSON.stringify(baselineContext.contextMessageIds)
            : null,
          baselineContext ? skillArenaModel : null,
          runtime.skillVersions?.baseline?.id ?? null,
          runtime.skillVersions?.enhanced?.id ?? null,
          savedAt,
        ],
      );
    }

    await client.query(
      "update arena_threads set updated_at = $1 where id = $2 and user_id = $3",
      [savedAt, threadId, userId],
    );
    return messages;
  });

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
  const runtime = await resolveThreadRuntime(userId, detail.thread);
  assertRubricConfigured(runtime.packageSnapshot.rubricMd, "评估报告");
  const baselineLabel = runtime.labels.baseline;
  const enhancedLabel = runtime.labels.enhanced;
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
      "[Baseline Label]",
      baselineLabel,
      "",
      "[Enhanced Label]",
      enhancedLabel,
      "",
      "[rubric.md]",
      runtime.packageSnapshot.rubricMd,
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
    baseline: normalizeSide(rawReport.baseline, baselineLabel),
    enhanced: normalizeSide(rawReport.enhanced, enhancedLabel),
    recommendation: String(rawReport.recommendation || "").trim(),
    winningSide: ["baseline", "enhanced", "tie"].includes(rawReport.winningSide as string)
      ? (rawReport.winningSide as "baseline" | "enhanced" | "tie")
      : "tie",
    labels: runtime.labels,
  };

  if (!report.recommendation) {
    report.recommendation = buildFallbackRecommendation(report, enhancedLabel);
  }

  return report;
}
