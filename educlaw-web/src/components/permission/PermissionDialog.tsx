import { useInteractionQueueStore } from '../../stores/interaction-queue';
import { useAgentStore } from '../../stores/agent';
import { agentRuntimeApi } from '../../api/runtime';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useT } from '../../i18n';
import { DetailSurface, PremiumHeader, PremiumPill } from '@/components/ui/premium';
import { ShieldAlert, ShieldCheck, TerminalSquare, Workflow } from 'lucide-react';

export default function PermissionDialog() {
  const t = useT();
  const pending = useInteractionQueueStore((s) => s.pendingPermissions);
  const agents = useAgentStore((s) => s.agents);

  if (pending.length === 0) return null;

  const perm = pending[0];
  const agent = agents.find((a) => a.id === perm.agentId);

  async function respond(reply: 'once' | 'always' | 'reject') {
    const api = agentRuntimeApi(perm.agentId);
    const sessionID = perm.sessionID ?? '';
    await api.respondPermission(sessionID, perm.id, reply);
    useInteractionQueueStore.getState().removePermission(perm.id);
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) respond('reject'); }}>
      <DialogContent showCloseButton={false} className="overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="sr-only">
          <DialogTitle>{t('perm.title')}</DialogTitle>
          <DialogDescription>
            {t('perm.agent')}
            {agent?.name ?? perm.agentId}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 p-4 sm:p-5">
          <PremiumHeader
            accent="amber"
            icon={ShieldAlert}
            eyebrow={t('perm.runtimeApproval')}
            title={t('perm.title')}
            description={
              <>
                {t('perm.agent')}
                <span className="font-medium text-foreground">{agent?.name ?? perm.agentId}</span>
              </>
            }
            actions={<PremiumPill accent="amber" icon={Workflow}>{perm.toolName}</PremiumPill>}
          />

          <DetailSurface className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {t('perm.tool')}
                </div>
                <div className="mt-2 flex items-center gap-2 text-sm font-mono text-foreground">
                  <div className="flex size-8 items-center justify-center rounded-[10px] bg-[rgba(55,130,255,0.10)] text-[color:var(--info)]">
                    <TerminalSquare className="size-4" />
                  </div>
                  {perm.toolName}
                </div>
              </div>
              <PremiumPill accent="slate">{t('perm.queued')}</PremiumPill>
            </div>
            {perm.input && (
              <>
                <div className="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {t('perm.input')}
                </div>
                <pre className="mt-2 max-h-56 overflow-auto rounded-[12px] border border-border bg-muted p-3 text-xs text-foreground whitespace-pre-wrap break-all">
                  {typeof perm.input === 'string' ? perm.input : JSON.stringify(perm.input, null, 2)}
                </pre>
              </>
            )}
            {perm.message && (
              <div className="mt-4 rounded-[12px] border border-[rgba(255,180,0,0.18)] bg-[rgba(255,180,0,0.10)] px-3 py-2 text-xs leading-5 text-muted-foreground">
                {perm.message}
              </div>
            )}
          </DetailSurface>

          <DialogFooter className="flex gap-2 sm:justify-between">
            <Button variant="outline" onClick={() => respond('reject')} className="gap-2">
              <ShieldAlert className="size-4" />
              {t('perm.deny')}
            </Button>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => respond('once')} className="gap-2">
                <ShieldCheck className="size-4" />
                {t('perm.once')}
              </Button>
              <Button onClick={() => respond('always')} className="gap-2 px-4">
                <ShieldCheck className="size-4" />
                {t('perm.always')}
              </Button>
            </div>
          </DialogFooter>

          {pending.length > 1 && <p className="text-center text-xs text-muted-foreground">{t('perm.pending').replace('{n}', String(pending.length - 1))}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
