// A synchronous process-local reservation closes start/delete check races.
import type { ArenaThread } from '@educlaw/shared';

export function isSkillRunTestThread(thread: ArenaThread): boolean {
  if (thread.arenaKind !== 'skill_arena') return false;
  const config = thread.skillArenaConfig;
  if (config?.surface)
    return config.surface === 'run' || config.surface === 'test';
  return Boolean(
    config?.left?.skillId &&
    config.left.skillVersionId &&
    config.left.skillId === config.right?.skillId &&
    config.left.skillVersionId === config.right?.skillVersionId,
  );
}
const reservations = new Map<string, symbol>();
export function reserveArenaThread(
  userId: string,
  threadId: string | number,
): () => void {
  const key = JSON.stringify([userId, String(threadId)]);
  if (reservations.has(key))
    throw Object.assign(new Error('Conversation has an active operation'), {
      status: 409,
      code: 'RUN_BUSY',
    });
  const token = Symbol();
  reservations.set(key, token);
  return () => {
    if (reservations.get(key) === token) reservations.delete(key);
  };
}
