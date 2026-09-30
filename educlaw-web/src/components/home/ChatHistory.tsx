import { useHomeChatStore } from '../../stores/home-chat';
import { useT } from '../../i18n';
import { ScrollArea } from '../ui/scroll-area';
import { Button } from '../ui/button';
import { Plus, Trash2 } from 'lucide-react';

interface ChatHistoryProps {
  onNewChat: () => void;
}

export default function ChatHistory({ onNewChat }: ChatHistoryProps) {
  const t = useT();
  const sessions = useHomeChatStore((s) => s.sessions);
  const activeSessionId = useHomeChatStore((s) => s.activeSessionId);
  const setActiveSession = useHomeChatStore((s) => s.setActiveSession);
  const deleteSession = useHomeChatStore((s) => s.deleteSession);

  function formatTime(ts: string) {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/20">
        <span className="text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wider">
          {t('home.chatHistory')}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={onNewChat}
          title={t('home.newChat')}
        >
          <Plus className="size-3.5" />
        </Button>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        {sessions.length === 0 ? (
          <p className="px-3 py-8 text-center text-xs text-muted-foreground/40">
            {t('home.noHistory')}
          </p>
        ) : (
          <div className="py-1">
            {sessions.map((session) => (
              <div
                key={session.id}
                className={`group flex items-center gap-2 px-3 py-2 mx-1 rounded-md cursor-pointer transition-colors ${
                  session.id === activeSessionId
                    ? 'bg-primary/10 text-foreground'
                    : 'hover:bg-muted/50 text-muted-foreground'
                }`}
                onClick={() => setActiveSession(session.id)}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">
                    {session.title || t('home.newChat')}
                  </p>
                  <p className="text-[10px] text-muted-foreground/50">
                    {formatTime(session.updatedAt)}
                  </p>
                </div>
                <button
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-destructive/10 hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteSession(session.id);
                  }}
                  title={t('home.deleteChat')}
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
