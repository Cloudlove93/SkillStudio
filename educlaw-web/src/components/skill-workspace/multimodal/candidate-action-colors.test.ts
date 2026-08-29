// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workbenchCss = readFileSync(
  resolve(
    process.cwd(),
    'src/components/skill-workspace/styles/multimodal-workbench.css',
  ),
  'utf8',
);

const THEME_VALUES = {
  light: {
    background: '#f7f8ff',
    workspaceBorder: '#dde2e1',
    workspaceMuted: '#66727e',
    workspacePrimary: '#4658c9',
  },
  dark: {
    background: '#11142a',
    workspaceBorder: '#2d3839',
    workspaceMuted: '#a9b4b4',
    workspacePrimary: '#9ba8ff',
  },
} as const;

function resolveActionTheme(css: string, theme: 'light' | 'dark') {
  const values = THEME_VALUES[theme];

  return css
    .replaceAll('var(--background)', values.background)
    .replaceAll('var(--workspace-border)', values.workspaceBorder)
    .replaceAll('var(--workspace-muted)', values.workspaceMuted)
    .replaceAll('var(--workspace-primary)', values.workspacePrimary);
}

function extractRule(css: string, selector: string) {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) {
    throw new Error(`Missing ${selector}; CSS begins with ${css.slice(0, 80)}`);
  }
  const end = css.indexOf('}', start);
  expect(end).toBeGreaterThan(start);
  return css.slice(start, end + 1);
}

function renderCandidateActions(theme: 'light' | 'dark') {
  document.documentElement.className = theme === 'dark' ? 'dark' : '';
  document.body.innerHTML = `
    <div class="skill-workspace-root">
      <div class="skill-mm-shell">
        <footer class="skill-mm-actionbar">
          <button class="skill-secondary-button skill-mm-action-muted">
            保存修改并重新验证
          </button>
          <button class="skill-primary-button skill-mm-action-confirm">
            确认 3 个融合主题并构建 Skill
          </button>
        </footer>
      </div>
    </div>
  `;

  return {
    save: document.querySelector<HTMLButtonElement>('.skill-mm-action-muted')!,
    confirm: document.querySelector<HTMLButtonElement>(
      '.skill-mm-action-confirm',
    )!,
  };
}

describe.each([
  ['light', 'rgba(0, 0, 0, 0)', 'rgb(70, 88, 201)', 'rgb(247, 248, 255)'],
  ['dark', 'rgba(0, 0, 0, 0)', 'rgb(155, 168, 255)', 'rgb(17, 20, 42)'],
] as const)(
  'candidate action hierarchy in %s mode',
  (theme, saveBackground, confirmBackground, confirmForeground) => {
    let style: HTMLStyleElement;

    beforeEach(() => {
      style = document.createElement('style');
      style.textContent = resolveActionTheme(
        [
          extractRule(
            workbenchCss,
            '.skill-mm-actionbar .skill-mm-action-muted',
          ),
          extractRule(
            workbenchCss,
            '.skill-mm-actionbar .skill-mm-action-confirm',
          ),
        ].join('\n'),
        theme,
      );
      document.head.append(style);
    });

    afterEach(() => {
      style.remove();
      document.body.replaceChildren();
      document.documentElement.className = '';
    });

    it('keeps save neutral and reserves the solid surface for confirmation', () => {
      const { save, confirm } = renderCandidateActions(theme);

      expect(getComputedStyle(save).backgroundColor).toBe(saveBackground);
      expect(getComputedStyle(confirm).backgroundColor).toBe(confirmBackground);
      expect(getComputedStyle(confirm).color).toBe(confirmForeground);
    });
  },
);
