import { beforeEach, describe, expect, it, vi } from 'vitest';

const createProductionMultimodalModelAdapters = vi.fn(() => ({
  adler: Symbol('adler'),
}));
const createMultimodalSessionService = vi.fn((adapters) => ({
  kind: 'session-service',
  adapters,
}));
const createMultimodalPipelineStore = vi.fn(() => ({
  kind: 'store',
}));
const createMultimodalPipelineOrchestrator = vi.fn((input) => ({
  kind: 'orchestrator',
  input,
}));
const createMultimodalPipelineRunner = vi.fn((input) => ({
  kind: 'runner',
  start: vi.fn(),
  stop: vi.fn(),
  input,
}));

vi.mock('./multimodal-model-adapters.js', () => ({
  createProductionMultimodalModelAdapters,
}));
vi.mock('./multimodal-session-service.js', () => ({
  createMultimodalSessionService,
}));
vi.mock('./multimodal-pipeline-store.js', () => ({
  createMultimodalPipelineStore,
}));
vi.mock('./multimodal-pipeline-orchestrator.js', () => ({
  createMultimodalPipelineOrchestrator,
}));
vi.mock('./multimodal-pipeline-runner.js', () => ({
  createMultimodalPipelineRunner,
}));

describe('multimodal pipeline runtime composition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('wires production model adapters into the session service, orchestrator, and runner', async () => {
    const { createProductionMultimodalPipelineRuntime } = await import(
      './multimodal-pipeline-runtime'
    );

    const runtime = createProductionMultimodalPipelineRuntime({
      pollIntervalMs: 12_000,
      batchLimit: 4,
      concurrency: 2,
    });

    expect(createProductionMultimodalModelAdapters).toHaveBeenCalledTimes(1);
    expect(createMultimodalSessionService).toHaveBeenCalledWith(
      createProductionMultimodalModelAdapters.mock.results[0]?.value,
    );
    expect(createMultimodalPipelineOrchestrator).toHaveBeenCalledWith({
      sessionService: createMultimodalSessionService.mock.results[0]?.value,
      store: createMultimodalPipelineStore.mock.results[0]?.value,
    });
    expect(createMultimodalPipelineRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        pollIntervalMs: 12_000,
        batchLimit: 4,
        concurrency: 2,
        orchestrator: expect.objectContaining({
          ...createMultimodalPipelineOrchestrator.mock.results[0]?.value,
          runDistillationPipeline: expect.any(Function),
        }),
        store: createMultimodalPipelineStore.mock.results[0]?.value,
      }),
    );
    expect(runtime.runner.kind).toBe('runner');
    expect(runtime.sessionService.kind).toBe('session-service');
  });

  it('does not construct or start the runtime when disabled, and starts exactly once when enabled', async () => {
    const { startProductionMultimodalPipelineRuntimeIfEnabled } = await import(
      './multimodal-pipeline-runtime'
    );
    const start = vi.fn();
    const createRuntime = vi.fn(() => ({
      runner: { start },
    }));

    const disabled = startProductionMultimodalPipelineRuntimeIfEnabled({
      enabled: false,
      pollIntervalMs: 12_000,
      batchLimit: 4,
      concurrency: 2,
      createRuntime: createRuntime as never,
    });
    expect(disabled).toBeNull();
    expect(createRuntime).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();

    const enabled = startProductionMultimodalPipelineRuntimeIfEnabled({
      enabled: true,
      pollIntervalMs: 12_000,
      batchLimit: 4,
      concurrency: 2,
      createRuntime: createRuntime as never,
    });
    expect(createRuntime).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
    expect(enabled).not.toBeNull();
  });
});
