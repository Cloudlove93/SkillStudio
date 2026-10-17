import AdmZip from 'adm-zip';
import { afterEach, describe, expect, it, vi } from 'vitest';

const client = { query: vi.fn() };
const withTransaction = vi.fn(async (work: (value: typeof client) => unknown) =>
  work(client),
);

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('Skill version export', () => {
  it('exports the exact owned fixed-version SKILL.md without internal data', async () => {
    vi.doMock('./db.js', () => ({ withTransaction }));
    const skillMd = '# v1\n\nOnly the selected immutable version.';
    client.query.mockResolvedValueOnce({
      rows: [
        {
          id: '81',
          skill_id: '12',
          package_id: '3',
          created_in_package_version_id: '61',
          version_number: 1,
          source: 'generated',
          based_on_version_id: null,
          skill_snapshot_json: {
            id: 'stable-skill-id',
            dirName: '../unsafe/math-skill',
            name: '函数教学',
            description: '描述',
            skillMd,
          },
          content_hash: 'hash-v1',
          status: 'active',
          note: '',
          created_at: '2026-10-16T00:00:00.000Z',
          discarded_at: null,
          discarded_by: null,
          discard_reason: null,
          restored_at: null,
          restored_by: null,
        },
      ],
    });
    const { exportSkillVersionZip } = await import(
      './skill-version-service.js'
    );

    const exported = await exportSkillVersionZip({
      authUserId: 'owner-1',
      packageId: '3',
      skillId: '12',
      versionId: '81',
    });

    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.query.mock.calls[0]?.[0]).toContain('p.user_id = $3');
    expect(client.query.mock.calls[0]?.[1]).toEqual([
      '81',
      '3',
      'owner-1',
      '12',
    ]);
    expect(exported.fileName).toBe('unsafe-math-skill-v1.zip');
    const zip = new AdmZip(exported.data);
    expect(zip.getEntries().map((entry) => entry.entryName)).toEqual([
      'SKILL.md',
    ]);
    expect(zip.readAsText('SKILL.md')).toBe(skillMd);
    expect(exported.data.toString('utf8')).not.toContain('owner-1');
    expect(exported.data.toString('utf8')).not.toContain('hash-v1');
  });

  it('keeps v1 and v2 exports isolated', async () => {
    vi.doMock('./db.js', () => ({ withTransaction }));
    const row = (id: string, versionNumber: number, skillMd: string) => ({
      id,
      skill_id: '12',
      package_id: '3',
      created_in_package_version_id: String(60 + versionNumber),
      version_number: versionNumber,
      source: versionNumber === 1 ? 'generated' : 'interactive',
      based_on_version_id: versionNumber === 1 ? null : '81',
      skill_snapshot_json: {
        id: 'stable-skill-id',
        dirName: 'math-skill',
        name: '函数教学',
        description: '描述',
        skillMd,
      },
      content_hash: `hash-v${versionNumber}`,
      status: 'active',
      note: '',
      created_at: '2026-10-16T00:00:00.000Z',
      discarded_at: null,
      discarded_by: null,
      discard_reason: null,
      restored_at: null,
      restored_by: null,
    });
    client.query
      .mockResolvedValueOnce({ rows: [row('81', 1, '# Version one')] })
      .mockResolvedValueOnce({ rows: [row('82', 2, '# Version two')] });
    const { exportSkillVersionZip } = await import(
      './skill-version-service.js'
    );

    const v1 = await exportSkillVersionZip({
      authUserId: 'owner-1',
      packageId: '3',
      skillId: '12',
      versionId: '81',
    });
    const v2 = await exportSkillVersionZip({
      authUserId: 'owner-1',
      packageId: '3',
      skillId: '12',
      versionId: '82',
    });

    expect(new AdmZip(v1.data).readAsText('SKILL.md')).toBe('# Version one');
    expect(new AdmZip(v2.data).readAsText('SKILL.md')).toBe('# Version two');
    expect(v1.fileName).toBe('math-skill-v1.zip');
    expect(v2.fileName).toBe('math-skill-v2.zip');
  });

  it('fails closed when the version is not owned or has no SKILL.md', async () => {
    vi.doMock('./db.js', () => ({ withTransaction }));
    client.query.mockResolvedValueOnce({ rows: [] });
    const { exportSkillVersionZip } = await import(
      './skill-version-service.js'
    );

    await expect(
      exportSkillVersionZip({
        authUserId: 'other-user',
        packageId: '3',
        skillId: '12',
        versionId: '81',
      }),
    ).rejects.toMatchObject({
      code: 'SKILL_VERSION_NOT_FOUND',
      status: 404,
    });
  });
});
