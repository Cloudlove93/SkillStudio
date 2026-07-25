import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('./LiteArenaPanel.tsx', import.meta.url),
  'utf8',
);

test('LiteArenaPanel should expose Skill Arena creation controls', () => {
  assert.match(source, /const \[arenaComposerKind, setArenaComposerKind\] = useState/);
  assert.match(source, /Skill Arena/);
  assert.match(source, /左侧 Skill/);
  assert.match(source, /右侧 Skill/);
  assert.match(source, /handleCreateArenaThread\(\)/);
});

test('LiteArenaPanel should create skill arena threads through action APIs', () => {
  assert.match(source, /liteApi\.createArenaThread\(/);
  assert.match(source, /liteApi\.getArenaThreadDetail\(/);
  assert.match(source, /basePackageVersionId: currentPackageVersionId/);
  assert.match(source, /idempotencyKey: createClientIdempotencyKey\(\)/);
});

test('LiteArenaPanel should render skill arena labels in the chat surface', () => {
  assert.match(source, /function getArenaSideLabels\(/);
  assert.match(source, /sideLabels=\{arenaSideLabels\}/);
  assert.match(source, /thread\?\.arenaKind === 'skill_arena'/);
});
