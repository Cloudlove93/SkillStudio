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
});
