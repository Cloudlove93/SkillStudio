import type { ArenaRunSnapshot } from '@educlaw/shared';
import type { Response } from 'express';

/** Await one frame's drain; the manager coalesces revisions while we wait. */
export async function writeArenaRunSnapshot(
  res: Response,
  snapshot: ArenaRunSnapshot,
): Promise<void> {
  const writable = res.write(
    `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`,
  );
  (res as Response & { flush?: () => void }).flush?.();
  if (writable) return;
  await new Promise<void>((resolve) => {
    const done = () => {
      res.removeListener('drain', done);
      res.removeListener('close', done);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      res.destroy();
      done();
    }, 15_000);
    res.once('drain', done);
    res.once('close', done);
  });
}
