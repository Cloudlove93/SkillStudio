export type ProgressState = {
  title: string;
  phase: string;
  steps: string[];
  startedAt: number;
  endedAt?: number;
  active: boolean;
  isError: boolean;
};

export function startProgressState(
  title: string,
  phase: string,
  now = Date.now(),
): ProgressState {
  return {
    title,
    phase,
    steps: [phase],
    startedAt: now,
    active: true,
    isError: false,
  };
}

export function pushProgressStep(
  progress: ProgressState | null,
  label: string,
  now = Date.now(),
): ProgressState {
  if (!progress) return startProgressState('\u5f53\u524d\u8fdb\u5ea6', label, now);
  return {
    ...progress,
    phase: label,
    steps:
      progress.steps[progress.steps.length - 1] === label
        ? progress.steps
        : [...progress.steps, label],
  };
}

export function completeProgress(
  progress: ProgressState | null,
  label: string,
  now = Date.now(),
): ProgressState | null {
  if (!progress) return null;
  return {
    ...progress,
    active: false,
    isError: false,
    endedAt: now,
    phase: label,
    steps:
      progress.steps[progress.steps.length - 1] === label
        ? progress.steps
        : [...progress.steps, label],
  };
}

export function failProgressState(
  progress: ProgressState | null,
  label: string,
  now = Date.now(),
): ProgressState | null {
  if (!progress) return null;
  return {
    ...progress,
    active: false,
    isError: true,
    endedAt: now,
    phase: label,
    steps:
      progress.steps[progress.steps.length - 1] === label
        ? progress.steps
        : [...progress.steps, label],
  };
}

export function getProgressElapsedMs(
  progress: ProgressState,
  now = Date.now(),
): number {
  return Math.max(
    0,
    (progress.active ? now : progress.endedAt || now) - progress.startedAt,
  );
}
