# Contributing

## Branches

- `main`: production only, no direct push
- `dev`: integration branch
- `feature/*`: new work
- `fix/*`: bug fixes

## Flow

1. Branch from `dev`
2. Develop locally
3. Run `pnpm lint`, `pnpm test`, `pnpm build`
4. Open PR into `dev`
5. Merge `dev` to `main` after verification

## Code Rules

- TypeScript strict on
- No `any`
- Run ESLint before commit
- Format with Prettier before commit
- Python, if added later, must use Python 3.10+, type hints, Ruff/Flake8, and Black

## Prompts

- Keep prompts in `educlaw-server/src/prompts`
- Do not hardcode long prompts in service logic

## Logs

- Use structured logs
- Include request id, path, and errors
- Log model input/output around model calls

## Secrets

- Never commit real API keys
- Keep real secrets in `.env.local`

## Services

- Every service must start independently
- Every service must have a README
- Every service must have a Makefile for build/push

