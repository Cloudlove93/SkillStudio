import { describe, expect, it } from 'vitest';
import {
  buildChangeRemovalFeedback,
  createOptimizationReviewItems,
} from './answer-optimization-review';

describe('answer optimization review', () => {
  it('turns the generated patch into a compact review item', () => {
    expect(createOptimizationReviewItems({
      patch: {
        section: 'Instructions',
        operation: 'replace',
        reason: '确认次数过多，容易打断教师的设计节奏。',
        proposedContent: '只保留情境信息和安全预案两处关键确认。',
      },
      diff: {
        before: '情境、目标和安全预案分别确认。',
        after: '只保留情境信息和安全预案两处关键确认。',
      },
    })).toEqual([{
      id: 'Instructions:replace',
      title: '调整 Instructions',
      summary: '确认次数过多，容易打断教师的设计节奏。',
      before: '情境、目标和安全预案分别确认。',
      after: '只保留情境信息和安全预案两处关键确认。',
    }]);
  });

  it('uses a readable fallback when only a diff is available', () => {
    expect(createOptimizationReviewItems({
      patch: null,
      diff: { before: '', after: '新增实验安全检查规则。' },
    })[0]).toMatchObject({
      id: 'generated-change',
      title: '更新 Skill 规则',
      summary: '已根据本轮反馈整理修改。',
    });
  });

  it('separates changed markdown subsections into individually reviewable items', () => {
    const items = createOptimizationReviewItems({
      patch: {
        section: 'Instructions',
        operation: 'replace',
        reason: '简化确认、明确偏差标准并统一安全边界。',
        proposedContent: '',
      },
      diff: {
        before: '### 确认节点\n确认三次。\n\n### 偏差处理\n偏差超过 20%。\n\n### 安全边界\n高风险实验暂停。',
        after: '### 确认节点\n只确认情境和安全。\n\n### 偏差处理\n人数误差超过 5 人时确认。\n\n### 安全边界\n高风险实验转安全评估。',
      },
    });

    expect(items).toHaveLength(3);
    expect(items.map((item) => item.title)).toEqual(['确认节点', '偏差处理', '安全边界']);
    expect(items[1]).toMatchObject({
      before: '偏差超过 20%。',
      after: '人数误差超过 5 人时确认。',
    });
  });

  it('creates explicit feedback for removing one change without reverting other edits', () => {
    expect(buildChangeRemovalFeedback({
      title: '调整 Instructions',
      summary: '减少确认节点。',
      after: '只保留两处确认。',
    })).toBe('撤销“调整 Instructions”这一项修改：只保留两处确认。保留本轮草案中的其他修改不变。');
  });
});
