import { useUIStore } from '../../stores/ui';
import ProfileGallery from '../agent/ProfileGallery';
import BuildAgentPanel from '../agent/BuildAgentPanel';
import SkillLibraryPanel from '../skill/SkillLibraryPanel';
import ToolLibraryPanel from '../tool/ToolLibraryPanel';
import OptimizePanel from './OptimizePanel';
import LiteArenaPanel from '../lite/LiteArenaPanel';

export default function DeepStudyPanel() {
  const activeTab = useUIStore((s) => s.deepStudyTab);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
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
