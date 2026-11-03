import { beforeEach, expect, it, vi } from 'vitest';
const fetchApi = vi.hoisted(() => vi.fn());
vi.mock('../../api/client', () => ({ apiFetch: fetchApi }));
import { agentsApi, AgentWorkspaceApiError } from '../../api/agents';
beforeEach(() => vi.resetAllMocks());
it('uses explicit bearer token and direct response for list/detail', async () => {
  fetchApi
    .mockResolvedValueOnce(
      new Response(JSON.stringify([{ id: '1' }]), { status: 200 }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'a/b' }), { status: 200 }),
    );
  expect(await agentsApi.list('session-token')).toEqual([{ id: '1' }]);
  expect(await agentsApi.get('session-token', 'a/b')).toEqual({ id: 'a/b' });
  expect(fetchApi).toHaveBeenNthCalledWith(
    2,
    '/api/agent-workspaces/a%2Fb',
    expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: 'Bearer session-token',
      }),
    }),
  );
});
it('sends concurrency timestamp and idempotent test creation payload', async () => {
  fetchApi.mockImplementation(async () => new Response('{}', { status: 200 }));
  const input = {
    name: 'A',
    description: '',
    instructions: '',
    model: '',
    skills: [],
    expectedUpdatedAt: '2026-11-03T00:00:00Z',
  };
  await agentsApi.update('t', '1', input);
  await agentsApi.createConversation('t', '1', {
    purpose: 'test',
    requestId: 'repeatable-key',
  });
  expect(fetchApi).toHaveBeenNthCalledWith(
    1,
    '/api/agent-workspaces/1',
    expect.objectContaining({ method: 'PUT', body: JSON.stringify(input) }),
  );
  expect(fetchApi).toHaveBeenNthCalledWith(
    2,
    '/api/agent-workspaces/1/conversations',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ purpose: 'test', requestId: 'repeatable-key' }),
      headers: expect.objectContaining({ Authorization: 'Bearer t' }),
    }),
  );
});
it('retains HTTP conflict status for the editor to offer reloading', async () => {
  fetchApi.mockResolvedValue(
    new Response(JSON.stringify({ error: 'Agent 配置已更新' }), {
      status: 409,
    }),
  );
  const result = agentsApi.get('t', '1');
  await expect(result).rejects.toBeInstanceOf(AgentWorkspaceApiError);
  await expect(result).rejects.toMatchObject({
    status: 409,
    message: 'Agent 配置已更新',
  });
});
