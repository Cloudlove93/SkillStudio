import { describe, expect, it } from 'vitest';
import {
  createDocumentBatchPlan,
  summarizeDocumentBatch,
} from './document-skill-creation-state';

describe('document Skill creation state', () => {
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
