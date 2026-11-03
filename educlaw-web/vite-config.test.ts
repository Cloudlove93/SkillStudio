import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'vitest';

describe('Vite public asset paths', () => {
  it('serves the Agent workspace document while keeping legacy API proxy requests', async () => {
    const { default: config } = await import('./vite.config');
    const proxy = config.server!.proxy!['/agents'];
    assert.equal(typeof proxy, 'object');
    if (typeof proxy === 'string') throw new Error('Expected proxy options');
    assert.equal(proxy.bypass!({ headers: { accept: 'text/html' } } as never, {} as never, proxy), '/index.html');
    assert.equal(proxy.bypass!({ headers: { accept: 'application/json' } } as never, {} as never, proxy), undefined);
  });
  it('uses root-relative public assets so the favicon works on nested routes', async () => {
    const config = await readFile(new URL('./vite.config.ts', import.meta.url), 'utf8');

    assert.match(config, /base:\s*['"]\/['"]/);
    assert.doesNotMatch(config, /base:\s*['"]\.\/['"]/);
  });
});
