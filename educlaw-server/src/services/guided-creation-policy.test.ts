import { describe, expect, it } from 'vitest';
import {
  applyDraftOperations,
  buildConfirmationCard,
  evaluateDraft,
  evaluateGuidedFlow,
  nextGuidedStage,
  sanitizeDraftOperations,
  validateExplicitEvidence,
} from './guided-creation-policy.js';

describe('guided creation draft policy', () => {
  it('applies set, replace and remove operations without mutating the source', () => {
    const source = { goal: '旧目标', roles: '教师助手' };
    const result = applyDraftOperations(source, [
      { op: 'replace', path: 'goal', value: '生成课堂反馈', state: 'explicit' },
      { op: 'set', path: 'usage_scenario', value: '课后复盘' },
      { op: 'remove', path: 'roles' },
    ]);

    expect(result).toEqual({
      goal: '生成课堂反馈',
      usage_scenario: '课后复盘',
    });
    expect(source).toEqual({ goal: '旧目标', roles: '教师助手' });
  });

  it('rejects unknown paths and invalid values', () => {
    expect(() =>
      applyDraftOperations({}, [{ op: 'set', path: 'unknown', value: 'x' }]),
    ).toThrowError('INVALID_DRAFT_PATH');
    expect(() =>
      applyDraftOperations({}, [{ op: 'set', path: 'goal', value: 1 }]),
    ).toThrowError('INVALID_DRAFT_VALUE');
  });

  it('selects exactly one required blocking field in a stable order', () => {
    const evaluation = evaluateDraft({
      roles: '面向教师的教学设计助手',
      goal: '生成课堂活动方案',
      usage_scenario: '教师备课',
    });

    expect(evaluation.next_blocking_field).toBe('input_contract');
    expect(evaluation.ready_for_confirmation).toBe(false);
    expect(
      Object.values(evaluation.field_states).filter(
        (state) => state === 'missing' || state === 'conflicted',
      ).length,
    ).toBeGreaterThan(0);
  });

  it('treats a conflict as blocking before later missing fields', () => {
    const evaluation = evaluateDraft(
      {
        roles: '教师助手',
        goal: '生成课堂反馈',
        usage_scenario: '课后复盘',
      },
      { goal: 'conflicted' },
    );

    expect(evaluation.next_blocking_field).toBe('goal');
    expect(evaluation.field_states.goal).toBe('conflicted');
  });

  it('fills safe defaults only after all required fields are complete', () => {
    const evaluation = evaluateDraft({
      roles: '面向教师的教学设计助手',
      goal: '生成课堂活动方案',
      usage_scenario: '教师备课',
      input_contract: '年级、学科、课时目标和教材内容',
      output_contract: '结构化课堂活动方案',
      core_capabilities: '提炼目标、设计活动、检查可执行性',
      workflow: '先分析目标，再设计活动，最后自检',
    });

    expect(evaluation.ready_for_confirmation).toBe(true);
    expect(evaluation.next_blocking_field).toBeNull();
    expect(evaluation.field_states.knowledge_evidence).toBe('defaulted');
    expect(evaluation.normalized_draft.completion_evidence).toBeTruthy();
  });

  it('builds a compact six-topic confirmation card', () => {
    const evaluation = evaluateDraft({
      roles: '面向教师的教学设计助手',
      goal: '生成课堂活动方案',
      usage_scenario: '教师备课',
      input_contract: '年级、学科、课时目标和教材内容',
      output_contract: '结构化课堂活动方案',
      core_capabilities: '提炼目标、设计活动、检查可执行性',
      workflow: '先分析目标，再设计活动，最后自检',
    });
    const card = buildConfirmationCard(evaluation.normalized_draft);

    expect(card.title).toBe('请确认这个 Skill');
    expect(card.sections).toHaveLength(6);
    expect(card.sections.map((section) => section.key)).toEqual([
      'positioning',
      'scenario',
      'input_output',
      'capability_flow',
      'knowledge_boundary',
      'recovery_completion',
    ]);
  });

  it('requires all six user-confirmed stages even when the model fills every field', () => {
    const completeDraft = {
      roles: '实验设计助手',
      goal: '指导初中浮力实验',
      usage_scenario: '初中物理分组实验',
      input_contract: '年级、器材和实验目标',
      output_contract: '实验方案和记录表',
      core_capabilities: '拆解实验并识别风险',
      workflow: '分析条件、设计步骤、检查安全',
      knowledge_evidence: '教材和课程标准',
      boundaries_permissions: '不建议危险操作',
      exception_recovery: '器材不足时给出替代方案',
      completion_evidence: '步骤可执行且结论可核查',
    };
    const allInferred = Object.fromEntries(
      Object.keys(completeDraft).map((field) => [field, 'inferred']),
    );

    const evaluation = evaluateGuidedFlow(
      completeDraft,
      allInferred,
      [],
    );

    expect(evaluation.ready_for_confirmation).toBe(false);
    expect(evaluation.next_stage).toBe('positioning');
  });

  it('advances through the six stages in a stable order', () => {
    expect(nextGuidedStage([])).toBe('positioning');
    expect(nextGuidedStage(['positioning'])).toBe('scenario_input');
    expect(
      nextGuidedStage([
        'positioning',
        'scenario_input',
        'expected_result',
        'working_method',
        'evidence_scope',
        'boundaries_completion',
      ]),
    ).toBeNull();
  });

  it('accepts explicit evidence only when it comes from the current user message', () => {
    expect(validateExplicitEvidence('帮教师设计实验', '教师')).toBe(true);
    expect(
      validateExplicitEvidence('帮教师设计实验', '学生自主探究'),
    ).toBe(false);
  });

  it('downgrades unsupported explicit content and protects explicit user choices', () => {
    const operations = sanitizeDraftOperations({ roles: '教师助手' }, {
      roles: 'explicit',
    }, [
      {
        op: 'replace',
        path: 'roles',
        value: '学生助手',
        state: 'inferred',
      },
      {
        op: 'set',
        path: 'usage_scenario',
        value: '学生自主探究',
        state: 'explicit',
        evidence: '学生自主探究',
      },
    ], '我想让学生自主探究');

    expect(operations).toEqual([
      {
        op: 'set',
        path: 'usage_scenario',
        value: '学生自主探究',
        state: 'explicit',
        evidence: '学生自主探究',
      },
    ]);

    expect(sanitizeDraftOperations({}, {}, [{
      op: 'set',
      path: 'workflow',
      value: '先讲解再实验',
      state: 'explicit',
      evidence: '用户没有说过的原话',
    }], '请你设计流程')[0]?.state).toBe('inferred');
  });

  it('adds compatible user details without erasing an earlier explicit goal', () => {
    const operations = sanitizeDraftOperations(
      { goal: '初中物理浮力实验指导' },
      { goal: 'explicit' },
      [
        {
          op: 'set',
          path: 'goal',
          value: '把实验教学经验整理成学生能执行的指导方案',
          state: 'explicit',
          evidence: '把实验教学经验整理成学生能执行的指导方案',
        },
      ],
      '希望它帮我把实验教学经验整理成学生能执行的指导方案',
    );

    expect(operations[0]?.value).toBe(
      '初中物理浮力实验指导；把实验教学经验整理成学生能执行的指导方案',
    );
  });
});
