import type {
  MultimodalSessionDetail,
  MultimodalSessionProgress,
} from './multimodal-guided-creation-service.js';
import type { MediaConfirmationStage } from '@educlaw/shared';
import { createMultimodalGuidedCreationService } from './multimodal-guided-creation-service.js';

export type MediaProgressStreamEvent =
  | {
      event: 'progress';
      data: {
        progress: MultimodalSessionProgress;
      };
    }
  | {
      event: 'confirmation';
      data: {
        session: MultimodalSessionDetail;
        confirmationStage: MediaConfirmationStage;
      };
    }
  | {
      event: 'done';
      data: {
        session: MultimodalSessionDetail;
      };
    }
  | {
      event: 'stream_end';
      data: {
        reason?: 'not_started';
      };
    };

type ServiceDependencies = {
  guidedService?: Pick<
    ReturnType<typeof createMultimodalGuidedCreationService>,
    'getSessionProgress' | 'getSessionDetail'
  >;
  getSessionProgress?: (
    input: {
      authUserId: string;
      sessionId: string;
    },
  ) => Promise<MultimodalSessionProgress>;
  getSessionDetail?: (
    input: {
      authUserId: string;
      sessionId: string;
    },
  ) => Promise<MultimodalSessionDetail>;
  wait?: (milliseconds: number) => Promise<void>;
  pollIntervalMs?: number;
};

type StreamProgressInput = {
  authUserId: string;
  sessionId: string;
  emit: <TEvent extends MediaProgressStreamEvent['event']>(
    event: TEvent,
    data: Extract<MediaProgressStreamEvent, { event: TEvent }>['data'],
  ) => Promise<void>;
  isClosed: () => boolean;
};

const DEFAULT_POLL_INTERVAL_MS = 1_000;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function getProgressFingerprint(progress: MultimodalSessionProgress): string {
  return JSON.stringify({
    revisionNo: progress.revisionNo,
    mediaStage: progress.mediaStage,
    status: progress.status,
    currentJob: progress.currentJob
      ? {
          jobId: progress.currentJob.jobId,
          status: progress.currentJob.status,
          percent: progress.currentJob.percent,
          hint: progress.currentJob.hint,
        }
      : null,
  });
}

function isTerminalProgress(progress: MultimodalSessionProgress): boolean {
  return (
    progress.status === 'completed' ||
    progress.status === 'failed' ||
    progress.status === 'cancelled' ||
    progress.mediaStage === 'published' ||
    progress.mediaStage === 'failed' ||
    progress.mediaStage === 'cancelled'
  );
}

function getConfirmationStage(
  progress: MultimodalSessionProgress,
): MediaConfirmationStage | null {
  if (progress.mediaStage === 'awaiting_adler_overview') {
    return 'adler_overview';
  }
  if (progress.mediaStage === 'awaiting_candidates') {
    return 'evidence_and_candidates';
  }
  if (progress.mediaStage === 'ready_to_publish') {
    return 'publish';
  }
  return null;
}

export function createMultimodalProgressStreamService(
  deps: ServiceDependencies = {},
) {
  const guidedService =
    deps.guidedService ?? createMultimodalGuidedCreationService();
  const getSessionProgress =
    deps.getSessionProgress ??
    ((input: { authUserId: string; sessionId: string }) =>
      guidedService.getSessionProgress(input));
  const getSessionDetail =
    deps.getSessionDetail ??
    ((input: { authUserId: string; sessionId: string }) =>
      guidedService.getSessionDetail(input));
  const wait = deps.wait ?? sleep;
  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  return {
    async streamProgress(input: StreamProgressInput): Promise<void> {
      let lastFingerprint: string | null = null;

      while (!input.isClosed()) {
        const progress = await getSessionProgress({
          authUserId: input.authUserId,
          sessionId: input.sessionId,
        });

        if (input.isClosed()) {
          return;
        }

        if (progress.mediaStage === 'draft') {
          const fingerprint = getProgressFingerprint(progress);
          if (fingerprint !== lastFingerprint) {
            await input.emit('progress', { progress });
          }
          await input.emit('stream_end', { reason: 'not_started' });
          return;
        }

        if (progress.mediaStage === 'ready_to_process') {
          const fingerprint = getProgressFingerprint(progress);
          if (fingerprint !== lastFingerprint) {
            await input.emit('progress', { progress });
          }
          if (input.isClosed()) {
            return;
          }
          const session = await getSessionDetail({
            authUserId: input.authUserId,
            sessionId: input.sessionId,
          });
          if (input.isClosed()) {
            return;
          }
          await input.emit('done', { session });
          await input.emit('stream_end', {});
          return;
        }

        const confirmationStage = getConfirmationStage(progress);
        if (confirmationStage !== null) {
          const fingerprint = getProgressFingerprint(progress);
          if (fingerprint !== lastFingerprint) {
            await input.emit('progress', { progress });
          }
          if (input.isClosed()) {
            return;
          }
          const session = await getSessionDetail({
            authUserId: input.authUserId,
            sessionId: input.sessionId,
          });
          if (input.isClosed()) {
            return;
          }
          await input.emit('confirmation', {
            session,
            confirmationStage,
          });
          await input.emit('stream_end', {});
          return;
        }

        if (isTerminalProgress(progress)) {
          if (input.isClosed()) {
            return;
          }
          const session = await getSessionDetail({
            authUserId: input.authUserId,
            sessionId: input.sessionId,
          });
          if (input.isClosed()) {
            return;
          }
          await input.emit('done', { session });
          await input.emit('stream_end', {});
          return;
        }

        const fingerprint = getProgressFingerprint(progress);
        if (fingerprint !== lastFingerprint) {
          await input.emit('progress', { progress });
          lastFingerprint = fingerprint;
        }

        await wait(pollIntervalMs);
      }
    },
  };
}
