import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };
const CONFIG_ENV_KEYS = [
  "NODE_ENV",
  "PORT",
  "BODY_LIMIT",
  "LLM_TIMEOUT_MS",
  "DATABASE_URL",
  "APP_ORIGIN",
  "UPLOAD_LIMIT_MB",
  "LLM_BASE_URL",
  "LLM_API_KEY",
  "LLM_MODEL",
  "LLM_NETWORK_RETRIES",
  "LLM_BASELINE_MODEL",
  "MULTIMODAL_ADLER_MODEL",
  "MULTIMODAL_CANDIDATE_MODEL",
  "MULTIMODAL_VALIDATION_MODEL",
  "MULTIMODAL_RIA_MODEL",
  "MULTIMODAL_VISION_MODEL",
  "MULTIMODAL_MODEL_MAX_TOKENS",
  "MULTIMODAL_ASR_CHUNK_DURATION_MS",
  "MULTIMODAL_UPLOAD_MAX_MB",
  "MULTIMODAL_SINGLE_PUT_MAX_MB",
  "MULTIMODAL_MULTIPART_PART_MB",
  "MEDIA_UPLOAD_TOKEN_SECRET",
  "INTERNAL_WORKER_TOKENS",
  "MULTIMODAL_PIPELINE_RUNNER_ENABLED",
  "MULTIMODAL_PIPELINE_RUNNER_POLL_INTERVAL_MS",
  "MULTIMODAL_PIPELINE_RUNNER_BATCH_LIMIT",
  "MULTIMODAL_PIPELINE_RUNNER_CONCURRENCY",
];

const DEFAULT_LOCAL_DATABASE_URL = "postgres://educlawlite:local-dev-password@127.0.0.1:5435/educlawlite";

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
    expect(config.port).toBe(3001);
    expect(config.bodyLimit).toBe("2mb");
    expect(config.internalWorkerBodyLimit).toBe("32mb");
    expect(config.llmTimeoutMs).toBe(300_000);
    expect(config.databaseUrl).toBe(DEFAULT_LOCAL_DATABASE_URL);
    expect(config.appOrigin).toBe("http://localhost:4173");
    expect(config.appOrigins).toEqual(["http://localhost:4173"]);
    expect(config.uploadLimitBytes).toBe(25 * 1024 * 1024);
    expect(config.llmBaseUrl).toBe("https://api.openai.com/v1");
    expect(config.llmApiKey).toBe("");
    expect(config.llmModel).toBe("gpt-4.1-mini");
    expect(config.llmNetworkRetries).toBe(2);
    expect(config.llmBaselineModel).toBe("");
    expect(config.multimodalAdlerModel).toBe("");
    expect(config.multimodalCandidateModel).toBe("");
    expect(config.multimodalValidationModel).toBe("");
    expect(config.multimodalRiaModel).toBe("");
    expect(config.multimodalVisionModel).toBe("");
    expect(config.multimodalModelMaxTokens).toBe(8192);
    expect(config.multimodalAsrChunkDurationMs).toBe(1_200_000);
    expect(config.multimodalUploadMaxBytes).toBe(1024 * 1024 * 1024);
    expect(config.multimodalSinglePutMaxBytes).toBe(256 * 1024 * 1024);
    expect(config.multimodalMultipartPartBytes).toBe(64 * 1024 * 1024);
    expect(config.mediaUploadTokenSecret).toBe("");
    expect(config.multimodalPipelineRunnerEnabled).toBe(false);
    expect(config.multimodalPipelineRunnerPollIntervalMs).toBe(15000);
    expect(config.multimodalPipelineRunnerBatchLimit).toBe(8);
    expect(config.multimodalPipelineRunnerConcurrency).toBe(2);
  });

  it("parses numbers, booleans, lists, and trims the LLM base URL", async () => {
    const config = await loadConfig({
      env: {
        PORT: "4001",
        LLM_TIMEOUT_MS: "1500",
        APP_ORIGIN: "http://localhost:5173, https://example.test ",
        UPLOAD_LIMIT_MB: "3",
        LLM_BASE_URL: "https://llm.example.test/v1///",
        LLM_NETWORK_RETRIES: "5",
        MULTIMODAL_ADLER_MODEL: "adler-model",
        MULTIMODAL_CANDIDATE_MODEL: "candidate-model",
        MULTIMODAL_VALIDATION_MODEL: "validation-model",
        MULTIMODAL_RIA_MODEL: "ria-model",
        MULTIMODAL_VISION_MODEL: "kimi-k2.5",
        MULTIMODAL_MODEL_MAX_TOKENS: "4096",
        MULTIMODAL_ASR_CHUNK_DURATION_MS: "900000",
        MULTIMODAL_UPLOAD_MAX_MB: "2048",
        MULTIMODAL_SINGLE_PUT_MAX_MB: "512",
        MULTIMODAL_MULTIPART_PART_MB: "96",
        MEDIA_UPLOAD_TOKEN_SECRET: "test-upload-token-secret-value-0123456789",
        MULTIMODAL_PIPELINE_RUNNER_ENABLED: "true",
        MULTIMODAL_PIPELINE_RUNNER_POLL_INTERVAL_MS: "30000",
        MULTIMODAL_PIPELINE_RUNNER_BATCH_LIMIT: "12",
        MULTIMODAL_PIPELINE_RUNNER_CONCURRENCY: "4",
      },
    });

    expect(config.port).toBe(4001);
    expect(config.llmTimeoutMs).toBe(1500);
    expect(config.appOrigins).toEqual(["http://localhost:5173", "https://example.test"]);
    expect(config.uploadLimitBytes).toBe(3 * 1024 * 1024);
    expect(config.llmBaseUrl).toBe("https://llm.example.test/v1");
    expect(config.llmNetworkRetries).toBe(5);
    expect(config.multimodalAdlerModel).toBe("adler-model");
    expect(config.multimodalCandidateModel).toBe("candidate-model");
    expect(config.multimodalValidationModel).toBe("validation-model");
    expect(config.multimodalRiaModel).toBe("ria-model");
    expect(config.multimodalVisionModel).toBe("kimi-k2.5");
    expect(config.multimodalModelMaxTokens).toBe(4096);
    expect(config.multimodalAsrChunkDurationMs).toBe(900_000);
    expect(config.multimodalUploadMaxBytes).toBe(2048 * 1024 * 1024);
    expect(config.multimodalSinglePutMaxBytes).toBe(512 * 1024 * 1024);
    expect(config.multimodalMultipartPartBytes).toBe(96 * 1024 * 1024);
    expect(config.mediaUploadTokenSecret).toBe(
      "test-upload-token-secret-value-0123456789",
    );
    expect(config.multimodalPipelineRunnerEnabled).toBe(true);
    expect(config.multimodalPipelineRunnerPollIntervalMs).toBe(30000);
    expect(config.multimodalPipelineRunnerBatchLimit).toBe(12);
    expect(config.multimodalPipelineRunnerConcurrency).toBe(4);
  });

  it("falls back when numeric environment values are invalid", async () => {
    const config = await loadConfig({
      env: {
        PORT: "not-a-number",
        LLM_TIMEOUT_MS: "NaN",
        UPLOAD_LIMIT_MB: "bad",
        MULTIMODAL_MODEL_MAX_TOKENS: "0",
        MULTIMODAL_UPLOAD_MAX_MB: "0",
        MULTIMODAL_SINGLE_PUT_MAX_MB: "NaN",
        MULTIMODAL_MULTIPART_PART_MB: "3",
        MULTIMODAL_PIPELINE_RUNNER_POLL_INTERVAL_MS: "Infinity",
        MULTIMODAL_PIPELINE_RUNNER_BATCH_LIMIT: "0",
        MULTIMODAL_PIPELINE_RUNNER_CONCURRENCY: "oops",
      },
    });

    expect(config.port).toBe(3001);
    expect(config.llmTimeoutMs).toBe(300_000);
    expect(config.uploadLimitBytes).toBe(25 * 1024 * 1024);
    expect(config.multimodalModelMaxTokens).toBe(8192);
    expect(config.multimodalUploadMaxBytes).toBe(1024 * 1024 * 1024);
    expect(config.multimodalSinglePutMaxBytes).toBe(256 * 1024 * 1024);
    expect(config.multimodalMultipartPartBytes).toBe(64 * 1024 * 1024);
    expect(config.multimodalPipelineRunnerPollIntervalMs).toBe(15000);
    expect(config.multimodalPipelineRunnerBatchLimit).toBe(8);
    expect(config.multimodalPipelineRunnerConcurrency).toBe(2);
  });

  it("loads values from .env without overriding existing process env", async () => {
    const config = await loadConfig({
      env: {
        APP_ORIGIN: "http://from-process-env.test",
      },
      envFile: [
        "APP_ORIGIN=http://from-dot-env.test",
        "DATABASE_URL='postgres://from-env-file'",
      ].join("\n"),
    });

    expect(config.appOrigin).toBe("http://from-process-env.test");
    expect(config.databaseUrl).toBe("postgres://from-env-file");
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

  it("requires a strong media upload token secret in production", async () => {
    await expect(loadConfig({
      env: {
        NODE_ENV: "production",
        DATABASE_URL: "postgres://prod-user:prod-secret-password@db.example.com:5432/educlaw",
        LLM_API_KEY: "valid-production-llm-api-key",
      },
    })).rejects.toThrow(
      "MEDIA_UPLOAD_TOKEN_SECRET must be set to a strong production value",
    );
  });

  it("requires strong internal worker tokens in production", async () => {
    await expect(loadConfig({
      env: {
        NODE_ENV: "production",
        DATABASE_URL: "postgres://prod-user:prod-secret-password@db.example.com:5432/educlaw",
        LLM_API_KEY: "valid-production-llm-api-key",
        MEDIA_UPLOAD_TOKEN_SECRET: "media-upload-secret-that-is-long-enough",
        INTERNAL_WORKER_TOKENS: "short-token",
      },
    })).rejects.toThrow(
      "INTERNAL_WORKER_TOKENS must contain only strong production values",
    );
  });

});
