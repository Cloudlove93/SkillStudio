# EduClaw Architecture Refactor Plan

This document is the long-term direction document.

For the current stable stop point of the HomeChat/OpenAgent refactor, see:

- [docs/current-chat-architecture.md](/Users/wumengsong/Code/EduClaw/docs/current-chat-architecture.md)

## Goal

This plan keeps the current monorepo shape:

- `openagent`
- `educlaw-web`
- `educlaw-server`
- `educlaw-shared`

But tightens boundaries so the codebase can keep growing without coupling UI state, user resource ownership, transport logic, and infrastructure details together.

The refactor is driven by four goals:

1. Separate `system`, `public`, and `user` resource scopes clearly.
2. Move backend request handlers toward thin route layers plus explicit application services.
3. Unify frontend real-time state flow so SSE and polling share one event path.
4. Reduce frontend main-bundle weight by lazy-loading heavy editor and highlighting dependencies.

## Current Progress Snapshot

The repository has already moved part of the way toward this target architecture.

Completed or materially advanced:

- backend `profiles` use cases extracted into application services
- backend `library` use cases extracted into application services
- backend agent orchestration moved toward application-layer entry points
- frontend `Workspace` and `CodeBlock` heavy dependencies lazily loaded
- `HomeChat` switched from a custom streaming hook to AI SDK transport/runtime primitives
- `openagent` introduced as a separate runtime-oriented package candidate

Current packaging boundary:

- `openagent`
  - framework-agnostic runtime only
  - message conversion helpers
  - AI SDK transport factory
  - suggestions fetch runtime
- `educlaw-web`
  - React hook adapters
  - `HomeChat` UI composition
  - session/model orchestration
- `educlaw-server`
  - chat HTTP routes
  - chat persistence
  - LLM invocation and stream response bridging

Deliberate non-goal at the current stage:

- do not keep splitting `HomeChat` into an all-in-one controller hook if it only hides straightforward page flow
- prefer removing obsolete paths and clarifying boundaries over abstraction for its own sake
- do not force every chat DTO into shared contracts before a second stable caller appears

## Current Pain Points

### Backend

- User-scoped write APIs do not consistently require authentication.
- Some services accept `userId?: string` even for write flows, which weakens ownership boundaries.
- Route handlers combine validation, permission logic, orchestration, filesystem access, and persistence.
- Infrastructure concerns like filesystem, Python scripts, OpenCode proxying, SQLite, and LLM access are directly referenced from business logic.

### Frontend

- Zustand stores call each other directly with `getState()` and `setState()` across domains.
- SSE dispatch and polling fallback each mutate stores independently.
- UI visibility is coupled to agent lifecycle.
- Heavy dependencies like `shiki`, `BlockNote`, and markdown highlighting are eagerly included in common paths.
- Chat runtime responsibilities have improved, but the chat domain is still not represented as a first-class directory boundary.

### Shared Contracts

- `educlaw-shared` is currently useful, but mostly acts as a type export package.
- DTOs, SSE event payloads, and route contracts are not yet modeled as explicit shared protocol definitions.

## Target Architecture

### Backend Layering

Target flow:

`presentation/http -> application -> domain/policy -> infrastructure`

Layer responsibilities:

- `presentation/http`
  - Parse HTTP requests
  - Apply auth middleware
  - Return response codes and DTOs
  - Handle SSE framing and uploads
- `application`
  - Implement use cases
  - Orchestrate repositories, gateways, and domain rules
  - No direct Express dependencies
- `domain/policy`
  - Resource ownership rules
  - Access policies
  - Lifecycle invariants and state transitions
  - Core business terminology
- `infrastructure`
  - File system
  - SQLite and repository implementations
  - Python profile generation bridge
  - OpenCode process/proxy integration
  - LLM provider adapters
  - Logging and audit

### Frontend Layering

Target flow:

`transport -> app event dispatcher -> domain stores -> hooks/components/pages`

Layer responsibilities:

- `transport`
  - HTTP client
  - SSE connection
  - Polling fallback
  - No direct multi-store mutations
- `app event dispatcher`
  - Normalize SSE and polling payloads to one app event format
  - Route events to domain reducers/actions
- `domain stores`
  - Manage only domain state
  - Avoid cross-domain side effects
- `hooks/components/pages`
  - Render and trigger intent
  - Avoid owning orchestration logic when possible

## Resource Scope Model

This model should be introduced explicitly in both server and shared contracts.

### Resource Scopes

- `system`
  - Built-in templates and preset resources
- `public`
  - Published profiles, skills, and tools
- `user`
  - Private resources belonging to a specific user

### Scope Rules

- `system`
  - readable by all
  - writable only by system-maintained flows
- `public`
  - readable by all
  - publish/unpublish only by owner
- `user`
  - readable and writable only by owner

### Required Policy Helpers

- `canReadProfile(userId, profileOwnerId, source)`
- `canEditProfile(userId, profileOwnerId)`
- `canPublishProfile(userId, profileOwnerId)`
- `canReadAgent(userId, agent)`
- `canManageAgent(userId, agent)`
- `resolveResourceScope(...)`

## Target Directory Sketch

### Root

```text
EduClaw/
  docs/
  educlaw-server/
  educlaw-shared/
  educlaw-web/
  data/
```

### Backend

```text
educlaw-server/src/
  app/
    bootstrap/
      register-routes.ts
      create-server.ts
      create-sse-channel.ts
  application/
    agents/
      agent-application-service.ts
      agent-lifecycle-service.ts
      dto.ts
    profiles/
      profile-application-service.ts
      dto.ts
    chat/
      chat-application-service.ts
      chat-prompt-factory.ts
      dto.ts
    diary/
      diary-application-service.ts
    library/
      skill-application-service.ts
      tool-application-service.ts
    auth/
      auth-application-service.ts
  domain/
    agents/
      agent-policy.ts
      agent-types.ts
    profiles/
      profile-policy.ts
      profile-types.ts
    auth/
      access-policy.ts
      user-scope.ts
    common/
      result.ts
      errors.ts
  infrastructure/
    db/
      user-db-repository.ts
      chat-repository.ts
      diary-repository.ts
    fs/
      profile-fs-repository.ts
      skill-fs-repository.ts
      tool-fs-repository.ts
      workspace-fs-service.ts
    llm/
      llm-model-registry.ts
      openai-chat-gateway.ts
    opencode/
      opencode-process-manager.ts
      opencode-proxy-client.ts
      opencode-event-adapter.ts
    scripts/
      profile-script-runner.ts
    logging/
      llm-audit-logger.ts
      chat-audit-logger.ts
  presentation/
    http/
      middleware/
        require-auth.ts
        require-admin.ts
        error-handler.ts
      routes/
        auth-routes.ts
        agent-routes.ts
        chat-routes.ts
        diary-routes.ts
        library-routes.ts
        admin-routes.ts
        event-routes.ts
      sse/
        sse-writer.ts
  index.ts
```

### Frontend

```text
educlaw-web/src/
  app/
    router/
    providers/
    boot/
  domains/
    agent/
      api/
      store/
      hooks/
      components/
      types/
    chat/
      api/
      store/
      events/
      hooks/
      components/
      types/
    diary/
      api/
      store/
      components/
    library/
      api/
      store/
      components/
    auth/
      api/
      store/
      hooks/
    workspace/
      store/
      components/
  hooks/
    useEduclawAgentChat.ts
    useHomeChatModels.ts
    useHomeChatSessionLifecycle.ts
  components/
    home/
      HomeChat.tsx
      HomeChatHeader.tsx
      HomeChatConversation.tsx
      HomeChatInput.tsx
      HomeChatMessages.tsx
      HomeChatActions.tsx
```

### OpenAgent Runtime Package

```text
openagent/
  src/
    index.ts
    messages.ts
    runtime.ts
    types.ts
```

Package intent:

- `messages.ts`
  - text extraction
  - legacy message conversion
- `runtime.ts`
  - request context resolution
  - AI SDK transport creation
  - suggestions fetching
- `types.ts`
  - shared runtime-facing message and context types

Recommended import policy for host apps:

- prefer `@openagent/core/messages`
- prefer `@openagent/core/runtime`
- prefer `@openagent/core/types`
- keep root `@openagent/core` only as a convenience entry, not the primary integration contract

## Next Sensible Steps

Highest-value follow-up steps from the current repo state:

1. Add lightweight tests around `application/chat` ownership and side effects
2. Add lightweight package-level examples or tests for `openagent`
3. Keep deleting obsolete transport/runtime code paths after each migration step
4. Move web chat files toward a `domains/chat` boundary only when adjacent chat concerns accumulate further

### Shared Contracts

```text
educlaw-shared/
  contracts/
    agents.ts
    chat.ts
    diary.ts
    library.ts
    auth.ts
    events.ts
  domain/
    resource-scope.ts
    agent-status.ts
  index.ts
```

## Module Responsibility Table

### Backend Modules

| Module | Responsibility | Must Not Do |
| --- | --- | --- |
| `presentation/http/routes/*` | Parse request, call application service, shape response | Access filesystem directly, contain business rules |
| `presentation/http/middleware/*` | Auth, admin check, error shaping | Execute use cases |
| `application/agents/*` | Create/start/stop/delete agents, orchestrate sync | Know Express or raw route details |
| `application/profiles/*` | Create/update/delete/publish profiles | Read `req`, `res` or write files directly without repository abstraction |
| `application/chat/*` | Stream home chat, save messages, update titles, summarize to diary | Embed transport-specific response piping logic |
| `application/library/*` | User/public skill and tool CRUD | Decide auth by itself without policy |
| `domain/auth/*` | Ownership and access rules | Touch DB or FS |
| `domain/agents/*` | Agent lifecycle and visibility rules | Call OpenCode processes directly |
| `infrastructure/db/*` | Persist users, sessions, diaries, chat messages | Contain ownership policy |
| `infrastructure/fs/*` | Read and write profile/skill/tool/workspace files safely | Know HTTP or route semantics |
| `infrastructure/llm/*` | Model lookup and provider calls | Store request objects or mutate business state |
| `infrastructure/opencode/*` | Process and proxy integration | Implement UI-facing orchestration |

### Frontend Modules

| Module | Responsibility | Must Not Do |
| --- | --- | --- |
| `domains/*/api` | Call backend endpoints | Mutate multiple stores directly |
| `domains/chat/events` | Convert transport payloads to normalized app events | Contain UI rendering logic |
| `domains/*/store` | Manage only domain state and domain actions | Reach into unrelated stores for side effects |
| `domains/workspace/controllers` | Handle cross-domain UI orchestration | Own transport implementation |
| `shared/state/app-event-dispatcher` | Dispatch normalized events into stores/actions | Fetch data directly from UI components |
| `pages/*` | Compose screens from domain components | Own persistence and lifecycle rules |
| `shared/ui/*` | Reusable presentational primitives | Depend on business state |

## Recommended Frontend Domain Split

### `agent` domain

Owns:

- agent list
- agent status
- agent create/start/stop/remove/toggle-public actions

Does not own:

- chat sessions
- open file viewer state
- question/todo overlays

### `chat` domain

Owns:

- tabs
- sessions
- messages
- streaming state
- chat event reducer

Does not own:

- whether the workspace main view is visible
- whether an agent process should be stopped when UI changes

### `interaction` domain

Recommended new domain for:

- pending permissions
- pending questions
- todo updates

This keeps those overlays from being spread between transport and chat state.

### `workspace` domain

Owns:

- current main view
- currently open file path
- deep-study active tab
- layout state

This is where cross-domain UI composition belongs.

## Real-Time Event Architecture

### Problem

SSE and polling each directly mutate stores today.

### Target

Both should emit the same normalized event type.

Example:

```ts
type AppEvent =
  | { type: 'chat/messageUpdated'; agentId: string; payload: unknown }
  | { type: 'chat/messageRemoved'; agentId: string; payload: unknown }
  | { type: 'chat/messageDelta'; agentId: string; payload: unknown }
  | { type: 'chat/sessionUpdated'; agentId: string; payload: unknown }
  | { type: 'chat/sessionStatus'; agentId: string; payload: unknown }
  | { type: 'interaction/questionAsked'; agentId: string; payload: unknown }
  | { type: 'interaction/questionResolved'; agentId: string; payload: unknown }
  | { type: 'interaction/permissionAsked'; agentId: string; payload: unknown }
  | { type: 'interaction/permissionResolved'; agentId: string; payload: unknown }
  | { type: 'interaction/todoUpdated'; agentId: string; payload: unknown }
  | { type: 'workspace/filesChanged'; agentId: string };
```

Then:

- `sse-client.ts` maps raw server payloads to `AppEvent`
- `polling-client.ts` maps polled payloads to `AppEvent`
- `dispatchAppEvent(event)` routes to domain actions

That removes duplicate mutation logic.

## Lifecycle Policy Changes

Current behavior ties chat visibility to process shutdown. That should be replaced by a more explicit lifecycle policy.

Recommended policies:

- `manual-only`
- `stop-when-tab-closed`
- `stop-when-idle`
- `leave-running`

Recommended default:

- `stop-when-tab-closed`

Not recommended:

- stopping agents simply because the user switched workspace panels

## Shared Contract Evolution

`educlaw-shared` should evolve from a pure type export package to a protocol contract package.

Recommended additions:

- route DTOs
- SSE event DTOs
- enum-like constants for event names and resource scopes
- optional runtime validation schemas later

Suggested first contract groups:

- `contracts/chat.ts`
- `contracts/agents.ts`
- `contracts/events.ts`
- `contracts/library.ts`
- `contracts/auth.ts`

## Incremental Refactor Phases

### Phase 1: Auth and Resource Boundary Hardening

Goals:

- Require auth for all user-scoped write APIs
- Remove optional `userId` from write-path service signatures
- Introduce policy helpers for owner/public/system access

Expected touched areas:

- `educlaw-server/src/routes/agent.ts`
- `educlaw-server/src/routes/llm.ts`
- `educlaw-server/src/services/profile-service.ts`
- related skill/tool service entry points

### Phase 2: Backend Application Service Extraction

Goals:

- Move orchestration from routes into application services
- Keep route files thin
- Wrap filesystem, Python script, and LLM integrations behind infrastructure modules

Priority order:

1. profiles
2. agents
3. chat
4. library

### Phase 3: Frontend Event Pipeline Unification

Goals:

- Normalize SSE and polling events
- Add `dispatchAppEvent`
- Remove direct multi-store mutations from transport layer
- Reduce store-to-store coupling

Priority order:

1. chat message/session events
2. permissions/questions/todos
3. file refresh signals

### Phase 4: Lifecycle Decoupling

Goals:

- Move agent shutdown policy out of page components
- Introduce workspace controller or application action for cross-domain behavior

### Phase 5: Bundle and Rendering Optimization

Goals:

- Lazy-load `BlockNote`
- Lazy-load `shiki`
- Reduce duplicated syntax-highlight paths
- Split deep-study, diary, and workflow code by route or panel

## First Concrete Refactor Targets

These are the most effective first implementation targets.

### Backend first targets

1. Add `requireAuth` to all `/profiles/user/*`, `/llm/skills/user/*`, and `/llm/tools/user/*` write routes.
2. Change profile write services to require non-optional `userId`.
3. Add policy helpers for readable vs writable resources.

### Frontend first targets

1. Extract an `app-event-dispatcher`.
2. Make SSE and polling produce the same `AppEvent`.
3. Stop transport files from touching more than one domain entry point.

## Definition of Done

The refactor should be considered structurally successful when:

- no user-scoped write flow accepts anonymous access
- route handlers are thin and mostly declarative
- SSE and polling share one event normalization path
- chat store no longer directly controls agent process lifecycle
- heavy editor/highlight dependencies are not eagerly loaded into the main bundle
- shared contracts clearly define API and event payloads

## Implementation Notes

- This plan intentionally avoids a big-bang rewrite.
- The repo should remain shippable after each phase.
- Phase 1 and Phase 2 can be completed incrementally by feature area.
- Frontend state refactor should start only after backend ownership boundaries are made explicit, otherwise transport and resource rules will keep shifting underneath the UI.
- If a proposed change mainly increases indirection without adding a new stable caller or test seam, stop and keep the simpler structure.
