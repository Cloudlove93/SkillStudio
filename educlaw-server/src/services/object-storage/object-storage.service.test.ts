import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { createObjectStorageService } from './object-storage.service.js';

function makeConfig() {
  return {
    endpoint: 'http://educlaw-minio:9000',
    region: 'us-east-1',
    bucket: 'educlaw-media',
    accessKeyId: 'replace-with-local-dev-access-key',
    secretAccessKey: 'replace-with-local-dev-secret-key',
    forcePathStyle: true,
    signedUrlTtlSeconds: 300,
  };
}

describe('object storage service', () => {
  it('generates immutable keys under allowed prefixes and rejects path injection', () => {
    const service = createObjectStorageService({
      config: makeConfig(),
      createRandomId: vi
        .fn()
        .mockReturnValueOnce('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
        .mockReturnValueOnce('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
        .mockReturnValueOnce('cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
    });

    expect(
      service.createSessionObjectKey({
        sessionId: '91',
        category: 'source',
        extension: 'mp4',
      }),
    ).toBe('skill-sessions/91/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4');
    expect(
      service.createSessionObjectKey({
        sessionId: '91',
        category: 'frames/selected',
        extension: 'jpg',
      }),
    ).toBe(
      'skill-sessions/91/frames/selected/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg',
    );
    expect(
      service.createSkillVersionObjectKey({
        versionId: '7',
        category: 'audio',
        extension: 'mp3',
      }),
    ).toBe('skill-versions/7/audio/cccccccc-cccc-4ccc-8ccc-cccccccccccc.mp3');

    expect(() =>
      service.createSessionObjectKey({
        sessionId: '0',
        category: 'source',
        extension: 'mp4',
      }),
    ).toThrowError(/sessionId/);
    expect(() =>
      service.createSessionObjectKey({
        sessionId: '91',
        category: 'source',
        extension: '../mp4',
      }),
    ).toThrowError(/extension/);
    expect(() =>
      service.createSkillVersionObjectKey({
        versionId: '7',
        category: 'delete',
        extension: 'mp3',
      }),
    ).toThrowError(/category/);
  });

  it('signs immutable PUT grants with if-none-match and exact content-type headers', async () => {
    const presignUrl = vi
      .fn()
      .mockResolvedValue('http://signed.example/upload?X-Amz-Signature=secret');
    const service = createObjectStorageService({
      config: makeConfig(),
      s3Client: { send: vi.fn() },
      presignUrl,
      now: () => new Date('2026-08-21T00:00:00.000Z'),
    });

    const grant = await service.createSignedPutGrant({
      objectKey:
        'skill-sessions/91/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
      contentType: 'video/mp4',
    });

    const [, command, options] = presignUrl.mock.calls[0] ?? [];
    expect(command.constructor.name).toBe('PutObjectCommand');
    expect(command.input).toMatchObject({
      Bucket: 'educlaw-media',
      Key: 'skill-sessions/91/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
      ContentType: 'video/mp4',
      IfNoneMatch: '*',
    });
    expect(options).toMatchObject({
      expiresIn: 300,
      signableHeaders: expect.any(Set),
    });
    expect(Array.from(options.signableHeaders as Set<string>).sort()).toEqual([
      'content-type',
      'if-none-match',
    ]);
    expect(grant).toEqual({
      method: 'PUT',
      objectKey:
        'skill-sessions/91/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
      url: 'http://signed.example/upload?X-Amz-Signature=secret',
      expiresAt: '2026-08-21T00:05:00.000Z',
      requiredHeaders: {
        'content-type': 'video/mp4',
        'if-none-match': '*',
      },
    });
    expect(JSON.stringify(grant)).not.toContain('accessKeyId');
    expect(JSON.stringify(grant)).not.toContain('secretAccessKey');
  });

  it('streams a known-length object through immutable PutObject without buffering it', async () => {
    const send = vi.fn().mockResolvedValue({ ETag: 'etag-1', VersionId: 'v1' });
    const service = createObjectStorageService({
      config: makeConfig(),
      s3Client: { send },
    });
    const body = Readable.from(['abc', 'def']);

    const stored = await service.putStream({
      objectKey:
        'skill-sessions/91/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
      body,
      contentType: 'video/mp4',
      sizeBytes: 6,
    });

    const command = send.mock.calls[0]?.[0];
    expect(command.constructor.name).toBe('PutObjectCommand');
    expect(command.input).toMatchObject({
      Bucket: 'educlaw-media',
      Key: 'skill-sessions/91/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
      Body: body,
      ContentType: 'video/mp4',
      ContentLength: 6,
      IfNoneMatch: '*',
      Metadata: { 'mime-type': 'video/mp4' },
    });
    expect(stored).toEqual({
      objectKey:
        'skill-sessions/91/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
      etag: '"etag-1"',
      versionId: 'v1',
    });
  });

  it('creates multipart uploads and signs exact upload parts without exposing internal credentials', async () => {
    const send = vi.fn().mockResolvedValueOnce({
      UploadId: 'multipart-upload-123',
    });
    const presignUrl = vi
      .fn()
      .mockResolvedValue('http://signed.example/upload-part?X-Amz-Signature=secret');
    const service = createObjectStorageService({
      config: makeConfig(),
      s3Client: { send },
      presignUrl,
      now: () => new Date('2026-08-22T00:00:00.000Z'),
    });

    const created = await service.createMultipartUpload({
      objectKey:
        'skill-sessions/91/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
      contentType: 'video/mp4',
    });

    expect(send.mock.calls[0]?.[0]?.constructor?.name).toBe(
      'CreateMultipartUploadCommand',
    );
    expect(send.mock.calls[0]?.[0]?.input).toMatchObject({
      Bucket: 'educlaw-media',
      Key: 'skill-sessions/91/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
      ContentType: 'video/mp4',
    });
    expect(created).toEqual({
      multipartUploadId: 'multipart-upload-123',
    });

    const grant = await service.createSignedUploadPartGrant({
      objectKey:
        'skill-sessions/91/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
      multipartUploadId: 'multipart-upload-123',
      partNumber: 2,
    });

    const [, command, options] = presignUrl.mock.calls[0] ?? [];
    expect(command.constructor.name).toBe('UploadPartCommand');
    expect(command.input).toMatchObject({
      Bucket: 'educlaw-media',
      Key: 'skill-sessions/91/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
      UploadId: 'multipart-upload-123',
      PartNumber: 2,
    });
    expect(options).toMatchObject({
      expiresIn: 300,
    });
    expect(grant).toEqual({
      method: 'PUT',
      partNumber: 2,
      url: 'http://signed.example/upload-part?X-Amz-Signature=secret',
      expiresAt: '2026-08-22T00:05:00.000Z',
      requiredHeaders: {},
    });
    expect(JSON.stringify(grant)).not.toContain('accessKeyId');
    expect(JSON.stringify(grant)).not.toContain('secretAccessKey');
  });

  it('aborts incomplete multipart uploads and rejects invalid part numbers', async () => {
    const send = vi.fn().mockResolvedValue({});
    const service = createObjectStorageService({
      config: makeConfig(),
      s3Client: { send },
      presignUrl: vi.fn().mockResolvedValue('http://signed.example/upload-part'),
    });

    await service.abortIncompleteMultipartUpload({
      objectKey:
        'skill-sessions/91/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
      multipartUploadId: 'multipart-upload-123',
    });

    expect(send.mock.calls[0]?.[0]?.constructor?.name).toBe(
      'AbortMultipartUploadCommand',
    );
    expect(send.mock.calls[0]?.[0]?.input).toMatchObject({
      Bucket: 'educlaw-media',
      Key: 'skill-sessions/91/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
      UploadId: 'multipart-upload-123',
    });

    for (const partNumber of [0, 10001, 1.5]) {
      await expect(
        service.createSignedUploadPartGrant({
          objectKey:
            'skill-sessions/91/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
          multipartUploadId: 'multipart-upload-123',
          partNumber,
        }),
      ).rejects.toThrowError(/partNumber/);
    }
  });

  it('completes multipart uploads with exact bucket, key, upload id, and ordered parts', async () => {
    const send = vi.fn().mockResolvedValue({
      ETag: '"final-etag"',
      VersionId: 'version-1',
    });
    const service = createObjectStorageService({
      config: makeConfig(),
      s3Client: { send },
      presignUrl: vi.fn(),
    });

    const result = await service.completeMultipartUpload({
      objectKey:
        'skill-sessions/91/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
      multipartUploadId: 'multipart-upload-123',
      parts: [
        { partNumber: 1, etag: 'etag-1' },
        { partNumber: 2, etag: '"etag-2"' },
        { partNumber: 3, etag: 'etag-3' },
      ],
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]?.constructor?.name).toBe(
      'CompleteMultipartUploadCommand',
    );
    expect(send.mock.calls[0]?.[0]?.input).toEqual({
      Bucket: 'educlaw-media',
      Key: 'skill-sessions/91/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
      UploadId: 'multipart-upload-123',
      MultipartUpload: {
        Parts: [
          { PartNumber: 1, ETag: '"etag-1"' },
          { PartNumber: 2, ETag: '"etag-2"' },
          { PartNumber: 3, ETag: '"etag-3"' },
        ],
      },
    });
    expect(result).toEqual({
      objectKey:
        'skill-sessions/91/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
      etag: '"final-etag"',
      versionId: 'version-1',
    });
  });

  it('rejects empty, unordered, duplicate, missing, or malformed multipart parts before sending', async () => {
    const send = vi.fn().mockResolvedValue({});
    const service = createObjectStorageService({
      config: makeConfig(),
      s3Client: { send },
      presignUrl: vi.fn(),
    });
    const objectKey =
      'skill-sessions/91/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4';
    const multipartUploadId = 'multipart-upload-123';

    await expect(
      service.completeMultipartUpload({
        objectKey,
        multipartUploadId,
        parts: [],
      }),
    ).rejects.toThrowError(/parts/);

    await expect(
      service.completeMultipartUpload({
        objectKey,
        multipartUploadId,
        parts: [
          { partNumber: 2, etag: 'etag-2' },
          { partNumber: 1, etag: 'etag-1' },
        ],
      }),
    ).rejects.toThrowError(/parts/);

    await expect(
      service.completeMultipartUpload({
        objectKey,
        multipartUploadId,
        parts: [
          { partNumber: 1, etag: 'etag-1' },
          { partNumber: 1, etag: 'etag-1b' },
        ],
      }),
    ).rejects.toThrowError(/parts/);

    await expect(
      service.completeMultipartUpload({
        objectKey,
        multipartUploadId,
        parts: [
          { partNumber: 1, etag: 'etag-1' },
          { partNumber: 3, etag: 'etag-3' },
        ],
      }),
    ).rejects.toThrowError(/parts/);

    for (const etag of ['', '   ', 'etag"\u0000bad', '"etag', 'etag"', '"bad""etag"']) {
      await expect(
        service.completeMultipartUpload({
          objectKey,
          multipartUploadId,
          parts: [{ partNumber: 1, etag }],
        }),
      ).rejects.toThrowError(/etag/);
    }

    expect(send).not.toHaveBeenCalled();
  });

  it('reuses existing objectKey and multipart upload id validation for completeMultipartUpload', async () => {
    const send = vi.fn().mockResolvedValue({});
    const service = createObjectStorageService({
      config: makeConfig(),
      s3Client: { send },
      presignUrl: vi.fn(),
    });

    await expect(
      service.completeMultipartUpload({
        objectKey: 'arbitrary/key.mp4',
        multipartUploadId: 'multipart-upload-123',
        parts: [{ partNumber: 1, etag: 'etag-1' }],
      }),
    ).rejects.toThrowError(/objectKey/);

    await expect(
      service.completeMultipartUpload({
        objectKey:
          'skill-sessions/91/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
        multipartUploadId: ' multipart-upload-123 ',
        parts: [{ partNumber: 1, etag: 'etag-1' }],
      }),
    ).rejects.toThrowError(/multipartUploadId/);

    expect(send).not.toHaveBeenCalled();
  });

  it('enforces signed URL ttl boundaries for GET and PUT grants', async () => {
    const service = createObjectStorageService({
      config: makeConfig(),
      s3Client: { send: vi.fn() },
      presignUrl: vi.fn().mockResolvedValue('http://signed.example/object'),
      now: () => new Date('2026-08-21T00:00:00.000Z'),
    });

    await expect(
      service.createSignedGetGrant({
        objectKey:
          'skill-sessions/91/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
        expiresInSeconds: 29,
      }),
    ).rejects.toThrowError(/expiresInSeconds/);
    await expect(
      service.createSignedPutGrant({
        objectKey:
          'skill-sessions/91/source/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4',
        contentType: 'video/mp4',
        expiresInSeconds: 901,
      }),
    ).rejects.toThrowError(/expiresInSeconds/);
  });

  it('validates every existing object key before signing, heading, or opening reads', async () => {
    const s3Client = { send: vi.fn() };
    const presignUrl = vi
      .fn()
      .mockResolvedValue('http://signed.example/object');
    const service = createObjectStorageService({
      config: makeConfig(),
      s3Client,
      presignUrl,
    });
    const invalidKeys = [
      'arbitrary/key.mp4',
      'skill-sessions/91/../source/file.mp4',
      'skill-sessions\\91\\source\\file.mp4',
      'skill-sessions//91/source/file.mp4',
      'wrong-root/91/source/file.mp4',
      'skill-sessions/0/source/file.mp4',
    ];

    for (const objectKey of invalidKeys) {
      await expect(
        service.createSignedGetGrant({ objectKey }),
      ).rejects.toThrowError(/objectKey/);
      await expect(
        service.createSignedPutGrant({
          objectKey,
          contentType: 'video/mp4',
        }),
      ).rejects.toThrowError(/objectKey/);
      await expect(service.headObject({ objectKey })).rejects.toThrowError(
        /objectKey/,
      );
      await expect(service.openReadStream({ objectKey })).rejects.toThrowError(
        /objectKey/,
      );
    }

    expect(s3Client.send).not.toHaveBeenCalled();
    expect(presignUrl).not.toHaveBeenCalled();
  });

  it('allows only fixed quality and attempt-scoped worker artifact keys', async () => {
    const presignUrl = vi
      .fn()
      .mockResolvedValue('http://signed.example/object');
    const service = createObjectStorageService({
      config: makeConfig(),
      s3Client: { send: vi.fn() },
      presignUrl,
    });
    const allowed = [
      'skill-sessions/91/manifest/media-quality-check/job-301-attempt-1.json',
      'skill-sessions/91/jobs/701/attempt-2/result.json',
      'skill-sessions/91/jobs/701/attempt-2/normalized-audio.wav',
      'skill-sessions/91/jobs/702/attempt-1/transcript.json',
      'skill-sessions/91/jobs/702/attempt-1/transcript-chunks/chunk-0000.json',
      'skill-sessions/91/jobs/703/attempt-1/frames/frame-candidate-001.png',
    ];

    for (const objectKey of allowed) {
      await expect(
        service.createSignedPutGrant({
          objectKey,
          contentType: objectKey.endsWith('.wav')
            ? 'audio/wav'
            : objectKey.endsWith('.png')
              ? 'image/png'
              : 'application/json',
        }),
      ).resolves.toMatchObject({ objectKey });
    }

    const rejected = [
      'skill-sessions/91/jobs/701/attempt-2/arbitrary.exe',
      'skill-sessions/91/jobs/701/attempt-0/result.json',
      'skill-sessions/91/jobs/701/attempt-2/frames/../result.json',
      'skill-sessions/91/manifest/media-quality-check/job-0-attempt-1.json',
    ];
    for (const objectKey of rejected) {
      await expect(
        service.createSignedPutGrant({
          objectKey,
          contentType: 'application/json',
        }),
      ).rejects.toThrowError(/objectKey/);
    }
    expect(presignUrl).toHaveBeenCalledTimes(allowed.length);
  });

  it('uses official S3 commands for HEAD and GET and never trusts etag as sha256', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        ContentLength: 12,
        ContentType: 'audio/mpeg',
        ETag: `"${'a'.repeat(64)}"`,
        Metadata: {
          'mime-type': 'audio/mpeg',
        },
      })
      .mockResolvedValueOnce({
        ContentLength: 3,
        ContentType: 'audio/mpeg',
        ETag: `"${'b'.repeat(64)}"`,
        Metadata: {},
        Body: Readable.from(['abc']),
      });
    const service = createObjectStorageService({
      config: makeConfig(),
      s3Client: { send },
      presignUrl: vi.fn(),
    });

    const head = await service.headObject({
      objectKey:
        'skill-sessions/91/audio/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp3',
    });
    const opened = await service.openReadStream({
      objectKey:
        'skill-sessions/91/audio/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp3',
    });
    const body = await streamToString(opened.body);

    expect(send.mock.calls[0]?.[0]?.constructor?.name).toBe(
      'HeadObjectCommand',
    );
    expect(send.mock.calls[1]?.[0]?.constructor?.name).toBe('GetObjectCommand');
    expect(head).toMatchObject({
      objectKey:
        'skill-sessions/91/audio/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp3',
      sizeBytes: 12,
      contentType: 'audio/mpeg',
      metadataMimeType: 'audio/mpeg',
      metadataSha256: null,
    });
    expect(opened.object).toMatchObject({
      metadataSha256: null,
    });
    expect(body).toBe('abc');
  });

  it('normalizes untrusted metadata fields instead of trusting or throwing on malformed values', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        ContentLength: 12,
        ContentType: 'audio/mpeg',
        Metadata: {
          'mime-type': 'text/html; charset=utf-8',
          sha256: 'not-a-real-sha256\u0000secret',
        },
      })
      .mockResolvedValueOnce({
        ContentLength: 12,
        ContentType: 'audio/mpeg',
        Metadata: {
          'mime-type': 'audio/mpeg',
          sha256: 'A'.repeat(64),
        },
        Body: Readable.from(['hello world!']),
      });
    const service = createObjectStorageService({
      config: makeConfig(),
      s3Client: { send },
      presignUrl: vi.fn(),
    });

    const malformed = await service.headObject({
      objectKey:
        'skill-sessions/91/audio/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp3',
    });
    const normalized = await service.openReadStream({
      objectKey:
        'skill-sessions/91/audio/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp3',
    });

    expect(malformed).toMatchObject({
      metadataMimeType: null,
      metadataSha256: null,
    });
    expect(normalized.object).toMatchObject({
      metadataMimeType: 'audio/mpeg',
      metadataSha256: 'a'.repeat(64),
    });
  });

  it('keeps the object-storage production source tree free of physical-delete APIs', () => {
    const sources = [
      readFileSync(
        new URL('./object-storage.service.ts', import.meta.url),
        'utf8',
      ),
    ];

    for (const source of sources) {
      expect(source).not.toContain('DeleteObjectCommand');
      expect(source).not.toContain('deleteObject');
      expect(source).not.toContain('removeObject');
    }
  });
});

async function streamToString(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}
