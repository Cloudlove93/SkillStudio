import { useRef, useEffect } from 'react';
import { useT } from '../../i18n';

export interface SlashCommand {
  id: string;
  trigger: string;
  title: string;
  description?: string;
  type: 'builtin' | 'custom';
  source?: 'command' | 'mcp' | 'skill';
}

export default function SlashPopover({
  commands,
  activeId,
  onSelect,
  onActiveChange,
}: {
  commands: SlashCommand[];
  activeId: string | null;
  onSelect: (cmd: SlashCommand) => void;
  onActiveChange: (id: string) => void;
}) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);

  // Scroll active item into view
  useEffect(() => {
    if (!activeId || !containerRef.current) return;
    const el = containerRef.current.querySelector(`[data-slash-id="${activeId}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  if (commands.length === 0) {
    return (
      <div className="absolute inset-x-0 bottom-full mb-1 rounded-xl border border-border/70 bg-popover p-2 shadow-md">
        <p className="px-2 py-1 text-xs text-muted-foreground">{t('slash.noResults')}</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="absolute inset-x-0 bottom-full mb-1 max-h-60 overflow-auto rounded-xl border border-border/70 bg-popover p-1 shadow-md"
      onMouseDown={(e) => e.preventDefault()}
    >
      {commands.map((cmd) => (
        <button
          key={cmd.id}
          data-slash-id={cmd.id}
          className={`flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left transition-colors ${
            activeId === cmd.id ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
          }`}
          onClick={() => onSelect(cmd)}
          onMouseEnter={() => onActiveChange(cmd.id)}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-medium text-foreground whitespace-nowrap">/{cmd.trigger}</span>
            {cmd.description && (
              <span className="text-xs text-muted-foreground truncate">{cmd.description}</span>
            )}
          </div>
          {cmd.type === 'custom' && cmd.source && cmd.source !== 'command' && (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {cmd.source === 'skill' ? t('slash.badgeSkill') : cmd.source === 'mcp' ? t('slash.badgeMcp') : t('slash.badgeCustom')}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
