import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8');

describe('Skill workspace visual contract', () => {
  it('self-hosts one Simplified Chinese variable UI font', () => {
    const pkg = JSON.parse(read('../../../package.json')) as {
      dependencies: Record<string, string>;
    };
    const main = read('../../main.tsx');

    expect(pkg.dependencies['@fontsource-variable/noto-sans-sc']).toBe('5.3.0');
    expect(main).toContain("@fontsource-variable/noto-sans-sc/wght.css");
  });

  it('defines workspace typography and semantic color tokens', () => {
    const tokens = read('./styles/workspace-tokens.css');

    expect(tokens).toContain('--workspace-font-ui: "Noto Sans SC Variable"');
    expect(tokens).toContain('--workspace-primary: #4658c9');
    expect(tokens).toContain('--workspace-evidence: #28766f');
    expect(tokens).toContain('--workspace-text-xs: 12px');
    expect(tokens).not.toMatch(/--workspace-text-[^:]+:\s*(?:[0-9]|1[01])px/);
  });
});
