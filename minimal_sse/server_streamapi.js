import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.PORT || 4310);
const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(root, "public");

const sseHeaders = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  "X-Accel-Buffering": "no",
  Connection: "keep-alive",
};

function formatSseEvent(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function initSse(res) {
  res.writeHead(200, sseHeaders);
  res.flushHeaders?.();
}

function writeSseEvent(res, event, data) {
  res.write(formatSseEvent(event, data));
  res.flush?.();
}

function createSseReadableStream(onClose) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      let count = 0;
      let closed = false;

      function send(event, data) {
        if (closed) return;
        controller.enqueue(encoder.encode(formatSseEvent(event, data)));
      }

      send("ready", {
        message: "ReadableStream SSE connection established",
        at: new Date().toISOString(),
      });

      const timer = setInterval(() => {
        count += 1;
        send("tick", {
          count,
          at: new Date().toISOString(),
        });
      }, 1000);

      onClose(() => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        controller.close();
      });
    },
  });
}

async function sendWebResponse(webResponse, res) {
  res.writeHead(webResponse.status, Object.fromEntries(webResponse.headers));
  if (!webResponse.body) {
    res.end();
    return;
  }

  const reader = webResponse.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
      res.flush?.();
    }
  } finally {
    res.end();
  }
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

  if (url.pathname === "/events-response") {
    const closeHandlers = [];
    req.on("close", () => {
      for (const close of closeHandlers) close();
    });

    const response = new Response(
      createSseReadableStream((close) => closeHandlers.push(close)),
      { headers: sseHeaders },
    );
    void sendWebResponse(response, res);
    return;
  }

  void serveStatic(req, res);
});

server.listen(port, () => {
  console.log(`minimal_sse listening on http://localhost:${port}`);
});
