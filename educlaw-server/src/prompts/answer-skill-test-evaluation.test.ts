import { describe, expect, it } from 'vitest';
import {
  AnswerSkillTestEvaluationContractError,
  buildAnswerSkillTestEvaluationLocalizationPrompt,
  buildAnswerSkillTestEvaluationPrompt,
  parseAnswerSkillTestEvaluationOutput,
} from './answer-skill-test-evaluation.js';

function validEvaluation() {
  return {
    samples: [
      {
        sampleIndex: 0,
        passed: true,
        score: 91,
        satisfiedRequirements: ['Ordered response steps'],
        unmetRequirements: [],
        riskNotes: [],
        criticalRisk: false,
      },
      {
        sampleIndex: 1,
        passed: true,
        score: 84,
        satisfiedRequirements: ['Usable family wording'],
        unmetRequirements: [],
        riskNotes: [],
        criticalRisk: false,
      },
      {
        sampleIndex: 2,
        passed: false,
        score: 62,
        satisfiedRequirements: [],
        unmetRequirements: ['Follow-up is too vague'],
        riskNotes: [],
        criticalRisk: false,
      },
    ],
    bestSampleIndex: 0,
    overallSummary: 'Two samples consistently satisfy the reusable feedback.',
  };
}

describe('answer Skill test evaluation prompt', () => {
  it('gives the Judge feedback and samples without database controls', () => {
    const prompt = buildAnswerSkillTestEvaluationPrompt({
      question: 'How should the teacher contact the family?',
      conversationContext: 'User: Earlier context',
      userFeedback: 'Add ordered steps and usable wording.',
      refinementFeedback: [
        'Keep the steps and make the family wording neutral.',
      ],
      diagnosis: {
        summary: 'The answer is too broad.',
        reusability: 'reusable',
        riskNotes: [],
      },
      rubricMd: '## Dimensions\n- Safety',
      beforeAnswer: 'Contact the family.',
      afterSamples: ['Sample A', 'Sample B', 'Sample C'],
    });

    expect(prompt.temperature).toBe(0);
    expect(prompt.systemPrompt).toContain('exactly three');
    expect(prompt.systemPrompt).toContain('Simplified Chinese');
    expect(prompt.systemPrompt).toContain(
      'satisfiedRequirements, unmetRequirements, riskNotes, and overallSummary',
    );
    expect(prompt.systemPrompt).toContain(
      'Keep JSON keys, sampleIndex, passed, score, criticalRisk, and bestSampleIndex unchanged',
    );
    expect(prompt.systemPrompt).toContain(
      'Preserve the original question and answers',
    );
    expect(prompt.systemPrompt).toContain(
      'the user makes the final product decision',
    );
    expect(prompt.systemPrompt).toContain('"sampleIndex":0');
    expect(prompt.systemPrompt).toContain('"passed":true');
    expect(prompt.userPrompt).toContain('Add ordered steps');
    expect(prompt.userPrompt).toContain(
      'Keep the steps and make the family wording neutral.',
    );
    expect(prompt.userPrompt).toContain('Sample C');
    expect(prompt.userPrompt).not.toContain('finalVersionId');
    expect(prompt.userPrompt).not.toContain('current_version_id');
  });

  it('localizes only Judge text while preserving scores and decisions', () => {
    const prompt = buildAnswerSkillTestEvaluationLocalizationPrompt({
      output: validEvaluation(),
    });

    expect(prompt.systemPrompt).toContain(
      'Translate only satisfiedRequirements, unmetRequirements, riskNotes, and overallSummary',
    );
    expect(prompt.systemPrompt).toContain(
      'Do not change sampleIndex, passed, score, criticalRisk, or bestSampleIndex',
    );
    expect(prompt.userPrompt).toContain('"sampleIndex":0');
    expect(prompt.userPrompt).toContain('"score":91');
    expect(prompt.userPrompt).toContain('"bestSampleIndex":0');
  });
});

describe('answer Skill test evaluation contract', () => {
  it('accepts and normalizes exactly three indexed samples', () => {
    const parsed = parseAnswerSkillTestEvaluationOutput({
      ...validEvaluation(),
      samples: [...validEvaluation().samples].reverse(),
    });

    expect(parsed.samples.map((sample) => sample.sampleIndex)).toEqual([
      0, 1, 2,
    ]);
    expect(parsed.bestSampleIndex).toBe(0);
  });

  it.each([
    ['an extra field', { ...validEvaluation(), status: 'test_ready' }],
    [
      'a missing sample',
      { ...validEvaluation(), samples: validEvaluation().samples.slice(0, 2) },
    ],
    [
      'duplicate indexes',
      {
        ...validEvaluation(),
        samples: validEvaluation().samples.map((sample) => ({
          ...sample,
          sampleIndex: 0,
        })),
      },
    ],
    [
      'an invalid score',
      {
        ...validEvaluation(),
        samples: validEvaluation().samples.map((sample, index) => ({
          ...sample,
          score: index === 1 ? 101 : sample.score,
        })),
      },
    ],
    ['an invalid best index', { ...validEvaluation(), bestSampleIndex: 3 }],
  ])('rejects %s', (_label, value) => {
    expect(() => parseAnswerSkillTestEvaluationOutput(value)).toThrow(
      AnswerSkillTestEvaluationContractError,
    );
  });
});
