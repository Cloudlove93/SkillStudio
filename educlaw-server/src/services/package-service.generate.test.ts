import { afterEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const generateJsonMock = vi.fn();
const streamTextMock = vi.fn();

async function loadService() {
  vi.resetModules();

  const ids = ['skill-1', 'package-1', 'version-1'];
  let storedPackage: Record<string, unknown> | null = null;
  let storedVersion: Record<string, unknown> | null = null;

  vi.doMock('./db.js', () => ({
    newId: () => ids.shift() || `id-${Math.random().toString(36).slice(2, 8)}`,
    query: queryMock.mockImplementation(async (sql: string, args: unknown[]) => {
      if (sql.startsWith('insert into agent_package_versions')) {
        storedVersion = {
          id: args[0],
          package_id: args[1],
          version_number: args[2],
          source: args[3],
          snapshot_json: args[4],
          created_at: args[5],
          note: '',
        };
        return { rows: [], rowCount: 1 };
      }

      if (sql.startsWith('insert into agent_packages')) {
        storedPackage = {
          id: args[0],
          user_id: args[1],
          name: args[2],
          description: args[3],
          current_version_id: args[4],
          created_at: args[5],
          updated_at: args[6],
        };
        return { rows: [], rowCount: 1 };
      }

      if (sql.startsWith('select * from agent_packages where id = $1')) {
        return {
          rows: storedPackage ? [storedPackage] : [],
          rowCount: storedPackage ? 1 : 0,
        };
      }

      if (sql.startsWith('select * from agent_package_versions where id = $1')) {
        return {
          rows: storedVersion ? [storedVersion] : [],
          rowCount: storedVersion ? 1 : 0,
        };
      }

      throw new Error(`Unexpected query: ${sql}`);
    }),
  }));

  vi.doMock('./llm-service.js', () => ({
    generateJson: generateJsonMock,
    generateText: vi.fn(),
    generateChat: vi.fn(),
    streamText: streamTextMock,
  }));

  return import('./package-service.js');
}

function makeLongSkillMarkdown() {
  return [
    '# Core Task',
    '## When to use',
    '- Use for the main package workflow.',
    '## When not to use',
    '- Skip this for off-topic chat.',
    '## Instructions',
    '- Review the request.',
    '- Produce a structured answer.',
    '## Workflow',
    '1. Identify the user goal.',
    '2. Produce steps.',
    '3. Check risks and constraints.',
    '## Output Format',
    '- Context',
    '- Plan',
    '- Risks',
    '## Examples',
    '- Example response.',
    '## Common Issues',
    '- Ask for missing context before guessing.',
    '',
    'Extra detail to satisfy length checks. '.repeat(40),
  ].join('\n');
}

function makeSkillMarkdownMissingSections() {
  return [
    '# Core Task',
    '## When to use',
    '- Use for the main package workflow.',
    '## When not to use',
    '- Skip this for off-topic chat.',
    '## Instructions',
    '- Review the request.',
    '## Output Format',
    '- Plan',
    '',
    'This draft intentionally omits Workflow, Examples, and Common Issues. '.repeat(
      20,
    ),
  ].join('\n');
}

function makeUsableSourceRubricDocument() {
  return [
    '# Project Note',
    '',
    '## Rubric',
    '5. Evaluation Criteria',
    '',
    'Overall evaluation: score whether the response stays grounded and safe.',
    '',
    '1. Document fidelity (20%)',
    '- Keep answers grounded in the source materials.',
    '',
    '2. Safety and referral boundaries (20%)',
    '- Escalate self-harm, violence, and legal or medical emergencies.',
    '',
    '3. Practical usability (20%)',
    '- Give concrete steps that a teacher can follow directly.',
    '',
    '## Other Section',
    'This should not be included.',
  ].join('\n');
}

function makeIncompleteSourceRubricDocument() {
  return [
    '# Project Note',
    '',
    '## Rubric',
    '5. Evaluation Criteria',
    '',
    'Overall evaluation: score whether the response stays grounded and practical.',
    '',
    '1. Behavior assessment',
    '- Provide a useful assessment checklist.',
    '',
    '2. Intervention variety',
    '- Offer more than one intervention strategy.',
    '',
    '## Other Section',
    'This should not be included.',
  ].join('\n');
}

function makeDocxRawRubricDocument() {
  return [
    'Task document',
    '',
    '4. Workflow design',
    'Earlier section content.',
    '',
    '## Rubric',
    '5. Evaluation Criteria',
    '',
    '1. Boundary language quality',
    '- Provide clear language for empathy and limits.',
    '',
    '## Case comparison',
    'This should not be included.',
    '',
    '## References',
    'This should not be included either.',
  ].join('\n');
}

function makeStandaloneWeightedRubricDocument() {
  return [
    '中职家校冲突处置顾问 - 评估量表',
    '',
    '维度一：文档保真度与知识准确性',
    '权重：25%',
    '分值 评级标准',
    '5分 严格基于上传材料和法规依据，无虚构内容。',
    '4分 主要依据可靠，只有少量明确标注的通用补充。',
    '3分 存在合理推断，但没有明确区分材料事实与补充判断。',
    '2分 出现明显无依据虚构或脱离中职场景。',
    '1分 严重幻觉或与材料冲突。',
    '',
    '关键检查点：',
    '- 未虚构法律条文',
    '',
    '维度二：安全边界与危机升级',
    '权重：30%',
    '分值 评级标准',
    '5分 准确识别暴力、自伤等红色风险并立即升级。',
    '4分 能识别高风险并优先提醒报警或安保介入。',
    '3分 提及风险，但仍混合提供常规沟通话术。',
    '2分 对暴力风险反应不足。',
    '1分 在高风险情境下仍继续提供常规调解建议。',
    '',
    '维度三：四步处置原则合规性',
    '权重：25%',
    '分值 评级标准',
    '5分 完整遵循控情绪、明边界、护教师、走程序。',
    '',
    '维度四：工具可执行性',
    '权重：20%',
    '分值 评级标准',
    '5分 提供表格、话术、留痕模板等直接可用工具。',
  ].join('\n');
}

function makeEmbeddedLegacyRubricDocument() {
  return [
    '# 项目说明',
    '',
    '任务背景：先介绍项目目标和用户对象。',
    '',
    '5、评价准则',
    '',
    '整体评价：判断回复是否贴合一线教师的实际工作场景。',
    '',
    '① 风险识别',
    '- 是否能识别需要立即升级处理的情况。',
    '',
    '② 话术可用性',
    '- 是否给出教师可以直接拿来使用的话术。',
    '',
    '附录：这里是后续参考资料，不属于 rubric。',
  ].join('\n');
}

function makeRepairedRubricMarkdown() {
  return [
    '# Rubric',
    '',
    '## 评分目标',
    '- Score whether the response is grounded, practical, and safe.',
    '',
    '## 评分维度',
    '### 角色贴合',
    '- Full score: stays aligned with the package role and audience.',
    '',
    '### Skill 遵循',
    '- Full score: uses the intended workflow and constraints.',
    '',
    '### 回答质量',
    '- Full score: preserves behavior assessment and intervention variety.',
    '',
    '### 安全边界',
    '- Full score: clearly escalates high-risk cases.',
    '',
    '## 使用说明',
    '- Score each dimension and then give a summary.',
  ].join('\n');
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('./db.js');
  vi.doUnmock('./llm-service.js');
  queryMock.mockReset();
  generateJsonMock.mockReset();
  streamTextMock.mockReset();
});

describe('generatePackage', () => {
  it('allows an empty rubricMd and still creates the package', async () => {
    generateJsonMock.mockResolvedValue({
      name: 'Test Agent',
      description: 'Handle test requests.',
      skills: [
        {
          dirName: 'core-task',
          name: 'Core Task',
          description: 'Use this when the user needs the primary task handled.',
        },
      ],
    });

    let streamCall = 0;
    streamTextMock.mockImplementation(() => {
      streamCall += 1;
      if (streamCall === 1) {
        return (async function* () {
          yield '# Test Agent\n\nAgent instructions.\n'.repeat(20);
        })();
      }
      if (streamCall === 2) {
        return (async function* () {})();
      }
      return (async function* () {
        yield makeLongSkillMarkdown();
      })();
    });

    const { generatePackage } = await loadService();
    const detail = await generatePackage('user-1', 'Create a test package');

    expect(detail.name).toBe('Test Agent');
    expect(detail.snapshot.rubricMd).toBe('');
    expect(detail.snapshot.skills).toHaveLength(1);
  });

  it('autofills missing skill sections before validation', async () => {
    generateJsonMock.mockResolvedValue({
      name: 'Test Agent',
      description: 'Handle test requests.',
      skills: [
        {
          dirName: 'core-task',
          name: 'Core Task',
          description: 'Use this when the user needs the primary task handled.',
        },
      ],
    });

    let streamCall = 0;
    streamTextMock.mockImplementation(() => {
      streamCall += 1;
      if (streamCall === 1) {
        return (async function* () {
          yield '# Test Agent\n\nAgent instructions.\n'.repeat(20);
        })();
      }
      if (streamCall === 2) {
        return (async function* () {})();
      }
      return (async function* () {
        yield makeSkillMarkdownMissingSections();
      })();
    });

    const { generatePackage } = await loadService();
    const detail = await generatePackage('user-1', 'Create a test package');
    const skillMd = detail.snapshot.skills[0]!.skillMd;

    expect(skillMd).toContain('## Workflow');
    expect(skillMd).toContain('## Examples');
    expect(skillMd).toContain('## Common Issues');
  });

  it('keeps a usable uploaded rubric without forcing repair', async () => {
    generateJsonMock.mockResolvedValue({
      name: 'Village Support Agent',
      description: 'Organize intervention plans.',
      skills: [
        {
          dirName: 'core-task',
          name: 'Core Task',
          description: 'Use this when the user needs the primary task handled.',
        },
      ],
    });

    let streamCall = 0;
    streamTextMock.mockImplementation(() => {
      streamCall += 1;
      if (streamCall === 1) {
        return (async function* () {
          yield '# Village Support Agent\n\nAgent instructions.\n'.repeat(20);
        })();
      }
      return (async function* () {
        yield makeLongSkillMarkdown();
      })();
    });

    const { generatePackage } = await loadService();
    const detail = await generatePackage('user-1', '', undefined, [
      { name: 'rubric-source.md', content: makeUsableSourceRubricDocument() },
    ]);

    expect(detail.snapshot.rubricMd).toContain('Document fidelity');
    expect(detail.snapshot.rubricMd).toContain('Safety and referral boundaries');
    expect(detail.snapshot.rubricMd).not.toContain('## Other Section');
    expect(streamTextMock).toHaveBeenCalledTimes(2);
  });

  it('accepts an incomplete but scorable uploaded rubric for report generation', async () => {
    generateJsonMock.mockResolvedValue({
      name: 'Conflict Coach',
      description: 'Support home-school conflict handling.',
      skills: [
        {
          dirName: 'core-task',
          name: 'Core Task',
          description: 'Use this when the user needs the primary task handled.',
        },
      ],
    });

    let streamCall = 0;
    streamTextMock.mockImplementation(() => {
      streamCall += 1;
      if (streamCall === 1) {
        return (async function* () {
          yield '# Conflict Coach\n\nAgent instructions.\n'.repeat(20);
        })();
      }
      return (async function* () {
        yield makeLongSkillMarkdown();
      })();
    });

    const { generatePackage, hasConfiguredRubricText } = await loadService();
    const detail = await generatePackage('user-1', '', undefined, [
      { name: 'rubric-source.md', content: makeIncompleteSourceRubricDocument() },
    ]);

    expect(detail.snapshot.rubricMd).toContain('Behavior assessment');
    expect(detail.snapshot.rubricMd).toContain('Intervention variety');
    expect(hasConfiguredRubricText(detail.snapshot.rubricMd)).toBe(true);
    expect(streamTextMock).toHaveBeenCalledTimes(2);
  });

  it('repairs an incomplete model-generated rubric before saving', async () => {
    generateJsonMock.mockResolvedValue({
      name: 'Conflict Coach',
      description: 'Support home-school conflict handling.',
      skills: [
        {
          dirName: 'core-task',
          name: 'Core Task',
          description: 'Use this when the user needs the primary task handled.',
        },
      ],
    });

    let streamCall = 0;
    streamTextMock.mockImplementation(() => {
      streamCall += 1;
      if (streamCall === 1) {
        return (async function* () {
          yield '# Conflict Coach\n\nAgent instructions.\n'.repeat(20);
        })();
      }
      if (streamCall === 2) {
        return (async function* () {
          yield [
            '5. Evaluation Criteria',
            '',
            '1. Conflict identification',
            '- Spot the main source of conflict.',
          ].join('\n');
        })();
      }
      if (streamCall === 3) {
        return (async function* () {
          yield makeRepairedRubricMarkdown();
        })();
      }
      return (async function* () {
        yield makeLongSkillMarkdown();
      })();
    });

    const { generatePackage, hasConfiguredRubricText } = await loadService();
    const detail = await generatePackage('user-1', 'Create a conflict coach');

    expect(detail.snapshot.rubricMd).toContain('# Rubric');
    expect(detail.snapshot.rubricMd).toContain('## 使用说明');
    expect(hasConfiguredRubricText(detail.snapshot.rubricMd)).toBe(true);
    expect(streamTextMock).toHaveBeenCalledTimes(4);
  });

  it('extracts a rubric from docx raw text and repairs it when needed', async () => {
    generateJsonMock.mockResolvedValue({
      name: 'Village Support Agent',
      description: 'Organize intervention plans.',
      skills: [
        {
          dirName: 'core-task',
          name: 'Core Task',
          description: 'Use this when the user needs the primary task handled.',
        },
      ],
    });

    let streamCall = 0;
    streamTextMock.mockImplementation(() => {
      streamCall += 1;
      if (streamCall === 1) {
        return (async function* () {
          yield '# Village Support Agent\n\nAgent instructions.\n'.repeat(20);
        })();
      }
      if (streamCall === 2) {
        return (async function* () {
          yield makeRepairedRubricMarkdown();
        })();
      }
      return (async function* () {
        yield makeLongSkillMarkdown();
      })();
    });

    const { generatePackage, hasConfiguredRubricText } = await loadService();
    const detail = await generatePackage('user-1', '', undefined, [
      { name: 'task.docx', content: makeDocxRawRubricDocument() },
    ]);

    expect(detail.snapshot.rubricMd).toContain('# Rubric');
    expect(detail.snapshot.rubricMd).toContain('## 使用说明');
    expect(detail.snapshot.rubricMd).not.toContain('## Case comparison');
    expect(detail.snapshot.rubricMd).not.toContain('## References');
    expect(hasConfiguredRubricText(detail.snapshot.rubricMd)).toBe(true);
    expect(streamTextMock).toHaveBeenCalledTimes(3);
  });

  it('keeps a standalone weighted rubric document without forcing template rewrite', async () => {
    generateJsonMock.mockResolvedValue({
      name: 'Conflict Coach',
      description: 'Support home-school conflict handling.',
      skills: [
        {
          dirName: 'core-task',
          name: 'Core Task',
          description: 'Use this when the user needs the primary task handled.',
        },
      ],
    });

    let streamCall = 0;
    streamTextMock.mockImplementation(() => {
      streamCall += 1;
      if (streamCall === 1) {
        return (async function* () {
          yield '# Conflict Coach\n\nAgent instructions.\n'.repeat(20);
        })();
      }
      return (async function* () {
        yield makeLongSkillMarkdown();
      })();
    });

    const { generatePackage, hasConfiguredRubricText } = await loadService();
    const detail = await generatePackage('user-1', '', undefined, [
      { name: 'rubric-source.docx', content: makeStandaloneWeightedRubricDocument() },
    ]);

    expect(detail.snapshot.rubricMd).toContain('中职家校冲突处置顾问 - 评估量表');
    expect(detail.snapshot.rubricMd).toContain('维度一：文档保真度与知识准确性');
    expect(detail.snapshot.rubricMd).toContain('维度四：工具可执行性');
    expect(hasConfiguredRubricText(detail.snapshot.rubricMd)).toBe(true);
    expect(streamTextMock).toHaveBeenCalledTimes(2);
  });

  it('extracts an embedded legacy rubric block instead of the whole document and repairs it when needed', async () => {
    generateJsonMock.mockResolvedValue({
      name: 'Conflict Coach',
      description: 'Support home-school conflict handling.',
      skills: [
        {
          dirName: 'core-task',
          name: 'Core Task',
          description: 'Use this when the user needs the primary task handled.',
        },
      ],
    });

    let streamCall = 0;
    streamTextMock.mockImplementation(() => {
      streamCall += 1;
      if (streamCall === 1) {
        return (async function* () {
          yield '# Conflict Coach\n\nAgent instructions.\n'.repeat(20);
        })();
      }
      if (streamCall === 2) {
        return (async function* () {
          yield [
            '# Rubric',
            '',
            '## 评分目标',
            '- 判断回复是否贴合一线教师的实际工作场景。',
            '',
            '## 评分维度',
            '### 风险识别',
            '- 满分标准：能够识别需要立即升级处理的情况。',
            '',
            '### 话术可用性',
            '- 满分标准：给出教师可以直接拿来使用的话术。',
            '',
            '### 回答质量',
            '- 满分标准：整体建议清楚、完整、能执行。',
            '',
            '### 安全边界',
            '- 满分标准：遇到高风险情况时会立即升级，不继续普通劝导。',
            '',
            '## 使用说明',
            '- 逐项评分后，再给出综合判断。',
          ].join('\n');
        })();
      }
      return (async function* () {
        yield makeLongSkillMarkdown();
      })();
    });

    const { generatePackage, hasConfiguredRubricText } = await loadService();
    const detail = await generatePackage('user-1', '', undefined, [
      { name: 'task-outline.md', content: makeEmbeddedLegacyRubricDocument() },
    ]);

    expect(detail.snapshot.rubricMd).toContain('风险识别');
    expect(detail.snapshot.rubricMd).toContain('话术可用性');
    expect(detail.snapshot.rubricMd).not.toContain('任务背景：先介绍项目目标和用户对象。');
    expect(detail.snapshot.rubricMd).not.toContain('附录：这里是后续参考资料');
    expect(hasConfiguredRubricText(detail.snapshot.rubricMd)).toBe(true);
    expect(streamTextMock).toHaveBeenCalledTimes(3);
  });
});
