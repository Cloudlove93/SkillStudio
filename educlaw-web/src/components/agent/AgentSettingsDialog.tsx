import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { useAgentStore } from '../../stores/agent';
import { useT } from '../../i18n';
import { DetailSurface, PremiumHeader, PremiumPill } from '@/components/ui/premium';
import { Globe, Lock, SlidersHorizontal } from 'lucide-react';

export default function AgentSettingsDialog({
  agentId,
  open,
  onOpenChange,
}: {
  agentId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const agent = useAgentStore((s) => agentId ? s.agents.find((a) => a.id === agentId) : undefined);
  const togglePublic = useAgentStore((s) => s.togglePublic);

  if (!agent) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden border-border/70 bg-background/98 p-0 shadow-[var(--shadow-lg)] sm:max-w-lg">
        <DialogHeader className="sr-only">
          <DialogTitle>{t('agentSettings.title')}</DialogTitle>
          <DialogDescription>{agent.name}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 p-4 sm:p-5">
          <PremiumHeader
            accent={agent.public ? 'emerald' : 'violet'}
            icon={SlidersHorizontal}
            eyebrow={t('agentSettings.public')}
            title={t('agentSettings.title')}
            description={agent.name}
            actions={
              <PremiumPill accent={agent.public ? 'emerald' : 'slate'} icon={agent.public ? Globe : Lock}>
                {agent.public ? t('shared.public') : t('shared.private')}
              </PremiumPill>
            }
          />

          <DetailSurface className="p-4 sm:p-5">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <div className={`flex size-8 items-center justify-center rounded-2xl ${agent.public ? 'bg-gradient-to-br from-emerald-500/16 to-teal-500/10 text-emerald-600 dark:text-emerald-300' : 'bg-gradient-to-br from-slate-500/14 to-white/20 text-slate-600 dark:text-slate-300'}`}>
                    {agent.public ? <Globe className="size-4" /> : <Lock className="size-4" />}
                  </div>
                  {t('agentSettings.public')}
                </div>
                <p className="pl-10 text-xs leading-5 text-muted-foreground">{t('agentSettings.publicDesc')}</p>
              </div>
              <Switch
                checked={!!agent.public}
                onCheckedChange={(checked) => togglePublic(agent.id, checked)}
                className="h-6 w-11 rounded-full"
              />
            </div>
          </DetailSurface>
        </div>
      </DialogContent>
    </Dialog>
  );
}
