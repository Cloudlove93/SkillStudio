import express from "express";
import cors from "cors";
import compression from "compression";
import { config } from "./config.js";
import { getLogger } from "./lib/request-context.js";
import { safeError } from "./lib/logger.js";
import { withRequestContext } from "./middleware/request-context.js";
import { initDb } from "./services/db.js";
import apiRoutes from "./routes/index.js";
import compatRoutes from "./routes/compat.js";

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
app.use(express.json({ limit: config.bodyLimit }));

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, service: "educlaw-lite-server" });
});

app.use("/api", apiRoutes);
app.use(compatRoutes);

app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  void next;
  getLogger().error({
    event: "request.error",
    path: req.originalUrl || req.url,
    method: req.method,
    error: safeError(err),
  }, "request.error");
  res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
});

await initDb();
app.listen(config.port, () => {
  getLogger({ port: config.port }).info("server.listen");
});
