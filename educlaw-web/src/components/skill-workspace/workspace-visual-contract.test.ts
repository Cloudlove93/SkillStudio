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
    expect(main).toContain('@fontsource-variable/noto-sans-sc/wght.css');
  });

  it('defines workspace typography and semantic color tokens', () => {
    const tokens = read('./styles/workspace-tokens.css');

    expect(tokens).toMatch(
      /--workspace-font-ui:\s*["']Noto Sans SC Variable["']/,
    );
    expect(tokens).toContain('--workspace-primary: #4658c9');
    expect(tokens).toContain('--workspace-evidence: #28766f');
    expect(tokens).toContain('--workspace-text-xs: 12px');
    expect(tokens).not.toMatch(/--workspace-text-[^:]+:\s*(?:[0-9]|1[01])px/);
  });

  it('keeps the legacy stylesheet as an import-only compatibility entry', () => {
    const css = read('./skill-workspace.css');
    const expectedImports = [
      'workspace-tokens.css',
      'workspace-shell.css',
      'workspace-controls.css',
      'workspace-inspector.css',
      'creation-workflows.css',
      'multimodal-workbench.css',
      'repository.css',
      'skill-detail.css',
    ];

    for (const stylesheet of expectedImports) {
      expect(css).toContain(stylesheet);
    }
    expect(css).not.toContain('.skill-workspace-root {');
    expect(css).not.toContain('.workspace-inspector {');
  });

  it('keeps readable text, explicit focus, and motion-safe transitions', () => {
    const styles = [
      read('./styles/workspace-controls.css'),
      read('./styles/workspace-inspector.css'),
      read('./styles/multimodal-workbench.css'),
    ].join('\n');

    expect(styles).not.toMatch(/font-size:\s*(?:[0-9]|1[01])px/);
    expect(styles).toContain(':focus-visible');
    expect(styles).not.toContain('transition: all');
    expect(styles).toContain('prefers-reduced-motion: reduce');
  });

  it('removes superseded drawer and popover shells', () => {
    const styles = [
      read('./styles/workspace-inspector.css'),
      read('./styles/multimodal-workbench.css'),
      read('./styles/skill-detail.css'),
    ].join('\n');

    expect(styles).not.toContain('.skill-mm-drawer-');
    expect(styles).not.toContain('.skill-context-popover');
    expect(styles).not.toContain('.skill-content-resize-');
  });

  it('keeps the inspector opaque and the compact sidebar readable on narrow screens', () => {
    const inspector = read('./styles/workspace-inspector.css');
    const shell = read('./styles/workspace-shell.css');

    expect(inspector).toMatch(
      /\.workspace-inspector-panel\s*\{[^}]*background:\s*var\(--workspace-surface\)/s,
    );
    expect(inspector).toMatch(
      /@media \(max-width: 767px\)[\s\S]*\.skill-workspace-root\.is-context-open \.workspace-inspector\s*\{[^}]*width:\s*0/s,
    );
    expect(inspector).toMatch(
      /@media \(max-width: 767px\)[\s\S]*\.workspace-inspector\.is-fullscreen\s*\{[^}]*flex:\s*0 0 0;[^}]*width:\s*0/s,
    );
    expect(inspector).toMatch(
      /@media \(max-width: 767px\)[\s\S]*\.skill-content-column:has\(\.workspace-inspector\.is-fullscreen\)\s+\.skill-main-column\s*\{[^}]*display:\s*flex/s,
    );
    expect(shell).toContain('@media (max-width: 1100px)');
    expect(shell).toMatch(
      /@media \(max-width: 1100px\)[\s\S]*\.skill-new-button > span[\s\S]*\.skill-sidebar-empty\s*\{\s*display:\s*none/s,
    );
  });
});
