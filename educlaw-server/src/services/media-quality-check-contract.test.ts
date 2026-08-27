import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  canonicalQualityCheckOutputJson,
  computeQualityCheckResultHash,
  parseQualityCheckInputManifest,
  parseQualityCheckOutputManifest,
  type QualityCheckOutputManifest,
} from './media-quality-check-contract.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function makeValidInput() {
  return {
    schemaVersion: 1,
    sourceId: 'src-test-001',
    mediaKind: 'video' as const,
    objectKey: 'skill-sessions/42/source/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d.mp4',
    fileName: 'recording.mp4',
    expectedSizeBytes: 1024000,
    expectedContentType: 'video/mp4',
    uploadMode: 'single_put' as const,
  };
}

function makeValidOutput(): QualityCheckOutputManifest {
  return {
    schemaVersion: 1,
    jobType: 'media_quality_check',
    sessionId: 'ses-abc-123',
    sourceId: 'src-test-001',
    sourceKind: 'video',
    sourceAsset: {
      objectKey: 'skill-sessions/42/source/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d.mp4',
      mimeType: 'video/mp4',
      sizeBytes: 1024000,
      sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    },
    probe: {
      durationMs: 30000,
      formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
      hasAudio: true,
      hasVideo: true,
      audioStreamCount: 1,
      videoStreamCount: 1,
      primaryAudioStreamIndex: 0,
      primaryVideoStreamIndex: 1,
    },
    resultManifestRef: {
      objectKey: 'skill-sessions/42/manifest/00000000-0000-4000-8000-000000000001.json',
      mimeType: 'application/json',
      sizeBytes: 512,
      sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
    processorVersion: '0.1.0',
    degradations: [],
  };
}

function canonicalizeGenericJson(value: unknown): string {
  return JSON.stringify(value, (_key, nestedValue) => {
    if (
      typeof nestedValue === 'object' &&
      nestedValue !== null &&
      !Array.isArray(nestedValue)
    ) {
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(nestedValue).sort()) {
        sorted[key] = (nestedValue as Record<string, unknown>)[key];
      }
      return sorted;
    }
    return nestedValue;
  });
}

describe('parseQualityCheckInputManifest', () => {
  it('rejects non-object', () => {
    expect(() => parseQualityCheckInputManifest(null)).toThrow('must be a plain object');
    expect(() => parseQualityCheckInputManifest('string')).toThrow('must be a plain object');
    expect(() => parseQualityCheckInputManifest([])).toThrow('must be a plain object');
  });

  it('rejects unknown keys', () => {
    const input = { ...makeValidInput(), signedUrl: 'https://evil.example.com' };
    expect(() => parseQualityCheckInputManifest(input)).toThrow('unknown key "signedUrl"');
  });

  it('rejects url/token/uploadId/ETag/headers if smuggled', () => {
    const input = { ...makeValidInput(), url: 'https://example.com' };
    expect(() => parseQualityCheckInputManifest(input)).toThrow('unknown key "url"');
  });

  it('rejects wrong schemaVersion', () => {
    const input = { ...makeValidInput(), schemaVersion: 99 };
    expect(() => parseQualityCheckInputManifest(input)).toThrow('schemaVersion must be 1');
  });

  it('rejects invalid mediaKind', () => {
    const input = { ...makeValidInput(), mediaKind: 'image' };
    expect(() => parseQualityCheckInputManifest(input)).toThrow('mediaKind must be one of');
  });

  it('rejects negative expectedSizeBytes', () => {
    const input = { ...makeValidInput(), expectedSizeBytes: -1 };
    expect(() => parseQualityCheckInputManifest(input)).toThrow('must be >= 0');
  });

  it('rejects non-integer expectedSizeBytes', () => {
    const input = { ...makeValidInput(), expectedSizeBytes: 1.5 };
    expect(() => parseQualityCheckInputManifest(input)).toThrow('must be an integer');
  });

  it('rejects empty sourceId', () => {
    const input = { ...makeValidInput(), sourceId: '' };
    expect(() => parseQualityCheckInputManifest(input)).toThrow('is not a valid id');
  });

  it('rejects empty objectKey', () => {
    const input = { ...makeValidInput(), objectKey: '' };
    expect(() => parseQualityCheckInputManifest(input)).toThrow('must be a non-empty string');
  });

  it('rejects empty fileName', () => {
    const input = { ...makeValidInput(), fileName: '' };
    expect(() => parseQualityCheckInputManifest(input)).toThrow('must be a non-empty string');
  });

  it('rejects empty expectedContentType', () => {
    const input = { ...makeValidInput(), expectedContentType: '' };
    expect(() => parseQualityCheckInputManifest(input)).toThrow('must be a non-empty string');
  });

  it('rejects invalid uploadMode', () => {
    const input = { ...makeValidInput(), uploadMode: 'presigned_post' };
    expect(() => parseQualityCheckInputManifest(input)).toThrow('uploadMode must be one of');
  });

  it('accepts valid input manifest', () => {
    const result = parseQualityCheckInputManifest(makeValidInput());
    expect(result.schemaVersion).toBe(1);
    expect(result.sourceId).toBe('src-test-001');
    expect(result.mediaKind).toBe('video');
    expect(result.objectKey).toBe('skill-sessions/42/source/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d.mp4');
    expect(result.fileName).toBe('recording.mp4');
    expect(result.expectedSizeBytes).toBe(1024000);
    expect(result.expectedContentType).toBe('video/mp4');
    expect(result.uploadMode).toBe('single_put');
  });
});

describe('parseQualityCheckOutputManifest', () => {
  it('accepts the default python worker processorVersion constant across the contract boundary', () => {
    const workerSource = readFileSync(
      path.resolve(
        __dirname,
        '../../../python/media_worker/src/media_worker/quality_check_executor.py',
      ),
      'utf-8',
    );
    const match = workerSource.match(
      /^PROCESSOR_VERSION\s*=\s*["']([^"']+)["']/m,
    );
    expect(match?.[1]).toBeTruthy();

    const output = {
      ...makeValidOutput(),
      processorVersion: match?.[1],
    };

    expect(() => parseQualityCheckOutputManifest(output)).not.toThrow();
  });

  it('rejects non-object', () => {
    expect(() => parseQualityCheckOutputManifest(null)).toThrow('must be a plain object');
  });

  it('rejects unknown keys', () => {
    const output = { ...makeValidOutput(), s3Path: '/tmp/evil' };
    expect(() => parseQualityCheckOutputManifest(output)).toThrow('unknown key "s3Path"');
  });

  it('rejects wrong schemaVersion', () => {
    const output = { ...makeValidOutput(), schemaVersion: 99 };
    expect(() => parseQualityCheckOutputManifest(output)).toThrow('schemaVersion must be 1');
  });

  it('rejects wrong jobType', () => {
    const output = { ...makeValidOutput(), jobType: 'transcribe' };
    expect(() => parseQualityCheckOutputManifest(output)).toThrow('must be one of');
  });

  it('rejects invalid sourceKind', () => {
    const output = { ...makeValidOutput(), sourceKind: 'image' };
    expect(() => parseQualityCheckOutputManifest(output)).toThrow('sourceKind must be one of');
  });

  it('rejects empty sessionId', () => {
    const output = { ...makeValidOutput(), sessionId: '' };
    expect(() => parseQualityCheckOutputManifest(output)).toThrow('is not a valid id');
  });

  it('rejects invalid sha256 in sourceAsset', () => {
    const output = { ...makeValidOutput() };
    (output.sourceAsset as Record<string, unknown>).sha256 = 'bad';
    expect(() => parseQualityCheckOutputManifest(output)).toThrow('64-char hex SHA-256');
  });

  it('rejects too-short sha256', () => {
    const output = { ...makeValidOutput() };
    (output.sourceAsset as Record<string, unknown>).sha256 = 'abcdef';
    expect(() => parseQualityCheckOutputManifest(output)).toThrow('64-char hex SHA-256');
  });

  it('rejects uppercase sha256', () => {
    const output = { ...makeValidOutput() };
    (output.sourceAsset as Record<string, unknown>).sha256 =
      'E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855';
    expect(() => parseQualityCheckOutputManifest(output)).toThrow('64-char hex SHA-256');
  });

  it('rejects negative durationMs', () => {
    const output = { ...makeValidOutput(), probe: { ...makeValidOutput().probe, durationMs: -1 } };
    expect(() => parseQualityCheckOutputManifest(output)).toThrow('must be >= 0');
  });

  it('rejects non-integer audioStreamCount', () => {
    const output = {
      ...makeValidOutput(),
      probe: { ...makeValidOutput().probe, audioStreamCount: 1.5 },
    };
    expect(() => parseQualityCheckOutputManifest(output)).toThrow('must be an integer');
  });

  it('rejects non-boolean hasAudio', () => {
    const output = {
      ...makeValidOutput(),
      probe: { ...makeValidOutput().probe, hasAudio: 'yes' },
    };
    expect(() => parseQualityCheckOutputManifest(output)).toThrow('must be a boolean');
  });

  it('rejects resultManifestRef with wrong mimeType', () => {
    const output = {
      ...makeValidOutput(),
      resultManifestRef: { ...makeValidOutput().resultManifestRef, mimeType: 'text/plain' },
    };
    expect(() => parseQualityCheckOutputManifest(output)).toThrow('mimeType must be application/json');
  });

  it('rejects invalid processorVersion', () => {
    const output = { ...makeValidOutput(), processorVersion: 'not-semver' };
    expect(() => parseQualityCheckOutputManifest(output)).toThrow('must be semver');
  });

  it('rejects negative sizeBytes in sourceAsset', () => {
    const output = {
      ...makeValidOutput(),
      sourceAsset: { ...makeValidOutput().sourceAsset, sizeBytes: -1 },
    };
    expect(() => parseQualityCheckOutputManifest(output)).toThrow('must be >= 0');
  });

  it('rejects missing probe fields', () => {
    const output = { ...makeValidOutput() };
    delete (output as Record<string, unknown>).probe;
    expect(() => parseQualityCheckOutputManifest(output)).toThrow(
      'probe must be a plain object',
    );
  });

  it('accepts valid audio output manifest', () => {
    const audioOutput: QualityCheckOutputManifest = {
      schemaVersion: 1,
      jobType: 'media_quality_check',
      sessionId: 'ses-audio-1',
      sourceId: 'src-audio-01',
      sourceKind: 'audio',
      sourceAsset: {
        objectKey: 'skill-sessions/42/source/aaaaaaaa-bbbb-4ccc-8ddd-eeeeffff0000.mp3',
        mimeType: 'audio/mpeg',
        sizeBytes: 512000,
        sha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      },
      probe: {
        durationMs: 12000,
        formatName: 'mp3',
        hasAudio: true,
        hasVideo: false,
        audioStreamCount: 1,
        videoStreamCount: 0,
        primaryAudioStreamIndex: 0,
        primaryVideoStreamIndex: null,
      },
      resultManifestRef: {
        objectKey: 'skill-sessions/42/manifest/11111111-1111-4111-8111-111111111111.json',
        mimeType: 'application/json',
        sizeBytes: 300,
        sha256: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      },
      processorVersion: '0.1.0',
      degradations: [],
    };
    const result = parseQualityCheckOutputManifest(audioOutput);
    expect(result.sourceKind).toBe('audio');
    expect(result.probe.hasAudio).toBe(true);
    expect(result.probe.hasVideo).toBe(false);
    expect(result.probe.primaryVideoStreamIndex).toBeNull();
  });

  it('accepts video with no audio track degradation', () => {
    const visualOutput: QualityCheckOutputManifest = {
      ...makeValidOutput(),
      probe: {
        durationMs: 15000,
        formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
        hasAudio: false,
        hasVideo: true,
        audioStreamCount: 0,
        videoStreamCount: 1,
        primaryAudioStreamIndex: null,
        primaryVideoStreamIndex: 0,
      },
      degradations: [{ code: 'visual_only/no_audio_track', message: 'No audio stream detected' }],
    };
    const result = parseQualityCheckOutputManifest(visualOutput);
    expect(result.probe.hasAudio).toBe(false);
    expect(result.probe.primaryAudioStreamIndex).toBeNull();
    expect(result.degradations).toHaveLength(1);
    expect(result.degradations[0].code).toBe('visual_only/no_audio_track');
  });

  it('rejects audio output without an audio stream', () => {
    const output: QualityCheckOutputManifest = {
      ...makeValidOutput(),
      sourceKind: 'audio',
      probe: {
        ...makeValidOutput().probe,
        hasAudio: false,
        audioStreamCount: 0,
        primaryAudioStreamIndex: null,
        hasVideo: false,
        videoStreamCount: 0,
        primaryVideoStreamIndex: null,
      },
    };

    expect(() => parseQualityCheckOutputManifest(output)).toThrow(
      'audio outputs must include at least one audio stream',
    );
  });

  it('rejects audio output that still reports a video stream', () => {
    const output: QualityCheckOutputManifest = {
      ...makeValidOutput(),
      sourceKind: 'audio',
      probe: {
        ...makeValidOutput().probe,
        hasAudio: true,
        audioStreamCount: 1,
        primaryAudioStreamIndex: 0,
        hasVideo: true,
        videoStreamCount: 1,
        primaryVideoStreamIndex: 1,
      },
    };

    expect(() => parseQualityCheckOutputManifest(output)).toThrow(
      'audio outputs must not report ordinary video streams',
    );
  });

  it('rejects video output without a video stream', () => {
    const output: QualityCheckOutputManifest = {
      ...makeValidOutput(),
      sourceKind: 'video',
      probe: {
        ...makeValidOutput().probe,
        hasVideo: false,
        videoStreamCount: 0,
        primaryVideoStreamIndex: null,
      },
    };

    expect(() => parseQualityCheckOutputManifest(output)).toThrow(
      'video outputs must include at least one video stream',
    );
  });

  it('rejects probe counts and primary indexes that disagree', () => {
    const output: QualityCheckOutputManifest = {
      ...makeValidOutput(),
      probe: {
        ...makeValidOutput().probe,
        audioStreamCount: 0,
        primaryAudioStreamIndex: 0,
      },
    };

    expect(() => parseQualityCheckOutputManifest(output)).toThrow(
      'probe.primaryAudioStreamIndex must be null when probe.audioStreamCount is 0',
    );
  });

  it('rejects missing primary indexes when stream counts are non-zero', () => {
    const output: QualityCheckOutputManifest = {
      ...makeValidOutput(),
      probe: {
        ...makeValidOutput().probe,
        videoStreamCount: 1,
        primaryVideoStreamIndex: null,
      },
    };

    expect(() => parseQualityCheckOutputManifest(output)).toThrow(
      'probe.primaryVideoStreamIndex must be set when probe.videoStreamCount is greater than 0',
    );
  });

  it('rejects equal primary audio and video stream indexes when both are set', () => {
    const output: QualityCheckOutputManifest = {
      ...makeValidOutput(),
      probe: {
        ...makeValidOutput().probe,
        primaryAudioStreamIndex: 2,
        primaryVideoStreamIndex: 2,
      },
    };

    expect(() => parseQualityCheckOutputManifest(output)).toThrow(
      'probe.primaryAudioStreamIndex and probe.primaryVideoStreamIndex must differ when both are set',
    );
  });
});

describe('computeQualityCheckResultHash', () => {
  it('matches shared canonical JSON golden vectors for unicode UTF-8 content', () => {
    const vectors = JSON.parse(
      readFileSync(
        path.resolve(
          __dirname,
          '../../../python/media_worker/tests/fixtures/canonical-json-vectors.json',
        ),
        'utf-8',
      ),
    ) as Array<{
      name: string;
      input: unknown;
      canonical: string;
      sha256: string;
    }>;

    for (const vector of vectors) {
      const canonical = canonicalizeGenericJson(vector.input);
      expect(canonical, vector.name).toBe(vector.canonical);
      expect(
        createHash('sha256').update(canonical, 'utf8').digest('hex'),
        vector.name,
      ).toBe(vector.sha256);
    }
  });

  it('produces deterministic 64-char hex hash', () => {
    const output = makeValidOutput();
    const hash = computeQualityCheckResultHash(output);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('same manifest produces same hash', () => {
    const a = computeQualityCheckResultHash(makeValidOutput());
    const b = computeQualityCheckResultHash(makeValidOutput());
    expect(a).toBe(b);
  });

  it('different sourceAsset.sha256 produces different hash', () => {
    const output1 = makeValidOutput();
    const output2: QualityCheckOutputManifest = {
      schemaVersion: 1,
      jobType: 'media_quality_check',
      sessionId: 'ses-abc-123',
      sourceId: 'src-test-001',
      sourceKind: 'video',
      sourceAsset: {
        objectKey: 'skill-sessions/42/source/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 1024000,
        sha256: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      },
      probe: {
        durationMs: 30000,
        formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
        hasAudio: true,
        hasVideo: true,
        audioStreamCount: 1,
        videoStreamCount: 1,
        primaryAudioStreamIndex: 0,
        primaryVideoStreamIndex: 1,
      },
      resultManifestRef: {
        objectKey: 'skill-sessions/42/manifest/00000000-0000-4000-8000-000000000001.json',
        mimeType: 'application/json',
        sizeBytes: 512,
        sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
      processorVersion: '0.1.0',
      degradations: [],
    };
    expect(computeQualityCheckResultHash(output1)).not.toBe(computeQualityCheckResultHash(output2));
  });

  it('hash is based on canonical sorted JSON keys', () => {
    const output = makeValidOutput();
    const canonical = computeQualityCheckResultHash(output);
    const raw = computeQualityCheckResultHash(output);
    expect(canonical).toBe(raw);
  });

  it('canonical output JSON preserves UTF-8 unicode rather than ASCII-escaping it', () => {
    const output: QualityCheckOutputManifest = {
      ...makeValidOutput(),
      degradations: [{ code: 'VISUAL_ONLY', message: '无音轨 🎓' }],
    };

    const canonical = canonicalQualityCheckOutputJson(output);

    expect(canonical).toContain('无音轨 🎓');
    expect(canonical).not.toContain('\\u65e0');
  });
});
