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
    | "rollback";
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
  | "arena.thread.detail";

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
  basePackageVersionId: string;
  left: ArenaThreadVariant;
  right: ArenaThreadVariant;
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
  createdAt: string;
}

export interface ArenaThreadDetail {
  thread: ArenaThread;
  messages: ArenaMessage[];
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
