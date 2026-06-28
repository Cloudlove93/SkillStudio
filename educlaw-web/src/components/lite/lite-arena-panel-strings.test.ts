import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('./LiteArenaPanel.tsx', import.meta.url),
  'utf8',
);

const mojibakeFragments = ['鎵归噺浠诲姟', '浠撳簱'];

test('LiteArenaPanel should not contain visible mojibake UI text', () => {
  const found = mojibakeFragments.filter((fragment) =>
    source.includes(fragment),
  );
  assert.deepEqual(found, []);
});

test('LiteArenaPanel should remove the rubric AI optimize action from the header', () => {
  assert.doesNotMatch(source, /const rubricPrimaryActionLabel = 'AI优化';/);
  assert.doesNotMatch(source, /function handleRubricPrimaryAction\(/);
  assert.doesNotMatch(source, /点“AI优化”/);
});

test('LiteArenaPanel should keep manual rubric actions in the header', () => {
  assert.match(source, /编辑/);
  assert.match(source, /导入文件/);
  assert.match(source, /在中间打开/);
});

test('LiteArenaPanel should keep rubric edit wired to the manual edit flow', () => {
  assert.match(source, /function startManualEditRubric\(/);
  assert.match(source, /onClick=\{\(\) => startManualEditRubric\(\)\}/);
  assert.match(source, /title: '手动编辑 rubric\.md'/);
});

test('LiteArenaPanel should drive report readiness from rubric content instead of strict rubric usability', () => {
  assert.match(source, /getReportReadiness\(messages, rubricHasContent\)/);
  assert.match(
    source,
    /canOpenReportAction\(Boolean\(thread\), rubricHasContent\)/,
  );
  assert.doesNotMatch(
    source,
    /if \(!ensureRubricConfigured\('评估报告'\)\) return;/,
  );
});

test('LiteArenaPanel should open rubric center preview from the current rubric markdown content', () => {
  assert.match(
    source,
    /const rubricPreviewContent = rubricText\.trim\(\) \|\| rubricDisplayText;/,
  );
  assert.match(source, /content: rubricPreviewContent,/);
});

test('LiteArenaPanel should render rubric content through the structured rubric view', () => {
  assert.match(
    source,
    /import \{ RubricStructuredView \} from '\.\/rubric-structured-view';/,
  );
  assert.match(
    source,
    /<RubricStructuredView content=\{rubricDisplayText\} \/>/,
  );
  assert.match(source, /const previewContent = normalizePreviewContent\(/);
  assert.match(
    source,
    /centerPreview\.type === 'rubric'[\s\S]*<RubricStructuredView content=\{previewContent\} \/>/,
  );
});
