import { afterEach, describe, expect, it, vi } from 'vitest';
import { register } from './auth';

const localStorageMock = {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('password registration', () => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageMock,
    configurable: true,
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorageMock.getItem.mockReset();
    localStorageMock.getItem.mockReturnValue(null);
    localStorageMock.setItem.mockReset();
    localStorageMock.removeItem.mockReset();
  });

  it('logs in after the registration acknowledgement and persists the real login token', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: 'real-access-token',
          refresh_token: 'real-refresh-token',
          expires_in: 3600,
        }),
      );

    await expect(
      register('teacher@example.test', 'strong-password', 'invite-code', 'teacher'),
    ).resolves.toEqual({
      access_token: 'real-access-token',
      refresh_token: 'real-refresh-token',
      expires_in: 3600,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      mode: 'register',
      username: 'teacher',
      password: 'strong-password',
      email: 'teacher@example.test',
      inviteCode: 'invite-code',
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      mode: 'login',
      username: 'teacher@example.test',
      password: 'strong-password',
    });
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'access_token',
      'real-access-token',
    );
    expect(localStorageMock.setItem).not.toHaveBeenCalledWith(
      'access_token',
      undefined,
    );
  });
});
