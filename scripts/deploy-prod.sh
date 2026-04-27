#!/usr/bin/env bash
set -Eeuo pipefail

# EduClaw Arena standard production deploy script.
# Target: a normal Ubuntu/Debian server without Docker.
# It keeps the arena frontend intact, builds static assets, runs the backend
# with systemd, and serves the frontend through nginx with API reverse proxying.
#
# Usage:
#   sudo APP_HOST=your.domain.com LLM_API_KEY=... bash scripts/deploy-prod.sh
#   sudo APP_HOST=1.2.3.4 LLM_API_KEY=... bash scripts/deploy-prod.sh

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="${APP_NAME:-educlaw-arena}"
SERVICE_NAME="${SERVICE_NAME:-educlaw-server}"
NODE_VERSION_MAJOR="${NODE_VERSION_MAJOR:-20}"
PNPM_VERSION="${PNPM_VERSION:-10.30.2}"
PORT="${PORT:-3000}"
DB_NAME="${POSTGRES_DB:-educlawlite}"
DB_USER="${POSTGRES_USER:-educlawlite}"
WEB_ROOT="$PROJECT_DIR/educlaw-web/dist"
NGINX_SITE="/etc/nginx/sites-available/$APP_NAME"
NGINX_ENABLED="/etc/nginx/sites-enabled/$APP_NAME"
RUNNER="$PROJECT_DIR/.deploy/run-server.sh"

log() {
  printf '\n[%s] %s\n' "$APP_NAME" "$*"
}

die() {
  printf '\n[%s] ERROR: %s\n' "$APP_NAME" "$*" >&2
  exit 1
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    die "Run as root: sudo APP_HOST=your.domain.com LLM_API_KEY=... bash scripts/deploy-prod.sh"
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
    die "This script targets Ubuntu/Debian. For other Linux distributions, install Node.js 20, PostgreSQL, nginx, and pnpm manually."
  fi

  apt-get update
  apt-get install -y ca-certificates curl gnupg git nginx postgresql postgresql-contrib openssl

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

configure_database() {
  log "Configuring PostgreSQL"
  systemctl enable --now postgresql

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
JWT_SECRET=${JWT_SECRET}
PORT=${PORT}
APP_ORIGIN=${APP_ORIGIN}
LLM_BASE_URL=${LLM_BASE_URL}
LLM_API_KEY=${LLM_API_KEY}
LLM_MODEL=${LLM_MODEL}
LLM_BASELINE_MODEL=${LLM_BASELINE_MODEL}
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

  if [[ ! -d "$WEB_ROOT" ]]; then
    die "Frontend build output not found: $WEB_ROOT"
  fi
}

find_server_entry() {
  local entry
  entry="$(find "$PROJECT_DIR/educlaw-server/dist" -type f -path '*/src/index.js' | head -n1)"
  if [[ -z "$entry" ]]; then
    die "Could not find built server entry under educlaw-server/dist"
  fi
  printf '%s' "$entry"
}

install_systemd_service() {
  local server_entry="$1"
  log "Installing systemd service: $SERVICE_NAME"

  mkdir -p "$(dirname "$RUNNER")"
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
}

install_nginx_site() {
  log "Installing nginx site"
  cat > "$NGINX_SITE" <<NGINXEOF
server {
    listen 80;
    server_name ${APP_HOST};

    root ${WEB_ROOT};
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

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
NGINXEOF

  ln -sf "$NGINX_SITE" "$NGINX_ENABLED"
  if [[ -e /etc/nginx/sites-enabled/default ]]; then
    rm -f /etc/nginx/sites-enabled/default
  fi

  nginx -t
  systemctl enable --now nginx
  systemctl reload nginx
}

verify_deploy() {
  log "Verifying deployment"
  systemctl --no-pager --full status "$SERVICE_NAME" | sed -n '1,18p'
  curl -fsS "http://127.0.0.1:${PORT}/healthz" >/dev/null
  curl -fsSI "http://127.0.0.1/" >/dev/null

  printf '\n[%s] Deployment complete\n' "$APP_NAME"
  printf '  URL:      %s\n' "$APP_ORIGIN"
  printf '  Backend:  http://127.0.0.1:%s/healthz\n' "$PORT"
  printf '  Logs:     journalctl -u %s -f\n' "$SERVICE_NAME"
}

main() {
  require_root
  cd "$PROJECT_DIR"

  APP_HOST="$(detect_app_host)"
  [[ -n "$APP_HOST" ]] || die "Set APP_HOST, for example: sudo APP_HOST=1.2.3.4 LLM_API_KEY=... bash scripts/deploy-prod.sh"

  DB_PASSWORD="${POSTGRES_PASSWORD:-$(read_env_value POSTGRES_PASSWORD "")}"
  [[ -n "$DB_PASSWORD" ]] || DB_PASSWORD="$(openssl rand -hex 16)"

  JWT_SECRET="${JWT_SECRET:-$(read_env_value JWT_SECRET "")}"
  if [[ -z "$JWT_SECRET" || "$JWT_SECRET" == "change-me" || "$JWT_SECRET" == "change-this-to-a-random-long-string" ]]; then
    JWT_SECRET="$(openssl rand -hex 32)"
  fi

  APP_ORIGIN="${APP_ORIGIN:-$(read_env_value APP_ORIGIN "http://${APP_HOST}")}"
  LLM_BASE_URL="${LLM_BASE_URL:-$(read_env_value LLM_BASE_URL "https://go8jao85pkcbchaakho5ce5chdk8ogkb.openapi-qb.sii.edu.cn/v1")}"
  LLM_API_KEY="${LLM_API_KEY:-$(read_env_value LLM_API_KEY "")}"
  LLM_MODEL="${LLM_MODEL:-$(read_env_value LLM_MODEL "Kimi-K2.6")}"
  LLM_BASELINE_MODEL="${LLM_BASELINE_MODEL:-$(read_env_value LLM_BASELINE_MODEL "$LLM_MODEL")}"

  if [[ -z "$LLM_API_KEY" || "$LLM_API_KEY" == "your-llm-api-key" ]]; then
    die "Set LLM_API_KEY before deploying. Example: sudo APP_HOST=${APP_HOST} LLM_API_KEY=xxxx bash scripts/deploy-prod.sh"
  fi

  install_system_packages
  configure_database
  write_env_file
  build_project

  local server_entry
  server_entry="$(find_server_entry)"
  install_systemd_service "$server_entry"
  install_nginx_site
  verify_deploy
}

main "$@"