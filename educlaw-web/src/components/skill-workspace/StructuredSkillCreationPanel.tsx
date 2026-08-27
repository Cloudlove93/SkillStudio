import { useRef, useState, type FormEvent } from 'react';
import type { GuidedCreationDocument } from '@educlaw/shared';
import { ArrowRight, Loader2, Paperclip } from 'lucide-react';
import {
  emptyStructuredSkillDraft,
  formatStructuredSkillRequest,
  hasStructuredSkillInput,
  type StructuredSkillDraft,
} from './structured-skill-creation-state';
import { InspectorPortal } from './InspectorPortal';
import { StructuredInspectorContent } from './StructuredInspectorContent';
import { useWorkspaceInspector } from './WorkspaceInspectorProvider';

type Props = {
  documents: GuidedCreationDocument[];
  busy: boolean;
  onSubmit: (content: string) => void;
  onFiles: (files: FileList) => void;
  onRemoveDocument: (index: number) => void;
};

const materialTypes =
  '.txt,.md,.docx,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export function StructuredSkillCreationPanel({
  documents,
  busy,
  onSubmit,
  onFiles,
  onRemoveDocument,
}: Props) {
  const { openInspector } = useWorkspaceInspector();
  const [draft, setDraft] = useState<StructuredSkillDraft>(
    emptyStructuredSkillDraft,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inspectorOpenedRef = useRef(false);

  const ensureInspector = () => {
    if (inspectorOpenedRef.current) return;
    inspectorOpenedRef.current = true;
    openInspector({
      owner: 'structured',
      view: 'structured-summary',
      title: '填写摘要',
      description: '随表单更新，不会改变当前输入焦点。',
    });
  };

  const update = (key: keyof StructuredSkillDraft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
    if (value.trim()) ensureInspector();
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !hasStructuredSkillInput(draft)) return;
    onSubmit(formatStructuredSkillRequest(draft));
  };

  return (
    <main className="skill-center">
      <form
        className="skill-structured-form skill-view-enter"
        onSubmit={submit}
      >
        <header className="skill-structured-header">
          <span className="skill-eyebrow">完整填写</span>
          <h1>完善 Skill 需求</h1>
          <p>一次写清楚，系统会继续检查遗漏并通过对话完善。</p>
        </header>

        <div className="skill-structured-fields">
          <label className="skill-structured-row">
            <span>Skill 名称</span>
            <input
              name="skill-name"
              autoComplete="off"
              value={draft.name}
              onChange={(event) => update('name', event.target.value)}
              placeholder="给这个 Skill 起一个清楚的名字"
            />
          </label>
          <div className="skill-structured-pair">
            <label className="skill-structured-row">
              <span>服务对象</span>
              <input
                name="skill-audience"
                autoComplete="off"
                value={draft.audience}
                onChange={(event) => update('audience', event.target.value)}
                placeholder="它主要给谁使用"
              />
            </label>
            <label className="skill-structured-row">
              <span>使用场景</span>
              <input
                name="skill-scenario"
                autoComplete="off"
                value={draft.scenario}
                onChange={(event) => update('scenario', event.target.value)}
                placeholder="通常在什么时候使用"
              />
            </label>
          </div>
          <label className="skill-structured-row is-multiline">
            <span>核心任务</span>
            <textarea
              name="skill-task"
              autoComplete="off"
              value={draft.task}
              onChange={(event) => update('task', event.target.value)}
              placeholder="希望这个 Skill 帮助完成什么"
              rows={2}
            />
          </label>
          <div className="skill-structured-pair">
            <label className="skill-structured-row is-multiline">
              <span>输入内容</span>
              <textarea
                name="skill-input"
                autoComplete="off"
                value={draft.input}
                onChange={(event) => update('input', event.target.value)}
                placeholder="用户会提供什么"
                rows={2}
              />
            </label>
            <label className="skill-structured-row is-multiline">
              <span>期望输出</span>
              <textarea
                name="skill-output"
                autoComplete="off"
                value={draft.output}
                onChange={(event) => update('output', event.target.value)}
                placeholder="最终需要得到什么"
                rows={2}
              />
            </label>
          </div>
          <label className="skill-structured-row is-multiline">
            <span>
              规则与边界 <small>可选</small>
            </span>
            <textarea
              name="skill-boundaries"
              autoComplete="off"
              value={draft.boundaries}
              onChange={(event) => update('boundaries', event.target.value)}
              placeholder="必须遵守或不能做的事情"
              rows={2}
            />
          </label>
        </div>

        <footer className="skill-structured-actions">
          <input
            ref={fileInputRef}
            name="skill-supporting-materials"
            hidden
            type="file"
            multiple
            accept={materialTypes}
            onChange={(event) => {
              if (event.target.files?.length) {
                ensureInspector();
                onFiles(event.target.files);
              }
              event.target.value = '';
            }}
          />
          <button
            type="button"
            className="skill-material-icon-button"
            onClick={() => fileInputRef.current?.click()}
            title="添加教学材料"
            aria-label="添加教学材料"
          >
            <Paperclip size={16} aria-hidden="true" />
          </button>
          <span>可先填写部分内容，系统会继续追问完善</span>
          <button
            className="skill-primary-button"
            type="submit"
            disabled={busy || !hasStructuredSkillInput(draft)}
          >
            {busy ? (
              <Loader2 size={15} className="spin" aria-hidden="true" />
            ) : (
              <ArrowRight size={15} aria-hidden="true" />
            )}
            继续完善
          </button>
        </footer>
      </form>
      <InspectorPortal owner="structured">
        <StructuredInspectorContent
          draft={draft}
          documents={documents}
          onRemoveDocument={onRemoveDocument}
        />
      </InspectorPortal>
    </main>
  );
}
