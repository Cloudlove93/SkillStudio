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

test('LiteArenaPanel should require configured rubric before report actions are enabled', () => {
  assert.match(
    source,
    /getReportReadiness\(\s*messages,\s*rubricConfigured,\s*replyGenerating,\s*\)/,
  );
  assert.match(
    source,
    /canOpenReportAction\(Boolean\(thread\), rubricConfigured\)/,
  );
  assert.doesNotMatch(
    source,
    /if \(!ensureRubricConfigured\('评估报告'\)\) return;/,
  );
});

test('LiteArenaPanel should not use global progress for normal reply generation', () => {
  const handleSend = source.match(
    /async function handleSend\(\) \{[\s\S]*?\n {2}async function handleDelete\(\)/,
  )?.[0];

  assert.ok(handleSend);
  assert.doesNotMatch(handleSend, /startProgress\(/);
  assert.doesNotMatch(handleSend, /pushProgress\(/);
  assert.doesNotMatch(handleSend, /finishProgress\(/);
  assert.doesNotMatch(handleSend, /failProgress\(/);
  assert.match(handleSend, /setReplyGeneratingThreadIds\(\(prev\)/);
  assert.match(handleSend, /currentThreadId/);
});

test('LiteArenaPanel should ignore stale reply stream events after switching threads', () => {
  const handleSend = source.match(
    /async function handleSend\(\) \{[\s\S]*?\n {2}async function handleDelete\(\)/,
  )?.[0];

  assert.ok(handleSend);
  assert.match(handleSend, /function isCurrentReplyThread\(\)/);
  assert.match(handleSend, /threadRef\.current\?\.id === currentThreadId/);
  assert.match(handleSend, /if \(!isCurrentReplyThread\(\)\) return;/);
  assert.match(
    handleSend,
    /setReplyGeneratingThreadIds\(\(prev\) => \{[\s\S]*next\.delete\(currentThreadId\)/,
  );
});

test('LiteArenaPanel should wait for reply save before starting interactive optimization', () => {
  const startInteractive = source.match(
    /async function startInteractive\(forceNew = false\) \{[\s\S]*?\n {2}async function sendInteractiveMessage\(\)/,
  )?.[0];

  assert.ok(startInteractive);
  assert.match(startInteractive, /replyGenerating/);
  assert.match(startInteractive, /setStatus\(interactiveRequiredMessage\)/);
  assert.ok(
    (source.match(
      /disabled=\{\s*!thread \|\| !rubricConfigured \|\| replyGenerating\s*\}/g,
    )?.length || 0) >= 3,
  );
  assert.match(source, /disabled=\{replyGenerating\}/);
  assert.match(
    source,
    /const interactiveActionTitle =[\s\S]*'开始交互式优化'/,
  );
  assert.doesNotMatch(source, /title=\{interactiveRequiredMessage\}/);
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
