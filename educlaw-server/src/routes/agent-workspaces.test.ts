import type { Server } from 'node:http';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = {
  listAgents: vi.fn(),
  getAgent: vi.fn(),
  saveAgent: vi.fn(),
  listAgentConversations: vi.fn(),
  createAgentConversation: vi.fn(),
};
let server: Server;
let url: string;
let WorkspaceError: typeof import('../services/agent-workspace-service.js').AgentWorkspaceError;
const endpoints = [
  ['GET', '/agent-workspaces', 'listAgents'],
  ['POST', '/agent-workspaces', 'saveAgent'],
  ['GET', '/agent-workspaces/12', 'getAgent'],
  ['PUT', '/agent-workspaces/12', 'saveAgent'],
  ['GET', '/agent-workspaces/12/conversations', 'listAgentConversations'],
  ['POST', '/agent-workspaces/12/conversations', 'createAgentConversation'],
] as const;

beforeEach(async () => {
  vi.resetModules();
  Object.values(mocks).forEach((mock) => mock.mockReset());
  // Use the production error class and real gateway requireAuth middleware.
  vi.doMock('../services/db.js', () => ({
    query: vi.fn(),
    withTransaction: vi.fn(),
  }));
  vi.doMock('../services/arena-service.js', () => ({
    getThreadDetail: vi.fn(),
  }));
  vi.doMock('../services/agent-workspace-service.js', async () => {
    const actual = await vi.importActual<
      typeof import('../services/agent-workspace-service.js')
    >('../services/agent-workspace-service.js');
    WorkspaceError = actual.AgentWorkspaceError;
    return { ...actual, ...mocks };
  });
  const router = (await import('./agent-workspaces.js')).default;
  const app = express();
  app.use(express.json());
  app.use('/api', router);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Expected TCP address');
  url = `http://127.0.0.1:${address.port}/api`;
});

afterEach(async () => {
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  vi.doUnmock('../services/agent-workspace-service.js');
  vi.doUnmock('../services/db.js');
  vi.doUnmock('../services/arena-service.js');
  vi.resetModules();
});

describe('Agent workspace gateway routes', () => {
  it.each(endpoints)(
    '%s %s requires gateway authentication before dispatch',
    async (method, path) => {
      for (const headers of [
        {},
        { 'X-User-Id': '   ' },
        { Authorization: 'Bearer forged-token' },
      ]) {
        const response = await fetch(url + path, {
          method,
          headers: { 'Content-Type': 'application/json', ...headers },
          ...(method === 'GET'
            ? {}
            : {
                body: JSON.stringify({
                  userId: 'injected',
                  purpose: 'run',
                  requestId: 'id',
                }),
              }),
        });
        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({
          error: 'Authentication required',
        });
      }
      Object.values(mocks).forEach((mock) =>
        expect(mock).not.toHaveBeenCalled(),
      );
    },
  );

  it.each(endpoints)(
    '%s %s dispatches using gateway owner and returns service JSON',
    async (method, path, key) => {
      const body = {
        name: 'Agent',
        expectedUpdatedAt: '2026-11-03T00:00:00.000Z',
        purpose: 'test',
        requestId: 'retry',
        userId: 'body-attacker',
      };
      const result = key.startsWith('list')
        ? [{ id: '12', name: 'Owned' }]
        : { id: '12', name: 'Owned' };
      mocks[key].mockResolvedValueOnce(result);
      const response = await fetch(url + path + '?userId=query-attacker', {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': 'gateway-owner',
          'X-User-Username': 'display-name',
        },
        ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(result);
      const args =
        key === 'listAgents'
          ? ['gateway-owner']
          : key === 'saveAgent'
            ? method === 'POST'
              ? ['gateway-owner', body]
              : ['gateway-owner', body, '12']
            : key === 'createAgentConversation'
              ? ['gateway-owner', '12', body]
              : ['gateway-owner', '12'];
      expect(mocks[key]).toHaveBeenCalledExactlyOnceWith(...args);
    },
  );

  it.each([
    [
      404,
      'AGENT_NOT_FOUND',
      'Agent 不存在',
      'GET',
      '/agent-workspaces/12',
      'getAgent',
    ],
    [
      422,
      'SKILL_UNAVAILABLE',
      'Skill 不可用',
      'POST',
      '/agent-workspaces',
      'saveAgent',
    ],
    [
      409,
      'AGENT_CONFLICT',
      '请重新加载',
      'PUT',
      '/agent-workspaces/12',
      'saveAgent',
    ],
    [
      409,
      'IDEMPOTENCY_CONFLICT',
      '请求标识冲突',
      'POST',
      '/agent-workspaces/12/conversations',
      'createAgentConversation',
    ],
  ] as const)(
    'preserves service status %s and code %s',
    async (status, code, message, method, path, key) => {
      mocks[key].mockRejectedValueOnce(
        new WorkspaceError(message, status, code),
      );
      const response = await fetch(url + path, {
        method,
        headers: { 'X-User-Id': 'owner', 'Content-Type': 'application/json' },
        ...(method === 'GET' ? {} : { body: '{}' }),
      });
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: message, code });
    },
  );

  it('returns a generic 500 without exposing database internals', async () => {
    mocks.listAgentConversations.mockRejectedValueOnce(
      new Error('postgres password=secret SQL detail'),
    );
    const response = await fetch(url + '/agent-workspaces/12/conversations', {
      headers: { 'X-User-Id': 'owner' },
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Agent 操作失败',
      code: 'AGENT_ERROR',
    });
  });
});
