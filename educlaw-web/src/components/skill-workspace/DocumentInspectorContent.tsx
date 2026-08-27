import { CheckCircle2, Clock3, FileText, Loader2, X, XCircle } from 'lucide-react';
import {
  summarizeDocumentBatch,
  type DocumentBatchRun,
  type DocumentSource,
} from './document-skill-creation-state';

type Props = {
  documents: DocumentSource[];
  runs: DocumentBatchRun[];
  busy: boolean;
  notice: string | null;
  onRemoveDocument: (index: number) => void;
};

function runLabel(run: DocumentBatchRun | undefined) {
  if (!run) return '准备生成 1 个 Skill';
  if (run.status === 'waiting') return '等待生成';
  if (run.status === 'running') return '正在生成';
  if (run.status === 'done') return run.packageName ? `已生成：${run.packageName}` : '生成完成';
  return run.error || '生成失败';
}

function RunStatusIcon({ run }: { run: DocumentBatchRun | undefined }) {
  if (!run || run.status === 'waiting') return <Clock3 size={16} aria-hidden="true" />;
  if (run.status === 'running') return <Loader2 size={16} className="spin" aria-hidden="true" />;
  if (run.status === 'done') return <CheckCircle2 size={16} className="is-success" aria-hidden="true" />;
  return <XCircle size={16} className="is-error" aria-hidden="true" />;
}

export function DocumentInspectorContent(props: Props) {
  const summary = summarizeDocumentBatch(props.runs);

  return (
    <div className="skill-inspector-document">
      <section className="skill-inspector-summary-strip" aria-label="文档生成摘要">
        <div><span>文档</span><strong>{props.documents.length}</strong></div>
        <div><span>成功</span><strong>{summary.successCount}</strong></div>
        <div><span>失败</span><strong>{summary.failureCount}</strong></div>
      </section>
      {props.notice && <p className="skill-inspector-notice" role="status">{props.notice}</p>}
      {props.documents.length === 0 ? (
        <div className="skill-context-placeholder">
          <FileText size={22} aria-hidden="true" />
          <p>添加文档后，这里会显示每份文档的生成状态。</p>
        </div>
      ) : (
        <div className="skill-inspector-item-list">
          {props.documents.map((document, index) => {
            const run = props.runs[index];
            return (
              <article key={`${document.name}-${index}`} className={run?.status === 'error' ? 'is-error' : ''}>
                <RunStatusIcon run={run} />
                <div>
                  <strong>{document.name}</strong>
                  <span>{runLabel(run)}</span>
                  {run?.status === 'error' && <small>可移除这份文档后重新生成，其余结果不受影响。</small>}
                </div>
                {!props.busy && !run && (
                  <button type="button" onClick={() => props.onRemoveDocument(index)} aria-label={`移除 ${document.name}`}>
                    <X size={14} />
                  </button>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

