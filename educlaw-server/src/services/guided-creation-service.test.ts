import { describe, expect, it } from 'vitest';
import {
  buildGuidedGenerationInstruction,
  buildGuidedAssistantTurn,
  parseExtractionResult,
} from './guided-creation-service.js';

describe('guided creation conversation service', () => {
  it('turns the confirmed draft into a one-Skill generation instruction', () => {
    const instruction = buildGuidedGenerationInstruction({
      roles: '教师助手',
      goal: '生成课堂反馈',
      usage_scenario: '课后复盘',
      input_contract: '课堂记录和教学目标',
      output_contract: '结构化反馈',
      core_capabilities: '分析课堂表现并给出建议',
      workflow: '分析、生成、自检',
      knowledge_evidence: '用户材料',
      boundaries_permissions: '不编造课堂事实',
      exception_recovery: '信息不足时追问',
      completion_evidence: '反馈可直接使用',
    });

    expect(instruction).toContain('只生成 1 个 Skill');
    expect(instruction).toContain('生成课堂反馈');
    expect(instruction).toContain('不编造课堂事实');
    expect(instruction).not.toContain('创建多个 Skill');
  });

  it('accepts only bounded draft operations from model output', () => {
    const result = parseExtractionResult({
      operations: [
        {
          op: 'set',
          path: 'goal',
          value: '帮助教师生成课堂反馈',
          state: 'explicit',
        },
      ],
      acknowledgement: '明白了。',
    });

    expect(result.operations).toHaveLength(1);
    expect(result.acknowledgement).toBe('明白了。');
    expect(() =>
      parseExtractionResult({
        operations: [{ op: 'set', path: 'private_data', value: 'x' }],
        acknowledgement: 'ok',
      }),
    ).toThrowError('INVALID_MODEL_EXTRACTION');
  });

  it('asks one deterministic blocking question after applying extraction', () => {
    const turn = buildGuidedAssistantTurn({
      current_draft: {},
      current_field_states: {},
      extraction: {
        operations: [
          {
            op: 'set',
            path: 'roles',
            value: '面向教师的备课助手',
            state: 'explicit',
          },
        ],
        acknowledgement: '明白，这是给教师使用的备课助手。',
      },
      phrasing: {
        question: '这个 Skill 最需要帮助教师完成什么目标？',
        suggested_options: ['生成教案', '设计课堂活动', '检查教学目标'],
      },
    });

    expect(turn.next_blocking_field).toBe('goal');
    expect(turn.content.match(/[？?]/g)).toHaveLength(1);
    expect(turn.suggested_options).toHaveLength(3);
    expect(turn.status).toBe('collecting');
  });

  it('ignores a model question for the wrong field and uses a safe fallback', () => {
    const turn = buildGuidedAssistantTurn({
      current_draft: { roles: '教师助手' },
      current_field_states: { roles: 'explicit' },
      extraction: { operations: [], acknowledgement: '好的。' },
      phrasing: {
        field: 'output_contract',
        question: '最后想输出什么？还需要别的吗？',
        suggested_options: ['教案'],
      },
    });

    expect(turn.next_blocking_field).toBe('goal');
    expect(turn.content).toContain('最希望这个 Skill 帮你完成什么目标');
    expect(turn.content.match(/[？?]/g)).toHaveLength(1);
  });

  it('returns a confirmation card when all required fields are ready', () => {
    const turn = buildGuidedAssistantTurn({
      current_draft: {
        roles: '教师助手',
        goal: '生成课堂反馈',
        usage_scenario: '课后复盘',
        input_contract: '课堂记录和教学目标',
        output_contract: '结构化反馈',
        core_capabilities: '分析课堂表现并给出建议',
        workflow: '分析记录、对照目标、生成反馈、自检',
      },
      current_field_states: {},
      extraction: { operations: [], acknowledgement: '信息已经完整。' },
      phrasing: null,
    });

    expect(turn.status).toBe('ready_for_confirmation');
    expect(turn.next_blocking_field).toBeNull();
    expect(turn.confirmation?.sections).toHaveLength(6);
    expect(turn.content).not.toMatch(/[？?]/);
  });
});
