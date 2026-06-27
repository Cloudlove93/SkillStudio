import "source-map-support/register.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pino, { type Logger } from "pino";
import pinoCallerModule from "pino-caller";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, "..", "..");

const rootLogger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug"),
  redact: {
    paths: [
      "authorization",
      "headers.authorization",
      "req.headers.authorization",
      "token",
      "password",
      "password_hash",
      "jwt",
      "apiKey",
      "llmApiKey",
    ],
    censor: "[redacted]",
  },
});

const pinoCaller = pinoCallerModule as unknown as (
  logger: Logger,
  options?: { relativeTo?: string; stackAdjustment?: number },
) => Logger;

export const logger: Logger = process.env.NODE_ENV === "development"
  ? pinoCaller(rootLogger, { relativeTo: serverRoot })
  : rootLogger;

export function safeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return { message: String(error) };
}

export function truncateForLog(value: string, maxLength = 1000): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...(truncated ${value.length - maxLength} chars)`;
}
