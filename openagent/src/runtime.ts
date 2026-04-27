import { DefaultChatTransport } from 'ai';
import { toLegacyOpenAgentMessages } from './messages.js';
import type { OpenAgentMessage } from './types.js';

export type ResolvableValue<T> = T | (() => T | Promise<T>);

export interface OpenAgentRequestContext {
  headers?: HeadersInit;
  body?: Record<string, unknown>;
  credentials?: RequestCredentials;
}

export interface OpenAgentRuntimeContext {
  model?: string;
  sessionId?: string;
  request?: OpenAgentRequestContext;
}

export interface CreateOpenAgentTransportOptions {
  api: string;
  getContext?: ResolvableValue<OpenAgentRuntimeContext>;
}

export interface FetchOpenAgentSuggestionsOptions {
  api: string;
  messages: OpenAgentMessage[];
  getContext?: ResolvableValue<OpenAgentRuntimeContext>;
}

async function resolveValue<T>(value: ResolvableValue<T> | undefined): Promise<T | undefined> {
  if (typeof value === 'function') {
    return (value as () => T | Promise<T>)();
  }
  return value;
}

export async function resolveOpenAgentRuntimeContext(
  getContext?: ResolvableValue<OpenAgentRuntimeContext>,
): Promise<OpenAgentRuntimeContext | undefined> {
  return resolveValue(getContext);
}

export function createOpenAgentTransport({
  api,
  getContext,
}: CreateOpenAgentTransportOptions): DefaultChatTransport<OpenAgentMessage> {
  return new DefaultChatTransport<OpenAgentMessage>({
    api,
    prepareSendMessagesRequest: async ({ messages, headers, credentials, api: requestApi }) => {
      const context = await resolveOpenAgentRuntimeContext(getContext);
      return {
        api: requestApi,
        headers: {
          ...headers,
          ...(context?.request?.headers ?? {}),
        },
        credentials: context?.request?.credentials ?? credentials,
        body: {
          messages,
          ...(context?.request?.body ?? {}),
          ...(context?.sessionId ? { sessionId: context.sessionId } : {}),
          ...(context?.model ? { model: context.model } : {}),
        },
      };
    },
    prepareReconnectToStreamRequest: async ({ headers, credentials, api: requestApi }) => {
      const context = await resolveOpenAgentRuntimeContext(getContext);
      return {
        api: requestApi,
        headers: {
          ...headers,
          ...(context?.request?.headers ?? {}),
        },
        credentials: context?.request?.credentials ?? credentials,
      };
    },
  });
}

export async function fetchOpenAgentSuggestions({
  api,
  messages,
  getContext,
}: FetchOpenAgentSuggestionsOptions): Promise<string[]> {
  const context = await resolveOpenAgentRuntimeContext(getContext);
  const response = await fetch(api, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(context?.request?.headers ?? {}),
    },
    credentials: context?.request?.credentials,
    body: JSON.stringify({
      ...(context?.request?.body ?? {}),
      ...(context?.sessionId ? { sessionId: context.sessionId } : {}),
      messages: toLegacyOpenAgentMessages(messages).map(({ role, content }) => ({ role, content })),
    }),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const payload = await response.json();
  return Array.isArray(payload) ? payload : [];
}
