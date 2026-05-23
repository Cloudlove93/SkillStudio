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
  id: string;
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
  id: string;
  packageId: string;
  versionNumber: number;
  createdAt: string;
  source: "generated" | "imported" | "optimized" | "manual" | "interactive";
  note: string;
  snapshot: AgentPackageSnapshot;
}

export type ArenaSide = "shared" | "baseline" | "enhanced";
export type ArenaRole = "user" | "assistant";

export interface ArenaThread {
  id: string;
  packageId: string;
  title: string;
  model: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ArenaMessage {
  id: string;
  threadId: string;
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
  threadId: string;
  baseline: ArenaReportSide;
  enhanced: ArenaReportSide;
  recommendation: string;
  winningSide: "baseline" | "enhanced" | "tie";
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
  runId: string;
  packageId: string;
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
  packageId: string;
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
  packageId: string;
  versionId: string;
  versionNumber: number;
  issues: OptimizationIssue[];
  snapshot: AgentPackageSnapshot;
}
