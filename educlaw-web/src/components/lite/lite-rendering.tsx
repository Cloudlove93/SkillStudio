import { useEffect, useRef, useState } from "react";
import type { AgentPackageSnapshot, ArenaMessage, OptimizationResult } from "@educlaw/shared";
import type { VersionCompareResult, LineDiff } from "../../api/lite-api";
import { computeLineDiff } from "../../api/lite-api";
import { Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

export type PackagePreview = { type: string; name: string; content: string };
export type PackagePreviewDelta = { type: string; name: string; delta: string };

export function upsertPackagePreview(previews: PackagePreview[], preview: PackagePreview): PackagePreview[] {
  const index = previews.findIndex((item) => item.type === preview.type && item.name === preview.name);
  if (index < 0) return [...previews, preview];
  const next = [...previews];
  next[index] = preview;
  return next;
}

export function appendPackagePreviewDelta(previews: PackagePreview[], delta: PackagePreviewDelta): PackagePreview[] {
  const index = previews.findIndex((item) => item.type === delta.type && item.name === delta.name);
  if (index < 0) return [...previews, { type: delta.type, name: delta.name, content: delta.delta }];
  const next = [...previews];
  const current = next[index]!;
  next[index] = { ...current, content: `${current.content}${delta.delta}` };
  return next;
}

const markdownComponents: Components = {
  table: ({ children }) => (
    <div className="my-2 not-prose overflow-x-auto">
      <table className="text-xs border-collapse border border-border/70 w-full">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/60">{children}</thead>,
  th: ({ children }) => <th className="border border-border/70 px-2 py-1 text-left font-semibold whitespace-nowrap">{children}</th>,
  td: ({ children }) => <td className="border border-border/70 px-2 py-1">{children}</td>,
  tr: ({ children }) => <tr className="even:bg-muted/30">{children}</tr>,
  pre: ({ children }) => (
    <pre className="bg-muted/60 rounded-xl p-3 text-xs whitespace-pre-wrap break-all not-prose my-2">{children}</pre>
  ),
  code: ({ children, className }) => {
    const isDiff = typeof className === "string" && className.includes("language-diff");
    if (isDiff && typeof children === "string") {
      return (
        <code className="block">
          {children.split("\n").map((line, i) => {
            if (line.startsWith("-")) return <div key={i} className="text-red-500">{line}</div>;
            if (line.startsWith("+")) return <div key={i} className="text-emerald-500">{line}</div>;
            return <div key={i} className="text-muted-foreground">{line}</div>;
          })}
        </code>
      );
    }
    return <code className={className}>{children}</code>;
  },
};

export function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="prose prose-sm max-w-none min-w-0 break-words [overflow-wrap:anywhere] dark:prose-invert">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

function DiffBlock({ title, diffs }: { title: string; diffs: LineDiff[] }) {
  const [expanded, setExpanded] = useState(false);
  const hasChanges = diffs.some((d) => d.type !== "same");
  if (!hasChanges) return null;
  const added = diffs.filter((d) => d.type === "added").length;
  const removed = diffs.filter((d) => d.type === "removed").length;
  return (
    <div className="rounded-[20px] border border-border/70 bg-card/80 px-4 py-3">
      <button onClick={() => setExpanded((v) => !v)} className="flex items-center justify-between w-full text-left">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{title}</div>
        <div className="flex items-center gap-2 text-[10px]">
          {removed > 0 && <span className="text-red-500">-{removed}</span>}
          {added > 0 && <span className="text-emerald-500">+{added}</span>}
          <span className="text-muted-foreground">{expanded ? "▲" : "▼"}</span>
        </div>
      </button>
      {expanded && (
        <div className="mt-2 space-y-0 font-mono leading-5 text-xs border-t border-border/50 pt-2">
          {diffs.map((line, i) => {
            if (line.type === "same" && line.text.startsWith("...")) {
              return <div key={i} className="px-2 py-0.5 text-muted-foreground/40 italic">{line.text}</div>;
            }
            return (
              <div key={i} className={`px-2 py-0.5 whitespace-pre-wrap break-all ${line.type === "removed" ? "bg-red-500/10 text-red-600" : line.type === "added" ? "bg-emerald-500/10 text-emerald-600" : "text-foreground/40"}`}>
                {line.type === "removed" ? "- " : line.type === "added" ? "+ " : "  "}{line.text}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function VersionDiffView({ result }: { result: VersionCompareResult }) {
  return (
    <div className="space-y-3 text-xs">
      <DiffBlock title={`agent.md (v${result.baseVersion.versionNumber} → v${result.targetVersion.versionNumber})`} diffs={result.diffs.agentMd} />
      <DiffBlock title={`rubric.md (v${result.baseVersion.versionNumber} → v${result.targetVersion.versionNumber})`} diffs={result.diffs.rubricMd} />
      {result.diffs.skills.map((skill) => (
        <DiffBlock key={skill.dirName} title={`${skill.name} (${skill.dirName})`} diffs={skill.diff} />
      ))}
    </div>
  );
}

export function PackagePreviewCard({ previews }: { previews: PackagePreview[] }) {
  if (!previews.length) return null;
  return (
    <div className="mx-3 mt-3 grid gap-2 sm:mx-5 md:grid-cols-2 xl:grid-cols-3">
      {previews.map((p, i) => (
        <div key={`${p.name}-${i}`} className="min-w-0 rounded-[20px] border border-border/70 bg-card/80 px-4 py-3 shadow-[var(--shadow-sm)]">
          <div className="flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            <span className="inline-flex size-6 items-center justify-center rounded-lg bg-primary/10 text-primary text-[10px]">{p.type[0]?.toUpperCase()}</span>
            <span className="truncate">{p.name}</span>
          </div>
          <div className="mt-2 max-h-36 overflow-y-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-xs leading-5 text-muted-foreground">{p.content}</div>
        </div>
      ))}
    </div>
  );
}

export function ConversationBoard({ messages, sideStreaming, packageName }: { messages: ArenaMessage[]; sideStreaming: { baseline: boolean; enhanced: boolean }; packageName?: string }) {
  const sharedMessages = messages.filter((m) => m.side === "shared" && m.role === "user");
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages]);

  if (!messages.length) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div className="text-sm font-medium text-muted-foreground">{packageName || "工作台"}</div>
          <div className="mt-1 text-xs text-muted-foreground/70">输入问题，测试智能体效果</div>
        </div>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="flex h-full flex-col gap-4 overflow-y-auto px-3 py-4 sm:px-5">
      {sharedMessages.map((shared, idx) => {
        const baselineMsgs = messages.filter((m) => m.side === "baseline" && m.role === "assistant");
        const enhancedMsgs = messages.filter((m) => m.side === "enhanced" && m.role === "assistant");
        const baselineMsg = baselineMsgs[idx];
        const enhancedMsg = enhancedMsgs[idx];
        const isLatest = idx === sharedMessages.length - 1;

        return (
          <div key={shared.id} className="space-y-3">
            <div className="flex justify-end">
              <div className="max-w-[92%] rounded-[20px] rounded-tr-md bg-primary px-4 py-3 text-sm text-primary-foreground shadow-[var(--shadow-sm)] sm:max-w-[80%]">
                {shared.content}
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className={`min-w-0 rounded-[20px] border px-4 py-3 shadow-[var(--shadow-sm)] ${sideStreaming.baseline && isLatest ? "border-cyan-500/20 bg-cyan-500/5" : "border-border/70 bg-card/80"}`}>
                <div className="flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  <span className="inline-flex size-6 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-500 text-[10px]">B</span>
                  基础模型
                  {sideStreaming.baseline && isLatest && <Loader2 className="ml-auto size-3 animate-spin text-cyan-500" />}
                </div>
                <div className="mt-2 text-sm leading-6 text-foreground">
                  {(baselineMsg?.content || "") ? <MarkdownContent content={baselineMsg.content} /> : <span className="text-muted-foreground/50">等待生成...</span>}
                </div>
              </div>
              <div className={`min-w-0 rounded-[20px] border px-4 py-3 shadow-[var(--shadow-sm)] ${sideStreaming.enhanced && isLatest ? "border-primary/20 bg-primary/5" : "border-border/70 bg-card/80"}`}>
                <div className="flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  <span className="inline-flex size-6 items-center justify-center rounded-lg bg-primary/10 text-primary text-[10px]">E</span>
                  {packageName || "智能体"}
                  {sideStreaming.enhanced && isLatest && <Loader2 className="ml-auto size-3 animate-spin text-primary" />}
                </div>
                <div className="mt-2 text-sm leading-6 text-foreground">
                  {(enhancedMsg?.content || "") ? <MarkdownContent content={enhancedMsg.content} /> : <span className="text-muted-foreground/50">等待生成...</span>}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function OptimizationDiffView({ oldSnapshot, optimization }: { oldSnapshot: AgentPackageSnapshot; optimization: OptimizationResult }) {
  return (
    <div className="space-y-3 text-xs">
      <div className="rounded-[20px] border border-border/70 bg-card/80 px-4 py-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground mb-2">agent.md 变更</div>
        <div className="space-y-0.5 font-mono leading-5">
          {diffLines(oldSnapshot.agentMd, optimization.snapshot.agentMd).map((line, i) => (
            <div key={i} className={`px-2 rounded ${line.type === "removed" ? "bg-red-500/10 text-red-600" : line.type === "added" ? "bg-emerald-500/10 text-emerald-600" : "text-foreground"}`}>
              {line.type === "removed" ? "- " : line.type === "added" ? "+ " : "  "}{line.text}
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-[20px] border border-border/70 bg-card/80 px-4 py-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground mb-2">rubric.md 变更</div>
        <div className="space-y-0.5 font-mono leading-5">
          {diffLines(oldSnapshot.rubricMd, optimization.snapshot.rubricMd).map((line, i) => (
            <div key={i} className={`px-2 rounded ${line.type === "removed" ? "bg-red-500/10 text-red-600" : line.type === "added" ? "bg-emerald-500/10 text-emerald-600" : "text-foreground"}`}>
              {line.type === "removed" ? "- " : line.type === "added" ? "+ " : "  "}{line.text}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
