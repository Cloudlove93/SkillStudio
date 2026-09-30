FROM node:22-slim AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.30.2 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY educlaw-shared/package.json educlaw-shared/package.json
COPY educlaw-server/package.json educlaw-server/package.json

RUN pnpm install --frozen-lockfile

COPY educlaw-shared ./educlaw-shared
COPY educlaw-server ./educlaw-server

RUN pnpm --filter @educlaw/shared build
RUN pnpm --filter educlaw-server build

FROM node:22-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

RUN corepack enable && corepack prepare pnpm@10.30.2 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY educlaw-shared/package.json educlaw-shared/package.json
COPY educlaw-server/package.json educlaw-server/package.json
COPY educlaw-web/package.json educlaw-web/package.json
COPY openagent/package.json openagent/package.json
COPY --from=builder /app/node_modules/.pnpm ./node_modules/.pnpm
COPY --from=builder /app/educlaw-shared ./educlaw-shared

RUN pnpm --filter educlaw-server... install --prod --offline --frozen-lockfile

RUN set -eux; \
    mkdir -p node_modules/@educlaw node_modules/@aws-sdk; \
    for dep in adm-zip bcryptjs compression cors express ipaddr.js jsonrepair jsonwebtoken multer pg pino pino-caller source-map-support; do \
      ln -s "../educlaw-server/node_modules/$dep" "node_modules/$dep"; \
    done; \
    for sdk in client-s3 s3-request-presigner; do \
      ln -s "../../educlaw-server/node_modules/@aws-sdk/$sdk" "node_modules/@aws-sdk/$sdk"; \
    done; \
    ln -s "../../educlaw-server/node_modules/@educlaw/shared" "node_modules/@educlaw/shared"

COPY --from=builder /app/educlaw-server/dist ./dist
COPY --from=builder /app/educlaw-server/package.json ./package.json

EXPOSE 3000

CMD ["node", "dist/educlaw-server/src/index.js"]
