# ---- Build Stage ----
FROM m.daocloud.io/docker.io/library/node:20-slim AS builder

ARG VITE_API_BASE

RUN corepack enable && corepack prepare pnpm@10.30.2 --activate
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY auth-frontend/package.json auth-frontend/package.json
RUN pnpm config set registry https://registry.npmmirror.com && pnpm install --frozen-lockfile
COPY auth-frontend/ auth-frontend/
RUN pnpm --filter auth-frontend build

# ---- Production Stage ----
FROM m.daocloud.io/docker.io/library/nginx:1.27-alpine

ENV API_UPSTREAM=http://auth-backend:3000

COPY --from=builder /app/auth-frontend/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=builder /app/auth-frontend/start-nginx.sh /usr/local/bin/start-nginx.sh
COPY --from=builder /app/auth-frontend/dist /usr/share/nginx/html

RUN sed -i 's/\r$//' /usr/local/bin/start-nginx.sh && chmod +x /usr/local/bin/start-nginx.sh

EXPOSE 80

CMD ["/usr/local/bin/start-nginx.sh"]
