import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_ENV_NAMES = ["LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL"] as const;

export interface SpikeLlmConfig {
  baseUrl: string;
  modelId: string;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  const first = trimmed.at(0);
  const last = trimmed.at(-1);
  return first && first === last && (first === '"' || first === "'")
    ? trimmed.slice(1, -1)
    : trimmed;
}

function parseSelectedEnv(text: string): Map<string, string> {
  const selected = new Map<string, string>();
  for (const line of text.split(/\r?\n/u)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/u.exec(line);
    if (match && ROOT_ENV_NAMES.includes(match[1] as (typeof ROOT_ENV_NAMES)[number])) {
      selected.set(match[1], unquote(match[2] ?? ""));
    }
  }
  return selected;
}

function repoRoot(): string {
  const sourceDir = dirname(fileURLToPath(import.meta.url));
  return resolve(sourceDir, "../../..");
}

export async function loadEduclawLlmEnvironment(): Promise<void> {
  const text = await readFile(resolve(repoRoot(), ".env"), "utf8");
  const selected = parseSelectedEnv(text);
  for (const name of ROOT_ENV_NAMES) {
    if (!process.env[name] && selected.get(name)) {
      process.env[name] = selected.get(name);
    }
  }
}

export function readSpikeLlmConfig(): SpikeLlmConfig {
  const baseUrl = process.env.LLM_BASE_URL?.trim().replace(/\/+$/u, "") ?? "";
  const modelId = process.env.LLM_MODEL?.trim() ?? "";
  if (!process.env.LLM_API_KEY?.trim() || !baseUrl || !modelId) {
    throw new Error("SPIKE_PROVIDER_CONFIG_MISSING");
  }
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("SPIKE_PROVIDER_BASE_URL_INVALID");
  }
  return { baseUrl, modelId };
}
