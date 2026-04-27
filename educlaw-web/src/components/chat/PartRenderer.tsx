import type { MessagePart } from '../../stores/chat';
import TextPartView from './TextPartView';
import ToolCallView from './ToolCallView';

import StepIndicator from './StepIndicator';
import { FileCode, GitBranch, Camera, ListTodo, Bot, RefreshCw, Minimize2 } from 'lucide-react';

export default function PartRenderer({
  part,
  isStreaming,
}: {
  part: MessagePart;
  /** True only when this is the last (active) part of a streaming message */
  isStreaming?: boolean;
}) {
  switch (part.type) {
    case 'text':
      return <TextPartView text={part.text ?? ''} isStreaming={isStreaming} />;
    case 'tool':
      return (
        <ToolCallView
          toolName={part.toolName ?? 'unknown'}
          input={part.toolInput}
          output={part.toolOutput}
          state={part.state}
        />
      );
    case 'reasoning':
      // Reasoning is internal model thought process — never show to end-users.
      return null;
    case 'step-start':
    case 'step-finish':
      return <StepIndicator part={part} />;
    case 'file':
      return <FilePart filename={part.filename} filePath={part.filePath} />;
    case 'patch':
      return <PatchPart files={part.patchFiles} hash={part.patchHash} />;
    case 'snapshot':
      return <SnapshotPart snapshot={part.snapshot} />;
    case 'subtask':
      return <SubtaskPart prompt={part.subtaskPrompt} description={part.subtaskDescription} agent={part.subtaskAgent} />;
    case 'agent':
      return <AgentPart name={part.agentName} source={part.agentSource} />;
    case 'compaction':
      return <CompactionPart auto={part.compactionAuto} />;
    case 'retry':
      return <RetryPart attempt={part.retryAttempt} error={part.retryError} />;
    default:
      if (part.text) {
        return <TextPartView text={part.text} isStreaming={isStreaming} />;
      }
      return null;
  }
}

function FilePart({ filename, filePath }: { filename?: string; filePath?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
      <FileCode className="size-4 text-blue-500 shrink-0" />
      <div className="min-w-0">
        <div className="font-medium text-foreground truncate">{filename ?? 'file'}</div>
        {filePath && <div className="text-xs text-muted-foreground truncate">{filePath}</div>}
      </div>
    </div>
  );
}

function PatchPart({ files, hash }: { files?: { path: string; additions: number; deletions: number }[]; hash?: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
      <div className="flex items-center gap-2 mb-1">
        <GitBranch className="size-4 text-orange-500 shrink-0" />
        <span className="font-medium text-foreground">Patch</span>
        {hash && <span className="text-xs text-muted-foreground font-mono">{hash.slice(0, 8)}</span>}
      </div>
      {files && files.length > 0 && (
        <div className="space-y-0.5 mt-1">
          {files.map((f, i) => (
            <div key={i} className="flex items-center gap-2 text-xs font-mono">
              <span className="text-muted-foreground truncate flex-1">{f.path}</span>
              {f.additions > 0 && <span className="text-green-600">+{f.additions}</span>}
              {f.deletions > 0 && <span className="text-red-500">-{f.deletions}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SnapshotPart({ snapshot: _snapshot }: { snapshot?: unknown }) {
  void _snapshot;
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
      <Camera className="size-4 text-purple-500 shrink-0" />
      <span className="text-muted-foreground">Snapshot saved</span>
    </div>
  );
}

function SubtaskPart({ prompt, description, agent }: { prompt?: string; description?: string; agent?: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
      <div className="flex items-center gap-2 mb-1">
        <ListTodo className="size-4 text-indigo-500 shrink-0" />
        <span className="font-medium text-foreground">Subtask</span>
        {agent && <span className="text-xs text-muted-foreground">({agent})</span>}
      </div>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
      {prompt && <pre className="mt-1 text-xs text-foreground/80 whitespace-pre-wrap">{prompt}</pre>}
    </div>
  );
}

function AgentPart({ name, source }: { name?: string; source?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
      <Bot className="size-4 text-teal-500 shrink-0" />
      <span className="text-foreground font-medium">{name ?? 'Agent'}</span>
      {source && <span className="text-xs text-muted-foreground">({source})</span>}
    </div>
  );
}

function CompactionPart({ auto }: { auto?: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
      <Minimize2 className="size-4 shrink-0" />
      <span>{auto ? 'Context auto-compacted' : 'Context compacted'}</span>
    </div>
  );
}

function RetryPart({ attempt, error }: { attempt?: number; error?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 text-sm">
      <RefreshCw className="size-4 text-yellow-600 shrink-0" />
      <div className="min-w-0">
        <span className="text-foreground">Retry{attempt ? ` #${attempt}` : ''}</span>
        {error && <p className="text-xs text-muted-foreground mt-0.5">{error}</p>}
      </div>
    </div>
  );
}
