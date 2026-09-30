import { describe, expect, it } from 'vitest';

import {
  buildSourceRubricExcerpt,
  normalizeStoredRubricMarkdown,
} from './package-service.js';

describe('rubric cleanup', () => {
  it('extracts only the main rubric section from user content', () => {
    const source = [
      '5、评价准则（基于智能体输出的评价维度）',
      '',
      '维度\t权重\t优秀（A）\t合格（B）\t不合格（C）',
      '口令设计的科学性\t30%\t口令动作简洁易记\t口令基本合理\t口令复杂或不符合儿童特点',
      '节奏感的掌握程度\t25%\t课堂节奏设计科学\t课堂节奏基本合理\t节奏不稳定',
      '',
      '6、案例对比',
      '正面案例：教师设计了快速响应系统。',
      '',
      '7、规范依据',
      '《小学课程标准》：强调课堂管理应尊重儿童发展规律。',
      '',
      '8、测试情景（10个）',
      '情景1：口令的设计标准。',
    ].join('\n');

    const excerpt = buildSourceRubricExcerpt([
      { name: 'rubric-source.docx', content: source },
    ]);

    expect(excerpt).toContain('5、评价准则');
    expect(excerpt).toContain('口令设计的科学性');
    expect(excerpt).not.toContain('6、案例对比');
    expect(excerpt).not.toContain('7、规范依据');
    expect(excerpt).not.toContain('8、测试情景');
  });

  it('normalizes wrapped repaired rubric down to the real rubric body', () => {
    const wrappedRubric = [
      '# Rubric',
      '',
      '## 评分目标',
      '用于评估回答是否贴合任务、可执行并保持必要的安全边界。',
      '',
      '## 评分维度',
      '5、评价准则（基于智能体输出的评价维度）',
      '6、案例对比',
      '7、规范依据',
      '8、测试情景（10个）',
      '',
      '## 使用说明',
      '先判断回答是否完成任务，再逐项评分。',
      '',
      '## 原始 rubric 要点',
      '5、评价准则（基于智能体输出的评价维度）',
      '',
      '维度\t权重\t优秀（A）\t合格（B）\t不合格（C）',
      '口令设计的科学性\t30%\t口令动作简洁易记\t口令基本合理\t口令复杂或不符合儿童特点',
      '节奏感的掌握程度\t25%\t课堂节奏设计科学\t课堂节奏基本合理\t节奏不稳定',
      '',
      '6、案例对比',
      '正面案例：教师设计了快速响应系统。',
      '',
      '7、规范依据',
      '《小学课程标准》：强调课堂管理应尊重儿童发展规律。',
    ].join('\n');

    expect(normalizeStoredRubricMarkdown(wrappedRubric)).toBe(
      [
        '5、评价准则（基于智能体输出的评价维度）',
        '',
        '维度\t权重\t优秀（A）\t合格（B）\t不合格（C）',
        '口令设计的科学性\t30%\t口令动作简洁易记\t口令基本合理\t口令复杂或不符合儿童特点',
        '节奏感的掌握程度\t25%\t课堂节奏设计科学\t课堂节奏基本合理\t节奏不稳定',
      ].join('\n'),
    );
  });
});
