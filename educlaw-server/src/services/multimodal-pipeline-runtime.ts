import { getLogger } from '../lib/request-context.js';
import { createProductionMultimodalModelAdapters } from './multimodal-model-adapters.js';
import { createMultimodalPipelineOrchestrator } from './multimodal-pipeline-orchestrator.js';
import { createMultimodalDistillationPipelineOrchestrator } from './multimodal-distillation-pipeline-orchestrator.js';
import { createMultimodalDistillationPipelineStore } from './multimodal-distillation-pipeline-store.js';
import { createProductionMediaEvidenceService } from './media-evidence-runtime.js';
import { createMultimodalPipelineRunner } from './multimodal-pipeline-runner.js';
import { createMultimodalPipelineStore } from './multimodal-pipeline-store.js';
import { createMultimodalSessionService } from './multimodal-session-service.js';

interface ProductionMultimodalPipelineRuntimeOptions {
  pollIntervalMs: number;
  batchLimit: number;
  concurrency: number;
}

interface StartProductionMultimodalPipelineRuntimeIfEnabledOptions
  extends ProductionMultimodalPipelineRuntimeOptions {
  enabled: boolean;
  createRuntime?: (
    options: ProductionMultimodalPipelineRuntimeOptions,
  ) => ReturnType<typeof createProductionMultimodalPipelineRuntime>;
}

export function createProductionMultimodalPipelineRuntime(
  options: ProductionMultimodalPipelineRuntimeOptions,
) {
  const adapters = createProductionMultimodalModelAdapters();
  const sessionService = createMultimodalSessionService(adapters);
  const store = createMultimodalPipelineStore();
  const orchestrator = createMultimodalPipelineOrchestrator({
    sessionService,
    store,
  });
  const mediaEvidenceService = createProductionMediaEvidenceService();
  const distillationStore = createMultimodalDistillationPipelineStore({
    pipelineStore: store,
  });
  const distillationOrchestrator =
    createMultimodalDistillationPipelineOrchestrator({
      store: distillationStore,
      mediaEvidenceService,
      sessionService,
    });
  const runner = createMultimodalPipelineRunner({
    store,
    orchestrator: {
      ...orchestrator,
      ...distillationOrchestrator,
    },
    logger: getLogger({ component: 'multimodal-pipeline-runner' }),
    pollIntervalMs: options.pollIntervalMs,
    batchLimit: options.batchLimit,
    concurrency: options.concurrency,
  });

  return {
    adapters,
    sessionService,
    store,
    orchestrator,
    distillationOrchestrator,
    distillationStore,
    mediaEvidenceService,
    runner,
  };
}

export function startProductionMultimodalPipelineRuntimeIfEnabled(
  options: StartProductionMultimodalPipelineRuntimeIfEnabledOptions,
) {
  if (!options.enabled) {
    return null;
  }

  const createRuntime =
    options.createRuntime ?? createProductionMultimodalPipelineRuntime;
  const runtime = createRuntime({
    pollIntervalMs: options.pollIntervalMs,
    batchLimit: options.batchLimit,
    concurrency: options.concurrency,
  });
  runtime.runner.start();
  return runtime;
}
