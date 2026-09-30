import { useEffect, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';

export function DiscardInspectorChangesDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    cancelButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [onCancel]);

  return (
    <div
      className="skill-delete-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        ref={dialogRef}
        className="skill-delete-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="discard-inspector-title"
        aria-describedby="discard-inspector-description"
      >
        <header>
          <span className="skill-delete-dialog-icon">
            <AlertTriangle size={18} aria-hidden="true" />
          </span>
          <div>
            <h2 id="discard-inspector-title">放弃未保存的修改？</h2>
            <p id="discard-inspector-description">
              关闭右侧栏会丢失当前尚未保存的内容。
            </p>
          </div>
          <button type="button" onClick={onCancel} aria-label="关闭确认窗口">
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <footer>
          <button ref={cancelButtonRef} type="button" onClick={onCancel}>
            继续编辑
          </button>
          <button type="button" className="is-destructive" onClick={onConfirm}>
            放弃并关闭
          </button>
        </footer>
      </section>
    </div>
  );
}
