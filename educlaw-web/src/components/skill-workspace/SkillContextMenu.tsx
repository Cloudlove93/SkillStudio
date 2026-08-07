import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';

export type SkillContextMenuItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  destructive?: boolean;
  separatorBefore?: boolean;
};

type Props = {
  x: number;
  y: number;
  items: SkillContextMenuItem[];
  onSelect: (id: string) => void;
  onClose: () => void;
};

export function SkillContextMenu({ x, y, items, onSelect, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const margin = 8;
    setPosition({
      left: Math.max(margin, Math.min(x, window.innerWidth - menu.offsetWidth - margin)),
      top: Math.max(margin, Math.min(y, window.innerHeight - menu.offsetHeight - margin)),
    });
  }, [x, y]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="skill-context-menu"
      role="menu"
      style={{ left: position.left, top: position.top }}
    >
      {items.map(({ id, label, icon: Icon, destructive, separatorBefore }) => (
        <div key={id} className={separatorBefore ? 'skill-context-menu-separator' : undefined}>
          <button
            type="button"
            role="menuitem"
            className={destructive ? 'is-destructive' : undefined}
            onClick={() => onSelect(id)}
          >
            <Icon size={14} aria-hidden="true" />
            <span>{label}</span>
          </button>
        </div>
      ))}
    </div>
  );
}
