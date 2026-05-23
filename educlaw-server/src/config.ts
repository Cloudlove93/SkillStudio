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

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
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
const jwtSecret = process.env.JWT_SECRET || "educlaw-lite-dev-secret";
const llmApiKey = process.env.LLM_API_KEY || "";

assertProductionConfig("JWT_SECRET", jwtSecret, [
  "change-me",
  "change-me-in-production",
  "change-this-to-a-random-long-string",
  "educlaw-lite-dev-secret",
]);
if (isProduction && (!llmApiKey || llmApiKey === "your-llm-api-key" || llmApiKey === "换成你新的可用key")) {
  throw new Error("LLM_API_KEY must be set before starting production");
}

export const config = {
  isProduction,
  port: readNumber("PORT", 3000),
  bodyLimit: process.env.BODY_LIMIT || "100mb",
  llmTimeoutMs: readNumber("LLM_TIMEOUT_MS", 300_000),
  databaseUrl: process.env.DATABASE_URL || "postgres://educlawlite:educlawlite@127.0.0.1:5435/educlawlite",
  jwtSecret,
  appOrigin: process.env.APP_ORIGIN || "http://localhost:4173",
  appOrigins: readList("APP_ORIGIN", ["http://localhost:4173"]),
  seedUsers: readBoolean("SEED_USERS", !isProduction),
  seedUserNames: readList("SEED_USER_NAMES", [
    "user1", "user2", "user3", "user4", "user5",
    "user6", "user7", "user8", "user9", "user10",
    "user11", "user12", "user13", "user14", "user15",
  ]),
  seedUserPassword: process.env.SEED_USER_PASSWORD || "educlaw123",
  uploadLimitBytes: readNumber("UPLOAD_LIMIT_MB", 25) * 1024 * 1024,
  llmBaseUrl: (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, ""),
  llmApiKey,
  llmModel: process.env.LLM_MODEL || "gpt-4.1-mini",
  llmNetworkRetries: readNumber("LLM_NETWORK_RETRIES", 2),
  llmBaselineModel: process.env.LLM_BASELINE_MODEL || "",
  conversationEvalBaseUrl: (process.env.CONVERSATION_EVAL_BASE_URL || "http://127.0.0.1:8090").replace(/\/+$/, ""),
  conversationEvalScenesDir: process.env.CONVERSATION_EVAL_SCENES_DIR || path.join(workspaceRoot, ".eval-scenes"),
};
