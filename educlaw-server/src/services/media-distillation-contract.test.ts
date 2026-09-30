import { describe, expect, it } from 'vitest';

import {
  buildDistillationResultHash,
  buildFrameAssetKey,
  buildJobResultManifestKey,
  buildNormalizedAudioKey,
  buildTranscriptAssetKey,
  buildTranscriptChunkManifestKey,
  parseFrameMaterializeOutputManifest,
  parseMediaPrepareOutputManifest,
  parseTranscribeOutputManifest,
} from './media-distillation-contract.js';

const jsonManifestRef = {
  objectKey: 'skill-sessions/101/jobs/701/attempt-1/result.json',
  mimeType: 'application/json',
  sizeBytes: 512,
  sha256: 'a'.repeat(64),
};

describe('media distillation job contracts', () => {
  it('strictly parses media_prepare output with slow-board and scene signals', () => {
    const output = parseMediaPrepareOutputManifest({
      schemaVersion: 1,
      jobType: 'media_prepare',
      sessionId: '101',
      sourceId: 'source-video-1',
      sourceKind: 'video',
      durationMs: 120_000,
      hasAudio: true,
      hasVideo: true,
      normalizedAudioAssetRef: {
        objectKey: 'skill-sessions/101/jobs/701/attempt-1/normalized-audio.wav',
        mimeType: 'audio/wav',
        sizeBytes: 64_000,
        sha256: 'b'.repeat(64),
      },
      visualSignals: {
        sceneChangeTimestampsMs: [10_000, 60_000],
        slowVisualChangeTimestampsMs: [30_000, 90_000],
        sampledFrameCount: 20,
        detectorVersion: '1.0.0',
      },
      resultManifestRef: jsonManifestRef,
      processorVersion: '1.0.0',
      degradations: [],
    });

    expect(output.visualSignals.slowVisualChangeTimestampsMs).toEqual([
      30_000,
      90_000,
    ]);
    expect(buildDistillationResultHash(output)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('requires ordered segment-level timestamps for transcribe output', () => {
    const output = parseTranscribeOutputManifest({
      schemaVersion: 1,
      jobType: 'transcribe',
      sessionId: '101',
      sourceId: 'source-audio-1',
      durationMs: 20_000,
      transcript: {
        status: 'ready',
        editable: true,
        segments: [
          { startMs: 0, endMs: 8_000, text: '先定义概念', confidence: 0.96 },
          { startMs: 8_000, endMs: 20_000, text: '再演示步骤', confidence: 0.91 },
        ],
      },
      transcriptAssetRef: {
        objectKey: 'skill-sessions/101/jobs/702/attempt-1/transcript.json',
        mimeType: 'application/json',
        sizeBytes: 1024,
        sha256: 'c'.repeat(64),
      },
      resultManifestRef: {
        ...jsonManifestRef,
        objectKey: 'skill-sessions/101/jobs/702/attempt-1/result.json',
      },
      processorVersion: '1.0.0',
      degradations: [],
    });
    expect(output.transcript.segments).toHaveLength(2);

    expect(() =>
      parseTranscribeOutputManifest({
        ...output,
        transcript: {
          ...output.transcript,
          segments: [
            { startMs: 5_000, endMs: 9_000, text: '后段' },
            { startMs: 1_000, endMs: 4_000, text: '倒序' },
          ],
        },
      }),
    ).toThrow(/segment/i);
  });

  it('keeps the worker hash stable when parsing omitted optional transcript fields', () => {
    const workerOutput = {
      schemaVersion: 1,
      jobType: 'transcribe',
      sessionId: '101',
      sourceId: 'source-audio-1',
      durationMs: 20_000,
      transcript: {
        status: 'low_confidence',
        editable: true,
        segments: [
          {
            startMs: 0,
            endMs: 8_000,
            text: '先定义概念',
            speaker: null,
            confidence: 0.62,
          },
        ],
      },
      transcriptAssetRef: {
        objectKey: 'skill-sessions/101/jobs/702/attempt-1/transcript.json',
        mimeType: 'application/json',
        sizeBytes: 1024,
        sha256: 'c'.repeat(64),
      },
      resultManifestRef: {
        ...jsonManifestRef,
        objectKey: 'skill-sessions/101/jobs/702/attempt-1/result.json',
      },
      processorVersion: '1.0.0',
      degradations: [
        {
          code: 'LOW_CONFIDENCE_SEGMENTS',
          message: 'one_or_more_segments_below_confidence_threshold',
        },
      ],
    } as const;

    const parsedOutput = parseTranscribeOutputManifest(workerOutput);

    expect(parsedOutput.transcript.segments[0]).toHaveProperty(
      'editedByUser',
      undefined,
    );
    expect(buildDistillationResultHash(parsedOutput)).toBe(
      buildDistillationResultHash(workerOutput),
    );
  });

  it('strictly binds materialized frame candidates and deterministic quality data', () => {
    const output = parseFrameMaterializeOutputManifest({
      schemaVersion: 1,
      jobType: 'frame_materialize',
      sessionId: '101',
      sourceId: 'source-video-1',
      candidates: [
        {
          candidateId: 'frame-candidate-001',
          semanticMomentId: 'moment-001',
          timestampMs: 10_000,
          sourceSignal: 'slow_visual_change',
          selectionReason: 'board writing accumulated',
          assetRef: {
            objectKey:
              'skill-sessions/101/jobs/703/attempt-1/frames/frame-candidate-001.png',
            mimeType: 'image/png',
            sizeBytes: 2048,
            sha256: 'd'.repeat(64),
          },
          metrics: {
            analysisWidth: 320,
            analysisHeight: 180,
            brightnessMeanNormalized: 0.5,
            blackPixelRatio: 0.01,
            whitePixelRatio: 0.2,
            entropyNormalized: 0.7,
            sharpness: {
              algorithm: 'laplacian_variance_4_neighbour_normalized',
              normalized: true,
              value: 0.8,
            },
            duplicateHash: { algorithm: 'dhash_64', value: '0123456789abcdef' },
          },
          hardRejectedReasons: [],
          suppressed: false,
          duplicateOf: null,
          frameExtractorVersion: '1.0.0',
          qualityProcessorVersion: '1.0.0',
        },
      ],
      resultManifestRef: {
        ...jsonManifestRef,
        objectKey: 'skill-sessions/101/jobs/703/attempt-1/result.json',
      },
      processorVersion: '1.0.0',
      degradations: [],
    });

    expect(output.candidates[0]?.sourceSignal).toBe('slow_visual_change');
    expect(buildDistillationResultHash(output)).not.toBe(
      buildDistillationResultHash({ ...output, processorVersion: '1.0.1' }),
    );
  });

  it('derives immutable attempt-scoped artifact keys', () => {
    expect(buildNormalizedAudioKey({ sessionId: '101', jobId: '701', attemptNo: 2 }))
      .toBe('skill-sessions/101/jobs/701/attempt-2/normalized-audio.wav');
    expect(buildTranscriptAssetKey({ sessionId: '101', jobId: '702', attemptNo: 1 }))
      .toBe('skill-sessions/101/jobs/702/attempt-1/transcript.json');
    expect(buildTranscriptChunkManifestKey({
      sessionId: '101',
      jobId: '702',
      attemptNo: 2,
      chunkIndex: 3,
    })).toBe(
      'skill-sessions/101/jobs/702/attempt-2/transcript-chunks/chunk-0003.json',
    );
    expect(buildFrameAssetKey({
      sessionId: '101',
      jobId: '703',
      attemptNo: 1,
      candidateId: 'frame-candidate-001',
    })).toBe(
      'skill-sessions/101/jobs/703/attempt-1/frames/frame-candidate-001.png',
    );
    expect(buildJobResultManifestKey({ sessionId: '101', jobId: '703', attemptNo: 1 }))
      .toBe('skill-sessions/101/jobs/703/attempt-1/result.json');
  });
});
