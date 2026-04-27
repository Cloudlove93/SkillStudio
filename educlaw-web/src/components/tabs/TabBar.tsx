import { useChatStore } from '../../stores/chat';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function TabBar() {
  const tabs = useChatStore((s) => s.tabs);
  const activeTabId = useChatStore((s) => s.activeTabId);
  const setActiveTab = useChatStore((s) => s.setActiveTab);
  const closeTab = useChatStore((s) => s.closeTab);

  const tabEntries = Array.from(tabs.entries());

  if (tabEntries.length === 0) return null;

  return (
    <div className="flex items-center border-b border-border bg-card/80 overflow-x-auto">
      {tabEntries.map(([id, tab]) => (
        <div
          key={id}
          onClick={() => setActiveTab(id)}
          className={`group relative flex cursor-pointer items-center gap-1 px-4 py-2 text-xs transition-colors duration-200 ${
            id === activeTabId
              ? 'text-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
          }`}
        >
          <span className="max-w-[120px] truncate">{tab.agentName}</span>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={(e) => {
              e.stopPropagation();
              closeTab(id);
            }}
            className="ml-1 size-5 opacity-0 group-hover:opacity-100"
          >
            <X className="size-3" />
          </Button>
          {id === activeTabId && (
            <span className="absolute bottom-0 left-1 right-1 h-0.5 rounded-full bg-gradient-to-r from-indigo-600 to-blue-600 dark:from-indigo-500 dark:to-blue-500" />
          )}
        </div>
      ))}
    </div>
  );
}
