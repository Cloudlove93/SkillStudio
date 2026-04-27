import { Home, Sparkles, BookOpen, Wrench, PanelsLeftRight } from 'lucide-react';
import { useUIStore, type DeepStudyTab } from '../../stores/ui';
import { useT, type MessageKey } from '../../i18n';
import ProfileGallery from '../agent/ProfileGallery';
import BuildAgentPanel from '../agent/BuildAgentPanel';
import SkillLibraryPanel from '../skill/SkillLibraryPanel';
import ToolLibraryPanel from '../tool/ToolLibraryPanel';
import OptimizePanel from './OptimizePanel';
import LiteArenaPanel from '../lite/LiteArenaPanel';

const HIDDEN_TABS = new Set<DeepStudyTab>(['gallery', 'build', 'skills', 'tools', 'optimize']);

const tabs: { key: DeepStudyTab; icon: typeof Home; labelKey: MessageKey; color: string; tone: string }[] = [
  { key: 'gallery', icon: Home, labelKey: 'sidebar.agentRepo', color: 'text-indigo-500 border-indigo-500', tone: 'from-indigo-500/18 to-cyan-500/10 text-indigo-600 dark:text-indigo-300' },
  { key: 'build', icon: Sparkles, labelKey: 'sidebar.buildAgent', color: 'text-amber-500 border-amber-500', tone: 'from-amber-500/20 to-orange-500/10 text-amber-600 dark:text-amber-300' },
  { key: 'skills', icon: BookOpen, labelKey: 'sidebar.skillRepo', color: 'text-emerald-500 border-emerald-500', tone: 'from-emerald-500/18 to-teal-500/10 text-emerald-600 dark:text-emerald-300' },
  { key: 'tools', icon: Wrench, labelKey: 'sidebar.toolRepo', color: 'text-sky-500 border-sky-500', tone: 'from-sky-500/18 to-cyan-500/10 text-sky-600 dark:text-sky-300' },
  { key: 'arena', icon: PanelsLeftRight, labelKey: 'sidebar.arena', color: 'text-cyan-500 border-cyan-500', tone: 'from-cyan-500/18 to-blue-500/10 text-cyan-600 dark:text-cyan-300' },
  { key: 'optimize', icon: Sparkles, labelKey: 'sidebar.optimize', color: 'text-rose-500 border-rose-500', tone: 'from-rose-500/18 to-fuchsia-500/10 text-rose-600 dark:text-rose-300' },
].filter((t) => !HIDDEN_TABS.has(t.key));

export default function DeepStudyPanel() {
  const t = useT();
  const activeTab = useUIStore((s) => s.deepStudyTab);
  const setTab = useUIStore((s) => s.setDeepStudyTab);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="px-5 pb-5 pt-5 sm:px-6">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
          {tabs.map(({ key, icon: Icon, labelKey, color, tone }) => {
            const active = activeTab === key;
            const [textColor, borderColor] = color.split(' ');
            return (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex items-center gap-3 rounded-[22px] border px-4 py-3 text-left transition-all duration-200 ${
                  active
                    ? `${textColor} ${borderColor} bg-background shadow-sm`
                    : 'border-border/70 bg-card/80 text-muted-foreground hover:-translate-y-0.5 hover:border-primary/20 hover:bg-background hover:text-foreground'
                }`}
              >
                <div className={`flex size-10 items-center justify-center rounded-2xl bg-gradient-to-br ${tone}`}>
                  <Icon className="size-5" />
                </div>
                <div className="min-w-0 flex-1 truncate text-sm font-semibold">{t(labelKey)}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div className={`min-h-0 flex-1 overflow-auto ${activeTab === 'arena' ? '' : 'px-5 pb-5 sm:px-6'}`}>
        <div className={`min-h-full overflow-hidden ${activeTab === 'arena' ? 'h-full' : 'rounded-[30px] border border-border/70 bg-background/95 shadow-[var(--shadow-md)]'}`}>
          {activeTab === 'gallery' && <ProfileGallery />}
          {activeTab === 'build' && <BuildAgentPanel />}
          {activeTab === 'skills' && <SkillLibraryPanel />}
          {activeTab === 'tools' && <ToolLibraryPanel />}
          {activeTab === 'arena' && <LiteArenaPanel />}
          {activeTab === 'optimize' && <OptimizePanel />}
        </div>
      </div>
    </div>
  );
}
