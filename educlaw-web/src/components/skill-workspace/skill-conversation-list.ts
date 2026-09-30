import type { ArenaThread, SkillArenaConfig } from '@educlaw/shared';

/** 会话用途对应的展示标签。 */
export type SkillConversationSurface = NonNullable<SkillArenaConfig['surface']>;

/**
 * 返回会话的用途标签。
 * - 旧数据没有 surface 时，按同版本判定归为 'run'，否则归为 'arena'
 */
export function getConversationSurface(thread: ArenaThread): SkillConversationSurface | null {
  if (thread.arenaKind !== 'skill_arena' || !thread.skillArenaConfig) return null;
  const config = thread.skillArenaConfig;
  if (config.surface) return config.surface;
  const sameVersion = config.left.skillVersionId === config.right.skillVersionId;
  return sameVersion ? 'run' : 'arena';
}

/** 会话用途对应的中文短标签，用于列表徽章。 */
export function getSurfaceLabel(surface: SkillConversationSurface | null): string {
  switch (surface) {
    case 'run':
      return '使用';
    case 'test':
      return '测试';
    case 'optimize':
      return '优化';
    case 'arena':
      return '对比';
    default:
      return '';
  }
}

/** Returns true for ordinary Run/Test conversations belonging to one Skill. */
export function isSkillConversationThread(thread: ArenaThread, skillId: string): boolean {
  if (thread.arenaKind !== 'skill_arena') return false;
  const config = thread.skillArenaConfig;
  if (!config) return false;
  // 仅运行/测试会话进入 Run 列表；对比与交互式优化各自独立，不在该列表展示
  const surface = getConversationSurface(thread);
  if (surface !== 'run' && surface !== 'test') return false;
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
