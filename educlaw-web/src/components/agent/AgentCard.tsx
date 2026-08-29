import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Play, Square, RotateCw, Trash2, Globe, Settings, FolderInput, X } from 'lucide-react';
import type { AgentConfig } from '../../stores/agent';
import type { SidebarGroup } from '../../stores/sidebar-groups';
import { matchAgentIcon } from '@/lib/agent-icons';
import { getGroupIcon } from '@/components/sidebar/IconPicker';
import { useT } from '../../i18n';

export default function AgentCard({
  agent,
  active,
  isOwner = true,
  onOpen,
  onStart,
  onStop,
  onRemove,
  onSettings,
  groups,
  onMoveToGroup,
  onRemoveFromGroup,
}: {
  agent: AgentConfig;
  active?: boolean;
  isOwner?: boolean;
  onOpen: () => void;
  onStart: () => void;
  onStop: () => void;
  onRemove: () => void;
  onSettings?: () => void;
  groups?: SidebarGroup[];
  onMoveToGroup?: (groupId: string) => void;
  onRemoveFromGroup?: () => void;
}) {
  const t = useT();
  const [showGroupMenu, setShowGroupMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const openMenu = useCallback(() => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + 4, left: rect.left });
    }
    setShowGroupMenu((v) => !v);
  }, []);

  useEffect(() => {
    if (!showGroupMenu) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (btnRef.current?.contains(target)) return;
      setShowGroupMenu(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showGroupMenu]);

  const statusMeta: Record<string, { dot: string; label: string }> = {
    running: { dot: 'bg-[color:var(--success)] animate-pulse-dot', label: t('agent.running') },
    starting: { dot: 'bg-[color:var(--warning)] animate-pulse-dot', label: t('agent.starting') },
    stopped: { dot: 'bg-muted-foreground/30', label: t('agent.stopped') },
    error: { dot: 'bg-destructive', label: t('agent.error') },
  };

  const status = statusMeta[agent.status] ?? statusMeta.stopped;
  const { icon: SubjectIcon, color: iconColor } = matchAgentIcon(agent.name);
  const currentGroup = groups?.find((g) => g.items.some((i) => i.itemId === agent.id && i.itemType === 'agent'));

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`打开 ${agent.name}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      className={`group relative mb-2 flex cursor-pointer items-start gap-3 rounded-[16px] border px-3.5 py-3 transition-colors ${active ? 'border-primary/16 bg-primary-soft shadow-[var(--shadow-sm)]' : 'border-border bg-card hover:bg-muted'}`}
    >
      <div className={`flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-muted ${iconColor}`}>
        <SubjectIcon className="size-4" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-semibold leading-tight text-foreground">{agent.name}</span>
          {agent.public && <Globe className="size-3 shrink-0 text-[color:var(--info)]" />}
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <span className={`size-1.5 shrink-0 rounded-full ${status.dot}`} />
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{status.label}</span>
          <span className="font-mono text-[10px] text-muted-foreground/60">{agent.shortId}</span>
        </div>
      </div>

      {isOwner && (
        <div className="absolute right-2 top-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          {groups && groups.length > 0 && onMoveToGroup && (
            <div className="relative">
              <button type="button" ref={btnRef} onClick={(e) => { e.stopPropagation(); openMenu(); }} className="rounded-[8px] border border-border bg-card p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" title="移动到分组" aria-label="移动到分组" aria-haspopup="menu" aria-expanded={showGroupMenu}>
                <FolderInput className="size-3" />
              </button>
              {showGroupMenu && createPortal(
                <div ref={menuRef} role="menu" className="fixed z-[120] min-w-[160px] rounded-[12px] border border-border bg-popover p-1.5 shadow-[var(--shadow-md)]" style={{ top: menuPos.top, left: menuPos.left }}>
                  {groups.map((g) => {
                    const Icon = getGroupIcon(g.icon);
                    const isCurrent = g.id === currentGroup?.id;
                    return <button type="button" role="menuitem" key={g.id} onClick={(e) => { e.stopPropagation(); onMoveToGroup(g.id); setShowGroupMenu(false); }} className={`flex w-full items-center gap-2 rounded-[8px] px-3 py-2 text-[12px] transition-colors ${isCurrent ? 'bg-primary-soft text-primary' : 'text-foreground hover:bg-muted'}`}><Icon className="size-3.5" /><span className="truncate">{g.name}</span></button>;
                  })}
                  {currentGroup && onRemoveFromGroup && (
                    <>
                      <div className="my-1 h-px bg-border" />
                      <button type="button" role="menuitem" onClick={(e) => { e.stopPropagation(); onRemoveFromGroup(); setShowGroupMenu(false); }} className="flex w-full items-center gap-2 rounded-[8px] px-3 py-2 text-[12px] text-muted-foreground hover:bg-muted"><X className="size-3.5" /><span>移出分组</span></button>
                    </>
                  )}
                </div>,
                document.body,
              )}
            </div>
          )}
          {onSettings && <button onClick={(e) => { e.stopPropagation(); onSettings(); }} className="rounded-[8px] border border-border bg-card p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" title={t('agentSettings.title')}><Settings className="size-3" /></button>}
          {(agent.status === 'stopped' || agent.status === 'error') && <button onClick={(e) => { e.stopPropagation(); onStart(); }} className="rounded-[8px] border border-[rgba(30,180,120,0.18)] bg-[rgba(30,180,120,0.10)] p-1.5 text-[color:var(--success)] transition-colors hover:bg-[rgba(30,180,120,0.16)]" title={agent.status === 'error' ? t('agent.restart') : t('agent.start')}>{agent.status === 'error' ? <RotateCw className="size-3" /> : <Play className="size-3" />}</button>}
          {(agent.status === 'running' || agent.status === 'starting') && <button onClick={(e) => { e.stopPropagation(); onStop(); }} className="rounded-[8px] border border-[rgba(255,180,0,0.18)] bg-[rgba(255,180,0,0.12)] p-1.5 text-[color:var(--warning)] transition-colors hover:bg-[rgba(255,180,0,0.18)]" title={t('agent.stop')}><Square className="size-3" /></button>}
          <button onClick={(e) => { e.stopPropagation(); onRemove(); }} className="rounded-[8px] border border-border bg-card p-1.5 text-muted-foreground transition-colors hover:border-destructive/20 hover:bg-[rgba(240,45,45,0.08)] hover:text-destructive" title={t('agent.delete')}><Trash2 className="size-3" /></button>
        </div>
      )}
    </div>
  );
}
