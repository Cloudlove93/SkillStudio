// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useSkillAnswerRerun } from './use-skill-answer-rerun';
import type { AnswerOptimizationSelection } from './answer-optimization-selection';
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
it('keeps an async optimization rerun from navigating back after switching Skills', async () => {
  let resolve!: () => void;
  const pending = new Promise<void>((r) => {
    resolve = r;
  });
  const reload = vi.fn(() => pending),
    ready = vi.fn();
  let rerun!: ReturnType<typeof useSkillAnswerRerun>;
  const root = createRoot(document.createElement('div'));
  function Probe({ skillKey }: { skillKey: string }) {
    rerun = useSkillAnswerRerun('t', skillKey, reload, ready);
    return null;
  }
  try {
    await act(async () => root.render(<Probe skillKey="7:11" />));
    const old = rerun;
    const selection = {
      packageId: 7,
      origin: 'run',
    } as AnswerOptimizationSelection;
    let work!: Promise<void>;
    await act(async () => {
      work = rerun(3, selection);
    });
    await act(async () => root.render(<Probe skillKey="7:12" />));
    await act(async () => {
      resolve();
      await work;
      await old(3, selection);
    });
    expect(ready).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
    await act(async () => rerun(4, selection));
    expect(ready).toHaveBeenCalledWith(4, selection);
  } finally {
    await act(async () => root.unmount());
  }
});
