import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import {
  AgentWorkspacePanel,
  type AgentWorkspaceMode,
} from '../components/agent-workspace/AgentWorkspacePanel';
import { AssetCenter } from '../components/asset-center/AssetCenter';
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

  if (mode === 'assemble') return <AssetCenter token={token} />;
  if (!agentId) return <Navigate to="/agents" replace />;

  return <main id="main-content" className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
    <header className="flex shrink-0 items-center justify-between border-b px-6 py-3">
      <Link
        to={`/agents?agentId=${encodeURIComponent(agentId)}`}
        className="inline-flex items-center gap-2"
      >
        <ArrowLeft size={16} />
        返回装配台
      </Link>
      <ThemeToggle />
    </header>
    <AgentWorkspacePanel
      key={`chat:${agentId}`}
      mode="chat"
      token={token}
      onOpenSkill={skill => navigate(`/?view=run&skill=${encodeURIComponent(`${skill.packageId}:${skill.skillId}`)}`)}
    />
  </main>;
}
