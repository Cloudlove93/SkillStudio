import { describe, expect, it } from 'vitest';
import type { ArenaThread } from '@educlaw/shared';
import { getConversationSurface, getConversationTitle, getSurfaceLabel, isSkillConversationThread } from './skill-conversation-list';

const thread = (overrides: Partial<ArenaThread>): ArenaThread => ({
  id: 1,
  packageId: 7,
  title: 'Skill Arena: Physics',
  arenaKind: 'skill_arena',
  basePackageVersionId: '10',
  skillArenaConfig: {
    mode: 'skill_arena',
    compositionMode: 'skill_only',
    basePackageVersionId: '10',
    left: { side: 'left', skillId: 'physics', skillVersionId: '1', skillUid: 'physics', skillName: 'Physics', versionNumber: 1 },
    right: { side: 'right', skillId: 'physics', skillVersionId: '1', skillUid: 'physics', skillName: 'Physics', versionNumber: 1 },
  },
  createdAt: '2026-08-05T08:00:00.000Z',
  updatedAt: '2026-08-05T08:01:00.000Z',
  ...overrides,
});

describe('Skill conversation list helpers', () => {
  it('keeps only run/test conversations for the selected Skill', () => {
    const base = thread({});
    expect(isSkillConversationThread(thread({}), 'physics')).toBe(true);
    expect(isSkillConversationThread(thread({ skillArenaConfig: { ...base.skillArenaConfig!, surface: 'run' } }), 'physics')).toBe(true);
    expect(isSkillConversationThread(thread({ skillArenaConfig: { ...base.skillArenaConfig!, surface: 'test' } }), 'physics')).toBe(true);
    expect(isSkillConversationThread(thread({ skillArenaConfig: { ...base.skillArenaConfig!, surface: 'arena' } }), 'physics')).toBe(false);
    expect(isSkillConversationThread(thread({ skillArenaConfig: { ...base.skillArenaConfig!, surface: 'optimize' } }), 'physics')).toBe(false);
    expect(isSkillConversationThread(thread({ skillArenaConfig: { ...base.skillArenaConfig!, left: { ...base.skillArenaConfig!.left, skillId: 'chemistry' } } }), 'physics')).toBe(false);
  });

  it('supports legacy same-version threads without a surface marker', () => {
    const base = thread({});
    expect(isSkillConversationThread(thread({}), 'physics')).toBe(true);
    expect(isSkillConversationThread(thread({ skillArenaConfig: { ...base.skillArenaConfig!, right: { ...base.skillArenaConfig!.right, skillVersionId: '2' } } }), 'physics')).toBe(false);
  });

  it('derives a surface label from the config or version parity', () => {
    const base = thread({});
    expect(getConversationSurface(thread({ skillArenaConfig: { ...base.skillArenaConfig!, surface: 'test' } }))).toBe('test');
    expect(getConversationSurface(thread({ skillArenaConfig: { ...base.skillArenaConfig!, surface: 'optimize' } }))).toBe('optimize');
    // legacy same-version → run
    expect(getConversationSurface(thread({}))).toBe('run');
    // legacy different-version → arena
    expect(getConversationSurface(thread({ skillArenaConfig: { ...base.skillArenaConfig!, right: { ...base.skillArenaConfig!.right, skillVersionId: '2' } } }))).toBe('arena');
    expect(getSurfaceLabel('run')).toBe('使用');
    expect(getSurfaceLabel('test')).toBe('测试');
    expect(getSurfaceLabel('optimize')).toBe('优化');
    expect(getSurfaceLabel('arena')).toBe('对比');
    expect(getSurfaceLabel(null)).toBe('');
  });

  it('creates a readable title from the first user prompt', () => {
    expect(getConversationTitle('Design a floating experiment for grade eight')).toBe('Design a floating experiment for grade eight');
    expect(getConversationTitle('  A very long prompt that should be shortened for the sidebar because it exceeds the limit  ')).toHaveLength(32);
  });
});
