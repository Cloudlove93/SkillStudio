import type {
  CandidatePassMeta,
  MultimodalCandidatePasses,
  MultimodalCandidateSuggestion,
  MultimodalSessionState,
  RiaSkillDraft,
  ValidatedCandidateResult,
} from '@educlaw/shared';
import { GuidedCreationError } from './guided-creation-service.js';
import { getLogger } from '../lib/request-context.js';
import {
  createMultimodalPipelineStore,
  type MultimodalPipelineSnapshot,
  type MultimodalPipelineStore,
  type PersistedPipelineError,
} from './multimodal-pipeline-store.js';

type CandidatePipelineService = {
  extractCandidatePasses(input: {
    primarySource: NonNullable<MultimodalSessionState['primarySource']>;
    transcript: MultimodalSessionState['transcript'];
    evidenceTimeline: MultimodalSessionState['evidenceTimeline']['evidenceItems'];
    confirmedStages: MultimodalPipelineSnapshot['confirmedStages'];
    adlerOverview: NonNullable<
      MultimodalSessionState['adlerOverview']
    >['overview'];
    adlerOverviewReview: NonNullable<
      MultimodalSessionState['adlerOverviewReview']
    >;
  }): Promise<{
    candidatePasses: MultimodalCandidatePasses;
    passMeta: NonNullable<MultimodalSessionState['candidatePassMeta']>;
  }>;
  validateCandidatePasses(input: {
    primarySource: NonNullable<MultimodalSessionState['primarySource']>;
    transcript: MultimodalSessionState['transcript'];
    confirmedStages: MultimodalPipelineSnapshot['confirmedStages'];
    evidenceTimeline: MultimodalSessionState['evidenceTimeline']['evidenceItems'];
    candidatePasses: MultimodalCandidatePasses;
  }): Promise<{ results: ValidatedCandidateResult[] }>;
  fuseCandidatePasses(input: {
    evidenceTimeline: MultimodalSessionState['evidenceTimeline']['evidenceItems'];
    retainedCandidates: MultimodalCandidateSuggestion[];
  }): Promise<{
    candidates: MultimodalCandidateSuggestion[];
    validations: ValidatedCandidateResult[];
    meta: CandidatePassMeta['fused'] | null;
  }>;
  buildRiaSkills(input: {
    primarySource: NonNullable<MultimodalSessionState['primarySource']>;
    transcript: MultimodalSessionState['transcript'];
    confirmedStages: MultimodalPipelineSnapshot['confirmedStages'];
    evidenceTimeline: MultimodalSessionState['evidenceTimeline']['evidenceItems'];
    validatedCandidates: ValidatedCandidateResult[];
    selectedCandidateIds: readonly string[];
  }): Promise<{ skills: RiaSkillDraft[] }>;
};

interface Dependencies {
  store?: MultimodalPipelineStore;
  sessionService: CandidatePipelineService;
  logger?: Pick<ReturnType<typeof getLogger>, 'error'>;
}

export class MultimodalPipelineOrchestratorError extends GuidedCreationError {}

export type {
  MultimodalPipelineSnapshot,
  MultimodalPipelineStore,
  PersistedPipelineError,
};

function fail(
  code: string,
  message: string,
  statusCode: number,
  retryable = false,
): never {
  throw new MultimodalPipelineOrchestratorError(
    code,
    message,
    statusCode,
    retryable,
  );
}

function isGuidedCreationError(error: unknown): error is GuidedCreationError {
  return error instanceof GuidedCreationError;
}

function isStalePipelineWork(error: unknown): error is GuidedCreationError {
  return (
    isGuidedCreationError(error) &&
    (error.code === 'SESSION_REVISION_CONFLICT' ||
      error.code === 'INVALID_MEDIA_STAGE')
  );
}

function flattenAtomicCandidateIds(state: MultimodalSessionState): string[] {
  return [
    ...state.candidatePasses.frameworks,
    ...state.candidatePasses.principles,
    ...state.candidatePasses.cases,
    ...state.candidatePasses.counterexamples,
    ...state.candidatePasses.terms,
  ].map((candidate) => candidate.candidateId);
}

function flattenAllCandidateIds(state: MultimodalSessionState): string[] {
  return [
    ...flattenAtomicCandidateIds(state),
    ...state.candidatePasses.fused.map((candidate) => candidate.candidateId),
  ];
}

function assertCandidateValidationCoverage(
  state: MultimodalSessionState,
): void {
  const candidateIds = flattenAllCandidateIds(state);
  const validationIds = state.candidateValidations.map(
    (validation) => validation.candidate.candidateId,
  );
  if (
    candidateIds.length !== validationIds.length ||
    candidateIds.some((candidateId) => !validationIds.includes(candidateId))
  ) {
    fail('MULTIMODAL_PIPELINE_FAILED', '候选校验覆盖不完整', 500);
  }
}

function assertExtractionPrerequisites(snapshot: MultimodalPipelineSnapshot): {
  primarySource: NonNullable<MultimodalSessionState['primarySource']>;
  adlerOverview: NonNullable<MultimodalSessionState['adlerOverview']>;
  adlerOverviewReview: NonNullable<
    MultimodalSessionState['adlerOverviewReview']
  >;
} {
  const primarySource = snapshot.mediaState.primarySource;
  const adlerOverview = snapshot.mediaState.adlerOverview;
  const adlerOverviewReview = snapshot.mediaState.adlerOverviewReview;
  if (
    primarySource == null ||
    adlerOverview == null ||
    adlerOverviewReview == null ||
    !snapshot.confirmedStages.includes('adler_overview')
  ) {
    fail('MULTIMODAL_PIPELINE_FAILED', '候选提取前置状态损坏', 500);
  }
  return {
    primarySource,
    adlerOverview,
    adlerOverviewReview,
  };
}

function assertValidationPrerequisites(
  snapshot: MultimodalPipelineSnapshot,
): NonNullable<MultimodalSessionState['primarySource']> {
  const primarySource = snapshot.mediaState.primarySource;
  if (
    primarySource == null ||
    !snapshot.confirmedStages.includes('adler_overview') ||
    flattenAtomicCandidateIds(snapshot.mediaState).length === 0
  ) {
    fail('MULTIMODAL_PIPELINE_FAILED', '候选校验前置状态损坏', 500);
  }
  return primarySource;
}

function assertSkillBuildPrerequisites(
  snapshot: MultimodalPipelineSnapshot,
): NonNullable<MultimodalSessionState['primarySource']> {
  const primarySource = snapshot.mediaState.primarySource;
  if (
    primarySource == null ||
    snapshot.mediaState.adlerOverviewReview == null ||
    !snapshot.confirmedStages.includes('adler_overview') ||
    !snapshot.confirmedStages.includes('evidence_and_candidates')
  ) {
    fail('MULTIMODAL_PIPELINE_FAILED', '技能构建前置状态损坏', 500);
  }
  assertCandidateValidationCoverage(snapshot.mediaState);
  if (snapshot.mediaState.selectedCandidateIds.length < 1) {
    fail('MULTIMODAL_PIPELINE_FAILED', '缺少已确认候选 Skill', 500);
  }
  if (snapshot.mediaState.candidateSkills.length > 0) {
    fail('MULTIMODAL_PIPELINE_FAILED', 'Skill 工作态已存在，不能重复构建', 500);
  }
  return primarySource;
}

function assertValidatedResultsCoverCandidates(
  state: MultimodalSessionState,
  results: ValidatedCandidateResult[],
): void {
  const candidateIds = flattenAtomicCandidateIds(state);
  if (candidateIds.length === 0) {
    throw new GuidedCreationError(
      'MULTIMODAL_PIPELINE_FAILED',
      '当前没有可校验的候选 Skill',
      502,
      true,
    );
  }
  const resultIds = results.map((result) => result.candidate.candidateId);
  if (
    candidateIds.length !== resultIds.length ||
    candidateIds.some((candidateId) => !resultIds.includes(candidateId))
  ) {
    fail('MULTIMODAL_PIPELINE_FAILED', '候选校验覆盖不完整', 500);
  }
}

function normalizePipelineFailure(
  stage: 'extracting_candidates' | 'validating_candidates' | 'building_skills',
  error: unknown,
): {
  persisted: PersistedPipelineError;
  thrown: MultimodalPipelineOrchestratorError;
} {
  const retryable = isGuidedCreationError(error) ? error.retryable : true;
  const message =
    stage === 'extracting_candidates'
      ? '候选提取未完成'
      : stage === 'validating_candidates'
        ? '候选校验未完成'
        : 'Skill 构建未完成';
  return {
    persisted: {
      code: 'MULTIMODAL_PIPELINE_FAILED',
      stage,
      retryable,
      message,
      resumeStage: stage,
    },
    thrown: new MultimodalPipelineOrchestratorError(
      'MULTIMODAL_PIPELINE_FAILED',
      message,
      502,
      retryable,
    ),
  };
}

function serializeErrorDetail(error: unknown): Record<string, unknown> {
  if (error == null) {
    return { kind: 'nullish' };
  }
  if (typeof (error as Error).message === 'string') {
    const err = error as Error & {
      code?: unknown;
      statusCode?: unknown;
      retryable?: unknown;
    };
    return {
      name: err.name,
      message: err.message,
      ...(typeof err.stack === 'string'
        ? { stack: err.stack.split('\n').slice(0, 12).join('\n') }
        : {}),
      ...(typeof err.code !== 'undefined' ? { code: err.code } : {}),
      ...(typeof err.statusCode !== 'undefined'
        ? { statusCode: err.statusCode }
        : {}),
      ...(typeof err.retryable !== 'undefined'
        ? { retryable: err.retryable }
        : {}),
    };
  }
  try {
    return { value: JSON.stringify(error) };
  } catch {
    return { value: String(error) };
  }
}

function recordPipelineFailureLog(
  logger: Pick<ReturnType<typeof getLogger>, 'error'>,
  sessionId: string,
  stage: 'extracting_candidates' | 'validating_candidates' | 'building_skills',
  error: unknown,
): void {
  try {
    logger.error(
      {
        event: 'multimodal.pipeline.stage_failed',
        sessionId,
        stage,
        error: serializeErrorDetail(error),
      },
      'multimodal.pipeline.stage_failed',
    );
  } catch {
    // Diagnostic logging is best-effort and must never block failure persistence.
  }
}

export function createMultimodalPipelineOrchestrator(deps: Dependencies) {
  const store = deps.store ?? createMultimodalPipelineStore();
  const sessionService = deps.sessionService;
  const logger = deps.logger ?? getLogger();

  async function persistFailureOrThrow(
    authUserId: string,
    snapshot: MultimodalPipelineSnapshot,
    stage:
      | 'extracting_candidates'
      | 'validating_candidates'
      | 'building_skills',
    error: unknown,
  ): Promise<never> {
    const normalized = normalizePipelineFailure(stage, error);
    try {
      await store.persistPipelineFailure({
        authUserId,
        sessionId: snapshot.sessionId,
        expectedRevisionNo: snapshot.revisionNo,
        expectedStage: stage,
        error: normalized.persisted,
      });
    } catch (persistError) {
      if (isGuidedCreationError(persistError)) {
        throw persistError;
      }
      throw normalized.thrown;
    }
    throw normalized.thrown;
  }

  async function runExtraction(
    authUserId: string,
    snapshot: MultimodalPipelineSnapshot,
  ): Promise<MultimodalPipelineSnapshot> {
    const { primarySource, adlerOverview, adlerOverviewReview } =
      assertExtractionPrerequisites(snapshot);
    try {
      const extracted = await sessionService.extractCandidatePasses({
        primarySource,
        transcript: snapshot.mediaState.transcript,
        evidenceTimeline: snapshot.mediaState.evidenceTimeline.evidenceItems,
        confirmedStages: snapshot.confirmedStages,
        adlerOverview: adlerOverview.overview,
        adlerOverviewReview,
      });
      return await store.persistCandidatePasses({
        authUserId,
        sessionId: snapshot.sessionId,
        expectedRevisionNo: snapshot.revisionNo,
        expectedStage: 'extracting_candidates',
        candidatePasses: extracted.candidatePasses,
        candidatePassMeta: extracted.passMeta,
      });
    } catch (error) {
      if (isStalePipelineWork(error)) {
        throw error;
      }
      recordPipelineFailureLog(
        logger,
        snapshot.sessionId,
        'extracting_candidates',
        error,
      );
      return persistFailureOrThrow(
        authUserId,
        snapshot,
        'extracting_candidates',
        error,
      );
    }
  }

  async function runValidation(
    authUserId: string,
    snapshot: MultimodalPipelineSnapshot,
  ): Promise<MultimodalPipelineSnapshot> {
    try {
      const primarySource = assertValidationPrerequisites(snapshot);
      const validated = await sessionService.validateCandidatePasses({
        primarySource,
        transcript: snapshot.mediaState.transcript,
        confirmedStages: snapshot.confirmedStages,
        evidenceTimeline: snapshot.mediaState.evidenceTimeline.evidenceItems,
        candidatePasses: snapshot.mediaState.candidatePasses,
      });
      assertValidatedResultsCoverCandidates(
        snapshot.mediaState,
        validated.results,
      );
      const retainedCandidates = validated.results
        .filter(
          (result) => result.overallPassed && result.disposition === 'retain',
        )
        .map((result) => result.candidate);
      const fused = await sessionService.fuseCandidatePasses({
        evidenceTimeline: snapshot.mediaState.evidenceTimeline.evidenceItems,
        retainedCandidates,
      });
      return await store.persistValidatedCandidates({
        authUserId,
        sessionId: snapshot.sessionId,
        expectedRevisionNo: snapshot.revisionNo,
        expectedStage: 'validating_candidates',
        candidateValidations: validated.results,
        fusedCandidates: fused.candidates,
        fusedMeta: fused.meta ?? undefined,
        fusedValidations: fused.validations,
      });
    } catch (error) {
      if (isStalePipelineWork(error)) {
        throw error;
      }
      recordPipelineFailureLog(
        logger,
        snapshot.sessionId,
        'validating_candidates',
        error,
      );
      return persistFailureOrThrow(
        authUserId,
        snapshot,
        'validating_candidates',
        error,
      );
    }
  }

  async function runSkillBuild(
    authUserId: string,
    snapshot: MultimodalPipelineSnapshot,
  ): Promise<MultimodalPipelineSnapshot> {
    const primarySource = assertSkillBuildPrerequisites(snapshot);
    try {
      const built = await sessionService.buildRiaSkills({
        primarySource,
        transcript: snapshot.mediaState.transcript,
        confirmedStages: snapshot.confirmedStages,
        evidenceTimeline: snapshot.mediaState.evidenceTimeline.evidenceItems,
        validatedCandidates: snapshot.mediaState.candidateValidations,
        selectedCandidateIds: snapshot.mediaState.selectedCandidateIds,
      });
      return await store.persistCandidateSkills({
        authUserId,
        sessionId: snapshot.sessionId,
        expectedRevisionNo: snapshot.revisionNo,
        expectedStage: 'building_skills',
        candidateSkills: built.skills,
      });
    } catch (error) {
      if (isStalePipelineWork(error)) {
        throw error;
      }
      recordPipelineFailureLog(
        logger,
        snapshot.sessionId,
        'building_skills',
        error,
      );
      return persistFailureOrThrow(
        authUserId,
        snapshot,
        'building_skills',
        error,
      );
    }
  }

  return {
    async runCandidatePipeline(input: {
      authUserId: string;
      sessionId: string;
    }): Promise<MultimodalPipelineSnapshot> {
      let snapshot = await store.loadSessionSnapshot(input);
      switch (snapshot.mediaStage) {
        case 'extracting_candidates':
          snapshot = await runExtraction(input.authUserId, snapshot);
          if (snapshot.mediaStage === 'awaiting_candidates') {
            return snapshot;
          }
          if (snapshot.mediaStage !== 'validating_candidates') {
            fail('MULTIMODAL_PIPELINE_FAILED', '候选编排阶段漂移', 500);
          }
          return runValidation(input.authUserId, snapshot);
        case 'validating_candidates':
          return runValidation(input.authUserId, snapshot);
        case 'awaiting_candidates':
          return snapshot;
        default:
          fail('INVALID_MEDIA_STAGE', '当前阶段不允许执行候选编排', 409);
      }
    },

    async runSkillBuildPipeline(input: {
      authUserId: string;
      sessionId: string;
    }): Promise<MultimodalPipelineSnapshot> {
      const snapshot = await store.loadSessionSnapshot(input);
      switch (snapshot.mediaStage) {
        case 'building_skills':
          return runSkillBuild(input.authUserId, snapshot);
        case 'arena_testing':
          return snapshot;
        default:
          fail('INVALID_MEDIA_STAGE', '当前阶段不允许执行 Skill 编排', 409);
      }
    },
  };
}
