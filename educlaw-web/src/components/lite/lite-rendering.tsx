import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  AgentPackageSnapshot,
  ArenaAnswerOptimizationSummary,
  ArenaMessage,
  OptimizationResult,
} from '@educlaw/shared';
import type { VersionCompareResult, LineDiff } from '../../api/lite-api';
import { computeLineDiff } from '../../api/lite-api';
import { Loader2, Wrench, ChevronDown } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { getAnswerOptimizationButtonState } from './answer-skill-optimization-state';

export type PackagePreview = { type: string; name: string; content: string };
export type PackagePreviewDelta = { type: string; name: string; delta: string };

export function upsertPackagePreview(
  previews: PackagePreview[],
  preview: PackagePreview,
): PackagePreview[] {
  const index = previews.findIndex(
    (item) => item.type === preview.type && item.name === preview.name,
  );
  if (index < 0) return [...previews, preview];
  const next = [...previews];
  next[index] = preview;
  return next;
}

export function appendPackagePreviewDelta(
  previews: PackagePreview[],
  delta: PackagePreviewDelta,
): PackagePreview[] {
  const index = previews.findIndex(
    (item) => item.type === delta.type && item.name === delta.name,
  );
  if (index < 0)
    return [
      ...previews,
      { type: delta.type, name: delta.name, content: delta.delta },
    ];
  const next = [...previews];
  const current = next[index]!;
  next[index] = { ...current, content: `${current.content}${delta.delta}` };
  return next;
}

const markdownComponents: Components = {
  table: ({ children }) => (
    <div className="my-2 not-prose overflow-x-auto">
      <table className="text-xs border-collapse border border-border/70 w-full">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/60">{children}</thead>,
  th: ({ children }) => (
    <th className="border border-border/70 px-2 py-1 text-left font-semibold whitespace-nowrap">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-border/70 px-2 py-1">{children}</td>
  ),
  tr: ({ children }) => <tr className="even:bg-muted/30">{children}</tr>,
  pre: ({ children }) => (
    <pre className="bg-muted/60 rounded-xl p-3 text-xs whitespace-pre-wrap break-all not-prose my-2">
      {children}
    </pre>
  ),
  code: ({ children, className }) => {
    const isDiff =
      typeof className === 'string' && className.includes('language-diff');
    if (isDiff && typeof children === 'string') {
      return (
        <code className="block">
          {children.split('\n').map((line, i) => {
            if (line.startsWith('-'))
              return (
                <div key={i} className="text-red-500">
                  {line}
                </div>
              );
            if (line.startsWith('+'))
              return (
                <div key={i} className="text-emerald-500">
                  {line}
                </div>
              );
            return (
              <div key={i} className="text-muted-foreground">
                {line}
              </div>
            );
          })}
        </code>
      );
    }
    return <code className={className}>{children}</code>;
  },
};

export function MarkdownContent({
  content,
}: {
  content: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  const components = useMemo<Components>(() => markdownComponents, []);

  return (
    <div
      ref={containerRef}
      className="prose prose-sm max-w-none min-w-0 break-words [overflow-wrap:anywhere] dark:prose-invert"
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function parseSkillFrontmatter(content: string): {
  name?: string;
  description?: string;
  body: string;
} {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) return { body: content };

  const meta: { name?: string; description?: string; body: string } = {
    body: content.slice(match[0].length).trimStart(),
  };
  for (const line of match[1].split('\n')) {
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (key === 'name') meta.name = value;
    if (key === 'description') meta.description = value;
  }
  return meta;
}

export function SkillMarkdownContent({ content }: { content: string }) {
  const skill = parseSkillFrontmatter(content);
  return (
    <div className="space-y-3">
      {(skill.name || skill.description) && (
        <div className="rounded-xl border border-primary/15 bg-primary/5 px-3 py-2 text-xs">
          {skill.name && (
            <div className="flex gap-2">
              <span className="shrink-0 font-semibold text-muted-foreground">
                技能名：
              </span>
              <span className="font-medium text-foreground">{skill.name}</span>
            </div>
          )}
          {skill.description && (
            <div className="mt-1 flex gap-2">
              <span className="shrink-0 font-semibold text-muted-foreground">
                触发说明：
              </span>
              <span className="leading-5 text-muted-foreground">
                {skill.description}
              </span>
            </div>
          )}
        </div>
      )}
      <MarkdownContent content={skill.body || content} />
    </div>
  );
}

function splitChangedText(text: string, counterpart: string) {
  const current = Array.from(text);
  const other = Array.from(counterpart);
  let prefixLength = 0;

  while (
    prefixLength < current.length &&
    prefixLength < other.length &&
    current[prefixLength] === other[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < current.length - prefixLength &&
    suffixLength < other.length - prefixLength &&
    current[current.length - 1 - suffixLength] ===
      other[other.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  return {
    prefix: current.slice(0, prefixLength).join(''),
    changed: current
      .slice(prefixLength, current.length - suffixLength)
      .join(''),
    suffix:
      suffixLength > 0
        ? current.slice(current.length - suffixLength).join('')
        : '',
  };
}

function InlineDiffText({
  text,
  counterpart,
  type,
}: {
  text: string;
  counterpart?: string;
  type: 'removed' | 'added';
}) {
  const tone =
    type === 'removed'
      ? 'bg-rose-100/80 dark:bg-rose-900/25 text-rose-700 dark:text-rose-300'
      : 'bg-emerald-100/80 dark:bg-emerald-900/25 text-emerald-700 dark:text-emerald-300';

  if (counterpart === undefined) {
    return <span className={`rounded-[2px] px-0.5 ${tone}`}>{text}</span>;
  }

  const parts = splitChangedText(text, counterpart);
  return (
    <>
      {parts.prefix}
      {parts.changed && (
        <span className={`rounded-[2px] px-0.5 ${tone}`}>{parts.changed}</span>
      )}
      {parts.suffix}
    </>
  );
}

function DiffLineView({
  line,
  counterpart,
  index,
}: {
  line: LineDiff;
  counterpart?: string;
  index: number;
}) {
  if (line.type === 'same' && line.text.startsWith('...')) {
    return (
      <div key={index} className="flex items-center gap-2 py-2 px-3">
        <div className="h-px flex-1 bg-border/60" />
        <span className="text-[10px] text-muted-foreground/40 select-none">省略</span>
        <div className="h-px flex-1 bg-border/60" />
      </div>
    );
  }

  if (line.type === 'removed') {
    return (
      <div
        key={index}
        className="border-l-2 border-l-rose-300/60 dark:border-l-rose-700/40 bg-rose-50/50 dark:bg-rose-950/10 px-3 py-1.5"
      >
        <span className="whitespace-pre-wrap break-all text-[13px] leading-[1.65] text-foreground/55">
          <InlineDiffText
            text={line.text}
            counterpart={counterpart}
            type="removed"
          />
        </span>
      </div>
    );
  }

  if (line.type === 'added') {
    return (
      <div
        key={index}
        className="border-l-2 border-l-emerald-300/60 dark:border-l-emerald-700/40 bg-emerald-50/50 dark:bg-emerald-950/10 px-3 py-1.5"
      >
        <span className="whitespace-pre-wrap break-all text-[13px] leading-[1.65] text-foreground">
          <InlineDiffText
            text={line.text}
            counterpart={counterpart}
            type="added"
          />
        </span>
      </div>
    );
  }

  return (
    <div
      key={index}
      className="px-3 py-1 whitespace-pre-wrap break-all text-[13px] leading-[1.65] text-muted-foreground/60"
    >
      {line.text}
    </div>
  );
}

function DiffLinesView({ diffs }: { diffs: LineDiff[] }) {
  const rows = [];
  for (let i = 0; i < diffs.length; i += 1) {
    const current = diffs[i]!;
    const next = diffs[i + 1];
    if (current.type === 'removed' && next?.type === 'added') {
      rows.push(
        <DiffLineView
          key={`${i}-removed`}
          line={current}
          counterpart={next.text}
          index={i}
        />,
      );
      rows.push(
        <DiffLineView
          key={`${i}-added`}
          line={next}
          counterpart={current.text}
          index={i + 1}
        />,
      );
      i += 1;
      continue;
    }
    if (current.type === 'added' && next?.type === 'removed') {
      rows.push(
        <DiffLineView
          key={`${i}-added`}
          line={current}
          counterpart={next.text}
          index={i}
        />,
      );
      rows.push(
        <DiffLineView
          key={`${i}-removed`}
          line={next}
          counterpart={current.text}
          index={i + 1}
        />,
      );
      i += 1;
      continue;
    }
    rows.push(<DiffLineView key={i} line={current} index={i} />);
  }
  return <>{rows}</>;
}

function DiffBlock({ title, diffs }: { title: string; diffs: LineDiff[] }) {
  const [expanded, setExpanded] = useState(false);
  const hasChanges = diffs.some((d) => d.type !== 'same');
  if (!hasChanges) return null;
  const added = diffs.filter((d) => d.type === 'added').length;
  const removed = diffs.filter((d) => d.type === 'removed').length;
  return (
    <div className="rounded-xl border border-border/80 bg-card overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center justify-between w-full text-left px-4 py-3 hover:bg-muted/30 transition-colors"
      >
        <span className="text-sm font-medium text-foreground">{title}</span>
        <div className="flex items-center gap-2">
          {removed > 0 && (
            <span className="rounded-full bg-rose-50 dark:bg-rose-950/30 px-2 py-0.5 text-[11px] font-medium text-rose-600 dark:text-rose-400">
              删除 {removed}
            </span>
          )}
          {added > 0 && (
            <span className="rounded-full bg-emerald-50 dark:bg-emerald-950/30 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
              新增 {added}
            </span>
          )}
          <ChevronDown
            className={`size-4 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </div>
      </button>
      {expanded && (
        <div className="border-t border-border/60 py-2">
          <DiffLinesView diffs={diffs} />
        </div>
      )}
    </div>
  );
}

export function VersionDiffView({ result }: { result: VersionCompareResult }) {
  return (
    <div className="space-y-3">
      <DiffBlock
        title={`agent.md (v${result.baseVersion.versionNumber} → v${result.targetVersion.versionNumber})`}
        diffs={result.diffs.agentMd}
      />
      <DiffBlock
        title={`rubric.md (v${result.baseVersion.versionNumber} → v${result.targetVersion.versionNumber})`}
        diffs={result.diffs.rubricMd}
      />
      {result.diffs.skills.map((skill) => (
        <DiffBlock
          key={skill.dirName}
          title={`${skill.name} (${skill.dirName})`}
          diffs={skill.diff}
        />
      ))}
    </div>
  );
}

export function PackagePreviewCard({
  previews,
}: {
  previews: PackagePreview[];
}) {
  if (!previews.length) return null;
  return (
    <div className="mx-3 mt-3 grid gap-2 sm:mx-5 md:grid-cols-2 xl:grid-cols-3">
      {previews.map((p, i) => (
        <div
          key={`${p.name}-${i}`}
          className="min-w-0 rounded-[20px] border border-border/70 bg-card/80 px-4 py-3 shadow-[var(--shadow-sm)]"
        >
          <div className="flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            <span className="inline-flex size-6 items-center justify-center rounded-lg bg-primary/10 text-primary text-[10px]">
              {p.type[0]?.toUpperCase()}
            </span>
            <span className="truncate">{p.name}</span>
          </div>
          <div className="mt-2 max-h-36 overflow-y-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-xs leading-5 text-muted-foreground">
            {p.content}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ConversationBoard({
  messages,
  sideStreaming,
  packageName,
  sideLabels,
  mode = 'compare',
  answerOptimizations = [],
  onOptimizeAnswer,
}: {
  messages: ArenaMessage[];
  sideStreaming: { baseline: boolean; enhanced: boolean };
  packageName?: string;
  sideLabels?: { baseline: string; enhanced: string };
  mode?: 'compare' | 'agent' | 'baseline';
  answerOptimizations?: ArenaAnswerOptimizationSummary[];
  onOptimizeAnswer?: (input: {
    question: ArenaMessage;
    baseline: ArenaMessage | null;
    enhanced: ArenaMessage;
    summary: ArenaAnswerOptimizationSummary;
  }) => void;
}) {
  const turns: Array<{
    shared: ArenaMessage;
    baseline?: ArenaMessage;
    enhanced?: ArenaMessage;
  }> = [];
  for (const message of messages) {
    if (message.side === 'shared' && message.role === 'user') {
      turns.push({ shared: message });
      continue;
    }
    const current = turns[turns.length - 1];
    if (!current || message.role !== 'assistant') continue;
    if (message.side === 'baseline') current.baseline = message;
    if (message.side === 'enhanced') current.enhanced = message;
  }
  const scrollRef = useRef<HTMLDivElement>(null);
  const optimizationByAnswerId = new Map(
    answerOptimizations.map((summary) => [
      summary.enhancedAnswerMessageId,
      summary,
    ]),
  );
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages]);

  if (!messages.length) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div className="text-sm font-medium text-muted-foreground">
            {packageName || '工作台'}
          </div>
          <div className="mt-1 text-xs text-muted-foreground/70">
            输入问题，测试智能体效果
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="flex h-full flex-col gap-4 overflow-y-auto px-3 py-4 sm:px-5"
    >
      {turns.map(
        ({ shared, baseline: baselineMsg, enhanced: enhancedMsg }, idx) => {
          const isLatest = idx === turns.length - 1;
          const optimizationSummary =
            enhancedMsg && typeof enhancedMsg.id === 'number'
              ? optimizationByAnswerId.get(enhancedMsg.id)
              : undefined;
          const optimizationButton = optimizationSummary
            ? getAnswerOptimizationButtonState(optimizationSummary)
            : null;

          return (
            <div key={shared.id} className="space-y-3">
              <div className="flex justify-end">
                <div className="max-w-[92%] rounded-[20px] rounded-tr-md bg-primary px-4 py-3 text-sm text-primary-foreground shadow-[var(--shadow-sm)] sm:max-w-[80%]">
                  {shared.content}
                </div>
              </div>
              <div
                className={`grid gap-3 ${mode === 'compare' ? 'md:grid-cols-2' : 'md:grid-cols-1'}`}
              >
                {mode !== 'agent' && (
                  <div
                    className={`min-w-0 rounded-[20px] border px-4 py-3 shadow-[var(--shadow-sm)] ${sideStreaming.baseline && isLatest ? 'border-cyan-500/20 bg-cyan-500/5' : 'border-border/70 bg-card/80'}`}
                  >
                    <div className="flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      <span className="inline-flex size-6 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-500 text-[10px]">
                        B
                      </span>
                      {sideLabels?.baseline || '基础模型'}
                      {sideStreaming.baseline && isLatest && (
                        <Loader2 className="ml-auto size-3 animate-spin text-cyan-500" />
                      )}
                    </div>
                    <div className="mt-2 text-sm leading-6 text-foreground">
                      {baselineMsg?.content || '' ? (
                        <MarkdownContent content={baselineMsg.content} />
                      ) : (
                        <span className="text-muted-foreground/50">
                          等待生成...
                        </span>
                      )}
                    </div>
                  </div>
                )}
                {mode !== 'baseline' && (
                  <div
                    className={`min-w-0 rounded-[20px] border px-4 py-3 shadow-[var(--shadow-sm)] ${sideStreaming.enhanced && isLatest ? 'border-primary/20 bg-primary/5' : 'border-border/70 bg-card/80'}`}
                  >
                    <div className="flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      <span className="inline-flex size-6 items-center justify-center rounded-lg bg-primary/10 text-primary text-[10px]">
                        E
                      </span>
                      {sideLabels?.enhanced || packageName || '智能体'}
                      {sideStreaming.enhanced && isLatest && (
                        <Loader2 className="ml-auto size-3 animate-spin text-primary" />
                      )}
                    </div>
                    <div className="mt-2 text-sm leading-6 text-foreground">
                      {enhancedMsg?.content || '' ? (
                        <MarkdownContent content={enhancedMsg.content} />
                      ) : (
                        <span className="text-muted-foreground/50">
                          等待生成...
                        </span>
                      )}
                    </div>
                    {enhancedMsg &&
                      optimizationSummary &&
                      optimizationButton &&
                      !(sideStreaming.enhanced && isLatest) && (
                        <div className="mt-3 flex items-center justify-end border-t border-border/60 pt-2">
                          <button
                            type="button"
                            className="inline-flex min-h-8 items-center gap-1.5 rounded-[8px] px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={optimizationButton.disabled}
                            title={optimizationButton.hint}
                            onClick={() =>
                              onOptimizeAnswer?.({
                                question: shared,
                                baseline: baselineMsg || null,
                                enhanced: enhancedMsg,
                                summary: optimizationSummary,
                              })
                            }
                          >
                            <Wrench className="size-3.5" />
                            {optimizationButton.label}
                          </button>
                        </div>
                      )}
                  </div>
                )}
              </div>
            </div>
          );
        },
      )}
    </div>
  );
}

export function OptimizationDiffView({
  oldSnapshot,
  optimization,
}: {
  oldSnapshot: AgentPackageSnapshot;
  optimization: OptimizationResult;
}) {
  const agentDiff = computeLineDiff(
    oldSnapshot.agentMd,
    optimization.snapshot.agentMd,
  );
  const rubricDiff = computeLineDiff(
    oldSnapshot.rubricMd,
    optimization.snapshot.rubricMd,
  );

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border/80 bg-card overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border/60">
          <span className="text-sm font-medium text-foreground">agent.md 变更</span>
        </div>
        <div className="py-2">
          <DiffLinesView diffs={agentDiff} />
        </div>
      </div>
      <div className="rounded-xl border border-border/80 bg-card overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border/60">
          <span className="text-sm font-medium text-foreground">rubric.md 变更</span>
        </div>
        <div className="py-2">
          <DiffLinesView diffs={rubricDiff} />
        </div>
      </div>
    </div>
  );
}
