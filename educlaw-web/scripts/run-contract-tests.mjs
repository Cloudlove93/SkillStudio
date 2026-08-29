import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = join(webRoot, 'src');

function collectTests(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectTests(path);
    if (!/\.test\.tsx?$/.test(entry.name)) return [];
    return readFileSync(path, 'utf8').includes("'node:test'") ||
      readFileSync(path, 'utf8').includes('"node:test"')
      ? [relative(webRoot, path)]
      : [];
  });
}

const tests = collectTests(sourceRoot);
if (tests.length === 0) {
  console.error('没有找到使用 node:test 的前端契约测试');
  process.exit(1);
}

const tsxCli = join(webRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const result = spawnSync(process.execPath, [tsxCli, '--test', ...tests], {
  cwd: webRoot,
  env: process.env,
  stdio: 'inherit',
  windowsHide: true,
});

if (result.error) {
  console.error(`无法启动前端契约测试：${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
