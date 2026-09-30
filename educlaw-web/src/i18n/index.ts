import zh from './zh';
import en from './en';
import { useSettingsStore } from '../stores/settings';

const messages = { zh, en } as const;

export type Locale = keyof typeof messages;
export type MessageKey = keyof typeof zh;

/**
 * Returns a translation function `t(key)` that resolves to the current locale's string.
 * Falls back to Chinese, then to the raw key.
 */
export function useT() {
  const lang = useSettingsStore((s) => s.language);
  return function t(key: MessageKey): string {
    return messages[lang]?.[key] ?? messages.zh[key] ?? key;
  };
}
