// @vitest-environment jsdom

import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useConversationAutoScroll } from './use-conversation-auto-scroll';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function Probe({ changeKey }: { changeKey: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useConversationAutoScroll(ref, changeKey);
  return <div ref={ref} data-testid="conversation" />;
}

let container: HTMLDivElement;
let root: Root;
let nextFrame: FrameRequestCallback | null;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  nextFrame = null;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    nextFrame = callback;
    return 17;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

it('smoothly follows the latest content after the conversation changes', async () => {
  await act(async () => root.render(<Probe changeKey="first" />));
  const viewport = container.querySelector<HTMLDivElement>(
    '[data-testid="conversation"]',
  )!;
  const scrollTo = vi.fn();
  Object.defineProperty(viewport, 'scrollHeight', {
    configurable: true,
    value: 720,
  });
  viewport.scrollTo = scrollTo;

  await act(async () => nextFrame?.(0));
  expect(scrollTo).toHaveBeenLastCalledWith({
    top: 720,
    behavior: 'smooth',
  });

  scrollTo.mockClear();
  await act(async () => root.render(<Probe changeKey="streaming-update" />));
  await act(async () => nextFrame?.(16));
  expect(scrollTo).toHaveBeenLastCalledWith({
    top: 720,
    behavior: 'smooth',
  });
});

it('cancels a stale scheduled scroll when newer content arrives', async () => {
  await act(async () => root.render(<Probe changeKey="first" />));
  await act(async () => root.render(<Probe changeKey="second" />));

  expect(window.cancelAnimationFrame).toHaveBeenCalledWith(17);
});
