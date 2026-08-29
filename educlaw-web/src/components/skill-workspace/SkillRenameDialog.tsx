import { useId, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import type { RepositorySkill } from './SkillRepositoryWorkspace';

type Props = {
  skill: RepositorySkill;
  onCancel: () => void;
  onRename: (skill: RepositorySkill, displayName: string) => Promise<void>;
};

export function SkillRenameDialog({ skill, onCancel, onRename }: Props) {
  const inputId = useId();
  const helpId = useId();
  const errorId = useId();
  const submittingRef = useRef(false);
  const [name, setName] = useState(skill.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const trimmedName = name.trim();
  const validationError = !trimmedName
    ? '请输入 Skill 名称'
    : trimmedName.length > 80
      ? '名称不能超过 80 个字符'
      : '';

  const submit = async () => {
    if (
      submittingRef.current ||
      validationError ||
      trimmedName === skill.name
    ) {
      return;
    }
    submittingRef.current = true;
    setBusy(true);
    setError('');
    try {
      await onRename(skill, trimmedName);
      onCancel();
    } catch (renameError) {
      setError(
        renameError instanceof Error
          ? renameError.message
          : '名称保存失败，请稍后重试',
      );
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  };

  return (
    <div
      className="skill-session-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <form
        className="skill-session-dialog skill-rename-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="重命名 Skill"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <header>
          <h2>重命名 Skill</h2>
          <p>只修改平台中的展示名称，不会改变 Skill 内容或生成新版本。</p>
        </header>
        <label htmlFor={inputId}>Skill 名称</label>
        <input
          id={inputId}
          name="skill-display-name"
          autoComplete="off"
          autoFocus
          value={name}
          maxLength={80}
          aria-describedby={`${helpId}${error ? ` ${errorId}` : ''}`}
          aria-invalid={Boolean(validationError || error)}
          onChange={(event) => {
            setName(event.target.value);
            setError('');
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !busy) onCancel();
          }}
        />
        <div className="skill-rename-dialog-meta" id={helpId}>
          <span>{validationError || '使用清晰、便于识别的名称。'}</span>
          <span>{name.length}/80</span>
        </div>
        {error ? (
          <p id={errorId} className="skill-rename-dialog-error" role="alert">
            {error}
          </p>
        ) : null}
        <footer>
          <button type="button" onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button
            type="submit"
            className="is-primary"
            disabled={
              busy || Boolean(validationError) || trimmedName === skill.name
            }
          >
            {busy ? (
              <>
                <LoaderCircle size={14} className="is-spinning" aria-hidden="true" />
                正在保存…
              </>
            ) : (
              '保存名称'
            )}
          </button>
        </footer>
      </form>
    </div>
  );
}
