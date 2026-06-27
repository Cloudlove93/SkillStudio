import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Search, ArrowLeft, Loader2, BookOpen, FileText, ChevronRight, Trash2, Lock, User, Pencil, X, Save, Plus, Scale, Monitor, Tag, Wrench, Info, Globe, Settings, CheckSquare, Square, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  getSkillDetail, deleteUserSkill, updateUserSkill, createUserSkill,
  listSkillFiles, readSkillFile, writeSkillFile, uploadSkillFiles,
  createSkillFile, createSkillDir, deleteSkillPath, renameSkillPath,
  publishSkill, unpublishSkill,
  type SkillSummary, type SkillDetail,
} from '../../api/manager';
import { useT } from '../../i18n';
import { useLibraryStore } from '../../stores/library';
import { useUIStore } from '../../stores/ui';
import { useAgentStore } from '../../stores/agent';
import { useOptimizeStore } from '../../stores/optimize';
import FileExplorer, { type FileOps } from '../sidebar/FileExplorer';

/* 閳光偓閳光偓閳光偓 SKILL.md frontmatter parser 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓 */

interface SkillFrontmatter {
  name?: string;
  description?: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  'allowed-tools'?: string;
}

function parseSkillMd(raw: string): { frontmatter: SkillFrontmatter; body: string } {
  const fm: SkillFrontmatter = {};
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: fm, body: raw };

  const yamlBlock = match[1];
  const body = match[2];

  // Simple line-by-line YAML parser (handles flat keys + one-level nested map for metadata)
  let metadataMap: Record<string, string> | null = null;

  for (const line of yamlBlock.split('\n')) {
    // Nested metadata value (indented)
    if (metadataMap !== null && /^\s{2,}\S/.test(line)) {
      const kv = line.trim().match(/^([^:]+):\s*(.*)$/);
      if (kv) metadataMap[kv[1].trim()] = kv[2].replace(/^["']|["']$/g, '').trim();
      continue;
    }
    // End of metadata block if we hit a non-indented line
    if (metadataMap !== null) {
      fm.metadata = metadataMap;
      metadataMap = null;
    }

    const kv = line.match(/^([a-z][\w-]*):\s*(.*)$/i);
    if (!kv) continue;
    const key = kv[1].trim();
    const val = kv[2].replace(/^["']|["']$/g, '').trim();

    if (key === 'metadata' && !val) {
      metadataMap = {};
    } else {
      (fm as Record<string, unknown>)[key] = val;
    }
  }
  if (metadataMap) fm.metadata = metadataMap;

  return { frontmatter: fm, body };
}

/* 閳光偓閳光偓閳光偓 SKILL.md structured renderer 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓 */

function SkillMdRenderer({ content }: { content: string }) {
  const { frontmatter: fm, body } = useMemo(() => parseSkillMd(content), [content]);
  const hasFrontmatter = !!(fm.name || fm.description || fm.license || fm.compatibility || fm.metadata || fm['allowed-tools']);

  return (
    <div className="space-y-5">
      {/* Frontmatter metadata cards */}
      {hasFrontmatter && (
        <div className="space-y-3">
          {/* Name + Description */}
          {(fm.name || fm.description) && (
            <div className="rounded-lg border border-border/40 bg-muted/20 p-4">
              {fm.name && (
                <div className="flex items-center gap-2 mb-1">
                  <Tag className="size-3.5 text-emerald-500 shrink-0" />
                  <code className="text-sm font-semibold text-foreground">{fm.name}</code>
                </div>
              )}
              {fm.description && (
                <p className="text-sm leading-relaxed text-muted-foreground mt-1.5 pl-[22px]">{fm.description}</p>
              )}
            </div>
          )}

          {/* Optional fields grid */}
          {(fm.license || fm.compatibility || fm['allowed-tools']) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {fm.license && (
                <div className="flex items-start gap-2.5 rounded-lg border border-border/30 bg-muted/10 px-3.5 py-2.5">
                  <Scale className="size-3.5 text-amber-500 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <span className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 mb-0.5">License</span>
                    <span className="text-xs text-foreground">{fm.license}</span>
                  </div>
                </div>
              )}
              {fm.compatibility && (
                <div className="flex items-start gap-2.5 rounded-lg border border-border/30 bg-muted/10 px-3.5 py-2.5">
                  <Monitor className="size-3.5 text-blue-500 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <span className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 mb-0.5">Compatibility</span>
                    <span className="text-xs text-foreground">{fm.compatibility}</span>
                  </div>
                </div>
              )}
              {fm['allowed-tools'] && (
                <div className="flex items-start gap-2.5 rounded-lg border border-border/30 bg-muted/10 px-3.5 py-2.5 sm:col-span-2">
                  <Wrench className="size-3.5 text-violet-500 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <span className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 mb-0.5">Allowed Tools</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {fm['allowed-tools'].split(/\s+/).filter(Boolean).map((tool) => (
                        <code key={tool} className="rounded bg-violet-500/10 px-1.5 py-0.5 text-[11px] font-mono text-violet-600 dark:text-violet-400">{tool}</code>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Metadata key-value pairs */}
          {fm.metadata && Object.keys(fm.metadata).length > 0 && (
            <div className="rounded-lg border border-border/30 bg-muted/10 px-3.5 py-2.5">
              <div className="flex items-center gap-2 mb-2">
                <Info className="size-3.5 text-muted-foreground/60 shrink-0" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Metadata</span>
              </div>
              <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 pl-[22px]">
                {Object.entries(fm.metadata).map(([k, v]) => (
                  <React.Fragment key={k}>
                    <span className="text-xs text-muted-foreground font-mono">{k}</span>
                    <span className="text-xs text-foreground">{v}</span>
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Body markdown */}
      {body.trim() && (
        <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:font-semibold prose-h2:text-lg prose-h3:text-base prose-p:leading-relaxed prose-pre:p-0 prose-pre:bg-transparent prose-hr:border-border">
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
            {body}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}

/* 閳光偓閳光偓閳光偓 Skill Detail View 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓 */

function SkillDetailView({
  detail,
  onBack,
  onUpdated,
  mode = 'view',
}: {
  detail: SkillDetail;
  onBack: () => void;
  onUpdated?: (updated: SkillDetail) => void;
  mode?: 'view' | 'create';
}) {
  const t = useT();
  const isUser = detail.source === 'user';
  const isCreateMode = mode === 'create';
  const source = (detail.source || 'preset') as 'preset' | 'public' | 'user';

  // Publish state
  const [publishingSkill, setPublishingSkill] = useState(false);
  const allSkills = useLibraryStore((s) => s.skills);
  const publicSkills = useMemo(() => allSkills.filter((s) => s.source === 'public'), [allSkills]);
  const isSkillPublished = useMemo(
    () => isUser && publicSkills.some((s) => s.dirName === detail.dirName),
    [isUser, publicSkills, detail.dirName],
  );

  const handleTogglePublishSkill = async () => {
    setPublishingSkill(true);
    try {
      if (isSkillPublished) {
        await unpublishSkill(detail.dirName);
      } else {
        await publishSkill(detail.dirName);
      }
      // Refresh skill list so public tab updates
      useLibraryStore.getState().fetchSkills(true);
      onUpdated?.({ ...detail });
      toast.success(isSkillPublished ? t('shared.unpublish') : t('shared.published'));
    } catch (err) {
      toast.error(isSkillPublished ? t('shared.unpublish') : t('shared.publish'), { description: err instanceof Error ? err.message : undefined });
    }
    finally { setPublishingSkill(false); }
  };

  // Hero editing state
  const [editing, setEditing] = useState(isCreateMode);
  const [saving, setSaving] = useState(false);
  const createSkillRun = useOptimizeStore((s) => s.createSkillRun);
  const optimizationCreating = useOptimizeStore((s) => s.creating);
  const [editName, setEditName] = useState(detail.name);
  const [editDesc, setEditDesc] = useState(detail.description);
  const [editContent, setEditContent] = useState(detail.content);

  // File content preview state
  const [openFile, setOpenFile] = useState<{ path: string; content: string; dirty: boolean } | null>(null);
  const [openFileLoading, setOpenFileLoading] = useState(false);
  const [fileSaving, setFileSaving] = useState(false);

  // Build FileOps for skill files
  const skillFileOps: FileOps = useMemo(() => ({
    listFiles: (dirPath) => listSkillFiles(source, detail.dirName, dirPath),
    createFile: (filePath) => createSkillFile(detail.dirName, filePath),
    createDir: (dirPath) => createSkillDir(detail.dirName, dirPath),
    renamePath: (oldP, newP) => renameSkillPath(detail.dirName, oldP, newP),
    deletePath: (path) => deleteSkillPath(detail.dirName, path),
    uploadFiles: (dir, files) => uploadSkillFiles(detail.dirName, dir, files),
  }), [source, detail.dirName]);

  const openFileContent = async (filePath: string) => {
    setOpenFileLoading(true);
    try {
      const content = await readSkillFile(source, detail.dirName, filePath);
      setOpenFile({ path: filePath, content, dirty: false });
    } catch {
      setOpenFile({ path: filePath, content: '', dirty: false });
    } finally {
      setOpenFileLoading(false);
    }
  };

  // Auto-open SKILL.md on first mount (non-create mode)
  const autoOpened = useRef(false);
  useEffect(() => {
    if (isCreateMode || autoOpened.current) return;
    autoOpened.current = true;
    openFileContent('SKILL.md');
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const handleFileSave = async () => {
    if (!openFile || !openFile.dirty) return;
    setFileSaving(true);
    try {
      await writeSkillFile(detail.dirName, openFile.path, openFile.content);
      setOpenFile({ ...openFile, dirty: false });
      // If saving SKILL.md, sync hero name/description from frontmatter
      if (openFile.path === 'SKILL.md') {
        const { frontmatter } = parseSkillMd(openFile.content);
        if (frontmatter.name) {
          onUpdated?.({
            ...detail,
            name: frontmatter.name,
            content: openFile.content,
            description: frontmatter.description ?? detail.description,
          });
        }
      }
    } catch (err) { toast.error(t('skill.saveFile'), { description: err instanceof Error ? err.message : undefined }); }
    finally { setFileSaving(false); }
  };

  const startEditing = () => {
    setEditName(detail.name);
    setEditDesc(detail.description);
    setEditing(true);
  };

  const cancelEditing = () => {
    if (isCreateMode) {
      onBack();
    } else {
      setEditing(false);
    }
  };

  const handleSave = async () => {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      if (isCreateMode) {
        const dirName = editName.trim().replace(/\s+/g, '_');
        await createUserSkill(dirName, editName, editDesc, editContent);
        toast.success(t('skill.saveSuccess'));
        onBack();
        onUpdated?.({ dirName, name: editName, description: editDesc, content: editContent, source: 'user' });
      } else {
        const res = await updateUserSkill(detail.dirName, editName, editDesc, detail.content);
        const newDirName = res.dirName ?? detail.dirName;
        toast.success(t('skill.saveSuccess'));
        setEditing(false);
        onUpdated?.({
          ...detail,
          dirName: newDirName,
          name: editName,
          description: editDesc,
        });
      }
    } catch (err) { toast.error(t('skill.save'), { description: err instanceof Error ? err.message : undefined }); }
    finally { setSaving(false); }
  };

  const isSkillMd = openFile?.path === 'SKILL.md';
  const openFileIsMarkdown = openFile ? /\.(md|mdx)$/.test(openFile.path) : false;

  return (
      <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border/70 px-6 py-4">
        <Button variant="outline" size="sm" onClick={onBack} className="gap-1.5 rounded-full">
          <ArrowLeft className="size-4" />
          {t('skill.back')}
        </Button>
        <div className="flex-1" />
        {!isCreateMode && !editing && (
          <Button variant="outline" size="sm" onClick={() => void createSkillRun(detail.dirName)} disabled={optimizationCreating} className="gap-1.5 rounded-full">
            <Sparkles className="size-3.5" />
            {t('optimize.action')}
          </Button>
        )}
        {isUser && !editing && (
          <>
          <Button
            variant="outline"
            size="sm"
            onClick={handleTogglePublishSkill}
            disabled={publishingSkill}
            className={`gap-1.5 rounded-full ${isSkillPublished ? 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400' : ''}`}
          >
            <Globe className="size-3.5" />
            {publishingSkill
              ? (isSkillPublished ? t('shared.unpublishing') : t('shared.publishing'))
              : (isSkillPublished ? t('shared.unpublish') : t('shared.publish'))
            }
          </Button>
          <Button variant="outline" size="sm" onClick={startEditing} className="gap-1.5 rounded-full">
            <Pencil className="size-3.5" />
            {t('skill.edit')}
          </Button>
          </>
        )}
        {editing && (
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={cancelEditing} className="gap-1.5 rounded-full">
              <X className="size-3.5" />
              {t('skill.cancel')}
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1.5 rounded-full">
              <Save className="size-3.5" />
              {t('skill.save')}
            </Button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-6 py-8">
          <div className="card-premium relative mb-8 overflow-hidden rounded-[30px] p-6 sm:p-7">
            <div className="absolute -top-8 left-8 size-32 rounded-full bg-emerald-500/8 blur-3xl" />
            <div className="relative flex items-start gap-5">
              <div className="flex size-14 shrink-0 items-center justify-center rounded-[24px] border border-border/70 bg-gradient-to-br from-white to-muted/80 text-emerald-500 shadow-md dark:from-muted/60 dark:to-muted/30">
                <BookOpen className="size-7" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1.5">
                  {detail.source && (
                    <span className={`inline-flex items-center gap-1 rounded-full border border-border/70 px-3 py-1 text-[10px] font-medium shadow-sm ${
                      detail.source === 'user'
                        ? 'bg-primary/8 text-primary/80'
                        : detail.source === 'public'
                          ? 'bg-blue-500/8 text-blue-600 dark:text-blue-400'
                          : 'bg-muted/60 text-muted-foreground'
                    }`}>
                      {detail.source === 'preset' ? <Lock className="size-2.5" /> : detail.source === 'public' ? <Globe className="size-2.5" /> : <User className="size-2.5" />}
                      {t(`skill.${detail.source}`)}
                    </span>
                  )}
                  {isSkillPublished && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                      <Globe className="size-2.5" />
                      {t('shared.published')}
                    </span>
                  )}
                </div>
                {editing ? (
                  <>
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="text-xl font-bold mb-2"
                    />
                    <Input
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      className="text-sm"
                    />
                  </>
                ) : (
                  <>
                    <h1 className="text-3xl font-semibold tracking-[-0.04em] text-foreground">{detail.name}</h1>
                    {detail.description && (
                      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{detail.description}</p>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* File Browser */}
          {!isCreateMode && (
            <section className="mb-6 overflow-hidden rounded-[24px] border border-border bg-card shadow-sm dark:bg-card">
              <FileExplorer
                fileOps={skillFileOps}
                onFileSelect={openFileContent}
                readonly={!isUser || !editing}
              />
            </section>
          )}

          {/* Open file content area */}
          {openFileLoading && (
            <section className="mb-6">
              <div className="flex items-center justify-center rounded-[24px] border border-border bg-card py-8 shadow-sm dark:bg-card">
                <Loader2 className="size-4 animate-spin text-emerald-500 mr-2" />
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
                {isUser && editing && openFile.dirty && (
                <Button size="sm" onClick={handleFileSave} disabled={fileSaving} className="h-8 gap-1 rounded-full px-3 text-xs">
                    <Save className="size-3" />
                    {fileSaving ? t('skill.loading') : t('skill.saveFile')}
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => setOpenFile(null)} className="h-8 gap-1 rounded-full px-3 text-xs">
                  <X className="size-3" />
                  {t('skill.closeFile')}
                </Button>
              </div>

              {/* File content */}
              <div className="overflow-hidden rounded-[24px] border border-border bg-card shadow-sm dark:bg-card">
                {isUser && editing ? (
                  <Textarea
                    value={openFile.content}
                    onChange={(e) => setOpenFile({ ...openFile, content: e.target.value, dirty: true })}
                    rows={20}
                    className="font-mono text-sm border-0 rounded-none resize-y focus-visible:ring-0"
                  />
                ) : isSkillMd ? (
                  <div className="p-5">
                    <SkillMdRenderer content={openFile.content} />
                  </div>
                ) : openFileIsMarkdown ? (
                  <div className="p-5">
                    <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:font-semibold prose-h2:text-lg prose-h3:text-base prose-p:leading-relaxed prose-pre:p-0 prose-pre:bg-transparent prose-hr:border-border">
                      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                        {openFile.content}
                      </ReactMarkdown>
                    </div>
                  </div>
                ) : (
                  <pre className="p-4 text-sm font-mono text-foreground/80 overflow-x-auto whitespace-pre-wrap break-words">
                    {openFile.content}
                  </pre>
                )}
              </div>
            </section>
          )}

          {/* Used by profiles */}
          {!isCreateMode && (() => {
            const profiles = useAgentStore.getState().profiles;
            const usedBy = profiles.filter((p) => p.skills?.includes(detail.dirName));
            if (usedBy.length === 0) return null;
            return (
              <section className="mb-6">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-3">
                  <Info className="size-4 text-muted-foreground" />
                  {t('skill.usedBy')}
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

          {/* Create mode: content textarea (legacy compat) */}
          {isCreateMode && (
            <section>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-3">
                <FileText className="size-4 text-muted-foreground" />
                {t('skill.content')}
              </h2>
              <Textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                rows={12}
                className="font-mono text-sm"
                placeholder="SKILL.md content..."
              />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

/* 閳光偓閳光偓閳光偓 Skill Card 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓 */

function SkillCard({
  skill,
  onClick,
  onDelete,
  batchMode,
  selected,
  published,
  onUnpublish,
}: {
  skill: SkillSummary;
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
      className={`group relative h-[150px] cursor-pointer gap-0 overflow-hidden rounded-[26px] border p-0 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-emerald-500/8 ${batchMode && selected ? 'border-primary/40 ring-2 ring-primary' : 'border-border bg-card dark:bg-card'}`}
    >
      <div className="h-1 w-full bg-gradient-to-r from-emerald-500/50 to-transparent" />

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

      {/* Delete button for user skills */}
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
        <div className="flex items-center gap-3 min-w-0 shrink-0">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-border/70 bg-gradient-to-br from-white to-muted/80 text-emerald-500 shadow-sm transition-transform duration-300 group-hover:scale-110 group-hover:shadow-md dark:from-muted/60 dark:to-muted/30">
            <BookOpen className="size-4" />
          </div>
          <h3 className="flex-1 min-w-0 text-sm font-bold text-foreground leading-tight truncate">
            {skill.name}
          </h3>
          <ChevronRight className="size-4 text-muted-foreground/30 shrink-0 transition-all duration-200 group-hover:text-emerald-500/60 group-hover:translate-x-0.5" />
        </div>

        {skill.description && (
          <p className="text-xs leading-relaxed text-muted-foreground/70 line-clamp-3 mt-2.5 flex-1">
            {skill.description}
          </p>
        )}
      </div>
    </Card>
  );
}

/* 閳光偓閳光偓閳光偓 Source Tab 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓 */

type SourceTab = 'preset' | 'public' | 'user';

/* 閳光偓閳光偓閳光偓 Main Panel 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓 */

export default function SkillLibraryPanel() {
  const t = useT();
  const summaries = useLibraryStore((s) => s.skills);
  const loading = useLibraryStore((s) => s.skillsLoading);
  const fetchSummaries = useLibraryStore((s) => s.fetchSkills);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<SkillDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [sourceTab, setSourceTab] = useState<SourceTab>('preset');
  const [creating, setCreating] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [batchSelected, setBatchSelected] = useState<Set<string>>(new Set());

  useEffect(() => { fetchSummaries(); }, [fetchSummaries]);

  // Split by source
  const presetSkills = useMemo(() => summaries.filter((s) => s.source === 'preset' || (!s.source)), [summaries]);
  const publicSkills = useMemo(() => summaries.filter((s) => s.source === 'public'), [summaries]);
  const userSkills = useMemo(() => summaries.filter((s) => s.source === 'user'), [summaries]);
  const currentSkills = sourceTab === 'preset' ? presetSkills : sourceTab === 'public' ? publicSkills : userSkills;

  // Published skill lookup (user skills that also exist in public)
  const publishedSkillDirNames = useMemo(() => new Set(publicSkills.map((s) => s.dirName)), [publicSkills]);

  const filtered = useMemo(() => {
    if (!search) return currentSkills;
    const keywords = search.toLowerCase().split(/\s+/).filter(Boolean);
    return currentSkills.filter((s) => {
      const text = `${s.name} ${s.description}`.toLowerCase();
      return keywords.every((kw) => text.includes(kw));
    });
  }, [currentSkills, search]);

  const handleSelect = async (summary: SkillSummary) => {
    setDetailLoading(true);
    try {
      const detail = await getSkillDetail(summary.dirName);
      setSelected(detail);
    } catch {
      setSelected({ ...summary, content: '' });
    } finally {
      setDetailLoading(false);
    }
  };

  // Handle pending navigation from profile detail
  const pendingSkillDirName = useUIStore((s) => s.pendingSkillDirName);
  const setPendingSkillDirName = useUIStore((s) => s.setPendingSkillDirName);
  useEffect(() => {
    if (pendingSkillDirName && summaries.length > 0) {
      const target = summaries.find((s) => s.dirName === pendingSkillDirName);
      if (target) {
        const src = (target.source || 'preset') as SourceTab;
        setSourceTab(src);
        handleSelect(target);
      }
      setPendingSkillDirName(null);
    }
  }, [pendingSkillDirName, summaries, setPendingSkillDirName, fetchSummaries]);

  const handleDelete = async (skill: SkillSummary) => {
    if (!confirm(t('skill.confirmDelete').replace('{name}', skill.name))) return;
    try {
      await deleteUserSkill(skill.dirName);
      toast.success(t('skill.deleteFile'));
      fetchSummaries(true);
    } catch (err) {
      toast.error(t('skill.deleteFile'), { description: err instanceof Error ? err.message : undefined });
    }
  };

  const handleUnpublish = async (skill: SkillSummary) => {
    try {
      await unpublishSkill(skill.dirName);
      toast.success(t('shared.unpublish'));
      fetchSummaries(true);
    } catch (err) {
      toast.error(t('shared.unpublish'), { description: err instanceof Error ? err.message : undefined });
    }
  };

  const handleBatchDelete = async () => {
    if (batchSelected.size === 0) return;
    if (!confirm(t('skill.confirmBatchDelete').replace('{n}', String(batchSelected.size)))) return;
    const items = Array.from(batchSelected);
    await Promise.all(items.map((dirName) => deleteUserSkill(dirName)));
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

  // Loading detail
  if (detailLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-gradient-to-br from-background via-background to-muted/30">
        <Loader2 className="size-6 animate-spin text-emerald-500" />
      </div>
    );
  }

  // Create new skill view
  if (creating) {
    const emptySkill: SkillDetail = {
      dirName: '',
      name: t('skill.newName'),
      description: '',
      content: '',
      source: 'user',
    };
    return (
      <SkillDetailView
        detail={emptySkill}
        onBack={() => setCreating(false)}
        onUpdated={() => { fetchSummaries(true); setSourceTab('user'); }}
        mode="create"
      />
    );
  }

  // Detail view
  if (selected) {
    return <SkillDetailView detail={selected} onBack={() => setSelected(null)} onUpdated={(updated) => { setSelected(updated); fetchSummaries(true); }} />;
  }

  // List view
  return (
    <div className="flex h-full flex-col bg-transparent">
      <div className="px-6 pb-3 pt-5">
        <div className="card-dashboard rounded-[28px] p-5">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-0.5 rounded-full border border-border/70 bg-card p-1 shadow-sm dark:bg-card">
            {(['preset', 'public', 'user'] as const).map((tab) => {
              const icon = tab === 'preset' ? Lock : tab === 'public' ? Globe : User;
              const Icon = icon;
              const count = tab === 'preset' ? presetSkills.length : tab === 'public' ? publicSkills.length : userSkills.length;
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
                  {t(`skill.${tab}`)}
                  <span className="text-[10px] tabular-nums text-muted-foreground/50">{count}</span>
                </button>
              );
            })}
                </div>
                {sourceTab === 'user' && !batchMode && userSkills.length > 0 && (
                  <Button variant="outline" size="sm" onClick={() => setBatchMode(true)} className="h-9 gap-1.5 rounded-full text-xs">
                    <Settings className="size-3" />
                    {t('skill.manage')}
                  </Button>
                )}
                <Button size="sm" onClick={() => setCreating(true)} className="h-9 gap-1.5 rounded-full text-xs bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-sm hover:shadow-md hover:shadow-emerald-500/20 dark:from-emerald-400 dark:to-emerald-500">
                  <Plus className="size-3.5" />
                  {t('skill.new')}
                </Button>
              </div>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
              <Input
                type="text"
                placeholder={t('skill.search')}
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
              {batchSelected.size === filtered.length && filtered.length > 0 ? t('skill.deselectAll') : t('skill.selectAll')}
            </button>
            <span className="text-xs text-muted-foreground">
              {t('skill.selected').replace('{n}', String(batchSelected.size))}
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
              {t('skill.batchDelete')}
            </Button>
            <Button variant="ghost" size="sm" onClick={exitBatchMode} className="h-7 text-xs">
              {t('skill.cancelManage')}
            </Button>
          </div>
        </div>
      )}

      {/* Card grid */}
      <div className="flex-1 overflow-y-auto px-6 pt-2 pb-6">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="size-5 animate-spin text-emerald-500 mr-2" />
            <span className="text-sm text-muted-foreground">{t('skill.loading')}</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-card shadow-sm dark:bg-card">
              {sourceTab === 'user' ? <User className="size-5 text-muted-foreground/30" /> : <Search className="size-5 text-muted-foreground/30" />}
            </div>
            <p className="text-sm text-muted-foreground/60">
              {sourceTab === 'user' ? t('skill.noUserSkills') : t('skill.noMatch')}
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filtered.map((skill) => (
                <SkillCard
                  key={skill.dirName}
                  skill={skill}
                  onClick={() => {
                    if (batchMode && skill.source === 'user') {
                      toggleBatchItem(skill.dirName);
                    } else {
                      handleSelect(skill);
                    }
                  }}
                  onDelete={skill.source === 'user' ? () => handleDelete(skill) : undefined}
                  batchMode={batchMode && skill.source === 'user'}
                  selected={batchSelected.has(skill.dirName)}
                  published={skill.source === 'user' && publishedSkillDirNames.has(skill.dirName)}
                  onUnpublish={skill.source === 'user' && publishedSkillDirNames.has(skill.dirName) ? () => handleUnpublish(skill) : undefined}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
