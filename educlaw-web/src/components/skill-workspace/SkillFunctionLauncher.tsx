import { useEffect, useRef, useState } from 'react';
import {
  FlaskConical,
  GitBranch,
  LayoutGrid,
  Pin,
  PinOff,
  Play,
  Scale,
  WandSparkles,
} from 'lucide-react';
import type { SkillWorkspaceView } from './skill-workspace-state';

const PINNED_KEY = 'eduskill:skill-launcher-pinned:v1';

export type SkillNavigationView = Extract<
  SkillWorkspaceView,
  'run' | 'test' | 'arena' | 'optimize' | 'versions'
>;

export type SkillNavigation = {
  activeView: SkillWorkspaceView;
  onNavigate: (view: SkillNavigationView) => void;
};

const launcherItems = [
  { view: 'run', label: '使用', description: '运行当前版本', icon: Play },
  { view: 'test', label: '测试', description: '验证真实任务效果', icon: FlaskConical },
  { view: 'arena', label: 'Arena', description: '对比两个版本', icon: Scale },
  { view: 'optimize', label: '优化', description: '通过对话改进', icon: WandSparkles },
  { view: 'versions', label: '版本', description: '管理历史版本', icon: GitBranch },
] as const;

function readPinnedPreference() {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(PINNED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function SkillFunctionLauncher({
  navigation,
}: {
  navigation: SkillNavigation;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(readPinnedPreference);
  const [open, setOpen] = useState(readPinnedPreference);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!pinned && !rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !open) return;
      if (pinned) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, pinned]);

  const togglePinned = () => {
    const next = !pinned;
    setPinned(next);
    setOpen(next);
    try {
      localStorage.setItem(PINNED_KEY, String(next));
    } catch {
      // Pinning remains available for the current session when storage is blocked.
    }
  };

  return (
    <div ref={rootRef} className="skill-function-launcher-root">
      <button
        className={`skill-icon-button ${open ? 'is-active' : ''}`}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label="功能切换"
        aria-expanded={open}
        title="使用、测试、Arena、优化与版本"
      >
        <LayoutGrid size={17} aria-hidden="true" />
      </button>
      {open ? (
        <nav className="skill-function-launcher" aria-label="Skill 功能切换">
          <header>
            <div>
              <span>Skill 工作方式</span>
              <strong>功能切换</strong>
            </div>
            <button
              type="button"
              onClick={togglePinned}
              aria-label={pinned ? '取消置顶功能栏' : '置顶功能栏'}
              title={pinned ? '取消置顶' : '置顶'}
            >
              {pinned ? (
                <PinOff size={15} aria-hidden="true" />
              ) : (
                <Pin size={15} aria-hidden="true" />
              )}
            </button>
          </header>
          <div>
            {launcherItems.map(({ view, label, description, icon: Icon }) => {
              const active = navigation.activeView === view;
              return (
                <button
                  key={view}
                  type="button"
                  className={active ? 'is-current' : undefined}
                  aria-label={`切换到 ${label}`}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => {
                    navigation.onNavigate(view);
                    if (!pinned) setOpen(false);
                  }}
                >
                  <span aria-hidden="true"><Icon size={15} /></span>
                  <span>
                    <strong>{label}</strong>
                    <small>{description}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </nav>
      ) : null}
    </div>
  );
}
