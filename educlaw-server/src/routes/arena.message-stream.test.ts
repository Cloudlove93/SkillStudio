import type { Server } from "node:http";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

const streamMessageMock = vi.fn();

it('requires an Agent snapshot for new conversations on the old thread URL', async () => {
  const { server, url } = await listen(await createApp());
  try {
    const response = await fetch(url + '/api/arena/threads/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId: '7' }),
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: 'AGENT_REQUIRED', nextUrl: '/agents',
    });
  } finally {
    await close(server);
  }
});

async function createApp(userId: string | null = "user-1", draining = false) {
  vi.resetModules();
  vi.doMock("../services/arena-service.js", () => ({
    createThread: vi.fn(),
    generateReport: vi.fn(),
    getThreadDetail: vi.fn(),
    listThreads: vi.fn(),
    sendMessage: vi.fn(),
    streamMessage: streamMessageMock,
  }));

  const router = (await import("./arena.js")).default;
  const app = express();
  const drain=(await import('../services/http-drain.js')).createHttpDrain();
  if(draining)drain.beginDrain();
  app.use(drain.middleware);
  app.use(express.json());
  app.use((req, _res, next) => {
    if (userId) req.headers["x-user-id"] = userId;
    next();
  });
  app.use('/api', router);
  return app;
}

async function listen(app: express.Express): Promise<{ server: Server; url: string }> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected server to listen on a TCP port");
  }
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function close(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function postMessage(thinkingEnabled: unknown, path: string) {
  const { server, url } = await listen(await createApp());
  try {
    const response = await fetch(
      `${url}${path}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: "请回答",
          mode: "agent",
          thinkingEnabled,
        }),
      },
    );
    const body = await response.text();
    return { response, body };
  } finally {
    await close(server);
  }
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("../services/arena-service.js");
  streamMessageMock.mockReset();
});

const paths = [
  '/api/arena/threads/thread-1/messages/stream',
  '/api/arena/threads/messages/stream?threadId=thread-1',
];
it.each(paths)('refuses generation on the real Arena route while draining: %s',async(path)=>{
  const {server,url}=await listen(await createApp('user-1',true));
  try{
    const response=await fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:'question'})});
    expect(response.status).toBe(503);expect(await response.json()).toMatchObject({code:'SERVER_DRAINING'});expect(streamMessageMock).not.toHaveBeenCalled();
  }finally{await close(server);}
});
it('serves identical SSE for canonical and alias requests with one execution per request', async () => {
  streamMessageMock.mockImplementation(async function* () {
    yield {event:'delta',data:{side:'enhanced',delta:'same answer'}};
    yield {event:'done',data:{messages:[]}};
  });
  const canonical=await postMessage(true,paths[0]);
  const alias=await postMessage(true,paths[1]);
  expect(canonical.body).toBe(alias.body);
  expect(canonical.body).toContain('same answer');
  expect(streamMessageMock).toHaveBeenCalledTimes(2);
  expect(streamMessageMock.mock.calls.map(call=>call.slice(0,6))).toEqual([
    ['user-1','thread-1','请回答',undefined,'agent',true],
    ['user-1','thread-1','请回答',undefined,'agent',true],
  ]);
});
describe.each(paths)('legacy Arena SSE entry %s', (path) => {
  it("forwards the literal boolean true to the service", async () => {
    streamMessageMock.mockImplementation(async function* () {
      yield { event: "done", data: { messages: [] } };
    });

    const { response, body } = await postMessage(true, path);

    expect(response.status).toBe(200);
    expect(streamMessageMock).toHaveBeenCalledWith(
      "user-1",
      "thread-1",
      "请回答",
      undefined,
      "agent",
      true,
      expect.any(AbortSignal),
    );
    expect(streamMessageMock.mock.calls[0]?.[6].aborted).toBe(false);
    expect(streamMessageMock).toHaveBeenCalledTimes(1);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('cache-control')).toBe('no-cache, no-transform');
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    expect((body.match(/event: stream_end/g) ?? []).length).toBe(1);
  });

  it("does not coerce string values into an enabled thinking request", async () => {
    streamMessageMock.mockImplementation(async function* () {
      yield { event: "done", data: { messages: [] } };
    });

    await postMessage("true", path);

    expect(streamMessageMock.mock.calls[0]?.[5]).toBe(false);
  });

  it("emits an unsuccessful stream_end after a service failure", async () => {
    streamMessageMock.mockImplementation(async function* () {
      yield { event: "phase", data: { label: "started" } };
      throw new Error("controlled generation failure");
    });

    const { body } = await postMessage(false, path);

    expect(body).toContain('event: error');
    expect(body).toContain('data: {"ok":false}');
    expect(body).not.toContain('data: {"ok":true}');
    expect((body.match(/event: stream_end/g) ?? []).length).toBe(1);
  });

  it("aborts the service signal when the streaming response is disconnected", async () => {
    let serviceSignal: AbortSignal | undefined;
    streamMessageMock.mockImplementation(async function* (...args: unknown[]) {
      serviceSignal = args[6] as AbortSignal;
      yield { event: "phase", data: { label: "started" } };
      await new Promise<void>((resolve) => {
        if (serviceSignal?.aborted) resolve();
        else serviceSignal?.addEventListener("abort", () => resolve(), { once: true });
      });
      throw new Error("cancelled");
    });
    const { server, url } = await listen(await createApp());
    const controller = new AbortController();
    try {
      const response = await fetch(
        `${url}${path}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "请回答", mode: "agent" }),
          signal: controller.signal,
        },
      );
      const reader = response.body?.getReader();
      expect(reader).toBeDefined();
      await reader!.read();
      controller.abort();
      await expect(reader!.read()).rejects.toMatchObject({ name: "AbortError" });
      await vi.waitFor(() => expect(serviceSignal?.aborted).toBe(true));
    } finally {
      controller.abort();
      await close(server);
    }
  });

  it('rejects unauthenticated requests before streaming or executing', async () => {
    const {server,url}=await listen(await createApp(null));
    try {
      const response=await fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:'question'})});
      expect(response.status).toBe(401);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(streamMessageMock).not.toHaveBeenCalled();
    } finally {await close(server);}
  });

  it('preserves service ownership errors without successful terminal output', async () => {
    streamMessageMock.mockImplementation(async function* (userId) {
      if(userId==='other-user') throw new Error('Arena thread not found');
      yield {event:'done',data:{messages:[]}};
    });
    const {server,url}=await listen(await createApp('other-user'));
    try {
      const response=await fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:'question'})});
      const body=await response.text();
      expect(body).toContain('Arena thread not found');
      expect(body).toContain('data: {"ok":false}');
      expect(body).not.toContain('event: done');
      expect(streamMessageMock.mock.calls[0]?.[0]).toBe('other-user');
    } finally {await close(server);}
  });

  it('keeps empty-content errors JSON and does not start generation', async () => {
    const {server,url}=await listen(await createApp());
    try {
      const response=await fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:'  '})});
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({error:'消息内容不能为空'});
      expect(streamMessageMock).not.toHaveBeenCalled();
    } finally {await close(server);}
  });

  it('retains heartbeat events and cleans up after normal completion', async () => {
    vi.stubEnv('ARENA_STREAM_HEARTBEAT_MS','5');
    streamMessageMock.mockImplementation(async function* () {
      await new Promise(resolve=>setTimeout(resolve,20));
      yield {event:'delta',data:{side:'enhanced',delta:'answer'}};
    });
    try {
      const {body}=await postMessage(false,path);
      expect(body).toContain('event: ping');
      expect(body).toContain('event: delta');
      expect(body.trim().endsWith('data: {"ok":true}')).toBe(true);
      expect((body.match(/event: stream_end/g)??[]).length).toBe(1);
    } finally {vi.unstubAllEnvs();}
  });
});

it.each([
  '/api/arena/threads/messages/stream',
  '/api/arena/threads/messages/stream?threadId=',
  '/api/arena/threads/messages/stream?threadId=one&threadId=two',
  '/api/arena/threads/messages/stream?threadId[x]=one',
  '/api/arena/threads/%20/messages/stream',
  '/api/arena/threads/thread-1/messages/stream?threadId=thread-2',
  '/api/arena/threads/thread-1/messages/stream?threadId=thread-1',
])('rejects ambiguous or missing thread identity before executing: %s',async(path)=>{
  const {server,url}=await listen(await createApp());
  try {
    const response=await fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:'question'})});
    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(streamMessageMock).not.toHaveBeenCalled();
  } finally {await close(server);}
});

it('decodes the scoped path once and never takes a thread ID from the body',async()=>{
  streamMessageMock.mockImplementation(async function* () {yield {event:'done',data:{messages:[]}};});
  const {server,url}=await listen(await createApp());
  try {
    const response=await fetch(url+'/api/arena/threads/thread%2Fone%3Fpart%3D2/messages/stream',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:'question',threadId:'wrong-thread'})});
    expect(response.status).toBe(200);
    await response.text();
    expect(streamMessageMock.mock.calls[0]?.[1]).toBe('thread/one?part=2');
    expect(streamMessageMock).toHaveBeenCalledTimes(1);
  } finally {await close(server);}
});
