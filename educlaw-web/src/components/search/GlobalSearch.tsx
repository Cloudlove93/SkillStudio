import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Search, Bot, BookOpen, Wrench, ArrowRight } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useAgentStore } from '../../stores/agent';
import { useLibraryStore } from '../../stores/library';
import { useUIStore } from '../../stores/ui';
import { useT, type MessageKey } from '../../i18n';

type ResultType = 'profile' | 'skill' | 'tool';

interface SearchResult {
  type: ResultType;
  id: string;
  name: string;
  description: string;
  source?: string;
}

const typeConfig: Record<ResultType, { icon: typeof Bot; color: string }> = {
  profile: { icon: Bot, color: 'bg-[rgba(55,130,255,0.10)] text-[color:var(--info)]' },
  skill: { icon: BookOpen, color: 'bg-[rgba(30,180,120,0.10)] text-[color:var(--success)]' },
  tool: { icon: Wrench, color: 'bg-primary-soft text-primary' },
};

const typeLabelKeys: Record<ResultType, MessageKey> = {
  profile: 'search.type.profile',
  skill: 'search.type.skill',
  tool: 'search.type.tool',
};

export default function GlobalSearch() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const profiles = useAgentStore((s) => s.profiles);
  const skills = useLibraryStore((s) => s.skills);
  const tools = useLibraryStore((s) => s.tools);
  const fetchSkills = useLibraryStore((s) => s.fetchSkills);
  const fetchTools = useLibraryStore((s) => s.fetchTools);

  const setMainView = useUIStore((s) => s.setMainView);
  const setDeepStudyTab = useUIStore((s) => s.setDeepStudyTab);
  const setPendingProfileFileName = useUIStore((s) => s.setPendingProfileFileName);
  const setPendingSkillDirName = useUIStore((s) => s.setPendingSkillDirName);
  const setPendingToolDirName = useUIStore((s) => s.setPendingToolDirName);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (open) {
      fetchSkills();
      fetchTools();
      setQuery('');
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, fetchSkills, fetchTools]);

  const results = useMemo<SearchResult[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const keywords = q.split(/\s+/).filter(Boolean);
    const items: SearchResult[] = [];

    for (const p of profiles) {
      const text = `${p.name} ${p.description}`.toLowerCase();
      if (keywords.every((kw) => text.includes(kw))) items.push({ type: 'profile', id: p.fileName, name: p.name, description: p.description, source: p.source });
    }
    for (const s of skills) {
      const text = `${s.name} ${s.description}`.toLowerCase();
      if (keywords.every((kw) => text.includes(kw))) items.push({ type: 'skill', id: s.dirName, name: s.name, description: s.description, source: s.source });
    }
    for (const tl of tools) {
      const text = `${tl.name} ${tl.description}`.toLowerCase();
      if (keywords.every((kw) => text.includes(kw))) items.push({ type: 'tool', id: tl.dirName, name: tl.name, description: tl.description, source: tl.source });
    }
    return items.slice(0, 20);
  }, [query, profiles, skills, tools]);

  useEffect(() => { setActiveIndex(0); }, [results.length]);

  const navigate = useCallback((item: SearchResult) => {
    switch (item.type) {
      case 'profile':
        setPendingProfileFileName(item.id);
        setDeepStudyTab('gallery');
        setMainView('deep-study');
        break;
      case 'skill':
        setPendingSkillDirName(item.id);
        setDeepStudyTab('skills');
        setMainView('deep-study');
        break;
      case 'tool':
        setPendingToolDirName(item.id);
        setDeepStudyTab('tools');
        setMainView('deep-study');
        break;
    }
    setOpen(false);
  }, [setMainView, setDeepStudyTab, setPendingProfileFileName, setPendingSkillDirName, setPendingToolDirName]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && results[activeIndex]) {
      e.preventDefault();
      navigate(results[activeIndex]);
    }
  }

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.children[activeIndex] as HTMLElement | undefined;
    active?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-xl">
        <div className="flex items-center gap-3 border-b border-border px-4 py-4">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-primary-soft text-primary">
            <Search className="size-4" />
          </div>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('search.placeholder')}
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <kbd className="hidden rounded-[8px] border border-border bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground sm:inline">
            ESC
          </kbd>
        </div>

        <div ref={listRef} className="max-h-80 overflow-y-auto p-2">
          {query.trim() && results.length === 0 && <div className="px-4 py-10 text-center text-sm text-muted-foreground">{t('search.noResults')}</div>}
          {!query.trim() && <div className="px-4 py-10 text-center text-sm text-muted-foreground">{t('search.hint')}</div>}
          {results.map((item, idx) => {
            const cfg = typeConfig[item.type];
            const Icon = cfg.icon;
            const isActive = idx === activeIndex;
            return (
              <button
                key={`${item.type}-${item.id}`}
                onClick={() => navigate(item)}
                onMouseEnter={() => setActiveIndex(idx)}
                className={`flex w-full items-center gap-3 rounded-[12px] px-3 py-3 text-left transition-colors ${isActive ? 'bg-muted' : 'hover:bg-muted/70'}`}
              >
                <div className={`flex size-9 shrink-0 items-center justify-center rounded-[10px] ${cfg.color}`}>
                  <Icon className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">{item.name}</div>
                  {item.description && <div className="truncate text-xs text-muted-foreground">{item.description}</div>}
                </div>
                <span className="shrink-0 rounded-full border border-border bg-card px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
                  {t(typeLabelKeys[item.type])}
                </span>
                {isActive && <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />}
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
