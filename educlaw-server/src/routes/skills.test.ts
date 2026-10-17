import type { Server } from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

const batchDeleteSkillsMock = vi.fn();
const exportSkillVersionZipMock = vi.fn();
const listRepositorySkillsMock = vi.fn();

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
    batchDeleteSkills: batchDeleteSkillsMock,
    exportSkillVersionZip: exportSkillVersionZipMock,
    listRepositorySkills: listRepositorySkillsMock,
  }));
  const routes = (await import('./skills.js')).default;
  const app = express();
  app.use(express.json());
  app.use('/api', routes);
  return app;
}

async function listen(app: express.Express) {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected TCP server address');
  }
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function close(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('../services/skill-version-service.js');
  batchDeleteSkillsMock.mockReset();
  exportSkillVersionZipMock.mockReset();
  listRepositorySkillsMock.mockReset();
});

describe('GET /api/skills/:skillId/versions/:versionId/export', () => {
  it('requires authentication before reading a Skill version', async () => {
    const { server, url } = await listen(await createApp());

    try {
      const response = await fetch(
        `${url}/api/skills/12/versions/82/export?packageId=3`,
      );
      expect(response.status).toBe(401);
      expect(exportSkillVersionZipMock).not.toHaveBeenCalled();
    } finally {
      await close(server);
    }
  });

  it('exports an owned fixed Skill version as a ZIP attachment', async () => {
    exportSkillVersionZipMock.mockResolvedValueOnce({
      data: Buffer.from('zip-bytes'),
      fileName: 'math-skill-v2.zip',
      versionNumber: 2,
    });
    const { server, url } = await listen(await createApp());

    try {
      const response = await fetch(
        `${url}/api/skills/12/versions/82/export?packageId=3`,
        { headers: { 'X-User-Id': 'real-user' } },
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/zip');
      expect(response.headers.get('content-disposition')).toContain(
        'math-skill-v2.zip',
      );
      expect(Buffer.from(await response.arrayBuffer()).toString()).toBe(
        'zip-bytes',
      );
      expect(exportSkillVersionZipMock).toHaveBeenCalledWith({
        authUserId: 'real-user',
        packageId: '3',
        skillId: '12',
        versionId: '82',
      });
    } finally {
      await close(server);
    }
  });

  it('rejects malformed identifiers and an injected owner identity', async () => {
    const { server, url } = await listen(await createApp());

    try {
      for (const path of [
        '/api/skills/0/versions/82/export?packageId=3',
        '/api/skills/12/versions/nope/export?packageId=3',
        '/api/skills/12/versions/82/export?packageId=0',
        '/api/skills/12/versions/82/export?packageId=3&userId=attacker',
      ]) {
        const response = await fetch(`${url}${path}`, {
          headers: { 'X-User-Id': 'real-user' },
        });
        expect(response.status).toBe(422);
      }
      expect(exportSkillVersionZipMock).not.toHaveBeenCalled();
    } finally {
      await close(server);
    }
  });

  it('does not leak an unowned version', async () => {
    exportSkillVersionZipMock.mockRejectedValueOnce(
      Object.assign(new Error('Skill version not found'), {
        code: 'SKILL_VERSION_NOT_FOUND',
        status: 404,
      }),
    );
    const { server, url } = await listen(await createApp());

    try {
      const response = await fetch(
        `${url}/api/skills/12/versions/82/export?packageId=3`,
        { headers: { 'X-User-Id': 'other-user' } },
      );
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        code: 'SKILL_VERSION_NOT_FOUND',
        error: 'Skill version not found',
      });
    } finally {
      await close(server);
    }
  });
});

describe('GET /api/skills/repository', () => {
  it('lists an authenticated repository page with an opaque cursor', async () => {
    listRepositorySkillsMock.mockResolvedValueOnce({
      items: [{ id: '11', name: '函数教学' }],
      nextCursor: 'next-page',
    });
    const { server, url } = await listen(await createApp());

    try {
      const response = await fetch(
        `${url}/api/skills/repository?cursor=current-page&limit=25`,
        { headers: { 'X-User-Id': 'real-user' } },
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        items: [{ id: '11', name: '函数教学' }],
        nextCursor: 'next-page',
      });
      expect(listRepositorySkillsMock).toHaveBeenCalledWith({
        authUserId: 'real-user',
        cursor: 'current-page',
        limit: 25,
      });
    } finally {
      await close(server);
    }
  });

  it('rejects malformed, repeated, and unknown query parameters', async () => {
    const { server, url } = await listen(await createApp());

    try {
      for (const query of [
        'limit=0',
        'limit=2.5',
        'limit=101',
        'limit=20&limit=30',
        'cursor=',
        'cursor=a&cursor=b',
        'userId=attacker',
      ]) {
        const response = await fetch(`${url}/api/skills/repository?${query}`, {
          headers: { 'X-User-Id': 'real-user' },
        });
        expect(response.status).toBe(422);
      }
      expect(listRepositorySkillsMock).not.toHaveBeenCalled();
    } finally {
      await close(server);
    }
  });
});

describe('POST /api/skills/batch-delete', () => {
  it('uses the authenticated identity and returns deleted Skill ids', async () => {
    batchDeleteSkillsMock.mockResolvedValueOnce({
      deletedSkillIds: ['11', '12'],
      deletedCount: 2,
    });
    const { server, url } = await listen(await createApp());

    try {
      const response = await fetch(`${url}/api/skills/batch-delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': 'real-user',
        },
        body: JSON.stringify({ skillIds: ['11', '12'] }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        deletedSkillIds: ['11', '12'],
        deletedCount: 2,
      });
      expect(batchDeleteSkillsMock).toHaveBeenCalledWith({
        authUserId: 'real-user',
        skillIds: ['11', '12'],
      });
    } finally {
      await close(server);
    }
  });

  it('rejects unknown fields instead of trusting a body identity', async () => {
    const { server, url } = await listen(await createApp());

    try {
      const response = await fetch(`${url}/api/skills/batch-delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': 'real-user',
        },
        body: JSON.stringify({ skillIds: ['11'], userId: 'attacker' }),
      });

      expect(response.status).toBe(400);
      expect(batchDeleteSkillsMock).not.toHaveBeenCalled();
    } finally {
      await close(server);
    }
  });

  it('rejects empty, invalid, and oversized Skill id arrays', async () => {
    const { server, url } = await listen(await createApp());

    try {
      for (const skillIds of [
        [],
        ['0'],
        ['11', 12],
        Array.from({ length: 101 }, (_, index) => String(index + 1)),
      ]) {
        const response = await fetch(`${url}/api/skills/batch-delete`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-User-Id': 'real-user',
          },
          body: JSON.stringify({ skillIds }),
        });
        expect(response.status).toBe(400);
      }
      expect(batchDeleteSkillsMock).not.toHaveBeenCalled();
    } finally {
      await close(server);
    }
  });

  it('applies the 100 item limit after de-duplicating Skill ids', async () => {
    batchDeleteSkillsMock.mockResolvedValueOnce({
      deletedSkillIds: ['11'],
      deletedCount: 1,
    });
    const { server, url } = await listen(await createApp());

    try {
      const response = await fetch(`${url}/api/skills/batch-delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': 'real-user',
        },
        body: JSON.stringify({ skillIds: Array.from({ length: 101 }, () => '11') }),
      });

      expect(response.status).toBe(200);
      expect(batchDeleteSkillsMock).toHaveBeenCalledWith({
        authUserId: 'real-user',
        skillIds: ['11'],
      });
    } finally {
      await close(server);
    }
  });

  it('maps an owned-resource lookup failure without leaking internals', async () => {
    batchDeleteSkillsMock.mockRejectedValueOnce(
      Object.assign(new Error('Skill not found'), {
        code: 'SKILL_NOT_FOUND',
        status: 404,
      }),
    );
    const { server, url } = await listen(await createApp());

    try {
      const response = await fetch(`${url}/api/skills/batch-delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': 'real-user',
        },
        body: JSON.stringify({ skillIds: ['11'] }),
      });

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        code: 'SKILL_NOT_FOUND',
        error: 'Skill not found',
      });
    } finally {
      await close(server);
    }
  });

  it('maps transient database concurrency failures to a retryable conflict', async () => {
    batchDeleteSkillsMock.mockRejectedValueOnce(
      Object.assign(new Error('deadlock detected'), { code: '40P01' }),
    );
    const { server, url } = await listen(await createApp());

    try {
      const response = await fetch(`${url}/api/skills/batch-delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': 'real-user',
        },
        body: JSON.stringify({ skillIds: ['11'] }),
      });

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        code: 'SKILL_DELETE_CONFLICT',
        error: 'Skill has changed. Refresh before retrying.',
      });
    } finally {
      await close(server);
    }
  });
});
