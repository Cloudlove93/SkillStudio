import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import type { ArenaThread, SkillVersionDetail } from '@educlaw/shared';
import { ArrowUp, Play, Sparkles, Square, WandSparkles } from 'lucide-react';
import { liteApi } from '../../api/lite-api';
import { createSkillRunState, skillRunReducer } from './skill-run-state';
import type {
  AnswerOptimizationRerunRequest,
  AnswerOptimizationSelection,
} from './answer-optimization-selection';
import { ConversationTurnNavigation } from './ConversationTurnNavigation';
import { collectConversationTurns } from './conversation-turn-navigation';
import { getConversationTitle } from './skill-conversation-list';
import { MarkdownContent } from '../lite/lite-rendering';
import { SkillReasoningBlock } from './SkillReasoningBlock';
import { SkillThinkingToggle } from './SkillThinkingToggle';
import {
  readThinkingPreference,
  writeThinkingPreference,
} from './skill-thinking-preference';
import { createSkillStreamBuffer } from './skill-stream-buffer';

type Props = {
  token: string;
  packageId: string;
  version: SkillVersionDetail | undefined;
  currentPackageVersionId: string | undefined;
  purpose?: 'run' | 'test';
  onCompleted?: () => void;
  onRunStateChange?: (running: boolean, threadId?: string | null) => void;
  onOptimizeAnswer: (selection: AnswerOptimizationSelection) => void;
  selectedThreadId?: string | null;
  onThreadCreated?: (thread: ArenaThread) => void;
  onThreadUpdated?: (thread: ArenaThread) => void;
  rerunRequest?: AnswerOptimizationRerunRequest | null;
};

function requestId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID)
    return crypto.randomUUID();
  return `skill-run-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function scheduleStreamFlush(callback: () => void): number {
  return typeof window.requestAnimationFrame === 'function'
    ? window.requestAnimationFrame(callback)
    : window.setTimeout(callback, 16);
}

function cancelStreamFlush(handle: number) {
  if (typeof window.cancelAnimationFrame === 'function')
    window.cancelAnimationFrame(handle);
  else window.clearTimeout(handle);
}

export function SkillRunWorkspace({
  token,
  packageId,
  version,
  currentPackageVersionId,
  purpose = 'run',
  onCompleted,
  onRunStateChange,
  onOptimizeAnswer,
  selectedThreadId = null,
  onThreadCreated,
  onThreadUpdated,
  rerunRequest,
}: Props) {
  const [state, dispatch] = useReducer(
    skillRunReducer,
    undefined,
    createSkillRunState,
  );
  const [thinkingPreference, setThinkingPreference] = useState(() =>
    readThinkingPreference(),
  );
  const threadIdRef = useRef<string | null>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const hydrateRequestRef = useRef(0);
  const handledRerunRef = useRef<string | null>(null);
  const activeRequestRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamBufferRef = useRef<
    ReturnType<typeof createSkillStreamBuffer> | null
  >(null);
  const conversationTurns = useMemo(
    () =>
      collectConversationTurns(
        state.messages.map((message, index) => ({
          id: `${purpose}-${index}`,
          role: message.role,
          content: message.content,
        })),
      ),
    [purpose, state.messages],
  );

  useEffect(() => {
    const requestNo = hydrateRequestRef.current + 1;
    hydrateRequestRef.current = requestNo;
    activeRequestRef.current += 1;
    streamBufferRef.current?.dispose();
    streamBufferRef.current = null;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    const previousThreadId = threadIdRef.current;
    threadIdRef.current = selectedThreadId;
    if (!selectedThreadId) {
      dispatch({ type: 'reset' });
      return;
    }
    if (previousThreadId === selectedThreadId) {
      return;
    }
    void liteApi
      .getArenaThreadDetail(token, packageId, selectedThreadId)
      .then((detail) => {
        if (
          hydrateRequestRef.current !== requestNo ||
          threadIdRef.current !== selectedThreadId
        )
          return;
        const messages: import('./skill-run-state').SkillRunMessage[] = [];
        const sorted = [...detail.messages].sort((a, b) => {
          const time =
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          return time || a.id - b.id;
        });
        let currentQuestionId: number | undefined;
        let currentBaselineId: number | null = null;
        for (const message of sorted) {
          if (message.side === 'shared' && message.role === 'user') {
            currentQuestionId = message.id;
            currentBaselineId = null;
            messages.push({
              role: 'user',
              content: message.content,
              messageId: message.id,
            });
          } else if (
            message.side === 'baseline' &&
            message.role === 'assistant'
          ) {
            currentBaselineId = message.id;
          } else if (
            message.side === 'enhanced' &&
            message.role === 'assistant'
          ) {
            messages.push({
              role: 'assistant',
              content: message.content,
              reasoningContent: message.reasoningContent ?? null,
              messageId: message.id,
              questionMessageId: currentQuestionId,
              threadId: message.threadId,
              enhancedAnswerMessageId: message.id,
              baselineAnswerMessageId: currentBaselineId,
              skillVersionNumber:
                message.skillVersionNumber ?? version?.versionNumber,
            });
          }
        }
        dispatch({ type: 'hydrate', messages });
      })
      .catch(() => {
        if (hydrateRequestRef.current === requestNo)
          dispatch({ type: 'error', message: '对话加载失败，请重试' });
      });
  }, [packageId, selectedThreadId, token, version?.versionNumber]);

  useEffect(
    () => () => {
      activeRequestRef.current += 1;
      streamBufferRef.current?.dispose();
      abortControllerRef.current?.abort();
    },
    [],
  );

  const sendContent = useCallback(
    async (rawContent: string) => {
      const content = rawContent.trim();
      if (!content || state.busy || !version) return;
      const requestNo = activeRequestRef.current + 1;
      activeRequestRef.current = requestNo;
      const controller = new AbortController();
      abortControllerRef.current = controller;
      const requestedThinking = thinkingPreference;
      onRunStateChange?.(true, threadIdRef.current);
      dispatch({
        type: 'submit',
        content,
        thinkingRequested: requestedThinking,
      });
      let buffer: ReturnType<typeof createSkillStreamBuffer> | null = null;
      try {
        if (!threadIdRef.current) {
          const thread = await liteApi.createArenaThread(token, packageId, {
            idempotencyKey: requestId(),
            basePackageVersionId: version.createdInPackageVersionId,
            left: { skillId: version.skillId, skillVersionId: version.id },
            right: { skillId: version.skillId, skillVersionId: version.id },
            surface: purpose,
          });
          threadIdRef.current = String(thread.id);
          onRunStateChange?.(true, threadIdRef.current);
          onThreadCreated?.(thread);
          try {
            const renamed = await liteApi.renameArenaThread(
              token,
              packageId,
              String(thread.id),
              getConversationTitle(content),
            );
            onThreadCreated?.(renamed);
          } catch {
            // A title is convenience metadata; a failed rename must not fail the run.
          }
        }
        if (
          activeRequestRef.current !== requestNo ||
          controller.signal.aborted
        )
          return;
        const streamThreadId = threadIdRef.current;
        if (!streamThreadId) return;
        let finished = false;
        buffer = createSkillStreamBuffer(
          ({ reasoning, content: contentDelta }) => {
            if (
              activeRequestRef.current !== requestNo ||
              threadIdRef.current !== streamThreadId
            )
              return;
            if (reasoning)
              dispatch({
                type: 'reasoning_delta',
                side: 'enhanced',
                delta: reasoning,
              });
            if (contentDelta)
              dispatch({
                type: 'delta',
                side: 'enhanced',
                delta: contentDelta,
              });
          },
          scheduleStreamFlush,
          cancelStreamFlush,
        );
        streamBufferRef.current = buffer;
        await liteApi.sendMessageStream(
          token,
          streamThreadId,
          content,
          undefined,
          'agent',
          requestedThinking,
          (event) => {
            if (
              activeRequestRef.current !== requestNo ||
              threadIdRef.current !== streamThreadId
            )
              return;
            if (event.event === 'thinking_status') {
              dispatch({ type: 'thinking_status', ...event.data });
            }
            if (event.event === 'reasoning_delta') {
              if (event.data.side === 'enhanced')
                buffer?.append('reasoning', event.data.delta);
            }
            if (event.event === 'delta') {
              if (event.data.side === 'enhanced')
                buffer?.append('content', event.data.delta);
            }
            if (event.event === 'side_done' && event.data.side === 'enhanced') {
              buffer?.flushNow();
              finished = true;
              if (event.data.ok) {
                dispatch({
                  type: 'done',
                  content: event.data.content,
                  reasoningContent: event.data.reasoningContent,
                });
                onCompleted?.();
              } else {
                dispatch({
                  type: 'error',
                  message: event.data.error || 'Skill 执行失败',
                });
              }
            }
            if (event.event === 'done') {
              onThreadUpdated?.(event.data.thread);
              const question = event.data.messages.find(
                (message) => message.side === 'shared',
              );
              const answer = event.data.messages.find(
                (message) => message.side === 'enhanced',
              );
              const baseline = event.data.messages.find(
                (message) => message.side === 'baseline',
              );
              if (question && answer) {
                dispatch({
                  type: 'attach-provenance',
                  questionMessageId: question.id,
                  answerMessageId: answer.id,
                  threadId: answer.threadId,
                  baselineAnswerMessageId: baseline?.id ?? null,
                  skillVersionNumber:
                    answer.skillVersionNumber ?? version.versionNumber,
                });
              }
            }
            if (event.event === 'error') {
              buffer?.flushNow();
              finished = true;
              dispatch({ type: 'error', message: event.data.error });
            }
            if (event.event === 'stream_end' && !event.data.ok && !finished) {
              buffer?.flushNow();
              dispatch({ type: 'error', message: 'Skill 执行中断，请重试' });
            }
          },
          controller.signal,
        );
      } catch (error) {
        buffer?.flushNow();
        if (activeRequestRef.current === requestNo) {
          if (
            controller.signal.aborted ||
            (error instanceof Error && error.name === 'AbortError')
          ) {
            dispatch({ type: 'stop' });
          } else {
            dispatch({
              type: 'error',
              message:
                error instanceof Error ? error.message : 'Skill 执行失败',
            });
          }
        }
      } finally {
        if (activeRequestRef.current === requestNo) {
          if (streamBufferRef.current === buffer) {
            buffer?.dispose();
            streamBufferRef.current = null;
          }
          if (abortControllerRef.current === controller)
            abortControllerRef.current = null;
          onRunStateChange?.(false, threadIdRef.current);
        }
      }
    },
    [
      onCompleted,
      onRunStateChange,
      onThreadCreated,
      onThreadUpdated,
      packageId,
      purpose,
      state.busy,
      thinkingPreference,
      token,
      version,
    ],
  );

  const send = () => sendContent(state.draft);
  const stop = useCallback(() => {
    streamBufferRef.current?.flushNow();
    activeRequestRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    streamBufferRef.current?.dispose();
    streamBufferRef.current = null;
    dispatch({ type: 'stop' });
    onRunStateChange?.(false, threadIdRef.current);
  }, [onRunStateChange]);

  const setThinking = (enabled: boolean) => {
    setThinkingPreference(enabled);
    writeThinkingPreference(enabled);
  };

  useEffect(() => {
    if (
      !rerunRequest ||
      rerunRequest.selection.origin !== purpose ||
      rerunRequest.versionNumber !== version?.versionNumber ||
      handledRerunRef.current === rerunRequest.requestId ||
      state.busy
    )
      return;
    handledRerunRef.current = rerunRequest.requestId;
    void sendContent(rerunRequest.selection.question);
  }, [purpose, rerunRequest, sendContent, state.busy, version?.versionNumber]);

  return (
    <div className="skill-flat-conversation skill-run-workspace skill-view-enter">
      <div className="skill-message-scroll-region">
        <ConversationTurnNavigation
          containerRef={messageListRef}
          turns={conversationTurns}
        />
        <div ref={messageListRef} className="skill-flat-messages">
          {state.messages.length === 0 &&
          !state.streaming &&
          !state.streamingReasoning ? (
            <div className="skill-flat-empty">
              <Play size={24} />
              <h2>
                {purpose === 'test' ? '试一试当前 Skill' : '开始使用这个 Skill'}
              </h2>
              <p>
                {purpose === 'test'
                  ? '用真实任务检查回答是否符合你的预期。'
                  : '输入一个教学任务，看看它如何完成。'}
              </p>
            </div>
          ) : (
            state.messages.map((message, index) =>
              message.role === 'user' ? (
                <div
                  id={`guided-turn-${purpose}-${index}`}
                  className="skill-user-message"
                  key={`${message.role}-${index}`}
                >
                  {message.content}
                </div>
              ) : (
                <div
                  className="skill-assistant-block"
                  key={`${message.role}-${index}`}
                >
                  <div className="skill-assistant-avatar">
                    <Sparkles size={14} />
                  </div>
                  <div className="skill-assistant-response">
                    {message.reasoningContent ? (
                      <SkillReasoningBlock
                        text={message.reasoningContent}
                        streaming={false}
                      />
                    ) : null}
                    <div className="skill-assistant-message">
                      <MarkdownContent content={message.content} />
                    </div>
                    {message.messageId && (
                      <div className="skill-answer-tools">
                        <span>
                          由 v
                          {message.skillVersionNumber ??
                            version?.versionNumber ??
                            '-'}{' '}
                          生成
                        </span>
                        <button
                          onClick={() => {
                            const question = [...state.messages.slice(0, index)]
                              .reverse()
                              .find((item) => item.role === 'user');
                            if (
                              !message.questionMessageId ||
                              !message.threadId ||
                              !version ||
                              !question
                            )
                              return;
                            onOptimizeAnswer({
                              origin: purpose,
                              packageId: Number(packageId),
                              threadId: message.threadId,
                              questionMessageId: message.questionMessageId,
                              enhancedAnswerMessageId:
                                message.enhancedAnswerMessageId!,
                              baselineAnswerMessageId:
                                message.baselineAnswerMessageId ?? null,
                              answerMessageId: message.messageId!,
                              answerSide: 'enhanced',
                              answerVersionNumber:
                                message.skillVersionNumber ??
                                version.versionNumber,
                              currentPackageVersionId: Number(
                                currentPackageVersionId ??
                                  version.createdInPackageVersionId,
                              ),
                              question: question.content,
                              answer: message.content,
                              feedback: '',
                            });
                          }}
                        >
                          <WandSparkles size={13} />
                          改进这条回答
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ),
            )
          )}
          {(state.streaming || state.streamingReasoning) && (
            <div className="skill-assistant-block">
              <div className="skill-assistant-avatar">
                <Sparkles size={14} />
              </div>
              <div className="skill-assistant-response">
                <SkillReasoningBlock
                  text={state.streamingReasoning}
                  streaming={state.busy}
                  expandedByDefault={state.stopped}
                />
                {state.streaming ? (
                  <div className="skill-assistant-message">
                    <MarkdownContent content={state.streaming} />
                  </div>
                ) : null}
              </div>
            </div>
          )}
          {state.thinkingNotice && state.thinkingSupported !== false ? (
            <div className="skill-thinking-notice" role="status">
              {state.thinkingNotice}
            </div>
          ) : null}
          {state.stopped ? (
            <div className="skill-thinking-notice" role="status">
              已停止生成，已收到的内容会保留在当前页面
            </div>
          ) : null}
          {state.error && <div className="skill-run-error">{state.error}</div>}
        </div>
      </div>
      <div className="skill-test-composer">
        <div className="skill-composer-input-row">
          <textarea
            aria-label={
              purpose === 'test'
                ? '输入测试任务'
                : '输入 Skill 使用任务'
            }
            value={state.draft}
            onChange={(event) =>
              dispatch({ type: 'draft', value: event.target.value })
            }
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !state.busy) {
                event.preventDefault();
                void send();
              }
            }}
            placeholder={
              purpose === 'test'
                ? '输入测试任务…'
                : '输入任务，立即使用这个 Skill…'
            }
          />
          {state.busy ? (
            <button
              type="button"
              className="skill-composer-stop"
              aria-label="停止生成"
              title="停止生成"
              onClick={stop}
            >
              <Square size={13} fill="currentColor" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              aria-label="发送任务"
              title="发送任务"
              onClick={() => void send()}
              disabled={!state.draft.trim() || !version}
            >
              <ArrowUp size={15} aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="skill-composer-helper-row">
          <SkillThinkingToggle
            enabled={thinkingPreference}
            disabled={state.busy}
            supported={state.thinkingSupported}
            onChange={setThinking}
          />
          <span className="skill-composer-shortcut">回车发送 · Shift+回车换行</span>
        </div>
      </div>
    </div>
  );
}
