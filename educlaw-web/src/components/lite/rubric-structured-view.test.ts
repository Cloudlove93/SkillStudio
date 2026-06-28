import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('./rubric-structured-view.tsx', import.meta.url),
  'utf8',
);

test('RubricStructuredView should not render raw fallback pills in the visible UI', () => {
  assert.doesNotMatch(source, /原文展示/);
  assert.doesNotMatch(source, /未显式标权重/);
  assert.doesNotMatch(source, /'Markdown'/);
});

test('RubricStructuredView should use readable Chinese labels in structured tables', () => {
  assert.match(source, /个评分维度/);
  assert.match(source, /含权重/);
  assert.match(source, /等级/);
  assert.match(source, /评分理由/);
  assert.match(source, /评分要点/);
});

test('RubricStructuredView should not extract or render narrative overall summaries', () => {
  assert.doesNotMatch(source, /extractOverallSummary/);
  assert.doesNotMatch(source, /Overall evaluation/);
  assert.doesNotMatch(source, /整体评价/);
});
