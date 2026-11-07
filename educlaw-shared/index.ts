export const AUTH_ROUTES = {
  REGISTER: '/register',
  LOGIN: '/login',
  ME: '/me',
} as const;

export const PACKAGE_ROUTES = {
  LIST: '/packages',
  DETAIL: '/packages/detail',
} as const;

export const ARENA_ROUTES = {
  THREADS: '/arena/threads',
  CREATE_THREAD: '/arena/threads/create',
  THREAD_DETAIL: '/arena/threads/detail',
  MESSAGE_STREAM: '/arena/threads/:threadId/messages/stream',
  LEGACY_MESSAGE_STREAM: '/arena/threads/messages/stream',
} as const;

export const ANSWER_SKILL_OPTIMIZATION_ROUTES = {
  CREATE: '/arena/answer-optimizations',
  RESOLVE: '/arena/answer-optimizations/resolve',
  SUGGESTIONS: '/arena/answer-optimizations/suggestions',
  DETAIL: '/arena/answer-optimizations/:optimizationId',
  REVISE: '/arena/answer-optimizations/:optimizationId/revise',
  REBASE: '/arena/answer-optimizations/:optimizationId/rebase',
  TEST: '/arena/answer-optimizations/:optimizationId/test',
  CONFIRM: '/arena/answer-optimizations/:optimizationId/confirm',
  CANCEL: '/arena/answer-optimizations/:optimizationId/cancel',
} as const;

export interface AnswerOptimizationSuggestionsRequest {
  packageId: number;
  threadId: number;
  questionMessageId: number;
  answerMessageId: number;
  answerSide: 'baseline' | 'enhanced';
  answerVersionNumber: number;
}

export interface AnswerOptimizationSuggestionsResult {
  suggestions: [string, string, string];
  source: 'ai' | 'fallback';
}

export const ANSWER_OPTIMIZATION_SUGGESTION_FALLBACKS: [
  string,
  string,
  string,
] = [
  '让回答更贴合具体教学目标和学生情况',
  '增加引导学生思考、判断和调整的过程',
  '补充关键边界、安全提醒和完成标准',
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
  /** Agent 包内标记该 Skill 是否启用；缺省视为启用。 */
  enabled?: boolean;
  /** 跨包副本的原始归属；名称不能用作资源标识。 */
  originPackageId?: string;
  originSkillId?: string;
}

export interface AgentPackageSnapshot {
  name: string;
  description: string;
  versionLabel: string;
  agentMd: string;
  rubricMd: string;
  skills: PackageSkill[];
  sourceSessionId?: string;
  /** Optional so snapshots written before workflows remain readable. */
  workflow?: WorkflowDefinition;
}

export type WorkflowNodeType = 'start' | 'llm' | 'skill' | 'condition' | 'loop' | 'end';
export type WorkflowConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'is_empty'
  | 'not_empty';

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  name: string;
  position: { x: number; y: number };
  params: Record<string, unknown>;
}

export interface WorkflowEdge {
  id: string;
  from: string;
  to: string;
  condition?: 'true' | 'false';
}

export interface WorkflowDefinition {
  schemaVersion: 1;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface WorkflowValidationError {
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface WorkflowNodeTrace {
  nodeId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped';
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  input?: unknown;
  output?: unknown;
  error?: { code: string; message: string; retryable: boolean };
}

export interface WorkflowRunReport {
  runId: string;
  packageId: string;
  packageVersionId: string;
  requestId: string;
  status: 'running' | 'succeeded' | 'failed';
  input: string;
  output?: string;
  traces: WorkflowNodeTrace[];
  startedAt: string;
  endedAt?: string;
  error?: { code: string; message: string };
}

/** Pure structural validation shared by the editor and the server. */
export function validateWorkflowDefinition(value: unknown): WorkflowValidationError[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [{ code: 'WORKFLOW_INVALID', message: '工作流定义必须是对象。' }];
  }
  const definition = value as Partial<WorkflowDefinition>;
  if (definition.schemaVersion !== 1 || !Array.isArray(definition.nodes) || !Array.isArray(definition.edges)) {
    return [{ code: 'WORKFLOW_INVALID', message: '工作流版本或节点、连线格式无效。' }];
  }
  if (definition.nodes.length < 2 || definition.nodes.length > 30) {
    return [{ code: 'WORKFLOW_INVALID', message: '工作流节点数必须在 2 到 30 之间。' }];
  }
  const errors: WorkflowValidationError[] = [];
  const nodes = definition.nodes as WorkflowNode[];
  const edges = definition.edges as WorkflowEdge[];
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const allowedTypes = new Set<WorkflowNodeType>(['start', 'llm', 'skill', 'condition', 'loop', 'end']);
  for (const node of nodes) {
    if (!node || typeof node.id !== 'string' || !node.id.trim() || nodeIds.has(node.id)) {
      errors.push({ code: 'WORKFLOW_INVALID', message: '节点 ID 必须唯一且非空。', nodeId: node?.id });
    } else nodeIds.add(node.id);
    if (!allowedTypes.has(node?.type)) {
      errors.push({ code: 'WORKFLOW_INVALID', message: '节点类型不受支持。', nodeId: node?.id });
    }
    if (node?.type === 'loop') {
      const iterations = Number(node.params?.iterations);
      if (!Number.isInteger(iterations) || iterations < 1 || iterations > 20) {
        errors.push({ code: 'WORKFLOW_INVALID', message: '循环节点的循环次数必须为 1 到 20 的整数。', nodeId: node.id });
      }
      if (typeof node.params?.promptTemplate !== 'string' || !node.params.promptTemplate.trim()) {
        errors.push({ code: 'WORKFLOW_INVALID', message: '循环节点需要填写每轮处理说明。', nodeId: node.id });
      }
    }
  }
  const starts = nodes.filter(node => node.type === 'start');
  const ends = nodes.filter(node => node.type === 'end');
  if (starts.length !== 1) errors.push({ code: 'WORKFLOW_INVALID', message: '必须且只能有一个开始节点。' });
  if (ends.length !== 1) errors.push({ code: 'WORKFLOW_INVALID', message: '必须且只能有一个结束节点。' });
  const incoming = new Map<string, WorkflowEdge[]>();
  const outgoing = new Map<string, WorkflowEdge[]>();
  const edgeKeys = new Set<string>();
  for (const edge of edges) {
    if (!edge || typeof edge.id !== 'string' || !edge.id.trim() || edgeIds.has(edge.id)) {
      errors.push({ code: 'WORKFLOW_INVALID', message: '连线 ID 必须唯一且非空。', edgeId: edge?.id });
      continue;
    }
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to) || edge.from === edge.to) {
      errors.push({ code: 'WORKFLOW_INVALID', message: '连线必须连接两个不同的有效节点。', edgeId: edge.id });
      continue;
    }
    const key = `${edge.from}:${edge.to}:${edge.condition || ''}`;
    if (edgeKeys.has(key)) errors.push({ code: 'WORKFLOW_INVALID', message: '存在重复连线。', edgeId: edge.id });
    edgeKeys.add(key);
    incoming.set(edge.to, [...(incoming.get(edge.to) || []), edge]);
    outgoing.set(edge.from, [...(outgoing.get(edge.from) || []), edge]);
  }
  for (const node of nodes) {
    const ins = incoming.get(node.id) || [];
    const outs = outgoing.get(node.id) || [];
    if (node.type === 'start' && ins.length) errors.push({ code: 'WORKFLOW_INVALID', message: '开始节点不能有入线。', nodeId: node.id });
    if (node.type === 'end' && outs.length) errors.push({ code: 'WORKFLOW_INVALID', message: '结束节点不能有出线。', nodeId: node.id });
    if (node.type !== 'start' && node.type !== 'end' && ins.length !== 1) errors.push({ code: 'WORKFLOW_INVALID', message: '除开始和结束节点外，每个节点必须有一条入线。', nodeId: node.id });
    if (node.type === 'end' && ins.length < 1) errors.push({ code: 'WORKFLOW_INVALID', message: '结束节点必须有至少一条入线。', nodeId: node.id });
    if (node.type === 'condition') {
      const labels = new Set(outs.map(edge => edge.condition));
      if (outs.length !== 2 || !labels.has('true') || !labels.has('false')) {
        errors.push({ code: 'WORKFLOW_INVALID', message: '条件节点必须有 true 和 false 两条出线。', nodeId: node.id });
      }
    } else if (node.type !== 'end' && outs.length !== 1) {
      errors.push({ code: 'WORKFLOW_INVALID', message: '该节点必须有一条出线。', nodeId: node.id });
    }
  }
  const start = starts[0];
  if (!start) return errors;
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) { errors.push({ code: 'WORKFLOW_INVALID', message: '工作流不能包含循环。', nodeId: id }); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const edge of outgoing.get(id) || []) visit(edge.to);
    visiting.delete(id);
    visited.add(id);
  };
  visit(start.id);
  for (const node of nodes) {
    if (!visited.has(node.id)) errors.push({ code: 'WORKFLOW_INVALID', message: '节点必须可从开始节点到达。', nodeId: node.id });
  }
  return errors;
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
    | 'generated'
    | 'imported'
    | 'optimized'
    | 'manual'
    | 'interactive'
    | 'rollback'
    | 'distilled';
  note: string;
  snapshot: AgentPackageSnapshot;
}

export type SkillEntityStatus = 'active' | 'removed';
export type SkillVersionStatus = 'active' | 'discarded';
export type SkillVersionSource = PackageVersion['source'];

export interface PackageSkillRecord {
  id: string;
  packageId: string;
  skillUid: string;
  dirName: string;
  name: string;
  description: string;
  status: SkillEntityStatus;
  updatedAt: string;
  originPackageId?: string;
  originSkillId?: string;
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
  | 'skill.list'
  | 'skill.version.list'
  | 'skill.version.detail'
  | 'skill.version.manual-edit'
  | 'skill.version.rollback'
  | 'skill.version.discard'
  | 'skill.version.undiscard'
  | 'arena.thread.create'
  | 'arena.thread.detail'
  | 'arena.thread.rename'
  | 'arena.thread.delete';

export type ArenaKind = 'package_arena' | 'skill_arena';

export interface ArenaThreadVariant {
  side: 'left' | 'right';
  skillId: string;
  skillVersionId: string;
  skillUid: string;
  skillName: string;
  versionNumber: number;
}

/** User-configured Agent with explicitly pinned reusable Skills. */
export interface AgentSkillBinding {
  skillId: string;
  skillVersionId: string;
  enabled: boolean;
}
export interface AgentResolvedSkill extends AgentSkillBinding {
  packageId: string;
  name: string;
  description: string;
  versionNumber: number;
  /** 为 false 表示固定的 Skill 或版本已不可用，需要重新选择。 */
  available: boolean;
}
export interface AgentWorkspace {
  id: string;
  name: string;
  description: string;
  instructions: string;
  model: string;
  skills: AgentResolvedSkill[];
  createdAt: string;
  updatedAt: string;
  /** 当前 Agent package version 的数据库 ID。 */
  currentVersion?: string;
  sourceSessionId?: string | null;
}
export type AgentSummary = AgentWorkspace;

/** 生成事务完成后返回的双仓资源，旧记录可以没有此字段。 */
export interface GeneratedAgentResult {
  agentId: string;
  skillId: string;
  skillVersionId: string;
  packageVersionId: string;
  sourceSessionId: string;
  name: string;
  description: string;
  instructions: string;
  model: string;
  skills: PackageSkill[];
}
export interface AgentWorkspaceInput {
  name: string;
  description: string;
  instructions: string;
  model: string;
  skills: AgentSkillBinding[];
}
/** 由已有产物转成 Agent：生成会话或仓库中的 Skill，二选一。 */
export interface AgentProvisionInput {
  sessionId?: string;
  skillId?: string;
}
/** Persisted with the conversation. Runtime must not resolve current Agent or
 * Skill configuration or replace its model with a message-level override. */
export interface AgentExecutionSnapshot {
  agentId: string;
  name: string;
  instructions: string;
  /** Effective model, including the default resolved at conversation creation. */
  model: string;
  skills: Array<AgentResolvedSkill & {
    packageVersionId: string;
    skillUid: string;
    skillMd: string;
  }>;
}

export interface SkillArenaConfig {
  mode: 'skill_arena';
  compositionMode: 'skill_only';
  agentExecution?: AgentExecutionSnapshot;
  /** New optimization workspaces cannot be used as ordinary chat entrypoints. */
  optimizationOnly?: boolean;
  /** Agent 对话的幂等键，同时用于把线程归属到某个 Agent。 */
  agentRequestId?: string;
  /** run: 单版本运行；test: 固定版本测试；arena: 双版本对比；optimize: 交互式优化 */
  surface?: 'run' | 'test' | 'arena' | 'optimize';
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

export interface ManualEditSkillVersionPayload {
  skillId: string;
  baseVersionId: string;
  expectedPackageVersionId: string;
  idempotencyKey: string;
  skillMd: string;
  note?: string;
}

export interface ManualEditSkillVersionResult {
  packageId: string;
  packageVersionId: string;
  packageVersionNumber: number;
  skillVersionId: string;
  skillVersionNumber: number;
  basedOnVersionId: string;
}

export interface SkillVersionListResult {
  items: SkillVersionDetail[];
  nextCursor: string | null;
  currentVersionId: string | null;
  currentPackageVersionId: string | null;
}

export type ArenaSide = 'shared' | 'baseline' | 'enhanced';
export type ArenaRole = 'user' | 'assistant';

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
  | 'processing'
  | 'target_selection_required'
  | 'draft_ready'
  | 'test_ready'
  | 'completed'
  | 'cancelled'
  | 'failed';

export type ArenaAnswerOptimizationAction =
  | 'create'
  | 'resume'
  | 'restart'
  | 'completed'
  | 'unavailable';

export type ArenaAnswerOptimizationUnavailableReason =
  | 'missing_answer_run'
  | 'replay_context_unavailable'
  | 'replay_model_unavailable';

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

export type ArenaRunStatus =
  | 'running'
  | 'stopping'
  | 'succeeded'
  | 'cancelled'
  | 'failed';
export interface ArenaRunSnapshot {
  /** A large persisted result must be read through recovery/history. */
  historyRequired?: boolean;
  runId: string;
  threadId: number;
  requestId: string;
  revision: number;
  status: ArenaRunStatus;
  content: string;
  reasoningContent: string;
  thinkingRequested: boolean;
  thinkingEnabled: boolean;
  thinkingSupported: boolean | null;
  shared: ArenaMessage | null;
  messages: ArenaMessage[];
  error: string | null;
  createdAt: number;
  updatedAt: number;
}
export interface ArenaRunStartRequest {
  requestId: string;
  content: string;
  model?: string;
  mode: 'agent';
  thinkingEnabled?: boolean;
}
export interface ArenaRunRecovery {
  detail: ArenaThreadDetail;
  run: ArenaRunSnapshot | null;
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
  winningSide: 'baseline' | 'enhanced' | 'tie';
  labels?: {
    baseline: string;
    enhanced: string;
  };
}

export type AutoEvalQuestionSource = 'builtin' | 'document';

export interface AutoEvalQuestion {
  id: string;
  title: string;
  prompt: string;
  source: AutoEvalQuestionSource;
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
  transcript: Array<{
    role: string;
    content: string;
  }>;
}

export type AutoEvalRunStatus = 'running' | 'completed' | 'failed';

export interface AutoEvalReport {
  runId: number;
  packageId: number;
  sceneName: string;
  status: AutoEvalRunStatus;
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
  dimensions: Array<{
    key: string;
    name: string;
    maxScore: number;
    description: string;
  }>;
  latestRun?: AutoEvalReport;
}

export interface OptimizationIssue {
  expert: 'persona' | 'skill' | 'rubric' | 'merge';
  target: 'agent' | 'skill' | 'rubric';
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
  | 'SkillGuidedCreationStart'
  | 'SkillGuidedCreationList'
  | 'SkillGuidedCreationDetail'
  | 'SkillGuidedCreationMessage'
  | 'SkillGuidedCreationConfirm'
  | 'SkillGuidedCreationSummarize'
  | 'SkillGuidedCreationCancel'
  | 'SkillGuidedCreationRename'
  | 'SkillGuidedCreationDelete';

export type GuidedCreationStatus =
  | 'collecting'
  | 'ready_for_confirmation'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type GuidedCreationStage =
  | 'positioning'
  | 'scenario_input'
  | 'expected_result'
  | 'working_method'
  | 'evidence_scope'
  | 'boundaries_completion';

export type GuidedDraftField =
  | 'roles'
  | 'goal'
  | 'usage_scenario'
  | 'input_contract'
  | 'output_contract'
  | 'core_capabilities'
  | 'workflow'
  | 'knowledge_evidence'
  | 'boundaries_permissions'
  | 'exception_recovery'
  | 'completion_evidence';

export type GuidedFieldState =
  | 'explicit'
  | 'inferred'
  | 'defaulted'
  | 'missing'
  | 'conflicted';

export type GuidedSkillDraft = Partial<Record<GuidedDraftField, string>>;

export type GuidedEducationDimension =
  | 'educational_goal'
  | 'audience_context'
  | 'input_evidence'
  | 'teaching_strategy'
  | 'action_adaptation'
  | 'boundaries_responsibility'
  | 'completion_evidence';

export type GuidedCreationStep =
  | 'intent_context'
  | 'teacher_experience'
  | 'strategy_co_creation'
  | 'action_adjustment'
  | 'evidence_review';

export type GuidedEducationEvidenceSource =
  | 'user_explicit'
  | 'user_adopted'
  | 'inferred'
  | 'platform_default'
  | 'conflicted';

/**
 * v3 教育版草稿操作类型。
 * - set：补充新内容（默认）
 * - replace：用户明确纠正或否定先前说法时覆盖 content 并清空旧 evidence
 * - remove：用户撤回该维度内容时删除整个 section
 */
export type GuidedEducationDraftOp = 'set' | 'replace' | 'remove';

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
    | 'positioning'
    | 'scenario'
    | 'input_output'
    | 'capability_flow'
    | 'knowledge_boundary'
    | 'recovery_completion'
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
  role: 'user' | 'assistant';
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
  generatedAgent?: GeneratedAgentResult | null;
}

export interface GuidedCreationSessionDetail extends GuidedCreationSession {
  messages: GuidedCreationMessage[];
}

export interface GuidedCreationStartPayload {
  content: string;
  client_message_id: string;
  model?: string;
  documents?: GuidedCreationDocument[];
  structured_fields?: StructuredGuidedInput;
}

export interface StructuredGuidedInput {
  name: string;
  audience: string;
  scenario: string;
  task: string;
  input: string;
  output: string;
  boundaries: string;
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
  | {
      type: 'phase';
      phase:
        | 'understanding'
        | 'questioning'
        | 'generating'
        | 'validating'
        | 'saving';
    }
  | { type: 'message'; message: GuidedCreationMessage }
  | { type: 'confirmation'; session: GuidedCreationSession }
  | { type: 'preview'; files: Array<{ path: string; content: string }> }
  | { type: 'done'; session: GuidedCreationSession }
  | { type: 'error'; code: string; message: string; retryable: boolean }
  | { type: 'stream_end' };
export * from './src/multimodal-contract.js';
export * from './src/document-content-quality.js';
