import express from "express";
import cors from "cors";
import compression from "compression";
import { config } from "./config.js";
import { initDb } from "./services/db.js";
import { seedUsers } from "./services/auth-service.js";
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
app.use(compression());
app.use(express.json({ limit: config.bodyLimit }));

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, service: "educlaw-lite-server" });
});

app.use("/api", apiRoutes);
app.use(compatRoutes);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
});

await initDb();
await seedUsers();
app.listen(config.port, () => {
  console.log(`EduClaw Lite server listening on :${config.port}`);
});
