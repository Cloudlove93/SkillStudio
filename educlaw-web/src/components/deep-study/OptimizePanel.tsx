import { useEffect, useMemo } from 'react';
import { Loader2, RefreshCw, Sparkles, Check, X, ChevronRight, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useOptimizeStore } from '../../stores/optimize';
import { useT, type MessageKey } from '../../i18n';
import type { OptimizationItemStatus, OptimizationRun, OptimizationRunStatus, OptimizationTargetKind, OptimizationTriggerSource } from '../../api/manager';

function formatTime(value: string) {
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? value : time.toLocaleString();
}

function riskTone(risk: 'low' | 'medium' | 'high') {
  if (risk === 'high') return 'border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-400';
  if (risk === 'medium') return 'border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400';
  return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
}

function statusTone(status: string) {
  if (status === 'applied') return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
  if (status === 'rejected') return 'border-slate-500/20 bg-slate-500/10 text-slate-600 dark:text-slate-300';
  if (status === 'failed') return 'border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-400';
  if (status === 'partial') return 'border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400';
  return 'border-primary/20 bg-primary/10 text-primary';
}

function riskLabel(risk: 'low' | 'medium' | 'high') {
  if (risk === 'high') return '\u9ad8\u98ce\u9669';
  if (risk === 'medium') return '\u4e2d\u98ce\u9669';
  return '\u4f4e\u98ce\u9669';
}

function targetScopeLabel(scope: string) {
  if (scope === 'user') return '\u6211\u7684';
  if (scope === 'shared') return '\u5171\u4eab';
  return '\u9884\u7f6e';
}

function getTargetDisplay(run: Pick<OptimizationRun, 'target_label' | 'target_ref'>) {
  const label = run.target_label?.trim();
  const ref = run.target_ref.trim();
  return {
    label: label || ref,
    showRef: Boolean(label) && label !== ref,
  };
}

function renderPatch(patchType: string, patch: Record<string, unknown>) {
  if (patchType === 'skill_markdown' && typeof patch.content === 'string') {
    return patch.content;
  }
  return JSON.stringify(patch, null, 2);
}

const targetKeyMap: Record<OptimizationTargetKind, MessageKey> = {
  profile: 'optimize.target.profile',
  skill: 'optimize.target.skill',
  agent: 'optimize.target.agent',
};

const statusKeyMap: Record<OptimizationRunStatus | OptimizationItemStatus, MessageKey> = {
  pending: 'optimize.status.pending',
  partial: 'optimize.status.partial',
  applied: 'optimize.status.applied',
  rejected: 'optimize.status.rejected',
  failed: 'optimize.status.failed',
};

const triggerKeyMap: Record<OptimizationTriggerSource, MessageKey> = {
  detail: 'optimize.trigger.detail',
  chat: 'optimize.trigger.chat',
};

export default function OptimizePanel() {
  const t = useT();
  const runs = useOptimizeStore((s) => s.runs);
  const selectedRunId = useOptimizeStore((s) => s.selectedRunId);
  const loading = useOptimizeStore((s) => s.loading);
  const creating = useOptimizeStore((s) => s.creating);
  const acting = useOptimizeStore((s) => s.acting);
  const setSelectedRunId = useOptimizeStore((s) => s.setSelectedRunId);
  const fetchRuns = useOptimizeStore((s) => s.fetchRuns);
  const applyRun = useOptimizeStore((s) => s.applyRun);
  const rejectRun = useOptimizeStore((s) => s.rejectRun);
  const deleteRun = useOptimizeStore((s) => s.deleteRun);

  useEffect(() => {
    void fetchRuns(true);
  }, [fetchRuns]);

  const selected = useMemo(
    () => runs.find((run) => run.run.id === selectedRunId) ?? runs[0],
    [runs, selectedRunId],
  );
  const pendingCount = selected?.items.filter((item) => item.status === 'pending').length ?? 0;
  const selectedTargetDisplay = selected ? getTargetDisplay(selected.run) : null;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border/70 px-6 py-5">
        <div>
          <div className="text-lg font-semibold text-foreground">{t('optimize.title')}</div>
          <div className="mt-1 text-sm text-muted-foreground">{t('optimize.subtitle')}</div>
        </div>
        <Button variant="outline" size="sm" onClick={() => void fetchRuns(true)} disabled={loading || creating || acting} className="gap-1.5 rounded-full">
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          {t('optimize.refresh')}
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[19rem_minmax(0,1fr)]">
        <div className="border-b border-border/70 lg:border-b-0 lg:border-r lg:border-r-border/70">
          <div className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {t('optimize.history')}
          </div>
          <div className="max-h-full space-y-2 overflow-auto px-3 pb-3">
            {runs.length === 0 && (
              <div className="rounded-[18px] border border-dashed border-border/70 bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
                <div className="font-medium text-foreground">{t('optimize.empty')}</div>
                <div className="mt-2 text-xs leading-6">{creating ? t('optimize.generating') : t('optimize.emptyHint')}</div>
              </div>
            )}
            {runs.map(({ run, items }) => {
              const active = selected?.run.id === run.id;
              const targetDisplay = getTargetDisplay(run);
              return (
                <button
                  key={run.id}
                  onClick={() => setSelectedRunId(run.id)}
                  className={`w-full rounded-[18px] border px-4 py-3 text-left transition-colors ${
                    active ? 'border-primary/25 bg-primary/8' : 'border-border/70 bg-card hover:border-primary/20 hover:bg-muted/40'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-foreground">{targetDisplay.label}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{t(targetKeyMap[run.target_kind as OptimizationTargetKind])}</span>
                        <span>&middot;</span>
                        <span>{targetScopeLabel(run.target_scope)}</span>
                        <span>&middot;</span>
                        <span>{formatTime(run.created_at)}</span>
                      </div>
                      {targetDisplay.showRef && (
                        <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground/80">{run.target_ref}</div>
                      )}
                    </div>
                    <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusTone(run.status)}`}>
                      {t(statusKeyMap[run.status as OptimizationRunStatus])}
                    </span>
                  </div>
                  <div className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{run.summary || t('optimize.noSelection')}</div>
                  <div className="mt-2 text-[11px] text-muted-foreground">{`${items.length} \u6761\u5efa\u8bae`}</div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="min-h-0 overflow-auto px-5 py-5 sm:px-6">
          {!selected && (
            <div className="flex h-full min-h-[280px] items-center justify-center rounded-[24px] border border-dashed border-border/70 bg-muted/20 px-6 text-center text-sm text-muted-foreground">
              {t('optimize.noSelection')}
            </div>
          )}

          {selected && (
            <div className="space-y-5">
              <div className="card-premium rounded-[24px] p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <Sparkles className="size-4 text-primary" />
                      {selected.run.summary || t('optimize.title')}
                    </div>
                    <div className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                      <div><span className="font-medium text-foreground">{t('optimize.target')}:</span> {selectedTargetDisplay?.label}</div>
                      {selectedTargetDisplay?.showRef && (
                        <div><span className="font-medium text-foreground">标识:</span> <span className="font-mono">{selected.run.target_ref}</span></div>
                      )}
                      <div><span className="font-medium text-foreground">{t('optimize.scope')}:</span> {targetScopeLabel(selected.run.target_scope)}</div>
                      <div><span className="font-medium text-foreground">{t('optimize.trigger')}:</span> {t(triggerKeyMap[selected.run.trigger_source as OptimizationTriggerSource])}</div>
                      <div><span className="font-medium text-foreground">{t('optimize.model')}:</span> {selected.run.model || '-'}</div>
                    </div>
                    {selected.run.instruction && (
                      <div className="mt-3 rounded-[16px] border border-border/70 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">{t('optimize.instruction')}:</span> {selected.run.instruction}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${statusTone(selected.run.status)}`}>
                      {t(statusKeyMap[selected.run.status as OptimizationRunStatus])}
                    </span>
                    <Button size="sm" variant="outline" disabled={acting} onClick={() => void deleteRun(selected.run.id)} className="gap-1.5 rounded-full">
                      <Trash2 className="size-3.5" />
                      {'\u5220\u9664'}
                    </Button>
                    <Button size="sm" variant="outline" disabled={acting || pendingCount === 0} onClick={() => void rejectRun(selected.run.id)} className="gap-1.5 rounded-full">
                      <X className="size-3.5" />
                      {t('optimize.rejectAll')}
                    </Button>
                    <Button size="sm" disabled={acting || pendingCount === 0} onClick={() => void applyRun(selected.run.id)} className="gap-1.5 rounded-full">
                      <Check className="size-3.5" />
                      {t('optimize.applyAll')}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                {selected.items.length === 0 && (
                  <div className="rounded-[20px] border border-dashed border-border/70 bg-muted/20 px-5 py-6 text-sm text-muted-foreground">
                    {t('optimize.noSuggestions')}
                  </div>
                )}
                {selected.items.map((item) => (
                  <div key={item.id} className="rounded-[22px] border border-border/70 bg-card p-5 shadow-[var(--shadow-sm)]">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-base font-semibold text-foreground">{item.title}</div>
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${riskTone(item.risk)}`}>{riskLabel(item.risk)}</span>
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusTone(item.status)}`}>{t(statusKeyMap[item.status as OptimizationItemStatus])}</span>
                        </div>
                        <div className="mt-2 text-sm leading-6 text-muted-foreground">{item.preview}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        {item.status === 'pending' && (
                          <>
                            <Button size="sm" variant="outline" disabled={acting} onClick={() => void rejectRun(selected.run.id, item.suggestion_key)} className="gap-1.5 rounded-full">
                              <X className="size-3.5" />
                              {t('optimize.reject')}
                            </Button>
                            <Button size="sm" disabled={acting} onClick={() => void applyRun(selected.run.id, item.suggestion_key)} className="gap-1.5 rounded-full">
                              <Check className="size-3.5" />
                              {t('optimize.apply')}
                            </Button>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="mt-4 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                      <div className="rounded-[18px] border border-border/70 bg-muted/25 px-4 py-3">
                        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('optimize.rationale')}</div>
                        <div className="text-sm leading-6 text-foreground/90">{item.rationale || '-'}</div>
                      </div>
                      <div className="rounded-[18px] border border-border/70 bg-muted/25 px-4 py-3">
                        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('optimize.result')}</div>
                        <div className="text-sm leading-6 text-foreground/90">{item.result_note || '-'}</div>
                      </div>
                    </div>

                    <div className="mt-4 rounded-[18px] border border-border/70 bg-background px-4 py-3">
                      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        <ChevronRight className="size-3.5" />
                        {t('optimize.patch')}
                      </div>
                      <pre className="overflow-auto whitespace-pre-wrap break-words rounded-[14px] bg-muted/40 p-3 text-xs leading-6 text-foreground">{renderPatch(item.patch_type, item.patch)}</pre>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
