import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };
const CONFIG_ENV_KEYS = [
  "NODE_ENV",
  "PORT",
  "BODY_LIMIT",
  "LLM_TIMEOUT_MS",
  "DATABASE_URL",
  "APP_ORIGIN",
  "SEED_USERS",
  "SEED_USER_NAMES",
  "SEED_USER_PASSWORD",
  "UPLOAD_LIMIT_MB",
  "LLM_BASE_URL",
  "LLM_API_KEY",
  "LLM_MODEL",
  "LLM_NETWORK_RETRIES",
  "LLM_BASELINE_MODEL",
];

const DEFAULT_LOCAL_DATABASE_URL = "postgres://educlawlite:local-dev-password@127.0.0.1:5435/educlawlite";
const DEFAULT_LOCAL_SEED_PASSWORD = "local-dev-seed-password-not-for-production";

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
}

async function loadConfig(options: {
  env?: Record<string, string | undefined>;
  envFile?: string;
  envLocalFile?: string;
} = {}) {
  vi.resetModules();
  restoreEnv();
  for (const key of CONFIG_ENV_KEYS) {
    delete process.env[key];
  }
  Object.assign(process.env, options.env || {});

  vi.doMock("node:fs", () => ({
    default: {
      existsSync: (filePath: string) => {
        if (filePath.endsWith(".env.local")) return options.envLocalFile != null;
        if (filePath.endsWith(".env")) return options.envFile != null;
        return false;
      },
      readFileSync: (filePath: string) => {
        if (filePath.endsWith(".env.local")) return options.envLocalFile || "";
        if (filePath.endsWith(".env")) return options.envFile || "";
        return "";
      },
    },
    existsSync: (filePath: string) => {
      if (filePath.endsWith(".env.local")) return options.envLocalFile != null;
      if (filePath.endsWith(".env")) return options.envFile != null;
      return false;
    },
    readFileSync: (filePath: string) => {
      if (filePath.endsWith(".env.local")) return options.envLocalFile || "";
      if (filePath.endsWith(".env")) return options.envFile || "";
      return "";
    },
  }));

  return (await import("./config.js")).config;
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("node:fs");
  restoreEnv();
});

describe("config", () => {
  it("uses development defaults when no environment is provided", async () => {
    const config = await loadConfig();

    expect(config.isProduction).toBe(false);
    expect(config.port).toBe(3000);
    expect(config.bodyLimit).toBe("100mb");
    expect(config.llmTimeoutMs).toBe(300_000);
    expect(config.databaseUrl).toBe(DEFAULT_LOCAL_DATABASE_URL);
    expect(config.appOrigin).toBe("http://localhost:4173");
    expect(config.appOrigins).toEqual(["http://localhost:4173"]);
    expect(config.seedUsers).toBe(true);
    expect(config.seedUserNames).toHaveLength(15);
    expect(config.seedUserPassword).toBe(DEFAULT_LOCAL_SEED_PASSWORD);
    expect(config.uploadLimitBytes).toBe(25 * 1024 * 1024);
    expect(config.llmBaseUrl).toBe("https://api.openai.com/v1");
    expect(config.llmApiKey).toBe("");
    expect(config.llmModel).toBe("gpt-4.1-mini");
    expect(config.llmNetworkRetries).toBe(2);
    expect(config.llmBaselineModel).toBe("");
  });

  it("parses numbers, booleans, lists, and trims the LLM base URL", async () => {
    const config = await loadConfig({
      env: {
        PORT: "4001",
        LLM_TIMEOUT_MS: "1500",
        APP_ORIGIN: "http://localhost:5173, https://example.test ",
        SEED_USERS: "false",
        SEED_USER_NAMES: "alice, bob,,",
        UPLOAD_LIMIT_MB: "3",
        LLM_BASE_URL: "https://llm.example.test/v1///",
        LLM_NETWORK_RETRIES: "5",
      },
    });

    expect(config.port).toBe(4001);
    expect(config.llmTimeoutMs).toBe(1500);
    expect(config.appOrigins).toEqual(["http://localhost:5173", "https://example.test"]);
    expect(config.seedUsers).toBe(false);
    expect(config.seedUserNames).toEqual(["alice", "bob"]);
    expect(config.uploadLimitBytes).toBe(3 * 1024 * 1024);
    expect(config.llmBaseUrl).toBe("https://llm.example.test/v1");
    expect(config.llmNetworkRetries).toBe(5);
  });

  it("falls back when numeric environment values are invalid", async () => {
    const config = await loadConfig({
      env: {
        PORT: "not-a-number",
        LLM_TIMEOUT_MS: "NaN",
        UPLOAD_LIMIT_MB: "bad",
      },
    });

    expect(config.port).toBe(3000);
    expect(config.llmTimeoutMs).toBe(300_000);
    expect(config.uploadLimitBytes).toBe(25 * 1024 * 1024);
  });

  it("loads values from .env without overriding existing process env", async () => {
    const config = await loadConfig({
      env: {
        APP_ORIGIN: "http://from-process-env.test",
      },
      envFile: [
        "APP_ORIGIN=http://from-dot-env.test",
        "DATABASE_URL='postgres://from-env-file'",
        "SEED_USERS=yes",
        "SEED_USER_NAMES=env1,env2",
      ].join("\n"),
    });

    expect(config.appOrigin).toBe("http://from-process-env.test");
    expect(config.databaseUrl).toBe("postgres://from-env-file");
    expect(config.seedUsers).toBe(true);
    expect(config.seedUserNames).toEqual(["env1", "env2"]);
  });

  it("prefers .env.local over .env when both exist", async () => {
    const config = await loadConfig({
      envFile: [
        "LLM_MODEL=from-dot-env",
        "DATABASE_URL=postgres://from-dot-env",
      ].join("\n"),
      envLocalFile: [
        "LLM_MODEL=from-dot-env-local",
        "DATABASE_URL=postgres://from-dot-env-local",
      ].join("\n"),
    });

    expect(config.llmModel).toBe("from-dot-env-local");
    expect(config.databaseUrl).toBe("postgres://from-dot-env-local");
  });

  it("requires an LLM API key in production", async () => {
    await expect(loadConfig({
      env: {
        NODE_ENV: "production",
        DATABASE_URL: "postgres://prod-user:prod-secret-password@db.example.com:5432/educlaw",
      },
    })).rejects.toThrow("LLM_API_KEY must be set before starting production");
  });

  it("rejects placeholder database urls in production", async () => {
    await expect(loadConfig({
      env: {
        NODE_ENV: "production",
        LLM_API_KEY: "valid-test-key",
      },
    })).rejects.toThrow("DATABASE_URL must be set to a strong production value");
  });

  it("rejects placeholder seed passwords when seeded users are enabled in production", async () => {
    await expect(loadConfig({
      env: {
        NODE_ENV: "production",
        DATABASE_URL: "postgres://prod-user:prod-secret-password@db.example.com:5432/educlaw",
        LLM_API_KEY: "valid-test-key",
        SEED_USERS: "true",
      },
    })).rejects.toThrow("SEED_USER_PASSWORD must be set to a strong production value");
  });
});
