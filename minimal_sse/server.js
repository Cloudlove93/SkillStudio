import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.PORT || 4310);
const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(root, "public");

function initSse(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
    Connection: "keep-alive",
  });
  res.flushHeaders?.();
}

function writeSseEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  // data
  // Object {count: 386, at: "2026-05-20T12:56:35.583Z"}
  res.write(`data: ${JSON.stringify(data)}\n\n`);
  res.flush?.();
}

async function serveStatic(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = join(publicDir, pathname);

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    res.writeHead(200, { "Content-Type": contentType(filePath) });
    res.end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
}

function contentType(filePath) {
  switch (extname(filePath)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/events") {
    initSse(res);

    let count = 0;
    writeSseEvent(res, "ready", {
      message: "SSE connection established",
      at: new Date().toISOString(),
    });

    const timer = setInterval(() => {
      count += 1;
      writeSseEvent(res, "tick", {
        count,
        at: new Date().toISOString(),
      });
    }, 1000);

    req.on("close", () => {
      clearInterval(timer);
    });
    return;
  }

  void serveStatic(req, res);
});

server.listen(port, () => {
  console.log(`minimal_sse listening on http://localhost:${port}`);
});
