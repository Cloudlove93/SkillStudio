import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

import {
  type InternalWorkerConfig,
  readInternalWorkerConfig,
} from '../config/internal-worker-config.js';

const INTERNAL_MEDIA_JOB_ACTIONS = [
  'internal.mediaJob.claim',
  'internal.mediaJob.refreshGrants',
  'internal.mediaJob.heartbeat',
  'internal.mediaJob.complete',
  'internal.mediaJob.fail',
] as const;

export type InternalMediaJobAction =
  (typeof INTERNAL_MEDIA_JOB_ACTIONS)[number];

export function isInternalMediaJobAction(
  action: unknown,
): action is InternalMediaJobAction {
  return (
    typeof action === 'string' &&
    (INTERNAL_MEDIA_JOB_ACTIONS as readonly string[]).includes(action)
  );
}

function firstHeaderValue(
  value: string | string[] | undefined,
): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const trimmed = item.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  return undefined;
}

function readBearerToken(req: Request): string | null {
  const authorization = firstHeaderValue(req.headers.authorization);
  if (!authorization) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/.exec(authorization);
  if (!match) {
    return null;
  }
  const token = match[1]?.trim();
  return token && token.length > 0 ? token : null;
}

function sha256Buffer(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function matchesWorkerToken(
  token: string | null,
  configuredTokens: readonly string[],
): boolean {
  if (!token || configuredTokens.length === 0) {
    return false;
  }

  const presentedHash = sha256Buffer(token);
  let matched = false;
  for (const configuredToken of configuredTokens) {
    const configuredHash = sha256Buffer(configuredToken);
    matched = timingSafeEqual(presentedHash, configuredHash) || matched;
  }
  return matched;
}

function sendAuthError(
  res: Response,
  status: number,
  code: 'INTERNAL_WORKER_AUTH_REQUIRED' | 'INTERNAL_WORKER_FORBIDDEN',
  message: string,
) {
  res.status(status).json({ code, message });
}

export function createInternalWorkerAuth(
  config: InternalWorkerConfig = readInternalWorkerConfig(),
) {
  function requireInternalWorker(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    const token = readBearerToken(req);
    if (matchesWorkerToken(token, config.tokens)) {
      next();
      return;
    }

    const userIdHeader = firstHeaderValue(req.headers['x-user-id']);
    if (userIdHeader) {
      sendAuthError(
        res,
        403,
        'INTERNAL_WORKER_FORBIDDEN',
        'Internal worker action is forbidden for user-authenticated requests',
      );
      return;
    }

    sendAuthError(
      res,
      401,
      'INTERNAL_WORKER_AUTH_REQUIRED',
      'Internal worker authentication required',
    );
  }

  function rejectWorkerTokenOnUserAction(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    const token = readBearerToken(req);
    if (matchesWorkerToken(token, config.tokens)) {
      sendAuthError(
        res,
        403,
        'INTERNAL_WORKER_FORBIDDEN',
        'Worker tokens cannot be used for user actions',
      );
      return;
    }
    next();
  }

  return {
    requireInternalWorker,
    rejectWorkerTokenOnUserAction,
  };
}
