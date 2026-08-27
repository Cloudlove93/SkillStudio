import { createHash } from 'node:crypto';
import type {
  MultimodalAssetRef,
  MultimodalTranscript,
  SemanticMomentDraft,
} from '@educlaw/shared';
import { config } from '../config.js';
import { readObjectStorageConfig } from '../config/object-storage-config.js';
import {
  generateJson,
  generateMultimodalJson,
  resolveEnhancedModel,
} from './llm-service.js';
import {
  MediaEvidenceService,
  type TranscriptCorrectionRequestSegment,
  type VisionRankingAdapter,
} from './media-evidence.service.js';
import {
  createObjectStorageService,
  type ObjectStorageGrant,
} from './object-storage/object-storage.service.js';

type GenerateJson = typeof generateJson;
type GenerateMultimodalJson = typeof generateMultimodalJson;
type CreateSignedGetGrant = (input: {
  objectKey: string;
}) => Promise<ObjectStorageGrant>;
type ReadFrameDataUrl = (assetRef: MultimodalAssetRef) => Promise<string>;
type OpenReadStream = ReturnType<typeof createObjectStorageService>['openReadStream'];

const PROMPT_VERSION = 'semantic-moments-v3-chunked-zh';
const DEFAULT_SEMANTIC_CHUNK_CHAR_BUDGET = 48_000;
const MAX_INLINE_FRAME_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = [
  'concept',
  'step',
  'worked_example',
  'counterexample',
  'demonstration',
  'limitation',
  'summary',
] as const;

export function createVerifiedInlineFrameReader(
  openReadStream: OpenReadStream,
): ReadFrameDataUrl {
  return async (assetRef) => {
    if (assetRef.mimeType !== 'image/png' || assetRef.sizeBytes > MAX_INLINE_FRAME_BYTES) {
      throw new Error('FRAME_INLINE_ASSET_INVALID');
    }
    const opened = await openReadStream({ objectKey: assetRef.objectKey });
    const storedMimeType = opened.object.metadataMimeType ?? opened.object.contentType;
    if (
      opened.object.objectKey !== assetRef.objectKey ||
      opened.object.sizeBytes !== assetRef.sizeBytes ||
      storedMimeType !== assetRef.mimeType
    ) {
      opened.body.destroy();
      throw new Error('FRAME_INLINE_ASSET_BINDING_INVALID');
    }
    const chunks: Buffer[] = [];
    const digest = createHash('sha256');
    let totalBytes = 0;
    for await (const chunk of opened.body) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;
      if (totalBytes > assetRef.sizeBytes || totalBytes > MAX_INLINE_FRAME_BYTES) {
        opened.body.destroy();
        throw new Error('FRAME_INLINE_ASSET_SIZE_INVALID');
      }
      digest.update(buffer);
      chunks.push(buffer);
    }
    if (totalBytes !== assetRef.sizeBytes || digest.digest('hex') !== assetRef.sha256) {
      throw new Error('FRAME_INLINE_ASSET_INTEGRITY_INVALID');
    }
    return `data:${assetRef.mimeType};base64,${Buffer.concat(chunks).toString('base64')}`;
  };
}

function fallbackMoments(durationMs: number): SemanticMomentDraft[] {
  const count = Math.max(1, Math.min(8, Math.ceil(durationMs / 300_000)));
  return Array.from({ length: count }, (_, index) => {
    const startMs = Math.floor((durationMs * index) / count);
    const endMs = Math.max(startMs + 1, Math.floor((durationMs * (index + 1)) / count));
    return {
      startMs,
      endMs: Math.min(durationMs, endMs),
      importance: 0.5,
      type: index === count - 1 ? 'summary' : 'demonstration',
      summary: `视觉教学片段 ${index + 1}`,
      visualTarget: '识别画面中的板书、幻灯片、图表或演示步骤',
      audioEvidence: null,
      transcriptEvidence: null,
      selectionReason: '无可用转录时按时长建立宽召回视觉窗口',
    };
  });
}

type TranscriptPromptSegment = {
  startMs: number;
  endMs: number;
  text: string;
  confidence: number | null;
};

function transcriptPrompt(transcript: MultimodalTranscript): TranscriptPromptSegment[] {
  return transcript.segments.slice(0, 10_000).map((segment) => ({
    startMs: segment.startMs,
    endMs: segment.endMs,
    text: segment.text,
    confidence: segment.confidence ?? null,
  }));
}

function chunkTranscriptPrompt(
  transcript: MultimodalTranscript,
  charBudget: number,
): TranscriptPromptSegment[][] {
  const segments = transcriptPrompt(transcript);
  const chunks: TranscriptPromptSegment[][] = [];
  let current: TranscriptPromptSegment[] = [];
  let currentChars = 0;
  for (const segment of segments) {
    const segmentChars = JSON.stringify(segment).length;
    if (current.length > 0 && currentChars + segmentChars > charBudget) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(segment);
    currentChars += segmentChars;
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}

function chunkCorrectionSegments(
  segments: TranscriptCorrectionRequestSegment[],
  charBudget: number,
): TranscriptCorrectionRequestSegment[][] {
  const chunks: TranscriptCorrectionRequestSegment[][] = [];
  let current: TranscriptCorrectionRequestSegment[] = [];
  let currentChars = 0;
  for (const segment of segments) {
    const segmentChars = JSON.stringify(segment).length;
    if (current.length > 0 && currentChars + segmentChars > charBudget) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(segment);
    currentChars += segmentChars;
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}

function validateChunkMoments(
  moments: unknown,
  window: { startMs: number; endMs: number },
): asserts moments is SemanticMomentDraft[] {
  if (!Array.isArray(moments) || moments.length < 1) {
    throw new Error('SEMANTIC_CHUNK_RESULT_INVALID');
  }
  for (const moment of moments) {
    if (
      typeof moment !== 'object' ||
      moment === null ||
      typeof (moment as { startMs?: unknown }).startMs !== 'number' ||
      typeof (moment as { endMs?: unknown }).endMs !== 'number' ||
      (moment as { startMs: number }).startMs < window.startMs ||
      (moment as { endMs: number }).endMs > window.endMs
    ) {
      throw new Error('SEMANTIC_CHUNK_RESULT_OUT_OF_WINDOW');
    }
  }
}

export function createProductionVisionRankingAdapter(options: {
  createSignedGetGrant?: CreateSignedGetGrant;
  readFrameDataUrl?: ReadFrameDataUrl;
  generateMultimodalJson: GenerateMultimodalJson;
  visionModel: string;
  maxTokens: number;
}): VisionRankingAdapter {
  if (!options.readFrameDataUrl && !options.createSignedGetGrant) {
    throw new Error('VISION_FRAME_READER_REQUIRED');
  }
  return {
    async rankVisualCandidates(input) {
      const imageUrls = options.readFrameDataUrl
        ? await Promise.all(
            input.candidates.map((candidate) =>
              options.readFrameDataUrl!(candidate.assetRef),
            ),
          )
        : await Promise.all(
            input.candidates.map(async (candidate) => {
              const grant = await options.createSignedGetGrant!({
                objectKey: candidate.assetRef.objectKey,
              });
              if (
                grant.method !== 'GET' ||
                grant.objectKey !== candidate.assetRef.objectKey
              ) {
                throw new Error('FRAME_READ_GRANT_BINDING_INVALID');
              }
              return grant.url;
            }),
          );
      const response = await options.generateMultimodalJson<{
        rankings: Array<{
          candidateId: string;
          score: number;
          reason: string;
        }>;
      }>({
        systemPrompt: [
          '你是教学视频关键帧重排器。只输出 JSON。',
          '结合语义目标与每张候选画面，判断其是否完整、清晰地呈现板书、幻灯片、图表、实验或演示步骤。',
          '不要仅按画质评分；优先选择能支撑教学结论、内容完整且非中间过渡态的画面。',
          '严格返回 {"rankings":[{"candidateId":string,"score":0到1,"reason":string}]}。',
          'candidateId 必须来自输入；最多返回两张，不得重复。',
        ].join('\n'),
        userPrompt: JSON.stringify({
          semanticMoment: {
            semanticMomentId: input.semanticMoment.semanticMomentId,
            startMs: input.semanticMoment.startMs,
            endMs: input.semanticMoment.endMs,
            summary: input.semanticMoment.summary,
            visualTarget: input.semanticMoment.visualTarget,
            selectionReason: input.semanticMoment.selectionReason,
          },
          candidates: input.candidates.map((candidate, index) => ({
            imageIndex: index,
            candidateId: candidate.candidateId,
            timestampMs: candidate.timestampMs,
            selectionReason: candidate.selectionReason,
            qualityMetrics: candidate.qualityMetrics,
          })),
        }),
        images: imageUrls.map((imageUrl) => ({
          imageUrl,
          detail: 'high',
        })),
        model: options.visionModel,
        maxTokens: options.maxTokens,
      });
      return {
        rankings: response.rankings,
        model: options.visionModel,
      };
    },
  };
}

export function createProductionMediaEvidenceService(options?: {
  generateJson?: GenerateJson;
  generateMultimodalJson?: GenerateMultimodalJson;
  createSignedGetGrant?: CreateSignedGetGrant;
  readFrameDataUrl?: ReadFrameDataUrl;
  semanticModel?: string;
  visionModel?: string;
  semanticChunkCharBudget?: number;
}) {
  const generate = options?.generateJson ?? generateJson;
  const model = resolveEnhancedModel(
    options?.semanticModel || config.multimodalAdlerModel,
  );
  const visionModel = options?.visionModel ?? config.multimodalVisionModel;
  const semanticChunkCharBudget =
    options?.semanticChunkCharBudget ?? DEFAULT_SEMANTIC_CHUNK_CHAR_BUDGET;
  if (
    !Number.isSafeInteger(semanticChunkCharBudget) ||
    semanticChunkCharBudget < 128 ||
    semanticChunkCharBudget > 1_000_000
  ) {
    throw new Error('semanticChunkCharBudget must be an integer between 128 and 1000000');
  }
  let readFrameDataUrl = options?.readFrameDataUrl;
  const createSignedGetGrant = options?.createSignedGetGrant;
  if (!readFrameDataUrl && !createSignedGetGrant && visionModel) {
    const storageConfig = readObjectStorageConfig();
    if (storageConfig) {
      const storage = createObjectStorageService({ config: storageConfig });
      readFrameDataUrl = createVerifiedInlineFrameReader(storage.openReadStream);
    }
  }
  const visionRankingAdapter =
    visionModel && (readFrameDataUrl || createSignedGetGrant)
      ? createProductionVisionRankingAdapter({
          readFrameDataUrl,
          createSignedGetGrant,
          generateMultimodalJson:
            options?.generateMultimodalJson ?? generateMultimodalJson,
          visionModel,
          maxTokens: config.multimodalModelMaxTokens,
        })
      : null;

  return new MediaEvidenceService({
    transcriptCorrectionModelAdapter: {
      async generateTranscriptCorrections(input) {
        const corrections: Array<{ index: number; text: string }> = [];
        for (const chunk of chunkCorrectionSegments(
          input.correctable,
          semanticChunkCharBudget,
        )) {
          const response = await generate<{
            corrections: Array<{ index: number; text: string }>;
          }>(
            {
              systemPrompt: [
                '你是中文课堂 ASR 转录校对员。只输出 JSON。',
                '输入的 segments 来自语音识别，可能包含同音字、近音字与术语误识（例如「函数」误识为「韩树」、「映射」误识为「影射」、「值域」误识为「直域」、「自变量」误识为「字面量」）。',
                '请结合课堂教学语境，仅修正明确的识别错误：错别字、同音字、术语误识与明显标点问题。',
                '不要改写句式，不要增删语义内容，不要翻译，保持教师口语原貌。',
                '只返回需要修正的片段；index 必须来自输入且不得改动，text 为该片段修正后的完整文本。',
                '严格返回 {"corrections":[{"index":number,"text":string}]}；无需修正时返回 {"corrections":[]}。',
              ].join('\n'),
              userPrompt: JSON.stringify({
                segments: chunk.map((segment) => ({
                  index: segment.index,
                  startMs: segment.startMs,
                  endMs: segment.endMs,
                  text: segment.text,
                  confidence: segment.confidence,
                })),
              }),
              model,
              temperature: 0,
              maxTokens: config.multimodalModelMaxTokens,
              hidePromptContentInLogs: true,
            },
            0,
            true,
          );
          if (!Array.isArray(response.corrections)) {
            throw new Error('TRANSCRIPT_CORRECTION_CHUNK_RESULT_INVALID');
          }
          corrections.push(...response.corrections);
        }
        return { corrections };
      },
    },
    semanticMomentModelAdapter: {
      async generateSemanticMoments(input) {
        if (input.transcript.segments.length === 0) {
          return {
            moments: fallbackMoments(input.durationMs),
            model: null,
            promptVersion: 'visual-wide-recall-v1',
          };
        }
        const chunks = chunkTranscriptPrompt(
          input.transcript,
          semanticChunkCharBudget,
        );
        const moments: SemanticMomentDraft[] = [];
        for (const transcript of chunks) {
          const analysisWindow = {
            startMs: transcript[0]!.startMs,
            endMs: transcript[transcript.length - 1]!.endMs,
          };
          const response = await generate<{ moments: SemanticMomentDraft[] }>(
            {
              systemPrompt: [
                '你是教学视频的语义时刻识别器。只输出 JSON。',
                `type 只能是：${ALLOWED_TYPES.join(', ')}。`,
                'moments 必须按时间递增、互不重叠；每项严格包含 startMs,endMs,importance,type,summary,visualTarget,audioEvidence,transcriptEvidence,selectionReason。',
                '每个 moment 必须完全位于 analysisWindow 内，不得引用窗口外时间。',
                'audioEvidence 与 transcriptEvidence 可为 null；若不为 null，严格包含 timeRange:{startMs,endMs},text,confidence。',
                '优先识别定义、步骤、例题、演示、反例、限制和总结，避免按固定时长机械切段。',
                'summary、visualTarget、selectionReason 必须使用简体中文撰写。',
                '转录文本来自语音识别（ASR），可能包含同音字与术语误识（例如「函数」误识为「韩树」、「映射」误识为「影射」）。summary 与 visualTarget 必须使用结合教学语境推断出的正确中文术语，不要照抄 ASR 错别字。',
                'audioEvidence.text 与 transcriptEvidence.text 引用转录时同样使用纠正后的规范术语。',
              ].join('\n'),
              userPrompt: JSON.stringify({
                durationMs: input.durationMs,
                sourceKind: input.primarySource.kind,
                analysisWindow,
                transcript,
              }),
              model,
              temperature: 0,
              maxTokens: config.multimodalModelMaxTokens,
              hidePromptContentInLogs: true,
            },
            0,
            true,
          );
          validateChunkMoments(response.moments, analysisWindow);
          moments.push(...response.moments);
        }
        return {
          moments,
          model,
          promptVersion: PROMPT_VERSION,
        };
      },
    },
    visionRankingAdapter,
  });
}
