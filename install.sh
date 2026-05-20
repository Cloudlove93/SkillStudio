nvm use  v22.22.2;
cp .env.example .env;
pnpm install;
docker compose up -d educlaw-postgres;
pnpm --filter @educlaw/shared build;