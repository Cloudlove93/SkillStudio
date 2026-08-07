export interface PendingGuidedMessage {
  clientMessageId: string;
  content: string;
  sessionId: string | null;
}

export function createPendingGuidedMessage(
  content: string,
  clientMessageId: string,
  sessionId: string | null,
): PendingGuidedMessage {
  return {
    clientMessageId,
    content,
    sessionId,
  };
}

export function shouldDisplayPendingGuidedMessage(
  pending: PendingGuidedMessage | null,
  visibleSessionId: string | null,
  messages: readonly { client_message_id: string | null }[],
): boolean {
  if (!pending || pending.sessionId !== visibleSessionId) return false;
  return !messages.some(
    (message) => message.client_message_id === pending.clientMessageId,
  );
}
