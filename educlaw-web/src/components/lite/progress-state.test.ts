import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  completeProgress,
  failProgressState,
  getProgressElapsedMs,
  startProgressState,
} from './progress-state.ts';

test('completed progress keeps elapsed time fixed', () => {
  const started = startProgressState('Report', 'Generating report...', 1_000);
  const completed = completeProgress(started, 'Report generated', 4_500);

  assert.equal(getProgressElapsedMs(completed, 20_000), 3_500);
});

test('failed progress keeps elapsed time fixed', () => {
  const started = startProgressState('Import ZIP', 'Importing...', 2_000);
  const failed = failProgressState(started, 'Import failed', 2_800);

  assert.equal(getProgressElapsedMs(failed, 10_000), 800);
});

test('active progress uses current time for elapsed time', () => {
  const started = startProgressState('Report', 'Generating report...', 1_000);

  assert.equal(getProgressElapsedMs(started, 3_250), 2_250);
});
