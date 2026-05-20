import express, { Router } from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const port = Number(process.env.PORT || 4320);
const root = dirname(fileURLToPath(import.meta.url));
const publicDir = join(root, "public");

const app = express();
const router = Router();

const threads = [
  {
    id: "thread-1",
    packageId: "package-alpha",
    title: "First router thread",
    createdAt: new Date().toISOString(),
  },
  {
    id: "thread-2",
    packageId: "package-beta",
    title: "Second router thread",
    createdAt: new Date().toISOString(),
  },
];

app.use(express.json());
app.use(express.static(publicDir));

router.get("/threads", async (req, res) => {
  // `/api/threads?packageId=${encodeURIComponent(packageId)}`
  const packageId = String(req.query.packageId || "");
  if (!packageId) {
    res.status(400).json({ error: "Missing packageId" });
    return;
  }

  res.json(threads.filter((thread) => thread.packageId === packageId));
});

router.post("/threads", async (req, res) => {
  try {
    const packageId = String(req.body?.packageId || "").trim();
    const title = String(req.body?.title || "New router thread").trim();
    if (!packageId) {
      res.status(400).json({ error: "Missing packageId" });
      return;
    }

    const thread = {
      id: `thread-${Date.now()}`,
      packageId,
      title,
      createdAt: new Date().toISOString(),
    };
    threads.unshift(thread);
    res.status(201).json(thread);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to create thread" });
  }
});

router.get("/threads/:threadId", async (req, res) => {
  const thread = threads.find((item) => item.id === req.params.threadId);
  if (!thread) {
    res.status(404).json({ error: "Thread not found" });
    return;
  }

  res.json(thread);
});

app.use("/api", router);

app.use((err, _req, res, _next) => {
  res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
});

app.listen(port, () => {
  console.log(`minimal_express_router listening on http://localhost:${port}`);
});
