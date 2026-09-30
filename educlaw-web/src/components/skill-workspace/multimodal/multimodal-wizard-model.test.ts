import { describe, expect, it } from 'vitest';
import type { MediaSessionDetail } from '../../../api/lite-api';
import {
  ADLER_LAYER_LABELS,
  aggregateMultimodalDegradations,
  deriveMultimodalWizardStep,
  evidenceByIds,
  paginateMultimodalItems,
} from './multimodal-wizard-model';

describe('multimodal wizard model', () => {
  it('names the final user step as direct generation', async () => {
    const { MULTIMODAL_WIZARD_STEPS } = await import('./multimodal-wizard-model');
    expect(MULTIMODAL_WIZARD_STEPS.at(-1)?.label).toBe('确认生成');
  });

  it.each([
    'draft',
    'uploading',
    'ready_to_process',
    'preparing_media',
    'transcribing',
    'reviewing_transcript',
    'building_semantic_windows',
    'building_evidence',
    'building_adler',
  ] as const)('maps processing stage %s', (mediaStage) => {
    expect(deriveMultimodalWizardStep({ mediaStage } as MediaSessionDetail)).toBe(
      'processing',
    );
  });

  it.each(['awaiting_adler_overview', 'extracting_candidates'] as const)(
    'maps overview stage %s',
    (mediaStage) => {
      expect(
        deriveMultimodalWizardStep({ mediaStage } as MediaSessionDetail),
      ).toBe('overview');
    },
  );

  it.each([
    'validating_candidates',
    'awaiting_candidates',
    'building_skills',
  ] as const)('maps candidate stage %s', (mediaStage) => {
    expect(deriveMultimodalWizardStep({ mediaStage } as MediaSessionDetail)).toBe(
      'candidates',
    );
  });

  it.each([
    'arena_testing',
    'ready_to_publish',
    'publishing',
    'published',
  ] as const)('maps release stage %s', (mediaStage) => {
    expect(deriveMultimodalWizardStep({ mediaStage } as MediaSessionDetail)).toBe(
      'release',
    );
  });

  it('infers the furthest safe failed step', () => {
    expect(
      deriveMultimodalWizardStep({
        mediaStage: 'cancelled',
        mediaState: {},
      } as MediaSessionDetail),
    ).toBe('processing');
    expect(
      deriveMultimodalWizardStep({
        mediaStage: 'failed',
        mediaState: { adlerOverview: {} },
      } as MediaSessionDetail),
    ).toBe('overview');
    expect(
      deriveMultimodalWizardStep({
        mediaStage: 'failed',
        mediaState: {
          candidatePasses: {
            frameworks: [{ candidateId: 'candidate-1' }],
            principles: [],
            cases: [],
            counterexamples: [],
            terms: [],
            fused: [],
          },
          candidateValidations: [],
        },
      } as MediaSessionDetail),
    ).toBe('candidates');
    expect(
      deriveMultimodalWizardStep({
        mediaStage: 'failed',
        mediaState: { candidateValidations: [{}] },
      } as MediaSessionDetail),
    ).toBe('candidates');
    expect(
      deriveMultimodalWizardStep({
        mediaStage: 'failed',
        mediaState: { candidateSkills: [{}] },
      } as MediaSessionDetail),
    ).toBe('release');
  });

  it.each([
    ['extracting_candidates', 'overview'],
    ['validating_candidates', 'candidates'],
    ['building_skills', 'candidates'],
  ] as const)('maps failed resume stage %s to its exact step', (resumeStage, step) => {
    expect(deriveMultimodalWizardStep({
      mediaStage: 'failed',
      error: {
        code: 'MULTIMODAL_PIPELINE_FAILED',
        stage: resumeStage,
        resumeStage,
        retryable: true,
        message: '处理失败',
      },
      mediaState: {},
    } as MediaSessionDetail)).toBe(step);
  });

  it('uses Chinese Adler labels', () => {
    expect(ADLER_LAYER_LABELS).toEqual({
      structure: '内容结构',
      interpretation: '核心理解',
      critique: '问题与不足',
      application: '可迁移应用',
    });
  });

  it('groups repeated degradation records', () => {
    const result = aggregateMultimodalDegradations([
      {
        code: 'FRAME_SHARPNESS_THRESHOLD_RELAXED',
        message: 'retained sharpest candidates',
        semanticMomentId: 'm1',
      },
      {
        code: 'FRAME_SHARPNESS_THRESHOLD_RELAXED',
        message: 'retained sharpest candidates',
        semanticMomentId: 'm2',
      },
      {
        code: 'ASR_LOW_CONFIDENCE_UNCONFIRMED',
        message: 'requires confirmation',
      },
    ]);

    expect(result.map((item) => [item.code, item.count])).toEqual([
      ['FRAME_SHARPNESS_THRESHOLD_RELAXED', 2],
      ['ASR_LOW_CONFIDENCE_UNCONFIRMED', 1],
    ]);
    expect(result[0].semanticMomentIds).toEqual(['m1', 'm2']);
  });

  it('normalizes repeated degradation whitespace before grouping', () => {
    const result = aggregateMultimodalDegradations([
      { code: 'FRAME', message: 'same   message' },
      { code: 'FRAME', message: ' same message ' },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].count).toBe(2);
  });

  it('returns six candidates per page without mutating input', () => {
    const items = Array.from({ length: 16 }, (_, index) => ({
      id: String(index + 1),
    }));

    expect(
      paginateMultimodalItems(items, 2, 6).items.map((item) => item.id),
    ).toEqual(['7', '8', '9', '10', '11', '12']);
    expect(paginateMultimodalItems(items, 3, 6)).toMatchObject({
      page: 3,
      pageCount: 3,
      total: 16,
    });
    expect(items).toHaveLength(16);
  });

  it('clamps invalid pages to the available range', () => {
    const items = ['a', 'b', 'c'];

    expect(paginateMultimodalItems(items, 0, 2)).toMatchObject({
      page: 1,
      items: ['a', 'b'],
    });
    expect(paginateMultimodalItems(items, 99, 2)).toMatchObject({
      page: 2,
      items: ['c'],
    });
  });

  it('selects evidence by id without changing timeline order', () => {
    const evidence = [
      { evidenceId: 'ev-1', timeRange: { startMs: 100, endMs: 200 } },
      { evidenceId: 'ev-2', timeRange: { startMs: 300, endMs: 400 } },
      { evidenceId: 'ev-3', timeRange: { startMs: 500, endMs: 600 } },
    ];

    expect(
      evidenceByIds(evidence, ['ev-3', 'ev-1']).map(
        (item) => item.evidenceId,
      ),
    ).toEqual(['ev-1', 'ev-3']);
    expect(evidence).toHaveLength(3);
  });
});
