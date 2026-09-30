import { strict as assert } from 'node:assert';
import test from 'node:test';
import type { ArenaReport } from '@educlaw/shared';
import {
  buildArenaReportRows,
  buildArenaReportSideCards,
  formatArenaReportWinner,
} from './arena-report.ts';

const report: ArenaReport = {
  threadId: 1,
  baseline: {
    summary: 'baseline summary',
    total: 72,
    dimensions: [
      {
        key: 'accuracy',
        name: '准确性',
        score: 30,
        maxScore: 40,
        reason: '基本正确',
      },
      {
        key: 'clarity',
        name: '清晰度',
        score: 20,
        maxScore: 30,
        reason: '表达一般',
      },
    ],
  },
  enhanced: {
    summary: 'enhanced summary',
    total: 85,
    dimensions: [
      {
        key: 'clarity',
        name: '清晰度',
        score: 26,
        maxScore: 30,
        reason: '表达更清楚',
      },
      {
        key: 'accuracy',
        name: '准确性',
        score: 35,
        maxScore: 40,
        reason: '更完整',
      },
      {
        key: 'safety',
        name: '安全性',
        score: 15,
        maxScore: 20,
        reason: '补充了边界',
      },
    ],
  },
  recommendation: '采用增强回答',
  winningSide: 'enhanced',
};

test('buildArenaReportRows merges baseline and enhanced dimensions by key', () => {
  const rows = buildArenaReportRows(report);

  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], {
    key: 'accuracy',
    name: '准确性',
    baselineScore: 30,
    baselineMaxScore: 40,
    baselineReason: '基本正确',
    enhancedScore: 35,
    enhancedMaxScore: 40,
    enhancedReason: '更完整',
    diff: 5,
  });
  assert.deepEqual(rows[1], {
    key: 'clarity',
    name: '清晰度',
    baselineScore: 20,
    baselineMaxScore: 30,
    baselineReason: '表达一般',
    enhancedScore: 26,
    enhancedMaxScore: 30,
    enhancedReason: '表达更清楚',
    diff: 6,
  });
  assert.deepEqual(rows[2], {
    key: 'safety',
    name: '安全性',
    baselineScore: 0,
    baselineMaxScore: 20,
    baselineReason: '',
    enhancedScore: 15,
    enhancedMaxScore: 20,
    enhancedReason: '补充了边界',
    diff: 15,
  });
});

test('buildArenaReportRows tolerates missing enhanced dimensions', () => {
  const rows = buildArenaReportRows({
    ...report,
    enhanced: {
      ...report.enhanced,
      dimensions: [
        {
          key: 'accuracy',
          name: '准确性',
          score: 33,
          maxScore: 40,
          reason: '还不错',
        },
      ],
    },
  });

  assert.deepEqual(rows[1], {
    key: 'clarity',
    name: '清晰度',
    baselineScore: 20,
    baselineMaxScore: 30,
    baselineReason: '表达一般',
    enhancedScore: 0,
    enhancedMaxScore: 30,
    enhancedReason: '',
    diff: -20,
  });
});

test('formatArenaReportWinner returns user-facing labels', () => {
  assert.equal(
    formatArenaReportWinner('baseline', '乡村中学三件好事干预设计师'),
    '基础模型',
  );
  assert.equal(
    formatArenaReportWinner('enhanced', '乡村中学三件好事干预设计师'),
    '乡村中学三件好事干预设计师',
  );
  assert.equal(
    formatArenaReportWinner('tie', '乡村中学三件好事干预设计师'),
    '平局',
  );
});

test('buildArenaReportSideCards keeps baseline and enhanced summaries under their own cards', () => {
  const cards = buildArenaReportSideCards(report, 'Enhanced');

  assert.deepEqual(cards, [
    {
      key: 'baseline',
      label: '基础模型',
      total: 72,
      summary: 'baseline summary',
    },
    {
      key: 'enhanced',
      label: 'Enhanced',
      total: 85,
      summary: 'enhanced summary',
    },
  ]);
});
