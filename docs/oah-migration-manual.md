# EduClaw Remote Pure-Docker OAH Migration Guide

## Goal

EduClaw now targets a remote pure-Docker OAH deployment backed by MinIO/rclone.
The intended architecture is:

- OAH is started and operated separately from EduClaw.
- Templates, workspaces, and platform model definitions are managed by OAH.
- `source/` is only used to initialize MinIO or OSS content.
- EduClaw creates and drives workspaces through OAH APIs.
- EduClaw keeps only its own business data and local workspace mirrors.

## Responsibility Split

### OAH owns

- workspace templates
- platform models
- workspace, session, run, and event-stream lifecycle
- MinIO or OSS mounted runtime content
- the OAH runtime itself

### EduClaw owns

- user login and product entrypoints
- profiles
- user skill, tool, and agent metadata
- calling OAH APIs to create and manage workspaces
- local workspace mirrors for browsing, editing, and exporting
- its own business data storage

## Important Operating Rules

- EduClaw should not start OAH by default.
- EduClaw should not treat local `agent_template/` as the source of truth.
- EduClaw should not treat local `models/` as the source of truth.
- HomeChat should not rely on local path import unless compatibility mode is explicitly enabled.

## OAH Startup

Use the OAH repository's new startup command:

```bash
OAH_DEPLOY_ROOT=../test_oah_server pnpm local:up
```

Notes:

- `source/` is only for MinIO or OSS initialization.
- Use the OAH repository `scripts/` to push configuration into the MinIO Docker service.
- EduClaw assumes OAH is already running and reachable.

## EduClaw Behavior After Migration

### Templates

`GET /templates` now reads from the remote OAH endpoint:

```text
GET /api/v1/runtimes
```

### Models

`llm-service` now prefers:

```text
GET /api/v1/platform-models
```

It only falls back to legacy local model files if the OAH API is unavailable.

### Agent Workspace Provisioning

When creating an agent, EduClaw now:

1. reads the profile
2. builds `agentsMd`
3. resolves profile skills and tools
4. calls OAH `createWorkspace(template, agentsMd, skills, toolServers, externalRef)`
5. syncs the remote workspace back into a local mirror directory

This means templates and runtime configuration are sourced from remote OAH rather than local template folders.

### HomeChat

HomeChat now prefers binding to an existing remote workspace by `externalRef`:

- default model: `educlaw:chat:home`
- model-specific: `educlaw:chat:home:<model>`

Only when `OAH_ENABLE_PATH_IMPORT=true` is set will EduClaw fall back to local path import.

## Recommended Environment Variables

```bash
export EDU_AGENT_DIR=/home/cloud/EduAgent_oah
export OAH_BASE_URL=http://10.11.20.89:8787
export OAH_ENABLE_PATH_IMPORT=false
```

If you truly want the local script to try to launch OAH in compatibility mode, set:

```bash
export MANAGE_LOCAL_OAH=1
```

## EduClaw Startup

```bash
cd /home/cloud/EduClaw
bash scripts/start-dev.sh
```

Current behavior:

- if `OAH_BASE_URL` points to a remote address, the script performs a remote health check first
- if the remote OAH is unreachable, the script exits immediately
- by default the script only starts `educlaw-server` and `educlaw-web`

## OAH-Side Prerequisites

The remote OAH deployment should provide at least:

- `micro-learning` and `educlaw-builder` in `runtimes`
- at least one usable `platform-model`
- a HomeChat workspace already provisioned in OAH, unless compatibility path import is intentionally enabled
- healthy MinIO/rclone mounts so OAH can read templates and workspace content

## Suggested Checks

```bash
curl http://10.11.20.89:8787/healthz
curl http://10.11.20.89:8787/api/v1/runtimes
curl http://10.11.20.89:8787/api/v1/platform-models
curl http://127.0.0.1:3000/runtimes
curl http://127.0.0.1:3000/llm/models
```

## External Blocker

If the remote OAH address is not reachable from the current machine, EduClaw can still be upgraded in code, but final end-to-end validation will remain blocked at the network or remote service layer.
