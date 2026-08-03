import { describe, expect, it } from 'vitest';
import {
  applyDraftOperations,
  buildConfirmationCard,
  evaluateDraft,
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
});
