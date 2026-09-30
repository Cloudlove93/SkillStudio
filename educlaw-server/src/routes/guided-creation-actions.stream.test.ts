import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';

const mocks = vi.hoisted(() => ({
  events: [] as Array<{ event: string; data: unknown }>,
  startGuidedCreation: vi.fn(),
}));

vi.mock('../services/guided-creation-service.js', () => {
  class GuidedCreationError extends Error {
    constructor(
      readonly code: string,
      message: string,
      readonly statusCode: number,
      readonly retryable = false,
    ) {
      super(message);
    }
  }
  return {
    GuidedCreationError,
    startGuidedCreation: mocks.startGuidedCreation,
    processGuidedCreationMessage: vi.fn(),
    confirmGuidedCreation: vi.fn(),
    listGuidedCreations: vi.fn(),
    getGuidedCreationDetail: vi.fn(),
    cancelGuidedCreation: vi.fn(),
  };
});

vi.mock('../utils/sse.js', () => ({
  initSse: vi.fn(),
  startSseHeartbeat: vi.fn(() => null),
  stopSseHeartbeat: vi.fn(),
  writeSseEvent: vi.fn((_response: Response, event: string, data: unknown) => {
    mocks.events.push({ event, data });
  }),
}));

import { handleGuidedCreationStreamAction } from './guided-creation-actions.js';

describe('guided creation SSE actions', () => {
  beforeEach(() => {
    mocks.events.length = 0;
    vi.clearAllMocks();
  });

  it('streams one assistant turn, confirmation, done and stream_end for Start', async () => {
    const assistant = {
      id: '2', session_id: '1', message_no: 2, client_message_id: null,
      role: 'assistant', content: '请确认内容。', metadata: {}, created_at: new Date().toISOString(),
    };
    const detail = {
      id: '1', status: 'ready_for_confirmation', model: null, documents: [], draft: {},
      field_states: {}, confirmation: { title: 'Skill', sections: [] }, revision_no: 1,
      package_id: null, skill_id: null, skill_version_id: null, error: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(), completed_at: null,
      messages: [assistant],
    };
    mocks.startGuidedCreation.mockResolvedValueOnce(detail);
    const response = { end: vi.fn() } as unknown as Response;

    await handleGuidedCreationStreamAction({
      auth_user_id: 'gateway-user',
      request: {
        action: 'SkillGuidedCreationStart',
        payload: {
          content: '创建课堂活动 Skill',
          client_message_id: 'message-1001',
        },
      },
      response,
    });

    expect(mocks.startGuidedCreation).toHaveBeenCalledWith(expect.objectContaining({
      auth_user_id: 'gateway-user',
    }));
    expect(mocks.events.map((item) => item.event)).toEqual([
      'phase', 'message', 'confirmation', 'done', 'stream_end',
    ]);
    expect(response.end).toHaveBeenCalledOnce();
  });

  it('converts a service failure to an SSE error and always closes the stream', async () => {
    mocks.startGuidedCreation.mockRejectedValueOnce(new Error('offline'));
    const response = { end: vi.fn() } as unknown as Response;

    await handleGuidedCreationStreamAction({
      auth_user_id: 'gateway-user',
      request: {
        action: 'SkillGuidedCreationStart',
        payload: { content: '创建 Skill', client_message_id: 'message-1002' },
      },
      response,
    });

    expect(mocks.events.map((item) => item.event)).toEqual(['phase', 'error', 'stream_end']);
    expect(mocks.events[1]?.data).toMatchObject({
      code: 'GUIDED_REQUEST_FAILED', retryable: true,
    });
    expect(response.end).toHaveBeenCalledOnce();
  });
});
