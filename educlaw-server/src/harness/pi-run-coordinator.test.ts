import { describe, expect, it } from "vitest";
import { PiRunBusyError, PiRunCoordinator } from "./pi-run-coordinator.js";

describe("PiRunCoordinator", () => {
  it("rejects a second run for the same thread until the lease is released", () => {
    const coordinator = new PiRunCoordinator(4);
    const first = coordinator.acquire({ runId: "run-1", threadKey: "user-1:thread-1" });

    expect(() => coordinator.acquire({
      runId: "run-2",
      threadKey: "user-1:thread-1",
    })).toThrowError(expect.objectContaining<PiRunBusyError>({
      code: "RUN_BUSY",
      reason: "thread_busy",
    }));

    first.release();
    expect(() => coordinator.acquire({
      runId: "run-3",
      threadKey: "user-1:thread-1",
    })).not.toThrow();
  });

  it("admits different threads up to the process limit and rejects excess work", () => {
    const coordinator = new PiRunCoordinator(2);
    const first = coordinator.acquire({ runId: "run-1", threadKey: "user-1:thread-1" });
    const second = coordinator.acquire({ runId: "run-2", threadKey: "user-1:thread-2" });

    expect(coordinator.snapshot()).toEqual({ activeRunCount: 2, activeThreadCount: 2 });
    expect(() => coordinator.acquire({
      runId: "run-3",
      threadKey: "user-1:thread-3",
    })).toThrowError(expect.objectContaining<PiRunBusyError>({
      code: "RUN_BUSY",
      reason: "process_capacity",
    }));

    first.release();
    first.release();
    expect(coordinator.snapshot()).toEqual({ activeRunCount: 1, activeThreadCount: 1 });
    second.release();
    expect(coordinator.snapshot()).toEqual({ activeRunCount: 0, activeThreadCount: 0 });
  });
});
