import { useEffect, useRef, useState } from 'react';
import { FileArchive, Loader2, UploadCloud, X } from 'lucide-react';

type Props = {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onImport: (file: File) => void;
};

export function SkillImportDialog({ open, busy, onClose, onImport }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) setFile(null);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [busy, onClose, open]);

  if (!open) return null;

  const choose = (nextFile: File | undefined) => {
    if (nextFile) setFile(nextFile);
  };

  return (
    <div
      className="skill-import-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section className="skill-import-dialog" role="dialog" aria-modal="true" aria-labelledby="skill-import-title">
        <header>
          <div>
            <h2 id="skill-import-title">导入 Skill</h2>
            <p>导入标准 Skill ZIP，校验后加入仓库。</p>
          </div>
          <button type="button" className="skill-icon-button" onClick={onClose} disabled={busy} aria-label="关闭导入窗口">
            <X size={16} />
          </button>
        </header>

        <input
          ref={inputRef}
          hidden
          type="file"
          accept=".zip,application/zip"
          onChange={(event) => {
            choose(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        <button
          type="button"
          className="skill-import-dialog-dropzone"
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            choose(event.dataTransfer.files[0]);
          }}
        >
          {file ? <FileArchive size={25} /> : <UploadCloud size={25} />}
          <strong>{file?.name || '选择 ZIP 文件'}</strong>
          <span>{file ? '点击可以重新选择' : '点击选择，或将文件拖到这里'}</span>
        </button>

        <footer>
          <button type="button" className="skill-secondary-button" onClick={onClose} disabled={busy}>取消</button>
          <button type="button" className="skill-primary-button" onClick={() => file && onImport(file)} disabled={!file || busy}>
            {busy && <Loader2 size={14} className="spin" />}
            开始导入
          </button>
        </footer>
      </section>
    </div>
  );
}
