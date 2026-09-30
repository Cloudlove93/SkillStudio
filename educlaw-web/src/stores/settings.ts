import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Locale } from '../i18n';

interface SettingsStore {
  /** null = not yet initialized (will fetch all on first load) */
  enabledPublicSkills: string[] | null;
  setEnabledPublicSkills: (v: string[]) => void;

  language: Locale;
  setLanguage: (v: Locale) => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      enabledPublicSkills: null,
      setEnabledPublicSkills: (v: string[]) => set({ enabledPublicSkills: v }),

      language: 'zh',
      setLanguage: (v: Locale) => set({ language: v }),
    }),
    { name: 'educlaw-settings' },
  ),
);
