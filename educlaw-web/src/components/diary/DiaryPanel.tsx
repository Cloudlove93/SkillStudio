import { useEffect, useCallback, useRef, useMemo } from 'react';
import { Loader2, Flame, FileText, PenLine } from 'lucide-react';

import { BlockNoteEditor } from '@blocknote/core';
import { BlockNoteView } from '@blocknote/shadcn';
import { useDiaryStore } from '../../stores/diary';
import DiaryCalendar from './DiaryCalendar';
import { useT } from '../../i18n';
import { useTheme } from '../theme-provider';

function countWords(text: string): number {
  if (!text.trim()) return 0;
  const cjk = text.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g);
  const latin = text.replace(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g, ' ').trim();
  const latinWords = latin ? latin.split(/\s+/).filter(Boolean).length : 0;
  return (cjk?.length ?? 0) + latinWords;
}

function calcStreak(diaryDates: Set<string>, todayStr: string): { days: number; includestoday: boolean } {
  const todayHas = diaryDates.has(todayStr);
  const d = new Date(todayStr);
  if (!todayHas) d.setDate(d.getDate() - 1);
  let days = 0;
  while (true) {
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!diaryDates.has(ds)) break;
    days++;
    d.setDate(d.getDate() - 1);
  }
  return { days, includestoday: todayHas };
}

function formatDisplayDate(dateStr: string, lang: string): { day: number; monthLabel: string; weekday: string } {
  const parts = dateStr.split('-');
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  const date = new Date(y, m - 1, d);
  if (lang === 'zh') {
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return { day: d, monthLabel: `${y}年${m}月`, weekday: weekdays[date.getDay()] };
  }
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return { day: d, monthLabel: `${monthNames[m - 1]} ${y}`, weekday: weekdays[date.getDay()] };
}

let diaryEditorSingleton: BlockNoteEditor | null = null;

function createDiaryEditor(): BlockNoteEditor {
  const originalWarn = console.warn;

  console.warn = (...args: unknown[]) => {
    const [firstArg] = args;
    if (
      typeof firstArg === 'string'
      && firstArg.includes('linkifyjs: already initialized - will not register custom scheme')
    ) {
      return;
    }
    originalWarn(...args);
  };

  try {
    return BlockNoteEditor.create();
  } finally {
    console.warn = originalWarn;
  }
}

function getDiaryEditor(): BlockNoteEditor {
  if (diaryEditorSingleton === null) {
    diaryEditorSingleton = createDiaryEditor();
  }
  return diaryEditorSingleton;
}

export default function DiaryPanel() {
  const t = useT();
  const { theme } = useTheme();
  const {
    selectedDate, content, diaryDates, loading, autoSaveStatus,
    setSelectedDate, loadDiary, setContent, save, loadDiaryDates,
  } = useDiaryStore();

  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedIndicatorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorOrigin = useRef(false);
  const editor = getDiaryEditor();

  useEffect(() => {
    loadDiary(selectedDate);
    const parts = selectedDate.split('-');
    loadDiaryDates(parseInt(parts[0], 10), parseInt(parts[1], 10));
  }, [selectedDate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset editorOrigin when selectedDate changes to ensure editor syncs new content
  useEffect(() => {
    editorOrigin.current = false;
  }, [selectedDate]);

  useEffect(() => {
    if (editorOrigin.current) { editorOrigin.current = false; return; }
    async function syncBlocks() {
      const blocks = await editor.tryParseMarkdownToBlocks(content);
      editor.replaceBlocks(editor.document, blocks);
    }
    syncBlocks();
  }, [content, editor]);

  const handleEditorChange = useCallback(async () => {
    const md = await editor.blocksToMarkdownLossy(editor.document);
    editorOrigin.current = true;
    setContent(md);
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    if (savedIndicatorTimer.current) clearTimeout(savedIndicatorTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      save().then(() => {
        savedIndicatorTimer.current = setTimeout(() => {
          useDiaryStore.getState().setAutoSaveStatus('idle');
        }, 2000);
      });
    }, 1500);
  }, [editor, setContent, save]);

  useEffect(() => {
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      if (savedIndicatorTimer.current) clearTimeout(savedIndicatorTimer.current);
    };
  }, []);

  const handleSelectDate = useCallback((date: string) => {
    // Clear pending auto-save timers before switching dates
    if (autoSaveTimer.current) { clearTimeout(autoSaveTimer.current); autoSaveTimer.current = null; }
    if (savedIndicatorTimer.current) { clearTimeout(savedIndicatorTimer.current); savedIndicatorTimer.current = null; }
    setSelectedDate(date);
  }, [setSelectedDate]);

  const handleMonthChange = useCallback((year: number, month: number) => {
    loadDiaryDates(year, month);
  }, [loadDiaryDates]);

  const resolvedTheme = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;

  const lang = t('diary.weekdays').startsWith('日') ? 'zh' : 'en';

  const todayStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  const wordCount = useMemo(() => countWords(content), [content]);
  const monthEntries = diaryDates.size;
  const streak = useMemo(() => calcStreak(diaryDates, todayStr), [diaryDates, todayStr]);
  const displayDate = useMemo(() => formatDisplayDate(selectedDate, lang), [selectedDate, lang]);

  return (
    <div className="flex h-full flex-col bg-transparent">
      <div className="px-6 pb-4 pt-5">
        <div className="card-premium overflow-hidden rounded-[30px] p-6">
          <div className="flex items-stretch gap-6">
            <div className="flex-1 min-w-0 flex items-center justify-center gap-8">
              <div className="flex items-center gap-1 select-none">
                <span className="text-6xl font-black leading-none tabular-nums text-foreground">{displayDate.day}</span>
                <div className="flex flex-col pl-1 gap-0.5">
                  <span className="text-sm font-semibold text-foreground/80 tracking-wide">{displayDate.monthLabel}</span>
                  <span className="text-xs text-muted-foreground/70">{displayDate.weekday}</span>
                  {autoSaveStatus === 'saving' && (
                    <span className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Loader2 className="size-2.5 animate-spin" />
                      {t('diary.saving')}
                    </span>
                  )}
                  {autoSaveStatus === 'saved' && (
                    <span className="mt-0.5 text-[11px] text-emerald-500/70">{t('diary.saved')}</span>
                  )}
                </div>
              </div>

              <div className="flex gap-2.5">
                <div className="flex min-w-[88px] flex-col items-center gap-1 rounded-[20px] border border-orange-500/12 bg-orange-500/6 px-4 py-3">
                  <Flame className={`size-5 ${streak.days > 0 ? 'text-orange-500' : 'text-muted-foreground/25'}`} />
                  <span className={`text-lg font-bold leading-none ${streak.days > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-muted-foreground/40'}`}>
                    {streak.days}
                  </span>
                  <span className="text-[10px] text-muted-foreground/60">
                    {streak.days > 0 ? t('diary.streak').replace('{n} ', '') : t('diary.streakBroken')}
                  </span>
                </div>
                <div className="flex min-w-[88px] flex-col items-center gap-1 rounded-[20px] border border-primary/10 bg-primary/5 px-4 py-3">
                  <FileText className="size-5 text-primary/50" />
                  <span className="text-lg font-bold leading-none text-primary/80">{monthEntries}</span>
                  <span className="text-[10px] text-muted-foreground/60">{t('diary.monthEntries').replace('{n} ', '').replace('{n}', '')}</span>
                </div>
                <div className="flex min-w-[88px] flex-col items-center gap-1 rounded-[20px] border border-emerald-500/12 bg-emerald-500/6 px-4 py-3">
                  <PenLine className="size-5 text-emerald-500/50" />
                  <span className="text-lg font-bold leading-none text-emerald-600 dark:text-emerald-400">{wordCount}</span>
                  <span className="text-[10px] text-muted-foreground/60">{t('diary.wordCount')}</span>
                </div>
              </div>
            </div>

            <div className="w-px bg-border/30 shrink-0" />

            <div className="w-56 shrink-0">
              <DiaryCalendar
                selectedDate={selectedDate}
                diaryDates={diaryDates}
                onSelectDate={handleSelectDate}
                onMonthChange={handleMonthChange}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6">
        <div className="card-premium mx-auto max-w-4xl rounded-[30px] p-5">
          {loading ? (
            <div className="flex items-center justify-center h-64 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : (
            <BlockNoteView
              editor={editor}
              onChange={handleEditorChange}
              theme={resolvedTheme}
            />
          )}
        </div>
      </div>
    </div>
  );
}
