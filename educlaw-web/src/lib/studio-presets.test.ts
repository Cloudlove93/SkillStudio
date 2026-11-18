import { describe, expect, it } from 'vitest';
import { LESSON_PACK_COUNTS, LESSON_TOTAL_COUNT } from './lesson-pack-counts';
import {
  AGENT_TEMPLATE_PRESETS,
  ANALYSIS_SKILL_PRESETS,
  LESSON_PACK_PRESETS,
  STUDIO_PRESETS,
  buildLessonPackDocument,
  findLessonPack,
  presetToPrompt,
  presetToStructuredDraft,
  recommendPresets,
} from './studio-presets';
import type { LessonIndexItem } from './lessons';

const lesson = {
  id: 'demo-1',
  name: '分数的初步认识',
  description: '三年级数学课例',
  updatedAt: '2026-11-01',
  ready: true,
  subject: '数学',
  stage: '小学',
  grade: '3年级',
  textbook: '人教版',
  unit: '第八单元',
  lessonType: '新授',
  charCount: 6200,
  quality: 'A',
  file: 'demo-1.json',
} satisfies LessonIndexItem;

describe('studio presets', () => {
  it('defines 36 lesson packs, 14 analysis skills and 7 agent templates', () => {
    expect(LESSON_PACK_PRESETS).toHaveLength(36);
    expect(ANALYSIS_SKILL_PRESETS).toHaveLength(14);
    expect(AGENT_TEMPLATE_PRESETS).toHaveLength(7);
    expect(STUDIO_PRESETS).toHaveLength(57);
  });

  it('includes the unit, assessment, learner and observation methods', () => {
    const analysisIds = ANALYSIS_SKILL_PRESETS.map((preset) => preset.id);
    expect(analysisIds).toEqual(
      expect.arrayContaining([
        'analysis-unit-design',
        'analysis-learner-diagnosis',
        'analysis-homework-assessment',
        'analysis-classroom-observation',
        'analysis-interdisciplinary-design',
        'analysis-test-blueprint',
      ]),
    );
    const agentIds = AGENT_TEMPLATE_PRESETS.map((preset) => preset.id);
    expect(agentIds).toEqual(
      expect.arrayContaining([
        'agent-unit-designer',
        'agent-assessment-designer',
        'agent-learner-diagnostician',
      ]),
    );
  });

  it('recommends the new method skills by their task language', () => {
    expect(
      recommendPresets('帮我做单元整体教学设计').some(
        (match) => match.preset.id === 'analysis-unit-design',
      ),
    ).toBe(true);
    expect(
      recommendPresets('设计分层作业和评价任务').some(
        (match) => match.preset.id === 'analysis-homework-assessment',
      ),
    ).toBe(true);
    expect(
      recommendPresets('根据前测做学情诊断').some(
        (match) => match.preset.id === 'analysis-learner-diagnosis',
      ),
    ).toBe(true);
    expect(
      recommendPresets('编制双向细目表和命题').some(
        (match) => match.preset.id === 'analysis-test-blueprint',
      ),
    ).toBe(true);
  });

  it('keeps preset lesson counts aligned with the generated manifest counts', () => {
    expect(LESSON_TOTAL_COUNT).toBe(1404);
    expect(
      Object.values(LESSON_PACK_COUNTS).reduce(
        (total, count) => total + count,
        0,
      ),
    ).toBe(1404);
    for (const pack of LESSON_PACK_PRESETS) {
      expect(pack.lessonCount, pack.id).toBe(LESSON_PACK_COUNTS[pack.id]);
      expect(pack.description).toContain(`${pack.lessonCount} 节`);
    }
    expect(LESSON_PACK_COUNTS['lesson-pack-语文-高2']).toBe(19);
    expect(LESSON_PACK_COUNTS['lesson-pack-语文-高3']).toBe(25);
  });

  it('matches subject and grade lesson pack first', () => {
    const matches = recommendPresets('三年级数学课例的提问链分析');
    expect(matches[0]?.preset.id).toBe('lesson-pack-数学-3年级');
    expect(
      matches.some((match) => match.preset.id === 'analysis-question-chain'),
    ).toBe(true);
  });

  it('normalizes Chinese and arabic grade numbers', () => {
    expect(recommendPresets('三年级语文课例怎么分析')[0]?.preset.id).toBe(
      'lesson-pack-语文-3年级',
    );
    expect(recommendPresets('3年级语文课例怎么分析')[0]?.preset.id).toBe(
      'lesson-pack-语文-3年级',
    );
  });

  it('matches junior and senior high lesson packs', () => {
    expect(recommendPresets('初二数学课例的提问链分析')[0]?.preset.id).toBe(
      'lesson-pack-数学-8年级',
    );
    expect(recommendPresets('高二英语课例怎么分析')[0]?.preset.id).toBe(
      'lesson-pack-英语-高2',
    );
  });

  it('returns analysis skills for a method request without subject', () => {
    const matches = recommendPresets('帮我分析课堂师生话语和发言机会');
    expect(matches[0]?.preset.id).toBe('analysis-classroom-discourse');
  });

  it('returns nothing for empty or unusable text', () => {
    expect(recommendPresets('')).toEqual([]);
    expect(recommendPresets('  ')).toEqual([]);
    expect(recommendPresets('你好')).toEqual([]);
  });

  it('maps a preset to editable structured fields', () => {
    const preset = findLessonPack('数学', '3年级');
    expect(preset).not.toBeNull();
    const draft = presetToStructuredDraft(preset!);
    expect(draft.name).toContain('小学');
    expect(draft.task).toContain('课例');
    expect(presetToPrompt(preset!)).toContain('ASR');
  });

  it('builds a lesson pack document with ids and caution note', () => {
    const pack = findLessonPack('数学', '3年级')!;
    const document = buildLessonPackDocument(pack, [lesson]);
    expect(document).toContain('# 小学数学3年级课例包');
    expect(document).toContain('分数的初步认识');
    expect(document).toContain('demo-1');
    expect(document).toContain('未人工校对');
  });
});
