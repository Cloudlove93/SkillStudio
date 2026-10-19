# EduSkill

EduSkill is an education-focused Skill lifecycle platform for creating, running, testing, optimizing, and versioning reusable Skills.

For a current product definition, feature map, core workflows, architecture, and implementation-status boundaries, see [EduSkill 平台说明与功能地图](docs/EDUSKILL_PLATFORM_OVERVIEW.md).

## Start

```bash
pnpm install
docker compose up -d educlaw-postgres
pnpm --filter @educlaw/shared build
pnpm --filter educlaw-server dev
pnpm --filter educlaw-web dev
```

## Services

- `educlaw-server`: API, auth, packages, arena, logging, and persistence
- `educlaw-web`: frontend workspace

## Config

- Copy `.env.example` to `.env.local`
- Put real secrets only in `.env.local`

## Workflow

- `main`: stable
- `dev`: integration
- `feature/*`: features
- `fix/*`: fixes

## Engineering checks

`pnpm check:types` rejects new frontend TypeScript diagnostics compared with the reviewed multiset in `educlaw-web/typecheck-baseline.json`. It runs first in `pnpm check`. Existing errors may disappear; a new error or a larger count of an existing diagnostic fails even if the total count stays the same. Paths, TS codes, flattened messages and occurrence counts are compared, without absolute line numbers or machine paths.

The baseline was captured before the 2026-10-19 engineering hardening changes with the same dependencies (257 diagnostics). The checker never rewrites it. Review any intentional baseline change as source code. `pnpm --filter educlaw-web check:types:full` still reports every current error and is expected to fail until historical issues are fixed; passing the incremental gate does not mean a clean full typecheck.

For isolated PostgreSQL concurrency verification on the existing local instance, set `HARDENING_POSTGRES_TESTS=1` and run the two `*.concurrency.test.ts` suites. They validate the local target, create random `eduskill_hardening_*` databases, use real transactions/connections, and drop only their own databases. They do not create tables in the business database or start Docker services. Routine tests skip these explicit integration suites unless opted in.

