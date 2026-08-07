import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import type { ArenaThread, SkillVersionDetail } from '@educlaw/shared';
import { ArrowUp, Loader2, Play, Sparkles, WandSparkles } from 'lucide-react';
import { liteApi } from '../../api/lite-api';
import { createSkillRunState, skillRunReducer } from './skill-run-state';
import type { AnswerOptimizationRerunRequest, AnswerOptimizationSelection } from './answer-optimization-selection';
import { ConversationTurnNavigation } from './ConversationTurnNavigation';
import { collectConversationTurns } from './conversation-turn-navigation';
import { getConversationTitle } from './skill-conversation-list';

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
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `skill-run-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function SkillRunWorkspace({ token, packageId, version, currentPackageVersionId, purpose = 'run', onCompleted, onRunStateChange, onOptimizeAnswer, selectedThreadId = null, onThreadCreated, onThreadUpdated, rerunRequest }: Props) {
  const [state, dispatch] = useReducer(skillRunReducer, undefined, createSkillRunState);
  const threadIdRef = useRef<string | null>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const hydrateRequestRef = useRef(0);
  const handledRerunRef = useRef<string | null>(null);
  const conversationTurns = useMemo(() => collectConversationTurns(
    state.messages.map((message, index) => ({
      id: `${purpose}-${index}`,
      role: message.role,
      content: message.content,
    })),
  ), [purpose, state.messages]);

  useEffect(() => {
    const requestNo = hydrateRequestRef.current + 1;
    hydrateRequestRef.current = requestNo;
    threadIdRef.current = selectedThreadId;
    if (!selectedThreadId) {
      dispatch({ type: 'reset' });
      return;
    }
    void liteApi.getArenaThreadDetail(token, packageId, selectedThreadId).then((detail) => {
      if (hydrateRequestRef.current !== requestNo || threadIdRef.current !== selectedThreadId) return;
      const messages: import('./skill-run-state').SkillRunMessage[] = [];
      const sorted = [...detail.messages].sort((a, b) => {
        const time = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        return time || a.id - b.id;
      });
      let currentQuestionId: number | undefined;
      let currentBaselineId: number | null = null;
      for (const message of sorted) {
        if (message.side === 'shared' && message.role === 'user') {
          currentQuestionId = message.id;
          currentBaselineId = null;
          messages.push({ role: 'user', content: message.content, messageId: message.id });
        } else if (message.side === 'baseline' && message.role === 'assistant') {
          currentBaselineId = message.id;
        } else if (message.side === 'enhanced' && message.role === 'assistant') {
          messages.push({
            role: 'assistant',
            content: message.content,
            messageId: message.id,
            questionMessageId: currentQuestionId,
            threadId: message.threadId,
            enhancedAnswerMessageId: message.id,
            baselineAnswerMessageId: currentBaselineId,
            skillVersionNumber: message.skillVersionNumber ?? version?.versionNumber,
          });
        }
      }
      dispatch({ type: 'hydrate', messages });
    }).catch(() => {
      if (hydrateRequestRef.current === requestNo) dispatch({ type: 'error', message: '对话加载失败，请重试' });
    });
  }, [packageId, selectedThreadId, token, version?.versionNumber]);

  const sendContent = useCallback(async (rawContent: string) => {
    const content = rawContent.trim();
    if (!content || state.busy || !version) return;
    onRunStateChange?.(true, threadIdRef.current);
    dispatch({ type: 'submit', content });
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
          const renamed = await liteApi.renameArenaThread(token, packageId, String(thread.id), getConversationTitle(content));
          onThreadCreated?.(renamed);
        } catch {
          // A title is convenience metadata; a failed rename must not fail the run.
        }
      }
      const streamThreadId = threadIdRef.current;
      if (!streamThreadId) return;
      let finished = false;
      await liteApi.sendMessageStream(
        token,
        streamThreadId,
        content,
        undefined,
        'agent',
        (event) => {
          if (threadIdRef.current !== streamThreadId) return;
          if (event.event === 'delta') {
            dispatch({ type: 'delta', side: event.data.side, delta: event.data.delta });
          }
          if (event.event === 'side_done' && event.data.side === 'enhanced') {
            finished = true;
            if (event.data.ok) {
              dispatch({ type: 'done', content: event.data.content });
              onCompleted?.();
            } else {
              dispatch({ type: 'error', message: event.data.error || 'Skill 执行失败' });
            }
          }
          if (event.event === 'done') {
            onThreadUpdated?.(event.data.thread);
            const question = event.data.messages.find((message) => message.side === 'shared');
            const answer = event.data.messages.find((message) => message.side === 'enhanced');
            const baseline = event.data.messages.find((message) => message.side === 'baseline');
            if (question && answer) {
              dispatch({
                type: 'attach-provenance',
                questionMessageId: question.id,
                answerMessageId: answer.id,
                threadId: answer.threadId,
                baselineAnswerMessageId: baseline?.id ?? null,
                skillVersionNumber: answer.skillVersionNumber ?? version.versionNumber,
              });
            }
          }
          if (event.event === 'error') {
            finished = true;
            dispatch({ type: 'error', message: event.data.error });
          }
          if (event.event === 'stream_end' && !event.data.ok && !finished) {
            dispatch({ type: 'error', message: 'Skill 执行中断，请重试' });
          }
        },
      );
    } catch (error) {
      dispatch({
        type: 'error',
        message: error instanceof Error ? error.message : 'Skill 执行失败',
      });
    } finally {
      onRunStateChange?.(false, threadIdRef.current);
    }
  }, [onCompleted, onRunStateChange, onThreadCreated, onThreadUpdated, packageId, state.busy, token, version]);

  const send = () => sendContent(state.draft);

  useEffect(() => {
    if (
      !rerunRequest
      || rerunRequest.selection.origin !== purpose
      || rerunRequest.versionNumber !== version?.versionNumber
      || handledRerunRef.current === rerunRequest.requestId
      || state.busy
    ) return;
    handledRerunRef.current = rerunRequest.requestId;
    void sendContent(rerunRequest.selection.question);
  }, [purpose, rerunRequest, sendContent, state.busy, version?.versionNumber]);

  return (
    <div className="skill-flat-conversation skill-run-workspace skill-view-enter">
      <div className="skill-message-scroll-region">
        <ConversationTurnNavigation containerRef={messageListRef} turns={conversationTurns} />
        <div ref={messageListRef} className="skill-flat-messages">
        {state.messages.length === 0 && !state.streaming ? (
          <div className="skill-flat-empty">
            <Play size={24} />
            <h2>{purpose === 'test' ? '试一试当前 Skill' : '开始使用这个 Skill'}</h2>
            <p>{purpose === 'test' ? '用真实任务检查回答是否符合你的预期。' : '输入一个教学任务，看看它如何完成。'}</p>
          </div>
        ) : (
          state.messages.map((message, index) =>
            message.role === 'user' ? (
              <div id={`guided-turn-${purpose}-${index}`} className="skill-user-message" key={`${message.role}-${index}`}>
                {message.content}
              </div>
            ) : (
              <div className="skill-assistant-block" key={`${message.role}-${index}`}>
                <div className="skill-assistant-avatar"><Sparkles size={14} /></div>
                <div className="skill-assistant-response">
                  <div className="skill-assistant-message">{message.content}</div>
                  {message.messageId && (
                    <div className="skill-answer-tools">
                      <span>由 v{message.skillVersionNumber ?? version?.versionNumber ?? '-'} 生成</span>
                      <button onClick={() => {
                        const question = [...state.messages.slice(0, index)].reverse().find((item) => item.role === 'user');
                        if (!message.questionMessageId || !message.threadId || !version || !question) return;
                        onOptimizeAnswer({
                          origin: purpose,
                          packageId: Number(packageId),
                          threadId: message.threadId,
                          questionMessageId: message.questionMessageId,
                          enhancedAnswerMessageId: message.enhancedAnswerMessageId!,
                          baselineAnswerMessageId: message.baselineAnswerMessageId ?? null,
                          answerMessageId: message.messageId!,
                          answerSide: 'enhanced',
                          answerVersionNumber: message.skillVersionNumber ?? version.versionNumber,
                          currentPackageVersionId: Number(currentPackageVersionId ?? version.createdInPackageVersionId),
                          question: question.content,
                          answer: message.content,
                          feedback: '',
                        });
                      }}><WandSparkles size={13} />改进这条回答</button>
                    </div>
                  )}
                </div>
              </div>
            ),
          )
        )}
        {state.streaming && (
          <div className="skill-assistant-block">
            <div className="skill-assistant-avatar"><Sparkles size={14} /></div>
            <div className="skill-assistant-message">{state.streaming}</div>
          </div>
        )}
        {state.error && <div className="skill-run-error">{state.error}</div>}
        </div>
      </div>
      <div className="skill-test-composer">
        <textarea
          value={state.draft}
          onChange={(event) => dispatch({ type: 'draft', value: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
          placeholder={purpose === 'test' ? '输入测试任务…' : '输入任务，立即使用这个 Skill…'}
        />
        <button onClick={() => void send()} disabled={!state.draft.trim() || state.busy || !version}>
          {state.busy ? <Loader2 size={15} className="spin" /> : <ArrowUp size={15} />}
        </button>
      </div>
    </div>
  );
}
