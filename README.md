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

