import {
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import { toast } from 'sonner';
import type {
  AgentPackageDetail,
  AgentPackageSummary,
  ArenaAnswerOptimizationSummary,
  ArenaMessage,
  ArenaReport,
  ArenaThread,
  ArenaThreadDetail,
  OptimizationResult,
  PackageSkillRecord,
  PackageVersion,
  SkillVersionDetail,
} from '@educlaw/shared';
import {
  LiteApiError,
  computeLineDiff,
} from '../../api/lite-api';
import type {
  DiagnosisIssue,
  AdoptedChange,
  VersionCompareResult,
  LineDiff,
  InteractiveOptimizationSession,
  ArenaMode,
} from '../../api/lite-api';
import { useAuthStore } from '../../stores/auth';
import { liteApi } from '../../api/lite-api';
import {
  buildArenaReportRows,
  buildArenaReportSideCards,
  formatArenaReportWinner,
} from './arena-report';
import { getDefaultDetailTab, type DetailTab } from './detail-tab';
import { canOpenReportAction, getReportReadiness } from './report-status';
import { isArenaReport, parseStoredArenaReport } from './report-compat';
import {
  completeProgress,
  failProgressState,
  getProgressElapsedMs,
  pushProgressStep,
  startProgressState,
  type ProgressState,
} from './progress-state';
import {
  buildGeneratedReportViewState,
  buildReportCompletionStatusMessage,
} from './report-preview-state';
import {
  appendPackagePreviewDelta,
  ConversationBoard,
  MarkdownContent,
  OptimizationDiffView,
  PackagePreviewCard,
  SkillMarkdownContent,
  upsertPackagePreview,
  VersionDiffView,
  type PackagePreview,
} from './lite-rendering';
import { RubricStructuredView } from './rubric-structured-view';
import {
  getRubricEditValidationError,
  hasRubricContent,
  isRubricUsable,
} from './rubric-status';
import { extractDisplayRubricContent } from './rubric-display';
import { resolveRubricManualEditContent } from './rubric-edit-state';
import { getPackageSwitchDecision } from './workspace-switch-state';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  ArenaThreadCreatorDialog,
} from '../arena/ArenaThreadCreatorDialog';
import { useArenaThreadList } from '../arena/useArenaThreadList';
import {
  Sparkles,
  Send,
  Upload,
  Trash2,
  FileText,
  ListChecks,
  Wrench,
  GitCompare,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  BarChart3,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  X,
  LogOut,
  Plus,
  History,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import {
  AnswerSkillOptimizationDialog,
  type AnswerOptimizationDialogTarget,
} from './AnswerSkillOptimizationDialog';
import type { ConfirmAnswerOptimizationResult } from '../../api/answer-skill-optimizations';

type ManualEditState = {
  target: 'agent' | 'rubric' | 'skill';
  skillId?: string;
  title: string;
  content: string;
  preview: boolean;
};
type BatchGenerateItem = {
  id: string;
  name: string;
  status: 'waiting' | 'running' | 'done' | 'error';
  packageId?: string;
  packageName?: string;
  error?: string;
};
type CenterPreviewState =
  | {
      type: 'agent' | 'rubric' | 'skill' | 'diff';
      name: string;
      content: string;
    }
  | { type: 'report'; name: string; report: ArenaReport }
  | {
      type: 'adoptedDiff';
      name: string;
      change: AdoptedChange;
      diffs: LineDiff[];
    };

const DOCX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const BATCH_GENERATE_CONCURRENCY = 2;
const RUBRIC_TEMPLATE = [
  '# Rubric',
  '',
  '## \u8bc4\u5206\u76ee\u6807',
  '- \u7528\u8fd9\u4efd rubric \u5224\u65ad\u667a\u80fd\u4f53\u56de\u7b54\u662f\u5426\u8d34\u5408\u4efb\u52a1\u3001\u8db3\u591f\u6e05\u6670\uff0c\u5e76\u4fdd\u6301\u5fc5\u8981\u7684\u5b89\u5168\u8fb9\u754c\u3002',
  '- \u6bcf\u4e2a\u7ef4\u5ea6\u90fd\u5199\u6e05\u695a\u6ee1\u5206\u6807\u51c6\u3001\u5e38\u89c1\u6263\u5206\u70b9\uff0c\u4ee5\u53ca\u5fc5\u987b\u907f\u514d\u7684\u95ee\u9898\u3002',
  '',
  '## \u8bc4\u5206\u7ef4\u5ea6',
  '### \u89d2\u8272\u8d34\u5408',
  '- \u6ee1\u5206\u6807\u51c6\uff1a',
  '- \u5e38\u89c1\u6263\u5206\u70b9\uff1a',
  '',
  '### Skill \u9075\u5faa',
  '- \u6ee1\u5206\u6807\u51c6\uff1a',
  '- \u5e38\u89c1\u6263\u5206\u70b9\uff1a',
  '',
  '### \u56de\u7b54\u8d28\u91cf',
  '- \u6ee1\u5206\u6807\u51c6\uff1a',
  '- \u5e38\u89c1\u6263\u5206\u70b9\uff1a',
  '',
  '### \u5b89\u5168\u8fb9\u754c',
  '- \u6ee1\u5206\u6807\u51c6\uff1a',
  '- \u5e38\u89c1\u6263\u5206\u70b9\uff1a',
  '',
  '## \u4f7f\u7528\u8bf4\u660e',
  '- \u5148\u5224\u65ad\u56de\u7b54\u6709\u6ca1\u6709\u5b8c\u6210\u7528\u6237\u4efb\u52a1\uff0c\u518d\u6309\u4e0a\u9762\u7684\u7ef4\u5ea6\u9010\u9879\u8bc4\u5206\u3002',
  '- \u5982\u679c\u56de\u7b54\u660e\u663e\u8d8a\u754c\u3001\u8bef\u5bfc\uff0c\u6216\u7f3a\u5c11\u5173\u952e\u4e8b\u5b9e\uff0c\u53ef\u4ee5\u76f4\u63a5\u5224\u4e3a\u4f4e\u5206\u3002',
].join('\n');

function buildRubricDraft(seedContent = '') {
  const trimmed = seedContent.trim();
  if (!trimmed) return RUBRIC_TEMPLATE;
  return trimmed;
}

function normalizePreviewContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content == null) return '';
  try {
    return JSON.stringify(content, null, 2);
  } catch {
    return String(content);
  }
}

function isInteractiveMessage(
  value: unknown,
): value is { role: string; content: string } {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    typeof (value as { role?: unknown }).role === 'string' &&
    typeof (value as { content?: unknown }).content === 'string'
  );
}

function isAdoptedChangeLike(value: unknown): value is AdoptedChange {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    typeof (value as { id?: unknown }).id === 'string'
  );
}

function isDiagnosisIssueLike(value: unknown): value is DiagnosisIssue {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    typeof (value as { id?: unknown }).id === 'string'
  );
}

function prefersWideLayout(): boolean {
  return (
    typeof window === 'undefined' ||
    window.matchMedia('(min-width: 1024px)').matches
  );
}

function isDocxFile(file: File): boolean {
  return (
    file.name.toLowerCase().endsWith('.docx') || file.type === DOCX_MIME_TYPE
  );
}

async function readTextDocument(
  file: File,
): Promise<{ name: string; content: string }> {
  if (isDocxFile(file)) {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({
      arrayBuffer: await file.arrayBuffer(),
    });
    const warnings =
      result.messages?.map((message) => message.message).filter(Boolean) || [];
    const warningText = warnings.length
      ? `\n\n[Word 解析提示]\n${warnings.map((message) => `- ${message}`).join('\n')}`
      : '';
    return {
      name: file.name,
      content:
        `${result.value.trim()}${warningText}`.trim() ||
        '[Word 文档没有提取到可用文本]',
    };
  }

  return {
    name: file.name,
    content: await file.text(),
  };
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

function getSkillActionId(
  action: 'rollback' | 'discard' | 'undiscard',
  skillId: string,
  versionId: string,
) {
  return `${action}:${skillId}:${versionId}`;
}

function formatSkillArenaVariantLabel(
  variant: NonNullable<ArenaThread['skillArenaConfig']>['left'],
) {
  return `${variant.skillName} v${variant.versionNumber}`;
}

function getArenaSideLabels(
  currentThread: ArenaThread | null,
  packageName?: string,
  currentReport?: ArenaReport | null,
) {
  if (currentReport?.labels) {
    return currentReport.labels;
  }
  if (currentThread?.arenaKind === 'skill_arena' && currentThread.skillArenaConfig) {
    return {
      baseline: formatSkillArenaVariantLabel(currentThread.skillArenaConfig.left),
      enhanced: formatSkillArenaVariantLabel(currentThread.skillArenaConfig.right),
    };
  }
  return {
    baseline: '基础模型',
    enhanced: packageName || '智能体',
  };
}

export default function LiteArenaPanel() {
  const token = useAuthStore((s) => s.token) || '';
  const authUser = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [packages, setPackages] = useState<AgentPackageSummary[]>([]);
  const [selectedPackageId, setSelectedPackageId] = useState('');
  const [selectedPackage, setSelectedPackage] =
    useState<AgentPackageDetail | null>(null);
  const [versions, setVersions] = useState<PackageVersion[]>([]);
  const [packageSkills, setPackageSkills] = useState<PackageSkillRecord[]>([]);
  const [thread, setThread] = useState<ArenaThread | null>(null);
  const [threadDetail, setThreadDetail] = useState<ArenaThreadDetail | null>(
    null,
  );
  const [report, setReport] = useState<ArenaReport | null>(null);
  const [optimization, setOptimization] = useState<OptimizationResult | null>(
    null,
  );
  const [detailTab, setDetailTab] = useState<DetailTab>(getDefaultDetailTab);
  const [selectedSkillId, setSelectedSkillId] = useState('');
  const [skillVersions, setSkillVersions] = useState<SkillVersionDetail[]>([]);
  const [skillVersionsLoading, setSkillVersionsLoading] = useState(false);
  const [skillVersionsError, setSkillVersionsError] = useState('');
  const [skillVersionsCurrentId, setSkillVersionsCurrentId] = useState('');
  const [selectedSkillVersionId, setSelectedSkillVersionId] = useState('');
  const [showDiscardedSkillVersions, setShowDiscardedSkillVersions] =
    useState(false);
  const [skillActionPendingId, setSkillActionPendingId] = useState('');
  const skillActionPendingIdRef = useRef('');
  const [packageVersionActionPendingId, setPackageVersionActionPendingId] =
    useState('');
  const packageVersionActionPendingIdRef = useRef('');
  const [versionSubTab, setVersionSubTab] = useState<'package' | 'skill'>(
    'package',
  );

  const [instruction, setInstruction] = useState('');
  const [input, setInput] = useState('');
  const [, setStatus] = useState('');
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [generatePreviews, setGeneratePreviews] = useState<PackagePreview[]>(
    [],
  );
  const [sideStreaming, setSideStreaming] = useState({
    baseline: false,
    enhanced: false,
  });
  const [replyGeneratingThreadIds, setReplyGeneratingThreadIds] = useState<
    Set<string>
  >(() => new Set());
  const [nowMs, setNowMs] = useState(0);
  const [isWideLayout, setIsWideLayout] = useState(prefersWideLayout);
  const [sidebarOpen, setSidebarOpen] = useState(prefersWideLayout);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(true);
  const [leftWidth, setLeftWidth] = useState(400);
  const [rightWidth, setRightWidth] = useState(450);
  const [rightExpanded, setRightExpanded] = useState(false);
  const [documents, setDocuments] = useState<
    Array<{ name: string; content: string }>
  >([]);
  const [batchRuns, setBatchRuns] = useState<BatchGenerateItem[]>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const docFileRef = useRef<HTMLInputElement | null>(null);
  const rubricFileRef = useRef<HTMLInputElement | null>(null);
  const preserveGenerateProgressRef = useRef(false);

  // Interactive optimization state
  const [interactiveMode, setInteractiveMode] = useState(false);
  const [interactiveMessages, setInteractiveMessages] = useState<
    Array<{ role: string; content: string }>
  >([]);
  const [interactiveIssues, setInteractiveIssues] = useState<DiagnosisIssue[]>(
    [],
  );
  const [interactiveAdopted, setInteractiveAdopted] = useState<AdoptedChange[]>(
    [],
  );
  const [interactivePhase, setInteractivePhase] = useState<
    'idle' | 'diagnosing' | 'chatting'
  >('idle');
  const [interactiveInput, setInteractiveInput] = useState('');
  const [interactiveSessionId, setInteractiveSessionId] = useState('');
  const [interactiveSessions, setInteractiveSessions] = useState<
    InteractiveOptimizationSession[]
  >([]);
  const [interactiveView, setInteractiveView] = useState<
    'chat' | 'issues' | 'adopted' | 'history'
  >('chat');
  const [arenaMode, setArenaMode] = useState<ArenaMode>('compare');
  const [manualEdit, setManualEdit] = useState<ManualEditState | null>(null);
  const [manualEditSaving, setManualEditSaving] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const selectedPackageIdRef = useRef(selectedPackageId);
  useEffect(() => {
    selectedPackageIdRef.current = selectedPackageId;
  }, [selectedPackageId]);
  const progressActiveRef = useRef(false);
  useEffect(() => {
    progressActiveRef.current = Boolean(progress?.active);
  }, [progress?.active]);
  const threadRef = useRef(thread);
  useEffect(() => {
    threadRef.current = thread;
  }, [thread]);
  const skillVersionsRequestIdRef = useRef(0);

  // Center preview mode (view file in main panel)
  const [centerPreview, setCenterPreview] = useState<CenterPreviewState | null>(
    null,
  );
  const [hasSavedSession, setHasSavedSession] = useState(false);

  // Version compare state
  const [compareBaseId, setCompareBaseId] = useState('');
  const [compareTargetId, setCompareTargetId] = useState('');
  const [compareResult, setCompareResult] =
    useState<VersionCompareResult | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [answerOptimizationOpen, setAnswerOptimizationOpen] = useState(false);
  const [answerOptimizationTarget, setAnswerOptimizationTarget] =
    useState<AnswerOptimizationDialogTarget | null>(null);

  const messages = threadDetail?.messages || [];
  const selectedSkill =
    (selectedSkillId
      ? selectedPackage?.snapshot.skills.find(
          (s) => (s.id || s.dirName) === selectedSkillId,
        )
      : null) ||
    selectedPackage?.snapshot.skills[0] ||
    null;
  const selectedSkillRecord =
    packageSkills.find((skill) => skill.skillUid === selectedSkillId) ||
    (selectedSkill
      ? packageSkills.find(
          (skill) => skill.skillUid === (selectedSkill.id || selectedSkill.dirName),
        )
      : null) ||
    packageSkills[0] ||
    null;
  const selectedSkillVersion =
    skillVersions.find((version) => version.id === selectedSkillVersionId) ||
    skillVersions.find((version) => version.id === skillVersionsCurrentId) ||
    skillVersions[0] ||
    null;
  // 计算"被回退跳过"的版本 id：skillVersions 已按 versionNumber 降序返回，
  // 取第一个 status === 'active' 且非当前的版本——它比当前版本更新，却被回退操作跳过
  const rolledBackSkippedSkillVersionId = skillVersions.find(
    (version) =>
      version.status === 'active' &&
      version.id !== skillVersionsCurrentId,
  )?.id || '';
  const currentPackageVersionId =
    versions.find(
      (version) => version.versionNumber === selectedPackage?.versionNumber,
    )?.id || '';
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // 重建场景：预选当前 Skill Arena 线程的左右 Skill，并优先使用最新版本
  const [creatorInitialLeft, setCreatorInitialLeft] = useState('');
  const [creatorInitialRight, setCreatorInitialRight] = useState('');
  const [creatorPreferLatest, setCreatorPreferLatest] = useState(false);
  const arenaThreadList = useArenaThreadList({
    token: token || '',
    packageId: selectedPackageId,
    onThreadSwitched: (nextThread, nextDetail) => {
      setThread(nextThread);
      setThreadDetail(nextDetail);
      setReport(null);
      setCenterPreview((prev) => (prev?.type === 'report' ? null : prev));
      setArenaMode('compare');
      setStatus('');
    },
  });
  // 当 openPackage 拉取到当前 thread 时，同步给 arenaThreadList
  useEffect(() => {
    if (thread?.id) {
      arenaThreadList.setCurrentThreadId(String(thread.id));
    }
  }, [thread?.id, arenaThreadList]);
  const arenaSideLabels = getArenaSideLabels(
    thread,
    selectedPackage?.name,
    report,
  );
  const isSkillArenaThread = thread?.arenaKind === 'skill_arena';
  // Skill Arena 线程的版本绑定信息：用于显示绑定版本号
  const skillVersionInfo = isSkillArenaThread
    ? threadDetail?.skillVersionInfo ?? null
    : null;
  const rubricText = selectedPackage?.snapshot.rubricMd || '';
  const rubricDisplayText = extractDisplayRubricContent(rubricText);
  const rubricPreviewContent = rubricText.trim() || rubricDisplayText;
  const rubricHasContent = hasRubricContent(rubricText);
  const rubricConfigured = isRubricUsable(rubricText);
  const rubricNeedsRepair = rubricHasContent && !rubricConfigured;
  const replyGenerating = Boolean(
    thread?.id && replyGeneratingThreadIds.has(thread.id),
  );
  const reportReadiness = getReportReadiness(
    messages,
    rubricConfigured,
    replyGenerating,
  );
  const canGenerateReport = reportReadiness.canGenerateReport;
  const canOpenReport = canOpenReportAction(
    Boolean(thread),
    canGenerateReport,
  );
  const reportHintMessage = rubricNeedsRepair
    ? '当前 rubric 还缺少完整评分结构。请先在右侧 Rubric 中补充维度、权重或等级说明。'
    : '当前还没有配置 rubric。请先在右侧 Rubric 中手动填写评分规则。';
  const rubricRequiredMessage = rubricNeedsRepair
    ? '当前 rubric 还缺少完整评分结构。请先在右侧 Rubric 中补充维度、权重或等级说明。'
    : '当前还没有配置 rubric。请先在右侧 Rubric 中手动填写评分规则。';
  const reportRequiredMessage =
    reportReadiness.reason === 'generating_reply'
      ? '回复还在保存，请等当前回答完全结束后再生成评估报告。'
      : reportReadiness.reason === 'missing_messages'
      ? '\u5f53\u524d\u8fd8\u6ca1\u6709\u53ef\u7528\u4e8e\u8bc4\u5206\u7684 Arena \u5bf9\u8bdd\u3002\u5148\u5b8c\u6210\u4e00\u8f6e\u5bf9\u8bdd\uff0c\u518d\u6765\u751f\u6210\u8bc4\u4f30\u62a5\u544a\u3002'
      : rubricRequiredMessage;
  const interactiveRequiredMessage = replyGenerating
    ? '回复还在保存，请等当前回答完全结束后再使用交互式优化。'
    : rubricRequiredMessage;
  const interactiveActionTitle =
    !thread || !rubricConfigured || replyGenerating
      ? interactiveRequiredMessage
      : '开始交互式优化';
  const manualRubricHint =
    manualEdit?.target === 'rubric'
      ? getRubricEditValidationError(manualEdit.content)
      : '';
  const showGeneratePreviews =
    progress?.active && progress.title === '\u751f\u6210\u667a\u80fd\u4f53';
  const sidebarStyle = { '--sidebar-width': `${leftWidth}px` } as CSSProperties;
  const detailStyle = {
    '--detail-width': `${rightWidth}px`,
  } as CSSProperties;

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)');
    const syncLayout = () => {
      const wide = media.matches;
      setIsWideLayout(wide);
      if (!wide) {
        setSidebarOpen(false);
        setRightExpanded(false);
      }
    };
    syncLayout();
    media.addEventListener('change', syncLayout);
    return () => media.removeEventListener('change', syncLayout);
  }, []);
  useEffect(() => {
    if (selectedPackage?.snapshot.skills.length) {
      const firstSkill =
        selectedPackage.snapshot.skills[0]?.id ||
        selectedPackage.snapshot.skills[0]?.dirName ||
        '';
      setSelectedSkillId((current) => current || firstSkill);
      return;
    }
    setSelectedSkillId('');
  }, [selectedPackage]);
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [interactiveMessages, interactivePhase]);
  // Persist / restore interactive optimization state per package
  const interactiveStorageKey = (packageId: string) =>
    `interactive-opt-${packageId}`;

  function saveInteractiveState(
    packageId: string,
    messages: typeof interactiveMessages,
    adopted: typeof interactiveAdopted,
    issues: typeof interactiveIssues,
  ) {
    localStorage.setItem(
      interactiveStorageKey(packageId),
      JSON.stringify({ messages, adopted, issues }),
    );
  }

  const applyInteractiveSession = useCallback(
    (session: InteractiveOptimizationSession | null, openPanel = false) => {
      if (!session) {
        setInteractiveSessionId('');
        setInteractiveMessages([]);
        setInteractiveAdopted([]);
        setInteractiveIssues([]);
        setHasSavedSession(false);
        if (openPanel) setInteractiveMode(false);
        return;
      }
      setInteractiveSessionId(session.id);
      setInteractiveMessages(session.messages || []);
      setInteractiveAdopted(session.adoptedChanges || []);
      setInteractiveIssues(session.issues || []);
      setHasSavedSession((session.messages || []).length > 0);
      if (openPanel) {
        setInteractiveMode(true);
        setInteractiveView('chat');
      }
    },
    [],
  );

  const loadInteractiveSessions = useCallback(
    async (packageId: string, openLatest = false) => {
      if (!token || !packageId) return;
      try {
        const sessions = await liteApi.listInteractiveSessions(
          token,
          packageId,
        );
        setInteractiveSessions(sessions);
        const latestActive =
          sessions.find((session) => session.status === 'active') ||
          sessions[0] ||
          null;
        if (latestActive) {
          applyInteractiveSession(latestActive, openLatest);
        } else {
          applyInteractiveSession(null, false);
        }
      } catch {
        setInteractiveSessions([]);
        applyInteractiveSession(null, false);
      }
    },
    [applyInteractiveSession, token],
  );

  const loadSkillVersions = useCallback(
    async (
      packageId: string,
      skillRecordId: string,
      preferredVersionId?: string,
    ) => {
      if (!token || !packageId || !skillRecordId) return;
      const requestId = skillVersionsRequestIdRef.current + 1;
      skillVersionsRequestIdRef.current = requestId;
      setSkillVersionsLoading(true);
      setSkillVersionsError('');
      try {
        const result = await liteApi.listSkillVersions(
          token,
          packageId,
          skillRecordId,
          {
            includeDiscarded: showDiscardedSkillVersions,
          },
        );
        if (
          skillVersionsRequestIdRef.current !== requestId ||
          selectedPackageIdRef.current !== packageId
        ) {
          return;
        }
        setSkillVersions(result.items);
        setSkillVersionsCurrentId(result.currentVersionId || '');
        setSelectedSkillVersionId((prev) => {
          if (
            preferredVersionId &&
            result.items.some((item) => item.id === preferredVersionId)
          ) {
            return preferredVersionId;
          }
          if (prev && result.items.some((item) => item.id === prev)) {
            return prev;
          }
          if (
            result.currentVersionId &&
            result.items.some((item) => item.id === result.currentVersionId)
          ) {
            return result.currentVersionId;
          }
          return result.items[0]?.id || '';
        });
      } catch (error) {
        if (
          skillVersionsRequestIdRef.current !== requestId ||
          selectedPackageIdRef.current !== packageId
        ) {
          return;
        }
        setSkillVersions([]);
        setSkillVersionsCurrentId('');
        setSelectedSkillVersionId('');
        setSkillVersionsError(
          error instanceof Error ? error.message : '加载 Skill 历史失败',
        );
      } finally {
        if (skillVersionsRequestIdRef.current === requestId) {
          setSkillVersionsLoading(false);
        }
      }
    },
    [showDiscardedSkillVersions, token],
  );

  const openPackage = useCallback(
    async (packageId: string, snapshotList?: AgentPackageSummary[]) => {
      if (!token || !packageId) return;
      selectedPackageIdRef.current = packageId;
      setSelectedPackageId(packageId);
      const [detail, versionList, skillList, threads] = await Promise.all([
        liteApi.getPackage(token, packageId),
        liteApi.listVersions(token, packageId),
        liteApi.listPackageSkills(token, packageId, true),
        liteApi.listThreads(token, packageId),
      ]);
      const activeThread =
        threads[0] || (await liteApi.createThread(token, packageId));
      const activeDetail = await liteApi.getThread(token, activeThread.id);
      if (selectedPackageIdRef.current === packageId) {
        setSelectedPackage(detail);
        setVersions(versionList);
        setPackageSkills(skillList);
        setThread(activeThread);
        setThreadDetail(activeDetail);
        setReport(null);
        setOptimization(null);
        setDetailTab(getDefaultDetailTab());
        setSideStreaming({ baseline: false, enhanced: false });
      }
      if (!snapshotList) {
        setPackages((prev) =>
          prev.map((item) =>
            item.id === packageId
              ? {
                  ...item,
                  name: detail.name,
                  description: detail.description,
                  versionNumber: detail.versionNumber,
                  updatedAt: detail.updatedAt,
                }
              : item,
          ),
        );
      }
    },
    [token],
  );

  const refreshPackages = useCallback(
    async (preferredPackageId?: string) => {
      if (!token) return;
      const list = await liteApi.listPackages(token);
      setPackages(list);
      const currentPackageId =
        selectedPackageIdRef.current || selectedPackageId;
      const preferredExists =
        preferredPackageId &&
        list.some((item) => item.id === preferredPackageId);
      const selectedExists =
        currentPackageId && list.some((item) => item.id === currentPackageId);
      const nextId =
        (preferredExists && preferredPackageId) ||
        (selectedExists && currentPackageId) ||
        list[0]?.id ||
        '';
      if (nextId) {
        if (nextId !== currentPackageId) {
          await openPackage(nextId, list);
        } else {
          const [detail, versionList, skillList] = await Promise.all([
            liteApi.getPackage(token, nextId),
            liteApi.listVersions(token, nextId),
            liteApi.listPackageSkills(token, nextId, true),
          ]);
          if (selectedPackageIdRef.current === nextId) {
            setSelectedPackage(detail);
            setVersions(versionList);
            setPackageSkills(skillList);
            setPackages((prev) =>
              prev.map((item) =>
                item.id === nextId
                  ? {
                      ...item,
                      name: detail.name,
                      description: detail.description,
                      versionNumber: detail.versionNumber,
                      updatedAt: detail.updatedAt,
                    }
                  : item,
              ),
            );
          }
        }
      } else {
        clearWorkspaceState();
      }
    },
    [openPackage, selectedPackageId, token],
  );

  useEffect(() => {
    const preserveGenerateProgress = preserveGenerateProgressRef.current;
    const switchDecision = getPackageSwitchDecision({
      hasActiveProgress: progressActiveRef.current,
      preserveGenerateProgress,
    });
    preserveGenerateProgressRef.current = false;
    if (switchDecision.clearCenterPreview) {
      setCenterPreview(null);
    }
    setManualEdit(null);
    setAnswerOptimizationOpen(false);
    setAnswerOptimizationTarget(null);
    setInteractiveInput('');
    setInteractivePhase('idle');
    if (switchDecision.clearProgress) {
      setProgress(null);
      setStatus('');
    }
    if (switchDecision.clearGeneratePreviews) {
      setGeneratePreviews([]);
    }
    if (switchDecision.clearSideStreaming) {
      setSideStreaming({ baseline: false, enhanced: false });
    }

    if (!selectedPackageId) {
      skillVersionsRequestIdRef.current += 1;
      setInteractiveMode(false);
      setHasSavedSession(false);
      setInteractiveSessionId('');
      setInteractiveSessions([]);
      setInteractiveMessages([]);
      setInteractiveAdopted([]);
      setInteractiveIssues([]);
      setInteractiveView('chat');
      setPackageSkills([]);
      setSkillVersions([]);
      setSkillVersionsCurrentId('');
      setSelectedSkillVersionId('');
      setSkillVersionsLoading(false);
      setSkillVersionsError('');
      return;
    }
    setInteractiveMode(false);
    setHasSavedSession(false);
    setInteractiveSessionId('');
    setInteractiveSessions([]);
    setInteractiveMessages([]);
    setInteractiveAdopted([]);
    setInteractiveIssues([]);
    setInteractiveView('chat');
    void loadInteractiveSessions(selectedPackageId, false);
  }, [loadInteractiveSessions, selectedPackageId, token]);

  useEffect(() => {
    const nextSelectedSkillId =
      (selectedSkillId &&
      packageSkills.some((skill) => skill.skillUid === selectedSkillId)
        ? selectedSkillId
        : '') ||
      selectedPackage?.snapshot.skills[0]?.id ||
      packageSkills.find((skill) => skill.status === 'active')?.skillUid ||
      packageSkills[0]?.skillUid ||
      '';
    if (nextSelectedSkillId !== selectedSkillId) {
      setSelectedSkillId(nextSelectedSkillId);
    }
  }, [packageSkills, selectedPackage?.snapshot.skills, selectedSkillId]);

  useEffect(() => {
    if (!selectedPackageId || !selectedSkillRecord?.id) {
      skillVersionsRequestIdRef.current += 1;
      setSkillVersions([]);
      setSkillVersionsCurrentId('');
      setSelectedSkillVersionId('');
      setSkillVersionsLoading(false);
      setSkillVersionsError('');
      return;
    }
    void loadSkillVersions(selectedPackageId, selectedSkillRecord.id);
  }, [
    loadSkillVersions,
    selectedPackageId,
    selectedSkillRecord?.id,
    showDiscardedSkillVersions,
  ]);

  useEffect(() => {
    if (!token) return;
    void refreshPackages();
  }, [refreshPackages, token]);

  const reportStorageKey = (threadId: string) => `arena-report-${threadId}`;

  function clearStoredReport(threadId: string) {
    localStorage.removeItem(reportStorageKey(threadId));
  }

  useEffect(() => {
    if (!thread?.id) {
      setReport(null);
      return;
    }
    const saved = localStorage.getItem(reportStorageKey(thread.id));
    if (saved) {
      const parsed = parseStoredArenaReport(saved);
      if (parsed) {
        setReport(parsed);
      } else {
        localStorage.removeItem(reportStorageKey(thread.id));
        setReport(null);
      }
    } else {
      setReport(null);
    }
  }, [thread?.id]);

  useEffect(() => {
    if (!thread?.id || !report) return;
    localStorage.setItem(reportStorageKey(thread.id), JSON.stringify(report));
  }, [report, thread?.id]);

  // Persist / restore optimization result per package
  const optimizationStorageKey = (packageId: string) =>
    `arena-optimization-${packageId}`;

  useEffect(() => {
    if (!selectedPackageId) {
      setOptimization(null);
      return;
    }
    const saved = localStorage.getItem(
      optimizationStorageKey(selectedPackageId),
    );
    if (saved) {
      try {
        setOptimization(JSON.parse(saved));
      } catch {
        setOptimization(null);
      }
    } else {
      setOptimization(null);
    }
  }, [selectedPackageId]);

  // Persist / restore version compare state per package
  const compareStorageKey = (packageId: string) => `arena-compare-${packageId}`;

  useEffect(() => {
    if (!selectedPackageId) {
      setCompareResult(null);
      setCompareBaseId('');
      setCompareTargetId('');
      return;
    }
    const saved = localStorage.getItem(compareStorageKey(selectedPackageId));
    if (saved) {
      try {
        const data = JSON.parse(saved);
        setCompareResult(data.result || null);
        setCompareBaseId(data.baseId || '');
        setCompareTargetId(data.targetId || '');
      } catch {
        setCompareResult(null);
        setCompareBaseId('');
        setCompareTargetId('');
      }
    } else {
      setCompareResult(null);
      setCompareBaseId('');
      setCompareTargetId('');
    }
  }, [selectedPackageId]);

  // compare save helper
  function saveCompareState(
    packageId: string,
    result: VersionCompareResult | null,
    baseId: string,
    targetId: string,
  ) {
    localStorage.setItem(
      compareStorageKey(packageId),
      JSON.stringify({ result, baseId, targetId }),
    );
  }

  function startProgress(title: string, phase: string) {
    setProgress(startProgressState(title, phase));
  }
  function pushProgress(label: string) {
    setProgress((prev) => pushProgressStep(prev, label));
  }
  function finishProgress(label: string) {
    setProgress((prev) => completeProgress(prev, label));
  }
  function failProgress(label: string) {
    setProgress((prev) => failProgressState(prev, label));
  }
  function formatElapsed(ms: number) {
    const total = Math.max(0, Math.floor(ms / 1000));
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }

  function clearWorkspaceState() {
    skillVersionsRequestIdRef.current += 1;
    selectedPackageIdRef.current = '';
    setSelectedPackageId('');
    setSelectedPackage(null);
    setThread(null);
    setThreadDetail(null);
    setVersions([]);
    setPackageSkills([]);
    setReport(null);
    setOptimization(null);
    setCompareResult(null);
    setCompareBaseId('');
    setCompareTargetId('');
    setSelectedSkillId('');
    setSkillVersions([]);
    setSkillVersionsCurrentId('');
    setSelectedSkillVersionId('');
    setSkillVersionsLoading(false);
    setSkillVersionsError('');
    setCenterPreview(null);
    setManualEdit(null);
    setInteractiveMode(false);
    setInteractiveSessionId('');
    setInteractiveSessions([]);
    setInteractiveView('chat');
    setInteractiveMessages([]);
    setInteractiveAdopted([]);
    setInteractiveIssues([]);
    setInput('');
    setSideStreaming({ baseline: false, enhanced: false });
    setRightExpanded(false);
    setAnswerOptimizationOpen(false);
    setAnswerOptimizationTarget(null);
  }

  const refreshAnswerOptimizationSummaries = useCallback(
    async (enhancedAnswerMessageId: number) => {
      const currentThread = threadRef.current;
      if (!token || !currentThread?.id) return null;
      const nextDetail = await liteApi.getThread(
        token,
        String(currentThread.id),
      );
      if (threadRef.current?.id === currentThread.id) {
        setThreadDetail(nextDetail);
      }
      return (
        nextDetail.answerOptimizations.find(
          (summary) =>
            summary.enhancedAnswerMessageId === enhancedAnswerMessageId,
        ) || null
      );
    },
    [token],
  );

  const handleAnswerOptimizationConfirmed = useCallback(
    async (result: ConfirmAnswerOptimizationResult) => {
      const packageId = selectedPackageIdRef.current;
      const currentThread = threadRef.current;
      if (!token || !packageId || !currentThread?.id) return;
      const [packageDetail, versionList, nextThreadDetail] = await Promise.all([
        liteApi.getPackage(token, packageId),
        liteApi.listVersions(token, packageId),
        liteApi.getThread(token, String(currentThread.id)),
      ]);
      if (selectedPackageIdRef.current !== packageId) return;
      setSelectedPackage(packageDetail);
      setVersions(versionList);
      if (threadRef.current?.id === currentThread.id) {
        setThreadDetail(nextThreadDetail);
      }
      setPackages((previous) =>
        previous.map((item) =>
          item.id === packageDetail.id
            ? {
                ...item,
                name: packageDetail.name,
                description: packageDetail.description,
                versionNumber: result.versionNumber,
                updatedAt: packageDetail.updatedAt,
              }
            : item,
        ),
      );
    },
    [token],
  );

  function openAnswerOptimization(input: {
    question: ArenaMessage;
    baseline: ArenaMessage | null;
    enhanced: ArenaMessage;
    summary: ArenaAnswerOptimizationSummary;
  }) {
    if (
      !selectedPackage ||
      !thread ||
      typeof input.enhanced.id !== 'number' ||
      !input.summary.canOptimize ||
      input.summary.action === 'unavailable' ||
      input.summary.action === 'completed'
    ) {
      return;
    }
    setAnswerOptimizationTarget({
      packageId: Number(selectedPackage.id),
      threadId: Number(thread.id),
      questionMessageId: Number(input.question.id),
      enhancedAnswerMessageId: input.enhanced.id,
      baselineAnswerMessageId:
        input.baseline && typeof input.baseline.id === 'number'
          ? input.baseline.id
          : null,
      feedback: '',
      optimizationId:
        input.summary.action === 'resume'
          ? input.summary.optimizationId
          : null,
      completedVersionNumber: input.summary.versionNumber,
      questionContent: input.question.content,
      answerContent: input.enhanced.content,
    });
    setAnswerOptimizationOpen(true);
  }

  function startResizeLeft(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = leftWidth;
    function onMove(moveEvent: MouseEvent) {
      const delta = moveEvent.clientX - startX;
      setLeftWidth(Math.max(180, Math.min(400, startWidth + delta)));
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function startResizeRight(e: React.MouseEvent) {
    e.preventDefault();
    if (rightExpanded) return;
    const startX = e.clientX;
    const startWidth = rightWidth;
    function onMove(moveEvent: MouseEvent) {
      const delta = startX - moveEvent.clientX;
      setRightWidth(Math.max(280, Math.min(1100, startWidth + delta)));
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function updateBatchRun(id: string, patch: Partial<BatchGenerateItem>) {
    setBatchRuns((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  async function reloadPackageList() {
    if (!token) return;
    const list = await liteApi.listPackages(token);
    setPackages(list);
  }

  async function handleDocFiles(fileList: FileList | null) {
    if (!fileList) return;
    const files = Array.from(fileList);
    const results: Array<{ name: string; content: string }> = [];
    for (const file of files) {
      try {
        results.push(await readTextDocument(file));
      } catch (error) {
        setStatus(
          `${file.name} \u8bfb\u53d6\u5931\u8d25\uff1a${error instanceof Error ? error.message : '\u4e0d\u652f\u6301\u7684\u6587\u6863\u683c\u5f0f'}`,
        );
      }
    }
    if (results.length > 0) {
      setDocuments((prev) => [...prev, ...results]);
      setStatus(`\u5df2\u6dfb\u52a0 ${results.length} \u4e2a\u6587\u6863`);
    }
  }

  async function handleGeneratePackages() {
    if ((!instruction.trim() && documents.length === 0) || !token) return;
    const instructionText = instruction.trim();
    const jobDocuments = documents.length > 0 ? documents : [];
    const batchMode = jobDocuments.length > 1;
    const batchPlan = batchMode
      ? jobDocuments.map((doc, index) => ({
          id: `${Date.now()}-${index}-${doc.name}`,
          name: doc.name,
          status: 'waiting' as const,
        }))
      : [];

    setBatchRuns(batchPlan);
    startProgress(
      '\u751f\u6210\u667a\u80fd\u4f53',
      batchMode
        ? `\u6b63\u5728\u5e76\u53d1\u5904\u7406 ${jobDocuments.length} \u4e2a\u6587\u6863\uff0c\u6700\u591a\u540c\u65f6 ${BATCH_GENERATE_CONCURRENCY} \u4e2a...`
        : '\u6b63\u5728\u751f\u6210\u667a\u80fd\u4f53...',
    );
    setStatus(
      batchMode
        ? `\u6b63\u5728\u5e76\u53d1\u5904\u7406 ${jobDocuments.length} \u4e2a\u6587\u6863\uff0c\u6700\u591a\u540c\u65f6 ${BATCH_GENERATE_CONCURRENCY} \u4e2a...`
        : '\u6b63\u5728\u751f\u6210\u667a\u80fd\u4f53...',
    );
    setGeneratePreviews([]);

    try {
      const runGenerateJob = async (
        docs: Array<{ name: string; content: string }>,
        showPreview = true,
      ) => {
        let createdId = '';
        let createdName = '';
        if (showPreview) setGeneratePreviews([]);
        await liteApi.generatePackageStream(
          token,
          instructionText,
          undefined,
          docs,
          (event) => {
            if (event.event === 'phase') {
              if (showPreview) {
                pushProgress(event.data.label);
                setStatus(event.data.label);
              }
            }
            if (showPreview && event.event === 'preview_delta') {
              setGeneratePreviews((prev) =>
                appendPackagePreviewDelta(prev, event.data),
              );
            }
            if (showPreview && event.event === 'preview') {
              setGeneratePreviews((prev) =>
                upsertPackagePreview(prev, event.data),
              );
            }
            if (event.event === 'done') {
              createdId = event.data.id;
              createdName = event.data.name;
            }
            if (event.event === 'error')
              throw new Error(event.data.error || '生成失败');
          },
        );
        return { createdId, createdName };
      };

      if (batchMode) {
        let successCount = 0;
        let failureCount = 0;
        let nextBatchIndex = 0;

        const runBatchWorker = async () => {
          while (true) {
            const index = nextBatchIndex;
            nextBatchIndex += 1;
            if (index >= batchPlan.length) return;

            const item = batchPlan[index]!;
            const sourceDoc = jobDocuments[index]!;
            updateBatchRun(item.id, { status: 'running' });
            setStatus(`正在生成 ${sourceDoc.name}...`);
            try {
              const result = await runGenerateJob([sourceDoc], false);
              if (result.createdId) {
                successCount += 1;
                updateBatchRun(item.id, {
                  status: 'done',
                  packageId: result.createdId,
                  packageName: result.createdName || sourceDoc.name,
                });
              } else {
                failureCount += 1;
                updateBatchRun(item.id, {
                  status: 'error',
                  error: '未生成出结果',
                });
              }
            } catch (error) {
              failureCount += 1;
              updateBatchRun(item.id, {
                status: 'error',
                error: error instanceof Error ? error.message : '生成失败',
              });
            }
          }
        };

        const workers = Array.from(
          {
            length: Math.min(BATCH_GENERATE_CONCURRENCY, batchPlan.length),
          },
          () => runBatchWorker(),
        );
        await Promise.all(workers);
        await reloadPackageList();
        if (failureCount === 0) {
          setInstruction('');
          setDocuments([]);
        }
        const doneLabel = `\u6279\u91cf\u751f\u6210\u5b8c\u6210\uff0c\u6210\u529f ${successCount} \u4e2a\uff0c\u5931\u8d25 ${failureCount} \u4e2a`;
        setGeneratePreviews([]);
        if (failureCount > 0 && successCount === 0) failProgress(doneLabel);
        else finishProgress(doneLabel);
        setStatus(doneLabel);
        return;
      }
      const { createdId, createdName } = await runGenerateJob(jobDocuments);
      const finalPackageName = createdName;
      if (createdId) {
        preserveGenerateProgressRef.current = true;
        setInstruction('');
        setDocuments([]);
        await refreshPackages(createdId);
      }
      const doneLabel = finalPackageName
        ? `\u751f\u6210\u5b8c\u6210\uff1a${finalPackageName}`
        : '\u751f\u6210\u5b8c\u6210\uff0c\u5df2\u6253\u5f00\u65b0\u667a\u80fd\u4f53';
      setGeneratePreviews([]);
      finishProgress(doneLabel);
      setStatus(doneLabel);
    } catch (error) {
      const message = error instanceof Error ? error.message : '生成失败';
      setGeneratePreviews([]);
      failProgress(message);
      setStatus(message);
    }
  }

  async function handleImport(file: File) {
    if (!token) return;
    startProgress('导入 ZIP', '正在导入...');
    setStatus('正在导入...');
    try {
      const created = await liteApi.importPackage(token, file);
      await refreshPackages(created.id);
      finishProgress('导入成功');
      setStatus('导入成功');
    } catch (error) {
      const message = error instanceof Error ? error.message : '导入失败';
      failProgress(message);
      setStatus(message);
    }
  }

  async function handleReport() {
    if (!token || !thread?.id) return;
    if (!canGenerateReport) {
      setDetailTab('report');
      setStatus(reportRequiredMessage);
      failProgress(reportRequiredMessage);
      return;
    }
    const currentThreadId = thread.id;
    startProgress('评估报告', '正在生成报告...');
    setStatus('正在生成报告...');
    try {
      let nextReport: ArenaReport | null = null;
      await liteApi.generateReportStream(
        token,
        currentThreadId,
        undefined,
        (event) => {
          if (event.event === 'phase') {
            pushProgress(event.data.label);
            setStatus(event.data.label);
            return;
          }
          if (event.event === 'done') {
            nextReport = event.data;
            return;
          }
          if (event.event === 'error') {
            throw new Error(event.data.error || '评估失败');
          }
        },
      );
      if (nextReport) {
        if (!isArenaReport(nextReport)) {
          throw new Error('\u62a5\u544a\u6570\u636e\u7ed3\u6784\u5f02\u5e38\uff0c\u8bf7\u91cd\u8bd5');
        }
        localStorage.setItem(
          reportStorageKey(currentThreadId),
          JSON.stringify(nextReport),
        );
        const isCurrentThreadSelected =
          threadRef.current?.id === currentThreadId;
        if (isCurrentThreadSelected) {
          const nextViewState = buildGeneratedReportViewState(nextReport);
          setReport(nextReport);
          setDetailTab(nextViewState.detailTab);
          setCenterPreview(nextViewState.centerPreview);
        }
        finishProgress('\u62a5\u544a\u5df2\u751f\u6210');
        setStatus(buildReportCompletionStatusMessage(isCurrentThreadSelected));
        return;
      }
      finishProgress('\u62a5\u544a\u5df2\u751f\u6210');
      setStatus('\u62a5\u544a\u5df2\u751f\u6210');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '\u8bc4\u4f30\u5931\u8d25';
      failProgress(message);
      setStatus(message);
    }
  }

  async function handleSend() {
    if (!token || !thread?.id || !input.trim() || !threadDetail) return;
    const currentThreadId = thread.id;
    const prompt = input.trim();
    const tempSharedId = `temp-shared-${Date.now()}`;
    const tempBaselineId = `temp-baseline-${Date.now()}`;
    const tempEnhancedId = `temp-enhanced-${Date.now()}`;
    const now = new Date().toISOString();
    const tempShared: ArenaMessage = {
      id: tempSharedId,
      threadId: currentThreadId,
      side: 'shared',
      role: 'user',
      content: prompt,
      createdAt: now,
    };
    const tempBaseline: ArenaMessage = {
      id: tempBaselineId,
      threadId: currentThreadId,
      side: 'baseline',
      role: 'assistant',
      content: '',
      createdAt: now,
    };
    const tempEnhanced: ArenaMessage = {
      id: tempEnhancedId,
      threadId: currentThreadId,
      side: 'enhanced',
      role: 'assistant',
      content: '',
      createdAt: now,
    };
    const shouldShowBaseline =
      arenaMode === 'compare' || arenaMode === 'baseline';
    const shouldShowEnhanced = arenaMode === 'compare' || arenaMode === 'agent';
    const tempMessages = [
      tempShared,
      ...(shouldShowBaseline ? [tempBaseline] : []),
      ...(shouldShowEnhanced ? [tempEnhanced] : []),
    ];
    function isCurrentReplyThread() {
      return threadRef.current?.id === currentThreadId;
    }
    function clearReplyGeneratingThread() {
      setReplyGeneratingThreadIds((prev) => {
        const next = new Set(prev);
        next.delete(currentThreadId);
        return next;
      });
    }

    clearStoredReport(currentThreadId);
    setReport(null);
    setCenterPreview((prev) => (prev?.type === 'report' ? null : prev));
    setInput('');
    setOptimization(null);
    setProgress((prev) => (prev?.active ? prev : null));
    setReplyGeneratingThreadIds((prev) => {
      const next = new Set(prev);
      next.add(currentThreadId);
      return next;
    });
    flushSync(() => {
      setThreadDetail({
        ...threadDetail,
        messages: [...threadDetail.messages, ...tempMessages],
      });
    });
    setSideStreaming({
      baseline: shouldShowBaseline,
      enhanced: shouldShowEnhanced,
    });
    setStatus('\u6b63\u5728\u751f\u6210...');
    try {
      await liteApi.sendMessageStream(
        token,
        currentThreadId,
        prompt,
        undefined,
        arenaMode,
        false,
        (event) => {
          if (event.event === 'phase') {
            if (!isCurrentReplyThread()) return;
            setStatus(event.data.label);
            return;
          }
          if (event.event === 'shared') {
            if (!isCurrentReplyThread()) return;
            setThreadDetail((prev) =>
              prev
                ? {
                    ...prev,
                    messages: prev.messages.map((m) =>
                      m.id === tempSharedId ? event.data.message : m,
                    ),
                  }
                : prev,
            );
            return;
          }
          if (event.event === 'side_start') {
            if (!isCurrentReplyThread()) return;
            setSideStreaming((prev) => ({ ...prev, [event.data.side]: true }));
            return;
          }
          if (event.event === 'delta') {
            if (!isCurrentReplyThread()) return;
            const targetId =
              event.data.side === 'baseline' ? tempBaselineId : tempEnhancedId;
            setThreadDetail((prev) =>
              prev
                ? {
                    ...prev,
                    messages: prev.messages.map((m) =>
                      m.id === targetId
                        ? { ...m, content: `${m.content}${event.data.delta}` }
                        : m,
                    ),
                  }
                : prev,
            );
            return;
          }
          if (event.event === 'side_done') {
            if (!isCurrentReplyThread()) return;
            const targetId =
              event.data.side === 'baseline' ? tempBaselineId : tempEnhancedId;
            setSideStreaming((prev) => ({ ...prev, [event.data.side]: false }));
            setThreadDetail((prev) =>
              prev
                ? {
                    ...prev,
                    messages: prev.messages.map((m) =>
                      m.id === targetId
                        ? { ...m, content: event.data.content }
                        : m,
                    ),
                  }
                : prev,
            );
            return;
          }
          if (event.event === 'done') {
            clearReplyGeneratingThread();
            if (!isCurrentReplyThread()) return;
            setThread(event.data.thread);
            const finalMessageIds = new Set(
              event.data.messages.map((message) => message.id),
            );
            setThreadDetail((prev) =>
              prev
                ? {
                    ...prev,
                    thread: event.data.thread,
                    messages: [
                      ...prev.messages.filter(
                        (m) =>
                          ![
                            tempSharedId,
                            tempBaselineId,
                            tempEnhancedId,
                          ].includes(m.id) && !finalMessageIds.has(m.id),
                      ),
                      ...event.data.messages,
                    ],
                  }
                : prev,
            );
            setSideStreaming({ baseline: false, enhanced: false });
            setStatus('\u56de\u590d\u5df2\u751f\u6210');
            void liteApi
              .getThread(token, String(currentThreadId))
              .then((savedDetail) => {
                if (isCurrentReplyThread()) setThreadDetail(savedDetail);
              })
              .catch(() => undefined);
            return;
          }
          if (event.event === 'error')
            throw new Error(event.data.error || '\u53d1\u9001\u5931\u8d25');
        },
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '\u53d1\u9001\u5931\u8d25';
      clearReplyGeneratingThread();
      if (isCurrentReplyThread()) {
        setSideStreaming({ baseline: false, enhanced: false });
        setInput(prompt);
        setStatus(message);
      }
    }
  }

  async function handleDelete() {
    const deletingId = selectedPackageIdRef.current || selectedPackageId;
    const deletingThreadId = threadRef.current?.id || '';
    if (!token || !deletingId) return;
    if (!window.confirm('确定要删除当前智能体吗？')) return;
    clearWorkspaceState();
    setPackages((prev) => prev.filter((item) => item.id !== deletingId));
    try {
      await liteApi.deletePackage(token, deletingId);
    } catch (error) {
      const message = error instanceof Error ? error.message : '删除失败';
      failProgress(message);
      setStatus(message);
      await refreshPackages(deletingId);
      return;
    }
    // Clean up package-scoped localStorage data
    localStorage.removeItem(interactiveStorageKey(deletingId));
    localStorage.removeItem(optimizationStorageKey(deletingId));
    localStorage.removeItem(compareStorageKey(deletingId));
    if (deletingThreadId) clearStoredReport(deletingThreadId);
    await refreshPackages();
  }

  async function handleExport() {
    if (!token || !selectedPackageId) return;
    await liteApi.exportPackage(token, selectedPackageId);
    setStatus('\u5bfc\u51fa\u5df2\u5f00\u59cb');
  }

  async function handleRenamePackage(packageId: string, currentName: string) {
    if (!token || !packageId) return;
    const nextName = window.prompt(
      '\u8bf7\u8f93\u5165\u65b0\u7684\u667a\u80fd\u4f53\u540d\u79f0\uff1a',
      currentName,
    );
    if (nextName === null) return;
    const trimmed = nextName.trim();
    if (!trimmed || trimmed === currentName) return;
    try {
      const detail = await liteApi.renamePackage(token, packageId, trimmed);
      setPackages((prev) =>
        prev.map((item) =>
          item.id === packageId
            ? {
                ...item,
                name: detail.name,
                description: detail.description,
                versionNumber: detail.versionNumber,
                updatedAt: detail.updatedAt,
              }
            : item,
        ),
      );
      if (selectedPackageIdRef.current === packageId) {
        setSelectedPackage(detail);
      }
      setStatus('\u540d\u79f0\u5df2\u66f4\u65b0');
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : '\u91cd\u547d\u540d\u5931\u8d25';
      failProgress(message);
      setStatus(message);
    }
  }

  function startManualEditAgent() {
    if (!selectedPackage) return;
    setInteractiveMode(false);
    setRightExpanded(false);
    setCenterPreview(null);
    setManualEdit({
      target: 'agent',
      title: 'agent.md',
      content: selectedPackage.snapshot.agentMd,
      preview: false,
    });
  }

  function startManualEditSkill() {
    if (!selectedSkill) return;
    setInteractiveMode(false);
    setRightExpanded(false);
    setCenterPreview(null);
    setManualEdit({
      target: 'skill',
      skillId: selectedSkill.id || selectedSkill.dirName,
      title: `${selectedSkill.name} / SKILL.md`,
      content: selectedSkill.skillMd,
      preview: false,
    });
  }

  function startManualEditRubric(seedContent?: string) {
    setInteractiveMode(false);
    setRightExpanded(false);
    setCenterPreview(null);
    setManualEdit({
      target: 'rubric',
      title: '手动编辑 rubric.md',
      content: buildRubricDraft(
        resolveRubricManualEditContent({
          seedContent,
          storedRubric: selectedPackage?.snapshot.rubricMd || '',
          displayRubric: rubricDisplayText,
          fallbackTemplate: RUBRIC_TEMPLATE,
        }),
      ),
      preview: false,
    });
  }

  async function handleRubricFiles(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file || !token || !selectedPackageId) return;
    try {
      const parsed = await readTextDocument(file);
      startProgress('导入 rubric', `正在保存 ${parsed.name}...`);
      setDetailTab('rubric');
      setCenterPreview(null);
      setManualEdit(null);
      const imported = await liteApi.saveManualMarkdownEdit(
        token,
        selectedPackageId,
        {
          target: 'rubric',
          content: parsed.content,
          note: `导入 ${parsed.name}`,
        },
      );
      setSelectedPackage(imported);
      await refreshPackages(imported.id);
      finishProgress(`已导入 ${parsed.name}`);
      setStatus(
        isRubricUsable(parsed.content)
          ? `已导入 ${parsed.name}`
          : `已导入 ${parsed.name}，当前内容会按现有 rubric 参与评分`,
      );
      return;
    } catch (error) {
      const message = `${file.name} 读取失败：${
        error instanceof Error ? error.message : '不支持的文档格式'
      }`;
      failProgress(message);
      setStatus(message);
    }
  }

  function ensureRubricConfigured(actionLabel: string) {
    if (rubricConfigured) return true;
    setInteractiveMode(false);
    setDetailTab('rubric');
    setStatus(rubricRequiredMessage);
    failProgress(
      `${actionLabel}不可用：${rubricNeedsRepair ? '请先继续补充 rubric 结构' : '请先补充 rubric'}`,
    );
    return false;
  }

  function validateManualEdit(edit: ManualEditState) {
    const content = edit.content.trim();
    if (!content) return '编辑内容不能为空';
    if (edit.target === 'rubric') {
      return '';
    }
    if (edit.target === 'skill') {
      const frontmatter = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
      if (!frontmatter)
        return 'SKILL.md \u5fc5\u987b\u4fdd\u7559\u9876\u90e8\u7684 YAML frontmatter';
      if (!/^name\s*:/m.test(frontmatter[1]))
        return 'SKILL.md \u7684 YAML frontmatter \u91cc\u5fc5\u987b\u5305\u542b name';
      if (!/^description\s*:/m.test(frontmatter[1]))
        return 'SKILL.md \u7684 YAML frontmatter \u91cc\u5fc5\u987b\u5305\u542b description';
    }
    return '';
  }

  async function saveManualEdit() {
    if (!token || !selectedPackageId || !manualEdit || manualEditSaving) return;
    const error = validateManualEdit(manualEdit);
    if (error) {
      setStatus(error);
      failProgress(error);
      toast.error(error);
      return;
    }
    const note =
      manualEdit.target === 'agent'
        ? '\u624b\u52a8\u7f16\u8f91 agent.md'
        : manualEdit.target === 'rubric'
          ? '\u624b\u52a8\u7f16\u8f91 rubric.md'
          : '\u624b\u52a8\u7f16\u8f91 SKILL.md';

    setManualEditSaving(true);
    startProgress(
      '\u4fdd\u5b58\u624b\u52a8\u7f16\u8f91',
      '\u6b63\u5728\u4fdd\u5b58\u4e3a\u65b0\u7248\u672c...',
    );
    try {
      const detail = await liteApi.saveManualMarkdownEdit(
        token,
        selectedPackageId,
        {
          target: manualEdit.target,
          skillId: manualEdit.skillId,
          content: manualEdit.content.replace(/\r\n/g, '\n'),
          note,
        },
      );
      const editedSkillId = manualEdit.skillId;
      const editedTarget = manualEdit.target;
      setSelectedPackage(detail);
      await refreshPackages(detail.id);
      setManualEdit(null);
      setDetailTab('versions');
      setVersionSubTab(editedTarget === 'skill' ? 'skill' : 'package');
      if (editedTarget === 'skill' && editedSkillId) {
        const latestSkillList = await liteApi.listPackageSkills(
          token,
          selectedPackageId,
          true,
        );
        setPackageSkills(latestSkillList);
        const skillRecord = latestSkillList.find(
          (s) => s.skillUid === editedSkillId,
        );
        if (skillRecord) {
          setSelectedSkillId(editedSkillId);
          await loadSkillVersions(selectedPackageId, skillRecord.id);
        }
      }
      finishProgress(
        `\u5df2\u4fdd\u5b58\u4e3a\u65b0\u7248\u672c v${detail.versionNumber}`,
      );
      setStatus(
        `\u5df2\u4fdd\u5b58\u4e3a\u65b0\u7248\u672c v${detail.versionNumber}`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '\u4fdd\u5b58\u5931\u8d25';
      failProgress(message);
      setStatus(message);
      toast.error(message);
    } finally {
      setManualEditSaving(false);
    }
  }

  async function startInteractive(forceNew = false) {
    if (!token || !thread?.id || !selectedPackageId) return;
    if (replyGenerating || interactivePhase !== 'idle') {
      setStatus(interactiveRequiredMessage);
      return;
    }
    if (!ensureRubricConfigured('\u4ea4\u4e92\u5f0f\u4f18\u5316')) return;
    setInteractiveMode(true);
    setRightExpanded(false);
    setCenterPreview(null);
    const latestActive =
      interactiveSessions.find((session) => session.status === 'active') ||
      null;
    if (!forceNew && latestActive && latestActive.messages.length > 0) {
      applyInteractiveSession(latestActive, true);
      return;
    }
    setHasSavedSession(false);
    // Fresh start: run diagnosis with simulated progress steps
    setInteractiveSessionId('');
    setInteractivePhase('diagnosing');
    setInteractiveMessages([]);
    setInteractiveIssues([]);
    setInteractiveAdopted([]);
    startProgress(
      '\u4ea4\u4e92\u5f0f\u4f18\u5316',
      '\u6b63\u5728\u521d\u59cb\u5316\u5206\u6790...',
    );
    const stepTimers: number[] = [];
    stepTimers.push(
      window.setTimeout(
        () =>
          pushProgress(
            '\u6b63\u5728\u8bfb\u53d6\u667a\u80fd\u4f53\u5185\u5bb9...',
          ),
        600,
      ),
    );
    stepTimers.push(
      window.setTimeout(() => pushProgress('正在分析 Arena 对话轨迹...'), 1800),
    );
    stepTimers.push(
      window.setTimeout(() => pushProgress('正在识别潜在优化问题...'), 4000),
    );
    stepTimers.push(
      window.setTimeout(() => pushProgress('正在生成优化建议...'), 7000),
    );
    const currentPkgId = selectedPackageId;
    try {
      const result = await liteApi.diagnosePackage(
        token,
        currentPkgId,
        thread.id,
      );
      stepTimers.forEach((id) => window.clearTimeout(id));
      const welcomeMsg = { role: 'assistant', content: result.welcomeMessage };
      saveInteractiveState(currentPkgId, [welcomeMsg], [], result.issues);
      if (result.session) {
        const newSession = result.session;
        setInteractiveSessionId(newSession.id);
        setInteractiveSessions((prev) => [
          newSession,
          ...prev.filter((session) => session.id !== newSession.id),
        ]);
      }
      if (selectedPackageIdRef.current === currentPkgId) {
        setInteractiveMode(true);
        setInteractiveIssues(result.issues);
        // Only set welcome message if UI is empty (user may have switched back and restored a longer session)
        setInteractiveMessages((prev) =>
          prev.length === 0 ? [welcomeMsg] : prev,
        );
      }
      finishProgress(
        `\u5206\u6790\u5b8c\u6210\uff0c\u53d1\u73b0 ${result.issues.length} \u4e2a\u95ee\u9898`,
      );
    } catch (error) {
      stepTimers.forEach((id) => window.clearTimeout(id));
      const message =
        error instanceof Error ? error.message : '\u8bca\u65ad\u5931\u8d25';
      const errorMsg = {
        role: 'assistant',
        content: `\u8bca\u65ad\u5931\u8d25\uff1a${message}`,
      };
      saveInteractiveState(currentPkgId, [errorMsg], [], []);
      if (selectedPackageIdRef.current === currentPkgId) {
        setInteractiveMode(true);
        setInteractiveMessages((prev) =>
          prev.length === 0 ? [errorMsg] : prev,
        );
      }
      failProgress(message);
    } finally {
      if (selectedPackageIdRef.current === currentPkgId) {
        setInteractivePhase('idle');
      }
    }
  }

  async function sendInteractiveMessage() {
    if (
      !token ||
      !selectedPackageId ||
      !interactiveInput.trim() ||
      interactivePhase !== 'idle'
    )
      return;
    const currentPkgId = selectedPackageId;
    const userMsg = interactiveInput.trim();
    setInteractiveInput('');

    // Prefer the server-backed session; localStorage only keeps older unsynced drafts alive.
    let latestMessages: typeof interactiveMessages = interactiveMessages;
    let latestAdopted: typeof interactiveAdopted = interactiveAdopted;
    let latestIssues: typeof interactiveIssues = interactiveIssues;
    const saved =
      latestMessages.length === 0
        ? localStorage.getItem(interactiveStorageKey(currentPkgId))
        : null;
    if (saved) {
      try {
        const data = JSON.parse(saved);
        if (data.messages && Array.isArray(data.messages)) {
          latestMessages = data.messages.filter(isInteractiveMessage);
        }
        if (data.adopted && Array.isArray(data.adopted)) {
          latestAdopted = data.adopted.filter(isAdoptedChangeLike);
        }
        if (data.issues && Array.isArray(data.issues)) {
          latestIssues = data.issues.filter(isDiagnosisIssueLike);
        }
      } catch {
        /* ignore corrupt data */
      }
    }

    // Build new messages with user message and update UI immediately
    const messagesWithUser = [
      ...latestMessages,
      { role: 'user', content: userMsg },
    ];
    setInteractiveMessages(messagesWithUser);
    setInteractivePhase('chatting');
    startProgress(
      '\u4ea4\u4e92\u5f0f\u4f18\u5316',
      '\u4e13\u5bb6\u6b63\u5728\u601d\u8003...',
    );

    // Save user message immediately so it's not lost if user switches packages
    saveInteractiveState(
      currentPkgId,
      messagesWithUser,
      latestAdopted,
      latestIssues,
    );

    try {
      const result = await liteApi.chatOptimize(
        token,
        currentPkgId,
        interactiveSessionId || undefined,
        messagesWithUser,
        latestAdopted,
      );

      // Build final messages with assistant reply using known array (not prev from state)
      const finalMessages = [
        ...messagesWithUser,
        { role: 'assistant', content: result.reply },
      ];
      const finalAdopted =
        result.newAdoptions.length > 0
          ? [...latestAdopted, ...result.newAdoptions]
          : latestAdopted;

      // Always save to localStorage for the original package
      saveInteractiveState(
        currentPkgId,
        finalMessages,
        finalAdopted,
        latestIssues,
      );

      if (result.session) {
        const newSession = result.session;
        setInteractiveSessionId(newSession.id);
        setInteractiveSessions((prev) => [
          newSession,
          ...prev.filter((session) => session.id !== newSession.id),
        ]);
      }

      // Only update UI if user is still on the same package
      if (selectedPackageIdRef.current === currentPkgId) {
        setInteractiveMessages(finalMessages);
        if (result.newAdoptions.length > 0) {
          setInteractiveAdopted(finalAdopted);
        }
      }
      finishProgress('\u4e13\u5bb6\u5df2\u56de\u590d');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '\u5bf9\u8bdd\u5931\u8d25';
      const errorMessages = [
        ...messagesWithUser,
        {
          role: 'assistant',
          content: `\u5bf9\u8bdd\u5931\u8d25\uff1a${message}`,
        },
      ];
      saveInteractiveState(
        currentPkgId,
        errorMessages,
        latestAdopted,
        latestIssues,
      );
      if (selectedPackageIdRef.current === currentPkgId) {
        setInteractiveMessages(errorMessages);
      }
      failProgress(message);
    } finally {
      if (selectedPackageIdRef.current === currentPkgId) {
        setInteractivePhase('idle');
      }
    }
  }

  async function saveInteractiveChanges() {
    if (!token || !selectedPackageId || interactiveAdopted.length === 0) return;
    const currentPkgId = selectedPackageId;
    const currentAdopted = interactiveAdopted;
    const note = window.prompt(
      '\u8bf7\u8f93\u5165\u65b0\u7248\u672c\u5907\u6ce8\uff08\u53ef\u9009\uff09\uff1a',
    );
    if (note === null) return; // cancelled
    startProgress(
      '\u4fdd\u5b58\u4fee\u6539',
      '\u6b63\u5728\u5e94\u7528\u4fee\u6539\u5e76\u751f\u6210\u65b0\u7248\u672c...',
    );
    try {
      const result = await liteApi.applyInteractiveChanges(
        token,
        currentPkgId,
        interactiveSessionId || undefined,
        currentAdopted,
        note,
      );
      await refreshPackages(currentPkgId);
      await loadInteractiveSessions(currentPkgId, false);
      // Clear saved interactive session
      localStorage.removeItem(interactiveStorageKey(currentPkgId));
      if (selectedPackageIdRef.current === currentPkgId) {
        setInteractiveMode(false);
        setOptimization(null);
        setDetailTab('versions');
        setVersionSubTab('package');
      }
      finishProgress(`已保存为新版本 v${result.versionNumber}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存失败';
      failProgress(message);
    }
  }

  async function handleUpdateNote(versionId: string, currentNote: string) {
    if (!token || !selectedPackageId) return;
    const note = window.prompt('请输入版本备注：', currentNote);
    if (note === null) return;
    try {
      await liteApi.updateVersionNote(
        token,
        selectedPackageId,
        versionId,
        note,
      );
      await refreshPackages(selectedPackageId);
    } catch (error) {
      alert(error instanceof Error ? error.message : '更新备注失败');
    }
  }

  function formatSkillVersionSourceLabel(source: SkillVersionDetail['source']) {
    if (source === 'generated') return '生成';
    if (source === 'imported') return '导入';
    if (source === 'optimized') return '优化';
    if (source === 'manual') return '手动';
    if (source === 'interactive') return '交互优化';
    if (source === 'rollback') return '回退';
    return source;
  }

  async function handleRollbackSkillVersion(version: SkillVersionDetail) {
    if (
      !token ||
      !selectedPackageId ||
      !selectedSkillRecord?.id ||
      !currentPackageVersionId
    ) {
      return;
    }
    if (
      !window.confirm(
        `确认回退到 Skill 历史版本 v${version.versionNumber} 吗？系统会前向创建一个新的智能体版本。`,
      )
    ) {
      return;
    }
    const note = window.prompt('请输入回退备注（可选）：', 'Skill 版本回退');
    if (note === null) return;
    const currentPkgId = selectedPackageId;
    const currentSkillId = selectedSkillRecord.id;
    const actionId = getSkillActionId('rollback', currentSkillId, version.id);
    if (skillActionPendingIdRef.current === actionId) return;
    const idempotencyKey = createClientIdempotencyKey();
    skillActionPendingIdRef.current = actionId;
    setSkillActionPendingId(actionId);
    startProgress('回退 Skill 版本', '正在创建新的智能体版本...');
    try {
      const result = await liteApi.rollbackSkillVersion(token, currentPkgId, {
        skillId: currentSkillId,
        versionId: version.id,
        expectedPackageVersionId: currentPackageVersionId,
        idempotencyKey,
        note: note.trim() || undefined,
      });
      await refreshPackages(currentPkgId);
      await loadSkillVersions(
        currentPkgId,
        currentSkillId,
        result.rolledBackSkillVersionId,
      );
      finishProgress(`已创建新版本 v${result.versionNumber}`);
      setStatus(`已回退并创建新版本 v${result.versionNumber}`);
      setDetailTab('versions');
      setVersionSubTab('skill');
    } catch (error) {
      const apiError = error instanceof LiteApiError ? error : null;
      if (apiError?.code === 'PACKAGE_VERSION_CONFLICT') {
        const message =
          '当前智能体包已被其他操作更新。页面会先刷新到最新版本，请确认后重新执行回退。';
        await refreshPackages(currentPkgId);
        await loadSkillVersions(currentPkgId, currentSkillId);
        failProgress(message);
        setStatus(message);
        return;
      }
      const message = error instanceof Error ? error.message : '回退失败';
      failProgress(message);
      setStatus(message);
    } finally {
      if (skillActionPendingIdRef.current === actionId) {
        skillActionPendingIdRef.current = '';
      }
      setSkillActionPendingId((current) =>
        current === actionId ? '' : current,
      );
    }
  }

  async function handleRollbackPackageVersion(version: PackageVersion) {
    if (!token || !selectedPackageId || !currentPackageVersionId) return;
    if (
      !window.confirm(
        `确认回退到智能体版本 v${version.versionNumber} 吗？系统会前向创建一个新的智能体版本，内容将完全替换为 v${version.versionNumber} 的快照。`,
      )
    ) {
      return;
    }
    const note = window.prompt('请输入回退备注（可选）：', '智能体版本回退');
    if (note === null) return;
    const currentPkgId = selectedPackageId;
    const actionId = `pkg-rollback:${version.id}`;
    if (packageVersionActionPendingIdRef.current === actionId) return;
    const idempotencyKey = createClientIdempotencyKey();
    packageVersionActionPendingIdRef.current = actionId;
    setPackageVersionActionPendingId(actionId);
    startProgress('回退智能体版本', '正在创建新的智能体版本...');
    try {
      const result = await liteApi.rollbackPackageVersion(
        token,
        currentPkgId,
        {
          versionId: String(version.id),
          expectedPackageVersionId: currentPackageVersionId,
          idempotencyKey,
          note: note.trim() || undefined,
        },
      );
      await refreshPackages(currentPkgId);
      finishProgress(`已回退到 v${result.rolledBackFromVersionNumber} 并创建新版本 v${result.versionNumber}`);
      setStatus(
        `已回退到 v${result.rolledBackFromVersionNumber} 并创建新版本 v${result.versionNumber}`,
      );
      setDetailTab('versions');
      setVersionSubTab('package');
    } catch (error) {
      const apiError = error instanceof LiteApiError ? error : null;
      if (apiError?.code === 'PACKAGE_VERSION_CONFLICT') {
        const message =
          '当前智能体包已被其他操作更新。页面会先刷新到最新版本，请确认后重新执行回退。';
        await refreshPackages(currentPkgId);
        failProgress(message);
        setStatus(message);
        return;
      }
      const message = error instanceof Error ? error.message : '回退失败';
      failProgress(message);
      setStatus(message);
    } finally {
      if (packageVersionActionPendingIdRef.current === actionId) {
        packageVersionActionPendingIdRef.current = '';
      }
      setPackageVersionActionPendingId((current) =>
        current === actionId ? '' : current,
      );
    }
  }

  async function handleDiscardSkillVersion(version: SkillVersionDetail) {
    if (!token || !selectedPackageId || !selectedSkillRecord?.id) return;
    const currentPkgId = selectedPackageId;
    const currentSkillId = selectedSkillRecord.id;
    const actionId = getSkillActionId('discard', currentSkillId, version.id);
    if (skillActionPendingIdRef.current === actionId) return;
    const reason = window.prompt('请输入废弃原因：', '该版本不再使用');
    if (reason === null) return;
    if (!reason.trim()) {
      setStatus('废弃原因不能为空');
      return;
    }
    skillActionPendingIdRef.current = actionId;
    setSkillActionPendingId(actionId);
    try {
      await liteApi.discardSkillVersion(
        token,
        currentPkgId,
        version.id,
        reason.trim(),
      );
      await loadSkillVersions(currentPkgId, currentSkillId, version.id);
      setStatus(`已废弃 Skill 版本 v${version.versionNumber}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '废弃失败';
      setStatus(message);
    } finally {
      if (skillActionPendingIdRef.current === actionId) {
        skillActionPendingIdRef.current = '';
      }
      setSkillActionPendingId((current) =>
        current === actionId ? '' : current,
      );
    }
  }

  async function handleUndiscardSkillVersion(version: SkillVersionDetail) {
    if (!token || !selectedPackageId || !selectedSkillRecord?.id) return;
    const currentPkgId = selectedPackageId;
    const currentSkillId = selectedSkillRecord.id;
    const actionId = getSkillActionId('undiscard', currentSkillId, version.id);
    if (skillActionPendingIdRef.current === actionId) return;
    skillActionPendingIdRef.current = actionId;
    setSkillActionPendingId(actionId);
    try {
      await liteApi.undiscardSkillVersion(token, currentPkgId, version.id);
      await loadSkillVersions(currentPkgId, currentSkillId, version.id);
      setStatus(`已恢复 Skill 版本 v${version.versionNumber}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '恢复失败';
      setStatus(message);
    } finally {
      if (skillActionPendingIdRef.current === actionId) {
        skillActionPendingIdRef.current = '';
      }
      setSkillActionPendingId((current) =>
        current === actionId ? '' : current,
      );
    }
  }

  function formatAdoptedTarget(change: AdoptedChange) {
    if (change.target === 'agent') return 'agent.md';
    if (change.target === 'rubric') return 'rubric.md';
    return change.targetName || change.targetId || 'skill.md';
  }

  function showAdoptedChangeDiff(change: AdoptedChange) {
    setInteractiveMode(false);
    setCenterPreview({
      type: 'adoptedDiff',
      name: `${formatAdoptedTarget(change)} - ${change.reason}`,
      change,
      diffs: computeLineDiff(change.original, change.modified),
    });
  }

  function getFocusedDiffRows(diffs: LineDiff[], context = 3) {
    const changedIndexes = diffs
      .map((diff, index) => (diff.type === 'same' ? -1 : index))
      .filter((index) => index >= 0);
    if (changedIndexes.length === 0) {
      return diffs.map((diff, index) => ({
        type: 'line' as const,
        diff,
        index,
      }));
    }

    const included = new Set<number>();
    for (const index of changedIndexes) {
      for (
        let i = Math.max(0, index - context);
        i <= Math.min(diffs.length - 1, index + context);
        i += 1
      ) {
        included.add(i);
      }
    }

    const rows: Array<
      { type: 'gap' } | { type: 'line'; diff: LineDiff; index: number }
    > = [];
    let previousIndex = -1;
    Array.from(included)
      .sort((a, b) => a - b)
      .forEach((index) => {
        if (previousIndex >= 0 && index > previousIndex + 1)
          rows.push({ type: 'gap' });
        rows.push({ type: 'line', diff: diffs[index]!, index });
        previousIndex = index;
      });
    return rows;
  }

  function renderAdoptedChangeDiffView(
    preview: Extract<CenterPreviewState, { type: 'adoptedDiff' }>,
  ) {
    const addedCount = preview.diffs.filter(
      (diff) => diff.type === 'added',
    ).length;
    const removedCount = preview.diffs.filter(
      (diff) => diff.type === 'removed',
    ).length;
    const rows = getFocusedDiffRows(preview.diffs);

    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-primary/15 bg-primary/5 px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-medium text-muted-foreground">
                修改位置
              </div>
              <div className="mt-0.5 text-sm font-semibold text-foreground">
                {formatAdoptedTarget(preview.change)}
              </div>
              <div className="mt-1 text-xs text-muted-foreground leading-relaxed">
                {preview.change.reason}
              </div>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <span className="rounded-full bg-emerald-50 dark:bg-emerald-950/30 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                新增 {addedCount}
              </span>
              <span className="rounded-full bg-rose-50 dark:bg-rose-950/30 px-2 py-0.5 text-[11px] font-medium text-rose-600 dark:text-rose-400">
                删除 {removedCount}
              </span>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-border/80 bg-card overflow-hidden">
          <div className="border-b border-border/60 px-4 py-2.5">
            <span className="text-sm font-medium text-foreground">修改痕迹</span>
          </div>
          <div className="py-2">
            {rows.map((row, index) => {
              if (row.type === 'gap') {
                return (
                  <div key={`gap-${index}`} className="flex items-center gap-2 py-2 px-3">
                    <div className="h-px flex-1 bg-border/60" />
                    <span className="text-[10px] text-muted-foreground/40 select-none">省略</span>
                    <div className="h-px flex-1 bg-border/60" />
                  </div>
                );
              }
              const lineClass =
                row.diff.type === 'added'
                  ? 'border-l-2 border-l-emerald-300/60 dark:border-l-emerald-700/40 bg-emerald-50/50 dark:bg-emerald-950/10 text-foreground'
                  : row.diff.type === 'removed'
                    ? 'border-l-2 border-l-rose-300/60 dark:border-l-rose-700/40 bg-rose-50/50 dark:bg-rose-950/10 text-foreground/55'
                    : 'text-muted-foreground/60';
              return (
                <div
                  key={`${row.index}-${index}`}
                  className={`px-3 py-1.5 text-[13px] leading-[1.65] ${lineClass}`}
                >
                  <span className="whitespace-pre-wrap break-words">
                    {row.diff.text || ' '}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }
  function formatExpert(value: OptimizationResult['issues'][number]['expert']) {
    return value === 'persona'
      ? '\u89d2\u8272\u4e13\u5bb6'
      : value === 'skill'
        ? '\u6280\u80fd\u4e13\u5bb6'
        : value === 'rubric'
          ? '\u8bc4\u4f30\u4e13\u5bb6'
          : '\u5408\u5e76\u4e13\u5bb6';
  }
  function formatTarget(value: OptimizationResult['issues'][number]['target']) {
    return value === 'agent'
      ? 'agent.md'
      : value === 'skill'
        ? '\u6280\u80fd\u6587\u4ef6'
        : 'rubric.md';
  }

  function renderArenaReportView(currentReport: ArenaReport, compact = false) {
    if (!isArenaReport(currentReport)) {
      return (
        <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          当前报告数据已失效，请重新生成评估报告。
        </div>
      );
    }

    const rows = buildArenaReportRows(currentReport);
    const reportLabels = getArenaSideLabels(
      thread,
      selectedPackage?.name,
      currentReport,
    );
    const winnerLabel = formatArenaReportWinner(
      currentReport.winningSide,
      reportLabels,
    );
    const sideCards = buildArenaReportSideCards(currentReport, reportLabels);
    const sideTitles = isSkillArenaThread
      ? { baseline: '左侧版本', enhanced: '右侧版本' }
      : { baseline: '基础回答', enhanced: '增强回答' };
    const baselineCard = sideCards.find((c) => c.key === 'baseline')!;
    const enhancedCard = sideCards.find((c) => c.key === 'enhanced')!;
    const baselineMaxTotal = rows.reduce(
      (sum, r) => sum + r.baselineMaxScore,
      0,
    );
    const enhancedMaxTotal = rows.reduce(
      (sum, r) => sum + r.enhancedMaxScore,
      0,
    );
    const baselineWin = currentReport.winningSide === 'baseline';
    const enhancedWin = currentReport.winningSide === 'enhanced';

    if (compact) {
      return (
        <div className="space-y-3">
          <div className="relative overflow-hidden rounded-[12px] border border-primary/20 bg-gradient-to-br from-primary/10 to-card px-3.5 py-3">
            <div className="absolute inset-x-0 top-0 h-[2px] bg-primary" />
            <div className="ec-eyebrow text-[10px]">VERDICT</div>
            <div className="mt-0.5 font-serif-display text-[15px] font-semibold leading-tight text-primary">
              {winnerLabel}
            </div>
            <div className="mt-1.5 line-clamp-4 text-[11.5px] leading-relaxed text-foreground/80">
              {currentReport.recommendation || '暂无综合判断。'}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div
              className={`relative overflow-hidden rounded-[10px] border px-2.5 py-2 ${
                baselineWin
                  ? 'border-primary/25 bg-primary/10'
                  : 'border-border bg-card'
              }`}
            >
              {baselineWin && (
                <div className="absolute inset-x-0 top-0 h-[2px] bg-primary" />
              )}
              <div className="font-mono-meta text-[9px] text-muted-foreground">
                BASELINE
              </div>
              <div className="mt-0.5 truncate font-serif-display text-[12px] font-semibold text-foreground">
                {baselineCard.label}
              </div>
              <div className="mt-1 font-serif-display text-[20px] font-semibold leading-none text-foreground">
                {baselineCard.total.toFixed(2)}
                <span className="ml-1 font-mono-meta text-[10px] text-muted-foreground">
                  /{baselineMaxTotal.toFixed(0)}
                </span>
              </div>
            </div>
            <div
              className={`relative overflow-hidden rounded-[10px] border px-2.5 py-2 ${
                enhancedWin
                  ? 'border-primary/25 bg-primary/10'
                  : 'border-border bg-card'
              }`}
            >
              {enhancedWin && (
                <div className="absolute inset-x-0 top-0 h-[2px] bg-primary" />
              )}
              <div className="font-mono-meta text-[9px] text-muted-foreground">
                ENHANCED
              </div>
              <div
                className={`mt-0.5 truncate font-serif-display text-[12px] font-semibold ${
                  enhancedWin ? 'text-primary' : 'text-foreground'
                }`}
              >
                {enhancedCard.label}
              </div>
              <div
                className={`mt-1 font-serif-display text-[20px] font-semibold leading-none ${
                  enhancedWin ? 'text-primary' : 'text-foreground'
                }`}
              >
                {enhancedCard.total.toFixed(2)}
                <span className="ml-1 font-mono-meta text-[10px] text-muted-foreground">
                  /{enhancedMaxTotal.toFixed(0)}
                </span>
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-[12px] border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border bg-muted px-3 py-2">
              <span className="font-mono-meta text-[9.5px] text-muted-foreground">
                DIMENSIONS
              </span>
              <span className="font-mono-meta text-[10px] text-muted-foreground">
                {rows.length} 项
              </span>
            </div>
            {rows.map((row) => {
              const diff = row.enhancedScore - row.baselineScore;
              const enhWin = diff > 0;
              const baseWin = diff < 0;
              const tie = diff === 0;
              return (
                <div
                  key={row.key}
                  className="border-b border-border px-3 py-2 last:border-b-0"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11.5px] font-medium text-foreground">
                      {row.name}
                    </span>
                    <span
                      className={`rounded-[3px] px-1.5 py-px font-mono-meta text-[9.5px] font-semibold ${
                        tie
                          ? 'bg-muted text-muted-foreground'
                          : enhWin
                            ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                            : 'bg-red-500/10 text-red-700 dark:text-red-300'
                      }`}
                    >
                      {tie ? '0' : `${enhWin ? '+' : ''}${diff}`}
                    </span>
                  </div>
                  <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-mono-meta text-[8.5px] text-muted-foreground/70">
                          BASE
                        </span>
                        <span
                          className={`font-mono-meta text-[11px] ${
                            baseWin
                              ? 'font-semibold text-primary'
                              : 'text-foreground/80'
                          }`}
                        >
                          {row.baselineScore}/{row.baselineMaxScore}
                        </span>
                      </div>
                      <div className="h-[3px] overflow-hidden rounded-full bg-foreground/5">
                        <div
                          className={`h-full rounded-full ${baseWin ? 'bg-primary' : 'bg-muted-foreground/40'}`}
                          style={{
                            width: `${row.baselineMaxScore > 0 ? (row.baselineScore / row.baselineMaxScore) * 100 : 0}%`,
                          }}
                        />
                      </div>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-mono-meta text-[8.5px] text-muted-foreground/70">
                          ENH
                        </span>
                        <span
                          className={`font-mono-meta text-[11px] ${
                            enhWin
                              ? 'font-semibold text-primary'
                              : 'text-foreground/80'
                          }`}
                        >
                          {row.enhancedScore}/{row.enhancedMaxScore}
                        </span>
                      </div>
                      <div className="h-[3px] overflow-hidden rounded-full bg-foreground/5">
                        <div
                          className={`h-full rounded-full ${enhWin ? 'bg-primary' : 'bg-muted-foreground/40'}`}
                          style={{
                            width: `${row.enhancedMaxScore > 0 ? (row.enhancedScore / row.enhancedMaxScore) * 100 : 0}%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {!rubricConfigured && (
            <div className="rounded-[10px] border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] leading-5 text-amber-900 dark:text-amber-200">
              {reportHintMessage}
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <section className="relative overflow-hidden rounded-[14px] border border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card px-4 py-4 shadow-sm">
          <div className="absolute inset-x-0 top-0 h-[3px] bg-primary" />
          <div className="ec-eyebrow text-[10.5px]">
            EVALUATION REPORT · VERDICT
          </div>
          <div className="mt-1 font-serif-display text-xl font-semibold leading-tight text-foreground">
            推荐选择 {winnerLabel}
          </div>
          <div className="mt-2 text-[13px] leading-relaxed text-foreground/85">
            {currentReport.recommendation || '暂无综合判断。'}
          </div>
          {!rubricConfigured && (
            <div className="mt-3 rounded-[10px] border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] leading-5 text-amber-900 dark:text-amber-200">
              {reportHintMessage}
            </div>
          )}
        </section>

        <section className="grid gap-3 lg:grid-cols-2">
          {sideCards.map((card) => {
            const isBaseline = card.key === 'baseline';
            const isWinner =
              (isBaseline && baselineWin) || (!isBaseline && enhancedWin);
            const maxTotal = isBaseline ? baselineMaxTotal : enhancedMaxTotal;
            const pct =
              maxTotal > 0 ? Math.min(100, (card.total / maxTotal) * 100) : 0;
            const roleLabel = isBaseline ? 'BASELINE' : 'ENHANCED';
            const sideTitle = isBaseline
              ? sideTitles.baseline
              : sideTitles.enhanced;
            return (
              <article
                key={card.key}
                className={`relative overflow-hidden rounded-[14px] border px-4 py-3.5 shadow-sm transition-colors ${
                  isWinner
                    ? 'border-primary/25 bg-primary/[0.04]'
                    : 'border-border bg-card'
                }`}
              >
                {isWinner && (
                  <div className="absolute inset-x-0 top-0 h-[2px] bg-primary" />
                )}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-[4px] px-1.5 py-px font-mono-meta text-[9.5px] font-medium tracking-[0.06em] ${
                          isWinner
                            ? 'bg-card text-primary'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {roleLabel}
                        {isWinner ? ' · WINNER' : ''}
                      </span>
                      <span className="font-mono-meta text-[10px] text-muted-foreground">
                        {sideTitle}
                      </span>
                    </div>
                    <div
                      className={`mt-1.5 truncate font-serif-display text-[15px] font-semibold ${
                        isWinner ? 'text-primary' : 'text-foreground'
                      }`}
                    >
                      {card.label}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-baseline gap-1">
                    <span
                      className={`font-serif-display text-[26px] font-semibold leading-none tracking-tight ${
                        isWinner ? 'text-primary' : 'text-foreground'
                      }`}
                    >
                      {card.total.toFixed(2)}
                    </span>
                    <span className="font-mono-meta text-[11px] text-muted-foreground">
                      /{maxTotal.toFixed(0)}
                    </span>
                  </div>
                </div>
                <div className="mt-2.5 text-[12.5px] leading-relaxed text-foreground/80">
                  {card.summary || '暂无评价。'}
                </div>
                <div className="mt-3 h-1 overflow-hidden rounded-full bg-foreground/5">
                  <div
                    className={`h-full rounded-full ${
                      isWinner
                        ? 'bg-gradient-to-r from-primary to-blue-500'
                        : 'bg-muted-foreground/40'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </article>
            );
          })}
        </section>

        <section className="overflow-hidden rounded-[14px] border border-border bg-card shadow-sm">
          <div className="border-b border-border px-4 py-3">
            <div className="ec-eyebrow text-[10px]">DIMENSIONS</div>
            <div className="mt-0.5 font-serif-display text-[15px] font-semibold text-foreground">
              维度逐项对比
            </div>
          </div>
          <div className="divide-y divide-border">
            {rows.map((row) => {
              const diff = row.enhancedScore - row.baselineScore;
              const enhWin = diff > 0;
              const baseWin = diff < 0;
              const tie = diff === 0;
              const baselinePctRow =
                row.baselineMaxScore > 0
                  ? (row.baselineScore / row.baselineMaxScore) * 100
                  : 0;
              const enhancedPctRow =
                row.enhancedMaxScore > 0
                  ? (row.enhancedScore / row.enhancedMaxScore) * 100
                  : 0;
              return (
                <div key={row.key} className="px-4 py-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-mono-meta text-[10px] text-muted-foreground/70">
                        {row.key}
                      </div>
                      <div className="font-serif-display text-[14px] font-semibold text-foreground">
                        {row.name}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="font-mono-meta text-[9px] text-muted-foreground">
                          BASELINE
                        </div>
                        <div
                          className={`font-mono-meta text-[13px] ${
                            baseWin
                              ? 'font-semibold text-primary'
                              : 'text-foreground/80'
                          }`}
                        >
                          {row.baselineScore} / {row.baselineMaxScore}
                        </div>
                      </div>
                      <span
                        className={`rounded-[4px] px-2 py-0.5 font-mono-meta text-[11px] font-semibold ${
                          tie
                            ? 'bg-muted text-muted-foreground'
                            : enhWin
                              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                              : 'bg-red-500/10 text-red-700 dark:text-red-300'
                        }`}
                      >
                        {tie ? '±0' : `${enhWin ? '+' : ''}${diff}`}
                      </span>
                      <div className="text-right">
                        <div className="font-mono-meta text-[9px] text-muted-foreground">
                          ENHANCED
                        </div>
                        <div
                          className={`font-mono-meta text-[13px] ${
                            enhWin
                              ? 'font-semibold text-primary'
                              : 'text-foreground/80'
                          }`}
                        >
                          {row.enhancedScore} / {row.enhancedMaxScore}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    <div className="rounded-[10px] border border-border/60 bg-muted/30 px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono-meta text-[9.5px] text-muted-foreground">
                          BASELINE
                        </span>
                        <span
                          className={`font-mono-meta text-[11px] ${
                            baseWin ? 'text-primary' : 'text-foreground/70'
                          }`}
                        >
                          {row.baselineScore}/{row.baselineMaxScore}
                        </span>
                      </div>
                      <div className="mt-1.5 h-[5px] overflow-hidden rounded-full bg-foreground/5">
                        <div
                          className={`h-full rounded-full ${
                            baseWin
                              ? 'bg-gradient-to-r from-primary to-blue-500'
                              : 'bg-muted-foreground/40'
                          }`}
                          style={{ width: `${baselinePctRow}%` }}
                        />
                      </div>
                      <div className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">
                        {row.baselineReason || '暂无说明。'}
                      </div>
                    </div>
                    <div
                      className={`rounded-[10px] border px-3 py-2.5 ${
                        enhWin
                          ? 'border-primary/20 bg-primary/5'
                          : 'border-border/60 bg-muted/30'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono-meta text-[9.5px] text-muted-foreground">
                          ENHANCED
                        </span>
                        <span
                          className={`font-mono-meta text-[11px] ${
                            enhWin ? 'text-primary' : 'text-foreground/70'
                          }`}
                        >
                          {row.enhancedScore}/{row.enhancedMaxScore}
                        </span>
                      </div>
                      <div className="mt-1.5 h-[5px] overflow-hidden rounded-full bg-foreground/5">
                        <div
                          className={`h-full rounded-full ${
                            enhWin
                              ? 'bg-gradient-to-r from-primary to-blue-500'
                              : 'bg-muted-foreground/40'
                          }`}
                          style={{ width: `${enhancedPctRow}%` }}
                        />
                      </div>
                      <div className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">
                        {row.enhancedReason || '暂无说明。'}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 w-full overflow-hidden">
      {!isWideLayout &&
        !manualEdit &&
        !interactiveMode &&
        (sidebarOpen || rightSidebarOpen) && (
        <button
          type="button"
          aria-label="关闭面板"
          className="absolute inset-0 z-20 bg-background/60 backdrop-blur-sm lg:hidden"
          onClick={() => {
            setSidebarOpen(false);
            setRightSidebarOpen(false);
            setRightExpanded(false);
          }}
        />
      )}
      {/* Sidebar */}
      {sidebarOpen ? (
        <>
          <aside
            style={sidebarStyle}
            className="absolute inset-y-0 left-0 z-30 flex w-[min(22rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] flex-col border-r border-border/70 bg-card shadow-xl lg:relative lg:z-auto lg:w-[var(--sidebar-width)] lg:max-w-none lg:shadow-none"
          >
            <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border/70 px-3">
              {authUser ? (
                <div className="flex min-w-0 items-center gap-2">
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-bold uppercase text-primary">
                    {authUser.username.charAt(0)}
                  </div>
                  <div
                    className="truncate text-xs font-medium text-foreground"
                    title={authUser.username}
                  >
                    {authUser.username}
                  </div>
                </div>
              ) : (
                <div />
              )}
              <div className="flex items-center gap-1">
                <button
                  onClick={logout}
                  className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  title="\u9000\u51fa\u767b\u5f55"
                >
                  <LogOut className="size-4" />
                </button>
                <button
                  onClick={() => setSidebarOpen(false)}
                  className="flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  title="\u6536\u8d77\u4fa7\u8fb9\u680f"
                >
                  <PanelLeftClose className="size-4" />
                </button>
              </div>
            </div>
            <ScrollArea className="flex-1 min-h-0">
              <div className="space-y-4 overflow-x-hidden p-4">
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold tracking-[0.05em] text-muted-foreground">
                    生成 Agent / Skill
                  </div>
                  <Textarea
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    placeholder="输入需求描述，或直接上传文档让 AI 自动生成..."
                    rows={3}
                    className="resize-none rounded-[14px] border-border/70 bg-card/80 text-xs"
                  />
                  {documents.length > 0 && (
                    <div className="space-y-1.5">
                      {documents.map((doc, i) => (
                        <div
                          key={`${doc.name}-${i}`}
                          className="flex min-w-0 items-center justify-between gap-2 overflow-hidden rounded-lg border border-border/70 bg-card/60 px-2.5 py-1.5 text-xs"
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
                            <FileText className="size-3 shrink-0 text-muted-foreground" />
                            <span
                              className="block min-w-0 truncate"
                              title={doc.name}
                            >
                              {doc.name}
                            </span>
                          </div>
                          <button
                            onClick={() =>
                              setDocuments((prev) =>
                                prev.filter((_, idx) => idx !== i),
                              )
                            }
                            className="shrink-0 text-muted-foreground hover:text-destructive"
                          >
                            <X className="size-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {documents.length > 1 && (
                    <div className="text-[11px] text-muted-foreground">
                      多文档会并发生成，不会合并成一个包。
                    </div>
                  )}
                  {batchRuns.length > 0 && (
                    <div className="min-w-0 max-w-full space-y-1.5 overflow-hidden rounded-xl border border-border/70 bg-card/40 p-2">
                      <div className="flex items-center justify-between px-0.5 text-[11px] text-muted-foreground">
                        <span>批量任务</span>
                        <span>
                          {
                            batchRuns.filter((item) => item.status === 'done')
                              .length
                          }
                          /{batchRuns.length}
                        </span>
                      </div>
                      {batchRuns.map((item) => (
                        <div
                          key={item.id}
                          className="flex min-w-0 items-start justify-between gap-2 overflow-hidden rounded-lg border border-border/70 bg-card/70 px-2.5 py-2 text-xs"
                        >
                          <div className="min-w-0 flex-1 overflow-hidden">
                            <div
                              className="block min-w-0 truncate font-medium"
                              title={item.name}
                            >
                              {item.name}
                            </div>
                            {item.packageName &&
                              item.packageName !== item.name && (
                                <div
                                  className="block min-w-0 truncate text-[11px] text-muted-foreground"
                                  title={item.packageName}
                                >
                                  {`生成结果：${item.packageName}`}
                                </div>
                            )}
                            {item.error && (
                              <div className="break-words text-[11px] text-destructive">
                                {item.error}
                              </div>
                            )}
                          </div>
                          <div className="flex w-14 shrink-0 items-center justify-end gap-1 text-[11px] text-muted-foreground">
                            {item.status === 'running' && (
                              <Loader2 className="size-3.5 animate-spin" />
                            )}
                            {item.status === 'done' && (
                              <CheckCircle2 className="size-3.5 text-emerald-500" />
                            )}
                            {item.status === 'error' && (
                              <XCircle className="size-3.5 text-destructive" />
                            )}
                            <span>
                              {item.status === 'waiting' &&
                                '\u7b49\u5f85\u4e2d'}
                              {item.status === 'running' &&
                                '\u751f\u6210\u4e2d'}
                              {item.status === 'done' && '\u5df2\u5b8c\u6210'}
                              {item.status === 'error' && '\u5931\u8d25'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      className="flex-1 min-w-[4rem] rounded-[12px]"
                      onClick={() => void handleGeneratePackages()}
                      disabled={!instruction.trim() && documents.length === 0}
                    >
                      <Sparkles className="mr-1.5 size-3.5" />
                      {documents.length > 1 ? '批量生成' : '生成'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 min-w-[4rem] rounded-[12px]"
                      onClick={() => docFileRef.current?.click()}
                    >
                      <FileText className="mr-1.5 size-3.5" />
                      文档
                    </Button>
                    <input
                      ref={docFileRef}
                      type="file"
                      multiple
                      accept=".txt,.md,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.csv,.json,.yaml,.yml,.js,.ts,.py,.html,.css"
                      hidden
                      onChange={(e) => {
                        void handleDocFiles(e.target.files);
                        e.currentTarget.value = '';
                      }}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 min-w-[4rem] rounded-[12px]"
                      onClick={() => fileRef.current?.click()}
                    >
                      <Upload className="mr-1.5 size-3.5" />
                      导入
                    </Button>
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".zip"
                      hidden
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void handleImport(file);
                      }}
                    />
                  </div>
                </div>
                <div className="h-px bg-border/70" />
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold tracking-[0.05em] text-muted-foreground">
                    仓库 · {packages.length}
                  </div>
                  <div className="space-y-1.5">
                    {packages.map((pkg) => (
                      <div
                        key={pkg.id}
                        className={`flex w-full items-center gap-2 rounded-[12px] px-2 py-2 transition-colors ${pkg.id === selectedPackageId ? 'bg-primary/10' : 'hover:bg-muted'}`}
                      >
                        <button
                          onClick={() => void openPackage(pkg.id)}
                          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                        >
                          <div className={`flex size-8 shrink-0 items-center justify-center rounded-[10px] font-bold text-xs transition-colors ${pkg.id === selectedPackageId ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary'}`}>
                            {pkg.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className={`truncate text-sm font-medium ${pkg.id === selectedPackageId ? 'text-primary' : ''}`}>
                              {pkg.name}
                            </div>
                            <div className="truncate text-[11px] text-muted-foreground">
                              v{pkg.versionNumber}
                            </div>
                          </div>
                        </button>
                        <button
                          onClick={() =>
                            void handleRenamePackage(pkg.id, pkg.name)
                        }
                          className="flex size-7 shrink-0 items-center justify-center rounded-[10px] text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                          title="\u91cd\u547d\u540d"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                      </div>
                    ))}
                    {packages.length === 0 && (
                      <div className="rounded-[14px] border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                        暂无智能体
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </ScrollArea>
          </aside>
          <div
            className="hidden w-1 shrink-0 cursor-col-resize bg-border/30 transition-all hover:w-1.5 hover:bg-primary/30 lg:block"
            onMouseDown={startResizeLeft}
          />
        </>
      ) : (
        <div className="absolute left-2 top-2 z-10 flex h-9 w-9 flex-col items-center justify-center rounded-xl border border-border/70 bg-card/90 shadow-sm backdrop-blur lg:relative lg:inset-y-0 lg:left-auto lg:top-auto lg:z-auto lg:h-auto lg:w-8 lg:justify-start lg:rounded-none lg:border-y-0 lg:border-l-0 lg:border-r lg:bg-card/40 lg:py-3 lg:shadow-none lg:backdrop-blur-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="\u5c55\u5f00\u4fa7\u8fb9\u680f"
          >
            <PanelLeftOpen className="size-4" />
          </button>
        </div>
      )}

      {/* Main Arena */}
      <main className={`flex min-w-0 flex-1 flex-col bg-card/20 ${manualEdit || interactiveMode ? 'relative z-40' : ''} ${rightExpanded && !manualEdit && !interactiveMode ? 'hidden lg:hidden' : ''}`}>
        {manualEdit ? (
          <>
            <div className="relative z-50 flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-card/40 px-14 py-2 lg:px-5">
              <div className="flex min-w-0 items-center gap-3">
                <div className="truncate text-sm font-semibold">
                  编辑 {manualEdit.title}
                </div>
                <div className="hidden text-xs text-muted-foreground sm:block">
                  保存后会生成新版本
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-[12px]"
                  onClick={() =>
                    setManualEdit((prev) =>
                      prev ? { ...prev, preview: !prev.preview } : prev,
                    )
                  }
                >
                  {manualEdit.preview ? '继续编辑' : '预览'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-[12px]"
                  onClick={() => setManualEdit(null)}
                  disabled={manualEditSaving}
                >
                  取消
                </Button>
                <Button
                  size="sm"
                  className="rounded-[12px]"
                  onClick={() => void saveManualEdit()}
                  disabled={manualEditSaving || !manualEdit.content.trim()}
                >
                  {manualEditSaving && (
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                  )}
                  保存
                </Button>
              </div>
            </div>
            {manualRubricHint && (
              <div className="border-b border-amber-500/20 bg-amber-500/10 px-14 py-2 text-xs text-amber-900 dark:text-amber-200 lg:px-5">
                {manualRubricHint}
              </div>
            )}
            <div className="flex-1 overflow-hidden p-3 sm:p-5">
              {manualEdit.preview ? (
                <div className="h-full overflow-auto rounded-[14px] border border-border/70 bg-card/70 p-5 text-sm">
                  {manualEdit.target === 'skill' ? (
                    <SkillMarkdownContent content={manualEdit.content} />
                  ) : manualEdit.target === 'rubric' ? (
                    <RubricStructuredView content={manualEdit.content} />
                  ) : (
                    <MarkdownContent content={manualEdit.content} />
                  )}
                </div>
              ) : (
                <Textarea
                  value={manualEdit.content}
                  onChange={(e) =>
                    setManualEdit((prev) =>
                      prev ? { ...prev, content: e.target.value } : prev,
                    )
                  }
                  spellCheck={false}
                  className="h-full min-h-[520px] resize-none rounded-[14px] border-border/70 bg-card/80 font-mono text-xs leading-5"
                />
              )}
            </div>
          </>
        ) : interactiveMode ? (
          <>
            <div className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-card/40 px-14 py-2 lg:px-5">
              <div className="flex min-w-0 items-center gap-3">
                <div className="text-sm font-semibold">交互式优化</div>
                <div className="hidden text-xs text-muted-foreground sm:block">
                  与专家对话，逐步优化智能体
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {interactiveAdopted.length > 0 && (
                  <span className="text-[10px] text-muted-foreground">
                    {interactiveAdopted.length} 项已采纳
                  </span>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="rounded-[12px] text-muted-foreground hover:text-foreground"
                  onClick={() => setInteractiveMode(false)}
                >
                  关闭
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-[12px] text-destructive border-destructive/30 hover:bg-destructive/10"
                  disabled={replyGenerating}
                  onClick={() => {
                    if (
                      window.confirm(
                        '\u786e\u5b9a\u8981\u91cd\u65b0\u5f00\u59cb\u5417\uff1f\u5f53\u524d\u5bf9\u8bdd\u548c\u5df2\u91c7\u7eb3\u7684\u4fee\u6539\u5c06\u88ab\u6e05\u7a7a\u3002',
                      )
                    ) {
                      if (selectedPackageId) {
                        localStorage.removeItem(
                          interactiveStorageKey(selectedPackageId),
                        );
                      }
                      setInteractiveMessages([]);
                      setInteractiveAdopted([]);
                      setInteractiveIssues([]);
                      void startInteractive(true);
                    }
                  }}
                >
                  {'->'} 重新开始
                </Button>
                {interactiveAdopted.length > 0 && (
                  <Button
                    size="sm"
                    className="rounded-[12px]"
                    onClick={() => {
                      const list = interactiveAdopted
                        .map(
                          (c, i) =>
                            `${i + 1}. [${c.target}${c.targetId ? `/${c.targetId}` : ''}] ${c.reason}`,
                        )
                        .join('\n');
                      if (
                        window.confirm(
                          `\u786e\u8ba4\u5c06\u4ee5\u4e0b\u4fee\u6539\u4fdd\u5b58\u4e3a\u65b0\u7248\u672c\uff1f\n\n${list}\n\n\u4fdd\u5b58\u540e\u5c06\u751f\u6210\u65b0\u7248\u672c\u5e76\u9000\u51fa\u4ea4\u4e92\u5f0f\u4f18\u5316\u3002`,
                        )
                      ) {
                        void saveInteractiveChanges();
                      }
                    }}
                  >
                    保存
                  </Button>
                )}
              </div>
            </div>
            <div className="flex shrink-0 gap-1 border-b border-border/70 bg-card/30 px-3 py-2 sm:px-5">
              {[
                { key: 'chat' as const, label: '当前对话' },
                {
                  key: 'issues' as const,
                  label: `专家建议 ${interactiveIssues.length || ''}`,
                },
                {
                  key: 'adopted' as const,
                  label: `已采纳 ${interactiveAdopted.length || ''}`,
                },
                {
                  key: 'history' as const,
                  label: `历史 ${interactiveSessions.length || ''}`,
                },
              ].map((item) => (
                <button
                  key={item.key}
                  onClick={() => setInteractiveView(item.key)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${interactiveView === item.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div
              ref={chatScrollRef}
              className="flex-1 space-y-5 overflow-y-auto px-3 py-4 sm:px-6"
            >
              {interactiveView === 'issues' && (
                <div className="grid gap-3 lg:grid-cols-2">
                  {interactiveIssues.map((issue) => (
                    <div
                      key={issue.id}
                      className="rounded-[14px] border border-border/70 bg-card/70 p-4 text-sm"
                    >
                      <div className="font-semibold">{issue.title}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {`目标：${issue.target}${issue.targetId ? ` / ${issue.targetId}` : ''}`}
                      </div>
                      <div className="mt-2 text-muted-foreground">
                        {issue.reason}
                      </div>
                      <div className="mt-2 rounded-lg bg-muted/60 p-2 text-xs leading-5">
                        {issue.suggestion}
                      </div>
                    </div>
                  ))}
                  {interactiveIssues.length === 0 && (
                    <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                      暂无专家建议
                    </div>
                  )}
                </div>
              )}
              {interactiveView === 'adopted' && (
                <div className="space-y-3">
                  {interactiveAdopted.map((change) => (
                    <button
                      key={change.id}
                      onClick={() => showAdoptedChangeDiff(change)}
                      className="block w-full rounded-[14px] border border-border/70 bg-card/70 p-4 text-left text-sm hover:border-primary/30 hover:bg-primary/5"
                    >
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">
                          {change.target}
                          {change.targetId ? `/${change.targetId}` : ''}
                        </Badge>
                        <span className="font-medium">{change.reason}</span>
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        点击查看具体修改痕迹
                      </div>
                    </button>
                  ))}
                  {interactiveAdopted.length === 0 && (
                    <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                      暂无已采纳修改
                    </div>
                  )}
                </div>
              )}
              {interactiveView === 'history' && (
                <div className="space-y-3">
                  {interactiveSessions.map((session) => (
                    <button
                      key={session.id}
                      onClick={() => applyInteractiveSession(session, true)}
                      className={`block w-full rounded-[14px] border p-4 text-left text-sm transition-colors ${interactiveSessionId === session.id ? 'border-primary/30 bg-primary/5' : 'border-border/70 bg-card/70 hover:border-primary/25'}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-medium">
                          {session.status === 'saved'
                            ? '\u5df2\u4fdd\u5b58\u4f18\u5316'
                            : '\u8fdb\u884c\u4e2d\u7684\u4f18\u5316'}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(session.updatedAt).toLocaleString()}
                        </div>
                      </div>
                      <div className="mt-2 text-xs leading-5 text-muted-foreground">
                        {session.summary || '暂无总结'}
                      </div>
                      <div className="mt-2 flex gap-2 text-[10px] text-muted-foreground">
                        <span>{session.issues.length} 条建议</span>
                        <span>{session.adoptedChanges.length} 项采纳</span>
                        {session.versionNumber && (
                          <span>v{session.versionNumber}</span>
                        )}
                      </div>
                    </button>
                  ))}
                  {interactiveSessions.length === 0 && (
                    <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                      暂无历史优化记录
                    </div>
                  )}
                </div>
              )}
              {interactiveView === 'chat' &&
                interactiveMessages.map((m, i) => (
                  <div
                    key={i}
                    className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div className="max-w-[88%] sm:max-w-[70%] lg:max-w-[50%]">
                      <div className="text-[10px] font-medium text-muted-foreground mb-1">
                        {m.role === 'user'
                          ? '\u4f60'
                          : '\u4f18\u5316\u4e13\u5bb6'}
                      </div>
                      <div
                        className={`rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${
                          m.role === 'user'
                            ? 'bg-primary/10 text-foreground rounded-tr-sm border border-primary/15'
                            : 'bg-muted/70 text-foreground rounded-tl-sm border border-border/60'
                        }`}
                      >
                        <MarkdownContent content={m.content} />
                      </div>
                    </div>
                  </div>
                ))}
              {interactiveView === 'chat' && interactivePhase !== 'idle' && (
                <div className="flex justify-start">
                  <div className="w-full max-w-[94%] sm:max-w-[90%]">
                    <div className="text-xs font-medium text-muted-foreground mb-1.5 pl-1">
                      优化专家
                    </div>
                    {interactivePhase === 'diagnosing' ? (
                      <div className="rounded-2xl px-5 py-4 text-sm bg-muted/70 border border-border/60 rounded-tl-sm shadow-sm">
                        <div className="space-y-3">
                          <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
                            <Loader2 className="size-4 animate-spin" />
                            <span>首次分析需要 10-30 秒，请稍候...</span>
                          </div>
                          <div className="text-xs text-muted-foreground space-y-1.5">
                            <div className="flex items-center gap-2">
                              <span className="inline-flex size-4 items-center justify-center rounded-full bg-primary/20 text-primary text-[10px]">
                                1
                              </span>
                              读取智能体内容
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="inline-flex size-4 items-center justify-center rounded-full bg-primary/20 text-primary text-[10px]">
                                2
                              </span>
                              分析 Arena 对话轨迹
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="inline-flex size-4 items-center justify-center rounded-full bg-primary/20 text-primary text-[10px]">
                                3
                              </span>
                              识别潜在优化问题
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="inline-flex size-4 items-center justify-center rounded-full bg-muted text-muted-foreground text-[10px]">
                                4
                              </span>
                              生成诊断报告
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-2xl px-4 py-3 text-sm bg-muted/70 border border-border/60 rounded-tl-sm shadow-sm">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Loader2 className="size-3 animate-spin" />
                          专家正在思考...
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            {interactiveAdopted.length > 0 && (
              <div className="shrink-0 border-t border-border/70 bg-card/40">
                <div className="px-5 py-2.5">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[11px] font-medium text-muted-foreground">
                      已采纳的修改 ({interactiveAdopted.length})
                    </div>
                    <div className="text-[10px] text-primary/80">
                      点击“保存”后会生成新版本
                    </div>
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {interactiveAdopted.map((change) => (
                      <button
                        key={change.id}
                        onClick={() => showAdoptedChangeDiff(change)}
                        className="shrink-0 rounded-lg border border-border/70 bg-muted/40 px-2.5 py-1.5 text-xs max-w-xs text-left hover:border-primary/30 hover:bg-primary/5 transition-colors cursor-pointer"
                        title="点击查看具体修改痕迹"
                      >
                        <div className="flex items-center gap-1.5">
                          <Badge
                            variant="secondary"
                            className="text-[10px] h-4 px-1 shrink-0"
                          >
                            {change.target}
                            {change.targetId ? `/${change.targetId}` : ''}
                          </Badge>
                          <span
                            className="text-muted-foreground truncate"
                            title={change.reason}
                          >
                            {change.reason}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div className="shrink-0 border-t border-border/70 bg-card/40 p-3 sm:p-4">
              <div className="flex flex-col gap-3 sm:flex-row">
                <Textarea
                  value={interactiveInput}
                  onChange={(e) => setInteractiveInput(e.target.value)}
                  placeholder="输入消息与专家对话..."
                  rows={2}
                  className="min-h-[56px] resize-none rounded-[14px] border-border/70 bg-card/80"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void sendInteractiveMessage();
                    }
                  }}
                />
                <Button
                  className="h-10 w-full rounded-[12px] px-5 sm:w-auto sm:self-end"
                  onClick={() => void sendInteractiveMessage()}
                  disabled={
                    interactivePhase !== 'idle' || !interactiveInput.trim()
                  }
                >
                  <Send className="mr-1.5 size-4" />
                  发送
                </Button>
              </div>
            </div>
          </>
        ) : centerPreview ? (
          <>
            <div className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-card/40 px-14 py-2 lg:px-5">
              <div className="flex min-w-0 items-center gap-3">
                <div className="truncate text-sm font-semibold">
                  {centerPreview.name}
                </div>
                <div className="hidden text-xs text-muted-foreground sm:block">
                  中间预览
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-[12px]"
                  onClick={() => {
                    if (centerPreview.type === 'adoptedDiff') {
                      setCenterPreview(null);
                      setInteractiveMode(true);
                      setInteractiveView('adopted');
                      return;
                    }
                    if (centerPreview.type === 'report') {
                      setCenterPreview(null);
                      setDetailTab('report');
                      return;
                    }
                    setCenterPreview(null);
                  }}
                >
                  {centerPreview.type === 'adoptedDiff'
                    ? '\u8fd4\u56de\u5df2\u91c7\u7eb3\u4fee\u6539'
                    : '\u8fd4\u56de\u5de5\u4f5c\u53f0'}
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-3 sm:p-6">
              {centerPreview.type === 'adoptedDiff' ? (
                renderAdoptedChangeDiffView(centerPreview)
              ) : centerPreview.type === 'report' ? (
                renderArenaReportView(centerPreview.report)
              ) : (
                <div className="max-w-3xl mx-auto">
                  <div className="rounded-[14px] border border-border/70 bg-muted/50 p-5 text-sm">
                    {(() => {
                      const previewContent = normalizePreviewContent(
                        centerPreview.content,
                      );

                      return centerPreview.type === 'skill' ? (
                        <SkillMarkdownContent content={previewContent} />
                      ) : centerPreview.type === 'rubric' ? (
                        <RubricStructuredView content={previewContent} />
                      ) : (
                        <MarkdownContent content={previewContent} />
                      );
                    })()}
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-card/40 px-14 py-2 lg:px-5">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <div className="truncate text-sm font-semibold">
                  {selectedPackage?.name || '\u5de5\u4f5c\u53f0'}
                </div>
                {selectedPackage && (
                  <button
                    onClick={() =>
                      void handleRenamePackage(
                        selectedPackage.id,
                        selectedPackage.name,
                      )
                    }
                    className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    title="\u91cd\u547d\u540d"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                )}
                {/* Skill Arena 线程：显示绑定的 Skill 版本号 */}
                {isSkillArenaThread && skillVersionInfo && (skillVersionInfo.left || skillVersionInfo.right) && (
                  <div className="flex flex-wrap items-center gap-1.5 pl-1 text-xs text-muted-foreground">
                    <span>
                      绑定版本：
                      {skillVersionInfo.left ? `v${skillVersionInfo.left.boundSkillVersionNumber}` : '不使用 Skill'}
                      {' / '}
                      {skillVersionInfo.right ? `v${skillVersionInfo.right.boundSkillVersionNumber}` : '不使用 Skill'}
                    </span>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <div className="inline-flex rounded-[12px] border border-border/70 bg-muted/40 p-0.5">
                  {[
                    { key: 'compare' as const, label: '\u5bf9\u6bd4' },
                    {
                      key: 'agent' as const,
                      label: isSkillArenaThread ? '\u53f3\u4fa7' : '\u667a\u80fd\u4f53',
                    },
                    {
                      key: 'baseline' as const,
                      label: isSkillArenaThread ? '\u5de6\u4fa7' : '\u57fa\u7840',
                    },
                  ].map((mode) => (
                    <button
                      key={mode.key}
                      onClick={() => setArenaMode(mode.key)}
                      className={`rounded-[10px] px-2.5 py-1 text-xs font-medium transition-colors ${arenaMode === mode.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-[12px]"
                  onClick={() => void startInteractive()}
                  disabled={!thread || !rubricConfigured || replyGenerating}
                  title={interactiveActionTitle}
                >
                  交互式优化
                  {hasSavedSession && (
                    <span className="ml-1 text-[10px] opacity-70">(继续)</span>
                  )}
                </Button>
                <Button
                  size="sm"
                  className="gap-1.5 rounded-[12px]"
                  onClick={() => setCreatorOpen(true)}
                  disabled={!currentPackageVersionId}
                >
                  <Plus className="size-3.5" />
                  新建对比
                </Button>
                {/* 历史线程下拉 */}
                <div className="relative">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 rounded-[12px]"
                    onClick={() => setHistoryOpen((v) => !v)}
                    disabled={arenaThreadList.threads.length === 0}
                    title="历史对比"
                  >
                    <History className="size-3.5" />
                  </Button>
                  {historyOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setHistoryOpen(false)}
                      />
                      <div className="absolute right-0 top-full z-50 mt-1 max-h-72 w-72 overflow-y-auto rounded-[12px] border border-border/70 bg-card p-1 shadow-[var(--shadow-lg)]">
                        {arenaThreadList.loading && (
                          <div className="px-3 py-2 text-xs text-muted-foreground">
                            加载中...
                          </div>
                        )}
                        {!arenaThreadList.loading &&
                          arenaThreadList.threads.length === 0 && (
                            <div className="px-3 py-2 text-xs text-muted-foreground">
                              暂无历史线程
                            </div>
                          )}
                        {arenaThreadList.threads.map((t) => {
                          const isActive =
                            String(t.id) === arenaThreadList.currentThreadId;
                          return (
                            <button
                              key={t.id}
                              onClick={() => {
                                setHistoryOpen(false);
                                void arenaThreadList.switchThread(String(t.id));
                              }}
                              className={`w-full rounded-[8px] px-3 py-2 text-left transition-colors ${
                                isActive
                                  ? 'bg-primary-soft text-primary'
                                  : 'hover:bg-muted'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="truncate text-xs font-medium">
                                  {t.arenaKind === 'skill_arena'
                                    ? 'Skill Arena'
                                    : '标准 Arena'}
                                </span>
                                <span className="shrink-0 text-[10px] text-muted-foreground">
                                  {new Date(t.updatedAt).toLocaleString(
                                    'zh-CN',
                                    {
                                      month: '2-digit',
                                      day: '2-digit',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    },
                                  )}
                                </span>
                              </div>
                              {t.arenaKind === 'skill_arena' &&
                                t.skillArenaConfig && (
                                  <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                                    {t.skillArenaConfig.left.skillName} vs{' '}
                                    {t.skillArenaConfig.right.skillName}
                                  </div>
                                )}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {progress && (
              <div
                className={`mx-5 mt-3 rounded-[14px] border px-5 py-3 ${progress.isError ? 'border-destructive/20 bg-destructive/5' : progress.active ? 'border-primary/15 bg-primary/5' : 'border-emerald-500/15 bg-emerald-500/5'}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    {progress.active ? (
                      <Loader2 className="size-4 animate-spin text-primary" />
                    ) : progress.isError ? (
                      <XCircle className="size-4 text-destructive" />
                    ) : (
                      <CheckCircle2 className="size-4 text-emerald-500" />
                    )}
                    {progress.title}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="size-3" />
                      {formatElapsed(getProgressElapsedMs(progress, nowMs))}
                    </div>
                    {!progress.active && (
                      <button
                        onClick={() => setProgress(null)}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                        title="关闭"
                      >
                        X
                      </button>
                    )}
                  </div>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {progress.phase}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {progress.steps.map((step, i) => (
                    <Badge
                      key={`${step}-${i}`}
                      variant={
                        i === progress.steps.length - 1
                          ? 'default'
                          : 'secondary'
                      }
                      className="text-[10px]"
                    >
                      {step}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <PackagePreviewCard
              previews={showGeneratePreviews ? generatePreviews : []}
            />

            {selectedPackage && token && (
              <ArenaThreadCreatorDialog
                open={creatorOpen}
                onOpenChange={(next) => {
                  setCreatorOpen(next);
                  if (!next) {
                    // 关闭弹窗时重置重建场景下的预选状态，避免下次"新建对比"被污染
                    setCreatorInitialLeft('');
                    setCreatorInitialRight('');
                    setCreatorPreferLatest(false);
                  }
                }}
                token={token}
                packageId={selectedPackageId}
                currentPackageVersionId={currentPackageVersionId}
                packageSkills={packageSkills}
                includeDiscardedVersions={showDiscardedSkillVersions}
                initialLeftSkillUid={creatorInitialLeft || undefined}
                initialRightSkillUid={creatorInitialRight || undefined}
                preferLatestVersion={creatorPreferLatest}
                onCreated={(nextThread, nextDetail) => {
                  setThread(nextThread);
                  setThreadDetail(nextDetail);
                  setReport(null);
                  setCenterPreview((prev) =>
                    prev?.type === 'report' ? null : prev,
                  );
                  setArenaMode('compare');
                  setStatus(
                    nextThread.warning ||
                      (nextThread.arenaKind === 'skill_arena'
                        ? 'Skill Arena 已创建'
                        : '标准 Arena 已创建'),
                  );
                  arenaThreadList.notifyCreated(nextThread, nextDetail);
                  // 创建完成后重置重建状态
                  setCreatorInitialLeft('');
                  setCreatorInitialRight('');
                  setCreatorPreferLatest(false);
                }}
              />
            )}

            <div className="flex-1 overflow-auto">
              <ConversationBoard
                messages={messages}
                sideStreaming={sideStreaming}
                packageName={selectedPackage?.name}
                sideLabels={arenaSideLabels}
                mode={arenaMode}
                answerOptimizations={threadDetail?.answerOptimizations || []}
                onOptimizeAnswer={openAnswerOptimization}
              />
            </div>

            <div className="border-t border-border/70 bg-card/40 p-3 sm:p-4">
              <div className="flex flex-col gap-3 sm:flex-row">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={`\u8f93\u5165\u95ee\u9898\uff0c\u6d4b\u8bd5 ${selectedPackage?.name || '\u667a\u80fd\u4f53'} \u6548\u679c...`}
                  rows={2}
                  className="min-h-[60px] resize-none rounded-[14px] border-border/70 bg-card/80"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void handleSend();
                    }
                  }}
                />
                <Button
                  className="h-10 w-full rounded-[12px] px-5 sm:w-auto sm:self-end"
                  onClick={() => void handleSend()}
                  disabled={
                    !selectedPackage ||
                    !thread ||
                    sideStreaming.baseline ||
                    sideStreaming.enhanced
                  }
                >
                  <Send className="mr-1.5 size-4" />
                  发送
                </Button>
              </div>
            </div>
          </>
        )}
      </main>

      {/* Detail */}
      {rightSidebarOpen && !(manualEdit || interactiveMode) ? (
        <>
          <div
            className={`hidden w-1 shrink-0 cursor-col-resize bg-border/30 transition-all hover:w-1.5 hover:bg-primary/30 lg:block ${rightExpanded ? 'lg:hidden' : ''}`}
            onMouseDown={startResizeRight}
          />
          <aside
            style={detailStyle}
            className={`absolute inset-y-0 right-0 z-30 flex w-[min(24rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] flex-col border-l border-border/70 bg-card shadow-xl lg:relative lg:z-auto lg:max-w-none lg:shadow-none ${manualEdit || interactiveMode ? 'hidden lg:flex' : ''} ${rightExpanded ? 'lg:flex-1 lg:w-0' : 'lg:w-[var(--detail-width)]'}`}
          >
            <div className="flex min-h-12 shrink-0 items-center justify-between gap-2 border-b border-border/70 px-3 py-2 sm:px-4">
              <div className="flex min-w-0 items-center gap-1.5">
                <div className="min-w-0 truncate text-sm font-semibold">
                  {selectedPackage?.name || '未选择'}
                </div>
                {selectedPackage && (
                  <button
                    onClick={() =>
                      void handleRenamePackage(
                        selectedPackage.id,
                        selectedPackage.name,
                      )
                    }
                    className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    title="\u91cd\u547d\u540d"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs rounded-[8px]"
                  onClick={() => void handleExport()}
                  disabled={!selectedPackageId}
                >
                  导出
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7 rounded-[10px] text-destructive hover:text-destructive"
                  onClick={() => void handleDelete()}
                  disabled={!selectedPackageId}
                >
                  <Trash2 className="size-3.5" />
                </Button>
                <button
                  onClick={() => setRightExpanded((v) => !v)}
                  className={`flex size-7 items-center justify-center rounded-lg transition-colors ${
                    rightExpanded
                      ? 'bg-primary/10 text-primary hover:bg-primary/15'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                  title={rightExpanded ? '恢复默认宽度' : '展开为宽面板'}
                >
                  {rightExpanded ? (
                    <Minimize2 className="size-4" />
                  ) : (
                    <Maximize2 className="size-4" />
                  )}
                </button>
                <button
                  onClick={() => {
                    setRightSidebarOpen(false);
                    setRightExpanded(false);
                  }}
                  className="flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  title="收起右侧面板"
                >
                  <PanelRightClose className="size-4" />
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1 px-4 pt-3 pb-2 border-b border-border/70">
              {[
                { key: 'agent' as DetailTab, label: 'Agent', icon: FileText },
                {
                  key: 'rubric' as DetailTab,
                  label: 'Rubric',
                  icon: ListChecks,
                },
                { key: 'skills' as DetailTab, label: 'Skills', icon: Wrench },
                {
                  key: 'versions' as DetailTab,
                  label: '版本',
                  icon: GitCompare,
                },
                { key: 'report' as DetailTab, label: '评估报告', icon: BarChart3 },
              ].map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => {
                    if (interactiveMode) {
                      if (
                        !window.confirm(
                          '切换标签将暂时退出交互式优化模式，已采纳的修改不会丢失。是否继续？',
                        )
                      )
                        return;
                      setInteractiveMode(false);
                    }
                    setDetailTab(tab.key);
                  }}
                  className={`inline-flex items-center gap-1 rounded-[10px] px-2.5 py-1 text-xs font-medium transition-colors ${detailTab === tab.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
                >
                  <tab.icon className="size-3" />
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="space-y-4 p-3 sm:p-4">
                {!selectedPackage && (
                  <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                    请选择一个智能体
                  </div>
                )}

                {selectedPackage && detailTab === 'agent' && (
                  <div className="overflow-hidden rounded-[14px] border border-border/70 bg-card shadow-sm">
                    <div className="flex items-start justify-between gap-3 border-b border-border/70 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="ec-eyebrow">AGENT.MD</div>
                        <h3 className="font-serif-display text-[15.5px] font-semibold leading-tight text-foreground">
                          智能体定义
                        </h3>
                      </div>
                      <div className="ec-actions">
                        <button
                          onClick={startManualEditAgent}
                          className="ec-action"
                        >
                          编辑
                        </button>
                      </div>
                    </div>
                    <div
                      className="cursor-pointer p-4 text-sm transition-colors hover:bg-muted/50 overflow-auto max-h-[60vh]"
                      onClick={() => {
                        setRightExpanded(false);
                        setCenterPreview({
                          type: 'agent',
                          name: 'agent.md',
                          content: selectedPackage.snapshot.agentMd,
                        });
                      }}
                    >
                      <MarkdownContent
                        content={selectedPackage.snapshot.agentMd}
                      />
                    </div>
                  </div>
                )}

                {selectedPackage && detailTab === 'rubric' && (
                  <div className="overflow-hidden rounded-[14px] border border-border/70 bg-card shadow-sm">
                    <div className="flex items-start justify-between gap-3 border-b border-border/70 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="ec-eyebrow">RUBRIC.MD</div>
                        <h3 className="font-serif-display text-[15.5px] font-semibold leading-tight text-foreground">
                          评分规则
                        </h3>
                        <div className="ec-meta">
                          {rubricHasContent
                            ? '已配置'
                            : '尚未配置'}
                        </div>
                      </div>
                      <div className="ec-actions">
                        <button
                          onClick={() => startManualEditRubric()}
                          className="ec-action"
                        >
                          编辑
                        </button>
                        <span className="ec-action-divider" />
                        <button
                          onClick={() => rubricFileRef.current?.click()}
                          className="ec-action"
                        >
                          导入
                        </button>
                        {rubricHasContent && (
                          <>
                            <span className="ec-action-divider" />
                            <button
                              onClick={() => {
                                setRightExpanded(false);
                                setCenterPreview({
                                  type: 'rubric',
                                  name: 'rubric.md',
                                  content: rubricPreviewContent,
                                });
                              }}
                              className="ec-action"
                              aria-label="在中间打开评分规则"
                            >
                              在中间打开
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    <input
                      ref={rubricFileRef}
                      type="file"
                      accept=".txt,.md,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      hidden
                      onChange={(e) => {
                        void handleRubricFiles(e.target.files);
                        e.currentTarget.value = '';
                      }}
                    />
                    <div className="space-y-3 p-4">
                      {rubricHasContent ? (
                        <>
                          {rubricNeedsRepair && (
                            <div className="rounded-[10px] border border-amber-500/25 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-900 dark:text-amber-200">
                              <div className="font-medium">
                                当前 rubric 会按现有内容参与评分
                              </div>
                              <div className="mt-1 leading-5">
                                当前内容已经保留下来了。现在可以直接生成报告；如果想让评分更稳定，可以继续手动补充维度、权重或等级说明。
                              </div>
                            </div>
                          )}
                          <div className="max-h-[60vh] overflow-auto text-sm">
                            <RubricStructuredView content={rubricDisplayText} />
                          </div>
                        </>
                      ) : (
                        <div className="rounded-[12px] border border-dashed border-border bg-muted/35 p-4 text-sm">
                          <div className="font-medium text-foreground">
                            当前还没有配置 rubric
                          </div>
                          <div className="mt-2 leading-6 text-muted-foreground">
                            这里保留手动编辑和导入文件两种方式。补好 rubric
                            之后，就能直接生成评估报告；交互式优化仍建议使用结构更完整的
                            rubric。
                          </div>
                          <div className="mt-4 rounded-[10px] border border-border/70 bg-card p-3 text-xs leading-5 text-muted-foreground">
                            <div className="font-medium text-foreground">
                              手动填写时，通常至少补上这些部分：
                            </div>
                            <div className="mt-2 whitespace-pre-wrap">
                              {[
                                '评分目标',
                                '角色贴合',
                                'Skill 遵循',
                                '回答质量',
                                '安全边界',
                                '使用说明',
                              ]
                                .map((item) => `- ${item}`)
                                .join('\n')}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {selectedPackage && detailTab === 'skills' && (
                  <div className="space-y-5">
                    {/* 卡 1:技能内容 */}
                    <div className="overflow-hidden rounded-[14px] border border-border/70 bg-card shadow-sm">
                      <div className="flex items-start justify-between gap-3 border-b border-border/70 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <div className="ec-eyebrow">SKILL.MD</div>
                          <h3 className="font-serif-display text-[15.5px] font-semibold leading-tight text-foreground">
                            技能内容
                          </h3>
                          <div className="ec-meta">
                            {selectedSkill
                              ? `${selectedSkill.name} · ${selectedSkill.dirName}`
                              : '请选择技能'}
                            <span className="ec-meta-sep">·</span>
                            {packageSkills.length} 个技能
                          </div>
                        </div>
                        {selectedSkill && (
                          <div className="ec-actions">
                            <button
                              onClick={startManualEditSkill}
                              className="ec-action"
                            >
                              编辑
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="space-y-3 p-4">
                        {packageSkills.length > 0 ? (
                          <>
                            <div className="flex gap-1.5 overflow-x-auto pb-1">
                              {packageSkills.map((skill) => (
                                <button
                                  key={skill.id}
                                  onClick={() => setSelectedSkillId(skill.skillUid)}
                                  title={skill.name}
                                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-[10px] px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors ${selectedSkillId === skill.skillUid ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
                                >
                                  <span className="max-w-[12rem] truncate">
                                    {skill.name}
                                  </span>
                                  {skill.status === 'removed' && (
                                    <span className="rounded-full border border-current/25 px-1.5 py-0.5 text-[10px] leading-none">
                                      已移除
                                    </span>
                                  )}
                                </button>
                              ))}
                            </div>
                            {selectedSkill ? (
                              <div
                                className="cursor-pointer text-sm transition-colors hover:bg-muted/50 overflow-auto max-h-[60vh]"
                                onClick={() => {
                                  setRightExpanded(false);
                                  setCenterPreview({
                                    type: 'skill',
                                    name: selectedSkill.name,
                                    content: selectedSkill.skillMd,
                                  });
                                }}
                              >
                                <SkillMarkdownContent
                                  content={
                                    selectedSkill?.skillMd ||
                                    '\u6682\u65e0\u6280\u80fd\u5185\u5bb9'
                                  }
                                />
                              </div>
                            ) : (
                              <div className="rounded-[12px] border border-amber-500/25 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-900 dark:text-amber-200">
                                <div className="font-medium">
                                  当前 Skill 已不在最新智能体快照中
                                </div>
                                <div className="mt-1 leading-5">
                                  这个 Skill 仍然保留历史版本，可以继续查看、恢复到包内，或做历史审计。
                                </div>
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="rounded-[12px] border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                            暂无技能
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {selectedPackage && detailTab === 'versions' && (
                  <div className="space-y-5">
                    {/* 子标签切换：智能体版本 / Skill 版本 */}
                    <div className="inline-flex rounded-[12px] border border-border/70 bg-muted/40 p-0.5">
                      {([
                        { key: 'package' as const, label: '智能体版本' },
                        { key: 'skill' as const, label: 'Skill 版本' },
                      ]).map((tab) => (
                        <button
                          key={tab.key}
                          onClick={() => setVersionSubTab(tab.key)}
                          className={`rounded-[9px] px-3 py-1 text-xs font-medium transition-colors ${versionSubTab === tab.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>

                    {versionSubTab === 'package' && (
                    <>
                    {/* 卡 1: 版本对比 */}
                    {versions.length >= 2 && (
                      <div className="overflow-hidden rounded-[14px] border border-border/70 bg-card shadow-sm">
                        <div className="flex items-start justify-between gap-3 border-b border-border/70 px-4 py-3">
                          <div className="min-w-0 flex-1">
                            <div className="ec-eyebrow">COMPARE</div>
                            <h3 className="font-serif-display text-[15.5px] font-semibold leading-tight text-foreground">
                              版本对比
                            </h3>
                            <div className="ec-meta">
                              {compareResult
                                ? `v${compareResult.baseVersion.versionNumber} → v${compareResult.targetVersion.versionNumber}`
                                : '选择两个版本生成差异报告'}
                            </div>
                          </div>
                          {compareResult && (
                            <div className="ec-actions">
                              <button
                                onClick={() => {
                                  setCompareResult(null);
                                  setCompareBaseId('');
                                  setCompareTargetId('');
                                }}
                                className="ec-action"
                              >
                                清除对比
                              </button>
                            </div>
                          )}
                        </div>
                        <div className="space-y-3 p-4">
                          {!compareResult ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <select
                                className="min-w-0 flex-1 rounded-[10px] border border-border/70 bg-card px-2.5 py-1.5 text-xs"
                                value={compareBaseId}
                                onChange={(e) =>
                                  setCompareBaseId(e.target.value)
                                }
                              >
                                <option value="">选择基准版本</option>
                                {versions.map((v) => (
                                  <option key={v.id} value={v.id}>
                                    v{v.versionNumber} ({v.source})
                                  </option>
                                ))}
                              </select>
                              <span className="text-muted-foreground">
                                {'->'}
                              </span>
                              <select
                                className="min-w-0 flex-1 rounded-[10px] border border-border/70 bg-card px-2.5 py-1.5 text-xs"
                                value={compareTargetId}
                                onChange={(e) =>
                                  setCompareTargetId(e.target.value)
                                }
                              >
                                <option value="">选择目标版本</option>
                                {versions.map((v) => (
                                  <option key={v.id} value={v.id}>
                                    v{v.versionNumber} ({v.source})
                                  </option>
                                ))}
                              </select>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 shrink-0 text-[11px] rounded-[10px]"
                                disabled={
                                  !compareBaseId ||
                                  !compareTargetId ||
                                  compareBaseId === compareTargetId ||
                                  compareLoading
                                }
                                onClick={() => {
                                  if (
                                    !token ||
                                    !selectedPackageId ||
                                    !compareBaseId ||
                                    !compareTargetId
                                  )
                                    return;
                                  setCompareLoading(true);
                                  const currentPkgId = selectedPackageId;
                                  liteApi
                                    .compareVersions(
                                      token,
                                      currentPkgId,
                                      compareBaseId,
                                      compareTargetId,
                                    )
                                    .then((res) => {
                                      saveCompareState(
                                        currentPkgId,
                                        res,
                                        compareBaseId,
                                        compareTargetId,
                                      );
                                      if (
                                        selectedPackageIdRef.current ===
                                        currentPkgId
                                      ) {
                                        setCompareResult(res);
                                      }
                                    })
                                    .catch((err) => {
                                      alert(err.message || '对比失败');
                                    })
                                    .finally(() => {
                                      if (
                                        selectedPackageIdRef.current ===
                                        currentPkgId
                                      ) {
                                        setCompareLoading(false);
                                      }
                                    });
                                }}
                              >
                                {compareLoading ? '比较中...' : '比较'}
                              </Button>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between rounded-[10px] border border-primary/20 bg-primary/5 px-3 py-2 text-xs">
                                <div>
                                  <div className="font-medium">比较结果</div>
                                  <div className="text-muted-foreground">
                                    v{compareResult.baseVersion.versionNumber}{' '}
                                    {'->'}{' '}
                                    v{compareResult.targetVersion.versionNumber}
                                  </div>
                                </div>
                              </div>
                              <div className="rounded-[10px] border border-primary/15 bg-primary/5 px-3 py-2.5 text-xs">
                                <div className="mb-2 flex items-center gap-1.5 font-medium text-primary">
                                  <span className="inline-flex size-5 items-center justify-center rounded-md bg-primary/10 text-[10px]">
                                    AI
                                  </span>
                                  AI 总结
                                </div>
                                <div className="text-muted-foreground leading-relaxed">
                                  <MarkdownContent
                                    content={compareResult.summary || '暂无总结'}
                                  />
                                </div>
                              </div>
                              <VersionDiffView result={compareResult} />
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* 卡 2: 版本列表 */}
                    {!compareResult && (
                      <div className="overflow-hidden rounded-[14px] border border-border/70 bg-card shadow-sm">
                        <div className="flex items-start justify-between gap-3 border-b border-border/70 px-4 py-3">
                          <div className="min-w-0 flex-1">
                            <div className="ec-eyebrow">VERSIONS</div>
                            <h3 className="font-serif-display text-[15.5px] font-semibold leading-tight text-foreground">
                              版本记录
                            </h3>
                            <div className="ec-meta">
                              共 {versions.length} 个版本
                            </div>
                          </div>
                        </div>
                        <div className="space-y-1.5 p-3">
                          {versions.map((v) => {
                            const isCurrentVersion =
                              String(v.id) === currentPackageVersionId;
                            const rollbackPkgActionId = `pkg-rollback:${v.id}`;
                            const isPkgRollbackPending =
                              packageVersionActionPendingId ===
                              rollbackPkgActionId;
                            return (
                            <div
                              key={v.id}
                              className={`rounded-[12px] border px-3 py-2 text-xs transition-colors ${compareBaseId === v.id || compareTargetId === v.id ? 'border-primary/30 bg-primary/10' : 'border-border/70 bg-muted hover:border-primary/20 hover:bg-primary/5'}`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium">
                                  v{v.versionNumber}
                                </span>
                                {isCurrentVersion && (
                                  <Badge
                                    variant="outline"
                                    className="h-5 rounded-full border-primary/30 bg-primary/10 px-2 text-[10px] text-primary"
                                  >
                                    当前
                                  </Badge>
                                )}
                                {v.source === 'rollback' && (
                                  <Badge
                                    variant="outline"
                                    className="h-5 rounded-full px-2 text-[10px]"
                                  >
                                    回退创建
                                  </Badge>
                                )}
                                <span className="text-muted-foreground">
                                  {v.source}
                                </span>
                                <span className="text-muted-foreground">
                                  {new Date(v.createdAt).toLocaleString()}
                                </span>
                              </div>
                              <div className="mt-1.5">
                                {v.note ? (
                                  <button
                                    onClick={() =>
                                      handleUpdateNote(v.id, v.note || '')
                                    }
                                    className="text-left text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                                    title="点击编辑备注"
                                  >
                                    {`备注：${v.note}`}
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => handleUpdateNote(v.id, '')}
                                    className="text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                                    title="点击添加备注"
                                  >
                                    + 添加备注
                                  </button>
                                )}
                              </div>
                              {!isCurrentVersion && (
                                <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
                                  <button
                                    type="button"
                                    disabled={isPkgRollbackPending}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void handleRollbackPackageVersion(v);
                                    }}
                                    className="text-primary hover:underline disabled:pointer-events-none disabled:opacity-60"
                                  >
                                    {isPkgRollbackPending
                                      ? '处理中...'
                                      : '回退到此版本'}
                                  </button>
                                </div>
                              )}
                            </div>
                            );
                          })}
                          {versions.length === 0 && (
                            <div className="rounded-[12px] border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                              暂无版本记录
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    </>
                    )}

                    {versionSubTab === 'skill' && (
                      <div className="overflow-hidden rounded-[14px] border border-border/70 bg-card shadow-sm">
                        <div className="flex items-start justify-between gap-3 border-b border-border/70 px-4 py-3">
                          <div className="min-w-0 flex-1">
                            <div className="ec-eyebrow">SKILL HISTORY</div>
                            <h3 className="font-serif-display text-[15.5px] font-semibold leading-tight text-foreground">
                              Skill 历史版本
                            </h3>
                            <div className="ec-meta">
                              {selectedSkillRecord
                                ? `${selectedSkillRecord.name} · ${selectedSkillRecord.dirName}`
                                : '请先选择一个 Skill'}
                              <span className="ec-meta-sep">·</span>
                              {skillVersions.length} 个版本
                            </div>
                          </div>
                          <label className="inline-flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground cursor-pointer">
                            <input
                              type="checkbox"
                              checked={showDiscardedSkillVersions}
                              onChange={(e) =>
                                setShowDiscardedSkillVersions(e.target.checked)
                              }
                              className="size-3.5 rounded border-border/70"
                            />
                            显示已废弃
                          </label>
                        </div>
                        <div className="space-y-2 p-4">
                          {skillVersionsError && (
                            <div className="rounded-[10px] border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                              {skillVersionsError}
                            </div>
                          )}
                          {skillVersionsLoading ? (
                            <div className="flex items-center gap-2 rounded-[10px] border border-border/70 bg-muted px-3 py-3 text-xs text-muted-foreground">
                              <Loader2 className="size-3.5 animate-spin" />
                              正在加载 Skill 历史...
                            </div>
                          ) : skillVersions.length > 0 ? (
                            <>
                              <div className="space-y-1.5">
                                {skillVersions.map((version) => {
                                  const isCurrent =
                                    version.id === skillVersionsCurrentId;
                                  // 此版本是否为"被回退跳过"的最新版本（仅最新一个非当前 active 版本命中）
                                  const isRolledBackSkipped =
                                    version.id ===
                                    rolledBackSkippedSkillVersionId;
                                  const isSelected =
                                    version.id === selectedSkillVersion?.id;
                                  const rollbackActionId = selectedSkillRecord
                                    ? getSkillActionId(
                                        'rollback',
                                        selectedSkillRecord.id,
                                        version.id,
                                      )
                                    : '';
                                  const discardActionId = selectedSkillRecord
                                    ? getSkillActionId(
                                        'discard',
                                        selectedSkillRecord.id,
                                        version.id,
                                      )
                                    : '';
                                  const undiscardActionId = selectedSkillRecord
                                    ? getSkillActionId(
                                        'undiscard',
                                        selectedSkillRecord.id,
                                        version.id,
                                      )
                                    : '';
                                  const isPending =
                                    skillActionPendingId === rollbackActionId ||
                                    skillActionPendingId === discardActionId ||
                                    skillActionPendingId === undiscardActionId;
                                  return (
                                    <div
                                      key={version.id}
                                      role="button"
                                      tabIndex={0}
                                      onClick={() =>
                                        setSelectedSkillVersionId(version.id)
                                      }
                                      onKeyDown={(event) => {
                                        if (
                                          event.key === 'Enter' ||
                                          event.key === ' '
                                        ) {
                                          event.preventDefault();
                                          setSelectedSkillVersionId(version.id);
                                        }
                                      }}
                                      className={`w-full rounded-[12px] border px-3 py-2 text-left text-xs transition-colors ${isSelected ? 'border-primary/30 bg-primary/10' : 'border-border/70 bg-muted hover:border-primary/20 hover:bg-primary/5'}`}
                                    >
                                      <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div className="flex min-w-0 items-center gap-2">
                                          <span className="font-medium">
                                            v{version.versionNumber}
                                          </span>
                                          {isCurrent && (
                                            <Badge
                                              variant="outline"
                                              className="h-5 rounded-full border-primary/30 bg-primary/10 px-2 text-[10px] text-primary"
                                            >
                                              当前
                                            </Badge>
                                          )}
                                          {version.status === 'discarded' && (
                                            <Badge
                                              variant="outline"
                                              className="h-5 rounded-full border-amber-500/30 bg-amber-500/10 px-2 text-[10px] text-amber-700 dark:text-amber-300"
                                            >
                                              已废弃
                                            </Badge>
                                          )}
                                          {/* 被回退跳过：版本比当前更新，但被回退操作跳过（未作为当前版本） */}
                                          {isRolledBackSkipped && (
                                            <Badge
                                              variant="outline"
                                              title="此版本比当前版本新，但被回退操作跳过"
                                              className="h-5 rounded-full border-amber-500/50 bg-amber-500/20 px-2 text-[10px] text-amber-600 dark:text-amber-300"
                                            >
                                              被回退跳过
                                            </Badge>
                                          )}
                                          {version.source === 'rollback' && (
                                            <Badge
                                              variant="outline"
                                              className="h-5 rounded-full border-primary/30 bg-primary/10 px-2 text-[10px] text-primary"
                                            >
                                              回退创建
                                            </Badge>
                                          )}
                                        </div>
                                        <span className="text-muted-foreground">
                                          {new Date(
                                            version.createdAt,
                                          ).toLocaleString()}
                                        </span>
                                      </div>
                                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                                        <span>
                                          来源：
                                          {formatSkillVersionSourceLabel(
                                            version.source,
                                          )}
                                        </span>
                                        {version.note && (
                                          <span className="truncate">
                                            备注：{version.note}
                                          </span>
                                        )}
                                        {version.discardReason && (
                                          <span className="truncate">
                                            废弃原因：{version.discardReason}
                                          </span>
                                        )}
                                      </div>
                                      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
                                        <button
                                          type="button"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            setInteractiveMode(false);
                                            setRightExpanded(false);
                                            setCenterPreview({
                                              type: 'skill',
                                              name: `版本预览 v${version.versionNumber}`,
                                              content: version.skill.skillMd,
                                            });
                                          }}
                                          onKeyDown={(event) => {
                                            if (
                                              event.key === 'Enter' ||
                                              event.key === ' '
                                            ) {
                                              event.preventDefault();
                                              event.stopPropagation();
                                              setInteractiveMode(false);
                                              setRightExpanded(false);
                                              setCenterPreview({
                                                type: 'skill',
                                                name: `版本预览 v${version.versionNumber}`,
                                                content: version.skill.skillMd,
                                              });
                                            }
                                          }}
                                          className="text-primary hover:underline"
                                        >
                                          点击预览
                                        </button>
                                        {!isCurrent &&
                                          version.status === 'active' && (
                                            <>
                                              <button
                                                type="button"
                                                disabled={isPending}
                                                onClick={(event) => {
                                                  event.stopPropagation();
                                                  void handleRollbackSkillVersion(
                                                    version,
                                                  );
                                                }}
                                                onKeyDown={(event) => {
                                                  if (
                                                    event.key === 'Enter' ||
                                                    event.key === ' '
                                                  ) {
                                                    event.preventDefault();
                                                    event.stopPropagation();
                                                    void handleRollbackSkillVersion(
                                                      version,
                                                    );
                                                  }
                                                }}
                                                className="text-primary hover:underline disabled:pointer-events-none disabled:opacity-60"
                                              >
                                                {isPending
                                                  ? '处理中...'
                                                  : '回退到此版本'}
                                              </button>
                                              <button
                                                type="button"
                                                disabled={isPending}
                                                onClick={(event) => {
                                                  event.stopPropagation();
                                                  void handleDiscardSkillVersion(
                                                    version,
                                                  );
                                                }}
                                                onKeyDown={(event) => {
                                                  if (
                                                    event.key === 'Enter' ||
                                                    event.key === ' '
                                                  ) {
                                                    event.preventDefault();
                                                    event.stopPropagation();
                                                    void handleDiscardSkillVersion(
                                                      version,
                                                    );
                                                  }
                                                }}
                                                className="text-muted-foreground hover:text-foreground hover:underline disabled:pointer-events-none disabled:opacity-60"
                                              >
                                                废弃
                                              </button>
                                            </>
                                          )}
                                        {version.status === 'discarded' && (
                                          <button
                                            type="button"
                                            disabled={isPending}
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              void handleUndiscardSkillVersion(
                                                version,
                                              );
                                            }}
                                            onKeyDown={(event) => {
                                              if (
                                                event.key === 'Enter' ||
                                                event.key === ' '
                                              ) {
                                                event.preventDefault();
                                                event.stopPropagation();
                                                void handleUndiscardSkillVersion(
                                                  version,
                                                );
                                              }
                                            }}
                                            className="text-primary hover:underline disabled:pointer-events-none disabled:opacity-60"
                                          >
                                            {isPending ? '处理中...' : '恢复可用'}
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                              {selectedSkillVersion && (
                                <div className="space-y-2 rounded-[12px] border border-border/70 bg-muted/35 p-3">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="min-w-0">
                                      <div className="text-xs font-medium">
                                        版本预览 v{selectedSkillVersion.versionNumber}
                                      </div>
                                      <div className="mt-1 text-[11px] text-muted-foreground">
                                        {selectedSkillVersion.basedOnVersionId
                                          ? `基于历史版本 ${selectedSkillVersion.basedOnVersionId} 前向创建`
                                          : `来源：${formatSkillVersionSourceLabel(selectedSkillVersion.source)}`}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="max-h-[60vh] overflow-auto rounded-[14px] border border-border/70 bg-card/70 p-3">
                                    <SkillMarkdownContent
                                      content={selectedSkillVersion.skill.skillMd}
                                    />
                                  </div>
                                </div>
                              )}
                            </>
                          ) : (
                            <div className="rounded-[12px] border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                              {selectedSkillRecord
                                ? '这个 Skill 还没有历史版本记录'
                                : '请在上方先选择一个 Skill'}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {detailTab === 'report' &&
                  (report ? (
                    <div className="overflow-hidden rounded-[14px] border border-border/70 bg-card shadow-sm">
                      <div className="flex items-start justify-between gap-3 border-b border-border/70 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <div className="ec-eyebrow">EVALUATION</div>
                          <h3 className="font-serif-display text-[15.5px] font-semibold leading-tight text-foreground">
                            评估报告
                          </h3>
                          <div className="ec-meta">
                            基于当前 rubric 与对话生成
                          </div>
                        </div>
                        <div className="ec-actions">
                          <button
                            onClick={() => void handleReport()}
                            className="ec-action"
                          >
                            重新生成
                          </button>
                        </div>
                      </div>
                      <div className="space-y-3 p-4">
                        {(!rubricHasContent || rubricNeedsRepair) && (
                          <div className="rounded-[10px] border border-amber-500/25 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-900 dark:text-amber-200">
                            <div className="font-medium">
                              {rubricHasContent
                                ? '当前 rubric 将按现有内容参与评分'
                                : '当前还没有配置 rubric'}
                            </div>
                            <div className="mt-1 leading-5">
                              {reportHintMessage}
                            </div>
                          </div>
                        )}
                        {renderArenaReportView(report, true)}
                      </div>
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-[14px] border border-border/70 bg-card shadow-sm">
                      <div className="flex items-start justify-between gap-3 border-b border-border/70 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <div className="ec-eyebrow">EVALUATION</div>
                          <h3 className="font-serif-display text-[15.5px] font-semibold leading-tight text-foreground">
                            评估报告
                          </h3>
                          <div className="ec-meta">尚未生成</div>
                        </div>
                      </div>
                      <div className="p-4">
                        <div className="rounded-[12px] border border-dashed border-border bg-muted/35 p-5 text-sm space-y-3">
                          <div className="text-center">
                            <div className="mx-auto mb-3 flex size-9 items-center justify-center rounded-[10px] border border-border/70 bg-card font-serif-display text-base font-semibold text-primary">
                              R
                            </div>
                            <div className="font-medium text-foreground">
                              还没有生成报告
                            </div>
                            <div className="mt-1 text-[11.5px] text-muted-foreground">
                              完成至少一轮对话后即可基于 rubric 生成评估
                            </div>
                          </div>
                          {!rubricHasContent && (
                            <div className="rounded-[10px] border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
                              {rubricRequiredMessage}
                            </div>
                          )}
                          {rubricHasContent && !canGenerateReport && (
                            <div className="rounded-[10px] border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
                              {reportRequiredMessage}
                            </div>
                          )}
                          <div className="flex justify-center">
                            <Button
                              size="sm"
                              variant="default"
                              className="rounded-[8px]"
                              onClick={() => void handleReport()}
                              disabled={!canOpenReport}
                              title={
                                !rubricHasContent
                                  ? rubricRequiredMessage
                                  : !canGenerateReport
                                    ? reportRequiredMessage
                                    : '生成评估报告'
                              }
                            >
                              生成评估报告
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}

                {detailTab === 'optimization' &&
                  (optimization ? (
                    <div className="space-y-5">
                      <div className="overflow-hidden rounded-[14px] border border-border/70 bg-card shadow-sm">
                        <div className="flex items-start justify-between gap-3 border-b border-border/70 px-4 py-3">
                          <div className="min-w-0 flex-1">
                            <div className="ec-eyebrow">OPTIMIZATION</div>
                            <h3 className="font-serif-display text-[15.5px] font-semibold leading-tight text-foreground">
                              优化结果
                            </h3>
                            <div className="ec-meta">
                              新版本 v{optimization.versionNumber}
                              <span className="ec-meta-sep">·</span>
                              {optimization.issues.length} 项改进
                            </div>
                          </div>
                          <div className="ec-actions">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2.5 text-[11.5px] font-medium text-primary rounded-[6px] hover:bg-accent"
                              onClick={() => void startInteractive()}
                              disabled={
                                !thread || !rubricConfigured || replyGenerating
                              }
                              title={interactiveActionTitle}
                            >
                              交互式优化
                            </Button>
                          </div>
                        </div>
                        <div className="space-y-3 p-4">
                          {!rubricConfigured && (
                            <div className="rounded-[10px] border border-amber-500/25 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-900 dark:text-amber-200">
                              <div className="font-medium">
                                交互式优化暂不可用
                              </div>
                              <div className="mt-1 leading-5">
                                {rubricRequiredMessage}
                              </div>
                            </div>
                          )}
                          <div className="space-y-2">
                            {optimization.issues.map((issue, i) => (
                              <div
                                key={`${issue.expert}-${i}`}
                                className="rounded-[10px] border border-border/70 border-l-2 border-l-primary bg-card p-3 text-sm shadow-sm"
                              >
                                <div className="mb-1 flex flex-wrap items-center gap-2">
                                  <span className="inline-flex items-center rounded-[4px] bg-accent px-1.5 py-0.5 font-mono-meta text-[10px] uppercase tracking-wider text-primary">
                                    {formatExpert(issue.expert)}
                                  </span>
                                  <span className="font-mono-meta text-[10.5px] text-muted-foreground">
                                    → {formatTarget(issue.target)}
                                    {issue.targetId ? ` / ${issue.targetId}` : ''}
                                  </span>
                                </div>
                                <div className="font-medium text-foreground">
                                  {issue.title}
                                </div>
                                <div className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                                  {issue.reason}
                                </div>
                                {issue.evidence.length > 0 && (
                                  <div className="mt-1 text-xs text-muted-foreground">
                                    <strong>依据：</strong>
                                    {issue.evidence.join('; ')}
                                  </div>
                                )}
                              </div>
                            ))}
                            {optimization.issues.length === 0 && (
                              <div className="rounded-[10px] border border-dashed border-border bg-muted/35 px-4 py-4 text-center text-sm text-muted-foreground">
                                当前没有额外优化项
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      {optimization && selectedPackage && (
                        <div className="overflow-hidden rounded-[14px] border border-border/70 bg-card shadow-sm">
                          <div className="flex items-start justify-between gap-3 border-b border-border/70 px-4 py-3">
                            <div className="min-w-0 flex-1">
                              <div className="ec-eyebrow">DIFF</div>
                              <h3 className="font-serif-display text-[15.5px] font-semibold leading-tight text-foreground">
                                优化对比
                              </h3>
                              <div className="ec-meta">
                                原版本 → v{optimization.versionNumber}
                              </div>
                            </div>
                          </div>
                          <div className="p-4">
                            <OptimizationDiffView
                              oldSnapshot={selectedPackage.snapshot}
                              optimization={optimization}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-[14px] border border-border/70 bg-card shadow-sm">
                      <div className="flex items-start justify-between gap-3 border-b border-border/70 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <div className="ec-eyebrow">OPTIMIZATION</div>
                          <h3 className="font-serif-display text-[15.5px] font-semibold leading-tight text-foreground">
                            优化
                          </h3>
                          <div className="ec-meta">尚未进行交互式优化</div>
                        </div>
                      </div>
                      <div className="p-4">
                        <div className="rounded-[12px] border border-dashed border-border bg-muted/35 p-5 text-sm space-y-3">
                          <div className="text-center">
                            <div className="mx-auto mb-3 flex size-9 items-center justify-center rounded-[10px] border border-border/70 bg-card font-serif-display text-base font-semibold text-primary">
                              O
                            </div>
                            <div className="font-medium text-foreground">
                              还没有进行交互式优化
                            </div>
                            <div className="mt-1 text-[11.5px] text-muted-foreground">
                              配置 rubric 后即可开始多专家协作优化
                            </div>
                          </div>
                          {!rubricConfigured && (
                            <div className="rounded-[10px] border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
                              {rubricRequiredMessage}
                            </div>
                          )}
                          <div className="flex justify-center">
                            <Button
                              size="sm"
                              variant="default"
                              className="rounded-[8px]"
                              onClick={() => void startInteractive()}
                              disabled={
                                !thread || !rubricConfigured || replyGenerating
                              }
                              title={interactiveActionTitle}
                            >
                              开始交互式优化
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}

                {detailTab === 'diff' &&
                  (optimization && selectedPackage ? (
                    <div className="overflow-hidden rounded-[14px] border border-border/70 bg-card shadow-sm">
                      <div className="flex items-start justify-between gap-3 border-b border-border/70 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <div className="ec-eyebrow">DIFF</div>
                          <h3 className="font-serif-display text-[15.5px] font-semibold leading-tight text-foreground">
                            优化对比
                          </h3>
                          <div className="ec-meta">
                            原版本 → v{optimization.versionNumber}
                          </div>
                        </div>
                      </div>
                      <div className="p-4">
                        <OptimizationDiffView
                          oldSnapshot={selectedPackage.snapshot}
                          optimization={optimization}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-[14px] border border-border/70 bg-card shadow-sm">
                      <div className="flex items-start justify-between gap-3 border-b border-border/70 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <div className="ec-eyebrow">DIFF</div>
                          <h3 className="font-serif-display text-[15.5px] font-semibold leading-tight text-foreground">
                            优化对比
                          </h3>
                          <div className="ec-meta">尚未执行优化</div>
                        </div>
                      </div>
                      <div className="p-4">
                        <div className="rounded-[12px] border border-dashed border-border bg-muted/35 px-5 py-6 text-center text-sm text-muted-foreground">
                          还没有执行优化
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </aside>
        </>
      ) : (
        <div className="absolute right-2 top-2 z-10 flex h-9 w-9 flex-col items-center justify-center rounded-xl border border-border/70 bg-card/90 shadow-sm backdrop-blur lg:relative lg:inset-y-0 lg:right-auto lg:top-auto lg:z-auto lg:h-auto lg:w-8 lg:justify-start lg:rounded-none lg:border-y-0 lg:border-r-0 lg:border-l lg:bg-card/40 lg:py-3 lg:shadow-none lg:backdrop-blur-0">
          <button
            onClick={() => setRightSidebarOpen(true)}
            className="flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="展开右侧面板"
          >
            <PanelRightOpen className="size-4" />
          </button>
        </div>
      )}
      <AnswerSkillOptimizationDialog
        open={answerOptimizationOpen}
        token={token}
        target={answerOptimizationTarget}
        onOpenChange={setAnswerOptimizationOpen}
        onSummaryChanged={refreshAnswerOptimizationSummaries}
        onConfirmed={handleAnswerOptimizationConfirmed}
      />
    </div>
  );
}
