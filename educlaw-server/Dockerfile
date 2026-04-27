FROM node:20-slim AS builder

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

FROM node:20-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/educlaw-server/dist ./dist
COPY --from=builder /app/educlaw-server/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/educlaw-server/node_modules ./node_modules
COPY --from=builder /app/educlaw-shared ./node_modules/@educlaw/shared

EXPOSE 3000

CMD ["node", "dist/index.js"]
