import { useState } from 'react';
import { ChevronDown, CheckCircle2, Circle, Loader2, ListTodo } from 'lucide-react';
import type { Todo } from '../../stores/todo';
import { useT } from '../../i18n';
import { PremiumPill } from '@/components/ui/premium';

export default function TodoDock({ todos }: { todos: Todo[] }) {
  const t = useT();
  const [collapsed, setCollapsed] = useState(false);

  if (todos.length === 0) return null;

  const done = todos.filter((td) => td.status === 'completed').length;
  const total = todos.length;
  const progressPct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="overflow-hidden rounded-[20px] border border-border bg-card shadow-sm">
      {/* Header */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/70"
      >
        <div className="flex size-9 shrink-0 items-center justify-center rounded-[14px] bg-emerald-50 text-emerald-600 dark:bg-emerald-500/12 dark:text-emerald-300">
          <ListTodo className="size-4" />
        </div>
        <div className="min-w-0">
          <div className="text-sm text-foreground">
            <span className="font-medium">{done}</span>
            <span className="text-muted-foreground"> {t('todo.of')} </span>
            <span className="font-medium">{total}</span>
            <span className="text-muted-foreground"> {t('todo.completed')}</span>
          </div>
          <div className="mt-1">
            <PremiumPill accent="emerald">{progressPct}%</PremiumPill>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mx-2 h-2 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        <ChevronDown
          className={`size-4 text-muted-foreground shrink-0 transition-transform duration-200 ${collapsed ? '-rotate-90' : ''}`}
        />
      </button>

      {/* List */}
      {!collapsed && (
        <div className="flex max-h-52 flex-col gap-1.5 overflow-y-auto border-t border-border/70 px-4 py-4">
          {todos.map((td) => (
            <div
              key={td.id}
              className={`flex items-start gap-3 rounded-[18px] px-3 py-2 text-sm ${
                td.status === 'completed' || td.status === 'cancelled'
                  ? 'border border-border/70 bg-muted/45 text-muted-foreground/70'
                  : 'border border-border bg-background text-foreground shadow-sm'
              }`}
            >
              <span className="mt-0.5 shrink-0">
                {td.status === 'completed' ? (
                  <CheckCircle2 className="size-4 text-emerald-500" />
                ) : td.status === 'in_progress' ? (
                  <Loader2 className="size-4 text-blue-500 animate-spin" />
                ) : (
                  <Circle className="size-4 text-muted-foreground/40" />
                )}
              </span>
              <span className={`min-w-0 flex-1 ${td.status === 'completed' || td.status === 'cancelled' ? 'line-through' : ''}`}>
                {td.content}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
