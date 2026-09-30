import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import {
  createProductionMediaEvidenceService,
  createProductionVisionRankingAdapter,
  createVerifiedInlineFrameReader,
} from './media-evidence-runtime.js';

describe('production media evidence runtime', () => {
  it('chunks long transcripts before semantic model calls and merges time-bound results', async () => {
    const generateJson = vi.fn().mockImplementation(async (request: { userPrompt: string }) => {
      const payload = JSON.parse(request.userPrompt) as {
        analysisWindow: { startMs: number; endMs: number };
      };
      const { startMs, endMs } = payload.analysisWindow;
      return {
        moments: [
          {
            startMs,
            endMs,
            importance: 0.8,
            type: 'concept',
            summary: `窗口 ${startMs}-${endMs}`,
            visualTarget: null,
            audioEvidence: null,
            transcriptEvidence: null,
            selectionReason: '分段语义识别',
          },
        ],
      };
    });
    const service = createProductionMediaEvidenceService({
      generateJson,
      semanticModel: 'semantic-model',
      semanticChunkCharBudget: 180,
    });

    const result = await service.generateSemanticMoments({
      primarySource: {
        sourceId: 'audio-source-1',
        kind: 'audio',
        assetRef: {
          objectKey: 'skill-sessions/1/source/audio.wav',
          mimeType: 'audio/wav',
          sizeBytes: 1024,
          sha256: 'a'.repeat(64),
        },
      },
      durationMs: 20_000,
      transcript: {
        status: 'ready',
        editable: true,
        segments: [
          { startMs: 0, endMs: 10_000, text: '甲'.repeat(100), confidence: 0.9 },
          { startMs: 10_000, endMs: 20_000, text: '乙'.repeat(100), confidence: 0.9 },
        ],
      },
    });

    expect(generateJson).toHaveBeenCalledTimes(2);
    expect(result.moments.map(({ startMs, endMs }) => ({ startMs, endMs }))).toEqual([
      { startMs: 0, endMs: 10_000 },
      { startMs: 10_000, endMs: 20_000 },
    ]);
    for (const call of generateJson.mock.calls) {
      expect(call[1]).toBe(0);
      const request = call[0] as { userPrompt: string };
      const payload = JSON.parse(request.userPrompt) as { transcript: unknown[] };
      expect(payload.transcript).toHaveLength(1);
    }
  });

  it('signs frame reads only at model-call time and returns no signed URL', async () => {
    const createSignedGetGrant = vi
      .fn()
      .mockImplementation(async ({ objectKey }: { objectKey: string }) => ({
        method: 'GET' as const,
        objectKey,
        url: `https://storage.example.test/${objectKey}?signature=ephemeral`,
        expiresAt: '2026-08-23T10:05:00.000Z',
        requiredHeaders: {},
      }));
    const generateMultimodalJson = vi.fn().mockResolvedValue({
      rankings: [
        {
          candidateId: 'frame-001',
          score: 0.93,
          reason: '完整呈现定义与板书关系',
        },
      ],
    });
    const adapter = createProductionVisionRankingAdapter({
      createSignedGetGrant,
      generateMultimodalJson,
      visionModel: 'kimi-k2.5',
      maxTokens: 1024,
    });

    const result = await adapter.rankVisualCandidates({
      semanticMoment: {
        semanticMomentId: 'moment-001',
        startMs: 0,
        endMs: 10_000,
        importance: 0.9,
        type: 'demonstration',
        summary: '定义并演示步骤',
        visualTarget: '选择能看清完整板书关系的画面',
        audioEvidence: null,
        transcriptEvidence: null,
        selectionReason: '核心教学步骤',
      },
      candidates: [
        {
          candidateId: 'frame-001',
          timestampMs: 5000,
          assetRef: {
            objectKey:
              'skill-sessions/101/jobs/703/attempt-1/frames/frame-001.png',
            mimeType: 'image/png',
            sizeBytes: 2048,
            sha256: 'a'.repeat(64),
          },
          selectionReason: 'slow board change',
          qualityMetrics: {
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
            duplicateHash: {
              algorithm: 'dhash_64',
              value: '0123456789abcdef',
            },
          },
        },
      ],
    });

    expect(createSignedGetGrant).toHaveBeenCalledWith({
      objectKey:
        'skill-sessions/101/jobs/703/attempt-1/frames/frame-001.png',
    });
    expect(generateMultimodalJson).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'kimi-k2.5',
        maxTokens: 1024,
        images: [
          {
            imageUrl:
              'https://storage.example.test/skill-sessions/101/jobs/703/attempt-1/frames/frame-001.png?signature=ephemeral',
            detail: 'high',
          },
        ],
      }),
    );
    expect(result).toEqual({
      rankings: [
        {
          candidateId: 'frame-001',
          score: 0.93,
          reason: '完整呈现定义与板书关系',
        },
      ],
      model: 'kimi-k2.5',
    });
    expect(JSON.stringify(result)).not.toContain('signature=ephemeral');
  });

  it('prefers verified inline frame reads so private object storage remains model-readable', async () => {
    const dataUrl = `data:image/png;base64,${Buffer.from('private-frame').toString('base64')}`;
    const readFrameDataUrl = vi.fn().mockResolvedValue(dataUrl);
    const createSignedGetGrant = vi.fn();
    const generateMultimodalJson = vi.fn().mockResolvedValue({
      rankings: [
        {
          candidateId: 'frame-001',
          score: 0.96,
          reason: '画面展示函数定义',
        },
      ],
    });
    const adapter = createProductionVisionRankingAdapter({
      readFrameDataUrl,
      createSignedGetGrant,
      generateMultimodalJson,
      visionModel: 'kimi-k2.5',
      maxTokens: 1024,
    });
    const assetRef = {
      objectKey: 'skill-sessions/101/jobs/703/attempt-1/frames/frame-001.png',
      mimeType: 'image/png',
      sizeBytes: 2048,
      sha256: 'a'.repeat(64),
    };

    const result = await adapter.rankVisualCandidates({
      semanticMoment: {
        semanticMomentId: 'moment-001',
        startMs: 0,
        endMs: 10_000,
        importance: 0.9,
        type: 'concept',
        summary: '函数定义',
        visualTarget: '函数定义板书',
        audioEvidence: null,
        transcriptEvidence: null,
        selectionReason: '核心概念',
      },
      candidates: [
        {
          candidateId: 'frame-001',
          timestampMs: 5000,
          assetRef,
          selectionReason: 'semantic moment',
          qualityMetrics: {
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
            duplicateHash: {
              algorithm: 'dhash_64',
              value: '0123456789abcdef',
            },
          },
        },
      ],
    });

    expect(readFrameDataUrl).toHaveBeenCalledWith(assetRef);
    expect(createSignedGetGrant).not.toHaveBeenCalled();
    expect(generateMultimodalJson).toHaveBeenCalledWith(
      expect.objectContaining({
        images: [{ imageUrl: dataUrl, detail: 'high' }],
      }),
    );
    expect(result).toEqual({
      rankings: [
        {
          candidateId: 'frame-001',
          score: 0.96,
          reason: '画面展示函数定义',
        },
      ],
      model: 'kimi-k2.5',
    });
  });

  it('verifies private frame size, MIME, and SHA-256 before creating an inline image', async () => {
    const bytes = Buffer.from('verified-private-frame');
    const assetRef = {
      objectKey: 'skill-sessions/101/jobs/703/attempt-1/frames/frame-001.png',
      mimeType: 'image/png',
      sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
    const openReadStream = vi.fn().mockResolvedValue({
      object: {
        objectKey: assetRef.objectKey,
        sizeBytes: bytes.length,
        contentType: 'image/png',
        metadataMimeType: 'image/png',
        metadataSha256: null,
      },
      body: Readable.from(bytes),
    });
    const readFrameDataUrl = createVerifiedInlineFrameReader(openReadStream);

    await expect(readFrameDataUrl(assetRef)).resolves.toBe(
      `data:image/png;base64,${bytes.toString('base64')}`,
    );

    const corruptReader = createVerifiedInlineFrameReader(
      vi.fn().mockResolvedValue({
        object: {
          objectKey: assetRef.objectKey,
          sizeBytes: bytes.length,
          contentType: 'image/png',
          metadataMimeType: 'image/png',
          metadataSha256: null,
        },
        body: Readable.from(Buffer.from('x'.repeat(bytes.length))),
      }),
    );
    await expect(corruptReader(assetRef)).rejects.toThrow(
      'FRAME_INLINE_ASSET_INTEGRITY_INVALID',
    );
  });
});
