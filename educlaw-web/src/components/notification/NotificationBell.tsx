import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Bell, Trash2, AlertTriangle, CheckCircle, Info, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNotificationStore } from '../../stores/notification';
import { useT } from '../../i18n';

const typeIcons = {
  info: Info,
  success: CheckCircle,
  warning: AlertTriangle,
  error: XCircle,
};

const typeColors = {
  info: 'text-blue-500',
  success: 'text-emerald-500',
  warning: 'text-amber-500',
  error: 'text-red-500',
};

const PANEL_WIDTH = 320;
const VIEWPORT_GAP = 16;

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

export default function NotificationBell() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [panelPosition, setPanelPosition] = useState({ top: 0, left: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const notifications = useNotificationStore((s) => s.notifications);
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const dismiss = useNotificationStore((s) => s.dismiss);
  const clear = useNotificationStore((s) => s.clear);

  useEffect(() => {
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;

    function updatePosition() {
      const button = buttonRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      const left = Math.min(
        Math.max(VIEWPORT_GAP, rect.right - PANEL_WIDTH),
        window.innerWidth - PANEL_WIDTH - VIEWPORT_GAP,
      );
      const top = Math.max(VIEWPORT_GAP, rect.bottom + 8);
      setPanelPosition({ top, left });
    }

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  function handleToggle() {
    setOpen((v) => !v);
    if (!open && unreadCount > 0) {
      markAllRead();
    }
  }

  const panel = open && mounted
    ? createPortal(
        <div
          ref={panelRef}
          className="fixed z-[2147483647] w-80 overflow-hidden rounded-2xl border border-border/70 bg-background/98 shadow-[var(--shadow-lg)]"
          style={{ top: panelPosition.top, left: panelPosition.left }}
        >
          <div className="flex items-center justify-between border-b border-border/30 px-4 py-3">
            <span className="text-sm font-semibold text-foreground">{t('notification.title')}</span>
            {notifications.length > 0 && (
              <button onClick={clear} className="text-[11px] text-muted-foreground transition-colors hover:text-foreground">
                {t('notification.clearAll')}
              </button>
            )}
          </div>

          <div className="max-h-72 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground/50">
                {t('notification.empty')}
              </div>
            ) : (
              notifications.map((n) => {
                const Icon = typeIcons[n.type];
                return (
                  <div
                    key={n.id}
                    className={`group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/30 ${
                      !n.read ? 'bg-primary/3' : ''
                    }`}
                  >
                    <Icon className={`mt-0.5 size-4 shrink-0 ${typeColors[n.type]}`} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-foreground">{n.title}</div>
                      {n.description && (
                        <div className="truncate text-xs text-muted-foreground/60">{n.description}</div>
                      )}
                      <div className="mt-0.5 text-[10px] text-muted-foreground/40">{timeAgo(n.timestamp)}</div>
                    </div>
                    <button
                      onClick={() => dismiss(n.id)}
                      className="shrink-0 text-muted-foreground/30 opacity-0 transition-opacity group-hover:opacity-100 hover:text-muted-foreground"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <div className="relative" ref={rootRef}>
        <Button
          ref={buttonRef}
          variant="outline"
          size="icon-sm"
          onClick={handleToggle}
          className="relative rounded-2xl bg-background/95"
        >
          <Bell className="size-4" />
          {unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </div>
      {panel}
    </>
  );
}
