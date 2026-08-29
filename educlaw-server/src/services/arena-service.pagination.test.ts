import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

vi.mock('./db.js', () => ({
  query: queryMock,
  withTransaction: vi.fn(),
}));
vi.mock('./llm-service.js', () => ({}));
vi.mock('./package-service.js', () => ({}));

describe('Arena pagination', () => {
  beforeEach(() => queryMock.mockReset());

  it('uses a bounded keyset query and returns an opaque next cursor', async () => {
    const { listThreadsPage } = await import('./arena-service.js');
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 12,
          user_id: 'user-1',
          package_id: 7,
          title: '最近对话',
          model: null,
          arena_kind: 'skill_arena',
          base_package_version_id: 3,
          arena_config_jsonb: null,
          created_at: '2026-08-29T08:00:00.000Z',
          updated_at: '2026-08-29T09:00:00.000Z',
        },
        {
          id: 11,
          user_id: 'user-1',
          package_id: 7,
          title: '更早对话',
          model: null,
          arena_kind: 'skill_arena',
          base_package_version_id: 3,
          arena_config_jsonb: null,
          created_at: '2026-08-29T07:00:00.000Z',
          updated_at: '2026-08-29T08:30:00.000Z',
        },
      ],
    });

    const page = await listThreadsPage({
      userId: 'user-1',
      packageId: '7',
      skillId: '42',
      limit: 1,
    });

    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toEqual(expect.any(String));
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining('limit $7'),
      ['user-1', '7', '42', null, null, null, 2],
    );
    expect(queryMock.mock.calls[0]?.[0]).toContain("arena_config_jsonb->'left'->>'skillId'");
    expect(queryMock.mock.calls[0]?.[0]).toContain('order by updated_at desc, id desc');
  });

  it('loads only the latest bounded message window in chronological order', async () => {
    const { getThreadDetail } = await import('./arena-service.js');
    queryMock
      .mockResolvedValueOnce({
        rows: [{
          id: 12,
          user_id: 'user-1',
          package_id: 7,
          title: '对话',
          model: null,
          created_at: '2026-08-29T07:00:00.000Z',
          updated_at: '2026-08-29T08:30:00.000Z',
        }],
      })
      .mockResolvedValueOnce({ rows: [] });

    await getThreadDetail('user-1', '12');

    expect(queryMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('limit $3'),
      ['12', 'user-1', 200],
    );
    expect(queryMock.mock.calls[1]?.[0]).toContain('order by created_at desc, id desc');
    expect(queryMock.mock.calls[1]?.[0]).toContain('order by created_at asc, id asc');
  });
});
