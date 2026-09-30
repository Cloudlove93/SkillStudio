export type EducationScenario = {
  id: string;
  label: string;
  description: string;
  tone: 'codex-orange' | 'codex-green';
  prompt: string;
};

export const educationScenarios: readonly EducationScenario[] = [
  {
    id: 'localized-lesson-planning',
    label: '完整课时设计',
    description: '教案、学习单与课堂观察同步设计',
    tone: 'codex-orange',
    prompt: [
      '创建一个适用于中国学校的完整课时设计 Skill。',
      '根据学段、年级、学科、教材版本、课程标准、教学内容、课时和真实学情，先用不超过两个问题补齐最关键的信息。',
      '生成教学目标、重难点、教学流程与时间、师生活动、分层支持、课堂评价、学生材料和课堂观察记录。',
      '目标、活动与评价保持一致，各环节时长合计等于课时，所有材料可以直接使用；没有可靠依据时不虚构课程标准编号或教材内容。',
    ].join(''),
  },
  {
    id: 'localized-lesson-differentiation',
    label: '分层教学设计',
    description: '保持共同目标，为不同学习需要提供支持',
    tone: 'codex-green',
    prompt: [
      '创建一个适用于中国课堂的分层教学设计 Skill。',
      '基于教师提供的现有教案或教学材料，先确认年级、学科、教材版本、共同核心目标和真实学情。',
      '在不降低共同核心目标、不改变主要教学内容的前提下，为需要支持、达到要求和学有余力的学习需要设计不同支架、任务路径、表达方式与学生材料。',
      '输出教师分层方案和三套可直接使用的学生任务；学生材料不标注能力等级，避免标签化，也不使用简单减题代替真正的分层。',
    ].join(''),
  },
];
