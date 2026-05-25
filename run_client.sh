nvm use  v22.22.2;
cd /Users/l/other_git_repos/EduClaw-js
pnpm --filter @educlaw/shared build
kill $(lsof -nP -iTCP:5173 -sTCP:LISTEN | awk 'NR>1 {print $2}') 2>/dev/null

VITE_API_BASE=http://localhost:3000 pnpm --filter educlaw-web dev
