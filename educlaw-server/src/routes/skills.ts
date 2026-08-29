import { Router } from 'express';
import type { AuthedRequest } from '../types.js';
import { requireAuth } from '../middleware/auth.js';
import {
  batchDeleteSkills,
  listRepositorySkills,
  SkillVersionError,
} from '../services/skill-version-service.js';

const router: import('express').Router = Router();

function parseSkillIds(body: unknown): string[] {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new SkillVersionError(
      'INVALID_ARGUMENT',
      'Request body must be an object',
      400,
    );
  }
  const record = body as Record<string, unknown>;
  const unknownKeys = Object.keys(record).filter((key) => key !== 'skillIds');
  if (unknownKeys.length > 0) {
    throw new SkillVersionError(
      'INVALID_ARGUMENT',
      `Request contains unknown fields: ${unknownKeys.join(', ')}`,
      400,
    );
  }
  if (
    !Array.isArray(record.skillIds)
    || record.skillIds.some(
      (value) => typeof value !== 'string' || !/^[1-9]\d*$/.test(value),
    )
  ) {
    throw new SkillVersionError(
      'INVALID_ARGUMENT',
      'skillIds must contain between 1 and 100 positive integer strings',
      400,
    );
  }
  const skillIds = [...new Set(record.skillIds as string[])];
  if (skillIds.length === 0 || skillIds.length > 100) {
    throw new SkillVersionError(
      'INVALID_ARGUMENT',
      'skillIds must contain between 1 and 100 positive integer strings',
      400,
    );
  }
  return skillIds;
}

function parseRepositoryQuery(query: Record<string, unknown>) {
  const unknownKeys = Object.keys(query).filter(
    (key) => key !== 'cursor' && key !== 'limit',
  );
  if (unknownKeys.length > 0) {
    throw new SkillVersionError(
      'INVALID_ARGUMENT',
      `Query contains unknown fields: ${unknownKeys.join(', ')}`,
      422,
    );
  }

  const cursor = query.cursor;
  if (
    cursor !== undefined
    && (typeof cursor !== 'string' || cursor.length === 0 || cursor.length > 2048)
  ) {
    throw new SkillVersionError(
      'INVALID_ARGUMENT',
      'cursor must be a non-empty opaque string',
      422,
    );
  }

  const rawLimit = query.limit;
  if (
    rawLimit !== undefined
    && (typeof rawLimit !== 'string' || !/^[1-9]\d*$/.test(rawLimit))
  ) {
    throw new SkillVersionError(
      'INVALID_ARGUMENT',
      'limit must be an integer between 1 and 100',
      422,
    );
  }
  const limit = rawLimit === undefined ? 100 : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new SkillVersionError(
      'INVALID_ARGUMENT',
      'limit must be an integer between 1 and 100',
      422,
    );
  }

  return { cursor: cursor as string | undefined, limit };
}

function errorResponse(
  error: unknown,
  fallback = { code: 'SKILL_DELETE_FAILED', message: 'Skill deletion failed' },
) {
  if (error instanceof SkillVersionError) {
    return {
      status: error.status,
      body: { code: error.code, error: error.message },
    };
  }
  const databaseCode = error instanceof Error
    ? (error as Error & { code?: unknown }).code
    : undefined;
  if (databaseCode === '40P01' || databaseCode === '40001') {
    return {
      status: 409,
      body: {
        code: 'SKILL_DELETE_CONFLICT',
        error: 'Skill has changed. Refresh before retrying.',
      },
    };
  }
  if (
    error instanceof Error
    && typeof (error as Error & { code?: unknown }).code === 'string'
    && typeof (error as Error & { status?: unknown }).status === 'number'
  ) {
    const typed = error as Error & { code: string; status: number };
    return {
      status: typed.status,
      body: { code: typed.code, error: typed.message },
    };
  }
  return {
    status: 500,
    body: { code: fallback.code, error: fallback.message },
  };
}

router.get('/skills/repository', requireAuth, async (req, res) => {
  try {
    const query = parseRepositoryQuery(req.query as Record<string, unknown>);
    res.json(await listRepositorySkills({
      authUserId: (req as AuthedRequest).userId || '',
      ...query,
    }));
  } catch (error) {
    const response = errorResponse(error, {
      code: 'SKILL_REPOSITORY_LOAD_FAILED',
      message: 'Skill repository loading failed',
    });
    res.status(response.status).json(response.body);
  }
});

router.post('/skills/batch-delete', requireAuth, async (req, res) => {
  try {
    const skillIds = parseSkillIds(req.body as unknown);
    res.json(await batchDeleteSkills({
      authUserId: (req as AuthedRequest).userId || '',
      skillIds,
    }));
  } catch (error) {
    const response = errorResponse(error);
    res.status(response.status).json(response.body);
  }
});

export default router;
