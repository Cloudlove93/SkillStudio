import type { NextFunction, Request, Response } from 'express';
import { getLogger } from '../logger.js';

const log = getLogger('auth-middleware');

/** Extract userId from Kong injected X-User-Id header */
export function getUserId(req: Request): string | undefined {
  const fromContext = (req as any).userId;
  if (typeof fromContext === 'string' && fromContext.trim().length > 0) {
    return fromContext.trim();
  }
  const forwardedUserId = req.headers['x-user-id'];
  if (typeof forwardedUserId === 'string') {
    const trimmed = forwardedUserId.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (Array.isArray(forwardedUserId)) {
    const first = forwardedUserId.find((item) => typeof item === 'string' && item.trim().length > 0);
    return first?.trim();
  }
  return undefined;
}

/** 中间件：从 Kong 注入的 X-User-* header 中读取用户信息 */
export async function requireOidcUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = getUserId(req);
  if (!userId) {
    log.warn('Missing X-User-Id header (Kong should inject this from JWT)');
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const username = req.headers['x-user-username'];
  (req as any).userId = userId;
  (req as any).username = (typeof username === 'string' && username.trim()) || userId;
  next();
}
