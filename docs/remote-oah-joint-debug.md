# Remote OAH MinIO / rclone Joint Debug Guide

This document describes the joint debug workflow between:

- the remote OAH repository
- MinIO / rclone mounted runtime content
- EduClaw as the OAH API client

## 1. Key rule

In the new architecture:

- `source/` is only used to initialize MinIO or OSS content
- runtime templates, workspaces, and model definitions must be read by OAH from the MinIO / rclone mounted location
- EduClaw must not treat local `source/`, `agent_template/`, or `models/` as the runtime source of truth

## 2. OAH repository side

In the OAH repository, confirm:

```bash
cat package.json
find scripts -maxdepth 2 -type f | sort
find source -maxdepth 2 -type f | head
```

Expected:

- `package.json` contains the current startup workflow
- `scripts/` contains the MinIO or rclone sync helpers
- `source/` contains the initialization payload

## 3. Initialize MinIO content

Use the OAH repository `scripts/` to:

- create or refresh the MinIO buckets
- push `source/` content into MinIO
- refresh the rclone-mounted runtime content visible to OAH

Because script names may differ by OAH version, identify them with:

```bash
grep -RIn 'minio\|rclone\|source' scripts package.json
```

## 4. Start OAH

Use the agreed startup command:

```bash
OAH_DEPLOY_ROOT=../test_oah_server pnpm local:up
```

## 5. Validate OAH before starting EduClaw

```bash
curl http://<remote-oah-host>:8787/healthz
curl http://<remote-oah-host>:8787/api/v1/runtimes
curl http://<remote-oah-host>:8787/api/v1/platform-models
```

You should see:

- a healthy OAH response
- `micro-learning`
- `educlaw-builder`
- at least one platform model

## 6. Validate remote content mount

If OAH starts but templates or models are missing, verify inside the OAH container:

```bash
docker exec -it <oah-container> sh
ls -la <mounted-template-dir>
ls -la <mounted-model-dir>
```

Check:

- expected template directories exist
- expected model definitions exist
- files are visible through the rclone-mounted path

## 7. Validate EduClaw against remote OAH

From the EduClaw machine:

```bash
curl http://127.0.0.1:3000/templates
curl http://127.0.0.1:3000/llm/models
```

These should reflect the remote OAH state, not local fallback folders.

## 8. HomeChat requirement

HomeChat now prefers a remote OAH workspace bound by `externalRef`.

Recommended refs:

- `educlaw:chat:home`
- `educlaw:chat:home:<model>`

If these are missing in OAH, EduClaw can only fall back when `OAH_ENABLE_PATH_IMPORT=true` is explicitly enabled.

## 9. Common failure split

If EduClaw fails, classify it as one of these:

### A. Remote OAH unreachable

- `/healthz` fails
- EduClaw startup should fail fast

### B. OAH reachable but templates/models missing

- `/runtimes` or `/platform-models` is incomplete
- Usually a MinIO or rclone sync issue

### C. OAH reachable and metadata present, but chat fails

- Usually an upstream model connectivity problem from the OAH side
- Verify the model host from inside the OAH container

### D. EduClaw local state mismatch

- Old browser tabs or stale frontend in-memory state
- Fix with a hard refresh and reloading the agent list
