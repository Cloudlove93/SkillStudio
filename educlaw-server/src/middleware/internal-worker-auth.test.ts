import type { Server } from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';

import { readInternalWorkerConfig } from '../config/internal-worker-config.js';
import { requireAuth, type GatewayAuthedRequest } from './auth.js';
import {
  createInternalWorkerAuth,
  isInternalMediaJobAction,
} from './internal-worker-auth.js';

async function listen(
  app: express.Express,
): Promise<{ server: Server; url: string }> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => {
    server.once('listening', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server to listen on a TCP port');
  }
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function close(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function createApp(tokens: string[]) {
  const app = express();
  app.use(express.json());
  const workerAuth = createInternalWorkerAuth({ tokens });

  app.post('/api', (req, res, next) => {
    const action =
      req.body &&
      typeof req.body === 'object' &&
      typeof req.body.action === 'string'
        ? req.body.action
        : undefined;

    if (isInternalMediaJobAction(action)) {
      return workerAuth.requireInternalWorker(req, res, next);
    }

    return workerAuth.rejectWorkerTokenOnUserAction(req, res, (error) => {
      if (error) {
        next(error);
        return;
      }
      requireAuth(req as GatewayAuthedRequest, res, next);
    });
  });

  app.post('/api', (req, res) => {
    const gatewayReq = req as GatewayAuthedRequest;
    res.json({
      ok: true,
      userId: gatewayReq.userId ?? null,
    });
  });

  return app;
}

afterEach(() => {
  delete process.env.INTERNAL_WORKER_TOKENS;
});

describe('internal worker auth', () => {
  it('parses comma-separated worker tokens with trim and empty-entry removal', () => {
    expect(
      readInternalWorkerConfig({
        INTERNAL_WORKER_TOKENS: ' worker-a , ,worker-b,  ',
      } as NodeJS.ProcessEnv),
    ).toEqual({
      tokens: ['worker-a', 'worker-b'],
    });
  });

  it('classifies only the exact internal media job actions', () => {
    expect(isInternalMediaJobAction('internal.mediaJob.claim')).toBe(true);
    expect(isInternalMediaJobAction('internal.mediaJob.refreshGrants')).toBe(true);
    expect(isInternalMediaJobAction('internal.mediaJob.heartbeat')).toBe(true);
    expect(isInternalMediaJobAction('internal.mediaJob.complete')).toBe(true);
    expect(isInternalMediaJobAction('internal.mediaJob.fail')).toBe(true);
    expect(isInternalMediaJobAction('internal.mediaJob.claimNow')).toBe(false);
    expect(isInternalMediaJobAction('internal.mediajob.claim')).toBe(false);
    expect(isInternalMediaJobAction('skill.list')).toBe(false);
  });

  it('returns 401 for an internal action without a valid worker token', async () => {
    const { server, url } = await listen(createApp(['worker-secret']));

    try {
      const response = await fetch(`${url}/api`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'internal.mediaJob.claim',
          payload: {
            workerIdentity: 'worker-a',
            acceptedJobTypes: ['transcribe'],
          },
        }),
      });

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.code).toBe('INTERNAL_WORKER_AUTH_REQUIRED');
      expect(JSON.stringify(body)).not.toContain('worker-secret');
    } finally {
      await close(server);
    }
  });

  it('returns 401 for an internal action when the worker token configuration is empty', async () => {
    const { server, url } = await listen(createApp([]));

    try {
      const response = await fetch(`${url}/api`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer any-bearer',
        },
        body: JSON.stringify({
          action: 'internal.mediaJob.claim',
          payload: {
            workerIdentity: 'worker-a',
            acceptedJobTypes: ['transcribe'],
          },
        }),
      });

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        code: 'INTERNAL_WORKER_AUTH_REQUIRED',
      });
    } finally {
      await close(server);
    }
  });

  it('returns 403 for an internal action sent by a Kong-authenticated user without a valid worker token', async () => {
    const { server, url } = await listen(createApp(['worker-secret']));

    try {
      const response = await fetch(`${url}/api`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': 'user-1',
        },
        body: JSON.stringify({
          action: 'internal.mediaJob.claim',
          payload: {
            workerIdentity: 'worker-a',
            acceptedJobTypes: ['transcribe'],
          },
        }),
      });

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        code: 'INTERNAL_WORKER_FORBIDDEN',
      });
    } finally {
      await close(server);
    }
  });

  it('accepts a valid worker token for an internal action without X-User-Id', async () => {
    const { server, url } = await listen(
      createApp(['worker-secret', 'rotated-secret']),
    );

    try {
      const response = await fetch(`${url}/api`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer rotated-secret',
        },
        body: JSON.stringify({
          action: 'internal.mediaJob.claim',
          payload: {
            workerIdentity: 'worker-a',
            acceptedJobTypes: ['transcribe'],
          },
        }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        ok: true,
        userId: null,
      });
    } finally {
      await close(server);
    }
  });

  it('returns 403 when a worker token is used against a user action even if X-User-Id is present', async () => {
    const { server, url } = await listen(createApp(['worker-secret']));

    try {
      const response = await fetch(`${url}/api`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': 'user-1',
          Authorization: 'Bearer worker-secret',
        },
        body: JSON.stringify({
          action: 'skill.list',
          pkgId: '1',
          payload: {},
        }),
      });

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        code: 'INTERNAL_WORKER_FORBIDDEN',
      });
    } finally {
      await close(server);
    }
  });

  it('does not block a normal bearer token on a user action when Kong headers are present', async () => {
    const { server, url } = await listen(createApp(['worker-secret']));

    try {
      const response = await fetch(`${url}/api`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': 'user-1',
          Authorization: 'Bearer ordinary-user-bearer',
        },
        body: JSON.stringify({
          action: 'skill.list',
          pkgId: '1',
          payload: {},
        }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        ok: true,
        userId: 'user-1',
      });
    } finally {
      await close(server);
    }
  });
});
