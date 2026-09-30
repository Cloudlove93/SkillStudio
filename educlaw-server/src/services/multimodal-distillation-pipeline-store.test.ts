import { describe, expect, it, vi } from 'vitest';
import { createMultimodalDistillationPipelineStore } from './multimodal-distillation-pipeline-store.js';

describe('multimodal distillation pipeline store', () => {
  it('rejects a persisted media job with an unknown status', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: '701',
          job_type: 'media_prepare',
          status: 'corrupt-status',
          attempt_no: 1,
          input_manifest_json: {},
          output_manifest_json: null,
        },
      ],
    });
    const store = createMultimodalDistillationPipelineStore({
      query,
      withTransaction: vi.fn(),
    });

    await expect(
      store.loadLatestJob({
        sessionId: '101',
        jobType: 'media_prepare',
      }),
    ).rejects.toMatchObject({
      code: 'MULTIMODAL_PIPELINE_FAILED',
      statusCode: 500,
    });
  });
});
