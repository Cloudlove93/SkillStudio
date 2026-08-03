export type StructuredSkillDraft = {
  name: string;
  audience: string;
  scenario: string;
  task: string;
  input: string;
  output: string;
  boundaries: string;
};

export const emptyStructuredSkillDraft: StructuredSkillDraft = {
  name: '',
  audience: '',
  scenario: '',
  task: '',
  input: '',
  output: '',
  boundaries: '',
};

export function hasStructuredSkillInput(draft: StructuredSkillDraft) {
  return Object.values(draft).some((value) => value.trim().length > 0);
}

export function formatStructuredSkillRequest(draft: StructuredSkillDraft) {
  return [
    ['Skill 名称', draft.name],
    ['服务对象', draft.audience],
    ['使用场景', draft.scenario],
    ['希望完成的任务', draft.task],
    ['输入内容', draft.input],
    ['期望输出', draft.output],
    ['需要遵守的边界', draft.boundaries],
  ]
    .map(([label, value]) => `${label}：${value.trim()}`)
    .join('\n');
}
