import { describe, expect, it, vi } from 'vitest';
import { createSkillStreamBuffer } from './skill-stream-buffer';

describe('Skill stream frame buffer', () => {
  it('merges both channels into one scheduled flush', () => {
    const callbacks = new Map<number, () => void>();
    const schedule = vi.fn((callback: () => void) => {
      callbacks.set(1, callback);
      return 1;
    });
    const cancel = vi.fn();
    const flush = vi.fn();
    const buffer = createSkillStreamBuffer(flush, schedule, cancel);

    buffer.append('reasoning', '先');
    buffer.append('reasoning', '分析');
    buffer.append('content', '答');
    buffer.append('content', '案');

    expect(schedule).toHaveBeenCalledTimes(1);
    callbacks.get(1)?.();
    expect(flush).toHaveBeenCalledWith({ reasoning: '先分析', content: '答案' });
  });

  it('flushes synchronously before completion and ignores work after disposal', () => {
    let callback: (() => void) | undefined;
    const flush = vi.fn();
    const cancel = vi.fn();
    const buffer = createSkillStreamBuffer(
      flush,
      (next) => {
        callback = next;
        return 7;
      },
      cancel,
    );

    buffer.append('reasoning', '保留');
    buffer.flushNow();
    expect(cancel).toHaveBeenCalledWith(7);
    expect(flush).toHaveBeenCalledWith({ reasoning: '保留', content: '' });

    buffer.append('content', '丢弃');
    buffer.dispose();
    callback?.();
    buffer.append('content', '仍然丢弃');
    expect(flush).toHaveBeenCalledTimes(1);
  });
});
