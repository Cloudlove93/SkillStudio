import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const settingsSource = readFileSync(
  new URL('./components/settings/SettingsDialog.tsx', import.meta.url),
  'utf8',
);

test('retired legacy screens are no longer reachable and workflow demo stays routed', () => {
  assert.doesNotMatch(appSource, /import Workspace from/);
  assert.doesNotMatch(appSource, /import AgentProfileWorkflow from/);
  assert.match(appSource, /path="\/legacy" element=\{<Navigate to="\/" replace \/>\}/);
  assert.match(appSource, /path="\/workflow" element=\{<WorkflowDemo \/>\}/);
  assert.doesNotMatch(settingsSource, /to="\/workflow"/);
});

test('unknown client routes have an explicit fallback', () => {
  assert.match(appSource, /path="\*"/);
});

test('conversation stays on the home route without a separate chat page', () => {
  assert.doesNotMatch(appSource, /path="\/agents\/chat"/);
  assert.doesNotMatch(appSource, /from-skill/);
  assert.match(appSource, /path="\/"/);
});
