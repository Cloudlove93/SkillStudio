import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Library, Search, Settings, MessageSquare, Plus, Trash2, Shield, LogOut, ChevronRight, Pencil, FolderPlus, FolderInput, X, Globe } from 'lucide-react';
import { useAgentStore, isOwnedAgent, type AgentConfig } from '../../stores/agent';
import { useUIStore } from '../../stores/ui';
import { useChatStore } from '../../stores/chat';
import { useHomeChatStore, type ChatSession } from '../../stores/home-chat';
import { useAuthStore } from '../../stores/auth';
import { useSidebarGroupStore, type SidebarGroup } from '../../stores/sidebar-groups';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ThemeToggle } from '@/components/theme-toggle';
import AgentCard from '../agent/AgentCard';
import AgentSettingsDialog from '../agent/AgentSettingsDialog';
import SettingsDialog from '../settings/SettingsDialog';
import GroupDialog from './GroupDialog';
import { getGroupIcon } from './IconPicker';
import { useT } from '../../i18n';
import { useNavigate } from 'react-router';

type SidebarItem =
  | { kind: 'agent'; agent: AgentConfig; time: number }
  | { kind: 'chat'; session: ChatSession; time: number };

export default function AgentList() {
  const t = useT();
  const agents = useAgentStore((s) => s.agents);
  const startAgent = useAgentStore((s) => s.startAgent);
  const stopAgent = useAgentStore((s) => s.stopAgent);
  const removeAgent = useAgentStore((s) => s.removeAgent);
  const setMainView = useUIStore((s) => s.setMainView);
  const openTab = useChatStore((s) => s.openTab);
  const activeTabId = useChatStore((s) => s.activeTabId);
  const setActiveTab = useChatStore((s) => s.setActiveTab);

  const sessions = useHomeChatStore((s) => s.sessions);
  const activeSessionId = useHomeChatStore((s) => s.activeSessionId);
  const setActiveSession = useHomeChatStore((s) => s.setActiveSession);
  const createSession = useHomeChatStore((s) => s.createSession);
  const deleteSession = useHomeChatStore((s) => s.deleteSession);

  const groups = useSidebarGroupStore((s) => s.groups);
  const fetchGroups = useSidebarGroupStore((s) => s.fetchGroups);
  const createGroup = useSidebarGroupStore((s) => s.createGroup);
  const updateGroup = useSidebarGroupStore((s) => s.updateGroup);
  const deleteGroup = useSidebarGroupStore((s) => s.deleteGroup);
  const addItem = useSidebarGroupStore((s) => s.addItem);
  const moveItem = useSidebarGroupStore((s) => s.moveItem);
  const toggleCollapsed = useSidebarGroupStore((s) => s.toggleCollapsed);

  const [search, setSearch] = useState('');
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [settingsAgentId, setSettingsAgentId] = useState<string | null>(null);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<SidebarGroup | null>(null);
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);
  const [dragOverUngrouped, setDragOverUngrouped] = useState(false);

  const authUser = useAuthStore((s) => s.user);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  useEffect(() => { fetchGroups(); }, [fetchGroups]);

  // Build items map by id for quick lookup
  const { ownedItems, publicItems } = useMemo(() => {
    const keywords = search.toLowerCase().split(/\s+/).filter(Boolean);
    const matchesSearch = (text: string) => !keywords.length || keywords.every((kw) => text.toLowerCase().includes(kw));

    const ownedAgents: SidebarItem[] = agents
      .filter((a) => isOwnedAgent(a) && matchesSearch(`${a.name} ${a.description}`))
      .map((a) => ({ kind: 'agent' as const, agent: a, time: a.createdAt ? new Date(a.createdAt).getTime() : 0 }));

    const pubAgents: SidebarItem[] = agents
      .filter((a) => !isOwnedAgent(a) && matchesSearch(`${a.name} ${a.description}`))
      .map((a) => ({ kind: 'agent' as const, agent: a, time: a.createdAt ? new Date(a.createdAt).getTime() : 0 }));

    return {
      ownedItems: ownedAgents.sort((a, b) => b.time - a.time),
      publicItems: pubAgents.sort((a, b) => b.time - a.time),
    };
  }, [agents, sessions, search]);

  const allItems = useMemo(() => [...ownedItems, ...publicItems], [ownedItems, publicItems]);

  // Set of grouped item IDs
  const groupedItemIds = useMemo(() => {
    const set = new Set<string>();
    for (const g of groups) {
      for (const i of g.items) {
        set.add(`${i.itemType}:${i.itemId}`);
      }
    }
    return set;
  }, [groups]);

  // Ungrouped items (only from owned items 闂?public items shown separately)
  const ungroupedItems = useMemo(
    () => ownedItems.filter((item) => {
      const key = item.kind === 'agent' ? `agent:${item.agent.id}` : `chat:${item.session.id}`;
      return !groupedItemIds.has(key);
    }),
    [ownedItems, groupedItemIds],
  );

  // Items for a specific group
  const getGroupItems = useCallback(
    (group: SidebarGroup) => {
      return group.items
        .map((gi) => allItems.find((item) => {
          if (gi.itemType === 'agent' && item.kind === 'agent') return item.agent.id === gi.itemId;
          if (gi.itemType === 'chat' && item.kind === 'chat') return item.session.id === gi.itemId;
          return false;
        }))
        .filter(Boolean) as SidebarItem[];
    },
    [allItems],
  );

  function handleOpenAgent(agent: AgentConfig) {
    openTab(agent.id, agent.name);
    setMainView(null);
  }

  function handleOpenChat(sessionId: string) {
    setActiveSession(sessionId);
    setActiveTab(null);
    setMainView(null);
  }

  async function handleNewChat() {
    const id = await createSession();
    setActiveSession(id);
    setActiveTab(null);
    setMainView(null);
  }

  function formatTime(ts: string) {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  // Drag & Drop handlers
  function handleDragStart(e: React.DragEvent, itemId: string, itemType: 'agent' | 'chat') {
    e.dataTransfer.setData('text/plain', JSON.stringify({ itemId, itemType }));
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleGroupDragOver(e: React.DragEvent, groupId: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverGroupId(groupId);
  }

  function handleGroupDragLeave() {
    setDragOverGroupId(null);
  }

  function handleGroupDrop(e: React.DragEvent, groupId: string) {
    e.preventDefault();
    setDragOverGroupId(null);
    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain'));
      if (data.itemId && data.itemType) {
        addItem(groupId, data.itemId, data.itemType);
      }
    } catch { /* ignore invalid data */ }
  }

  function handleUngroupedDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverUngrouped(true);
  }

  function handleUngroupedDragLeave() {
    setDragOverUngrouped(false);
  }

  function handleUngroupedDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOverUngrouped(false);
    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain'));
      if (data.itemId && data.itemType) {
        moveItem(data.itemId, data.itemType, null);
      }
    } catch { /* ignore */ }
  }

  function handleCreateGroup(name: string, icon: string) {
    createGroup(name, icon);
  }

  function handleEditGroup(name: string, icon: string) {
    if (editingGroup) {
      updateGroup(editingGroup.id, { name, icon });
      setEditingGroup(null);
    }
  }

  function renderSidebarItem(item: SidebarItem) {
    if (item.kind === 'agent') {
      const a = item.agent;
      const isOwner = isOwnedAgent(a);
      return (
        <div
          key={`agent-${a.id}`}
          draggable
          onDragStart={(e) => handleDragStart(e, a.id, 'agent')}
        >
          <AgentCard
            agent={a}
            active={activeTabId === a.id}
            isOwner={isOwner}
            onOpen={() => handleOpenAgent(a)}
            onStart={() => startAgent(a.id)}
            onStop={() => stopAgent(a.id)}
            onRemove={() => removeAgent(a.id)}
            onSettings={isOwner ? () => setSettingsAgentId(a.id) : undefined}
            groups={groups}
            onMoveToGroup={(groupId) => addItem(groupId, a.id, 'agent')}
            onRemoveFromGroup={() => moveItem(a.id, 'agent', null)}
          />
        </div>
      );
    }
    const s = item.session;
    const currentGroup = groups.find((g) => g.items.some((i) => i.itemId === s.id && i.itemType === 'chat'));
    return (
      <ChatItem
        key={`chat-${s.id}`}
        session={s}
        active={!activeTabId && !useUIStore.getState().mainView && s.id === activeSessionId}
        groups={groups}
        currentGroup={currentGroup}
        onOpen={() => handleOpenChat(s.id)}
        onDelete={() => deleteSession(s.id)}
        onDragStart={(e) => handleDragStart(e, s.id, 'chat')}
        onMoveToGroup={(groupId) => addItem(groupId, s.id, 'chat')}
        onRemoveFromGroup={() => moveItem(s.id, 'chat', null)}
        formatTime={formatTime}
      />
    );
  }

  const hasItems = allItems.length > 0 || groups.length > 0;
  const runningCount = agents.filter((agent) => agent.status === 'running').length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1" />

      <div className="border-t border-border px-4 py-4">
        {authUser && (
          <div className="rounded-[16px] border border-border bg-card px-3 py-3 shadow-[var(--shadow-sm)]">
            <div className="flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-primary text-xs font-bold uppercase text-white shadow-[0_10px_24px_rgba(85,90,255,0.22)]">
              {authUser.username.charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-foreground" title={authUser.username}>
                  {authUser.username}
                </div>
                <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground/50">
                  Operating Workspace
                </div>
              </div>
              <div className="flex items-center gap-1">
                {isAdmin && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => navigate('/admin')}
                    title={t('admin.title')}
                    className="rounded-[8px] hover:bg-primary-soft"
                  >
                    <Shield className="size-3.5 text-primary" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setShowSettingsDialog(true)}
                  title={t('sidebar.settings')}
                  className="rounded-[8px] hover:bg-muted"
                >
                  <Settings className="size-3.5 text-muted-foreground" />
                </Button>
                <ThemeToggle />
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={logout}
                  title={t('auth.logout')}
                  className="rounded-[8px] hover:bg-[rgba(240,45,45,0.08)]"
                >
                  <LogOut className="size-3.5 text-muted-foreground" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      <SettingsDialog open={showSettingsDialog} onOpenChange={setShowSettingsDialog} />
      <AgentSettingsDialog
        agentId={settingsAgentId}
        open={!!settingsAgentId}
        onOpenChange={(open) => { if (!open) setSettingsAgentId(null); }}
      />
      <GroupDialog
        open={groupDialogOpen}
        onOpenChange={setGroupDialogOpen}
        onSave={handleCreateGroup}
      />
      <GroupDialog
        open={!!editingGroup}
        onOpenChange={(open) => { if (!open) setEditingGroup(null); }}
        onSave={handleEditGroup}
        initial={editingGroup ? { name: editingGroup.name, icon: editingGroup.icon } : undefined}
      />
    </div>
  );
}

/** Chat session item with group menu */
function ChatItem({
  session,
  active,
  groups,
  currentGroup,
  onOpen,
  onDelete,
  onDragStart,
  onMoveToGroup,
  onRemoveFromGroup,
  formatTime,
}: {
  session: ChatSession;
  active: boolean;
  groups: SidebarGroup[];
  currentGroup: SidebarGroup | undefined;
  onOpen: () => void;
  onDelete: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onMoveToGroup: (groupId: string) => void;
  onRemoveFromGroup: () => void;
  formatTime: (ts: string) => string;
}) {
  const t = useT();
  const [showGroupMenu, setShowGroupMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  function openMenu() {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + 4, left: rect.left });
    }
    setShowGroupMenu((v) => !v);
  }

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

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className={`group relative mb-2 flex cursor-pointer items-start gap-3 rounded-[16px] border px-3.5 py-3 transition-colors ${
        active
          ? 'border-primary/16 bg-primary-soft shadow-[var(--shadow-sm)]'
          : 'border-border bg-card hover:bg-muted'
      }`}
      onClick={onOpen}
    >
      <div className="hidden" />
      <div className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-muted text-muted-foreground shadow-[var(--shadow-sm)]">
        <MessageSquare className="size-4" />
      </div>
      <div className="flex-1 min-w-0">
        <span className="block truncate text-[13px] font-semibold leading-tight text-foreground">
          {session.title || t('home.newChat')}
        </span>
        <span className="mt-1 block text-[10px] text-muted-foreground/50">
          {formatTime(session.updatedAt)}
        </span>
      </div>
      <div className="absolute right-2 top-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        {groups.length > 0 && (
          <div className="relative">
            <button
              ref={btnRef}
              onClick={(e) => { e.stopPropagation(); openMenu(); }}
              className="rounded-[8px] border border-border bg-card p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Move to Group"
            >
              <FolderInput className="size-3" />
            </button>
            {showGroupMenu && createPortal(
              <div
                ref={menuRef}
                className="fixed z-[120] min-w-[160px] rounded-[12px] border border-border bg-popover p-1.5 shadow-[var(--shadow-md)]"
                style={{ top: menuPos.top, left: menuPos.left }}
              >
                {groups.map((g) => {
                  const Icon = getGroupIcon(g.icon);
                  const isCurrent = g.id === currentGroup?.id;
                  return (
                    <button
                      key={g.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onMoveToGroup(g.id);
                        setShowGroupMenu(false);
                      }}
                      className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-[12px] transition-colors ${
                        isCurrent ? 'bg-primary-soft text-primary' : 'text-foreground hover:bg-muted'
                      }`}
                    >
                      <Icon className="size-3.5" />
                      <span className="truncate">{g.name}</span>
                    </button>
                  );
                })}
                {currentGroup && (
                  <>
                    <div className="my-1 h-px bg-border/70" />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveFromGroup();
                        setShowGroupMenu(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-[8px] px-3 py-2 text-[12px] text-muted-foreground hover:bg-muted"
                    >
                      <X className="size-3.5" />
                      <span>Remove from Group</span>
                    </button>
                  </>
                )}
              </div>,
              document.body,
            )}
          </div>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="rounded-[8px] border border-border bg-card p-1.5 text-muted-foreground transition-colors hover:border-destructive/20 hover:bg-[rgba(240,45,45,0.08)] hover:text-destructive"
          title={t('home.deleteChat')}
        >
          <Trash2 className="size-3" />
        </button>
      </div>
    </div>
  );
}

