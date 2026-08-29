import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import type { SkillVersionDetail } from '@educlaw/shared';
import { ArrowUp, Ban, Columns3, Loader2, WandSparkles } from 'lucide-react';
import { liteApi } from '../../api/lite-api';
import { createSkillArenaState, skillArenaReducer } from './skill-arena-state';
import type {
  AnswerOptimizationRerunRequest,
  AnswerOptimizationSelection,
} from './answer-optimization-selection';
import { ConversationTurnNavigation } from './ConversationTurnNavigation';
import { collectConversationTurns } from './conversation-turn-navigation';

type Props = {
  token: string;
  packageId: string;
  versions: SkillVersionDetail[];
  currentVersionId: string | null;
  onCompleted: () => void;
  onOptimizeAnswer: (selection: AnswerOptimizationSelection) => void;
  rerunRequest?: AnswerOptimizationRerunRequest | null;
};

function requestId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID)
    return crypto.randomUUID();
  return `skill-arena-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const NONE = '__none__';

export function SkillArenaWorkspace({
  token,
  packageId,
  versions,
  currentVersionId,
  onCompleted,
  onOptimizeAnswer,
  rerunRequest,
}: Props) {
  const available = useMemo(
    () => versions.filter((version) => version.status !== 'discarded'),
    [versions],
  );
  const fallbackLeft =
    available.find((version) => version.id !== currentVersionId)?.id ||
    currentVersionId ||
    '';
  const fallbackRight = currentVersionId || available[0]?.id || '';
  const [leftVersionId, setLeftVersionId] = useState(fallbackLeft);
  const [rightVersionId, setRightVersionId] = useState(fallbackRight);
  const [state, dispatch] = useReducer(
    skillArenaReducer,
    undefined,
    createSkillArenaState,
  );
  const [provenance, setProvenance] = useState<{
    questionMessageId: number;
    threadId: number;
    baselineAnswerMessageId: number;
    enhancedAnswerMessageId: number;
  } | null>(null);
  const threadIdRef = useRef<string | null>(null);
  const resultListRef = useRef<HTMLDivElement>(null);
  const handledRerunRef = useRef<string | null>(null);
  const conversationTurns = useMemo(
    () =>
      collectConversationTurns(
        state.question
          ? [{ id: 'arena-current', role: 'user', content: state.question }]
          : [],
      ),
    [state.question],
  );

  useEffect(() => {
    if (!leftVersionId && fallbackLeft) setLeftVersionId(fallbackLeft);
    if (!rightVersionId && fallbackRight) setRightVersionId(fallbackRight);
  }, [fallbackLeft, fallbackRight, leftVersionId, rightVersionId]);

  useEffect(() => {
    threadIdRef.current = null;
    dispatch({ type: 'reset' });
    setProvenance(null);
  }, [leftVersionId, rightVersionId]);

  const leftVersion =
    leftVersionId === NONE
      ? null
      : available.find((version) => version.id === leftVersionId);
  const rightVersion =
    rightVersionId === NONE
      ? null
      : available.find((version) => version.id === rightVersionId);

  const sendContent = useCallback(
    async (rawContent: string) => {
      const content = rawContent.trim();
      if (!content || state.busy || (!leftVersion && !rightVersion)) return;
      const baseVersion = leftVersion ?? rightVersion;
      if (!baseVersion) return;
      dispatch({ type: 'submit', content });
      try {
        if (!threadIdRef.current) {
          const thread = await liteApi.createArenaThread(token, packageId, {
            idempotencyKey: requestId(),
            basePackageVersionId: baseVersion.createdInPackageVersionId,
            left: leftVersion
              ? { skillId: leftVersion.skillId, skillVersionId: leftVersion.id }
              : null,
            right: rightVersion
              ? {
                  skillId: rightVersion.skillId,
                  skillVersionId: rightVersion.id,
                }
              : null,
            surface: 'arena',
          });
          threadIdRef.current = String(thread.id);
        }
        await liteApi.sendMessageStream(
          token,
          threadIdRef.current,
          content,
          undefined,
          'compare',
          false,
          (event) => {
            if (event.event === 'delta')
              dispatch({
                type: 'delta',
                side: event.data.side,
                delta: event.data.delta,
              });
            if (event.event === 'side_done') {
              if (event.data.ok) {
                dispatch({
                  type: 'side_done',
                  side: event.data.side,
                  content: event.data.content,
                });
                if (event.data.side === 'enhanced') onCompleted();
              } else
                dispatch({
                  type: 'error',
                  message: event.data.error || '版本对比失败',
                });
            }
            if (event.event === 'done') {
              const question = event.data.messages.find(
                (message) => message.side === 'shared',
              );
              const baseline = event.data.messages.find(
                (message) => message.side === 'baseline',
              );
              const enhanced = event.data.messages.find(
                (message) => message.side === 'enhanced',
              );
              if (question && baseline && enhanced)
                setProvenance({
                  questionMessageId: question.id,
                  threadId: question.threadId,
                  baselineAnswerMessageId: baseline.id,
                  enhancedAnswerMessageId: enhanced.id,
                });
            }
            if (event.event === 'error')
              dispatch({ type: 'error', message: event.data.error });
          },
        );
      } catch (error) {
        dispatch({
          type: 'error',
          message: error instanceof Error ? error.message : '版本对比失败',
        });
      }
    },
    [leftVersion, onCompleted, packageId, rightVersion, state.busy, token],
  );

  const send = () => sendContent(state.draft);

  useEffect(() => {
    if (!rerunRequest || rerunRequest.selection.origin !== 'arena') return;
    const nextVersion = available.find(
      (item) => item.versionNumber === rerunRequest.versionNumber,
    );
    if (!nextVersion) return;
    if (
      rerunRequest.selection.answerSide === 'baseline' &&
      leftVersionId !== nextVersion.id
    ) {
      setLeftVersionId(nextVersion.id);
      return;
    }
    if (
      rerunRequest.selection.answerSide === 'enhanced' &&
      rightVersionId !== nextVersion.id
    ) {
      setRightVersionId(nextVersion.id);
      return;
    }
    if (handledRerunRef.current === rerunRequest.requestId || state.busy)
      return;
    handledRerunRef.current = rerunRequest.requestId;
    void sendContent(rerunRequest.selection.question);
  }, [
    available,
    leftVersionId,
    rerunRequest,
    rightVersionId,
    sendContent,
    state.busy,
  ]);

  const openOptimization = (side: 'baseline' | 'enhanced') => {
    const selected = side === 'baseline' ? leftVersion : rightVersion;
    const answer = side === 'baseline' ? state.baseline : state.enhanced;
    if (!provenance || !selected || !answer || !state.question) return;
    const current =
      versions.find((item) => item.id === currentVersionId) ??
      rightVersion ??
      selected;
    onOptimizeAnswer({
      origin: 'arena',
      packageId: Number(packageId),
      threadId: provenance.threadId,
      questionMessageId: provenance.questionMessageId,
      enhancedAnswerMessageId: provenance.enhancedAnswerMessageId,
      baselineAnswerMessageId: provenance.baselineAnswerMessageId,
      answerMessageId:
        side === 'baseline'
          ? provenance.baselineAnswerMessageId
          : provenance.enhancedAnswerMessageId,
      answerSide: side,
      answerVersionNumber: selected.versionNumber,
      currentPackageVersionId: Number(current.createdInPackageVersionId),
      question: state.question,
      answer,
      feedback: '',
    });
  };

  return (
    <div className="skill-arena-workspace skill-view-enter">
      <div className="arena-control-bar">
        <div className="arena-side-picker">
          <span className="arena-side-label">A</span>
          {leftVersionId === NONE ? (
            <button
              type="button"
              className="arena-none-btn"
              onClick={() => setLeftVersionId(fallbackLeft)}
            >
              <Ban size={13} /> 不使用 Skill
            </button>
          ) : (
            <>
              <select
                name="arena-left-version"
                aria-label="左侧对比版本"
                value={leftVersionId}
                onChange={(event) => setLeftVersionId(event.target.value)}
              >
                {available.map((version) => (
                  <option key={version.id} value={version.id}>
                    v{version.versionNumber}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="arena-remove-btn"
                onClick={() => setLeftVersionId(NONE)}
                title="移除 Skill"
                aria-label="移除左侧 Skill"
              >
                <Ban size={13} />
              </button>
            </>
          )}
        </div>
        <div className="arena-side-picker">
          <span className="arena-side-label">B</span>
          {rightVersionId === NONE ? (
            <button
              type="button"
              className="arena-none-btn"
              onClick={() => setRightVersionId(fallbackRight)}
            >
              <Ban size={13} /> 不使用 Skill
            </button>
          ) : (
            <>
              <select
                name="arena-right-version"
                aria-label="右侧对比版本"
                value={rightVersionId}
                onChange={(event) => setRightVersionId(event.target.value)}
              >
                {available.map((version) => (
                  <option key={version.id} value={version.id}>
                    v{version.versionNumber}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="arena-remove-btn"
                onClick={() => setRightVersionId(NONE)}
                title="移除 Skill"
                aria-label="移除右侧 Skill"
              >
                <Ban size={13} />
              </button>
            </>
          )}
        </div>
      </div>

      <div className="skill-message-scroll-region">
        <ConversationTurnNavigation
          containerRef={resultListRef}
          turns={conversationTurns}
        />
        <div ref={resultListRef} className="skill-arena-results">
          {!state.question ? (
            <div className="arena-empty-state">
              <Columns3 size={28} strokeWidth={1.5} />
              <h2>版本对比</h2>
              <p>输入同一个任务，直观比较两个版本的回答效果</p>
            </div>
          ) : (
            <>
              <div
                id="guided-turn-arena-current"
                className="skill-user-message"
              >
                {state.question}
              </div>
              <div className="arena-grid">
                <ArenaSide
                  side="A"
                  version={leftVersion}
                  answer={state.baseline}
                  busy={state.busy}
                  onBegin={() => openOptimization('baseline')}
                  ready={Boolean(provenance)}
                />
                <ArenaSide
                  side="B"
                  version={rightVersion}
                  answer={state.enhanced}
                  busy={state.busy}
                  onBegin={() => openOptimization('enhanced')}
                  ready={Boolean(provenance)}
                />
              </div>
            </>
          )}
          {state.error && <div className="skill-run-error">{state.error}</div>}
        </div>
      </div>
      <div className="skill-test-composer">
        <textarea
          aria-label="输入对比测试任务"
          name="arena-task"
          autoComplete="off"
          value={state.draft}
          onChange={(event) =>
            dispatch({ type: 'draft', value: event.target.value })
          }
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
          placeholder="输入用于对比的真实任务…"
        />
        <button
          type="button"
          aria-label="运行版本对比"
          onClick={() => void send()}
          disabled={
            !state.draft.trim() || state.busy || (!leftVersion && !rightVersion)
          }
        >
          {state.busy ? (
            <Loader2 size={15} className="spin" aria-hidden="true" />
          ) : (
            <ArrowUp size={15} aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  );
}

function ArenaSide({
  side,
  version,
  answer,
  busy,
  onBegin,
  ready,
}: {
  side: 'A' | 'B';
  version?: SkillVersionDetail | null;
  answer: string;
  busy: boolean;
  onBegin: () => void;
  ready: boolean;
}) {
  const isNone = !version;
  return (
    <section className={isNone ? 'arena-side arena-side-none' : 'arena-side'}>
      <div className="arena-side-label-row">
        <span className={`arena-side-badge arena-side-badge-${side}`}>
          {side}
        </span>
        <span className="arena-side-version">
          {version ? `v${version.versionNumber}` : '不使用 Skill'}
        </span>
      </div>
      <div className="arena-side-body">
        {answer ||
          (busy ? (
            <span className="arena-side-loading">
              <Loader2 size={14} className="spin" /> 正在生成…
            </span>
          ) : (
            <span className="arena-side-placeholder">暂无结果</span>
          ))}
      </div>
      {ready && answer && version && (
        <button className="arena-side-optimize" onClick={onBegin}>
          <WandSparkles size={13} /> 改进这个版本
        </button>
      )}
    </section>
  );
}
