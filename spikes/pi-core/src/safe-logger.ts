import type { SafeEventRecord } from "./types.js";

export type SafeLogFields = Record<string, boolean | number | string | null>;

export function logSafeEvent(
  event: string,
  runId: string,
  fields?: SafeLogFields,
): void {
  const record: SafeEventRecord = {
    event,
    runId,
    timestamp: new Date().toISOString(),
    ...(fields ? { fields } : {}),
  };
  process.stdout.write(`${JSON.stringify(record)}\n`);
}
