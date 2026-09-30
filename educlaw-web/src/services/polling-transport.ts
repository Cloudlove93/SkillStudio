/**
 * Polling Transport — fallback for environments where SSE is unavailable.
 *
 * Polls REST endpoints for messages, questions, permissions, and session status,
 * then updates the same stores that SSE events would.
 */
import { useChatStore } from '../stores/chat';
import { useInteractionQueueStore, type QuestionRequest } from '../stores/interaction-queue';
import { useTodoStore } from '../stores/todo';
import { useUIStore } from '../stores/ui';
import { agentRuntimeApi } from '../api/runtime';
import { convertRuntimeMessage } from '../lib/message-converter';

// ── Intervals (ms) ──────────────────────────────────────────

const INTERVAL_QUESTIONS_ACTIVE = 1000;
const INTERVAL_QUESTIONS_IDLE = 3000;
const INTERVAL_MESSAGES_ACTIVE = 2000;
const INTERVAL_MESSAGES_IDLE = 5000;
const INTERVAL_SESSION_ACTIVE = 3000;
const INTERVAL_SESSION_IDLE = 10000;

// ── State ───────────────────────────────────────────────────

let active = false;
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const lastMessageIds = new Map<string, string[]>();
const knownQuestionIds = new Set<string>();

// ── Scheduling helper ───────────────────────────────────────

function schedule(key: string, fn: () => Promise<void>, getInterval: () => number) {
  if (!active) return;
  timers.set(key, setTimeout(async () => {
    if (!active) return;
    try { await fn(); } catch { /* ignore, retry next tick */ }
    schedule(key, fn, getInterval);
  }, getInterval()));
}

function clearAll() {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
}

// ── Resolve active tabs ─────────────────────────────────────

function getActiveTabs(): { agentId: string; sessionId: string; isStreaming: boolean }[] {
  const { tabs } = useChatStore.getState();
  const result: { agentId: string; sessionId: string; isStreaming: boolean }[] = [];
  for (const [agentId, tab] of tabs) {
    if (tab.sessionId) {
      result.push({ agentId, sessionId: tab.sessionId, isStreaming: tab.isStreaming });
    }
  }
  return result;
}

// ── Poll: Questions & Permissions ───────────────────────────

async function pollQuestions() {
  const tabs = getActiveTabs();
  const store = useInteractionQueueStore.getState();

  for (const { agentId } of tabs) {
    try {
      const questions = await agentRuntimeApi(agentId).listQuestions() as unknown;
      const list = (Array.isArray(questions) ? questions : (typeof questions === 'object' && questions !== null && 'data' in questions ? (questions as { data?: unknown }).data : [])) as QuestionRequest[];
      const currentIds = new Set<string>();

      for (const q of list) {
        if (!q?.id) continue;
        currentIds.add(q.id);
        if (!knownQuestionIds.has(q.id)) {
          knownQuestionIds.add(q.id);
          store.addQuestion({ ...(q as QuestionRequest), agentId });
        }
      }

      // Remove questions that disappeared (answered/rejected)
      for (const id of knownQuestionIds) {
        if (!currentIds.has(id)) {
          knownQuestionIds.delete(id);
          store.removeQuestion(id);
        }
      }
    } catch { /* agent may not be running */ }
  }
}

// ── Poll: Messages ──────────────────────────────────────────

async function pollMessages() {
  const tabs = getActiveTabs();
  const chat = useChatStore.getState();

  for (const { agentId, sessionId } of tabs) {
    const tab = chat.tabs.get(agentId);
    if (!tab) continue;

    try {
      const rawMessages = await agentRuntimeApi(agentId).listMessages(sessionId) as unknown;
      if (!Array.isArray(rawMessages)) continue;

      const converted = rawMessages.map((message) => convertRuntimeMessage(message as Record<string, unknown>));
      const key = `${agentId}:${sessionId}`;

      // If there's a temp optimistic message, replace it with the real user message
      // from the server if available, otherwise keep it
      const hasTempMsg = tab.messages.some((m) => m.id.startsWith('temp-user-'));
      if (hasTempMsg && converted.length === 0) continue; // server hasn't processed yet

      const newIds = converted.map((m) => m.id);
      const prevIds = lastMessageIds.get(key);

      // Only update if messages actually changed
      if (!prevIds || newIds.length !== prevIds.length || newIds.some((id, i) => id !== prevIds[i])) {
        lastMessageIds.set(key, newIds);
        chat.setMessages(agentId, converted);

        // If new messages appeared, trigger file refresh
        if (prevIds && newIds.length > prevIds.length) {
          useUIStore.getState().triggerFileRefresh(agentId);
        }
      }
    } catch { /* ignore */ }
  }
}

// ── Poll: Session status ────────────────────────────────────

async function pollSessionStatus() {
  const tabs = getActiveTabs();
  const chat = useChatStore.getState();

  for (const { agentId, sessionId } of tabs) {
    try {
      const session = await agentRuntimeApi(agentId).getSession(sessionId) as Record<string, unknown> | null;
      if (!session) continue;

      chat.handleSessionUpdate(agentId, session);

      const status = ((session.status as { type?: string } | undefined)
        ?? ((session.info as { status?: { type?: string } } | undefined)?.status));
      if (status) {
        const isBusy = status.type === 'busy' || status.type === 'running';
        chat.setStreaming(agentId, isBusy);
      }
    } catch { /* ignore */ }
  }
}

// ── Poll: Todos ─────────────────────────────────────────────

async function pollTodos() {
  const tabs = getActiveTabs();

  for (const { agentId, sessionId } of tabs) {
    try {
      const data = await agentRuntimeApi(agentId).listTodos(sessionId) as unknown;
      const todos = Array.isArray(data) ? data : [];
      useTodoStore.getState().handleTodoUpdate(agentId, { sessionID: sessionId, todos });
    } catch { /* ignore */ }
  }
}

// ── Public API ──────────────────────────────────────────────

export function startPolling() {
  if (active) return;
  active = true;
  console.log('[Polling] SSE unavailable, starting polling fallback');

  const isAnyStreaming = () => getActiveTabs().some((t) => t.isStreaming);

  schedule('questions', pollQuestions, () =>
    isAnyStreaming() ? INTERVAL_QUESTIONS_ACTIVE : INTERVAL_QUESTIONS_IDLE,
  );
  schedule('messages', pollMessages, () =>
    isAnyStreaming() ? INTERVAL_MESSAGES_ACTIVE : INTERVAL_MESSAGES_IDLE,
  );
  schedule('session', pollSessionStatus, () =>
    isAnyStreaming() ? INTERVAL_SESSION_ACTIVE : INTERVAL_SESSION_IDLE,
  );
  schedule('todos', pollTodos, () =>
    isAnyStreaming() ? INTERVAL_SESSION_ACTIVE : INTERVAL_SESSION_IDLE,
  );
}

export function stopPolling() {
  active = false;
  clearAll();
  lastMessageIds.clear();
  knownQuestionIds.clear();
}
