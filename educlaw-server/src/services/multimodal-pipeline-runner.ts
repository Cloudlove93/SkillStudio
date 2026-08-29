import { GuidedCreationError } from './guided-creation-service.js';
import type {
  MultimodalPipelineStore,
  RunnablePipelineSession,
} from './multimodal-pipeline-store.js';

interface LoggerLike {
  debug?(payload: Record<string, unknown>, message: string): void;
  info(payload: Record<string, unknown>, message: string): void;
  warn(payload: Record<string, unknown>, message: string): void;
  error(payload: Record<string, unknown>, message: string): void;
  child?(payload: Record<string, unknown>): LoggerLike;
}

export interface MultimodalPipelineRunner {
  start(): void;
  stop(): void;
  runOnce(): Promise<void>;
}

interface MultimodalPipelineRunnerDependencies {
  store: Pick<MultimodalPipelineStore, 'scanRunnableSessions'> &
    Partial<Pick<MultimodalPipelineStore, 'runWithPipelineLease'>>;
  orchestrator: {
    runDistillationPipeline(input: {
      authUserId: string;
      sessionId: string;
    }): Promise<unknown>;
    runCandidatePipeline(input: {
      authUserId: string;
      sessionId: string;
    }): Promise<unknown>;
    runSkillBuildPipeline(input: {
      authUserId: string;
      sessionId: string;
    }): Promise<unknown>;
  };
  logger: LoggerLike;
  pollIntervalMs: number;
  batchLimit: number;
  concurrency: number;
  nowMs?: () => number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

const STALE_WORK_CODES = new Set(['SESSION_REVISION_CONFLICT', 'INVALID_MEDIA_STAGE']);

function positiveInteger(value: number, fieldName: string, maximum: number): number {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${fieldName} must be an integer between 1 and ${maximum}`);
  }
  return value;
}

function isStaleWorkError(error: unknown): error is GuidedCreationError {
  return error instanceof GuidedCreationError && STALE_WORK_CODES.has(error.code);
}

function returnedMediaStage(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const mediaStage = (value as Record<string, unknown>).mediaStage;
  return typeof mediaStage === 'string' && mediaStage.length > 0 ? mediaStage : null;
}

export function createMultimodalPipelineRunner(
  deps: MultimodalPipelineRunnerDependencies,
): MultimodalPipelineRunner {
  const logger = deps.logger.child?.({ component: 'multimodal-pipeline-runner' }) ?? deps.logger;
  const pollIntervalMs = positiveInteger(deps.pollIntervalMs, 'pollIntervalMs', 300_000);
  const batchLimit = positiveInteger(deps.batchLimit, 'batchLimit', 64);
  const concurrency = positiveInteger(deps.concurrency, 'concurrency', 16);
  const nowMs = deps.nowMs ?? Date.now;
  const setTimeoutFn = deps.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = deps.clearTimeoutFn ?? clearTimeout;

  let started = false;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let activeRun: Promise<void> | null = null;
  const inFlightSessionIds = new Set<string>();
  const retryAfterBySessionId = new Map<string, number>();

  function scheduleNext() {
    if (!started || stopped) {
      return;
    }

    timer = setTimeoutFn(() => {
      timer = null;
      void runOnce();
    }, pollIntervalMs);
    timer.unref?.();
    logger.debug?.(
      {
        event: 'multimodal.pipeline.runner.scheduled',
        pollIntervalMs,
      },
      'multimodal.pipeline.runner.scheduled',
    );
  }

  async function runSession(session: RunnablePipelineSession) {
    const retryAfter = retryAfterBySessionId.get(session.sessionId);
    if (retryAfter !== undefined && retryAfter > nowMs()) {
      return;
    }

    if (inFlightSessionIds.has(session.sessionId)) {
      logger.debug?.(
        {
          event: 'multimodal.pipeline.runner.session_already_inflight',
          sessionId: session.sessionId,
          mediaStage: session.mediaStage,
        },
        'multimodal.pipeline.runner.session_already_inflight',
      );
      return;
    }

    const startedAtMs = nowMs();
    inFlightSessionIds.add(session.sessionId);
    try {
      const runClaimedSession = async (): Promise<unknown> => {
        if (
          session.mediaStage === 'building_semantic_windows' ||
          session.mediaStage === 'building_evidence' ||
          session.mediaStage === 'building_adler'
        ) {
          return deps.orchestrator.runDistillationPipeline({
            authUserId: session.authUserId,
            sessionId: session.sessionId,
          });
        }
        if (session.mediaStage === 'building_skills') {
          return deps.orchestrator.runSkillBuildPipeline({
            authUserId: session.authUserId,
            sessionId: session.sessionId,
          });
        }

        return deps.orchestrator.runCandidatePipeline({
          authUserId: session.authUserId,
          sessionId: session.sessionId,
        });
      };

      const leaseResult = deps.store.runWithPipelineLease
        ? await deps.store.runWithPipelineLease(
            { sessionId: session.sessionId },
            runClaimedSession,
          )
        : { acquired: true as const, result: await runClaimedSession() };
      if (!leaseResult.acquired) {
        logger.debug?.(
          {
            event: 'multimodal.pipeline.runner.session_lease_busy',
            sessionId: session.sessionId,
            mediaStage: session.mediaStage,
          },
          'multimodal.pipeline.runner.session_lease_busy',
        );
        return;
      }
      retryAfterBySessionId.delete(session.sessionId);
      const nextMediaStage = returnedMediaStage(leaseResult.result);
      if (nextMediaStage === null || nextMediaStage === session.mediaStage) {
        logger.debug?.(
          {
            event: 'multimodal.pipeline.runner.session_waiting',
            sessionId: session.sessionId,
            mediaStage: session.mediaStage,
          },
          'multimodal.pipeline.runner.session_waiting',
        );
      } else {
        logger.info(
          {
            event: 'multimodal.pipeline.runner.session_advanced',
            sessionId: session.sessionId,
            previousMediaStage: session.mediaStage,
            mediaStage: nextMediaStage,
            durationMs: Math.max(0, nowMs() - startedAtMs),
          },
          'multimodal.pipeline.runner.session_advanced',
        );
      }
    } catch (error) {
      if (isStaleWorkError(error)) {
        retryAfterBySessionId.delete(session.sessionId);
        logger.warn(
          {
            event: 'multimodal.pipeline.runner.stale_work',
            sessionId: session.sessionId,
            mediaStage: session.mediaStage,
            code: error.code,
            statusCode: error.statusCode,
          },
          'multimodal.pipeline.runner.stale_work',
        );
        return;
      }

      retryAfterBySessionId.set(session.sessionId, nowMs() + Math.max(60_000, pollIntervalMs));

      logger.error(
        {
          event: 'multimodal.pipeline.runner.session_failed',
          sessionId: session.sessionId,
          mediaStage: session.mediaStage,
          errorType: error instanceof Error ? error.name : typeof error,
          ...(error instanceof GuidedCreationError
            ? {
                code: error.code,
                statusCode: error.statusCode,
                retryable: error.retryable,
              }
            : {}),
        },
        'multimodal.pipeline.runner.session_failed',
      );
    } finally {
      inFlightSessionIds.delete(session.sessionId);
    }
  }

  async function processBatch(sessions: RunnablePipelineSession[]) {
    const pending: RunnablePipelineSession[] = [];
    const seenSessionIds = new Set<string>();
    for (const session of sessions) {
      if (seenSessionIds.has(session.sessionId)) {
        continue;
      }
      seenSessionIds.add(session.sessionId);
      pending.push(session);
    }
    const workerCount = Math.min(concurrency, pending.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (pending.length > 0) {
        const session = pending.shift();
        if (!session) {
          return;
        }
        await runSession(session);
      }
    });
    await Promise.all(workers);
  }

  function runOnce(): Promise<void> {
    if (activeRun) {
      return activeRun;
    }

    activeRun = (async () => {
      try {
        const sessions = await deps.store.scanRunnableSessions({ limit: batchLimit });
        await processBatch(sessions);
      } catch (error) {
        logger.error(
          {
            event: 'multimodal.pipeline.runner.scan_failed',
            errorType: error instanceof Error ? error.name : typeof error,
            ...(error instanceof GuidedCreationError
              ? {
                  code: error.code,
                  statusCode: error.statusCode,
                }
              : {}),
          },
          'multimodal.pipeline.runner.scan_failed',
        );
      }
    })().finally(() => {
      activeRun = null;
      scheduleNext();
    });

    return activeRun;
  }

  function start() {
    if (started) {
      return;
    }

    started = true;
    stopped = false;
    logger.info(
      {
        event: 'multimodal.pipeline.runner.started',
        pollIntervalMs,
        batchLimit,
        concurrency,
      },
      'multimodal.pipeline.runner.started',
    );
    void runOnce();
  }

  function stop() {
    started = false;
    stopped = true;
    if (timer) {
      clearTimeoutFn(timer);
      timer = null;
    }
    logger.info(
      {
        event: 'multimodal.pipeline.runner.stopped',
      },
      'multimodal.pipeline.runner.stopped',
    );
  }

  return {
    start,
    stop,
    runOnce,
  };
}
