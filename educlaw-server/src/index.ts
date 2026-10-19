import express from "express";
import cors from "cors";
import compression from "compression";
import { config } from "./config.js";
import { getLogger, getRequestId } from "./lib/request-context.js";
import { safeError } from "./lib/logger.js";
import { withRequestContext } from "./middleware/request-context.js";
import { checkDbConnection, closeDbPool } from "./services/db.js";
import { arenaRunService } from './services/arena-run-service.js';
import { createServerShutdown } from './services/server-shutdown.js';
import { createHttpDrain } from './services/http-drain.js';
import { readObjectStorageConfig } from "./config/object-storage-config.js";
import { createHealthService } from "./services/health-service.js";
import { createObjectStorageService } from "./services/object-storage/object-storage.service.js";
import { startProductionMultimodalPipelineRuntimeIfEnabled } from "./services/multimodal-pipeline-runtime.js";
import { buildInternalErrorPayload } from "./utils/http.js";
import apiRoutes from "./routes/index.js";
import compatRoutes from "./routes/compat.js";
import { createHealthRouter } from "./routes/health.js";

const app = express();
const allowedOrigins = new Set(config.appOrigins);
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has("*") || allowedOrigins.has(origin)) {
      callback(null, true);
      return;
    }
    callback(null, false);
  },
  credentials: false,
}));
app.use(withRequestContext);
const httpDrain=createHttpDrain();
app.use(httpDrain.middleware);
app.use(httpDrain.trackMiddleware(compression()));
app.use(
  "/api/actions",
  httpDrain.trackMiddleware(express.json({ limit: config.internalWorkerBodyLimit })),
);
app.use(httpDrain.trackMiddleware(express.json({ limit: config.bodyLimit })));

const objectStorageConfig = readObjectStorageConfig(process.env);
const objectStorage = objectStorageConfig
  ? createObjectStorageService({ config: objectStorageConfig })
  : null;
const healthService = createHealthService({
  checkDatabase: checkDbConnection,
  checkObjectStorage: objectStorage
    ? () => objectStorage.checkHealth()
    : undefined,
});

app.use(createHealthRouter(healthService));

app.use("/api", apiRoutes);
app.use(compatRoutes);

app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  void next;
  const requestId = getRequestId();
  getLogger().error({
    event: "request.error",
    path: req.originalUrl || req.url,
    method: req.method,
    error: safeError(err),
  }, "request.error");
  res.status(500).json(buildInternalErrorPayload(requestId));
});

await checkDbConnection();
const runtime = startProductionMultimodalPipelineRuntimeIfEnabled({
  enabled: config.multimodalPipelineRunnerEnabled,
  pollIntervalMs: config.multimodalPipelineRunnerPollIntervalMs,
  batchLimit: config.multimodalPipelineRunnerBatchLimit,
  concurrency: config.multimodalPipelineRunnerConcurrency,
});
if (runtime) {
  getLogger({
    pollIntervalMs: config.multimodalPipelineRunnerPollIntervalMs,
    batchLimit: config.multimodalPipelineRunnerBatchLimit,
    concurrency: config.multimodalPipelineRunnerConcurrency,
  }).info("multimodal.pipeline.runner.enabled");
}
const server = app.listen(config.port, () => {
  getLogger({ port: config.port }).info("server.listen");
});
const shutdown = createServerShutdown({
  beginDrain: () => { httpDrain.beginDrain(); healthService.beginDrain(); arenaRunService.beginDrain(); },
  stopBackground: () => runtime?.runner.stop(),
  waitForIdle: async () => { await Promise.all([httpDrain.waitForIdle(), arenaRunService.waitForIdle(), runtime?.runner.waitForIdle()]); },
  abortActive: () => arenaRunService.abortActive(),
  closeHttp: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  forceCloseHttp: () => server.closeAllConnections(),
  closeResources: closeDbPool,
  exit: code => process.exit(code),
  log: event => getLogger().info({event}, event),
});
for (const signal of ['SIGTERM','SIGINT'] as const) process.on(signal, () => { void shutdown(); });
