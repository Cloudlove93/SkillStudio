import { describe, expect, it } from 'vitest';
import { hasMeaningfulDocumentContent } from '@educlaw/shared';
import {
  createDocumentBatchPlan,
  summarizeDocumentBatch,
} from './document-skill-creation-state';

describe('document Skill creation state', () => {
  it.each([
    '68fjjfy4mi夫57',
    'suu6ed迷7我i吧234',
    'asdfghjkl123456',
  ])('rejects meaningless document text: %s', (content) => {
    expect(hasMeaningfulDocumentContent(content)).toBe(false);
  });

  it.each([
    '设计函数作业',
    'Create a lesson plan',
    '{"goal":"teach fractions"}',
    'function buildLesson() { return "practice"; }',
  ])('accepts meaningful document text: %s', (content) => {
    expect(hasMeaningfulDocumentContent(content)).toBe(true);
  });

  it('creates one generation task per document', () => {
    const plan = createDocumentBatchPlan(
      [
        { name: 'a.docx', content: 'a' },
        { name: 'b.md', content: 'b' },
      ],
      100,
    );

    expect(plan.map((item) => [item.name, item.status])).toEqual([
      ['a.docx', 'waiting'],
      ['b.md', 'waiting'],
    ]);
  });

  it('summarizes mixed completion without losing failures', () => {
    expect(
      summarizeDocumentBatch([
        { id: '1', name: 'a', status: 'done', packageId: '10' },
        { id: '2', name: 'b', status: 'error', error: '生成失败' },
      ]),
    ).toEqual({ successCount: 1, failureCount: 1 });
  });
});
