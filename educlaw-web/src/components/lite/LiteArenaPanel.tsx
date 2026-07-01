import {
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import type {
  AgentPackageDetail,
  AgentPackageSummary,
  ArenaMessage,
  ArenaReport,
  ArenaThread,
  ArenaThreadDetail,
  OptimizationResult,
  PackageVersion,
} from '@educlaw/shared';
import type {
  DiagnosisIssue,
  AdoptedChange,
  VersionCompareResult,
  LineDiff,
  InteractiveOptimizationSession,
  ArenaMode,
} from '../../api/lite-api';
import { computeLineDiff } from '../../api/lite-api';
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
} from 'lucide-react';

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

export default function LiteArenaPanel() {
  const token = useAuthStore((s) => s.token) || '';
  const authUser = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [packages, setPackages] = useState<AgentPackageSummary[]>([]);
  const [selectedPackageId, setSelectedPackageId] = useState('');
  const [selectedPackage, setSelectedPackage] =
    useState<AgentPackageDetail | null>(null);
  const [versions, setVersions] = useState<PackageVersion[]>([]);
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
  const [rightSidebarOpen, setRightSidebarOpen] = useState(prefersWideLayout);
  const [leftWidth, setLeftWidth] = useState(400);
  const [rightWidth, setRightWidth] = useState(450);
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

  const messages = threadDetail?.messages || [];
  const selectedSkill =
    selectedPackage?.snapshot.skills.find(
      (s) => (s.id || s.dirName) === selectedSkillId,
    ) ||
    selectedPackage?.snapshot.skills[0] ||
    null;
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
  const canOpenReport = canOpenReportAction(Boolean(thread), rubricConfigured);
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
  const detailStyle = { '--detail-width': `${rightWidth}px` } as CSSProperties;

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
        setRightSidebarOpen(false);
      }
    };
    syncLayout();
    media.addEventListener('change', syncLayout);
    return () => media.removeEventListener('change', syncLayout);
  }, []);
  useEffect(() => {
    if (selectedPackage?.snapshot.skills.length)
      setSelectedSkillId((c) => c || selectedPackage.snapshot.skills[0]!.id);
    else setSelectedSkillId('');
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

  const openPackage = useCallback(
    async (packageId: string, snapshotList?: AgentPackageSummary[]) => {
      if (!token || !packageId) return;
      selectedPackageIdRef.current = packageId;
      setSelectedPackageId(packageId);
      const detail = await liteApi.getPackage(token, packageId);
      const versionList = await liteApi.listVersions(token, packageId);
      const threads = await liteApi.listThreads(token, packageId);
      const activeThread =
        threads[0] || (await liteApi.createThread(token, packageId));
      const activeDetail = await liteApi.getThread(token, activeThread.id);
      if (selectedPackageIdRef.current === packageId) {
        setSelectedPackage(detail);
        setVersions(versionList);
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
          const detail = await liteApi.getPackage(token, nextId);
          const versionList = await liteApi.listVersions(token, nextId);
          if (selectedPackageIdRef.current === nextId) {
            setSelectedPackage(detail);
            setVersions(versionList);
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
      setInteractiveMode(false);
      setHasSavedSession(false);
      setInteractiveSessionId('');
      setInteractiveSessions([]);
      setInteractiveMessages([]);
      setInteractiveAdopted([]);
      setInteractiveIssues([]);
      return;
    }
    setInteractiveMode(false);
    setHasSavedSession(false);
    setInteractiveSessionId('');
    setInteractiveSessions([]);
    setInteractiveMessages([]);
    setInteractiveAdopted([]);
    setInteractiveIssues([]);
    void loadInteractiveSessions(selectedPackageId, false);
  }, [loadInteractiveSessions, selectedPackageId, token]);

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
    selectedPackageIdRef.current = '';
    setSelectedPackageId('');
    setSelectedPackage(null);
    setThread(null);
    setThreadDetail(null);
    setVersions([]);
    setReport(null);
    setOptimization(null);
    setCompareResult(null);
    setCompareBaseId('');
    setCompareTargetId('');
    setSelectedSkillId('');
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
    const startX = e.clientX;
    const startWidth = rightWidth;
    function onMove(moveEvent: MouseEvent) {
      const delta = startX - moveEvent.clientX;
      setRightWidth(Math.max(200, Math.min(450, startWidth + delta)));
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
        ? `\u6b63\u5728\u9010\u4e2a\u5904\u7406 ${jobDocuments.length} \u4e2a\u6587\u6863...`
        : '\u6b63\u5728\u751f\u6210\u667a\u80fd\u4f53...',
    );
    setStatus(
      batchMode
        ? `\u6b63\u5728\u9010\u4e2a\u5904\u7406 ${jobDocuments.length} \u4e2a\u6587\u6863...`
        : '\u6b63\u5728\u751f\u6210\u667a\u80fd\u4f53...',
    );
    setGeneratePreviews([]);

    try {
      const runGenerateJob = async (
        docs: Array<{ name: string; content: string }>,
      ) => {
        let createdId = '';
        let createdName = '';
        setGeneratePreviews([]);
        await liteApi.generatePackageStream(
          token,
          instructionText,
          undefined,
          docs,
          (event) => {
            if (event.event === 'phase') {
              pushProgress(event.data.label);
              setStatus(event.data.label);
            }
            if (event.event === 'preview_delta') {
              setGeneratePreviews((prev) =>
                appendPackagePreviewDelta(prev, event.data),
              );
            }
            if (event.event === 'preview') {
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
        for (let index = 0; index < batchPlan.length; index += 1) {
          const item = batchPlan[index]!;
          const sourceDoc = jobDocuments[index]!;
          updateBatchRun(item.id, { status: 'running' });
          setStatus(`正在生成 ${sourceDoc.name}...`);
          try {
            const result = await runGenerateJob([sourceDoc]);
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
        thread: threadDetail.thread,
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

  function openReportPreview(currentReport: ArenaReport | null) {
    if (!currentReport) return;
    setDetailTab('report');
    setCenterPreview({
      type: 'report',
      name: '评估报告',
      report: currentReport,
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
      const frontmatter = content.match(/^---\s*\n([\s\S]*?)\n---/);
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
      return;
    }
    const defaultNote =
      manualEdit.target === 'agent'
        ? '\u624b\u52a8\u7f16\u8f91 agent.md'
        : manualEdit.target === 'rubric'
          ? '\u624b\u52a8\u7f16\u8f91 rubric.md'
          : '\u624b\u52a8\u7f16\u8f91 SKILL.md';
    const note = window.prompt(
      '\u8bf7\u8f93\u5165\u65b0\u7248\u672c\u5907\u6ce8\uff08\u53ef\u9009\uff09\uff1a',
      defaultNote,
    );
    if (note === null) return;

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
          content: manualEdit.content,
          note,
        },
      );
      setSelectedPackage(detail);
      await refreshPackages(detail.id);
      setManualEdit(null);
      setDetailTab('versions');
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
    } finally {
      setManualEditSaving(false);
    }
  }

  async function startInteractive(forceNew = false) {
    if (!token || !thread?.id || !selectedPackageId) return;
    if (replyGenerating) {
      setStatus(interactiveRequiredMessage);
      return;
    }
    if (!ensureRubricConfigured('\u4ea4\u4e92\u5f0f\u4f18\u5316')) return;
    setInteractiveMode(true);
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
        setInteractiveSessionId(result.session.id);
        setInteractiveSessions((prev) => [
          result.session!,
          ...prev.filter((session) => session.id !== result.session!.id),
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
        setInteractiveSessionId(result.session.id);
        setInteractiveSessions((prev) => [
          result.session!,
          ...prev.filter((session) => session.id !== result.session!.id),
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
        setDetailTab('optimization');
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

  function buildDiffMarkdown(result: VersionCompareResult): string {
    const lines: string[] = [
      `# 版本对比：v${result.baseVersion.versionNumber} -> v${result.targetVersion.versionNumber}`,
      '',
      '## AI 总结',
      '',
      result.summary || '暂无总结',
      '',
      '---',
      '',
    ];
    const pushDiff = (title: string, diffs: LineDiff[]) => {
      const changes = diffs.filter((d) => d.type !== 'same');
      if (changes.length === 0) return;
      lines.push(`## ${title}`);
      lines.push('```diff');
      for (const d of diffs) {
        if (d.type === 'same') lines.push(` ${d.text}`);
        else if (d.type === 'removed') lines.push(`-${d.text}`);
        else if (d.type === 'added') lines.push(`+${d.text}`);
      }
      lines.push('```');
      lines.push('');
    };
    pushDiff('agent.md', result.diffs.agentMd);
    pushDiff('rubric.md', result.diffs.rubricMd);
    for (const skill of result.diffs.skills) {
      pushDiff(`${skill.name} (${skill.dirName})`, skill.diff);
    }
    return lines.join('\n');
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
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="rounded-[18px] border border-primary/20 bg-primary/5 px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                修改位置
              </div>
              <div className="mt-1 text-base font-semibold">
                {formatAdoptedTarget(preview.change)}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                {preview.change.reason}
              </div>
            </div>
            <div className="flex shrink-0 gap-2 text-xs">
              <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-emerald-700 dark:text-emerald-300">
                新增 {addedCount} 行
              </span>
              <span className="rounded-full border border-destructive/20 bg-destructive/10 px-2.5 py-1 text-destructive">
                删除 {removedCount} 行
              </span>
            </div>
          </div>
        </div>
        <div className="overflow-hidden rounded-[18px] border border-border/70 bg-card/80">
          <div className="border-b border-border/70 bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
            修改痕迹
          </div>
          <div className="overflow-auto text-xs font-mono leading-5">
            {rows.map((row, index) => {
              if (row.type === 'gap') {
                return (
                  <div
                    key={`gap-${index}`}
                    className="select-none border-y border-border/50 bg-muted/30 px-4 py-1 text-center text-muted-foreground"
                  >
                    ...
                  </div>
                );
              }
              const prefix =
                row.diff.type === 'added'
                  ? '+'
                  : row.diff.type === 'removed'
                    ? '-'
                    : ' ';
              const lineClass =
                row.diff.type === 'added'
                  ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
                  : row.diff.type === 'removed'
                    ? 'bg-destructive/10 text-destructive'
                    : 'text-muted-foreground';
              return (
                <div
                  key={`${row.index}-${index}`}
                  className={`flex min-w-max gap-3 px-4 py-0.5 ${lineClass}`}
                >
                  <span className="w-8 shrink-0 select-none text-right opacity-60">
                    {row.index + 1}
                  </span>
                  <span className="w-4 shrink-0 select-none">{prefix}</span>
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
    const enhancedLabel = selectedPackage?.name || 'Enhanced';
    const winnerLabel = formatArenaReportWinner(
      currentReport.winningSide,
      enhancedLabel,
    );
    const sideCards = buildArenaReportSideCards(currentReport, enhancedLabel);
    const titleClass = compact ? 'text-lg' : 'text-xl';

    return (
      <div className={compact ? 'space-y-4' : 'mx-auto max-w-5xl space-y-5'}>
        <section className="rounded-[16px] border border-border/70 bg-card/90 px-4 py-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                评估报告
              </div>
              <div
                className={`mt-1 font-semibold text-foreground ${titleClass}`}
              >
                {winnerLabel}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {sideCards.map((card) => (
                <div
                  key={card.key}
                  className="min-w-[108px] rounded-[14px] border border-border/70 bg-muted/30 px-3 py-2.5 text-right"
                >
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {card.label}
                  </div>
                  <div className="mt-1 text-lg font-bold leading-none text-foreground">
                    {card.total.toFixed(2)}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <div className="rounded-[14px] border border-border/60 bg-muted/20 px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                综合判断
              </div>
              <div className="mt-2 text-sm leading-6 text-foreground">
                {currentReport.recommendation ||
                  '\u6682\u65e0\u7efc\u5408\u5224\u65ad\u3002'}
              </div>
            </div>
            <div className="rounded-[14px] border border-border/60 bg-muted/20 px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                阅读方式
              </div>
              <div className="mt-2 text-sm leading-6 text-muted-foreground">
                先看两边的整体总结，再对照每个维度的分数和理由，就能比较快地判断当前智能体哪里更强、下一步该补哪里。
              </div>
              {!rubricConfigured && (
                <div className="mt-3 rounded-[14px] border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-800 dark:text-amber-200">
                  {reportHintMessage}
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          {sideCards.map((card) => (
            <article
              key={card.key}
              className="rounded-[16px] border border-border/70 bg-card/90 px-4 py-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    {card.key === 'baseline' ? '基础回答' : '增强回答'}
                  </div>
                  <div className="mt-1 text-sm font-medium text-foreground">
                    {card.label}
                  </div>
                </div>
              </div>
              <div className="mt-3 rounded-[14px] border border-border/60 bg-muted/20 px-4 py-3 text-sm leading-6 text-foreground">
                {card.summary || '\u6682\u65e0\u8bc4\u4ef7\u3002'}
              </div>
            </article>
          ))}
        </section>

        <section className="overflow-hidden rounded-[16px] border border-border/70 bg-card/90 shadow-sm">
          <div className="border-b border-border/70 bg-muted/35 px-4 py-3">
            <div className="text-sm font-medium text-foreground">
              维度逐项对比
            </div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">
              分数告诉你差距，理由告诉你为什么会有这个差距。
            </div>
          </div>
          <div className="divide-y divide-border/70">
            {rows.map((row) => (
              <div key={row.key} className="px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-medium text-foreground">
                      {row.name}
                    </div>
                    {!compact && (
                      <div className="mt-1 text-xs leading-5 text-muted-foreground">
                        {row.key}
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-3 grid gap-4 lg:grid-cols-2">
                  <article className="rounded-[14px] border border-border/60 bg-muted/20 px-3 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        基础回答
                      </div>
                      <div className="rounded-full border border-border/80 bg-background/85 px-2.5 py-1 text-sm font-semibold text-foreground">
                        {row.baselineScore}/{row.baselineMaxScore}
                      </div>
                    </div>
                    <div className="mt-2 text-sm leading-6 text-muted-foreground">
                      {row.baselineReason || '\u6682\u65e0\u8bf4\u660e\u3002'}
                    </div>
                  </article>
                  <article className="rounded-[14px] border border-primary/15 bg-primary/5 px-3 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        增强回答
                      </div>
                      <div className="rounded-full border border-primary/20 bg-background/90 px-2.5 py-1 text-sm font-semibold text-foreground">
                        {row.enhancedScore}/{row.enhancedMaxScore}
                      </div>
                    </div>
                    <div className="mt-2 text-sm leading-6 text-muted-foreground">
                      {row.enhancedReason || '\u6682\u65e0\u8bf4\u660e\u3002'}
                    </div>
                  </article>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 w-full overflow-hidden">
      {!isWideLayout && (sidebarOpen || rightSidebarOpen) && (
        <button
          type="button"
          aria-label="关闭面板"
          className="absolute inset-0 z-20 bg-background/60 backdrop-blur-sm lg:hidden"
          onClick={() => {
            setSidebarOpen(false);
            setRightSidebarOpen(false);
          }}
        />
      )}
      {/* Sidebar */}
      {sidebarOpen ? (
        <>
          <aside
            style={sidebarStyle}
            className="absolute inset-y-0 left-0 z-30 flex w-[min(22rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] flex-col border-r border-border/70 bg-card/95 shadow-xl backdrop-blur lg:relative lg:z-auto lg:w-[var(--sidebar-width)] lg:max-w-none lg:bg-card/40 lg:shadow-none lg:backdrop-blur-0"
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
              <div className="space-y-4 p-4">
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
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
                          className="flex items-center justify-between rounded-lg border border-border/70 bg-card/60 px-2.5 py-1.5 text-xs"
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <FileText className="size-3 shrink-0 text-muted-foreground" />
                            <span className="truncate">{doc.name}</span>
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
                      多文档会逐个生成，不会合并成一个包。
                    </div>
                  )}
                  {batchRuns.length > 0 && (
                    <div className="space-y-1.5 rounded-xl border border-border/70 bg-card/40 p-2">
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
                          className="flex items-start justify-between gap-3 rounded-lg border border-border/70 bg-card/70 px-2.5 py-2 text-xs"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium">
                              {item.name}
                            </div>
                            {item.packageName &&
                              item.packageName !== item.name && (
                                <div className="truncate text-[11px] text-muted-foreground">
                                  {`生成结果：${item.packageName}`}
                                </div>
                              )}
                            {item.error && (
                              <div className="truncate text-[11px] text-destructive">
                                {item.error}
                              </div>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
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
                  <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    仓库 ({packages.length})
                  </div>
                  <div className="space-y-1.5">
                    {packages.map((pkg) => (
                      <div
                        key={pkg.id}
                        className={`flex w-full items-center gap-2 rounded-xl border px-2 py-2 transition-colors ${pkg.id === selectedPackageId ? 'border-primary/30 bg-primary/5' : 'border-transparent hover:bg-muted'}`}
                      >
                        <button
                          onClick={() => void openPackage(pkg.id)}
                          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                        >
                          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary font-bold text-xs">
                            {pkg.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">
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
                          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                          title="\u91cd\u547d\u540d"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                      </div>
                    ))}
                    {packages.length === 0 && (
                      <div className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
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
      <main className="flex min-w-0 flex-1 flex-col bg-card/20">
        {manualEdit ? (
          <>
            <div className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-card/40 px-14 py-2 lg:px-5">
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
                  保存为新版本
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
                <div className="h-full overflow-auto rounded-[18px] border border-border/70 bg-card/70 p-5 text-sm">
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
                  className="h-full min-h-[520px] resize-none rounded-[18px] border-border/70 bg-card/80 font-mono text-xs leading-5"
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
                      className="rounded-[18px] border border-border/70 bg-card/70 p-4 text-sm"
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
                      className="block w-full rounded-[18px] border border-border/70 bg-card/70 p-4 text-left text-sm hover:border-primary/30 hover:bg-primary/5"
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
                      className={`block w-full rounded-[18px] border p-4 text-left text-sm transition-colors ${interactiveSessionId === session.id ? 'border-primary/30 bg-primary/5' : 'border-border/70 bg-card/70 hover:border-primary/25'}`}
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
                  <div className="rounded-[20px] border border-border/70 bg-muted/50 p-5 text-sm">
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
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex min-w-0 items-center gap-1.5">
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
                </div>
                <div className="hidden text-xs text-muted-foreground sm:block">
                  输入问题，测试智能体效果
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <div className="inline-flex rounded-[12px] border border-border/70 bg-muted/40 p-0.5">
                  {[
                    { key: 'compare' as const, label: '\u5bf9\u6bd4' },
                    { key: 'agent' as const, label: '\u667a\u80fd\u4f53' },
                    { key: 'baseline' as const, label: '\u57fa\u7840' },
                  ].map((mode) => (
                    <button
                      key={mode.key}
                      onClick={() => setArenaMode(mode.key)}
                      className={`rounded-[9px] px-2.5 py-1 text-xs font-medium transition-colors ${arenaMode === mode.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-[12px]"
                  onClick={() => void handleReport()}
                  disabled={!canOpenReport}
                  title={
                    !rubricConfigured
                      ? rubricRequiredMessage
                      : !canGenerateReport
                        ? reportRequiredMessage
                        : '生成评估报告'
                  }
                >
                  <BarChart3 className="mr-1.5 size-3.5" />
                  评估报告
                </Button>
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
              </div>
            </div>

            {progress && (
              <div
                className={`mx-5 mt-3 rounded-[20px] border px-5 py-3 ${progress.isError ? 'border-destructive/20 bg-destructive/5' : progress.active ? 'border-primary/15 bg-primary/5' : 'border-emerald-500/15 bg-emerald-500/5'}`}
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

            <div className="flex-1 overflow-auto">
              <ConversationBoard
                messages={messages}
                sideStreaming={sideStreaming}
                packageName={selectedPackage?.name}
                mode={arenaMode}
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
      {rightSidebarOpen ? (
        <>
          <div
            className="hidden w-1 shrink-0 cursor-col-resize bg-border/30 transition-all hover:w-1.5 hover:bg-primary/30 lg:block"
            onMouseDown={startResizeRight}
          />
          <aside
            style={detailStyle}
            className="absolute inset-y-0 right-0 z-30 flex w-[min(24rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] flex-col border-l border-border/70 bg-card/95 shadow-xl backdrop-blur lg:relative lg:z-auto lg:w-[var(--detail-width)] lg:max-w-none lg:bg-card/40 lg:shadow-none lg:backdrop-blur-0"
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
                  onClick={() => setRightSidebarOpen(false)}
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
                { key: 'report' as DetailTab, label: '报告', icon: BarChart3 },
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
                  className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition-colors ${detailTab === tab.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
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
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        agent.md
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={startManualEditAgent}
                          className="text-[10px] text-primary hover:underline"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() =>
                            setCenterPreview({
                              type: 'agent',
                              name: 'agent.md',
                              content: selectedPackage.snapshot.agentMd,
                            })
                          }
                          className="text-[10px] text-primary hover:underline"
                        >
                          在中间打开
                        </button>
                      </div>
                    </div>
                    <div
                      className="rounded-[20px] border border-border/70 bg-muted/50 p-4 text-sm cursor-pointer hover:border-primary/30 transition-colors overflow-auto max-h-[60vh]"
                      onClick={() =>
                        setCenterPreview({
                          type: 'agent',
                          name: 'agent.md',
                          content: selectedPackage.snapshot.agentMd,
                        })
                      }
                    >
                      <MarkdownContent
                        content={selectedPackage.snapshot.agentMd}
                      />
                    </div>
                  </div>
                )}

                {selectedPackage && detailTab === 'rubric' && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        rubric.md
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => startManualEditRubric()}
                          className="text-[10px] text-primary hover:underline"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => rubricFileRef.current?.click()}
                          className="text-[10px] text-primary hover:underline"
                        >
                          导入文件
                        </button>
                        <button
                          onClick={() =>
                            rubricHasContent &&
                            setCenterPreview({
                              type: 'rubric',
                              name: 'rubric.md',
                              content: rubricPreviewContent,
                            })
                          }
                          disabled={!rubricHasContent}
                          className="text-[10px] text-primary hover:underline disabled:pointer-events-none disabled:text-muted-foreground/70 disabled:no-underline"
                        >
                          在中间打开
                        </button>
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
                    {rubricHasContent ? (
                      <div className="space-y-3">
                        {rubricNeedsRepair && (
                          <div className="rounded-[18px] border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
                            <div className="font-medium">
                              当前 rubric 会按现有内容参与评分
                            </div>
                            <div className="mt-1 text-xs leading-5">
                              当前内容已经保留下来了。现在可以直接生成报告；如果想让评分更稳定，可以继续手动补充维度、权重或等级说明。
                            </div>
                          </div>
                        )}
                        <div
                          className="rounded-[20px] border border-border/70 bg-muted/50 p-4 text-sm cursor-pointer hover:border-primary/30 transition-colors overflow-auto max-h-[60vh]"
                          onClick={() =>
                            setCenterPreview({
                              type: 'rubric',
                              name: 'rubric.md',
                              content: rubricPreviewContent,
                            })
                          }
                        >
                          <RubricStructuredView content={rubricDisplayText} />
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-[20px] border border-dashed border-border bg-muted/35 p-4 text-sm">
                        <div className="font-medium text-foreground">
                          当前还没有配置 rubric
                        </div>
                        <div className="mt-2 leading-6 text-muted-foreground">
                          这里保留手动编辑和导入文件两种方式。补好 rubric
                          之后，就能直接生成评估报告；交互式优化仍建议使用结构更完整的
                          rubric。
                        </div>
                        <div className="mt-4 rounded-[16px] border border-border/70 bg-card/70 p-3 text-xs leading-5 text-muted-foreground">
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
                )}
                {selectedPackage && detailTab === 'skills' && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        技能文件
                      </div>
                      {selectedSkill && (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={startManualEditSkill}
                            className="text-[10px] text-primary hover:underline"
                          >
                            编辑
                          </button>
                          <button
                            onClick={() =>
                              setCenterPreview({
                                type: 'skill',
                                name: selectedSkill.name,
                                content: selectedSkill.skillMd,
                              })
                            }
                            className="text-[10px] text-primary hover:underline"
                          >
                            在中间打开
                          </button>
                        </div>
                      )}
                    </div>
                    {selectedPackage.snapshot.skills.length > 0 ? (
                      <>
                        <div className="flex gap-1.5 overflow-x-auto pb-1">
                          {selectedPackage.snapshot.skills.map((skill) => (
                            <button
                              key={skill.id || skill.dirName}
                              onClick={() =>
                                setSelectedSkillId(skill.id || skill.dirName)
                              }
                              className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors ${selectedSkillId === (skill.id || skill.dirName) ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
                            >
                              {skill.name}
                            </button>
                          ))}
                        </div>
                        <div
                          className="rounded-[20px] border border-border/70 bg-muted/50 p-4 text-sm cursor-pointer hover:border-primary/30 transition-colors overflow-auto max-h-[60vh]"
                          onClick={() =>
                            selectedSkill &&
                            setCenterPreview({
                              type: 'skill',
                              name: selectedSkill.name,
                              content: selectedSkill.skillMd,
                            })
                          }
                        >
                          <SkillMarkdownContent
                            content={
                              selectedSkill?.skillMd ||
                              '\u6682\u65e0\u6280\u80fd\u5185\u5bb9'
                            }
                          />
                        </div>
                      </>
                    ) : (
                      <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                        暂无技能文件
                      </div>
                    )}
                  </div>
                )}

                {selectedPackage && detailTab === 'versions' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        版本记录
                      </div>
                      {compareResult && (
                        <button
                          onClick={() => {
                            setCompareResult(null);
                            setCompareBaseId('');
                            setCompareTargetId('');
                          }}
                          className="text-[10px] text-primary hover:underline"
                        >
                          清除对比
                        </button>
                      )}
                    </div>

                    {/* Compare controls */}
                    {versions.length >= 2 && !compareResult && (
                      <div className="flex flex-wrap items-center gap-2 text-[10px]">
                        <select
                          className="min-w-0 flex-1 rounded-lg border border-border/70 bg-muted/50 px-2 py-1 text-xs"
                          value={compareBaseId}
                          onChange={(e) => setCompareBaseId(e.target.value)}
                        >
                          <option value="">选择基准版本</option>
                          {versions.map((v) => (
                            <option key={v.id} value={v.id}>
                              v{v.versionNumber} ({v.source})
                            </option>
                          ))}
                        </select>
                        <span className="text-muted-foreground">{'->'}</span>
                        <select
                          className="min-w-0 flex-1 rounded-lg border border-border/70 bg-muted/50 px-2 py-1 text-xs"
                          value={compareTargetId}
                          onChange={(e) => setCompareTargetId(e.target.value)}
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
                          className="h-7 text-[10px] rounded-[8px]"
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
                                  selectedPackageIdRef.current === currentPkgId
                                ) {
                                  setCompareResult(res);
                                }
                              })
                              .catch((err) => {
                                alert(err.message || '对比失败');
                              })
                              .finally(() => {
                                if (
                                  selectedPackageIdRef.current === currentPkgId
                                ) {
                                  setCompareLoading(false);
                                }
                              });
                          }}
                        >
                          {compareLoading ? '比较中...' : '比较'}
                        </Button>
                      </div>
                    )}

                    {/* Compare result */}
                    {compareResult && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs">
                          <div>
                            <div className="font-medium">比较结果</div>
                            <div className="text-muted-foreground">
                              v{compareResult.baseVersion.versionNumber} {'->'}{' '}
                              v{compareResult.targetVersion.versionNumber}
                            </div>
                          </div>
                          <button
                            onClick={() =>
                              setCenterPreview({
                                type: 'diff',
                                name: '版本对比',
                                content: buildDiffMarkdown(compareResult),
                              })
                            }
                            className="text-[10px] text-primary hover:underline"
                          >
                            在中间打开
                          </button>
                        </div>
                        <div className="rounded-lg border border-primary/15 bg-primary/5 px-3 py-2.5 text-xs">
                          <div className="flex items-center gap-1.5 font-medium text-primary mb-2">
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

                    {/* Version list */}
                    {!compareResult && (
                      <div className="space-y-1.5">
                        {versions.map((v) => (
                          <div
                            key={v.id}
                            className={`rounded-lg border px-3 py-2 text-xs ${compareBaseId === v.id || compareTargetId === v.id ? 'border-primary/30 bg-primary/5' : 'border-border/70 bg-muted/50'}`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-medium">
                                v{v.versionNumber}
                              </span>
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
                          </div>
                        ))}
                        {versions.length === 0 && (
                          <div className="text-center text-sm text-muted-foreground py-4">
                            暂无版本记录
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {detailTab === 'report' &&
                  (report ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                          评估报告
                        </div>
                        <button
                          onClick={() => void handleReport()}
                          className="text-[10px] text-primary hover:underline"
                        >
                          重新生成
                        </button>
                        <button
                          onClick={() => openReportPreview(report)}
                          className="text-[10px] text-primary hover:underline"
                        >
                          在中间打开
                        </button>
                      </div>
                      {(!rubricHasContent || rubricNeedsRepair) && (
                        <div className="rounded-[18px] border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
                          <div className="font-medium">
                            {rubricHasContent
                              ? '当前 rubric 将按现有内容参与评分'
                              : '当前还没有配置 rubric'}
                          </div>
                          <div className="mt-1 text-xs leading-5">
                            {reportHintMessage}
                          </div>
                        </div>
                      )}
                      {renderArenaReportView(report, true)}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        评估报告
                      </div>
                      <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground space-y-3">
                        <div>还没有生成报告</div>
                        {!rubricHasContent && (
                          <div className="text-xs text-amber-700 dark:text-amber-300">
                            {rubricRequiredMessage}
                          </div>
                        )}
                        {rubricHasContent && !canGenerateReport && (
                          <div className="text-xs text-amber-700 dark:text-amber-300">
                            {reportRequiredMessage}
                          </div>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
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
                  ))}

                {detailTab === 'optimization' &&
                  (optimization ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                          优化结果
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs rounded-[8px]"
                          onClick={() => void startInteractive()}
                          disabled={
                            !thread || !rubricConfigured || replyGenerating
                          }
                          title={interactiveActionTitle}
                        >
                          开始交互式优化
                        </Button>
                      </div>
                      {!rubricConfigured && (
                        <div className="rounded-[18px] border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
                          <div className="font-medium">交互式优化暂不可用</div>
                          <div className="mt-1 text-xs leading-5">
                            {rubricRequiredMessage}
                          </div>
                        </div>
                      )}
                      <div className="rounded-[20px] border border-border/70 bg-muted/50 p-3 text-sm">
                        <strong>新版本：</strong>v{optimization.versionNumber}
                      </div>
                      <div className="space-y-2">
                        {optimization.issues.map((issue, i) => (
                          <div
                            key={`${issue.expert}-${i}`}
                            className="rounded-[20px] border border-border/70 bg-muted/50 p-3 text-sm"
                          >
                            <div className="font-medium">
                              [{formatExpert(issue.expert)}] {issue.title}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              <strong>目标：</strong>
                              {formatTarget(issue.target)}
                              {issue.targetId ? ` / ${issue.targetId}` : ''}
                            </div>
                            <div className="mt-1">{issue.reason}</div>
                            {issue.evidence.length > 0 && (
                              <div className="mt-1 text-xs text-muted-foreground">
                                <strong>依据：</strong>
                                {issue.evidence.join('; ')}
                              </div>
                            )}
                          </div>
                        ))}
                        {optimization.issues.length === 0 && (
                          <div className="text-sm text-muted-foreground">
                            当前没有额外优化项
                          </div>
                        )}
                      </div>
                      {optimization && selectedPackage && (
                        <OptimizationDiffView
                          oldSnapshot={selectedPackage.snapshot}
                          optimization={optimization}
                        />
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        优化
                      </div>
                      <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground space-y-3">
                        <div>还没有进行交互式优化</div>
                        {!rubricConfigured && (
                          <div className="text-xs text-amber-700 dark:text-amber-300">
                            {rubricRequiredMessage}
                          </div>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
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
                  ))}

                {detailTab === 'diff' &&
                  (optimization && selectedPackage ? (
                    <OptimizationDiffView
                      oldSnapshot={selectedPackage.snapshot}
                      optimization={optimization}
                    />
                  ) : (
                    <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                      还没有执行优化
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
    </div>
  );
}
