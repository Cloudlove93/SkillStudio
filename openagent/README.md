# OpenAgent Core

Framework-agnostic runtime primitives for building OpenAgent-powered chat experiences.

This package intentionally excludes UI concerns. It focuses on:

- message types and text extraction
- transport creation for AI SDK chat flows
- request context injection
- follow-up suggestion fetching

## Scope

This package does not provide React hooks or UI components.

Typical layering:

1. `@openagent/core`: runtime, transport, protocol helpers
2. app-specific adapter: React/Vue/Svelte hooks
3. app-specific UI

## Package Boundaries

`@openagent/core` should remain portable across products. Keep product concerns outside this package:

- React hooks
- component state orchestration
- visual message rendering
- product-specific auth/session stores

Typical ownership split:

- package: message normalization, transport creation, request context, suggestions fetching
- app adapter: `useChat(...)` wiring, model/session state composition
- app UI: chat panels, message bubbles, action buttons

## Recommended Imports

Prefer subpath imports in host apps so the dependency boundary stays explicit:

```ts
import { fromLegacyOpenAgentMessages } from '@openagent/core/messages';
import { createOpenAgentTransport } from '@openagent/core/runtime';
import type { OpenAgentMessage } from '@openagent/core/types';
```

The root entry `@openagent/core` is kept as a convenience re-export, but subpaths are the better long-term contract for reusable integrations.

## Usage

### 1. Create a transport

```ts
import { createOpenAgentTransport } from '@openagent/core/runtime';

const transport = createOpenAgentTransport({
  api: '/api/chat',
  getContext: () => ({
    sessionId: 'session-123',
    model: 'gpt-5.1',
    request: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  }),
});
```

### 2. Convert legacy messages

```ts
import {
  fromLegacyOpenAgentMessages,
  toLegacyOpenAgentMessages,
} from '@openagent/core/messages';

const messages = fromLegacyOpenAgentMessages([
  { id: '1', role: 'user', content: 'Hello' },
]);

const legacyMessages = toLegacyOpenAgentMessages(messages);
```

### 3. Fetch follow-up suggestions

```ts
import { fetchOpenAgentSuggestions } from '@openagent/core/runtime';

const suggestions = await fetchOpenAgentSuggestions({
  api: '/api/chat/suggestions',
  messages,
  getContext: () => ({
    sessionId: 'session-123',
  }),
});
```

### 4. Add a React adapter outside the package

```ts
import { useChat } from '@ai-sdk/react';
import { createOpenAgentTransport } from '@openagent/core/runtime';

export function useProductChat(id: string) {
  return useChat({
    id,
    transport: createOpenAgentTransport({
      api: '/api/chat',
      getContext: () => ({
        sessionId: id,
      }),
    }),
  });
}
```

That React hook belongs in the product workspace, not in `@openagent/core`.

## Exports

- `@openagent/core`
- `@openagent/core/messages`
- `@openagent/core/runtime`
- `@openagent/core/types`
