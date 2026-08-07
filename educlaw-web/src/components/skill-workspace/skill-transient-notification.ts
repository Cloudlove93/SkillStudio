import type { SkillPinnedUpdate } from './skill-workspace-state';

export function getSkillNotificationDuration(update: SkillPinnedUpdate): number {
  return update.actionLabel ? 6_000 : 3_500;
}
