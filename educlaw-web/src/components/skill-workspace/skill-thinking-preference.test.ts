import { describe, expect, it } from 'vitest';
import {
  readThinkingPreference,
  SKILL_THINKING_PREFERENCE_KEY,
  writeThinkingPreference,
} from './skill-thinking-preference';

function createStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined)
    values.set(SKILL_THINKING_PREFERENCE_KEY, initial);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  } satisfies Storage;
}

describe('Skill thinking preference', () => {
  it('defaults safely to disabled and only accepts the versioned enabled value', () => {
    expect(readThinkingPreference(createStorage())).toBe(false);
    expect(readThinkingPreference(createStorage('broken'))).toBe(false);
    expect(readThinkingPreference(createStorage('1'))).toBe(true);
  });

  it('stores enabled and disabled values without throwing on unavailable storage', () => {
    const storage = createStorage();
    writeThinkingPreference(true, storage);
    expect(storage.getItem(SKILL_THINKING_PREFERENCE_KEY)).toBe('1');
    writeThinkingPreference(false, storage);
    expect(storage.getItem(SKILL_THINKING_PREFERENCE_KEY)).toBe('0');

    const unavailable = {
      getItem() {
        throw new Error('unavailable');
      },
      setItem() {
        throw new Error('unavailable');
      },
    } as unknown as Storage;
    expect(readThinkingPreference(unavailable)).toBe(false);
    expect(() => writeThinkingPreference(true, unavailable)).not.toThrow();
  });
});
