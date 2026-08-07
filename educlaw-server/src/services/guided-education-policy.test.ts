import { describe, expect, it } from 'vitest';
import type {
  GuidedCreationStep,
  GuidedEducationDraft,
} from '@educlaw/shared';
import {
  applyEducationOperations,
  buildEducationConfirmationCard,
  educationDraftToGenerationBrief,
  evaluateEducationFlow,
  nextGuidedCreationStep,
  sanitizeEducationOperations,
} from './guided-education-policy.js';

const ALL_STEPS: GuidedCreationStep[] = [
  'intent_context',
  'teacher_experience',
  'strategy_co_creation',
  'action_adjustment',
  'evidence_review',
];

function completeDraft(): GuidedEducationDraft {
  return {
    educational_goal: {
      content: '让学生能根据受力情况解释物体的浮沉',
      evidence: [{ source: 'user_explicit', quote: '解释物体的浮沉' }],
    },
    audience_context: {
      content: '面向初二学生，在分组实验课中使用',
      evidence: [{ source: 'user_explicit', quote: '初二学生' }],
    },
    input_evidence: {
      content: '使用教材实验、弹簧测力计、量筒和学生观察记录',
      evidence: [{ source: 'user_adopted', quote: '可以使用这些材料' }],
    },
    teaching_strategy: {
      content: '先预测，再测量和比较，最后用证据修正解释',
      evidence: [{ source: 'user_explicit', quote: '先预测再实验' }],
    },
    action_adaptation: {
      content: '观察学生能否控制变量；混淆质量与浮力时改用对照实验',
      evidence: [{ source: 'user_explicit', quote: '混淆时做对照' }],
    },
    boundaries_responsibility: {
      content: '涉及器材安全和结论判断时由教师确认',
      evidence: [{ source: 'user_adopted', quote: '由教师确认' }],
    },
    completion_evidence: {
      content: '学生能用实验数据解释至少两种浮沉现象并说明证据',
      evidence: [{ source: 'user_explicit', quote: '能用数据解释' }],
    },
  };
}

describe('guided education policy', () => {
  it('allows one user answer to update several educational dimensions', () => {
    const message = '给初二学生做浮力分组实验，希望他们能用数据解释浮沉';
    const operations = sanitizeEducationOperations({}, [
      {
        dimension: 'audience_context',
        content: '面向初二学生开展浮力分组实验',
        source: 'user_explicit',
        quote: '初二学生',
      },
      {
        dimension: 'educational_goal',
        content: '学生能用数据解释浮沉',
        source: 'user_explicit',
        quote: '用数据解释浮沉',
      },
    ], message);

    const draft = applyEducationOperations({}, operations);

    expect(draft.audience_context?.content).toContain('初二学生');
    expect(draft.educational_goal?.content).toContain('用数据解释浮沉');
  });

  it('downgrades invented user evidence and cannot overwrite an explicit choice', () => {
    const current: GuidedEducationDraft = {
      teaching_strategy: {
        content: '先让学生预测，再开展实验',
        evidence: [{ source: 'user_explicit', quote: '先预测' }],
      },
    };
    const operations = sanitizeEducationOperations(current, [
      {
        dimension: 'educational_goal',
        content: '培养科学推理',
        source: 'user_explicit',
        quote: '培养科学推理',
      },
      {
        dimension: 'teaching_strategy',
        content: '教师直接讲解结论',
        source: 'inferred',
      },
    ], '我想做一个浮力实验');

    expect(operations).toEqual([
      expect.objectContaining({
        dimension: 'educational_goal',
        source: 'inferred',
      }),
    ]);
  });

  it('does not finish after choosing only a role or scenario', () => {
    const evaluation = evaluateEducationFlow({
      audience_context: {
        content: '由耐心的实验老师面向初二学生指导',
        evidence: [{ source: 'user_explicit', quote: '实验老师' }],
      },
    }, ['intent_context']);

    expect(evaluation.ready_for_confirmation).toBe(false);
    expect(evaluation.current_step).toBe('intent_context');
    expect(evaluation.missing_dimensions).toContain('educational_goal');
  });

  it('advances through exactly five co-creation steps', () => {
    expect(nextGuidedCreationStep([])).toBe('intent_context');
    expect(nextGuidedCreationStep(['intent_context'])).toBe('teacher_experience');
    expect(nextGuidedCreationStep(ALL_STEPS)).toBeNull();
  });

  it('requires five completed steps, seven conclusions and user-owned critical decisions', () => {
    const valid = evaluateEducationFlow(completeDraft(), ALL_STEPS);
    expect(valid.ready_for_confirmation).toBe(true);
    expect(valid.current_step).toBeNull();

    const inferredGoal = completeDraft();
    inferredGoal.educational_goal = {
      content: '培养科学推理',
      evidence: [{ source: 'inferred' }],
    };
    expect(evaluateEducationFlow(inferredGoal, ALL_STEPS).ready_for_confirmation).toBe(false);
  });

  it('requires user confirmation for every education dimension, including materials and responsibility', () => {
    const missingUserDecision = completeDraft();
    missingUserDecision.input_evidence = {
      content: '系统建议使用教材和实验记录',
      evidence: [{ source: 'platform_default' }],
    };
    missingUserDecision.boundaries_responsibility = {
      content: '涉及安全时交给教师确认',
      evidence: [{ source: 'platform_default' }],
    };

    const evaluation = evaluateEducationFlow(missingUserDecision, ALL_STEPS);

    expect(evaluation.ready_for_confirmation).toBe(false);
    expect(evaluation.missing_user_decisions).toEqual(
      expect.arrayContaining(['input_evidence', 'boundaries_responsibility']),
    );
  });

  it('builds seven user-facing summaries and a rule-oriented generation brief', () => {
    const draft = completeDraft();
    const card = buildEducationConfirmationCard(draft);
    const brief = educationDraftToGenerationBrief(draft);

    expect(card.sections).toHaveLength(7);
    expect(card.sections.map((section) => section.key)).toEqual([
      'educational_goal',
      'audience_context',
      'input_evidence',
      'teaching_strategy',
      'action_adaptation',
      'boundaries_responsibility',
      'completion_evidence',
    ]);
    expect(brief).toContain('教育目标');
    expect(brief).toContain('观察与调整规则');
    expect(brief).not.toContain('experience_id');
    expect(brief).not.toContain('user_explicit');
  });
});
