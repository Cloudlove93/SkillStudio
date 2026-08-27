import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import * as ipaddr from 'ipaddr.js';
import path from 'node:path';
import { Readable } from 'node:stream';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)(?!-)(?!.*\.\.)(?:[a-z0-9-]+\.)*[a-z0-9-]+$/i;
const HTML_CONTENT_TYPE_PATTERN = /^text\/html\b|^application\/xhtml\+xml\b/i;
const MIME_TYPE_PATTERN = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/;
const MAGIC_SNIFF_BYTES = 512;
const BLOCKED_SECONDARY_EXTENSIONS = new Set([
  'exe',
  'com',
  'bat',
  'cmd',
  'scr',
  'ps1',
  'msi',
  'zip',
  'tar',
]);

const MEDIA_RULES = [
  {
    extension: 'mp4',
    mediaKind: 'video',
    mimeTypes: ['video/mp4'],
    containerFamilies: ['iso-bmff'],
  },
  {
    extension: 'mov',
    mediaKind: 'video',
    mimeTypes: ['video/quicktime'],
    containerFamilies: ['iso-bmff'],
  },
  {
    extension: 'webm',
    mediaKind: 'video',
    mimeTypes: ['video/webm', 'audio/webm'],
    containerFamilies: ['ebml-webm'],
  },
  {
    extension: 'mp3',
    mediaKind: 'audio',
    mimeTypes: ['audio/mpeg'],
    containerFamilies: ['mp3'],
  },
  {
    extension: 'wav',
    mediaKind: 'audio',
    mimeTypes: ['audio/wav', 'audio/x-wav', 'audio/wave'],
    containerFamilies: ['riff-wave'],
  },
  {
    extension: 'm4a',
    mediaKind: 'audio',
    mimeTypes: ['audio/mp4', 'audio/x-m4a'],
    containerFamilies: ['iso-bmff'],
  },
  {
    extension: 'ogg',
    mediaKind: 'audio',
    mimeTypes: ['audio/ogg'],
    containerFamilies: ['ogg'],
  },
] as const;

type MediaRule = (typeof MEDIA_RULES)[number];
type ResolvedAddress = { address: string; family: number };
type PinnedRequest = {
  url: string;
  hostname: string;
  pinnedIp: string;
  family: 4 | 6;
  connectTimeoutMs: number;
  readTimeoutMs: number;
  remainingTimeMs?: number;
};
type PinnedResponse = {
  statusCode: number;
  headers: Record<string, string | undefined>;
  body: Readable;
};

export class UploadSecurityError extends Error {
  code: string;
  status: number;
  retryable: boolean;

  constructor(code: string, message: string, status = 400, retryable = false) {
    super(message);
    this.name = 'UploadSecurityError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
    };
  }
}

export function createUploadSecurityService(
  options: {
    maxUploadBytes?: number;
    maxRemoteBytes?: number;
    maxRedirects?: number;
    connectTimeoutMs?: number;
    readTimeoutMs?: number;
    totalDownloadTimeoutMs?: number;
    now?: () => Date;
    dnsResolver?: (hostname: string) => Promise<ResolvedAddress[]>;
    sendPinnedRequest?: (request: PinnedRequest) => Promise<PinnedResponse>;
  } = {},
) {
  const maxUploadBytes = options.maxUploadBytes ?? 25 * 1024 * 1024;
  const maxRemoteBytes = options.maxRemoteBytes ?? maxUploadBytes;
  const maxRedirects = options.maxRedirects ?? 5;
  const connectTimeoutMs = options.connectTimeoutMs ?? 10_000;
  const readTimeoutMs = options.readTimeoutMs ?? 10_000;
  const totalDownloadTimeoutMs = options.totalDownloadTimeoutMs ?? 60_000;
  const now = options.now ?? (() => new Date());

  validatePositiveIntegerOption(maxUploadBytes, 'maxUploadBytes');
  validatePositiveIntegerOption(maxRemoteBytes, 'maxRemoteBytes');
  validateNonNegativeSafeIntegerOption(maxRedirects, 'maxRedirects');
  validatePositiveIntegerOption(connectTimeoutMs, 'connectTimeoutMs');
  validatePositiveIntegerOption(readTimeoutMs, 'readTimeoutMs');
  validatePositiveIntegerOption(
    totalDownloadTimeoutMs,
    'totalDownloadTimeoutMs',
  );

  const dnsResolver = options.dnsResolver ?? defaultDnsResolver;
  const sendPinnedRequest =
    options.sendPinnedRequest ?? createPinnedRequestSender();
  const deadlineError = () =>
    new UploadSecurityError(
      'REMOTE_DOWNLOAD_FAILED',
      'Remote media download failed.',
      502,
    );

  return {
    validateUploadIntent(input: {
      fileName: string;
      declaredMimeType: string;
      sizeBytes: number;
    }) {
      return validateUploadIntent(input, maxUploadBytes);
    },

    async verifyUploadedContent(input: {
      stream: Readable;
      fileName: string;
      declaredMimeType: string;
      expectedSizeBytes?: number;
      expectedSha256?: string;
      clientReportedSha256?: string;
      clientReportedEtag?: string;
    }) {
      return verifyVerifiedMedia({
        stream: input.stream,
        fileName: input.fileName,
        declaredMimeType: input.declaredMimeType,
        maxBytes: maxUploadBytes,
        expectedSizeBytes: input.expectedSizeBytes,
        expectedSha256:
          typeof input.expectedSha256 === 'string' &&
          input.expectedSha256.trim() !== ''
            ? validateExpectedSha256(input.expectedSha256)
            : undefined,
      });
    },

    async downloadAndVerifyRemoteMedia(input: { url: string }) {
      const deadlineGuard = createDeadlineGuard({
        totalTimeoutMs: totalDownloadTimeoutMs,
        now,
        createTimeoutError: deadlineError,
      });
      try {
        return await deadlineGuard.awaitWithDeadline(
          (async () => {
            try {
              let currentUrl = validateRemoteUrl(input.url);

              for (
                let redirectCount = 0;
                redirectCount <= maxRedirects;
                redirectCount += 1
              ) {
                deadlineGuard.assertWithinDeadline();
                const resolution = await deadlineGuard.awaitWithDeadline(
                  resolvePinnedAddress(currentUrl, dnsResolver),
                );
                const response = await deadlineGuard.awaitWithDeadline(
                  sendPinnedRequest({
                    url: currentUrl.toString(),
                    hostname: currentUrl.hostname,
                    pinnedIp: resolution.address,
                    family: resolution.family as 4 | 6,
                    connectTimeoutMs,
                    readTimeoutMs,
                    remainingTimeMs: deadlineGuard.remainingTimeMs(),
                  }),
                  (lateResponse) => {
                    destroyReadable(lateResponse.body);
                  },
                );
                deadlineGuard.assertWithinDeadline();

                if (isRedirectStatus(response.statusCode)) {
                  destroyReadable(response.body);
                  if (redirectCount === maxRedirects) {
                    throw new UploadSecurityError(
                      'REMOTE_DOWNLOAD_FAILED',
                      'Remote media download failed.',
                      502,
                    );
                  }
                  const location = response.headers.location;
                  if (!location) {
                    throw new UploadSecurityError(
                      'REMOTE_DOWNLOAD_FAILED',
                      'Remote media download failed.',
                      502,
                    );
                  }
                  const nextUrl = validateRemoteUrl(
                    new URL(location, currentUrl).toString(),
                  );
                  if (
                    currentUrl.protocol === 'https:' &&
                    nextUrl.protocol !== 'https:'
                  ) {
                    throw new UploadSecurityError(
                      'REMOTE_DOWNLOAD_FAILED',
                      'Remote media download failed.',
                      502,
                    );
                  }
                  currentUrl = nextUrl;
                  continue;
                }

                return consumeFinalResponse({
                  response,
                  currentUrl,
                  maxRemoteBytes,
                  deadlineGuard,
                });
              }

              throw deadlineError();
            } catch (error) {
              if (error instanceof UploadSecurityError) {
                throw error;
              }
              throw deadlineError();
            }
          })(),
        );
      } finally {
        deadlineGuard.clear();
      }
    },
  };
}

function sanitizeFinalUrl(url: URL): string {
  const sanitized = new URL(url.toString());
  sanitized.search = '';
  sanitized.hash = '';
  return sanitized.toString();
}

function destroyReadable(stream: Readable, error?: Error): void {
  stream.destroy?.(error);
}

function validateExpectedSha256(expectedSha256: string): string {
  const normalized = expectedSha256.trim().toLowerCase();
  if (!SHA256_PATTERN.test(normalized)) {
    throw new UploadSecurityError(
      'INVALID_UPLOAD_INTENT',
      'Upload request is invalid.',
      422,
    );
  }

  return normalized;
}

function validateUploadIntent(
  input: { fileName: string; declaredMimeType: string; sizeBytes: number },
  maxBytes: number,
) {
  const normalizedFileName = normalizeFileName(input.fileName);
  const extension = extractExtension(normalizedFileName);
  const rule = ruleForExtension(extension);
  const declaredMimeType = normalizeMimeType(input.declaredMimeType);

  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0) {
    throw new UploadSecurityError(
      'INVALID_UPLOAD_INTENT',
      'Upload request is invalid.',
      422,
    );
  }
  if (input.sizeBytes > maxBytes) {
    throw new UploadSecurityError(
      'FILE_TOO_LARGE',
      'Uploaded content exceeds the allowed size.',
      413,
    );
  }
  if (!rule.mimeTypes.includes(declaredMimeType as never)) {
    throw new UploadSecurityError(
      'UNSUPPORTED_MEDIA_TYPE',
      'Uploaded content is not an allowed media type.',
      415,
    );
  }

  return {
    normalizedFileName,
    extension,
    mediaKind: rule.mediaKind,
    declaredMimeType,
  };
}

function validatePositiveIntegerOption(value: number, fieldName: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new UploadSecurityError(
      'INVALID_UPLOAD_INTENT',
      `${fieldName} must be a positive integer.`,
      422,
    );
  }
}

function validateNonNegativeSafeIntegerOption(
  value: number,
  fieldName: string,
): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new UploadSecurityError(
      'INVALID_UPLOAD_INTENT',
      `${fieldName} must be a non-negative integer.`,
      422,
    );
  }
}

async function verifyVerifiedMedia(input: {
  stream: Readable;
  fileName: string;
  declaredMimeType: string;
  maxBytes: number;
  expectedSizeBytes?: number;
  expectedSha256?: string;
  deadlineGuard?: DeadlineGuard;
}) {
  const intent = validateUploadIntent(
    {
      fileName: input.fileName,
      declaredMimeType: input.declaredMimeType,
      sizeBytes: input.expectedSizeBytes ?? 1,
    },
    Number.MAX_SAFE_INTEGER,
  );
  const verification = await verifyStreamContent({
    stream: input.stream,
    maxBytes: input.maxBytes,
    deadlineGuard: input.deadlineGuard,
  });
  const rule = ruleForExtension(intent.extension);
  if (
    !(rule.containerFamilies as readonly string[]).includes(
      verification.containerFamily,
    )
  ) {
    throw new UploadSecurityError(
      'UNSUPPORTED_MEDIA_TYPE',
      'Uploaded content is not an allowed media type.',
      415,
    );
  }
  if (
    typeof input.expectedSizeBytes === 'number' &&
    verification.sizeBytes !== input.expectedSizeBytes
  ) {
    throw new UploadSecurityError(
      'FILE_SIZE_MISMATCH',
      'Uploaded content size did not match the expected size.',
      422,
    );
  }
  if (
    typeof input.expectedSha256 === 'string' &&
    verification.sha256 !== input.expectedSha256
  ) {
    throw new UploadSecurityError(
      'FILE_HASH_MISMATCH',
      'Uploaded content hash did not match the expected hash.',
      422,
    );
  }

  return {
    normalizedFileName: intent.normalizedFileName,
    extension: intent.extension,
    mediaKind: intent.mediaKind,
    declaredMimeType: intent.declaredMimeType,
    sizeBytes: verification.sizeBytes,
    sha256: verification.sha256,
    containerFamily: verification.containerFamily,
  };
}

async function verifyStreamContent(input: {
  stream: Readable;
  maxBytes: number;
  deadlineGuard?: DeadlineGuard;
}) {
  const hash = createHash('sha256');
  const sniffBuffer = Buffer.allocUnsafe(MAGIC_SNIFF_BYTES);
  let sniffLength = 0;
  let totalBytes = 0;

  try {
    for await (const chunk of input.stream) {
      input.deadlineGuard?.assertWithinDeadline();
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.byteLength;
      if (totalBytes > input.maxBytes) {
        const sizeError = new UploadSecurityError(
          'FILE_TOO_LARGE',
          'Uploaded content exceeds the allowed size.',
          413,
        );
        destroyReadable(input.stream);
        throw sizeError;
      }
      if (sniffLength < MAGIC_SNIFF_BYTES) {
        const copyLength = Math.min(
          MAGIC_SNIFF_BYTES - sniffLength,
          buffer.byteLength,
        );
        buffer.copy(sniffBuffer, sniffLength, 0, copyLength);
        sniffLength += copyLength;
      }
      hash.update(buffer);
    }
  } catch (error) {
    if (input.deadlineGuard?.expired) {
      throw input.deadlineGuard.createTimeoutError();
    }
    if (error instanceof UploadSecurityError) {
      throw error;
    }
    throw error;
  }

  const containerFamily = detectContainerFamily(
    sniffBuffer.subarray(0, sniffLength),
  );
  if (!containerFamily) {
    throw new UploadSecurityError(
      'UNSUPPORTED_MEDIA_TYPE',
      'Uploaded content is not an allowed media type.',
      415,
    );
  }

  return {
    sizeBytes: totalBytes,
    sha256: hash.digest('hex'),
    containerFamily,
  };
}

function normalizeFileName(fileName: string): string {
  if (fileName !== fileName.trim() || fileName.endsWith('.')) {
    throw new UploadSecurityError(
      'INVALID_UPLOAD_INTENT',
      'Upload request is invalid.',
      422,
    );
  }

  const trimmed = fileName.trim();
  if (
    trimmed === '' ||
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    containsControlCharacters(trimmed)
  ) {
    throw new UploadSecurityError(
      'INVALID_UPLOAD_INTENT',
      'Upload request is invalid.',
      422,
    );
  }
  return trimmed;
}

function extractExtension(fileName: string): string {
  const parts = fileName.split('.');
  if (
    parts.length >= 3 &&
    parts
      .slice(1, -1)
      .some((segment) =>
        BLOCKED_SECONDARY_EXTENSIONS.has(segment.toLowerCase()),
      )
  ) {
    throw new UploadSecurityError(
      'UNSUPPORTED_MEDIA_TYPE',
      'Uploaded content is not an allowed media type.',
      415,
    );
  }

  const extension = path.extname(fileName).replace(/^\./, '').toLowerCase();
  if (!/^[a-z0-9]{1,16}$/.test(extension)) {
    throw new UploadSecurityError(
      'UNSUPPORTED_MEDIA_TYPE',
      'Uploaded content is not an allowed media type.',
      415,
    );
  }
  return extension;
}

function ruleForExtension(extension: string): MediaRule {
  const rule = MEDIA_RULES.find((entry) => entry.extension === extension);
  if (!rule) {
    throw new UploadSecurityError(
      'UNSUPPORTED_MEDIA_TYPE',
      'Uploaded content is not an allowed media type.',
      415,
    );
  }
  return rule;
}

function normalizeMimeType(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (
    normalized.includes(';') ||
    containsControlCharacters(normalized) ||
    !MIME_TYPE_PATTERN.test(normalized)
  ) {
    throw new UploadSecurityError(
      'UNSUPPORTED_MEDIA_TYPE',
      'Uploaded content is not an allowed media type.',
      415,
    );
  }
  return normalized;
}

function detectContainerFamily(buffer: Buffer) {
  if (isHtml(buffer) || isPortableExecutable(buffer) || isZipArchive(buffer)) {
    return null;
  }
  if (
    buffer.byteLength >= 12 &&
    buffer.subarray(4, 8).toString('ascii') === 'ftyp'
  ) {
    return 'iso-bmff';
  }
  if (
    buffer.byteLength >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WAVE'
  ) {
    return 'riff-wave';
  }
  if (
    buffer.byteLength >= 4 &&
    buffer.subarray(0, 4).equals(Buffer.from('OggS'))
  ) {
    return 'ogg';
  }
  if (
    buffer.byteLength >= 4 &&
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3
  ) {
    return 'ebml-webm';
  }
  if (
    (buffer.byteLength >= 3 &&
      buffer.subarray(0, 3).equals(Buffer.from('ID3'))) ||
    (buffer.byteLength >= 2 &&
      buffer[0] === 0xff &&
      (buffer[1] & 0xe0) === 0xe0)
  ) {
    return 'mp3';
  }
  return null;
}

function isHtml(buffer: Buffer): boolean {
  const prefix = buffer
    .subarray(0, 64)
    .toString('utf8')
    .trimStart()
    .toLowerCase();
  return prefix.startsWith('<!doctype html') || prefix.startsWith('<html');
}

function isPortableExecutable(buffer: Buffer): boolean {
  return buffer.byteLength >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a;
}

function isZipArchive(buffer: Buffer): boolean {
  return (
    buffer.byteLength >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  );
}

function validateRemoteUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new UploadSecurityError(
      'URL_SSRF_BLOCKED',
      'Remote URL is not allowed.',
      422,
    );
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new UploadSecurityError(
      'URL_SSRF_BLOCKED',
      'Remote URL is not allowed.',
      422,
    );
  }
  if (parsed.username || parsed.password) {
    throw new UploadSecurityError(
      'URL_SSRF_BLOCKED',
      'Remote URL is not allowed.',
      422,
    );
  }

  const hostname = normalizeHostname(parsed.hostname);
  if (!hostname || hostname === 'localhost' || hostname === 'localhost.') {
    throw new UploadSecurityError(
      'URL_SSRF_BLOCKED',
      'Remote URL is not allowed.',
      422,
    );
  }
  if (isAmbiguousIpv4Notation(hostname)) {
    throw new UploadSecurityError(
      'URL_SSRF_BLOCKED',
      'Remote URL is not allowed.',
      422,
    );
  }
  if (!parseIpAddressOrNull(hostname) && !HOSTNAME_PATTERN.test(hostname)) {
    throw new UploadSecurityError(
      'URL_SSRF_BLOCKED',
      'Remote URL is not allowed.',
      422,
    );
  }
  if (isBlockedAddress(hostname)) {
    throw new UploadSecurityError(
      'URL_SSRF_BLOCKED',
      'Remote URL is not allowed.',
      422,
    );
  }

  return parsed;
}

async function resolvePinnedAddress(
  url: URL,
  dnsResolver: (hostname: string) => Promise<ResolvedAddress[]>,
): Promise<ResolvedAddress> {
  const hostname = normalizeHostname(url.hostname);
  const literalIp = parseIpAddressOrNull(hostname);
  if (literalIp) {
    return {
      address: literalIp.toNormalizedString(),
      family: literalIp.kind() === 'ipv4' ? 4 : 6,
    };
  }

  const records = await dnsResolver(hostname);
  if (!Array.isArray(records) || records.length === 0) {
    throw new UploadSecurityError(
      'REMOTE_DOWNLOAD_FAILED',
      'Remote media download failed.',
      502,
    );
  }

  for (const record of records) {
    if (isBlockedAddress(record.address)) {
      throw new UploadSecurityError(
        'URL_SSRF_BLOCKED',
        'Remote URL is not allowed.',
        422,
      );
    }
  }

  return records[0]!;
}

async function defaultDnsResolver(
  hostname: string,
): Promise<ResolvedAddress[]> {
  return lookup(hostname, { all: true, verbatim: true });
}

export function createPinnedRequestSender(
  options: {
    httpRequest?: typeof http.request;
    httpsRequest?: typeof https.request;
  } = {},
) {
  return async function defaultPinnedRequest(
    request: PinnedRequest,
  ): Promise<PinnedResponse> {
    const url = new URL(request.url);
    const requestFactory =
      url.protocol === 'https:'
        ? (options.httpsRequest ?? https.request)
        : (options.httpRequest ?? http.request);

    return new Promise<PinnedResponse>((resolve, reject) => {
      const remainingTimeMs =
        typeof request.remainingTimeMs === 'number'
          ? Math.max(1, request.remainingTimeMs)
          : null;
      const connectTimeoutMs =
        remainingTimeMs == null
          ? request.connectTimeoutMs
          : Math.min(request.connectTimeoutMs, remainingTimeMs);
      const readTimeoutMs =
        remainingTimeMs == null
          ? request.readTimeoutMs
          : Math.min(request.readTimeoutMs, remainingTimeMs);
      const outgoing = requestFactory(
        {
          method: 'GET',
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || undefined,
          path: `${url.pathname}${url.search}`,
          headers: {
            accept: '*/*',
            host: url.host,
            'user-agent': 'educlaw-server/remote-import',
          },
          servername: url.hostname,
          lookup(
            _hostname: string,
            _options: unknown,
            callback: (
              error: Error | null,
              address: string,
              family: number,
            ) => void,
          ) {
            callback(null, request.pinnedIp, request.family);
          },
        } as http.RequestOptions,
        (response: http.IncomingMessage) => {
          response.setTimeout(readTimeoutMs, () => {
            response.destroy(new Error('read timeout'));
          });

          if (
            !sameIpAddress(response.socket?.remoteAddress, request.pinnedIp)
          ) {
            response.destroy();
            reject(
              new UploadSecurityError(
                'REMOTE_DOWNLOAD_FAILED',
                'Remote response did not match the pinned address.',
                502,
              ),
            );
            return;
          }

          resolve({
            statusCode: response.statusCode ?? 0,
            headers: normalizeResponseHeaders(response.headers),
            body: response,
          });
        },
      );

      outgoing.setTimeout(connectTimeoutMs, () => {
        outgoing.destroy(new Error('connect timeout'));
      });
      outgoing.on('error', reject);
      outgoing.end();
    });
  };
}

function normalizeResponseHeaders(
  headers: http.IncomingHttpHeaders,
): Record<string, string | undefined> {
  const normalized: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      normalized[key.toLowerCase()] = value.join(', ');
    } else {
      normalized[key.toLowerCase()] = value;
    }
  }
  return normalized;
}

function isRedirectStatus(statusCode: number) {
  return [301, 302, 303, 307, 308].includes(statusCode);
}

function normalizeContentTypeHeader(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return normalized === '' ? null : normalized;
}

function parseContentLength(value: string | undefined): number | null {
  if (!value) return null;
  if (!/^\d+$/.test(value.trim())) {
    throw new UploadSecurityError(
      'REMOTE_DOWNLOAD_FAILED',
      'Remote media download failed.',
      502,
    );
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new UploadSecurityError(
      'REMOTE_DOWNLOAD_FAILED',
      'Remote media download failed.',
      502,
    );
  }
  return parsed;
}

function deriveRemoteFileName(url: URL): string {
  const baseName = path.posix.basename(url.pathname);
  if (!baseName || !baseName.includes('.')) {
    throw new UploadSecurityError(
      'UNSUPPORTED_MEDIA_TYPE',
      'Uploaded content is not an allowed media type.',
      415,
    );
  }
  return baseName;
}

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, '').toLowerCase();
}

function containsControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }

  return false;
}

function isAmbiguousIpv4Notation(hostname: string): boolean {
  if (parseIpAddressOrNull(hostname)) {
    return false;
  }

  if (/^0x[0-9a-f]+$/i.test(hostname)) {
    return true;
  }
  if (/^0[0-7]+(?:\.[0-7]+){0,3}$/.test(hostname)) {
    return true;
  }
  if (/^\d+$/.test(hostname)) {
    return true;
  }

  return false;
}

export function isBlockedAddress(address: string): boolean {
  const parsed = parseIpAddressOrNull(address);
  if (!parsed) {
    return false;
  }

  const comparable = toComparableIpAddress(parsed);
  return comparable.range() !== 'unicast';
}

function parseIpAddressOrNull(
  address: string,
): ipaddr.IPv4 | ipaddr.IPv6 | null {
  const normalized = normalizeHostname(address);
  if (!ipaddr.isValid(normalized)) {
    return null;
  }

  return ipaddr.parse(normalized);
}

function toComparableIpAddress(
  address: ipaddr.IPv4 | ipaddr.IPv6,
): ipaddr.IPv4 | ipaddr.IPv6 {
  if (address.kind() === 'ipv6') {
    const ipv6Address = address as ipaddr.IPv6;
    if (ipv6Address.isIPv4MappedAddress()) {
      return ipv6Address.toIPv4Address();
    }
  }

  return address;
}

function sameIpAddress(
  left: string | undefined,
  right: string | undefined,
): boolean {
  if (!left || !right) {
    return false;
  }

  const parsedLeft = parseIpAddressOrNull(left);
  const parsedRight = parseIpAddressOrNull(right);
  if (!parsedLeft || !parsedRight) {
    return false;
  }

  const comparableLeft = toComparableIpAddress(parsedLeft);
  const comparableRight = toComparableIpAddress(parsedRight);
  if (comparableLeft.kind() !== comparableRight.kind()) {
    return false;
  }

  return (
    comparableLeft.toByteArray().join(',') ===
    comparableRight.toByteArray().join(',')
  );
}

type DeadlineGuard = {
  expired: boolean;
  createTimeoutError: () => UploadSecurityError;
  remainingTimeMs: () => number;
  setActiveBody: (body: Readable | null) => void;
  assertWithinDeadline: () => void;
  awaitWithDeadline: <T>(
    promise: Promise<T>,
    onLateResolve?: (value: T) => void,
  ) => Promise<T>;
  clear: () => void;
};

function createDeadlineGuard(input: {
  totalTimeoutMs: number;
  now: () => Date;
  createTimeoutError: () => UploadSecurityError;
}): DeadlineGuard {
  const startedAtMs = input.now().getTime();
  const deadlineAtMs = startedAtMs + input.totalTimeoutMs;
  let expired = false;
  let cleared = false;
  let activeBody: Readable | null = null;
  const timeoutListeners = new Set<(error: UploadSecurityError) => void>();
  const expire = (): UploadSecurityError => {
    if (!expired) {
      expired = true;
      const timeoutError = input.createTimeoutError();
      if (activeBody) {
        destroyReadable(activeBody);
      }
      for (const listener of timeoutListeners) {
        listener(timeoutError);
      }
      timeoutListeners.clear();
      return timeoutError;
    }

    return input.createTimeoutError();
  };
  const timer = setTimeout(() => {
    if (!cleared) {
      expire();
    }
  }, input.totalTimeoutMs);
  timer.unref?.();

  return {
    get expired() {
      return expired;
    },
    createTimeoutError: input.createTimeoutError,
    remainingTimeMs() {
      return Math.max(0, deadlineAtMs - input.now().getTime());
    },
    setActiveBody(body) {
      activeBody = body;
      if (expired && body) {
        destroyReadable(body);
      }
    },
    assertWithinDeadline() {
      if (input.now().getTime() >= deadlineAtMs) {
        throw expire();
      }
    },
    awaitWithDeadline<T>(
      promise: Promise<T>,
      onLateResolve?: (value: T) => void,
    ) {
      return new Promise<T>((resolve, reject) => {
        let settled = false;
        const onTimeout = (error: UploadSecurityError) => {
          if (settled) {
            return;
          }
          settled = true;
          timeoutListeners.delete(onTimeout);
          reject(error);
        };
        timeoutListeners.add(onTimeout);

        const settleReject = (error: unknown) => {
          if (settled) {
            return;
          }
          settled = true;
          timeoutListeners.delete(onTimeout);
          reject(error);
        };

        const settleResolve = (value: T) => {
          if (settled) {
            return;
          }
          settled = true;
          timeoutListeners.delete(onTimeout);
          resolve(value);
        };

        void promise.then(
          (value) => {
            if (cleared || expired) {
              onLateResolve?.(value);
              settleReject(input.createTimeoutError());
              return;
            }
            try {
              if (input.now().getTime() >= deadlineAtMs) {
                onLateResolve?.(value);
                settleReject(expire());
                return;
              }
            } catch (error) {
              settleReject(error);
              return;
            }
            settleResolve(value);
          },
          (error) => {
            if (cleared || expired) {
              settleReject(input.createTimeoutError());
              return;
            }
            settleReject(error);
          },
        );
      });
    },
    clear() {
      cleared = true;
      activeBody = null;
      timeoutListeners.clear();
      clearTimeout(timer);
    },
  };
}

async function consumeFinalResponse(input: {
  response: PinnedResponse;
  currentUrl: URL;
  maxRemoteBytes: number;
  deadlineGuard: DeadlineGuard;
}) {
  input.deadlineGuard.setActiveBody(input.response.body);
  try {
    if (input.response.statusCode < 200 || input.response.statusCode >= 300) {
      throw new UploadSecurityError(
        'REMOTE_DOWNLOAD_FAILED',
        'Remote media download failed.',
        502,
      );
    }

    input.deadlineGuard.assertWithinDeadline();
    const contentType = normalizeContentTypeHeader(
      input.response.headers['content-type'],
    );
    if (!contentType || HTML_CONTENT_TYPE_PATTERN.test(contentType)) {
      throw new UploadSecurityError(
        'UNSUPPORTED_MEDIA_TYPE',
        'Uploaded content is not an allowed media type.',
        415,
      );
    }
    const contentLength = parseContentLength(
      input.response.headers['content-length'],
    );
    if (contentLength != null && contentLength > input.maxRemoteBytes) {
      throw new UploadSecurityError(
        'FILE_TOO_LARGE',
        'Uploaded content exceeds the allowed size.',
        413,
      );
    }

    const verified = await verifyVerifiedMedia({
      stream: input.response.body,
      fileName: deriveRemoteFileName(input.currentUrl),
      declaredMimeType: contentType,
      maxBytes: input.maxRemoteBytes,
      expectedSizeBytes: contentLength ?? undefined,
      deadlineGuard: input.deadlineGuard,
    });
    return {
      finalUrl: sanitizeFinalUrl(input.currentUrl),
      verified,
    };
  } catch (error) {
    if (error instanceof UploadSecurityError) {
      throw error;
    }
    throw new UploadSecurityError(
      'REMOTE_DOWNLOAD_FAILED',
      'Remote media download failed.',
      502,
    );
  } finally {
    destroyReadable(input.response.body);
    input.deadlineGuard.setActiveBody(null);
  }
}
