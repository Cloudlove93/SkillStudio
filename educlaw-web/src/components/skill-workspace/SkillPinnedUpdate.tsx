import { useEffect, useRef } from 'react';
import { Sparkles, X } from 'lucide-react';
import type { SkillPinnedUpdate as SkillPinnedUpdateValue } from './skill-workspace-state';
import { getSkillNotificationDuration } from './skill-transient-notification';

type Props = {
  update: SkillPinnedUpdateValue | null;
  onAction?: (update: SkillPinnedUpdateValue) => void;
  onDismiss: () => void;
};

export function SkillPinnedUpdate({ update, onAction, onDismiss }: Props) {
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const remainingRef = useRef(0);
  const dismissRef = useRef(onDismiss);

  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!update) return;
    remainingRef.current = getSkillNotificationDuration(update);
    startedAtRef.current = Date.now();
    timerRef.current = window.setTimeout(
      () => dismissRef.current(),
      remainingRef.current,
    );
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [update]);

  if (!update) return null;

  const pauseDismiss = () => {
    if (timerRef.current === null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
    remainingRef.current = Math.max(
      0,
      remainingRef.current - (Date.now() - startedAtRef.current),
    );
  };

  const resumeDismiss = () => {
    if (timerRef.current !== null || remainingRef.current <= 0) return;
    startedAtRef.current = Date.now();
    timerRef.current = window.setTimeout(
      () => dismissRef.current(),
      remainingRef.current,
    );
  };

  const runAction = () => {
    onAction?.(update);
    onDismiss();
  };

  return (
    <div
      className="skill-transient-notification"
      role="status"
      aria-live="polite"
      onMouseEnter={pauseDismiss}
      onMouseLeave={resumeDismiss}
      onFocus={pauseDismiss}
      onBlur={resumeDismiss}
    >
      <span className="skill-transient-notification-icon"><Sparkles size={14} /></span>
      <div className="skill-transient-notification-copy">
        <strong>{update.title}</strong>
        <span>{update.message}</span>
      </div>
      {update.actionLabel && (
        <button onClick={runAction}>{update.actionLabel}</button>
      )}
      <button className="skill-transient-notification-dismiss" onClick={onDismiss} aria-label="关闭提示">
        <X size={14} />
      </button>
    </div>
  );
}
