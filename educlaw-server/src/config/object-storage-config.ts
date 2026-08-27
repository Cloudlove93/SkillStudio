const OBJECT_STORAGE_KEYS = [
  'OBJECT_STORAGE_ENDPOINT',
  'OBJECT_STORAGE_REGION',
  'OBJECT_STORAGE_BUCKET',
  'OBJECT_STORAGE_ACCESS_KEY_ID',
  'OBJECT_STORAGE_SECRET_ACCESS_KEY',
  'OBJECT_STORAGE_FORCE_PATH_STYLE',
  'OBJECT_STORAGE_SIGNED_URL_TTL_SECONDS',
] as const;
const PLACEHOLDER_PATTERN = /^(replace-with-|your-)/i;
const SAFE_BUCKET_PATTERN = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const SAFE_REGION_PATTERN = /^[a-z0-9-]{1,32}$/i;

export type ObjectStorageConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  signedUrlTtlSeconds: number;
};

export function readObjectStorageConfig(
  env: NodeJS.ProcessEnv = process.env,
): ObjectStorageConfig | null {
  const hasAnyValue = OBJECT_STORAGE_KEYS.some((key) => {
    const value = env[key];
    return typeof value === 'string' && value.trim() !== '';
  });

  if (!hasAnyValue && env.NODE_ENV !== 'production') {
    return null;
  }

  const endpoint = normalizeEndpoint(
    requireText(env, 'OBJECT_STORAGE_ENDPOINT'),
  );
  const region = requireText(env, 'OBJECT_STORAGE_REGION');
  const bucket = requireText(env, 'OBJECT_STORAGE_BUCKET');
  const accessKeyId = requireText(env, 'OBJECT_STORAGE_ACCESS_KEY_ID');
  const secretAccessKey = requireText(env, 'OBJECT_STORAGE_SECRET_ACCESS_KEY');
  const forcePathStyle = parseBoolean(
    requireText(env, 'OBJECT_STORAGE_FORCE_PATH_STYLE'),
    'OBJECT_STORAGE_FORCE_PATH_STYLE',
  );
  const signedUrlTtlSeconds = parseInteger(
    requireText(env, 'OBJECT_STORAGE_SIGNED_URL_TTL_SECONDS'),
    'OBJECT_STORAGE_SIGNED_URL_TTL_SECONDS',
    30,
    900,
  );
  validateBucket(bucket);
  validateRegion(region);
  validateSecretLikeText(accessKeyId, 'OBJECT_STORAGE_ACCESS_KEY_ID');
  validateSecretLikeText(secretAccessKey, 'OBJECT_STORAGE_SECRET_ACCESS_KEY');
  if (env.NODE_ENV === 'production') {
    if (PLACEHOLDER_PATTERN.test(accessKeyId)) {
      throw new Error(
        'OBJECT_STORAGE_ACCESS_KEY_ID must not use a placeholder in production',
      );
    }
    if (PLACEHOLDER_PATTERN.test(secretAccessKey)) {
      throw new Error(
        'OBJECT_STORAGE_SECRET_ACCESS_KEY must not use a placeholder in production',
      );
    }
  }

  return {
    endpoint,
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    forcePathStyle,
    signedUrlTtlSeconds,
  };
}

function requireText(
  env: NodeJS.ProcessEnv,
  key: (typeof OBJECT_STORAGE_KEYS)[number],
): string {
  const value = env[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}

function normalizeEndpoint(rawValue: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawValue);
  } catch {
    throw new Error('OBJECT_STORAGE_ENDPOINT must be a valid http(s) URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('OBJECT_STORAGE_ENDPOINT must use http or https');
  }
  if (!parsed.hostname || parsed.username || parsed.password) {
    throw new Error(
      'OBJECT_STORAGE_ENDPOINT must not include inline credentials',
    );
  }
  if (parsed.search || parsed.hash) {
    throw new Error(
      'OBJECT_STORAGE_ENDPOINT must not include query or fragment',
    );
  }
  if (parsed.pathname && parsed.pathname !== '/' && parsed.pathname !== '') {
    throw new Error('OBJECT_STORAGE_ENDPOINT must not include a non-root path');
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString().replace(/\/$/, '');
}

function validateBucket(value: string) {
  if (!SAFE_BUCKET_PATTERN.test(value) || value.includes('..')) {
    throw new Error('OBJECT_STORAGE_BUCKET must be a safe bucket name');
  }
}

function validateRegion(value: string) {
  if (!SAFE_REGION_PATTERN.test(value) || containsControlCharacters(value)) {
    throw new Error('OBJECT_STORAGE_REGION must be a safe region value');
  }
}

function validateSecretLikeText(value: string, key: string) {
  if (containsControlCharacters(value)) {
    throw new Error(`${key} must not contain control characters`);
  }
  if (value.length < 8) {
    throw new Error(`${key} must be at least 8 characters long`);
  }
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

function parseBoolean(rawValue: string, key: string): boolean {
  if (rawValue === 'true') return true;
  if (rawValue === 'false') return false;
  throw new Error(`${key} must be "true" or "false"`);
}

function parseInteger(
  rawValue: string,
  key: string,
  minimum: number,
  maximum: number,
): number {
  if (!/^\d+$/.test(rawValue)) {
    throw new Error(`${key} must be an integer`);
  }
  const parsed = Number(rawValue);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${key} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}
