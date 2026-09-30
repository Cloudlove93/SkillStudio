import { afterEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const generateTextMock = vi.fn();
const streamTextMock = vi.fn();

interface VersionRow {
  id: string | number;
  package_id: string | number;
  version_number: number;
  source: string;
  snapshot_json: string;
  created_at: string;
  note: string;
}

interface SeedState {
  packageRow: {
    id: string | number;
    user_id: string;
    name: string;
    description: string;
    current_version_id: string | number;
    created_at: string;
    updated_at: string;
  };
  versions: VersionRow[];
}

const pollutedStoredRubric = [
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
  '8、测试情景（10个）',
  '情景1：口令的设计标准。',
].join('\n');

const cleanedRubric = [
  '5、评价准则（基于智能体输出的评价维度）',
  '',
  '维度\t权重\t优秀（A）\t合格（B）\t不合格（C）',
  '口令设计的科学性\t30%\t口令动作简洁易记\t口令基本合理\t口令复杂或不符合儿童特点',
  '节奏感的掌握程度\t25%\t课堂节奏设计科学\t课堂节奏基本合理\t节奏不稳定',
].join('\n');

function createSeedState(rubricMd = pollutedStoredRubric): SeedState {
  const snapshot = {
    name: '低学段课堂口令与节奏设计助手',
    description:
      '帮助小学低学段教师设计动作化口令与节奏化教学方案，建立可持续的课堂管理系统。',
    versionLabel: 'v1',
    agentMd: '# Agent\n\nDesign classroom cue systems.\n',
    rubricMd,
    skills: [
      {
        id: 'skill-1',
        dirName: 'core-skill',
        name: 'Core Skill',
        description: 'Handle classroom design guidance.',
        skillMd: [
          '---',
          'name: core-skill',
          'description: Handle classroom design guidance.',
          '---',
          '',
          '# Core Skill',
        ].join('\n'),
      },
    ],
  };

  return {
    packageRow: {
      id: 1,
      user_id: 'user-1',
      name: snapshot.name,
      description: snapshot.description,
      current_version_id: 1,
      created_at: '2026-06-28T00:00:00.000Z',
      updated_at: '2026-06-28T00:00:00.000Z',
    },
    versions: [
      {
        id: 1,
        package_id: 1,
        version_number: 1,
        source: 'generated',
        snapshot_json: JSON.stringify(snapshot),
        created_at: '2026-06-28T00:00:00.000Z',
        note: '',
      },
    ],
  };
}

async function loadService(state: SeedState) {
  vi.resetModules();

  let nextId = state.versions.length + 1;

  vi.doMock('./db.js', () => ({
    withTransaction: async (
      work: (client: { query: typeof queryMock }) => Promise<unknown>,
    ) => work({ query: queryMock }),
    query: queryMock.mockImplementation(
      async (sql: string, args: unknown[]) => {
        if (
          sql.startsWith(
            'select * from agent_packages where id = $1 and user_id = $2',
          )
        ) {
          const row =
            state.packageRow.id === args[0] &&
            state.packageRow.user_id === args[1]
              ? state.packageRow
              : null;
          return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
        }

        if (
          sql.startsWith('select * from agent_package_versions where id = $1')
        ) {
          const version =
            state.versions.find((item) => item.id === args[0]) || null;
          return { rows: version ? [version] : [], rowCount: version ? 1 : 0 };
        }

        if (
          sql.startsWith(
            'select * from agent_package_versions where package_id = $1 order by version_number desc limit 1',
          )
        ) {
          const version =
            [...state.versions]
              .filter((item) => item.package_id === args[0])
              .sort(
                (left, right) => right.version_number - left.version_number,
              )[0] || null;
          return { rows: version ? [version] : [], rowCount: version ? 1 : 0 };
        }

        if (sql.startsWith('insert into agent_package_versions')) {
          const id = nextId++;
          state.versions.push({
            id,
            package_id: args[0],
            version_number: Number(args[1]),
            source: String(args[2]),
            snapshot_json: String(args[3]),
            note: String(args[4] || ''),
            created_at: String(args[5] || ''),
          });
          return { rows: [{ id }], rowCount: 1 };
        }

        if (
          sql.startsWith(
            'update agent_packages set name = $1, description = $2, current_version_id = $3, updated_at = $4 where id = $5 and user_id = $6',
          )
        ) {
          state.packageRow = {
            ...state.packageRow,
            name: String(args[0]),
            description: String(args[1]),
            current_version_id: args[2],
            updated_at: String(args[3]),
          };
          return { rows: [], rowCount: 1 };
        }

        throw new Error(`Unexpected query: ${sql}`);
      },
    ),
  }));

  vi.doMock('./skill-version-service.js', () => ({
    syncPackageVersionSkillsFromSnapshot: vi.fn(),
  }));

  vi.doMock('./llm-service.js', () => ({
    generateJson: vi.fn(),
    generateText: generateTextMock,
    generateChat: vi.fn(),
    streamText: streamTextMock,
  }));

  return import('./package-service.js');
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('./db.js');
  vi.doUnmock('./skill-version-service.js');
  vi.doUnmock('./llm-service.js');
  queryMock.mockReset();
  generateTextMock.mockReset();
  streamTextMock.mockReset();
});

describe('rubric actions', () => {
  it('cleans rubric content before saving a manual rubric edit', async () => {
    const state = createSeedState();
    const { applyManualMarkdownEdit } = await loadService(state);

    const detail = await applyManualMarkdownEdit('user-1', 1, {
      target: 'rubric',
      content: pollutedStoredRubric,
      note: 'manual cleanup',
    });

    expect(detail.versionNumber).toBe(2);
    expect(detail.snapshot.rubricMd).toBe(cleanedRubric);
  });

  it('repairs polluted stored rubric by saving the cleaned body first', async () => {
    const state = createSeedState();
    const { repairPackageRubric } = await loadService(state);

    const detail = await repairPackageRubric('user-1', 1);

    expect(generateTextMock).not.toHaveBeenCalled();
    expect(detail.versionNumber).toBe(2);
    expect(detail.snapshot.rubricMd).toBe(cleanedRubric);
  });

  it('cleans a polluted rubric during AI optimize before calling the model', async () => {
    const state = createSeedState();
    const { optimizePackageRubric } = await loadService(state);

    const detail = await optimizePackageRubric('user-1', 1);

    expect(generateTextMock).not.toHaveBeenCalled();
    expect(detail.versionNumber).toBe(2);
    expect(detail.snapshot.rubricMd).toBe(cleanedRubric);
  });

  it('sends only the cleaned rubric body into AI optimize when the rubric is already clean', async () => {
    const state = createSeedState(cleanedRubric);
    generateTextMock.mockImplementation(
      async (input: { userPrompt: string }) => {
        expect(input.userPrompt).toContain('口令设计的科学性');
        expect(input.userPrompt).not.toContain('案例对比');
        expect(input.userPrompt).not.toContain('测试情景');
        return `${cleanedRubric}\n课堂节奏的可持续性\t20%\t能长期稳定执行\t基本可维持\t长期效果不佳`;
      },
    );

    const { optimizePackageRubric } = await loadService(state);
    const detail = await optimizePackageRubric('user-1', 1);

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(detail.versionNumber).toBe(2);
    expect(detail.snapshot.rubricMd).not.toContain('案例对比');
    expect(detail.snapshot.rubricMd).not.toContain('测试情景');
  });
});
