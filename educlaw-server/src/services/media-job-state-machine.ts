export type MediaJobStatus =
  | 'queued'
  | 'leased'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

const allowedMediaJobTransitions: Record<MediaJobStatus, readonly MediaJobStatus[]> = {
  queued: ['leased', 'cancelled'],
  leased: ['queued', 'succeeded', 'failed', 'cancelled'],
  succeeded: [],
  failed: [],
  cancelled: [],
};

export function assertMediaJobTransition(
  from: MediaJobStatus,
  to: MediaJobStatus,
): void {
  if (!allowedMediaJobTransitions[from].includes(to)) {
    throw new Error('INVALID_MEDIA_JOB_TRANSITION');
  }
}

export function shouldRecycleExpiredLease(input: {
  status: MediaJobStatus;
  leaseExpiresAt: Date | null;
  now: Date;
}): boolean {
  return (
    input.status === 'leased' &&
    input.leaseExpiresAt instanceof Date &&
    input.leaseExpiresAt.getTime() <= input.now.getTime()
  );
}
