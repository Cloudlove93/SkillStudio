import { describe, expect, it } from 'vitest';
import type { SkillVersionDetail } from '@educlaw/shared';
import {
  canDiscardSkillVersion,
  canRollbackSkillVersion,
  visibleSkillVersions,
} from './skill-version-state';

function version(
  id: string,
  versionNumber: number,
  status: SkillVersionDetail['status'] = 'active',
): SkillVersionDetail {
  return {
    id,
    skillId: 'skill-1',
    packageId: 'package-1',
    createdInPackageVersionId: `package-version-${versionNumber}`,
    versionNumber,
    source: 'manual',
    basedOnVersionId: null,
    skill: {
      id: 'skill-uid',
      dirName: 'lesson-plan',
      name: '课堂活动设计',
      description: '生成课堂活动',
      skillMd: `# Skill v${versionNumber}`,
    },
    contentHash: `hash-${versionNumber}`,
    status,
    note: '',
    createdAt: `2026-08-0${versionNumber}T09:00:00.000Z`,
    discardedAt: status === 'discarded' ? '2026-08-03T10:00:00.000Z' : null,
    discardedBy: null,
    discardReason: null,
    restoredAt: null,
    restoredBy: null,
  };
}

describe('Skill version presentation state', () => {
  const current = version('v3', 3);
  const history = version('v2', 2);
  const discarded = version('v1', 1, 'discarded');

  it('sorts newest first and hides discarded versions by default', () => {
    expect(visibleSkillVersions([history, discarded, current], false).map((item) => item.id)).toEqual([
      'v3',
      'v2',
    ]);
  });

  it('includes discarded versions when requested', () => {
    expect(visibleSkillVersions([history, discarded, current], true).map((item) => item.id)).toEqual([
      'v3',
      'v2',
      'v1',
    ]);
  });

  it('protects the current version from discard and rollback', () => {
    expect(canDiscardSkillVersion(current, 'v3')).toBe(false);
    expect(canRollbackSkillVersion(current, 'v3')).toBe(false);
  });

  it('allows rollback for history but only active history can be discarded', () => {
    expect(canRollbackSkillVersion(history, 'v3')).toBe(true);
    expect(canRollbackSkillVersion(discarded, 'v3')).toBe(true);
    expect(canDiscardSkillVersion(history, 'v3')).toBe(true);
    expect(canDiscardSkillVersion(discarded, 'v3')).toBe(false);
  });
});
