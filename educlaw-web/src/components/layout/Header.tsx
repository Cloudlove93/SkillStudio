import { type ComponentType, useMemo } from 'react';
import {
  Activity,
  BookOpen,
  CalendarDays,
  ChevronRight,
  Coins,
  GraduationCap,
  Home,
  MessageSquare,
  PanelLeft,
  Play,
  PanelsLeftRight,
  Search,
  Sparkles,
  Square,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import { useUIStore, type DeepStudyTab } from '../../stores/ui';
import { useAgentStore, isOwnedAgent } from '../../stores/agent';
import { useChatStore, type Message } from '../../stores/chat';
import { useHomeChatStore } from '../../stores/home-chat';
import { useAuthStore } from '../../stores/auth';
import { Button } from '@/components/ui/button';
import { useT, type MessageKey } from '../../i18n';
import NotificationBell from '../notification/NotificationBell';
import { BASE } from '../../api/client';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatCost(n: number): string {
  if (n === 0) return '$0';
  if (n < 0.001) return '<$0.001';
  if (n < 0.01) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

function MetricsBadge({
  icon: Icon,
  label,
  value,
  tone = 'neutral',
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone?: 'neutral' | 'primary' | 'gold';
}) {
  const toneClass =
    tone === 'primary'
      ? 'border-primary/12 bg-primary-soft text-primary'
      : tone === 'gold'
        ? 'border-[rgba(255,180,0,0.14)] bg-[rgba(255,180,0,0.12)] text-[color:var(--warning)]'
        : 'border-border bg-card text-muted-foreground';

  return (
    <div
      className={`hidden items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium sm:flex ${toneClass}`}
      title={label}
    >
      <Icon className="size-3" />
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function SessionMetrics({ messages }: { messages: Message[] }) {
  const metrics = useMemo(() => {
    let totalCost = 0;
    let totalInput = 0;
    let totalOutput = 0;
    let totalReasoning = 0;
    let model = '';
    let msgCount = 0;

    for (const msg of messages) {
      if (msg.role !== 'assistant') continue;
      msgCount += 1;
      if (msg.cost) totalCost += msg.cost;
      if (msg.tokens) {
        totalInput += msg.tokens.input;
        totalOutput += msg.tokens.output;
        totalReasoning += msg.tokens.reasoning ?? 0;
      }
      if (msg.modelID && !model) model = msg.modelID;
    }

    const totalTokens = totalInput + totalOutput + totalReasoning;
    return { totalCost, totalTokens, model, msgCount };
  }, [messages]);

  if (metrics.totalTokens === 0 && metrics.totalCost === 0 && metrics.msgCount === 0) return null;

  return (
    <div className="hidden items-center gap-2 xl:flex">
      {metrics.model && (
        <div
          className="max-w-[12rem] truncate rounded-full border border-border bg-card px-3 py-1 text-[11px] font-medium text-primary"
          title={metrics.model}
        >
          <Activity className="mr-1 inline size-3" />
          {metrics.model}
        </div>
      )}
      {metrics.totalTokens > 0 && (
        <MetricsBadge icon={Zap} label="Total tokens" value={formatTokens(metrics.totalTokens)} tone="primary" />
      )}
      {metrics.totalCost > 0 && (
        <MetricsBadge icon={Coins} label="Total cost" value={formatCost(metrics.totalCost)} tone="gold" />
      )}
      {metrics.msgCount > 0 && <MetricsBadge icon={MessageSquare} label="Replies" value={String(metrics.msgCount)} />}
    </div>
  );
}

function HeaderQuickAction({
  active,
  onClick,
  icon: Icon,
  label,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  icon: ComponentType<{ className?: string }>;
  label: string;
  tone: 'study' | 'diary';
}) {
  const idleClass =
    tone === 'study'
      ? 'border-border bg-card text-primary hover:border-primary/20 hover:bg-primary-soft'
      : 'border-border bg-card text-[color:var(--warning)] hover:border-[rgba(255,180,0,0.18)] hover:bg-[rgba(255,180,0,0.10)]';

  const activeClass =
    tone === 'study'
      ? 'border-primary/18 bg-primary text-white shadow-[0_10px_24px_rgba(85,90,255,0.18)]'
      : 'border-[rgba(255,180,0,0.18)] bg-[color:var(--warning)] text-white shadow-[0_10px_24px_rgba(255,180,0,0.18)]';

  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-[10px] border px-3 py-2 text-xs font-semibold transition-colors ${active ? activeClass : idleClass}`}
    >
      <span className={`flex size-6 items-center justify-center rounded-[8px] ${active ? 'bg-black/10 text-white' : 'bg-muted text-current'}`}>
        <Icon className="size-3.5" />
      </span>
      <span>{label}</span>
    </button>
  );
}

const viewConfig = {
  'deep-study': { icon: GraduationCap, labelKey: 'sidebar.deepStudy' as const, accent: 'bg-primary-soft text-primary' },
  gallery: { icon: Home, labelKey: 'sidebar.agentRepo' as const, accent: 'bg-[rgba(55,130,255,0.10)] text-[color:var(--info)]' },
  build: { icon: Sparkles, labelKey: 'sidebar.buildAgent' as const, accent: 'bg-[rgba(255,180,0,0.12)] text-[color:var(--warning)]' },
  skills: { icon: BookOpen, labelKey: 'sidebar.skillRepo' as const, accent: 'bg-[rgba(30,180,120,0.10)] text-[color:var(--success)]' },
  tools: { icon: Wrench, labelKey: 'sidebar.toolRepo' as const, accent: 'bg-[rgba(55,130,255,0.10)] text-[color:var(--info)]' },
  diary: { icon: CalendarDays, labelKey: 'sidebar.diary' as const, accent: 'bg-[rgba(255,180,0,0.12)] text-[color:var(--warning)]' },
};

const deepStudyTabConfig: Record<DeepStudyTab, { icon: ComponentType<{ className?: string }>; labelKey: string }> = {
  gallery: { icon: Home, labelKey: 'sidebar.agentRepo' },
  build: { icon: Sparkles, labelKey: 'sidebar.buildAgent' },
  skills: { icon: BookOpen, labelKey: 'sidebar.skillRepo' },
  tools: { icon: Wrench, labelKey: 'sidebar.toolRepo' },
  arena: { icon: PanelsLeftRight, labelKey: 'sidebar.arena' },
  optimize: { icon: Sparkles, labelKey: 'sidebar.optimize' },
};

export default function Header() {
  const t = useT();
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const setMainView = useUIStore((s) => s.setMainView);
  const mainView = useUIStore((s) => s.mainView);
  const deepStudyTab = useUIStore((s) => s.deepStudyTab);
  const setDeepStudyTab = useUIStore((s) => s.setDeepStudyTab);
  const setOpenFilePath = useUIStore((s) => s.setOpenFilePath);
  const activeTabId = useChatStore((s) => s.activeTabId);
  const tabs = useChatStore((s) => s.tabs);
  const setActiveTab = useChatStore((s) => s.setActiveTab);
  const setActiveSession = useHomeChatStore((s) => s.setActiveSession);
  const activeSessionId = useHomeChatStore((s) => s.activeSessionId);
  const homeSessions = useHomeChatStore((s) => s.sessions);
  const authUser = useAuthStore((s) => s.user);

  const activeHomeChatTitle = activeSessionId
    ? homeSessions.find((s) => s.id === activeSessionId)?.title
    : null;

  const activeTab = activeTabId ? tabs.get(activeTabId) : undefined;
  const agentId = activeTab?.agentId;
  const agent = useAgentStore((s) => (agentId ? s.agents.find((a) => a.id === agentId) : undefined));
  const startAgent = useAgentStore((s) => s.startAgent);
  const stopAgent = useAgentStore((s) => s.stopAgent);

  const isOwner = agent ? isOwnedAgent(agent) : false;
  const messages = activeTab?.messages ?? [];
  const isHome = !activeTabId && !mainView && !activeSessionId;
  const isDefaultArenaView = mainView === 'deep-study' && deepStudyTab === 'arena';
  const showDeepStudySubTab = mainView === 'deep-study' && deepStudyTab !== 'arena';

  function handleGoHome() {
    setActiveTab(null);
    setMainView('deep-study');
    setDeepStudyTab('arena');
    setOpenFilePath(null);
    setActiveSession(null);
  }

  const viewCfg = mainView ? viewConfig[mainView] : null;

  return (
    <header className="relative z-[160] shrink-0 rounded-[20px] border border-border/70 bg-background/95 px-3 py-3 shadow-[var(--shadow-sm)] sm:px-4">
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {/*<Button*/}
          {/*  variant="outline"*/}
          {/*  size="icon-sm"*/}
          {/*  onClick={toggleSidebar}*/}
          {/*  title={t('status.toggleSidebar')}*/}
          {/*  className="rounded-[10px]"*/}
          {/*>*/}
          {/*  <PanelLeft className="size-4" />*/}
          {/*</Button>*/}

          <button
            onClick={handleGoHome}
            className={`flex min-w-0 items-center gap-3 rounded-[14px] border px-3 py-2 text-left transition-colors ${
              isHome ? 'border-primary/20 bg-primary-soft' : 'border-border bg-card hover:bg-muted'
            }`}
          >
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-card shadow-[var(--shadow-sm)]">
              <img src={`${BASE}/logo.png`} alt="" className="size-7 rounded-[10px] object-cover" />
            </div>
            <div className="min-w-0">
              <div className={`truncate text-[15px] font-semibold tracking-[-0.03em] ${isHome ? 'text-gradient-primary' : 'text-foreground'}`}>
                EduArena
              </div>
              <div className="truncate text-xs text-muted-foreground">Arena for agent evaluation</div>
            </div>
          </button>

          {/*{activeTab && (*/}
          {/*  <nav className="hidden min-w-0 items-center gap-2 lg:flex">*/}
          {/*    <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" />*/}
          {/*    <div className="flex min-w-0 items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm shadow-[var(--shadow-sm)]">*/}
          {/*      <span className={`size-2 shrink-0 rounded-full ${agent?.status === 'running' ? 'bg-[color:var(--success)] animate-pulse-dot' : 'bg-muted-foreground/40'}`} />*/}
          {/*      <span className="truncate font-medium text-foreground">{activeTab.agentName}</span>*/}
          {/*    </div>*/}
          {/*  </nav>*/}
          {/*)}*/}

          {/*{!activeTab && !viewCfg && activeHomeChatTitle && (*/}
          {/*  <nav className="hidden min-w-0 items-center gap-2 lg:flex">*/}
          {/*    <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" />*/}
          {/*    <div className="flex min-w-0 items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm shadow-[var(--shadow-sm)]">*/}
          {/*      <MessageSquare className="size-3.5 shrink-0 text-primary" />*/}
          {/*      <span className="max-w-[220px] truncate font-medium text-foreground">{activeHomeChatTitle}</span>*/}
          {/*      <Button variant="ghost" size="icon-xs" onClick={() => setActiveSession(null)} className="rounded-full">*/}
          {/*        <X className="size-3" />*/}
          {/*      </Button>*/}
          {/*    </div>*/}
          {/*  </nav>*/}
          {/*)}*/}

          {/*{viewCfg && !isDefaultArenaView && (*/}
          {/*  <nav className="hidden items-center gap-2 md:flex">*/}
          {/*    <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" />*/}
          {/*    <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 shadow-[var(--shadow-sm)]">*/}
          {/*      <div className={`flex size-7 items-center justify-center rounded-full ${viewCfg.accent}`}>*/}
          {/*        <viewCfg.icon className="size-4" />*/}
          {/*      </div>*/}
          {/*      <span className="text-sm font-medium text-foreground">{t(viewCfg.labelKey)}</span>*/}
          {/*      <Button variant="ghost" size="icon-xs" onClick={() => { setMainView('deep-study'); setDeepStudyTab('arena'); }} className="rounded-full">*/}
          {/*        <X className="size-3" />*/}
          {/*      </Button>*/}
          {/*    </div>*/}
          {/*    {showDeepStudySubTab && (() => {*/}
          {/*      const tabCfg = deepStudyTabConfig[deepStudyTab];*/}
          {/*      const TabIcon = tabCfg.icon;*/}
          {/*      return (*/}
          {/*        <div className="flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">*/}
          {/*          <TabIcon className="size-3.5" />*/}
          {/*          {t(tabCfg.labelKey as MessageKey)}*/}
          {/*        </div>*/}
          {/*      );*/}
          {/*    })()}*/}
          {/*  </nav>*/}
          {/*)}*/}
        </div>

        {/*<div className="flex items-center gap-2">*/}
        {/*  <Button*/}
        {/*    variant="outline"*/}
        {/*    size="sm"*/}
        {/*    onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, ctrlKey: true }))}*/}
        {/*    className="hidden gap-1.5 rounded-[10px] text-muted-foreground md:flex"*/}
        {/*  >*/}
        {/*    <Search className="size-3.5" />*/}
        {/*    <kbd className="rounded border border-border bg-muted px-1 py-0.5 text-[10px] font-medium">Ctrl K</kbd>*/}
        {/*  </Button>*/}

        {/*  <NotificationBell />*/}
        {/*  <SessionMetrics messages={messages} />*/}

        {/*  {agent && isOwner && (*/}
        {/*    agent.status === 'running' ? (*/}
        {/*      <Button*/}
        {/*        variant="outline"*/}
        {/*        size="icon-sm"*/}
        {/*        onClick={() => stopAgent(agentId!)}*/}
        {/*        title="Stop agent"*/}
        {/*        className="rounded-[10px] text-destructive"*/}
        {/*      >*/}
        {/*        <Square className="size-4" />*/}
        {/*      </Button>*/}
        {/*    ) : (*/}
        {/*      <Button*/}
        {/*        variant="outline"*/}
        {/*        size="icon-sm"*/}
        {/*        onClick={() => startAgent(agentId!)}*/}
        {/*        title="Start agent"*/}
        {/*        className="rounded-[10px] text-[color:var(--success)]"*/}
        {/*      >*/}
        {/*        <Play className="size-4" />*/}
        {/*      </Button>*/}
        {/*    )*/}
        {/*  )}*/}

        {/*  {authUser && (*/}
        {/*    <div className="hidden items-center gap-2 xl:flex">*/}
        {/*      <HeaderQuickAction*/}
        {/*        active={mainView === 'deep-study'}*/}
        {/*        onClick={() => {*/}
        {/*          setActiveTab(null);*/}
        {/*          setActiveSession(null);*/}
        {/*          setMainView('deep-study');*/}
        {/*          setDeepStudyTab('arena');*/}
        {/*        }}*/}
        {/*        icon={GraduationCap}*/}
        {/*        label={t('sidebar.deepStudy')}*/}
        {/*        tone="study"*/}
        {/*      />*/}
        {/*      <HeaderQuickAction*/}
        {/*        active={mainView === 'diary'}*/}
        {/*        onClick={() => {*/}
        {/*          setActiveTab(null);*/}
        {/*          setActiveSession(null);*/}
        {/*          setMainView('diary');*/}
        {/*        }}*/}
        {/*        icon={CalendarDays}*/}
        {/*        label={t('sidebar.diary')}*/}
        {/*        tone="diary"*/}
        {/*      />*/}
        {/*    </div>*/}
        {/*  )}*/}
        {/*</div>*/}
      </div>
    </header>
  );
}
