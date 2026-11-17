import { describe, expect, it } from 'vitest';
import type { WorkflowDefinition } from '@educlaw/shared';
import {
  buildWorkflowAgentInstructions,
  collectWorkflowSkillIds,
} from './workflow-publish';

const workflow: WorkflowDefinition = {
  schemaVersion: 1,
  nodes: [
    { id: 'start', type: 'start', name: '开始', position: { x: 0, y: 0 }, params: {} },
    { id: 'llm', type: 'llm', name: '梳理教学目标', position: { x: 180, y: 0 }, params: {} },
    { id: 'skill-a', type: 'skill', name: '生成教案', position: { x: 360, y: 0 }, params: { skillId: '11' } },
    { id: 'skill-b', type: 'skill', name: '设计练习', position: { x: 540, y: 0 }, params: { skillId: '12' } },
    { id: 'skill-c', type: 'skill', name: '再次生成教案', position: { x: 720, y: 0 }, params: { skillId: '11' } },
    { id: 'unbound', type: 'skill', name: '待绑定', position: { x: 900, y: 0 }, params: { skillId: '' } },
    { id: 'end', type: 'end', name: '结束', position: { x: 1080, y: 0 }, params: {} },
  ],
  edges: [],
};

describe('workflow publish', () => {
  it('collects bound Skill ids once, in workflow order', () => {
    expect(collectWorkflowSkillIds(workflow)).toEqual(['11', '12']);
  });

  it('turns canvas steps into direct Agent instructions', () => {
    const instructions = buildWorkflowAgentInstructions(workflow, '备课流程');
    expect(instructions).toContain('你是由工作流「备课流程」生成的 Agent。');
    expect(instructions).toContain('1. 梳理教学目标');
    expect(instructions).toContain('2. 生成教案');
    expect(instructions).not.toContain('开始');
    expect(instructions).not.toContain('结束');
  });

  it('keeps the package agent.md and appends the canvas steps', () => {
    const instructions = buildWorkflowAgentInstructions(
      workflow,
      '备课流程',
      '已有 Agent 指令',
    );
    expect(instructions).toContain('已有 Agent 指令');
    expect(instructions).toContain('1. 梳理教学目标');
    expect(instructions).toContain('在需要时调用已装配的 Skill');
  });
});
