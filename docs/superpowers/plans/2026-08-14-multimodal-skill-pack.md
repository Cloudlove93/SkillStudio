# Multimodal Skill Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an evidence-grounded multimodal Skill Pack pipeline that turns video and document sources into reviewed, versioned, testable Skills with visual assets and Arena provenance.

**Architecture:** Keep TypeScript/PostgreSQL as the control plane and existing Package/Skill Version records as the publication target. Add immutable S3-compatible assets, a lease-driven Python media worker, a typed Skill Pack compiler, three human review gates, and Pack-level runtime evaluation. The authoritative design is `docs/superpowers/specs/2026-08-14-multimodal-skill-pack-design.md`.

**Tech Stack:** TypeScript 5.9, Express 5, PostgreSQL, React 19, Vitest, Python 3.12, FastAPI worker internals, ffmpeg, faster-whisper, S3/MinIO, OpenAI-compatible Kimi K2.5 multimodal API.

---

## File map

### Shared contracts

- Modify `educlaw-shared/index.ts`: Skill Pack, Evidence, Asset, SSE, test and Package Skill asset types.
- Modify `educlaw-shared/index.ts`: add `SKILL_PACK_ROUTES` beside the existing `PACKAGE_ROUTES` and `ARENA_ROUTES` constants.

### Server control plane

- Modify `educlaw-server/src/config.ts`: object store, worker, model and feature-flag configuration.
- Modify `educlaw-server/src/services/db-schema.ts`: new Pack, Asset, Evidence, Job and Test tables.
- Modify `educlaw-server/src/services/llm-service.ts`: multimodal message parts and JSON generation.
- Modify `educlaw-server/src/services/package-service.ts`: `distilled` source and versioned asset manifest publication.
- Modify `educlaw-server/src/services/skill-version-service.ts`: include sorted asset hashes in version identity.
- Modify `educlaw-server/src/services/arena-service.ts`: load relevant evidence and record answer evidence provenance.
- Create `educlaw-server/src/services/blob-store.ts`: storage interface and local/S3 implementations.
- Create `educlaw-server/src/services/skill-pack-service.ts`: Pack CRUD, ownership and revision logic.
- Create `educlaw-server/src/services/media-job-service.ts`: PostgreSQL lease queue.
- Create `educlaw-server/src/services/skill-evidence-service.ts`: evidence validation and lookup.
- Create `educlaw-server/src/services/multimodal-analysis-service.ts`: text baseline and visual enrichment.
- Create `educlaw-server/src/services/skill-pack-compiler.ts`: Overview, extractors, verification, RIA++, relations and test generation.
- Create `educlaw-server/src/services/skill-pack-publish-service.ts`: atomic publication.
- Create `educlaw-server/src/services/skill-pack-test-service.ts`: Pack route and execution tests.
- Create `educlaw-server/src/routes/skill-packs.ts`: REST binary and read endpoints.
- Create `educlaw-server/src/routes/skill-pack-actions.ts`: action/SSE orchestration.

### Python worker

- Create `educlaw-media-worker/pyproject.toml`.
- Create `educlaw-media-worker/app/config.py`.
- Create `educlaw-media-worker/app/client.py`.
- Create `educlaw-media-worker/app/downloader.py`.
- Create `educlaw-media-worker/app/transcriber.py`.
- Create `educlaw-media-worker/app/frame_extractor.py`.
- Create `educlaw-media-worker/app/document_extractor.py`.
- Create `educlaw-media-worker/app/worker.py`.
- Create focused pytest files under `educlaw-media-worker/tests/`.

### Web

- Modify `educlaw-web/src/api/lite-api.ts`: Pack API and SSE clients.
- Modify `educlaw-web/src/components/skill-workspace/SkillWorkspaceSidebar.tsx`: creation entry and Pack tree.
- Modify `educlaw-web/src/pages/SkillFirstWorkspace.tsx`: Pack workspace routing.
- Create `educlaw-web/src/components/skill-workspace/SkillPackWorkspace.tsx`.
- Create stage components under `educlaw-web/src/components/skill-workspace/skill-pack/`.
- Modify `educlaw-web/src/components/skill-workspace/skill-workspace.css`.
- Extend `educlaw-web/src/components/skill-workspace/skill-workspace-ui.test.ts`.

## Milestone 1: Asset and evidence foundation

### Task 1: Shared contracts and backwards-compatible Package Skill assets

**Files:**
- Modify: `educlaw-shared/index.ts`
- Test: `educlaw-server/src/services/package-service.generate.test.ts`
- Test: `educlaw-server/src/services/skill-version-service.test.ts`

- [ ] **Step 1: Write failing compatibility tests**

Add tests proving that a legacy `PackageSkill` without `assets` still loads and that asset order does not change the calculated version identity.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --filter educlaw-server exec vitest run src/services/package-service.generate.test.ts src/services/skill-version-service.test.ts
```

Expected: FAIL because `distilled` and asset-aware identity are not implemented.

- [ ] **Step 3: Add shared contracts**

Add these exact unions and fields:

```ts
export type SkillAssetRole =
  | "visual_evidence"
  | "source_excerpt"
  | "reference"
  | "executable_asset";

export interface SkillAssetManifestEntry {
  id: string;
  path: string;
  role: SkillAssetRole;
  mimeType: string;
  sha256: string;
  size: number;
}

export interface PackageSkill {
  id: string;
  dirName: string;
  name: string;
  description: string;
  skillMd: string;
  assets?: SkillAssetManifestEntry[];
}
```

Extend `PackageVersion.source` with `"distilled"` and add the Pack/Evidence types defined in the design document.

- [ ] **Step 4: Normalize legacy assets**

At every snapshot boundary use `skill.assets ?? []`; never mutate stored legacy JSON.

- [ ] **Step 5: Run shared and targeted tests**

```bash
pnpm --filter @educlaw/shared build
pnpm --filter educlaw-server exec vitest run src/services/package-service.generate.test.ts src/services/skill-version-service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add educlaw-shared/index.ts educlaw-server/src/services/package-service.generate.test.ts educlaw-server/src/services/skill-version-service.test.ts
git commit -m "feat: add multimodal skill asset contracts"
```

### Task 2: Database schema for Packs, assets, evidence and tests

**Files:**
- Modify: `educlaw-server/src/services/db-schema.ts`
- Modify: `educlaw-server/src/services/db-schema.test.ts`

- [ ] **Step 1: Add failing schema assertions**

Assert all tables, ownership indexes, foreign keys, status checks, unique idempotency constraints and `distilled` source check exist.

- [ ] **Step 2: Verify failure**

```bash
pnpm --filter educlaw-server exec vitest run src/services/db-schema.test.ts
```

Expected: FAIL on missing `skill_packs`.

- [ ] **Step 3: Add schema statements**

Implement the tables from sections 7.1–7.11 of the design. Enforce JSON object/array checks, `(id, pack_id)` composite uniqueness where child foreign keys need ownership safety, and indexes on `(user_id, updated_at)`, `(pack_id, status)`, `(run_id, artifact_type)` and `(skill_version_id, role)`.

- [ ] **Step 4: Extend the Skill Version source constraint**

Replace the existing source check with:

```sql
check (source in ('generated','imported','optimized','manual','interactive','rollback','distilled'))
```

Use a named constraint replacement block so existing databases are upgraded idempotently.

- [ ] **Step 5: Run schema tests and build**

```bash
pnpm --filter educlaw-server exec vitest run src/services/db-schema.test.ts
pnpm --filter educlaw-server build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add educlaw-server/src/services/db-schema.ts educlaw-server/src/services/db-schema.test.ts
git commit -m "feat: add skill pack and evidence schema"
```

### Task 3: Immutable blob storage

**Files:**
- Modify: `educlaw-server/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `educlaw-server/src/config.ts`
- Modify: `educlaw-server/src/config.test.ts`
- Create: `educlaw-server/src/services/blob-store.ts`
- Create: `educlaw-server/src/services/blob-store.test.ts`

- [ ] **Step 1: Write failing storage contract tests**

Test `put`, `head`, `getSignedReadUrl`, `createSignedUpload`, content-addressed key construction and path traversal rejection. Test both an in-memory fake and LocalBlobStore.

- [ ] **Step 2: Verify failure**

```bash
pnpm --filter educlaw-server exec vitest run src/services/blob-store.test.ts src/config.test.ts
```

- [ ] **Step 3: Add configuration**

Add the environment variables from design section 18 and validate that production S3 configuration is complete when `BLOB_STORE_DRIVER=s3`.

- [ ] **Step 4: Implement the interface**

```ts
export interface BlobStore {
  createSignedUpload(input: { key: string; mimeType: string; size: number }): Promise<{ url: string; headers: Record<string, string> }>;
  head(key: string): Promise<{ size: number; mimeType: string; sha256?: string }>;
  getSignedReadUrl(key: string, expiresSeconds: number): Promise<string>;
  delete(key: string): Promise<void>;
}
```

Object keys must be generated server-side as `users/<userId>/skill-packs/<packId>/<sha256>/<safeName>`.

- [ ] **Step 5: Implement S3 and local drivers**

Use `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` for S3/MinIO. LocalBlobStore must resolve paths and reject targets outside `BLOB_LOCAL_ROOT`.

- [ ] **Step 6: Run tests**

```bash
pnpm --filter educlaw-server exec vitest run src/services/blob-store.test.ts src/config.test.ts
pnpm --filter educlaw-server build
```

- [ ] **Step 7: Commit**

```bash
git add educlaw-server/package.json pnpm-lock.yaml educlaw-server/src/config.ts educlaw-server/src/config.test.ts educlaw-server/src/services/blob-store.ts educlaw-server/src/services/blob-store.test.ts
git commit -m "feat: add immutable blob storage"
```

### Task 4: Pack CRUD, revision and upload intents

**Files:**
- Create: `educlaw-server/src/services/skill-pack-service.ts`
- Create: `educlaw-server/src/services/skill-pack-service.test.ts`
- Create: `educlaw-server/src/routes/skill-packs.ts`
- Create: `educlaw-server/src/routes/skill-packs.test.ts`
- Modify: `educlaw-server/src/index.ts`

- [ ] Write failing tests for ownership, optimistic revision, create/list/detail/rename/delete, upload intent, upload completion and URL assets.
- [ ] Run `pnpm --filter educlaw-server exec vitest run src/services/skill-pack-service.test.ts src/routes/skill-packs.test.ts` and verify missing modules fail.
- [ ] Implement Pack CRUD with every mutation using `where id = $1 and user_id = $2 and revision_no = $3` and incrementing `revision_no` exactly once.
- [ ] Implement direct upload intent and completion. Completion must HEAD the object, compare expected size/type/hash metadata, insert `skill_pack_assets`, and enqueue `media_ingest` using the same transaction.
- [ ] Reject MIME types outside the approved video/audio/document/image allowlist and reject URL sources that are not HTTP(S).
- [ ] Run route/service tests and `pnpm --filter educlaw-server build`.
- [ ] Commit with `git commit -m "feat: add skill pack source management"`.

## Milestone 2: Media evidence pipeline

### Task 5: PostgreSQL lease queue

**Files:**
- Create: `educlaw-server/src/services/media-job-service.ts`
- Create: `educlaw-server/src/services/media-job-service.test.ts`
- Create: `educlaw-server/src/routes/internal-media-jobs.ts`
- Create: `educlaw-server/src/routes/internal-media-jobs.test.ts`
- Modify: `educlaw-server/src/index.ts`

- [ ] Write tests for atomic claim, lease expiry, heartbeat, success, retryable failure, terminal failure, cancellation and internal-token authentication.
- [ ] Verify tests fail because the service and route do not exist.
- [ ] Implement claim using `for update skip locked`, setting `lease_owner`, `lease_expires_at` and incrementing `attempt_count` in one transaction.
- [ ] Implement heartbeat guarded by job id, worker id and unexpired lease.
- [ ] Implement exponential retry times of 5, 30 and 120 seconds, then terminal failure after the configured maximum.
- [ ] Run targeted tests and build.
- [ ] Commit with `git commit -m "feat: add leased media job queue"`.

### Task 6: Python media worker skeleton and transcription

**Files:**
- Create: `educlaw-media-worker/pyproject.toml`
- Create: `educlaw-media-worker/app/__init__.py`
- Create: `educlaw-media-worker/app/config.py`
- Create: `educlaw-media-worker/app/client.py`
- Create: `educlaw-media-worker/app/transcriber.py`
- Create: `educlaw-media-worker/app/worker.py`
- Create: `educlaw-media-worker/tests/test_client.py`
- Create: `educlaw-media-worker/tests/test_transcriber.py`

- [ ] Write tests for claim/heartbeat/complete requests, cached transcription identity and JSON/TXT/SRT outputs.
- [ ] Run `python -m pytest educlaw-media-worker/tests -q` and verify imports fail.
- [ ] Implement the internal client with bearer token, bounded timeouts and no media payload logging.
- [ ] Implement Faster Whisper transcription with VAD, timestamped segments and cache identity `{audio_sha256, model, language, transcriber_version}`.
- [ ] Implement worker lifecycle: claim, heartbeat thread, download signed input, process in a temporary directory, upload derived artifacts, report manifest, clean temporary files.
- [ ] Run pytest and verify all tests pass.
- [ ] Preserve MIT attribution for any code adapted from the reference branch.
- [ ] Commit with `git commit -m "feat: add media worker transcription"`.

### Task 7: Keyframes and document extraction

**Files:**
- Create: `educlaw-media-worker/app/frame_extractor.py`
- Create: `educlaw-media-worker/app/document_extractor.py`
- Create: `educlaw-media-worker/tests/test_frame_extractor.py`
- Create: `educlaw-media-worker/tests/test_document_extractor.py`

- [ ] Write deterministic tests for transcript cues, scene changes, periodic sampling, spacing, max-frame limits and frame manifest IDs.
- [ ] Write PDF/DOCX tests proving page text, rendered page images, embedded image metadata and page locators are emitted.
- [ ] Run targeted pytest and verify failures.
- [ ] Implement first-pass frame planning with priority `transcript_cue`, `scene_change`, `periodic`, maximum 20 frames, 3-second de-duplication and 960-pixel output width.
- [ ] Implement document extraction that never invents page numbers and stores rendered pages as derived assets.
- [ ] Run pytest and an ffmpeg smoke test.
- [ ] Commit with `git commit -m "feat: extract multimodal source evidence"`.

### Task 8: Evidence ingestion and validation

**Files:**
- Create: `educlaw-server/src/services/skill-evidence-service.ts`
- Create: `educlaw-server/src/services/skill-evidence-service.test.ts`
- Modify: `educlaw-server/src/services/media-job-service.ts`

- [ ] Write failing tests for transcript/page/frame Evidence creation, invalid locators, duplicate evidence hashes, model-observed versus inferred claims and asset ownership.
- [ ] Verify the tests fail.
- [ ] Implement manifest ingestion in one transaction. Validate frame IDs against the worker frame manifest and page numbers against the document manifest.
- [ ] Store transcript/OCR as `source_explicit`, visual observations as `model_observed`, and never promote `model_inferred` automatically.
- [ ] Update the Pack from `processing_sources` to `overview_review` only after every active source has a completed manifest.
- [ ] Run tests and build.
- [ ] Commit with `git commit -m "feat: persist multimodal evidence units"`.

## Milestone 3: Multimodal analysis and Skill Pack compiler

### Task 9: Multimodal LLM support and capability probe

**Files:**
- Modify: `educlaw-server/src/services/llm-service.ts`
- Modify: `educlaw-server/src/services/llm-service.test.ts`
- Create: `educlaw-server/src/services/multimodal-analysis-service.ts`
- Create: `educlaw-server/src/services/multimodal-analysis-service.test.ts`

- [ ] Add failing tests for mixed text/image content, redacted logging, strict JSON parsing, Kimi K2.5 request shape, image count/byte limits and invalid evidence ID filtering.
- [ ] Run targeted tests and verify type and assertion failures.
- [ ] Change `ChatMessage.content` to `string | ChatContentPart[]`, where content parts are `text` or `image_url`; update log size calculation without logging URLs or base64.
- [ ] Add `generateMultimodalJson<T>()` using the same retry/repair behavior as `generateJson`.
- [ ] Add a startup/on-demand probe that sends one known image and requires a known JSON observation; cache the capability result for the process lifetime.
- [ ] Implement text baseline followed by visual enrichment in batches of at most three images, with nearby transcript and server-side evidence ID whitelist.
- [ ] Run tests and build.
- [ ] Commit with `git commit -m "feat: add Kimi multimodal analysis"`.

### Task 10: Source Overview and three review gates

**Files:**
- Create: `educlaw-server/src/services/skill-pack-compiler.ts`
- Create: `educlaw-server/src/services/skill-pack-compiler.test.ts`
- Create: `educlaw-server/src/routes/skill-pack-actions.ts`
- Create: `educlaw-server/src/routes/skill-pack-actions.test.ts`
- Modify: `educlaw-server/src/index.ts`

- [ ] Write failing tests for Overview generation, input fingerprint reuse, overview approval, stale revision rejection, invalid stage transition and SSE `review_required` events.
- [ ] Verify targeted tests fail.
- [ ] Implement a typed stage registry with exact transitions from design section 7.1; no route may update status directly.
- [ ] Implement map-reduce Overview generation using natural source boundaries, followed by structural, interpretive, critical and applicability sections.
- [ ] Persist every output as an immutable `skill_pack_artifacts` record with prompt/model/pipeline versions.
- [ ] Implement Overview, Candidate and Publish approval actions with ownership, revision and idempotency.
- [ ] Run tests and build.
- [ ] Commit with `git commit -m "feat: add skill pack review workflow"`.

### Task 11: Five extractors and V0/V1/V2/V3

**Files:**
- Modify: `educlaw-server/src/services/skill-pack-compiler.ts`
- Modify: `educlaw-server/src/services/skill-pack-compiler.test.ts`
- Create: `educlaw-server/src/prompts/skill-pack-overview.ts`
- Create: `educlaw-server/src/prompts/skill-pack-extractors.ts`
- Create: `educlaw-server/src/prompts/skill-pack-verification.ts`

- [ ] Add failing fixture tests for framework, principle, case, counterexample and glossary outputs.
- [ ] Add verification tests proving cases/glossary do not become Skills, duplicate candidates merge, same-event text/frame does not pass V1, ungrounded candidates fail V0 and generic advice fails V3.
- [ ] Run targeted tests and verify failures.
- [ ] Implement five bounded extractor calls that all receive the approved Overview and emit source Evidence IDs.
- [ ] Implement deterministic de-duplication before model verification using normalized title/tags/evidence overlap.
- [ ] Implement V0 locally, V1 from independent source-context groups, V2 through a generated novel question and derived answer, and V3 through author/mechanism specificity.
- [ ] Persist accepted and rejected candidates with reasons; implement accept/reject/merge/recover mutations.
- [ ] Run tests and build.
- [ ] Commit with `git commit -m "feat: verify skill pack candidates"`.

### Task 12: RIA++, education mapping, relations and test generation

**Files:**
- Modify: `educlaw-server/src/services/skill-pack-compiler.ts`
- Modify: `educlaw-server/src/services/skill-pack-compiler.test.ts`
- Create: `educlaw-server/src/prompts/skill-pack-ria.ts`
- Create: `educlaw-server/src/prompts/skill-pack-relations.ts`
- Create: `educlaw-server/src/prompts/skill-pack-tests.ts`

- [ ] Add failing tests requiring R/I/A1/A2/E/B, exact Evidence IDs, sibling distinction, executable completion/stop conditions and all seven education dimensions.
- [ ] Add relation tests rejecting self-links, duplicate reverse links and unsupported relation types.
- [ ] Add test generation fixtures requiring positive, negative, edge and sibling-confusion cases.
- [ ] Run targeted tests and verify failures.
- [ ] Implement RIA++ compilation and deterministic mapping to the seven education dimensions defined in design section 9.6.
- [ ] Implement sparse relation validation and generate Index, Glossary and Digest artifacts.
- [ ] Generate immutable test cases pinned to candidate and draft identities.
- [ ] Run tests and build.
- [ ] Commit with `git commit -m "feat: compile reviewed skill packs"`.

## Milestone 4: Publication, runtime and evaluation

### Task 13: Atomic Pack publication

**Files:**
- Create: `educlaw-server/src/services/skill-pack-publish-service.ts`
- Create: `educlaw-server/src/services/skill-pack-publish-service.test.ts`
- Modify: `educlaw-server/src/services/package-service.ts`
- Modify: `educlaw-server/src/services/skill-version-service.ts`

- [ ] Write failing tests for first publication, republish, unchanged version reuse, asset-only version change, rollback fidelity, stale revision, failed-test rejection and transaction rollback.
- [ ] Verify tests fail.
- [ ] Calculate Skill identity from canonical Skill JSON plus sorted `{path, sha256, role}` asset entries.
- [ ] Build one Package Snapshot containing all accepted Skill Drafts and their optional asset manifests.
- [ ] Publish with source `distilled`, bind `skill_pack_members`, `agent_skill_version_assets` and `skill_evidence_links` in the same transaction.
- [ ] Ensure the Pack leaves `publishing` only after commit and returns to `publish_review` with a retryable error after rollback.
- [ ] Run targeted package/version tests and build.
- [ ] Commit with `git commit -m "feat: publish multimodal skill packs"`.

### Task 14: Runtime evidence selection and Arena provenance

**Files:**
- Modify: `educlaw-server/src/services/arena-service.ts`
- Modify: `educlaw-server/src/services/arena-service.answer-runs.test.ts`
- Modify: `educlaw-server/src/services/arena-service.skill-arena.test.ts`
- Create: `educlaw-server/src/services/runtime-evidence-selector.ts`
- Create: `educlaw-server/src/services/runtime-evidence-selector.test.ts`

- [ ] Write failing tests for evidence selection after Skill routing, ownership, maximum four images, deterministic ordering, text fallback and answer provenance persistence.
- [ ] Verify targeted tests fail.
- [ ] Implement selection only within pinned Skill Version evidence, scored by question terms, supports text, modality and relation context.
- [ ] Resolve assets to short-lived signed URLs immediately before the model request; never persist signed URLs.
- [ ] Send Skill instructions plus selected evidence to `generateMultimodalJson`/chat, and record evidence IDs, asset hashes, modalities and order in `arena_answer_run_evidence`.
- [ ] Preserve existing text-only behavior for Skills without assets and when the feature flag is off.
- [ ] Run Arena tests and build.
- [ ] Commit with `git commit -m "feat: run skills with visual evidence"`.

### Task 15: Pack route and execution test runner

**Files:**
- Create: `educlaw-server/src/services/skill-pack-test-service.ts`
- Create: `educlaw-server/src/services/skill-pack-test-service.test.ts`
- Modify: `educlaw-server/src/routes/skill-pack-actions.ts`

- [ ] Write failing tests for version-pinned test runs, expected route sets, forbidden Skill sets, abstention, sibling confusion, visual grounding and publish-gate calculation.
- [ ] Verify failures.
- [ ] Implement a runner that invokes the same production router and runtime used by Arena; test code must not bypass routing with direct Skill injection.
- [ ] Persist route selections, answer IDs, evidence IDs, scores and model/prompt/asset versions.
- [ ] Enforce: all V0, should-not-trigger and sibling-confusion pass; remaining overall pass rate at least 80 percent.
- [ ] Emit SSE progress and a final immutable `test_report` artifact.
- [ ] Run tests and build.
- [ ] Commit with `git commit -m "feat: evaluate skill packs before publication"`.

## Milestone 5: Native Skill Pack workspace

### Task 16: Frontend API and Pack shell

**Files:**
- Modify: `educlaw-web/src/api/lite-api.ts`
- Modify: `educlaw-web/src/components/skill-workspace/SkillWorkspaceSidebar.tsx`
- Modify: `educlaw-web/src/pages/SkillFirstWorkspace.tsx`
- Create: `educlaw-web/src/components/skill-workspace/SkillPackWorkspace.tsx`
- Modify: `educlaw-web/src/components/skill-workspace/skill-workspace-ui.test.ts`

- [ ] Add failing source-contract tests for the Material Distillation entry, Pack draft list, stage navigation, SSE reducer and coexistence with quick document creation.
- [ ] Run `pnpm --filter educlaw-web exec vitest run src/components/skill-workspace/skill-workspace-ui.test.ts` and verify failure.
- [ ] Add typed Pack methods and SSE event parsing to `lite-api.ts`.
- [ ] Add “素材蒸馏” without removing conversation, document, manual or import modes.
- [ ] Route active Pack drafts through `SkillPackWorkspace` while keeping existing Skill selection behavior unchanged.
- [ ] Run frontend tests and build.
- [ ] Commit with `git commit -m "feat: add skill pack workspace shell"`.

### Task 17: Stage editors and Evidence Viewer

**Files:**
- Create: `educlaw-web/src/components/skill-workspace/skill-pack/PackSourcesStage.tsx`
- Create: `educlaw-web/src/components/skill-workspace/skill-pack/PackOverviewStage.tsx`
- Create: `educlaw-web/src/components/skill-workspace/skill-pack/PackCandidatesStage.tsx`
- Create: `educlaw-web/src/components/skill-workspace/skill-pack/PackSkillsStage.tsx`
- Create: `educlaw-web/src/components/skill-workspace/skill-pack/PackTestsStage.tsx`
- Create: `educlaw-web/src/components/skill-workspace/skill-pack/PackPublishStage.tsx`
- Create: `educlaw-web/src/components/skill-workspace/skill-pack/EvidenceViewer.tsx`
- Modify: `educlaw-web/src/components/skill-workspace/skill-workspace.css`
- Modify: `educlaw-web/src/components/skill-workspace/skill-workspace-ui.test.ts`

- [ ] Add failing tests for upload progress, Overview approval, Candidate accept/reject/merge, RIA++ editing, relation/test views, publish gating and evidence navigation.
- [ ] Verify tests fail.
- [ ] Implement the six stage panels with all mutation buttons disabled while their revision is stale or a request is active.
- [ ] Implement Evidence Viewer for timestamp, frame, page and region locators; label source-explicit, model-observed, model-inferred and user-confirmed distinctly.
- [ ] Add Pack tree expansion after publication while member Skill links continue opening the existing Skill workspace.
- [ ] Run frontend tests, lint and build.
- [ ] Commit with `git commit -m "feat: complete multimodal pack authoring UI"`.

## Milestone 6: Deployment and verification

### Task 18: Docker, feature flag and end-to-end verification

**Files:**
- Modify: `.env.example`
- Modify: `docker-compose.yml`
- Create: `educlaw-media-worker/Dockerfile`
- Modify: `docs/DEPLOY.md`
- Create: `educlaw-server/src/services/multimodal-skill-pack.integration.test.ts`

- [ ] Add a failing integration test covering one short fixture video from upload completion through Evidence, one reviewed Skill, publication, multimodal Arena answer and rollback.
- [ ] Add a failure-path test for forged frame IDs and interrupted worker lease recovery.
- [ ] Add MinIO and media-worker services, health checks, internal token wiring and persistent object storage volume.
- [ ] Add `MULTIMODAL_SKILL_PACK_ENABLED=false` default and document staged activation.
- [ ] Run worker tests: `python -m pytest educlaw-media-worker/tests -q`.
- [ ] Run server tests: `pnpm --filter educlaw-server test`.
- [ ] Run web tests: `pnpm --filter educlaw-web test`.
- [ ] Run `pnpm lint && pnpm build`.
- [ ] Build containers with `docker compose build educlaw-server educlaw-web educlaw-media-worker minio`.
- [ ] Run the integration test with the feature flag on and verify the feature flag off preserves all existing creation and Arena tests.
- [ ] Record model-probe evidence for Kimi K2.5 image input without including credentials or source images in logs.
- [ ] Commit with `git commit -m "feat: ship multimodal skill pack pipeline"`.

## Review checkpoints

Implementation must pause for review after:

1. Task 4: asset schema, object storage and Pack ownership boundary;
2. Task 8: worker manifest and Evidence Unit contract;
3. Task 12: compiler artifacts and review semantics;
4. Task 15: publication gate and Arena evaluation;
5. Task 18: production rollout readiness.

No later milestone may change an approved earlier contract without updating the design document and adding a backwards-compatible migration.
