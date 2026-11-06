import type { ArenaThread, SkillArenaConfig } from '@educlaw/shared';

/** 会话用途对应的展示标签。 */
export type SkillConversationSurface = NonNullable<SkillArenaConfig['surface']>;

/**
 * 返回会话的用途标签。
 * - 旧数据没有 surface 时，按同版本判定归为 'run'，否则归为 'arena'
 */
export function getConversationSurface(
  thread: ArenaThread,
): SkillConversationSurface | null {
  if (thread.arenaKind !== 'skill_arena' || !thread.skillArenaConfig)
    return null;
  const config = thread.skillArenaConfig;
  if (config.surface) return config.surface;
  const sameVersion =
    !!config.left &&
    !!config.right &&
    config.left.skillVersionId === config.right.skillVersionId;
  return sameVersion ? 'run' : 'arena';
}

/** 会话用途对应的中文短标签，用于列表徽章。 */
export function getSurfaceLabel(
  surface: SkillConversationSurface | null,
): string {
  switch (surface) {
    case 'run':
      return '使用';
    case 'test':
      return '使用';
    case 'optimize':
      return '优化';
    case 'arena':
      return '对比';
    default:
      return '';
  }
}

/** Includes old Run/Test and comparison histories belonging to one Skill. */
export function isSkillConversationThread(
  thread: ArenaThread,
  skillId: string,
): boolean {
  if (thread.arenaKind !== 'skill_arena') return false;
  const config = thread.skillArenaConfig;
  if (!config || config.agentExecution) return false;
  const surface = getConversationSurface(thread);
  if (surface === 'arena')
    return (
      config.left?.skillId === skillId || config.right?.skillId === skillId
    );
  if (surface !== 'run' && surface !== 'test') return false;
  const left = config.left;
  const right = config.right;
  return (
    !!(left || right) &&
    (!left || left.skillId === skillId) &&
    (!right || right.skillId === skillId) &&
    (!left || !right || left.skillVersionId === right.skillVersionId)
  );
}

export function getConversationTitle(prompt: string): string {
  const normalized = prompt.trim().replace(/\s+/g, ' ');
  return (
    (normalized.length > 48 ? normalized.slice(0, 32) : normalized) ||
    '新建对话'
  );
}
