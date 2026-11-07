import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ArenaRunSnapshot,
  ArenaThread,
  SkillVersionDetail,
} from '@educlaw/shared';
import {
  ArrowUp,
  Play,
  Sparkles,
  Square,
  WandSparkles,
} from 'lucide-react';
import { useSkillRun } from './use-skill-run';
import type {
  AnswerOptimizationRerunRequest,
  AnswerOptimizationSelection,
} from './answer-optimization-selection';
import { ConversationTurnNavigation } from './ConversationTurnNavigation';
import { collectConversationTurns } from './conversation-turn-navigation';
import { MarkdownContent } from '../lite/lite-rendering';
import { SkillReasoningBlock } from './SkillReasoningBlock';
import { SkillThinkingToggle } from './SkillThinkingToggle';
import {
  readThinkingPreference,
  writeThinkingPreference,
} from './skill-thinking-preference';
import { useConversationAutoScroll } from './use-conversation-auto-scroll';

type Props = {
  token: string;
  packageId: string;
  version: SkillVersionDetail | undefined;
  currentPackageVersionId: string | undefined;
  purpose?: 'run' | 'test';
  showAnswerOptimization?: boolean;
  agentName?: string;
  onCompleted?: () => void;
  onRunStateChange?: (
    running: boolean,
    threadId?: string | null,
    status?: ArenaRunSnapshot['status'],
  ) => void;
  onOptimizeAnswer: (selection: AnswerOptimizationSelection) => void;
  selectedThreadId?: string | null;
  onThreadCreated?: (thread: ArenaThread) => void;
  onThreadUpdated?: (thread: ArenaThread) => void;
  rerunRequest?: AnswerOptimizationRerunRequest | null;
  onRerunHandled?: (requestId: string) => void;
};

function SkillRunActivityStatus({ label }: { label: string }) {
  return (
    <div
      className="skill-run-activity"
      role="status"
      aria-live="polite"
      data-skill-run-activity
    >
      <span>{label}</span>
      <span className="skill-run-activity-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
    </div>
  );
}

export function SkillRunWorkspace({
  token,
  packageId,
  version,
  currentPackageVersionId,
  purpose = 'run',
  showAnswerOptimization = true,
  agentName,
  onCompleted,
  onRunStateChange,
  onOptimizeAnswer,
  selectedThreadId = null,
  onThreadCreated,
  onThreadUpdated,
  rerunRequest,
  onRerunHandled,
}: Props) {
  const { state, dispatch, historyLoading, sendContent, stop, canSend } =
    useSkillRun({
      token,
      packageId,
      version,
      purpose,
      selectedThreadId,
      onCompleted,
      onRunStateChange,
      onThreadCreated,
      onThreadUpdated,
    });
  const [thinkingPreference, setThinkingPreference] = useState(() =>
    readThinkingPreference(),
  );
  const messageListRef = useRef<HTMLDivElement>(null);
  const handledRerunRef = useRef<string | null>(null);
  const packageHeadId = Number(currentPackageVersionId);
  const canOptimize = Number.isSafeInteger(packageHeadId) && packageHeadId > 0;
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
  const latestMessage = state.messages.at(-1);
  const conversationScrollKey = [
    selectedThreadId ?? 'new',
    historyLoading ? 'loading' : 'ready',
    state.messages.length,
    latestMessage?.role ?? '',
    latestMessage?.messageId ?? '',
    latestMessage?.content.length ?? 0,
    latestMessage?.content.slice(-32) ?? '',
    state.streaming.length,
    state.streaming.slice(-32),
    state.streamingReasoning.length,
    state.streamingReasoning.slice(-32),
    state.thinkingNotice ?? '',
    state.stopped ? 'stopped' : 'running',
    state.error ?? '',
  ].join('|');
  useConversationAutoScroll(
    messageListRef,
    conversationScrollKey,
    selectedThreadId ?? 'new',
  );

  const send = () => sendContent(state.draft, thinkingPreference);

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
      state.busy ||
      historyLoading ||
      !version ||
      !rerunRequest.selection.question.trim()
    )
      return;
    // Effect replay must cancel admission before it marks a rerun as handled.
    let current = true;
    queueMicrotask(() => {
      if (!current || !canSend()) return;
      handledRerunRef.current = rerunRequest.requestId;
      void sendContent(rerunRequest.selection.question, thinkingPreference);
      onRerunHandled?.(rerunRequest.requestId);
    });
    return () => {
      current = false;
    };
  }, [
    canSend,
    historyLoading,
    purpose,
    rerunRequest,
    onRerunHandled,
    sendContent,
    state.busy,
    thinkingPreference,
    version,
  ]);

  return (
    <div className="skill-flat-conversation skill-run-workspace skill-view-enter">
      <div className="skill-message-scroll-region">
        <ConversationTurnNavigation
          containerRef={messageListRef}
          turns={conversationTurns}
        />
        <div ref={messageListRef} className="skill-flat-messages">
          {historyLoading ? (
            <div className="skill-flat-empty" role="status">
              <Play size={24} />
              <h2>正在加载历史对话</h2>
              <p>正在读取已保存的消息，请稍候。</p>
            </div>
          ) : state.messages.length === 0 &&
            !state.streaming &&
            !state.streamingReasoning ? (
            <div className="skill-flat-empty">
              <Play size={24} />
              <h2>
                {agentName ? `${purpose === 'test' ? '测试' : '开始使用'} ${agentName}` : purpose === 'test' ? '试一试当前 Skill' : '开始使用这个 Skill'}
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
                    {message.messageId && showAnswerOptimization && (
                      <div className="skill-answer-tools">
                        <span>
                          由 v
                          {message.skillVersionNumber ??
                            version?.versionNumber ??
                            '-'}{' '}
                          生成
                        </span>
                        <button
                          disabled={!canOptimize}
                          onClick={() => {
                            const question = [...state.messages.slice(0, index)]
                              .reverse()
                              .find((item) => item.role === 'user');
                            if (
                              !message.questionMessageId ||
                              !message.threadId ||
                              !version ||
                              !canOptimize ||
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
                              currentPackageVersionId: packageHeadId,
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
          {(state.busy || state.streaming || state.streamingReasoning) && (
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
                {state.busy &&
                (!state.streamingReasoning || state.streaming) ? (
                  <SkillRunActivityStatus
                    label={state.streaming ? '正在生成…' : '正在思考…'}
                  />
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
                : agentName ? '输入教学任务' : '输入 Skill 使用任务'
            }
            value={state.draft}
            onChange={(event) =>
              dispatch({ type: 'draft', value: event.target.value })
            }
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !state.busy &&
                !historyLoading
              ) {
                event.preventDefault();
                void send();
              }
            }}
            placeholder={
              purpose === 'test'
                ? '输入测试任务…'
                : agentName ? '输入教学任务…' : '输入任务，立即使用这个 Skill…'
            }
            disabled={historyLoading}
          />
          {state.busy ? (
            <button
              type="button"
              className="skill-composer-stop"
              aria-label="停止生成"
              title="停止生成"
              onClick={() => void stop()}
            >
              <Square size={13} fill="currentColor" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              aria-label="发送任务"
              title="发送任务"
              onClick={() => void send()}
              disabled={historyLoading || !state.draft.trim() || !version}
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
          <span className="skill-composer-shortcut">
            回车发送 · Shift+回车换行
          </span>
        </div>
      </div>
    </div>
  );
}
