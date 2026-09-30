export type DocumentSource = {
  name: string;
  content: string;
};

export type DocumentBatchRun = {
  id: string;
  name: string;
  status: 'waiting' | 'running' | 'done' | 'error';
  packageId?: string;
  packageName?: string;
  error?: string;
};

export function createDocumentBatchPlan(
  documents: DocumentSource[],
  now = Date.now(),
): DocumentBatchRun[] {
  return documents.map((document, index) => ({
    id: `${now}-${index}-${document.name}`,
    name: document.name,
    status: 'waiting',
  }));
}

export function summarizeDocumentBatch(runs: DocumentBatchRun[]) {
  return runs.reduce(
    (summary, run) => {
      if (run.status === 'done') summary.successCount += 1;
      if (run.status === 'error') summary.failureCount += 1;
      return summary;
    },
    { successCount: 0, failureCount: 0 },
  );
}
