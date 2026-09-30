# Answer Optimization Suggestions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the answer-optimization composer with the main workspace, make the source answer collapsible, and provide three AI-generated improvement prompts with a safe fallback.

**Architecture:** Add a focused POST suggestion endpoint that validates answer-run ownership and loads trusted question/answer messages before calling the LLM. Keep suggestion parsing and fallback normalization in a small pure module. The React panel requests suggestions on selection changes and treats the feature as optional UI assistance.

**Tech Stack:** TypeScript, Express, React 19, Vitest, existing `generateJson` LLM helper, existing CSS theme variables.

---

### Task 1: Suggestion contract and normalization

**Files:**
- Modify: `educlaw-shared/index.ts`
- Create: `educlaw-server/src/services/answer-optimization-suggestions.ts`
- Test: `educlaw-server/src/services/answer-optimization-suggestions.test.ts`

- [ ] Write tests proving that exactly three short, non-empty suggestions are returned and malformed model output falls back to the three approved education suggestions.
- [ ] Run `pnpm --filter educlaw-server exec vitest run src/services/answer-optimization-suggestions.test.ts` and verify the missing module/exports fail.
- [ ] Add the `SUGGESTIONS` POST route constant, input/result types, prompt builder, strict normalizer and fallback list.
- [ ] Re-run the test and verify it passes.

### Task 2: Trusted server endpoint

**Files:**
- Create: `educlaw-server/src/services/answer-optimization-suggestion-service.ts`
- Modify: `educlaw-server/src/routes/answer-skill-optimizations.ts`
- Test: `educlaw-server/src/routes/answer-skill-optimizations.test.ts`

- [ ] Add a failing route test for authenticated POST input and a validation test for unexpected or invalid fields.
- [ ] Run `pnpm --filter educlaw-server exec vitest run src/routes/answer-skill-optimizations.test.ts -t "suggestions"` and verify a 404/failing assertion.
- [ ] Implement ownership/provenance validation through the recorded answer run, load trusted question and answer text, call `generateJson` once with the education quality dimensions, and return normalized suggestions.
- [ ] Map upstream failure to the fallback result instead of failing the request; keep authentication and safe envelopes consistent with existing routes.
- [ ] Re-run the route and service tests.

### Task 3: Frontend API and optional suggestion state

**Files:**
- Modify: `educlaw-web/src/api/answer-skill-optimizations.ts`
- Modify: `educlaw-web/src/components/skill-workspace/SkillAnswerOptimizationPanel.tsx`
- Test: `educlaw-web/src/components/skill-workspace/skill-workspace-ui.test.ts`

- [ ] Add failing source-contract assertions for the API call, selection-keyed loading, fallback handling, three suggestion buttons and click-to-fill behavior.
- [ ] Run `pnpm --filter educlaw-web exec vitest run src/components/skill-workspace/skill-workspace-ui.test.ts -t "answer optimization"` and verify the new assertions fail.
- [ ] Add `answerSkillOptimizationApi.suggestions()` and request it whenever the selected answer changes.
- [ ] Ignore stale responses through the existing request counter and use the shared fallback suggestions when the request fails.
- [ ] Render at most three light suggestion buttons; clicking calls `setFeedbackDraft(suggestion)` and never starts optimization.

### Task 4: Collapsible answer and composer parity

**Files:**
- Modify: `educlaw-web/src/components/skill-workspace/SkillAnswerOptimizationPanel.tsx`
- Modify: `educlaw-web/src/components/skill-workspace/skill-workspace.css`
- Test: `educlaw-web/src/components/skill-workspace/skill-workspace-ui.test.ts`

- [ ] Add failing assertions for a native accessible `<details>` answer preview, the exact placeholder `说说希望这条回答怎么改进`, removal of footer helper text, and absence of optimization-specific composer height/font overrides.
- [ ] Run the targeted test and verify it fails for those reasons.
- [ ] Replace the source-answer block with a collapsed `<details>` summary and full Skill answer body.
- [ ] Remove `.skill-answer-optimization-footer-status` text and composer size overrides so the shared `.skill-test-composer` rules apply unchanged.
- [ ] Keep test/save actions in a separate compact row only after an optimization draft exists.
- [ ] Re-run targeted frontend tests and TypeScript.

### Task 5: Verification and local rebuild

**Files:**
- Verify all files above.

- [ ] Run targeted server and frontend tests.
- [ ] Run targeted ESLint and both TypeScript builds.
- [ ] Run production builds and record any pre-existing unrelated failures separately.
- [ ] Rebuild the local Docker services with `docker compose up -d --build educlaw-web educlaw-server`.
- [ ] Verify `http://eduskill.localhost/login` returns HTTP 200 and the served bundle contains the new placeholder and suggestion UI.
- [ ] Leave implementation uncommitted for user visual review.
