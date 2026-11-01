import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ArenaThread, SkillVersionDetail } from '@educlaw/shared';
import { createPatch } from 'diff';
import {
  ArrowUp,
  Check,
  ChevronDown,
  Eye,
  Loader2,
  Save,
  Sparkles,
} from 'lucide-react';
import { liteApi } from '../../api/lite-api';
import DiffView from '../editor/DiffView';
import { MarkdownContent } from '../lite/lite-rendering';
import {
  createSkillOptimizeState,
  resolveSkillOptimizeReply,
  skillOptimizeReducer,
} from './skill-optimize-state';
import { ConversationTurnNavigation } from './ConversationTurnNavigation';
import { collectConversationTurns } from './conversation-turn-navigation';
import { getConversationTitle } from './skill-conversation-list';

type Props = {
  token: string;
  packageId: string;
  version: SkillVersionDetail | undefined;
  onSaved: (versionNumber: number) => void;
  onThreadCreated?: (thread: ArenaThread) => void;
};

function requestId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID)
    return crypto.randomUUID();
  return `skill-optimize-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const OPTIMIZE_REQUEST_TIMEOUT_MS = 180_000;

function createTimedOperation() {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, OPTIMIZE_REQUEST_TIMEOUT_MS);

  return {
    controller,
    didTimeout: () => timedOut,
    dispose: () => globalThis.clearTimeout(timeoutId),
  };
}

export function SkillOptimizeWorkspace({
  token,
  packageId,
  version,
  onSaved,
  onThreadCreated,
}: Props) {
  const [state, dispatch] = useReducer(
    skillOptimizeReducer,
    undefined,
    createSkillOptimizeState,
  );
  const [initializing, setInitializing] = useState(true);
  const [initializeAttempt, setInitializeAttempt] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const sessionIdRef = useRef<string | undefined>(undefined);
  const threadIdRef = useRef<string | null>(null);
  const renamedRef = useRef(false);
  const contextKeyRef = useRef('');
  const requestEpochRef = useRef(0);
  const mountedRef = useRef(true);
  const initializationAbortRef = useRef<AbortController | null>(null);
  const actionAbortRef = useRef<AbortController | null>(null);
  const sendLockRef = useRef(false);
  const saveLockRef = useRef(false);
  const onThreadCreatedRef = useRef(onThreadCreated);
  const messageListRef = useRef<HTMLDivElement>(null);
  const skillChanges = useMemo(
    () => state.changes.filter((change) => change.target === 'skill'),
    [state.changes],
  );
  const latestSkillChange = skillChanges[skillChanges.length - 1];
  const baseSkillMd = version?.skill.skillMd ?? '';
  const pendingSkillMd = latestSkillChange?.modified ?? '';
  const hasPendingDraft =
    Boolean(latestSkillChange) && pendingSkillMd !== baseSkillMd;
  const changeSummaries = useMemo(
    () =>
      [...new Set(skillChanges.map((change) => change.reason.trim()))].filter(
        Boolean,
      ),
    [skillChanges],
  );
  const pendingDiff = useMemo(() => {
    if (!version || !hasPendingDraft) return '';
    return createPatch(
      `${version.skill.dirName}/SKILL.md`,
      baseSkillMd,
      pendingSkillMd,
      `原始版本 v${version.versionNumber}`,
      '待保存草稿',
    );
  }, [baseSkillMd, hasPendingDraft, pendingSkillMd, version]);
  const conversationTurns = useMemo(
    () =>
      collectConversationTurns(
        state.messages.map((message, index) => ({
          id: `optimize-${index}`,
          role: message.role,
          content: message.content,
        })),
      ),
    [state.messages],
  );

  useEffect(() => {
    onThreadCreatedRef.current = onThreadCreated;
  }, [onThreadCreated]);

  useEffect(() => {
    if (!hasPendingDraft) setPreviewOpen(false);
  }, [hasPendingDraft]);

  useEffect(() => {
    const contextKey = version ? `${packageId}:${version.id}` : packageId;
    const contextChanged = contextKeyRef.current !== contextKey;
    if (contextChanged) {
      contextKeyRef.current = contextKey;
      requestEpochRef.current += 1;
      actionAbortRef.current?.abort();
      actionAbortRef.current = null;
      sendLockRef.current = false;
      saveLockRef.current = false;
      sessionIdRef.current = undefined;
      threadIdRef.current = null;
      renamedRef.current = false;
      setPreviewOpen(false);
      dispatch({ type: 'reset' });
    }

    const epoch = ++requestEpochRef.current;
    const operation = createTimedOperation();
    initializationAbortRef.current?.abort();
    initializationAbortRef.current = operation.controller;
    setInitializing(true);
    let disposed = false;
    const isCurrent = () =>
      !disposed &&
      mountedRef.current &&
      epoch === requestEpochRef.current &&
      contextKey === contextKeyRef.current;

    async function initialize() {
      if (!version) {
        if (isCurrent()) setInitializing(false);
        return;
      }
      try {
        let threadId = threadIdRef.current;
        if (!threadId) {
          const thread = await liteApi.createArenaThread(
            token,
            packageId,
            {
              idempotencyKey: requestId(),
              basePackageVersionId: version.createdInPackageVersionId,
              left: { skillId: version.skillId, skillVersionId: version.id },
              right: { skillId: version.skillId, skillVersionId: version.id },
              surface: 'optimize',
            },
            operation.controller.signal,
          );
          if (!isCurrent()) return;
          threadId = String(thread.id);
          threadIdRef.current = threadId;
          onThreadCreatedRef.current?.(thread);
        }
        const diagnosis = await liteApi.diagnosePackage(
          token,
          packageId,
          threadId,
          undefined,
          version.skill.dirName,
          operation.controller.signal,
        );
        if (!isCurrent()) return;
        sessionIdRef.current = diagnosis.session?.id
          ? String(diagnosis.session.id)
          : undefined;
        const skillIssues = diagnosis.issues.filter(
          (issue) => issue.target === 'skill',
        );
        const issueSummary = skillIssues.length
          ? `\n\n我先发现了 ${skillIssues.length} 个 Skill 层面的改进点：\n${skillIssues.map((issue, index) => `${index + 1}. ${issue.title}：${issue.suggestion}`).join('\n')}`
          : '';
        dispatch({
          type: 'initialize',
          content: `我已读取当前 v${version.versionNumber}。告诉我你希望改进的具体效果，我只会调整这个 Skill，不改动其他配置。${issueSummary}`,
        });
      } catch (error) {
        if (isCurrent()) {
          dispatch({
            type: 'error',
            message: operation.didTimeout()
              ? '分析等待时间过长，请重试。'
              : error instanceof Error
                ? error.message
                : 'Skill 分析失败',
          });
        }
      } finally {
        operation.dispose();
        if (initializationAbortRef.current === operation.controller) {
          initializationAbortRef.current = null;
        }
        if (isCurrent()) setInitializing(false);
      }
    }
    void initialize();
    return () => {
      disposed = true;
      operation.controller.abort();
      operation.dispose();
    };
  }, [initializeAttempt, packageId, token, version]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestEpochRef.current += 1;
      initializationAbortRef.current?.abort();
      actionAbortRef.current?.abort();
    };
  }, []);

  const send = async () => {
    const content = state.draft.trim();
    if (
      !content ||
      state.busy ||
      state.saving ||
      initializing ||
      sendLockRef.current
    )
      return;
    sendLockRef.current = true;
    const operation = createTimedOperation();
    actionAbortRef.current = operation.controller;
    const epoch = requestEpochRef.current;
    const requestMessages = [
      ...state.messages,
      {
        role: 'user' as const,
        content: `只优化当前 Skill，不要修改 agent 或 rubric。用户要求：${content}`,
      },
    ];
    dispatch({ type: 'submit', content });
    if (threadIdRef.current && !renamedRef.current) {
      renamedRef.current = true;
      void liteApi
        .renameArenaThread(
          token,
          packageId,
          threadIdRef.current,
          getConversationTitle(content),
        )
        .then((renamed) => {
          if (epoch === requestEpochRef.current) {
            onThreadCreatedRef.current?.(renamed);
          }
        })
        .catch(() => {
          // 标题为便捷元数据，重命名失败不应阻塞优化流程
        });
    }
    try {
      const result = await liteApi.chatOptimize(
        token,
        packageId,
        sessionIdRef.current,
        requestMessages,
        state.changes,
        undefined,
        version?.skill.dirName,
        operation.controller.signal,
      );
      if (
        epoch !== requestEpochRef.current ||
        operation.controller.signal.aborted
      )
        return;
      if (result.session?.id) sessionIdRef.current = String(result.session.id);
      const newSkillAdoptions = result.newAdoptions.filter(
        (change) => change.target === 'skill',
      );
      const visibleReply = resolveSkillOptimizeReply(
        result.reply,
        newSkillAdoptions,
      );
      dispatch({
        type: 'reply',
        content: visibleReply,
        adoptions: newSkillAdoptions,
      });
    } catch (error) {
      if (!mountedRef.current || epoch !== requestEpochRef.current) return;
      dispatch({
        type: 'error',
        message: operation.didTimeout()
          ? '修改等待时间过长，当前草稿已保留，请重试。'
          : error instanceof Error
            ? error.message
            : '优化对话失败',
      });
    } finally {
      operation.dispose();
      sendLockRef.current = false;
      if (actionAbortRef.current === operation.controller) {
        actionAbortRef.current = null;
      }
    }
  };

  const save = async () => {
    if (
      !state.changes.length ||
      state.saving ||
      state.busy ||
      saveLockRef.current
    )
      return;
    saveLockRef.current = true;
    const operation = createTimedOperation();
    actionAbortRef.current = operation.controller;
    const epoch = requestEpochRef.current;
    dispatch({ type: 'saving' });
    try {
      const result = await liteApi.applyInteractiveChanges(
        token,
        packageId,
        sessionIdRef.current,
        state.changes,
        '通过 Skill 工作台交互式优化生成',
        version?.skill.dirName,
        operation.controller.signal,
      );
      if (
        epoch !== requestEpochRef.current ||
        operation.controller.signal.aborted
      )
        return;
      dispatch({ type: 'saved', versionNumber: result.versionNumber });
      setPreviewOpen(false);
      onSaved(result.versionNumber);
    } catch (error) {
      if (!mountedRef.current || epoch !== requestEpochRef.current) return;
      dispatch({
        type: 'error',
        message: operation.didTimeout()
          ? '保存等待时间过长，待保存草稿仍在，请重试。'
          : error instanceof Error
            ? error.message
            : '保存优化版本失败',
      });
    } finally {
      operation.dispose();
      saveLockRef.current = false;
      if (actionAbortRef.current === operation.controller) {
        actionAbortRef.current = null;
      }
    }
  };

  return (
    <div className="skill-flat-conversation skill-optimize-workspace skill-view-enter">
      <div className="skill-message-scroll-region">
        <ConversationTurnNavigation
          containerRef={messageListRef}
          turns={conversationTurns}
        />
        <div ref={messageListRef} className="skill-flat-messages">
          {initializing ? (
            <div className="skill-flat-empty">
              <Loader2 size={23} className="spin" />
              <h2>正在分析这个 Skill</h2>
              <p>马上为你整理值得改进的地方。</p>
            </div>
          ) : (
            state.messages.map((message, index) =>
              message.role === 'user' ? (
                <div
                  id={`guided-turn-optimize-${index}`}
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
                  <div className="skill-assistant-message">
                    <MarkdownContent content={message.content} />
                  </div>
                </div>
              ),
            )
          )}
          {state.busy && (
            <div className="skill-assistant-message is-thinking">
              <span />
              <span />
              <span />
            </div>
          )}
          {state.error && (
            <div className="skill-run-error skill-optimize-error">
              <span>{state.error}</span>
              {!initializing && state.messages.length === 0 && version && (
                <button
                  type="button"
                  onClick={() => setInitializeAttempt((attempt) => attempt + 1)}
                >
                  重新分析
                </button>
              )}
            </div>
          )}
          {state.savedVersionNumber && (
            <div className="skill-optimize-saved">
              <Check size={14} />
              已生成 v{state.savedVersionNumber}
            </div>
          )}
        </div>
      </div>

      {state.changes.length > 0 && (
        <div className="skill-optimize-review">
          <div className="skill-optimize-savebar">
            <span>{state.changes.length} 项修改待保存</span>
            <div className="skill-optimize-save-actions">
              <button
                type="button"
                className="is-secondary"
                aria-expanded={previewOpen}
                aria-controls="skill-optimize-diff"
                onClick={() => setPreviewOpen((open) => !open)}
                disabled={!hasPendingDraft}
              >
                <Eye size={14} />
                查看本次改动
                <ChevronDown
                  size={14}
                  className={previewOpen ? 'is-open' : undefined}
                />
              </button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={state.saving || state.busy}
              >
                {state.saving ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <Save size={14} />
                )}
                保存为新版本
              </button>
            </div>
          </div>
          {!hasPendingDraft && (
            <p className="skill-optimize-preview-warning">
              当前修改没有形成可预览的 SKILL.md 草稿。
            </p>
          )}
          {previewOpen && hasPendingDraft && version && (
            <section
              id="skill-optimize-diff"
              className="skill-optimize-preview"
              aria-label="本次 Skill 修改预览"
            >
              <header>
                <div>
                  <strong>本次修改内容</strong>
                  <p>预览不会保存数据，也不会提前创建新版本。</p>
                </div>
                <div className="skill-optimize-version-source">
                  <span>原始版本 v{version.versionNumber}</span>
                  <span>待保存草稿 · 尚无正式版本号</span>
                </div>
              </header>
              {changeSummaries.length > 0 && (
                <div className="skill-optimize-summary">
                  <strong>修改摘要</strong>
                  <ul>
                    {changeSummaries.map((summary) => (
                      <li key={summary}>{summary}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="skill-optimize-diff-view">
                <DiffView diff={pendingDiff} />
              </div>
            </section>
          )}
        </div>
      )}

      <div className="skill-test-composer">
        <textarea
          value={state.draft}
          disabled={initializing}
          onChange={(event) =>
            dispatch({ type: 'draft', value: event.target.value })
          }
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
          placeholder="说说希望改进的效果，或回复“采纳”…"
        />
        <button
          onClick={() => void send()}
          disabled={
            !state.draft.trim() || state.busy || state.saving || initializing
          }
        >
          {state.busy ? (
            <Loader2 size={15} className="spin" />
          ) : (
            <ArrowUp size={15} />
          )}
        </button>
      </div>
    </div>
  );
}
