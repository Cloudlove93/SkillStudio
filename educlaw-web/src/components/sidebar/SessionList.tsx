import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Trash2, MessageSquare, MoreHorizontal, Copy, Share2, Archive, ArchiveRestore, Pencil, Minimize2, ChevronDown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '../../i18n';
import type { SessionInfo } from '../../stores/chat';

const MENU_WIDTH = 176;
const MENU_MARGIN = 8;
const MENU_OFFSET = 4;
const MENU_MAX_HEIGHT = 280;

interface MenuState {
  id: string;
  left: number;
  top: number;
}

export default function SessionList({
  sessions,
  activeSessionId,
  onSelect,
  onCreate,
  onDelete,
  onFork,
  onShare,
  onUnshare,
  onArchive,
  onUnarchive,
  onRename,
  onCompact,
  compactingId,
  readonly,
}: {
  sessions: SessionInfo[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete?: (id: string) => void;
  onFork?: (id: string) => void;
  onShare?: (id: string) => void;
  onUnshare?: (id: string) => void;
  onArchive?: (id: string) => void;
  onUnarchive?: (id: string) => void;
  onRename?: (id: string, title: string) => void;
  onCompact?: (id: string) => void;
  compactingId?: string | null;
  readonly?: boolean;
}) {
  const t = useT();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const editRef = useRef<HTMLInputElement>(null);
  const menuButtonRefs = useRef(new Map<string, HTMLButtonElement>());

  const activeSessions = useMemo(() => sessions.filter((s) => !s.archived), [sessions]);
  const archivedSessions = useMemo(() => sessions.filter((s) => !!s.archived), [sessions]);

  const updateMenuPosition = useCallback((sessionId: string) => {
    const trigger = menuButtonRefs.current.get(sessionId);
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const left = Math.max(
      MENU_MARGIN,
      Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - MENU_MARGIN),
    );
    const top = Math.max(
      MENU_MARGIN,
      Math.min(rect.bottom + MENU_OFFSET, window.innerHeight - MENU_MAX_HEIGHT - MENU_MARGIN),
    );

    setMenu({ id: sessionId, left, top });
  }, []);

  useEffect(() => {
    if (!menu) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const trigger = menuButtonRefs.current.get(menu.id);
      if (menuRef.current?.contains(target) || trigger?.contains(target)) {
        return;
      }
      setMenu(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const handleLayout = () => updateMenuPosition(menu.id);
    window.addEventListener('resize', handleLayout);
    window.addEventListener('scroll', handleLayout, true);
    return () => {
      window.removeEventListener('resize', handleLayout);
      window.removeEventListener('scroll', handleLayout, true);
    };
  }, [menu, updateMenuPosition]);

  useEffect(() => {
    if (editId && editRef.current) {
      editRef.current.focus();
      editRef.current.select();
    }
  }, [editId]);

  function handleRename(id: string) {
    const session = sessions.find((s) => s.id === id);
    setEditId(id);
    setEditValue(session?.title ?? '');
    setMenu(null);
  }

  function commitRename() {
    if (editId && editValue.trim() && onRename) {
      onRename(editId, editValue.trim());
    }
    setEditId(null);
    setEditValue('');
  }

  function formatSessionDate(session: SessionInfo) {
    const value = session.updatedAt ?? session.createdAt;
    if (!value) return '';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function toggleMenu(sessionId: string) {
    if (menu?.id === sessionId) {
      setMenu(null);
      return;
    }
    updateMenuPosition(sessionId);
  }

  function renderMenu(session: SessionInfo, isArchived: boolean) {
    if (!menu || menu.id !== session.id) return null;

    return createPortal(
      <div
        ref={menuRef}
        className="fixed z-[120] min-w-[160px] overflow-y-auto rounded-[12px] border border-border bg-popover p-1.5 shadow-[var(--shadow-md)] text-xs"
        style={{ left: menu.left, top: menu.top, width: MENU_WIDTH, maxHeight: MENU_MAX_HEIGHT }}
        onClick={(e) => e.stopPropagation()}
      >
        {isArchived ? (
          <>
            {onUnarchive && (
              <button className="flex w-full items-center gap-2 rounded-[8px] px-2.5 py-2 hover:bg-muted" onClick={() => { onUnarchive(session.id); setMenu(null); }}>
                <ArchiveRestore className="size-3.5" /> {t('session.unarchive')}
              </button>
            )}
            {onDelete && (
              <>
                <div className="my-1 h-px bg-border" />
                <button className="flex w-full items-center gap-2 rounded-[8px] px-2.5 py-2 text-destructive hover:bg-[rgba(240,45,45,0.08)]" onClick={() => { onDelete(session.id); setMenu(null); }}>
                  <Trash2 className="size-3.5" /> {t('session.delete')}
                </button>
              </>
            )}
          </>
        ) : (
          <>
            {onRename && <button className="flex w-full items-center gap-2 rounded-[8px] px-2.5 py-2 hover:bg-muted" onClick={() => handleRename(session.id)}><Pencil className="size-3.5" /> {t('session.rename')}</button>}
            {onFork && <button className="flex w-full items-center gap-2 rounded-[8px] px-2.5 py-2 hover:bg-muted" onClick={() => { onFork(session.id); setMenu(null); }}><Copy className="size-3.5" /> {t('session.fork')}</button>}
            {onShare && <button className="flex w-full items-center gap-2 rounded-[8px] px-2.5 py-2 hover:bg-muted" onClick={() => { onShare(session.id); setMenu(null); }}><Share2 className="size-3.5" /> {session.share ? t('session.share.copyLink') : t('session.share')}</button>}
            {onUnshare && session.share && <button className="flex w-full items-center gap-2 rounded-[8px] px-2.5 py-2 hover:bg-muted" onClick={() => { onUnshare(session.id); setMenu(null); }}><Share2 className="size-3.5" /> {t('session.unshare')}</button>}
            {onCompact && <button className="flex w-full items-center gap-2 rounded-[8px] px-2.5 py-2 hover:bg-muted" disabled={compactingId === session.id} onClick={() => { onCompact(session.id); setMenu(null); }}>{compactingId === session.id ? <Loader2 className="size-3.5 animate-spin" /> : <Minimize2 className="size-3.5" />} {compactingId === session.id ? t('session.compacting') : t('session.compact')}</button>}
            {onArchive && <button className="flex w-full items-center gap-2 rounded-[8px] px-2.5 py-2 hover:bg-muted" onClick={() => { onArchive(session.id); setMenu(null); }}><Archive className="size-3.5" /> {t('session.archive')}</button>}
            {onDelete && (
              <>
                <div className="my-1 h-px bg-border" />
                <button className="flex w-full items-center gap-2 rounded-[8px] px-2.5 py-2 text-destructive hover:bg-[rgba(240,45,45,0.08)]" onClick={() => { onDelete(session.id); setMenu(null); }}>
                  <Trash2 className="size-3.5" /> {t('session.delete')}
                </button>
              </>
            )}
          </>
        )}
      </div>,
      document.body,
    );
  }

  function renderSessionItem(s: SessionInfo, index: number, list: SessionInfo[], isArchived: boolean) {
    const active = s.id === activeSessionId;
    const label = s.title || t('session.label').replace('{n}', String(list.length - index));
    const isEditing = editId === s.id;
    const sessionDate = formatSessionDate(s);

    return (
      <div
        key={s.id}
        className={`group relative mb-1 flex cursor-pointer items-center rounded-[12px] border px-3 py-2 text-sm transition-colors ${
          active
            ? 'border-primary/16 bg-primary-soft text-foreground'
            : isArchived
              ? 'border-transparent text-muted-foreground/70 hover:border-border hover:bg-muted'
              : 'border-transparent text-muted-foreground hover:border-border hover:bg-muted'
        }`}
        onClick={() => { if (!isEditing) onSelect(s.id); }}
      >
        <div className={`mr-3 flex size-8 shrink-0 items-center justify-center rounded-[10px] ${
          active
            ? 'bg-primary/12 text-primary'
            : isArchived
              ? 'bg-muted text-muted-foreground/50'
              : 'bg-muted text-muted-foreground/70'
        }`}>
          {isArchived ? <Archive className="size-3.5" /> : <MessageSquare className="size-3.5" />}
        </div>

        {isEditing ? (
          <input
            ref={editRef}
            className="min-w-0 flex-1 border-b border-primary bg-transparent text-sm text-foreground outline-none"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') { setEditId(null); setEditValue(''); }
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <div className="min-w-0 flex-1">
            <span className={`block truncate ${active ? 'font-medium text-foreground' : 'text-inherit'} ${isArchived ? 'italic' : ''}`}>
              {label}
            </span>
          </div>
        )}

        {!isEditing && sessionDate && (
          <span className="ml-3 shrink-0 text-[11px] text-muted-foreground/60">
            {sessionDate}
          </span>
        )}

        {!readonly && !isEditing && (
          <div className="ml-2 flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
            <button
              ref={(node) => {
                if (node) menuButtonRefs.current.set(s.id, node);
                else menuButtonRefs.current.delete(s.id);
              }}
              className="rounded-[8px] p-1 text-muted-foreground/50 transition-colors hover:bg-card hover:text-foreground"
              onClick={(e) => { e.stopPropagation(); toggleMenu(s.id); }}
            >
              <MoreHorizontal className="size-3.5" />
            </button>
          </div>
        )}

        {renderMenu(s, isArchived)}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          <MessageSquare className="size-3.5" />
          {t('session.list')}
        </span>
        {!readonly && (
          <Button variant="outline" size="icon-xs" onClick={onCreate} title={t('session.new')} className="rounded-[8px]">
            <Plus className="size-3.5" />
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {activeSessions.map((s, index) => renderSessionItem(s, index, activeSessions, false))}

        {activeSessions.length === 0 && archivedSessions.length === 0 && (
          <div className="flex flex-col items-center py-8 text-center text-muted-foreground/60">
            <div className="mb-2 flex size-10 items-center justify-center rounded-[12px] bg-muted">
              <MessageSquare className="size-5" />
            </div>
            <span className="text-xs">{t('session.empty')}</span>
            <span className="mt-0.5 text-[11px]">{t('session.emptyHint')}</span>
          </div>
        )}

        {archivedSessions.length > 0 && (
          <>
            <button
              onClick={() => setShowArchived((v) => !v)}
              className="mt-2 flex w-full items-center gap-1.5 rounded-[10px] px-2 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronDown className={`size-3 transition-transform duration-200 ${showArchived ? '' : '-rotate-90'}`} />
              <Archive className="size-3" />
              <span>{t('session.archived')}</span>
              <span className="ml-auto text-muted-foreground/60">{archivedSessions.length}</span>
            </button>
            {showArchived && <div className="animate-fade-in">{archivedSessions.map((s, index) => renderSessionItem(s, index, archivedSessions, true))}</div>}
          </>
        )}
      </div>
    </div>
  );
}