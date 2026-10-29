# ---- Build Stage ----
FROM m.daocloud.io/docker.io/library/node:20-slim AS builder
RUN corepack enable && corepack prepare pnpm@10.30.2 --activate
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY auth-backend/package.json auth-backend/package.json
RUN pnpm config set registry https://registry.npmmirror.com && pnpm install --frozen-lockfile
COPY auth-backend/ auth-backend/
RUN pnpm --filter auth-backend build

# ---- Production Stage ----
FROM m.daocloud.io/docker.io/library/node:20-slim
RUN corepack enable && corepack prepare pnpm@10.30.2 --activate
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY auth-backend/package.json auth-backend/package.json
COPY --from=builder /app/auth-backend/dist ./auth-backend/dist
RUN pnpm config set registry https://registry.npmmirror.com && pnpm install --frozen-lockfile --prod
WORKDIR /app/auth-backend
EXPOSE 3000
CMD ["node", "dist/index.js"]
