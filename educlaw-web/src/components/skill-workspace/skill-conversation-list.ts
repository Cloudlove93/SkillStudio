import type { ArenaThread } from '@educlaw/shared';

/** Returns true for ordinary Run/Test conversations belonging to one Skill. */
export function isSkillConversationThread(thread: ArenaThread, skillId: string): boolean {
  if (thread.arenaKind !== 'skill_arena') return false;
  const config = thread.skillArenaConfig;
  if (!config) return false;
  if (config.surface === 'arena') return false;
  const left = config.left;
  const right = config.right;
  return left.skillId === skillId
    && right.skillId === skillId
    && left.skillVersionId === right.skillVersionId;
}

export function getConversationTitle(prompt: string): string {
  const normalized = prompt.trim().replace(/\s+/g, ' ');
  return (normalized.length > 48 ? normalized.slice(0, 32) : normalized) || '新建对话';
}
