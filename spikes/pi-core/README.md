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
`LLM_MODEL` from repository `.env.local` first, then `.env`, when those variables
are not already set in the process. This matches the formal server's precedence.
Missing optional environment files are allowed. Logs never print the key, prompt,
full model output, or full tool result.

The fixture tool is read-only. It accepts relative Markdown paths inside the
fixed Skill root, resolves symbolic links before containment checks, enforces
per-file and cumulative byte limits, and honors cancellation.

Kimi K2.5/K2.6 probes explicitly disable thinking and omit temperature, matching
the formal Adapter's compatibility rule. Other models keep temperature 0.
Provider probes have a 15-second deadline and no automatic retry. The CLI tool
loop has a 45-second deadline and at most three model requests; the reusable
runner defaults to 180 seconds / eight requests. All SDK requests disable retries.

Tool-loop evidence records both the tool result in the next SDK context and the
reference marker in the serialized follow-up provider payload. The first payload
must not contain the marker. CLI acceptance requires both forms of evidence,
successful tool execution, a final answer containing the marker, and cleanup.
No complete prompt, payload, key, or tool output is written to logs.

The October 16 acceptance results and remaining real-provider/container blockers
are recorded in `../../docs/acceptance/2026-10-16-pi-core-stage1.md`.
