import express from "express";
import cors from "cors";
import compression from "compression";
import { config } from "./config.js";
import { getLogger, getRequestId } from "./lib/request-context.js";
import { safeError } from "./lib/logger.js";
import { withRequestContext } from "./middleware/request-context.js";
import { checkDbConnection } from "./services/db.js";
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
app.use(compression());
app.use(
  "/api/actions",
  express.json({ limit: config.internalWorkerBodyLimit }),
);
app.use(express.json({ limit: config.bodyLimit }));

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
app.listen(config.port, () => {
  getLogger({ port: config.port }).info("server.listen");
});
