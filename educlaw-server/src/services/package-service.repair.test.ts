import { afterEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const streamTextMock = vi.fn();
const generateTextMock = vi.fn();

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

const incompleteRubric = [
  'Evaluation draft',
  '',
  '1. Evidence fidelity',
  'Keep answers grounded in the uploaded scenario.',
  '',
  '2. Family engagement',
  'Avoid forcing unrealistic parent coordination.',
].join('\n');

const completeRubric = [
  '# Rubric',
  '',
  '## 评分目标',
  '- Score whether the response stays grounded, usable, and safe.',
  '',
  '## 评分维度',
  '### 角色贴合',
  '- Full score: the reply stays aligned with the agent role and audience.',
  '',
  '### Skill 遵循',
  '- Full score: the reply uses the expected skill workflow and constraints.',
  '',
  '### 回答质量',
  '- Full score: keep evidence fidelity and family engagement guidance from the draft.',
  '',
  '### 安全边界',
  '- Full score: clearly escalates high-risk cases and avoids unsafe advice.',
  '',
  '## 使用说明',
  '- Score each dimension first, then give a final summary.',
].join('\n');

function createSeedState(rubricMd = incompleteRubric): SeedState {
  const snapshot = {
    name: 'Homework Reform Coach',
    description: 'Support teachers with practical assignment redesign.',
    versionLabel: 'v1',
    agentMd:
      '# Agent\n\nHelp teachers redesign homework with realistic classroom constraints.\n'.repeat(
        8,
      ),
    rubricMd,
    skills: [
      {
        id: 'skill-1',
        dirName: 'core-task',
        name: 'Core Task',
        description: 'Handle the main package workflow.',
        skillMd: [
          '---',
          'name: core-task',
          'description: Handle the main package workflow.',
          '---',
          '',
          '# Core Task',
          '',
          '## Instructions',
          '- Give clear steps.',
          '',
          '## Workflow',
          '1. Review the request.',
          '',
          '## Output Format',
          '- Plan',
          '',
          '## Examples',
          '- Example',
          '',
          '## Common Issues',
          '- Missing context',
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
      created_at: '2026-06-27T00:00:00.000Z',
      updated_at: '2026-06-27T00:00:00.000Z',
    },
    versions: [
      {
        id: 1,
        package_id: 1,
        version_number: 1,
        source: 'generated',
        snapshot_json: JSON.stringify(snapshot),
        created_at: '2026-06-27T00:00:00.000Z',
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
              .sort((a, b) => b.version_number - a.version_number)[0] || null;
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
            created_at: String(args[5] || args[4]),
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
  streamTextMock.mockReset();
  generateTextMock.mockReset();
});

describe('repairPackageRubric', () => {
  it('rejects repair when the current package has no rubric yet', async () => {
    const state = createSeedState('');
    generateTextMock.mockResolvedValue(completeRubric);

    const { repairPackageRubric } = await loadService(state);

    await expect(repairPackageRubric('user-1', 1)).rejects.toThrow('rubric');
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it('rejects repair when the current rubric is incomplete', async () => {
    const state = createSeedState();
    generateTextMock.mockResolvedValue(completeRubric);

    const { repairPackageRubric } = await loadService(state);

    await expect(repairPackageRubric('user-1', 1)).rejects.toThrow('rubric');
    expect(streamTextMock).not.toHaveBeenCalled();
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it('returns the current package unchanged when the rubric is already usable', async () => {
    const state = createSeedState(completeRubric);

    const { repairPackageRubric } = await loadService(state);
    const detail = await repairPackageRubric('user-1', 1);

    expect(streamTextMock).not.toHaveBeenCalled();
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(detail.versionNumber).toBe(1);
    expect(detail.snapshot.rubricMd).toBe(completeRubric);
  });
});

describe('optimizePackageRubric', () => {
  it('optimizes an existing scorable rubric without entering interactive optimization', async () => {
    const state = createSeedState(completeRubric);
    const optimizedRubric = `${completeRubric}\n- Keep scoring language even tighter.`;
    generateTextMock.mockResolvedValue(optimizedRubric);

    const { optimizePackageRubric } = await loadService(state);
    const detail = await optimizePackageRubric('user-1', 1);

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(generateTextMock.mock.calls[0]?.[0]?.userPrompt).toContain(
      'Optimize the existing rubric.md',
    );
    expect(detail.versionNumber).toBe(2);
    expect(detail.snapshot.rubricMd).toContain(
      'Keep scoring language even tighter.',
    );
  });

  it('rejects optimization when the current rubric is still incomplete', async () => {
    const state = createSeedState(incompleteRubric);
    generateTextMock.mockResolvedValue(completeRubric);

    const { optimizePackageRubric } = await loadService(state);

    await expect(optimizePackageRubric('user-1', 1)).rejects.toThrow('rubric');
    expect(generateTextMock).not.toHaveBeenCalled();
  });
});
