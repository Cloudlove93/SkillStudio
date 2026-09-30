import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type { ObjectStorageConfig } from '../../config/object-storage-config.js';

const SESSION_CATEGORIES = new Set([
  'source',
  'audio',
  'transcript',
  'frames/candidates',
  'frames/selected',
  'manifest',
] as const);
const VERSION_CATEGORIES = new Set(['visual', 'code', 'audio'] as const);
const SAFE_EXTENSION_PATTERN = /^[a-z0-9]{1,16}$/;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ALLOWED_OBJECT_KEY_PATTERNS = [
  /^skill-(?:sessions\/[1-9]\d*\/(?:source|audio|transcript|frames\/candidates|frames\/selected|manifest)|versions\/[1-9]\d*\/(?:visual|code|audio))\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[a-z0-9]{1,16}$/,
  /^skill-sessions\/[1-9]\d*\/manifest\/media-quality-check\/job-[1-9]\d*-attempt-[1-9]\d*\.json$/,
  /^skill-sessions\/[1-9]\d*\/jobs\/[1-9]\d*\/attempt-[1-9]\d*\/(?:result\.json|normalized-audio\.wav|transcript\.json|transcript-chunks\/chunk-\d{4}\.json|frames\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}\.png)$/,
] as const;

export type ObjectStorageGrant = {
  method: 'GET' | 'PUT';
  objectKey: string;
  url: string;
  expiresAt: string;
  requiredHeaders: Record<string, string>;
};

export type MultipartUploadPartGrant = {
  method: 'PUT';
  partNumber: number;
  url: string;
  expiresAt: string;
  requiredHeaders: Record<string, string>;
};

export type CompleteMultipartUploadResult = {
  objectKey: string;
  etag: string | null;
  versionId: string | null;
};

export type StoredObjectInfo = {
  objectKey: string;
  sizeBytes: number;
  contentType: string;
  metadataMimeType: string | null;
  metadataSha256: string | null;
};

type S3SendClient = Pick<S3Client, 'send'>;
type PresignUrl = typeof getSignedUrl;

export function createObjectStorageService(options: {
  config: ObjectStorageConfig;
  s3Client?: S3SendClient;
  presignUrl?: PresignUrl;
  now?: () => Date;
  createRandomId?: () => string;
}) {
  const config = options.config;
  const s3Client =
    options.s3Client ??
    new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  const presignUrl = options.presignUrl ?? getSignedUrl;
  const now = options.now ?? (() => new Date());
  const createRandomId =
    options.createRandomId ?? (() => randomUUID().toLowerCase());

  return {
    async checkHealth(): Promise<void> {
      await s3Client.send(new HeadBucketCommand({ Bucket: config.bucket }));
    },

    createSessionObjectKey(input: {
      sessionId: string;
      category:
        | (typeof SESSION_CATEGORIES extends Set<infer T> ? T : never)
        | string;
      extension: string;
    }) {
      return buildObjectKey(
        'skill-sessions',
        input.sessionId,
        input.category,
        input.extension,
        createRandomId,
      );
    },

    createSkillVersionObjectKey(input: {
      versionId: string;
      category:
        | (typeof VERSION_CATEGORIES extends Set<infer T> ? T : never)
        | string;
      extension: string;
    }) {
      return buildObjectKey(
        'skill-versions',
        input.versionId,
        input.category,
        input.extension,
        createRandomId,
      );
    },

    async createSignedGetGrant(input: {
      objectKey: string;
      expiresInSeconds?: number;
    }): Promise<ObjectStorageGrant> {
      const objectKey = validateExistingObjectKey(input.objectKey);
      const expiresInSeconds = resolveTtlSeconds(
        input.expiresInSeconds,
        config.signedUrlTtlSeconds,
      );
      const url = await presignUrl(
        s3Client as S3Client,
        new GetObjectCommand({
          Bucket: config.bucket,
          Key: objectKey,
        }),
        {
          expiresIn: expiresInSeconds,
        },
      );

      return {
        method: 'GET',
        objectKey,
        url,
        expiresAt: new Date(
          now().getTime() + expiresInSeconds * 1000,
        ).toISOString(),
        requiredHeaders: {},
      };
    },

    async createSignedPutGrant(input: {
      objectKey: string;
      contentType: string;
      expiresInSeconds?: number;
    }): Promise<ObjectStorageGrant> {
      const objectKey = validateExistingObjectKey(input.objectKey);
      const contentType = requireContentType(input.contentType);
      const expiresInSeconds = resolveTtlSeconds(
        input.expiresInSeconds,
        config.signedUrlTtlSeconds,
      );
      const url = await presignUrl(
        s3Client as S3Client,
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: objectKey,
          ContentType: contentType,
          IfNoneMatch: '*',
        }),
        {
          expiresIn: expiresInSeconds,
          signableHeaders: new Set(['content-type', 'if-none-match']),
        },
      );

      return {
        method: 'PUT',
        objectKey,
        url,
        expiresAt: new Date(
          now().getTime() + expiresInSeconds * 1000,
        ).toISOString(),
        requiredHeaders: {
          'content-type': contentType,
          'if-none-match': '*',
        },
      };
    },

    async putStream(input: {
      objectKey: string;
      body: Readable;
      contentType: string;
      sizeBytes: number;
    }): Promise<CompleteMultipartUploadResult> {
      const objectKey = validateExistingObjectKey(input.objectKey);
      const contentType = requireContentType(input.contentType);
      const sizeBytes = requireObjectSize(input.sizeBytes);
      if (!(input.body instanceof Readable)) {
        throw new Error('body must be a Node.js readable stream');
      }
      const response = await s3Client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: objectKey,
          Body: input.body,
          ContentType: contentType,
          ContentLength: sizeBytes,
          IfNoneMatch: '*',
          Metadata: {
            'mime-type': contentType,
          },
        }),
      );
      return {
        objectKey,
        etag: normalizeReturnedEtag(response.ETag),
        versionId: normalizeVersionId(response.VersionId),
      };
    },

    async createMultipartUpload(input: {
      objectKey: string;
      contentType: string;
    }): Promise<{ multipartUploadId: string }> {
      const objectKey = validateExistingObjectKey(input.objectKey);
      const contentType = requireContentType(input.contentType);
      const response = await s3Client.send(
        new CreateMultipartUploadCommand({
          Bucket: config.bucket,
          Key: objectKey,
          ContentType: contentType,
        }),
      );
      const multipartUploadId = requireMultipartUploadId(response.UploadId);
      return {
        multipartUploadId,
      };
    },

    async createSignedUploadPartGrant(input: {
      objectKey: string;
      multipartUploadId: string;
      partNumber: number;
      expiresInSeconds?: number;
    }): Promise<MultipartUploadPartGrant> {
      const objectKey = validateExistingObjectKey(input.objectKey);
      const multipartUploadId = requireMultipartUploadId(
        input.multipartUploadId,
      );
      const partNumber = requirePartNumber(input.partNumber);
      const expiresInSeconds = resolveTtlSeconds(
        input.expiresInSeconds,
        config.signedUrlTtlSeconds,
      );
      const url = await presignUrl(
        s3Client as S3Client,
        new UploadPartCommand({
          Bucket: config.bucket,
          Key: objectKey,
          UploadId: multipartUploadId,
          PartNumber: partNumber,
        }),
        {
          expiresIn: expiresInSeconds,
        },
      );
      return {
        method: 'PUT',
        partNumber,
        url,
        expiresAt: new Date(
          now().getTime() + expiresInSeconds * 1000,
        ).toISOString(),
        requiredHeaders: {},
      };
    },

    async abortIncompleteMultipartUpload(input: {
      objectKey: string;
      multipartUploadId: string;
    }): Promise<void> {
      const objectKey = validateExistingObjectKey(input.objectKey);
      const multipartUploadId = requireMultipartUploadId(
        input.multipartUploadId,
      );
      await s3Client.send(
        new AbortMultipartUploadCommand({
          Bucket: config.bucket,
          Key: objectKey,
          UploadId: multipartUploadId,
        }),
      );
    },

    async completeMultipartUpload(input: {
      objectKey: string;
      multipartUploadId: string;
      parts: Array<{ partNumber: number; etag: string }>;
    }): Promise<CompleteMultipartUploadResult> {
      const objectKey = validateExistingObjectKey(input.objectKey);
      const multipartUploadId = requireMultipartUploadId(
        input.multipartUploadId,
      );
      const parts = normalizeCompletedMultipartParts(input.parts);
      const response = await s3Client.send(
        new CompleteMultipartUploadCommand({
          Bucket: config.bucket,
          Key: objectKey,
          UploadId: multipartUploadId,
          MultipartUpload: {
            Parts: parts.map((part) => ({
              PartNumber: part.partNumber,
              ETag: part.etag,
            })),
          },
        }),
      );
      return {
        objectKey,
        etag: normalizeReturnedEtag(response.ETag),
        versionId: normalizeVersionId(response.VersionId),
      };
    },

    async headObject(input: { objectKey: string }): Promise<StoredObjectInfo> {
      const objectKey = validateExistingObjectKey(input.objectKey);
      const response = await s3Client.send(
        new HeadObjectCommand({
          Bucket: config.bucket,
          Key: objectKey,
        }),
      );
      return mapStoredObjectInfo(objectKey, response);
    },

    async openReadStream(input: {
      objectKey: string;
    }): Promise<{ object: StoredObjectInfo; body: Readable }> {
      const objectKey = validateExistingObjectKey(input.objectKey);
      const response = await s3Client.send(
        new GetObjectCommand({
          Bucket: config.bucket,
          Key: objectKey,
        }),
      );
      const body = toNodeReadable(response.Body);
      return {
        object: mapStoredObjectInfo(objectKey, response),
        body,
      };
    },
  };
}

function buildObjectKey(
  root: 'skill-sessions' | 'skill-versions',
  rawId: string,
  rawCategory: string,
  rawExtension: string,
  createRandomId: () => string,
): string {
  const positiveId = validatePositiveId(
    rawId,
    root === 'skill-sessions' ? 'sessionId' : 'versionId',
  );
  const category = validateCategory(root, rawCategory);
  const extension = validateExtension(rawExtension);
  const randomId = createRandomId().toLowerCase();
  if (!UUID_V4_PATTERN.test(randomId)) {
    throw new Error('createRandomId must return a UUID v4 identifier');
  }
  const objectKey = `${root}/${positiveId}/${category}/${randomId}.${extension}`;
  return validateExistingObjectKey(objectKey);
}

function validatePositiveId(value: string, fieldName: string): string {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${fieldName} must be a positive integer string`);
  }
  return value;
}

function validateCategory(
  root: 'skill-sessions' | 'skill-versions',
  category: string,
): string {
  const trimmed = category.trim();
  const allowed =
    root === 'skill-sessions' ? SESSION_CATEGORIES : VERSION_CATEGORIES;
  if (!allowed.has(trimmed as never)) {
    throw new Error(`category is not allowed for ${root}`);
  }
  return trimmed;
}

function validateExtension(extension: string): string {
  const normalized = extension.trim().toLowerCase();
  if (!SAFE_EXTENSION_PATTERN.test(normalized)) {
    throw new Error('extension must be a safe file extension');
  }
  return normalized;
}

function validateExistingObjectKey(objectKey: string): string {
  if (
    objectKey.trim() !== objectKey ||
    objectKey.startsWith('/') ||
    objectKey.includes('\\') ||
    objectKey.includes('..') ||
    objectKey.includes('//') ||
    containsControlCharacters(objectKey) ||
    !ALLOWED_OBJECT_KEY_PATTERNS.some((pattern) => pattern.test(objectKey))
  ) {
    throw new Error(
      'objectKey must stay inside an allowed immutable storage prefix',
    );
  }
  return objectKey;
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

function requireContentType(contentType: string): string {
  const normalized = contentType.trim().toLowerCase();
  if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(normalized)) {
    throw new Error('contentType must be a valid MIME type');
  }
  return normalized;
}

function requireObjectSize(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('sizeBytes must be a positive safe integer');
  }
  return value;
}

function resolveTtlSeconds(
  rawValue: number | undefined,
  defaultValue: number,
): number {
  const ttlSeconds = rawValue ?? defaultValue;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > 900) {
    throw new Error('expiresInSeconds must be an integer between 30 and 900');
  }
  return ttlSeconds;
}

function requireMultipartUploadId(value: unknown): string {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0) {
    throw new Error('multipartUploadId must be a non-empty string');
  }
  return value;
}

function requirePartNumber(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 10_000
  ) {
    throw new Error('partNumber must be an integer between 1 and 10000');
  }
  return value;
}

function normalizeCompletedMultipartParts(
  value: unknown,
): Array<{ partNumber: number; etag: string }> {
  if (!Array.isArray(value) || value.length === 0 || value.length > 10_000) {
    throw new Error('parts must be a non-empty array with at most 10000 items');
  }

  const parts = value.map((item, index) => {
    if (!(index in value)) {
      throw new Error('parts must be a dense array');
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('parts items must be objects');
    }
    const record = item as Record<string, unknown>;
    const keys = Object.keys(record);
    if (
      keys.length !== 2 ||
      !keys.includes('partNumber') ||
      !keys.includes('etag')
    ) {
      throw new Error('parts items must only contain partNumber and etag');
    }
    return {
      partNumber: requirePartNumber(record.partNumber),
      etag: normalizeCompletedMultipartEtag(record.etag),
    };
  });

  for (let index = 0; index < parts.length; index += 1) {
    const expectedPartNumber = index + 1;
    if (parts[index]?.partNumber !== expectedPartNumber) {
      throw new Error('parts must start at 1 and increase continuously');
    }
  }

  return parts;
}

function normalizeCompletedMultipartEtag(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('etag must be a string');
  }

  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > 1024 ||
    containsControlCharacters(trimmed)
  ) {
    throw new Error('etag must be a non-empty printable string');
  }

  const startsQuoted = trimmed.startsWith('"');
  const endsQuoted = trimmed.endsWith('"');
  if (startsQuoted !== endsQuoted) {
    throw new Error('etag must use balanced double quotes');
  }

  if (startsQuoted && endsQuoted) {
    const inner = trimmed.slice(1, -1);
    if (inner.length === 0 || inner.includes('"')) {
      throw new Error('etag quoted form is invalid');
    }
    return trimmed;
  }

  if (trimmed.includes('"')) {
    throw new Error('etag unquoted form cannot contain double quotes');
  }

  return `"${trimmed}"`;
}

function normalizeReturnedEtag(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  return normalizeCompletedMultipartEtag(value);
}

function normalizeVersionId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && !containsControlCharacters(trimmed)
    ? trimmed
    : null;
}

function mapStoredObjectInfo(
  objectKey: string,
  response: {
    ContentLength?: number;
    ContentType?: string;
    Metadata?: Record<string, string> | undefined;
  },
): StoredObjectInfo {
  if (
    !Number.isFinite(response.ContentLength) ||
    (response.ContentLength ?? -1) < 0
  ) {
    throw new Error('Object storage response did not include a valid size');
  }
  const contentType = requireContentType(response.ContentType ?? '');
  const metadataMimeType = normalizeMetadataMimeType(
    response.Metadata?.['mime-type'],
  );
  const metadataSha256 = normalizeMetadataSha256(response.Metadata?.sha256);

  return {
    objectKey,
    sizeBytes: Number(response.ContentLength),
    contentType,
    metadataMimeType,
    metadataSha256,
  };
}

function normalizeMetadataMimeType(value: string | undefined): string | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  try {
    return requireContentType(value);
  } catch {
    return null;
  }
}

function normalizeMetadataSha256(value: string | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function toNodeReadable(body: unknown): Readable {
  if (body instanceof Readable) {
    return body;
  }
  if (body && typeof body === 'object' && Symbol.asyncIterator in body) {
    return Readable.from(body as AsyncIterable<Uint8Array>);
  }
  throw new Error('Object storage response body was not a readable stream');
}
