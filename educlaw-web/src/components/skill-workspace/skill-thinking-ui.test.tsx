// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SkillReasoningBlock } from './SkillReasoningBlock';
import { SkillThinkingToggle } from './SkillThinkingToggle';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('Skill thinking controls', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('renders a Chinese pressed-state button and locks it during generation', async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <SkillThinkingToggle
          enabled
          disabled
          supported
          onChange={onChange}
        />,
      );
    });

    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="关闭深度思考"]',
    );
    expect(button?.getAttribute('aria-pressed')).toBe('true');
    expect(button?.disabled).toBe(true);
    expect(container.textContent).toContain('深度思考：开');
  });

  it('keeps the preference visible when the current model is unsupported', async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <SkillThinkingToggle
          enabled
          disabled={false}
          supported={false}
          onChange={onChange}
        />,
      );
    });

    await act(async () => container.querySelector('button')?.click());
    expect(onChange).toHaveBeenCalledWith(false);
    expect(container.textContent).toContain('当前模型不支持深度思考');
    expect(container.textContent).not.toMatch(
      /reasoning_content|thinkingEnabled|supported/i,
    );
  });

  it('keeps completed reasoning collapsed until the user opens it', async () => {
    await act(async () => {
      root.render(
        <SkillReasoningBlock text={'第一步\n第二步'} streaming={false} />,
      );
    });

    const toggle = container.querySelector<HTMLButtonElement>(
      'button[aria-expanded="false"]',
    );
    expect(container.textContent).toContain('已完成思考');
    expect(container.textContent).not.toContain('第一步');

    await act(async () => toggle?.click());
    expect(container.textContent).toContain('第一步');
    expect(
      container.querySelector('[data-reasoning-content]')?.textContent,
    ).toBe('第一步\n第二步');
  });

  it('shows streaming reasoning as plain text and copies it separately', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const unsafe = '<img src=x onerror=alert(1)>\n分析';

    await act(async () => {
      root.render(<SkillReasoningBlock text={unsafe} streaming />);
    });

    expect(
      container.querySelector('button[aria-expanded="true"]'),
    ).not.toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(
      container.querySelector('[data-reasoning-content]')?.textContent,
    ).toContain('<img src=x onerror=alert(1)>');
    const copy = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('复制思考'),
    );
    await act(async () => copy?.click());
    expect(writeText).toHaveBeenCalledWith(unsafe);

    await act(async () => {
      root.render(<SkillReasoningBlock text="" streaming={false} />);
    });
    expect(container.querySelector('[data-reasoning-content]')).toBeNull();
  });
});
