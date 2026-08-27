import { useEffect, useRef } from 'react';
import { AlertTriangle, LoaderCircle, X } from 'lucide-react';
import { summarizeSkillDeletion } from './skill-repository-state';
import type { RepositorySkill } from './SkillRepositoryWorkspace';

type Props = {
  skills: RepositorySkill[];
  deleting: boolean;
  error: string;
  returnFocusSkillId: string | null;
  onCancel: () => void;
  onConfirm: () => void;
};

export function SkillDeleteConfirmDialog({
  skills,
  deleting,
  error,
  returnFocusSkillId,
  onCancel,
  onConfirm,
}: Props) {
  const summary = summarizeSkillDeletion(skills);
  const dialogRef = useRef<HTMLElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const deletingRef = useRef(deleting);
  const onCancelRef = useRef(onCancel);
  deletingRef.current = deleting;
  onCancelRef.current = onCancel;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    cancelButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !deletingRef.current) {
        onCancelRef.current();
        return;
      }
      if (event.key === 'Tab') {
        const focusable = Array.from(
          dialogRef.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ) ?? [],
        );
        const first = focusable[0];
        const last = focusable.at(-1);
        if (!first || !last) {
          event.preventDefault();
          return;
        }
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const previousCanReceiveFocus = previousFocus
        && previousFocus !== document.body
        && previousFocus.isConnected;
      if (previousCanReceiveFocus) {
        previousFocus.focus();
        return;
      }

      const rowAction = returnFocusSkillId
        ? document.querySelector<HTMLElement>(
          `[data-skill-delete-return="${returnFocusSkillId}"]`,
        )
        : null;
      (rowAction || document.querySelector<HTMLElement>(
        '[data-skill-delete-return-focus]',
      ))?.focus();
    };
  }, [returnFocusSkillId]);

  return (
    <div
      className="skill-delete-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !deleting) onCancel();
      }}
    >
      <section
        ref={dialogRef}
        className="skill-delete-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="skill-delete-dialog-title"
        aria-describedby="skill-delete-dialog-description"
      >
        <header>
          <span className="skill-delete-dialog-icon"><AlertTriangle size={18} /></span>
          <div>
            <h2 id="skill-delete-dialog-title">删除选中的 Skill？</h2>
            <p id="skill-delete-dialog-description">
              删除后将从 Skill 仓库和工作区移除，原始素材与处理产物仍会保留。
            </p>
          </div>
          <button type="button" onClick={onCancel} disabled={deleting} aria-label="关闭删除确认">
            <X size={16} />
          </button>
        </header>

        <div className="skill-delete-dialog-summary">
          <strong>将删除 {summary.count} 个 Skill</strong>
          <ul>
            {summary.names.map((name) => <li key={name}>{name}</li>)}
          </ul>
          {summary.remaining > 0 ? <small>以及另外 {summary.remaining} 个 Skill</small> : null}
        </div>

        {error ? <p className="skill-delete-dialog-error" role="alert">{error}</p> : null}

        <footer>
          <button ref={cancelButtonRef} type="button" onClick={onCancel} disabled={deleting}>取消</button>
          <button type="button" className="is-destructive" onClick={onConfirm} disabled={deleting}>
            {deleting ? <><LoaderCircle size={14} className="is-spinning" />正在删除</> : '确认删除'}
          </button>
        </footer>
      </section>
    </div>
  );
}
