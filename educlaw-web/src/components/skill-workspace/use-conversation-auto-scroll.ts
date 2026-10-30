import { useEffect, type RefObject } from 'react';

function scrollToLatest(container: HTMLElement) {
  const top = container.scrollHeight;
  if (typeof container.scrollTo === 'function') {
    container.scrollTo({ top, behavior: 'smooth' });
    return;
  }
  container.scrollTop = top;
}

/** Keeps a conversation viewport following content appended at its bottom. */
export function useConversationAutoScroll<T extends HTMLElement>(
  containerRef: RefObject<T | null>,
  changeKey: string,
) {
  useEffect(() => {
    if (!containerRef.current) return undefined;

    const update = () => {
      const container = containerRef.current;
      if (container) scrollToLatest(container);
    };

    if (typeof window.requestAnimationFrame !== 'function') {
      const timeout = window.setTimeout(update, 0);
      return () => window.clearTimeout(timeout);
    }

    const frame = window.requestAnimationFrame(update);
    return () => window.cancelAnimationFrame(frame);
  }, [changeKey, containerRef]);
}

