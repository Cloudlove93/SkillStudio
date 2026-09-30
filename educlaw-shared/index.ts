export const AUTH_ROUTES = {
  REGISTER: "/register",
  LOGIN: "/login",
  ME: "/me",
} as const;

export const PACKAGE_ROUTES = {
  LIST: "/packages",
  DETAIL: "/packages/detail",
} as const;

export const ARENA_ROUTES = {
  THREADS: "/arena/threads",
  CREATE_THREAD: "/arena/threads/create",
  THREAD_DETAIL: "/arena/threads/detail",
  MESSAGE_STREAM: "/arena/threads/messages/stream",
} as const;

export const ANSWER_SKILL_OPTIMIZATION_ROUTES = {
  CREATE: "/arena/answer-optimizations",
  RESOLVE: "/arena/answer-optimizations/resolve",
  SUGGESTIONS: "/arena/answer-optimizations/suggestions",
  DETAIL: "/arena/answer-optimizations/:optimizationId",
  REVISE: "/arena/answer-optimizations/:optimizationId/revise",
  REBASE: "/arena/answer-optimizations/:optimizationId/rebase",
  TEST: "/arena/answer-optimizations/:optimizationId/test",
  CONFIRM: "/arena/answer-optimizations/:optimizationId/confirm",
  CANCEL: "/arena/answer-optimizations/:optimizationId/cancel",
} as const;

export interface AnswerOptimizationSuggestionsRequest {
  packageId: number;
  threadId: number;
  questionMessageId: number;
  answerMessageId: number;
  answerSide: "baseline" | "enhanced";
  answerVersionNumber: number;
}

export interface AnswerOptimizationSuggestionsResult {
  suggestions: [string, string, string];
  source: "ai" | "fallback";
}

export const ANSWER_OPTIMIZATION_SUGGESTION_FALLBACKS: [string, string, string] = [
  "让回答更贴合具体教学目标和学生情况",
  "增加引导学生思考、判断和调整的过程",
  "补充关键边界、安全提醒和完成标准",
];

export interface LoginRequest {
  username: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  user: UserSummary;
}

export interface UserSummary {
  id: string;
  username: string;
}

export interface PackageSkill {
  id: string;
  dirName: string;
  name: string;
  description: string;
  skillMd: string;
}

export interface AgentPackageSnapshot {
  name: string;
  description: string;
  versionLabel: string;
  agentMd: string;
  rubricMd: string;
  skills: PackageSkill[];
}

export interface AgentPackageSummary {
  id: number;
  userId: string;
  name: string;
  description: string;
  versionNumber: number;
  updatedAt: string;
}

export interface AgentPackageDetail extends AgentPackageSummary {
  snapshot: AgentPackageSnapshot;
}

export interface PackageVersion {
  id: number;
  packageId: number;
  versionNumber: number;
  createdAt: string;
  source:
    | "generated"
    | "imported"
    | "optimized"
    | "manual"
    | "interactive"
    | "rollback"
    | "distilled";
  note: string;
  snapshot: AgentPackageSnapshot;
}

export type SkillEntityStatus = "active" | "removed";
export type SkillVersionStatus = "active" | "discarded";
export type SkillVersionSource = PackageVersion["source"];

export interface PackageSkillRecord {
  id: string;
  packageId: string;
  skillUid: string;
  dirName: string;
  name: string;
  description: string;
  status: SkillEntityStatus;
  updatedAt: string;
}

export interface SkillVersionDetail {
  id: string;
  skillId: string;
  packageId: string;
  createdInPackageVersionId: string;
  versionNumber: number;
  source: SkillVersionSource;
  basedOnVersionId: string | null;
  skill: PackageSkill;
  contentHash: string;
  status: SkillVersionStatus;
  note: string;
  createdAt: string;
  discardedAt: string | null;
  discardedBy: string | null;
  discardReason: string | null;
  restoredAt: string | null;
  restoredBy: string | null;
}

export type SkillAction =
  | "skill.list"
  | "skill.version.list"
  | "skill.version.detail"
  | "skill.version.rollback"
  | "skill.version.discard"
  | "skill.version.undiscard"
  | "arena.thread.create"
  | "arena.thread.detail"
  | "arena.thread.rename"
  | "arena.thread.delete";

export type ArenaKind = "package_arena" | "skill_arena";

export interface ArenaThreadVariant {
  side: "left" | "right";
  skillId: string;
  skillVersionId: string;
  skillUid: string;
  skillName: string;
  versionNumber: number;
}

export interface SkillArenaConfig {
  mode: "skill_arena";
  compositionMode: "skill_only";
  /** run: 单版本运行；test: 固定版本测试；arena: 双版本对比；optimize: 交互式优化 */
  surface?: "run" | "test" | "arena" | "optimize";
  basePackageVersionId: string;
  left: ArenaThreadVariant | null;
  right: ArenaThreadVariant | null;
}

export interface RollbackSkillVersionPayload {
  skillId: string;
  versionId: string;
  expectedPackageVersionId: string;
  idempotencyKey: string;
  note?: string;
}

export interface SkillVersionListResult {
  items: SkillVersionDetail[];
  nextCursor: string | null;
  currentVersionId: string | null;
}

export type ArenaSide = "shared" | "baseline" | "enhanced";
export type ArenaRole = "user" | "assistant";

export interface ArenaThread {
  id: number;
  packageId: number;
  title: string;
  model: string | null;
  arenaKind: ArenaKind;
  basePackageVersionId: string | null;
  skillArenaConfig: SkillArenaConfig | null;
  warning?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ArenaMessage {
  id: number;
  threadId: number;
  side: ArenaSide;
  role: ArenaRole;
  content: string;
  reasoningContent?: string | null;
  createdAt: string;
  skillVersionId?: string;
  skillVersionNumber?: number;
}

export type ArenaAnswerOptimizationStatus =
  | "processing"
  | "target_selection_required"
  | "draft_ready"
  | "test_ready"
  | "completed"
  | "cancelled"
  | "failed";

export type ArenaAnswerOptimizationAction =
  | "create"
  | "resume"
  | "restart"
  | "completed"
  | "unavailable";

export type ArenaAnswerOptimizationUnavailableReason =
  | "missing_answer_run"
  | "replay_context_unavailable"
  | "replay_model_unavailable";

export interface ArenaAnswerOptimizationSummary {
  enhancedAnswerMessageId: number;
  optimizationId: number | null;
  status: ArenaAnswerOptimizationStatus | null;
  finalVersionId: number | null;
  versionNumber: number | null;
  canOptimize: boolean;
  action: ArenaAnswerOptimizationAction;
  unavailableReason: ArenaAnswerOptimizationUnavailableReason | null;
}

export interface ArenaThreadSideVersionInfo {
  boundSkillVersionNumber: number;
  latestSkillVersionNumber: number;
}

export interface ArenaThreadDetail {
  thread: ArenaThread;
  messages: ArenaMessage[];
  answerOptimizations: ArenaAnswerOptimizationSummary[];
  // Skill Arena 线程的版本绑定信息（仅 skill_arena 模式有值；package_arena 为 null）
  skillVersionInfo?: {
    left: ArenaThreadSideVersionInfo | null;
    right: ArenaThreadSideVersionInfo | null;
  } | null;
}

export interface ArenaChatResult {
  thread: ArenaThread;
  baseline?: ArenaMessage;
  enhanced?: ArenaMessage;
  shared: ArenaMessage;
}

export interface ArenaDimensionScore {
  key: string;
  name: string;
  score: number;
  maxScore: number;
  reason: string;
}

export interface ArenaReportSide {
  summary: string;
  total: number;
  dimensions: ArenaDimensionScore[];
}

export interface ArenaReport {
  threadId: number;
  baseline: ArenaReportSide;
  enhanced: ArenaReportSide;
  recommendation: string;
  winningSide: "baseline" | "enhanced" | "tie";
  labels?: {
    baseline: string;
    enhanced: string;
  };
}

export interface AutoEvalQuestion {
  id: string;
  title: string;
  prompt: string;
  source: "builtin" | "document";
}

export interface AutoEvalDimensionScore {
  key: string;
  name: string;
  score: number;
  maxScore: number;
  reason: string;
}

export interface AutoEvalCaseResult {
  questionId: string;
  title: string;
  prompt: string;
  score: number;
  maxScore: number;
  summary: string;
  issues: string[];
  suggestions: string[];
  transcript: Array<{ role: string; content: string }>;
}

export interface AutoEvalReport {
  runId: number;
  packageId: number;
  sceneName: string;
  status: "pending" | "running" | "completed" | "failed";
  totalScore: number;
  maxScore: number;
  summary: string;
  dimensions: AutoEvalDimensionScore[];
  cases: AutoEvalCaseResult[];
  issues: string[];
  suggestions: string[];
  compactRetryUsed?: boolean;
  createdAt: string;
  updatedAt: string;
  errorMessage?: string;
}

export interface AutoEvalPreview {
  packageId: number;
  packageName: string;
  skillCount: number;
  builtinQuestions: AutoEvalQuestion[];
  documentQuestions: AutoEvalQuestion[];
  dimensions: Array<{ key: string; name: string; maxScore: number; description: string }>;
  latestRun?: AutoEvalReport;
}

export interface OptimizationIssue {
  expert: "persona" | "skill" | "rubric" | "merge";
  target: "agent" | "skill" | "rubric";
  targetId?: string;
  title: string;
  reason: string;
  evidence: string[];
}

export interface OptimizationResult {
  packageId: number;
  versionId: number;
  versionNumber: number;
  issues: OptimizationIssue[];
  snapshot: AgentPackageSnapshot;
}

export type GuidedCreationAction =
  | "SkillGuidedCreationStart"
  | "SkillGuidedCreationList"
  | "SkillGuidedCreationDetail"
  | "SkillGuidedCreationMessage"
  | "SkillGuidedCreationConfirm"
  | "SkillGuidedCreationCancel"
  | "SkillGuidedCreationRename"
  | "SkillGuidedCreationDelete";

export type GuidedCreationStatus =
  | "collecting"
  | "ready_for_confirmation"
  | "finalizing"
  | "completed"
  | "failed"
  | "cancelled";

export type GuidedCreationStage =
  | "positioning"
  | "scenario_input"
  | "expected_result"
  | "working_method"
  | "evidence_scope"
  | "boundaries_completion";

export type GuidedDraftField =
  | "roles"
  | "goal"
  | "usage_scenario"
  | "input_contract"
  | "output_contract"
  | "core_capabilities"
  | "workflow"
  | "knowledge_evidence"
  | "boundaries_permissions"
  | "exception_recovery"
  | "completion_evidence";

export type GuidedFieldState =
  | "explicit"
  | "inferred"
  | "defaulted"
  | "missing"
  | "conflicted";

export type GuidedSkillDraft = Partial<Record<GuidedDraftField, string>>;

export type GuidedEducationDimension =
  | "educational_goal"
  | "audience_context"
  | "input_evidence"
  | "teaching_strategy"
  | "action_adaptation"
  | "boundaries_responsibility"
  | "completion_evidence";

export type GuidedCreationStep =
  | "intent_context"
  | "teacher_experience"
  | "strategy_co_creation"
  | "action_adjustment"
  | "evidence_review";

export type GuidedEducationEvidenceSource =
  | "user_explicit"
  | "user_adopted"
  | "inferred"
  | "platform_default"
  | "conflicted";

/**
 * v3 教育版草稿操作类型。
 * - set：补充新内容（默认）
 * - replace：用户明确纠正或否定先前说法时覆盖 content 并清空旧 evidence
 * - remove：用户撤回该维度内容时删除整个 section
 */
export type GuidedEducationDraftOp = "set" | "replace" | "remove";

export interface GuidedEducationEvidence {
  source: GuidedEducationEvidenceSource;
  quote?: string;
  experience_id?: string;
}

export interface GuidedEducationSection {
  content: string;
  evidence: GuidedEducationEvidence[];
}

export type GuidedEducationDraft = Partial<
  Record<GuidedEducationDimension, GuidedEducationSection>
>;

export interface GuidedCreationDocument {
  name: string;
  content: string;
  mime_type?: string;
}

export interface GuidedConfirmationSection {
  key:
    | "positioning"
    | "scenario"
    | "input_output"
    | "capability_flow"
    | "knowledge_boundary"
    | "recovery_completion"
    | GuidedEducationDimension;
  title: string;
  content: string;
}

export interface GuidedConfirmationCard {
  title: string;
  sections: GuidedConfirmationSection[];
}

export interface GuidedCreationMessage {
  id: string;
  session_id: string;
  message_no: number;
  client_message_id: string | null;
  role: "user" | "assistant";
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface GuidedCreationSession {
  id: string;
  display_name: string | null;
  deleted_at: string | null;
  status: GuidedCreationStatus;
  model: string | null;
  documents: GuidedCreationDocument[];
  draft: GuidedSkillDraft;
  field_states: Record<GuidedDraftField, GuidedFieldState>;
  education_draft?: GuidedEducationDraft;
  flow_version: number;
  confirmed_stages: GuidedCreationStage[];
  next_stage: GuidedCreationStage | null;
  completed_steps?: GuidedCreationStep[];
  current_step?: GuidedCreationStep | null;
  confirmation: GuidedConfirmationCard | null;
  revision_no: number;
  package_id: string | null;
  skill_id: string | null;
  skill_version_id: string | null;
  error: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface GuidedCreationSessionDetail extends GuidedCreationSession {
  messages: GuidedCreationMessage[];
}

export interface GuidedCreationStartPayload {
  content: string;
  client_message_id: string;
  model?: string;
  documents?: GuidedCreationDocument[];
}

export interface GuidedCreationMessagePayload {
  session_id: string;
  client_message_id: string;
  revision_no: number;
  content: string;
}

export interface GuidedCreationConfirmPayload {
  session_id: string;
  revision_no: number;
  request_id: string;
}

export interface GuidedCreationDetailPayload {
  session_id: string;
}

export interface GuidedCreationListPayload {
  status?: GuidedCreationStatus[];
  limit?: number;
  cursor?: string;
}

export interface GuidedCreationCancelPayload {
  session_id: string;
  revision_no: number;
}

export interface GuidedCreationRenamePayload {
  session_id: string;
  revision_no: number;
  display_name: string;
}

export interface GuidedCreationDeletePayload {
  session_id: string;
  revision_no: number;
}

export type GuidedCreationStreamEvent =
  | { type: "phase"; phase: "understanding" | "questioning" | "generating" | "validating" | "saving" }
  | { type: "message"; message: GuidedCreationMessage }
  | { type: "confirmation"; session: GuidedCreationSession }
  | { type: "preview"; files: Array<{ path: string; content: string }> }
  | { type: "done"; session: GuidedCreationSession }
  | { type: "error"; code: string; message: string; retryable: boolean }
  | { type: "stream_end" };
export * from "./src/multimodal-contract.js";
