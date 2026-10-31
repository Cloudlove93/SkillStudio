import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type {
  ArenaMessage,
  ArenaRunSnapshot,
  ArenaThread,
  SkillVersionDetail,
} from '@educlaw/shared';
import { liteApi } from '../../api/lite-api';
import { createSkillRunState, skillRunReducer } from './skill-run-state';
import { isArenaRunActive, reconcileSkillRun } from './skill-run-recovery';
import { getConversationTitle } from './skill-conversation-list';

type Options = {
  token: string;
  packageId: string;
  selectedThreadId: string | null;
  version?: SkillVersionDetail;
  purpose: 'run' | 'test';
  onCompleted?: () => void;
  onRunStateChange?: (
    running: boolean,
    threadId?: string | null,
    status?: ArenaRunSnapshot['status'],
  ) => void;
  onThreadCreated?: (thread: ArenaThread) => void;
  onThreadUpdated?: (thread: ArenaThread) => void;
};
type Context = {
  generation: number;
  threadId: string | null;
  token: string;
  packageId: string;
  controller: AbortController;
  history: ArenaMessage[];
  run: ArenaRunSnapshot | null;
  optimistic?: string;
  hydratedTerminal?: string;
  pendingStop?: boolean;
  reportedStatus?: ArenaRunSnapshot['status'];
  recoveryFailureStartedAt?: number;
  connectionWarningVisible?: boolean;
};
const CONNECTION_WARNING_GRACE_MS = 10_000;
function requestId() {
  return crypto.randomUUID();
}
function pause(signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, 700);
    signal.addEventListener('abort', done, { once: true });
    if (signal.aborted) done();
  });
}

/** The controller owns only the display subscription; execution lives on the server. */
export function useSkillRun(options: Options) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [state, dispatch] = useReducer(
    skillRunReducer,
    undefined,
    createSkillRunState,
  );
  const [historyLoading, setHistoryLoading] = useState(
    !!options.selectedThreadId,
  );
  const loadingRef = useRef(!!options.selectedThreadId);
  const admissionRef = useRef(false);
  const contextRef = useRef<Context | null>(null);
  const generationRef = useRef(0);
  const notifiedRef = useRef(new Set<string>());
  const current = useCallback(
    (context: Context) =>
      contextRef.current === context && !context.controller.signal.aborted,
    [],
  );

  const apply = useCallback(
    function applySnapshot(context: Context, snapshot: ArenaRunSnapshot) {
      if (!current(context) || String(snapshot.threadId) !== context.threadId)
        return;
      context.recoveryFailureStartedAt = undefined;
      if (context.connectionWarningVisible) {
        context.connectionWarningVisible = false;
        dispatch({ type: 'connection_restored' });
      }
      if (
        context.run &&
        (context.run.runId !== snapshot.runId ||
          snapshot.revision <= context.run.revision)
      )
        return;
      context.run = snapshot;
      if (snapshot.shared || !isArenaRunActive(snapshot))
        context.optimistic = undefined;
      if (
        snapshot.status === 'succeeded' &&
        (snapshot.historyRequired ||
          !snapshot.messages.some(
            (message) =>
              message.side === 'enhanced' && message.role === 'assistant',
          )) &&
        context.hydratedTerminal !== snapshot.runId
      ) {
        admissionRef.current = true;
        void (async () => {
          while (current(context) && context.run?.runId === snapshot.runId) {
            try {
              const recovery = await liteApi.recoverArenaRun(
                context.token,
                context.threadId!,
              );
              if (!current(context)) return;
              const questionId =
                snapshot.shared?.id ??
                context.history
                  .filter(
                    (message) =>
                      message.side === 'shared' && message.role === 'user',
                  )
                  .at(-1)?.id;
              if (
                !recovery.detail.messages.some(
                  (message) =>
                    message.side === 'enhanced' &&
                    message.role === 'assistant' &&
                    (questionId === undefined ||
                      Number(message.id) > Number(questionId)),
                )
              ) {
                await pause(context.controller.signal);
                continue;
              }
              context.history = recovery.detail.messages;
              context.hydratedTerminal = snapshot.runId;
              context.run = null;
              applySnapshot(context, snapshot);
              return;
            } catch {
              if (current(context))
                dispatch({
                  type: 'connection_error',
                  message: '回答已完成，正在恢复已保存消息…',
                });
              await pause(context.controller.signal);
            }
          }
        })();
        return;
      }
      const merged = new Map(
        context.history.map((message) => [String(message.id), message]),
      );
      if (snapshot.shared)
        merged.set(String(snapshot.shared.id), snapshot.shared);
      for (const message of snapshot.messages)
        merged.set(String(message.id), message);
      context.history = [...merged.values()];
      const next = reconcileSkillRun(
        context.history,
        snapshot,
        optionsRef.current.version?.versionNumber,
      );
      if (!snapshot.shared && context.optimistic)
        next.messages.push({ role: 'user', content: context.optimistic });
      dispatch({ type: 'restore', state: next });
      admissionRef.current = isArenaRunActive(snapshot);
      if (context.reportedStatus !== snapshot.status) {
        context.reportedStatus = snapshot.status;
        optionsRef.current.onRunStateChange?.(
          isArenaRunActive(snapshot),
          context.threadId,
          snapshot.status,
        );
      }
      if (
        !isArenaRunActive(snapshot) &&
        !notifiedRef.current.has(snapshot.runId)
      ) {
        notifiedRef.current.add(snapshot.runId);
        if (snapshot.status === 'succeeded') optionsRef.current.onCompleted?.();
      }
    },
    [current],
  );

  const observe = useCallback(
    async (context: Context) => {
      while (current(context) && context.run && isArenaRunActive(context.run)) {
        const runId = context.run.runId;
        try {
          await liteApi.subscribeArenaRun(
            context.token,
            context.threadId!,
            runId,
            (snapshot) => apply(context, snapshot),
            context.controller.signal,
          );
        } catch {
          // Execution is owned by the server. A transient subscription reset
          // must not be presented as a generation failure; the authoritative
          // snapshot check below decides whether recovery is actually needed.
        }
        if (!current(context) || !context.run || !isArenaRunActive(context.run))
          break;
        await pause(context.controller.signal);
        if (!current(context)) break;
        try {
          const snapshot = await liteApi.getArenaRun(
            context.token,
            context.threadId!,
            runId,
          );
          apply(context, snapshot);
        } catch (error) {
          const status = (error as { status?: number }).status;
          if (current(context) && (status === 401 || status === 403)) {
            admissionRef.current = false;
            context.run = null;
            dispatch({ type: 'error', message: '无权访问此运行，请重新登录' });
            break;
          }
          if (current(context) && status === 404) {
            try {
              const recovery = await liteApi.recoverArenaRun(
                context.token,
                context.threadId!,
              );
              if (!current(context)) break;
              context.history = recovery.detail.messages;
              context.run = null;
              if (recovery.run) {
                apply(context, recovery.run);
                if (isArenaRunActive(recovery.run)) continue;
              } else {
                admissionRef.current = false;
                dispatch({
                  type: 'restore',
                  state: reconcileSkillRun(
                    context.history,
                    null,
                    optionsRef.current.version?.versionNumber,
                  ),
                });
                optionsRef.current.onRunStateChange?.(
                  false,
                  context.threadId,
                  'failed',
                );
              }
              break;
            } catch {
              /* transient recovery failure follows the normal backoff */
            }
          }
          // A lost connection never asserts that execution succeeded or failed.
          if (current(context)) {
            context.recoveryFailureStartedAt ??= Date.now();
          }
          if (
            current(context) &&
            !context.connectionWarningVisible &&
            Date.now() - context.recoveryFailureStartedAt! >=
              CONNECTION_WARNING_GRACE_MS
          ) {
            context.connectionWarningVisible = true;
            dispatch({
              type: 'connection_error',
              message: '暂时无法连接服务端，正在重试恢复…',
            });
          }
        }
      }
    },
    [apply, current],
  );

  const honorPendingStop = useCallback(
    async (context: Context, snapshot: ArenaRunSnapshot) => {
      if (!context.pendingStop || !isArenaRunActive(snapshot)) return;
      try {
        apply(
          context,
          await liteApi.stopArenaRun(
            context.token,
            context.threadId!,
            snapshot.runId,
          ),
        );
      } catch (error) {
        if (current(context))
          dispatch({
            type: 'connection_error',
            message:
              error instanceof Error ? error.message : '停止失败，请重试',
          });
      }
    },
    [apply, current],
  );

  useEffect(() => {
    const previous = contextRef.current;
    // Parent acknowledges a newly created thread without detaching its run.
    if (
      previous &&
      !previous.controller.signal.aborted &&
      previous.threadId === options.selectedThreadId &&
      previous.token === options.token &&
      previous.packageId === options.packageId
    )
      return;
    previous?.controller.abort();
    const context: Context = {
      generation: ++generationRef.current,
      threadId: options.selectedThreadId,
      token: options.token,
      packageId: options.packageId,
      controller: new AbortController(),
      history: [],
      run: null,
    };
    contextRef.current = context;
    admissionRef.current = false;
    loadingRef.current = !!context.threadId;
    setHistoryLoading(!!context.threadId);
    dispatch({ type: 'reset' });
    if (!context.threadId) return;
    void liteApi
      .recoverArenaRun(options.token, context.threadId)
      .then((recovery) => {
        if (!current(context)) return;
        context.history = recovery.detail.messages;
        if (recovery.run) apply(context, recovery.run);
        else
          dispatch({
            type: 'restore',
            state: reconcileSkillRun(
              context.history,
              null,
              optionsRef.current.version?.versionNumber,
            ),
          });
        loadingRef.current = false;
        setHistoryLoading(false);
        void observe(context);
      })
      .catch(() => {
        if (!current(context)) return;
        // Keep admission closed until recovery has established the server state.
        dispatch({
          type: 'connection_error',
          message: '对话加载失败，请刷新重试恢复',
        });
        setHistoryLoading(false);
      });
  }, [
    options.selectedThreadId,
    options.token,
    options.packageId,
    current,
    apply,
    observe,
  ]);

  useEffect(
    () => () => {
      contextRef.current?.controller.abort();
      contextRef.current = null;
      admissionRef.current = false;
      loadingRef.current = true;
    },
    [],
  );

  const sendContent = useCallback(
    async (raw: string, thinkingEnabled: boolean) => {
      const content = raw.trim();
      const context = contextRef.current;
      const captured = optionsRef.current;
      if (
        !content ||
        !context ||
        !current(context) ||
        admissionRef.current ||
        loadingRef.current ||
        !captured.version
      )
        return;
      admissionRef.current = true;
      context.optimistic = content;
      context.run = null;
      context.pendingStop = false;
      let pendingRequestId: string | null = null;
      dispatch({ type: 'submit', content, thinkingRequested: thinkingEnabled });
      try {
        if (!context.threadId) {
          const thread = await liteApi.createArenaThread(
            captured.token,
            captured.packageId,
            {
              idempotencyKey: requestId(),
              basePackageVersionId: captured.version.createdInPackageVersionId,
              left: {
                skillId: captured.version.skillId,
                skillVersionId: captured.version.id,
              },
              right: {
                skillId: captured.version.skillId,
                skillVersionId: captured.version.id,
              },
              surface: captured.purpose,
            },
          );
          if (!current(context)) return;
          context.threadId = String(thread.id);
          captured.onThreadCreated?.(thread);
          // Title updates never delay model admission, and stale responses cannot navigate.
          void liteApi
            .renameArenaThread(
              captured.token,
              captured.packageId,
              context.threadId,
              getConversationTitle(content),
            )
            .then((renamed) => {
              if (current(context))
                optionsRef.current.onThreadUpdated?.(renamed);
            })
            .catch(() => {});
        }
        if (!current(context)) return;
        captured.onRunStateChange?.(true, context.threadId, 'running');
        const input = {
          requestId: requestId(),
          content,
          mode: 'agent' as const,
          thinkingEnabled,
        };
        pendingRequestId = input.requestId;
        let snapshot: ArenaRunSnapshot;
        try {
          snapshot = await liteApi.startArenaRun(
            captured.token,
            context.threadId!,
            input,
          );
        } catch (error) {
          // A transport failure may have lost an accepted response. Reuse the key.
          if (!(error instanceof TypeError)) throw error;
          snapshot = await liteApi.startArenaRun(
            captured.token,
            context.threadId!,
            input,
          );
        }
        apply(context, snapshot);
        await honorPendingStop(context, snapshot);
        if (current(context)) void observe(context);
      } catch (error) {
        if (!current(context) && !context.pendingStop) return;
        // Establish authoritative state after a failed/lost start before reopening admission.
        try {
          const recovery = await liteApi.recoverArenaRun(
            captured.token,
            context.threadId!,
          );
          if (!current(context) && !context.pendingStop) return;
          context.history = recovery.detail.messages;
          if (
            recovery.run &&
            (isArenaRunActive(recovery.run) ||
              recovery.run.requestId === pendingRequestId)
          ) {
            context.run = null;
            apply(context, recovery.run);
            if (recovery.run.requestId === pendingRequestId)
              await honorPendingStop(context, recovery.run);
            if (current(context)) void observe(context);
            return;
          }
          if (!current(context)) return;
          admissionRef.current = false;
          dispatch({
            type: 'error',
            message: error instanceof Error ? error.message : 'Skill 执行失败',
          });
          captured.onRunStateChange?.(false, context.threadId, 'failed');
        } catch {
          if (current(context))
            dispatch({
              type: 'connection_error',
              message: '无法确认运行状态，请刷新恢复后继续',
            });
        }
      }
    },
    [apply, current, honorPendingStop, observe],
  );

  const stop = useCallback(async () => {
    const context = contextRef.current;
    if (!context || !current(context)) return;
    if (!context.run) {
      if (admissionRef.current) context.pendingStop = true;
      return;
    }
    if (!isArenaRunActive(context.run)) return;
    try {
      apply(
        context,
        await liteApi.stopArenaRun(
          context.token,
          context.threadId!,
          context.run.runId,
        ),
      );
    } catch (error) {
      if (current(context))
        dispatch({
          type: 'connection_error',
          message: error instanceof Error ? error.message : '停止失败，请重试',
        });
    }
  }, [apply, current]);
  return {
    state,
    dispatch,
    historyLoading,
    sendContent,
    stop,
    canSend: () => !loadingRef.current && !admissionRef.current,
  };
}
