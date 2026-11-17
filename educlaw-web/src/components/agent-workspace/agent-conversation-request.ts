const pendingStorageKey = (agentId: string, purpose: 'run' | 'test') =>
  `skillstudio:pending-conversation:${agentId}:${purpose}`;

export const newRequestId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** 复用未确认的 requestId，避免刷新或重复点击生成两个空对话。 */
export function conversationRequestId(
  agentId: string,
  purpose: 'run' | 'test',
  preferred?: string,
) {
  const key = pendingStorageKey(agentId, purpose);
  try {
    const requestId =
      sessionStorage.getItem(key) || preferred || newRequestId();
    sessionStorage.setItem(key, requestId);
    return requestId;
  } catch {
    return preferred || newRequestId();
  }
}

export function completeConversationRequest(
  agentId: string,
  purpose: 'run' | 'test',
) {
  try {
    sessionStorage.removeItem(pendingStorageKey(agentId, purpose));
  } catch {
    // The in-memory key still prevents duplicate requests when storage is unavailable.
  }
}
