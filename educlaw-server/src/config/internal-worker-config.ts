export interface InternalWorkerConfig {
  readonly tokens: readonly string[];
}

export function readInternalWorkerConfig(
  env: NodeJS.ProcessEnv = process.env,
): InternalWorkerConfig {
  const rawTokens = env.INTERNAL_WORKER_TOKENS ?? '';
  const tokens = rawTokens
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  return { tokens };
}
