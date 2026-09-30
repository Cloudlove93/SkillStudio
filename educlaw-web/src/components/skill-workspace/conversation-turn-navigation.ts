export interface ConversationTurnMessage {
  id: string;
  role: string;
  content: string;
}

export interface ConversationTurn {
  id: string;
  label: string;
}

export function collectConversationTurns(
  messages: readonly ConversationTurnMessage[],
): ConversationTurn[] {
  return messages
    .filter((message) => message.role === 'user')
    .map((message, index) => ({
      id: `guided-turn-${message.id}`,
      label: message.content.trim() || `第 ${index + 1} 次提问`,
    }));
}

export function findActiveConversationTurn(
  turnOffsets: readonly number[],
  scrollTop: number,
  viewportHeight: number,
): number {
  if (turnOffsets.length === 0) return -1;
  const readingThreshold = scrollTop + Math.min(96, viewportHeight * 0.24);
  let activeIndex = 0;
  for (let index = 0; index < turnOffsets.length; index += 1) {
    if (turnOffsets[index] > readingThreshold) break;
    activeIndex = index;
  }
  return activeIndex;
}
