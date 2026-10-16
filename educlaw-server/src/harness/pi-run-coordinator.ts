const DEFAULT_MAX_CONCURRENT_RUNS = 4;

export type PiRunBusyReason = "thread_busy" | "process_capacity";

export class PiRunBusyError extends Error {
  readonly code = "RUN_BUSY";

  constructor(readonly reason: PiRunBusyReason) {
    super(
      reason === "thread_busy"
        ? "当前对话已有运行中的任务，请等待完成后重试。"
        : "当前运行任务较多，请稍后重试。",
    );
    this.name = "PiRunBusyError";
  }
}

export interface PiRunLease {
  readonly runId: string;
  readonly threadKey: string;
  release(): void;
}

export class PiRunCoordinator {
  private readonly activeRunIds = new Set<string>();
  private readonly activeThreadKeys = new Set<string>();
  private readonly maxConcurrentRuns: number;

  constructor(maxConcurrentRuns = DEFAULT_MAX_CONCURRENT_RUNS) {
    this.maxConcurrentRuns = Number.isSafeInteger(maxConcurrentRuns)
      && maxConcurrentRuns > 0
      ? maxConcurrentRuns
      : DEFAULT_MAX_CONCURRENT_RUNS;
  }

  acquire(input: { runId: string; threadKey: string }): PiRunLease {
    if (this.activeThreadKeys.has(input.threadKey)) {
      throw new PiRunBusyError("thread_busy");
    }
    if (this.activeRunIds.size >= this.maxConcurrentRuns) {
      throw new PiRunBusyError("process_capacity");
    }

    this.activeRunIds.add(input.runId);
    this.activeThreadKeys.add(input.threadKey);
    let released = false;
    return {
      runId: input.runId,
      threadKey: input.threadKey,
      release: () => {
        if (released) return;
        released = true;
        this.activeRunIds.delete(input.runId);
        this.activeThreadKeys.delete(input.threadKey);
      },
    };
  }

  snapshot(): { activeRunCount: number; activeThreadCount: number } {
    return {
      activeRunCount: this.activeRunIds.size,
      activeThreadCount: this.activeThreadKeys.size,
    };
  }
}

