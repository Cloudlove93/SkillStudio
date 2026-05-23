import express from "express";
import cors from "cors";
import compression from "compression";
import { config } from "./config.js";
import { initDb } from "./services/db.js";
import { seedUsers } from "./services/auth-service.js";
import authRoutes from "./routes/auth.js";
import packageRoutes from "./routes/packages.js";
import arenaRoutes from "./routes/arena.js";
import compatRoutes from "./routes/compat.js";
import autoEvalRoutes from "./routes/auto-eval.js";

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

app.use("/api/auth", authRoutes);
app.use("/api/packages", packageRoutes);
app.use("/api/arena", arenaRoutes);
app.use("/api/auto-eval", autoEvalRoutes);
app.use(compatRoutes);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
});

await initDb();
await seedUsers();
app.listen(config.port, () => {
  console.log(`EduClaw Lite server listening on :${config.port}`);
});
