import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('./LiteArenaPanel.tsx', import.meta.url),
  'utf8',
);

test('LiteArenaPanel should guard skill history mutations with action-scoped pending ids', () => {
  assert.match(source, /function getSkillActionId\(/);
  assert.match(source, /const skillActionPendingIdRef = useRef\(''\);/);
  assert.match(
    source,
    /const actionId = getSkillActionId\('rollback', currentSkillId, version\.id\);/,
  );
  assert.match(
    source,
    /const actionId = getSkillActionId\('discard', currentSkillId, version\.id\);/,
  );
  assert.match(
    source,
    /const actionId = getSkillActionId\('undiscard', currentSkillId, version\.id\);/,
  );
  assert.match(source, /if \(skillActionPendingIdRef\.current === actionId\) return;/);
  assert.match(source, /skillActionPendingIdRef\.current = actionId;/);
  assert.match(source, /disabled=\{isPending\}/);
});

test('LiteArenaPanel should select the new rollback-created skill version after refresh', () => {
  assert.match(
    source,
    /await loadSkillVersions\(\s*currentPkgId,\s*currentSkillId,\s*result\.rolledBackSkillVersionId,\s*\);/,
  );
});
