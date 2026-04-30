import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { X, Save, RotateCw, Code, Eye } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import { readFile, writeFile, getFileRawUrl } from '../../api/manager';
import CodeBlock from './CodeBlock';
import { useT } from '../../i18n';

const EXT_LANG: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TSX', js: 'JavaScript', jsx: 'JSX',
  json: 'JSON', md: 'Markdown', css: 'CSS', html: 'HTML',
  py: 'Python', go: 'Go', rs: 'Rust', sh: 'Shell', bash: 'Shell',
  yml: 'YAML', yaml: 'YAML', toml: 'TOML', sql: 'SQL',
  xml: 'XML', svg: 'SVG', java: 'Java', c: 'C', cpp: 'C++',
  h: 'C', hpp: 'C++', rb: 'Ruby', php: 'PHP', swift: 'Swift',
  kt: 'Kotlin', lua: 'Lua', r: 'R', zig: 'Zig', txt: 'Text',
};

function detectLanguageLabel(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return EXT_LANG[ext] || 'Text';
}

function isHtmlFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return ext === 'html' || ext === 'htm';
}

function isMarkdownFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return ext === 'md' || ext === 'mdx';
}

function isPreviewable(filePath: string): boolean {
  return isHtmlFile(filePath) || isMarkdownFile(filePath);
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp']);

function isImageFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_EXTS.has(ext);
}

export default function FileViewer({
  agentId,
  filePath,
  onClose,
  readonly,
}: {
  agentId: string;
  filePath: string;
  onClose: () => void;
  readonly?: boolean;
}) {
  const t = useT();
  const [content, setContent] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [mode, setMode] = useState<'preview' | 'source'>('source');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumRef = useRef<HTMLDivElement>(null);

  const html = isHtmlFile(filePath);
  const md = isMarkdownFile(filePath);
  const image = isImageFile(filePath);
  const previewable = html || md;
  const dirty = content !== null && draft !== content && !readonly;

  // Default to preview for HTML/Markdown files
  useEffect(() => {
    setMode(isPreviewable(filePath) ? 'preview' : 'source');
  }, [filePath]);

  const loadFile = useCallback(async () => {
    if (image) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const c = await readFile(agentId, filePath);
      setContent(c);
      setDraft(c);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load file');
    } finally {
      setLoading(false);
    }
  }, [agentId, filePath, image]);

  useEffect(() => {
    loadFile();
  }, [loadFile]);

  const handleSave = useCallback(async () => {
    if (!dirty) return;
    setSaving(true);
    try {
      await writeFile(agentId, filePath, draft);
      setContent(draft);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load file');
    } finally {
      setSaving(false);
    }
  }, [agentId, filePath, draft, dirty]);

  const handleClose = useCallback(() => {
    if (dirty) {
      if (!window.confirm(t('viewer.confirmClose'))) return;
    }
    onClose();
  }, [dirty, onClose, t]);

  const syncScroll = useCallback(() => {
    if (lineNumRef.current && textareaRef.current) {
      lineNumRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      handleSave();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const value = ta.value;
      const newValue = value.substring(0, start) + '  ' + value.substring(end);
      setDraft(newValue);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    }
  }, [handleSave]);

  // Build blob URL for HTML preview 閳?uses draft so preview updates after save
  const previewUrl = useMemo(() => {
    if (!html || content === null) return null;
    // Use the saved content for preview (draft if saved matches)
    const src = dirty ? draft : content;
    const blob = new Blob([src], { type: 'text/html' });
    return URL.createObjectURL(blob);
  }, [html, content, draft, dirty]);

  // Cleanup blob URL
  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  const imageUrl = useMemo(() => {
    if (!image) return null;
    return getFileRawUrl(agentId, filePath);
  }, [image, agentId, filePath]);

  const fileName = filePath.split('/').pop() ?? filePath;
  const langLabel = detectLanguageLabel(filePath);
  const lineCount = (draft || '').split('\n').length;
  const showPreview = previewable && mode === 'preview' && content !== null;
  const showEditor = mode === 'source' && content !== null;

  return (
    <div className="flex flex-1 flex-col min-h-0 min-w-0">
      {/* Header */}
      <div className="relative flex items-center gap-1.5 border-b border-border/60 bg-card/95 px-3 py-1.5">
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-primary/10 to-transparent" />
        <div className="flex items-center gap-1.5 rounded-md bg-muted/40 px-2 py-0.5 text-xs">
          <Code className="size-3 text-muted-foreground/50" />
          <span className="font-medium text-foreground">{fileName}</span>
          {dirty && <span className="size-1.5 rounded-full bg-orange-400 shadow-sm shadow-orange-400/50" title={t('viewer.unsavedTitle')} />}
        </div>
        <span className="text-[10px] text-muted-foreground/50 truncate font-mono">{filePath}</span>

        <div className="flex-1" />

        {saved && (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-600 dark:text-green-400">
            {t('viewer.saved')}
          </span>
        )}
        {saving && (
          <span className="text-[10px] text-muted-foreground/60">{t('viewer.saving')}</span>
        )}

        {/* Preview / Source toggle for HTML & Markdown */}
        {!image && previewable && content !== null && (
          <div className="flex items-center rounded-lg border border-border/50 bg-muted/30 p-0.5">
            <button
              className={`rounded-md px-2 py-0.5 text-[10px] font-medium transition-all duration-200 ${
                mode === 'preview'
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground/60 hover:text-foreground'
              }`}
              onClick={() => setMode('preview')}
            >
              <Eye className="mr-1 inline size-3" />
              {t('viewer.preview')}
            </button>
            <button
              className={`rounded-md px-2 py-0.5 text-[10px] font-medium transition-all duration-200 ${
                mode === 'source'
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground/60 hover:text-foreground'
              }`}
              onClick={() => setMode('source')}
            >
              <Code className="mr-1 inline size-3" />
              {t('viewer.source')}
            </button>
          </div>
        )}

        {!image && (
          <span className="rounded-full bg-muted/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground/60">
            {langLabel}
          </span>
        )}

        {!readonly && !image && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={handleSave}
            disabled={saving || !dirty}
            title={t('viewer.save')}
            className={dirty ? 'text-orange-500 hover:text-orange-600' : ''}
          >
            <Save className="size-3.5" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={loadFile}
          disabled={loading}
          title={t('viewer.reload')}
        >
          <RotateCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
        </Button>
        <div className="mx-0.5 h-3 w-px bg-border/40" />
        <Button variant="ghost" size="icon-xs" onClick={handleClose} title={t('viewer.close')} className="rounded-full">
          <X className="size-3.5" />
        </Button>
      </div>

      {/* Error */}
      {error && (
        <div className="border-b border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Loading */}
      {!image && loading && content === null && (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          <RotateCw className="mr-1.5 size-3 animate-spin" /> {t('viewer.loading')}
        </div>
      )}

      {/* Image Preview */}
      {image && imageUrl && (
        <div className="flex flex-1 items-center justify-center min-h-0 overflow-auto bg-[repeating-conic-gradient(hsl(var(--muted))_0%_25%,transparent_0%_50%)] bg-[length:16px_16px] p-4">
          <img
            src={imageUrl}
            alt={fileName}
            className="max-w-full max-h-full object-contain rounded shadow-lg"
          />
        </div>
      )}

      {/* HTML Preview */}
      {showPreview && html && previewUrl && (
        <iframe
          key={previewUrl}
          src={previewUrl}
          className="flex-1 border-none bg-white"
          sandbox=""
          title="HTML Preview"
        />
      )}

      {/* Markdown Preview */}
      {showPreview && md && (
        <div className="flex-1 overflow-y-auto bg-background px-8 py-6">
          <div className="mx-auto max-w-3xl prose dark:prose-invert prose-sm prose-headings:font-semibold prose-h1:text-2xl prose-h1:border-b prose-h1:border-border prose-h1:pb-2 prose-h2:text-xl prose-h3:text-lg prose-p:leading-relaxed prose-li:leading-relaxed prose-pre:p-0 prose-pre:bg-transparent prose-img:rounded-lg prose-hr:border-border">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code({ className, children, ...props }) {
                  const match = /language-(\w+)/.exec(className || '');
                  const code = String(children).replace(/\n$/, '');
                  if (match) {
                    return (
                      <div className="not-prose my-3 rounded-lg border border-border overflow-hidden max-w-full">
                        <div className="flex items-center justify-between bg-muted/60 px-3 py-1.5">
                          <span className="text-[10px] font-mono font-medium text-muted-foreground uppercase tracking-wide">{match[1]}</span>
                        </div>
                        <CodeBlock code={code} language={match[1]} />
                      </div>
                    );
                  }
                  return (
                    <code className="rounded-md bg-muted/70 px-1.5 py-0.5 text-xs font-mono text-foreground/90 before:content-none after:content-none" {...props}>
                      {children}
                    </code>
                  );
                },
                pre({ children }) {
                  return <>{children}</>;
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
                a({ href, children }) {
                  return (
                    <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80 underline underline-offset-2 decoration-primary/30">
                      {children}
                    </a>
                  );
                },
              }}
            >
              {dirty ? draft : content}
            </ReactMarkdown>
          </div>
        </div>
      )}

      {/* Source Editor */}
      {showEditor && (
        <div className="relative flex flex-1 min-h-0 overflow-hidden">
          <div
            ref={lineNumRef}
            className="flex-shrink-0 overflow-hidden select-none border-r border-border/40 bg-muted/20 py-3 text-right font-mono text-[11px] leading-[1.6] text-muted-foreground/30"
            aria-hidden
          >
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i} className="px-3">{i + 1}</div>
            ))}
          </div>
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => { if (!readonly) setDraft(e.target.value); }}
            onScroll={syncScroll}
            onKeyDown={readonly ? undefined : handleKeyDown}
            readOnly={readonly}
            spellCheck={false}
            className="flex-1 resize-none bg-transparent py-3 pl-4 pr-3 font-mono text-[11px] leading-[1.6] text-foreground caret-foreground focus:outline-none"
          />
        </div>
      )}

      {/* Footer */}
      {(content !== null || image) && (
        <div className="relative flex items-center gap-3 border-t border-border/60 bg-card/90 px-3 py-1 text-[10px] text-muted-foreground/60">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/10 to-transparent" />
          {image ? (
            <>
              <span className="font-medium">Image</span>
              <span>{filePath.split('.').pop()?.toUpperCase()}</span>
            </>
          ) : showPreview ? (
            <>
              <span className="font-medium">{html ? t('viewer.htmlPreview') : t('viewer.mdPreview')}</span>
              {dirty && <span className="text-orange-500">{t('viewer.previewUnsaved')}</span>}
            </>
          ) : (
            <>
              <span>{t('viewer.lines')} <span className="font-medium text-foreground/60">{lineCount}</span></span>
              <span>{t('viewer.chars')} <span className="font-medium text-foreground/60">{draft.length}</span></span>
            </>
          )}
          <div className="flex-1" />
          <span className="font-medium">{langLabel}</span>
        </div>
      )}
    </div>
  );
}
