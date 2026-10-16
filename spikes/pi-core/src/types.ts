export type SpikeStatus = "completed" | "failed" | "cancelled";

export interface SafeEventRecord {
  event: string;
  runId: string;
  timestamp: string;
  fields?: Record<string, boolean | number | string | null>;
}

export interface ProviderProbeResult {
  runId: string;
  status: SpikeStatus;
  providerId: string;
  modelId: string;
  outputChars: number;
}

export interface AgentSpikeResult {
  runId: string;
  status: SpikeStatus;
  providerId: string;
  modelId: string;
  finalText: string;
  markerObserved: boolean;
  toolCallCount: number;
  toolResultCount: number;
  toolNames: string[];
  eventTypes: string[];
  resourceCleaned: boolean;
  errorCode: string | null;
}

export interface ToolAudit {
  readCount: number;
  totalBytes: number;
  deniedCount: number;
}
