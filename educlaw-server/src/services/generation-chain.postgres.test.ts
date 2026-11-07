import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import type { AgentPackageSnapshot } from '@educlaw/shared';
import { isolatedPostgres } from '../../test-utils/isolated-postgres.js';

const enabled = process.env.GENERATION_CHAIN_POSTGRES_TESTS === '1';
let db: Awaited<ReturnType<typeof isolatedPostgres>>;
let packages: typeof import('./package-service.js');
let skills: typeof import('./skill-version-service.js');

beforeAll(async () => {
  if (!enabled) return;
  db = await isolatedPostgres();
  vi.doMock('./db.js', () => ({
    query: (sql: string, values?: unknown[]) => db.pool.query(sql, values),
    withTransaction: async (work: (client: PoolClient) => Promise<unknown>) => {
      const client = await db.pool.connect();
      try {
        await client.query('begin');
        const result = await work(client);
        await client.query('commit');
        return result;
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },
  }));
  await (await import('./db-schema.js')).initDbSchema();
  packages = await import('./package-service.js');
  skills = await import('./skill-version-service.js');
}, 30_000);

afterAll(async () => {
  if (db) await db.close();
  vi.doUnmock('./db.js');
});

function snapshot(
  name: string,
  skillMd: string,
  origin?: { packageId: string; skillId: string },
): AgentPackageSnapshot {
  return {
    name,
    description: 'P3 integration fixture',
    agentMd: '# Agent',
    rubricMd: '',
    versionLabel: 'v1',
    skills: [
      {
        id: 'teaching-procedure',
        dirName: 'teaching-procedure',
        name: '同名 Skill',
        description: 'Reusable teaching procedure',
        skillMd,
        ...(origin
          ? { originPackageId: origin.packageId, originSkillId: origin.skillId }
          : {}),
      },
    ],
  };
}

it.runIf(enabled)(
  'commits Agent and Skill together, rolls back failures, and deduplicates unchanged copies by provenance',
  async () => {
    let origin!: { packageId: number; skillId: string };
    await expect(
      db.pool.connect().then(async (client) => {
        try {
          await client.query('begin');
          const created = await packages.createPackageWithSnapshotTx(
            client,
            'generation-chain-owner',
            snapshot('Will roll back', 'same content'),
            'generated',
            'test-model',
          );
          throw new Error(`probe after commit objects ${created.packageId}`);
        } finally {
          await client.query('rollback');
          client.release();
        }
      }),
    ).rejects.toThrow('probe after commit objects');
    expect(
      (
        await db.pool.query(
          'select count(*)::int as n from agent_packages where user_id = $1',
          ['generation-chain-owner'],
        )
      ).rows[0].n,
    ).toBe(0);
    for (const table of [
      'agent_package_versions',
      'agent_package_skills',
      'agent_skill_versions',
      'agent_package_version_skills',
    ]) {
      expect(
        (await db.pool.query(`select count(*)::int as n from ${table}`)).rows[0]
          .n,
      ).toBe(0);
    }

    const client = await db.pool.connect();
    try {
      await client.query('begin');
      const created = await packages.createPackageWithSnapshotTx(
        client,
        'generation-chain-owner',
        snapshot('Canonical Agent', 'same content'),
        'generated',
        'test-model',
      );
      const row = await client.query<{ id: string }>(
        'select id from agent_package_skills where package_id = $1',
        [created.packageId],
      );
      origin = { packageId: created.packageId, skillId: row.rows[0]!.id };
      await packages.createPackageWithSnapshotTx(
        client,
        'generation-chain-owner',
        snapshot('Reusable copy', 'same content', {
          packageId: String(origin.packageId),
          skillId: origin.skillId,
        }),
        'generated',
        'test-model',
      );
      await packages.createPackageWithSnapshotTx(
        client,
        'generation-chain-owner',
        snapshot('Independent copy', 'different content', {
          packageId: String(origin.packageId),
          skillId: origin.skillId,
        }),
        'generated',
        'test-model',
      );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
    const saved = await packages.getPackage(
      'generation-chain-owner',
      origin.packageId,
    );
    expect(saved.model).toBe('test-model');
    expect(saved.snapshot.skills).toHaveLength(1);

    const listed = await skills.listRepositorySkills({
      authUserId: 'generation-chain-owner',
      limit: 100,
    });
    expect(
      listed.items.filter(
        (item) => item.originPackageId === String(origin.packageId),
      ),
    ).toHaveLength(2);
    expect(listed.items.map((item) => item.packageName)).toContain(
      'Independent copy',
    );
    expect(listed.items.map((item) => item.packageName)).not.toContain(
      'Reusable copy',
    );
  },
);
