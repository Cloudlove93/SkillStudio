import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(serverRoot, "..");

const DEFAULT_LOCAL_DATABASE_URL = "postgres://educlawlite:local-dev-password@127.0.0.1:5435/educlawlite";
function loadEnvFile(fileName: string) {
  const envPath = path.join(workspaceRoot, fileName);
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
      process.env[key] = value.replace(/^['"]|['"]$/g, "");
    }
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env");

function readNumber(name: string, fallback: number): number {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) ? value : fallback;
}

function readList(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  const value = raw == null || raw.trim() === "" ? fallback.join(",") : raw;
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function assertProductionConfig(name: string, value: string, invalidValues: string[] = []) {
  if (process.env.NODE_ENV !== "production") return;
  if (!value || invalidValues.includes(value) || value.length < 32) {
    throw new Error(`${name} must be set to a strong production value`);
  }
}

const isProduction = process.env.NODE_ENV === "production";
const llmApiKey = process.env.LLM_API_KEY || "";
const databaseUrl = process.env.DATABASE_URL || DEFAULT_LOCAL_DATABASE_URL;
assertProductionConfig("DATABASE_URL", databaseUrl, [
  "postgres://educlawlite:educlawlite@127.0.0.1:5435/educlawlite",
  DEFAULT_LOCAL_DATABASE_URL,
]);
if (isProduction && (!llmApiKey || llmApiKey === "your-llm-api-key" || llmApiKey === "replace-with-a-real-api-key")) {
  throw new Error("LLM_API_KEY must be set before starting production");
}

export const config = {
  isProduction,
  port: readNumber("PORT", 3001),
  bodyLimit: process.env.BODY_LIMIT || "100mb",
  llmTimeoutMs: readNumber("LLM_TIMEOUT_MS", 300_000),
  databaseUrl,
  appOrigin: process.env.APP_ORIGIN || "http://localhost:4173",
  appOrigins: readList("APP_ORIGIN", ["http://localhost:4173"]),
  uploadLimitBytes: readNumber("UPLOAD_LIMIT_MB", 25) * 1024 * 1024,
  llmBaseUrl: (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, ""),
  llmApiKey,
  llmModel: process.env.LLM_MODEL || "gpt-4.1-mini",
  llmNetworkRetries: readNumber("LLM_NETWORK_RETRIES", 2),
  llmBaselineModel: process.env.LLM_BASELINE_MODEL || "",
  conversationEvalBaseUrl: (process.env.CONVERSATION_EVAL_BASE_URL || "http://127.0.0.1:8090").replace(/\/+$/, ""),
  conversationEvalScenesDir: process.env.CONVERSATION_EVAL_SCENES_DIR || path.join(workspaceRoot, ".eval-scenes"),
};
