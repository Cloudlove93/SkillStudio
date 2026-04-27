import { useState, useMemo, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '../../i18n';

interface DiaryCalendarProps {
  selectedDate: string;
  diaryDates: Set<string>;
  onSelectDate: (date: string) => void;
  onMonthChange: (year: number, month: number) => void;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatDate(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export default function DiaryCalendar({ selectedDate, diaryDates, onSelectDate, onMonthChange }: DiaryCalendarProps) {
  const t = useT();
  const today = useMemo(() => {
    const d = new Date();
    return formatDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }, []);

  const [viewYear, viewMonth] = useMemo(() => {
    const parts = selectedDate.split('-');
    return [parseInt(parts[0], 10), parseInt(parts[1], 10)];
  }, [selectedDate]);

  const [displayYear, setDisplayYear] = useState(viewYear);
  const [displayMonth, setDisplayMonth] = useState(viewMonth);

  // Sync display when selectedDate changes externally
  useEffect(() => {
    setDisplayYear(viewYear);
    setDisplayMonth(viewMonth);
  }, [viewYear, viewMonth]);

  const daysInMonth = new Date(displayYear, displayMonth, 0).getDate();
  const firstDayOfWeek = new Date(displayYear, displayMonth - 1, 1).getDay();

  const weekDays = t('diary.weekdays').split(',');

  function goPrev() {
    let y = displayYear;
    let m = displayMonth - 1;
    if (m < 1) { m = 12; y--; }
    setDisplayYear(y);
    setDisplayMonth(m);
    onMonthChange(y, m);
  }

  function goNext() {
    let y = displayYear;
    let m = displayMonth + 1;
    if (m > 12) { m = 1; y++; }
    setDisplayYear(y);
    setDisplayMonth(m);
    onMonthChange(y, m);
  }

  function goToday() {
    const d = new Date();
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    setDisplayYear(y);
    setDisplayMonth(m);
    onMonthChange(y, m);
    onSelectDate(today);
  }

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDayOfWeek; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div className="space-y-1">
      {/* Header: month nav */}
      <div className="flex items-center justify-between px-1">
        <Button variant="ghost" size="icon-xs" onClick={goPrev}>
          <ChevronLeft className="size-3.5" />
        </Button>
        <button
          onClick={goToday}
          className="text-xs font-semibold text-foreground hover:text-primary transition-colors"
        >
          {displayYear} / {pad(displayMonth)}
        </button>
        <Button variant="ghost" size="icon-xs" onClick={goNext}>
          <ChevronRight className="size-3.5" />
        </Button>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {weekDays.map((d) => (
          <div key={d} className="text-[10px] font-medium text-muted-foreground/50 py-0.5">
            {d}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((day, i) => {
          if (day === null) return <div key={`empty-${i}`} />;
          const dateStr = formatDate(displayYear, displayMonth, day);
          const isSelected = dateStr === selectedDate;
          const isToday = dateStr === today;
          const hasDiary = diaryDates.has(dateStr);

          return (
            <button
              key={dateStr}
              onClick={() => onSelectDate(dateStr)}
              className={`
                relative flex flex-col items-center justify-center rounded-md aspect-square text-xs transition-all
                ${isSelected
                  ? 'bg-primary text-primary-foreground font-semibold shadow-sm'
                  : isToday
                    ? 'bg-primary/10 text-primary font-medium ring-1 ring-primary/30'
                    : hasDiary
                      ? 'hover:bg-muted/60 text-foreground font-medium'
                      : 'hover:bg-muted/60 text-foreground/60'
                }
              `}
            >
              {day}
              {hasDiary && !isSelected && (
                <span className="absolute bottom-0.5 size-1 rounded-full bg-primary/70" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
