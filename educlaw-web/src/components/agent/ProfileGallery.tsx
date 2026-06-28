import {
  useState,
  useMemo,
  useCallback,
  useRef,
  useLayoutEffect,
  useEffect,
} from 'react';
import {
  Search,
  ArrowLeft,
  Wrench,
  BookOpen,
  Users,
  Plus,
  FileText,
  ChevronRight,
  Sparkles,
  Trash2,
  Lock,
  User,
  Pencil,
  X,
  Save,
  Globe,
  AlertTriangle,
  Settings,
  CheckSquare,
  Square,
  Copy,
  Download,
  Upload,
  Layers,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import { useAgentStore, type AgentProfile } from '../../stores/agent';
import { useLibraryStore } from '../../stores/library';
import { useUIStore } from '../../stores/ui';
import { useChatStore } from '../../stores/chat';
import {
  deleteUserProfile,
  updateUserProfile,
  createUserProfile,
  copyProfileToUser,
  exportProfile,
  importProfile,
  publishProfile,
  unpublishProfile,
  listRuntimes,
} from '../../api/manager';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
  matchAgentIcon,
  matchAgentCategory,
  categories,
} from '@/lib/agent-icons';
import { useT, type MessageKey } from '../../i18n';
import { useOptimizeStore } from '../../stores/optimize';

/* Shared tiny components */

const SOURCE_BADGE_STYLES: Record<string, { icon: LucideIcon; cls: string }> = {
  preset: { icon: Lock, cls: 'bg-muted/60 text-muted-foreground' },
  public: {
    icon: Globe,
    cls: 'bg-blue-500/8 text-blue-600 dark:text-blue-400',
  },
  user: { icon: User, cls: 'bg-primary/8 text-primary/80' },
};

const SOURCE_LABEL_KEYS: Record<'preset' | 'public' | 'user', MessageKey> = {
  preset: 'gallery.preset',
  public: 'gallery.public',
  user: 'gallery.user',
};

function TagGrid({
  items,
  icon: TagIcon,
  color,
  sourceMap,
  onItemClick,
}: {
  items: string[];
  icon: LucideIcon;
  color: string;
  sourceMap?: Map<string, string>;
  onItemClick?: (item: string) => void;
}) {
  const t = useT();
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {items.map((item) => {
        const src = sourceMap?.get(item);
        const badge = src ? SOURCE_BADGE_STYLES[src] : undefined;
        const BadgeIcon = badge?.icon;
        const clickable = !!onItemClick;
        return (
          <div
            key={item}
            onClick={clickable ? () => onItemClick(item) : undefined}
            className={`flex items-center gap-2.5 rounded-[18px] border border-border bg-card px-3.5 py-3 text-sm shadow-sm dark:bg-card ${clickable ? 'cursor-pointer transition-colors hover:border-primary/30 hover:bg-muted/70 dark:hover:bg-muted/60' : ''}`}
          >
            <div
              className={`flex size-6 items-center justify-center rounded-md ${color}`}
            >
              <TagIcon className="size-3" />
            </div>
            <span
              className={`truncate flex-1 ${clickable ? 'text-primary/80 hover:text-primary' : 'text-foreground/90'}`}
            >
              {item}
            </span>
            {badge && BadgeIcon && (
              <span
                className={`inline-flex items-center gap-1 rounded-full border border-border/70 px-2 py-0.5 text-[10px] font-medium shadow-sm shrink-0 ${badge.cls}`}
              >
                <BadgeIcon className="size-2.5" />
                {t(SOURCE_LABEL_KEYS[src as keyof typeof SOURCE_LABEL_KEYS])}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Marquee({
  text,
  hovered,
  direction,
  className,
}: {
  text: string;
  hovered: boolean;
  direction: 'h' | 'v';
  className?: string;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [dist, setDist] = useState(0);

  useLayoutEffect(() => {
    const o = outerRef.current,
      i = innerRef.current;
    if (!o || !i) return;
    setDist(
      direction === 'h'
        ? i.scrollWidth - o.clientWidth
        : i.scrollHeight - o.clientHeight,
    );
  }, [text, direction]);

  const overflows = dist > 2;
  const duration =
    direction === 'h' ? Math.max(dist / 30, 2) : Math.max(dist / 20, 2.5);
  const animName = direction === 'h' ? 'marquee-h' : 'marquee-v';
  const pad = direction === 'h' ? 12 : 8;

  return (
    <div ref={outerRef} className={`overflow-hidden ${className ?? ''}`}>
      <div
        ref={innerRef}
        className={`will-change-transform ${direction === 'h' ? 'inline-block whitespace-nowrap' : ''}`}
        style={
          hovered && overflows
            ? ({
                animation: `${animName} ${duration}s linear infinite`,
                '--marquee-dist': `-${dist + pad}px`,
              } as React.CSSProperties)
            : undefined
        }
      >
        {text}
      </div>
    </div>
  );
}

/* useProfileEdit hook */

function useProfileEdit(
  profile: AgentProfile,
  displaySkills: string[],
  isCreateMode: boolean,
) {
  const [editing, setEditing] = useState(isCreateMode);
  const [saving, setSaving] = useState(false);
  const [editName, setEditName] = useState(profile.name);
  const [editDesc, setEditDesc] = useState(profile.description);
  const [editDetails, setEditDetails] = useState(profile.details || '');
  const [editTools, setEditTools] = useState<string[]>(profile.tools || []);
  const [editSkills, setEditSkills] = useState<string[]>(profile.skills || []);
  const [editSubagents, setEditSubagents] = useState<string[]>(
    profile.subagents || [],
  );
  const [editRuntime, setEditRuntime] = useState(
    profile.agent_runtime || profile.agent_template || 'micro-learning',
  );

  const startEditing = () => {
    setEditName(profile.name);
    setEditDesc(profile.description);
    setEditDetails(profile.details || '');
    setEditTools(profile.tools || []);
    setEditSkills(displaySkills);
    setEditSubagents(profile.subagents || []);
    setEditRuntime(
      profile.agent_runtime || profile.agent_template || 'micro-learning',
    );
    setEditing(true);
  };

  return {
    editing,
    setEditing,
    saving,
    setSaving,
    editName,
    setEditName,
    editDesc,
    setEditDesc,
    editDetails,
    setEditDetails,
    editTools,
    setEditTools,
    editSkills,
    setEditSkills,
    editSubagents,
    setEditSubagents,
    editRuntime,
    setEditRuntime,
    startEditing,
  };
}

/* Editable tag list */

function EditableTagList({
  tags,
  onChange,
  icon: TagIcon,
  color,
  placeholder,
  suggestions,
  sourceMap,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  icon: typeof Wrench;
  color: string;
  placeholder: string;
  suggestions?: string[];
  sourceMap?: Map<string, string>;
}) {
  const t = useT();
  const [input, setInput] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!suggestions) return [];
    const query = input.trim().toLowerCase();
    return suggestions.filter(
      (s) => (!query || s.toLowerCase().includes(query)) && !tags.includes(s),
    );
  }, [suggestions, input, tags]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Reset highlight when filtered list changes
  useEffect(() => {
    setHighlightIdx(-1);
  }, [filtered.length]);

  const addTag = (value?: string) => {
    const v = (value ?? input).trim();
    if (!v || tags.includes(v)) {
      setInput('');
      setShowSuggestions(false);
      return;
    }
    // When suggestions are provided, only allow values from the list
    if (suggestions && !suggestions.includes(v)) {
      return;
    }
    onChange([...tags, v]);
    setInput('');
    setShowSuggestions(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightIdx >= 0 && highlightIdx < filtered.length) {
        addTag(filtered[highlightIdx]);
      } else {
        addTag();
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx((prev) => Math.min(prev + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      {tags.map((tag) => {
        const src = sourceMap?.get(tag);
        const badge = src ? SOURCE_BADGE_STYLES[src] : undefined;
        const BadgeIcon = badge?.icon;
        return (
          <span
            key={tag}
            className={`inline-flex items-center gap-1.5 rounded-lg border border-border/30 bg-card/40 px-3 py-1.5 text-sm`}
          >
            <div
              className={`flex size-5 items-center justify-center rounded-md ${color}`}
            >
              <TagIcon className="size-3" />
            </div>
            <span className="text-foreground/90">{tag}</span>
            {badge && BadgeIcon && (
              <span
                className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${badge.cls}`}
              >
                <BadgeIcon className="size-2" />
                {t(SOURCE_LABEL_KEYS[src as keyof typeof SOURCE_LABEL_KEYS])}
              </span>
            )}
            <button
              onClick={() => onChange(tags.filter((t) => t !== tag))}
              className="ml-1 text-muted-foreground hover:text-red-500 transition-colors"
            >
              <X className="size-3" />
            </button>
          </span>
        );
      })}
      <div ref={wrapperRef} className="relative inline-flex items-center gap-1">
        <Input
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setShowSuggestions(true);
          }}
          onFocus={() => setShowSuggestions(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="h-8 w-32 text-xs"
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => addTag()}
          className="h-8 px-2"
        >
          <Plus className="size-3" />
        </Button>
        {showSuggestions && filtered.length > 0 && (
          <div className="absolute left-0 top-full z-50 mt-1 max-h-48 w-64 overflow-y-auto rounded-lg border border-border bg-popover py-1 shadow-lg">
            {filtered.map((item, i) => (
              <button
                key={item}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors ${
                  i === highlightIdx
                    ? 'bg-accent text-accent-foreground'
                    : 'text-popover-foreground hover:bg-accent/60'
                }`}
                onMouseEnter={() => setHighlightIdx(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  addTag(item);
                }}
              >
                <div
                  className={`flex size-4 items-center justify-center rounded ${color}`}
                >
                  <TagIcon className="size-2.5" />
                </div>
                <span className="flex-1 truncate text-left">{item}</span>
                {(() => {
                  const src = sourceMap?.get(item);
                  const badge = src ? SOURCE_BADGE_STYLES[src] : undefined;
                  const BadgeIcon = badge?.icon;
                  return badge && BadgeIcon ? (
                    <span
                      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-medium shrink-0 ${badge.cls}`}
                    >
                      <BadgeIcon className="size-2" />
                      {t(
                        SOURCE_LABEL_KEYS[
                          src as keyof typeof SOURCE_LABEL_KEYS
                        ],
                      )}
                    </span>
                  ) : null;
                })()}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* Profile detail view */

function ProfileDetail({
  profile,
  onBack,
  onCreate,
  onUpdated,
  loading,
  mode = 'view',
}: {
  profile: AgentProfile;
  onBack: () => void;
  onCreate: (p: AgentProfile) => void;
  onUpdated?: () => void;
  loading: boolean;
  mode?: 'view' | 'create';
}) {
  const t = useT();
  const { icon: Icon, color } = matchAgentIcon(profile.name);
  const category = matchAgentCategory(profile.name);
  const isUser = profile.source === 'user';
  const isCreateMode = mode === 'create';
  const canCopy = !isUser && !isCreateMode;
  const [copying, setCopying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const createProfileRun = useOptimizeStore((s) => s.createProfileRun);
  const optimizationCreating = useOptimizeStore((s) => s.creating);

  // Determine if this user profile is already published (exists in public list)
  const allProfiles = useAgentStore((s) => s.profiles);
  const publicProfiles = useMemo(
    () => allProfiles.filter((p) => p.source === 'public'),
    [allProfiles],
  );
  const isPublished = useMemo(
    () => isUser && publicProfiles.some((p) => p.fileName === profile.fileName),
    [isUser, publicProfiles, profile.fileName],
  );

  // Fetch available skill names for autocomplete
  const skillSummaries = useLibraryStore((s) => s.skills);
  const fetchSkillSummaries = useLibraryStore((s) => s.fetchSkills);
  useEffect(() => {
    fetchSkillSummaries();
  }, [fetchSkillSummaries]);
  const availableSkillDirNames = useMemo(
    () => skillSummaries.map((s) => s.dirName),
    [skillSummaries],
  );

  // Fetch available tool names for autocomplete
  const toolSummaries = useLibraryStore((s) => s.tools);
  const fetchToolSummaries = useLibraryStore((s) => s.fetchTools);
  useEffect(() => {
    fetchToolSummaries();
  }, [fetchToolSummaries]);
  const availableToolDirNames = useMemo(
    () => toolSummaries.map((t) => t.dirName),
    [toolSummaries],
  );

  // Fetch available runtime names
  const [runtimes, setRuntimes] = useState<string[]>([]);
  useEffect(() => {
    listRuntimes()
      .then(setRuntimes)
      .catch(() => {});
  }, []);

  // Build source lookup maps for display badges
  const skillSourceMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of skillSummaries) map.set(s.dirName, s.source || 'preset');
    return map;
  }, [skillSummaries]);

  const toolSourceMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of toolSummaries) map.set(t.dirName, t.source || 'preset');
    return map;
  }, [toolSummaries]);

  const [removedSkills, setRemovedSkills] = useState<string[]>([]);
  const [displaySkills, setDisplaySkills] = useState<string[]>(
    profile.skills || [],
  );

  // Sync display state when profile prop changes (e.g. after save + refetch)
  useEffect(() => {
    setDisplaySkills(profile.skills || []);
  }, [profile]);

  const edit = useProfileEdit(profile, displaySkills, isCreateMode);

  // Detect and remove skills that no longer exist
  useEffect(() => {
    if (!skillSummaries.length || !displaySkills.length) return;
    const available = new Set(skillSummaries.map((s) => s.dirName));
    const missing = displaySkills.filter((s) => !available.has(s));
    if (missing.length > 0) {
      const kept = displaySkills.filter((s) => available.has(s));
      setDisplaySkills(kept);
      edit.setEditSkills(kept);
      setRemovedSkills(missing);
      // Persist the cleanup for user profiles
      if (isUser) {
        updateUserProfile(profile.fileName, { skills: kept }).catch(() => {});
      }
    }
  }, [skillSummaries]); // eslint-disable-line react-hooks/exhaustive-deps

  const cancelEditing = () => {
    if (isCreateMode) {
      onBack();
    } else {
      edit.setEditing(false);
    }
  };

  const handleSave = async () => {
    if (!edit.editName.trim()) return;
    edit.setSaving(true);
    try {
      const payload = {
        name: edit.editName,
        description: edit.editDesc,
        details: edit.editDetails || undefined,
        agent_runtime: edit.editRuntime || undefined,
        tools: edit.editTools,
        skills: edit.editSkills,
        subagents: edit.editSubagents,
      };
      if (isCreateMode) {
        await createUserProfile(payload);
        toast.success(t('gallery.saveSuccess'));
        onUpdated?.();
        onBack();
      } else {
        await updateUserProfile(profile.fileName, payload);
        toast.success(t('gallery.saveSuccess'));
        edit.setEditing(false);
        onUpdated?.();
      }
    } catch (err) {
      toast.error(t('gallery.save'), {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      edit.setSaving(false);
    }
  };

  const handleCopyToUser = async () => {
    setCopying(true);
    try {
      await copyProfileToUser(profile.fileName);
      toast.success(t('gallery.copyToUser'));
      onUpdated?.();
    } catch (err) {
      toast.error(t('gallery.copyToUser'), {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setCopying(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportProfile(profile.fileName);
      toast.success(t('gallery.exportSuccess'));
    } catch (err) {
      toast.error(t('gallery.export'), {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setExporting(false);
    }
  };

  const handleTogglePublish = async () => {
    setPublishing(true);
    try {
      if (isPublished) {
        await unpublishProfile(profile.fileName);
        toast.success(t('shared.unpublish'));
      } else {
        await publishProfile(profile.fileName);
        toast.success(t('shared.published'));
      }
      onUpdated?.();
    } catch (err) {
      toast.error(isPublished ? t('shared.unpublish') : t('shared.publish'), {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setPublishing(false);
    }
  };

  // Tag section config for DRY rendering
  const setMainView = useUIStore((s) => s.setMainView);
  const setPendingSkillDirName = useUIStore((s) => s.setPendingSkillDirName);
  const setPendingToolDirName = useUIStore((s) => s.setPendingToolDirName);

  const navigateToSkill = (dirName: string) => {
    setPendingSkillDirName(dirName);
    setMainView('deep-study');
    setDeepStudyTab('skills');
  };
  const navigateToTool = (dirName: string) => {
    setPendingToolDirName(dirName);
    setMainView('deep-study');
    setDeepStudyTab('tools');
  };
  const setPendingArenaTarget = useUIStore((s) => s.setPendingArenaTarget);

  const tagSections = [
    {
      key: 'skills',
      items: edit.editing ? edit.editSkills : displaySkills,
      setItems: edit.setEditSkills,
      icon: BookOpen,
      color: 'bg-emerald-500/10 text-emerald-500',
      iconColor: 'text-emerald-500',
      label: t('gallery.skillsList'),
      suggestions: availableSkillDirNames,
      sourceMap: skillSourceMap,
      onItemClick: navigateToSkill,
    },
    {
      key: 'tools',
      items: edit.editing ? edit.editTools : profile.tools || [],
      setItems: edit.setEditTools,
      icon: Wrench,
      color: 'bg-sky-500/10 text-sky-500',
      iconColor: 'text-sky-500',
      label: t('gallery.toolsList'),
      suggestions: availableToolDirNames,
      sourceMap: toolSourceMap,
      onItemClick: navigateToTool,
    },
    {
      key: 'subagents',
      items: edit.editing ? edit.editSubagents : profile.subagents || [],
      setItems: edit.setEditSubagents,
      icon: Users,
      color: 'bg-violet-500/10 text-violet-500',
      iconColor: 'text-violet-500',
      label: t('gallery.subagentsList'),
      suggestions: undefined,
      sourceMap: undefined,
      onItemClick: undefined,
    },
  ] as const;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border/70 px-6 py-4">
        <Button
          variant="outline"
          size="sm"
          onClick={onBack}
          className="gap-1.5 rounded-full"
        >
          <ArrowLeft className="size-4" />
          {t('gallery.backToList')}
        </Button>
        <div className="flex-1" />
        {!isCreateMode && !edit.editing && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setPendingArenaTarget({
                  kind: 'profile',
                  ref: profile.fileName,
                  label: profile.name,
                });
                setMainView('deep-study');
                setDeepStudyTab('arena');
              }}
              className="gap-1.5 rounded-full"
            >
              <Layers className="size-3.5" />
              Arena
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void createProfileRun(profile.fileName)}
              disabled={optimizationCreating}
              className="gap-1.5 rounded-full"
            >
              <Sparkles className="size-3.5" />
              {t('optimize.action')}
            </Button>
          </>
        )}
        {canCopy && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyToUser}
            disabled={copying}
            className="gap-1.5 rounded-full"
          >
            <Copy className="size-3.5" />
            {t('gallery.copyToUser')}
          </Button>
        )}
        {isUser && !edit.editing && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={handleTogglePublish}
              disabled={publishing}
              className={`gap-1.5 rounded-full ${isPublished ? 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400' : ''}`}
            >
              <Globe className="size-3.5" />
              {publishing
                ? isPublished
                  ? t('shared.unpublishing')
                  : t('shared.publishing')
                : isPublished
                  ? t('shared.unpublish')
                  : t('shared.publish')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={exporting}
              className="gap-1.5 rounded-full"
            >
              <Download className="size-3.5" />
              {exporting ? t('gallery.exporting') : t('gallery.export')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={edit.startEditing}
              className="gap-1.5 rounded-full"
            >
              <Pencil className="size-3.5" />
              {t('gallery.edit')}
            </Button>
          </>
        )}
        {edit.editing && (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={cancelEditing}
              className="gap-1.5 rounded-full"
            >
              <X className="size-3.5" />
              {t('gallery.cancel')}
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={edit.saving}
              className="gap-1.5 rounded-full"
            >
              <Save className="size-3.5" />
              {t('gallery.save')}
            </Button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-6 py-8">
          <div className="card-premium relative mb-8 overflow-hidden rounded-[30px] p-6 sm:p-7">
            <div
              className={`absolute -top-8 left-8 size-32 rounded-full ${color.replace('text-', 'bg-')}/8 blur-3xl`}
            />

            <div className="relative flex items-start gap-5">
              <div
                className={`flex size-16 shrink-0 items-center justify-center rounded-[24px] bg-gradient-to-br from-white to-muted/80 border border-border/70 shadow-md dark:from-muted/60 dark:to-muted/30 ${color}`}
              >
                <Icon className="size-8" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2.5 mb-1.5">
                  <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-card px-3 py-1 text-[11px] font-medium text-primary/80 shadow-sm">
                    {category}
                  </span>
                  {isPublished && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                      <Globe className="size-3" />
                      {t('shared.published')}
                    </span>
                  )}
                </div>
                {edit.editing ? (
                  <>
                    <Input
                      value={edit.editName}
                      onChange={(e) => edit.setEditName(e.target.value)}
                      placeholder={t('gallery.placeholderName')}
                      className="text-xl font-bold mb-2"
                    />
                    <Input
                      value={edit.editDesc}
                      onChange={(e) => edit.setEditDesc(e.target.value)}
                      placeholder={t('gallery.placeholderDesc')}
                      className="text-sm"
                    />
                  </>
                ) : (
                  <>
                    <h1 className="text-3xl font-semibold tracking-[-0.04em] text-foreground">
                      {profile.name}
                    </h1>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {profile.description}
                    </p>
                  </>
                )}

                {!edit.editing && (
                  <div className="mt-5 flex items-center gap-3">
                    <Button
                      onClick={() => onCreate(profile)}
                      disabled={loading}
                      className="gap-2 rounded-full bg-gradient-to-r from-indigo-500 to-indigo-600 text-white shadow-md transition-all duration-200 hover:shadow-lg hover:shadow-indigo-500/20 dark:from-indigo-400 dark:to-indigo-500"
                    >
                      <Plus className="size-4" />
                      {t('gallery.create')}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Warning: removed missing skills */}
          {removedSkills.length > 0 && (
            <div className="mb-6 flex items-start gap-2.5 rounded-[22px] border border-amber-500/30 bg-amber-500/8 px-4 py-3">
              <AlertTriangle className="size-4 text-amber-500 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-amber-700 dark:text-amber-400">
                  {t('gallery.skillsRemoved').replace(
                    '{skills}',
                    removedSkills.join(', '),
                  )}
                </p>
              </div>
              <button
                onClick={() => setRemovedSkills([])}
                className="shrink-0 text-amber-500/60 hover:text-amber-500 transition-colors"
              >
                <X className="size-3.5" />
              </button>
            </div>
          )}

          {/* Meta badges row (read-only mode only) */}
          {!edit.editing &&
            (profile.agent_runtime ||
              profile.agent_template ||
              profile.tools?.length ||
              displaySkills.length ||
              profile.subagents?.length) && (
              <div className="flex flex-wrap gap-2 mb-6">
                {(profile.agent_runtime || profile.agent_template) && (
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-orange-500/15 bg-orange-500/8 px-3 py-1.5 text-xs font-medium text-orange-600 dark:text-orange-400">
                    <Layers className="size-3.5" />
                    {profile.agent_runtime || profile.agent_template}
                  </div>
                )}
                {displaySkills.length > 0 && (
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/15 bg-emerald-500/8 px-3 py-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    <BookOpen className="size-3.5" />
                    {displaySkills.length} {t('gallery.skills')}
                  </div>
                )}
                {profile.tools && profile.tools.length > 0 && (
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/15 bg-sky-500/8 px-3 py-1.5 text-xs font-medium text-sky-600 dark:text-sky-400">
                    <Wrench className="size-3.5" />
                    {profile.tools.length} {t('gallery.tools')}
                  </div>
                )}
                {profile.subagents && profile.subagents.length > 0 && (
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/15 bg-violet-500/8 px-3 py-1.5 text-xs font-medium text-violet-600 dark:text-violet-400">
                    <Users className="size-3.5" />
                    {profile.subagents.length} {t('gallery.subagents')}
                  </div>
                )}
              </div>
            )}

          {/* Template selector */}
          {(edit.editing ||
            profile.agent_runtime ||
            profile.agent_template) && (
            <section className="mb-6">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-3">
                <Layers className="size-4 text-muted-foreground" />
                {t('gallery.runtime')}
              </h2>
              {edit.editing ? (
                <select
                  value={edit.editRuntime}
                  onChange={(e) => edit.setEditRuntime(e.target.value)}
                  className="w-full rounded-[18px] border border-border bg-card px-3.5 py-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring dark:bg-card"
                >
                  {runtimes.map((rt) => (
                    <option key={rt} value={rt}>
                      {rt}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-orange-500/15 bg-orange-500/8 px-3 py-1.5 text-xs font-medium text-orange-600 dark:text-orange-400">
                  <Layers className="size-3.5" />
                  {profile.agent_runtime || profile.agent_template}
                </span>
              )}
            </section>
          )}

          {/* Details section */}
          {(edit.editing || profile.details) && (
            <section className="mb-6">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-3">
                <FileText className="size-4 text-muted-foreground" />
                {t('gallery.details')}
              </h2>
              {edit.editing ? (
                <Textarea
                  value={edit.editDetails}
                  onChange={(e) => edit.setEditDetails(e.target.value)}
                  placeholder={t('gallery.placeholderDetails')}
                  rows={12}
                  className="font-mono text-sm"
                />
              ) : (
                <div className="rounded-[24px] border border-border bg-card p-5 shadow-sm dark:bg-card">
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {profile.details!}
                    </ReactMarkdown>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Skills / Tools / Subagents - rendered from tagSections config */}
          {tagSections.map(
            ({
              key,
              items,
              setItems,
              icon: SectionIcon,
              color: sectionColor,
              iconColor,
              label,
              suggestions,
              sourceMap,
              onItemClick,
            }) =>
              edit.editing || items.length > 0 ? (
                <section key={key} className="mb-6">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-3">
                    <SectionIcon className={`size-4 ${iconColor}`} />
                    {label}
                  </h2>
                  {edit.editing ? (
                    <EditableTagList
                      tags={items as string[]}
                      onChange={setItems}
                      icon={SectionIcon}
                      color={sectionColor}
                      placeholder={t('gallery.addTag')}
                      suggestions={suggestions as string[] | undefined}
                      sourceMap={sourceMap as Map<string, string> | undefined}
                    />
                  ) : (
                    <TagGrid
                      items={items as string[]}
                      icon={SectionIcon}
                      color={sectionColor}
                      sourceMap={sourceMap as Map<string, string> | undefined}
                      onItemClick={
                        onItemClick as ((item: string) => void) | undefined
                      }
                    />
                  )}
                </section>
              ) : null,
          )}
        </div>
      </div>
    </div>
  );
}

/* Profile card */

function ProfileCard({
  profile,
  onClick,
  onCreate,
  onDelete,
  loading,
  batchMode,
  selected,
  published,
  onUnpublish,
}: {
  profile: AgentProfile;
  onClick: () => void;
  onCreate: (e: React.MouseEvent) => void;
  onDelete?: (e: React.MouseEvent) => void;
  loading: boolean;
  batchMode?: boolean;
  selected?: boolean;
  published?: boolean;
  onUnpublish?: (e: React.MouseEvent) => void;
}) {
  const t = useT();
  const { icon: Icon, color } = matchAgentIcon(profile.name);
  const category = matchAgentCategory(profile.name);
  const [hovered, setHovered] = useState(false);
  const isUser = profile.source === 'user';

  return (
    <Card
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`group relative h-[190px] cursor-pointer gap-0 overflow-hidden rounded-[26px] border p-0 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-primary/8 ${batchMode && selected ? 'border-primary/40 ring-2 ring-primary' : 'border-border bg-card dark:bg-card'}`}
    >
      {/* Top color accent bar */}
      <div
        className={`h-1 w-full bg-gradient-to-r ${color.replace('text-', 'from-')}/60 to-transparent`}
      />

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

      {/* Delete button for user profiles */}
      {!batchMode && isUser && onDelete && (
        <button
          onClick={onDelete}
          className="absolute top-3 right-3 z-10 flex size-7 items-center justify-center rounded-full border border-red-500/15 bg-red-500/10 text-red-500 opacity-0 transition-all duration-200 group-hover:opacity-100 hover:bg-red-500/20"
          title={t('agent.delete')}
        >
          <Trash2 className="size-3" />
        </button>
      )}

      {/* Published badge - clickable to unpublish */}
      {!batchMode && published && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onUnpublish?.(e);
          }}
          className="absolute top-3 left-3 z-10 inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 transition-colors hover:border-red-500/20 hover:bg-red-500/10 hover:text-red-500"
          title={t('shared.unpublish')}
        >
          <Globe className="size-2.5" />
          {t('shared.published')}
        </button>
      )}

      <div className="flex h-[calc(100%-4px)] flex-col p-5">
        {/* Row 1 (fixed): icon + name + category + arrow */}
        <div className="flex items-center gap-3 min-w-0 h-10 shrink-0">
          <div
            className={`flex size-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-white to-muted/80 border border-border/70 shadow-sm transition-transform duration-300 group-hover:scale-110 group-hover:shadow-md dark:from-muted/60 dark:to-muted/30 ${color}`}
          >
            <Icon className="size-5" />
          </div>
          <div className="flex-1 min-w-0">
            <Marquee
              text={profile.name}
              hovered={hovered}
              direction="h"
              className="text-sm font-bold text-foreground leading-tight"
            />
            <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground/60">
              {category}
            </span>
          </div>
          <ChevronRight className="size-4 text-muted-foreground/30 shrink-0 transition-all duration-200 group-hover:text-primary/60 group-hover:translate-x-0.5" />
        </div>

        {/* Row 2 (flexible): description - fills middle space */}
        <Marquee
          text={profile.description}
          hovered={hovered}
          direction="v"
          className="text-xs leading-relaxed text-muted-foreground/70 mt-3 flex-1"
        />

        {/* Row 3 (fixed): meta badges left + create button right */}
        <div className="mt-2 flex shrink-0 items-center justify-between gap-2 border-t border-border/70 pt-3">
          <div className="flex gap-1.5 min-w-0">
            {profile.skills && profile.skills.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/8 px-2 py-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                <BookOpen className="size-2.5" />
                {profile.skills.length}
              </span>
            )}
            {profile.tools && profile.tools.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/8 px-2 py-1 text-[10px] font-medium text-sky-600 dark:text-sky-400">
                <Wrench className="size-2.5" />
                {profile.tools.length}
              </span>
            )}
            {profile.subagents && profile.subagents.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/8 px-2 py-1 text-[10px] font-medium text-violet-600 dark:text-violet-400">
                <Users className="size-2.5" />
                {profile.subagents.length}
              </span>
            )}
          </div>

          <Button
            onClick={onCreate}
            disabled={loading}
            size="sm"
            className="h-8 shrink-0 gap-1.5 rounded-full text-xs shadow-sm transition-all duration-200 hover:shadow-md hover:shadow-indigo-500/20"
          >
            <Sparkles className="size-3" />
            {t('gallery.create')}
          </Button>
        </div>
      </div>
    </Card>
  );
}

/* Source tab */

type SourceTab = 'preset' | 'public' | 'user';

/* Main gallery */

export default function ProfileGallery() {
  const t = useT();
  const profiles = useAgentStore((s) => s.profiles);
  const fetchProfiles = useAgentStore((s) => s.fetchProfiles);
  const createAgent = useAgentStore((s) => s.createAgent);
  const loading = useAgentStore((s) => s.loading);
  const setMainView = useUIStore((s) => s.setMainView);
  const openTab = useChatStore((s) => s.openTab);
  const fetchSkillSummaries = useLibraryStore((s) => s.fetchSkills);
  const fetchToolSummaries = useLibraryStore((s) => s.fetchTools);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<AgentProfile | null>(
    null,
  );
  const [sourceTab, setSourceTab] = useState<SourceTab>('preset');
  const [creating, setCreating] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  // Sync selectedProfile with latest store data after fetchProfiles
  useEffect(() => {
    if (selectedProfile) {
      const updated = profiles.find(
        (p) => p.fileName === selectedProfile.fileName,
      );
      if (updated) setSelectedProfile(updated);
    }
  }, [profiles]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle pending profile navigation from deep study dialog
  const pendingProfileFileName = useUIStore((s) => s.pendingProfileFileName);
  const setPendingProfileFileName = useUIStore(
    (s) => s.setPendingProfileFileName,
  );
  useEffect(() => {
    if (pendingProfileFileName && profiles.length > 0) {
      const target = profiles.find(
        (p) => p.fileName === pendingProfileFileName,
      );
      if (target) {
        setSelectedProfile(target);
      }
      setPendingProfileFileName(null);
    }
  }, [pendingProfileFileName, profiles, setPendingProfileFileName]);

  // Split by source
  const presetProfiles = useMemo(
    () => profiles.filter((p) => p.source === 'preset' || !p.source),
    [profiles],
  );
  const publicProfiles = useMemo(
    () => profiles.filter((p) => p.source === 'public'),
    [profiles],
  );
  const userProfiles = useMemo(
    () => profiles.filter((p) => p.source === 'user'),
    [profiles],
  );
  const currentProfiles =
    sourceTab === 'preset'
      ? presetProfiles
      : sourceTab === 'public'
        ? publicProfiles
        : userProfiles;

  // Published profile lookup (user profiles that also exist in public)
  const publishedFileNames = useMemo(
    () => new Set(publicProfiles.map((p) => p.fileName)),
    [publicProfiles],
  );

  const availableCategories = useMemo(() => {
    const catSet = new Set<string>();
    for (const p of currentProfiles) {
      catSet.add(matchAgentCategory(p.name));
    }
    return categories.filter((c) => catSet.has(c.name));
  }, [currentProfiles]);

  const filtered = currentProfiles.filter((p: AgentProfile) => {
    if (activeCategory && matchAgentCategory(p.name) !== activeCategory)
      return false;
    if (search) {
      const keywords = search.toLowerCase().split(/\s+/).filter(Boolean);
      const text = `${p.name} ${p.description}`.toLowerCase();
      return keywords.every((kw) => text.includes(kw));
    }
    return true;
  });

  const handleCreate = useCallback(
    async (profile: AgentProfile) => {
      const agent = await createAgent(profile.fileName);
      openTab(agent.id, agent.name);
      setMainView(null);
    },
    [createAgent, openTab, setMainView],
  );

  const handleDelete = useCallback(
    async (profile: AgentProfile) => {
      if (!confirm(t('gallery.confirmDelete').replace('{name}', profile.name)))
        return;
      try {
        await deleteUserProfile(profile.fileName);
        toast.success(t('agent.delete'));
        fetchProfiles(true);
      } catch (err) {
        toast.error(t('agent.delete'), {
          description: err instanceof Error ? err.message : undefined,
        });
      }
    },
    [fetchProfiles, t],
  );

  const handleUnpublishProfile = useCallback(
    async (profile: AgentProfile) => {
      try {
        await unpublishProfile(profile.fileName);
        toast.success(t('shared.unpublish'));
        fetchProfiles(true);
      } catch (err) {
        toast.error(t('shared.unpublish'), {
          description: err instanceof Error ? err.message : undefined,
        });
      }
    },
    [fetchProfiles, t],
  );

  const handleBatchDelete = useCallback(async () => {
    if (selectedItems.size === 0) return;
    if (
      !confirm(
        t('gallery.confirmBatchDelete').replace(
          '{n}',
          String(selectedItems.size),
        ),
      )
    )
      return;
    const items = Array.from(selectedItems);
    try {
      await Promise.all(items.map((fileName) => deleteUserProfile(fileName)));
      toast.success(t('gallery.batchDelete'));
    } catch (err) {
      toast.error(t('gallery.batchDelete'), {
        description: err instanceof Error ? err.message : undefined,
      });
    }
    setBatchMode(false);
    setSelectedItems(new Set());
    fetchProfiles(true);
  }, [selectedItems, fetchProfiles, t]);

  const toggleSelectItem = useCallback((fileName: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(fileName)) next.delete(fileName);
      else next.add(fileName);
      return next;
    });
  }, []);

  const exitBatchMode = useCallback(() => {
    setBatchMode(false);
    setSelectedItems(new Set());
  }, []);

  const handleImport = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = ''; // reset so same file can be re-selected
      setImporting(true);
      try {
        const result = await importProfile(file);
        await fetchProfiles(true);
        // Refresh skill/tool caches so newly imported items are visible
        if (result.skillsImported > 0) fetchSkillSummaries();
        if (result.toolsImported > 0) fetchToolSummaries();
        toast.success(t('gallery.importSuccess'));
        setSourceTab('user');
      } catch (err) {
        toast.error(t('gallery.importError'), {
          description: err instanceof Error ? err.message : undefined,
        });
      } finally {
        setImporting(false);
      }
    },
    [fetchProfiles, fetchSkillSummaries, fetchToolSummaries, t],
  );

  // Create new profile view
  if (creating) {
    const emptyProfile: AgentProfile = {
      fileName: '',
      name: t('gallery.newName'),
      description: '',
      details: '',
      tools: [],
      skills: [],
      subagents: [],
      source: 'user',
    };
    return (
      <ProfileDetail
        profile={emptyProfile}
        onBack={() => setCreating(false)}
        onCreate={handleCreate}
        onUpdated={() => {
          fetchProfiles(true);
          setSourceTab('user');
        }}
        loading={loading}
        mode="create"
      />
    );
  }

  const sourceTabs: {
    key: SourceTab;
    icon: LucideIcon;
    label: string;
    count: number;
    exitBatch?: boolean;
  }[] = [
    {
      key: 'preset',
      icon: Lock,
      label: t('gallery.preset'),
      count: presetProfiles.length,
      exitBatch: true,
    },
    {
      key: 'public',
      icon: Globe,
      label: t('gallery.public'),
      count: publicProfiles.length,
      exitBatch: true,
    },
    {
      key: 'user',
      icon: User,
      label: t('gallery.user'),
      count: userProfiles.length,
    },
  ];

  // Detail view
  if (selectedProfile) {
    return (
      <ProfileDetail
        profile={selectedProfile}
        onBack={() => setSelectedProfile(null)}
        onCreate={handleCreate}
        onUpdated={() => fetchProfiles(true)}
        loading={loading}
      />
    );
  }

  return (
    <div className="flex h-full flex-col bg-transparent">
      <div className="px-6 pb-3 pt-5">
        <div className="card-dashboard rounded-[28px] p-5">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-0.5 rounded-full border border-border/70 bg-card p-1 shadow-sm dark:bg-card">
                  {sourceTabs.map((tab) => {
                    const TabIcon = tab.icon;
                    return (
                      <button
                        key={tab.key}
                        onClick={() => {
                          setSourceTab(tab.key);
                          setActiveCategory(null);
                          if (tab.exitBatch) exitBatchMode();
                        }}
                        className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-medium transition-all duration-200 ${
                          sourceTab === tab.key
                            ? 'bg-primary text-primary-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        <TabIcon className="size-3" />
                        {tab.label}
                        <span className="text-[10px] tabular-nums text-muted-foreground/50">
                          {tab.count}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {sourceTab === 'user' &&
                  !batchMode &&
                  userProfiles.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setBatchMode(true)}
                      className="h-9 gap-1.5 rounded-full text-xs"
                    >
                      <Settings className="size-3" />
                      {t('gallery.manage')}
                    </Button>
                  )}
                <Button
                  size="sm"
                  onClick={() => setCreating(true)}
                  className="h-9 gap-1.5 rounded-full text-xs bg-gradient-to-r from-amber-500 to-amber-600 text-white shadow-sm hover:shadow-md hover:shadow-amber-500/20 dark:from-amber-400 dark:to-amber-500"
                >
                  <Plus className="size-3.5" />
                  {t('gallery.new')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => importInputRef.current?.click()}
                  disabled={importing}
                  className="h-9 gap-1.5 rounded-full text-xs"
                >
                  <Upload className="size-3.5" />
                  {importing ? t('gallery.importing') : t('gallery.import')}
                </Button>
                <input
                  ref={importInputRef}
                  type="file"
                  accept=".zip"
                  className="hidden"
                  onChange={handleImport}
                />
              </div>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
              <Input
                type="text"
                placeholder={t('gallery.search')}
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
                if (selectedItems.size === filtered.length) {
                  setSelectedItems(new Set());
                } else {
                  setSelectedItems(new Set(filtered.map((p) => p.fileName)));
                }
              }}
              className="text-xs text-primary hover:text-primary/80 transition-colors shrink-0"
            >
              {selectedItems.size === filtered.length && filtered.length > 0
                ? t('gallery.deselectAll')
                : t('gallery.selectAll')}
            </button>
            <span className="text-xs text-muted-foreground">
              {t('gallery.selected').replace('{n}', String(selectedItems.size))}
            </span>
            <div className="flex-1" />
            <Button
              variant="destructive"
              size="sm"
              onClick={handleBatchDelete}
              disabled={selectedItems.size === 0}
              className="h-7 text-xs gap-1.5"
            >
              <Trash2 className="size-3" />
              {t('gallery.batchDelete')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={exitBatchMode}
              className="h-7 text-xs"
            >
              {t('gallery.cancelManage')}
            </Button>
          </div>
        </div>
      )}

      {availableCategories.length > 0 && (
        <div className="flex flex-wrap gap-2 px-6 pb-3">
          <button
            className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-all duration-200 ${
              activeCategory === null
                ? 'bg-gradient-to-r from-indigo-500 to-indigo-600 text-white shadow-md shadow-indigo-500/20'
                : 'border border-border bg-card text-muted-foreground hover:border-border hover:bg-white hover:text-foreground hover:shadow-sm dark:bg-card'
            }`}
            onClick={() => setActiveCategory(null)}
          >
            {t('gallery.all')}
            <span
              className={`text-[10px] ${activeCategory === null ? 'text-white/70' : 'text-muted-foreground/50'}`}
            >
              {currentProfiles.length}
            </span>
          </button>
          {availableCategories.map((cat) => {
            const CatIcon = cat.icon;
            const count = currentProfiles.filter(
              (p) => matchAgentCategory(p.name) === cat.name,
            ).length;
            const isActive = activeCategory === cat.name;
            return (
              <button
                key={cat.name}
                className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-all duration-200 ${
                  isActive
                    ? 'bg-gradient-to-r from-indigo-500 to-indigo-600 text-white shadow-md shadow-indigo-500/20'
                    : 'border border-border bg-card text-muted-foreground hover:border-border hover:bg-white hover:text-foreground hover:shadow-sm dark:bg-card'
                }`}
                onClick={() => setActiveCategory(isActive ? null : cat.name)}
              >
                <CatIcon className="size-3" />
                {cat.name}
                <span
                  className={`text-[10px] ${isActive ? 'text-white/70' : 'text-muted-foreground/50'}`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-6 pt-2 pb-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((p: AgentProfile) => (
            <ProfileCard
              key={p.fileName}
              profile={p}
              onClick={() => {
                if (batchMode && p.source === 'user') {
                  toggleSelectItem(p.fileName);
                } else {
                  setSelectedProfile(p);
                }
              }}
              onCreate={(e) => {
                e.stopPropagation();
                if (batchMode) return;
                handleCreate(p);
              }}
              onDelete={
                p.source === 'user'
                  ? (e) => {
                      e.stopPropagation();
                      handleDelete(p);
                    }
                  : undefined
              }
              loading={loading}
              batchMode={batchMode && p.source === 'user'}
              selected={selectedItems.has(p.fileName)}
              published={
                p.source === 'user' && publishedFileNames.has(p.fileName)
              }
              onUnpublish={
                p.source === 'user' && publishedFileNames.has(p.fileName)
                  ? (e) => {
                      e.stopPropagation();
                      handleUnpublishProfile(p);
                    }
                  : undefined
              }
            />
          ))}
          {filtered.length === 0 && (
            <div className="col-span-full py-16 text-center">
              <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-card shadow-sm dark:bg-card">
                {sourceTab === 'user' ? (
                  <User className="size-5 text-muted-foreground/30" />
                ) : (
                  <Search className="size-5 text-muted-foreground/30" />
                )}
              </div>
              <p className="text-sm text-muted-foreground/60">
                {sourceTab === 'user'
                  ? t('gallery.noUserProfiles')
                  : t('gallery.noMatch')}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
