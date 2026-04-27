import { useState } from 'react';
import { Brain, ChevronDown, ChevronRight } from 'lucide-react';

export default function ReasoningPartView({ text, isStreaming }: { text: string; isStreaming?: boolean }) {
  const [expanded, setExpanded] = useState(true);

  if (!text && !isStreaming) return null;

  // During streaming — compact inline with animated indicator
  if (isStreaming) {
    return (
      <div className="flex items-start gap-2 py-1 animate-fade-in">
        <Brain size={12} className="mt-0.5 shrink-0 text-violet-500 dark:text-violet-400 animate-pulse" />
        <p className="text-xs text-muted-foreground/70 italic leading-relaxed whitespace-pre-wrap">
          {text}
          <span className="animate-blink-cursor text-violet-500 font-bold">▍</span>
        </p>
      </div>
    );
  }

  // Completed — full collapsible view
  return (
    <div className="my-1.5 rounded-lg border border-dashed border-muted-foreground/20 bg-violet-500/[0.03] dark:bg-violet-500/[0.05] overflow-hidden animate-fade-in">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors hover:bg-muted/30"
      >
        <Brain size={12} className="text-violet-500 dark:text-violet-400 shrink-0" />
        <span className="font-medium text-muted-foreground italic">Thinking</span>
        <span className="text-muted-foreground/50 transition-transform duration-150">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
      </button>
      {expanded && (
        <div className="animate-slide-down border-t border-dashed border-muted-foreground/20 px-3 py-2">
          <p className="text-xs text-muted-foreground/70 italic leading-relaxed whitespace-pre-wrap">
            {text}
          </p>
        </div>
      )}
    </div>
  );
}
