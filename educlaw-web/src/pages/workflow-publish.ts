import type { WorkflowDefinition } from '@educlaw/shared';

/** 工作流里已绑定的 Skill，按出现顺序去重。 */
export function collectWorkflowSkillIds(workflow: WorkflowDefinition): string[] {
  const seen = new Set<string>();
  workflow.nodes.forEach((node) => {
    if (node.type !== 'skill') return;
    const skillId = String(node.params.skillId || '').trim();
    if (skillId) seen.add(skillId);
  });
  return [...seen];
}

/** 把画布步骤整理成一段可以直接交给 Agent 的指令。 */
export function buildWorkflowAgentInstructions(
  workflow: WorkflowDefinition,
  workflowName: string,
  agentMd?: string,
) {
  const source = agentMd?.trim();
  const steps = workflow.nodes
    .filter((node) => node.type !== 'start' && node.type !== 'end')
    .map((node) => node.name);
  if (!steps.length) return source || `你是由工作流「${workflowName}」生成的 Agent。`;
  const header = source
    ? `${source}\n\n以下是「${workflowName}」的执行顺序：`
    : `你是由工作流「${workflowName}」生成的 Agent。\n\n面对用户任务时，请按下面的顺序组织处理：`;
  return [
    header,
    ...steps.map((step, index) => `${index + 1}. ${step}`),
    '',
    '在需要时调用已装配的 Skill，最后给出清晰、可直接执行的结果。',
  ].join('\n');
}
