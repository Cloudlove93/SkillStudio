import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import {
  createMediaUrlImportService,
  MediaUrlImportError,
} from './media-url-import.service.js';

function response(input: {
  statusCode?: number;
  headers?: Record<string, string>;
  chunks?: Array<string | Uint8Array>;
}) {
  return {
    statusCode: input.statusCode ?? 200,
    headers: input.headers ?? {
      'content-type': 'video/mp4',
      'content-length': '6',
    },
    body: Readable.from(input.chunks ?? ['abc', 'def']),
  };
}

function makeHarness() {
  const resolveHost = vi.fn().mockResolvedValue([
    { address: '8.8.8.8', family: 4 as const },
  ]);
  const openResponse = vi.fn().mockResolvedValue(response({}));
  const putStream = vi.fn(async (input: { body: Readable }) => {
    let stored = '';
    for await (const chunk of input.body) {
      stored += Buffer.from(chunk).toString('utf8');
    }
    return { etag: 'etag-1', versionId: null, stored };
  });
  const service = createMediaUrlImportService({
    resolveHost,
    openResponse,
    objectStorageService: { putStream },
    connectTimeoutMs: 1_000,
    readTimeoutMs: 1_000,
    totalTimeoutMs: 5_000,
    maxRedirects: 3,
  });
  return { service, resolveHost, openResponse, putStream };
}

describe('media URL import service', () => {
  it.each([
    'file:///etc/passwd',
    'ftp://media.example/lesson.mp4',
    'http://localhost/lesson.mp4',
    'http://127.0.0.1/lesson.mp4',
    'http://[::1]/lesson.mp4',
    'https://user:secret@media.example/lesson.mp4',
    'https://media.example:8443/lesson.mp4',
  ])('rejects unsafe URL %s before opening a socket', async (sourceUrl) => {
    const { service, openResponse } = makeHarness();

    await expect(
      service.openDirectMedia({ sourceUrl, maxBytes: 1_024 }),
    ).rejects.toMatchObject({ code: 'URL_SSRF_BLOCKED' });
    expect(openResponse).not.toHaveBeenCalled();
  });

  it.each([
    '10.0.0.1',
    '172.16.0.1',
    '192.168.1.2',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    'fc00::1',
    'fe80::1',
  ])('rejects DNS answers in non-public range %s', async (address) => {
    const { service, resolveHost, openResponse } = makeHarness();
    resolveHost.mockResolvedValue([
      { address, family: address.includes(':') ? 6 : 4 },
    ]);

    await expect(
      service.openDirectMedia({
        sourceUrl: 'https://media.example/lesson.mp4',
        maxBytes: 1_024,
      }),
    ).rejects.toMatchObject({ code: 'URL_SSRF_BLOCKED' });
    expect(openResponse).not.toHaveBeenCalled();
  });

  it('rejects a mixed public/private DNS set to close rebinding ambiguity', async () => {
    const { service, resolveHost } = makeHarness();
    resolveHost.mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);

    await expect(
      service.openDirectMedia({
        sourceUrl: 'https://media.example/lesson.mp4',
        maxBytes: 1_024,
      }),
    ).rejects.toMatchObject({ code: 'URL_SSRF_BLOCKED' });
  });

  it('revalidates and pins DNS independently for every redirect hop', async () => {
    const { service, resolveHost, openResponse } = makeHarness();
    resolveHost
      .mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
      .mockResolvedValueOnce([{ address: '1.1.1.1', family: 4 }]);
    openResponse
      .mockResolvedValueOnce(
        response({
          statusCode: 302,
          headers: { location: 'https://cdn.example/final.mp4' },
          chunks: [],
        }),
      )
      .mockResolvedValueOnce(response({}));

    const opened = await service.openDirectMedia({
      sourceUrl: 'https://media.example/lesson.mp4',
      maxBytes: 1_024,
    });

    expect(resolveHost).toHaveBeenNthCalledWith(1, 'media.example');
    expect(resolveHost).toHaveBeenNthCalledWith(2, 'cdn.example');
    expect(openResponse.mock.calls[0]?.[0]).toMatchObject({
      address: '8.8.8.8',
      family: 4,
    });
    expect(openResponse.mock.calls[1]?.[0]).toMatchObject({
      address: '1.1.1.1',
      family: 4,
    });
    expect(opened.finalUrl).toBe('https://cdn.example/final.mp4');
  });

  it('rejects missing, invalid, or oversized Content-Length before storage', async () => {
    for (const contentLength of [undefined, 'abc', '2049']) {
      const { service, openResponse } = makeHarness();
      openResponse.mockResolvedValue(
        response({
          headers: {
            'content-type': 'video/mp4',
            ...(contentLength ? { 'content-length': contentLength } : {}),
          },
        }),
      );

      await expect(
        service.openDirectMedia({
          sourceUrl: 'https://media.example/lesson.mp4',
          maxBytes: 2_048,
        }),
      ).rejects.toBeInstanceOf(MediaUrlImportError);
    }
  });

  it('streams the response into immutable object storage and verifies actual bytes', async () => {
    const { service, putStream } = makeHarness();
    const opened = await service.openDirectMedia({
      sourceUrl: 'https://media.example/lesson.mp4',
      maxBytes: 1_024,
    });

    const result = await service.storeOpenedMedia({
      opened,
      objectKey:
        'skill-sessions/91/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
    });

    expect(putStream).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: 'video/mp4',
        sizeBytes: 6,
      }),
    );
    expect(result).toMatchObject({
      sizeBytes: 6,
      contentType: 'video/mp4',
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it('aborts storage when the body is longer than its declared length', async () => {
    const { service, openResponse } = makeHarness();
    openResponse.mockResolvedValue(
      response({
        headers: {
          'content-type': 'audio/mpeg',
          'content-length': '3',
        },
        chunks: ['abcdef'],
      }),
    );
    const opened = await service.openDirectMedia({
      sourceUrl: 'https://media.example/lesson.mp3',
      maxBytes: 1_024,
    });

    await expect(
      service.storeOpenedMedia({
        opened,
        objectKey:
          'skill-sessions/91/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp3',
      }),
    ).rejects.toMatchObject({ code: 'REMOTE_DOWNLOAD_FAILED' });
  });

  it('streams a safe URL into the existing upload-confirm quality gate', async () => {
    const resolveHost = vi.fn().mockResolvedValue([
      { address: '8.8.8.8', family: 4 as const },
    ]);
    const openResponse = vi.fn().mockResolvedValue(response({}));
    const putStream = vi.fn(async (input: { body: Readable }) => {
      for await (const chunk of input.body) {
        void chunk;
        // Drain the stream as the object storage SDK would.
      }
      return { etag: 'etag-1', versionId: 'version-1' };
    });
    const guidedCreationService = {
      findMediaQualityCheckByIdempotency: vi.fn().mockResolvedValue(null),
      createUploadIntent: vi.fn().mockResolvedValue({
        sessionId: '101',
        revisionNo: 4,
        mediaStage: 'uploading',
        uploadMode: 'single_put',
        uploadToken: 'signed-token',
        replayed: false,
      }),
      getServerPendingUpload: vi.fn().mockResolvedValue({
        sessionId: '101',
        revisionNo: 4,
        objectKey:
          'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
        uploadMode: 'single_put',
        fileName: 'lesson.mp4',
        declaredMimeType: 'video/mp4',
        sizeBytes: 6,
      }),
      createUploadConfirm: vi.fn().mockResolvedValue({
        sessionId: '101',
        revisionNo: 5,
        mediaStage: 'uploading',
        materialStatus: 'verifying',
        jobId: '501',
        observedSizeBytes: 6,
        observedContentType: 'video/mp4',
        jobType: 'media_quality_check',
        replayed: false,
      }),
    };
    const service = createMediaUrlImportService({
      resolveHost,
      openResponse,
      objectStorageService: { putStream },
      guidedCreationService,
      maxBytes: 1_024,
    });

    const result = await service.importToSession({
      authUserId: 'user-1',
      sessionId: '101',
      idempotencyKey: 'url-import-001',
      sourceUrl: 'https://media.example/lesson.mp4',
    });

    expect(guidedCreationService.createUploadIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        authUserId: 'user-1',
        sessionId: '101',
        fileName: 'lesson.mp4',
        declaredMimeType: 'video/mp4',
        sizeBytes: 6,
        serverManaged: true,
      }),
    );
    expect(putStream).toHaveBeenCalledWith(
      expect.objectContaining({
        objectKey:
          'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
      }),
    );
    expect(guidedCreationService.createUploadConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        uploadToken: 'signed-token',
        expectedRevisionNo: 4,
      }),
    );
    expect(result).toMatchObject({
      sessionId: '101',
      revisionNo: 5,
      mediaStage: 'uploading',
      jobId: '501',
      jobType: 'media_quality_check',
      sizeBytes: 6,
      contentType: 'video/mp4',
      replayed: false,
    });
  });

  it('uses the persisted quality-check job as a durable replay receipt', async () => {
    const findMediaQualityCheckByIdempotency = vi.fn().mockResolvedValue({
      sessionId: '101',
      revisionNo: 8,
      mediaStage: 'ready_to_process',
      jobId: '501',
      jobStatus: 'succeeded',
      expectedSizeBytes: 6,
      expectedContentType: 'video/mp4',
    });
    const resolveHost = vi.fn();
    const openResponse = vi.fn();
    const putStream = vi.fn();
    const guidedCreationService = {
      findMediaQualityCheckByIdempotency,
      createUploadIntent: vi.fn(),
      getServerPendingUpload: vi.fn(),
      createUploadConfirm: vi.fn(),
    };
    const service = createMediaUrlImportService({
      resolveHost,
      openResponse,
      objectStorageService: { putStream },
      guidedCreationService,
      maxBytes: 1_024,
    });

    const result = await service.importToSession({
      authUserId: 'user-1',
      sessionId: '101',
      idempotencyKey: 'url-import-001',
      sourceUrl: 'https://media.example/lesson.mp4',
    });

    expect(result).toMatchObject({
      sessionId: '101',
      revisionNo: 8,
      mediaStage: 'ready_to_process',
      jobId: '501',
      sizeBytes: 6,
      contentType: 'video/mp4',
      replayed: true,
    });
    expect(resolveHost).not.toHaveBeenCalled();
    expect(openResponse).not.toHaveBeenCalled();
    expect(putStream).not.toHaveBeenCalled();
    expect(guidedCreationService.createUploadIntent).not.toHaveBeenCalled();
  });

  it('does not confirm when the remote stream is interrupted', async () => {
    const { service: baseService, openResponse } = makeHarness();
    openResponse.mockResolvedValue(
      response({
        headers: {
          'content-type': 'video/mp4',
          'content-length': '6',
        },
        chunks: ['abc'],
      }),
    );
    const guidedCreationService = {
      findMediaQualityCheckByIdempotency: vi.fn().mockResolvedValue(null),
      createUploadIntent: vi.fn().mockResolvedValue({
        sessionId: '101',
        revisionNo: 4,
        uploadMode: 'single_put',
        uploadToken: 'signed-token',
      }),
      getServerPendingUpload: vi.fn().mockResolvedValue({
        sessionId: '101',
        revisionNo: 4,
        objectKey:
          'skill-sessions/101/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
        uploadMode: 'single_put',
        fileName: 'lesson.mp4',
        declaredMimeType: 'video/mp4',
        sizeBytes: 6,
      }),
      createUploadConfirm: vi.fn(),
    };
    const service = createMediaUrlImportService({
      resolveHost: vi.fn().mockResolvedValue([
        { address: '8.8.8.8', family: 4 as const },
      ]),
      openResponse,
      objectStorageService: {
        putStream: vi.fn(async (input: { body: Readable }) => {
          for await (const chunk of input.body) {
            void chunk;
            // Drain to surface the Content-Length mismatch.
          }
          return { etag: null, versionId: null };
        }),
      },
      guidedCreationService,
      maxBytes: 1_024,
    });

    await expect(
      service.importToSession({
        authUserId: 'user-1',
        sessionId: '101',
        idempotencyKey: 'url-import-001',
        sourceUrl: 'https://media.example/lesson.mp4',
      }),
    ).rejects.toMatchObject({ code: 'REMOTE_DOWNLOAD_FAILED' });
    expect(guidedCreationService.createUploadConfirm).not.toHaveBeenCalled();
    expect(baseService).toBeDefined();
  });
});
