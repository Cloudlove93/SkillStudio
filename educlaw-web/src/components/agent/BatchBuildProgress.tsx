import { useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBatchBuildStore } from '../../stores/batch-build';
import { useChatStore } from '../../stores/chat';
import { useUIStore } from '../../stores/ui';
import { useLibraryStore } from '../../stores/library';
import { useT } from '../../i18n';
import { LogItem, ProfilePreviewCard, SkillPreviewCard } from './build-components';

export default function BatchBuildProgress() {
  const t = useT();
  const selectedFileId = useBatchBuildStore((s) => s.selectedFileId);
  const items = useBatchBuildStore((s) => s.items);
  const createProject = useBatchBuildStore((s) => s.createProject);
  const openTab = useChatStore((s) => s.openTab);
  const setMainView = useUIStore((s) => s.setMainView);
  const setDeepStudyTab = useUIStore((s) => s.setDeepStudyTab);
  const setPendingSkillDirName = useUIStore((s) => s.setPendingSkillDirName);
  const logEndRef = useRef<HTMLDivElement>(null);

  const item = selectedFileId ? items.get(selectedFileId) : undefined;

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [item?.logs, item?.streamingText, item?.profilePreview, item?.skillPreview]);

  if (!item) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        {t('build.batchSelectFile')}
      </div>
    );
  }

  const {
    logs,
    profilePreview,
    skillPreview,
    isWaitingLLM,
    isStreaming,
    streamingText,
    status,
    resultAgent,
    resultSkill,
    projectCreated,
  } = item;
  const hasContent = logs.length > 0 || isStreaming || isWaitingLLM || profilePreview !== null || skillPreview !== null;

  if (!hasContent) {
    return (
      <div className="flex items-center justify-center h-full">
        {status === 'pending' ? (
          <span className="text-sm text-muted-foreground">{t('build.batchPending')}</span>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            <span>{t('build.batchBuilding')}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3 max-h-[360px] overflow-y-auto">
        {logs.map((log, i) => (
          <LogItem key={i} entry={log} t={t} />
        ))}
        {profilePreview && <ProfilePreviewCard preview={profilePreview} t={t} />}
        {skillPreview && <SkillPreviewCard preview={skillPreview} />}
        {isWaitingLLM && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            <span>{t('build.waitingLLM')}</span>
          </div>
        )}
        {isStreaming && streamingText && (
          <div className="rounded-lg border border-border bg-background p-4">
            <div className="flex items-center gap-2 mb-2">
              <Loader2 className="size-3.5 animate-spin text-blue-500" />
              <span className="text-xs font-medium text-muted-foreground">
                {profilePreview ? t('build.selectingSkills') : t('build.generatingProfile')}
              </span>
            </div>
            <pre className="text-sm text-foreground/80 whitespace-pre-wrap break-words font-mono leading-relaxed max-h-48 overflow-y-auto">
              {streamingText}
              <span className="inline-block w-1.5 h-4 bg-blue-500 animate-pulse align-text-bottom ml-0.5" />
            </pre>
          </div>
        )}
        {status === 'building' && !isStreaming && !isWaitingLLM && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            <span>{t('build.processing')}</span>
          </div>
        )}
        <div ref={logEndRef} />
      </div>

      {status === 'done' && resultAgent && (
        <div className="flex items-center justify-end gap-2">
          {!projectCreated ? (
            <Button size="sm" onClick={() => createProject(selectedFileId!)}>
              {t('build.batchCreateProject')}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                openTab(resultAgent.id, resultAgent.name);
                setMainView(null);
              }}
            >
              {t('build.openAgent')}
            </Button>
          )}
        </div>
      )}

      {status === 'done' && resultSkill && (
        <div className="flex items-center justify-end gap-2">
          <Button
            size="sm"
            onClick={() => {
              useLibraryStore.getState().fetchSkills(true);
              setPendingSkillDirName(resultSkill.dirName);
              setMainView('deep-study');
              setDeepStudyTab('skills');
            }}
          >
            {t('build.openSkill')}
          </Button>
        </div>
      )}
    </div>
  );
}

