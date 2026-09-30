import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Search, ArrowLeft, Loader2, Wrench, FileText, ChevronRight, Trash2, Lock, User, X, Globe, Settings, CheckSquare, Square, FolderUp, Info } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  deleteUserTool, uploadUserTool,
  listToolFiles, readToolFile,
  publishTool, unpublishTool,
  type ToolSummary,
} from '../../api/manager';
import { useT } from '../../i18n';
import { useLibraryStore } from '../../stores/library';
import { useUIStore } from '../../stores/ui';
import { useAgentStore } from '../../stores/agent';
import FileExplorer, { type FileOps } from '../sidebar/FileExplorer';

/* 閳光偓閳光偓閳光偓 Tool Detail View 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓 */

function ToolDetailView({
  tool,
  onBack,
  onUpdated,
}: {
  tool: ToolSummary;
  onBack: () => void;
  onUpdated?: () => void;
}) {
  const t = useT();
  const source = (tool.source || 'preset') as 'preset' | 'public' | 'user';
  const isUser = source === 'user';

  // Publish state
  const [publishingTool, setPublishingTool] = useState(false);
  const allTools = useLibraryStore((s) => s.tools);
  const publicTools = useMemo(() => allTools.filter((t) => t.source === 'public'), [allTools]);
  const isToolPublished = useMemo(
    () => isUser && publicTools.some((t) => t.dirName === tool.dirName),
    [isUser, publicTools, tool.dirName],
  );

  const handleTogglePublishTool = async () => {
    setPublishingTool(true);
    try {
      if (isToolPublished) {
        await unpublishTool(tool.dirName);
      } else {
        await publishTool(tool.dirName);
      }
      useLibraryStore.getState().fetchTools(true);
      onUpdated?.();
      toast.success(isToolPublished ? t('shared.unpublish') : t('shared.published'));
    } catch (err) {
      toast.error(isToolPublished ? t('shared.unpublish') : t('shared.publish'), { description: err instanceof Error ? err.message : undefined });
    }
    finally { setPublishingTool(false); }
  };

  // File content preview state
  const [openFile, setOpenFile] = useState<{ path: string; content: string } | null>(null);
  const [openFileLoading, setOpenFileLoading] = useState(false);

  // Build FileOps for tool files (read-only)
  const toolFileOps: FileOps = useMemo(() => ({
    listFiles: (dirPath) => listToolFiles(source, tool.dirName, dirPath),
    createFile: async () => {},
    createDir: async () => {},
    renamePath: async () => {},
    deletePath: async () => {},
    uploadFiles: async () => {},
  }), [source, tool.dirName]);

  const openFileContent = async (filePath: string) => {
    setOpenFileLoading(true);
    try {
      const content = await readToolFile(source, tool.dirName, filePath);
      setOpenFile({ path: filePath, content });
    } catch {
      setOpenFile({ path: filePath, content: '' });
    } finally {
      setOpenFileLoading(false);
    }
  };

  // Auto-open setting.json on first mount
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current) return;
    autoOpened.current = true;
    openFileContent('setting.json');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openFileIsJson = openFile ? /\.json$/i.test(openFile.path) : false;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border/70 px-6 py-4">
        <Button variant="outline" size="sm" onClick={onBack} className="gap-1.5 rounded-full">
          <ArrowLeft className="size-4" />
          {t('toolLib.back')}
        </Button>
        <div className="flex-1" />
        {isUser && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleTogglePublishTool}
            disabled={publishingTool}
            className={`gap-1.5 rounded-full ${isToolPublished ? 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400' : ''}`}
          >
            <Globe className="size-3.5" />
            {publishingTool
              ? (isToolPublished ? t('shared.unpublishing') : t('shared.publishing'))
              : (isToolPublished ? t('shared.unpublish') : t('shared.publish'))
            }
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-6 py-8">
          <div className="card-premium relative mb-8 overflow-hidden rounded-[30px] p-6 sm:p-7">
            <div className="absolute -top-8 left-8 size-32 rounded-full bg-sky-500/8 blur-3xl" />
            <div className="relative flex items-start gap-5">
              <div className="flex size-14 shrink-0 items-center justify-center rounded-[24px] border border-border/70 bg-gradient-to-br from-white to-muted/80 text-sky-500 shadow-md dark:from-muted/60 dark:to-muted/30">
                <Wrench className="size-7" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1.5">
                  {tool.source && (
                    <span className={`inline-flex items-center gap-1 rounded-full border border-border/70 px-3 py-1 text-[10px] font-medium shadow-sm ${
                      tool.source === 'user'
                        ? 'bg-primary/8 text-primary/80'
                        : tool.source === 'public'
                          ? 'bg-blue-500/8 text-blue-600 dark:text-blue-400'
                          : 'bg-muted/60 text-muted-foreground'
                    }`}>
                      {tool.source === 'preset' ? <Lock className="size-2.5" /> : tool.source === 'public' ? <Globe className="size-2.5" /> : <User className="size-2.5" />}
                      {t(`toolLib.${tool.source}`)}
                    </span>
                  )}
                  {isToolPublished && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                      <Globe className="size-2.5" />
                      {t('shared.published')}
                    </span>
                  )}
                </div>
                <h1 className="text-3xl font-semibold tracking-[-0.04em] text-foreground">{tool.name}</h1>
                {tool.description && (
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{tool.description}</p>
                )}
              </div>
            </div>
          </div>

          {/* File Browser */}
            <section className="mb-6 overflow-hidden rounded-[24px] border border-border bg-card shadow-sm dark:bg-card">
            <FileExplorer
              fileOps={toolFileOps}
              onFileSelect={openFileContent}
              readonly
            />
          </section>

          {/* Open file content area */}
          {openFileLoading && (
            <section className="mb-6">
              <div className="flex items-center justify-center rounded-[24px] border border-border bg-card py-8 shadow-sm dark:bg-card">
                <Loader2 className="size-4 animate-spin text-sky-500 mr-2" />
                <span className="text-xs text-muted-foreground">{t('skill.loading')}</span>
              </div>
            </section>
          )}

          {openFile && !openFileLoading && (
            <section className="mb-6">
              {/* File header */}
              <div className="flex items-center gap-2 mb-2">
                <FileText className="size-4 text-muted-foreground" />
                <span className="text-sm font-medium text-foreground flex-1 truncate">{openFile.path}</span>
                <Button variant="ghost" size="sm" onClick={() => setOpenFile(null)} className="h-8 gap-1 rounded-full px-3 text-xs">
                  <X className="size-3" />
                </Button>
              </div>

              {/* File content */}
              <div className="overflow-hidden rounded-[24px] border border-border bg-card shadow-sm dark:bg-card">
                {openFileIsJson ? (
                  <pre className="p-4 text-sm font-mono text-foreground/80 overflow-x-auto whitespace-pre-wrap break-words">
                    {(() => { try { return JSON.stringify(JSON.parse(openFile.content), null, 2); } catch { return openFile.content; } })()}
                  </pre>
                ) : (
                  <pre className="p-4 text-sm font-mono text-foreground/80 overflow-x-auto whitespace-pre-wrap break-words">
                    {openFile.content}
                  </pre>
                )}
              </div>
            </section>
          )}

          {/* Used by profiles */}
          {(() => {
            const profiles = useAgentStore.getState().profiles;
            const usedBy = profiles.filter((p) => p.tools?.includes(tool.dirName));
            if (usedBy.length === 0) return null;
            return (
              <section className="mb-6">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-3">
                  <Info className="size-4 text-muted-foreground" />
                  {t('toolLib.usedBy')}
                </h2>
                <div className="flex flex-wrap gap-2">
                  {usedBy.map((p) => (
                    <span key={p.fileName} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground/80 shadow-sm dark:bg-card">
                      {p.name}
                    </span>
                  ))}
                </div>
              </section>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

/* 閳光偓閳光偓閳光偓 Tool Card 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓 */

function ToolCard({
  tool,
  onClick,
  onDelete,
  batchMode,
  selected,
  published,
  onUnpublish,
}: {
  tool: ToolSummary;
  onClick: () => void;
  onDelete?: (e: React.MouseEvent) => void;
  batchMode?: boolean;
  selected?: boolean;
  published?: boolean;
  onUnpublish?: (e: React.MouseEvent) => void;
}) {
  const t = useT();
  return (
    <Card
      onClick={onClick}
      className={`group relative h-[150px] cursor-pointer gap-0 overflow-hidden rounded-[26px] border p-0 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-sky-500/8 ${batchMode && selected ? 'border-primary/40 ring-2 ring-primary' : 'border-border bg-card dark:bg-card'}`}
    >
      {/* Top accent */}
      <div className="h-1 w-full bg-gradient-to-r from-sky-500/50 to-transparent" />

      {/* Batch mode checkbox */}
      {batchMode && (
        <div className="absolute top-2.5 left-2.5 z-10 flex size-6 items-center justify-center">
          {selected ? (
            <CheckSquare className="size-5 text-primary" />
          ) : (
            <Square className="size-5 text-muted-foreground/50" />
          )}
        </div>
      )}

      {/* Delete button for user tools */}
      {!batchMode && onDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(e); }}
          className="absolute right-3 top-3 z-10 flex size-7 items-center justify-center rounded-full border border-red-500/15 bg-red-500/10 text-red-500 opacity-0 transition-all duration-200 group-hover:opacity-100 hover:bg-red-500/20"
        >
          <Trash2 className="size-3" />
        </button>
      )}

      {/* Published badge 閳?clickable to unpublish */}
      {!batchMode && published && (
        <button
          onClick={(e) => { e.stopPropagation(); onUnpublish?.(e); }}
          className="absolute top-3 left-3 z-10 inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 transition-colors hover:border-red-500/20 hover:bg-red-500/10 hover:text-red-500"
          title={t('shared.unpublish')}
        >
          <Globe className="size-2.5" />
          {t('shared.published')}
        </button>
      )}

      <div className="flex h-[calc(100%-4px)] flex-col p-5">
        {/* Row 1: icon + name + arrow */}
        <div className="flex items-center gap-3 min-w-0 shrink-0">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-border/70 bg-gradient-to-br from-white to-muted/80 text-sky-500 shadow-sm transition-transform duration-300 group-hover:scale-110 group-hover:shadow-md dark:from-muted/60 dark:to-muted/30">
            <Wrench className="size-4" />
          </div>
          <h3 className="flex-1 min-w-0 text-sm font-bold text-foreground leading-tight truncate">
            {tool.name}
          </h3>
          <ChevronRight className="size-4 text-muted-foreground/30 shrink-0 transition-all duration-200 group-hover:text-sky-500/60 group-hover:translate-x-0.5" />
        </div>

        {/* Row 2: description */}
        {tool.description && (
          <p className="text-xs leading-relaxed text-muted-foreground/70 line-clamp-3 mt-2.5 flex-1">
            {tool.description}
          </p>
        )}
      </div>
    </Card>
  );
}

/* 閳光偓閳光偓閳光偓 Source Tab 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓 */

type SourceTab = 'preset' | 'public' | 'user';
type FileWithWebkitPath = File & { webkitRelativePath?: string; directory?: string; webkitdirectory?: string };

/* 閳光偓閳光偓閳光偓 Main Panel 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓 */

export default function ToolLibraryPanel() {
  const t = useT();
  const summaries = useLibraryStore((s) => s.tools);
  const loading = useLibraryStore((s) => s.toolsLoading);
  const fetchSummaries = useLibraryStore((s) => s.fetchTools);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ToolSummary | null>(null);
  const [sourceTab, setSourceTab] = useState<SourceTab>('preset');
  const [batchMode, setBatchMode] = useState(false);
  const [batchSelected, setBatchSelected] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const folderInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { fetchSummaries(); }, [fetchSummaries]);

  // Handle pending navigation from profile detail
  const pendingToolDirName = useUIStore((s) => s.pendingToolDirName);
  const setPendingToolDirName = useUIStore((s) => s.setPendingToolDirName);
  useEffect(() => {
    if (pendingToolDirName && summaries.length > 0) {
      const target = summaries.find((t) => t.dirName === pendingToolDirName);
      if (target) {
        const src = (target.source || 'preset') as SourceTab;
        setSourceTab(src);
        setSelected(target);
      }
      setPendingToolDirName(null);
    }
  }, [pendingToolDirName, summaries, setPendingToolDirName]);

  // Split by source
  const presetTools = useMemo(() => summaries.filter((s) => s.source === 'preset' || (!s.source)), [summaries]);
  const publicTools = useMemo(() => summaries.filter((s) => s.source === 'public'), [summaries]);
  const userTools = useMemo(() => summaries.filter((s) => s.source === 'user'), [summaries]);
  const currentTools = sourceTab === 'preset' ? presetTools : sourceTab === 'public' ? publicTools : userTools;

  // Published tool lookup (user tools that also exist in public)
  const publishedToolDirNames = useMemo(() => new Set(publicTools.map((t) => t.dirName)), [publicTools]);

  const filtered = useMemo(() => {
    if (!search) return currentTools;
    const keywords = search.toLowerCase().split(/\s+/).filter(Boolean);
    return currentTools.filter((s) => {
      const text = `${s.name} ${s.description}`.toLowerCase();
      return keywords.every((kw) => text.includes(kw));
    });
  }, [currentTools, search]);

  const handleDelete = async (tool: ToolSummary) => {
    if (!confirm(t('toolLib.confirmDelete').replace('{name}', tool.name))) return;
    try {
      await deleteUserTool(tool.dirName);
      toast.success(t('file.delete'));
      fetchSummaries(true);
    } catch (err) {
      toast.error(t('file.delete'), { description: err instanceof Error ? err.message : undefined });
    }
  };

  const handleUnpublishTool = async (tool: ToolSummary) => {
    try {
      await unpublishTool(tool.dirName);
      toast.success(t('shared.unpublish'));
      fetchSummaries(true);
    } catch (err) {
      toast.error(t('shared.unpublish'), { description: err instanceof Error ? err.message : undefined });
    }
  };

  const handleBatchDelete = async () => {
    if (batchSelected.size === 0) return;
    if (!confirm(t('toolLib.confirmBatchDelete').replace('{n}', String(batchSelected.size)))) return;
    const items = Array.from(batchSelected);
    try {
      await Promise.all(items.map((dirName) => deleteUserTool(dirName)));
      toast.success(t('toolLib.batchDelete'));
    } catch (err) {
      toast.error(t('toolLib.batchDelete'), { description: err instanceof Error ? err.message : undefined });
    }
    setBatchMode(false);
    setBatchSelected(new Set());
    fetchSummaries(true);
  };

  const toggleBatchItem = (dirName: string) => {
    setBatchSelected((prev) => {
      const next = new Set(prev);
      if (next.has(dirName)) next.delete(dirName);
      else next.add(dirName);
      return next;
    });
  };

  const exitBatchMode = () => {
    setBatchMode(false);
    setBatchSelected(new Set());
  };

  const handleFolderUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // Derive tool name from the common top-level folder
    const firstPath = (files[0] as FileWithWebkitPath).webkitRelativePath || files[0].name;
    const dirName = firstPath.split('/')[0] || `tool_${Date.now()}`;

    const items: { file: globalThis.File; relativePath: string }[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const relPath = ((file as FileWithWebkitPath).webkitRelativePath) || file.name;
      // Strip the top-level folder from the relative path since dirName already is that folder
      const parts = relPath.split('/');
      const innerPath = parts.slice(1).join('/');
      if (innerPath) {
        items.push({ file, relativePath: innerPath });
      }
    }

    if (items.length === 0) {
      // Reset
      e.target.value = '';
      return;
    }

    setUploading(true);
    try {
      await uploadUserTool(dirName, items);
      toast.success(t('file.uploadComplete'));
      setSourceTab('user');
      fetchSummaries(true);
    } catch (err) {
      toast.error(t('toolLib.uploading'), { description: err instanceof Error ? err.message : undefined });
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  // Detail view
  if (selected) {
    return <ToolDetailView tool={selected} onBack={() => setSelected(null)} onUpdated={() => fetchSummaries(true)} />;
  }

  // List view
  return (
    <div className="flex h-full flex-col bg-transparent">
      {/* Hidden folder input */}
      <input
        ref={folderInputRef}
        type="file"
        className="hidden"
        onChange={handleFolderUpload}
        {...({ webkitdirectory: '', directory: '' } as Record<'webkitdirectory' | 'directory', string>)}
      />

      <div className="px-6 pb-3 pt-5">
        <div className="card-dashboard rounded-[28px] p-5">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-0.5 rounded-full border border-border/70 bg-card p-1 shadow-sm dark:bg-card">
            {(['preset', 'public', 'user'] as const).map((tab) => {
              const icon = tab === 'preset' ? Lock : tab === 'public' ? Globe : User;
              const Icon = icon;
              const count = tab === 'preset' ? presetTools.length : tab === 'public' ? publicTools.length : userTools.length;
              return (
                <button
                  key={tab}
                  onClick={() => { setSourceTab(tab); if (tab !== 'user') exitBatchMode(); }}
                        className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-medium transition-all duration-200 ${
                    sourceTab === tab
                            ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Icon className="size-3" />
                  {t(`toolLib.${tab}`)}
                  <span className="text-[10px] tabular-nums text-muted-foreground/50">{count}</span>
                </button>
              );
            })}
                </div>
                {sourceTab === 'user' && !batchMode && userTools.length > 0 && (
                  <Button variant="outline" size="sm" onClick={() => setBatchMode(true)} className="h-9 gap-1.5 rounded-full text-xs">
                    <Settings className="size-3" />
                    {t('toolLib.manage')}
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={() => folderInputRef.current?.click()}
                  disabled={uploading}
                  className="h-9 gap-1.5 rounded-full text-xs bg-gradient-to-r from-sky-500 to-sky-600 text-white shadow-sm hover:shadow-md hover:shadow-sky-500/20 dark:from-sky-400 dark:to-sky-500"
                >
                  {uploading ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <FolderUp className="size-3.5" />
                  )}
                  {uploading ? t('toolLib.uploading') : t('toolLib.new')}
                </Button>
              </div>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
              <Input
                type="text"
                placeholder={t('toolLib.search')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-11 rounded-2xl border-border/70 bg-card5 pl-9 shadow-sm focus:bg-white dark:bg-card"
              />
            </div>
          </div>
        </div>
      </div>

      {batchMode && sourceTab === 'user' && (
        <div className="px-6 pb-3">
          <div className="flex items-center gap-2 rounded-[22px] border border-border/70 bg-card px-4 py-3 shadow-sm dark:bg-card">
            <button
              onClick={() => {
                if (batchSelected.size === filtered.length) {
                  setBatchSelected(new Set());
                } else {
                  setBatchSelected(new Set(filtered.map((s) => s.dirName)));
                }
              }}
              className="text-xs text-primary hover:text-primary/80 transition-colors shrink-0"
            >
              {batchSelected.size === filtered.length && filtered.length > 0 ? t('toolLib.deselectAll') : t('toolLib.selectAll')}
            </button>
            <span className="text-xs text-muted-foreground">
              {t('toolLib.selected').replace('{n}', String(batchSelected.size))}
            </span>
            <div className="flex-1" />
            <Button
              variant="destructive"
              size="sm"
              onClick={handleBatchDelete}
              disabled={batchSelected.size === 0}
              className="h-7 text-xs gap-1.5"
            >
              <Trash2 className="size-3" />
              {t('toolLib.batchDelete')}
            </Button>
            <Button variant="ghost" size="sm" onClick={exitBatchMode} className="h-7 text-xs">
              {t('toolLib.cancelManage')}
            </Button>
          </div>
        </div>
      )}

      {/* Card grid */}
      <div className="flex-1 overflow-y-auto px-6 pt-2 pb-6">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="size-5 animate-spin text-sky-500 mr-2" />
            <span className="text-sm text-muted-foreground">{t('skill.loading')}</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-card shadow-sm dark:bg-card">
              {sourceTab === 'user' ? <User className="size-5 text-muted-foreground/30" /> : <Search className="size-5 text-muted-foreground/30" />}
            </div>
            <p className="text-sm text-muted-foreground/60">
              {sourceTab === 'user' && !search ? t('toolLib.noUserTools') : search ? t('toolLib.noMatch') : t('toolLib.emptyHint')}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((tool) => (
              <ToolCard
                key={`${tool.source}-${tool.dirName}`}
                tool={tool}
                onClick={() => {
                  if (batchMode && tool.source === 'user') {
                    toggleBatchItem(tool.dirName);
                  } else {
                    setSelected(tool);
                  }
                }}
                onDelete={tool.source === 'user' ? () => handleDelete(tool) : undefined}
                batchMode={batchMode && tool.source === 'user'}
                selected={batchSelected.has(tool.dirName)}
                published={tool.source === 'user' && publishedToolDirNames.has(tool.dirName)}
                onUnpublish={tool.source === 'user' && publishedToolDirNames.has(tool.dirName) ? () => handleUnpublishTool(tool) : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
