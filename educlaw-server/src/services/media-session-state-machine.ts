import type {
  GuidedCreationStatus,
  MediaConfirmationStage,
  MediaStage,
} from '@educlaw/shared';

export type { MediaConfirmationStage, MediaStage } from '@educlaw/shared';

const allowedMediaStageTransitions: Record<MediaStage, readonly MediaStage[]> = {
  draft: ['uploading', 'cancelled'],
  uploading: ['ready_to_process', 'failed', 'cancelled'],
  ready_to_process: ['preparing_media', 'cancelled'],
  preparing_media: ['transcribing', 'building_semantic_windows', 'failed', 'cancelled'],
  transcribing: [
    'reviewing_transcript',
    'building_semantic_windows',
    'failed',
    'cancelled',
  ],
  reviewing_transcript: ['building_semantic_windows', 'failed', 'cancelled'],
  building_semantic_windows: ['building_evidence', 'failed', 'cancelled'],
  building_evidence: ['building_adler', 'failed', 'cancelled'],
  building_adler: ['awaiting_adler_overview', 'failed', 'cancelled'],
  awaiting_adler_overview: ['extracting_candidates', 'cancelled'],
  extracting_candidates: ['validating_candidates', 'failed', 'cancelled'],
  validating_candidates: ['awaiting_candidates', 'failed', 'cancelled'],
  awaiting_candidates: ['building_skills', 'cancelled'],
  building_skills: ['arena_testing', 'failed', 'cancelled'],
  arena_testing: ['ready_to_publish', 'publishing', 'failed', 'cancelled'],
  ready_to_publish: ['publishing', 'cancelled'],
  publishing: ['published', 'failed', 'cancelled'],
  published: [],
  failed: [
    'preparing_media',
    'transcribing',
    'reviewing_transcript',
    'building_semantic_windows',
    'building_evidence',
    'building_adler',
    'extracting_candidates',
    'validating_candidates',
    'building_skills',
    'arena_testing',
    'cancelled',
  ],
  cancelled: [],
};

const stageGateRequirements: Record<
  MediaStage,
  readonly MediaConfirmationStage[]
> = {
  draft: [],
  uploading: [],
  ready_to_process: [],
  preparing_media: [],
  transcribing: [],
  reviewing_transcript: [],
  building_semantic_windows: [],
  building_evidence: [],
  building_adler: [],
  awaiting_adler_overview: [],
  extracting_candidates: ['adler_overview'],
  validating_candidates: ['adler_overview'],
  awaiting_candidates: ['adler_overview'],
  building_skills: ['adler_overview', 'evidence_and_candidates'],
  arena_testing: ['adler_overview', 'evidence_and_candidates'],
  ready_to_publish: ['adler_overview', 'evidence_and_candidates'],
  publishing: ['adler_overview', 'evidence_and_candidates', 'publish'],
  published: ['adler_overview', 'evidence_and_candidates', 'publish'],
  failed: [],
  cancelled: [],
};

const resumableStages: readonly MediaStage[] = [
  'preparing_media',
  'transcribing',
  'reviewing_transcript',
  'building_semantic_windows',
  'building_evidence',
  'building_adler',
  'extracting_candidates',
  'validating_candidates',
  'building_skills',
  'arena_testing',
];

const cancellableStages = new Set<MediaStage>([
  'draft',
  'uploading',
  'ready_to_process',
  'preparing_media',
  'transcribing',
  'reviewing_transcript',
  'building_semantic_windows',
  'building_evidence',
  'building_adler',
  'awaiting_adler_overview',
  'extracting_candidates',
  'validating_candidates',
  'awaiting_candidates',
  'building_skills',
  'arena_testing',
  'ready_to_publish',
  'publishing',
  'failed',
]);

const editableResetStages = {
  transcript: new Set<MediaStage>([
    'reviewing_transcript',
    'building_semantic_windows',
    'building_evidence',
    'building_adler',
    'awaiting_adler_overview',
  ]),
  evidence: new Set<MediaStage>(['awaiting_adler_overview']),
  candidate: new Set<MediaStage>(['awaiting_candidates']),
} as const;

export function assertMediaStageTransition(
  from: MediaStage,
  to: MediaStage,
): void {
  if (!allowedMediaStageTransitions[from].includes(to)) {
    throw new Error('INVALID_MEDIA_STAGE_TRANSITION');
  }
}

export function assertMediaStageGate(input: {
  targetStage: MediaStage;
  confirmedStages: readonly MediaConfirmationStage[];
}): void {
  const confirmed = new Set(input.confirmedStages);
  for (const required of stageGateRequirements[input.targetStage]) {
    if (!confirmed.has(required)) {
      throw new Error('INVALID_MEDIA_STAGE_GATE');
    }
  }
}

export function getGuidedCreationStatusForMediaStage(
  stage: MediaStage,
): GuidedCreationStatus {
  if (
    stage === 'awaiting_adler_overview' ||
    stage === 'awaiting_candidates' ||
    stage === 'arena_testing' ||
    stage === 'ready_to_publish'
  ) {
    return 'ready_for_confirmation';
  }
  if (stage === 'publishing') {
    return 'finalizing';
  }
  if (stage === 'published') {
    return 'completed';
  }
  if (stage === 'failed') {
    return 'failed';
  }
  if (stage === 'cancelled') {
    return 'cancelled';
  }
  return 'collecting';
}

export function assertResumeFromFailed(stage: MediaStage): void {
  if (!resumableStages.includes(stage)) {
    throw new Error('INVALID_MEDIA_STAGE_RESUME');
  }
}

export function canCancelMediaStage(stage: MediaStage): boolean {
  return cancellableStages.has(stage);
}

export function assertMediaEditReset(input: {
  kind: keyof typeof editableResetStages;
  fromStage: MediaStage;
  targetStage: MediaStage;
}): void {
  const expectedTarget: Record<keyof typeof editableResetStages, MediaStage> = {
    transcript: 'building_semantic_windows',
    evidence: 'building_adler',
    candidate: 'validating_candidates',
  };
  if (
    expectedTarget[input.kind] !== input.targetStage ||
    !editableResetStages[input.kind].has(input.fromStage)
  ) {
    throw new Error('INVALID_MEDIA_EDIT_RESET');
  }
}
