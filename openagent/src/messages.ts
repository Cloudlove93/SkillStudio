import type { OpenAgentLegacyMessage, OpenAgentMessage } from './types.js';

function getTextPartText(part: unknown): string {
  if (!part || typeof part !== 'object') return '';
  const candidate = part as { type?: string; text?: string };
  if (candidate.type !== 'text') return '';
  return typeof candidate.text === 'string' ? candidate.text : '';
}

export function getOpenAgentMessageText(message: Pick<OpenAgentMessage, 'parts'>): string {
  return message.parts.map(getTextPartText).join('');
}

export function createOpenAgentTextMessage(message: OpenAgentLegacyMessage): OpenAgentMessage {
  return {
    id: message.id,
    role: message.role,
    parts: [{ type: 'text', text: message.content }],
  };
}

export function fromLegacyOpenAgentMessages(messages: OpenAgentLegacyMessage[]): OpenAgentMessage[] {
  return messages.map(createOpenAgentTextMessage);
}

export function toLegacyOpenAgentMessages(messages: OpenAgentMessage[]): OpenAgentLegacyMessage[] {
  return messages
    .filter((message): message is OpenAgentMessage & { role: 'user' | 'assistant' } =>
      message.role === 'user' || message.role === 'assistant',
    )
    .map((message) => ({
      id: message.id,
      role: message.role,
      content: getOpenAgentMessageText(message),
    }));
}
