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

const app = express();
app.use(cors({ origin: config.appOrigin, credentials: false }));
app.use(compression());
app.use(express.json({ limit: "8mb" }));

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, service: "educlaw-lite-server" });
});

app.use("/api/auth", authRoutes);
app.use("/api/packages", packageRoutes);
app.use("/api/arena", arenaRoutes);
app.use(compatRoutes);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
});

await initDb();
await seedUsers();
app.listen(config.port, () => {
  console.log(`EduClaw Lite server listening on :${config.port}`);
});
