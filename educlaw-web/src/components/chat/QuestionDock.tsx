import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  X,
  Send,
  Pencil,
  MessageCircleQuestion,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { agentRuntimeApi } from '../../api/runtime';
import type { QuestionRequest } from '../../stores/interaction-queue';
import { useInteractionQueueStore } from '../../stores/interaction-queue';
import { useT } from '../../i18n';
import { PremiumPill } from '@/components/ui/premium';

/**
 * QuestionDock renders the interactive question tool.
 * Follows the same UX pattern as the runtime question dock:
 * multi-question tabs, single/multi select options, custom text input.
 */
export default function QuestionDock({
  request,
}: {
  request: QuestionRequest;
}) {
  const t = useT();
  const questions = request.questions;
  const total = questions.length;

  const [tab, setTab] = useState(0);
  const [answers, setAnswers] = useState<string[][]>(() =>
    questions.map(() => []),
  );
  const [customTexts, setCustomTexts] = useState<string[]>(() =>
    questions.map(() => ''),
  );
  const [customOn, setCustomOn] = useState<boolean[]>(() =>
    questions.map(() => false),
  );
  const [editing, setEditing] = useState(false);
  const [sending, setSending] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const question = questions[tab];
  const options = question?.options ?? [];
  const isMulti = question?.multiple === true;
  const isLast = tab >= total - 1;
  const currentAnswers = answers[tab] ?? [];
  const currentCustom = customTexts[tab] ?? '';
  const currentCustomOn = customOn[tab] ?? false;

  // Auto-focus textarea when editing
  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      // Auto-resize
      const el = textareaRef.current;
      el.style.height = '0px';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [editing, tab]);

  const updateCustom = useCallback(
    (value: string, selected?: boolean) => {
      const sel = selected ?? customOn[tab];
      setCustomTexts((prev) => {
        const next = [...prev];
        next[tab] = value;
        return next;
      });
      if (!sel) return;
      const trimmed = value.trim();
      if (isMulti) {
        setAnswers((prev) => {
          const next = [...prev];
          const current = [...(next[tab] ?? [])];
          // Remove old custom value, add new one
          const oldCustom = customTexts[tab]?.trim();
          const filtered = oldCustom
            ? current.filter((a) => a !== oldCustom)
            : current;
          if (trimmed && !filtered.includes(trimmed)) {
            filtered.push(trimmed);
          }
          next[tab] = filtered;
          return next;
        });
      } else {
        setAnswers((prev) => {
          const next = [...prev];
          next[tab] = trimmed ? [trimmed] : [];
          return next;
        });
      }
    },
    [tab, isMulti, customOn, customTexts],
  );

  function pick(label: string) {
    if (sending) return;
    setAnswers((prev) => {
      const next = [...prev];
      next[tab] = [label];
      return next;
    });
    setCustomOn((prev) => {
      const next = [...prev];
      next[tab] = false;
      return next;
    });
    setEditing(false);
  }

  function toggle(label: string) {
    if (sending) return;
    setAnswers((prev) => {
      const next = [...prev];
      const current = [...(next[tab] ?? [])];
      if (current.includes(label)) {
        next[tab] = current.filter((a) => a !== label);
      } else {
        next[tab] = [...current, label];
      }
      return next;
    });
  }

  function selectOption(index: number) {
    if (sending) return;
    if (index === options.length) {
      // Custom option
      openCustom();
      return;
    }
    const opt = options[index];
    if (!opt) return;
    if (isMulti) {
      toggle(opt.label);
    } else {
      pick(opt.label);
    }
  }

  function openCustom() {
    if (sending) return;
    setCustomOn((prev) => {
      const next = [...prev];
      next[tab] = true;
      return next;
    });
    setEditing(true);
    updateCustom(currentCustom, true);
  }

  function customToggle() {
    if (sending) return;
    if (!isMulti) {
      openCustom();
      return;
    }
    const nextOn = !currentCustomOn;
    setCustomOn((prev) => {
      const next = [...prev];
      next[tab] = nextOn;
      return next;
    });
    if (nextOn) {
      setEditing(true);
      updateCustom(currentCustom, true);
    } else {
      const value = currentCustom.trim();
      if (value) {
        setAnswers((prev) => {
          const next = [...prev];
          next[tab] = (next[tab] ?? []).filter((a) => a !== value);
          return next;
        });
      }
      setEditing(false);
    }
  }

  function commitCustom() {
    setEditing(false);
    updateCustom(currentCustom);
  }

  async function handleReply() {
    if (sending) return;
    setSending(true);
    try {
      const api = agentRuntimeApi(request.agentId);
      await api.questionReply(request.id, answers);
      useInteractionQueueStore.getState().removeQuestion(request.id);
    } catch {
      // Keep UI open on error
    } finally {
      setSending(false);
    }
  }

  async function handleReject() {
    if (sending) return;
    setSending(true);
    try {
      const api = agentRuntimeApi(request.agentId);
      await api.questionReject(request.id);
      useInteractionQueueStore.getState().removeQuestion(request.id);
    } catch {
      // Keep UI open on error
    } finally {
      setSending(false);
    }
  }

  function handleNext() {
    if (sending) return;
    if (editing) commitCustom();
    if (isLast) {
      handleReply();
      return;
    }
    setTab((t) => t + 1);
    setEditing(false);
  }

  function handleBack() {
    if (sending || tab <= 0) return;
    setTab((t) => t - 1);
    setEditing(false);
  }

  const isPicked = (label: string) => currentAnswers.includes(label);

  return (
    <div className="overflow-hidden rounded-[20px] border border-border bg-card shadow-sm animate-fade-in">
      {/* Header - always visible, clickable to toggle */}
      <button
        type="button"
        onClick={() => setMinimized((v) => !v)}
        className={`flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-muted/70 ${
          minimized ? '' : 'border-b border-border/70 bg-muted/35'
        }`}
      >
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-[14px] bg-primary-soft text-primary">
            <MessageCircleQuestion className="size-4" />
          </div>
          <PremiumPill accent="blue">
            {tab + 1} / {total} {t('question.questions')}
          </PremiumPill>
          {minimized && question?.question && (
            <span className="ml-1 truncate text-xs text-muted-foreground/70 max-w-[200px]">
              {question.question}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Progress dots */}
          {total > 1 && (
            <div className="flex items-center gap-1 mr-2">
              {questions.map((_, i) => {
                const answered =
                  (answers[i]?.length ?? 0) > 0 ||
                  (customOn[i] && (customTexts[i] ?? '').trim().length > 0);
                return (
                  <span
                    key={i}
                    className={`size-2.5 rounded-full transition-all duration-200 ${
                      i === tab
                        ? 'bg-primary shadow-[0_0_0_4px_rgba(85,90,255,0.14)]'
                        : answered
                          ? 'bg-primary/40'
                          : 'bg-muted-foreground/20'
                    }`}
                  />
                );
              })}
            </div>
          )}
          {minimized ? (
            <ChevronUp size={16} className="text-muted-foreground/50" />
          ) : (
            <ChevronDown size={16} className="text-muted-foreground/50" />
          )}
        </div>
      </button>

      {!minimized && (
        <>
          {/* Question text */}
          <div className="px-4 pt-3 pb-2">
            {question?.header && (
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/50">
                {question.header}
              </div>
            )}
            <p className="text-sm font-medium leading-6 text-foreground">
              {question?.question}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground/65">
              {isMulti ? t('question.multiHint') : t('question.singleHint')}
            </p>
          </div>

          {/* Options */}
          <div className="px-4 pb-2 space-y-1.5">
            {options.map((opt, i) => {
              const picked = isPicked(opt.label);
              return (
                <button
                  key={i}
                  onClick={() => selectOption(i)}
                  disabled={sending}
                  className={`flex w-full items-start gap-3 rounded-[18px] border px-3 py-3 text-left transition-all duration-150 ${
                    picked
                      ? 'border-primary/30 bg-primary-soft shadow-sm'
                      : 'border-border bg-background hover:border-primary/18 hover:bg-muted/55'
                  } ${sending ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  {/* Radio/Checkbox indicator */}
                  <span className="mt-0.5 shrink-0">
                    {isMulti ? (
                      <span
                        className={`flex size-4 items-center justify-center rounded border transition-colors ${
                          picked
                            ? 'bg-primary border-primary'
                            : 'border-muted-foreground/30'
                        }`}
                      >
                        {picked && <Check size={10} className="text-white" />}
                      </span>
                    ) : (
                      <span
                        className={`flex size-4 items-center justify-center rounded-full border-2 transition-colors ${
                          picked
                            ? 'border-primary'
                            : 'border-muted-foreground/30'
                        }`}
                      >
                        {picked && (
                          <span className="size-2 rounded-full bg-primary" />
                        )}
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={`text-sm font-medium block ${picked ? 'text-primary' : 'text-foreground'}`}
                    >
                      {opt.label}
                    </span>
                    {opt.description && (
                      <span className="text-xs text-muted-foreground/60 block mt-0.5">
                        {opt.description}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}

            {/* Custom answer option */}
            {question?.custom !== false &&
              (editing ? (
                <div
                  className={`rounded-[18px] border px-3 py-3 transition-all ${
                    currentCustomOn
                      ? 'border-primary/30 bg-primary-soft'
                      : 'border-border bg-background'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className="mt-0.5 shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        customToggle();
                      }}
                    >
                      {isMulti ? (
                        <span
                          className={`flex size-4 items-center justify-center rounded border cursor-pointer transition-colors ${
                            currentCustomOn
                              ? 'bg-primary border-primary'
                              : 'border-muted-foreground/30'
                          }`}
                        >
                          {currentCustomOn && (
                            <Check size={10} className="text-white" />
                          )}
                        </span>
                      ) : (
                        <span
                          className={`flex size-4 items-center justify-center rounded-full border-2 cursor-pointer transition-colors ${
                            currentCustomOn
                              ? 'border-primary'
                              : 'border-muted-foreground/30'
                          }`}
                        >
                          {currentCustomOn && (
                            <span className="size-2 rounded-full bg-primary" />
                          )}
                        </span>
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className="text-sm font-medium text-foreground block mb-1.5">
                        {t('question.typeOwn')}
                      </span>
                      <textarea
                        ref={textareaRef}
                        value={currentCustom}
                        onChange={(e) => {
                          updateCustom(e.target.value);
                          e.target.style.height = '0px';
                          e.target.style.height = `${e.target.scrollHeight}px`;
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            e.preventDefault();
                            setEditing(false);
                            return;
                          }
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            commitCustom();
                          }
                        }}
                        placeholder={t('question.customPlaceholder')}
                        rows={1}
                        disabled={sending}
                        className="w-full resize-none rounded-[14px] border border-border bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-4 focus:ring-primary/10 placeholder:text-muted-foreground/40"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <button
                  onClick={openCustom}
                  disabled={sending}
                  className={`flex w-full items-start gap-3 rounded-[18px] border px-3 py-3 text-left transition-all ${
                    currentCustomOn
                      ? 'border-primary/30 bg-primary-soft'
                      : 'border-dashed border-border bg-background hover:border-primary/18 hover:bg-muted/55'
                  } ${sending ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <span className="mt-0.5 shrink-0">
                    {isMulti ? (
                      <span
                        className={`flex size-4 items-center justify-center rounded border transition-colors ${
                          currentCustomOn
                            ? 'bg-primary border-primary'
                            : 'border-muted-foreground/30'
                        }`}
                      >
                        {currentCustomOn && (
                          <Check size={10} className="text-white" />
                        )}
                      </span>
                    ) : (
                      <span
                        className={`flex size-4 items-center justify-center rounded-full border-2 transition-colors ${
                          currentCustomOn
                            ? 'border-primary'
                            : 'border-muted-foreground/30'
                        }`}
                      >
                        {currentCustomOn && (
                          <span className="size-2 rounded-full bg-primary" />
                        )}
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-sm font-medium text-foreground flex items-center gap-1.5">
                      <Pencil size={12} className="text-muted-foreground/50" />
                      {t('question.typeOwn')}
                    </span>
                    <span className="text-xs text-muted-foreground/50 block mt-0.5">
                      {currentCustom || t('question.customPlaceholder')}
                    </span>
                  </span>
                </button>
              ))}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-border/70 bg-muted/20 px-4 py-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReject}
              disabled={sending}
              className="text-muted-foreground"
            >
              <X size={14} className="mr-1" />
              {t('question.dismiss')}
            </Button>
            <div className="flex items-center gap-2">
              {tab > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleBack}
                  disabled={sending}
                >
                  <ChevronLeft size={14} className="mr-1" />
                  {t('question.back')}
                </Button>
              )}
              <Button
                size="sm"
                onClick={handleNext}
                disabled={sending}
                className="rounded-full px-4"
              >
                {isLast ? (
                  <>
                    <Send size={14} className="mr-1" />
                    {t('question.submit')}
                  </>
                ) : (
                  <>
                    {t('question.next')}
                    <ChevronRight size={14} className="ml-1" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
