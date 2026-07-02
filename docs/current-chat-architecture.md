# Current Chat Architecture

## Purpose

This document describes the **current stable boundary** for the HomeChat and OpenAgent refactor work.

It is intentionally different from the long-term refactor plan:

- this document explains what is already true in the repo
- it also explains where we should **stop for now**
- it tries to prevent further abstraction when the payoff is low

If this document conflicts with the older roadmap document, prefer this one when making near-term code organization decisions.

## Stable Boundary

The current chat stack is split into four layers:

1. `openagent`
2. `educlaw-web`
3. `educlaw-server`
4. `educlaw-shared`

### `openagent`

Location:

- [openagent/src/index.ts](/Users/wumengsong/Code/EduClaw/openagent/src/index.ts)
- [openagent/src/messages.ts](/Users/wumengsong/Code/EduClaw/openagent/src/messages.ts)
- [openagent/src/runtime.ts](/Users/wumengsong/Code/EduClaw/openagent/src/runtime.ts)
- [openagent/src/types.ts](/Users/wumengsong/Code/EduClaw/openagent/src/types.ts)

Responsibility:

- message normalization helpers
- text extraction
- legacy message conversion
- AI SDK transport creation
- runtime request context injection
- suggestions fetch runtime

Must not own:

- React hooks
- UI components
- visual message rendering
- EduClaw-specific store wiring
- session title rules
- diary save flows

Import policy:

- prefer `@openagent/core/messages`
- prefer `@openagent/core/runtime`
- prefer `@openagent/core/types`
- treat root `@openagent/core` as convenience only

### `educlaw-web`

Relevant files:

- [educlaw-web/src/hooks/useEduclawAgentChat.ts](/Users/wumengsong/Code/EduClaw/educlaw-web/src/hooks/useEduclawAgentChat.ts)
- [educlaw-web/src/hooks/useHomeChatModels.ts](/Users/wumengsong/Code/EduClaw/educlaw-web/src/hooks/useHomeChatModels.ts)
- [educlaw-web/src/hooks/useHomeChatSessionLifecycle.ts](/Users/wumengsong/Code/EduClaw/educlaw-web/src/hooks/useHomeChatSessionLifecycle.ts)
- [educlaw-web/src/components/home/HomeChat.tsx](/Users/wumengsong/Code/EduClaw/educlaw-web/src/components/home/HomeChat.tsx)
- [educlaw-web/src/components/home/HomeChatHeader.tsx](/Users/wumengsong/Code/EduClaw/educlaw-web/src/components/home/HomeChatHeader.tsx)
- [educlaw-web/src/components/home/HomeChatConversation.tsx](/Users/wumengsong/Code/EduClaw/educlaw-web/src/components/home/HomeChatConversation.tsx)

Responsibility:

- React adapter around `@openagent/core`
- model selection and session lifecycle wiring
- HomeChat UI composition
- diary and deep-study action entry points

Must not own:

- low-level transport protocol details
- LLM request formatting logic
- server-side ownership rules

Important current choice:

- `HomeChat` has been split enough to be maintainable
- do **not** continue splitting it into a single mega controller hook unless a real reuse case appears

Good current shape:

- small dedicated hooks for model loading and session lifecycle
- small UI subcomponents for header and conversation area
- page component still shows the main flow clearly

### `educlaw-server`

Relevant files:

- [educlaw-server/src/routes/chat.ts](/Users/wumengsong/Code/EduClaw/educlaw-server/src/routes/chat.ts)
- [educlaw-server/src/application/chat/chat-application-service.ts](/Users/wumengsong/Code/EduClaw/educlaw-server/src/application/chat/chat-application-service.ts)
- [educlaw-server/src/application/chat/chat-message-utils.ts](/Users/wumengsong/Code/EduClaw/educlaw-server/src/application/chat/chat-message-utils.ts)
- [educlaw-server/src/application/chat/chat-prompt-factory.ts](/Users/wumengsong/Code/EduClaw/educlaw-server/src/application/chat/chat-prompt-factory.ts)
- [educlaw-server/src/services/chat-service.ts](/Users/wumengsong/Code/EduClaw/educlaw-server/src/services/chat-service.ts)

Current server-side flow:

`route -> application/chat -> services/chat-service`

Responsibility split:

- route
  - parse request
  - perform HTTP response handling
  - stream AI SDK response back to client
- application/chat
  - enforce owned-session checks
  - orchestrate chat persistence
  - orchestrate session title update
  - orchestrate audit logging
  - orchestrate diary save behavior
- chat-service
  - resolve model config
  - build AI SDK requests
  - return runtime results and metadata

Important current choice:

- keep `chat-service` focused on runtime/model invocation
- keep persistence and side effects in `application/chat`
- do not explode this into many tiny service classes unless another chat product path appears

### `educlaw-shared`

Relevant files:

- [educlaw-shared/types/chat.ts](/Users/wumengsong/Code/EduClaw/educlaw-shared/types/chat.ts)
- [educlaw-shared/index.ts](/Users/wumengsong/Code/EduClaw/educlaw-shared/index.ts)

Current shared contract scope:

- generic chat message/session types already used elsewhere
- HomeChat session/message DTOs
- HomeChat create/update inputs
- HomeChat summarize result shape

Rule of thumb:

- put stable cross-boundary DTOs here
- do not move every internal application input/output here by default

## What We Explicitly Removed

The following path has been retired and should not be reintroduced:

- [educlaw-web/src/hooks/useHomeChatStream.ts](/Users/wumengsong/Code/EduClaw/educlaw-web/src/hooks/useHomeChatStream.ts)

Reason:

- it represented the old custom streaming path
- it duplicated responsibilities now handled by `@openagent/core` plus the web adapter layer

## Stop Line For This Phase

At the current stage, the architecture work should pause before these moves:

- introducing a giant `useHomeChatController`
- pushing every chat request and response shape into `@educlaw/shared`
- splitting server chat code into many micro-services with no second caller
- moving `HomeChat` files into a full `domains/chat` tree before adjacent chat features justify it

Those moves are not forbidden forever. They are simply not worth the complexity yet.

## When Further Refactor Becomes Worth It

Continue abstracting only if one of these becomes true:

- another product besides EduClaw needs the same chat UI adapter logic
- another server entry point needs to reuse HomeChat application use cases
- another frontend surface begins sharing the same HomeChat store/actions
- request/response contracts start drifting between server and web in multiple places
- tests become hard to write because logic is still trapped in broad modules

If none of those are true, prefer small cleanup over new layers.

## Practical Guidance

When touching this area next time:

1. Prefer deleting obsolete paths over creating new indirection.
2. Prefer stable boundary docs over speculative directory reshuffles.
3. Prefer extracting pure helpers before extracting more orchestrators.
4. If a proposed refactor only makes files thinner but hides the main flow, do not do it.

## Related Docs

- [openagent/README.md](openagent/README.md)
