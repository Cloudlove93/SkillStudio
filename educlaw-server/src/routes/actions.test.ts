import type { Server } from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

class MockMultimodalJobServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly retryable = false,
  ) {
    super(message);
  }
}

const listPackageSkillsMock = vi.fn();
const renameSkillMock = vi.fn();
const createArenaThreadMock = vi.fn();
const getArenaThreadDetailMock = vi.fn();
const deleteArenaThreadMock = vi.fn();
const claimMediaJobMock = vi.fn();
const heartbeatMediaJobMock = vi.fn();
const completeMediaJobMock = vi.fn();
const failMediaJobMock = vi.fn();
const createMultimodalSessionMock = vi.fn();
const listMultimodalSessionsMock = vi.fn();
const getMultimodalSessionDetailMock = vi.fn();
const getMultimodalSessionProgressMock = vi.fn();
const confirmMultimodalOverviewMock = vi.fn();
const confirmMultimodalCandidatesMock = vi.fn();
const createUploadConfirmMock = vi.fn();

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
    renameSkill: renameSkillMock,
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
    deleteArenaThread: deleteArenaThreadMock,
  }));
  vi.doMock('../services/multimodal-job-service.js', () => ({
    MultimodalJobServiceError: MockMultimodalJobServiceError,
    createMultimodalJobService: () => ({
      claimMediaJob: claimMediaJobMock,
      heartbeatMediaJob: heartbeatMediaJobMock,
      completeMediaJob: completeMediaJobMock,
      failMediaJob: failMediaJobMock,
    }),
  }));
  vi.doMock('../services/multimodal-guided-creation-service.js', () => ({
    createMultimodalGuidedCreationService: () => ({
      createSession: createMultimodalSessionMock,
      listSessions: listMultimodalSessionsMock,
      getSessionDetail: getMultimodalSessionDetailMock,
      getSessionProgress: getMultimodalSessionProgressMock,
      confirmOverview: confirmMultimodalOverviewMock,
      confirmCandidates: confirmMultimodalCandidatesMock,
      createUploadConfirm: createUploadConfirmMock,
    }),
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
  vi.doUnmock('../services/multimodal-job-service.js');
  vi.doUnmock('../services/multimodal-guided-creation-service.js');
  listPackageSkillsMock.mockReset();
  renameSkillMock.mockReset();
  createArenaThreadMock.mockReset();
  getArenaThreadDetailMock.mockReset();
  deleteArenaThreadMock.mockReset();
  claimMediaJobMock.mockReset();
  heartbeatMediaJobMock.mockReset();
  completeMediaJobMock.mockReset();
  failMediaJobMock.mockReset();
  createMultimodalSessionMock.mockReset();
  listMultimodalSessionsMock.mockReset();
  getMultimodalSessionDetailMock.mockReset();
  getMultimodalSessionProgressMock.mockReset();
  confirmMultimodalOverviewMock.mockReset();
  confirmMultimodalCandidatesMock.mockReset();
  createUploadConfirmMock.mockReset();
  delete process.env.INTERNAL_WORKER_TOKENS;
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

  it('renames an owned Skill through POST /api with validated input', async () => {
    renameSkillMock.mockResolvedValueOnce({
      id: '11',
      packageId: '7',
      name: '函数概念辨析',
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
          action: 'skill.rename',
          pkgId: '7',
          payload: { skillId: '11', displayName: '函数概念辨析' },
        }),
      });

      expect(response.status).toBe(200);
      expect(renameSkillMock).toHaveBeenCalledWith({
        authUserId: 'real-user',
        packageId: '7',
        skillId: '11',
        displayName: '函数概念辨析',
      });
      expect(await response.json()).toEqual({
        success: true,
        data: { id: '11', packageId: '7', name: '函数概念辨析' },
      });
    } finally {
      await close(server);
    }
  });

  it('rejects unknown fields in Skill rename requests', async () => {
    const { server, url } = await listen(await createApp());

    try {
      const response = await fetch(`${url}/api`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': 'real-user',
        },
        body: JSON.stringify({
          action: 'skill.rename',
          pkgId: '7',
          payload: {
            skillId: '11',
            displayName: '函数概念辨析',
            userId: 'attacker',
          },
        }),
      });

      expect(response.status).toBe(422);
      expect(renameSkillMock).not.toHaveBeenCalled();
    } finally {
      await close(server);
    }
  });

  it('dispatches multimodal media session actions through POST /api with authenticated identity', async () => {
    createMultimodalSessionMock.mockResolvedValueOnce({
      sessionId: '101',
      displayName: '多模态技能包',
      status: 'collecting',
      mediaStage: 'draft',
      revisionNo: 0,
      createdAt: '2026-08-21T10:00:00.000Z',
      updatedAt: '2026-08-21T10:00:00.000Z',
      mediaState: {
        schemaVersion: 1,
        primarySource: null,
        transcript: {
          status: 'pending',
          editable: true,
          segments: [],
        },
        evidenceTimeline: { evidenceItems: [] },
        candidatePasses: {
          frameworks: [],
          principles: [],
          cases: [],
          counterexamples: [],
          terms: [],
        },
      },
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
          action: 'skill.media.session.create',
          idempotencyKey: 'media-create-key-1',
          payload: { displayName: '多模态技能包' },
        }),
      });

      expect(response.status).toBe(200);
      expect(createMultimodalSessionMock).toHaveBeenCalledWith({
        authUserId: 'real-user',
        idempotencyKey: 'media-create-key-1',
        displayName: '多模态技能包',
      });
      expect(await response.json()).toEqual({
        success: true,
        data: expect.objectContaining({
          sessionId: '101',
          mediaStage: 'draft',
        }),
      });
    } finally {
      await close(server);
    }
  });

  it('dispatches multimodal overview confirmation through POST /api with authenticated identity', async () => {
    confirmMultimodalOverviewMock.mockResolvedValueOnce({
      sessionId: '101',
      revisionNo: 1,
      mediaStage: 'extracting_candidates',
      confirmedStage: 'adler_overview',
      replayed: false,
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
          action: 'skill.media.overview.confirm',
          sessionId: '101',
          idempotencyKey: 'overview-confirm-001',
          payload: {
            expectedRevisionNo: 0,
            overview: {
              title: 'Adler Overview',
              approved: true,
              userNotes: '',
            },
          },
        }),
      });

      expect(response.status).toBe(200);
      expect(confirmMultimodalOverviewMock).toHaveBeenCalledWith({
        authUserId: 'real-user',
        sessionId: '101',
        idempotencyKey: 'overview-confirm-001',
        expectedRevisionNo: 0,
        overview: {
          title: 'Adler Overview',
          approved: true,
          userNotes: '',
        },
      });
      expect(await response.json()).toEqual({
        success: true,
        data: {
          sessionId: '101',
          revisionNo: 1,
          mediaStage: 'extracting_candidates',
          confirmedStage: 'adler_overview',
          replayed: false,
        },
      });
    } finally {
      await close(server);
    }
  });

  it('dispatches multimodal candidate confirmation through POST /api with authenticated identity', async () => {
    confirmMultimodalCandidatesMock.mockResolvedValueOnce({
      sessionId: '101',
      revisionNo: 2,
      mediaStage: 'building_skills',
      confirmedStage: 'evidence_and_candidates',
      replayed: false,
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
          action: 'skill.media.candidate.confirm',
          sessionId: '101',
          idempotencyKey: 'candidate-confirm-001',
          payload: {
            expectedRevisionNo: 1,
            selectedCandidateIds: ['candidate-a', 'candidate-b'],
          },
        }),
      });

      expect(response.status).toBe(200);
      expect(confirmMultimodalCandidatesMock).toHaveBeenCalledWith({
        authUserId: 'real-user',
        sessionId: '101',
        idempotencyKey: 'candidate-confirm-001',
        expectedRevisionNo: 1,
        selectedCandidateIds: ['candidate-a', 'candidate-b'],
      });
      expect(await response.json()).toEqual({
        success: true,
        data: {
          sessionId: '101',
          revisionNo: 2,
          mediaStage: 'building_skills',
          confirmedStage: 'evidence_and_candidates',
          replayed: false,
        },
      });
    } finally {
      await close(server);
    }
  });

  it('dispatches multimodal upload confirm through POST /api with authenticated identity', async () => {
    createUploadConfirmMock.mockResolvedValueOnce({
      sessionId: '101',
      revisionNo: 2,
      mediaStage: 'ready_to_process',
      confirmedStage: 'uploading',
      online: true,
      uploadVerification: {
        status: 'ok',
        objectKey: 'skill-sessions/101/source/uuid.mp4',
        sizeBytes: 20 * 1024 * 1024,
        contentType: 'video/mp4',
      },
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
          action: 'skill.media.upload.confirm',
          sessionId: '101',
          idempotencyKey: 'upload-confirm-001',
          payload: {
            uploadToken: 'a.b.c',
            expectedRevisionNo: 1,
          },
        }),
      });

      expect(response.status).toBe(200);
      expect(createUploadConfirmMock).toHaveBeenCalledWith({
        authUserId: 'real-user',
        sessionId: '101',
        idempotencyKey: 'upload-confirm-001',
        uploadToken: 'a.b.c',
        expectedRevisionNo: 1,
        parts: undefined,
      });
      expect(await response.json()).toEqual({
        success: true,
        data: {
          sessionId: '101',
          revisionNo: 2,
          mediaStage: 'ready_to_process',
          confirmedStage: 'uploading',
          online: true,
          uploadVerification: {
            status: 'ok',
            objectKey: 'skill-sessions/101/source/uuid.mp4',
            sizeBytes: 20 * 1024 * 1024,
            contentType: 'video/mp4',
          },
        },
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

  it('deletes an arena conversation through POST /api with the authenticated identity', async () => {
    deleteArenaThreadMock.mockResolvedValueOnce({ ok: true });
    const { server, url } = await listen(await createApp());

    try {
      const response = await fetch(`${url}/api`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': 'real-user',
        },
        body: JSON.stringify({
          action: 'arena.thread.delete',
          pkgId: '7',
          payload: { threadId: '91' },
        }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        success: true,
        data: { ok: true },
      });
      expect(deleteArenaThreadMock).toHaveBeenCalledWith({
        authUserId: 'real-user',
        packageId: '7',
        threadId: '91',
      });
    } finally {
      await close(server);
    }
  });

  it('routes internal worker actions before requireAuth when a valid worker token is present', async () => {
    process.env.INTERNAL_WORKER_TOKENS = 'worker-secret';
    claimMediaJobMock.mockResolvedValueOnce({
      jobId: '77',
      sessionId: '44',
      jobType: 'transcribe',
      attemptNo: 1,
      maxAttempts: 3,
      inputManifest: {},
      progress: {},
      leaseToken: 'lease-token',
      leaseExpiresAt: '2026-08-21T00:01:00.000Z',
    });
    const { server, url } = await listen(await createApp());

    try {
      const response = await fetch(`${url}/api`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer worker-secret',
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
      expect(claimMediaJobMock).toHaveBeenCalledWith({
        workerIdentity: 'worker-a',
        acceptedJobTypes: ['transcribe'],
      });
    } finally {
      await close(server);
    }
  });

  it('rejects internal worker actions from normal Kong-authenticated users without a worker token', async () => {
    process.env.INTERNAL_WORKER_TOKENS = 'worker-secret';
    const { server, url } = await listen(await createApp());

    try {
      const response = await fetch(`${url}/api`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': 'real-user',
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
      expect(claimMediaJobMock).not.toHaveBeenCalled();
    } finally {
      await close(server);
    }
  });

  it('rejects worker tokens on user actions even when Kong headers are present', async () => {
    process.env.INTERNAL_WORKER_TOKENS = 'worker-secret';
    const { server, url } = await listen(await createApp());

    try {
      const response = await fetch(`${url}/api`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': 'real-user',
          Authorization: 'Bearer worker-secret',
        },
        body: JSON.stringify({
          action: 'skill.list',
          pkgId: '1',
          payload: {},
        }),
      });

      expect(response.status).toBe(403);
      expect(listPackageSkillsMock).not.toHaveBeenCalled();
    } finally {
      await close(server);
    }
  });

  it('returns retryable on root internal action errors', async () => {
    process.env.INTERNAL_WORKER_TOKENS = 'worker-secret';
    failMediaJobMock.mockRejectedValueOnce(
      new MockMultimodalJobServiceError(
        'JOB_LEASE_CONFLICT',
        'Lease is no longer valid',
        409,
        false,
      ),
    );
    const { server, url } = await listen(await createApp());

    try {
      const response = await fetch(`${url}/api`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer worker-secret',
        },
        body: JSON.stringify({
          action: 'internal.mediaJob.fail',
          payload: {
            jobId: '77',
            leaseToken: 'lease-token',
            error: {
              code: 'WORKER_FAILED',
              message: 'worker failed',
              retryable: true,
            },
          },
        }),
      });

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        code: 'JOB_LEASE_CONFLICT',
        message: 'Lease is no longer valid',
        retryable: false,
      });
    } finally {
      await close(server);
    }
  });
});
