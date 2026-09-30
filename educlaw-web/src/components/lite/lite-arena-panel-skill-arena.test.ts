import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('./LiteArenaPanel.tsx', import.meta.url),
  'utf8',
);
const dialogSource = readFileSync(
  new URL('../arena/ArenaThreadCreatorDialog.tsx', import.meta.url),
  'utf8',
);

test('LiteArenaPanel should delegate Skill Arena creation to the dedicated dialog', () => {
  assert.match(source, /from '\.\.\/arena\/ArenaThreadCreatorDialog'/);
  assert.match(source, /ArenaThreadCreatorDialog/);
  assert.match(source, /setCreatorOpen\(true\)/);
});

test('ArenaThreadCreatorDialog should expose Skill Arena creation controls', () => {
  assert.match(dialogSource, /Skill Arena/);
  assert.match(dialogSource, /左侧 Skill/);
  assert.match(dialogSource, /右侧 Skill/);
  assert.match(dialogSource, /const \[mode, setMode\] = useState<ArenaKind>/);
});

test('ArenaThreadCreatorDialog should create skill arena threads through action APIs', () => {
  assert.match(dialogSource, /liteApi\.createArenaThread\(/);
  assert.match(dialogSource, /liteApi\.getArenaThreadDetail\(/);
  assert.match(dialogSource, /basePackageVersionId: currentPackageVersionId/);
  assert.match(dialogSource, /idempotencyKey: createClientIdempotencyKey\(\)/);
});

test('LiteArenaPanel should render skill arena labels in the chat surface', () => {
  assert.match(source, /function getArenaSideLabels\(/);
  assert.match(source, /sideLabels=\{arenaSideLabels\}/);
  assert.match(source, /thread\?\.arenaKind === 'skill_arena'/);
});

test('LiteArenaPanel should provide a history dropdown to switch threads', () => {
  assert.match(source, /useArenaThreadList/);
  assert.match(source, /arenaThreadList\.switchThread/);
  assert.match(source, /arenaThreadList\.notifyCreated/);
});
