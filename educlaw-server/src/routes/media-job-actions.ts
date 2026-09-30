import { MEDIA_JOB_TYPES, type MediaJobType } from '@educlaw/shared';

import type { InternalMediaJobAction } from '../middleware/internal-worker-auth.js';
import { createMultimodalJobService } from '../services/multimodal-job-service.js';

interface MediaJobActionErrorDetails {
  [key: string]: unknown;
}

class MediaJobActionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: MediaJobActionErrorDetails,
  ) {
    super(message);
  }
}

interface MediaJobActionService {
  claimMediaJob(input: {
    workerIdentity: string;
    acceptedJobTypes: readonly MediaJobType[];
  }): Promise<unknown>;
  refreshMediaJobRuntimeGrants(input: {
    jobId: string;
    leaseToken: string;
  }): Promise<unknown>;
  heartbeatMediaJob(input: {
    jobId: string;
    leaseToken: string;
    progress: Record<string, unknown>;
  }): Promise<unknown>;
  completeMediaJob(input: {
    jobId: string;
    leaseToken: string;
    resultHash: string;
    outputManifest: Record<string, unknown>;
  }): Promise<unknown>;
  failMediaJob(input: {
    jobId: string;
    leaseToken: string;
    error: {
      code: string;
      message: string;
      retryable: boolean;
      details?: Record<string, unknown>;
    };
  }): Promise<unknown>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
) {
  const allowedSet = new Set(allowed);
  const unknownKeys = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (unknownKeys.length > 0) {
    throw new MediaJobActionError(
      'INVALID_ARGUMENT',
      `${label} contains unknown fields: ${unknownKeys.join(', ')}`,
      422,
    );
  }
}

function parseBody(body: unknown): {
  action: InternalMediaJobAction;
  payload: Record<string, unknown>;
} {
  if (!isPlainObject(body)) {
    throw new MediaJobActionError(
      'INVALID_ARGUMENT',
      'Request body must be an object',
      422,
    );
  }
  rejectUnknownKeys(body, ['action', 'payload'], 'body');
  const { action, payload = {} } = body;
  if (
    action !== 'internal.mediaJob.claim' &&
    action !== 'internal.mediaJob.refreshGrants' &&
    action !== 'internal.mediaJob.heartbeat' &&
    action !== 'internal.mediaJob.complete' &&
    action !== 'internal.mediaJob.fail'
  ) {
    throw new MediaJobActionError('UNKNOWN_ACTION', 'Unknown action', 400);
  }
  if (!isPlainObject(payload)) {
    throw new MediaJobActionError(
      'INVALID_ARGUMENT',
      'payload must be an object',
      422,
    );
  }
  return { action, payload };
}

function requiredNonBlankString(
  value: unknown,
  fieldName: string,
  maxLength = 400,
): string {
  if (typeof value !== 'string') {
    throw new MediaJobActionError(
      'INVALID_ARGUMENT',
      `${fieldName} must be a string`,
      422,
    );
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) {
    throw new MediaJobActionError(
      'INVALID_ARGUMENT',
      `${fieldName} must be a non-empty string up to ${maxLength} characters`,
      422,
    );
  }
  return trimmed;
}

function requiredPositiveId(value: unknown, fieldName: string): string {
  const text = requiredNonBlankString(value, fieldName, 100);
  if (!/^[1-9]\d*$/.test(text)) {
    throw new MediaJobActionError(
      'INVALID_ARGUMENT',
      `${fieldName} must be a positive integer string`,
      422,
    );
  }
  return text;
}

function requiredHash(value: unknown, fieldName: string): string {
  const text = requiredNonBlankString(value, fieldName, 128);
  if (!/^[a-f0-9]{64}$/.test(text)) {
    throw new MediaJobActionError(
      'INVALID_ARGUMENT',
      `${fieldName} must be a 64-character lowercase hex string`,
      422,
    );
  }
  return text;
}

function requiredPlainObject(
  value: unknown,
  fieldName: string,
): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new MediaJobActionError(
      'INVALID_ARGUMENT',
      `${fieldName} must be an object`,
      422,
    );
  }
  return value;
}

function parseAcceptedJobTypes(value: unknown): readonly MediaJobType[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new MediaJobActionError(
      'INVALID_ARGUMENT',
      'acceptedJobTypes must be a non-empty array',
      422,
    );
  }

  const parsed = value.map((item) =>
    requiredNonBlankString(item, 'acceptedJobTypes[]', 80),
  );
  for (const item of parsed) {
    if (!(MEDIA_JOB_TYPES as readonly string[]).includes(item)) {
      throw new MediaJobActionError(
        'INVALID_ARGUMENT',
        'acceptedJobTypes contains an unsupported job type',
        422,
      );
    }
  }

  return parsed as readonly MediaJobType[];
}

function parseFailureError(value: unknown): {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
} {
  const record = requiredPlainObject(value, 'error');
  rejectUnknownKeys(
    record,
    ['code', 'message', 'retryable', 'details'],
    'error',
  );
  const details =
    record.details === undefined
      ? undefined
      : requiredPlainObject(record.details, 'error.details');
  if (typeof record.retryable !== 'boolean') {
    throw new MediaJobActionError(
      'INVALID_ARGUMENT',
      'error.retryable must be boolean',
      422,
    );
  }
  return {
    code: requiredNonBlankString(record.code, 'error.code', 120),
    message: requiredNonBlankString(record.message, 'error.message', 500),
    retryable: record.retryable,
    details,
  };
}

export async function handleInternalMediaJobAction(
  body: unknown,
  service: MediaJobActionService = createMultimodalJobService(),
) {
  const parsed = parseBody(body);

  switch (parsed.action) {
    case 'internal.mediaJob.claim':
      rejectUnknownKeys(
        parsed.payload,
        ['workerIdentity', 'acceptedJobTypes'],
        'payload',
      );
      return service.claimMediaJob({
        workerIdentity: requiredNonBlankString(
          parsed.payload.workerIdentity,
          'workerIdentity',
          200,
        ),
        acceptedJobTypes: parseAcceptedJobTypes(
          parsed.payload.acceptedJobTypes,
        ),
      });
    case 'internal.mediaJob.refreshGrants':
      rejectUnknownKeys(parsed.payload, ['jobId', 'leaseToken'], 'payload');
      return service.refreshMediaJobRuntimeGrants({
        jobId: requiredPositiveId(parsed.payload.jobId, 'jobId'),
        leaseToken: requiredNonBlankString(
          parsed.payload.leaseToken,
          'leaseToken',
          400,
        ),
      });
    case 'internal.mediaJob.heartbeat':
      rejectUnknownKeys(
        parsed.payload,
        ['jobId', 'leaseToken', 'progress'],
        'payload',
      );
      return service.heartbeatMediaJob({
        jobId: requiredPositiveId(parsed.payload.jobId, 'jobId'),
        leaseToken: requiredNonBlankString(
          parsed.payload.leaseToken,
          'leaseToken',
          400,
        ),
        progress: requiredPlainObject(parsed.payload.progress, 'progress'),
      });
    case 'internal.mediaJob.complete':
      rejectUnknownKeys(
        parsed.payload,
        ['jobId', 'leaseToken', 'resultHash', 'outputManifest'],
        'payload',
      );
      return service.completeMediaJob({
        jobId: requiredPositiveId(parsed.payload.jobId, 'jobId'),
        leaseToken: requiredNonBlankString(
          parsed.payload.leaseToken,
          'leaseToken',
          400,
        ),
        resultHash: requiredHash(parsed.payload.resultHash, 'resultHash'),
        outputManifest: requiredPlainObject(
          parsed.payload.outputManifest,
          'outputManifest',
        ),
      });
    case 'internal.mediaJob.fail':
      rejectUnknownKeys(
        parsed.payload,
        ['jobId', 'leaseToken', 'error'],
        'payload',
      );
      return service.failMediaJob({
        jobId: requiredPositiveId(parsed.payload.jobId, 'jobId'),
        leaseToken: requiredNonBlankString(
          parsed.payload.leaseToken,
          'leaseToken',
          400,
        ),
        error: parseFailureError(parsed.payload.error),
      });
  }
}

export { MediaJobActionError };
