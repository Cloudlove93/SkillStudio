import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { useChatStore, convertRuntimeMessage, parseSessionInfo } from '../../../stores/chat';
import { useTodoStore } from '../../../stores/todo';
import type { SessionInfo } from '@educlaw/shared';
import { agentRuntimeApi } from '../../../api/runtime';
import { useAgentStore } from '../../../stores/agent';

function parseSessionList(data: unknown): SessionInfo[] {
  const raw = Array.isArray(data) ? data : [];
  return raw.map(parseSessionInfo);
}

function isNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /404|not found/i.test(message);
}

async function removeMissingAgentTab(
  agentId: string,
  fetchAgents: () => Promise<void>,
  missingAgentHandledRef: MutableRefObject<boolean>,
  sessionLoadVer: MutableRefObject<number>,
  msgLoadVer: MutableRefObject<number>,
) {
  if (missingAgentHandledRef.current) return;
  missingAgentHandledRef.current = true;
  sessionLoadVer.current++;
  msgLoadVer.current++;

  try {
    await fetchAgents();
  } catch {
    // Ignore refresh failures and still drop the stale tab below.
  }

  const agents = useAgentStore
    .getState()
    .agents
    .filter((agent) => agent.id !== agentId)
    .map((agent) => ({ id: agent.id, name: agent.name }));

  useChatStore.getState().reconcileAgents(agents);
}

export function useChatSessions(agentId: string, canLoadData: boolean) {
  const sessionId = useChatStore((s) => s.tabs.get(agentId)?.sessionId ?? null);
  const setSessions = useChatStore((s) => s.setSessions);
  const setSessionId = useChatStore((s) => s.setSessionId);
  const setMessages = useChatStore((s) => s.setMessages);
  const startAgent = useAgentStore((s) => s.startAgent);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const api = useMemo(() => agentRuntimeApi(agentId), [agentId]);

  // Version counters: each async load captures the current version; if a newer
  // version exists when the callback resolves, the result is stale and discarded.
  // Auto-incremented inside each effect, and also bumped by user actions to
  // invalidate any pending loads.
  const sessionLoadVer = useRef(0);
  const msgLoadVer = useRef(0);
  const missingAgentHandledRef = useRef(false);

  const [isStartingForSend, setIsStartingForSend] = useState(false);

  /** Bump both version counters so any in-flight load callbacks are discarded. */
  function invalidatePendingLoads() {
    sessionLoadVer.current++;
    msgLoadVer.current++;
  }

  useEffect(() => {
    missingAgentHandledRef.current = false;
  }, [agentId]);

  // Load sessions
  useEffect(() => {
    if (!canLoadData) return;
    const ver = ++sessionLoadVer.current;
    api.listSessions()
      .then((data: unknown) => {
        if (ver !== sessionLoadVer.current) return;

        const sessions = parseSessionList(data);
        setSessions(agentId, sessions);
        const currentSessionId = useChatStore.getState().tabs.get(agentId)?.sessionId;
        if (!currentSessionId || !sessions.some((session) => session.id === currentSessionId)) {
          const active = sessions.filter((session) => !session.archived);
          if (active.length > 0) {
            setSessionId(agentId, active[0].id);
          } else if (sessions.length > 0) {
            setSessionId(agentId, sessions[0].id);
          } else {
            setSessionId(agentId, '');
            const tab = useChatStore.getState().tabs.get(agentId);
            if (!tab?.messages.some((m) => m.id.startsWith('temp-user-'))) {
              setMessages(agentId, []);
            }
          }
        }
      })
      .catch((error: unknown) => {
        if (isNotFoundError(error)) {
          void removeMissingAgentTab(agentId, fetchAgents, missingAgentHandledRef, sessionLoadVer, msgLoadVer);
        }
      });
  }, [canLoadData, agentId, api, fetchAgents, setMessages, setSessionId, setSessions]);

  // Load messages when session changes
  useEffect(() => {
    if (!canLoadData || !sessionId) return;
    const ver = ++msgLoadVer.current;
    api.listMessages(sessionId)
      .then((data: unknown) => {
        if (ver !== msgLoadVer.current) return;
        const tab = useChatStore.getState().tabs.get(agentId);
        if (tab?.messages.some((message) => message.id.startsWith('temp-user-'))) return;
        const raw = Array.isArray(data) ? data : [];
        setMessages(agentId, raw.map(convertRuntimeMessage));
      })
      .catch((error: unknown) => {
        if (isNotFoundError(error)) return;
      });

    api.listTodos(sessionId)
      .then((data: unknown) => {
        const todos = Array.isArray(data) ? data : [];
        if (todos.length > 0) {
          useTodoStore.getState().handleTodoUpdate(agentId, { sessionID: sessionId, todos });
        }
      })
      .catch(() => {});
  }, [canLoadData, sessionId, agentId, api, fetchAgents, setMessages]);

  // Keep-alive: periodically ping the agent while the chat tab is open
  // to prevent the server's idle timeout from stopping the agent process.
  useEffect(() => {
    if (!canLoadData) return;
    const interval = setInterval(() => {
      api.listSessions().catch((error: unknown) => {
        if (isNotFoundError(error)) {
          void removeMissingAgentTab(agentId, fetchAgents, missingAgentHandledRef, sessionLoadVer, msgLoadVer);
        }
      });
    }, 30_000); // every 30s (server idle timeout is 60s)
    return () => clearInterval(interval);
  }, [canLoadData, agentId, api, fetchAgents]);

  async function ensureRunning(): Promise<boolean> {
    const current = useAgentStore.getState().agents.find((agent) => agent.id === agentId);
    if (current?.status === 'running') return true;

    setIsStartingForSend(true);
    invalidatePendingLoads();
    try {
      await startAgent(agentId);
    } finally {
      setIsStartingForSend(false);
    }

    const latest = useAgentStore.getState().agents.find((agent) => agent.id === agentId);
    if (!latest) {
      await removeMissingAgentTab(agentId, fetchAgents, missingAgentHandledRef, sessionLoadVer, msgLoadVer);
      return false;
    }
    if (latest.status !== 'running') return false;

    invalidatePendingLoads();
    try {
      const data = await api.listSessions();
      const existingSessions = parseSessionList(data);
      setSessions(agentId, existingSessions);
      return true;
    } catch (error) {
      if (isNotFoundError(error)) {
        await removeMissingAgentTab(agentId, fetchAgents, missingAgentHandledRef, sessionLoadVer, msgLoadVer);
        return false;
      }
      throw error;
    }
  }

  async function handleCreateSession(agentName?: string) {
    if (!(await ensureRunning())) return;
    const rawSession = await api.createSession(agentName ? { agentName } : undefined);
    const session = parseSessionInfo(rawSession);
    console.log('[chat] createSession response:', rawSession, '-> id:', session.id);
    const currentSessions = useChatStore.getState().tabs.get(agentId)?.sessions ?? [];
    setSessions(agentId, [...currentSessions, session]);
    invalidatePendingLoads();
    setSessionId(agentId, session.id);
    setMessages(agentId, []);
  }

  async function handleDeleteSession(targetId: string) {
    if (!(await ensureRunning())) return;
    useChatStore.getState().markSessionDeleted(agentId, targetId);
    await api.deleteSession(targetId);
    const latestTab = useChatStore.getState().tabs.get(agentId);
    const remaining = (latestTab?.sessions ?? []).filter((session) => session.id !== targetId);
    setSessions(agentId, remaining);
    if ((latestTab?.sessionId ?? sessionId) === targetId) {
      if (remaining.length > 0) {
        setSessionId(agentId, remaining[0].id);
      } else {
        setSessionId(agentId, '');
        setMessages(agentId, []);
      }
    }
  }

  async function handleArchiveSession(targetId: string) {
    if (!(await ensureRunning())) return;
    await api.archiveSession(targetId);
    const latestTab = useChatStore.getState().tabs.get(agentId);
    const updated = (latestTab?.sessions ?? []).map((session) =>
      session.id === targetId ? { ...session, archived: Date.now() } : session,
    );
    setSessions(agentId, updated);
    if ((latestTab?.sessionId ?? sessionId) === targetId) {
      const active = updated.filter((session) => !session.archived);
      if (active.length > 0) {
        setSessionId(agentId, active[0].id);
      } else {
        setSessionId(agentId, '');
        setMessages(agentId, []);
      }
    }
  }

  async function handleUnarchiveSession(targetId: string) {
    if (!(await ensureRunning())) return;
    await api.unarchiveSession(targetId);
    const latestTab = useChatStore.getState().tabs.get(agentId);
    const updated = (latestTab?.sessions ?? []).map((session) =>
      session.id === targetId ? { ...session, archived: undefined } : session,
    );
    setSessions(agentId, updated);
  }

  async function handleRenameSession(targetId: string, title: string) {
    if (!(await ensureRunning())) return;
    await api.renameSession(targetId, title);
    const latestTab = useChatStore.getState().tabs.get(agentId);
    const updated = (latestTab?.sessions ?? []).map((session) =>
      session.id === targetId ? { ...session, title } : session,
    );
    setSessions(agentId, updated);
  }

  return {
    isStartingForSend,
    invalidatePendingLoads,
    ensureRunning,
    handleCreateSession,
    handleDeleteSession,
    handleArchiveSession,
    handleUnarchiveSession,
    handleRenameSession,
  };
}

