import { lazy, Suspense, useEffect, useState, useCallback, type KeyboardEvent, type ReactNode } from 'react';
import {
  ArrowRight,
  Bot,
  PanelsLeftRight,
  Send,
  Sparkles,
  Zap,
} from 'lucide-react';
import { BASE } from '../api/client';
import { useAgentStore } from '../stores/agent';
import { useUIStore } from '../stores/ui';
import { useChatStore } from '../stores/chat';
import { connectSSE, disconnectSSE, restorePendingQuestions } from '../api/events';
import AppLayout from '../components/layout/AppLayout';
import PermissionDialog from '../components/permission/PermissionDialog';
import GlobalSearch from '../components/search/GlobalSearch';
import { useHomeChatStore } from '../stores/home-chat';
import { useT } from '../i18n';

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
  const t = useT();
  const fetchProfiles = useAgentStore((s) => s.fetchProfiles);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const agents = useAgentStore((s) => s.agents);
  const mainView = useUIStore((s) => s.mainView);
  const setMainView = useUIStore((s) => s.setMainView);
  const setDeepStudyTab = useUIStore((s) => s.setDeepStudyTab);
  const reconcileChatAgents = useChatStore((s) => s.reconcileAgents);
  const activeSessionId = useHomeChatStore((s) => s.activeSessionId);
  const setActiveSession = useHomeChatStore((s) => s.setActiveSession);
  const createSession = useHomeChatStore((s) => s.createSession);
  const setPendingMessage = useHomeChatStore((s) => s.setPendingMessage);
  const fetchSessions = useHomeChatStore((s) => s.fetchSessions);
  const activeTabId = useChatStore((s) => s.activeTabId);
  const tabs = useChatStore((s) => s.tabs);
  const activeTab = activeTabId ? tabs.get(activeTabId) : undefined;
  const [homeInput, setHomeInput] = useState('');

  // useEffect(() => {
  // fetchProfiles();
  // fetchAgents().then(() => {
  //   restorePendingQuestions();
  // });
  // fetchSessions();
  // connectSSE();
  //   return () => disconnectSSE();
  // }, [fetchProfiles, fetchAgents, fetchSessions]);

  useEffect(() => {
    reconcileChatAgents(agents.map((agent) => ({ id: agent.id, name: agent.name })));
  }, [agents, reconcileChatAgents]);


  const handleHomeSend = useCallback(async () => {
    const text = homeInput.trim();
    if (!text) return;
    setHomeInput('');
    setPendingMessage(text);
    const id = await createSession(text);
    setActiveSession(id);
  }, [homeInput, createSession, setActiveSession, setPendingMessage]);

  function handleHomeKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleHomeSend();
    }
  }

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
