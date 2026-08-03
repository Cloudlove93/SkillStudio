#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_HOST="${APP_HOST:-1.15.87.91}"
APP_ORIGIN="${APP_ORIGIN:-http://${APP_HOST}}"
PORT="${PORT:-3000}"
TMUX_SESSION="${TMUX_SESSION:-1}"
TMUX_WINDOW="${TMUX_WINDOW:-educlaw-server}"
SERVICE_NAME="${SERVICE_NAME:-educlaw-server}"
WEB_DEPLOY_ROOT="${WEB_DEPLOY_ROOT:-/var/www/educlaw-arena}"
NGINX_SITE="${NGINX_SITE:-/etc/nginx/sites-available/educlaw-arena}"
NGINX_ENABLED="${NGINX_ENABLED:-/etc/nginx/sites-enabled/educlaw-arena}"
CONVERSATION_EVAL_BASE_URL="${CONVERSATION_EVAL_BASE_URL:-http://127.0.0.1:8090}"
CONVERSATION_EVAL_SCENES_DIR="${CONVERSATION_EVAL_SCENES_DIR:-/data/educlaw-eval-scenes}"
DEPLOY_DIR="$PROJECT_DIR/.deploy"
BACKEND_LOG="$DEPLOY_DIR/tmux-server.log"
TMUX_RUNNER="$DEPLOY_DIR/tmux-run-server.sh"

log() {
  printf '\n[educlaw-tmux] %s\n' "$*"
}

die() {
  printf '\n[educlaw-tmux] ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Missing command: $1"
}

upsert_env_value() {
  local key="$1"
  local value="$2"
  local env_file="$PROJECT_DIR/.env"

  if [[ ! -f "$env_file" ]]; then
    cp "$PROJECT_DIR/.env.example" "$env_file"
  fi

  if grep -q "^${key}=" "$env_file"; then
    sed -i "s#^${key}=.*#${key}=${value}#" "$env_file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$env_file"
  fi
}

find_server_entry() {
  local entry
  entry="$(find "$PROJECT_DIR/educlaw-server/dist" -type f -path '*/src/index.js' | head -n1)"
  [[ -n "$entry" ]] || die "Built server entry not found. Run: pnpm --filter educlaw-server build"
  printf '%s' "$entry"
}

ensure_server_dependencies() {
  if node -e "require.resolve('express', { paths: ['$PROJECT_DIR/educlaw-server'] })" >/dev/null 2>&1; then
    return
  fi

  require_command pnpm
  log "Installing workspace dependencies because educlaw-server cannot resolve express"
  pnpm install --frozen-lockfile
}

ensure_tmux_session() {
  if ! tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
    tmux new-session -d -s "$TMUX_SESSION" -n bash
  fi
}

stop_systemd_backends() {
  local service
  local stopped=""

  for service in "$SERVICE_NAME" educlaw-server educlaw-lite-server; do
    case " $stopped " in
      *" $service "*) continue ;;
    esac
    stopped="$stopped $service"
    sudo systemctl disable --now "$service" >/dev/null 2>&1 || true
  done
}

deploy_frontend() {
  local web_dist="$PROJECT_DIR/educlaw-web/dist"

  log "Building frontend"
  pnpm --filter educlaw-web build

  [[ -f "$web_dist/index.html" ]] || die "Built web app not found. Run: pnpm --filter educlaw-web build"

  case "$WEB_DEPLOY_ROOT" in
    /var/www/*) ;;
    *) die "Refusing to clear unexpected WEB_DEPLOY_ROOT: $WEB_DEPLOY_ROOT" ;;
  esac

  sudo mkdir -p "$WEB_DEPLOY_ROOT"
  sudo find "$WEB_DEPLOY_ROOT" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
  sudo cp -a "$web_dist"/. "$WEB_DEPLOY_ROOT"/
  sudo find "$WEB_DEPLOY_ROOT" -type d -exec chmod 0755 {} +
  sudo find "$WEB_DEPLOY_ROOT" -type f -exec chmod 0644 {} +
  sudo test -f "$WEB_DEPLOY_ROOT/index.html" || die "Frontend deploy failed: index.html missing in $WEB_DEPLOY_ROOT"
}

start_backend_in_tmux() {
  local server_entry="$1"

  if tmux list-windows -t "$TMUX_SESSION" -F '#W' | grep -Fxq "$TMUX_WINDOW"; then
    tmux kill-window -t "${TMUX_SESSION}:${TMUX_WINDOW}"
  fi

  mkdir -p "$DEPLOY_DIR"
  cat > "$TMUX_RUNNER" <<RUNEOF
#!/usr/bin/env bash
set -Eeuo pipefail
cd "$PROJECT_DIR"
export NODE_ENV=production
set -a
source "$PROJECT_DIR/.env"
set +a
echo "[educlaw-tmux] starting backend at \$(date)"
echo "[educlaw-tmux] entry: $server_entry"
echo "[educlaw-tmux] port: \${PORT:-3000}"
set +e
node "$server_entry"
status=\$?
set -e
echo
echo "[educlaw-tmux] backend exited with status \$status at \$(date)"
echo "[educlaw-tmux] press Enter to keep this shell, or Ctrl+B D to detach"
read -r _ || true
exec bash
RUNEOF
  chmod 0750 "$TMUX_RUNNER"
  : > "$BACKEND_LOG"

  tmux new-window -t "$TMUX_SESSION" -n "$TMUX_WINDOW" "bash '$TMUX_RUNNER' 2>&1 | tee -a '$BACKEND_LOG'"
}

write_nginx_site() {
  sudo tee "$NGINX_SITE" >/dev/null <<EOF
server {
    listen 80 default_server;
    server_name ${APP_HOST} localhost 127.0.0.1 _;

    root ${WEB_DEPLOY_ROOT};
    index index.html;

    client_max_body_size 100m;

    location = /healthz {
        proxy_pass http://127.0.0.1:${PORT}/healthz;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
    }

    location ~ ^/(api|auth|packages|arena|optimize|profiles|agents|runtimes|llm|events|admin)(/|$) {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_buffering off;
        proxy_read_timeout 3600;
    }

    location = /index.html {
        add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate" always;
        expires -1;
        try_files /index.html =404;
    }

    location / {
        add_header Cache-Control "no-cache" always;
        try_files \$uri \$uri/ /index.html;
    }
}
EOF

  sudo ln -sf "$NGINX_SITE" "$NGINX_ENABLED"
  sudo rm -f /etc/nginx/sites-enabled/default
  sudo nginx -t
  sudo systemctl reload nginx
}

verify() {
  log "Waiting for backend"
  for _ in $(seq 1 20); do
    if curl -fsS "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done

  if ! curl -fsS "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1; then
    printf '\n[educlaw-tmux] Backend did not become healthy. Recent backend log:\n' >&2
    tail -n 120 "$BACKEND_LOG" >&2 || true
    die "Backend health check failed"
  fi

  curl -fsS "http://127.0.0.1:${PORT}/healthz"
  printf '\n'

  local route_probe_body="$DEPLOY_DIR/route-probe.json"
  local route_probe_status
  route_probe_status="$(
    curl -sS -o "$route_probe_body" -w '%{http_code}' \
      -X PATCH "http://127.0.0.1:${PORT}/api/packages/__deploy_route_probe__" \
      -H 'Content-Type: application/json' \
      -d '{"name":"deploy-probe"}' || true
  )"
  if [[ "$route_probe_status" == "404" ]]; then
    printf '\n[educlaw-tmux] Backend route probe failed: PATCH /api/packages/:id returned 404.\n' >&2
    printf '[educlaw-tmux] This usually means an old backend is still serving port %s.\n' "$PORT" >&2
    printf '\n[educlaw-tmux] Route probe response:\n' >&2
    cat "$route_probe_body" >&2 || true
    printf '\n[educlaw-tmux] Recent backend log:\n' >&2
    tail -n 120 "$BACKEND_LOG" >&2 || true
    die "Backend route probe failed"
  fi

  curl -fsS "http://127.0.0.1/healthz"
  printf '\n'
  if ! curl -fsSI "http://127.0.0.1/" >/dev/null; then
    printf '\n[educlaw-tmux] Frontend health check failed. Deployed files:\n' >&2
    sudo ls -la "$WEB_DEPLOY_ROOT" >&2 || true
    printf '\n[educlaw-tmux] nginx sites enabled:\n' >&2
    sudo ls -la /etc/nginx/sites-enabled >&2 || true
    die "Frontend health check failed"
  fi

  log "Done"
  printf 'URL:   %s\n' "$APP_ORIGIN"
  printf 'tmux:  tmux attach -t %s\n' "$TMUX_SESSION"
}

main() {
  require_command tmux
  require_command node
  require_command curl
  require_command nginx

  cd "$PROJECT_DIR"

  log "Setting .env"
  upsert_env_value PORT "$PORT"
  upsert_env_value APP_ORIGIN "$APP_ORIGIN"
  upsert_env_value CONVERSATION_EVAL_BASE_URL "$CONVERSATION_EVAL_BASE_URL"
  upsert_env_value CONVERSATION_EVAL_SCENES_DIR "$CONVERSATION_EVAL_SCENES_DIR"
  sudo mkdir -p "$CONVERSATION_EVAL_SCENES_DIR"
  sudo chown "$(id -u):$(id -g)" "$CONVERSATION_EVAL_SCENES_DIR" 2>/dev/null || true

  ensure_server_dependencies

  log "Building shared package"
  pnpm --filter @educlaw/shared build

  log "Building backend"
  pnpm --filter educlaw-server build

  log "Applying database schema before service restart"
  pnpm --filter educlaw-server db:init

  log "Stopping systemd backend if present"
  stop_systemd_backends

  log "Starting backend in tmux session ${TMUX_SESSION}, window ${TMUX_WINDOW}"
  ensure_tmux_session
  start_backend_in_tmux "$(find_server_entry)"

  log "Deploying frontend"
  deploy_frontend

  log "Configuring nginx"
  write_nginx_site

  verify
}

main "$@"
