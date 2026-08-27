import type { GuidedCreationDocument } from '@educlaw/shared';
import { Check, FileText, X } from 'lucide-react';
import type { StructuredSkillDraft } from './structured-skill-creation-state';

const FIELDS: Array<{ key: keyof StructuredSkillDraft; label: string }> = [
  { key: 'name', label: 'Skill 名称' },
  { key: 'audience', label: '服务对象' },
  { key: 'scenario', label: '使用场景' },
  { key: 'task', label: '核心任务' },
  { key: 'input', label: '输入内容' },
  { key: 'output', label: '期望输出' },
  { key: 'boundaries', label: '规则与边界' },
];

export function StructuredInspectorContent({
  draft,
  documents,
  onRemoveDocument,
}: {
  draft: StructuredSkillDraft;
  documents: GuidedCreationDocument[];
  onRemoveDocument: (index: number) => void;
}) {
  const completed = FIELDS.filter((field) => draft[field.key].trim()).length;

  return (
    <div className="skill-inspector-structured">
      <div className="skill-context-progress">
        <div><span>已填写</span><strong>{completed}/{FIELDS.length}</strong></div>
        <div className="skill-context-progress-track">
          <span style={{ width: `${Math.round((completed / FIELDS.length) * 100)}%` }} />
        </div>
      </div>
      <div className="skill-inspector-field-list">
        {FIELDS.map((field) => {
          const value = draft[field.key].trim();
          return (
            <section key={field.key} className={value ? 'is-complete' : ''}>
              <span>{value ? <Check size={13} /> : null}</span>
              <div><strong>{field.label}</strong><p>{value || '等待填写'}</p></div>
            </section>
          );
        })}
      </div>
      <section className="skill-inspector-materials">
        <h3>教学材料 <span>{documents.length}</span></h3>
        {documents.length === 0 ? (
          <p>尚未添加材料。</p>
        ) : documents.map((document, index) => (
          <div key={`${document.name}-${index}`}>
            <FileText size={14} />
            <span>{document.name}</span>
            <button type="button" onClick={() => onRemoveDocument(index)} aria-label={`移除 ${document.name}`}>
              <X size={13} />
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}

