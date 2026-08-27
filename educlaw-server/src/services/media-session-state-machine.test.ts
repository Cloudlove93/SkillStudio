import { describe, expect, it } from 'vitest';
import {
  MEDIA_CONFIRMATION_STAGES,
  MEDIA_STAGES,
} from '@educlaw/shared';
import {
  assertMediaStageGate,
  assertMediaStageTransition,
  assertResumeFromFailed,
  canCancelMediaStage,
  getGuidedCreationStatusForMediaStage,
} from './media-session-state-machine.js';

describe('media session state machine', () => {
  it('consumes the shared media stage and confirmation-stage contracts', () => {
    expect(MEDIA_STAGES).toContain('ready_to_publish');
    expect(MEDIA_STAGES).toContain('published');
    expect(MEDIA_CONFIRMATION_STAGES).toEqual([
      'adler_overview',
      'evidence_and_candidates',
      'publish',
    ]);
  });

  it('allows the approved main-chain transition into media preparation', () => {
    expect(() =>
      assertMediaStageTransition('ready_to_process', 'preparing_media'),
    ).not.toThrow();
  });

  it('allows the explicit visual-only downgrade path', () => {
    expect(() =>
      assertMediaStageTransition('preparing_media', 'building_semantic_windows'),
    ).not.toThrow();
  });

  it('allows a completed audio transcription to enter semantic-window building', () => {
    expect(() =>
      assertMediaStageTransition('transcribing', 'building_semantic_windows'),
    ).not.toThrow();
  });

  it('blocks candidate extraction until Adler Overview is confirmed', () => {
    expect(() =>
      assertMediaStageGate({
        targetStage: 'extracting_candidates',
        confirmedStages: [],
      }),
    ).toThrowError('INVALID_MEDIA_STAGE_GATE');

    expect(() =>
      assertMediaStageGate({
        targetStage: 'extracting_candidates',
        confirmedStages: ['adler_overview'],
      }),
    ).not.toThrow();
  });

  it('blocks skill building until evidence and candidates are confirmed', () => {
    expect(() =>
      assertMediaStageGate({
        targetStage: 'building_skills',
        confirmedStages: ['adler_overview'],
      }),
    ).toThrowError('INVALID_MEDIA_STAGE_GATE');

    expect(() =>
      assertMediaStageGate({
        targetStage: 'building_skills',
        confirmedStages: ['adler_overview', 'evidence_and_candidates'],
      }),
    ).not.toThrow();
  });

  it('blocks publishing until all three confirmations are present', () => {
    expect(() =>
      assertMediaStageGate({
        targetStage: 'publishing',
        confirmedStages: ['adler_overview', 'evidence_and_candidates'],
      }),
    ).toThrowError('INVALID_MEDIA_STAGE_GATE');

    expect(() =>
      assertMediaStageGate({
        targetStage: 'publishing',
        confirmedStages: [
          'adler_overview',
          'evidence_and_candidates',
          'publish',
        ],
      }),
    ).not.toThrow();
  });

  it('allows a confirmed draft to skip optional Arena and enter publishing', () => {
    expect(() =>
      assertMediaStageTransition('arena_testing', 'publishing'),
    ).not.toThrow();
  });

  it('maps media stages to the existing top-level guided status values', () => {
    expect(getGuidedCreationStatusForMediaStage('building_evidence')).toBe(
      'collecting',
    );
    expect(
      getGuidedCreationStatusForMediaStage('awaiting_adler_overview'),
    ).toBe('ready_for_confirmation');
    expect(getGuidedCreationStatusForMediaStage('arena_testing')).toBe(
      'ready_for_confirmation',
    );
    expect(getGuidedCreationStatusForMediaStage('publishing')).toBe(
      'finalizing',
    );
    expect(getGuidedCreationStatusForMediaStage('published')).toBe('completed');
    expect(getGuidedCreationStatusForMediaStage('failed')).toBe('failed');
    expect(getGuidedCreationStatusForMediaStage('cancelled')).toBe(
      'cancelled',
    );
  });

  it('allows only explicit failed resume targets', () => {
    expect(() =>
      assertResumeFromFailed('building_evidence'),
    ).not.toThrow();
    expect(() => assertResumeFromFailed('awaiting_candidates')).toThrowError(
      'INVALID_MEDIA_STAGE_RESUME',
    );
    expect(() => assertResumeFromFailed('publishing')).toThrowError(
      'INVALID_MEDIA_STAGE_RESUME',
    );
    expect(() => assertResumeFromFailed('published')).toThrowError(
      'INVALID_MEDIA_STAGE_RESUME',
    );
  });

  it('allows cancel before publish completion and rejects cancel after publish', () => {
    expect(canCancelMediaStage('arena_testing')).toBe(true);
    expect(canCancelMediaStage('publishing')).toBe(true);
    expect(canCancelMediaStage('published')).toBe(false);
  });

  it('rejects illegal stage skips even when the target gate would otherwise pass', () => {
    expect(() =>
      assertMediaStageTransition('awaiting_adler_overview', 'publishing'),
    ).toThrowError('INVALID_MEDIA_STAGE_TRANSITION');
  });
});
