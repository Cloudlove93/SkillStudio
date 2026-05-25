import { type ReactNode, useEffect, useState } from 'react';
import { useUIStore } from '../../stores/ui';
import { useChatStore } from '../../stores/chat';
import { useAgentStore, isOwnedAgent } from '../../stores/agent';
import AgentList from '../sidebar/AgentList';
import AgentDetailSections from '../sidebar/AgentDetailSections';

const DESKTOP_QUERY = '(min-width: 1024px)';

export default function AppLayout({ children }: { children: ReactNode }) {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const activeTabId = useChatStore((s) => s.activeTabId);
  const agents = useAgentStore((s) => s.agents);

  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(DESKTOP_QUERY).matches : true,
  );

  useEffect(() => {
    const mql = window.matchMedia(DESKTOP_QUERY);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    if (!isDesktop && sidebarOpen) {
      setSidebarOpen(false);
    }
  }, [isDesktop, sidebarOpen, setSidebarOpen]);

  const activeAgent = activeTabId ? agents.find((a) => a.id === activeTabId) : undefined;
  const isRunning = activeAgent?.status === 'running';
  const isOwner = activeAgent ? isOwnedAgent(activeAgent) : true;
  const canLoadData = isRunning || !isOwner;

  const sidebarContent = activeTabId ? (
    <AgentDetailSections
      agentId={activeTabId}
      canLoadData={canLoadData}
      readonly={!isOwner}
    />
  ) : (
    <AgentList />
  );

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-mesh-gradient opacity-80" />
      <div className="pointer-events-none absolute left-[-8rem] top-[-7rem] h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(85,90,255,0.12),transparent_65%)] blur-3xl animate-float-orb-1" />
      <div className="pointer-events-none absolute right-[-8rem] top-12 h-64 w-64 rounded-full bg-[radial-gradient(circle,rgba(55,130,255,0.12),transparent_65%)] blur-3xl animate-float-orb-2" />

      <div className="relative z-10 flex h-full flex-col gap-3 p-3 sm:p-4">
        <div className="relative flex min-h-0 flex-1 overflow-hidden rounded-[24px] border border-border/70 bg-background/95 shadow-[var(--shadow-md)]">
          <aside
            className={`relative hidden h-full min-w-0 flex-shrink-0 border-r border-border bg-card/88 transition-all duration-200 lg:flex ${
              sidebarOpen && isDesktop ? 'w-[23rem] opacity-100' : 'w-0 opacity-0'
            }`}
          >
            {sidebarOpen && isDesktop && <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">{sidebarContent}</div>}
          </aside>

          {sidebarOpen && !isDesktop && (
            <>
              <div
                className="fixed inset-0 z-40 bg-[rgba(10,10,40,0.28)]"
                onClick={() => setSidebarOpen(false)}
              />
              <aside className="fixed left-3 top-20 bottom-3 z-50 flex w-[22rem] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-[20px] border border-border/70 bg-background/98 shadow-[var(--shadow-lg)] animate-slide-in-left">
                <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">{sidebarContent}</div>
              </aside>
            </>
          )}

          <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-card/52">
            <div className="pointer-events-none absolute inset-0 bg-dot-pattern opacity-35" />
            <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-white/45 via-white/10 to-transparent dark:from-white/5" />
            <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden">{children}</main>
          </div>
        </div>
      </div>
    </div>
  );
}
