import { useEffect, useRef, useState } from 'react';
import type { SkillVersionDetail } from '@educlaw/shared';
import { Download, History, MessageSquare, Pencil, Trash2 } from 'lucide-react';
import { liteApi, type RepositorySkillRecord } from '../../api/lite-api';
import { useSkillVersions } from '../skill-workspace/use-skill-versions';
import { SkillExportDialog } from '../skill-workspace/SkillExportDialog';
import { AssetCard } from './AssetCard';

export function SkillAssetDetail({
  token,
  skill,
  pinnedVersion,
  onNavigate,
  onChanged,
  onDeleted,
}: {
  token: string;
  skill: RepositorySkillRecord;
  pinnedVersion?: string | null;
  onNavigate: (url: string) => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const versions = useSkillVersions(token, skill.packageId, skill.id);
  const [selectedVersion, setSelectedVersion] = useState(
    pinnedVersion || skill.currentVersionId || skill.latestVersionId || '',
  );
  const [version, setVersion] = useState<SkillVersionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(skill.name);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let current = true;
    setVersion(null);
    setError('');
    setLoading(!!selectedVersion);
    if (!selectedVersion) return;
    void liteApi
      .getSkillVersionDetail(token, skill.packageId, selectedVersion)
      .then((result) => {
        if (result.skillId !== skill.id)
          throw new Error('此版本不属于当前 Skill，请选择其他版本。');
        if (current) setVersion(result);
      })
      .catch((e) => {
        if (current) setError(e instanceof Error ? e.message : '版本加载失败');
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [token, skill.packageId, skill.id, selectedVersion, retry]);

  async function rename() {
    if (busy || !name.trim()) return;
    setBusy(true);
    setError('');
    try {
      await liteApi.renameSkill(token, skill.packageId, skill.id, name.trim());
      if (!mounted.current) return;
      setRenaming(false);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : '重命名失败');
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (
      busy ||
      !window.confirm(`删除「${skill.name}」？关联的使用记录也可能受到影响。`)
    )
      return;
    setBusy(true);
    setError('');
    try {
      await liteApi.batchDeleteSkills(token, [skill.id]);
      if (!mounted.current) return;
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="asset-detail" aria-label="Skill 详情">
      <AssetCard
        detail
        kind="skill"
        name={skill.name}
        description={skill.description}
        metadata={[
          {
            label: '当前版本',
            value: skill.currentVersionNumber
              ? `v${skill.currentVersionNumber}`
              : '暂无当前版本',
          },
          {
            label: '来源',
            value:
              skill.packageName ||
              `Package #${skill.originPackageId || skill.packageId}`,
          },
        ]}
      >
        <button
          type="button"
          className="asset-primary"
          disabled={busy}
          onClick={() =>
            onNavigate(
              `/agents?skillId=${encodeURIComponent(skill.id)}&autochat=1`,
            )
          }
        >
          <MessageSquare size={15} />在 Agent 中使用
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            onNavigate(
              `/?view=versions&skill=${encodeURIComponent(`${skill.packageId}:${skill.id}`)}`,
            )
          }
        >
          <History size={15} />
          版本管理
        </button>
        <button type="button" onClick={() => setExporting(true)}>
          <Download size={15} />
          导出 Skill
        </button>
        <button
          type="button"
          title="重命名 Skill"
          aria-label="重命名 Skill"
          disabled={busy}
          onClick={() => setRenaming(true)}
        >
          <Pencil size={15} />
        </button>
        <button
          type="button"
          title="删除 Skill"
          aria-label="删除 Skill"
          disabled={busy}
          onClick={() => void remove()}
        >
          <Trash2 size={15} />
        </button>
      </AssetCard>
      {renaming && (
        <form
          className="asset-toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            void rename();
          }}
        >
          <label>
            Skill 名称
            <input
              autoFocus
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
            />
          </label>
          <button type="submit" disabled={busy || !name.trim()}>
            保存名称
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setRenaming(false)}
          >
            取消
          </button>
        </form>
      )}
      <h3>版本内容</h3>
      <div className="asset-actions">
        <label>
          查看版本{' '}
          <select
            value={selectedVersion}
            disabled={loading}
            onChange={(e) => setSelectedVersion(e.target.value)}
          >
            {!versions.versions.some((v) => v.id === selectedVersion) && (
              <option value={selectedVersion}>
                {selectedVersion ? `版本 #${selectedVersion}` : '暂无版本'}
              </option>
            )}
            {versions.versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.versionNumber}
                {v.status === 'discarded' ? '（已废弃）' : ''}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={versions.loading}
          onClick={() => void versions.reload()}
        >
          刷新版本
        </button>
        {versions.hasMore && (
          <button
            type="button"
            disabled={versions.loadingMore}
            onClick={() => void versions.loadMore()}
          >
            更多版本
          </button>
        )}
      </div>
      {loading && <p role="status">正在读取版本…</p>}
      {error && (
        <div role="alert" className="asset-error">
          {error}
          <button type="button" onClick={() => setRetry((n) => n + 1)}>
            重试
          </button>
        </div>
      )}
      {version && <pre>{version.skill.skillMd}</pre>}
      <SkillExportDialog
        token={token}
        skill={
          exporting
            ? {
                ...skill,
                key: `${skill.packageId}:${skill.id}`,
                skillId: skill.id,
              }
            : null
        }
        onClose={() => setExporting(false)}
      />
    </section>
  );
}
