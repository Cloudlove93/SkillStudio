import { useState } from 'react';
import { Settings, Shield, LogOut } from 'lucide-react';
import { useAuthStore } from '../../stores/auth';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import SettingsDialog from '../settings/SettingsDialog';
import { useT } from '../../i18n';
import { useNavigate } from 'react-router';

export default function AgentList() {
  const t = useT();
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const authUser = useAuthStore((s) => s.user);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

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
    </div>
  );
}
