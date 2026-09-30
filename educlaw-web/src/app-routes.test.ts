import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const settingsSource = readFileSync(
  new URL('./components/settings/SettingsDialog.tsx', import.meta.url),
  'utf8',
);

test('retired legacy and workflow screens are no longer reachable from the app', () => {
  assert.doesNotMatch(appSource, /import Workspace from/);
  assert.doesNotMatch(appSource, /import AgentProfileWorkflow from/);
  assert.match(appSource, /path="\/legacy" element=\{<Navigate to="\/" replace \/>\}/);
  assert.match(appSource, /path="\/workflow" element=\{<Navigate to="\/" replace \/>\}/);
  assert.doesNotMatch(settingsSource, /to="\/workflow"/);
});

test('unknown client routes have an explicit fallback', () => {
  assert.match(appSource, /path="\*"/);
});
