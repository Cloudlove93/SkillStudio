import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import {
  AgentWorkspacePanel,
  type AgentWorkspaceMode,
} from '../components/agent-workspace/AgentWorkspacePanel';
import { useAuthStore } from '../stores/auth';
import { ThemeToggle } from '../components/theme-toggle';

export default function AgentWorkspacePage({
  mode = 'assemble',
}: {
  mode?: AgentWorkspaceMode;
}) {
  const token = useAuthStore(state => state.token) || '';
  const navigate = useNavigate();
  const location = useLocation();
  const agentId = new URLSearchParams(location.search).get('agentId');

  if (mode === 'chat' && !agentId) {
    return <Navigate to="/agents" replace />;
  }

  return <main id="main-content" className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
    <header className="flex shrink-0 items-center justify-between border-b px-6 py-3">
      <Link
        to={mode === 'chat' ? `/agents?agentId=${encodeURIComponent(agentId!)}` : '/'}
        className="inline-flex items-center gap-2"
      >
        <ArrowLeft size={16} />
        {mode === 'chat' ? '返回装配台' : '返回 SkillStudio'}
      </Link>
      <ThemeToggle />
    </header>
    <AgentWorkspacePanel
      key={mode}
      mode={mode}
      token={token}
      onOpenSkill={skill => navigate(`/?view=run&skill=${encodeURIComponent(`${skill.packageId}:${skill.skillId}`)}`)}
    />
  </main>;
}
