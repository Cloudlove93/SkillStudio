import type { SkillVersionDetail } from '@educlaw/shared';

export function visibleSkillVersions(
  versions: SkillVersionDetail[],
  includeDiscarded: boolean,
): SkillVersionDetail[] {
  return versions
    .filter((version) => includeDiscarded || version.status !== 'discarded')
    .sort((left, right) => right.versionNumber - left.versionNumber);
}

export function canDiscardSkillVersion(
  version: SkillVersionDetail,
  currentVersionId: string | null,
): boolean {
  return version.id !== currentVersionId && version.status === 'active';
}

export function canRollbackSkillVersion(
  version: SkillVersionDetail,
  currentVersionId: string | null,
): boolean {
  return version.id !== currentVersionId;
}
