import { describe, expect, it } from 'vitest';
import type {
  GuidedCreationSessionDetail,
  GuidedEducationDraft,
} from '@educlaw/shared';
import { deriveGuidedCreationProgress } from './guided-creation-progress';

function session(
  educationDraft: GuidedEducationDraft,
  overrides: Partial<GuidedCreationSessionDetail> = {},
): GuidedCreationSessionDetail {
  return {
    flow_version: 3,
    education_draft: educationDraft,
    completed_steps: [],
    current_step: 'intent_context',
    ...overrides,
  } as GuidedCreationSessionDetail;
}

function section(
  content: string,
  source:
    | 'user_explicit'
    | 'user_adopted'
    | 'inferred'
    | 'platform_default'
    | 'conflicted',
) {
  return { content, evidence: [{ source }] };
}

const inferredDraft: GuidedEducationDraft = {
  educational_goal: section('理解课文', 'inferred'),
  audience_context: section('七年级课堂', 'inferred'),
  input_evidence: section('教材和学情', 'inferred'),
  teaching_strategy: section('问题引导', 'inferred'),
  action_adaptation: section('根据回答调整', 'inferred'),
  boundaries_responsibility: section('由教师确认', 'inferred'),
  completion_evidence: section('学生能够复述', 'inferred'),
};

describe('guided creation progress', () => {
  it('does not count inferred content as completed conversation progress', () => {
    const progress = deriveGuidedCreationProgress(session(inferredDraft));

    expect(progress.completedStepCount).toBe(0);
    expect(progress.totalStepCount).toBe(5);
    expect(progress.currentStepLabel).toBe('目标与对象');
    expect(
      progress.steps.flatMap((step) => step.dimensions).map(({ status }) => status),
    ).toEqual(new Array(7).fill('pending'));
  });

  it('keeps explicitly extracted content pending until its step is confirmed', () => {
    const explicitDraft = Object.fromEntries(
      Object.entries(inferredDraft).map(([key, value]) => [
        key,
        section(value!.content, 'user_explicit'),
      ]),
    ) as GuidedEducationDraft;
    const progress = deriveGuidedCreationProgress(
      session(explicitDraft, { completed_steps: [], current_step: 'intent_context' }),
    );

    expect(progress.completedStepCount).toBe(0);
    expect(
      progress.steps.flatMap((step) => step.dimensions).map(({ status }) => status),
    ).toEqual(new Array(7).fill('pending'));
  });

  it('counts a step only after the user confirmed every dimension in it', () => {
    const progress = deriveGuidedCreationProgress(
      session(
        {
          ...inferredDraft,
          educational_goal: section('理解课文', 'user_explicit'),
          audience_context: section('七年级课堂', 'user_adopted'),
        },
        {
          completed_steps: ['intent_context'],
          current_step: 'teacher_experience',
        },
      ),
    );

    expect(progress.completedStepCount).toBe(1);
    expect(progress.currentStepLabel).toBe('经验与依据');
    expect(progress.steps[0]?.status).toBe('completed');
    expect(progress.steps[1]?.status).toBe('active');
  });

  it('keeps platform defaults pending and gives conflicts priority', () => {
    const progress = deriveGuidedCreationProgress(
      session({
        educational_goal: section('理解课文', 'platform_default'),
        audience_context: {
          content: '七年级课堂',
          evidence: [
            { source: 'user_explicit' },
            { source: 'conflicted' },
          ],
        },
      }),
    );

    expect(progress.steps[0]?.dimensions[0]?.status).toBe('pending');
    expect(progress.steps[0]?.dimensions[1]?.status).toBe('conflicted');
    expect(progress.steps[0]?.status).toBe('conflicted');
    expect(progress.completedStepCount).toBe(0);
  });

  it('does not complete a two-dimension step when only one item is confirmed', () => {
    const progress = deriveGuidedCreationProgress(
      session(
        {
          action_adaptation: section('根据回答调整', 'user_explicit'),
          boundaries_responsibility: section('由教师确认', 'inferred'),
        },
        {
          completed_steps: ['action_adjustment'],
          current_step: 'action_adjustment',
        },
      ),
    );

    expect(progress.steps[3]?.confirmedDimensionCount).toBe(1);
    expect(progress.steps[3]?.status).toBe('active');
    expect(progress.completedStepCount).toBe(0);
  });

  it('shows five completed steps after all user decisions are confirmed', () => {
    const confirmedDraft = Object.fromEntries(
      Object.entries(inferredDraft).map(([key, value]) => [
        key,
        section(value!.content, 'user_explicit'),
      ]),
    ) as GuidedEducationDraft;
    const progress = deriveGuidedCreationProgress(
      session(confirmedDraft, {
        completed_steps: [
          'intent_context',
          'teacher_experience',
          'strategy_co_creation',
          'action_adjustment',
          'evidence_review',
        ],
        current_step: null,
      }),
    );

    expect(progress.completedStepCount).toBe(5);
    expect(progress.currentStepLabel).toBeNull();
    expect(progress.steps.every((step) => step.status === 'completed')).toBe(true);
  });

  it('safely handles older v3 records without optional progress fields', () => {
    const progress = deriveGuidedCreationProgress(
      session({}, { completed_steps: undefined, current_step: undefined }),
    );

    expect(progress.completedStepCount).toBe(0);
    expect(progress.currentStep).toBeNull();
    expect(progress.steps.flatMap((step) => step.dimensions)).toHaveLength(7);
  });
});
