import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  initSse: vi.fn(),
  startSseHeartbeat: vi.fn(() => ({ heartbeat: true })),
  stopSseHeartbeat: vi.fn(),
  streamProgress: vi.fn(),
}));

vi.mock('../utils/sse.js', async () => {
  const actual = await vi.importActual<typeof import('../utils/sse.js')>(
    '../utils/sse.js',
  );
  return {
    ...actual,
    initSse: mocks.initSse,
    startSseHeartbeat: mocks.startSseHeartbeat,
    stopSseHeartbeat: mocks.stopSseHeartbeat,
  };
});

vi.mock('../services/multimodal-progress-stream-service.js', () => ({
  createMultimodalProgressStreamService: () => ({
    streamProgress: mocks.streamProgress,
  }),
}));

import { handleGuidedCreationStreamAction } from './guided-creation-actions.js';

function createResponse() {
  const listeners = new Map<string, Array<() => void>>();
  const writes: string[] = [];
  return {
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    on: vi.fn((event: string, handler: () => void) => {
      const handlers = listeners.get(event) ?? [];
      handlers.push(handler);
      listeners.set(event, handlers);
      return undefined;
    }),
    write: vi.fn((chunk: string) => {
      writes.push(chunk);
      return true;
    }),
    end: vi.fn(function end() {
      this.writableEnded = true;
    }),
    emitClose() {
      this.destroyed = true;
      for (const handler of listeners.get('close') ?? []) {
        handler();
      }
    },
    getWrites() {
      return writes.slice();
    },
  } as unknown as {
    headersSent: boolean;
    writableEnded: boolean;
    destroyed: boolean;
    on: (event: string, handler: () => void) => void;
    write: (chunk: string) => boolean;
    end: () => void;
    emitClose: () => void;
    getWrites: () => string[];
  };
}

describe('multimodal progress stream route', () => {
  beforeEach(() => {
    mocks.initSse.mockReset();
    mocks.startSseHeartbeat.mockReset();
    mocks.startSseHeartbeat.mockReturnValue({ heartbeat: true });
    mocks.stopSseHeartbeat.mockReset();
    mocks.streamProgress.mockReset();
  });

  it('serializes confirmation stream events as JSON objects without data: undefined', async () => {
    mocks.streamProgress.mockImplementation(async ({ emit }: { emit: (event: string, data: unknown) => Promise<void> }) => {
      await emit('progress', { progress: { sessionId: '101', mediaStage: 'extracting_candidates' } });
      await emit('confirmation', {
        session: { sessionId: '101', mediaStage: 'awaiting_candidates' },
        confirmationStage: 'evidence_and_candidates',
      });
      await emit('stream_end', {});
    });
    const response = createResponse();

    await handleGuidedCreationStreamAction({
      auth_user_id: 'user-1',
      request: {
        action: 'skill.media.progress.stream',
        payload: { sessionId: '101' },
      } as never,
      response: response as never,
    });

    expect(mocks.initSse).toHaveBeenCalledWith(response);
    expect(mocks.startSseHeartbeat).toHaveBeenCalledWith(response, 15_000);
    expect(mocks.streamProgress).toHaveBeenCalledTimes(1);
    expect(mocks.stopSseHeartbeat).toHaveBeenCalledTimes(1);
    expect(response.end).toHaveBeenCalledTimes(1);
    const writes = response.getWrites().join('');
    expect(writes).not.toContain('data: undefined');
    expect(
      JSON.parse(
        writes
          .split('\n\n')
          .find((chunk) => chunk.includes('event: confirmation'))!
          .split('\n')
          .find((line) => line.startsWith('data: '))!
          .slice(6),
      ),
    ).toEqual({
      session: { sessionId: '101', mediaStage: 'awaiting_candidates' },
      confirmationStage: 'evidence_and_candidates',
    });
    expect(
      JSON.parse(
        writes
          .split('\n\n')
          .find((chunk) => chunk.includes('event: stream_end'))!
          .split('\n')
          .find((line) => line.startsWith('data: '))!
          .slice(6),
      ),
    ).toEqual({});
  });

  it('returns a safe SSE error and a single stream_end when the progress service throws', async () => {
    mocks.streamProgress.mockRejectedValueOnce(new Error('secret-owner-and-sql'));
    const response = createResponse();

    await handleGuidedCreationStreamAction({
      auth_user_id: 'user-1',
      request: {
        action: 'skill.media.progress.stream',
        payload: { sessionId: '101' },
      } as never,
      response: response as never,
    });

    expect(response.getWrites().join('')).not.toContain('secret-owner-and-sql');
    expect(mocks.stopSseHeartbeat).toHaveBeenCalledTimes(1);
    expect(response.end).toHaveBeenCalledTimes(1);
  });

  it('serializes terminal and draft stream_end payloads as JSON objects', async () => {
    const terminalResponse = createResponse();
    mocks.streamProgress.mockImplementationOnce(
      async ({ emit }: { emit: (event: string, data: unknown) => Promise<void> }) => {
        await emit('done', {
          session: { sessionId: '101', mediaStage: 'published' },
        });
        await emit('stream_end', {});
      },
    );

    await handleGuidedCreationStreamAction({
      auth_user_id: 'user-1',
      request: {
        action: 'skill.media.progress.stream',
        payload: { sessionId: '101' },
      } as never,
      response: terminalResponse as never,
    });

    expect(
      JSON.parse(
        terminalResponse
          .getWrites()
          .join('')
          .split('\n\n')
          .find((chunk) => chunk.includes('event: stream_end'))!
          .split('\n')
          .find((line) => line.startsWith('data: '))!
          .slice(6),
      ),
    ).toEqual({});

    const draftResponse = createResponse();
    mocks.streamProgress.mockImplementationOnce(
      async ({ emit }: { emit: (event: string, data: unknown) => Promise<void> }) => {
        await emit('progress', {
          progress: { sessionId: '101', mediaStage: 'draft' },
        });
        await emit('stream_end', { reason: 'not_started' });
      },
    );

    await handleGuidedCreationStreamAction({
      auth_user_id: 'user-1',
      request: {
        action: 'skill.media.progress.stream',
        payload: { sessionId: '101' },
      } as never,
      response: draftResponse as never,
    });

    expect(
      JSON.parse(
        draftResponse
          .getWrites()
          .join('')
          .split('\n\n')
          .find((chunk) => chunk.includes('event: stream_end'))!
          .split('\n')
          .find((line) => line.startsWith('data: '))!
          .slice(6),
      ),
    ).toEqual({ reason: 'not_started' });
  });

  it('does not write or end again after the response closes mid-stream', async () => {
    const response = createResponse();
    mocks.streamProgress.mockImplementation(
      async ({ emit }: { emit: (event: string, data: unknown) => Promise<void> }) => {
        await emit('progress', {
          progress: { sessionId: '101', mediaStage: 'awaiting_candidates' },
        });
        response.emitClose();
        await emit('stream_end', {});
      },
    );

    await handleGuidedCreationStreamAction({
      auth_user_id: 'user-1',
      request: {
        action: 'skill.media.progress.stream',
        payload: { sessionId: '101' },
      } as never,
      response: response as never,
    });

    const writes = response.getWrites().join('');
    expect(writes).toContain('event: progress');
    expect(writes).not.toContain('event: stream_end');
    expect(response.end).not.toHaveBeenCalled();
  });
});
