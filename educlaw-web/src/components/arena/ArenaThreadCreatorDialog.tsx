import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Lock, Swords } from 'lucide-react';
import type {
  ArenaKind,
  ArenaThread,
  ArenaThreadDetail,
  PackageSkillRecord,
  SkillVersionDetail,
} from '@educlaw/shared';
import { liteApi } from '../../api/lite-api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface ArenaThreadCreatorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: string;
  packageId: string;
  currentPackageVersionId: string;
  packageSkills: PackageSkillRecord[];
  includeDiscardedVersions: boolean;
  onCreated: (thread: ArenaThread, detail: ArenaThreadDetail) => void;
  // 重建场景下使用：预选左右 Skill 的 skillUid
  initialLeftSkillUid?: string;
  initialRightSkillUid?: string;
  // 重建场景下使用：版本下拉优先选中最新 active 版本（而非 package 当前绑定版本）
  preferLatestVersion?: boolean;
}

type Side = 'left' | 'right';

export function ArenaThreadCreatorDialog({
  open,
  onOpenChange,
  token,
  packageId,
  currentPackageVersionId,
  packageSkills,
  includeDiscardedVersions,
  onCreated,
  initialLeftSkillUid,
  initialRightSkillUid,
  preferLatestVersion,
}: ArenaThreadCreatorDialogProps) {
  const [mode, setMode] = useState<ArenaKind>('skill_arena');
  const [leftSkillId, setLeftSkillId] = useState('');
  const [rightSkillId, setRightSkillId] = useState('');
  const [leftVersions, setLeftVersions] = useState<SkillVersionDetail[]>([]);
  const [rightVersions, setRightVersions] = useState<SkillVersionDetail[]>([]);
  const [leftVersionId, setLeftVersionId] = useState('');
  const [rightVersionId, setRightVersionId] = useState('');
  const [loading, setLoading] = useState({ left: false, right: false });
  const [pending, setPending] = useState(false);

  const leftRequestIdRef = useRef(0);
  const rightRequestIdRef = useRef(0);

  // 重置表单：Dialog 打开时初始化左右 Skill 默认选前两个不同的
  // 重建场景下：若传入 initialLeftSkillUid/initialRightSkillUid，则预选对应 Skill
  useEffect(() => {
    if (!open) return;
    setMode('skill_arena');
    setPending(false);
    if (packageSkills.length > 0) {
      const validLeftUid = initialLeftSkillUid
        ? packageSkills.find((s) => s.skillUid === initialLeftSkillUid)?.skillUid
        : undefined;
      const validRightUid = initialRightSkillUid
        ? packageSkills.find((s) => s.skillUid === initialRightSkillUid)?.skillUid
        : undefined;
      const first = validLeftUid || packageSkills[0].skillUid;
      const second =
        validRightUid ||
        (packageSkills.length > 1
          ? packageSkills[1].skillUid
          : packageSkills[0].skillUid);
      setLeftSkillId(first);
      setRightSkillId(second);
    } else {
      setLeftSkillId('');
      setRightSkillId('');
    }
    setLeftVersions([]);
    setRightVersions([]);
    setLeftVersionId('');
    setRightVersionId('');
  }, [open, packageSkills, initialLeftSkillUid, initialRightSkillUid]);

  const loadVersions = useCallback(
    async (
      side: Side,
      skillRecordId: string,
      preferredVersionId?: string,
    ) => {
      if (!token || !packageId || !skillRecordId) return;
      const requestRef =
        side === 'left' ? leftRequestIdRef : rightRequestIdRef;
      const requestId = requestRef.current + 1;
      requestRef.current = requestId;
      setLoading((prev) => ({ ...prev, [side]: true }));
      try {
        const result = await liteApi.listSkillVersions(
          token,
          packageId,
          skillRecordId,
          { includeDiscarded: includeDiscardedVersions },
        );
        if (requestRef.current !== requestId) return;
        const setVersions =
          side === 'left' ? setLeftVersions : setRightVersions;
        const setVersionId =
          side === 'left' ? setLeftVersionId : setRightVersionId;
        setVersions(result.items);
        setVersionId((current) => {
          if (
            preferredVersionId &&
            result.items.some((item) => item.id === preferredVersionId)
          ) {
            return preferredVersionId;
          }
          if (current && result.items.some((item) => item.id === current)) {
            return current;
          }
          // 重建场景下：优先选最新 active 版本（result.items 已按版本号倒序）
          if (preferLatestVersion && result.items[0]) {
            return result.items[0].id;
          }
          if (
            result.currentVersionId &&
            result.items.some((item) => item.id === result.currentVersionId)
          ) {
            return result.currentVersionId;
          }
          return result.items[0]?.id || '';
        });
      } catch {
        if (requestRef.current !== requestId) return;
        if (side === 'left') {
          setLeftVersions([]);
          setLeftVersionId('');
        } else {
          setRightVersions([]);
          setRightVersionId('');
        }
      } finally {
        if (requestRef.current === requestId) {
          setLoading((prev) => ({ ...prev, [side]: false }));
        }
      }
    },
    [token, packageId, includeDiscardedVersions, preferLatestVersion],
  );

  // 加载左侧版本
  useEffect(() => {
    if (!open) return;
    const record = packageSkills.find((s) => s.skillUid === leftSkillId);
    if (!record?.id) {
      leftRequestIdRef.current += 1;
      setLeftVersions([]);
      setLeftVersionId('');
      setLoading((prev) => ({ ...prev, left: false }));
      return;
    }
    void loadVersions('left', record.id);
  }, [open, leftSkillId, packageSkills, loadVersions]);

  // 加载右侧版本
  useEffect(() => {
    if (!open) return;
    const record = packageSkills.find((s) => s.skillUid === rightSkillId);
    if (!record?.id) {
      rightRequestIdRef.current += 1;
      setRightVersions([]);
      setRightVersionId('');
      setLoading((prev) => ({ ...prev, right: false }));
      return;
    }
    void loadVersions('right', record.id);
  }, [open, rightSkillId, packageSkills, loadVersions]);

  // 左右完全相同 → 右侧自动让位到另一个版本
  useEffect(() => {
    if (!open) return;
    if (
      leftSkillId &&
      leftSkillId === rightSkillId &&
      leftVersionId &&
      leftVersionId === rightVersionId
    ) {
      const alt = rightVersions.find((v) => v.id !== leftVersionId)?.id;
      if (alt) setRightVersionId(alt);
    }
  }, [open, leftSkillId, rightSkillId, leftVersionId, rightVersionId, rightVersions]);

  const canSubmit =
    !pending &&
    (mode === 'package_arena' ||
      (Boolean(currentPackageVersionId) &&
        Boolean(leftSkillId) &&
        Boolean(rightSkillId) &&
        Boolean(leftVersionId) &&
        Boolean(rightVersionId) &&
        !(
          leftSkillId === rightSkillId &&
          leftVersionId === rightVersionId
        )));

  const handleCreate = async () => {
    if (!token || !packageId || !canSubmit) return;
    setPending(true);
    try {
      let nextThread: ArenaThread;
      let nextDetail: ArenaThreadDetail;
      if (mode === 'skill_arena') {
        const leftRecord = packageSkills.find(
          (s) => s.skillUid === leftSkillId,
        );
        const rightRecord = packageSkills.find(
          (s) => s.skillUid === rightSkillId,
        );
        if (
          !currentPackageVersionId ||
          !leftRecord?.id ||
          !rightRecord?.id ||
          !leftVersionId ||
          !rightVersionId
        ) {
          throw new Error('请先选择左右 Skill 及其版本');
        }
        nextThread = await liteApi.createArenaThread(token, packageId, {
          idempotencyKey: createClientIdempotencyKey(),
          basePackageVersionId: currentPackageVersionId,
          left: { skillId: leftRecord.id, skillVersionId: leftVersionId },
          right: { skillId: rightRecord.id, skillVersionId: rightVersionId },
        });
        nextDetail = await liteApi.getArenaThreadDetail(
          token,
          packageId,
          String(nextThread.id),
        );
      } else {
        nextThread = await liteApi.createThread(token, packageId);
        nextDetail = await liteApi.getThread(token, String(nextThread.id));
      }
      if (nextThread.warning) {
        toast.warning(nextThread.warning);
      } else {
        toast.success(
          mode === 'skill_arena' ? 'Skill Arena 已创建' : '标准 Arena 已创建',
        );
      }
      onCreated(nextThread, nextDetail);
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : '创建 Arena 线程失败',
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Swords className="size-5 text-primary" />
            新建 Arena 对比
          </DialogTitle>
          <DialogDescription>
            选择对比模式并配置 Skill，线程将绑定当前版本快照。
          </DialogDescription>
        </DialogHeader>

        {/* 模式切换 */}
        <div className="inline-flex w-fit rounded-[12px] border border-border/70 bg-muted/40 p-0.5">
          {([
            { key: 'package_arena' as const, label: '标准 Arena' },
            { key: 'skill_arena' as const, label: 'Skill Arena' },
          ]).map((kind) => (
            <button
              key={kind.key}
              onClick={() => setMode(kind.key)}
              className={`rounded-[9px] px-3 py-1 text-xs font-medium transition-colors ${
                mode === kind.key
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {kind.label}
            </button>
          ))}
        </div>

        {/* 配置区 */}
        {mode === 'package_arena' ? (
          <div className="rounded-[12px] border border-border/70 bg-card px-4 py-3">
            <div className="flex items-start gap-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-primary-soft text-primary">
                <Swords className="size-4" />
              </div>
              <div>
                <div className="text-sm font-medium">基线模型 vs 当前智能体</div>
                <div className="mt-1 text-xs text-muted-foreground leading-5">
                  使用智能体的最新快照进行对比，无需额外配置。
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-[12px] border border-border/70 bg-card px-4 py-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <SideSelector
                label="左侧 Skill"
                skills={packageSkills}
                selectedSkillId={leftSkillId}
                onSelectSkill={setLeftSkillId}
                versions={leftVersions}
                selectedVersionId={leftVersionId}
                onSelectVersion={setLeftVersionId}
                loading={loading.left}
              />
              <SideSelector
                label="右侧 Skill"
                skills={packageSkills}
                selectedSkillId={rightSkillId}
                onSelectSkill={setRightSkillId}
                versions={rightVersions}
                selectedVersionId={rightVersionId}
                onSelectVersion={setRightVersionId}
                loading={loading.right}
              />
            </div>
          </div>
        )}

        {/* 快照提示 */}
        <div className="flex items-start gap-2 rounded-[10px] border border-primary/15 bg-primary-soft px-3 py-2">
          <Lock className="size-3.5 shrink-0 text-primary mt-0.5" />
          <div className="text-xs leading-5">
            {mode === 'skill_arena'
              ? '线程将固定绑定当前 Package 版本与左右 Skill 版本，后续对话和报告都使用这份快照。'
              : '标准 Arena 使用当前智能体快照。'}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            取消
          </Button>
          <Button
            size="sm"
            onClick={() => void handleCreate()}
            disabled={!canSubmit}
          >
            {pending ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                创建中...
              </>
            ) : (
              '创建线程'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface SideSelectorProps {
  label: string;
  skills: PackageSkillRecord[];
  selectedSkillId: string;
  onSelectSkill: (id: string) => void;
  versions: SkillVersionDetail[];
  selectedVersionId: string;
  onSelectVersion: (id: string) => void;
  loading: boolean;
}

function SideSelector({
  label,
  skills,
  selectedSkillId,
  onSelectSkill,
  versions,
  selectedVersionId,
  onSelectVersion,
  loading,
}: SideSelectorProps) {
  return (
    <div className="space-y-2">
      <div className="text-[11px] font-medium text-muted-foreground">
        {label}
      </div>
      <select
        className="w-full rounded-[10px] border border-border/70 bg-background px-3 py-2 text-sm"
        value={selectedSkillId}
        onChange={(e) => onSelectSkill(e.target.value)}
      >
        <option value="">选择 Skill</option>
        {skills.map((skill) => (
          <option key={skill.id} value={skill.skillUid}>
            {skill.name}
            {skill.status === 'removed' ? ' (已移除)' : ''}
          </option>
        ))}
      </select>
      <select
        className="w-full rounded-[10px] border border-border/70 bg-background px-3 py-2 text-sm"
        value={selectedVersionId}
        onChange={(e) => onSelectVersion(e.target.value)}
        disabled={loading || !versions.length}
      >
        <option value="">{loading ? '加载版本中...' : '选择版本'}</option>
        {versions.map((version) => (
          <option key={version.id} value={version.id}>
            v{version.versionNumber} ({version.source})
          </option>
        ))}
      </select>
    </div>
  );
}

function createClientIdempotencyKey() {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  return `skill-op-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
