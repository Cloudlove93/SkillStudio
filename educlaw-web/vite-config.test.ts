import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'vitest';

describe('Vite public asset paths', () => {
  it('uses root-relative public assets so the favicon works on nested routes', async () => {
    const config = await readFile(new URL('./vite.config.ts', import.meta.url), 'utf8');

    assert.match(config, /base:\s*['"]\/['"]/);
    assert.doesNotMatch(config, /base:\s*['"]\.\/['"]/);
  });
});
