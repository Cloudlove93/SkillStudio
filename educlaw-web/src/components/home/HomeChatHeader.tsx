import { ChevronDown } from 'lucide-react';
import { useT } from '../../i18n';
import { BASE } from '../../api/client';
import type { HomeChatModelOption } from '../../hooks/useHomeChatModels';

interface HomeChatHeaderProps {
  models: HomeChatModelOption[];
  selectedModel: string;
  onSelectModel: (model: string) => void;
}

export default function HomeChatHeader({
  models,
  selectedModel,
  onSelectModel,
}: HomeChatHeaderProps) {
  const t = useT();

  return (
    <div className="flex items-center justify-between border-b border-border/70 px-5 py-4">
      <div className="flex items-center gap-3">
        <div className="relative">
          <div className="absolute -inset-2 rounded-full bg-primary/10 blur-lg" />
          <img src={`${BASE}/logo.png`} alt="" className="relative size-9 rounded-2xl drop-shadow-sm" />
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground/60">
            Guided Conversation
          </div>
          <span className="text-sm font-semibold tracking-[-0.02em] text-foreground">{t('home.chatTitle')}</span>
        </div>
      </div>

      {models.length > 1 ? (
        <div className="relative">
          <select
            value={selectedModel}
            onChange={(e) => onSelectModel(e.target.value)}
            className="appearance-none rounded-full border border-border/70 bg-background/95 py-2 pl-3 pr-8 text-[11px] text-muted-foreground shadow-sm transition-colors hover:border-primary/30 focus:outline-none focus:ring-1 focus:ring-primary/30"
          >
            {models.map((model) => (
              <option key={model.name} value={model.name}>
                {model.name}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/50" />
        </div>
      ) : models.length === 1 ? (
        <span className="rounded-full border border-border/70 bg-background/95 px-3 py-1.5 text-[11px] text-muted-foreground/70 shadow-sm">
          {models[0].name}
        </span>
      ) : null}
    </div>
  );
}
