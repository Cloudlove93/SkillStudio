import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  ManualEditSkillVersionResult,
  SkillVersionDetail,
} from '@educlaw/shared';
import {
  Eye,
  FileText,
  FolderOpen,
  Loader2,
  PencilLine,
  Save,
  X,
} from 'lucide-react';
import { liteApi } from '../../api/lite-api';
import { SkillMarkdownContent } from '../lite/lite-rendering';

type Props = {
  token: string;
  packageId: string;
  version: SkillVersionDetail;
  currentPackageVersionId: string | null;
  onClose: () => void;
  onSaved: (result: ManualEditSkillVersionResult) => Promise<void> | void;
};

export function SkillVersionContentDialog({
  token,
  packageId,
  version,
  currentPackageVersionId,
  onClose,
  onSaved,
}: Props) {
  const original = version.skill.skillMd;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(original);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const saveLock = useRef(false);
  const requestKey = useRef<string | null>(null);
  const dirty = editing && draft !== original;
  const title = version.skill.name || version.skill.dirName;
  const canLeave = useCallback(
    () =>
      !dirty || window.confirm('尚未保存的修改会丢失，确定离开吗？'),
    [dirty],
  );
  const requestClose = useCallback(() => {
    if (canLeave()) onClose();
  }, [canLeave, onClose]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) requestClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [requestClose, saving]);
  const cancelEditing = () => {
    if (!canLeave()) return;
    setDraft(original);
    setError('');
    setEditing(false);
    requestKey.current = null;
  };
  const save = async () => {
    if (saveLock.current || saving) return;
    if (!currentPackageVersionId) {
      setError('无法确认当前 Package 版本，请刷新版本列表后重试。');
      return;
    }
    if (!draft.trim()) {
      setError('SKILL.md 不能为空。');
      return;
    }
    saveLock.current = true;
    setSaving(true);
    setError('');
    requestKey.current ||= createRequestId('skill-manual-edit');
    try {
      const result = await liteApi.createManualSkillVersion(token, packageId, {
        skillId: version.skillId,
        baseVersionId: version.id,
        expectedPackageVersionId: currentPackageVersionId,
        idempotencyKey: requestKey.current,
        skillMd: draft,
        note: `手动编辑 Skill v${version.versionNumber}`,
      });
      await onSaved(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存新版本失败');
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  };

  const filePath = useMemo(
    () => `${version.skill.dirName}/SKILL.md`,
    [version.skill.dirName],
  );

  return createPortal(
    <div className="skill-content-dialog" role="dialog" aria-modal="true">
      <section className="skill-content-shell">
        <header className="skill-content-head">
          <div>
            <span className="skill-eyebrow">Skill 内容</span>
            <h3>{title} · v{version.versionNumber}</h3>
            <p>当前只展示此固定版本真实保存的 SKILL.md。</p>
          </div>
          <div className="skill-content-head-actions">
            {editing ? (
              <>
                <button
                  type="button"
                  className="skill-secondary-button"
                  onClick={cancelEditing}
                  disabled={saving}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="skill-primary-button"
                  onClick={() => void save()}
                  disabled={saving || !dirty}
                >
                  {saving ? <Loader2 className="spin" size={15} /> : <Save size={15} />}
                  保存为新版本
                </button>
              </>
            ) : (
              <button
                type="button"
                className="skill-secondary-button"
                onClick={() => setEditing(true)}
              >
                <PencilLine size={15} />
                编辑 SKILL.md
              </button>
            )}
            <button
              type="button"
              className="skill-icon-button"
              onClick={requestClose}
              disabled={saving}
              aria-label="关闭 Skill 内容"
              title="关闭"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        {error ? <div className="skill-content-error" role="alert">{error}</div> : null}

        <div className={`skill-content-layout ${editing ? 'is-editing' : ''}`}>
          <aside className="skill-content-tree" aria-label="Skill 文件">
            <div><FolderOpen size={15} /> {version.skill.dirName}</div>
            <button type="button" className="is-selected" aria-current="page">
              <FileText size={14} />
              SKILL.md
            </button>
            <small>该版本未保存 references、scripts 或 assets。</small>
          </aside>

          <main className="skill-content-main">
            <div className="skill-content-filebar">
              <span>{filePath}</span>
              <span>{editing ? '源码编辑 + 实时预览' : '只读预览'}</span>
            </div>
            {editing ? (
              <div className="skill-content-editor-grid">
                <label>
                  <span>Markdown 源码</span>
                  <textarea
                    aria-label="SKILL.md 源码"
                    value={draft}
                    spellCheck={false}
                    disabled={saving}
                    onChange={(event) => {
                      setDraft(event.target.value);
                      setError('');
                      requestKey.current = null;
                    }}
                  />
                </label>
                <section aria-label="SKILL.md 实时预览">
                  <h4><Eye size={14} /> 实时预览</h4>
                  <div className="skill-content-rendered">
                    <SkillMarkdownContent content={draft} />
                  </div>
                </section>
              </div>
            ) : (
              <div className="skill-content-rendered">
                <SkillMarkdownContent content={original} />
              </div>
            )}
          </main>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function createRequestId(prefix: string) {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
