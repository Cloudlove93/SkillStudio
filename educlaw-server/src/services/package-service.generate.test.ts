import { afterEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const generateJsonMock = vi.fn();
const streamTextMock = vi.fn();

async function loadService() {
  vi.resetModules();

  let nextId = 1;
  let storedPackage: Record<string, unknown> | null = null;
  let storedVersion: Record<string, unknown> | null = null;

  vi.doMock('./db.js', () => ({
    withTransaction: async (
      work: (client: { query: typeof queryMock }) => Promise<unknown>,
    ) => work({ query: queryMock }),
    query: queryMock.mockImplementation(
      async (sql: string, args: unknown[]) => {
        if (sql.startsWith('insert into agent_package_versions')) {
          const id = nextId++;
          storedVersion = {
            id,
            package_id: args[0],
            version_number: args[1],
            source: args[2],
            snapshot_json: args[3],
            created_at: args[4],
            note: '',
          };
          return { rows: [{ id }], rowCount: 1 };
        }

        if (sql.startsWith('insert into agent_packages')) {
          const id = nextId++;
          storedPackage = {
            id,
            user_id: args[0],
            name: args[1],
            description: args[2],
            current_version_id: 0,
            created_at: args[3],
            updated_at: args[4],
          };
          return { rows: [{ id }], rowCount: 1 };
        }

        if (
          sql.startsWith(
            'update agent_packages set name = $1, description = $2',
          )
        ) {
          if (storedPackage) {
            storedPackage = {
              ...storedPackage,
              name: args[0],
              description: args[1],
              current_version_id: args[2],
              updated_at: args[3],
            };
          }
          return { rows: [], rowCount: 1 };
        }

        if (sql.startsWith('update agent_packages set current_version_id')) {
          if (storedPackage) {
            storedPackage = {
              ...storedPackage,
              current_version_id: args[0],
            };
          }
          return { rows: [], rowCount: 1 };
        }

        if (sql.startsWith('select * from agent_packages where id = $1')) {
          return {
            rows: storedPackage ? [storedPackage] : [],
            rowCount: storedPackage ? 1 : 0,
          };
        }

        if (
          sql.startsWith('select * from agent_package_versions where id = $1')
        ) {
          return {
            rows: storedVersion ? [storedVersion] : [],
            rowCount: storedVersion ? 1 : 0,
          };
        }

        throw new Error(`Unexpected query: ${sql}`);
      },
    ),
  }));

  vi.doMock('./skill-version-service.js', () => ({
    syncPackageVersionSkillsFromSnapshot: vi.fn().mockResolvedValue(new Map()),
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

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('./db.js');
  vi.doUnmock('./skill-version-service.js');
  vi.doUnmock('./llm-service.js');
  queryMock.mockReset();
  generateJsonMock.mockReset();
  streamTextMock.mockReset();
});

describe('generatePackage', () => {
  it('builds a one-Skill snapshot without persisting it', async () => {
    generateJsonMock.mockResolvedValue({
      name: '课堂反馈 Skill',
      description: '帮助教师生成课堂反馈。',
      skills: [
        {
          dirName: 'class-feedback',
          name: '课堂反馈',
          description: 'Use this when a teacher needs structured classroom feedback.',
        },
        {
          dirName: 'extra-skill',
          name: '额外能力',
          description: '不应在引导创建模式中生成。',
        },
      ],
    });
    let streamCall = 0;
    streamTextMock.mockImplementation(() => {
      streamCall += 1;
      return (async function* () {
        yield streamCall === 1
          ? '# Runtime\n\nInternal runtime instructions.\n'.repeat(20)
          : makeLongSkillMarkdown();
      })();
    });

    const { buildGeneratedPackageSnapshot } = await loadService();
    const snapshot = await buildGeneratedPackageSnapshot({
      instruction: '创建一个课堂反馈 Skill',
      max_skills: 1,
    });

    expect(snapshot.skills).toHaveLength(1);
    expect(snapshot.skills[0]?.name).toBe('课堂反馈');
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('leaves rubric empty when no source rubric is provided', async () => {
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
      return (async function* () {
        yield makeLongSkillMarkdown();
      })();
    });

    const { generatePackage, hasConfiguredRubricText } = await loadService();
    const detail = await generatePackage('user-1', 'Create a test package');

    expect(detail.name).toBe('Test Agent');
    expect(detail.snapshot.rubricMd).toBe('');
    expect(hasConfiguredRubricText(detail.snapshot.rubricMd)).toBe(false);
    expect(detail.snapshot.skills).toHaveLength(1);
    expect(streamTextMock).toHaveBeenCalledTimes(2);
  });

  it('starts skill generation in parallel after the agent is generated', async () => {
    generateJsonMock.mockResolvedValue({
      name: 'Test Agent',
      description: 'Handle test requests.',
      skills: [
        {
          dirName: 'core-task',
          name: 'Core Task',
          description: 'Use this when the user needs the primary task handled.',
        },
        {
          dirName: 'safety-check',
          name: 'Safety Check',
          description: 'Use this when the user needs risk boundaries checked.',
        },
      ],
    });

    let releaseFirstSkill!: () => void;
    const firstSkillMayContinue = new Promise<void>((resolve) => {
      releaseFirstSkill = resolve;
    });
    let secondSkillStartedBeforeFirstReleased = false;
    let firstSkillReleased = false;
    let streamCall = 0;

    streamTextMock.mockImplementation(() => {
      streamCall += 1;
      if (streamCall === 1) {
        return (async function* () {
          yield '# Test Agent\n\nAgent instructions.\n'.repeat(20);
        })();
      }
      if (streamCall === 2) {
        return (async function* () {
          await firstSkillMayContinue;
          yield makeLongSkillMarkdown();
        })();
      }
      if (!firstSkillReleased) {
        secondSkillStartedBeforeFirstReleased = true;
      }
      return (async function* () {
        yield makeLongSkillMarkdown();
      })();
    });

    const { generatePackage } = await loadService();
    const generating = generatePackage('user-1', 'Create a test package');

    await vi.waitFor(() => {
      expect(streamTextMock).toHaveBeenCalledTimes(3);
    });
    firstSkillReleased = true;
    releaseFirstSkill();
    const detail = await generating;

    expect(secondSkillStartedBeforeFirstReleased).toBe(true);
    expect(detail.snapshot.skills.map((skill) => skill.dirName)).toEqual([
      'core-task',
      'safety-check',
    ]);
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

  it('caps generated package names to a compact length', async () => {
    generateJsonMock.mockResolvedValue({
      name: '这是一个非常非常非常长的乡村中学心理干预智能体名字需要被截断',
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
      return (async function* () {
        yield makeLongSkillMarkdown();
      })();
    });

    const { generatePackage } = await loadService();
    const detail = await generatePackage('user-1', 'Create a test package');

    expect(Array.from(detail.name).length).toBeLessThanOrEqual(24);
    expect(
      '这是一个非常非常非常长的乡村中学心理干预智能体名字需要被截断'.startsWith(
        detail.name,
      ),
    ).toBe(true);
    expect(detail.name).not.toBe(
      '这是一个非常非常非常长的乡村中学心理干预智能体名字需要被截断',
    );
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
    expect(detail.snapshot.rubricMd).toContain(
      'Safety and referral boundaries',
    );
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
      {
        name: 'rubric-source.md',
        content: makeIncompleteSourceRubricDocument(),
      },
    ]);

    expect(detail.snapshot.rubricMd).toContain('Behavior assessment');
    expect(detail.snapshot.rubricMd).toContain('Intervention variety');
    expect(hasConfiguredRubricText(detail.snapshot.rubricMd)).toBe(true);
    expect(streamTextMock).toHaveBeenCalledTimes(2);
  });

  it('does not ask the model to generate rubric when no source rubric exists', async () => {
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
    const detail = await generatePackage('user-1', 'Create a conflict coach');

    expect(detail.snapshot.rubricMd).toBe('');
    expect(hasConfiguredRubricText(detail.snapshot.rubricMd)).toBe(false);
    expect(streamTextMock).toHaveBeenCalledTimes(2);
  });

  it('extracts a rubric from docx raw text without AI repair', async () => {
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
      { name: 'task.docx', content: makeDocxRawRubricDocument() },
    ]);

    expect(detail.snapshot.rubricMd).toContain('Boundary language quality');
    expect(detail.snapshot.rubricMd).not.toContain('## Case comparison');
    expect(detail.snapshot.rubricMd).not.toContain('## References');
    expect(streamTextMock).toHaveBeenCalledTimes(2);
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
      {
        name: 'rubric-source.docx',
        content: makeStandaloneWeightedRubricDocument(),
      },
    ]);

    expect(detail.snapshot.rubricMd).toContain(
      '中职家校冲突处置顾问 - 评估量表',
    );
    expect(detail.snapshot.rubricMd).toContain(
      '维度一：文档保真度与知识准确性',
    );
    expect(detail.snapshot.rubricMd).toContain('维度四：工具可执行性');
    expect(hasConfiguredRubricText(detail.snapshot.rubricMd)).toBe(true);
    expect(streamTextMock).toHaveBeenCalledTimes(2);
  });

  it('extracts an embedded legacy rubric block instead of the whole document', async () => {
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
      { name: 'task-outline.md', content: makeEmbeddedLegacyRubricDocument() },
    ]);

    expect(detail.snapshot.rubricMd).toContain('风险识别');
    expect(detail.snapshot.rubricMd).toContain('话术可用性');
    expect(detail.snapshot.rubricMd).not.toContain(
      '任务背景：先介绍项目目标和用户对象。',
    );
    expect(detail.snapshot.rubricMd).not.toContain('附录：这里是后续参考资料');
    expect(hasConfiguredRubricText(detail.snapshot.rubricMd)).toBe(true);
    expect(streamTextMock).toHaveBeenCalledTimes(2);
  });

  it('keeps a concise weighted 5-section rubric directly when it is already usable', async () => {
    generateJsonMock.mockResolvedValue({
      name: 'Classroom Workflow Coach',
      description: 'Help teachers organize long vocational classroom sessions.',
      skills: [
        {
          dirName: 'core-task',
          name: 'Core Task',
          description: 'Use this when the user needs the primary task handled.',
        },
      ],
    });

    const sourceRubric = [
      '5、评价准则（基于智能体输出的评价维度）',
      '',
      '时间节奏设计合理性 25% 清晰划分三阶段并给出转场指令',
      '角色分工清晰度 25% 明确汇报员、AI检索员、记录员、监察员职责',
      'AI协作的风险管控 25% 限制 AI 直接代做并给出监管方法',
      '学生融入与差异适配 25% 为基础差学生设计阶梯角色',
    ].join('\n');

    let streamCall = 0;
    streamTextMock.mockImplementation(() => {
      streamCall += 1;
      if (streamCall === 1) {
        return (async function* () {
          yield '# Classroom Workflow Coach\n\nAgent instructions.\n'.repeat(
            20,
          );
        })();
      }
      return (async function* () {
        yield makeLongSkillMarkdown();
      })();
    });

    const { generatePackage, hasConfiguredRubricText } = await loadService();
    const detail = await generatePackage('user-1', '', undefined, [
      { name: 'classroom-rubric.md', content: sourceRubric },
    ]);

    expect(detail.snapshot.rubricMd).toContain('时间节奏设计合理性');
    expect(detail.snapshot.rubricMd).toContain('AI协作的风险管控');
    expect(hasConfiguredRubricText(detail.snapshot.rubricMd)).toBe(true);
    expect(detail.snapshot.rubricMd).not.toContain('## 原始 rubric 要点');
    expect(streamTextMock).toHaveBeenCalledTimes(2);
  });

  it('keeps a usable 5-section rubric directly without folding in later support sections', async () => {
    generateJsonMock.mockResolvedValue({
      name: 'Parent Communication Coach',
      description: 'Help teachers communicate with difficult parents.',
      skills: [
        {
          dirName: 'core-task',
          name: 'Core Task',
          description: 'Use this when the user needs the primary task handled.',
        },
      ],
    });

    const sourceRubric = [
      '5、评价准则（基于智能体输出的评价维度）',
      '对智能体沟通建议的评价：',
      '',
      '维度\t权重\t优秀（A）\t合格（B）\t不合格（C）',
      '沟通策略的针对性\t30%\t准确识别家长的心理防御机制和身份焦虑\t基本识别了问题\t建议过于通用',
      '证据呈现的有效性\t25%\t强调用“具体行为记录”替代“主观评价”\t有证据思维\t仍然依赖主观描述',
      '',
      '6、案例对比',
      '正面案例（访谈中专家教师的实际做法）：',
      '情境：面对自称教授、父亲即将升职为教授的家长。',
      '反面案例（典型的育人误区）：',
      '主观评价陷阱：仅凭主观印象与家长沟通。',
      '',
      '8、测试情景（10个）',
      '情景1：权威与否认的对峙',
      '教师说：“我拿不出证据，家长就否认，我该怎样处理？”',
      '',
      '7、规范依据',
      '《中小学教师职业道德规范》（2008年修订）',
      '《义务教育学校管理标准》（教基〔2017〕9号）',
    ].join('\n');

    let streamCall = 0;
    streamTextMock.mockImplementation(() => {
      streamCall += 1;
      if (streamCall === 1) {
        return (async function* () {
          yield '# Parent Communication Coach\n\nAgent instructions.\n'.repeat(
            20,
          );
        })();
      }
      return (async function* () {
        yield makeLongSkillMarkdown();
      })();
    });

    const { generatePackage, hasConfiguredRubricText } = await loadService();
    const detail = await generatePackage('user-1', '', undefined, [
      { name: 'communication-rubric.md', content: sourceRubric },
    ]);

    expect(hasConfiguredRubricText(detail.snapshot.rubricMd)).toBe(true);
    expect(detail.snapshot.rubricMd).toContain('沟通策略的针对性');
    expect(detail.snapshot.rubricMd).not.toContain('6、案例对比');
    expect(detail.snapshot.rubricMd).not.toContain('8、测试情景（10个）');
    expect(detail.snapshot.rubricMd).not.toContain('7、规范依据');
    expect(streamTextMock).toHaveBeenCalledTimes(2);
  });
});
