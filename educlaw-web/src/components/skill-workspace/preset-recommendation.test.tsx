// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PresetRecommendation } from './PresetRecommendation';
import type { PresetMatch } from '../../lib/studio-presets';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const matches: PresetMatch[] = [
  {
    preset: {
      id: 'lesson-pack-数学-3年级',
      kind: 'lesson-pack',
      name: '小学数学3年级课例包',
      description: '40 节课例',
      tags: [],
      keywords: [],
      prompt: 'pack prompt',
    },
    score: 8,
    reason: '匹配小学3年级数学课例',
  },
  {
    preset: {
      id: 'analysis-question-chain',
      kind: 'analysis-skill',
      name: '提问链分析',
      description: '分析问题链',
      tags: [],
      keywords: [],
      prompt: 'skill prompt',
    },
    score: 4,
    reason: '匹配提问链',
  },
];

describe('PresetRecommendation', () => {
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

  it('renders related resources and calls the matching action', () => {
    const onUse = vi.fn();
    const onRemix = vi.fn();
    const onDismiss = vi.fn();

    act(() =>
      root.render(
        <PresetRecommendation
          presets={matches}
          onUse={onUse}
          onRemix={onRemix}
          onDismiss={onDismiss}
        />,
      ),
    );

    expect(container.textContent).toContain('已有相关资源');
    expect(container.textContent).toContain('小学数学3年级课例包');
    expect(container.textContent).toContain('提问链分析');

    const useButtons = [
      ...container.querySelectorAll<HTMLButtonElement>('button'),
    ].filter((button) => button.textContent?.includes('用这个'));
    act(() => useButtons[1].click());
    expect(onUse).toHaveBeenCalledWith(matches[1].preset);

    const remixButton = [
      ...container.querySelectorAll<HTMLButtonElement>('button'),
    ].find((button) => button.textContent?.includes('基于这个改'))!;
    act(() => remixButton.click());
    expect(onRemix).toHaveBeenCalledWith(matches[0].preset);

    act(() =>
      container
        .querySelector<HTMLButtonElement>('.preset-recommendation-dismiss')!
        .click(),
    );
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when no preset matches', () => {
    act(() =>
      root.render(
        <PresetRecommendation
          presets={[]}
          onUse={vi.fn()}
          onRemix={vi.fn()}
          onDismiss={vi.fn()}
        />,
      ),
    );
    expect(container.innerHTML).toBe('');
  });
});
