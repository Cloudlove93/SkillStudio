import { strict as assert } from 'node:assert';
import test from 'node:test';

import { extractDisplayRubricContent } from './rubric-display.ts';

test('extractDisplayRubricContent keeps only the main rubric body', () => {
  const source = [
    '5、评价准则',
    '',
    '维度\t权重\t优秀（A）\t合格（B）\t不合格（C）',
    '沟通策略的针对性\t30%\t准确识别家长心理\t基本识别问题\t建议过于通用',
    '证据呈现的有效性\t25%\t强调具体行为记录\t有证据思维\t仍依赖主观描述',
    '',
    '分级描述（以汇报质量为例）：',
    '- 优秀：能解释代码逻辑',
    '- 合格：能完整演示操作步骤',
    '',
    '6、案例对比',
    '正面案例：先让学生独立完成，再用 AI 对照。',
    '',
    '7、规范依据',
    '《职业教育提质培优行动计划》',
  ].join('\n');

  const display = extractDisplayRubricContent(source);

  assert.match(display, /5、评价准则/);
  assert.match(display, /沟通策略的针对性/);
  assert.doesNotMatch(display, /分级描述/);
  assert.doesNotMatch(display, /6、案例对比/);
  assert.doesNotMatch(display, /7、规范依据/);
});

test('extractDisplayRubricContent falls back to the original text when no boundary is found', () => {
  const source = [
    '# Rubric',
    '',
    '## 评分目标',
    '- 判断回答是否贴合角色。',
    '',
    '## 评分维度',
    '### 角色贴合',
    '- 回答聚焦任务本身。',
  ].join('\n');

  assert.equal(extractDisplayRubricContent(source), source);
});

test('extractDisplayRubricContent prefers the raw rubric section inside wrapped content', () => {
  const source = [
    '# Rubric',
    '',
    '## 评分目标',
    '- 用于评估回答是否贴合任务。',
    '',
    '## 原始 rubric 要点',
    '5、评价准则',
    '',
    '维度\t权重\t优秀（A）\t合格（B）\t不合格（C）',
    '口令设计的科学性\t30%\t口令动作简洁易记\t口令基本合理\t口令复杂或不符合儿童特点',
    '',
    '6、案例对比',
    '正面案例：教师设计了快速响应系统。',
  ].join('\n');

  const display = extractDisplayRubricContent(source);

  assert.equal(
    display,
    [
      '5、评价准则',
      '',
      '维度\t权重\t优秀（A）\t合格（B）\t不合格（C）',
      '口令设计的科学性\t30%\t口令动作简洁易记\t口令基本合理\t口令复杂或不符合儿童特点',
    ].join('\n'),
  );
});

test('extractDisplayRubricContent extracts only the main rubric block from wrapped legacy content', () => {
  const source = [
    '# Rubric',
    '',
    '## 评分目标',
    '- 用于评估回答是否贴合任务。',
    '',
    '## 评分维度',
    '5、评价准则',
    '',
    '维度\t权重\t优秀（A）\t合格（B）\t不合格（C）',
    '口令设计的科学性\t30%\t口令动作简洁易记\t口令基本合理\t口令复杂或不符合儿童特点',
    '',
    '6、案例对比',
    '正面案例：教师设计了快速响应系统。',
    '',
    '## 使用说明',
    '- 先判断回答是否完成用户任务。',
  ].join('\n');

  assert.equal(
    extractDisplayRubricContent(source),
    [
      '5、评价准则',
      '',
      '维度\t权重\t优秀（A）\t合格（B）\t不合格（C）',
      '口令设计的科学性\t30%\t口令动作简洁易记\t口令基本合理\t口令复杂或不符合儿童特点',
    ].join('\n'),
  );
});

test('extractDisplayRubricContent removes narrative summary prose and keeps only scorable criteria rows', () => {
  const source = [
    '5、评价准则',
    '',
    '整体评价：回复展现了对网络文化影响的深刻洞察。',
    '',
    '具体评价：',
    '',
    '① 热梗辨析能力 应提供识别、分析网络热梗的指南。',
    '② 媒介素养培养 应提供符合学龄特点的媒介素养课程。',
    '③ 价值观正向引导 应提供积极、健康的价值观教育。',
    '',
    '6、案例对比',
    '正面案例：从课堂语言规范入手。',
    '',
    '7、规范依据',
    '《小学课程标准》',
    '',
    '8、测试情景（10个）',
    '情景1：低龄学童模仿网络热梗。',
  ].join('\n');

  const display = extractDisplayRubricContent(source);

  assert.equal(
    display,
    [
      '5、评价准则',
      '',
      '① 热梗辨析能力 应提供识别、分析网络热梗的指南。',
      '② 媒介素养培养 应提供符合学龄特点的媒介素养课程。',
      '③ 价值观正向引导 应提供积极、健康的价值观教育。',
    ].join('\n'),
  );
});
