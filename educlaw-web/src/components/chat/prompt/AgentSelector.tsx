import { useMemo, useState } from 'react';
import { ChevronUp } from 'lucide-react';
import type { AgentOption } from '../PromptInput';
import { useT } from '../../../i18n';

export default function AgentSelector({
  agents,
  currentAgent,
  onAgentChange,
}: {
  agents: AgentOption[];
  currentAgent?: string;
  onAgentChange?: (name: string) => void;
}) {
  const t = useT();
  const [showPicker, setShowPicker] = useState(false);
  const visibleAgents = useMemo(
    () => agents.filter((a) => a.mode !== 'subagent' && !a.hidden),
    [agents],
  );

  if (visibleAgents.length <= 1) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setShowPicker(!showPicker)}
        className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/60 transition-colors"
        title={t('prompt.switchAgent')}
      >
        <span>{currentAgent ?? visibleAgents[0]?.name ?? 'agent'}</span>
        <ChevronUp className={`size-2.5 transition-transform ${showPicker ? '' : 'rotate-180'}`} />
      </button>
      {showPicker && (
        <div
          className="absolute bottom-full left-0 mb-1 min-w-[140px] rounded-lg border border-border/60 bg-popover p-1 shadow-lg"
          onMouseDown={(e) => e.preventDefault()}
        >
          {visibleAgents.map((a) => (
            <button
              key={a.name}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                (currentAgent ?? visibleAgents[0]?.name) === a.name
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-accent/50'
              }`}
              onClick={() => { onAgentChange?.(a.name); setShowPicker(false); }}
            >
              <span className="font-medium">{a.name}</span>
              {a.description && <span className="text-muted-foreground truncate">{a.description}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
