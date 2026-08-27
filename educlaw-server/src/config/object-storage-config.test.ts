import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { readObjectStorageConfig } from './object-storage-config.js';

const VALID_ENV = {
  OBJECT_STORAGE_ENDPOINT: 'http://educlaw-minio:9000',
  OBJECT_STORAGE_REGION: 'us-east-1',
  OBJECT_STORAGE_BUCKET: 'educlaw-media',
  OBJECT_STORAGE_ACCESS_KEY_ID: 'replace-with-local-dev-access-key',
  OBJECT_STORAGE_SECRET_ACCESS_KEY: 'replace-with-local-dev-secret-key',
  OBJECT_STORAGE_FORCE_PATH_STYLE: 'true',
  OBJECT_STORAGE_SIGNED_URL_TTL_SECONDS: '300',
} satisfies NodeJS.ProcessEnv;

describe('object storage config', () => {
  it('returns null when object storage is not configured outside production', () => {
    expect(readObjectStorageConfig({ NODE_ENV: 'development' })).toBeNull();
  });

  it('reads a valid object storage configuration', () => {
    expect(readObjectStorageConfig(VALID_ENV)).toEqual({
      endpoint: 'http://educlaw-minio:9000',
      region: 'us-east-1',
      bucket: 'educlaw-media',
      accessKeyId: 'replace-with-local-dev-access-key',
      secretAccessKey: 'replace-with-local-dev-secret-key',
      forcePathStyle: true,
      signedUrlTtlSeconds: 300,
    });
  });

  it('fails closed in production when required values are missing', () => {
    expect(() =>
      readObjectStorageConfig({ NODE_ENV: 'production' }),
    ).toThrowError(/OBJECT_STORAGE_ENDPOINT/);
  });

  it('rejects invalid endpoint, ttl, and path-style values', () => {
    expect(() =>
      readObjectStorageConfig({
        ...VALID_ENV,
        OBJECT_STORAGE_ENDPOINT: 'ftp://educlaw-minio:9000?leak=1',
      }),
    ).toThrowError(/OBJECT_STORAGE_ENDPOINT/);

    expect(() =>
      readObjectStorageConfig({
        ...VALID_ENV,
        OBJECT_STORAGE_SIGNED_URL_TTL_SECONDS: '901',
      }),
    ).toThrowError(/OBJECT_STORAGE_SIGNED_URL_TTL_SECONDS/);

    expect(() =>
      readObjectStorageConfig({
        ...VALID_ENV,
        OBJECT_STORAGE_FORCE_PATH_STYLE: 'sometimes',
      }),
    ).toThrowError(/OBJECT_STORAGE_FORCE_PATH_STYLE/);
  });

  it('rejects production placeholder credentials case-insensitively and too-short credential values', () => {
    expect(() =>
      readObjectStorageConfig({
        ...VALID_ENV,
        NODE_ENV: 'production',
        OBJECT_STORAGE_ACCESS_KEY_ID: 'Replace-With-Local-Dev-Access-Key',
        OBJECT_STORAGE_SECRET_ACCESS_KEY: 'local-dev-secret-value-12345',
      }),
    ).toThrowError(/OBJECT_STORAGE_ACCESS_KEY_ID/);

    expect(() =>
      readObjectStorageConfig({
        ...VALID_ENV,
        OBJECT_STORAGE_SECRET_ACCESS_KEY: 'tiny',
      }),
    ).toThrowError(/OBJECT_STORAGE_SECRET_ACCESS_KEY/);
  });

  it('keeps env examples on placeholders instead of real secrets', () => {
    for (const relativePath of ['.env.example', '.env.docker']) {
      const text = readFileSync(
        new URL(`../../../${relativePath}`, import.meta.url),
        'utf8',
      );
      const lines = text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.startsWith('#'));

      for (const line of lines) {
        const [key, ...rest] = line.split('=');
        const value = rest.join('=');
        if (
          key === 'OBJECT_STORAGE_ACCESS_KEY_ID' ||
          key === 'OBJECT_STORAGE_SECRET_ACCESS_KEY'
        ) {
          expect(value).toMatch(/^(replace-with-|your-)/);
        }
      }
    }
  });
});
