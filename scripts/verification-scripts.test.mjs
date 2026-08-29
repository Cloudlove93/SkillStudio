import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const rootPackage = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
);
const openAgentPackage = JSON.parse(
  await readFile(new URL('../openagent/package.json', import.meta.url), 'utf8'),
);
const dockerIgnore = await readFile(
  new URL('../.dockerignore', import.meta.url),
  'utf8',
);

test('root verification covers every TypeScript workspace and the Python worker', () => {
  const scripts = rootPackage.scripts;

  for (const buildStep of [
    'build:shared',
    'build:openagent',
    'build:server',
    'build:web',
  ]) {
    assert.match(scripts.build, new RegExp(`(?:^|\\s)${buildStep}(?:\\s|$)`));
  }

  for (const testStep of ['test:server', 'test:web', 'test:worker']) {
    assert.match(scripts.test, new RegExp(`(?:^|\\s)${testStep}(?:\\s|$)`));
  }

  assert.equal(scripts['check:python'], 'pnpm run test:worker');
  assert.match(scripts['security:audit'], /--audit-level moderate/);
  assert.match(scripts.check, /pnpm lint/);
  assert.match(scripts.check, /pnpm test/);
  assert.match(scripts.check, /pnpm build/);
});

test('OpenAgent build cleanup is cross-platform', () => {
  assert.match(openAgentPackage.scripts.build, /node -e/);
  assert.doesNotMatch(openAgentPackage.scripts.build, /\brm\s+-rf\b/);
});

test('Docker context excludes local Codex artifacts and dependency backups', () => {
  const ignoredEntries = new Set(
    dockerIgnore
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean),
  );

  assert.equal(ignoredEntries.has('.codex_tmp'), true);
  assert.equal(ignoredEntries.has('**/node_modules'), true);
  assert.equal(ignoredEntries.has('**/dist'), true);
  assert.equal(ignoredEntries.has('**/.venv'), true);
});
