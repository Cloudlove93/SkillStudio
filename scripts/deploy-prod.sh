#!/usr/bin/env bash
set -Eeuo pipefail

# EduClaw Arena standard production deploy script.
# Target: Ubuntu/Debian without Docker.
# It keeps the arena frontend intact, builds static assets, runs the backend
# as a production Node process, and serves the frontend through nginx.
#
# Usage:
#   bash scripts/deploy-prod.sh
#   APP_HOST=your.domain.com bash scripts/deploy-prod.sh

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="${APP_NAME:-educlaw-arena}"
SERVICE_NAME="${SERVICE_NAME:-educlaw-server}"
NODE_VERSION_MAJOR="${NODE_VERSION_MAJOR:-20}"
PNPM_VERSION="${PNPM_VERSION:-10.30.2}"
PORT="${PORT:-3000}"
BODY_LIMIT="${BODY_LIMIT:-100mb}"
LLM_TIMEOUT_MS="${LLM_TIMEOUT_MS:-300000}"
DB_NAME="${POSTGRES_DB:-educlawlite}"
DB_USER="${POSTGRES_USER:-educlawlite}"
WEB_ROOT="$PROJECT_DIR/educlaw-web/dist"
WEB_DEPLOY_ROOT="${WEB_DEPLOY_ROOT:-/var/www/$APP_NAME}"
NGINX_SITE="/etc/nginx/sites-available/$APP_NAME"
NGINX_ENABLED="/etc/nginx/sites-enabled/$APP_NAME"
DEPLOY_DIR="$PROJECT_DIR/.deploy"
RUNNER="$DEPLOY_DIR/run-server.sh"
TMUX_RUNNER="$DEPLOY_DIR/tmux-server.sh"
BACKEND_LOG="$DEPLOY_DIR/server.log"
BACKEND_MODE=""

log() {
  printf '\n[%s] %s\n' "$APP_NAME" "$*"
}

die() {
  printf '\n[%s] ERROR: %s\n' "$APP_NAME" "$*" >&2
  exit 1
}

has_systemd() {
  [[ "$(ps -p 1 -o comm= 2>/dev/null || true)" == "systemd" ]] && command -v systemctl >/dev/null 2>&1
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    die "Run as root. Example: bash scripts/deploy-prod.sh"
  fi
}

read_env_value() {
  local key="$1"
  local fallback="${2:-}"
  local value=""

  if [[ -f "$PROJECT_DIR/.env" ]]; then
    value="$(grep -E "^${key}=" "$PROJECT_DIR/.env" 2>/dev/null | tail -n1 | cut -d= -f2- || true)"
    value="${value%$'\r'}"
    value="${value#\"}"
    value="${value%\"}"
    value="${value#\'}"
    value="${value%\'}"
  fi

  if [[ -n "$value" ]]; then
    printf '%s' "$value"
  else
    printf '%s' "$fallback"
  fi
}

sql_escape() {
  printf "%s" "$1" | sed "s/'/''/g"
}

detect_app_host() {
  if [[ -n "${APP_HOST:-}" ]]; then
    printf '%s' "$APP_HOST"
    return
  fi

  local from_env
  from_env="$(read_env_value APP_ORIGIN "")"
  if [[ -n "$from_env" ]]; then
    printf '%s' "${from_env#http://}" | sed 's#^https://##;s#/.*$##'
    return
  fi

  hostname -I 2>/dev/null | awk '{print $1}'
}

install_system_packages() {
  log "Installing system packages"
  if [[ ! -f /etc/debian_version ]]; then
    die "This script targets Ubuntu/Debian. For other Linux distributions, install Node.js 20, PostgreSQL, nginx, pnpm, and tmux manually."
  fi

  apt-get update
  apt-get install -y ca-certificates curl gnupg git nginx postgresql postgresql-contrib openssl tmux rsync

  local current_major="0"
  if command -v node >/dev/null 2>&1; then
    current_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  fi

  if [[ "$current_major" -lt "$NODE_VERSION_MAJOR" ]]; then
    log "Installing Node.js ${NODE_VERSION_MAJOR}.x"
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION_MAJOR}.x" | bash -
    apt-get install -y nodejs
  fi

  corepack enable
  corepack prepare "pnpm@${PNPM_VERSION}" --activate
}

start_postgresql() {
  log "Starting PostgreSQL"
  if has_systemd; then
    systemctl enable --now postgresql
    return
  fi

  if command -v service >/dev/null 2>&1; then
    service postgresql start && return
  fi

  if command -v pg_ctlcluster >/dev/null 2>&1; then
    pg_ctlcluster 16 main start 2>/dev/null && return
    pg_ctlcluster 15 main start 2>/dev/null && return
    pg_ctlcluster 14 main start 2>/dev/null && return
  fi

  die "Could not start PostgreSQL. Start it manually, then rerun this script."
}

configure_database() {
  start_postgresql
  log "Configuring PostgreSQL"

  local db_password_escaped
  db_password_escaped="$(sql_escape "$DB_PASSWORD")"

  if runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$(sql_escape "$DB_USER")'" | grep -q 1; then
    runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c "ALTER USER \"$DB_USER\" WITH PASSWORD '$db_password_escaped';"
  else
    runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c "CREATE USER \"$DB_USER\" WITH PASSWORD '$db_password_escaped';"
  fi

  if ! runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_database WHERE datname='$(sql_escape "$DB_NAME")'" | grep -q 1; then
    runuser -u postgres -- createdb -O "$DB_USER" "$DB_NAME"
  fi
}

write_env_file() {
  log "Writing production .env"
  if [[ -f "$PROJECT_DIR/.env" ]]; then
    local backup="$PROJECT_DIR/.env.backup.$(date +%Y%m%d%H%M%S)"
    cp "$PROJECT_DIR/.env" "$backup"
    log "Backed up existing .env to $backup"
  fi

  umask 077
  cat > "$PROJECT_DIR/.env" <<ENVEOF
DATABASE_URL=postgres://${DB_USER}:${DB_PASSWORD}@127.0.0.1:5432/${DB_NAME}
PORT=${PORT}
BODY_LIMIT=${BODY_LIMIT}
LLM_TIMEOUT_MS=${LLM_TIMEOUT_MS}
APP_ORIGIN=${APP_ORIGIN}
LLM_BASE_URL=${LLM_BASE_URL}
LLM_API_KEY=${LLM_API_KEY}
LLM_MODEL=${LLM_MODEL}
LLM_BASELINE_MODEL=${LLM_BASELINE_MODEL}
CONVERSATION_EVAL_BASE_URL=${CONVERSATION_EVAL_BASE_URL}
CONVERSATION_EVAL_SCENES_DIR=${CONVERSATION_EVAL_SCENES_DIR}
SEED_USERS=${SEED_USERS}
SEED_USER_NAMES=${SEED_USER_NAMES}
SEED_USER_PASSWORD=${SEED_USER_PASSWORD}
ENVEOF
}

build_project() {
  log "Installing workspace dependencies"
  cd "$PROJECT_DIR"
  pnpm install --frozen-lockfile

  log "Building workspace packages"
  pnpm --filter @educlaw/shared build
  pnpm --filter educlaw-server build
  pnpm --filter educlaw-web build

  log "Applying database schema before service restart"
  pnpm --filter educlaw-server db:init

  if [[ ! -d "$WEB_ROOT" ]]; then
    die "Frontend build output not found: $WEB_ROOT"
  fi
}

publish_frontend() {
  log "Publishing frontend assets to $WEB_DEPLOY_ROOT"
  mkdir -p "$WEB_DEPLOY_ROOT"
  rsync -a --delete "$WEB_ROOT/" "$WEB_DEPLOY_ROOT/"

  if id www-data >/dev/null 2>&1; then
    chown -R www-data:www-data "$WEB_DEPLOY_ROOT"
  fi
  find "$WEB_DEPLOY_ROOT" -type d -exec chmod 0755 {} +
  find "$WEB_DEPLOY_ROOT" -type f -exec chmod 0644 {} +
}

find_server_entry() {
  local entry
  entry="$(find "$PROJECT_DIR/educlaw-server/dist" -type f -path '*/src/index.js' | head -n1)"
  if [[ -z "$entry" ]]; then
    die "Could not find built server entry under educlaw-server/dist"
  fi
  printf '%s' "$entry"
}

write_backend_runner() {
  local server_entry="$1"
  mkdir -p "$DEPLOY_DIR"

  cat > "$RUNNER" <<RUNEOF
#!/usr/bin/env bash
set -Eeuo pipefail
cd "$PROJECT_DIR"
set -a
source "$PROJECT_DIR/.env"
set +a
exec node "$server_entry"
RUNEOF
  chmod 0750 "$RUNNER"
}

install_systemd_backend() {
  log "Installing systemd backend service: $SERVICE_NAME"
  cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<SERVICEEOF
[Unit]
Description=EduClaw Arena backend
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
WorkingDirectory=$PROJECT_DIR
Environment=NODE_ENV=production
ExecStart=$RUNNER
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SERVICEEOF

  systemctl daemon-reload
  systemctl enable --now "$SERVICE_NAME"
  systemctl restart "$SERVICE_NAME"
  BACKEND_MODE="systemd"
}

install_tmux_backend() {
  log "Starting backend with tmux because systemd is unavailable"
  command -v tmux >/dev/null 2>&1 || die "tmux is required when systemd is unavailable"

  cat > "$TMUX_RUNNER" <<TMUXEOF
#!/usr/bin/env bash
exec "$RUNNER" >> "$BACKEND_LOG" 2>&1
TMUXEOF
  chmod 0750 "$TMUX_RUNNER"

  tmux kill-session -t "$SERVICE_NAME" 2>/dev/null || true
  : > "$BACKEND_LOG"
  tmux new-session -d -s "$SERVICE_NAME" "$TMUX_RUNNER"
  BACKEND_MODE="tmux"
}

install_backend() {
  local server_entry="$1"
  write_backend_runner "$server_entry"

  if has_systemd; then
    install_systemd_backend
  else
    install_tmux_backend
  fi
}

wait_for_backend() {
  log "Waiting for backend health check"
  for _ in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1; then
      return
    fi
    sleep 1
  done

  if [[ -f "$BACKEND_LOG" ]]; then
    tail -n 120 "$BACKEND_LOG" >&2 || true
  fi
  die "Backend health check failed"
}

start_or_reload_nginx() {
  nginx -t

  if has_systemd; then
    systemctl enable --now nginx
    systemctl reload nginx
    return
  fi

  if pgrep -x nginx >/dev/null 2>&1; then
    nginx -s reload
    return
  fi

  if command -v service >/dev/null 2>&1; then
    service nginx start && return
  fi

  nginx
}

install_nginx_site() {
  log "Installing nginx site"
  cat > "$NGINX_SITE" <<NGINXEOF
server {
    listen 80;
    server_name ${APP_HOST};

    root ${WEB_DEPLOY_ROOT};
    index index.html;

    client_max_body_size 100m;

    location = /healthz {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location ~ ^/.*/proxy/[0-9]+/healthz$ {
        rewrite ^/.*/proxy/[0-9]+/healthz$ /healthz break;
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location ~ ^(.*/proxy/[0-9]+)$ {
        return 302 \$1/;
    }

    location ~ ^/(api|auth|packages|arena|optimize|profiles|agents|runtimes|llm|events|admin)(/|$) {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_buffering off;
        proxy_read_timeout 3600;
    }

    location ~ ^/.*/proxy/[0-9]+/(api|auth|packages|arena|optimize|profiles|agents|runtimes|llm|events|admin)(/|$) {
        rewrite ^/.*/proxy/[0-9]+/(.*)$ /\$1 break;
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_buffering off;
        proxy_read_timeout 3600;
    }

    location ~ ^/.*/proxy/[0-9]+/(.*)$ {
        try_files /\$1 /index.html;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
NGINXEOF

  ln -sf "$NGINX_SITE" "$NGINX_ENABLED"
  if [[ -e /etc/nginx/sites-enabled/default ]]; then
    rm -f /etc/nginx/sites-enabled/default
  fi

  start_or_reload_nginx
}

verify_deploy() {
  log "Verifying deployment"

  if [[ "$BACKEND_MODE" == "systemd" ]]; then
    systemctl --no-pager --full status "$SERVICE_NAME" | sed -n '1,18p'
  else
    tmux has-session -t "$SERVICE_NAME"
  fi

  wait_for_backend

  if ! curl -fsSI -H "Host: ${APP_HOST}" "http://127.0.0.1/" >/dev/null; then
    tail -n 80 /var/log/nginx/error.log >&2 || true
    die "Frontend check failed"
  fi

  printf '\n[%s] Deployment complete\n' "$APP_NAME"
  printf '  URL:      %s\n' "$APP_ORIGIN"
  printf '  Backend:  http://127.0.0.1:%s/healthz\n' "$PORT"
  if [[ "$BACKEND_MODE" == "systemd" ]]; then
    printf '  Logs:     journalctl -u %s -f\n' "$SERVICE_NAME"
  else
    printf '  Logs:     tail -f %s\n' "$BACKEND_LOG"
    printf '  Session:  tmux attach -t %s\n' "$SERVICE_NAME"
  fi
}

main() {
  require_root
  cd "$PROJECT_DIR"

  APP_HOST="$(detect_app_host)"
  [[ -n "$APP_HOST" ]] || die "Set APP_HOST or APP_ORIGIN, or make sure hostname -I returns an address."

  DB_PASSWORD="${POSTGRES_PASSWORD:-$(read_env_value POSTGRES_PASSWORD "")}"
  [[ -n "$DB_PASSWORD" ]] || DB_PASSWORD="$(openssl rand -hex 16)"

  APP_ORIGIN="${APP_ORIGIN:-$(read_env_value APP_ORIGIN "http://${APP_HOST}")}"
  SEED_USERS="${SEED_USERS:-$(read_env_value SEED_USERS "false")}"
  case "${SEED_USERS,,}" in
    1|true|yes|on) SEED_USERS=true ;;
    *) SEED_USERS=false ;;
  esac
  SEED_USER_NAMES="${SEED_USER_NAMES:-$(read_env_value SEED_USER_NAMES "user1,user2,user3,user4,user5")}"
  SEED_USER_PASSWORD="${SEED_USER_PASSWORD:-$(read_env_value SEED_USER_PASSWORD "")}"
  LLM_BASE_URL="${LLM_BASE_URL:-$(read_env_value LLM_BASE_URL "https://api.moonshot.ai/v1")}"
  LLM_API_KEY="${LLM_API_KEY:-$(read_env_value LLM_API_KEY "")}"
  LLM_MODEL="${LLM_MODEL:-$(read_env_value LLM_MODEL "kimi-k2.6")}"
  LLM_BASELINE_MODEL="${LLM_BASELINE_MODEL:-$(read_env_value LLM_BASELINE_MODEL "$LLM_MODEL")}"
  CONVERSATION_EVAL_BASE_URL="${CONVERSATION_EVAL_BASE_URL:-$(read_env_value CONVERSATION_EVAL_BASE_URL "http://127.0.0.1:8090")}"
  CONVERSATION_EVAL_SCENES_DIR="${CONVERSATION_EVAL_SCENES_DIR:-$(read_env_value CONVERSATION_EVAL_SCENES_DIR "/data/educlaw-eval-scenes")}"

  if [[ "$SEED_USERS" == "true" && ( -z "$SEED_USER_PASSWORD" || "$SEED_USER_PASSWORD" == "educlaw123" || ${#SEED_USER_PASSWORD} -lt 12 ) ]]; then
    die "Set SEED_USER_PASSWORD to a strong value before enabling seeded users in production."
  fi

  if [[ -z "$LLM_API_KEY" || "$LLM_API_KEY" == "your-llm-api-key" || "$LLM_API_KEY" == "换成你新的可用key" ]]; then
    die "Set LLM_API_KEY in .env before deploying, or pass it once as an environment variable."
  fi

  install_system_packages
  configure_database
  mkdir -p "$CONVERSATION_EVAL_SCENES_DIR"
  write_env_file
  build_project
  publish_frontend

  local server_entry
  server_entry="$(find_server_entry)"
  install_backend "$server_entry"
  install_nginx_site
  verify_deploy
}

main "$@"
