import { AsyncLocalStorage } from "node:async_hooks";
import type { Logger } from "pino";
import { logger } from "./logger.js";

interface RequestContextValue {
  requestId: string;
  logger: Logger;
}

const storage = new AsyncLocalStorage<RequestContextValue>();

export function runWithRequestContext<T>(context: RequestContextValue, callback: () => T): T {
  return storage.run(context, callback);
}

export function getRequestContext(): RequestContextValue | undefined {
  return storage.getStore();
}

export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

export function getLogger(bindings?: Record<string, unknown>): Logger {
  const activeLogger = storage.getStore()?.logger || logger;
  return bindings ? activeLogger.child(bindings) : activeLogger;
}
