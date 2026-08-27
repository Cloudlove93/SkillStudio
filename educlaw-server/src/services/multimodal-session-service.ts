import { createHash } from 'node:crypto';
import {
  CANDIDATE_PASS_KEYS,
  FAILED_CANDIDATE_DISPOSITIONS,
  VALIDATION_CAPABILITIES,
  parseAdlerOverview,
  parseAdlerOverviewReview,
  parseAdlerOverviewResult,
  parseCandidatePasses,
  parseEvidenceCard,
  parseMediaEvidenceDegradations,
  parseRiaSkillDrafts,
  parseMultimodalPrimarySource,
  parseMultimodalTranscript,
  parseValidatedCandidateResults,
  type AdlerOverview,
  type AdlerOverviewReview,
  type AdlerOverviewResult,
  type CandidatePassKey,
  type CandidatePassMeta,
  type CandidateDisposition,
  type FailedCandidateDisposition,
  type MediaEvidenceDegradation,
  type MultimodalCandidatePasses,
  type MultimodalCandidateSuggestion,
  type MultimodalEvidence,
  type MultimodalPrimarySource,
  type RiaSkillDraft,
  type MultimodalTranscript,
  type ValidatedCandidateResult,
} from '@educlaw/shared';
import { getLogger } from '../lib/request-context.js';
import {
  assertMediaStageGate,
  type MediaConfirmationStage,
} from './media-session-state-machine.js';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_TEXT_LENGTH = 2000;
const MAX_SHORT_TEXT_LENGTH = 512;
const MAX_EVIDENCE_ITEMS = 1024;
const FAILURE_DISPOSITIONS = FAILED_CANDIDATE_DISPOSITIONS;

export const MULTIMODAL_CONFIRMATION_LABELS = {
  adler_overview: 'Adler Overview',
  evidence_and_candidates: '证据与候选 Skill',
  publish: '发布',
} as const;

const RIA_BUILD_BATCH_SIZE = 2;
const RIA_BUILD_MAX_CONCURRENT_BATCHES = 4;
const CANDIDATE_EXTRACTION_MAX_CONCURRENCY = 3;
const CANDIDATE_VALIDATION_MAX_CONCURRENCY = 3;
const MAX_SELECTED_CANDIDATES_PER_PASS = 4;

async function mapInWaves<T, R>(
  items: readonly T[],
  maximumConcurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let index = 0; index < items.length; index += maximumConcurrency) {
    const wave = items.slice(index, index + maximumConcurrency);
    results.push(...(await Promise.all(wave.map(mapper))));
  }
  return results;
}

function deterministicRiaSkillIdentity(candidateId: string): {
  id: string;
  dirName: string;
} {
  const digest = createHash('sha256').update(candidateId, 'utf8').digest('hex');
  const readableBase =
    candidateId
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'candidate';
  const dirSuffix = digest.slice(0, 16);
  const maximumBaseLength = 128 - 'skill-'.length - 1 - dirSuffix.length;
  const boundedBase = readableBase
    .slice(0, maximumBaseLength)
    .replace(/-+$/g, '');
  return {
    id: `skill-${digest}`,
    dirName: `skill-${boundedBase}-${dirSuffix}`,
  };
}

function assignServerOwnedRiaIdentities(skills: unknown[]): unknown[] {
  return skills.map((value) => {
    const skill = readRecord(value);
    const candidateId = readSafeId(skill.candidateId);
    const serverIdentity = deterministicRiaSkillIdentity(candidateId);
    return {
      ...skill,
      id: serverIdentity.id,
      dirName: serverIdentity.dirName,
    };
  });
}

export class MultimodalSessionServiceError extends Error {
  readonly code = 'MULTIMODAL_SESSION_FAILED';
  readonly retryable = false;

  constructor(message = 'Multimodal session orchestration failed') {
    super(message);
    this.name = 'MultimodalSessionServiceError';
  }
}

export type {
  AdlerOverviewResult,
  CandidateDisposition,
  FailedCandidateDisposition,
  RiaSkillDraft,
  ValidatedCandidateResult,
};

export interface MultimodalAdlerAdapter {
  generate(input: {
    primarySource: MultimodalPrimarySource;
    transcript: MultimodalTranscript;
    evidenceTimeline: MultimodalEvidence[];
    sourceFactEligibleEvidenceIds: readonly string[];
    degradations: readonly MediaEvidenceDegradation[];
  }): Promise<unknown>;
}

export interface MultimodalCandidateAdapter {
  extractPass(input: {
    passKey: CandidatePassKey;
    primarySource: MultimodalPrimarySource;
    transcript: MultimodalTranscript;
    evidenceTimeline: MultimodalEvidence[];
    sourceFactEligibleEvidenceIds: readonly string[];
    adlerOverview: AdlerOverview;
    adlerOverviewReview: AdlerOverviewReview;
  }): Promise<unknown>;
}

export interface MultimodalValidationAdapter {
  validate(input: {
    candidate: MultimodalCandidateSuggestion;
    evidenceTimeline: MultimodalEvidence[];
  }): Promise<unknown>;
}

export interface MultimodalRiaSkillDirectoryEntry {
  candidateId: string;
  skillId: string;
  title: string;
  summary: string;
}

export interface MultimodalRiaAdapter {
  buildSkills(input: {
    candidates: MultimodalCandidateSuggestion[];
    evidenceTimeline: MultimodalEvidence[];
    skillDirectory: MultimodalRiaSkillDirectoryEntry[];
  }): Promise<unknown>;
}

export interface MultimodalFusedTopicAdapter {
  generateFusedTopics(input: {
    candidates: MultimodalCandidateSuggestion[];
    evidenceTimeline: MultimodalEvidence[];
  }): Promise<unknown>;
}

function failSession(): never {
  throw new MultimodalSessionServiceError();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRecord(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) {
    failSession();
  }
  return value;
}

function ensureExactKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): void {
  const allowed = new Set(allowedKeys);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    failSession();
  }
}

function readString(value: unknown, maximum = MAX_TEXT_LENGTH): string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > maximum
  ) {
    failSession();
  }
  return value;
}

function readProbability(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    failSession();
  }
  return value;
}

function readBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    failSession();
  }
  return value;
}

function readSafeId(value: unknown): string {
  const parsed = readString(value, 128);
  if (!SAFE_ID.test(parsed)) {
    failSession();
  }
  return parsed;
}

function readDenseArray(value: unknown, maxLength: number): unknown[] {
  if (!Array.isArray(value) || value.length > maxLength) {
    failSession();
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      failSession();
    }
  }
  return value;
}

function readUniqueStringArray(
  value: unknown,
  maxLength: number,
  allowed?: ReadonlySet<string>,
): string[] {
  const items = readDenseArray(value, maxLength);
  const seen = new Set<string>();
  return items.map((item) => {
    const parsed = readSafeId(item);
    if (seen.has(parsed) || (allowed && !allowed.has(parsed))) {
      failSession();
    }
    seen.add(parsed);
    return parsed;
  });
}

function readEnumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] {
  const parsed = readString(value, MAX_SHORT_TEXT_LENGTH);
  if (!allowed.includes(parsed)) {
    failSession();
  }
  return parsed as T[number];
}

function normalizeTextKey(value: string): string {
  return value.trim().toLowerCase();
}

function deriveSourceFactEligibleEvidenceIds(
  transcript: MultimodalTranscript,
  evidenceTimeline: MultimodalEvidence[],
  confidenceThreshold: number,
): Set<string> {
  const eligible = new Set<string>();
  for (const evidence of evidenceTimeline) {
    if (evidence.claimType !== 'sourceFact') {
      continue;
    }
    if (evidence.kind === 'transcript') {
      if (evidence.provenance.editedByUser === true) {
        eligible.add(evidence.evidenceId);
        continue;
      }
      if (transcript.status !== 'ready') {
        continue;
      }
      const { confidence } = evidence.provenance;
      if (
        typeof confidence !== 'number' ||
        !Number.isFinite(confidence) ||
        confidence < confidenceThreshold
      ) {
        continue;
      }
    }
    eligible.add(evidence.evidenceId);
  }
  return eligible;
}

function assertEvidenceTimelineMatchesSource(
  primarySource: MultimodalPrimarySource,
  evidenceTimeline: MultimodalEvidence[],
): void {
  for (const evidence of evidenceTimeline) {
    if (evidence.source.primarySourceId !== primarySource.sourceId) {
      failSession();
    }
  }
}

function normalizeRuntimeContext(input: {
  primarySource: unknown;
  transcript: unknown;
  evidenceTimeline: unknown;
  sourceFactTranscriptConfidenceThreshold: number;
}): {
  primarySource: MultimodalPrimarySource;
  transcript: MultimodalTranscript;
  evidenceTimeline: MultimodalEvidence[];
  sourceFactEligibleEvidenceIds: string[];
  evidenceIds: string[];
  frameEvidenceIds: string[];
} {
  const primarySource = parseMultimodalPrimarySource(
    input.primarySource,
    'primarySource',
  );
  if (!primarySource) {
    failSession();
  }
  const transcript = parseMultimodalTranscript(input.transcript, 'transcript');
  const evidenceTimeline = readDenseArray(
    input.evidenceTimeline,
    MAX_EVIDENCE_ITEMS,
  ).map((item) => parseEvidenceCard(item));
  const evidenceIds = new Set<string>();
  const frameEvidenceIds = new Set<string>();
  for (const evidence of evidenceTimeline) {
    if (evidenceIds.has(evidence.evidenceId)) {
      failSession();
    }
    evidenceIds.add(evidence.evidenceId);
    if (evidence.kind === 'frame') {
      frameEvidenceIds.add(evidence.evidenceId);
    }
  }
  assertEvidenceTimelineMatchesSource(primarySource, evidenceTimeline);
  return {
    primarySource,
    transcript,
    evidenceTimeline,
    sourceFactEligibleEvidenceIds: [
      ...deriveSourceFactEligibleEvidenceIds(
        transcript,
        evidenceTimeline,
        input.sourceFactTranscriptConfidenceThreshold,
      ),
    ],
    evidenceIds: [...evidenceIds],
    frameEvidenceIds: [...frameEvidenceIds],
  };
}

function withStableError<T>(operation: () => Promise<T>): Promise<T> {
  return operation().catch((error: unknown) => {
    getLogger({ component: 'multimodal-session-service' }).error(
      {
        event: 'multimodal.session_service_failed',
        error:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                ...(typeof (error as Error & { code?: unknown }).code !==
                'undefined'
                  ? { code: (error as Error & { code?: unknown }).code }
                  : {}),
                ...(typeof error.stack === 'string'
                  ? { stack: error.stack.split('\n').slice(0, 12).join('\n') }
                  : {}),
              }
            : error,
      },
      'multimodal.session_service_failed',
    );
    if (error instanceof MultimodalSessionServiceError) {
      throw error;
    }
    throw new MultimodalSessionServiceError();
  });
}

function collectEvidenceIds(evidenceTimeline: MultimodalEvidence[]) {
  const evidenceIds = new Set<string>();
  const frameEvidenceIds = new Set<string>();
  for (const evidence of evidenceTimeline) {
    evidenceIds.add(evidence.evidenceId);
    if (evidence.kind === 'frame') {
      frameEvidenceIds.add(evidence.evidenceId);
    }
  }
  return { evidenceIds, frameEvidenceIds };
}

function parseAdlerEnvelope(
  value: unknown,
  context: {
    evidenceTimeline: MultimodalEvidence[];
    sourceFactEligibleEvidenceIds: readonly string[];
    degradations: readonly MediaEvidenceDegradation[];
  },
): AdlerOverviewResult {
  const record = readRecord(value);
  ensureExactKeys(record, [
    'overview',
    'model',
    'promptVersion',
    'generatorVersion',
  ]);
  const { evidenceIds } = collectEvidenceIds(context.evidenceTimeline);
  return parseAdlerOverviewResult(
    {
      overview: parseAdlerOverview(record.overview, {
        evidenceIds: [...evidenceIds],
        sourceFactEligibleEvidenceIds: context.sourceFactEligibleEvidenceIds,
      }),
      meta: {
        model: readString(record.model, MAX_SHORT_TEXT_LENGTH),
        promptVersion: readString(record.promptVersion, MAX_SHORT_TEXT_LENGTH),
        generatorVersion: readString(
          record.generatorVersion,
          MAX_SHORT_TEXT_LENGTH,
        ),
        degradations: [...context.degradations],
      },
    },
    {
      evidenceIds: [...evidenceIds],
      sourceFactEligibleEvidenceIds: context.sourceFactEligibleEvidenceIds,
    },
  );
}

function parseCandidateEnvelope(
  value: unknown,
  context: {
    passKey: CandidatePassKey;
    evidenceTimeline: MultimodalEvidence[];
    sourceFactEligibleEvidenceIds: readonly string[];
  },
): {
  candidates: MultimodalCandidateSuggestion[];
  meta: { model: string; promptVersion: string };
} {
  const record = readRecord(value);
  ensureExactKeys(record, ['candidates', 'model', 'promptVersion']);
  const { evidenceIds, frameEvidenceIds } = collectEvidenceIds(
    context.evidenceTimeline,
  );
  const parsed = parseCandidatePasses(
    {
      frameworks: [],
      principles: [],
      cases: [],
      counterexamples: [],
      terms: [],
      [context.passKey]: record.candidates,
    },
    {
      evidenceIds: [...evidenceIds],
      frameEvidenceIds: [...frameEvidenceIds],
      sourceFactEligibleEvidenceIds: context.sourceFactEligibleEvidenceIds,
    },
  );
  return {
    candidates: parsed[context.passKey],
    meta: {
      model: readString(record.model, MAX_SHORT_TEXT_LENGTH),
      promptVersion: readString(record.promptVersion, MAX_SHORT_TEXT_LENGTH),
    },
  };
}

export function parseValidationEnvelope(
  value: unknown,
  expectedCandidateId: string,
) {
  const record = readRecord(value);
  ensureExactKeys(record, ['candidateId', 'v1', 'v2', 'v3']);
  if (readSafeId(record.candidateId) !== expectedCandidateId) {
    failSession();
  }

  const parseV1 = (input: unknown) => {
    const v1 = readRecord(input);
    ensureExactKeys(v1, ['passed', 'reason', 'reusableContexts']);
    const reusableContexts = readDenseArray(v1.reusableContexts, 8).map(
      (item) => readString(item, MAX_SHORT_TEXT_LENGTH),
    );
    const normalized = new Set(reusableContexts.map(normalizeTextKey));
    const proofSatisfied = reusableContexts.length >= 2 && normalized.size >= 2;
    return {
      passed: readBoolean(v1.passed),
      reason: readString(v1.reason, MAX_SHORT_TEXT_LENGTH),
      reusableContexts,
      proofSatisfied,
    };
  };

  const parseV2 = (input: unknown) => {
    const v2 = readRecord(input);
    ensureExactKeys(v2, ['passed', 'reason', 'novelScenario', 'capability']);
    const novelScenario = readString(v2.novelScenario, MAX_SHORT_TEXT_LENGTH);
    return {
      passed: readBoolean(v2.passed),
      reason: readString(v2.reason, MAX_SHORT_TEXT_LENGTH),
      novelScenario,
      capability: readEnumValue(v2.capability, VALIDATION_CAPABILITIES),
      proofSatisfied: novelScenario.trim().length > 0,
    };
  };

  const parseV3 = (input: unknown) => {
    const v3 = readRecord(input);
    ensureExactKeys(v3, ['passed', 'reason', 'differentiators']);
    const differentiators = readDenseArray(v3.differentiators, 8).map((item) =>
      readString(item, MAX_SHORT_TEXT_LENGTH),
    );
    return {
      passed: readBoolean(v3.passed),
      reason: readString(v3.reason, MAX_SHORT_TEXT_LENGTH),
      differentiators,
      proofSatisfied: differentiators.length >= 1,
    };
  };

  const v1 = parseV1(record.v1);
  const v2 = parseV2(record.v2);
  const v3 = parseV3(record.v3);
  return {
    v1,
    v2,
    v3,
    overallPassed:
      v1.passed &&
      v1.proofSatisfied &&
      v2.passed &&
      v2.proofSatisfied &&
      v3.passed &&
      v3.proofSatisfied,
  };
}

function parseLegacyValidatedCandidate(
  value: unknown,
  context: {
    evidenceTimeline: MultimodalEvidence[];
    sourceFactEligibleEvidenceIds: readonly string[];
  },
): ValidatedCandidateResult {
  const record = readRecord(value);
  ensureExactKeys(record, [
    'candidate',
    'validation',
    'overallPassed',
    'disposition',
  ]);
  const candidateRecord = readRecord(record.candidate);
  const passKey = readEnumValue(candidateRecord.passKey, CANDIDATE_PASS_KEYS);
  const { evidenceIds, frameEvidenceIds } = collectEvidenceIds(
    context.evidenceTimeline,
  );
  const candidate = parseCandidatePasses(
    {
      frameworks: [],
      principles: [],
      cases: [],
      counterexamples: [],
      terms: [],
      [passKey]: [record.candidate],
    },
    {
      evidenceIds: [...evidenceIds],
      frameEvidenceIds: [...frameEvidenceIds],
      sourceFactEligibleEvidenceIds: context.sourceFactEligibleEvidenceIds,
    },
  )[passKey][0];
  if (!candidate) {
    failSession();
  }
  const parsedValidation = parseValidationEnvelope(
    record.validation,
    candidate.candidateId,
  );
  const overallPassed = readBoolean(record.overallPassed);
  if (overallPassed !== parsedValidation.overallPassed) {
    failSession();
  }
  const disposition = readString(record.disposition, MAX_SHORT_TEXT_LENGTH);
  if (overallPassed) {
    if (disposition !== 'retain') {
      failSession();
    }
  } else if (
    !FAILURE_DISPOSITIONS.includes(disposition as FailedCandidateDisposition)
  ) {
    failSession();
  }
  return {
    candidate,
    validation: {
      v1: parsedValidation.v1,
      v2: parsedValidation.v2,
      v3: parsedValidation.v3,
    },
    overallPassed,
    disposition: disposition as CandidateDisposition,
  };
}

function parseValidatedCandidates(
  value: unknown,
  context: {
    evidenceTimeline: MultimodalEvidence[];
    sourceFactEligibleEvidenceIds: readonly string[];
  },
): ValidatedCandidateResult[] {
  const { evidenceIds, frameEvidenceIds } = collectEvidenceIds(
    context.evidenceTimeline,
  );
  const items = readDenseArray(value, CANDIDATE_PASS_KEYS.length * 24);
  const normalizedFlags = items.map((item) => {
    const validation = readRecord(readRecord(item).validation);
    return ['v1', 'v2', 'v3'].every((key) =>
      Object.prototype.hasOwnProperty.call(
        readRecord(validation[key]),
        'proofSatisfied',
      ),
    );
  });
  if (normalizedFlags.some(Boolean)) {
    if (!normalizedFlags.every(Boolean)) {
      failSession();
    }
    return parseValidatedCandidateResults(items, {
      evidenceIds: [...evidenceIds],
      frameEvidenceIds: [...frameEvidenceIds],
      sourceFactEligibleEvidenceIds: context.sourceFactEligibleEvidenceIds,
    });
  }
  const legacyItems = items.map((item) =>
    parseLegacyValidatedCandidate(item, context),
  );
  return parseValidatedCandidateResults(legacyItems, {
    evidenceIds: [...evidenceIds],
    frameEvidenceIds: [...frameEvidenceIds],
    sourceFactEligibleEvidenceIds: context.sourceFactEligibleEvidenceIds,
  });
}

function parseRiaEnvelope(
  value: unknown,
  context: {
    selectedCandidateIds: readonly string[];
    selectedResultsById: ReadonlyMap<string, ValidatedCandidateResult>;
    evidenceTimeline: MultimodalEvidence[];
  },
): { skills: RiaSkillDraft[] } {
  const record = readRecord(value);
  ensureExactKeys(record, ['skills']);
  const { evidenceIds } = collectEvidenceIds(context.evidenceTimeline);
  const rawSkills = readDenseArray(record.skills, 16).map((skillValue) => {
    const skill = readRecord(skillValue);
    ensureExactKeys(skill, [
      'candidateId',
      'id',
      'dirName',
      'name',
      'description',
      'skillMd',
      'sourceEvidenceIds',
      'mechanism',
      'sourceExample',
      'futureApplicability',
      'execution',
      'boundaries',
      'evidenceIds',
      'relations',
      'model',
      'promptVersion',
      'generatorVersion',
    ]);
    return {
      candidateId: skill.candidateId,
      id: skill.id,
      dirName: skill.dirName,
      name: skill.name,
      description: skill.description,
      skillMd: skill.skillMd,
      ria: {
        sourceEvidenceIds: skill.sourceEvidenceIds,
        mechanism: skill.mechanism,
        sourceExample: skill.sourceExample,
        futureApplicability: skill.futureApplicability,
        execution: skill.execution,
        boundaries: skill.boundaries,
      },
      evidenceIds: skill.evidenceIds,
      relations: skill.relations,
      manifest: {
        model: skill.model,
        promptVersion: skill.promptVersion,
        generatorVersion: skill.generatorVersion,
      },
    };
  });
  const skills = parseRiaSkillDrafts(rawSkills, {
    validatedCandidates: context.selectedCandidateIds.map((candidateId) => {
      const result = context.selectedResultsById.get(candidateId);
      if (!result) {
        failSession();
      }
      return result;
    }),
    evidenceIds: [...evidenceIds],
  });
  if (skills.length !== context.selectedCandidateIds.length) {
    failSession();
  }
  return { skills };
}

export function createMultimodalSessionService(
  adapters: {
    adlerAdapter: MultimodalAdlerAdapter;
    candidateAdapter: MultimodalCandidateAdapter;
    validationAdapter: MultimodalValidationAdapter;
    riaAdapter: MultimodalRiaAdapter;
    fusedTopicAdapter?: MultimodalFusedTopicAdapter | null;
  },
  options?: { sourceFactTranscriptConfidenceThreshold?: number },
) {
  const sourceFactTranscriptConfidenceThreshold =
    options?.sourceFactTranscriptConfidenceThreshold ?? 0.85;
  readProbability(sourceFactTranscriptConfidenceThreshold);

  return {
    generateAdlerOverview(input: {
      primarySource: MultimodalPrimarySource;
      transcript: MultimodalTranscript;
      evidenceTimeline: MultimodalEvidence[];
      degradations: readonly MediaEvidenceDegradation[];
    }): Promise<AdlerOverviewResult> {
      return withStableError(async () => {
        const context = normalizeRuntimeContext({
          primarySource: input.primarySource,
          transcript: input.transcript,
          evidenceTimeline: input.evidenceTimeline,
          sourceFactTranscriptConfidenceThreshold,
        });
        const degradations = parseMediaEvidenceDegradations(
          input.degradations,
          'degradations',
        );
        const raw = await adapters.adlerAdapter.generate({
          primarySource: context.primarySource,
          transcript: context.transcript,
          evidenceTimeline: context.evidenceTimeline,
          sourceFactEligibleEvidenceIds: context.sourceFactEligibleEvidenceIds,
          degradations,
        });
        return parseAdlerEnvelope(raw, {
          evidenceTimeline: context.evidenceTimeline,
          sourceFactEligibleEvidenceIds: context.sourceFactEligibleEvidenceIds,
          degradations,
        });
      });
    },

    extractCandidatePasses(input: {
      primarySource: MultimodalPrimarySource;
      transcript: MultimodalTranscript;
      evidenceTimeline: MultimodalEvidence[];
      confirmedStages: readonly MediaConfirmationStage[];
      adlerOverview: AdlerOverview;
      adlerOverviewReview: AdlerOverviewReview;
    }): Promise<{
      candidatePasses: MultimodalCandidatePasses;
      passMeta: Record<
        CandidatePassKey,
        { model: string; promptVersion: string }
      >;
    }> {
      return withStableError(async () => {
        assertMediaStageGate({
          targetStage: 'extracting_candidates',
          confirmedStages: input.confirmedStages,
        });
        const context = normalizeRuntimeContext({
          primarySource: input.primarySource,
          transcript: input.transcript,
          evidenceTimeline: input.evidenceTimeline,
          sourceFactTranscriptConfidenceThreshold,
        });
        const normalizedAdlerOverview = parseAdlerOverview(
          input.adlerOverview,
          {
            evidenceIds: context.evidenceIds,
            sourceFactEligibleEvidenceIds:
              context.sourceFactEligibleEvidenceIds,
          },
        );
        const normalizedAdlerOverviewReview = parseAdlerOverviewReview(
          input.adlerOverviewReview,
          'adlerOverviewReview',
        );
        const result = {
          frameworks: [] as MultimodalCandidateSuggestion[],
          principles: [] as MultimodalCandidateSuggestion[],
          cases: [] as MultimodalCandidateSuggestion[],
          counterexamples: [] as MultimodalCandidateSuggestion[],
          terms: [] as MultimodalCandidateSuggestion[],
          fused: [] as MultimodalCandidateSuggestion[],
        };
        const passMeta = {} as Record<
          CandidatePassKey,
          { model: string; promptVersion: string }
        >;

        const extractedPasses = await mapInWaves(
          CANDIDATE_PASS_KEYS,
          CANDIDATE_EXTRACTION_MAX_CONCURRENCY,
          async (passKey) => {
            const raw = await adapters.candidateAdapter.extractPass({
              passKey,
              primarySource: context.primarySource,
              transcript: context.transcript,
              evidenceTimeline: context.evidenceTimeline,
              sourceFactEligibleEvidenceIds:
                context.sourceFactEligibleEvidenceIds,
              adlerOverview: normalizedAdlerOverview,
              adlerOverviewReview: normalizedAdlerOverviewReview,
            });
            const parsed = parseCandidateEnvelope(raw, {
              passKey,
              evidenceTimeline: context.evidenceTimeline,
              sourceFactEligibleEvidenceIds:
                context.sourceFactEligibleEvidenceIds,
            });
            return { passKey, parsed };
          },
        );
        for (const { passKey, parsed } of extractedPasses) {
          result[passKey] = parsed.candidates.slice(
            0,
            MAX_SELECTED_CANDIDATES_PER_PASS,
          );
          passMeta[passKey] = parsed.meta;
        }

        return {
          candidatePasses: parseCandidatePasses(result, {
            evidenceIds: context.evidenceIds,
            frameEvidenceIds: context.frameEvidenceIds,
            sourceFactEligibleEvidenceIds:
              context.sourceFactEligibleEvidenceIds,
          }),
          passMeta,
        };
      });
    },

    validateCandidatePasses(input: {
      primarySource: MultimodalPrimarySource;
      transcript: MultimodalTranscript;
      confirmedStages: readonly MediaConfirmationStage[];
      evidenceTimeline: MultimodalEvidence[];
      candidatePasses: MultimodalCandidatePasses;
      failureDispositions?: Record<string, FailedCandidateDisposition>;
    }): Promise<{ results: ValidatedCandidateResult[] }> {
      return withStableError(async () => {
        assertMediaStageGate({
          targetStage: 'validating_candidates',
          confirmedStages: input.confirmedStages,
        });
        const context = normalizeRuntimeContext({
          primarySource: input.primarySource,
          transcript: input.transcript,
          evidenceTimeline: input.evidenceTimeline,
          sourceFactTranscriptConfidenceThreshold,
        });
        const candidatePasses = parseCandidatePasses(input.candidatePasses, {
          evidenceIds: context.evidenceIds,
          frameEvidenceIds: context.frameEvidenceIds,
          sourceFactEligibleEvidenceIds: context.sourceFactEligibleEvidenceIds,
        });
        const candidates = CANDIDATE_PASS_KEYS.flatMap(
          (passKey) => candidatePasses[passKey],
        );
        if (input.failureDispositions) {
          for (const candidateId of Object.keys(input.failureDispositions)) {
            if (
              !candidates.some(
                (candidate) => candidate.candidateId === candidateId,
              )
            ) {
              failSession();
            }
          }
        }
        const results = await mapInWaves(
          candidates,
          CANDIDATE_VALIDATION_MAX_CONCURRENCY,
          async (candidate): Promise<ValidatedCandidateResult> => {
            const parsed = parseValidationEnvelope(
              await adapters.validationAdapter.validate({
                candidate,
                evidenceTimeline: context.evidenceTimeline,
              }),
              candidate.candidateId,
            );
            const disposition = parsed.overallPassed
              ? 'retain'
              : (input.failureDispositions?.[candidate.candidateId] ??
                'discard');
            if (
              disposition !== 'retain' &&
              !FAILURE_DISPOSITIONS.includes(disposition)
            ) {
              failSession();
            }
            return {
              candidate,
              validation: {
                v1: parsed.v1,
                v2: parsed.v2,
                v3: parsed.v3,
              },
              overallPassed: parsed.overallPassed,
              disposition,
            };
          },
        );

        return { results };
      });
    },

    fuseCandidatePasses(input: {
      evidenceTimeline: MultimodalEvidence[];
      retainedCandidates: MultimodalCandidateSuggestion[];
    }): Promise<{
      candidates: MultimodalCandidateSuggestion[];
      validations: ValidatedCandidateResult[];
      meta: CandidatePassMeta['fused'] | null;
    }> {
      return withStableError(async () => {
        const evidenceTimeline = readDenseArray(
          input.evidenceTimeline,
          MAX_EVIDENCE_ITEMS,
        ).map((item) => parseEvidenceCard(item));
        const retainedCandidates = input.retainedCandidates.filter(
          (candidate) => candidate.passKey !== 'fused',
        );
        if (
          adapters.fusedTopicAdapter == null ||
          retainedCandidates.length === 0
        ) {
          return { candidates: [], validations: [], meta: null };
        }
        const referencedEvidenceIds = new Set(
          retainedCandidates.flatMap((candidate) => candidate.evidenceIds),
        );
        const referencedEvidenceTimeline = evidenceTimeline.filter((evidence) =>
          referencedEvidenceIds.has(evidence.evidenceId),
        );
        const raw = await adapters.fusedTopicAdapter.generateFusedTopics({
          candidates: retainedCandidates,
          evidenceTimeline: referencedEvidenceTimeline,
        });
        const parsed = parseCandidateEnvelope(raw, {
          passKey: 'fused',
          evidenceTimeline: referencedEvidenceTimeline,
          sourceFactEligibleEvidenceIds: [],
        });
        const validations = await mapInWaves(
          parsed.candidates,
          CANDIDATE_VALIDATION_MAX_CONCURRENCY,
          async (candidate): Promise<ValidatedCandidateResult> => {
            const parsedValidation = parseValidationEnvelope(
              await adapters.validationAdapter.validate({
                candidate,
                evidenceTimeline,
              }),
              candidate.candidateId,
            );
            return {
              candidate,
              validation: {
                v1: parsedValidation.v1,
                v2: parsedValidation.v2,
                v3: parsedValidation.v3,
              },
              overallPassed: parsedValidation.overallPassed,
              disposition: parsedValidation.overallPassed
                ? 'retain'
                : 'discard',
            };
          },
        );
        return {
          candidates: parsed.candidates,
          validations,
          meta: parsed.meta,
        };
      });
    },

    buildRiaSkills(input: {
      primarySource: MultimodalPrimarySource;
      transcript: MultimodalTranscript;
      confirmedStages: readonly MediaConfirmationStage[];
      evidenceTimeline: MultimodalEvidence[];
      validatedCandidates: unknown;
      selectedCandidateIds: readonly string[];
    }): Promise<{ skills: RiaSkillDraft[] }> {
      return withStableError(async () => {
        assertMediaStageGate({
          targetStage: 'building_skills',
          confirmedStages: input.confirmedStages,
        });
        const context = normalizeRuntimeContext({
          primarySource: input.primarySource,
          transcript: input.transcript,
          evidenceTimeline: input.evidenceTimeline,
          sourceFactTranscriptConfidenceThreshold,
        });
        const selectedCandidateIds = readUniqueStringArray(
          input.selectedCandidateIds,
          16,
        );
        if (selectedCandidateIds.length < 1) {
          failSession();
        }
        const validatedCandidates = parseValidatedCandidates(
          input.validatedCandidates,
          {
            evidenceTimeline: context.evidenceTimeline,
            sourceFactEligibleEvidenceIds:
              context.sourceFactEligibleEvidenceIds,
          },
        );
        const validatedById = new Map(
          validatedCandidates.map((result) => [
            result.candidate.candidateId,
            result,
          ]),
        );
        const selectedCandidates = selectedCandidateIds.map((candidateId) => {
          const result = validatedById.get(candidateId);
          if (
            !result ||
            !result.overallPassed ||
            result.disposition !== 'retain'
          ) {
            failSession();
          }
          return result.candidate;
        });
        const selectedEvidenceIds = new Set(
          selectedCandidates.flatMap((candidate) => candidate.evidenceIds),
        );
        const selectedEvidenceTimeline = context.evidenceTimeline.filter(
          (evidence) => selectedEvidenceIds.has(evidence.evidenceId),
        );
        const skillDirectory = selectedCandidates.map((candidate) => ({
          candidateId: candidate.candidateId,
          skillId: deterministicRiaSkillIdentity(candidate.candidateId).id,
          title: candidate.title,
          summary: candidate.summary,
        }));
        const candidateBatches = Array.from(
          {
            length: Math.ceil(selectedCandidates.length / RIA_BUILD_BATCH_SIZE),
          },
          (_, batchIndex) =>
            selectedCandidates.slice(
              batchIndex * RIA_BUILD_BATCH_SIZE,
              (batchIndex + 1) * RIA_BUILD_BATCH_SIZE,
            ),
        );
        const buildBatch = (candidates: typeof selectedCandidates) => {
          const batchEvidenceIds = new Set(
            candidates.flatMap((candidate) => candidate.evidenceIds),
          );
          return adapters.riaAdapter.buildSkills({
            candidates,
            skillDirectory,
            evidenceTimeline: selectedEvidenceTimeline.filter((evidence) =>
              batchEvidenceIds.has(evidence.evidenceId),
            ),
          });
        };
        const builtBatches: Awaited<ReturnType<typeof buildBatch>>[] = [];
        for (
          let batchIndex = 0;
          batchIndex < candidateBatches.length;
          batchIndex += RIA_BUILD_MAX_CONCURRENT_BATCHES
        ) {
          const wave = candidateBatches.slice(
            batchIndex,
            batchIndex + RIA_BUILD_MAX_CONCURRENT_BATCHES,
          );
          builtBatches.push(...(await Promise.all(wave.map(buildBatch))));
        }
        const mergedSkills = builtBatches.flatMap((batch) => {
          const record = readRecord(batch);
          ensureExactKeys(record, ['skills']);
          return assignServerOwnedRiaIdentities(
            readDenseArray(record.skills, RIA_BUILD_BATCH_SIZE),
          );
        });
        try {
          return parseRiaEnvelope(
            { skills: mergedSkills },
            {
              selectedCandidateIds,
              selectedResultsById: new Map(
                selectedCandidateIds.map((candidateId) => {
                  const result = validatedById.get(candidateId);
                  if (!result) {
                    failSession();
                  }
                  return [candidateId, result] as const;
                }),
              ),
              evidenceTimeline: selectedEvidenceTimeline,
            },
          );
        } catch (error) {
          const skillRecords = mergedSkills.filter(isPlainObject);
          const candidateIds = skillRecords.flatMap((skill) =>
            typeof skill.candidateId === 'string' ? [skill.candidateId] : [],
          );
          const skillIds = skillRecords.flatMap((skill) =>
            typeof skill.id === 'string' ? [skill.id] : [],
          );
          const dirNames = skillRecords.flatMap((skill) =>
            typeof skill.dirName === 'string' ? [skill.dirName] : [],
          );
          const skillIdSet = new Set(skillIds);
          const relationRecords = skillRecords.flatMap((skill) =>
            Array.isArray(skill.relations)
              ? skill.relations.filter(isPlainObject)
              : [],
          );
          getLogger({ component: 'multimodal-session-service' }).error(
            {
              event: 'multimodal.ria.aggregate_validation_failed',
              batchCount: builtBatches.length,
              skillCount: mergedSkills.length,
              duplicateCandidateIdCount:
                candidateIds.length - new Set(candidateIds).size,
              duplicateSkillIdCount: skillIds.length - skillIdSet.size,
              duplicateDirNameCount: dirNames.length - new Set(dirNames).size,
              unselectedCandidateIdCount: candidateIds.filter(
                (candidateId) => !selectedCandidateIds.includes(candidateId),
              ).length,
              missingCandidateIdCount: selectedCandidateIds.filter(
                (candidateId) => !candidateIds.includes(candidateId),
              ).length,
              invalidRelationTargetCount: relationRecords.filter(
                (relation) =>
                  typeof relation.targetSkillId !== 'string' ||
                  !skillIdSet.has(relation.targetSkillId),
              ).length,
              validationIssue:
                error instanceof Error
                  ? error.message.slice(0, 1000)
                  : 'unknown aggregate validation failure',
            },
            'multimodal.ria.aggregate_validation_failed',
          );
          throw error;
        }
      });
    },
  };
}
