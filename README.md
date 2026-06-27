# EduSkill

EduSkill is a workspace for managing skills, agents, chats, and learning assets.

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

