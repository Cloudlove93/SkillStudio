import express from 'express';
import { afterEach, expect, it, vi } from 'vitest';
import { reserveArenaThread } from '../services/arena-thread-lifecycle.js';
const query = vi.fn();
vi.mock('../services/db.js', () => ({ query }));
vi.mock('../config.js', () => ({ config: {} }));
vi.mock('../services/package-service.js', () => ({}));
vi.mock('../services/optimization-service.js', () => ({}));
vi.mock('../services/arena-service.js', () => ({}));
afterEach(() => vi.clearAllMocks());
it('legacy delete alias rejects a reserved thread before deleting any messages', async () => {
  const { default: router } = await import('./compat.js');
  const app = express();
  app.use(router);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const release = reserveArenaThread('owner', '91');
  try {
    const response = await fetch(
      `http://127.0.0.1:${(server.address() as { port: number }).port}/arena/chat/sessions/91/delete`,
      { method: 'POST', headers: { 'x-user-id': 'owner' } },
    );
    expect(response.status).toBe(409);
    expect(query).not.toHaveBeenCalled();
  } finally {
    release();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
