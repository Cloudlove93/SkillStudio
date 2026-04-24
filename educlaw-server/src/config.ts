import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(serverRoot, "..");

function loadEnvFile() {
  const envPath = path.join(workspaceRoot, ".env");
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf-8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value.replace(/^['\"]|['\"]$/g, "");
    }
  }
}

loadEnvFile();

function readNumber(name: string, fallback: number): number {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) ? value : fallback;
}

export const config = {
  port: readNumber("PORT", 3000),
  databaseUrl: process.env.DATABASE_URL || "postgres://educlawlite:educlawlite@127.0.0.1:5435/educlawlite",
  jwtSecret: process.env.JWT_SECRET || "educlaw-lite-dev-secret",
  appOrigin: process.env.APP_ORIGIN || "http://localhost:4173",
  llmBaseUrl: (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, ""),
  llmApiKey: process.env.LLM_API_KEY || "",
  llmModel: process.env.LLM_MODEL || "gpt-4.1-mini",
  llmBaselineModel: process.env.LLM_BASELINE_MODEL || ""
};