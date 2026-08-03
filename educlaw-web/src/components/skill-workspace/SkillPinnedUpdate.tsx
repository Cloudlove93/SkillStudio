import { Sparkles, X } from 'lucide-react';
import type { SkillPinnedUpdate as SkillPinnedUpdateValue } from './skill-workspace-state';

type Props = {
  update: SkillPinnedUpdateValue | null;
  onAction?: (update: SkillPinnedUpdateValue) => void;
  onDismiss: () => void;
};

export function SkillPinnedUpdate({ update, onAction, onDismiss }: Props) {
  if (!update) return null;

  return (
    <div className="skill-pinned-update" role="status">
      <span className="skill-pinned-update-icon"><Sparkles size={14} /></span>
      <div className="skill-pinned-update-copy">
        <strong>{update.title}</strong>
        <span>{update.message}</span>
      </div>
      {update.actionLabel && (
        <button onClick={() => onAction?.(update)}>{update.actionLabel}</button>
      )}
      <button className="skill-pinned-dismiss" onClick={onDismiss} aria-label="关闭置顶摘要">
        <X size={14} />
      </button>
    </div>
  );
}
