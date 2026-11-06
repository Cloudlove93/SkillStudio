import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AgentPackageSnapshot,
  AgentWorkspaceInput,
  ArenaThread,
  PackageSkill,
  SkillArenaConfig,
} from '@educlaw/shared';

const queryMock = vi.fn();
const transactionMock = vi.fn();
const detailMock = vi.fn();

type Pkg = {
  id: string;
  userId: string;
  name: string;
  description: string;
  model: string;
  currentVersionId: string;
  createdAt: string;
  updatedAt: string;
};
type PkgVersion = {
  id: string;
  packageId: string;
  versionNumber: number;
  snapshot: AgentPackageSnapshot;
};
type SkillRow = {
  id: string;
  packageId: string;
  uid: string;
  dirName: string;
  displayName: string | null;
  name: string;
  description: string;
  status: string;
};
type SkillVersionRow = {
  id: string;
  skillId: string;
  packageId: string;
  versionNumber: number;
  status: string;
  skill: PackageSkill;
};
type Link = {
  packageVersionId: string;
  packageId: string;
  skillId: string;
  skillVersionId: string;
  sortOrder: number;
};

let packages: Map<string, Pkg>;
let versions: Map<string, PkgVersion>;
let skills: Map<string, SkillRow>;
let skillVersions: Map<string, SkillVersionRow>;
let links: Link[];
let threads: Map<string, { userId: string; thread: ArenaThread }>;
let skillSequence: number;
let versionSequence: number;
let packageSequence: number;
let packageVersionSequence: number;
let service: typeof import('./agent-workspace-service.js');

class PackageVersionConflictError extends Error {
  readonly code = 'PACKAGE_VERSION_CONFLICT';
  readonly status = 409;
  constructor() {
    super('PACKAGE_VERSION_CONFLICT');
    this.name = 'PackageVersionConflictError';
  }
}

const binding = (skillId = '11', skillVersionId = '101', enabled = true) => ({
  skillId,
  skillVersionId,
  enabled,
});
const input = (
  name = 'Teaching Agent',
  skills = [binding()],
): AgentWorkspaceInput => ({
  name,
  description: 'Teaching',
  instructions: 'Use the mounted procedures.',
  model: 'fixed-model',
  skills,
});

const now = '2026-11-04T00:00:00.000Z';

function seedPackage(id: string, userId: string) {
  packages.set(id, {
    id,
    userId,
    name: 'Source package',
    description: '',
    model: '',
    currentVersionId: '0',
    createdAt: now,
    updatedAt: now,
  });
}

function seedSkillVersion(options: {
  versionId: string;
  skillId: string;
  packageId: string;
  userId?: string;
  uid: string;
  name: string;
  skillMd: string;
  versionStatus?: string;
  skillStatus?: string;
}) {
  seedPackage(options.packageId, options.userId || 'owner');
  skills.set(options.skillId, {
    id: options.skillId,
    packageId: options.packageId,
    uid: options.uid,
    dirName: options.uid,
    displayName: options.name,
    name: options.name,
    description: `${options.name} description`,
    status: options.skillStatus || 'active',
  });
  skillVersions.set(options.versionId, {
    id: options.versionId,
    skillId: options.skillId,
    packageId: options.packageId,
    versionNumber: 1,
    status: options.versionStatus || 'active',
    skill: {
      id: options.uid,
      dirName: options.uid,
      name: options.name,
      description: `${options.name} description`,
      skillMd: options.skillMd,
    },
  });
}

function syncSnapshot(
  packageId: string,
  packageVersionId: string,
  snapshot: AgentPackageSnapshot,
) {
  snapshot.skills.forEach((skill, index) => {
    let skillRow = [...skills.values()].find(
      (row) => row.packageId === packageId && row.uid === skill.id,
    );
    if (!skillRow) {
      const id = String(++skillSequence);
      skillRow = {
        id,
        packageId,
        uid: skill.id,
        dirName: skill.dirName,
        displayName: skill.name,
        name: skill.name,
        description: skill.description,
        status: 'active',
      };
      skills.set(id, skillRow);
    }
    const skillVersionId = String(++versionSequence);
    skillVersions.set(skillVersionId, {
      id: skillVersionId,
      skillId: skillRow.id,
      packageId,
      versionNumber: 1,
      status: 'active',
      skill,
    });
    links.push({
      packageVersionId,
      packageId,
      skillId: skillRow.id,
      skillVersionId,
      sortOrder: index,
    });
  });
}

const result = (rows: unknown[]) => ({
  rows: structuredClone(rows),
  rowCount: rows.length,
});

const encodePackage = (row: Pkg) => ({
  id: row.id,
  user_id: row.userId,
  name: row.name,
  description: row.description,
  model: row.model,
  current_version_id: row.currentVersionId,
  created_at: row.createdAt,
  updated_at: row.updatedAt,
});

beforeEach(async () => {
  vi.resetModules();
  packages = new Map();
  versions = new Map();
  skills = new Map();
  skillVersions = new Map();
  links = [];
  threads = new Map();
  skillSequence = 0;
  versionSequence = 0;
  packageSequence = 0;
  packageVersionSequence = 0;

  seedSkillVersion({
    versionId: '101',
    skillId: '11',
    packageId: '7',
    uid: 'procedure-a',
    name: 'Procedure A',
    skillMd: 'BODY_A',
  });
  seedSkillVersion({
    versionId: '202',
    skillId: '12',
    packageId: '8',
    uid: 'procedure-b',
    name: 'Procedure B',
    skillMd: 'BODY_B',
  });
  seedSkillVersion({
    versionId: '303',
    skillId: '13',
    packageId: '9',
    userId: 'other',
    uid: 'procedure-c',
    name: 'Procedure C',
    skillMd: 'BODY_C',
  });

  queryMock
    .mockReset()
    .mockImplementation(async (text: string, args: unknown[] = []) => {
      const sql = text.replace(/\s+/g, ' ').trim();
      if (sql.startsWith('select * from agent_packages where id')) {
        const row = packages.get(String(args[0]));
        return result(
          row && row.userId === args[1] ? [encodePackage(row)] : [],
        );
      }
      if (sql.startsWith('select * from agent_packages where user_id')) {
        return result(
          [...packages.values()]
            .filter((row) => row.userId === args[0])
            .sort(
              (a, b) =>
                b.updatedAt.localeCompare(a.updatedAt) ||
                Number(b.id) - Number(a.id),
            )
            .map(encodePackage),
        );
      }
      if (sql.startsWith('select snapshot_json from agent_package_versions')) {
        const row = versions.get(String(args[0]));
        return result(
          row && row.packageId === args[1]
            ? [{ snapshot_json: row.snapshot }]
            : [],
        );
      }
      if (sql.startsWith('select link.skill_id')) {
        return result(
          links
            .filter(
              (link) =>
                link.packageId === args[0] && link.packageVersionId === args[1],
            )
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((link) => {
              const skill = skills.get(link.skillId)!;
              const version = skillVersions.get(link.skillVersionId)!;
              return {
                skill_id: link.skillId,
                skill_version_id: link.skillVersionId,
                skill_uid: skill.uid,
                dir_name: skill.dirName,
                name: skill.displayName || skill.name,
                description: skill.description,
                version_number: version.versionNumber,
                skill_snapshot_json: version.skill,
              };
            }),
        );
      }
      if (sql.startsWith('select s.skill_uid, s.dir_name')) {
        const version = skillVersions.get(String(args[0]));
        const skill = skills.get(String(args[1]));
        const owner = packages.get(skill?.packageId || '');
        return result(
          version && skill && owner?.userId === args[2]
            ? [
                {
                  skill_uid: skill.uid,
                  dir_name: skill.dirName,
                  display_name: skill.displayName,
                  description: skill.description,
                  version_number: version.versionNumber,
                  status: version.status,
                  skill_status: skill.status,
                  skill_snapshot_json: version.skill,
                  package_id: skill.packageId,
                  skill_id: skill.id,
                },
              ]
            : [],
        );
      }
      if (
        sql.startsWith('select status, package_id, skill_id from skill_guided')
      ) {
        const sessions = (globalThis as Record<string, unknown>)
          .__agentSessions as Array<Record<string, unknown>>;
        return result(
          (sessions || []).filter(
            (row) => String(row.id) === args[0] && row.user_id === args[1],
          ),
        );
      }
      if (sql.startsWith('select s.package_id from agent_package_skills')) {
        const skill = skills.get(String(args[0]));
        const owner = packages.get(skill?.packageId || '');
        return result(
          skill && owner?.userId === args[1]
            ? [{ package_id: skill.packageId }]
            : [],
        );
      }
      if (sql.startsWith('select id from arena_threads')) {
        return result(
          [...threads.values()]
            .filter(
              (entry) =>
                entry.userId === args[0] &&
                entry.thread.packageId === Number(args[1]) &&
                entry.thread.skillArenaConfig?.agentRequestId,
            )
            .map((entry) => ({ id: String(entry.thread.id) })),
        );
      }
      if (sql.startsWith('select id, arena_config_jsonb from arena_threads')) {
        const found = [...threads.values()].find(
          (entry) =>
            entry.userId === args[0] &&
            entry.thread.packageId === Number(args[1]) &&
            entry.thread.skillArenaConfig?.agentRequestId === args[2],
        );
        return result(
          found
            ? [
                {
                  id: String(found.thread.id),
                  arena_config_jsonb: found.thread.skillArenaConfig,
                },
              ]
            : [],
        );
      }
      if (sql.startsWith('insert into arena_threads')) {
        const id = String(threads.size + 91);
        const config = JSON.parse(String(args[5])) as SkillArenaConfig;
        threads.set(id, {
          userId: String(args[0]),
          thread: {
            id: Number(id),
            packageId: Number(args[1]),
            title: String(args[2]),
            model: args[3] as string | null,
            arenaKind: 'skill_arena',
            basePackageVersionId: String(args[4]),
            skillArenaConfig: config,
            createdAt: String(args[6]),
            updatedAt: String(args[6]),
          },
        });
        return result([{ id }]);
      }
      if (sql.startsWith('insert into arena_thread_variants'))
        return result([]);
      throw new Error(`Unexpected query: ${sql}`);
    });

  vi.doMock('./db.js', () => ({
    query: queryMock,
    withTransaction: transactionMock,
  }));
  vi.doMock('./arena-service.js', () => ({ getThreadDetail: detailMock }));
  vi.doMock('./package-service.js', () => ({
    PackageVersionConflictError,
    createPackageWithSnapshotTx: async (
      _client: unknown,
      userId: string,
      snapshot: AgentPackageSnapshot,
      _source: string,
      model = '',
    ) => {
      const packageId = String(++packageSequence);
      const packageVersionId = String(++packageVersionSequence);
      packages.set(packageId, {
        id: packageId,
        userId,
        name: snapshot.name,
        description: snapshot.description,
        model,
        currentVersionId: packageVersionId,
        createdAt: now,
        updatedAt: now,
      });
      versions.set(packageVersionId, {
        id: packageVersionId,
        packageId,
        versionNumber: 1,
        snapshot,
      });
      syncSnapshot(packageId, packageVersionId, snapshot);
      return {
        packageId: Number(packageId),
        packageVersionId: Number(packageVersionId),
        packageVersionNumber: 1,
        skillVersionIds: {},
      };
    },
    createPackageVersionWithSnapshotTx: async (
      _client: unknown,
      request: {
        userId: string;
        packageId: string;
        expectedPackageVersionId: string;
        snapshot: AgentPackageSnapshot;
        model?: string;
      },
    ) => {
      const pkg = packages.get(String(request.packageId));
      if (!pkg || pkg.userId !== request.userId) throw new Error('not found');
      if (pkg.currentVersionId !== request.expectedPackageVersionId)
        throw new PackageVersionConflictError();
      const versionNumber =
        Math.max(
          ...[...versions.values()]
            .filter((row) => row.packageId === pkg.id)
            .map((row) => row.versionNumber),
          0,
        ) + 1;
      const packageVersionId = String(++packageVersionSequence);
      versions.set(packageVersionId, {
        id: packageVersionId,
        packageId: pkg.id,
        versionNumber,
        snapshot: request.snapshot,
      });
      syncSnapshot(pkg.id, packageVersionId, request.snapshot);
      pkg.name = request.snapshot.name;
      pkg.description = request.snapshot.description;
      pkg.model = request.model ?? pkg.model;
      pkg.currentVersionId = packageVersionId;
      pkg.updatedAt = now;
      return {
        packageId: Number(pkg.id),
        packageVersionId: Number(packageVersionId),
        packageVersionNumber: versionNumber,
        skillVersionIds: {},
      };
    },
  }));

  transactionMock.mockReset().mockImplementation(async (work) => {
    const snapshot = structuredClone({
      packages,
      versions,
      skills,
      skillVersions,
      links,
      threads,
      skillSequence,
      versionSequence,
      packageSequence,
      packageVersionSequence,
    });
    try {
      return await work({ query: queryMock });
    } catch (error) {
      packages = snapshot.packages;
      versions = snapshot.versions;
      skills = snapshot.skills;
      skillVersions = snapshot.skillVersions;
      links = snapshot.links;
      threads = snapshot.threads;
      skillSequence = snapshot.skillSequence;
      versionSequence = snapshot.versionSequence;
      packageSequence = snapshot.packageSequence;
      packageVersionSequence = snapshot.packageVersionSequence;
      throw error;
    }
  });
  detailMock
    .mockReset()
    .mockImplementation(async (userId: string, id: string) => {
      const entry = threads.get(String(id));
      if (!entry || entry.userId !== userId)
        throw new Error('Thread not owned');
      return { thread: structuredClone(entry.thread), messages: [] };
    });
  (globalThis as Record<string, unknown>).__agentSessions = [];
  service = await import('./agent-workspace-service.js');
});

afterEach(() => {
  vi.doUnmock('./db.js');
  vi.doUnmock('./arena-service.js');
  vi.doUnmock('./package-service.js');
  vi.resetModules();
});

describe('Package-backed Agents', () => {
  it('persists Agents as packages and isolates every owned operation', async () => {
    const first = await service.saveAgent('owner', input('First'));
    const second = await service.saveAgent(
      'owner',
      input('Second', [binding('12', '202')]),
    );
    const foreign = await service.saveAgent(
      'other',
      input('Private', [binding('13', '303')]),
    );
    expect(first.id).not.toBe(second.id);
    const names = (await service.listAgents('owner')).map(
      (agent) => agent.name,
    );
    expect(names).toEqual(expect.arrayContaining(['First', 'Second']));
    expect(
      (await service.listAgents('other')).map((agent) => agent.id),
    ).toEqual(expect.arrayContaining([foreign.id]));
    expect(await service.getAgent('owner', second.id)).toMatchObject({
      name: 'Second',
      instructions: 'Use the mounted procedures.',
      model: 'fixed-model',
    });
    for (const operation of [
      () => service.getAgent('other', first.id),
      () =>
        service.saveAgent(
          'other',
          { ...input('Hijacked'), expectedUpdatedAt: first.updatedAt },
          first.id,
        ),
      () => service.listAgentConversations('other', first.id),
      () =>
        service.createAgentConversation('other', first.id, {
          purpose: 'run',
          requestId: 'attack',
        }),
    ])
      await expect(operation()).rejects.toMatchObject({
        status: 404,
        code: 'AGENT_NOT_FOUND',
      });
    expect((await service.getAgent('owner', first.id)).name).toBe('First');
  });

  it('requires CAS and writes a new package version on update', async () => {
    const agent = await service.saveAgent('owner', input());
    const versionCount = () =>
      [...versions.values()].filter((v) => v.packageId === agent.id).length;
    expect(versionCount()).toBe(1);
    for (const expectedUpdatedAt of [
      undefined,
      'invalid',
      '2000-01-01T00:00:00.000Z',
    ]) {
      await expect(
        service.saveAgent(
          'owner',
          { ...input('Rejected'), expectedUpdatedAt },
          agent.id,
        ),
      ).rejects.toMatchObject({ status: 409, code: 'AGENT_CONFLICT' });
    }
    const edited = await service.saveAgent(
      'owner',
      {
        ...input('Updated', [binding('12', '202')]),
        instructions: 'New instructions',
        model: 'new-model',
        expectedUpdatedAt: agent.updatedAt,
      },
      agent.id,
    );
    expect(edited.id).toBe(agent.id);
    expect(versionCount()).toBe(2);
    expect(
      queryMock.mock.calls.some(([sql]) => sql.includes('for update')),
    ).toBe(true);
    expect(await service.getAgent('owner', agent.id)).toMatchObject({
      name: 'Updated',
      instructions: 'New instructions',
      model: 'new-model',
    });
  });

  it('rejects duplicate and malformed skill bindings before database access', async () => {
    await expect(
      service.saveAgent(
        'owner',
        input('Duplicate', [binding(), binding('11', '102')]),
      ),
    ).rejects.toMatchObject({ status: 422, code: 'INVALID_ARGUMENT' });
    expect(queryMock).not.toHaveBeenCalled();
    for (const id of ['0', '-1', '1.2', 'abc', '9007199254740992']) {
      await expect(
        service.saveAgent('owner', input('Invalid', [binding('11', id)])),
      ).rejects.toMatchObject({ status: 422 });
    }
    expect(queryMock).not.toHaveBeenCalled();
  });

  it.each([
    'missing',
    'inaccessible',
    'discarded',
    'removed',
    'empty',
  ] as const)(
    'rejects %s versions on save without leaving a package behind',
    async (scenario) => {
      const selected =
        scenario === 'inaccessible' ? binding('13', '303') : binding();
      const version = skillVersions.get('101')!;
      if (scenario === 'missing') skillVersions.delete('101');
      if (scenario === 'discarded') version.status = 'discarded';
      if (scenario === 'removed') skills.get('11')!.status = 'removed';
      if (scenario === 'empty') version.skill.skillMd = '   ';
      await expect(
        service.saveAgent('owner', input('Invalid', [selected])),
      ).rejects.toMatchObject({
        status: 422,
        code: scenario === 'empty' ? 'INVALID_ARGUMENT' : 'SKILL_UNAVAILABLE',
      });
      expect(
        [...packages.values()].filter((p) => p.userId === 'owner'),
      ).toHaveLength(2);
    },
  );
});

describe('Agent conversations on packages', () => {
  it('pins the package snapshot and replays idempotent requests', async () => {
    const agent = await service.saveAgent(
      'owner',
      input('Original', [binding(), binding('12', '202')]),
    );
    const thread = await service.createAgentConversation('owner', agent.id, {
      purpose: 'run',
      requestId: 'original',
    });
    expect(thread.packageId).toBe(Number(agent.id));
    expect(thread.skillArenaConfig).toMatchObject({
      mode: 'skill_arena',
      surface: 'run',
      agentRequestId: 'original',
      agentExecution: {
        agentId: agent.id,
        name: 'Original',
        instructions: 'Use the mounted procedures.',
        model: 'fixed-model',
        skills: [
          { skillUid: 'procedure-a', skillMd: 'BODY_A', versionNumber: 1 },
          { skillUid: 'procedure-b', skillMd: 'BODY_B', versionNumber: 1 },
        ],
      },
    });
    expect(thread.title).toContain('对话');

    const first = thread;
    skillVersions.get('101')!.status = 'discarded';
    queryMock.mockClear();
    expect(
      await service.createAgentConversation('owner', agent.id, {
        purpose: 'run',
        requestId: 'original',
      }),
    ).toEqual(first);
    expect(
      queryMock.mock.calls.some(([sql]) => sql.includes('insert into')),
    ).toBe(false);
    await expect(
      service.createAgentConversation('owner', agent.id, {
        purpose: 'test',
        requestId: 'original',
      }),
    ).rejects.toMatchObject({ status: 409, code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('requires at least one mounted skill and scopes conversations to each Agent', async () => {
    const empty = await service.saveAgent(
      'owner',
      input('Empty', [binding('11', '101', false)]),
    );
    // 停用的 Skill 必须保留在快照中，重新读取才能还原“未启用”状态。
    expect(
      (await service.getAgent('owner', empty.id)).skills.map((skill) => ({
        enabled: skill.enabled,
        available: skill.available,
      })),
    ).toEqual([{ enabled: false, available: true }]);
    await expect(
      service.createAgentConversation('owner', empty.id, {
        purpose: 'run',
        requestId: 'none',
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(threads.size).toBe(0);

    const first = await service.saveAgent('owner', input('First'));
    const second = await service.saveAgent(
      'owner',
      input('Second', [binding('12', '202')]),
    );
    const a = await service.createAgentConversation('owner', first.id, {
      purpose: 'run',
      requestId: 'same',
    });
    const b = await service.createAgentConversation('owner', second.id, {
      purpose: 'test',
      requestId: 'same',
    });
    expect(a.id).not.toBe(b.id);
    expect(await service.listAgentConversations('owner', first.id)).toEqual([
      a,
    ]);
    expect(await service.listAgentConversations('owner', second.id)).toEqual([
      b,
    ]);
  });

  it.each([
    null,
    {},
    { purpose: 'arena', requestId: 'id' },
    { purpose: 'run', requestId: '   ' },
  ])(
    'rejects invalid conversation input %# before database access',
    async (body) => {
      await expect(
        service.createAgentConversation('owner', '1', body),
      ).rejects.toMatchObject({ status: 422 });
      expect(queryMock).not.toHaveBeenCalled();
    },
  );
});

describe('Agent provisioning', () => {
  it('converts a legacy package in place once without creating another Skill', async () => {
    const agent = await service.saveAgent('owner', {
      ...input('Legacy'),
      instructions: '',
      model: '',
    });
    const skillCount = skills.size;
    const packageCount = packages.size;
    const first = await service.provisionAgent('owner', {
      skillId: agent.skills[0]!.skillId,
    });
    expect(first.id).toBe(agent.id);
    expect(first.instructions).toContain('教学助手');
    expect(first.model).toBeTruthy();
    const versionCount = versions.size;
    await service.provisionAgent('owner', {
      skillId: agent.skills[0]!.skillId,
    });
    expect(versions.size).toBe(versionCount);
    expect(skills.size).toBe(skillCount);
    expect(packages.size).toBe(packageCount);
  });
  it('returns the generated package behind a completed session', async () => {
    const agent = await service.saveAgent('owner', input('Generated'));
    (globalThis as Record<string, unknown>).__agentSessions = [
      {
        id: '55',
        user_id: 'owner',
        status: 'completed',
        package_id: agent.id,
        skill_id: null,
      },
    ];
    expect(
      await service.provisionAgent('owner', { sessionId: '55' }),
    ).toMatchObject({
      id: agent.id,
      name: 'Generated',
    });
  });

  it('resolves the owning package from a skill and refuses foreign or unfinished sources', async () => {
    const agent = await service.saveAgent('owner', input('From skill'));
    const [skillId] = [...skills.values()]
      .filter((row) => row.packageId === agent.id)
      .map((row) => row.id);
    expect(await service.provisionAgent('owner', { skillId })).toMatchObject({
      id: agent.id,
      name: 'From skill',
    });
    (globalThis as Record<string, unknown>).__agentSessions = [
      { id: '56', user_id: 'owner', status: 'in_progress', package_id: null },
    ];
    await expect(
      service.provisionAgent('owner', { sessionId: '56' }),
    ).rejects.toMatchObject({ status: 409, code: 'SESSION_NOT_READY' });
    await expect(
      service.provisionAgent('other', { skillId }),
    ).rejects.toMatchObject({ status: 422, code: 'SKILL_UNAVAILABLE' });
  });
});

it('keeps independent same-name Skills and rejects colliding Skill identifiers', async () => {
  skillVersions.get('202')!.skill.name = skillVersions.get('101')!.skill.name;
  const agent = await service.saveAgent(
    'owner',
    input('Same names', [binding(), binding('12', '202')]),
  );
  expect(agent.skills).toHaveLength(2);
  skillVersions.get('202')!.skill.id = skillVersions.get('101')!.skill.id;
  skillVersions.get('202')!.skill.dirName =
    skillVersions.get('101')!.skill.dirName;
  await expect(
    service.saveAgent(
      'owner',
      input('Conflicting identifiers', [binding(), binding('12', '202')]),
    ),
  ).rejects.toMatchObject({ status: 422 });
});
