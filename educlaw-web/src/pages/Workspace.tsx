import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { useAgentStore } from '../stores/agent';
import { useUIStore } from '../stores/ui';
import { useChatStore } from '../stores/chat';
import AppLayout from '../components/layout/AppLayout';
import PermissionDialog from '../components/permission/PermissionDialog';
import GlobalSearch from '../components/search/GlobalSearch';
import { useHomeChatStore } from '../stores/home-chat';

const ChatPanel = lazy(() => import('../components/chat/ChatPanel'));
const ProfileGallery = lazy(() => import('../components/agent/ProfileGallery'));
const BuildAgentPanel = lazy(() => import('../components/agent/BuildAgentPanel'));
const SkillLibraryPanel = lazy(() => import('../components/skill/SkillLibraryPanel'));
const ToolLibraryPanel = lazy(() => import('../components/tool/ToolLibraryPanel'));
const DiaryPanel = lazy(() => import('../components/diary/DiaryPanel'));
const DeepStudyPanel = lazy(() => import('../components/deep-study/DeepStudyPanel'));
const HomeChat = lazy(() => import('../components/home/HomeChat'));

function WorkspacePanelFallback() {
  return (
    <div className="flex h-full min-h-[320px] items-center justify-center px-6 text-sm text-muted-foreground">
      Loading workspace...
    </div>
  );
}

function withLazyBoundary(node: ReactNode) {
  return <Suspense fallback={<WorkspacePanelFallback />}>{node}</Suspense>;
}

export default function Workspace() {
  const agents = useAgentStore((s) => s.agents);
  const mainView = useUIStore((s) => s.mainView);
  const reconcileChatAgents = useChatStore((s) => s.reconcileAgents);
  const activeSessionId = useHomeChatStore((s) => s.activeSessionId);
  const activeTabId = useChatStore((s) => s.activeTabId);
  const tabs = useChatStore((s) => s.tabs);
  const activeTab = activeTabId ? tabs.get(activeTabId) : undefined;

  useEffect(() => {
    reconcileChatAgents(agents.map((agent) => ({ id: agent.id, name: agent.name })));
  }, [agents, reconcileChatAgents]);

  function renderMainContent() {
    if (mainView === 'deep-study') return withLazyBoundary(<DeepStudyPanel />);
    if (mainView === 'gallery') return withLazyBoundary(<ProfileGallery />);
    if (mainView === 'build') return withLazyBoundary(<BuildAgentPanel />);
    if (mainView === 'skills') return withLazyBoundary(<SkillLibraryPanel />);
    if (mainView === 'tools') return withLazyBoundary(<ToolLibraryPanel />);
    if (mainView === 'diary') return withLazyBoundary(<DiaryPanel />);
    if (activeTab) return withLazyBoundary(<ChatPanel tab={activeTab} />);
    if (activeSessionId) return withLazyBoundary(<HomeChat sessionId={activeSessionId} />);

    // Default: go to Arena
    return withLazyBoundary(<DeepStudyPanel />);
  }

  return (
    <>
      <AppLayout>{renderMainContent()}</AppLayout>
      <PermissionDialog />
      <GlobalSearch />
    </>
  );
}
