import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  ACCESS_TOKEN_KEY,
  LEGACY_TOKEN_KEY,
  REFRESH_TOKEN_KEY,
  clearStoredTokens,
  getStoredAccessToken,
  persistTokens,
} from './token-storage';

class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

function withLocalStorage(fn: (storage: Storage) => void): void {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });
  fn(storage);
}

test('persistTokens stores access and refresh tokens under the new keys', () => {
  withLocalStorage((storage) => {
    persistTokens({
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      expires_in: 3600,
    });

    assert.equal(storage.getItem(ACCESS_TOKEN_KEY), 'access-1');
    assert.equal(storage.getItem(REFRESH_TOKEN_KEY), 'refresh-1');
  });
});

test('getStoredAccessToken prefers the new key and still falls back to the legacy token', () => {
  withLocalStorage((storage) => {
    storage.setItem(LEGACY_TOKEN_KEY, 'legacy-token');
    assert.equal(getStoredAccessToken(), 'legacy-token');

    storage.setItem(ACCESS_TOKEN_KEY, 'access-2');
    assert.equal(getStoredAccessToken(), 'access-2');
  });
});

test('clearStoredTokens removes both new and legacy auth keys', () => {
  withLocalStorage((storage) => {
    storage.setItem(ACCESS_TOKEN_KEY, 'access-3');
    storage.setItem(REFRESH_TOKEN_KEY, 'refresh-3');
    storage.setItem(LEGACY_TOKEN_KEY, 'legacy-token');

    clearStoredTokens();

    assert.equal(storage.getItem(ACCESS_TOKEN_KEY), null);
    assert.equal(storage.getItem(REFRESH_TOKEN_KEY), null);
    assert.equal(storage.getItem(LEGACY_TOKEN_KEY), null);
  });
});
