import { describe, expect, it } from 'vitest';
import { validateWorkflowDefinition, type AgentPackageDetail, type WorkflowDefinition } from '@educlaw/shared';
import { WorkflowServiceError, validateWorkflowForSnapshot } from './workflow-service.js';

function definition(): WorkflowDefinition {
  return {
    schemaVersion: 1,
    nodes: [
      { id: 'start', type: 'start', name: '开始', position: { x: 0, y: 0 }, params: {} },
      { id: 'check', type: 'condition', name: '检查', position: { x: 1, y: 0 }, params: { left: '{{ $input }}', operator: 'not_empty' } },
      { id: 'end', type: 'end', name: '结束', position: { x: 2, y: 0 }, params: { outputTemplate: '{{ $input }}' } },
    ],
    edges: [
      { id: 'a', from: 'start', to: 'check' },
      { id: 'b', from: 'check', to: 'end', condition: 'true' },
      { id: 'c', from: 'check', to: 'end', condition: 'false' },
    ],
  };
}

describe('workflow definition validation', () => {
  it('accepts a conditional workflow whose paths converge on its end node', () => {
    expect(validateWorkflowDefinition(definition())).toEqual([]);
  });

  it('rejects cycles', () => {
    const workflow = definition();
    workflow.edges = [
      { id: 'a', from: 'start', to: 'check' },
      { id: 'b', from: 'check', to: 'start', condition: 'true' },
      { id: 'c', from: 'check', to: 'end', condition: 'false' },
    ];
    expect(validateWorkflowDefinition(workflow).some(error => error.message.includes('循环'))).toBe(true);
  });

  it('allows an unbound Skill node in a saved draft but requires it to run', () => {
    const workflow: WorkflowDefinition = {
      schemaVersion: 1,
      nodes: [
        { id: 'start', type: 'start', name: '开始', position: { x: 0, y: 0 }, params: {} },
        { id: 'skill', type: 'skill', name: '调用 Skill', position: { x: 1, y: 0 }, params: { skillId: '', inputTemplate: '{{ $input }}' } },
        { id: 'end', type: 'end', name: '结束', position: { x: 2, y: 0 }, params: { outputTemplate: '{{ $node.skill.output.text }}' } },
      ],
      edges: [{ id: 'a', from: 'start', to: 'skill' }, { id: 'b', from: 'skill', to: 'end' }],
    };
    const snapshot: AgentPackageDetail['snapshot'] = {
      name: '草稿 Agent', description: '', versionLabel: 'v1', agentMd: '', rubricMd: '', skills: [],
    };

    expect(validateWorkflowForSnapshot(workflow, snapshot)).toBe(workflow);
    expect(() => validateWorkflowForSnapshot(workflow, snapshot, { requireSkillBindings: true }))
      .toThrow(WorkflowServiceError);
  });
});
