import { useCallback, useRef, useState } from 'react';
import { Settings, MessageSquare, FolderOpen, Sparkles } from 'lucide-react';
import { useChatStore } from '../../stores/chat';
import { useUIStore } from '../../stores/ui';
import { useChatSessions } from '../chat/hooks/useChatSessions';
import SessionList from './SessionList';
import FileExplorer from './FileExplorer';
import SettingsDialog from '../settings/SettingsDialog';
import { useT } from '../../i18n';
import { useOptimizeStore } from '../../stores/optimize';
import { DetailSurface } from '@/components/ui/premium';

export default function AgentDetailSections({
  agentId,
  canLoadData,
  readonly,
}: {
  agentId: string;
  canLoadData: boolean;
  readonly: boolean;
}) {
  const t = useT();
  const tab = useChatStore((s) => s.tabs.get(agentId));
  const setSessionId = useChatStore((s) => s.setSessionId);
  const setOpenFilePath = useUIStore((s) => s.setOpenFilePath);

  const sessions = useChatSessions(agentId, canLoadData);
  const sessionId = tab?.sessionId ?? null;
  const tabSessions = tab?.sessions ?? [];

  const [splitRatio, setSplitRatio] = useState(0.5);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const createAgentRun = useOptimizeStore((s) => s.createAgentRun);
  const optimizationCreating = useOptimizeStore((s) => s.creating);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const ratio = (ev.clientY - rect.top) / rect.height;
      setSplitRatio(Math.min(0.85, Math.max(0.15, ratio)));
    };
    const onUp = () => {
      draggingRef.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, []);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-3 px-3 py-3">
      <div ref={containerRef} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <DetailSurface className="min-h-0 min-w-0 overflow-hidden" style={{ height: `${splitRatio * 100}%` }}>
          {canLoadData ? (
            <SessionList
              sessions={tabSessions}
              activeSessionId={sessionId}
              onSelect={(id) => { setSessionId(agentId, id); setOpenFilePath(null); useUIStore.getState().setMainView(null); }}
              onCreate={sessions.handleCreateSession}
              onDelete={sessions.handleDeleteSession}
              onArchive={sessions.handleArchiveSession}
              onUnarchive={sessions.handleUnarchiveSession}
              onRename={sessions.handleRenameSession}
              readonly={readonly}
            />
          ) : (
            <div className="flex h-full flex-1 flex-col items-center justify-center px-6 text-center text-muted-foreground/70">
              <div className="mb-3 flex size-11 items-center justify-center rounded-[12px] bg-muted text-muted-foreground">
                <MessageSquare className="size-5" />
              </div>
              <p className="text-xs">{t('session.notStarted')}</p>
            </div>
          )}
        </DetailSurface>

        <div onMouseDown={onDragStart} className="group my-2 flex h-4 shrink-0 cursor-row-resize items-center justify-center">
          <div className="pointer-events-none h-1 w-20 rounded-full bg-border transition-colors duration-200 group-hover:bg-primary/40" />
        </div>

        <DetailSurface className="min-h-0 min-w-0 flex-1 overflow-hidden">
          {canLoadData ? (
            <FileExplorer agentId={agentId} onFileSelect={(path) => setOpenFilePath(path)} onDeselect={() => setOpenFilePath(null)} readonly={readonly} />
          ) : (
            <div className="flex h-full flex-1 flex-col items-center justify-center px-6 text-center text-muted-foreground/70">
              <div className="mb-3 flex size-11 items-center justify-center rounded-[12px] bg-muted text-muted-foreground">
                <FolderOpen className="size-5" />
              </div>
              <p className="text-xs">{t('file.notStarted')}</p>
            </div>
          )}
        </DetailSurface>
      </div>

      {!readonly && (
        <DetailSurface className="shrink-0 p-2">
          <button
            onClick={() => void createAgentRun(agentId)}
            disabled={optimizationCreating}
            className="flex w-full items-center gap-3 rounded-[12px] px-3 py-3 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            <div className="flex size-9 items-center justify-center rounded-[10px] bg-primary-soft text-primary">
              <Sparkles className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-medium text-foreground">{t('optimize.action')}</div>
              <div className="text-xs break-words text-muted-foreground">{t('optimize.agentHint')}</div>
            </div>
          </button>
        </DetailSurface>
      )}

      <DetailSurface className="shrink-0 p-2">
        <button
          onClick={() => setShowSettingsDialog(true)}
          className="flex w-full items-center gap-3 rounded-[12px] px-3 py-3 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <div className="flex size-9 items-center justify-center rounded-[10px] bg-primary-soft text-primary">
            <Settings className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-medium text-foreground">{t('sidebar.settings')}</div>
            <div className="text-xs break-words text-muted-foreground">{t('sidebar.settingsHint')}</div>
          </div>
        </button>
      </DetailSurface>

      <SettingsDialog open={showSettingsDialog} onOpenChange={setShowSettingsDialog} />
    </div>
  );
}
