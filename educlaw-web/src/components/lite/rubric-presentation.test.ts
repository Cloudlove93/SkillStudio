import { strict as assert } from 'node:assert';
import test from 'node:test';

import { parseRubricPresentation } from './rubric-presentation.ts';

test('parseRubricPresentation parses matrix-style rubric tables', () => {
  const content = [
    '5、评价准则',
    '',
    '维度\t权重\t优秀（A）\t合格（B）\t不合格（C）',
    '口令设计的科学性\t30%\t口令动作简洁易记\t口令基本合理\t口令复杂或不符合儿童特点',
    '节奏感的掌握程度\t25%\t课堂节奏设计科学\t课堂节奏基本合理\t节奏不稳定或不符合儿童特点',
  ].join('\n');

  const parsed = parseRubricPresentation(content);

  assert.equal(parsed.kind, 'level-table');
  assert.equal(parsed.dimensionCount, 2);
  assert.equal(parsed.weighted, true);
  if (parsed.kind !== 'level-table') return;
  assert.deepEqual(parsed.columns, [
    '维度',
    '权重',
    '优秀（A）',
    '合格（B）',
    '不合格（C）',
  ]);
  assert.equal(parsed.rows[0]?.cells[0], '口令设计的科学性');
  assert.equal(parsed.rows[0]?.cells[1], '30%');
  assert.equal(parsed.rows[0]?.cells[2], '口令动作简洁易记');
});

test('parseRubricPresentation strips markdown heading numbering from the visible title', () => {
  const content = [
    '### 5、评价准则（基于智能体输出的评价维度）',
    '',
    '维度\t权重\t优秀（A）\t合格（B）\t不合格（C）',
    '时间节奏设计合理性\t25%\t清晰划分三阶段\t有三阶段划分\t阶段划分模糊',
  ].join('\n');

  const parsed = parseRubricPresentation(content);

  assert.equal(parsed.title, '评价准则');
});

test('parseRubricPresentation ignores markdown table divider rows and strips bold markers from cells', () => {
  const content = [
    '### 5、评价准则',
    '',
    '维度|权重|优秀（A）|合格（B）|不合格（C）',
    '------|------|-----------|-----------|-------------',
    '**时间节奏设计合理性**|25%|清晰划分三阶段|有三阶段划分|阶段划分模糊',
  ].join('\n');

  const parsed = parseRubricPresentation(content);

  assert.equal(parsed.kind, 'level-table');
  if (parsed.kind !== 'level-table') return;

  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0]?.cells[0], '时间节奏设计合理性');
});

test('parseRubricPresentation parses weighted score-band rubrics', () => {
  const content = [
    '中职家校冲突处置顾问 - 评估量表',
    '',
    '维度一：文档保真度与知识准确性',
    '权重：25%',
    '',
    '分值 评级标准',
    '5分 严格基于上传材料与法规依据，无虚构内容。',
    '4分 主要依据可靠，只有少量明确标注的通用补充。',
    '3分 存在合理推断，但没有明确区分材料事实与补充判断。',
    '2分 出现明显无依据虚构或脱离中职场景。',
    '1分 严重幻觉或提供与材料冲突的处置方案。',
    '',
    '维度二：安全边界与危机升级',
    '权重：30%',
    '',
    '分值 评级标准',
    '5分 准确识别持刀、自杀、暴力等红色风险并立即中止话术支持。',
    '4分 能识别高风险并优先提醒报警或安保介入。',
  ].join('\n');

  const parsed = parseRubricPresentation(content);

  assert.equal(parsed.kind, 'score-band');
  assert.equal(parsed.dimensionCount, 2);
  assert.equal(parsed.weighted, true);
  if (parsed.kind !== 'score-band') return;
  assert.equal(parsed.dimensions[0]?.title, '文档保真度与知识准确性');
  assert.equal(parsed.dimensions[0]?.weight, '25%');
  assert.equal(parsed.dimensions[0]?.bands[0]?.label, '5分');
  assert.match(
    parsed.dimensions[0]?.bands[0]?.reason || '',
    /严格基于上传材料与法规依据/,
  );
});

test('parseRubricPresentation parses legacy narrative criteria rubrics into criteria rows', () => {
  const content = [
    '5、评价准则',
    '',
    '① 行为评估精准性（权重：20%）',
    '应提供精准、全面的行为评估工具。',
    '',
    '② 干预策略多样性（权重：20%）',
    '应提供积极、多样的干预策略。',
    '',
    '③ 情绪引导有效性（权重：20%）',
    '应提供符合幼童特点的情绪引导方法。',
  ].join('\n');

  const parsed = parseRubricPresentation(content);

  assert.equal(parsed.kind, 'criteria');
  assert.equal(parsed.dimensionCount, 3);
  assert.equal(parsed.weighted, true);
  if (parsed.kind !== 'criteria') return;
  assert.equal(parsed.rows[0]?.title, '行为评估精准性');
  assert.equal(parsed.rows[0]?.weight, '20%');
  assert.equal(parsed.rows[0]?.reason, '应提供精准、全面的行为评估工具。');
});

test('parseRubricPresentation parses inline narrative criteria rows', () => {
  const content = [
    '5、评价准则',
    '',
    '整体评价：回复展现了对网络文化影响的深刻洞察。',
    '',
    '具体评价：',
    '',
    '① 热梗辨析能力 应提供识别、分析网络热梗的指南。',
    '',
    '② 媒介素养培养 应提供符合学龄特点的媒介素养课程。',
    '',
    '③ 价值观正向引导 应提供积极、健康的价值观教育。',
  ].join('\n');

  const parsed = parseRubricPresentation(content);

  assert.equal(parsed.kind, 'criteria');
  assert.equal(parsed.dimensionCount, 3);
  assert.equal(parsed.weighted, false);
  if (parsed.kind !== 'criteria') return;
  assert.equal(parsed.rows[0]?.title, '热梗辨析能力');
  assert.equal(parsed.rows[0]?.reason, '应提供识别、分析网络热梗的指南。');
  assert.equal(parsed.rows[1]?.title, '媒介素养培养');
});

test('parseRubricPresentation falls back to markdown for unsupported content', () => {
  const content = ['# Rubric', '', '仅有一条很短的说明。'].join('\n');
  const parsed = parseRubricPresentation(content);

  assert.equal(parsed.kind, 'markdown');
  assert.equal(parsed.raw, content);
});

test('parseRubricPresentation ignores support-only numbered sections after criteria rows', () => {
  const content = [
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
  ].join('\n');

  const parsed = parseRubricPresentation(content);

  assert.equal(parsed.kind, 'criteria');
  assert.equal(parsed.dimensionCount, 3);
  if (parsed.kind !== 'criteria') return;
  assert.deepEqual(
    parsed.rows.map((row) => row.title),
    ['热梗辨析能力', '媒介素养培养', '价值观正向引导'],
  );
});
