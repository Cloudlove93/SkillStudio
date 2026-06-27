import { useChatStore } from '../stores/chat';
import { useUIStore } from '../stores/ui';
import { useTodoStore } from '../stores/todo';
import { getToken, API_BASE } from './client';
import { startPolling, stopPolling } from '../services/polling-transport';

let eventSource: EventSource | null = null;

// ── SSE failure detection ───────────────────────────────────

const SSE_GRACE_MS = 6_000;

function fallbackToPolling() {
  if (!eventSource) return; // already disconnected
  console.warn('[SSE] Unavailable, switching to polling fallback');
  eventSource.close();
  eventSource = null;
  startPolling();
}

export function connectSSE() {
  if (eventSource) return;

  const token = getToken();
  eventSource = new EventSource(`${API_BASE}/events${token ? `?token=${encodeURIComponent(token)}` : ''}`);

  // Only criterion: if readyState is not OPEN after grace period, fall back.
  // This avoids false positives from transient onerror events during connection.
  const graceTimer = setTimeout(() => {
    if (eventSource && eventSource.readyState !== EventSource.OPEN) {
      fallbackToPolling();
    }
  }, SSE_GRACE_MS);

  eventSource.onopen = () => {
    clearTimeout(graceTimer);
  };

  eventSource.onmessage = (e) => {
    clearTimeout(graceTimer);
    try {
      const payload = JSON.parse(e.data);
      dispatch(payload);
    } catch {
      // ignore
    }
  };

  eventSource.onerror = () => {
    // Don't act here — let the grace timer handle failure detection.
    // EventSource auto-reconnects on transient errors.
  };
}

export function restorePendingQuestions() {
  void 0;
}

export function disconnectSSE() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  stopPolling();
}

function dispatch(payload: { agentId: string; event: string; data: Record<string, unknown> }) {
  const { agentId, event, data } = payload;
  // Log non-delta events to help diagnose SSE connectivity
  if (event !== 'message.part.delta') {
    console.log(`[SSE:dispatch] agent=${agentId} event=${event}`);
  }
  const chat = useChatStore.getState();

  switch (event) {
    case 'message.updated':
      chat.handleMessageUpdate(agentId, data);
      break;
    case 'message.removed':
      chat.handleMessageRemoved(agentId, data);
      break;
    case 'message.part.updated': {
      chat.handleMessagePartUpdate(agentId, data);
      const part = ((data.part as Record<string, unknown> | undefined) ?? data) as Record<string, unknown>;
      const state = part.state as { status?: string } | undefined;
      if (part.type === 'tool' && (state?.status === 'completed' || state?.status === 'error')) {
        useUIStore.getState().triggerFileRefresh(agentId);
      }
      break;
    }
    case 'message.part.removed':
      chat.handleMessagePartRemoved(agentId, data);
      break;
    case 'message.part.delta':
      chat.handleMessagePartDelta(agentId, data);
      break;
    case 'session.created':
    case 'session.updated':
      chat.handleSessionUpdate(agentId, data);
      break;
    case 'session.status':
      chat.handleSessionStatus(agentId, data);
      break;
    case 'session.idle':
      chat.setStreaming(agentId, false);
      break;
    case 'permission.asked':
    case 'permission.created': {
      const permissionId = String(data.id ?? data.requestID ?? '');
      if (!permissionId) break;
      useInteractionQueueStore.getState().addPermission({
        ...(data as Record<string, unknown>),
        id: permissionId,
        agentId,
        toolName: typeof data.permission === 'string' ? data.permission : typeof data.toolName === 'string' ? data.toolName : 'unknown',
      });
      break;
    }
    case 'permission.replied':
    case 'permission.completed':
      useInteractionQueueStore.getState().removePermission(String(data.requestID ?? data.id ?? ''));
      break;
    case 'question.asked':
      useInteractionQueueStore.getState().addQuestion({ ...(data as unknown as QuestionRequest), agentId });
      break;
    case 'question.replied':
    case 'question.rejected':
      useInteractionQueueStore.getState().removeQuestion(String(data.requestID ?? data.id ?? ''));
      break;
    case 'todo.updated':
      useTodoStore.getState().handleTodoUpdate(agentId, data);
      break;
    case 'files.changed':
      useUIStore.getState().triggerFileRefresh(agentId);
      break;
  }
}
