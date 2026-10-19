interface ShutdownDependencies {
  beginDrain(): void;
  stopBackground(): void;
  waitForIdle(): Promise<void>;
  abortActive(): void;
  closeHttp(): Promise<void>;
  forceCloseHttp(): void;
  closeResources(): Promise<void>;
  exit(code: number): void;
  log(event: string): void;
  drainMs?: number;
  cancelMs?: number;
  closeMs?: number;
}

async function bounded(work: Promise<void>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work.then(() => true, () => false),
      new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), ms); }),
    ]);
  } finally { clearTimeout(timer); }
}

/** One process-local drain, shared by SIGTERM/SIGINT. No cross-process recovery. */
export function createServerShutdown(deps: ShutdownDependencies): () => Promise<void> {
  let pending: Promise<void> | undefined;
  return () => pending ??= (async () => {
    try {
      deps.beginDrain();
      deps.stopBackground();
      deps.log('shutdown.draining');
      const idle = deps.waitForIdle();
      let settled = await bounded(idle, deps.drainMs ?? 30_000);
      if (!settled) {
        deps.abortActive();
        deps.log('shutdown.aborting');
        settled = await bounded(idle, deps.cancelMs ?? 5_000);
      }
      if (!settled) { deps.log('shutdown.unconfirmed'); deps.forceCloseHttp(); }
      // One shared final budget: HTTP ends, handler promises settle, then DB closes.
      // A forced socket close alone never proves business work has ended.
      const deadline=Date.now()+(deps.closeMs??5_000);
      const remaining=()=>Math.max(0,deadline-Date.now());
      const httpClosed=await bounded(deps.closeHttp(),remaining());
      const businessEnded=httpClosed&&await bounded(deps.waitForIdle(),remaining());
      const resourcesClosed=businessEnded&&await bounded(deps.closeResources(),remaining());
      const closed=httpClosed&&businessEnded&&resourcesClosed;
      if (!closed) { deps.log('shutdown.cleanup_unconfirmed'); deps.forceCloseHttp(); }
      deps.log(settled && closed ? 'shutdown.complete' : 'shutdown.incomplete');
      deps.exit(settled && closed ? 0 : 1);
    } catch {
      deps.log('shutdown.failed');
      deps.exit(1);
    }
  })();
}
