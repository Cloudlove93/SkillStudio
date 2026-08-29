import type { Server } from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

const listThreadsPageMock = vi.fn();

async function createApp() {
  vi.resetModules();
  vi.doMock('../services/arena-service.js', () => ({
    createThread: vi.fn(),
    generateReport: vi.fn(),
    getThreadDetail: vi.fn(),
    listThreads: vi.fn(),
    listThreadsPage: listThreadsPageMock,
    sendMessage: vi.fn(),
    streamMessage: vi.fn(),
  }));
  vi.doMock('../services/answer-skill-optimization-service.js', () => ({
    listAnswerOptimizationSummariesForThread: vi.fn(),
  }));
  const routes = (await import('./arena.js')).default;
  return express().use('/api', routes);
}

async function listen(app: express.Express) {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected port');
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function close(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

afterEach(() => {
  listThreadsPageMock.mockReset();
  vi.resetModules();
  vi.doUnmock('../services/arena-service.js');
  vi.doUnmock('../services/answer-skill-optimization-service.js');
});

describe('GET /api/arena/threads/page', () => {
  it('passes authenticated keyset pagination inputs to the service', async () => {
    listThreadsPageMock.mockResolvedValueOnce({ items: [], nextCursor: null });
    const { server, url } = await listen(await createApp());

    try {
      const response = await fetch(
        `${url}/api/arena/threads/page?packageId=7&skillId=42&cursor=abc&limit=25`,
        { headers: { 'X-User-Id': 'user-1' } },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ items: [], nextCursor: null });
      expect(listThreadsPageMock).toHaveBeenCalledWith({
        userId: 'user-1',
        packageId: '7',
        skillId: '42',
        cursor: 'abc',
        limit: 25,
      });
    } finally {
      await close(server);
    }
  });
});
