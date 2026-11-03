import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentWorkspaceInput, ArenaThread } from '@educlaw/shared';

const queryMock = vi.fn();
const transactionMock = vi.fn();
const detailMock = vi.fn();
type AgentRow = {
  id: string;
  user_id: string;
  name: string;
  description: string;
  instructions: string;
  model: string;
  skills_json: AgentWorkspaceInput['skills'];
  created_at: string;
  updated_at: string;
};
type VersionRow = {
  skill_id: string;
  user_id: string;
  package_id: string;
  current_version_id: string;
  skill_uid: string;
  version_number: number;
  status: string;
  skill_status: string;
  display_name: string;
  skill_snapshot_json: { name: string; description: string; skillMd: string };
};
let agents: Map<string, AgentRow>;
let versions: Map<string, VersionRow>;
let threads: Map<string, { userId: string; thread: ArenaThread }>;
let conversations: {
  agentId: string;
  threadId: string;
  requestId: string;
  purpose: string;
}[];
let service: typeof import('./agent-workspace-service.js');

const binding = (skillId = '11', skillVersionId = '101', enabled = true) => ({
  skillId,
  skillVersionId,
  enabled,
});
const input = (
  name = 'Teaching agent',
  skills = [binding()],
): AgentWorkspaceInput => ({
  name,
  description: 'Teaching',
  instructions: 'Use all attached procedures.',
  model: 'fixed-model',
  skills,
});

// This fixture persists writes and applies owner/version predicates. Unknown SQL
// fails loudly so a new lookup cannot accidentally pass with an empty result.
beforeEach(async () => {
  vi.resetModules();
  agents = new Map();
  threads = new Map();
  conversations = [];
  versions = new Map(
    ['101', '202', '303'].map((id, index) => [
      id,
      {
        skill_id: String(11 + index),
        user_id: index === 2 ? 'other' : 'owner',
        package_id: String(7 + index),
        current_version_id: String(70 + index),
        skill_uid: `skill-${index}`,
        version_number: index + 1,
        status: 'active',
        skill_status: 'active',
        display_name: `Procedure ${index}`,
        skill_snapshot_json: {
          name: `Skill ${index}`,
          description: `Description ${index}`,
          skillMd: `PINNED_BODY_${index}`,
        },
      },
    ]),
  );
  queryMock
    .mockReset()
    .mockImplementation(async (text: string, args: unknown[] = []) => {
      const sql = text.replace(/\s+/g, ' ').trim();
      const result = (rows: unknown[]) => ({
        rows: structuredClone(rows),
        rowCount: rows.length,
      });
      if (sql.startsWith('select * from user_agents where id')) {
        return result(
          [...agents.values()].filter(
            (row) => row.id === args[0] && row.user_id === args[1],
          ),
        );
      }
      if (sql.startsWith('select * from user_agents where user_id')) {
        return result(
          [...agents.values()]
            .filter((row) => row.user_id === args[0])
            .sort(
              (a, b) =>
                b.updated_at.localeCompare(a.updated_at) ||
                Number(b.id) - Number(a.id),
            ),
        );
      }
      if (sql.startsWith('select sv.package_id')) {
        const row = versions.get(String(args[0]));
        return result(
          row && row.skill_id === args[1] && row.user_id === args[2]
            ? [row]
            : [],
        );
      }
      if (
        sql.startsWith('insert into user_agents') ||
        sql.startsWith('update user_agents')
      ) {
        const updating = sql.startsWith('update');
        const id = updating ? String(args[6]) : String(agents.size + 1);
        const previous = agents.get(id);
        if (updating && previous?.user_id !== args[7]) return result([]);
        const row: AgentRow = {
          id,
          user_id: String(updating ? args[7] : args[6]),
          name: String(args[0]),
          description: String(args[1]),
          instructions: String(args[2]),
          model: String(args[3]),
          skills_json: JSON.parse(String(args[4])),
          created_at: previous?.created_at ?? String(args[5]),
          updated_at: String(args[5]),
        };
        agents.set(id, row);
        return result([row]);
      }
      if (
        sql.startsWith(
          'select thread_id, purpose from user_agent_conversations',
        )
      ) {
        return result(
          conversations
            .filter(
              (row) => row.agentId === args[0] && row.requestId === args[1],
            )
            .map((row) => ({ thread_id: row.threadId, purpose: row.purpose })),
        );
      }
      if (sql.startsWith('insert into arena_threads')) {
        const id = String(threads.size + 91);
        threads.set(id, {
          userId: String(args[0]),
          thread: {
            id: Number(id),
            packageId: Number(args[1]),
            title: String(args[2]),
            model: args[3] as string | null,
            arenaKind: 'skill_arena',
            basePackageVersionId: String(args[4]),
            skillArenaConfig: JSON.parse(String(args[5])),
            createdAt: String(args[6]),
            updatedAt: String(args[6]),
          },
        });
        return result([{ id }]);
      }
      if (sql.startsWith('insert into arena_thread_variants'))
        return result([]);
      if (sql.startsWith('insert into user_agent_conversations')) {
        conversations.push({
          agentId: String(args[0]),
          threadId: String(args[1]),
          requestId: String(args[2]),
          purpose: String(args[3]),
        });
        return result([]);
      }
      if (sql.startsWith('select c.thread_id from user_agent_conversations')) {
        return result(
          conversations
            .filter(
              (row) =>
                row.agentId === args[0] &&
                threads.get(row.threadId)?.userId === args[1],
            )
            .map((row) => ({ thread_id: row.threadId })),
        );
      }
      throw new Error(`Unexpected query: ${sql}`);
    });
  transactionMock.mockReset().mockImplementation(async (work) => {
    const saved = structuredClone({ agents, threads, conversations });
    try {
      return await work({ query: queryMock });
    } catch (error) {
      ({ agents, threads, conversations } = saved);
      throw error;
    }
  });
  detailMock
    .mockReset()
    .mockImplementation(async (userId: string, id: string) => {
      const row = threads.get(id);
      if (!row || row.userId !== userId) throw new Error('Thread not owned');
      return { thread: structuredClone(row.thread), messages: [] };
    });
  vi.doMock('./db.js', () => ({
    query: queryMock,
    withTransaction: transactionMock,
  }));
  vi.doMock('./arena-service.js', () => ({ getThreadDetail: detailMock }));
  service = await import('./agent-workspace-service.js');
});

afterEach(() => {
  vi.doUnmock('./db.js');
  vi.doUnmock('./arena-service.js');
  vi.resetModules();
});

describe('Agent workspace ownership and edits', () => {
  it('persists several independent Agents per owner and isolates every owned operation', async () => {
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
    expect(
      (await service.listAgents('owner')).map((agent) => agent.name).sort(),
    ).toEqual(['First', 'Second']);
    expect(
      (await service.listAgents('other')).map((agent) => agent.id),
    ).toEqual([foreign.id]);
    expect(await service.getAgent('owner', second.id)).toMatchObject({
      name: 'Second',
      skills: [binding('12', '202')],
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
    expect(conversations).toEqual([]);
  });

  it('requires CAS, advances the timestamp, and rejects a stale editor without overwriting', async () => {
    const agent = await service.saveAgent('owner', input());
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
      { ...input('Updated'), expectedUpdatedAt: agent.updatedAt },
      agent.id,
    );
    expect(Date.parse(edited.updatedAt)).toBeGreaterThan(
      Date.parse(agent.updatedAt),
    );
    await expect(
      service.saveAgent(
        'owner',
        { ...input('Stale'), expectedUpdatedAt: agent.updatedAt },
        agent.id,
      ),
    ).rejects.toMatchObject({ status: 409, code: 'AGENT_CONFLICT' });
    expect(await service.getAgent('owner', agent.id)).toMatchObject({
      name: 'Updated',
      updatedAt: edited.updatedAt,
    });
    expect(
      queryMock.mock.calls.some(([sql]) => sql.includes('for update')),
    ).toBe(true);
  });

  it.each([true, false])(
    'rejects duplicate skill ids even when the second binding is enabled=%s',
    async (enabled) => {
      await expect(
        service.saveAgent(
          'owner',
          input('Duplicate', [binding(), binding('11', '102', enabled)]),
        ),
      ).rejects.toMatchObject({ status: 422, code: 'INVALID_ARGUMENT' });
      expect(transactionMock).not.toHaveBeenCalled();
      expect(agents.size).toBe(0);
    },
  );

  it.each(['0', '-1', '1.2', 'abc', '9007199254740992'])(
    'rejects invalid version id %s before database access',
    async (id) => {
      await expect(
        service.saveAgent('owner', input('Invalid', [binding('11', id)])),
      ).rejects.toMatchObject({ status: 422 });
      expect(queryMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    'missing',
    'inaccessible',
    'mismatched',
    'discarded',
    'removed',
    'empty',
  ] as const)(
    'rejects %s versions on save and leaves no partial Agent',
    async (scenario) => {
      const selected =
        scenario === 'inaccessible' ? binding('13', '303') : binding();
      const version = versions.get('101')!;
      if (scenario === 'missing') versions.delete('101');
      if (scenario === 'mismatched') version.skill_id = '99';
      if (scenario === 'discarded') version.status = 'discarded';
      if (scenario === 'removed') version.skill_status = 'removed';
      if (scenario === 'empty') version.skill_snapshot_json.skillMd = '   ';
      await expect(
        service.saveAgent('owner', input('Invalid', [selected])),
      ).rejects.toMatchObject({
        status: 422,
        code: scenario === 'empty' ? 'INVALID_ARGUMENT' : 'SKILL_UNAVAILABLE',
      });
      expect(agents.size).toBe(0);
    },
  );
});

describe('Agent conversation snapshots', () => {
  it('pins all enabled cross-package versions and preserves old snapshots after Agent and repository changes', async () => {
    const agent = await service.saveAgent(
      'owner',
      input('Original', [binding(), binding('12', '202')]),
    );
    const old = await service.createAgentConversation('owner', agent.id, {
      purpose: 'run',
      requestId: 'original',
    });
    const frozen = structuredClone(old.skillArenaConfig!.agentExecution!);
    expect(frozen).toMatchObject({
      name: 'Original',
      instructions: input().instructions,
      model: 'fixed-model',
      skills: [
        {
          skillId: '11',
          skillVersionId: '101',
          packageId: '7',
          packageVersionId: '70',
          versionNumber: 1,
          skillMd: 'PINNED_BODY_0',
        },
        {
          skillId: '12',
          skillVersionId: '202',
          packageId: '8',
          packageVersionId: '71',
          versionNumber: 2,
          skillMd: 'PINNED_BODY_1',
        },
      ],
    });
    versions.set('102', {
      ...structuredClone(versions.get('101')!),
      version_number: 2,
      current_version_id: '80',
      skill_snapshot_json: {
        name: 'New',
        description: 'New',
        skillMd: 'NEW_VERSION_BODY',
      },
    });
    await service.saveAgent(
      'owner',
      {
        ...input('Reconfigured', [binding('11', '102')]),
        instructions: 'New instructions',
        model: 'new-model',
        expectedUpdatedAt: agent.updatedAt,
      },
      agent.id,
    );
    versions.get('101')!.status = 'discarded';
    versions.get('202')!.skill_snapshot_json.skillMd =
      'CHANGED_REPOSITORY_BODY';
    const fresh = await service.createAgentConversation('owner', agent.id, {
      purpose: 'test',
      requestId: 'fresh',
    });
    expect(fresh.skillArenaConfig!.agentExecution).toMatchObject({
      name: 'Reconfigured',
      instructions: 'New instructions',
      model: 'new-model',
      skills: [{ skillVersionId: '102', skillMd: 'NEW_VERSION_BODY' }],
    });
    const listed = await service.listAgentConversations('owner', agent.id);
    expect(
      listed.find((thread) => thread.id === old.id)!.skillArenaConfig!
        .agentExecution,
    ).toEqual(frozen);
    expect(old.skillArenaConfig!.agentExecution).toEqual(frozen);
  });

  it('excludes disabled bindings before resolving versions and can run when a disabled version is discarded', async () => {
    const agent = await service.saveAgent(
      'owner',
      input('Enabled only', [binding(), binding('12', '202', false)]),
    );
    versions.get('202')!.status = 'discarded';
    expect((await service.getAgent('owner', agent.id)).skills).toHaveLength(2);
    queryMock.mockClear();
    const thread = await service.createAgentConversation('owner', agent.id, {
      purpose: 'run',
      requestId: 'one',
    });
    expect(thread.skillArenaConfig!.agentExecution!.skills).toHaveLength(1);
    expect(
      thread.skillArenaConfig!.agentExecution!.skills[0].skillVersionId,
    ).toBe('101');
    expect(
      queryMock.mock.calls
        .filter(([sql]) => sql.includes('select sv.package_id'))
        .map(([, args]) => args),
    ).toEqual([['101', '11', 'owner']]);
  });

  it('rejects an Agent with no enabled skills without creating a conversation', async () => {
    const agent = await service.saveAgent(
      'owner',
      input('Disabled', [binding('11', '101', false)]),
    );
    await expect(
      service.createAgentConversation('owner', agent.id, {
        purpose: 'test',
        requestId: 'none',
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(threads.size).toBe(0);
    expect(conversations).toEqual([]);
  });

  it.each(['missing', 'inaccessible', 'discarded', 'removed'] as const)(
    'revalidates enabled %s versions at conversation creation',
    async (scenario) => {
      const agent = await service.saveAgent('owner', input());
      if (scenario === 'missing') versions.delete('101');
      if (scenario === 'inaccessible') versions.get('101')!.user_id = 'other';
      if (scenario === 'discarded') versions.get('101')!.status = 'discarded';
      if (scenario === 'removed') versions.get('101')!.skill_status = 'removed';
      await expect(
        service.createAgentConversation('owner', agent.id, {
          purpose: 'run',
          requestId: 'unavailable',
        }),
      ).rejects.toMatchObject({ status: 422, code: 'SKILL_UNAVAILABLE' });
      expect(threads.size).toBe(0);
      expect(conversations).toEqual([]);
    },
  );

  it.each(['run', 'test'] as const)(
    'replays %s requests without new writes or resolving changed bindings; rejects purpose reuse',
    async (purpose) => {
      const agent = await service.saveAgent('owner', input());
      const request = { purpose, requestId: 'retry' };
      const first = await service.createAgentConversation(
        'owner',
        agent.id,
        request,
      );
      versions.get('101')!.status = 'discarded';
      queryMock.mockClear();
      expect(
        await service.createAgentConversation('owner', agent.id, request),
      ).toEqual(first);
      expect(
        queryMock.mock.calls.some(
          ([sql]) =>
            sql.includes('insert into') || sql.includes('select sv.package_id'),
        ),
      ).toBe(false);
      await expect(
        service.createAgentConversation('owner', agent.id, {
          ...request,
          purpose: purpose === 'run' ? 'test' : 'run',
        }),
      ).rejects.toMatchObject({ status: 409, code: 'IDEMPOTENCY_CONFLICT' });
      expect(threads.size).toBe(1);
      expect(conversations).toHaveLength(1);
      expect(first.skillArenaConfig!.surface).toBe(purpose);
      expect(first.title).toContain(purpose === 'run' ? '对话' : '测试');
    },
  );

  it('scopes request ids and conversation lists to each Agent', async () => {
    const first = await service.saveAgent('owner', input('First'));
    const second = await service.saveAgent('owner', input('Second'));
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
    { purpose: 'run', requestId: '' },
    { purpose: 'test', requestId: '   ' },
    { purpose: 'run', requestId: 'x'.repeat(121) },
  ])('rejects invalid conversation input %# before DB access', async (body) => {
    await expect(
      service.createAgentConversation('owner', '1', body),
    ).rejects.toMatchObject({ status: 422 });
    expect(queryMock).not.toHaveBeenCalled();
  });
});
