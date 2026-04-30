import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { Copy, Check } from 'lucide-react';
import CodeBlock from '../editor/CodeBlock';
import { copyToClipboard } from '../../lib/utils';

/**
 * Convert LaTeX-style delimiters to dollar-sign delimiters
 * so remark-math can parse them.
 * Avoids converting inside fenced code blocks.
 */
function normalizeMathDelimiters(text: string): string {
  const parts = text.split(/(```[\s\S]*?```)/g);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part;
      part = part.replace(/\\\[([\s\S]*?)\\\]/g, (_m, inner) => `$$${inner}$$`);
      part = part.replace(/\\\((.*?)\\\)/g, (_m, inner) => `$${inner}$`);
      return part;
    })
    .join('');
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    copyToClipboard(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
      title="Copy"
    >
      {copied ? <Check size={10} className="text-green-500" /> : <Copy size={10} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeKatex];

const markdownComponents: Components = {
  pre({ children, ...props }) {
    const codeChild = Array.isArray(children) ? children[0] : children;
    if (codeChild?.type === 'code' || codeChild?.props?.node?.tagName === 'code') {
      const className = codeChild.props?.className || '';
      const match = /language-(\w+)/.exec(className);
      const code = String(codeChild.props?.children ?? '').replace(/\n$/, '');
      const language = match?.[1] || '';

      return (
        <div className="not-prose my-3 rounded-xl border border-border/60 overflow-hidden max-w-full shadow-sm">
          <div className="flex items-center justify-between bg-muted/60 px-3 py-1.5">
            <span className="text-[10px] font-mono font-medium text-muted-foreground uppercase tracking-wide">
              {language || 'text'}
            </span>
            <CopyButton text={code} />
          </div>
          <CodeBlock code={code} language={language || 'text'} />
        </div>
      );
    }
    return <pre {...props}>{children}</pre>;
  },
  code({ className, children, node, ...props }) {
    const isBlock = node?.position && String(children).includes('\n');
    if (isBlock || /language-(\w+)/.test(className || '')) {
      return <code className={className} {...props}>{children}</code>;
    }
    return (
      <code
        className="rounded-md bg-muted/70 px-1.5 py-0.5 text-[13px] font-mono text-foreground/90 border border-border/30 before:content-none after:content-none"
        {...props}
      >
        {children}
      </code>
    );
  },
  table({ children }) {
    return (
      <div className="not-prose my-3 overflow-x-auto rounded-lg border border-border shadow-sm">
        <table className="w-full text-xs border-collapse">{children}</table>
      </div>
    );
  },
  thead({ children }) {
    return (
      <thead className="bg-muted/60 text-left text-[11px] font-semibold text-foreground">
        {children}
      </thead>
    );
  },
  th({ children }) {
    return (
      <th className="px-3 py-2 border-b border-border font-semibold whitespace-nowrap">
        {children}
      </th>
    );
  },
  td({ children }) {
    return (
      <td className="px-3 py-1.5 border-b border-border/50 text-foreground/80">
        {children}
      </td>
    );
  },
  tr({ children, ...props }) {
    return (
      <tr className="transition-colors hover:bg-muted/40 even:bg-muted/20" {...props}>
        {children}
      </tr>
    );
  },
  a({ href, children }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary hover:text-primary/80 underline underline-offset-2 decoration-primary/30"
      >
        {children}
      </a>
    );
  },
  ul({ children }) {
    return <ul className="my-2 ml-1 list-disc space-y-1 pl-4">{children}</ul>;
  },
  ol({ children, start }) {
    return (
      <ol className="my-2 ml-1 list-decimal space-y-1 pl-4" start={start}>
        {children}
      </ol>
    );
  },
  li({ children }) {
    return <li className="leading-relaxed pl-0.5">{children}</li>;
  },
  h1({ children }) {
    return <h1 className="text-xl font-bold mt-5 mb-3 leading-tight">{children}</h1>;
  },
  h2({ children }) {
    return <h2 className="text-lg font-semibold mt-4 mb-2 leading-tight">{children}</h2>;
  },
  h3({ children }) {
    return <h3 className="text-base font-semibold mt-3 mb-1.5 leading-snug">{children}</h3>;
  },
  h4({ children }) {
    return <h4 className="text-sm font-semibold mt-3 mb-1 leading-snug">{children}</h4>;
  },
  blockquote({ children }) {
    return (
      <blockquote className="my-3 border-l-3 border-primary/40 pl-4 bg-muted/20 rounded-r-lg py-2 text-muted-foreground italic">
        {children}
      </blockquote>
    );
  },
  p({ children }) {
    return <p className="my-2 leading-relaxed">{children}</p>;
  },
  hr() {
    return <hr className="my-4 border-border/40" />;
  },
  img({ src, alt }) {
    return (
      <img
        src={src}
        alt={alt || ''}
        className="my-3 max-w-full rounded-lg border border-border shadow-sm"
        loading="lazy"
      />
    );
  },
};

// ---------------------------------------------------------------------------
// Throttled markdown rendering hook
// During streaming, text changes on every SSE delta (potentially 30+ fps).
// Re-parsing markdown on every delta is expensive and causes jank.
// This hook uses leading+trailing edge throttling: it renders the first
// change immediately, then suppresses renders for THROTTLE_MS, then flushes
// accumulated changes. This gives instant feedback on the first chunk while
// keeping ReactMarkdown re-renders to ~6 times/sec.
// When streaming stops, it immediately flushes the final text.
// ---------------------------------------------------------------------------
const THROTTLE_MS = 150;

function useThrottledText(text: string, isStreaming: boolean): string {
  const [rendered, setRendered] = useState(text);
  const latestRef = useRef(text);
  const lastFlushRef = useRef(0);
  const rafRef = useRef<number>(0);

  latestRef.current = text;

  useEffect(() => {
    if (!isStreaming) {
      cancelAnimationFrame(rafRef.current);
      setRendered(text);
      return;
    }

    // Schedule a rAF loop that flushes at most every THROTTLE_MS
    function tick() {
      const now = performance.now();
      if (now - lastFlushRef.current >= THROTTLE_MS) {
        lastFlushRef.current = now;
        setRendered(latestRef.current);
      }
      rafRef.current = requestAnimationFrame(tick);
    }

    // Leading edge: render immediately
    setRendered(text);
    lastFlushRef.current = performance.now();
    rafRef.current = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(rafRef.current);
  }, [isStreaming, text]);

  // When not streaming, always sync
  useEffect(() => {
    if (!isStreaming) setRendered(text);
  }, [text, isStreaming]);

  return rendered;
}

/**
 * TextPartView — renders markdown with throttled updates during streaming.
 *
 * Streaming:  text updates are throttled (~150ms) before re-parsing markdown,
 *             keeping the UI responsive while still showing formatted content.
 * Completed:  text is rendered immediately with full markdown + math support.
 */
export default function TextPartView({ text, isStreaming }: { text: string; isStreaming?: boolean }) {
  const throttled = useThrottledText(text, !!isStreaming);
  const normalizedText = useMemo(() => normalizeMathDelimiters(throttled), [throttled]);

  if (!text && !isStreaming) return null;

  return (
    <div className="text-sm max-w-none overflow-x-auto">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={markdownComponents}
      >
        {normalizedText}
      </ReactMarkdown>
      {isStreaming && (
        <span className="animate-blink-cursor text-primary font-bold text-lg leading-none">▍</span>
      )}
    </div>
  );
}
