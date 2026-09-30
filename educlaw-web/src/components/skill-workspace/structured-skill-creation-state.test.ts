import { describe, expect, it } from 'vitest';
import {
  emptyStructuredSkillDraft,
  formatStructuredSkillRequest,
  hasStructuredSkillInput,
} from './structured-skill-creation-state';

describe('structured Skill creation state', () => {
  it('formats structured fields for the existing guided creation API', () => {
    expect(formatStructuredSkillRequest({
      name: '课堂活动设计',
      audience: '初中教师',
      scenario: '备课',
      task: '生成课堂活动',
      input: '教学目标',
      output: '活动方案',
      boundaries: '适龄',
    })).toBe([
      'Skill 名称：课堂活动设计',
      '服务对象：初中教师',
      '使用场景：备课',
      '希望完成的任务：生成课堂活动',
      '输入内容：教学目标',
      '期望输出：活动方案',
      '需要遵守的边界：适龄',
    ].join('\n'));
  });

  it('allows the backend to continue an incomplete but non-empty draft', () => {
    expect(hasStructuredSkillInput(emptyStructuredSkillDraft)).toBe(false);
    expect(hasStructuredSkillInput({
      ...emptyStructuredSkillDraft,
      task: '  生成课堂活动  ',
    })).toBe(true);
  });
});
