import { describe, expect, it } from 'vitest';
import {
  GUIDED_SKILL_CONVERSION_RULES,
  GUIDED_TEACHING_EXPERIENCES,
  matchTeachingExperiences,
} from './guided-experience-library.js';

describe('guided experience library', () => {
  it('keeps a small first batch for the two approved scenarios', () => {
    const lesson = GUIDED_TEACHING_EXPERIENCES.filter((item) =>
      item.scenario_tags.includes('完整课时设计'),
    );
    const differentiation = GUIDED_TEACHING_EXPERIENCES.filter((item) =>
      item.scenario_tags.includes('分层教学设计'),
    );

    expect(lesson.length).toBeGreaterThanOrEqual(5);
    expect(lesson.length).toBeLessThanOrEqual(8);
    expect(differentiation.length).toBeGreaterThanOrEqual(5);
    expect(differentiation.length).toBeLessThanOrEqual(8);
    expect(new Set(GUIDED_TEACHING_EXPERIENCES.map((item) => item.experience_id)).size)
      .toBe(GUIDED_TEACHING_EXPERIENCES.length);
  });

  it('stores executable observation, adjustment, responsibility and evidence', () => {
    for (const item of GUIDED_TEACHING_EXPERIENCES) {
      expect(item.applicable_when).toBeTruthy();
      expect(item.suggested_strategy).toBeTruthy();
      expect(item.observation_signals.length).toBeGreaterThan(0);
      expect(item.adjustment_guidance).toBeTruthy();
      expect(item.teacher_responsibility).toBeTruthy();
      expect(item.effectiveness_evidence.length).toBeGreaterThan(0);
      expect(item.source.url).toMatch(/^https:\/\//);
      expect(item.status).toBe('candidate');
    }
  });

  it('returns at most two relevant candidates and none for an unsupported scenario', () => {
    const matched = matchTeachingExperiences({
      draft: {
        audience_context: {
          content: '初中物理完整课时设计，包含实验探究和课堂评价',
          evidence: [{ source: 'user_explicit', quote: '实验探究' }],
        },
      },
      step: 'strategy_co_creation',
    });
    const unmatched = matchTeachingExperiences({
      draft: {
        audience_context: {
          content: '学校食堂排班和库存盘点',
          evidence: [{ source: 'user_explicit', quote: '食堂排班' }],
        },
      },
      step: 'strategy_co_creation',
    });

    expect(matched.length).toBeGreaterThan(0);
    expect(matched.length).toBeLessThanOrEqual(2);
    expect(unmatched).toEqual([]);
  });

  it('provides generic conversion rules without treating them as user requirements', () => {
    expect(GUIDED_SKILL_CONVERSION_RULES.length).toBeGreaterThanOrEqual(6);
    expect(GUIDED_SKILL_CONVERSION_RULES.join(' ')).toContain('观察');
    expect(GUIDED_SKILL_CONVERSION_RULES.join(' ')).toContain('教师确认');
  });
});
