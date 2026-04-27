import { useT } from '../../i18n';
import { useBatchBuildStore } from '../../stores/batch-build';
import BatchFileSidebar from './BatchFileSidebar';
import BatchBuildProgress from './BatchBuildProgress';

export default function BatchBuildView() {
  const t = useT();
  const items = useBatchBuildStore((s) => s.items);
  const allDone = useBatchBuildStore((s) => s.allDone);
  const total = items.size;
  const doneCount = Array.from(items.values()).filter((i) => i.status === 'done' || i.status === 'error').length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">
          {allDone
            ? t('build.batchAllDone')
            : t('build.batchProgress').replace('{done}', String(doneCount)).replace('{total}', String(total))}
        </h3>
      </div>
      <div className="flex gap-4 min-h-[400px]">
        <div className="w-56 shrink-0">
          <BatchFileSidebar />
        </div>
        <div className="flex-1 min-w-0">
          <BatchBuildProgress />
        </div>
      </div>
    </div>
  );
}
