import { create } from 'zustand';
import * as diaryApi from '../api/diary';

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface DiaryStore {
  selectedDate: string;
  content: string;
  dirty: boolean;
  diaryDates: Set<string>;
  loading: boolean;
  saving: boolean;
  autoSaveStatus: 'idle' | 'saving' | 'saved';

  setSelectedDate: (date: string) => void;
  loadDiary: (date: string) => Promise<void>;
  setContent: (content: string) => void;
  save: () => Promise<void>;
  loadDiaryDates: (year: number, month: number) => Promise<void>;
  setAutoSaveStatus: (status: 'idle' | 'saving' | 'saved') => void;
}

export const useDiaryStore = create<DiaryStore>((set, get) => ({
  selectedDate: todayStr(),
  content: '',
  dirty: false,
  diaryDates: new Set(),
  loading: false,
  saving: false,
  autoSaveStatus: 'idle',

  setSelectedDate(date: string) {
    if (date === get().selectedDate) return;
    // Only flush if content was actually edited (dirty)
    const { content, selectedDate: prevDate, saving, dirty } = get();
    if (dirty && content.trim() && !saving) {
      diaryApi.saveDiary(prevDate, content).then(() => {
        const dates = new Set(get().diaryDates);
        dates.add(prevDate);
        set({ diaryDates: dates });
      }).catch(() => {});
    }
    set({ selectedDate: date, autoSaveStatus: 'idle', dirty: false });
    get().loadDiary(date);
  },

  async loadDiary(date: string) {
    set({ loading: true });
    try {
      const res = await diaryApi.fetchDiary(date);
      // Only update if still on the same date
      if (get().selectedDate === date) {
        set({ content: res.content, loading: false, autoSaveStatus: 'idle', dirty: false });
      }
    } catch {
      if (get().selectedDate === date) {
        set({ content: '', loading: false, dirty: false });
      }
    }
  },

  setContent(content: string) {
    set({ content, autoSaveStatus: 'idle', dirty: true });
  },

  async save() {
    const { selectedDate, content } = get();
    set({ saving: true, autoSaveStatus: 'saving' });
    try {
      await diaryApi.saveDiary(selectedDate, content);
      set({ saving: false, autoSaveStatus: 'saved', dirty: false });
      // Update diaryDates to include this date if content is non-empty
      const dates = new Set(get().diaryDates);
      if (content.trim()) {
        dates.add(selectedDate);
      } else {
        dates.delete(selectedDate);
      }
      set({ diaryDates: dates });
    } catch {
      set({ saving: false, autoSaveStatus: 'idle' });
    }
  },

  setAutoSaveStatus(status: 'idle' | 'saving' | 'saved') {
    set({ autoSaveStatus: status });
  },

  async loadDiaryDates(year: number, month: number) {
    try {
      const res = await diaryApi.fetchDiaryDates(year, month);
      set({ diaryDates: new Set(res.dates) });
    } catch {
      // ignore
    }
  },
}));
