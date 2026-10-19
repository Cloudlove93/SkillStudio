import { describe, expect, it } from 'vitest';
import {
  parseStructuredGuidedInput,
  structuredInputToEducationDraft,
} from './structured-guided-input.js';

describe('structured creation input', () => {
  const fields = {
    name: '分层作业助手',
    audience: '初二数学教师',
    scenario: '课后作业',
    task: '设计分层作业',
    input: '教材例题与匿名学情',
    output: 'A/B/C三层任务和评价标准',
    boundaries: '不允许自动给学生评分',
  };
  it('maps explicit fields directly without an extraction model', () => {
    const draft = structuredInputToEducationDraft(
      parseStructuredGuidedInput(fields)!,
    );
    expect(draft.input_evidence).toEqual({
      content: fields.input,
      evidence: [{ source: 'user_explicit', quote: fields.input }],
    });
    expect(draft.educational_goal?.content).toBe(fields.task);
    expect(draft.audience_context?.content).toContain(fields.audience);
    expect(draft.completion_evidence?.content).toBe(fields.output);
    expect(draft.boundaries_responsibility?.content).toBe(fields.boundaries);
    expect(draft.teaching_strategy).toBeUndefined();
    expect(draft.action_adaptation).toBeUndefined();
  });
  it.each([
    { ...fields, userId: 'other' },
    { ...fields, input: 42 },
    { ...fields, input: 'a'.repeat(4001) },
    { ...fields, name: 'a'.repeat(81) },
  ])('rejects untrusted or oversized fields', (value) => {
    expect(() => parseStructuredGuidedInput(value)).toThrow();
  });
});
