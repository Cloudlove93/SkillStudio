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
    /canOpenReportAction\(\s*Boolean\(thread\),\s*canGenerateReport,\s*\)/,
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

test('LiteArenaPanel should generate batch documents with a limited concurrency pool', () => {
  const handleGeneratePackages = source.match(
    /async function handleGeneratePackages\(\) \{[\s\S]*?\n {2}async function handleSend\(\)/,
  )?.[0];

  assert.ok(handleGeneratePackages);
  assert.match(source, /const BATCH_GENERATE_CONCURRENCY = 2;/);
  assert.match(handleGeneratePackages, /nextBatchIndex/);
  assert.match(handleGeneratePackages, /Math\.min\(BATCH_GENERATE_CONCURRENCY, batchPlan\.length\)/);
  assert.match(handleGeneratePackages, /Promise\.all\(workers\)/);
  assert.doesNotMatch(
    handleGeneratePackages,
    /for \(let index = 0; index < batchPlan\.length; index \+= 1\) \{[\s\S]*?await runGenerateJob\(\[sourceDoc\]\);/,
  );
});

test('LiteArenaPanel should constrain batch task UI inside the left sidebar', () => {
  assert.match(source, /className="space-y-4 overflow-x-hidden p-4"/);
  assert.match(
    source,
    /className="min-w-0 max-w-full space-y-1\.5 overflow-hidden rounded-xl border border-border\/70 bg-card\/40 p-2"/,
  );
  assert.match(
    source,
    /className="flex min-w-0 items-start justify-between gap-2 overflow-hidden rounded-lg border border-border\/70 bg-card\/70 px-2\.5 py-2 text-xs"/,
  );
});

test('LiteArenaPanel should hard-limit long document names inside the left sidebar lists', () => {
  assert.match(
    source,
    /className="flex min-w-0 flex-1 items-center gap-1\.5 overflow-hidden"/,
  );
  assert.match(
    source,
    /<span[\s\S]*className="block min-w-0 truncate"[\s\S]*title=\{doc\.name\}[\s\S]*>\s*\{doc\.name\}\s*<\/span>/,
  );
  assert.match(
    source,
    /<div[\s\S]*className="block min-w-0 truncate font-medium"[\s\S]*title=\{item\.name\}[\s\S]*>/,
  );
  assert.match(
    source,
    /<div[\s\S]*className="block min-w-0 truncate text-\[11px\] text-muted-foreground"[\s\S]*title=\{item\.packageName\}[\s\S]*>/,
  );
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

test('LiteArenaPanel should load skill history through the new action APIs', () => {
  assert.match(source, /liteApi\.listPackageSkills\(token, packageId, true\)/);
  assert.match(
    source,
    /liteApi\.listSkillVersions\(\s*token,\s*packageId,\s*skillRecordId,/,
  );
  assert.match(source, /expectedPackageVersionId: currentPackageVersionId/);
  assert.match(source, /const idempotencyKey = createClientIdempotencyKey\(\);/);
});

test('LiteArenaPanel should ignore stale skill history responses and clear loading when selection changes', () => {
  assert.match(source, /const skillVersionsRequestIdRef = useRef\(0\);/);
  assert.match(source, /const requestId = skillVersionsRequestIdRef\.current \+ 1;/);
  assert.match(
    source,
    /skillVersionsRequestIdRef\.current !== requestId \|\|\s*selectedPackageIdRef\.current !== packageId/,
  );
  assert.match(source, /setSkillVersionsLoading\(false\);/);
});

test('LiteArenaPanel should show the removed-skill notice instead of previewing another skill', () => {
  assert.match(
    source,
    /const selectedSkill =\s*\(selectedSkillId\s*\?\s*selectedPackage\?\.snapshot\.skills\.find/,
  );
  assert.match(source, /当前 Skill 已不在最新智能体快照中/);
});

test('LiteArenaPanel should expose skill history controls in the skills tab', () => {
  assert.match(source, /历史版本/);
  assert.match(source, /显示已废弃/);
  assert.match(source, /回退到此版本/);
  assert.match(source, /恢复可用/);
  assert.match(source, /版本预览 v\{/);
});
