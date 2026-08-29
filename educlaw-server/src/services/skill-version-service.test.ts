import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const withTransactionMock = vi.fn();

async function loadService() {
  vi.resetModules();
  vi.doMock('./db.js', () => ({
    query: queryMock,
    withTransaction: withTransactionMock.mockImplementation(async (work) =>
      work({ query: queryMock }),
    ),
  }));

  return import('./skill-version-service.js');
}

function buildRollbackHash() {
  return createHash('sha256')
    .update(
      JSON.stringify({
        packageId: '1',
        skillId: '11',
        versionId: '21',
        expectedPackageVersionId: '10',
        note: '',
      }),
    )
    .digest('hex');
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('./db.js');
  queryMock.mockReset();
  withTransactionMock.mockReset();
});

describe('skill version service', () => {
  it('stores a user-facing Skill name without creating a new version', async () => {
    queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.startsWith('update agent_package_skills')) {
        expect(params?.[0]).toBe('函数概念辨析');
        expect(params?.[2]).toBe('11');
        expect(params?.[3]).toBe('7');
        expect(params?.[4]).toBe('user-1');
        return {
          rows: [
            {
              id: '11',
              package_id: '7',
              skill_uid: 'function-concepts',
              dir_name: 'function-concepts',
              name: '原始 Skill 名称',
              display_name: '函数概念辨析',
              description: '辨析函数概念',
              status: 'active',
              next_version_number: 2,
              created_at: '2026-08-20T00:00:00.000Z',
              updated_at: '2026-08-27T00:00:00.000Z',
            },
          ],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });
    const service = await loadService();

    const renamed = await service.renameSkill({
      authUserId: 'user-1',
      packageId: '7',
      skillId: '11',
      displayName: '  函数概念辨析  ',
    });

    expect(renamed).toMatchObject({
      id: '11',
      packageId: '7',
      name: '函数概念辨析',
    });
    expect(
      queryMock.mock.calls.some((call) =>
        String(call[0]).includes('agent_package_versions'),
      ),
    ).toBe(false);
  });

  it('rejects empty and overlong Skill display names before querying', async () => {
    const service = await loadService();

    await expect(
      service.renameSkill({
        authUserId: 'user-1',
        packageId: '7',
        skillId: '11',
        displayName: '   ',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(
      service.renameSkill({
        authUserId: 'user-1',
        packageId: '7',
        skillId: '11',
        displayName: '名'.repeat(81),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('does not reveal or rename a Skill outside the authenticated owner', async () => {
    queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
    const service = await loadService();

    await expect(
      service.renameSkill({
        authUserId: 'other-user',
        packageId: '7',
        skillId: '11',
        displayName: '不应成功',
      }),
    ).rejects.toMatchObject({ code: 'SKILL_NOT_FOUND', status: 404 });

    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('p.user_id = $5');
    expect(params[4]).toBe('other-user');
  });

  it('returns the persisted display name without replacing Skill content', async () => {
    queryMock.mockResolvedValue({
      rows: [
        {
          id: '11',
          package_id: '7',
          skill_uid: 'function-concepts',
          dir_name: 'function-concepts',
          name: '版本中的原始名称',
          display_name: '教师自定义名称',
          description: '原始内容保持不变',
          status: 'active',
          next_version_number: 2,
          created_at: '2026-08-20T00:00:00.000Z',
          updated_at: '2026-08-27T00:00:00.000Z',
        },
      ],
      rowCount: 1,
    });
    const service = await loadService();

    await expect(
      service.listPackageSkills({
        authUserId: 'user-1',
        packageId: '7',
      }),
    ).resolves.toMatchObject([
      {
        name: '教师自定义名称',
        description: '原始内容保持不变',
      },
    ]);
  });

  it('rejects unsafe skill dir names before syncing version history', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('from agent_package_skills')) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });
    const { syncPackageVersionSkillsFromSnapshot } = await loadService();

    await expect(
      syncPackageVersionSkillsFromSnapshot(
        { query: queryMock },
        {
          packageId: '1',
          packageVersionId: '10',
          packageVersionNumber: 10,
          source: 'manual',
          snapshot: {
            name: 'Pkg',
            description: '',
            versionLabel: 'v1',
            agentMd: '',
            rubricMd: '',
            skills: [
              {
                id: 'skill-1',
                dirName: '../escape',
                name: 'Escape',
                description: '',
                skillMd: '---\nname: Escape\n---',
              },
            ],
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('reuses existing skill versions when only package-level content changes', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('from agent_package_skills')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.startsWith('insert into agent_package_skills')) {
        return { rows: [{ id: '11' }], rowCount: 1 };
      }
      if (sql.startsWith('select sv.id')) {
        return { rows: [{ id: '21' }], rowCount: 1 };
      }
      if (sql.startsWith('insert into agent_package_version_skills')) {
        return { rows: [], rowCount: 1 };
      }
      if (
        sql.startsWith("update agent_package_skills set status = 'removed'")
      ) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });
    const { syncPackageVersionSkillsFromSnapshot } = await loadService();

    await syncPackageVersionSkillsFromSnapshot(
      { query: queryMock },
      {
        packageId: '1',
        packageVersionId: '10',
        packageVersionNumber: 10,
        source: 'manual',
        snapshot: {
          name: 'Pkg',
          description: '',
          versionLabel: 'v2',
          agentMd: 'changed agent',
          rubricMd: '',
          skills: [
            {
              id: 'skill-1',
              dirName: 'core',
              name: 'Core',
              description: '',
              skillMd: 'same skill',
            },
          ],
        },
      },
    );

    expect(
      queryMock.mock.calls.some((call) =>
        String(call[0]).startsWith('insert into agent_skill_versions'),
      ),
    ).toBe(false);
  });

  it('blocks discarding the skill version used by the current package version', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.startsWith('select * from agent_packages')) {
        return {
          rows: [
            {
              id: '1',
              user_id: 'user-1',
              name: 'Pkg',
              description: '',
              current_version_id: '10',
              created_at: '',
              updated_at: '',
            },
          ],
          rowCount: 1,
        };
      }
      if (
        sql.startsWith(
          'select * from agent_package_versions\n     where package_id = $1',
        )
      ) {
        return {
          rows: [
            {
              id: '10',
              package_id: '1',
              version_number: 2,
              source: 'manual',
              snapshot_json: '{}',
              note: '',
              created_at: '',
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.startsWith('select distinct package_version_id')) {
        return { rows: [{ package_version_id: '10' }], rowCount: 1 };
      }
      if (sql.startsWith('select sv.*')) {
        return {
          rows: [
            {
              id: '21',
              skill_id: '11',
              package_id: '1',
              created_in_package_version_id: '9',
              version_number: 1,
              source: 'manual',
              based_on_version_id: null,
              skill_snapshot_json: '{}',
              content_hash: 'hash',
              status: 'active',
              note: '',
              created_at: '',
              discarded_at: null,
              discarded_by: null,
              discard_reason: null,
              restored_at: null,
              restored_by: null,
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.startsWith('select 1 from agent_package_version_skills')) {
        return { rows: [{ '?column?': 1 }], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });
    const { discardSkillVersion } = await loadService();

    await expect(
      discardSkillVersion({
        authUserId: 'user-1',
        packageId: '1',
        versionId: '21',
        reason: 'bad',
      }),
    ).rejects.toMatchObject({ code: 'CURRENT_VERSION_CANNOT_BE_DISCARDED' });
  });

  it('returns the first rollback result for repeated idempotent requests', async () => {
    const replayed = {
      packageId: '1',
      packageVersionId: '12',
      versionNumber: 12,
      rolledBackSkillVersionId: '21',
      snapshot: { skills: [] },
    };
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.startsWith('delete from api_idempotency_keys')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.startsWith('insert into api_idempotency_keys')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.startsWith('select request_hash, status, response_status')) {
        return {
          rows: [
            {
              request_hash: buildRollbackHash(),
              status: 'completed',
              response_status: 200,
              response_json: replayed,
              expires_at: '2099-01-01T00:00:00.000Z',
            },
          ],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });
    const { rollbackSkillVersion } = await loadService();

    await expect(
      rollbackSkillVersion({
        authUserId: 'user-1',
        packageId: '1',
        skillId: '11',
        versionId: '21',
        expectedPackageVersionId: '10',
        idempotencyKey: 'key-1',
      }),
    ).resolves.toEqual(replayed);

    expect(
      queryMock.mock.calls.some((call) =>
        String(call[0]).startsWith('insert into agent_package_versions'),
      ),
    ).toBe(false);
  });

  it('rejects reusing the same idempotency key with different request data', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.startsWith('delete from api_idempotency_keys')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.startsWith('insert into api_idempotency_keys')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.startsWith('select request_hash, status, response_status')) {
        return {
          rows: [
            {
              request_hash: 'different-hash',
              status: 'completed',
              response_status: 200,
              response_json: {},
              expires_at: '2099-01-01T00:00:00.000Z',
            },
          ],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });
    const { rollbackSkillVersion } = await loadService();

    await expect(
      rollbackSkillVersion({
        authUserId: 'user-1',
        packageId: '1',
        skillId: '11',
        versionId: '21',
        expectedPackageVersionId: '10',
        idempotencyKey: 'key-1',
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('returns a version conflict before writing new rollback versions when the package has moved', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.startsWith('delete from api_idempotency_keys')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.startsWith('insert into api_idempotency_keys')) {
        return { rows: [{ id: '1' }], rowCount: 1 };
      }
      if (sql.startsWith('select * from agent_packages')) {
        return {
          rows: [
            {
              id: '1',
              user_id: 'user-1',
              name: 'Pkg',
              description: '',
              current_version_id: '12',
              created_at: '',
              updated_at: '',
            },
          ],
          rowCount: 1,
        };
      }
      if (
        sql.startsWith(
          'select * from agent_package_versions\n     where package_id = $1',
        )
      ) {
        return {
          rows: [
            {
              id: '12',
              package_id: '1',
              version_number: 12,
              source: 'manual',
              snapshot_json: '{}',
              note: '',
              created_at: '',
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.startsWith('select distinct package_version_id')) {
        return { rows: [{ package_version_id: '12' }], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });
    const { rollbackSkillVersion } = await loadService();

    await expect(
      rollbackSkillVersion({
        authUserId: 'user-1',
        packageId: '1',
        skillId: '11',
        versionId: '21',
        expectedPackageVersionId: '10',
        idempotencyKey: 'key-1',
      }),
    ).rejects.toMatchObject({ code: 'PACKAGE_VERSION_CONFLICT' });

    expect(
      queryMock.mock.calls.some((call) =>
        String(call[0]).startsWith('insert into agent_package_versions'),
      ),
    ).toBe(false);
  });

  it('writes a new current snapshot that excludes only selected Skills', async () => {
    let insertedSnapshotJson = '';
    queryMock.mockImplementation(async (sql: string, values?: unknown[]) => {
      if (sql.includes('from agent_package_skills s')) {
        return {
          rows: [
            {
              id: '11',
              package_id: '1',
              skill_uid: 'delete-me',
              dir_name: 'delete-me',
              name: 'Delete me',
              description: '',
              status: 'active',
              next_version_number: 2,
              created_at: '',
              updated_at: '',
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes('from agent_packages') && sql.includes('for update')) {
        return {
          rows: [
            {
              id: '1',
              user_id: 'user-1',
              name: 'Skills',
              description: '',
              current_version_id: '10',
              created_at: '',
              updated_at: '',
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes('from agent_package_versions') && sql.includes('id = $1')) {
        return {
          rows: [
            {
              id: '10',
              package_id: '1',
              version_number: 3,
              source: 'manual',
              snapshot_json: {
                name: 'Skills',
                description: '',
                versionLabel: 'v3',
                agentMd: '',
                rubricMd: '',
                skills: [
                  {
                    id: 'delete-me',
                    dirName: 'delete-me',
                    name: 'Delete me',
                    description: '',
                    skillMd: 'delete',
                  },
                  {
                    id: 'keep-me',
                    dirName: 'keep-me',
                    name: 'Keep me',
                    description: '',
                    skillMd: 'keep',
                  },
                ],
              },
              note: '',
              created_at: '',
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.startsWith('insert into agent_package_versions')) {
        insertedSnapshotJson = String(values?.[2] || '');
        return { rows: [{ id: '20' }], rowCount: 1 };
      }
      if (sql.includes('select skill_uid, dir_name')) {
        return {
          rows: [
            { skill_uid: 'delete-me', dir_name: 'delete-me' },
            { skill_uid: 'keep-me', dir_name: 'keep-me' },
          ],
          rowCount: 2,
        };
      }
      if (sql.startsWith('insert into agent_package_skills')) {
        return { rows: [{ id: '12' }], rowCount: 1 };
      }
      if (sql.startsWith('select sv.id')) {
        return { rows: [{ id: '22', version_number: 1 }], rowCount: 1 };
      }
      if (sql.startsWith('insert into agent_package_version_skills')) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("update agent_package_skills set status = 'removed'")) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith('update agent_packages')) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("remove_reason = 'deleted by user'")) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });
    const { batchDeleteSkills } = await loadService();

    await expect(
      batchDeleteSkills({ authUserId: 'user-1', skillIds: ['11'] }),
    ).resolves.toEqual({ deletedSkillIds: ['11'], deletedCount: 1 });

    expect(
      JSON.parse(insertedSnapshotJson).skills.map(
        (skill: { id: string }) => skill.id,
      ),
    ).toEqual(['keep-me']);
    const packageLockIndex = queryMock.mock.calls.findIndex(([sql]) =>
      String(sql).includes('from agent_packages') && String(sql).includes('for update'));
    const skillLockIndex = queryMock.mock.calls.findIndex(([sql]) =>
      String(sql).includes('for update of s'));
    expect(packageLockIndex).toBeLessThan(skillLockIndex);
  });

  it('rejects the whole delete batch before writes when any Skill is not owned', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('from agent_package_skills s')) {
        return {
          rows: [
            {
              id: '11',
              package_id: '1',
              skill_uid: 'owned',
              status: 'active',
            },
          ],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });
    const { batchDeleteSkills } = await loadService();

    await expect(
      batchDeleteSkills({
        authUserId: 'user-1',
        skillIds: ['11', '999'],
      }),
    ).rejects.toMatchObject({ code: 'SKILL_NOT_FOUND', status: 404 });

    expect(
      queryMock.mock.calls.some(([sql]) =>
        String(sql).startsWith('insert into agent_package_versions'),
      ),
    ).toBe(false);
  });

  it('treats an already removed owned Skill as a successful retry', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('from agent_package_skills s')) {
        return {
          rows: [
            {
              id: '11',
              package_id: '1',
              skill_uid: 'removed',
              status: 'removed',
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes('from agent_packages') && sql.includes('for update')) {
        return {
          rows: [
            {
              id: '1',
              user_id: 'user-1',
              name: 'Skills',
              description: '',
              current_version_id: '10',
              created_at: '',
              updated_at: '',
            },
          ],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });
    const { batchDeleteSkills } = await loadService();

    await expect(
      batchDeleteSkills({ authUserId: 'user-1', skillIds: ['11'] }),
    ).resolves.toEqual({ deletedSkillIds: ['11'], deletedCount: 1 });

    expect(
      queryMock.mock.calls.some(([sql]) =>
        String(sql).startsWith('insert into agent_package_versions'),
      ),
    ).toBe(false);
  });

  it('does not advance a removed-only package in a mixed idempotent retry', async () => {
    const targets = [
      { id: '11', package_id: '1', skill_uid: 'active-one', status: 'active' },
      { id: '22', package_id: '2', skill_uid: 'removed-two', status: 'removed' },
    ];
    const insertedPackageIds: string[] = [];
    queryMock.mockImplementation(async (sql: string, values?: unknown[]) => {
      if (sql.includes('from agent_package_skills s')) {
        return { rows: targets, rowCount: 2 };
      }
      if (sql.includes('from agent_packages') && sql.includes('for update')) {
        return {
          rows: [
            { id: '1', user_id: 'user-1', current_version_id: '10' },
            { id: '2', user_id: 'user-1', current_version_id: '30' },
          ],
          rowCount: 2,
        };
      }
      if (sql.includes('from agent_package_versions') && sql.includes('id = $1')) {
        const packageId = String(values?.[1]);
        if (packageId !== '1') {
          throw new Error('removed-only package must not receive a new version');
        }
        return {
          rows: [{
            id: '10',
            package_id: '1',
            version_number: 1,
            snapshot_json: {
              name: 'Skills', description: '', versionLabel: 'v1', agentMd: '', rubricMd: '',
              skills: [{ id: 'active-one', dirName: 'active-one', name: 'Active', description: '', skillMd: '' }],
            },
          }],
          rowCount: 1,
        };
      }
      if (sql.startsWith('insert into agent_package_versions')) {
        insertedPackageIds.push(String(values?.[0]));
        return { rows: [{ id: '20' }], rowCount: 1 };
      }
      if (sql.includes('select skill_uid, dir_name')) {
        return { rows: [{ skill_uid: 'active-one', dir_name: 'active-one' }], rowCount: 1 };
      }
      if (sql.startsWith("update agent_package_skills set status = 'removed'")) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith('update agent_packages')) {
        expect(values?.[2]).toBe('1');
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("remove_reason = 'deleted by user'")) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });
    const { batchDeleteSkills } = await loadService();

    await expect(
      batchDeleteSkills({ authUserId: 'user-1', skillIds: ['11', '22'] }),
    ).resolves.toEqual({ deletedSkillIds: ['11', '22'], deletedCount: 2 });
    expect(insertedPackageIds).toEqual(['1']);
  });

  it('de-duplicates ids and rejects more than 100 unique ids before opening a transaction', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('from agent_package_skills s')) {
        return {
          rows: [{ id: '11', package_id: '1', skill_uid: 'removed', status: 'removed' }],
          rowCount: 1,
        };
      }
      if (sql.includes('from agent_packages') && sql.includes('for update')) {
        return {
          rows: [{ id: '1', user_id: 'user-1', current_version_id: '10' }],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });
    const { batchDeleteSkills } = await loadService();

    await expect(
      batchDeleteSkills({ authUserId: 'user-1', skillIds: ['11', '11'] }),
    ).resolves.toEqual({ deletedSkillIds: ['11'], deletedCount: 1 });
    expect(queryMock.mock.calls[0]?.[1]).toEqual([['11'], 'user-1']);

    withTransactionMock.mockClear();
    await expect(
      batchDeleteSkills({
        authUserId: 'user-1',
        skillIds: Array.from({ length: 101 }, (_, index) => String(index + 1)),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT', status: 400 });
    expect(withTransactionMock).not.toHaveBeenCalled();
  });

  it('deletes across packages and writes an empty snapshot for each last Skill', async () => {
    const targets = [
      { id: '11', package_id: '1', skill_uid: 'only-one', status: 'active' },
      { id: '22', package_id: '2', skill_uid: 'only-two', status: 'active' },
    ];
    const insertedSnapshots: Array<{ packageId: string; snapshot: { skills: unknown[] } }> = [];
    queryMock.mockImplementation(async (sql: string, values?: unknown[]) => {
      if (sql.includes('from agent_package_skills s')) {
        return { rows: targets, rowCount: 2 };
      }
      if (sql.includes('from agent_packages') && sql.includes('for update')) {
        return {
          rows: [
            { id: '1', user_id: 'user-1', current_version_id: '10' },
            { id: '2', user_id: 'user-1', current_version_id: '30' },
          ],
          rowCount: 2,
        };
      }
      if (sql.includes('from agent_package_versions') && sql.includes('id = $1')) {
        const packageId = String(values?.[1]);
        const skillUid = packageId === '1' ? 'only-one' : 'only-two';
        return {
          rows: [{
            id: packageId === '1' ? '10' : '30',
            package_id: packageId,
            version_number: 1,
            snapshot_json: {
              name: 'Skills', description: '', versionLabel: 'v1', agentMd: '', rubricMd: '',
              skills: [{ id: skillUid, dirName: skillUid, name: skillUid, description: '', skillMd: '' }],
            },
          }],
          rowCount: 1,
        };
      }
      if (sql.startsWith('insert into agent_package_versions')) {
        insertedSnapshots.push({
          packageId: String(values?.[0]),
          snapshot: JSON.parse(String(values?.[2])),
        });
        return { rows: [{ id: String(values?.[0]) === '1' ? '20' : '40' }], rowCount: 1 };
      }
      if (sql.includes('select skill_uid, dir_name')) {
        const packageId = String(values?.[0]);
        const skillUid = packageId === '1' ? 'only-one' : 'only-two';
        return { rows: [{ skill_uid: skillUid, dir_name: skillUid }], rowCount: 1 };
      }
      if (sql.startsWith("update agent_package_skills set status = 'removed'")) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith('update agent_packages')) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("remove_reason = 'deleted by user'")) {
        return { rows: [], rowCount: 2 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });
    const { batchDeleteSkills } = await loadService();

    await expect(
      batchDeleteSkills({ authUserId: 'user-1', skillIds: ['22', '11'] }),
    ).resolves.toEqual({ deletedSkillIds: ['11', '22'], deletedCount: 2 });
    expect(insertedSnapshots).toHaveLength(2);
    expect(insertedSnapshots.map((entry) => entry.snapshot.skills)).toEqual([[], []]);
    const packageLock = queryMock.mock.calls.find(([sql]) =>
      String(sql).includes('from agent_packages') && String(sql).includes('for update'));
    expect(packageLock?.[1]).toEqual(['user-1', ['1', '2']]);
  });

  it('rejects the transaction when the current package pointer changes', async () => {
    const target = { id: '11', package_id: '1', skill_uid: 'only-one', status: 'active' };
    queryMock.mockImplementation(async (sql: string, values?: unknown[]) => {
      if (sql.includes('from agent_package_skills s')) {
        return { rows: [target], rowCount: 1 };
      }
      if (sql.includes('from agent_packages') && sql.includes('for update')) {
        return { rows: [{ id: '1', user_id: 'user-1', current_version_id: '10' }], rowCount: 1 };
      }
      if (sql.includes('from agent_package_versions') && sql.includes('id = $1')) {
        return {
          rows: [{
            id: '10', package_id: '1', version_number: 1,
            snapshot_json: {
              name: 'Skills', description: '', versionLabel: 'v1', agentMd: '', rubricMd: '',
              skills: [{ id: 'only-one', dirName: 'only-one', name: 'Only', description: '', skillMd: '' }],
            },
          }],
          rowCount: 1,
        };
      }
      if (sql.startsWith('insert into agent_package_versions')) {
        return { rows: [{ id: '20' }], rowCount: 1 };
      }
      if (sql.includes('select skill_uid, dir_name')) {
        return { rows: [{ skill_uid: 'only-one', dir_name: 'only-one' }], rowCount: 1 };
      }
      if (sql.startsWith("update agent_package_skills set status = 'removed'")) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith('update agent_packages')) {
        expect(values?.[4]).toBe('10');
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });
    const { batchDeleteSkills } = await loadService();

    await expect(
      batchDeleteSkills({ authUserId: 'user-1', skillIds: ['11'] }),
    ).rejects.toMatchObject({ code: 'SKILL_DELETE_CONFLICT', status: 409 });
    expect(
      queryMock.mock.calls.some(([sql]) => String(sql).includes("remove_reason = 'deleted by user'")),
    ).toBe(false);
  });
});
