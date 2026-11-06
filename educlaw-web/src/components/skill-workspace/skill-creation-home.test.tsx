// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SkillCreationHome } from './SkillCreationHome';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('SkillCreationHome', () => {
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
  });

  function renderHome(overrides: Partial<Parameters<typeof SkillCreationHome>[0]> = {}) {
    const props = {
      documents: [],
      busy: false,
      onSend: vi.fn(),
      onFiles: vi.fn(),
      onRemoveDocument: vi.fn(),
      onOpenMultimodal: vi.fn(),
      onOpenManual: vi.fn(),
      onOpenWorkflow: vi.fn(),
      ...overrides,
    };
    act(() => root.render(<SkillCreationHome {...props} />));
    return props;
  }

  it('starts the existing guided conversation from the hero composer', () => {
    const props = renderHome();
    const textarea = container.querySelector('textarea')!;
    const send = container.querySelector<HTMLButtonElement>(
      'button[aria-label="开始对话共创"]',
    )!;

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      setter?.call(textarea, '  帮我设计一个分层教学 Skill  ');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => send.click());

    expect(props.onSend).toHaveBeenCalledWith('帮我设计一个分层教学 Skill');
  });

  it('routes the dedicated creation cards through their existing callbacks', () => {
    const props = renderHome();
    const buttons = [...container.querySelectorAll('button')];

    act(() =>
      buttons.find((button) => button.textContent?.includes('实录蒸馏'))!.click(),
    );
    act(() =>
      buttons.find((button) => button.textContent?.includes('结构视图'))!.click(),
    );
    act(() =>
      buttons.find((button) => button.textContent?.includes('工作流'))!.click(),
    );

    expect(props.onOpenMultimodal).toHaveBeenCalledTimes(1);
    expect(props.onOpenManual).toHaveBeenCalledTimes(1);
    expect(props.onOpenWorkflow).toHaveBeenCalledTimes(1);
  });

  it('keeps attached document removal available on the landing page', () => {
    const onRemoveDocument = vi.fn();
    renderHome({
      documents: [{ name: '课堂反思.md', content: '有效内容' }],
      onRemoveDocument,
    });

    act(() =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="移除 课堂反思.md"]')!
        .click(),
    );

    expect(onRemoveDocument).toHaveBeenCalledWith(0);
  });
});
