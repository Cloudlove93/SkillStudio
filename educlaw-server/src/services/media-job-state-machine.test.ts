import { describe, expect, it } from 'vitest';
import {
  assertMediaJobTransition,
  shouldRecycleExpiredLease,
} from './media-job-state-machine.js';

describe('media job state machine', () => {
  it('allows queued to leased', () => {
    expect(() => assertMediaJobTransition('queued', 'leased')).not.toThrow();
  });

  it('rejects terminal jobs returning to queued', () => {
    expect(() => assertMediaJobTransition('succeeded', 'queued')).toThrowError(
      'INVALID_MEDIA_JOB_TRANSITION',
    );
    expect(() => assertMediaJobTransition('failed', 'queued')).toThrowError(
      'INVALID_MEDIA_JOB_TRANSITION',
    );
    expect(() => assertMediaJobTransition('cancelled', 'queued')).toThrowError(
      'INVALID_MEDIA_JOB_TRANSITION',
    );
  });

  it('recycles leased jobs that are expired or exactly at lease expiry', () => {
    expect(
      shouldRecycleExpiredLease({
        status: 'leased',
        leaseExpiresAt: new Date('2026-08-21T10:00:00.000Z'),
        now: new Date('2026-08-21T10:00:01.000Z'),
      }),
    ).toBe(true);

    expect(
      shouldRecycleExpiredLease({
        status: 'queued',
        leaseExpiresAt: new Date('2026-08-21T10:00:00.000Z'),
        now: new Date('2026-08-21T10:00:01.000Z'),
      }),
    ).toBe(false);

    expect(
      shouldRecycleExpiredLease({
        status: 'leased',
        leaseExpiresAt: new Date('2026-08-21T10:00:01.000Z'),
        now: new Date('2026-08-21T10:00:01.000Z'),
      }),
    ).toBe(true);

    expect(
      shouldRecycleExpiredLease({
        status: 'leased',
        leaseExpiresAt: new Date('2026-08-21T10:00:02.000Z'),
        now: new Date('2026-08-21T10:00:01.000Z'),
      }),
    ).toBe(false);
  });
});
