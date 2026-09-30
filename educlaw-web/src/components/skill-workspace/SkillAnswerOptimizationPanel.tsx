import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowUp, Check, ChevronDown, ChevronUp, FileText, GitCompare, Loader2, Play, RotateCcw, Sparkles } from 'lucide-react';
import { ANSWER_OPTIMIZATION_SUGGESTION_FALLBACKS } from '@educlaw/shared';
import {
  answerSkillOptimizationApi,
  AnswerOptimizationApiError,
  type AnswerSkillOptimizationDetail,
} from '../../api/answer-skill-optimizations';
import { MarkdownContent } from '../lite/lite-rendering';
import type { AnswerOptimizationSelection } from './answer-optimization-selection';
import {
  collapsePanelLayout,
  createManualPanelLayout,
  resetPanelLayout,
  type AnswerOptimizationPanelLayout,
} from './answer-optimization-panel-layout';
import {
  buildChangeRemovalFeedback,
  createOptimizationReviewItems,
} from './answer-optimization-review';

type Props = {
  token: string;
  selection: AnswerOptimizationSelection;
  onSaved: (versionNumber: number) => void;
  onRerun: (versionNumber: number, selection: AnswerOptimizationSelection) => void;
};

type ReviewTab = 'changes' | 'preview' | 'tests';

function idempotencyKey() {
  return crypto.randomUUID();
}

function optimizationActionError(
  cause: unknown,
  action: 'test' | 'save' | 'rebase',
): string {
  if (action === 'test') {
    if (cause instanceof AnswerOptimizationApiError && cause.statusCode === 503) {
      return '测试服务暂时不可用，请稍后重试';
    }
    return '测试没有完成，请稍后重试';
  }
  if (action === 'rebase') {
    return '当前版本发生了变化，请重新打开后再试';
  }
  if (cause instanceof AnswerOptimizationApiError && cause.statusCode === 422) {
    return '当前改进还不能保存，请重新测试或继续调整';
  }
  return '保存没有完成，请稍后重试';
}

export function SkillAnswerOptimizationPanel({ token, selection, onSaved, onRerun }: Props) {
  const [feedbackDraft, setFeedbackDraft] = useState(selection.feedback);
  const [detail, setDetail] = useState<AnswerSkillOptimizationDetail | null>(null);
  const [busy, setBusy] = useState<'restore' | 'create' | 'revise' | 'test' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedVersion, setSavedVersion] = useState<number | null>(null);
  const [statusTab, setStatusTab] = useState<ReviewTab>('changes');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(true);
  const [panelLayout, setPanelLayout] = useState<AnswerOptimizationPanelLayout>(resetPanelLayout());
  const requestRef = useRef(0);
  const suggestionsRequestRef = useRef(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);

  useEffect(() => {
    requestRef.current += 1;
    setFeedbackDraft(selection.feedback);
    setBusy(null);
    setError(null);
    setDetail(null);
    setSavedVersion(null);
    setStatusTab('changes');
    setPanelLayout(resetPanelLayout());
    setSuggestions([]);
    setSuggestionsLoading(true);

    const restoreRequest = requestRef.current;
    setBusy('restore');
    void answerSkillOptimizationApi.resolve(token, {
      packageId: selection.packageId,
      threadId: selection.threadId,
      questionMessageId: selection.questionMessageId,
      answerMessageId: selection.answerMessageId,
      answerSide: selection.answerSide,
    }).then((result) => {
      if (restoreRequest !== requestRef.current) return;
      setDetail(result.data.detail);
      if (result.data.detail?.status === 'completed' && result.data.versionNumber !== null) {
        setSavedVersion(result.data.versionNumber);
      }
    }).catch(() => {
      if (restoreRequest === requestRef.current) {
        setError('暂时无法恢复上次的改进，请稍后重试');
      }
    }).finally(() => {
      if (restoreRequest === requestRef.current) setBusy(null);
    });

    const request = ++suggestionsRequestRef.current;
    void answerSkillOptimizationApi.suggestions(token, {
      packageId: selection.packageId,
      threadId: selection.threadId,
      questionMessageId: selection.questionMessageId,
      answerMessageId: selection.answerMessageId,
      answerSide: selection.answerSide,
      answerVersionNumber: selection.answerVersionNumber,
    }).then((result) => {
      if (request === suggestionsRequestRef.current) {
        setSuggestions(result.data.suggestions.slice(0, 3));
      }
    }).catch(() => {
      if (request === suggestionsRequestRef.current) {
        setSuggestions([...ANSWER_OPTIMIZATION_SUGGESTION_FALLBACKS]);
      }
    }).finally(() => {
      if (request === suggestionsRequestRef.current) setSuggestionsLoading(false);
    });
  }, [selection, token]);

  useEffect(() => {
    if (detail?.status !== 'processing') return undefined;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void answerSkillOptimizationApi.get(token, detail.optimizationId).then((result) => {
        if (cancelled) return;
        setDetail(result.data);
        if (result.data.status === 'completed') {
          void answerSkillOptimizationApi.resolve(token, {
            packageId: selection.packageId,
            threadId: selection.threadId,
            questionMessageId: selection.questionMessageId,
            answerMessageId: selection.answerMessageId,
            answerSide: selection.answerSide,
          }).then((resolved) => {
            if (!cancelled && resolved.data.versionNumber !== null) {
              setSavedVersion(resolved.data.versionNumber);
            }
          }).catch(() => undefined);
        }
      }).catch(() => undefined);
    }, 1_500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [detail?.optimizationId, detail?.status, selection, token]);

  const beginOptimization = async () => {
    const feedback = feedbackDraft.trim();
    if (!feedback || busy) return;

    const request = ++requestRef.current;
    setBusy(detail ? 'revise' : 'create');
    setError(null);
    try {
      let next: AnswerSkillOptimizationDetail;
      if (detail) {
        next = (await answerSkillOptimizationApi.revise(
          token,
          detail.optimizationId,
          {
            expectedRevision: detail.revision,
            additionalFeedback: feedback,
            revisionSource: 'draft_review',
          },
          idempotencyKey(),
        )).data;
      } else {
        next = (await answerSkillOptimizationApi.create(token, {
          packageId: selection.packageId,
          threadId: selection.threadId,
          questionMessageId: selection.questionMessageId,
          enhancedAnswerMessageId: selection.enhancedAnswerMessageId,
          baselineAnswerMessageId: selection.baselineAnswerMessageId,
          answerSide: selection.answerSide,
          answerMessageId: selection.answerMessageId,
          feedback,
        }, idempotencyKey())).data;
      }
      next = (await answerSkillOptimizationApi.rebase(
        token,
        next.optimizationId,
        next.revision,
      )).data;
      if (request === requestRef.current) {
        setDetail(next);
        setFeedbackDraft('');
        setStatusTab('changes');
        setPanelLayout(resetPanelLayout());
      }
    } catch (cause) {
      if (request !== requestRef.current) return;
      if (
        cause instanceof AnswerOptimizationApiError
        && cause.statusCode === 409
        && cause.payload.existingOptimizationId
      ) {
        try {
          let existing = (await answerSkillOptimizationApi.get(
            token,
            cause.payload.existingOptimizationId,
          )).data;
          const feedbackAlreadyApplied = existing.feedback === feedback
            || existing.refinementHistory.some((turn) => turn.userMessage === feedback);
          if (
            existing.status !== 'completed'
            && existing.status !== 'processing'
            && !feedbackAlreadyApplied
          ) {
            existing = (await answerSkillOptimizationApi.revise(
              token,
              existing.optimizationId,
              {
                expectedRevision: existing.revision,
                additionalFeedback: feedback,
                revisionSource: 'draft_review',
              },
              idempotencyKey(),
            )).data;
            existing = (await answerSkillOptimizationApi.rebase(
              token,
              existing.optimizationId,
              existing.revision,
            )).data;
            setFeedbackDraft('');
          }
          setDetail(existing);
          if (existing.status === 'completed' && cause.payload.versionNumber !== null) {
            setSavedVersion(cause.payload.versionNumber ?? null);
          } else if (existing.status === 'processing' && !feedbackAlreadyApplied) {
            setError('已恢复上次未完成的改进；完成后可继续提交当前要求');
          }
          setStatusTab(existing.testResult ? 'tests' : 'changes');
          setPanelLayout(resetPanelLayout());
        } catch {
          setError('上次的改进仍在保存，请稍后重新打开');
        }
      } else {
        setError('暂时无法生成改进建议，请稍后重试');
      }
    } finally {
      if (request === requestRef.current) setBusy(null);
    }
  };

  const test = async () => {
    if (!detail || busy) return;
    setBusy('test');
    setError(null);
    try {
      const result = (await answerSkillOptimizationApi.test(
        token,
        detail.optimizationId,
        detail.revision,
        idempotencyKey(),
      )).data;
      setDetail({ ...detail, status: result.status, testResult: result.testResult });
      setStatusTab('tests');
      setPanelLayout(resetPanelLayout());
    } catch (cause) {
      setError(optimizationActionError(cause, 'test'));
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!detail || detail.status !== 'test_ready' || busy) return;
    setBusy('save');
    setError(null);
    try {
      const result = (await answerSkillOptimizationApi.confirm(
        token,
        detail.optimizationId,
        { expectedRevision: detail.revision, versionNote: `改进 v${selection.answerVersionNumber} 的回答` },
        idempotencyKey(),
      )).data;
      setSavedVersion(result.skillVersionNumber);
      onSaved(result.skillVersionNumber);
    } catch (cause) {
      if (cause instanceof AnswerOptimizationApiError && cause.statusCode === 409 && detail) {
        try {
          const rebased = (await answerSkillOptimizationApi.rebase(
            token,
            detail.optimizationId,
            detail.revision,
          )).data;
          setDetail(rebased);
          setStatusTab('changes');
          setPanelLayout(resetPanelLayout());
          setError('当前 Skill 已有新的修改。本次改进已合并到最新内容，请重新测试后保存。');
        } catch (rebaseCause) {
          setError(optimizationActionError(rebaseCause, 'rebase'));
        }
      } else {
        setError(optimizationActionError(cause, 'save'));
      }
    } finally {
      setBusy(null);
    }
  };

  const startPanelResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const statusPanel = event.currentTarget.nextElementSibling as HTMLElement | null;
    if (!bodyRef.current || !statusPanel) return;
    dragRef.current = { startY: event.clientY, startHeight: statusPanel.getBoundingClientRect().height };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const resizePanel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || !bodyRef.current) return;
    const requestedHeight = dragRef.current.startHeight + dragRef.current.startY - event.clientY;
    setPanelLayout(createManualPanelLayout(requestedHeight, bodyRef.current.clientHeight));
  };

  const stopPanelResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const resetPanelHeight = () => setPanelLayout(resetPanelLayout());
  const togglePanel = () => setPanelLayout((current) => (
    current.mode === 'collapsed' ? resetPanelLayout() : collapsePanelLayout()
  ));

  const rerunSelection: AnswerOptimizationSelection = {
    ...selection,
    feedback: detail?.feedback || feedbackDraft.trim(),
  };
  const statusPanelStyle = panelLayout.mode === 'manual'
    ? { '--skill-answer-status-height': `${panelLayout.height}px` } as CSSProperties
    : undefined;
  const hasStatus = Boolean(detail?.diff || detail?.testResult);
  const feedbackHistory = detail?.refinementHistory ?? [];
  const testResult = detail?.testResult ?? null;
  const reviewItems = detail ? createOptimizationReviewItems(detail) : [];

  const removeReviewItem = async (item: (typeof reviewItems)[number]) => {
    if (!detail || busy) return;
    setBusy('revise');
    setError(null);
    try {
      const next = (await answerSkillOptimizationApi.revise(
        token,
        detail.optimizationId,
        {
          expectedRevision: detail.revision,
          additionalFeedback: buildChangeRemovalFeedback(item),
          revisionSource: 'draft_review',
        },
        idempotencyKey(),
      )).data;
      setDetail(next);
      setStatusTab('changes');
      setPanelLayout(resetPanelLayout());
    } catch (cause) {
      setError(cause instanceof AnswerOptimizationApiError && cause.statusCode === 409
        ? '草案刚刚发生了变化，请重新查看后再撤销'
        : '这项修改暂时无法撤销，请稍后重试');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="skill-answer-optimization-panel">
      <div ref={bodyRef} className="skill-answer-optimization-body">
        <div className="skill-answer-optimization-dialogue">
          <details className="skill-answer-optimization-origin">
            <summary>
              <span><Sparkles size={14} />Skill 的回答</span>
              <ChevronDown size={14} />
            </summary>
            <div className="skill-answer-optimization-origin-content">
              <div className="skill-assistant-block">
                <div className="skill-assistant-avatar"><Sparkles size={14} /></div>
                <div className="skill-assistant-message">
                  <MarkdownContent content={selection.answer} />
                </div>
              </div>
            </div>
          </details>

          {(detail || (busy && busy !== 'restore')) && (
            <div className="skill-answer-optimization-chat">
              <div className="skill-user-message">{detail?.feedback || feedbackDraft.trim()}</div>
              {feedbackHistory.map((turn) => (
                <div key={turn.id} className="skill-answer-optimization-turn">
                  <div className="skill-user-message">{turn.userMessage}</div>
                  {turn.assistantSummary && (
                    <div className="skill-assistant-block">
                      <div className="skill-assistant-avatar"><Sparkles size={14} /></div>
                      <div className="skill-assistant-message"><MarkdownContent content={turn.assistantSummary} /></div>
                    </div>
                  )}
                </div>
              ))}
              {detail?.diagnosis && (
                <div className="skill-assistant-block">
                  <div className="skill-assistant-avatar"><Sparkles size={14} /></div>
                  <div className="skill-assistant-message">
                    <MarkdownContent content={detail.diagnosis.summary} />
                  </div>
                </div>
              )}
              {(busy === 'create' || busy === 'revise' || detail?.status === 'processing') && (
                <div className="skill-assistant-message is-thinking"><span /><span /><span /></div>
              )}
            </div>
          )}
        </div>

        {hasStatus && savedVersion === null && (
          <>
            <div
              className="skill-answer-optimization-resize-handle"
              role="separator"
              aria-label="调整优化状态区域高度"
              aria-orientation="horizontal"
              onPointerDown={startPanelResize}
              onPointerMove={resizePanel}
              onPointerUp={stopPanelResize}
              onPointerCancel={stopPanelResize}
              onDoubleClick={resetPanelHeight}
              title="拖动调整高度，双击恢复自动高度"
            />
            <section
              className={`skill-answer-optimization-status-panel is-${panelLayout.mode}`}
              style={statusPanelStyle}
            >
              <header className="skill-answer-optimization-status-header">
                <div className="skill-answer-optimization-status-tabs" role="tablist" aria-label="修改审核">
                  <button
                    className={statusTab === 'changes' ? 'is-active' : ''}
                    onClick={() => setStatusTab('changes')}
                  >修改内容</button>
                  <button
                    className={statusTab === 'preview' ? 'is-active' : ''}
                    onClick={() => setStatusTab('preview')}
                    disabled={!detail?.draft?.previewContent}
                  >完整预览</button>
                  <button
                    className={statusTab === 'tests' ? 'is-active' : ''}
                    onClick={() => setStatusTab('tests')}
                    disabled={!detail?.testResult}
                  >测试</button>
                </div>
                <span className="skill-answer-optimization-status-summary">
                  {detail?.diff ? '准备生成新版本' : '等待修改'}
                  {testResult ? ` · ${testResult.qualityGate.passed ? '改进有效' : '建议继续调整'}` : ''}
                </span>
                <button className="skill-answer-optimization-collapse" onClick={togglePanel} title={panelLayout.mode === 'collapsed' ? '展开状态区' : '收起状态区'}>
                  {panelLayout.mode === 'collapsed' ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
              </header>
              <div className="skill-answer-optimization-status-content">
                {statusTab === 'changes' ? (
                  <div className="skill-answer-optimization-review-list">
                    {detail?.baseVersionId !== detail?.evidenceVersionId && (
                      <p className="skill-answer-optimization-rebase-note">
                        <GitCompare size={13} />已保留当前 Skill 的修改，并应用本次改进。
                      </p>
                    )}
                    {reviewItems.length > 0 ? reviewItems.map((item, index) => (
                      <details className="skill-answer-optimization-review-item" key={item.id} open={index === 0}>
                        <summary>
                          <span className="skill-answer-optimization-review-number">{index + 1}</span>
                          <span><strong>{item.title}</strong><small>{item.summary}</small></span>
                          <ChevronDown size={13} />
                        </summary>
                        <div className="skill-answer-optimization-review-detail">
                          {item.before && (
                            <div className="skill-answer-optimization-review-copy is-before">
                              <span>修改前</span><MarkdownContent content={item.before} />
                            </div>
                          )}
                          <div className="skill-answer-optimization-review-copy is-after">
                            <span>修改后</span><MarkdownContent content={item.after} />
                          </div>
                          <button
                            type="button"
                            className="skill-answer-optimization-remove-change"
                            disabled={Boolean(busy)}
                            onClick={() => void removeReviewItem(item)}
                          ><RotateCcw size={12} />撤销这一项</button>
                        </div>
                      </details>
                    )) : <p className="skill-context-muted">正在准备修改后的规则…</p>}
                  </div>
                ) : statusTab === 'preview' ? (
                  <div className="skill-answer-optimization-full-preview">
                    <div className="skill-answer-optimization-preview-title"><FileText size={14} /><span>修改后的完整 Skill</span></div>
                    {detail.draft?.previewContent
                      ? <MarkdownContent content={detail.draft.previewContent} />
                      : <p className="skill-context-muted">完整预览正在准备中…</p>}
                  </div>
                ) : testResult ? (
                  <div className={`skill-answer-optimization-test-summary ${testResult.qualityGate.passed ? 'is-pass' : 'is-fail'}`}>
                    <div className="skill-answer-optimization-test-hero">
                      <span className="skill-answer-optimization-test-icon">
                        {testResult.qualityGate.passed ? <Check size={16} /> : <GitCompare size={16} />}
                      </span>
                      <div>
                        <strong>{testResult.qualityGate.passed ? '改进有效' : '建议继续调整'}</strong>
                        <span>{testResult.qualityGate.passedCount}/{testResult.qualityGate.sampleCount} 项测试通过</span>
                      </div>
                    </div>
                    <div className="skill-answer-optimization-test-samples">
                      {testResult.samples.map((sample, index) => (
                        <details
                          key={index}
                          className={index === testResult.qualityGate.bestSampleIndex ? 'is-best' : ''}
                        >
                          <summary>
                            <span className={sample.passed ? 'is-pass' : 'is-fail'}>{sample.passed ? '✓' : '!'}</span>
                            <strong>测试 {index + 1}</strong>
                            {index === testResult.qualityGate.bestSampleIndex && <em>表现最佳</em>}
                            <small>{sample.passed ? '通过' : '需调整'}</small>
                            <ChevronDown size={13} />
                          </summary>
                          <div className="skill-answer-optimization-test-detail">
                            <span>测试回答</span>
                            <MarkdownContent content={sample.answer} />
                            {sample.satisfiedRequirements.length > 0 && (
                              <p><strong>做得好：</strong>{sample.satisfiedRequirements.join('；')}</p>
                            )}
                            {sample.unmetRequirements.length > 0 && (
                              <p><strong>可改进：</strong>{sample.unmetRequirements.join('；')}</p>
                            )}
                            {sample.riskNotes.length > 0 && (
                              <p><strong>需要注意：</strong>{sample.riskNotes.join('；')}</p>
                            )}
                          </div>
                        </details>
                      ))}
                    </div>
                    <details className="skill-answer-optimization-test-evaluation">
                      <summary>查看评估说明 <ChevronDown size={13} /></summary>
                      <p>{testResult.qualityGate.overallSummary}</p>
                    </details>
                  </div>
                ) : null}
              </div>
            </section>
          </>
        )}
      </div>

      <footer className="skill-answer-optimization-footer">
        {error && <div className="skill-run-error">{error}</div>}
        {savedVersion !== null ? (
          <div className="skill-answer-optimization-saved">
            <div className="skill-answer-optimization-saved-badge"><Check size={14} />已保存为 v{savedVersion}</div>
            <button className="skill-primary-button" onClick={() => onRerun(savedVersion, rerunSelection)}>
              <Play size={14} />用 v{savedVersion} 重新运行原任务
            </button>
          </div>
        ) : (
          <>
            {detail && (
              <div className="skill-answer-optimization-actions">
                <button onClick={() => void test()} disabled={Boolean(busy) || !detail.draft}>
                  {busy === 'test' ? <Loader2 className="spin" size={12} /> : <Play size={12} />}测试改进
                </button>
                <button className="is-primary" onClick={() => void save()} disabled={Boolean(busy) || detail.status !== 'test_ready'}>
                  {busy === 'save' ? <Loader2 className="spin" size={12} /> : <Sparkles size={12} />}保存新版本
                </button>
              </div>
            )}
            <div className="skill-answer-optimization-suggestions" aria-label="参考改进方向">
              {suggestionsLoading
                ? [0, 1, 2].map((index) => <span key={index} className="is-loading" />)
                : suggestions.slice(0, 3).map((suggestion) => (
                  <button key={suggestion} type="button" onClick={() => setFeedbackDraft(suggestion)}>
                    {suggestion}
                  </button>
                ))}
            </div>
            <div className="skill-test-composer skill-answer-optimization-composer">
              <textarea
                value={feedbackDraft}
                onChange={(event) => setFeedbackDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void beginOptimization();
                  }
                }}
                placeholder="说说希望这条回答怎么改进"
                autoFocus
              />
              <button type="button" disabled={!feedbackDraft.trim() || Boolean(busy)} onClick={() => void beginOptimization()}>
                {busy === 'create' || busy === 'revise' ? <Loader2 size={15} className="spin" /> : <ArrowUp size={15} />}
              </button>
            </div>
          </>
        )}
      </footer>
    </div>
  );
}
