export const SKILL_THINKING_PREFERENCE_KEY =
  'educlaw.skill-chat.thinking.v1';

function browserStorage(): Storage | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.localStorage;
}

export function readThinkingPreference(storage = browserStorage()): boolean {
  try {
    return storage?.getItem(SKILL_THINKING_PREFERENCE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeThinkingPreference(
  enabled: boolean,
  storage = browserStorage(),
): void {
  try {
    storage?.setItem(SKILL_THINKING_PREFERENCE_KEY, enabled ? '1' : '0');
  } catch {
    // Preference persistence is optional and must not block the conversation.
  }
}
