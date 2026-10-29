FROM m.daocloud.io/docker.io/library/node:22-slim AS builder

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
COPY educlaw-web/nginx/sso-bootstrap.js /app/educlaw-web/dist/sso-bootstrap.js
RUN sed -i 's#</head>#<script src="/sso-bootstrap.js"></script></head>#' /app/educlaw-web/dist/index.html

FROM m.daocloud.io/docker.io/library/nginx:1.27-alpine AS runner

COPY --from=builder /app/educlaw-web/dist /usr/share/nginx/html
COPY educlaw-web/nginx/default.conf.template /etc/nginx/templates/default.conf.template

ENV NGINX_ENVSUBST_FILTER="^(API_UPSTREAM|AUTH_UPSTREAM)$"

EXPOSE 80
