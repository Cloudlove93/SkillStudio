import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const runtimeFacingFiles = [
  'components/theme-toggle.tsx',
  'components/deep-study/ArenaPanel.tsx',
  'components/lite/arena-report.ts',
  'components/lite/LiteArenaPanel.tsx',
  'components/lite/lite-rendering.tsx',
  'components/lite/report-preview-state.ts',
  'components/lite/rubric-display.ts',
  'components/lite/rubric-presentation.ts',
  'components/lite/rubric-status.ts',
  'components/lite/rubric-structured-view.tsx',
  'i18n/zh.ts',
  'lib/agent-icons.ts',
  'pages/LoginPage.tsx',
];

const mojibakeFragments = [
  '鍒嗙骇',
  '璇勫垎',
  '缁村害',
  '鏉冮噸',
  '鍏蜂綋璇勪环',
];

test('runtime-facing frontend files should not contain mojibake fragments', () => {
  const offenders = runtimeFacingFiles.filter((file) => {
    const source = readFileSync(resolve(import.meta.dirname, file), 'utf8');
    return mojibakeFragments.some((fragment) => source.includes(fragment));
  });

  assert.deepEqual(offenders, []);
});
