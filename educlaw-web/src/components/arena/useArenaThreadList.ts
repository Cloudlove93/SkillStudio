import { useCallback, useEffect, useRef, useState } from 'react';
import type { ArenaThread, ArenaThreadDetail } from '@educlaw/shared';
import { liteApi } from '../../api/lite-api';

export interface UseArenaThreadListResult {
  threads: ArenaThread[];
  currentThreadId: string | null;
  loading: boolean;
  error: string;
  refresh: (packageId: string) => Promise<void>;
  switchThread: (threadId: string) => Promise<void>;
  notifyCreated: (thread: ArenaThread, detail: ArenaThreadDetail) => void;
  setCurrentThreadId: (id: string | null) => void;
}

interface UseArenaThreadListOptions {
  token: string;
  packageId: string;
  onThreadSwitched: (thread: ArenaThread, detail: ArenaThreadDetail) => void;
}

/**
 * Arena 线程历史列表 hook：负责拉取线程列表、切换当前线程、新建后通知刷新。
 * 不维护 thread/detail 的状态本身，仅负责列表与切换，切换结果通过 onThreadSwitched 回调上抛。
 */
export function useArenaThreadList({
  token,
  packageId,
  onThreadSwitched,
}: UseArenaThreadListOptions): UseArenaThreadListResult {
  const [threads, setThreads] = useState<ArenaThread[]>([]);
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestIdRef = useRef(0);

  const refresh = useCallback(
    async (pkgId: string) => {
      if (!token || !pkgId) return;
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setLoading(true);
      setError('');
      try {
        const list = await liteApi.listThreads(token, pkgId);
        if (requestIdRef.current !== requestId) return;
        setThreads(list);
      } catch (err) {
        if (requestIdRef.current !== requestId) return;
        setError(err instanceof Error ? err.message : '加载线程列表失败');
      } finally {
        if (requestIdRef.current === requestId) {
          setLoading(false);
        }
      }
    },
    [token],
  );

  const switchThread = useCallback(
    async (threadId: string) => {
      if (!token || !threadId) return;
      try {
        const detail = await liteApi.getThread(token, threadId);
        const thread = threads.find((t) => String(t.id) === threadId);
        if (!thread) return;
        setCurrentThreadId(threadId);
        onThreadSwitched(thread, detail);
      } catch (err) {
        setError(err instanceof Error ? err.message : '切换线程失败');
      }
    },
    [token, threads, onThreadSwitched],
  );

  const notifyCreated = useCallback(
    (thread: ArenaThread) => {
      setThreads((prev) => {
        const exists = prev.some((t) => t.id === thread.id);
        if (exists) {
          return prev.map((t) => (t.id === thread.id ? thread : t));
        }
        return [thread, ...prev];
      });
      setCurrentThreadId(String(thread.id));
    },
    [],
  );

  useEffect(() => {
    if (!packageId) {
      setThreads([]);
      setCurrentThreadId(null);
      return;
    }
    void refresh(packageId);
  }, [packageId, refresh]);

  return {
    threads,
    currentThreadId,
    loading,
    error,
    refresh,
    switchThread,
    notifyCreated,
    setCurrentThreadId,
  };
}
