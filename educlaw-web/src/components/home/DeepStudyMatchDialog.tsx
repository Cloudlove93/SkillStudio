import { useState } from 'react';
import { Loader2, GraduationCap, Play, Eye, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useT } from '../../i18n';
import { useUIStore } from '../../stores/ui';
import { useAgentStore } from '../../stores/agent';
import { useChatStore } from '../../stores/chat';

interface MatchedProfile {
  fileName: string;
  name: string;
  description: string;
  score: number;
}

interface DeepStudyMatchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profiles: MatchedProfile[];
  loading: boolean;
  chatText: string;
}

export default function DeepStudyMatchDialog({
  open,
  onOpenChange,
  profiles,
  loading,
  chatText,
}: DeepStudyMatchDialogProps) {
  const t = useT();
  const setMainView = useUIStore((s) => s.setMainView);
  const setDeepStudyTab = useUIStore((s) => s.setDeepStudyTab);
  const setPendingProfileFileName = useUIStore((s) => s.setPendingProfileFileName);
  const setPendingBuildScenario = useUIStore((s) => s.setPendingBuildScenario);
  const createAgent = useAgentStore((s) => s.createAgent);
  const startAgent = useAgentStore((s) => s.startAgent);
  const openTab = useChatStore((s) => s.openTab);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);

  async function handleQuickLaunch() {
    if (!selectedFileName) return;
    setLaunching(true);
    try {
      const agent = await createAgent(selectedFileName);
      await startAgent(agent.id);
      openTab(agent.id, agent.name);
      setMainView(null);
      onOpenChange(false);
    } catch (err) {
      toast.error('Failed to launch agent', { description: err instanceof Error ? err.message : undefined });
    } finally {
      setLaunching(false);
    }
  }

  function handleViewDetails() {
    if (!selectedFileName) return;
    setPendingProfileFileName(selectedFileName);
    setDeepStudyTab('gallery');
    setMainView('deep-study');
    onOpenChange(false);
  }

  function handleGenerateFromChat() {
    setPendingBuildScenario(chatText);
    setDeepStudyTab('build');
    setMainView('deep-study');
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GraduationCap className="size-5 text-primary" />
            {t('home.deepStudyTitle')}
          </DialogTitle>
          <DialogDescription>{t('home.deepStudyDesc')}</DialogDescription>
        </DialogHeader>

        <div className="py-2">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              <span className="text-sm">{t('home.deepStudyLoading')}</span>
            </div>
          ) : profiles.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t('home.deepStudyNoMatch')}
            </p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {profiles.map((p) => {
                const selected = selectedFileName === p.fileName;
                return (
                  <button
                    key={p.fileName}
                    onClick={() => setSelectedFileName(selected ? null : p.fileName)}
                    className={`w-full text-left rounded-xl border p-3 transition-all duration-150 ${
                      selected
                        ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                        : 'border-border/40 hover:border-primary/30 hover:bg-muted/30'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{p.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {t('home.deepStudyScore')}: {p.score}
                      </span>
                    </div>
                    {p.description && (
                      <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                        {p.description}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!selectedFileName || loading || launching}
            onClick={handleQuickLaunch}
            className="gap-1.5"
          >
            {launching ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
            {t('home.deepStudyLaunch')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!selectedFileName || loading || launching}
            onClick={handleViewDetails}
            className="gap-1.5"
          >
            <Eye className="size-3.5" />
            {t('home.deepStudyDetails')}
          </Button>
          <Button
            size="sm"
            disabled={loading || launching}
            onClick={handleGenerateFromChat}
            className="gap-1.5"
          >
            <Sparkles className="size-3.5" />
            {t('home.deepStudyGenerate')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
