import { afterEach, describe, expect, it, vi } from 'vitest';
import { GuidedCreationError } from './guided-creation-service.js';
import { createMultimodalPipelineRunner } from './multimodal-pipeline-runner';

describe('multimodal pipeline runner', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('skips a session when another server instance holds its database lease', async () => {
    const runCandidatePipeline = vi.fn();
    const runWithPipelineLease = vi.fn().mockResolvedValue({ acquired: false });
    const runner = createMultimodalPipelineRunner({
      store: {
        scanRunnableSessions: vi.fn().mockResolvedValue([{
          sessionId: '101',
          authUserId: 'user-1',
          mediaStage: 'extracting_candidates',
        }]),
        runWithPipelineLease,
      },
      orchestrator: {
        runCandidatePipeline,
        runSkillBuildPipeline: vi.fn(),
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn().mockReturnThis(),
      },
      pollIntervalMs: 5_000,
      batchLimit: 1,
      concurrency: 1,
    });

    await runner.runOnce();

    expect(runWithPipelineLease).toHaveBeenCalledWith(
      { sessionId: '101' },
      expect.any(Function),
    );
    expect(runCandidatePipeline).not.toHaveBeenCalled();
  });

  it('dispatches semantic, evidence, and Adler stages to the distillation orchestrator', async () => {
    const scanRunnableSessions = vi.fn().mockResolvedValue([
      {
        sessionId: '201',
        authUserId: 'user-1',
        mediaStage: 'building_semantic_windows',
      },
      {
        sessionId: '202',
        authUserId: 'user-2',
        mediaStage: 'building_evidence',
      },
      {
        sessionId: '203',
        authUserId: 'user-3',
        mediaStage: 'building_adler',
      },
    ]);
    const runDistillationPipeline = vi.fn().mockResolvedValue(undefined);
    const runner = createMultimodalPipelineRunner({
      store: { scanRunnableSessions },
      orchestrator: {
        runDistillationPipeline,
        runCandidatePipeline: vi.fn(),
        runSkillBuildPipeline: vi.fn(),
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn().mockReturnThis(),
      },
      pollIntervalMs: 5_000,
      batchLimit: 3,
      concurrency: 3,
    });

    await runner.runOnce();

    expect(runDistillationPipeline).toHaveBeenCalledTimes(3);
    expect(runDistillationPipeline).toHaveBeenCalledWith({
      authUserId: 'user-1',
      sessionId: '201',
    });
    expect(runDistillationPipeline).toHaveBeenCalledWith({
      authUserId: 'user-2',
      sessionId: '202',
    });
    expect(runDistillationPipeline).toHaveBeenCalledWith({
      authUserId: 'user-3',
      sessionId: '203',
    });
  });

  it('starts immediately, scans with bounded batches, dispatches by stage, and schedules the next poll with unref', async () => {
    vi.useFakeTimers();
    const unref = vi.fn();
    const scanRunnableSessions = vi
      .fn()
      .mockResolvedValueOnce([
        {
          sessionId: '101',
          authUserId: 'user-1',
          mediaStage: 'extracting_candidates',
        },
        {
          sessionId: '102',
          authUserId: 'user-2',
          mediaStage: 'building_skills',
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValue([]);
    const runCandidatePipeline = vi.fn().mockResolvedValue({
      mediaStage: 'awaiting_candidates',
    });
    const runSkillBuildPipeline = vi.fn().mockResolvedValue({
      mediaStage: 'arena_testing',
    });
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };
    const setTimeoutFn = vi.fn((callback: TimerHandler) => {
      const handle = setTimeout(callback, 0);
      return Object.assign(handle, { unref });
    });

    const runner = createMultimodalPipelineRunner({
      store: {
        scanRunnableSessions,
      },
      orchestrator: {
        runCandidatePipeline,
        runSkillBuildPipeline,
      },
      logger,
      pollIntervalMs: 5_000,
      batchLimit: 2,
      concurrency: 2,
      setTimeoutFn,
    });

    runner.start();
    await Promise.resolve();
    await vi.runOnlyPendingTimersAsync();
    runner.stop();

    expect(scanRunnableSessions).toHaveBeenNthCalledWith(1, { limit: 2 });
    expect(runCandidatePipeline).toHaveBeenCalledWith({
      authUserId: 'user-1',
      sessionId: '101',
    });
    expect(runSkillBuildPipeline).toHaveBeenCalledWith({
      authUserId: 'user-2',
      sessionId: '102',
    });
    const scheduledEntry = logger.debug.mock.calls
      .map(([entry]) => entry)
      .find((entry) => entry?.event === 'multimodal.pipeline.runner.scheduled');
    expect(unref).toHaveBeenCalled();
    expect(scheduledEntry).toEqual({
      event: 'multimodal.pipeline.runner.scheduled',
      pollIntervalMs: 5_000,
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'multimodal.pipeline.runner.session_advanced',
        sessionId: '101',
        previousMediaStage: 'extracting_candidates',
        mediaStage: 'awaiting_candidates',
        durationMs: expect.any(Number),
      }),
      'multimodal.pipeline.runner.session_advanced',
    );
  });

  it('logs a quiet waiting event instead of claiming completion when a worker-backed stage has not advanced', async () => {
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };
    const runner = createMultimodalPipelineRunner({
      store: {
        scanRunnableSessions: vi.fn().mockResolvedValue([{
          sessionId: '204',
          authUserId: 'user-4',
          mediaStage: 'building_evidence',
        }]),
      },
      orchestrator: {
        runDistillationPipeline: vi.fn().mockResolvedValue({
          mediaStage: 'building_evidence',
        }),
        runCandidatePipeline: vi.fn(),
        runSkillBuildPipeline: vi.fn(),
      },
      logger,
      pollIntervalMs: 5_000,
      batchLimit: 1,
      concurrency: 1,
    });

    await runner.runOnce();

    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      {
        event: 'multimodal.pipeline.runner.session_waiting',
        sessionId: '204',
        mediaStage: 'building_evidence',
      },
      'multimodal.pipeline.runner.session_waiting',
    );
  });

  it('avoids runOnce reentry and per-session duplicate dispatch while work is still in flight', async () => {
    let resolveFirstScan: ((value: unknown) => void) | null = null;
    const scanRunnableSessions = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstScan = resolve;
          }),
      )
      .mockResolvedValueOnce([
        {
          sessionId: '101',
          authUserId: 'user-1',
          mediaStage: 'extracting_candidates',
        },
        {
          sessionId: '101',
          authUserId: 'user-1',
          mediaStage: 'extracting_candidates',
        },
      ]);
    let releasePipeline: (() => void) | null = null;
    const runCandidatePipeline = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releasePipeline = resolve;
        }),
    );
    const runner = createMultimodalPipelineRunner({
      store: {
        scanRunnableSessions,
      },
      orchestrator: {
        runCandidatePipeline,
        runSkillBuildPipeline: vi.fn(),
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn().mockReturnThis(),
      },
      pollIntervalMs: 5_000,
      batchLimit: 2,
      concurrency: 1,
    });

    const firstRun = runner.runOnce();
    const secondRun = runner.runOnce();
    expect(secondRun).toBe(firstRun);

    resolveFirstScan?.([]);
    await firstRun;

    const activeRun = runner.runOnce();
    const overlappingRun = runner.runOnce();
    expect(overlappingRun).toBe(activeRun);
    await Promise.resolve();
    expect(runCandidatePipeline).toHaveBeenCalledTimes(1);
    releasePipeline?.();
    await activeRun;
  });

  it('treats stale CAS and invalid-stage races as safe stale work while keeping other sessions moving', async () => {
    const scanRunnableSessions = vi.fn().mockResolvedValue([
      {
        sessionId: '101',
        authUserId: 'user-1',
        mediaStage: 'extracting_candidates',
      },
      {
        sessionId: '102',
        authUserId: 'user-2',
        mediaStage: 'building_skills',
      },
      {
        sessionId: '103',
        authUserId: 'user-3',
        mediaStage: 'validating_candidates',
      },
    ]);
    const runCandidatePipeline = vi
      .fn()
      .mockRejectedValueOnce(
        new GuidedCreationError(
          'SESSION_REVISION_CONFLICT',
          'stale',
          409,
          false,
        ),
      )
      .mockResolvedValueOnce(undefined);
    const runSkillBuildPipeline = vi.fn().mockRejectedValueOnce(
      new GuidedCreationError('INVALID_MEDIA_STAGE', 'stale-stage', 409, false),
    );
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };
    const runner = createMultimodalPipelineRunner({
      store: {
        scanRunnableSessions,
      },
      orchestrator: {
        runCandidatePipeline,
        runSkillBuildPipeline,
      },
      logger,
      pollIntervalMs: 5_000,
      batchLimit: 3,
      concurrency: 2,
    });

    await expect(runner.runOnce()).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'multimodal.pipeline.runner.stale_work',
        code: 'SESSION_REVISION_CONFLICT',
        sessionId: '101',
      }),
      'multimodal.pipeline.runner.stale_work',
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'multimodal.pipeline.runner.stale_work',
        code: 'INVALID_MEDIA_STAGE',
        sessionId: '102',
      }),
      'multimodal.pipeline.runner.stale_work',
    );
    expect(runCandidatePipeline).toHaveBeenNthCalledWith(2, {
      authUserId: 'user-3',
      sessionId: '103',
    });
  });

  it('logs ordinary failures without leaking session materials and stop clears the scheduled timer', async () => {
    vi.useFakeTimers();
    const scanRunnableSessions = vi
      .fn()
      .mockResolvedValueOnce([
        {
          sessionId: '101',
          authUserId: 'user-1',
          mediaStage: 'extracting_candidates',
        },
      ])
      .mockResolvedValueOnce([]);
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };
    const runner = createMultimodalPipelineRunner({
      store: {
        scanRunnableSessions,
      },
      orchestrator: {
        runCandidatePipeline: vi.fn().mockRejectedValue(new Error('secret transcript text')),
        runSkillBuildPipeline: vi.fn(),
      },
      logger,
      pollIntervalMs: 5_000,
      batchLimit: 1,
      concurrency: 1,
    });

    runner.start();
    await vi.runOnlyPendingTimersAsync();
    runner.stop();

    expect(JSON.stringify(logger.error.mock.calls[0]?.[0] ?? {})).not.toContain(
      'secret transcript text',
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'multimodal.pipeline.runner.stopped',
      }),
      'multimodal.pipeline.runner.stopped',
    );
  });

  it('logs stable fields for non-stale guided pipeline failures', async () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };
    const runner = createMultimodalPipelineRunner({
      store: {
        scanRunnableSessions: vi.fn().mockResolvedValue([
          {
            sessionId: '301',
            authUserId: 'user-3',
            mediaStage: 'building_semantic_windows',
          },
        ]),
      },
      orchestrator: {
        runDistillationPipeline: vi.fn().mockRejectedValue(
          new GuidedCreationError(
            'MULTIMODAL_PIPELINE_FAILED',
            'secret transcript text',
            500,
            true,
          ),
        ),
        runCandidatePipeline: vi.fn(),
        runSkillBuildPipeline: vi.fn(),
      },
      logger,
      pollIntervalMs: 5_000,
      batchLimit: 1,
      concurrency: 1,
    });

    await runner.runOnce();

    expect(logger.error).toHaveBeenCalledWith(
      {
        event: 'multimodal.pipeline.runner.session_failed',
        sessionId: '301',
        mediaStage: 'building_semantic_windows',
        errorType: 'GuidedCreationError',
        code: 'MULTIMODAL_PIPELINE_FAILED',
        statusCode: 500,
        retryable: true,
      },
      'multimodal.pipeline.runner.session_failed',
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
      'secret transcript text',
    );
  });

  it('backs off a failed session instead of retrying it on every poll', async () => {
    let now = 1_000;
    const runDistillationPipeline = vi.fn().mockRejectedValue(
      new GuidedCreationError('MULTIMODAL_PIPELINE_FAILED', 'transient failure', 500, true),
    );
    const runner = createMultimodalPipelineRunner({
      store: {
        scanRunnableSessions: vi.fn().mockResolvedValue([
          {
            sessionId: '401',
            authUserId: 'user-4',
            mediaStage: 'building_adler',
          },
        ]),
      },
      orchestrator: {
        runDistillationPipeline,
        runCandidatePipeline: vi.fn(),
        runSkillBuildPipeline: vi.fn(),
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn().mockReturnThis(),
      },
      pollIntervalMs: 3_000,
      batchLimit: 1,
      concurrency: 1,
      nowMs: () => now,
    });

    await runner.runOnce();
    await runner.runOnce();
    expect(runDistillationPipeline).toHaveBeenCalledTimes(1);

    now += 60_000;
    await runner.runOnce();
    expect(runDistillationPipeline).toHaveBeenCalledTimes(2);
  });

  it('swallows scan failures, redacts secrets, and continues polling on the next interval', async () => {
    vi.useFakeTimers();
    const scanRunnableSessions = vi
      .fn()
      .mockRejectedValueOnce(new Error('secret sql and transcript'))
      .mockResolvedValueOnce([
        {
          sessionId: '201',
          authUserId: 'user-2',
          mediaStage: 'validating_candidates',
        },
      ])
      .mockResolvedValue([]);
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };
    const runCandidatePipeline = vi.fn().mockResolvedValue(undefined);
    const runner = createMultimodalPipelineRunner({
      store: {
        scanRunnableSessions,
      },
      orchestrator: {
        runCandidatePipeline,
        runSkillBuildPipeline: vi.fn(),
      },
      logger,
      pollIntervalMs: 5_000,
      batchLimit: 1,
      concurrency: 1,
    });

    runner.start();
    await Promise.resolve();
    await vi.runOnlyPendingTimersAsync();
    runner.stop();

    expect(scanRunnableSessions).toHaveBeenCalledTimes(2);
    expect(runCandidatePipeline).toHaveBeenCalledWith({
      authUserId: 'user-2',
      sessionId: '201',
    });
    expect(logger.error).toHaveBeenCalledWith(
      {
        event: 'multimodal.pipeline.runner.scan_failed',
        errorType: 'Error',
      },
      'multimodal.pipeline.runner.scan_failed',
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('secret sql and transcript');
  });
});
