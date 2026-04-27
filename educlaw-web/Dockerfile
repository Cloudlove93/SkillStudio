FROM node:20-slim AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.30.2 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY educlaw-shared/package.json educlaw-shared/package.json
COPY educlaw-server/package.json educlaw-server/package.json
COPY educlaw-web/package.json educlaw-web/package.json

RUN pnpm install --frozen-lockfile

COPY educlaw-shared ./educlaw-shared
COPY educlaw-web ./educlaw-web

RUN pnpm --filter @educlaw/shared build
RUN pnpm --filter educlaw-web build

FROM nginx:1.27-alpine AS runner

ENV API_UPSTREAM=http://educlaw-server:3000

COPY educlaw-web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY educlaw-web/start-nginx.sh /usr/local/bin/start-nginx.sh
COPY --from=builder /app/educlaw-web/dist /usr/share/nginx/html

RUN chmod +x /usr/local/bin/start-nginx.sh

EXPOSE 80

CMD ["/usr/local/bin/start-nginx.sh"]
