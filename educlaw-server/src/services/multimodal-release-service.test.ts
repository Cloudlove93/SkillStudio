import { describe, expect, it, vi } from 'vitest';
import type { MultimodalSessionState } from '@educlaw/shared';
import {
  computeMultimodalArenaResultHash,
  type MultimodalArenaEvaluation,
} from './arena-service.js';
import {
  createMultimodalReleaseService,
  readMultimodalReleaseStatus,
  type MultimodalReleaseSession,
} from './multimodal-release-service.js';

function candidateState(): MultimodalSessionState {
  return {
    schemaVersion: 1,
    primarySource: {
      sourceId: 'source-1',
      kind: 'audio',
      assetRef: {
        objectKey: 'skill-sessions/101/source/audio.mp3',
        mimeType: 'audio/mpeg',
        sizeBytes: 4096,
        sha256: 'a'.repeat(64),
      },
    },
    pendingUpload: null,
    transcript: { status: 'ready', editable: true, segments: [] },
    evidenceTimeline: { evidenceItems: [] },
    candidatePasses: { frameworks: [], principles: [], cases: [], counterexamples: [], terms: [] },
    candidatePassMeta: null,
    semanticMoments: [],
    degradations: [],
    adlerOverview: null,
    adlerOverviewReview: { title: '已确认', approved: true, userNotes: '' },
    selectedCandidateIds: ['candidate-1'],
    candidateValidations: [],
    candidateSkills: [
      {
        candidateId: 'candidate-1',
        id: 'skill-1',
        dirName: 'teaching-transfer',
        name: '教学迁移法',
        description: '迁移课堂方法',
        skillMd: '# 教学迁移法\n按步骤执行并遵守停止条件。',
        ria: {
          sourceEvidenceIds: [], mechanism: '迁移', sourceExample: '课堂', futureApplicability: '新场景',
          execution: { input: '任务', steps: ['识别', '执行'], output: '方案', completionCriteria: '完成', stopCriteria: '越界停止' },
          boundaries: { counterexamples: ['无关任务'], failureModes: ['缺少输入'], limits: ['不编造'], confusions: [] },
        },
        evidenceIds: [],
        relations: [],
      },
    ],
    operationReceipts: [],
  };
}

function evaluation(candidateRevisionNo: number, snapshotHash: string, passed = true): MultimodalArenaEvaluation {
  const cases = ['novel-scenario-transfer', 'boundary-and-stop', 'evidence-grounding'].map((caseId) => ({
    caseId: caseId as MultimodalArenaEvaluation['cases'][number]['caseId'],
    input: 'fixed', baselineOutput: 'baseline', enhancedOutput: 'enhanced',
    baselineScore: 2, enhancedScore: passed ? 4 : 1,
    safetyPassed: true, groundedPassed: true, passed,
    reason: passed ? '通过' : '未通过',
  }));
  const withoutHash: Omit<MultimodalArenaEvaluation, 'resultHash'> = {
    schemaVersion: 1,
    configVersion: 'multimodal-arena-v1',
    caseVersion: '2026-08-23',
    candidateRevisionNo,
    snapshotHash,
    models: { baseline: 'baseline', enhanced: 'enhanced' },
    cases,
    passedCaseCount: passed ? 3 : 0,
    passed,
    deterministicFailures: passed ? [] : ['INSUFFICIENT_CASES_PASSED'],
  };
  return { ...withoutHash, resultHash: computeMultimodalArenaResultHash(withoutHash) };
}

function reorderJsonKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reorderJsonKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => right.localeCompare(left))
      .map(([key, item]) => [key, reorderJsonKeys(item)]),
  );
}

function harness(passed = true) {
  let session: MultimodalReleaseSession = {
    sessionId: '101',
    displayName: '课堂音频 Skill Pack',
    mediaStage: 'arena_testing',
    revisionNo: 10,
    confirmedStages: ['adler_overview', 'evidence_and_candidates'],
    mediaState: candidateState(),
    generatedSnapshot: null,
    arenaReceipt: null,
    publishReceipt: null,
  };
  let transactionDepth = 0;
  let serial = Promise.resolve();
  const withTransaction = <T>(work: (client: never) => Promise<T>) => {
    const run = serial.then(async () => {
      transactionDepth += 1;
      try { return await work({} as never); } finally { transactionDepth -= 1; }
    });
    serial = run.then(() => undefined, () => undefined);
    return run;
  };
  const repository = {
    loadForUpdate: vi.fn(async () => session),
    saveArenaResult: vi.fn(async (_db, input) => {
      session = { ...session, mediaStage: input.mediaStage, revisionNo: input.resultRevisionNo, generatedSnapshot: input.snapshot, arenaReceipt: input.receipt };
    }),
    savePublished: vi.fn(async (_db, input) => {
      session = { ...session, mediaStage: 'published', revisionNo: input.receipt.resultRevisionNo, generatedSnapshot: input.snapshot, publishReceipt: input.receipt };
    }),
  };
  const evaluator = vi.fn(async (input) => {
    expect(transactionDepth).toBe(0);
    return evaluation(input.candidateRevisionNo, input.snapshotHash, passed);
  });
  const publishPackageTx = vi.fn(async () => {
    expect(transactionDepth).toBe(1);
    return { packageId: 51, packageVersionId: 61, packageVersionNumber: 1, skillVersionIds: { 'skill-1': '71' } };
  });
  return {
    service: createMultimodalReleaseService({ withTransaction, repository, evaluator, publishPackageTx, now: () => new Date('2026-08-23T12:00:00.000Z') }),
    evaluator,
    publishPackageTx,
  };
}

describe('multimodal Arena and publish release', () => {
  it('confirms generation directly without invoking the optional Arena evaluator', async () => {
    const { service, evaluator, publishPackageTx } = harness(true);
    const input = {
      authUserId: 'user-1',
      sessionId: '101',
      idempotencyKey: 'generate-confirm-1',
      expectedRevisionNo: 10,
      targetPackageId: null,
      expectedPackageVersionId: null,
    };

    const first = await service.confirmGeneration(input);
    const replay = await service.confirmGeneration(input);

    expect(first).toMatchObject({
      action: 'skill.media.generate.confirm',
      mediaStage: 'published',
      revisionNo: 11,
      packageId: '51',
      replayed: false,
    });
    expect(replay).toEqual({ ...first, replayed: true });
    expect(evaluator).not.toHaveBeenCalled();
    expect(publishPackageTx).toHaveBeenCalledTimes(1);
  });

  it('confirms generation for a historical ready_to_publish session', async () => {
    const { service, publishPackageTx } = harness(true);
    await service.startArenaTest({
      authUserId: 'user-1',
      sessionId: '101',
      idempotencyKey: 'arena-legacy-1',
      expectedRevisionNo: 10,
    });

    await expect(service.confirmGeneration({
      authUserId: 'user-1',
      sessionId: '101',
      idempotencyKey: 'generate-legacy-1',
      expectedRevisionNo: 11,
      targetPackageId: null,
      expectedPackageVersionId: null,
    })).resolves.toMatchObject({ mediaStage: 'published', revisionNo: 12 });
    expect(publishPackageTx).toHaveBeenCalledTimes(1);
  });

  it('runs model work outside transactions and replays the revision-bound Arena receipt', async () => {
    const { service, evaluator } = harness(true);
    const input = { authUserId: 'user-1', sessionId: '101', idempotencyKey: 'arena-key-1', expectedRevisionNo: 10 };
    const first = await service.startArenaTest(input);
    const replay = await service.startArenaTest(input);

    expect(first).toMatchObject({ mediaStage: 'ready_to_publish', revisionNo: 11, passed: true, replayed: false });
    expect(replay).toEqual({ ...first, replayed: true });
    expect(evaluator).toHaveBeenCalledTimes(1);
  });

  it('keeps deterministic gate failures out of ready_to_publish and blocks publish', async () => {
    const { service, publishPackageTx } = harness(false);
    const testResult = await service.startArenaTest({ authUserId: 'user-1', sessionId: '101', idempotencyKey: 'arena-key-2', expectedRevisionNo: 10 });
    expect(testResult).toMatchObject({ mediaStage: 'arena_testing', passed: false });
    await expect(service.publish({ authUserId: 'user-1', sessionId: '101', idempotencyKey: 'publish-key-2', expectedRevisionNo: 11, targetPackageId: null, expectedPackageVersionId: null })).rejects.toMatchObject({ code: 'QUALITY_GATE_FAILED' });
    expect(publishPackageTx).not.toHaveBeenCalled();
  });

  it('publishes once under concurrency, replays the same IDs, and rejects key drift', async () => {
    const { service, publishPackageTx } = harness(true);
    await service.startArenaTest({ authUserId: 'user-1', sessionId: '101', idempotencyKey: 'arena-key-3', expectedRevisionNo: 10 });
    const input = { authUserId: 'user-1', sessionId: '101', idempotencyKey: 'publish-key-3', expectedRevisionNo: 11, targetPackageId: null, expectedPackageVersionId: null };
    const [left, right] = await Promise.all([service.publish(input), service.publish(input)]);
    expect(left.packageVersionId).toBe('61');
    expect(right.packageVersionId).toBe('61');
    expect([left.replayed, right.replayed].sort()).toEqual([false, true]);
    expect(publishPackageTx).toHaveBeenCalledTimes(1);

    await expect(service.publish({ ...input, targetPackageId: '99', expectedPackageVersionId: '100' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('rejects malformed persisted Arena evaluations before exposing them', () => {
    expect(() => readMultimodalReleaseStatus({
      validationResult: {
        schemaVersion: 1,
        action: 'skill.media.test.start',
        idempotencyKey: 'arena-corrupt',
        requestHash: 'a'.repeat(64),
        baseRevisionNo: 10,
        resultRevisionNo: 11,
        recordedAt: '2026-08-23T12:00:00.000Z',
        evaluation: { cases: 'not-an-array' },
      },
      confirmation: null,
    })).toThrowError(expect.objectContaining({ code: 'MULTIMODAL_SESSION_FAILED' }));
  });

  it('accepts a valid Arena receipt after JSONB changes object key order', () => {
    const validEvaluation = evaluation(10, 'c'.repeat(64));
    const persisted = reorderJsonKeys({
      schemaVersion: 1,
      action: 'skill.media.test.start',
      idempotencyKey: 'arena-jsonb-order',
      requestHash: 'a'.repeat(64),
      baseRevisionNo: 10,
      resultRevisionNo: 11,
      recordedAt: '2026-08-23T12:00:00.000Z',
      evaluation: validEvaluation,
    });

    expect(readMultimodalReleaseStatus({
      validationResult: persisted,
      confirmation: null,
    }).arenaEvaluation).toEqual(validEvaluation);
  });

  it('rejects hash-valid Arena evaluations with duplicated fixed case IDs', () => {
    const original = evaluation(10, 'c'.repeat(64));
    const cases = original.cases.map((item) => ({
      ...item,
      caseId: 'novel-scenario-transfer' as const,
    }));
    const withoutHash = {
      schemaVersion: original.schemaVersion,
      configVersion: original.configVersion,
      caseVersion: original.caseVersion,
      candidateRevisionNo: original.candidateRevisionNo,
      snapshotHash: original.snapshotHash,
      models: original.models,
      cases,
      passedCaseCount: original.passedCaseCount,
      passed: original.passed,
      deterministicFailures: original.deterministicFailures,
    };
    const corrupted = {
      ...withoutHash,
      resultHash: computeMultimodalArenaResultHash(withoutHash),
    };
    expect(() => readMultimodalReleaseStatus({
      validationResult: {
        schemaVersion: 1,
        action: 'skill.media.test.start',
        idempotencyKey: 'arena-duplicate-cases',
        requestHash: 'a'.repeat(64),
        baseRevisionNo: 10,
        resultRevisionNo: 11,
        recordedAt: '2026-08-23T12:00:00.000Z',
        evaluation: corrupted,
      },
      confirmation: null,
    })).toThrowError(expect.objectContaining({ code: 'MULTIMODAL_SESSION_FAILED' }));
  });

  it('rejects persisted Arena receipts with a non-successor revision', () => {
    expect(() => readMultimodalReleaseStatus({
      validationResult: {
        schemaVersion: 1,
        action: 'skill.media.test.start',
        idempotencyKey: 'arena-bad-revision',
        requestHash: 'a'.repeat(64),
        baseRevisionNo: 10,
        resultRevisionNo: 12,
        recordedAt: '2026-08-23T12:00:00.000Z',
        evaluation: evaluation(10, 'c'.repeat(64)),
      },
      confirmation: null,
    })).toThrowError(expect.objectContaining({ code: 'MULTIMODAL_SESSION_FAILED' }));
  });

  it('rejects malformed published skill version mappings before exposing them', () => {
    expect(() => readMultimodalReleaseStatus({
      validationResult: null,
      confirmation: {
        schemaVersion: 1,
        action: 'skill.media.publish',
        idempotencyKey: 'publish-corrupt',
        requestHash: 'b'.repeat(64),
        baseRevisionNo: 11,
        resultRevisionNo: 12,
        packageId: '51',
        packageVersionId: '61',
        packageVersionNumber: 1,
        skillVersionIds: { 'skill-1': 71 },
        publishedAt: '2026-08-23T12:00:00.000Z',
      },
    })).toThrowError(expect.objectContaining({ code: 'MULTIMODAL_SESSION_FAILED' }));
  });
});
