import { describe, expect, it } from 'vitest';
import { buildInternalErrorPayload, one } from './http.js';

describe('one', () => {
  it('returns the original string value', () => {
    expect(one('package-1')).toBe('package-1');
  });

  it('returns the first item for array values', () => {
    expect(one(['first', 'second'])).toBe('first');
  });

  it('returns an empty string for empty arrays', () => {
    expect(one([])).toBe('');
  });

  it('returns an empty string for undefined', () => {
    expect(one(undefined)).toBe('');
  });

  it('preserves an empty string input', () => {
    expect(one('')).toBe('');
  });
});

describe('HTTP error responses', () => {
  it('builds a stable internal error payload without exposing private details', () => {
    expect(buildInternalErrorPayload('request-500')).toEqual({
      code: 'INTERNAL_REQUEST_FAILED',
      message: '服务端处理失败，请稍后重试',
      retryable: true,
      requestId: 'request-500',
    });
    expect(JSON.stringify(buildInternalErrorPayload('request-500'))).not.toContain(
      'duplicate key',
    );
  });
});
