import { Router } from 'express';
import type { AuthedRequest } from '../types.js';
import { requireAuth } from '../middleware/auth.js';
import {
  createInternalWorkerAuth,
  isInternalMediaJobAction,
} from '../middleware/internal-worker-auth.js';
import {
  ArenaServiceError,
  createArenaThread,
  getArenaThreadDetail,
  renameArenaThread,
  deleteArenaThread,
} from '../services/arena-service.js';
import {
  discardSkillVersion,
  getSkillVersionDetail,
  listPackageSkills,
  listSkillVersions,
  renameSkill,
  rollbackPackageVersion,
  rollbackSkillVersion,
  SkillVersionError,
  undiscardSkillVersion,
} from '../services/skill-version-service.js';
import { GuidedCreationError } from '../services/guided-creation-service.js';
import { MultimodalJobServiceError } from '../services/multimodal-job-service.js';
import {
  handleGuidedCreationJsonAction,
  handleGuidedCreationStreamAction,
  isGuidedCreationAction,
  isGuidedCreationStreamAction,
  parseGuidedCreationRequest,
} from './guided-creation-actions.js';
import {
  handleInternalMediaJobAction,
  MediaJobActionError,
} from './media-job-actions.js';

type ApiHandler = (input: {
  body: Record<string, unknown>;
  authUserId: string;
}) => Promise<unknown>;

const router: import('express').Router = Router();
const internalWorkerAuth = createInternalWorkerAuth();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: string[],
  label: string,
) {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (unknown.length > 0) {
    throw new SkillVersionError(
      'INVALID_ARGUMENT',
      `${label} contains unknown fields: ${unknown.join(', ')}`,
      422,
    );
  }
}

function asPositiveId(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new SkillVersionError(
      'INVALID_ARGUMENT',
      `${fieldName} must be a positive integer string`,
      422,
    );
  }
  return value;
}

function optionalBoolean(
  value: unknown,
  fieldName: string,
): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    throw new SkillVersionError(
      'INVALID_ARGUMENT',
      `${fieldName} must be boolean`,
      422,
    );
  }
  return value;
}

function optionalString(
  value: unknown,
  fieldName: string,
  maxLength: number,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new SkillVersionError(
      'INVALID_ARGUMENT',
      `${fieldName} must be a string up to ${maxLength} characters`,
      422,
    );
  }
  return value;
}

function requiredString(
  value: unknown,
  fieldName: string,
  maxLength: number,
): string {
  const text = optionalString(value, fieldName, maxLength)?.trim();
  if (!text) {
    throw new SkillVersionError(
      'INVALID_ARGUMENT',
      `${fieldName} is required`,
      422,
    );
  }
  return text;
}

function optionalLimit(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 100
  ) {
    throw new SkillVersionError(
      'INVALID_ARGUMENT',
      'limit must be an integer from 1 to 100',
      422,
    );
  }
  return value;
}

function optionalArenaSurface(
  value: unknown,
): 'run' | 'test' | 'arena' | 'optimize' | undefined {
  const surface = optionalString(value, 'surface', 20);
  if (surface === undefined) return undefined;
  if (
    surface !== 'run' &&
    surface !== 'test' &&
    surface !== 'arena' &&
    surface !== 'optimize'
  ) {
    throw new SkillVersionError(
      'INVALID_ARGUMENT',
      'surface must be run, test, arena or optimize',
      422,
    );
  }
  return surface;
}

function parseBase(body: unknown, payloadKeys: string[]) {
  if (!isPlainObject(body)) {
    throw new SkillVersionError(
      'INVALID_ARGUMENT',
      'Request body must be an object',
      422,
    );
  }
  rejectUnknownKeys(body, ['action', 'pkgId', 'payload'], 'body');
  const payload = body.payload === undefined ? {} : body.payload;
  if (!isPlainObject(payload)) {
    throw new SkillVersionError(
      'INVALID_ARGUMENT',
      'payload must be an object',
      422,
    );
  }
  rejectUnknownKeys(payload, payloadKeys, 'payload');
  return {
    packageId: asPositiveId(body.pkgId, 'pkgId'),
    payload,
  };
}

function parseVariantSelection(
  value: unknown,
  fieldName: string,
): { skillId: string; skillVersionId: string } | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (!isPlainObject(value)) {
    throw new SkillVersionError(
      'INVALID_ARGUMENT',
      `${fieldName} must be an object`,
      422,
    );
  }
  rejectUnknownKeys(value, ['skillId', 'skillVersionId'], fieldName);
  return {
    skillId: asPositiveId(value.skillId, `${fieldName}.skillId`),
    skillVersionId: asPositiveId(
      value.skillVersionId,
      `${fieldName}.skillVersionId`,
    ),
  };
}

const actionMap = new Map<string, ApiHandler>([
  [
    'arena.thread.create',
    async ({ body, authUserId }) => {
      const parsed = parseBase(body, [
        'arenaKind',
        'idempotencyKey',
        'basePackageVersionId',
        'left',
        'right',
        'model',
        'surface',
      ]);
      const arenaKind = optionalString(
        parsed.payload.arenaKind,
        'arenaKind',
        40,
      );
      if (arenaKind !== undefined && arenaKind !== 'skill_arena') {
        throw new SkillVersionError(
          'INVALID_ARGUMENT',
          'arenaKind must be skill_arena when provided',
          422,
        );
      }
      return createArenaThread({
        authUserId,
        packageId: parsed.packageId,
        arenaKind: 'skill_arena',
        idempotencyKey: requiredString(
          parsed.payload.idempotencyKey,
          'idempotencyKey',
          120,
        ),
        basePackageVersionId: asPositiveId(
          parsed.payload.basePackageVersionId,
          'basePackageVersionId',
        ),
        left: parseVariantSelection(parsed.payload.left, 'left'),
        right: parseVariantSelection(parsed.payload.right, 'right'),
        model: optionalString(parsed.payload.model, 'model', 120),
        surface: optionalArenaSurface(parsed.payload.surface),
      });
    },
  ],
  [
    'arena.thread.detail',
    async ({ body, authUserId }) => {
      const parsed = parseBase(body, ['threadId']);
      return getArenaThreadDetail({
        authUserId,
        packageId: parsed.packageId,
        threadId: asPositiveId(parsed.payload.threadId, 'threadId'),
      });
    },
  ],
  [
    'arena.thread.rename',
    async ({ body, authUserId }) => {
      const parsed = parseBase(body, ['threadId', 'title']);
      return renameArenaThread({
        authUserId,
        packageId: parsed.packageId,
        threadId: asPositiveId(parsed.payload.threadId, 'threadId'),
        title: requiredString(parsed.payload.title, 'title', 120),
      });
    },
  ],
  [
    'arena.thread.delete',
    async ({ body, authUserId }) => {
      const parsed = parseBase(body, ['threadId']);
      return deleteArenaThread({
        authUserId,
        packageId: parsed.packageId,
        threadId: asPositiveId(parsed.payload.threadId, 'threadId'),
      });
    },
  ],
  [
    'skill.list',
    async ({ body, authUserId }) => {
      const parsed = parseBase(body, ['includeRemoved']);
      return listPackageSkills({
        authUserId,
        packageId: parsed.packageId,
        includeRemoved: optionalBoolean(
          parsed.payload.includeRemoved,
          'includeRemoved',
        ),
      });
    },
  ],
  [
    'skill.rename',
    async ({ body, authUserId }) => {
      const parsed = parseBase(body, ['skillId', 'displayName']);
      return renameSkill({
        authUserId,
        packageId: parsed.packageId,
        skillId: asPositiveId(parsed.payload.skillId, 'skillId'),
        displayName: requiredString(
          parsed.payload.displayName,
          'displayName',
          80,
        ),
      });
    },
  ],
  [
    'skill.version.list',
    async ({ body, authUserId }) => {
      const parsed = parseBase(body, [
        'skillId',
        'includeDiscarded',
        'cursor',
        'limit',
      ]);
      return listSkillVersions({
        authUserId,
        packageId: parsed.packageId,
        skillId: asPositiveId(parsed.payload.skillId, 'skillId'),
        includeDiscarded: optionalBoolean(
          parsed.payload.includeDiscarded,
          'includeDiscarded',
        ),
        cursor: optionalString(parsed.payload.cursor, 'cursor', 40),
        limit: optionalLimit(parsed.payload.limit),
      });
    },
  ],
  [
    'skill.version.detail',
    async ({ body, authUserId }) => {
      const parsed = parseBase(body, ['versionId']);
      return getSkillVersionDetail({
        authUserId,
        packageId: parsed.packageId,
        versionId: asPositiveId(parsed.payload.versionId, 'versionId'),
      });
    },
  ],
  [
    'skill.version.rollback',
    async ({ body, authUserId }) => {
      const parsed = parseBase(body, [
        'skillId',
        'versionId',
        'expectedPackageVersionId',
        'idempotencyKey',
        'note',
      ]);
      return rollbackSkillVersion({
        authUserId,
        packageId: parsed.packageId,
        skillId: asPositiveId(parsed.payload.skillId, 'skillId'),
        versionId: asPositiveId(parsed.payload.versionId, 'versionId'),
        expectedPackageVersionId: asPositiveId(
          parsed.payload.expectedPackageVersionId,
          'expectedPackageVersionId',
        ),
        idempotencyKey: requiredString(
          parsed.payload.idempotencyKey,
          'idempotencyKey',
          120,
        ),
        note: optionalString(parsed.payload.note, 'note', 500),
      });
    },
  ],
  [
    'package.version.rollback',
    async ({ body, authUserId }) => {
      const parsed = parseBase(body, [
        'versionId',
        'expectedPackageVersionId',
        'idempotencyKey',
        'note',
      ]);
      return rollbackPackageVersion({
        authUserId,
        packageId: parsed.packageId,
        versionId: asPositiveId(parsed.payload.versionId, 'versionId'),
        expectedPackageVersionId: asPositiveId(
          parsed.payload.expectedPackageVersionId,
          'expectedPackageVersionId',
        ),
        idempotencyKey: requiredString(
          parsed.payload.idempotencyKey,
          'idempotencyKey',
          120,
        ),
        note: optionalString(parsed.payload.note, 'note', 500),
      });
    },
  ],
  [
    'skill.version.discard',
    async ({ body, authUserId }) => {
      const parsed = parseBase(body, ['versionId', 'reason']);
      return discardSkillVersion({
        authUserId,
        packageId: parsed.packageId,
        versionId: asPositiveId(parsed.payload.versionId, 'versionId'),
        reason: requiredString(parsed.payload.reason, 'reason', 500),
      });
    },
  ],
  [
    'skill.version.undiscard',
    async ({ body, authUserId }) => {
      const parsed = parseBase(body, ['versionId']);
      return undiscardSkillVersion({
        authUserId,
        packageId: parsed.packageId,
        versionId: asPositiveId(parsed.payload.versionId, 'versionId'),
      });
    },
  ],
]);

router.post(
  '/',
  (req, res, next) => {
    const body = req.body as unknown;
    const action =
      isPlainObject(body) && typeof body.action === 'string'
        ? body.action
        : undefined;

    if (isInternalMediaJobAction(action)) {
      return internalWorkerAuth.requireInternalWorker(req, res, next);
    }

    return internalWorkerAuth.rejectWorkerTokenOnUserAction(
      req,
      res,
      (error) => {
        if (error) {
          next(error);
          return;
        }
        requireAuth(req as AuthedRequest, res, next);
      },
    );
  },
  async (req, res, next) => {
    try {
      const body = req.body as unknown;
      if (!isPlainObject(body) || typeof body.action !== 'string') {
        res
          .status(400)
          .json({ code: 'UNKNOWN_ACTION', message: 'Unknown action' });
        return;
      }
      if (isInternalMediaJobAction(body.action)) {
        const data = await handleInternalMediaJobAction(body);
        res.json({ success: true, data });
        return;
      }
      if (isGuidedCreationAction(body.action)) {
        const request = parseGuidedCreationRequest(body);
        const authUserId = (req as AuthedRequest).userId || '';
        if (isGuidedCreationStreamAction(request.action)) {
          await handleGuidedCreationStreamAction({
            auth_user_id: authUserId,
            request,
            response: res,
          });
          return;
        }
        const data = await handleGuidedCreationJsonAction({
          auth_user_id: authUserId,
          request,
        });
        res.json({ success: true, data });
        return;
      }
      const handler = actionMap.get(body.action);
      if (!handler) {
        res
          .status(400)
          .json({ code: 'UNKNOWN_ACTION', message: 'Unknown action' });
        return;
      }
      const data = await handler({
        body,
        authUserId: (req as AuthedRequest).userId || '',
      });
      res.json({ success: true, data });
    } catch (error) {
      if (error instanceof GuidedCreationError) {
        res.status(error.statusCode).json({
          code: error.code,
          message: error.message,
          retryable: error.retryable,
        });
        return;
      }
      if (error instanceof MultimodalJobServiceError) {
        res.status(error.status).json({
          code: error.code,
          message: error.message,
          retryable: error.retryable,
        });
        return;
      }
      if (error instanceof MediaJobActionError) {
        res.status(error.status).json({
          code: error.code,
          message: error.message,
          ...(error.details || {}),
        });
        return;
      }
      if (error instanceof SkillVersionError) {
        res.status(error.status).json({
          code: error.code,
          message: error.message,
          ...(error.details || {}),
        });
        return;
      }
      if (error instanceof ArenaServiceError) {
        res.status(error.status).json({
          code: error.code,
          message: error.message,
          ...(error.details || {}),
        });
        return;
      }
      next(error);
    }
  },
);

export default router;
