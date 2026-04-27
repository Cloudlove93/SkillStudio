import type { Message, MessagePart } from '@educlaw/shared';

/** Convert a runtime compat message (with info + parts) into our frontend Message format. */
export function convertRuntimeMessage(raw: unknown): Message {
  const data = raw as Record<string, unknown>;
  const info = (data.info ?? data) as Record<string, unknown>;
  const rawParts: unknown[] = (data.parts as unknown[]) ?? [];
  const parts: MessagePart[] = rawParts.map(convertRuntimePart);
  const msg: Message = {
    id: info.id as string,
    role: info.role as 'user' | 'assistant',
    parts,
    createdAt: (info.time as Record<string, string> | undefined)?.created,
  };
  // Extract token/cost info from assistant messages
  if (info.role === 'assistant') {
    const tokens = info.tokens as Record<string, unknown> | undefined;
    if (tokens) {
      const cache = tokens.cache as Record<string, number> | undefined;
      msg.tokens = {
        input: (tokens.input as number) ?? 0,
        output: (tokens.output as number) ?? 0,
        reasoning: (tokens.reasoning as number) ?? 0,
        cacheRead: cache?.read ?? 0,
        cacheWrite: cache?.write ?? 0,
      };
    }
    if (info.cost != null) msg.cost = info.cost as number;
    if (info.modelID) msg.modelID = info.modelID as string;
    if (info.providerID) msg.providerID = info.providerID as string;
  }
  return msg;
}

export function convertRuntimePart(raw: unknown): MessagePart {
  const p = raw as Record<string, unknown>;
  const base = { id: p.id as string | undefined, messageID: p.messageID as string | undefined };
  const state = p.state as Record<string, unknown> | undefined;

  switch (p.type) {
    case 'text':
      return { type: 'text', text: (p.text as string) ?? '', ...base };
    case 'tool':
      return {
        type: 'tool',
        toolName: (p.tool as string) ?? 'unknown',
        toolInput: state?.input,
        toolOutput: state?.output,
        state: state?.status === 'completed' ? 'completed'
          : state?.status === 'error' ? 'error'
          : state?.status === 'running' ? 'running'
          : 'pending',
        ...base,
      };
    case 'reasoning':
      return { type: 'reasoning', text: (p.text as string) ?? '', ...base };
    case 'step-start':
      return { type: 'step-start', ...base };
    case 'step-finish': {
      const stepTokens = p.tokens as Record<string, number> | undefined;
      return {
        type: 'step-finish',
        finishReason: p.reason as string | undefined,
        tokens: stepTokens ? { input: stepTokens.input ?? 0, output: stepTokens.output ?? 0 } : undefined,
        ...base,
      };
    }
    case 'file':
      return {
        type: 'file',
        filename: p.filename as string | undefined,
        filePath: (p.url ?? p.path) as string | undefined,
        mime: p.mime as string | undefined,
        ...base,
      };
    case 'patch': {
      const files = p.files as { path: string; additions: number; deletions: number }[] | undefined;
      return { type: 'patch', patchHash: p.hash as string | undefined, patchFiles: files, ...base };
    }
    case 'snapshot':
      return { type: 'snapshot', snapshot: p.snapshot, ...base };
    case 'subtask':
      return {
        type: 'subtask',
        subtaskPrompt: p.prompt as string | undefined,
        subtaskDescription: p.description as string | undefined,
        subtaskAgent: p.agent as string | undefined,
        ...base,
      };
    case 'agent':
      return {
        type: 'agent',
        agentName: p.name as string | undefined,
        agentSource: p.source as string | undefined,
        ...base,
      };
    case 'compaction':
      return { type: 'compaction', compactionAuto: p.auto as boolean | undefined, ...base };
    case 'retry':
      return {
        type: 'retry',
        retryAttempt: p.attempt as number | undefined,
        retryError: p.error as string | undefined,
        ...base,
      };
    default:
      return { type: 'text', text: ((p.text ?? p.content) as string) ?? '', ...base };
  }
}
