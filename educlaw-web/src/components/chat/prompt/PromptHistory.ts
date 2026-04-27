import { useRef } from 'react';

const MAX_HISTORY = 50;

export function usePromptHistory() {
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const savedTextRef = useRef('');

  function push(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const history = historyRef.current;
    if (history[0] !== trimmed) {
      history.unshift(trimmed);
      if (history.length > MAX_HISTORY) history.pop();
    }
    historyIndexRef.current = -1;
    savedTextRef.current = '';
  }

  /** Navigate history from current text. Returns new text or null if no change. */
  function navigate(
    direction: 'up' | 'down',
    currentText: string,
    cursorAtStart: boolean,
    cursorAtEnd: boolean,
  ): string | null {
    const history = historyRef.current;
    if (history.length === 0) return null;

    if (direction === 'up' && cursorAtStart) {
      if (historyIndexRef.current === -1) {
        savedTextRef.current = currentText;
        historyIndexRef.current = 0;
        return history[0];
      } else if (historyIndexRef.current < history.length - 1) {
        historyIndexRef.current++;
        return history[historyIndexRef.current];
      }
    } else if (direction === 'down' && cursorAtEnd) {
      if (historyIndexRef.current > 0) {
        historyIndexRef.current--;
        return history[historyIndexRef.current];
      } else if (historyIndexRef.current === 0) {
        historyIndexRef.current = -1;
        return savedTextRef.current;
      }
    }
    return null;
  }

  return { push, navigate };
}
