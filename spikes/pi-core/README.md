# EduSkill Pi Core Spike

This isolated package validates `@earendil-works/pi-agent-core@1.1.0` without
changing the EduSkill Arena execution chain or database.

## Commands

```powershell
pnpm.cmd install --dir spikes/pi-core --ignore-workspace --frozen-lockfile
pnpm.cmd --dir spikes/pi-core build
pnpm.cmd --dir spikes/pi-core test
pnpm.cmd --dir spikes/pi-core spike:provider
pnpm.cmd --dir spikes/pi-core spike:agent
pnpm.cmd --dir spikes/pi-core spike:abort
```

The real-provider commands read only `LLM_API_KEY`, `LLM_BASE_URL`, and
`LLM_MODEL` from the repository root `.env` when those variables are not already
set. Logs never print the key, prompt, full model output, or full tool result.

The fixture tool is read-only. It accepts relative Markdown paths inside the
fixed Skill root, resolves symbolic links before containment checks, enforces
per-file and cumulative byte limits, and honors cancellation.
