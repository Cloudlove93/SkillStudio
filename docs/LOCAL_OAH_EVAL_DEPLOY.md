# Local OAH + Auto Evaluation Deploy Notes

This deployment uses services on the same server:

- EduClaw backend: `http://127.0.0.1:3000`
- conversation_eval_server: `http://127.0.0.1:8090`
- OAH: `http://127.0.0.1:8787/api/v1`

EduClaw does not call OAH directly for auto evaluation. The flow is:

```text
EduClaw -> conversation_eval_server -> local OAH
```

Use these values in EduClaw `.env`:

```bash
CONVERSATION_EVAL_BASE_URL=http://127.0.0.1:8090
CONVERSATION_EVAL_SCENES_DIR=/data/educlaw-eval-scenes
ASSISTANT_OAH_BASE_URL=http://127.0.0.1:8787/api/v1
USER_OAH_BASE_URL=http://127.0.0.1:8787/api/v1
EVAL_OAH_BASE_URL=http://127.0.0.1:8787/api/v1
```

Use matching values for `conversation_eval_server`:

```bash
APP_PORT=8090
SCENES_DIR=/data/educlaw-eval-scenes
ASSISTANT_OAH_BASE_URL=http://127.0.0.1:8787/api/v1
USER_OAH_BASE_URL=http://127.0.0.1:8787/api/v1
EVAL_OAH_BASE_URL=http://127.0.0.1:8787/api/v1
```

Before testing in EduClaw, verify the local services:

```bash
curl http://127.0.0.1:8787/healthz
curl http://127.0.0.1:8787/api/v1/runtimes
curl http://127.0.0.1:8090/v1/health
```

The scene directory must be the same readable directory for both EduClaw and `conversation_eval_server`.
