import { useEffect, useRef, type RefObject } from 'react';

function scrollToLatest(container: HTMLElement) {
  const top = container.scrollHeight;
  if (typeof container.scrollTo === 'function') {
    container.scrollTo({ top, behavior: 'smooth' });
    return;
  }
  container.scrollTop = top;
}

const FOLLOW_THRESHOLD_PX = 72;

function isNearLatest(container: HTMLElement) {
  return (
    container.scrollHeight - container.scrollTop - container.clientHeight <=
    FOLLOW_THRESHOLD_PX
  );
}

/** Follows appended content while the user remains near the conversation bottom. */
export function useConversationAutoScroll<T extends HTMLElement>(
  containerRef: RefObject<T | null>,
  changeKey: string,
  scopeKey?: string,
) {
  const followLatestRef = useRef(true);

  useEffect(() => {
    followLatestRef.current = true;
  }, [scopeKey]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const handleScroll = () => {
      followLatestRef.current = isNearLatest(container);
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [containerRef]);

  useEffect(() => {
    if (!containerRef.current || !followLatestRef.current) return undefined;

    const update = () => {
      const container = containerRef.current;
      if (container && followLatestRef.current) scrollToLatest(container);
    };

    if (typeof window.requestAnimationFrame !== 'function') {
      const timeout = window.setTimeout(update, 0);
      return () => window.clearTimeout(timeout);
    }

    const frame = window.requestAnimationFrame(update);
    return () => window.cancelAnimationFrame(frame);
  }, [changeKey, containerRef]);
}

