FROM node:20-slim AS builder

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

COPY <<EOF /etc/nginx/conf.d/default.conf
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;
    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
EOF

EXPOSE 80
