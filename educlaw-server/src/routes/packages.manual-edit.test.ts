import type { Server } from "node:http";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

const applyManualMarkdownEditMock = vi.fn();
const generatePackageMock = vi.fn();

async function createApp() {
  vi.resetModules();
  vi.doMock('../services/package-service.js', () => ({
    applyManualMarkdownEdit: applyManualMarkdownEditMock,
    compareVersions: vi.fn(),
    deletePackage: vi.fn(),
    exportPackageZip: vi.fn(),
    generatePackage: generatePackageMock,
    getPackage: vi.fn(),
    importPackageZip: vi.fn(),
    listPackages: vi.fn(),
    listVersions: vi.fn(),
    renamePackage: vi.fn(),
    updateVersionNote: vi.fn(),
  }));
  vi.doMock('../services/optimization-service.js', () => ({
    optimizePackage: vi.fn(),
  }));
  vi.doMock('../services/interactive-optimization-service.js', () => ({
    applyInteractiveChanges: vi.fn(),
    chatOptimize: vi.fn(),
    diagnosePackage: vi.fn(),
    getInteractiveSession: vi.fn(),
    listInteractiveSessions: vi.fn(),
  }));
  const router = (await import("./packages.js")).default;
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}

async function listen(app: express.Express): Promise<{ server: Server; url: string }> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => {
    server.once("listening", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected server to listen on a TCP port");
  }
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function close(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('../services/package-service.js');
  vi.doUnmock('../services/optimization-service.js');
  vi.doUnmock('../services/interactive-optimization-service.js');
  applyManualMarkdownEditMock.mockReset();
  generatePackageMock.mockReset();
});

it('passes the document single-Skill requirement to generation', async () => {
  generatePackageMock.mockResolvedValue({ id: 'p1', name: '函数作业设计' });
    const { server, url } = await listen(await createApp());
  try {
    const response = await fetch(`${url}/packages/generate/stream`, {
      method: 'POST',
      headers: { 'X-User-Id': 'user-1', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instruction: '',
        documents: [{ name: '教学.md', content: '设计函数作业' }],
        singleSkill: true,
      }),
    });
    expect(response.status).toBe(200);
    await response.text();
    expect(generatePackageMock).toHaveBeenCalledWith(
      'user-1',
      '',
      undefined,
      [{ name: '教学.md', content: '设计函数作业' }],
      expect.any(Function),
      expect.any(Function),
      1,
    );
  } finally {
    await close(server);
  }
});

describe('POST /packages/:packageId/manual-edit', () => {
  it('passes the rubric target through to the package service', async () => {
    applyManualMarkdownEditMock.mockResolvedValue({ ok: true });
    const { server, url } = await listen(await createApp());

    try {
      const response = await fetch(`${url}/packages/pkg-1/manual-edit`, {
        method: 'POST',
        headers: {
          'X-User-Id': 'user-1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          target: 'rubric',
          expectedPackageVersionId: '12',
          content: '# Rubric\n\n## 评分目标',
          note: 'update rubric',
        }),
      });

      expect(response.status).toBe(200);
      expect(applyManualMarkdownEditMock).toHaveBeenCalledWith(
        'user-1',
        'pkg-1',
        {
          target: 'rubric',
          expectedPackageVersionId: '12',
          skillId: undefined,
          content: '# Rubric\n\n## 评分目标',
          note: 'update rubric',
        },
      );
    } finally {
      await close(server);
    }
  });
});

it.each([['missing',{},422],['conflict',{expectedPackageVersionId:'old'},409]])('preserves the %s precondition error contract',async (_name,extra,status)=>{
  applyManualMarkdownEditMock.mockRejectedValue(new Error('PACKAGE_VERSION_CONFLICT'));
  const {server,url}=await listen(await createApp());
  try{
    const response=await fetch(`${url}/packages/1/manual-edit`,{method:'POST',headers:{'X-User-Id':'owner','Content-Type':'application/json'},body:JSON.stringify({target:'agent',content:'# Changed',...extra})});
    expect(response.status).toBe(status);
    if(status===409)expect(await response.json()).toMatchObject({code:'PACKAGE_VERSION_CONFLICT'});
    else expect(applyManualMarkdownEditMock).not.toHaveBeenCalled();
  }finally{await close(server);}
});
