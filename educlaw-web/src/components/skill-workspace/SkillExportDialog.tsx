import { useEffect, useRef, useState } from 'react';
import type { SkillVersionDetail } from '@educlaw/shared';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { liteApi } from '../../api/lite-api';
import type { RepositorySkill } from './SkillRepositoryWorkspace';

type Props = {
  token: string;
  skill: RepositorySkill | null;
  onClose: () => void;
};

async function loadExportableVersions(
  token: string,
  skill: RepositorySkill,
): Promise<SkillVersionDetail[]> {
  const versions: SkillVersionDetail[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 100; page += 1) {
    const result = await liteApi.listSkillVersions(
      token,
      skill.packageId,
      skill.skillId,
      { limit: 100, cursor },
    );
    versions.push(...result.items.filter((item) => item.status === 'active'));
    if (!result.nextCursor) break;
    if (seenCursors.has(result.nextCursor)) {
      throw new Error('版本分页游标重复，请刷新后重试');
    }
    seenCursors.add(result.nextCursor);
    cursor = result.nextCursor;
  }
  return versions.sort(
    (left, right) => right.versionNumber - left.versionNumber,
  );
}

export function SkillExportDialog({ token, skill, onClose }: Props) {
  return skill ? (
    <SkillExportSession
      key={JSON.stringify([token, skill.key])}
      token={token}
      skill={skill}
      onClose={onClose}
    />
  ) : null;
}

function SkillExportSession({
  token,
  skill,
  onClose,
}: Props & { skill: RepositorySkill }) {
  const [versions, setVersions] = useState<SkillVersionDetail[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const exportLock = useRef(false);
  const mounted = useRef(false);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    mounted.current = true;
    const opener = document.activeElement;
    dialogRef.current?.focus();
    return () => {
      mounted.current = false;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError('');
    setVersions([]);
    setSelectedVersionId('');
    void loadExportableVersions(token, skill)
      .then((items) => {
        if (!current) return;
        setVersions(items);
        setSelectedVersionId(items[0]?.id || '');
      })
      .catch((loadError) => {
        if (!current) return;
        setError(
          loadError instanceof Error ? loadError.message : '版本列表加载失败',
        );
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [skill, token]);

  const selected =
    versions.find((item) => item.id === selectedVersionId) ?? null;

  const exportVersion = async () => {
    if (!selected || exportLock.current) return;
    exportLock.current = true;
    setExporting(true);
    setError('');
    try {
      const fallbackName = `skill-v${selected.versionNumber}.zip`;
      const fileName = await liteApi.exportSkillVersion(
        token,
        skill.packageId,
        skill.skillId,
        selected.id,
        fallbackName,
      );
      if (!mounted.current) return;
      toast.success(`已导出 ${fileName}`);
      onClose();
    } catch (exportError) {
      if (!mounted.current) return;
      setError(
        exportError instanceof Error ? exportError.message : 'Skill 导出失败',
      );
    } finally {
      exportLock.current = false;
      if (mounted.current) setExporting(false);
    }
  };

  return (
    <div
      className="skill-session-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !exporting) onClose();
      }}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        className="skill-session-dialog skill-export-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="导出 Skill"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !exportLock.current) onClose();
          if (event.key !== 'Tab') return;
          const controls = event.currentTarget.querySelectorAll<HTMLElement>(
            'input:not(:disabled), button:not(:disabled)',
          );
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (!first || !last) {
            event.preventDefault();
            event.currentTarget.focus();
          } else if (
            event.shiftKey &&
            (document.activeElement === first ||
              document.activeElement === event.currentTarget)
          ) {
            event.preventDefault();
            last.focus();
          } else if (
            !event.shiftKey &&
            (document.activeElement === last ||
              document.activeElement === event.currentTarget)
          ) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <h2>导出 Skill</h2>
        <p>
          选择要导出的固定版本。ZIP 只包含该版本真实保存的
          SKILL.md，导出不会修改 Skill。
        </p>
        {loading ? (
          <div className="skill-export-state" role="status">
            <Loader2 className="spin" size={17} /> 正在读取版本
          </div>
        ) : versions.length === 0 ? (
          <div className="skill-export-state">
            当前 Skill 暂无可导出的正常版本
          </div>
        ) : (
          <div
            className="skill-export-version-list"
            role="radiogroup"
            aria-label="导出版本"
          >
            {versions.map((version) => (
              <label key={version.id}>
                <input
                  type="radio"
                  name="skill-export-version"
                  value={version.id}
                  checked={selectedVersionId === version.id}
                  onChange={() => setSelectedVersionId(version.id)}
                  disabled={exporting}
                />
                <span>
                  <strong>v{version.versionNumber}</strong>
                  <small>{version.note || '正常版本'}</small>
                </span>
              </label>
            ))}
          </div>
        )}
        {error ? (
          <div className="skill-dialog-error" role="alert">
            {error}
          </div>
        ) : null}
        <footer>
          <button type="button" onClick={onClose} disabled={exporting}>
            取消
          </button>
          <button
            type="button"
            className="is-primary"
            disabled={loading || exporting || !selected}
            onClick={() => void exportVersion()}
          >
            {exporting ? (
              <Loader2 className="spin" size={15} />
            ) : (
              <Download size={15} />
            )}
            {exporting ? '正在导出…' : '导出所选版本'}
          </button>
        </footer>
      </section>
    </div>
  );
}
