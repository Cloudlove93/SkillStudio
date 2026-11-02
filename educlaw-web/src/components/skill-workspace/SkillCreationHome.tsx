import { useRef, useState, type DragEvent } from 'react';
import type { GuidedCreationDocument } from '@educlaw/shared';
import {
  ArrowUp,
  FileText,
  MessageCircle,
  PencilLine,
  Plus,
  Video,
  X,
} from 'lucide-react';

type SkillCreationHomeProps = {
  documents: GuidedCreationDocument[];
  busy: boolean;
  onSend: (content: string) => void;
  onFiles: (files: FileList) => void;
  onRemoveDocument: (index: number) => void;
  onOpenMultimodal: () => void;
  onOpenManual: () => void;
};

export function SkillCreationHome({
  documents,
  busy,
  onSend,
  onFiles,
  onRemoveDocument,
  onOpenMultimodal,
  onOpenManual,
}: SkillCreationHomeProps) {
  const [input, setInput] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const send = () => {
    const value = input.trim();
    if (!value || busy) return;
    setInput('');
    onSend(value);
  };

  const acceptFiles = (files: FileList) => {
    if (!files.length) return;
    onFiles(files);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    acceptFiles(event.dataTransfer.files);
  };

  return (
    <main className="skill-creation-home skill-view-enter">
      <div className="skill-creation-home-content">
        <h1>
          想把哪段<span>教学经验</span>，蒸馏成可复用的 Skill？
        </h1>

        <div className="skill-home-composer-zone">
          <div
            className={`skill-home-composer ${dragActive ? 'is-dragging' : ''}`}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                setDragActive(false);
              }
            }}
            onDrop={handleDrop}
          >
            <input
              ref={fileInputRef}
              hidden
              multiple
              type="file"
              accept=".txt,.md,.docx,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(event) => {
                if (event.target.files) acceptFiles(event.target.files);
                event.target.value = '';
              }}
            />
            <button
              type="button"
              className="skill-home-attach"
              onClick={() => fileInputRef.current?.click()}
              aria-label="添加教案或课例文档"
              title="添加教案或课例文档"
            >
              <Plus size={22} aria-hidden="true" />
            </button>
            <textarea
              rows={1}
              value={input}
              name="skill-creation-home-message"
              aria-label="描述你的教学经验"
              autoComplete="off"
              placeholder="描述你的教学经验，或直接拖入教案、课例文档……"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
            />
            <button
              type="button"
              className="skill-home-send"
              onClick={send}
              disabled={busy || !input.trim()}
              aria-label="开始对话共创"
              title="开始对话共创"
            >
              <ArrowUp size={18} strokeWidth={2.4} aria-hidden="true" />
            </button>
          </div>

          {documents.length > 0 ? (
            <div className="skill-home-documents" aria-label="已添加的教学材料">
              {documents.map((document, index) => (
                <span key={`${document.name}-${index}`}>
                  <FileText size={13} aria-hidden="true" />
                  <b>{document.name}</b>
                  <button
                    type="button"
                    onClick={() => onRemoveDocument(index)}
                    aria-label={`移除 ${document.name}`}
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          <div className="skill-home-composer-meta">
            <span className="skill-home-mode-chip">
              <MessageCircle size={15} aria-hidden="true" />
              对话共创 · 默认方式
            </span>
            <small>一个对话入口，系统自动匹配提炼路径</small>
          </div>
        </div>

        <p className="skill-home-way-label">更多触发方式</p>
        <div className="skill-home-way-grid">
          <button type="button" onClick={onOpenMultimodal}>
            <span className="skill-home-way-icon is-video">
              <Video size={19} aria-hidden="true" />
            </span>
            <strong>
              实录蒸馏 <em className="is-violet">专用工作台</em>
            </strong>
            <small>课堂音视频的证据对齐与回放核对，未确认不生成</small>
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
          >
            <span className="skill-home-way-icon is-document">
              <FileText size={19} aria-hidden="true" />
            </span>
            <strong>
              材料提炼 <em>对话内完成</em>
            </strong>
            <small>教案、课例、反思文档拖入上方对话框即可提炼</small>
          </button>

          <button type="button" onClick={onOpenManual}>
            <span className="skill-home-way-icon is-manual">
              <PencilLine size={19} aria-hidden="true" />
            </span>
            <strong>
              结构视图 <em>适合专家</em>
            </strong>
            <small>方法已成型时，跳过对话直接定义草案字段</small>
          </button>
        </div>
      </div>
    </main>
  );
}
