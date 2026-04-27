import { Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { useBatchBuildStore, type FileBuildStatus } from '../../stores/batch-build';
import { useChatStore } from '../../stores/chat';
import { useUIStore } from '../../stores/ui';
import { useT } from '../../i18n';
import { formatFileSize } from './build-components';

function StatusIcon({ status }: { status: FileBuildStatus }) {
  switch (status) {
    case 'pending':
      return <Clock className="size-3.5 text-muted-foreground" />;
    case 'building':
      return <Loader2 className="size-3.5 animate-spin text-blue-500" />;
    case 'done':
      return <CheckCircle2 className="size-3.5 text-green-500" />;
    case 'error':
      return <XCircle className="size-3.5 text-destructive" />;
  }
}

export default function BatchFileSidebar() {
  const t = useT();
  const items = useBatchBuildStore((s) => s.items);
  const selectedFileId = useBatchBuildStore((s) => s.selectedFileId);
  const selectFile = useBatchBuildStore((s) => s.selectFile);
  const createProject = useBatchBuildStore((s) => s.createProject);
  const openTab = useChatStore((s) => s.openTab);
  const setMainView = useUIStore((s) => s.setMainView);

  const fileList = Array.from(items.values());

  return (
    <div className="rounded-lg border border-border bg-muted/20 overflow-hidden">
      <div className="px-3 py-2 border-b border-border">
        <span className="text-xs font-medium text-muted-foreground">
          {t('build.fileSelected')} ({fileList.length})
        </span>
      </div>
      <div className="max-h-[360px] overflow-y-auto">
        {fileList.map((item) => (
          <button
            key={item.fileId}
            onClick={() => selectFile(item.fileId)}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors border-b border-border/50 last:border-b-0 ${
              selectedFileId === item.fileId
                ? 'bg-accent/50'
                : 'hover:bg-muted/40'
            }`}
          >
            <StatusIcon status={item.status} />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate">{item.fileName}</div>
              <div className="text-[10px] text-muted-foreground">
                {formatFileSize(item.fileSize)}
                {item.resultAgent && (
                  <span className="ml-1.5 text-green-600 dark:text-green-400">
                    → {item.resultAgent.name}
                  </span>
                )}
              </div>
            </div>
            {item.status === 'done' && item.resultAgent && !item.projectCreated && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  createProject(item.fileId);
                }}
                className="text-[10px] text-blue-500 hover:text-blue-600 shrink-0"
              >
                {t('build.batchCreateProject')}
              </button>
            )}
            {item.status === 'done' && item.resultAgent && item.projectCreated && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  openTab(item.resultAgent!.id, item.resultAgent!.name);
                  setMainView(null);
                }}
                className="text-[10px] text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300 shrink-0"
              >
                {t('build.openAgent')}
              </button>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
