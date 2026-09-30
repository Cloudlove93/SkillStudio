import { useRef, useState } from 'react';
import { FileUp, Loader2, Sparkles } from 'lucide-react';
import { liteApi } from '../../api/lite-api';
import {
  createDocumentBatchPlan,
  type DocumentBatchRun,
  type DocumentSource,
} from './document-skill-creation-state';
import { DocumentInspectorContent } from './DocumentInspectorContent';
import { InspectorPortal } from './InspectorPortal';
import { useWorkspaceInspector } from './WorkspaceInspectorProvider';

type Props = {
  token: string;
  onGenerated: () => Promise<void> | void;
};

const DOCUMENT_ACCEPT =
  '.txt,.md,.docx,.csv,.json,.yaml,.yml,.js,.ts,.py,.html,.css';
const DOCX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const BATCH_CONCURRENCY = 2;

export function DocumentSkillCreationPanel({ token, onGenerated }: Props) {
  const { openInspector } = useWorkspaceInspector();
  const inputRef = useRef<HTMLInputElement>(null);
  const [documents, setDocuments] = useState<DocumentSource[]>([]);
  const documentsRef = useRef<DocumentSource[]>([]);
  const [instruction, setInstruction] = useState('');
  const [runs, setRuns] = useState<DocumentBatchRun[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const updateRun = (id: string, patch: Partial<DocumentBatchRun>) => {
    setRuns((current) =>
      current.map((run) => (run.id === id ? { ...run, ...patch } : run)),
    );
  };

  const addFiles = async (files: FileList | File[]) => {
    const selected = Array.from(files).slice(0, 20);
    const next: DocumentSource[] = [];
    const failures: string[] = [];
    for (const file of selected) {
      try {
        next.push(await readDocument(file));
      } catch (error) {
        failures.push(
          `${file.name}：${error instanceof Error ? error.message : '读取失败'}`,
        );
      }
    }
    if (next.length > 0) {
      const merged = [...documentsRef.current, ...next].slice(0, 20);
      documentsRef.current = merged;
      setDocuments(merged);
      setRuns([]);
      openInspector({
        owner: 'document',
        view: 'document-materials',
        title: '文档与生成状态',
        description: `${merged.length} 份文档`,
        preferredWidth: 400,
      });
    }
    setNotice(
      failures.length > 0
        ? failures.join('；')
        : next.length > 0
          ? `已添加 ${next.length} 份文档`
          : null,
    );
  };

  const generate = async () => {
    if (busy || documents.length === 0) return;
    const plan = createDocumentBatchPlan(documents);
    let nextIndex = 0;
    let successCount = 0;
    let failureCount = 0;
    setRuns(plan);
    setBusy(true);
    openInspector({
      owner: 'document',
      view: 'document-materials',
      title: '文档与生成状态',
      description: `${documents.length} 份文档正在分别生成`,
      preferredWidth: 400,
    });
    setNotice(
      documents.length > 1
        ? `正在分别生成 ${documents.length} 个 Skill`
        : `正在根据 ${documents[0]?.name || '文档'} 生成 Skill`,
    );

    const runWorker = async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= plan.length) return;
        const run = plan[index];
        const document = documents[index];
        if (!run || !document) return;
        updateRun(run.id, { status: 'running' });
        try {
          const result = await generateDocumentSkill(
            token,
            instruction.trim(),
            document,
          );
          successCount += 1;
          updateRun(run.id, {
            status: 'done',
            packageId: result.packageId,
            packageName: result.packageName,
          });
        } catch (error) {
          failureCount += 1;
          updateRun(run.id, {
            status: 'error',
            error: error instanceof Error ? error.message : '生成失败',
          });
        }
      }
    };

    try {
      await Promise.all(
        Array.from({ length: Math.min(BATCH_CONCURRENCY, plan.length) }, () =>
          runWorker(),
        ),
      );
      setNotice(`生成完成：成功 ${successCount} 个，失败 ${failureCount} 个`);
      if (successCount > 0) await onGenerated();
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="skill-center">
      <div
        className="skill-document-create-page skill-view-enter"
        onDragOver={(event) => {
          if (!busy) event.preventDefault();
        }}
        onDrop={(event) => {
          if (busy) return;
          event.preventDefault();
          if (event.dataTransfer.files.length) {
            void addFiles(event.dataTransfer.files);
          }
        }}
      >
        <header className="skill-document-create-header">
          <span className="skill-eyebrow">从描述文档生成</span>
          <h1>上传文档，生成教育 Skill</h1>
          <p>
            上传需求说明、教学设计或其他描述文档。每份文档会分别生成一个
            Skill，也可以补充统一要求。
          </p>
        </header>

        <input
          ref={inputRef}
          name="skill-source-documents"
          hidden
          type="file"
          multiple
          accept={DOCUMENT_ACCEPT}
          onChange={(event) => {
            if (event.target.files?.length) void addFiles(event.target.files);
            event.target.value = '';
          }}
        />
        <button
          type="button"
          className="skill-document-create-dropzone"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          <span>
            <FileUp size={20} aria-hidden="true" />
          </span>
          <span>
            <strong>拖入文档，或点击选择</strong>
            <small>支持 DOCX、Markdown、TXT 及原有文本与代码格式</small>
          </span>
          <b>选择文档</b>
        </button>

        <label className="skill-document-create-instruction">
          <span>补充要求（可选）</span>
          <textarea
            name="document-generation-instruction"
            autoComplete="off"
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder="例如：统一面向初中教师，输出需包含可执行步骤……"
            disabled={busy}
          />
        </label>

        <footer className="skill-document-create-footer">
          <span>{notice || '每份文档都会单独生成一个 Skill。'}</span>
          <button
            type="button"
            className="skill-primary-button"
            onClick={() => void generate()}
            disabled={documents.length === 0 || busy}
          >
            {busy ? (
              <Loader2 size={15} className="spin" aria-hidden="true" />
            ) : (
              <Sparkles size={15} aria-hidden="true" />
            )}
            {documents.length > 1
              ? `批量生成 ${documents.length} 个 Skill`
              : '生成 Skill'}
          </button>
        </footer>
      </div>
      <InspectorPortal owner="document">
        <DocumentInspectorContent
          documents={documents}
          runs={runs}
          busy={busy}
          notice={notice}
          onRemoveDocument={(index) => {
            setDocuments((current) => {
              const next = current.filter(
                (_, itemIndex) => itemIndex !== index,
              );
              documentsRef.current = next;
              return next;
            });
            setRuns([]);
          }}
        />
      </InspectorPortal>
    </main>
  );
}

async function readDocument(file: File): Promise<DocumentSource> {
  const isDocx =
    file.name.toLowerCase().endsWith('.docx') || file.type === DOCX_MIME_TYPE;
  let content: string;
  if (isDocx) {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({
      arrayBuffer: await file.arrayBuffer(),
    });
    content = result.value.trim();
  } else {
    content = (await file.text()).trim();
  }
  if (!content) throw new Error('没有读取到可用文本');
  return { name: file.name, content };
}

async function generateDocumentSkill(
  token: string,
  instruction: string,
  document: DocumentSource,
) {
  let packageId = '';
  let packageName = '';
  await liteApi.generatePackageStream(
    token,
    instruction,
    undefined,
    [document],
    (event) => {
      if (event.event === 'done') {
        packageId = String(event.data.id || '');
        packageName = String(event.data.name || '');
      }
      if (event.event === 'error') {
        throw new Error(event.data.error || '生成失败');
      }
    },
  );
  if (!packageId) throw new Error('服务未返回生成结果');
  return { packageId, packageName };
}
