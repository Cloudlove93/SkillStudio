import { describe, expect, it } from 'vitest';
import { educationScenarios } from './education-scenarios';

describe('education Skill conversation starters', () => {
  it('keeps only the two reviewed localized teaching scenarios', () => {
    expect(educationScenarios.map((scenario) => scenario.label)).toEqual([
      '完整课时设计',
      '分层教学设计',
    ]);

    expect(educationScenarios.map((scenario) => scenario.description)).toEqual([
      '教案、学习单与课堂观察同步设计',
      '保持共同目标，为不同学习需要提供支持',
    ]);
    expect(educationScenarios.map((scenario) => scenario.tone)).toEqual([
      'codex-orange',
      'codex-green',
    ]);

    const lessonPlanning = educationScenarios.find(
      (scenario) => scenario.id === 'localized-lesson-planning',
    );
    const differentiation = educationScenarios.find(
      (scenario) => scenario.id === 'localized-lesson-differentiation',
    );

    expect(lessonPlanning?.prompt).toMatch(/中国学校/);
    expect(lessonPlanning?.prompt).toMatch(/课程标准/);
    expect(lessonPlanning?.prompt).toMatch(/教材版本/);
    expect(lessonPlanning?.prompt).toMatch(/目标、活动与评价保持一致/);
    expect(lessonPlanning?.prompt).toMatch(/课堂观察记录/);

    expect(differentiation?.prompt).toMatch(/现有教案或教学材料/);
    expect(differentiation?.prompt).toMatch(/共同核心目标/);
    expect(differentiation?.prompt).toMatch(/不标注能力等级/);
    expect(differentiation?.prompt).toMatch(/避免标签化/);

    const localizedPrompts = [lessonPlanning?.prompt, differentiation?.prompt].join('\n');
    expect(localizedPrompts).not.toMatch(/CCSS|NGSS|美国州标准|Learning Commons/i);
  });
});
