import type { ClientRequestArgs } from 'node:http';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import {
  createUploadSecurityService,
  createPinnedRequestSender,
  isBlockedAddress,
  UploadSecurityError,
} from './upload-security.service.js';

function isoBmffSample() {
  return Buffer.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
    0x00, 0x00, 0x00, 0x00, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x32,
  ]);
}

function mp3Sample() {
  return Buffer.from([
    0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x21,
  ]);
}

function htmlSample() {
  return Buffer.from('<!DOCTYPE html><html><body>login</body></html>', 'utf8');
}

function peSample() {
  return Buffer.from([0x4d, 0x5a, 0x90, 0x00]);
}

function zipSample() {
  return Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
}

function makeService(
  overrides: Parameters<typeof createUploadSecurityService>[0] = {},
) {
  return createUploadSecurityService({
    maxUploadBytes: 1024 * 1024,
    maxRemoteBytes: 1024 * 1024,
    connectTimeoutMs: 1000,
    readTimeoutMs: 1000,
    maxRedirects: 3,
    ...overrides,
  });
}

describe('upload security service', () => {
  it('accepts allowlisted media intents and rejects double extensions, nul bytes, and executable disguises', () => {
    const service = makeService();

    expect(
      service.validateUploadIntent({
        fileName: 'lesson.mp4',
        declaredMimeType: 'video/mp4',
        sizeBytes: 1024,
      }),
    ).toMatchObject({
      normalizedFileName: 'lesson.mp4',
      mediaKind: 'video',
      extension: 'mp4',
    });
    expectSyncUploadError(
      () =>
        service.validateUploadIntent({
          fileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4; charset=binary',
          sizeBytes: 1024,
        }),
      'UNSUPPORTED_MEDIA_TYPE',
    );
    expect(
      service.validateUploadIntent({
        fileName: 'audio.m4a',
        declaredMimeType: 'audio/mp4',
        sizeBytes: 1024,
      }),
    ).toMatchObject({
      mediaKind: 'audio',
      extension: 'm4a',
    });
    expectSyncUploadError(
      () =>
        service.validateUploadIntent({
          fileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4;\nsecret=token',
          sizeBytes: 1024,
        }),
      'UNSUPPORTED_MEDIA_TYPE',
    );
    expectSyncUploadError(
      () =>
        service.validateUploadIntent({
          fileName: 'lesson.mp4.exe',
          declaredMimeType: 'video/mp4',
          sizeBytes: 1024,
        }),
      'UNSUPPORTED_MEDIA_TYPE',
    );
    expectSyncUploadError(
      () =>
        service.validateUploadIntent({
          fileName: 'lesson.exe.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 1024,
        }),
      'UNSUPPORTED_MEDIA_TYPE',
    );
    expectSyncUploadError(
      () =>
        service.validateUploadIntent({
          fileName: 'lesson.tar.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 1024,
        }),
      'UNSUPPORTED_MEDIA_TYPE',
    );
    expectSyncUploadError(
      () =>
        service.validateUploadIntent({
          fileName: 'lesson\0.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 1024,
        }),
      'INVALID_UPLOAD_INTENT',
    );
    expectSyncUploadError(
      () =>
        service.validateUploadIntent({
          fileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 1.5,
        }),
      'INVALID_UPLOAD_INTENT',
    );
    expectSyncUploadError(
      () =>
        service.validateUploadIntent({
          fileName: 'lesson.mp4 ',
          declaredMimeType: 'video/mp4',
          sizeBytes: 1024,
        }),
      'INVALID_UPLOAD_INTENT',
    );
    expectSyncUploadError(
      () =>
        service.validateUploadIntent({
          fileName: 'lesson.',
          declaredMimeType: 'video/mp4',
          sizeBytes: 1024,
        }),
      'INVALID_UPLOAD_INTENT',
    );
    expectSyncUploadError(
      () =>
        service.validateUploadIntent({
          fileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 0,
        }),
      'INVALID_UPLOAD_INTENT',
    );
    expectSyncUploadError(
      () =>
        service.validateUploadIntent({
          fileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4',
          sizeBytes: 2 * 1024 * 1024,
        }),
      'FILE_TOO_LARGE',
    );
    expectSyncUploadError(
      () =>
        service.validateUploadIntent({
          fileName: 'index.html',
          declaredMimeType: 'text/html',
          sizeBytes: 1024,
        }),
      'UNSUPPORTED_MEDIA_TYPE',
    );
  });

  it('streams content verification, recomputes sha256 and size, and treats iso-bmff only as container compatibility', async () => {
    const service = makeService();
    const sample = isoBmffSample();

    const result = await service.verifyUploadedContent({
      stream: Readable.from([sample.subarray(0, 8), sample.subarray(8)]),
      fileName: 'audio.m4a',
      declaredMimeType: 'audio/mp4',
      expectedSizeBytes: sample.byteLength,
      clientReportedSha256: 'f'.repeat(64),
      clientReportedEtag: '"not-trusted"',
    });

    expect(result.sizeBytes).toBe(sample.byteLength);
    expect(result.containerFamily).toBe('iso-bmff');
    expect(result.declaredMimeType).toBe('audio/mp4');
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect('trackKind' in result).toBe(false);
  });

  it('rejects declared size and expected hash mismatches with stable local errors', async () => {
    const service = makeService();
    const sample = mp3Sample();

    await expect(
      service.verifyUploadedContent({
        stream: Readable.from([sample]),
        fileName: 'audio.mp3',
        declaredMimeType: 'audio/mpeg',
        expectedSizeBytes: sample.byteLength + 1,
      }),
    ).rejects.toMatchObject({
      code: 'FILE_SIZE_MISMATCH',
    } satisfies Partial<UploadSecurityError>);
    await expect(
      service.verifyUploadedContent({
        stream: Readable.from([sample]),
        fileName: 'audio.mp3',
        declaredMimeType: 'audio/mpeg',
        expectedSizeBytes: 10.5,
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_UPLOAD_INTENT',
    } satisfies Partial<UploadSecurityError>);

    await expect(
      service.verifyUploadedContent({
        stream: Readable.from([sample]),
        fileName: 'audio.mp3',
        declaredMimeType: 'audio/mpeg',
        expectedSha256: '0'.repeat(64),
      }),
    ).rejects.toMatchObject({
      code: 'FILE_HASH_MISMATCH',
    } satisfies Partial<UploadSecurityError>);
  });

  it('rejects html, pe, and zip disguises even when the extension and mime pretend to be media', async () => {
    const service = makeService();

    for (const sample of [htmlSample(), peSample(), zipSample()]) {
      await expect(
        service.verifyUploadedContent({
          stream: Readable.from([sample]),
          fileName: 'lesson.mp4',
          declaredMimeType: 'video/mp4',
        }),
      ).rejects.toMatchObject({
        code: 'UNSUPPORTED_MEDIA_TYPE',
      } satisfies Partial<UploadSecurityError>);
    }
  });

  it('rejects localhost, private, link-local, documentation, and ipv4-mapped private targets before any fetch', async () => {
    const service = makeService({
      dnsResolver: vi.fn(),
      sendPinnedRequest: vi.fn(),
    });

    await expect(
      service.downloadAndVerifyRemoteMedia({
        url: 'http://localhost/media.mp4?token=secret',
      }),
    ).rejects.toMatchObject({ code: 'URL_SSRF_BLOCKED' });
    await expect(
      service.downloadAndVerifyRemoteMedia({
        url: 'http://127.0.0.1/media.mp4?token=secret',
      }),
    ).rejects.toMatchObject({ code: 'URL_SSRF_BLOCKED' });
    await expect(
      service.downloadAndVerifyRemoteMedia({
        url: 'https://[::ffff:10.0.0.8]/media.mp4?token=secret',
      }),
    ).rejects.toMatchObject({ code: 'URL_SSRF_BLOCKED' });
    await expect(
      service.downloadAndVerifyRemoteMedia({
        url: 'http://2130706433/media.mp4?token=secret',
      }),
    ).rejects.toMatchObject({ code: 'URL_SSRF_BLOCKED' });
    await expect(
      service.downloadAndVerifyRemoteMedia({
        url: 'http://0x7f000001/media.mp4?token=secret',
      }),
    ).rejects.toMatchObject({ code: 'URL_SSRF_BLOCKED' });
    await expect(
      service.downloadAndVerifyRemoteMedia({
        url: 'http://0177.0.0.1/media.mp4?token=secret',
      }),
    ).rejects.toMatchObject({ code: 'URL_SSRF_BLOCKED' });
  });

  it('classifies blocked and public addresses with table-driven coverage', () => {
    const cases = [
      ['0.0.0.0', true],
      ['10.0.0.1', true],
      ['100.64.0.1', true],
      ['127.0.0.1', true],
      ['169.254.1.1', true],
      ['172.16.0.1', true],
      ['192.168.0.1', true],
      ['192.0.2.1', true],
      ['198.18.0.1', true],
      ['224.0.0.1', true],
      ['240.0.0.1', true],
      ['::', true],
      ['::1', true],
      ['fc00::1', true],
      ['fe80::1', true],
      ['ff00::1', true],
      ['2001:db8::1', true],
      ['::ffff:127.0.0.1', true],
      ['::ffff:10.0.0.1', true],
      ['93.184.216.34', false],
      ['2606:2800:220:1:248:1893:25c8:1946', false],
    ] as const;

    for (const [address, expected] of cases) {
      expect(isBlockedAddress(address)).toBe(expected);
    }
  });

  it('blocks additional reserved ipv6 forms and keeps public ipv4/ipv6 allowed', () => {
    expect(isBlockedAddress('::10.0.0.1')).toBe(true);
    expect(isBlockedAddress('64:ff9b::a00:1')).toBe(true);
    expect(isBlockedAddress('100::1')).toBe(true);
    expect(isBlockedAddress('2002:0a00:0001::')).toBe(true);
    expect(isBlockedAddress('8.8.8.8')).toBe(false);
    expect(isBlockedAddress('2001:4860:4860::8888')).toBe(false);
  });

  it('rejects any dns result set that mixes a public address with a blocked private address', async () => {
    const dnsResolver = vi.fn().mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.8', family: 4 },
    ]);
    const sendPinnedRequest = vi.fn();
    const service = makeService({ dnsResolver, sendPinnedRequest });

    await expect(
      service.downloadAndVerifyRemoteMedia({
        url: 'https://media.example/video.mp4?token=secret',
      }),
    ).rejects.toMatchObject({ code: 'URL_SSRF_BLOCKED' });

    expect(sendPinnedRequest).not.toHaveBeenCalled();
  });

  it('re-resolves every redirect hop and pins the exact IP used by the transport', async () => {
    const firstBody = Readable.from([]);
    const firstDestroy = vi.spyOn(firstBody, 'destroy');
    const dnsResolver = vi
      .fn()
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValueOnce([{ address: '93.184.216.35', family: 4 }]);
    const sendPinnedRequest = vi
      .fn()
      .mockResolvedValueOnce({
        statusCode: 302,
        headers: { location: 'https://cdn.example/final.m4a' },
        body: firstBody,
      })
      .mockResolvedValueOnce({
        statusCode: 200,
        headers: {
          'content-type': 'audio/mp4',
          'content-length': String(isoBmffSample().byteLength),
        },
        body: Readable.from([isoBmffSample()]),
      });
    const service = makeService({ dnsResolver, sendPinnedRequest });

    const result = await service.downloadAndVerifyRemoteMedia({
      url: 'https://media.example/source.m4a?token=secret',
    });

    expect(dnsResolver).toHaveBeenNthCalledWith(1, 'media.example');
    expect(dnsResolver).toHaveBeenNthCalledWith(2, 'cdn.example');
    expect(sendPinnedRequest).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        url: 'https://media.example/source.m4a?token=secret',
        pinnedIp: '93.184.216.34',
      }),
    );
    expect(sendPinnedRequest).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        url: 'https://cdn.example/final.m4a',
        pinnedIp: '93.184.216.35',
      }),
    );
    expect(sendPinnedRequest.mock.calls[0]?.[0]).not.toHaveProperty('headers');
    expect(sendPinnedRequest.mock.calls[1]?.[0]).not.toHaveProperty('headers');
    expect(firstDestroy).toHaveBeenCalled();
    expect(result.finalUrl).toBe('https://cdn.example/final.m4a');
    expect(result.verified.containerFamily).toBe('iso-bmff');
  });

  it('rejects redirects to private networks, https downgrades, redirect loops, oversized responses, html content, and timeouts without leaking internals', async () => {
    const baseUrl = 'https://media.example/source.mp4?token=secret';

    const redirectToPrivate = makeService({
      dnsResolver: vi
        .fn()
        .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
        .mockResolvedValueOnce([{ address: '10.0.0.8', family: 4 }]),
      sendPinnedRequest: vi.fn().mockResolvedValueOnce({
        statusCode: 302,
        headers: { location: 'https://internal.example/asset.mp4' },
        body: Readable.from([]),
      }),
    });
    await expect(
      redirectToPrivate.downloadAndVerifyRemoteMedia({ url: baseUrl }),
    ).rejects.toMatchObject({ code: 'URL_SSRF_BLOCKED' });

    const downgrade = makeService({
      dnsResolver: vi
        .fn()
        .mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
      sendPinnedRequest: vi.fn().mockResolvedValueOnce({
        statusCode: 302,
        headers: { location: 'http://media.example/plain.mp4' },
        body: Readable.from([]),
      }),
    });
    await expect(
      downgrade.downloadAndVerifyRemoteMedia({ url: baseUrl }),
    ).rejects.toMatchObject({ code: 'REMOTE_DOWNLOAD_FAILED' });

    const tooManyRedirects = makeService({
      maxRedirects: 1,
      dnsResolver: vi
        .fn()
        .mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
      sendPinnedRequest: vi.fn().mockResolvedValue({
        statusCode: 302,
        headers: { location: '/again.mp4' },
        body: Readable.from([]),
      }),
    });
    await expect(
      tooManyRedirects.downloadAndVerifyRemoteMedia({ url: baseUrl }),
    ).rejects.toMatchObject({ code: 'REMOTE_DOWNLOAD_FAILED' });

    const oversizedContentLength = makeService({
      maxRemoteBytes: 4,
      dnsResolver: vi
        .fn()
        .mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
      sendPinnedRequest: vi.fn().mockResolvedValue({
        statusCode: 200,
        headers: {
          'content-type': 'video/mp4',
          'content-length': '10',
        },
        body: Readable.from([isoBmffSample()]),
      }),
    });
    await expect(
      oversizedContentLength.downloadAndVerifyRemoteMedia({ url: baseUrl }),
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });

    const htmlResponse = makeService({
      dnsResolver: vi
        .fn()
        .mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
      sendPinnedRequest: vi.fn().mockResolvedValue({
        statusCode: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
        },
        body: Readable.from([htmlSample()]),
      }),
    });
    await expect(
      htmlResponse.downloadAndVerifyRemoteMedia({ url: baseUrl }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE' });

    const timeout = makeService({
      dnsResolver: vi
        .fn()
        .mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
      sendPinnedRequest: vi
        .fn()
        .mockRejectedValue(new Error('timeout 10.0.0.8 token=secret')),
    });
    const error = await timeout
      .downloadAndVerifyRemoteMedia({ url: baseUrl })
      .catch((caught: unknown) => caught as UploadSecurityError);
    expect(error).toBeInstanceOf(UploadSecurityError);
    expect(error.code).toBe('REMOTE_DOWNLOAD_FAILED');
    expect(String(error)).not.toContain('token=secret');
    expect(String(error)).not.toContain('10.0.0.8');
    expect(JSON.stringify(error)).not.toContain('token=secret');
    expect(JSON.stringify(error)).not.toContain('10.0.0.8');
  });

  it('rejects a remote body that exceeds maxRemoteBytes even when content-length is missing or understated', async () => {
    const sample = isoBmffSample();

    const withoutContentLength = makeService({
      maxRemoteBytes: 8,
      dnsResolver: vi
        .fn()
        .mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
      sendPinnedRequest: vi.fn().mockResolvedValue({
        statusCode: 200,
        headers: {
          'content-type': 'audio/mp4',
        },
        body: Readable.from([sample]),
      }),
    });
    await expect(
      withoutContentLength.downloadAndVerifyRemoteMedia({
        url: 'https://media.example/source.m4a?token=secret',
      }),
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });

    const understatedContentLength = makeService({
      maxRemoteBytes: 8,
      dnsResolver: vi
        .fn()
        .mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
      sendPinnedRequest: vi.fn().mockResolvedValue({
        statusCode: 200,
        headers: {
          'content-type': 'audio/mp4',
          'content-length': '4',
        },
        body: Readable.from([sample]),
      }),
    });
    await expect(
      understatedContentLength.downloadAndVerifyRemoteMedia({
        url: 'https://media.example/source.m4a?token=secret',
      }),
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
  });

  it('destroys the final response body on invalid content-length and missing remote extension failures', async () => {
    const invalidContentLengthBody = Readable.from([isoBmffSample()]);
    const invalidContentLengthDestroy = vi.spyOn(
      invalidContentLengthBody,
      'destroy',
    );
    const invalidContentLengthService = makeService({
      dnsResolver: vi
        .fn()
        .mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
      sendPinnedRequest: vi.fn().mockResolvedValue({
        statusCode: 200,
        headers: {
          'content-type': 'audio/mp4',
          'content-length': '4.5',
        },
        body: invalidContentLengthBody,
      }),
    });

    await expect(
      invalidContentLengthService.downloadAndVerifyRemoteMedia({
        url: 'https://media.example/source.m4a?token=secret',
      }),
    ).rejects.toMatchObject({ code: 'REMOTE_DOWNLOAD_FAILED' });
    expect(invalidContentLengthDestroy).toHaveBeenCalledTimes(1);

    const noExtensionBody = Readable.from([isoBmffSample()]);
    const noExtensionDestroy = vi.spyOn(noExtensionBody, 'destroy');
    const noExtensionService = makeService({
      dnsResolver: vi
        .fn()
        .mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
      sendPinnedRequest: vi.fn().mockResolvedValue({
        statusCode: 200,
        headers: {
          'content-type': 'audio/mp4',
        },
        body: noExtensionBody,
      }),
    });

    await expect(
      noExtensionService.downloadAndVerifyRemoteMedia({
        url: 'https://media.example/source?token=secret',
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE' });
    expect(noExtensionDestroy).toHaveBeenCalledTimes(1);
  });

  it('rejects a stalled final response body on the total deadline and destroys the active body', async () => {
    vi.useFakeTimers();
    try {
      const body = new Readable({
        read() {},
      });
      const destroySpy = vi.spyOn(body, 'destroy');
      const service = createUploadSecurityService({
        maxUploadBytes: 1024 * 1024,
        maxRemoteBytes: 1024 * 1024,
        connectTimeoutMs: 1000,
        readTimeoutMs: 1000,
        totalDownloadTimeoutMs: 50,
        maxRedirects: 3,
        dnsResolver: vi
          .fn()
          .mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
        sendPinnedRequest: vi.fn().mockResolvedValue({
          statusCode: 200,
          headers: {
            'content-type': 'audio/mp4',
          },
          body,
        }),
      });

      const resultPromise = service.downloadAndVerifyRemoteMedia({
        url: 'https://media.example/source.m4a?token=secret',
      });
      const rejection = expect(resultPromise).rejects.toMatchObject({
        code: 'REMOTE_DOWNLOAD_FAILED',
      });

      await vi.advanceTimersByTimeAsync(50);

      await rejection;
      expect(destroySpy).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects on the total deadline when dns resolution or transport never resolve', async () => {
    vi.useFakeTimers();
    try {
      const unresolvedDnsService = createUploadSecurityService({
        totalDownloadTimeoutMs: 50,
        dnsResolver: vi.fn().mockImplementation(
          () =>
            new Promise(() => {
              // intentionally unresolved
            }),
        ),
        sendPinnedRequest: vi.fn(),
      });
      const unresolvedDnsPromise =
        unresolvedDnsService.downloadAndVerifyRemoteMedia({
          url: 'https://media.example/source.m4a?token=secret',
        });
      const unresolvedDnsRejection = expect(
        unresolvedDnsPromise,
      ).rejects.toMatchObject({
        code: 'REMOTE_DOWNLOAD_FAILED',
      });

      await vi.advanceTimersByTimeAsync(50);

      await unresolvedDnsRejection;

      const unresolvedTransportService = createUploadSecurityService({
        totalDownloadTimeoutMs: 50,
        dnsResolver: vi
          .fn()
          .mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
        sendPinnedRequest: vi.fn().mockImplementation(
          () =>
            new Promise(() => {
              // intentionally unresolved
            }),
        ),
      });
      const unresolvedTransportPromise =
        unresolvedTransportService.downloadAndVerifyRemoteMedia({
          url: 'https://media.example/source.m4a?token=secret',
        });
      const unresolvedTransportRejection = expect(
        unresolvedTransportPromise,
      ).rejects.toMatchObject({
        code: 'REMOTE_DOWNLOAD_FAILED',
      });

      await vi.advanceTimersByTimeAsync(50);

      await unresolvedTransportRejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it('destroys a late response body after the deadline and does not continue to a next hop', async () => {
    vi.useFakeTimers();
    try {
      const lateBody = new Readable({
        read() {},
      });
      const destroySpy = vi.spyOn(lateBody, 'destroy');
      const sendPinnedRequest = vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                statusCode: 302,
                headers: { location: 'https://cdn.example/final.m4a' },
                body: lateBody,
              });
            }, 100);
          }),
      );
      const service = createUploadSecurityService({
        totalDownloadTimeoutMs: 50,
        dnsResolver: vi
          .fn()
          .mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
        sendPinnedRequest,
      });

      const resultPromise = service.downloadAndVerifyRemoteMedia({
        url: 'https://media.example/source.m4a?token=secret',
      });
      const rejection = expect(resultPromise).rejects.toMatchObject({
        code: 'REMOTE_DOWNLOAD_FAILED',
      });

      await vi.advanceTimersByTimeAsync(50);
      await rejection;

      await vi.advanceTimersByTimeAsync(60);

      expect(destroySpy).toHaveBeenCalledTimes(1);
      expect(sendPinnedRequest).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears total-deadline timers after success and ordinary failures', async () => {
    vi.useFakeTimers();
    try {
      const successService = createUploadSecurityService({
        totalDownloadTimeoutMs: 100,
        dnsResolver: vi
          .fn()
          .mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
        sendPinnedRequest: vi.fn().mockResolvedValue({
          statusCode: 200,
          headers: {
            'content-type': 'audio/mp4',
            'content-length': String(isoBmffSample().byteLength),
          },
          body: Readable.from([isoBmffSample()]),
        }),
      });

      await successService.downloadAndVerifyRemoteMedia({
        url: 'https://media.example/source.m4a?token=secret',
      });
      expect(vi.getTimerCount()).toBe(0);

      const failingBody = new Readable({
        read() {},
      });
      const ordinaryFailureService = createUploadSecurityService({
        totalDownloadTimeoutMs: 100,
        dnsResolver: vi
          .fn()
          .mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
        sendPinnedRequest: vi.fn().mockResolvedValue({
          statusCode: 200,
          headers: {
            'content-type': 'audio/mp4',
            'content-length': '4.5',
          },
          body: failingBody,
        }),
      });

      await expect(
        ordinaryFailureService.downloadAndVerifyRemoteMedia({
          url: 'https://media.example/source.m4a?token=secret',
        }),
      ).rejects.toMatchObject({ code: 'REMOTE_DOWNLOAD_FAILED' });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects invalid numeric service options but still allows maxRedirects=0', async () => {
    expect(() =>
      createUploadSecurityService({
        maxUploadBytes: 1.5,
      }),
    ).toThrowError(/maxUploadBytes/);
    expect(() =>
      createUploadSecurityService({
        maxRemoteBytes: Number.POSITIVE_INFINITY,
      }),
    ).toThrowError(/maxRemoteBytes/);
    expect(() =>
      createUploadSecurityService({
        connectTimeoutMs: 0,
      }),
    ).toThrowError(/connectTimeoutMs/);
    expect(() =>
      createUploadSecurityService({
        readTimeoutMs: 1.5,
      }),
    ).toThrowError(/readTimeoutMs/);

    const service = createUploadSecurityService({
      maxRedirects: 0,
      dnsResolver: vi
        .fn()
        .mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
      sendPinnedRequest: vi.fn().mockResolvedValue({
        statusCode: 302,
        headers: { location: 'https://cdn.example/final.m4a' },
        body: Readable.from([]),
      }),
    });

    await expect(
      service.downloadAndVerifyRemoteMedia({
        url: 'https://media.example/source.m4a?token=secret',
      }),
    ).rejects.toMatchObject({ code: 'REMOTE_DOWNLOAD_FAILED' });
  });

  it('builds default pinned request options that keep the original host while lookup returns only the pinned ip', async () => {
    let capturedOptions: ClientRequestArgs | undefined;
    const sender = createPinnedRequestSender({
      httpRequest() {
        throw new Error('unexpected http transport');
      },
      httpsRequest(options, callback) {
        capturedOptions = options;
        const body = Readable.from(['ok']) as Readable & {
          socket?: { remoteAddress?: string };
          setTimeout?: (timeout: number, listener: () => void) => void;
          headers?: Record<string, string>;
          statusCode?: number;
        };
        body.socket = { remoteAddress: '93.184.216.34' };
        body.setTimeout = (...args) => {
          const listener = args[1];
          void listener;
        };
        body.headers = {};
        body.statusCode = 200;
        callback(body as never);
        return makeFakeRequest();
      },
    });

    const response = await sender({
      url: 'https://media.example/path/video.mp4?token=secret',
      hostname: 'media.example',
      pinnedIp: '93.184.216.34',
      family: 4,
      connectTimeoutMs: 1000,
      readTimeoutMs: 1000,
    });

    expect(capturedOptions?.hostname).toBe('media.example');
    expect(capturedOptions?.servername).toBe('media.example');
    expect(capturedOptions?.path).toBe('/path/video.mp4?token=secret');
    await new Promise<void>((resolve, reject) => {
      capturedOptions?.lookup?.('ignored', {}, (error, address, family) => {
        if (error) {
          reject(error);
          return;
        }
        expect(address).toBe('93.184.216.34');
        expect(family).toBe(4);
        resolve();
      });
    });
    expect(response.statusCode).toBe(200);
  });

  it('rejects a pinned transport response whose remote address does not match the validated ip', async () => {
    const sender = createPinnedRequestSender({
      httpRequest(options, callback) {
        void options;
        const body = Readable.from(['ok']) as Readable & {
          socket?: { remoteAddress?: string };
          setTimeout?: (timeout: number, listener: () => void) => void;
          headers?: Record<string, string>;
          statusCode?: number;
        };
        body.socket = { remoteAddress: '203.0.113.10' };
        body.setTimeout = (...args) => {
          const listener = args[1];
          void listener;
        };
        body.headers = {};
        body.statusCode = 200;
        callback(body as never);
        return makeFakeRequest();
      },
      httpsRequest() {
        throw new Error('unexpected https transport');
      },
    });

    await expect(
      sender({
        url: 'http://media.example/path/audio.mp3?token=secret',
        hostname: 'media.example',
        pinnedIp: '93.184.216.34',
        family: 4,
        connectTimeoutMs: 1000,
        readTimeoutMs: 1000,
      }),
    ).rejects.toThrowError(/pinned/i);
  });

  it('accepts equivalent public ipv6 remote addresses when pinned and socket forms differ', async () => {
    const sender = createPinnedRequestSender({
      httpsRequest(options, callback) {
        void options;
        const body = Readable.from(['ok']) as Readable & {
          socket?: { remoteAddress?: string };
          setTimeout?: (timeout: number, listener: () => void) => void;
          headers?: Record<string, string>;
          statusCode?: number;
        };
        body.socket = { remoteAddress: '2001:4860:4860:0:0:0:0:8888' };
        body.setTimeout = (...args) => {
          const listener = args[1];
          void listener;
        };
        body.headers = {};
        body.statusCode = 200;
        callback(body as never);
        return makeFakeRequest();
      },
    });

    const response = await sender({
      url: 'https://media.example/path/video.mp4?token=secret',
      hostname: 'media.example',
      pinnedIp: '2001:4860:4860::8888',
      family: 6,
      connectTimeoutMs: 1000,
      readTimeoutMs: 1000,
    });

    expect(response.statusCode).toBe(200);
  });
});

function makeFakeRequest() {
  return {
    setTimeout() {
      return this;
    },
    on() {
      return this;
    },
    end() {
      return this;
    },
    destroy() {
      return this;
    },
  };
}

function expectSyncUploadError(action: () => unknown, code: string) {
  try {
    action();
  } catch (error) {
    expect(error).toMatchObject({ code });
    return;
  }

  throw new Error(`Expected UploadSecurityError with code ${code}`);
}
