import type { Server } from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';

import { config } from '../config.js';
import compatRoutes from './compat.js';

async function listen() {
  const app = express();
  app.use(express.json());
  app.use(compatRoutes);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('TCP expected');
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function close(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

let activeServer: Server | null = null;
afterEach(async () => {
  if (activeServer) await close(activeServer);
  activeServer = null;
});

describe('legacy compatibility routes', () => {
  it('advertises only the configured model instead of invented provider models', async () => {
    const running = await listen();
    activeServer = running.server;
    const response = await fetch(`${running.url}/llm/models`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(
      config.llmModel
        ? [{ name: config.llmModel, modelName: config.llmModel }]
        : [],
    );
  });

  it.each([
    ['POST', '/api/sidebar-groups'],
    ['POST', '/agents'],
    ['PUT', '/agents/agent-1/file-content'],
    ['POST', '/profiles/published/package-1'],
    ['POST', '/arena/skill/skill-1'],
    ['GET', '/arena/runs'],
  ])('returns an explicit retired response for %s %s', async (method, path) => {
    const running = await listen();
    activeServer = running.server;
    const response = await fetch(`${running.url}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': 'user-1',
      },
      body: method === 'GET' ? undefined : '{}',
    });

    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({
      code: 'FEATURE_RETIRED',
    });
  });
});
