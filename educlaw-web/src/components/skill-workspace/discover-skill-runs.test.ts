import { describe, expect, it } from 'vitest';
import { discoverActiveSkillRuns } from './discover-skill-runs';

describe('background Skill run discovery', () => {
  it('limits recovery concurrency and discovers active conversations without marking past completions', async () => {
    let active = 0;
    let peak = 0;
    const found: string[] = [];
    await discoverActiveSkillRuns(
      ['1', '2', '3', '4', '5', '6'],
      async (id) => {
        active += 1;
        peak = Math.max(peak, active);
        await Promise.resolve();
        active -= 1;
        return id === '2' || id === '6';
      },
      (id) => found.push(id),
      () => true,
    );
    expect(peak).toBe(4);
    expect(found).toEqual(['2', '6']);
  });
  it('ignores stale discovery results after a Skill or identity switch', async () => {
    let current = true;
    const found: string[] = [];
    await discoverActiveSkillRuns(
      ['1', '2'],
      async () => {
        current = false;
        return true;
      },
      (id) => found.push(id),
      () => current,
    );
    expect(found).toEqual([]);
  });
});
