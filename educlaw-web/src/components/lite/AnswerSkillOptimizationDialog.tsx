import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FlaskConical,
  Loader2,
  RefreshCw,
  Save,
  Sparkles,
  WandSparkles,
  XCircle,
} from 'lucide-react';
import type { ArenaAnswerOptimizationSummary } from '@educlaw/shared';
import {
  AnswerOptimizationApiError,
  answerSkillOptimizationApi,
  type AnswerSkillOptimizationDetail,
  type ConfirmAnswerOptimizationResult,
  type CreateAnswerOptimizationInput,
} from '../../api/answer-skill-optimizations';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { MarkdownContent } from './lite-rendering';
import {
  createIdempotencyKey,
  formatOptimizationFailure,
  formatOptimizationPatchOperation,
  formatOptimizationPatchSection,
  formatOptimizationReusability,
  formatOptimizationStatus,
  formatOptimizationUnavailableReason,
  formatAnswerOptimizationSampleAssessment,
  formatRefinementTechnicalFailure,
  getAnswerOptimizationAvailableActions,
  getAnswerOptimizationFailureReasonGroups,
  getAnswerOptimizationFlowStep,
  getConfirmBlockReason,
} from './answer-skill-optimization-state';

type MutationAction =
  | 'create'
  | 'revise'
  | 'refine'
  | 'alternative'
  | 'test'
  | 'confirm'
  | 'cancel';

export interface AnswerOptimizationDialogTarget extends CreateAnswerOptimizationInput {
  optimizationId: number | null;
  completedVersionNumber: number | null;
  questionContent: string;
  answerContent: string;
}

interface Props {
  open: boolean;
  token: string;
  target: AnswerOptimizationDialogTarget | null;
  onOpenChange: (open: boolean) => void;
  onSummaryChanged: (
    enhancedAnswerMessageId: number,
  ) => Promise<ArenaAnswerOptimizationSummary | null>;
  onConfirmed: (result: ConfirmAnswerOptimizationResult) => Promise<void>;
}

interface UiError {
  message: string;
  requestId: string | null;
}

function errorForDisplay(error: unknown): UiError {
  if (error instanceof AnswerOptimizationApiError) {
    return {
      message: error.payload.code
        ? formatRefinementTechnicalFailure(error.payload.code)
        : formatOptimizationFailure(
            error.payload.reason ?? error.payload.error,
          ),
      requestId: error.requestId,
    };
  }
  return {
    message: formatOptimizationFailure(null),
    requestId: null,
  };
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-border/70 pt-4 first:border-t-0 first:pt-0">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

export function AnswerSkillOptimizationDialog({
  open,
  token,
  target,
  onOpenChange,
  onSummaryChanged,
  onConfirmed,
}: Props) {
  const [detail, setDetail] = useState<AnswerSkillOptimizationDetail | null>(
    null,
  );
  const [feedback, setFeedback] = useState('');
  const [additionalFeedback, setAdditionalFeedback] = useState('');
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [versionNote, setVersionNote] = useState('');
  const [busyAction, setBusyAction] = useState<MutationAction | null>(null);
  const [error, setError] = useState<UiError | null>(null);
  const [confirmResult, setConfirmResult] =
    useState<ConfirmAnswerOptimizationResult | null>(null);
  const [confirmWarningOpen, setConfirmWarningOpen] = useState(false);
  const operationKeys = useRef<Partial<Record<MutationAction, string>>>({});
  const activeMutation = useRef<MutationAction | null>(null);
  const currentDraftRef = useRef<HTMLDivElement | null>(null);

  const operationKey = useCallback((action: MutationAction) => {
    const existing = operationKeys.current[action];
    if (existing) return existing;
    const next = createIdempotencyKey();
    operationKeys.current[action] = next;
    return next;
  }, []);

  const clearOperationKey = useCallback((action: MutationAction) => {
    delete operationKeys.current[action];
  }, []);

  const beginOperation = useCallback((action: MutationAction) => {
    if (activeMutation.current !== null) return false;
    activeMutation.current = action;
    setBusyAction(action);
    return true;
  }, []);

  const endOperation = useCallback(() => {
    activeMutation.current = null;
    setBusyAction(null);
  }, []);

  const applyDetail = useCallback((next: AnswerSkillOptimizationDetail) => {
    setDetail(next);
    setFeedback(next.feedback);
    setSelectedSkillIds(next.targetSkill ? [next.targetSkill.skillId] : []);
    setError(null);
  }, []);

  const loadDetail = useCallback(
    async (optimizationId: number) => {
      const response = await answerSkillOptimizationApi.get(
        token,
        optimizationId,
      );
      applyDetail(response.data);
      return response.data;
    },
    [applyDetail, token],
  );

  const refreshSummary = useCallback(() => {
    if (!target) return Promise.resolve(null);
    return onSummaryChanged(target.enhancedAnswerMessageId);
  }, [onSummaryChanged, target]);

  useEffect(() => {
    if (!open || !target) return;
    operationKeys.current = {};
    activeMutation.current = null;
    setBusyAction(null);
    setError(null);
    setConfirmResult(null);
    setConfirmWarningOpen(false);
    setVersionNote('');
    setAdditionalFeedback('');
    setSelectedSkillIds([]);
    if (target.optimizationId === null) {
      setDetail(null);
      setFeedback(target.feedback);
      return;
    }
    setDetail(null);
    setBusyAction('create');
    void loadDetail(target.optimizationId)
      .catch((loadError) => setError(errorForDisplay(loadError)))
      .finally(() => setBusyAction(null));
  }, [loadDetail, open, target]);

  useEffect(() => {
    if (!open || detail?.status !== 'processing') return;
    const timer = window.setTimeout(() => {
      void loadDetail(detail.optimizationId).catch((loadError) =>
        setError(errorForDisplay(loadError)),
      );
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [detail?.optimizationId, detail?.status, loadDetail, open]);

  const recoverConflict = useCallback(
    async (caught: AnswerOptimizationApiError) => {
      const optimizationId =
        caught.payload.existingOptimizationId || detail?.optimizationId;
      if (!optimizationId || caught.statusCode !== 409) return false;
      await loadDetail(optimizationId);
      await refreshSummary();
      setError({
        message: '任务已在其他操作中更新，已加载服务器上的最新状态',
        requestId: caught.requestId,
      });
      return true;
    },
    [detail?.optimizationId, loadDetail, refreshSummary],
  );

  async function handleCreate() {
    if (!target) return;
    const normalized = feedback.trim();
    if (!normalized || normalized.length > 2000) {
      setError({ message: '反馈需为 1～2000 个字符', requestId: null });
      return;
    }
    if (!beginOperation('create')) return;
    setError(null);
    try {
      const response = await answerSkillOptimizationApi.create(
        token,
        {
          packageId: target.packageId,
          threadId: target.threadId,
          questionMessageId: target.questionMessageId,
          enhancedAnswerMessageId: target.enhancedAnswerMessageId,
          baselineAnswerMessageId: target.baselineAnswerMessageId,
          feedback: normalized,
        },
        operationKey('create'),
      );
      clearOperationKey('create');
      applyDetail(response.data);
      await refreshSummary();
    } catch (caught) {
      if (
        caught instanceof AnswerOptimizationApiError &&
        (await recoverConflict(caught))
      ) {
        clearOperationKey('create');
      } else {
        setError(errorForDisplay(caught));
        const summary = await refreshSummary().catch(() => null);
        if (summary?.optimizationId) {
          await loadDetail(summary.optimizationId).catch(() => undefined);
        }
      }
    } finally {
      endOperation();
    }
  }

  async function handleRegenerateDraft() {
    if (!detail || !detail.replayAvailability.available) return;
    const normalized = feedback.trim();
    if (!normalized || normalized.length > 2000) {
      setError({ message: '反馈需为 1～2000 个字符', requestId: null });
      return;
    }
    if (!beginOperation('revise')) return;
    setError(null);
    try {
      const isTargetSelection = detail.status === 'target_selection_required';
      const targetSelectionPayload =
        isTargetSelection && selectedSkillIds.length === 1
          ? { targetSkillId: selectedSkillIds[0] }
          : isTargetSelection && selectedSkillIds.length > 1
            ? { targetSkillIds: selectedSkillIds }
            : {};
      const response = await answerSkillOptimizationApi.revise(
        token,
        detail.optimizationId,
        {
          expectedRevision: detail.revision,
          feedback: normalized,
          ...targetSelectionPayload,
        },
        operationKey('revise'),
      );
      clearOperationKey('revise');
      applyDetail(response.data);
      await refreshSummary();
    } catch (caught) {
      if (
        caught instanceof AnswerOptimizationApiError &&
        (await recoverConflict(caught))
      ) {
        clearOperationKey('revise');
      } else {
        setError(errorForDisplay(caught));
      }
    } finally {
      endOperation();
    }
  }

  async function handleAlternativeRegeneration() {
    if (
      !detail ||
      detail.status !== 'draft_ready' ||
      !detail.replayAvailability.available
    ) {
      return;
    }
    if (!beginOperation('alternative')) return;
    setError(null);
    try {
      const response = await answerSkillOptimizationApi.revise(
        token,
        detail.optimizationId,
        {
          expectedRevision: detail.revision,
          revisionSource: 'alternative_regeneration',
        },
        operationKey('alternative'),
      );
      clearOperationKey('alternative');
      setAdditionalFeedback('');
      applyDetail(response.data);
      window.requestAnimationFrame(() =>
        currentDraftRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        }),
      );
      await refreshSummary();
    } catch (caught) {
      if (
        caught instanceof AnswerOptimizationApiError &&
        (await recoverConflict(caught))
      ) {
        clearOperationKey('alternative');
      } else {
        setError(errorForDisplay(caught));
        if (caught instanceof AnswerOptimizationApiError) {
          clearOperationKey('alternative');
        }
        await loadDetail(detail.optimizationId).catch(() => undefined);
      }
    } finally {
      endOperation();
    }
  }

  async function handleRefineDraft(
    revisionSource: 'draft_review' | 'test_failure',
  ) {
    if (!detail || !detail.replayAvailability.available) return;
    const normalized = additionalFeedback.trim();
    if (
      (revisionSource === 'draft_review' && !normalized) ||
      normalized.length > 1500
    ) {
      setError({
        message:
          revisionSource === 'draft_review'
            ? '请先填写希望怎样修改当前草稿'
            : '补充意见不能超过 1500 个字符',
        requestId: null,
      });
      return;
    }
    if (!beginOperation('refine')) return;
    setError(null);
    try {
      const payload =
        revisionSource === 'draft_review'
          ? {
              expectedRevision: detail.revision,
              additionalFeedback: normalized,
              revisionSource: 'draft_review' as const,
            }
          : {
              expectedRevision: detail.revision,
              ...(normalized ? { additionalFeedback: normalized } : {}),
              revisionSource: 'test_failure' as const,
            };
      const response = await answerSkillOptimizationApi.revise(
        token,
        detail.optimizationId,
        payload,
        operationKey('refine'),
      );
      clearOperationKey('refine');
      const latest = response.data;
      applyDetail(latest);
      const latestTurn = latest.refinementHistory.at(-1);
      if (latestTurn?.outcome?.kind === 'applied') {
        setAdditionalFeedback('');
        window.requestAnimationFrame(() =>
          currentDraftRef.current?.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
          }),
        );
      }
      await refreshSummary();
    } catch (caught) {
      if (
        caught instanceof AnswerOptimizationApiError &&
        (await recoverConflict(caught))
      ) {
        clearOperationKey('refine');
      } else {
        setError(errorForDisplay(caught));
        if (caught instanceof AnswerOptimizationApiError) {
          clearOperationKey('refine');
        }
        await loadDetail(detail.optimizationId).catch(() => undefined);
      }
    } finally {
      endOperation();
    }
  }

  async function handleTest() {
    if (!detail || !detail.replayAvailability.available) return;
    if (!beginOperation('test')) return;
    setError(null);
    try {
      await answerSkillOptimizationApi.test(
        token,
        detail.optimizationId,
        detail.revision,
        operationKey('test'),
      );
      clearOperationKey('test');
      await loadDetail(detail.optimizationId);
      await refreshSummary();
    } catch (caught) {
      if (
        caught instanceof AnswerOptimizationApiError &&
        (await recoverConflict(caught))
      ) {
        clearOperationKey('test');
      } else {
        setError(errorForDisplay(caught));
      }
    } finally {
      endOperation();
    }
  }

  async function handleConfirm() {
    if (
      !detail ||
      !detail.replayAvailability.available ||
      getConfirmBlockReason(detail)
    ) {
      return;
    }
    if (!beginOperation('confirm')) return;
    setError(null);
    try {
      const response = await answerSkillOptimizationApi.confirm(
        token,
        detail.optimizationId,
        {
          expectedRevision: detail.revision,
          ...(versionNote.trim() ? { versionNote: versionNote.trim() } : {}),
        },
        operationKey('confirm'),
      );
      clearOperationKey('confirm');
      setConfirmWarningOpen(false);
      setConfirmResult(response.data);
      await loadDetail(detail.optimizationId);
      await onConfirmed(response.data);
    } catch (caught) {
      if (
        caught instanceof AnswerOptimizationApiError &&
        (await recoverConflict(caught))
      ) {
        clearOperationKey('confirm');
      } else {
        setError(errorForDisplay(caught));
      }
    } finally {
      endOperation();
    }
  }

  function requestConfirm() {
    if (!detail || !availableActions.canConfirm) return;
    if (availableActions.confirmNeedsAdvisory) {
      setConfirmWarningOpen(true);
      return;
    }
    void handleConfirm();
  }

  async function handleCancel() {
    if (!detail || detail.status === 'completed') return;
    if (!beginOperation('cancel')) return;
    setError(null);
    try {
      await answerSkillOptimizationApi.cancel(
        token,
        detail.optimizationId,
        {
          expectedRevision: detail.revision,
          reason: 'user_cancelled',
        },
        operationKey('cancel'),
      );
      clearOperationKey('cancel');
      await loadDetail(detail.optimizationId);
      await refreshSummary();
    } catch (caught) {
      if (
        caught instanceof AnswerOptimizationApiError &&
        (await recoverConflict(caught))
      ) {
        clearOperationKey('cancel');
      } else {
        setError(errorForDisplay(caught));
      }
    } finally {
      endOperation();
    }
  }

  const status = detail?.status;
  const replayUnavailable =
    detail !== null && !detail.replayAvailability.available;
  const initialFeedbackEditable =
    !replayUnavailable &&
    (!status ||
      status === 'target_selection_required' ||
      (status === 'failed' && !detail?.draft));
  const availableActions = detail
    ? getAnswerOptimizationAvailableActions(detail)
    : {
        canRefineDraft: false,
        refinementSource: 'draft_review' as const,
        refinementRequiresFeedback: true,
        canPreviewDraft: false,
        canRegenerateAlternative: false,
        canConfirm: false,
        confirmNeedsAdvisory: false,
      };
  const previewHasIssues =
    detail?.status === 'test_ready' &&
    Boolean(detail.testResult) &&
    !detail.testResult!.qualityGate.passed;
  const failureReasonGroups = detail
    ? getAnswerOptimizationFailureReasonGroups(detail)
    : { visible: [], hidden: [] };
  const flowStep = getAnswerOptimizationFlowStep(detail);
  const confirmBlockReason = detail ? getConfirmBlockReason(detail) : null;
  const advisoryIssues = failureReasonGroups.visible
    .flatMap((group) => group.reasons)
    .slice(0, 5);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="border-b border-border/70 px-5 py-4 pr-12">
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle>优化这次回答</DialogTitle>
            {status && (
              <Badge variant="secondary">
                {formatOptimizationStatus(status)}
              </Badge>
            )}
          </div>
          <DialogDescription>
            系统正在修改智能体以后回答类似问题时遵守的规则。当前内容只是草稿，尚未影响正式版本。
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[calc(92vh-7rem)] space-y-5 overflow-y-auto px-5 py-4">
          <ol className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            {[
              '提出反馈',
              '查看并修改规则草稿',
              '预览草稿效果',
              '确认保存新版本',
            ].map((label, index) => {
              const step = (index + 1) as 1 | 2 | 3 | 4;
              return (
                <li
                  key={label}
                  className={`rounded-[8px] border px-3 py-2 ${
                    step === flowStep
                      ? 'border-primary bg-primary/5 font-medium text-primary'
                      : step < flowStep
                        ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700'
                        : 'border-border text-muted-foreground'
                  }`}
                >
                  {step} {label}
                </li>
              );
            })}
          </ol>

          <Section title="本次问答">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="min-w-0">
                <div className="mb-1 text-xs text-muted-foreground">原问题</div>
                <div className="whitespace-pre-wrap text-sm leading-6">
                  {detail?.question.content ||
                    target?.questionContent ||
                    '问题内容将在任务创建后由服务器读取'}
                </div>
              </div>
              <div className="min-w-0">
                <div className="mb-1 text-xs text-muted-foreground">
                  原增强回答
                </div>
                <div className="max-h-40 overflow-y-auto text-sm leading-6">
                  {detail?.originalAnswer.content ? (
                    <MarkdownContent content={detail.originalAnswer.content} />
                  ) : target?.answerContent ? (
                    <MarkdownContent content={target.answerContent} />
                  ) : (
                    <span className="text-muted-foreground">
                      回答内容将在任务创建后由服务器读取
                    </span>
                  )}
                </div>
              </div>
            </div>
          </Section>

          {replayUnavailable && (
            <div className="rounded-[8px] border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-800">
              {formatOptimizationUnavailableReason(
                detail.replayAvailability.reason,
              )}
              。已有诊断和草稿仍可查看，也可以取消本任务。
            </div>
          )}

          {detail?.failureCode && (
            <div className="rounded-[8px] border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {formatOptimizationFailure(detail.failureCode)}
            </div>
          )}

          {detail?.draft?.validation.valid && (
            <div
              ref={currentDraftRef}
              className="scroll-mt-4 rounded-[8px] border border-primary/25 bg-primary/5 p-3"
            >
              <div className="text-sm font-semibold text-primary">
                当前展示：草稿 v{detail.revision}
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                这是最近一次成功生成的规则草稿。失败的修改尝试不会改变这里的内容。
              </p>
            </div>
          )}

          {initialFeedbackEditable && (
            <Section title="你的初始反馈">
              <Textarea
                value={feedback}
                onChange={(event) => {
                  setFeedback(event.target.value);
                  clearOperationKey(detail ? 'revise' : 'create');
                }}
                maxLength={2000}
                rows={4}
                placeholder="例如：回答太笼统，希望按时间顺序给出可执行步骤，并增加可以直接使用的沟通话术。"
                disabled={Boolean(busyAction)}
              />
              <div className="mt-1 text-right text-xs text-muted-foreground">
                {feedback.trim().length}/2000
              </div>
            </Section>
          )}

          {detail?.draft && (
            <Section title="你的初始反馈">
              <p className="whitespace-pre-wrap text-sm leading-6">
                {detail.feedback}
              </p>
            </Section>
          )}

          {detail?.diagnosis && (
            <Section title="我们理解到的问题">
              <p className="text-sm leading-6">{detail.diagnosis.summary}</p>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                这是系统根据你的反馈归纳出的长期问题。若理解不准确，可以在下方继续补充意见。
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge variant="outline">
                  {formatOptimizationReusability(detail.diagnosis.reusability)}
                </Badge>
                {detail.diagnosis.riskNotes.map((note) => (
                  <Badge key={note} variant="secondary">
                    {note}
                  </Badge>
                ))}
              </div>
            </Section>
          )}

          {detail?.candidateSkills.length ? (
            <Section title="选择要修改的 Skill（可多选）">
              <div className="grid gap-2 sm:grid-cols-2">
                {detail.candidateSkills.map((candidate) => {
                  const selected = selectedSkillIds.includes(
                    candidate.skillId,
                  );
                  return (
                    <label
                      key={candidate.skillId}
                      className={`min-w-0 cursor-pointer rounded-[8px] border px-3 py-2 text-left transition-colors ${
                        selected
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:bg-muted/50'
                      } ${
                        Boolean(busyAction) || replayUnavailable
                          ? 'cursor-not-allowed opacity-60'
                          : ''
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          className="mt-0.5 size-4 accent-primary"
                          checked={selected}
                          onChange={(event) => {
                            if (event.target.checked) {
                              setSelectedSkillIds([
                                ...selectedSkillIds,
                                candidate.skillId,
                              ]);
                            } else {
                              setSelectedSkillIds(
                                selectedSkillIds.filter(
                                  (id) => id !== candidate.skillId,
                                ),
                              );
                            }
                            clearOperationKey('revise');
                          }}
                          disabled={Boolean(busyAction) || replayUnavailable}
                        />
                        <div className="min-w-0">
                          <div className="text-sm font-medium">
                            {candidate.name}
                          </div>
                          <div className="mt-1 text-xs leading-5 text-muted-foreground">
                            {candidate.reason}
                          </div>
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
              {selectedSkillIds.length > 1 && (
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  已选择 {selectedSkillIds.length} 个 Skill，将依次为每个
                  Skill 生成修改草稿，确认保存后会逐个推进。
                </p>
              )}
            </Section>
          ) : null}

          {detail?.plannedTargets && detail.plannedTargets.length > 1 && (
            <Section title="优化进度">
              <ol className="space-y-1.5">
                {detail.plannedTargets.map((target, index) => (
                  <li
                    key={target.skillId}
                    className="flex items-center gap-2 text-sm"
                  >
                    <span
                      className={`size-2 shrink-0 rounded-full ${
                        target.status === 'completed'
                          ? 'bg-emerald-500'
                          : target.status === 'active'
                            ? 'bg-primary'
                            : target.status === 'failed'
                              ? 'bg-destructive'
                              : 'bg-muted-foreground/30'
                      }`}
                    />
                    <span className="min-w-0 truncate">
                      {index + 1}. {target.name}
                    </span>
                    {target.status === 'completed' &&
                      target.confirmedVersionNumber && (
                        <Badge variant="outline" className="ml-1 text-xs">
                          v{target.confirmedVersionNumber}
                        </Badge>
                      )}
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {target.status === 'pending'
                        ? '待处理'
                        : target.status === 'active'
                          ? '处理中'
                          : target.status === 'completed'
                            ? '已完成'
                            : '已失败'}
                    </span>
                  </li>
                ))}
              </ol>
            </Section>
          )}

          {detail?.targetSkill && detail.patch && (
            <Section title="AI 准备怎样修改回答规则">
              <div className="grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <span className="text-xs text-muted-foreground">
                    要修改的规则模块（Skill）
                  </span>
                  <div className="mt-0.5 font-medium">
                    {detail.targetSkill.name}
                  </div>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">
                    要修改的位置
                  </span>
                  <div className="mt-0.5">
                    {formatOptimizationPatchSection(detail.patch.section)}
                  </div>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">修改方式</span>
                  <div className="mt-0.5">
                    {formatOptimizationPatchOperation(detail.patch.operation)}
                  </div>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">预期改善</span>
                  <div className="mt-0.5">让以后遇到类似问题时回答得更符合你的要求</div>
                </div>
              </div>
              <div className="mt-3 rounded-[8px] bg-muted/50 p-3">
                <div className="text-xs text-muted-foreground">为什么这样改</div>
                <p className="mt-1 text-sm leading-6">{detail.patch.reason}</p>
              </div>
              {detail.draft && (
                <div className="mt-2 text-xs text-muted-foreground">
                  格式校验：
                  {detail.draft.validation.valid ? '通过' : '未通过'}
                </div>
              )}
            </Section>
          )}

          {detail?.diff && (
            <Section title={`当前规则与草稿 v${detail.revision}`}>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="min-w-0">
                  <div className="mb-1 text-xs font-medium text-red-600">
                    当前版本中的规则
                  </div>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-[8px] bg-red-500/5 p-3 text-xs leading-5">
                    {detail.diff.before}
                  </pre>
                </div>
                <div className="min-w-0">
                  <div className="mb-1 text-xs font-medium text-emerald-600">
                    草稿 v{detail.revision} 准备写入的规则
                  </div>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-[8px] bg-emerald-500/5 p-3 text-xs leading-5">
                    {detail.diff.after}
                  </pre>
                </div>
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                这里只展示本次涉及的规则片段，不是整个 Skill
                文件。绿色内容目前只是修改草稿，完成重测并点击“确认保存新版本”后才会生效。
              </p>
            </Section>
          )}

          {detail && detail.refinementHistory.length > 0 && (
            <Section title="草稿修改记录">
              <div className="space-y-3">
                {detail.refinementHistory.map((turn) => {
                  const outcome = turn.outcome;
                  const applied = outcome?.kind === 'applied';
                  return (
                    <div
                      key={turn.id}
                      className="rounded-[8px] border border-border/70 p-3 text-sm"
                    >
                      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline">
                          {applied && turn.toRevision
                            ? `基于草稿 v${turn.fromRevision} → 已生成草稿 v${turn.toRevision}`
                            : `基于草稿 v${turn.fromRevision}`}
                        </Badge>
                        <span>
                          {turn.source === 'test_failure'
                            ? '参考效果预览中的改进建议'
                            : turn.source === 'alternative_regeneration'
                              ? '重新生成另一套方案'
                              : '根据草稿审阅意见'}
                        </span>
                        {turn.status === 'pending' && (
                          <Badge variant="secondary">正在处理</Badge>
                        )}
                        {outcome && !applied && (
                          <Badge variant="secondary">未生成新草稿</Badge>
                        )}
                      </div>
                      <p className="leading-6">
                        <span className="font-medium">
                          {turn.source === 'alternative_regeneration'
                            ? '你的操作：'
                            : '你的意见：'}
                        </span>
                        {turn.userMessage}
                      </p>
                      {outcome?.kind === 'applied' && (
                        <p className="mt-1 leading-6 text-muted-foreground">
                          <span className="font-medium text-foreground">
                            系统已调整：
                          </span>
                          {outcome.assistantSummary}
                        </p>
                      )}
                      {outcome?.kind === 'needs_clarification' && (
                        <div className="mt-2 rounded-[8px] bg-amber-500/5 p-3">
                          <div className="font-medium">还需要你再说明一点</div>
                          <p className="mt-1 leading-6">{outcome.message}</p>
                          <p className="mt-1 font-medium">
                            {outcome.clarificationQuestion}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {outcome.suggestedFeedback.map((suggestion) => (
                              <Button
                                key={suggestion}
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={Boolean(busyAction)}
                                onClick={() => {
                                  setAdditionalFeedback(suggestion);
                                  clearOperationKey('refine');
                                }}
                              >
                                {suggestion}
                              </Button>
                            ))}
                          </div>
                        </div>
                      )}
                      {outcome?.kind ===
                        'not_suitable_for_shared_rule' && (
                        <div className="mt-2 rounded-[8px] bg-amber-500/5 p-3">
                          <div className="font-medium">
                            这条意见更适合当前这一次回答
                          </div>
                          <p className="mt-1 leading-6">{outcome.message}</p>
                          {outcome.suggestedReusableFeedback && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="mt-2"
                              disabled={Boolean(busyAction)}
                              onClick={() => {
                                setAdditionalFeedback(
                                  outcome.suggestedReusableFeedback!,
                                );
                                clearOperationKey('refine');
                              }}
                            >
                              使用可复用的改写建议
                            </Button>
                          )}
                        </div>
                      )}
                      {outcome?.kind === 'technical_failure' && (
                        <div className="mt-2 rounded-[8px] bg-red-500/5 p-3 text-red-700">
                          <div className="font-medium">
                            这次没有生成新草稿：
                            {formatRefinementTechnicalFailure(outcome.code)}
                          </div>
                          <p className="mt-1 leading-6">
                            当前仍为草稿 v{turn.fromRevision}
                            ，原草稿和重测结果没有变化。
                          </p>
                        </div>
                      )}
                      {outcome && !applied && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          本次未生成新草稿；提交当时仍为草稿 v
                          {turn.fromRevision}。
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {detail?.testResult && (
            <Section title="草稿效果预览">
              <div
                className={`mb-3 flex items-start gap-2 rounded-[8px] border p-3 ${
                  detail.testResult.qualityGate.passed
                    ? 'border-emerald-500/30 bg-emerald-500/5'
                    : 'border-amber-500/30 bg-amber-500/5'
                }`}
              >
                {detail.testResult.qualityGate.passed ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                ) : (
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                )}
                <div className="text-sm">
                  <div className="font-medium">
                    {detail.testResult.qualityGate.passed
                      ? '效果较稳定'
                      : '发现可改进点'}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {detail.testResult.qualityGate.passed
                      ? '三次生成结果总体符合你的反馈要求。'
                      : 'AI 评估发现以下可改进内容，你可以继续修改草稿，也可以结合专业判断保存。'}
                  </p>
                  <div className="mt-2 text-xs leading-5 text-muted-foreground">
                    AI 评估总结：
                    {detail.testResult.qualityGate.overallSummary}
                  </div>
                </div>
              </div>

              {previewHasIssues && (
                <div className="mb-3 rounded-[8px] border border-amber-500/30 bg-amber-500/5 p-3">
                  <div className="text-sm font-medium">
                    AI 发现的可改进内容
                  </div>
                  <div className="mt-2 space-y-2 text-xs leading-5 text-amber-900">
                    {failureReasonGroups.visible.map((group) => (
                      <div key={group.label}>
                        <div className="font-medium">{group.label}</div>
                        <ul className="list-disc pl-5">
                          {group.reasons.map((reason) => (
                            <li key={reason}>{reason}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                    {failureReasonGroups.hidden.length > 0 && (
                      <details>
                        <summary className="cursor-pointer font-medium">
                          查看其余可改进内容
                        </summary>
                        <div className="mt-2 space-y-2">
                          {failureReasonGroups.hidden.map((group) => (
                            <div key={group.label}>
                              <div className="font-medium">{group.label}</div>
                              <ul className="list-disc pl-5">
                                {group.reasons.map((reason) => (
                                  <li key={reason}>{reason}</li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                </div>
              )}

              <div className="grid gap-3 lg:grid-cols-3">
                {detail.testResult.samples.map((sample, index) => (
                  <div
                    key={`${detail.testResult!.testedRevision}-${index}`}
                    className="min-w-0 rounded-[8px] border border-border/70 p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold">
                        样本 {index + 1}
                        {index ===
                          detail.testResult!.qualityGate.bestSampleIndex &&
                          ' · 最佳'}
                      </span>
                      <Badge variant={sample.passed ? 'default' : 'secondary'}>
                        {formatAnswerOptimizationSampleAssessment(sample)}
                      </Badge>
                    </div>
                    <div className="mt-2 max-h-48 overflow-y-auto text-xs leading-5">
                      <MarkdownContent content={sample.answer} />
                    </div>
                    {sample.satisfiedRequirements.length > 0 && (
                      <div className="mt-2 text-xs text-emerald-700">
                        已满足的要求：
                        {sample.satisfiedRequirements.join('；')}
                      </div>
                    )}
                    {sample.unmetRequirements.length > 0 && (
                      <div className="mt-2 text-xs text-amber-700">
                        可改进的问题：
                        {sample.unmetRequirements.join('；')}
                      </div>
                    )}
                    {(sample.criticalRisk || sample.riskNotes.length > 0) && (
                      <div className="mt-2 text-xs text-red-600">
                        风险提示：
                        {sample.criticalRisk
                          ? '存在关键风险'
                          : sample.riskNotes.join('；')}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-3 text-xs text-muted-foreground">
                正式使用时能否选中这项规则：
                {detail.testResult.runtimeSelectionCheck.targetSkillSelected
                  ? '可以'
                  : '暂时不能，因此还不能保存新版本'}
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                AI 评估仅供参考，请结合你的专业判断决定是否保存。
              </p>
            </Section>
          )}

          {detail && availableActions.canRefineDraft && (
            <Section
              title={
                previewHasIssues
                  ? '根据预览问题修改当前草稿'
                  : '对这份修改草稿还有意见？'
              }
            >
              <p className="mb-3 text-xs leading-5 text-muted-foreground">
                {previewHasIssues
                  ? '系统已经整理出本次预览发现的问题。你可以直接让系统按这些问题修改，也可以补充自己的要求。'
                  : '可以告诉系统哪些内容需要保留、删除、加强或换一种表达。系统会在当前草稿基础上修改。'}
              </p>
              <Textarea
                value={additionalFeedback}
                onChange={(event) => {
                  setAdditionalFeedback(event.target.value);
                  clearOperationKey('refine');
                }}
                maxLength={1500}
                rows={3}
                placeholder={
                  previewHasIssues
                    ? '可选，例如：根据上面的问题修改，并保留当前五步处理顺序。'
                    : '例如：保留当天五步处理结构，但把家长沟通写得更中性，并明确不能让学生承担监控职责。'
                }
                disabled={Boolean(busyAction)}
              />
              <div className="mt-1 text-right text-xs text-muted-foreground">
                {additionalFeedback.trim().length}/1500
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  onClick={() =>
                    void handleRefineDraft(
                      availableActions.refinementSource,
                    )
                  }
                  disabled={
                    Boolean(busyAction) ||
                    (availableActions.refinementRequiresFeedback &&
                      !additionalFeedback.trim())
                  }
                >
                  {busyAction === 'refine' ? (
                    <Loader2 className="mr-1.5 size-4 animate-spin" />
                  ) : (
                    <WandSparkles className="mr-1.5 size-4" />
                  )}
                  {previewHasIssues
                    ? additionalFeedback.trim()
                      ? '结合预览问题和我的意见修改当前草稿'
                      : '按预览问题修改当前草稿'
                    : detail.status === 'test_ready'
                      ? '根据我的意见继续修改当前草稿'
                      : '根据我的意见修改当前草稿'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void handleTest()}
                  disabled={
                    Boolean(busyAction) || !availableActions.canPreviewDraft
                  }
                >
                  {busyAction === 'test' ? (
                    <Loader2 className="mr-1.5 size-4 animate-spin" />
                  ) : (
                    <FlaskConical className="mr-1.5 size-4" />
                  )}
                  {detail.status === 'test_ready'
                    ? '重新试运行当前草稿'
                    : '用当前草稿试运行'}
                </Button>
              </div>
              {availableActions.canRegenerateAlternative && (
                <div className="mt-3 border-t border-border/60 pt-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleAlternativeRegeneration()}
                    disabled={Boolean(busyAction)}
                  >
                    {busyAction === 'alternative' ? (
                      <Loader2 className="mr-1.5 size-4 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-1.5 size-4" />
                    )}
                    根据目前所有要求重新生成另一版草稿
                  </Button>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    不会沿用当前草稿的具体写法，但会保留你已经确认的所有要求，重新生成另一套修改方案。
                  </p>
                </div>
              )}
              {detail.status === 'test_ready' && (
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  “重新试运行当前草稿”不会修改草稿 v{detail.revision}
                  ，只会重新生成三份回答，用于观察回答效果是否稳定。
                </p>
              )}
            </Section>
          )}

          {status === 'processing' && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              正在分析并生成可校验的 Skill 草稿
            </div>
          )}

          {(status === 'completed' || confirmResult) && (
            <Section title="已保存">
              <div className="flex items-start gap-2 text-sm">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                <div>
                  <div className="font-medium">
                    {confirmResult
                      ? `已创建并启用 v${confirmResult.versionNumber}`
                      : target?.completedVersionNumber
                        ? `已创建并启用 v${target.completedVersionNumber}`
                        : `已创建新版本（ID ${detail?.finalVersionId ?? '-'}）`}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    后续新问题会自动使用当前新版本。请重新提问后再基于新的回答继续优化。
                  </p>
                </div>
              </div>
            </Section>
          )}

          {status === 'cancelled' && (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <XCircle className="size-4" />
              本次优化已取消，可关闭窗口后从回答卡重新开始。
            </div>
          )}

          {status === 'failed' && !error && (
            <div className="rounded-[8px] border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-800">
              上次处理未能生成可用草稿。请把反馈改得更通用、具体后重新生成。
            </div>
          )}

          {error && (
            <div className="rounded-[8px] border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-700">
              {error.message}
              {error.requestId && (
                <div className="mt-1 text-xs">requestId: {error.requestId}</div>
              )}
            </div>
          )}

          <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t border-border bg-card py-3">
            {!detail && (
              <Button
                onClick={() => void handleCreate()}
                disabled={Boolean(busyAction) || !feedback.trim()}
              >
                {busyAction === 'create' ? (
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-1.5 size-4" />
                )}
                开始优化
              </Button>
            )}
            {detail &&
              !replayUnavailable &&
              (detail.status === 'target_selection_required' ||
                (detail.status === 'failed' && !detail.draft)) && (
                <Button
                  variant="outline"
                  onClick={() => void handleRegenerateDraft()}
                  disabled={
                    Boolean(busyAction) ||
                    !feedback.trim() ||
                    (detail.status === 'target_selection_required' &&
                      selectedSkillIds.length === 0)
                  }
                >
                  {busyAction === 'revise' ? (
                    <Loader2 className="mr-1.5 size-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-1.5 size-4" />
                  )}
                  重新生成草稿
                </Button>
              )}
            {detail?.status === 'test_ready' && detail.testResult && (
              <>
                <Textarea
                  value={versionNote}
                  onChange={(event) => {
                    setVersionNote(event.target.value.slice(0, 500));
                    clearOperationKey('confirm');
                  }}
                  rows={1}
                  maxLength={500}
                  placeholder="版本说明（可选）"
                  className="min-h-9 basis-full resize-none sm:basis-72"
                  disabled={Boolean(busyAction)}
                />
                <Button
                  onClick={requestConfirm}
                  disabled={Boolean(busyAction) || Boolean(confirmBlockReason)}
                  title={confirmBlockReason || '保存并启用新版本'}
                >
                  {busyAction === 'confirm' ? (
                    <Loader2 className="mr-1.5 size-4 animate-spin" />
                  ) : (
                    <Save className="mr-1.5 size-4" />
                  )}
                  确认保存新版本
                </Button>
              </>
            )}
            {detail &&
              !['completed', 'cancelled'].includes(detail.status) &&
              (detail.status !== 'processing' || replayUnavailable) && (
                <Button
                  variant="ghost"
                  onClick={() => void handleCancel()}
                  disabled={Boolean(busyAction)}
                >
                  取消任务
                </Button>
              )}
          </div>
        </div>
      </DialogContent>
      </Dialog>

      <Dialog open={confirmWarningOpen} onOpenChange={setConfirmWarningOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>AI 评估仍发现可改进点</DialogTitle>
            <DialogDescription>
              当前草稿已经完成试运行，但 AI 仍发现以下可改进内容。AI
              评估可能存在误差，请结合你的专业判断决定。
            </DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-1 pl-5 text-sm leading-6">
            {advisoryIssues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmWarningOpen(false)}
              disabled={Boolean(busyAction)}
            >
              返回继续修改
            </Button>
            <Button
              onClick={() => {
                setConfirmWarningOpen(false);
                void handleConfirm();
              }}
              disabled={Boolean(busyAction)}
            >
              {busyAction === 'confirm' && (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              )}
              仍然保存新版本
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
