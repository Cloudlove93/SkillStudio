import { describe, expect, it } from 'vitest';
import {
  createPendingGuidedMessage,
  shouldDisplayPendingGuidedMessage,
} from './guided-optimistic-message';

describe('guided creation optimistic message', () => {
  it('shows a sent user message before the server session returns', () => {
    const pending = createPendingGuidedMessage(
      '我想做一个浮力实验 Skill',
      'message-1000',
      null,
    );

    expect(shouldDisplayPendingGuidedMessage(pending, null, [])).toBe(true);
    expect(pending.content).toBe('我想做一个浮力实验 Skill');
  });

  it('hides the optimistic copy after the persisted message arrives', () => {
    const pending = createPendingGuidedMessage(
      '准确，继续',
      'message-1001',
      'session-1',
    );

    expect(shouldDisplayPendingGuidedMessage(pending, 'session-1', [
      { client_message_id: 'message-1001' },
    ])).toBe(false);
  });

  it('does not leak a pending message into another conversation', () => {
    const pending = createPendingGuidedMessage(
      '补充当前会话',
      'message-1002',
      'session-1',
    );

    expect(shouldDisplayPendingGuidedMessage(pending, 'session-2', [])).toBe(false);
  });
});
