// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { liteApi } from './lite-api';

describe('Skill export API', () => {
  afterEach(() => vi.restoreAllMocks());

  it('downloads the selected fixed version with the server-provided safe name', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Blob(['zip-data']), {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition':
            "attachment; filename=skill-v2.zip; filename*=UTF-8''math-skill-v2.zip",
        },
      }),
    );
    const createObjectUrl = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:skill-export');
    const revokeObjectUrl = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    const fileName = await liteApi.exportSkillVersion(
      'token',
      '3',
      '12',
      '82',
      'fallback.zip',
    );

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/skills/12/versions/82/export?packageId=3',
    );
    expect(
      new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('Authorization'),
    ).toBe('Bearer token');
    expect(fileName).toBe('math-skill-v2.zip');
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:skill-export');
  });

  it('does not create a download when the server rejects access', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Skill version not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL');

    await expect(
      liteApi.exportSkillVersion('token', '3', '12', '82', 'fallback.zip'),
    ).rejects.toThrow('Skill version not found');
    expect(createObjectUrl).not.toHaveBeenCalled();
  });
});
