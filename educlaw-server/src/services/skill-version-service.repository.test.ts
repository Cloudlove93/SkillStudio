import { afterEach, describe, expect, it, vi } from 'vitest';

const client = { query: vi.fn() };
const withTransaction = vi.fn(async (work: (value: typeof client) => unknown) =>
  work(client),
);

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('repository Skill listing', () => {
  it('loads owned active Skills with package metadata in one paginated query', async () => {
    vi.doMock('./db.js', () => ({ withTransaction }));
    client.query.mockResolvedValueOnce({
      rows: [
        {
          id: '12',
          package_id: '3',
          skill_uid: 'skill-12',
          dir_name: 'math-concept',
          name: '函数概念',
          display_name: '函数辨析',
          description: 'Skill 描述',
          status: 'active',
          next_version_number: 2,
          created_at: '2026-08-01T00:00:00.000Z',
          updated_at: '2026-08-29T08:00:00.000Z',
          package_name: '高等数学',
          package_description: '课程包描述',
        },
        {
          id: '11',
          package_id: '2',
          skill_uid: 'skill-11',
          dir_name: 'mapping',
          name: '映射',
          display_name: null,
          description: '',
          status: 'active',
          next_version_number: 2,
          created_at: '2026-08-01T00:00:00.000Z',
          updated_at: '2026-08-28T08:00:00.000Z',
          package_name: '线性代数',
          package_description: '备用描述',
        },
      ],
    });
    const { listRepositorySkills } = await import('./skill-version-service.js');

    const result = await listRepositorySkills({
      authUserId: 'user-1',
      limit: 1,
    });

    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.query.mock.calls[0]?.[0]).toContain(
      'join agent_packages p on p.id = s.package_id',
    );
    expect(client.query.mock.calls[0]?.[1]).toEqual([
      'user-1',
      null,
      null,
      2,
    ]);
    expect(result.items).toEqual([
      {
        id: '12',
        packageId: '3',
        skillUid: 'skill-12',
        dirName: 'math-concept',
        name: '函数辨析',
        description: 'Skill 描述',
        updatedAt: '2026-08-29T08:00:00.000Z',
        packageName: '高等数学',
        packageDescription: '课程包描述',
      },
    ]);
    expect(result.nextCursor).toEqual(expect.any(String));
  });
});
