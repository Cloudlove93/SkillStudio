FROM node:22-slim AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.30.2 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY educlaw-shared/package.json educlaw-shared/package.json
COPY educlaw-server/package.json educlaw-server/package.json
COPY educlaw-web/package.json educlaw-web/package.json
COPY openagent/package.json openagent/package.json

RUN pnpm install --frozen-lockfile

COPY educlaw-shared ./educlaw-shared
COPY openagent ./openagent
COPY educlaw-web ./educlaw-web

RUN pnpm --filter @educlaw/shared build
RUN pnpm --filter educlaw-web build

FROM nginx:1.27-alpine AS runner

COPY --from=builder /app/educlaw-web/dist /usr/share/nginx/html
COPY educlaw-web/nginx/default.conf.template /etc/nginx/templates/default.conf.template

ENV NGINX_ENVSUBST_FILTER="^(API_UPSTREAM|AUTH_UPSTREAM)$"

EXPOSE 80
