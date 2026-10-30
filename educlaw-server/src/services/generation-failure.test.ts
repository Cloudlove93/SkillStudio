import { describe, expect, it } from 'vitest';
import { parseSemanticMomentDrafts } from '@educlaw/shared';
import { classifyGenerationFailure } from './generation-failure.js';
describe('bounded generation diagnostics', () => {
  it('preserves a bounded shared-contract field path while keeping the public error generic', () => {
    let caught: unknown;
    try {
      parseSemanticMomentDrafts(
        [
          {
            startMs: 0,
            endMs: 1000,
            importance: 9,
            type: 'concept',
            summary: 'PRIVATE_TEXT',
            visualTarget: null,
            audioEvidence: null,
            transcriptEvidence: null,
            selectionReason: 'test',
          },
        ],
        { durationMs: 1000 },
      );
    } catch (error) {
      caught = error;
    }
    expect(classifyGenerationFailure(caught)).toMatchObject({
      reason: 'schema',
      path: 'semanticMoments[0].importance',
    });
    expect((caught as Error).message).not.toContain('PRIVATE_TEXT');
  });
  it.each([
    ['LLM request failed: 401', 'authentication', false],
    ['LLM request failed: 404', 'model_configuration', false],
    ['LLM request failed: 429', 'rate_limit', true],
    ['LLM request failed: 503', 'provider_unavailable', true],
    [
      'JSON generation failed: LLM output token limit was exhausted before usable content was returned',
      'truncated',
      false,
    ],
    [
      'Model returned invalid JSON and automatic repair also failed',
      'json_syntax',
      true,
    ],
    ['SEMANTIC_CHUNK_RESULT_OUT_OF_WINDOW', 'time_bounds', false],
    ['SEMANTIC_CHUNK_RESULT_INVALID', 'empty_result', true],
  ])(
    'classifies %s without exposing response text',
    (message, reason, retryable) => {
      const d = classifyGenerationFailure(new Error(message));
      expect(d).toMatchObject({ reason, retryable });
      expect(JSON.stringify(d)).not.toContain(message);
    },
  );
  it('keeps only a schema path, never material values', () => {
    const d = classifyGenerationFailure(
      new Error(
        'moments[2].audioEvidence.timeRange.endMs is out of range: SECRET_STUDENT',
      ),
    );
    expect(d).toMatchObject({
      reason: 'time_bounds',
      path: 'moments[2].audioEvidence.timeRange.endMs',
    });
    expect(JSON.stringify(d)).not.toContain('SECRET_STUDENT');
  });
});
