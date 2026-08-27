import { createHash } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { LookupFunction } from 'node:net';
import { Readable, Transform } from 'node:stream';
import ipaddr from 'ipaddr.js';

import { config } from '../config.js';
import { readObjectStorageConfig } from '../config/object-storage-config.js';
import { GuidedCreationError } from './guided-creation-service.js';
import {
  createMultimodalGuidedCreationService,
  type PersistedMediaQualityCheckReceipt,
  type ServerPendingUploadBinding,
} from './multimodal-guided-creation-service.js';
import { createObjectStorageService } from './object-storage/object-storage.service.js';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_READ_TIMEOUT_MS = 30_000;
const DEFAULT_TOTAL_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_MAX_REDIRECTS = 5;

type ResolvedAddress = { address: string; family: 4 | 6 };
type ResponseHeaders = Record<string, string | string[] | undefined>;

interface OpenedResponse {
  statusCode: number;
  headers: ResponseHeaders;
  body: Readable;
}

interface OpenResponseInput {
  url: URL;
  address: string;
  family: 4 | 6;
  connectTimeoutMs: number;
  readTimeoutMs: number;
  signal: AbortSignal;
}

export interface OpenedDirectMedia {
  finalUrl: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  body: Readable;
  abortController: AbortController;
  totalTimeout: ReturnType<typeof setTimeout>;
}

interface MediaUrlImportDependencies {
  resolveHost?: (hostname: string) => Promise<ResolvedAddress[]>;
  openResponse?: (input: OpenResponseInput) => Promise<OpenedResponse>;
  objectStorageService?: {
    putStream(input: {
      objectKey: string;
      body: Readable;
      contentType: string;
      sizeBytes: number;
    }): Promise<{ etag: string | null; versionId: string | null }>;
    headObject?(input: { objectKey: string }): Promise<{
      sizeBytes: number;
      contentType: string;
    }>;
  };
  guidedCreationService?: MediaUrlGuidedCreationPort;
  maxBytes?: number;
  connectTimeoutMs?: number;
  readTimeoutMs?: number;
  totalTimeoutMs?: number;
  maxRedirects?: number;
}

interface MediaUrlGuidedCreationPort {
  findMediaQualityCheckByIdempotency(input: {
    authUserId: string;
    sessionId: string;
    idempotencyKey: string;
  }): Promise<PersistedMediaQualityCheckReceipt | null>;
  createUploadIntent(input: {
    authUserId: string;
    sessionId: string;
    idempotencyKey: string;
    fileName: string;
    declaredMimeType: string;
    sizeBytes: number;
    serverManaged: true;
  }): Promise<{
    revisionNo: number;
    uploadMode: 'single_put' | 'multipart';
    uploadToken: string;
    replayed: boolean;
  }>;
  getServerPendingUpload(input: {
    authUserId: string;
    sessionId: string;
    idempotencyKey: string;
  }): Promise<ServerPendingUploadBinding>;
  createUploadConfirm(input: {
    authUserId: string;
    sessionId: string;
    idempotencyKey: string;
    uploadToken: string;
    expectedRevisionNo: number;
  }): Promise<{
    sessionId: string;
    revisionNo: number;
    mediaStage: 'uploading' | 'ready_to_process';
    jobId: string;
    observedSizeBytes: number;
    observedContentType: string;
    jobType: 'media_quality_check';
    replayed: boolean;
  }>;
}

export interface MediaUrlImportResult {
  sessionId: string;
  revisionNo: number;
  mediaStage: PersistedMediaQualityCheckReceipt['mediaStage'];
  jobId: string;
  jobType: 'media_quality_check';
  sizeBytes: number;
  contentType: string;
  replayed: boolean;
}

export class MediaUrlImportError extends GuidedCreationError {}

function fail(
  code: string,
  message: string,
  statusCode: number,
  retryable = false,
): never {
  throw new MediaUrlImportError(code, message, statusCode, retryable);
}

export function createMediaUrlImportService(
  dependencies: MediaUrlImportDependencies = {},
) {
  const resolveHost =
    dependencies.resolveHost ??
    (async (hostname: string): Promise<ResolvedAddress[]> => {
      const addresses = await dnsLookup(hostname, { all: true, verbatim: true });
      return addresses.map((item) => ({
        address: item.address,
        family: item.family === 6 ? 6 : 4,
      }));
    });
  const openResponse = dependencies.openResponse ?? openPinnedResponse;
  const objectStorageService =
    dependencies.objectStorageService ??
    (() => {
      const storageConfig = readObjectStorageConfig();
      if (!storageConfig) {
        throw new Error('Object storage is not configured');
      }
      return createObjectStorageService({ config: storageConfig });
    })();
  const guidedCreationService =
    dependencies.guidedCreationService ?? createMultimodalGuidedCreationService();
  const importMaxBytes = normalizeMaxBytes(
    dependencies.maxBytes ?? config.multimodalUploadMaxBytes,
  );
  const connectTimeoutMs = positiveTimeout(
    dependencies.connectTimeoutMs,
    DEFAULT_CONNECT_TIMEOUT_MS,
    'connectTimeoutMs',
  );
  const readTimeoutMs = positiveTimeout(
    dependencies.readTimeoutMs,
    DEFAULT_READ_TIMEOUT_MS,
    'readTimeoutMs',
  );
  const totalTimeoutMs = positiveTimeout(
    dependencies.totalTimeoutMs,
    DEFAULT_TOTAL_TIMEOUT_MS,
    'totalTimeoutMs',
  );
  const maxRedirects = normalizeMaxRedirects(dependencies.maxRedirects);

  const api = {
    async openDirectMedia(input: {
      sourceUrl: string;
      maxBytes: number;
    }): Promise<OpenedDirectMedia> {
      const maxBytes = normalizeMaxBytes(input.maxBytes);
      const abortController = new AbortController();
      const totalTimeout = setTimeout(() => {
        abortController.abort(new Error('Remote media total timeout exceeded'));
      }, totalTimeoutMs);
      totalTimeout.unref?.();

      try {
        let currentUrl = parseAndValidateUrl(input.sourceUrl);
        for (let redirectCount = 0; ; redirectCount += 1) {
          const addresses = await resolveAndValidateHost(
            currentUrl.hostname,
            resolveHost,
          );
          const pinned = addresses[0];
          if (!pinned) {
            fail('URL_SSRF_BLOCKED', '远程地址没有可用的公共 IP', 422);
          }
          const remote = await openResponse({
            url: currentUrl,
            address: pinned.address,
            family: pinned.family,
            connectTimeoutMs,
            readTimeoutMs,
            signal: abortController.signal,
          });

          if (REDIRECT_STATUSES.has(remote.statusCode)) {
            remote.body.destroy();
            if (redirectCount >= maxRedirects) {
              fail('REMOTE_DOWNLOAD_FAILED', '远程媒体重定向次数过多', 422);
            }
            const location = firstHeader(remote.headers.location);
            if (!location) {
              fail('REMOTE_DOWNLOAD_FAILED', '远程重定向缺少 Location', 422);
            }
            currentUrl = parseAndValidateUrl(
              new URL(location, currentUrl).toString(),
            );
            continue;
          }

          if (remote.statusCode < 200 || remote.statusCode >= 300) {
            remote.body.destroy();
            fail(
              'REMOTE_DOWNLOAD_FAILED',
              `远程媒体返回 HTTP ${remote.statusCode}`,
              502,
              remote.statusCode >= 500,
            );
          }

          const contentType = normalizeRemoteContentType(
            firstHeader(remote.headers['content-type']),
          );
          const sizeBytes = normalizeRemoteContentLength(
            firstHeader(remote.headers['content-length']),
            maxBytes,
          );
          return {
            finalUrl: currentUrl.toString(),
            fileName: deriveRemoteFileName(currentUrl, contentType),
            contentType,
            sizeBytes,
            body: remote.body,
            abortController,
            totalTimeout,
          };
        }
      } catch (error) {
        clearTimeout(totalTimeout);
        abortController.abort();
        if (error instanceof GuidedCreationError) throw error;
        fail('REMOTE_DOWNLOAD_FAILED', '无法安全读取远程媒体', 502, true);
      }
    },

    async storeOpenedMedia(input: {
      opened: OpenedDirectMedia;
      objectKey: string;
    }): Promise<{
      objectKey: string;
      sizeBytes: number;
      contentType: string;
      sha256: string;
      etag: string | null;
      versionId: string | null;
    }> {
      const hash = createHash('sha256');
      let observedBytes = 0;
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          observedBytes += chunk.length;
          if (observedBytes > input.opened.sizeBytes) {
            callback(new Error('Remote body exceeded declared Content-Length'));
            return;
          }
          hash.update(chunk);
          callback(null, chunk);
        },
        flush(callback) {
          if (observedBytes !== input.opened.sizeBytes) {
            callback(new Error('Remote body did not match Content-Length'));
            return;
          }
          callback();
        },
      });
      input.opened.body.pipe(meter);

      try {
        const stored = await objectStorageService.putStream({
          objectKey: input.objectKey,
          body: meter,
          contentType: input.opened.contentType,
          sizeBytes: input.opened.sizeBytes,
        });
        return {
          objectKey: input.objectKey,
          sizeBytes: observedBytes,
          contentType: input.opened.contentType,
          sha256: hash.digest('hex'),
          etag: stored.etag,
          versionId: stored.versionId,
        };
      } catch (error) {
        meter.destroy();
        input.opened.body.destroy();
        if (error instanceof GuidedCreationError) throw error;
        fail('REMOTE_DOWNLOAD_FAILED', '远程媒体下载或存储中断', 502, true);
      } finally {
        clearTimeout(input.opened.totalTimeout);
        input.opened.abortController.abort();
      }
    },

    async importToSession(input: {
      authUserId: string;
      sessionId: string;
      idempotencyKey: string;
      sourceUrl: string;
    }): Promise<MediaUrlImportResult> {
      const canonicalSourceUrl = parseAndValidateUrl(input.sourceUrl).toString();
      const intentIdempotencyKey = derivePhaseIdempotencyKey(
        input.idempotencyKey,
        canonicalSourceUrl,
        'intent',
      );
      const confirmIdempotencyKey = derivePhaseIdempotencyKey(
        input.idempotencyKey,
        canonicalSourceUrl,
        'confirm',
      );
      const persisted =
        await guidedCreationService.findMediaQualityCheckByIdempotency({
          authUserId: input.authUserId,
          sessionId: input.sessionId,
          idempotencyKey: confirmIdempotencyKey,
        });
      if (persisted) {
        return {
          sessionId: persisted.sessionId,
          revisionNo: persisted.revisionNo,
          mediaStage: persisted.mediaStage,
          jobId: persisted.jobId,
          jobType: 'media_quality_check',
          sizeBytes: persisted.expectedSizeBytes,
          contentType: persisted.expectedContentType,
          replayed: true,
        };
      }

      const opened = await api.openDirectMedia({
        sourceUrl: canonicalSourceUrl,
        maxBytes: importMaxBytes,
      });
      try {
        const intent = await guidedCreationService.createUploadIntent({
          authUserId: input.authUserId,
          sessionId: input.sessionId,
          idempotencyKey: intentIdempotencyKey,
          fileName: opened.fileName,
          declaredMimeType: opened.contentType,
          sizeBytes: opened.sizeBytes,
          serverManaged: true,
        });
        const pending = await guidedCreationService.getServerPendingUpload({
          authUserId: input.authUserId,
          sessionId: input.sessionId,
          idempotencyKey: intentIdempotencyKey,
        });
        assertServerPendingUploadMatchesRemote(pending, opened);

        const existingObject =
          intent.replayed && objectStorageService.headObject
            ? await objectStorageService
                .headObject({ objectKey: pending.objectKey })
                .catch(() => null)
            : null;
        if (existingObject) {
          if (
            existingObject.sizeBytes !== opened.sizeBytes ||
            normalizeMediaType(existingObject.contentType) !== opened.contentType
          ) {
            fail('REMOTE_IMPORT_CONFLICT', '已存储对象与远程媒体声明不一致', 409);
          }
          disposeOpenedMedia(opened);
        } else {
          await api.storeOpenedMedia({
            opened,
            objectKey: pending.objectKey,
          });
        }

        const confirmed = await guidedCreationService.createUploadConfirm({
          authUserId: input.authUserId,
          sessionId: input.sessionId,
          idempotencyKey: confirmIdempotencyKey,
          uploadToken: intent.uploadToken,
          expectedRevisionNo: intent.revisionNo,
        });
        return {
          sessionId: confirmed.sessionId,
          revisionNo: confirmed.revisionNo,
          mediaStage: confirmed.mediaStage,
          jobId: confirmed.jobId,
          jobType: 'media_quality_check',
          sizeBytes: confirmed.observedSizeBytes,
          contentType: confirmed.observedContentType,
          replayed: confirmed.replayed,
        };
      } catch (error) {
        disposeOpenedMedia(opened);
        throw error;
      }
    },
  };
  return api;
}

function derivePhaseIdempotencyKey(
  requestKey: string,
  sourceUrl: string,
  phase: 'intent' | 'confirm',
): string {
  const digest = createHash('sha256')
    .update(`${requestKey}\n${sourceUrl}\n${phase}`)
    .digest('hex');
  return `url-${phase}-${digest.slice(0, 48)}`;
}

function disposeOpenedMedia(opened: OpenedDirectMedia): void {
  clearTimeout(opened.totalTimeout);
  opened.abortController.abort();
  opened.body.destroy();
}

function assertServerPendingUploadMatchesRemote(
  pending: ServerPendingUploadBinding,
  opened: OpenedDirectMedia,
): void {
  if (
    pending.uploadMode !== 'single_put' ||
    pending.fileName !== opened.fileName ||
    pending.declaredMimeType !== opened.contentType ||
    pending.sizeBytes !== opened.sizeBytes
  ) {
    fail('REMOTE_IMPORT_CONFLICT', '待上传绑定与远程媒体不一致', 409);
  }
}

function normalizeMediaType(value: string): string {
  return value.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function parseAndValidateUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail('URL_SSRF_BLOCKED', '远程媒体 URL 格式不正确', 422);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    fail('URL_SSRF_BLOCKED', '只允许 http/https 直接媒体 URL', 422);
  }
  if (url.username || url.password) {
    fail('URL_SSRF_BLOCKED', '远程媒体 URL 不能包含凭据', 422);
  }
  const hostname = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.length === 0
  ) {
    fail('URL_SSRF_BLOCKED', '不允许访问本机地址', 422);
  }
  if (
    url.port &&
    !(
      (url.protocol === 'http:' && url.port === '80') ||
      (url.protocol === 'https:' && url.port === '443')
    )
  ) {
    fail('URL_SSRF_BLOCKED', '远程媒体 URL 端口不允许', 422);
  }
  if (ipaddr.isValid(hostname) && !isPublicAddress(hostname)) {
    fail('URL_SSRF_BLOCKED', '远程媒体 URL 指向非公共地址', 422);
  }
  return url;
}

async function resolveAndValidateHost(
  hostname: string,
  resolveHost: (hostname: string) => Promise<ResolvedAddress[]>,
): Promise<ResolvedAddress[]> {
  const normalizedHostname = hostname.replace(/^\[|\]$/g, '');
  if (ipaddr.isValid(normalizedHostname)) {
    if (!isPublicAddress(normalizedHostname)) {
      fail('URL_SSRF_BLOCKED', '远程媒体 URL 指向非公共地址', 422);
    }
    return [
      {
        address: normalizedHostname,
        family: ipaddr.parse(normalizedHostname).kind() === 'ipv4' ? 4 : 6,
      },
    ];
  }
  let addresses: ResolvedAddress[];
  try {
    addresses = await resolveHost(normalizedHostname);
  } catch {
    fail('REMOTE_DOWNLOAD_FAILED', '远程媒体域名解析失败', 502, true);
  }
  if (
    addresses.length === 0 ||
    addresses.some(
      (item) =>
        (item.family !== 4 && item.family !== 6) ||
        !isPublicAddress(item.address),
    )
  ) {
    fail('URL_SSRF_BLOCKED', '远程媒体域名包含非公共地址', 422);
  }
  return addresses;
}

function isPublicAddress(address: string): boolean {
  try {
    let parsed = ipaddr.parse(address);
    if (parsed.kind() === 'ipv6') {
      const ipv6 = parsed as ipaddr.IPv6;
      if (ipv6.isIPv4MappedAddress()) {
        parsed = ipv6.toIPv4Address();
      }
    }
    return parsed.range() === 'unicast';
  } catch {
    return false;
  }
}

function normalizeRemoteContentType(value: string | undefined): string {
  const normalized = value?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (
    !/^(?:audio|video)\/[a-z0-9.+-]+$/.test(normalized) ||
    normalized === 'audio/*' ||
    normalized === 'video/*'
  ) {
    fail('UNSUPPORTED_MEDIA_TYPE', '远程地址不是可直接下载的音视频媒体', 422);
  }
  return normalized;
}

function normalizeRemoteContentLength(
  value: string | undefined,
  maxBytes: number,
): number {
  if (!value || !/^[1-9]\d*$/.test(value)) {
    fail(
      'REMOTE_DOWNLOAD_FAILED',
      '远程媒体必须提供可信的 Content-Length',
      422,
    );
  }
  const sizeBytes = Number(value);
  if (!Number.isSafeInteger(sizeBytes)) {
    fail('REMOTE_DOWNLOAD_FAILED', '远程媒体大小无效', 422);
  }
  if (sizeBytes > maxBytes) {
    fail('FILE_TOO_LARGE', '远程媒体超过允许的最大大小', 413);
  }
  return sizeBytes;
}

function deriveRemoteFileName(url: URL, contentType: string): string {
  let candidate = url.pathname.split('/').filter(Boolean).at(-1) ?? '';
  try {
    candidate = decodeURIComponent(candidate);
  } catch {
    candidate = '';
  }
  candidate = [...candidate]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 0x1f && code !== 0x7f && character !== '/' && character !== '\\';
    })
    .join('')
    .trim();
  if (!candidate || candidate.length > 200 || !candidate.includes('.')) {
    candidate = `remote-media.${extensionForContentType(contentType)}`;
  }
  return candidate;
}

function extensionForContentType(contentType: string): string {
  const known: Record<string, string> = {
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/ogg': 'ogg',
  };
  return known[contentType] ?? 'bin';
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeMaxBytes(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('maxBytes must be a positive safe integer');
  }
  return value;
}

function positiveTimeout(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return resolved;
}

function normalizeMaxRedirects(value: number | undefined): number {
  const resolved = value ?? DEFAULT_MAX_REDIRECTS;
  if (!Number.isInteger(resolved) || resolved < 0 || resolved > 10) {
    throw new Error('maxRedirects must be an integer between 0 and 10');
  }
  return resolved;
}

async function openPinnedResponse(
  input: OpenResponseInput,
): Promise<OpenedResponse> {
  return new Promise((resolve, reject) => {
    const lookup: LookupFunction = (_hostname, _options, callback) => {
      callback(null, input.address, input.family);
    };
    const request = (input.url.protocol === 'https:' ? httpsRequest : httpRequest)(
      input.url,
      {
        method: 'GET',
        headers: {
          accept: 'video/*, audio/*',
          'user-agent': 'EduSkill-Media-Importer/1.0',
        },
        lookup,
        signal: input.signal,
      },
      (response) => {
        clearTimeout(connectTimer);
        response.setTimeout(input.readTimeoutMs, () => {
          response.destroy(new Error('Remote media read timeout exceeded'));
        });
        resolve({
          statusCode: response.statusCode ?? 0,
          headers: response.headers,
          body: response,
        });
      },
    );
    const connectTimer = setTimeout(() => {
      request.destroy(new Error('Remote media connect timeout exceeded'));
    }, input.connectTimeoutMs);
    connectTimer.unref?.();
    request.once('error', (error) => {
      clearTimeout(connectTimer);
      reject(error);
    });
    request.end();
  });
}
