import type { Server } from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

const listPackageSkillsMock = vi.fn();
const createArenaThreadMock = vi.fn();
const getArenaThreadDetailMock = vi.fn();

async function createApp() {
  vi.resetModules();
  vi.doMock('../services/skill-version-service.js', () => ({
    SkillVersionError: class SkillVersionError extends Error {
      constructor(
        public readonly code: string,
        message: string,
        public readonly status = 400,
      ) {
        super(message);
      }
    },
    listPackageSkills: listPackageSkillsMock,
    listSkillVersions: vi.fn(),
    getSkillVersionDetail: vi.fn(),
    rollbackSkillVersion: vi.fn(),
    discardSkillVersion: vi.fn(),
    undiscardSkillVersion: vi.fn(),
  }));
  vi.doMock('../services/arena-service.js', () => ({
    ArenaServiceError: class ArenaServiceError extends Error {
      constructor(
        message: string,
        public readonly status = 400,
        public readonly code = 'ARENA_ERROR',
      ) {
        super(message);
      }
    },
    createArenaThread: createArenaThreadMock,
    getArenaThreadDetail: getArenaThreadDetailMock,
  }));

  const routes = (await import('./index.js')).default;
  const app = express();
  app.use(express.json());
  app.use('/api', routes);
  return app;
}

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

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('../services/skill-version-service.js');
  vi.doUnmock('../services/arena-service.js');
  listPackageSkillsMock.mockReset();
  createArenaThreadMock.mockReset();
  getArenaThreadDetailMock.mockReset();
});

describe('POST /api action dispatcher', () => {
  it('uses the authenticated user id instead of any request body identity', async () => {
    listPackageSkillsMock.mockResolvedValueOnce([
      { id: '11', skillUid: 'skill-1' },
    ]);
    const { server, url } = await listen(await createApp());

    try {
      const response = await fetch(`${url}/api`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': 'real-user',
        },
        body: JSON.stringify({
          action: 'skill.list',
          pkgId: '1',
          payload: {},
          userId: 'attacker',
          authUserId: 'attacker',
        }),
      });

      expect(response.status).toBe(422);
      expect(listPackageSkillsMock).not.toHaveBeenCalled();
    } finally {
      await close(server);
    }
  });

  it('dispatches known actions through POST /api', async () => {
    listPackageSkillsMock.mockResolvedValueOnce([
      { id: '11', skillUid: 'skill-1' },
    ]);
    const { server, url } = await listen(await createApp());

    try {
      const response = await fetch(`${url}/api`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': 'real-user',
        },
        body: JSON.stringify({
          action: 'skill.list',
          pkgId: '1',
          payload: { includeRemoved: false },
        }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        success: true,
        data: [{ id: '11', skillUid: 'skill-1' }],
      });
      expect(listPackageSkillsMock).toHaveBeenCalledWith({
        authUserId: 'real-user',
        packageId: '1',
        includeRemoved: false,
      });
    } finally {
      await close(server);
    }
  });

  it('creates a skill arena thread through POST /api with authenticated identity', async () => {
    createArenaThreadMock.mockResolvedValueOnce({
      id: 91,
      packageId: 7,
      title: 'Skill Arena Conversation',
      model: 'gpt-5',
      arenaKind: 'skill_arena',
      basePackageVersionId: '33',
      skillArenaConfig: {
        mode: 'skill_arena',
        compositionMode: 'skill_only',
        basePackageVersionId: '33',
        left: {
          side: 'left',
          skillId: '11',
          skillVersionId: '101',
          skillUid: 'skill-a',
          skillName: 'Skill A',
          versionNumber: 1,
        },
        right: {
          side: 'right',
          skillId: '12',
          skillVersionId: '202',
          skillUid: 'skill-b',
          skillName: 'Skill B',
          versionNumber: 2,
        },
      },
      createdAt: '2026-07-24T00:00:00.000Z',
      updatedAt: '2026-07-24T00:00:00.000Z',
      warning: 'Selected versions are identical',
    });
    const { server, url } = await listen(await createApp());

    try {
      const response = await fetch(`${url}/api`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': 'real-user',
        },
        body: JSON.stringify({
          action: 'arena.thread.create',
          pkgId: '7',
          payload: {
            arenaKind: 'skill_arena',
            idempotencyKey: 'arena-key-1',
            basePackageVersionId: '33',
            left: {
              skillId: '11',
              skillVersionId: '101',
            },
            right: {
              skillId: '12',
              skillVersionId: '202',
            },
          },
        }),
      });

      expect(response.status).toBe(200);
      expect(createArenaThreadMock).toHaveBeenCalledWith({
        authUserId: 'real-user',
        packageId: '7',
        arenaKind: 'skill_arena',
        basePackageVersionId: '33',
        idempotencyKey: 'arena-key-1',
        left: {
          skillId: '11',
          skillVersionId: '101',
        },
        right: {
          skillId: '12',
          skillVersionId: '202',
        },
        model: undefined,
      });
    } finally {
      await close(server);
    }
  });

  it('rejects skill arena thread creation without idempotencyKey', async () => {
    const { server, url } = await listen(await createApp());

    try {
      const response = await fetch(`${url}/api`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': 'real-user',
        },
        body: JSON.stringify({
          action: 'arena.thread.create',
          pkgId: '7',
          payload: {
            arenaKind: 'skill_arena',
            basePackageVersionId: '33',
            left: {
              skillId: '11',
              skillVersionId: '101',
            },
            right: {
              skillId: '12',
              skillVersionId: '202',
            },
          },
        }),
      });

      expect(response.status).toBe(422);
      expect(createArenaThreadMock).not.toHaveBeenCalled();
    } finally {
      await close(server);
    }
  });

  it('returns arena thread detail through POST /api', async () => {
    getArenaThreadDetailMock.mockResolvedValueOnce({
      thread: {
        id: 91,
        packageId: 7,
        title: 'Skill Arena Conversation',
        model: null,
        arenaKind: 'skill_arena',
        basePackageVersionId: '33',
        skillArenaConfig: null,
        createdAt: '2026-07-24T00:00:00.000Z',
        updatedAt: '2026-07-24T00:00:00.000Z',
      },
      messages: [],
    });
    const { server, url } = await listen(await createApp());

    try {
      const response = await fetch(`${url}/api`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': 'real-user',
        },
        body: JSON.stringify({
          action: 'arena.thread.detail',
          pkgId: '7',
          payload: {
            threadId: '91',
          },
        }),
      });

      expect(response.status).toBe(200);
      expect(getArenaThreadDetailMock).toHaveBeenCalledWith({
        authUserId: 'real-user',
        packageId: '7',
        threadId: '91',
      });
    } finally {
      await close(server);
    }
  });
});
