import { Link, useNavigate } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { AgentWorkspacePanel } from '../components/agent-workspace/AgentWorkspacePanel';
import { useAuthStore } from '../stores/auth';
import { ThemeToggle } from '../components/theme-toggle';
export default function AgentWorkspacePage() {
  const token = useAuthStore(state => state.token) || '';
  const navigate = useNavigate();
  return <main id="main-content" className="min-h-screen bg-background text-foreground">
    <header className="flex items-center justify-between border-b px-6 py-3">
      <Link to="/" className="inline-flex items-center gap-2"><ArrowLeft size={16} />Skill 工作台</Link>
      <ThemeToggle />
    </header>
    <AgentWorkspacePanel token={token} onOpenSkill={skill => navigate(`/?view=run&skill=${encodeURIComponent(`${skill.packageId}:${skill.skillId}`)}`)} />
  </main>;
}
