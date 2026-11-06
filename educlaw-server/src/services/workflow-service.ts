import { randomUUID } from 'node:crypto';
import {
  validateWorkflowDefinition,
  type AgentPackageDetail,
  type WorkflowDefinition,
  type WorkflowNode,
  type WorkflowNodeTrace,
  type WorkflowRunReport,
} from '@educlaw/shared';
import { query, withTransaction } from './db.js';
import {
  createPackageWithSnapshotTx,
  createPackageVersionWithSnapshotTx,
  getPackage,
  getVersion,
} from './package-service.js';
import { generateText } from './llm-service.js';

const MAX_CAPTURED_TEXT = 32 * 1024;

export class WorkflowServiceError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 422,
  ) {
    super(message);
    this.name = 'WorkflowServiceError';
  }
}

function asDefinition(value: unknown): WorkflowDefinition {
  const errors = validateWorkflowDefinition(value);
  if (errors.length) {
    const error = new WorkflowServiceError('工作流结构不合法，请修复标记的节点或连线。', 'WORKFLOW_INVALID');
    Object.assign(error, { validationErrors: errors });
    throw error;
  }
  return value as WorkflowDefinition;
}

function clip(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return value.length > MAX_CAPTURED_TEXT
    ? { text: value.slice(0, MAX_CAPTURED_TEXT), truncated: true }
    : { text: value };
}

function renderTemplate(template: unknown, input: string, results: Map<string, unknown>): string {
  if (typeof template !== 'string') {
    throw new WorkflowServiceError('节点模板必须是文本。', 'WORKFLOW_INVALID');
  }
  return template.replace(/{{\s*\$(input|node\.([A-Za-z0-9_-]+)\.output(?:\.text)?)\s*}}/g, (_all, value: string, nodeId?: string) => {
    if (value === 'input') return input;
    const output = nodeId ? results.get(nodeId) : undefined;
    const text = output && typeof output === 'object' && 'text' in output
      ? (output as { text?: unknown }).text
      : undefined;
    if (typeof text !== 'string') {
      throw new WorkflowServiceError('模板引用的上游节点输出不可用。', 'WORKFLOW_VARIABLE_UNAVAILABLE');
    }
    return text;
  });
}

function conditionPassed(node: WorkflowNode, input: string, results: Map<string, unknown>): boolean {
  const params = node.params;
  const left = renderTemplate(params.left, input, results);
  const right = params.right === undefined ? '' : renderTemplate(String(params.right), input, results);
  switch (params.operator) {
    case 'equals': return left === right;
    case 'not_equals': return left !== right;
    case 'contains': return left.includes(right);
    case 'not_contains': return !left.includes(right);
    case 'is_empty': return !left.trim();
    case 'not_empty': return Boolean(left.trim());
    default: throw new WorkflowServiceError('条件节点使用了不支持的比较方式。', 'WORKFLOW_INVALID');
  }
}

function traceFor(nodeId: string, status: WorkflowNodeTrace['status']): WorkflowNodeTrace {
  return { nodeId, status };
}

function dbReport(value: unknown): WorkflowRunReport | null {
  if (!value || typeof value !== 'object') return null;
  const report = value as Partial<WorkflowRunReport>;
  return typeof report.runId === 'string' && typeof report.status === 'string'
    ? report as WorkflowRunReport
    : null;
}

export function validateWorkflowForSnapshot(
  definition: unknown,
  snapshot: AgentPackageDetail['snapshot'],
  options: { requireSkillBindings?: boolean } = {},
) {
  const parsed = asDefinition(definition);
  const errors = [];
  const skills = new Set(snapshot.skills.map(skill => skill.id));
  for (const node of parsed.nodes) {
    if (node.type !== 'skill') continue;
    const skillId = typeof node.params.skillId === 'string'
      ? node.params.skillId.trim()
      : '';
    // A workflow can be saved as a draft before a Skill is chosen.  A non-empty
    // reference must always be valid; an empty reference only blocks execution.
    if (!skillId && !options.requireSkillBindings) continue;
    if (!skillId || !skills.has(skillId)) {
      errors.push({
        code: 'WORKFLOW_SKILL_UNAVAILABLE',
        nodeId: node.id,
        message: !skillId
          ? '请先为这个 Skill 节点选择一个 Skill，再试跑工作流。'
          : 'Skill 节点引用的 Skill 不在当前 Agent 版本中。',
      });
    }
  }
  if (errors.length) {
    const error = new WorkflowServiceError('工作流引用了不可用的 Skill。', 'WORKFLOW_SKILL_UNAVAILABLE');
    Object.assign(error, { validationErrors: errors });
    throw error;
  }
  return parsed;
}

export async function saveWorkflow(
  userId: string,
  packageId: string,
  input: { expectedPackageVersionId: string; definition: unknown; note?: string },
) {
  const pkg = await getPackage(userId, packageId);
  const definition = validateWorkflowForSnapshot(input.definition, pkg.snapshot);
  await withTransaction(client => createPackageVersionWithSnapshotTx(client, {
    userId,
    packageId,
    expectedPackageVersionId: input.expectedPackageVersionId,
    source: 'manual',
    note: input.note || '保存工作流',
    snapshot: { ...pkg.snapshot, workflow: definition },
  }));
  return getPackage(userId, packageId);
}

/**
 * A workflow is versioned through the same durable container as an Agent, but
 * its first save must not require a pre-existing Skill or Agent selection.
 */
export async function createWorkflow(
  userId: string,
  definition: unknown,
) {
  const snapshot = {
    name: '未命名工作流',
    description: '通过工作流编辑器创建的草稿。',
    versionLabel: 'v1',
    agentMd: '按照工作流节点完成用户请求。',
    rubricMd: '',
    skills: [],
  } satisfies AgentPackageDetail['snapshot'];
  const parsed = validateWorkflowForSnapshot(definition, snapshot);
  const created = await withTransaction(client => createPackageWithSnapshotTx(
    client,
    userId,
    { ...snapshot, workflow: parsed },
    'manual',
  ));
  return getPackage(userId, created.packageId);
}

export async function runWorkflow(
  userId: string,
  packageId: string,
  input: { packageVersionId: string; requestId: string; content: string; model?: string },
): Promise<WorkflowRunReport> {
  if (!input.requestId.trim() || !input.content.trim()) {
    throw new WorkflowServiceError('requestId 和输入内容不能为空。', 'WORKFLOW_INVALID');
  }
  const sessionId = `workflow:${input.requestId}`;
  const existing = await query<{ report_json: unknown }>(
    `select r.report_json from arena_runs r
       join agent_packages p on p.id = r.package_id
      where r.package_id = $1 and p.user_id = $2 and r.target_kind = 'workflow' and r.session_id = $3
      order by r.id desc limit 1`,
    [packageId, userId, sessionId],
  );
  const previous = dbReport(existing.rows[0]?.report_json);
  if (previous) return previous;

  const version = await getVersion(userId, packageId, input.packageVersionId);
  if (!version.snapshot.workflow) {
    throw new WorkflowServiceError('该 Agent 版本尚未配置工作流。', 'WORKFLOW_NOT_CONFIGURED');
  }
  const definition = validateWorkflowForSnapshot(version.snapshot.workflow, version.snapshot, {
    requireSkillBindings: true,
  });
  const now = new Date().toISOString();
  const report: WorkflowRunReport = {
    runId: randomUUID(),
    packageId,
    packageVersionId: String(version.id),
    requestId: input.requestId,
    status: 'running',
    input: input.content,
    traces: definition.nodes.map(node => traceFor(node.id, 'queued')),
    startedAt: now,
  };
  const inserted = await query<{ id: number }>(
    `insert into arena_runs (session_id, package_id, target_kind, target_ref, model, state, report_json, created_at, updated_at)
     values ($1, $2, 'workflow', $3, $4, 1, $5, $6, $6) returning id`,
    [sessionId, packageId, String(version.id), input.model || null, JSON.stringify(report), now],
  );
  const runRowId = inserted.rows[0]!.id;
  const nodeResults = new Map<string, unknown>();
  const trace = (nodeId: string) => report.traces.find(item => item.nodeId === nodeId)!;
  try {
    let current = definition.nodes.find(node => node.type === 'start')!;
    while (current) {
      const currentTrace = trace(current.id);
      currentTrace.status = 'running';
      currentTrace.startedAt = new Date().toISOString();
      let output: unknown;
      if (current.type === 'start') output = { text: input.content };
      else if (current.type === 'condition') output = { passed: conditionPassed(current, input.content, nodeResults) };
      else if (current.type === 'loop') {
        const iterations = Number(current.params.iterations);
        const instruction = renderTemplate(current.params.promptTemplate, input.content, nodeResults);
        let previous = '';
        for (let index = 0; index < iterations; index += 1) {
          previous = await generateText({
            model: typeof current.params.model === 'string' ? current.params.model : input.model,
            systemPrompt: version.snapshot.agentMd,
            userPrompt: [
              `循环任务：${instruction}`,
              `工作流输入：${input.content}`,
              previous ? `上一轮结果：${previous}` : '这是第一轮处理，请直接开始。',
              `当前为第 ${index + 1} / ${iterations} 轮，请输出可供下一轮继续使用的结果。`,
            ].join('\n\n'),
            maxTokens: 2_000,
            hidePromptContentInLogs: true,
          });
        }
        output = { text: previous, iterations };
      }
      else if (current.type === 'end') output = { text: renderTemplate(current.params.outputTemplate, input.content, nodeResults) };
      else {
        const template = current.type === 'skill'
          ? current.params.inputTemplate
          : current.params.promptTemplate;
        const prompt = renderTemplate(template, input.content, nodeResults);
        const skill = current.type === 'skill'
          ? version.snapshot.skills.find(item => item.id === current.params.skillId)
          : undefined;
        if (current.type === 'skill' && !skill) {
          throw new WorkflowServiceError('试跑时找不到固定版本的 Skill。', 'WORKFLOW_SKILL_UNAVAILABLE');
        }
        output = {
          text: await generateText({
            model: typeof current.params.model === 'string' ? current.params.model : input.model,
            systemPrompt: current.type === 'skill'
              ? `${version.snapshot.agentMd}\n\n[Skill: ${skill!.name}]\n${skill!.skillMd}`
              : version.snapshot.agentMd,
            userPrompt: prompt,
            maxTokens: 2_000,
            hidePromptContentInLogs: true,
          }),
        };
      }
      nodeResults.set(current.id, output);
      currentTrace.input = current.type === 'start' ? undefined : clip(current.params);
      currentTrace.output = clip(output);
      currentTrace.status = 'succeeded';
      currentTrace.endedAt = new Date().toISOString();
      currentTrace.durationMs = Date.parse(currentTrace.endedAt) - Date.parse(currentTrace.startedAt!);
      if (current.type === 'end') {
        report.output = (output as { text: string }).text;
        break;
      }
      const next = definition.edges.find(edge => edge.from === current.id && (
        current.type !== 'condition' || edge.condition === String((output as { passed: boolean }).passed)
      ));
      if (!next) throw new WorkflowServiceError('工作流找不到下一节点。', 'WORKFLOW_INVALID');
      current = definition.nodes.find(node => node.id === next.to)!;
    }
    report.status = 'succeeded';
    for (const item of report.traces) if (item.status === 'queued') item.status = 'skipped';
  } catch (caught) {
    const error = caught instanceof WorkflowServiceError
      ? caught
      : new WorkflowServiceError('工作流试跑失败，请检查节点配置或稍后重试。', 'WORKFLOW_RUN_FAILED', 502);
    const active = report.traces.find(item => item.status === 'running');
    if (active) {
      active.status = 'failed';
      active.endedAt = new Date().toISOString();
      active.error = { code: error.code, message: error.message, retryable: error.code === 'WORKFLOW_RUN_FAILED' };
    }
    for (const item of report.traces) if (item.status === 'queued') item.status = 'skipped';
    report.status = 'failed';
    report.error = { code: error.code, message: error.message };
  } finally {
    report.endedAt = new Date().toISOString();
    await query('update arena_runs set state = $1, report_json = $2, updated_at = $3 where id = $4', [
      report.status === 'succeeded' ? 2 : 3,
      JSON.stringify(report),
      report.endedAt,
      runRowId,
    ]);
  }
  return report;
}

export async function getWorkflowRun(userId: string, packageId: string, runId: string) {
  const result = await query<{ report_json: unknown }>(
    `select r.report_json from arena_runs r join agent_packages p on p.id = r.package_id
      where r.package_id = $1 and p.user_id = $2 and r.target_kind = 'workflow'
        and r.report_json->>'runId' = $3 order by r.id desc limit 1`,
    [packageId, userId, runId],
  );
  const report = dbReport(result.rows[0]?.report_json);
  if (!report) throw new WorkflowServiceError('找不到工作流运行记录。', 'WORKFLOW_RUN_NOT_FOUND', 404);
  return report;
}
