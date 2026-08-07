import { describe, expect, it } from 'vitest';
import { getSkillNotificationDuration } from './skill-transient-notification';

describe('transient Skill notification', () => {
  it('keeps ordinary status updates brief', () => {
    expect(getSkillNotificationDuration({
      id: 'saved',
      title: '已保存',
      message: '修改已经保存。',
    })).toBe(3_500);
  });

  it('keeps actionable updates available longer', () => {
    expect(getSkillNotificationDuration({
      id: 'version-ready',
      title: '新版本已生成',
      message: '可以立即查看结果。',
      actionLabel: '查看版本',
    })).toBe(6_000);
  });
});
