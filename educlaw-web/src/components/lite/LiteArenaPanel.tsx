import { type CSSProperties, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type {
  AgentPackageDetail,
  AgentPackageSummary,
  ArenaMessage,
  ArenaReport,
  ArenaThread,
  ArenaThreadDetail,
  OptimizationResult,
  PackageVersion,
} from "@educlaw/shared";
import type { DiagnosisIssue, AdoptedChange, VersionCompareResult, LineDiff } from "../../api/lite-api";
import { computeLineDiff } from "../../api/lite-api";
import { useAuthStore } from "../../stores/auth";
import { liteApi } from "../../api/lite-api";
import {
  appendPackagePreviewDelta,
  ConversationBoard,
  MarkdownContent,
  OptimizationDiffView,
  PackagePreviewCard,
  upsertPackagePreview,
  VersionDiffView,
  type PackagePreview,
} from "./lite-rendering";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sparkles, Send, Upload, Trash2, FileText, ListChecks, Wrench,
  History, BarChart3, Zap, GitCompare, Clock, CheckCircle2, XCircle, Loader2,
  PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, X,
} from "lucide-react";

type DetailTab = "agent" | "rubric" | "skills" | "versions" | "report" | "optimization" | "diff";
type ProgressState = { title: string; phase: string; steps: string[]; startedAt: number; active: boolean; isError: boolean };

const DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function prefersWideLayout(): boolean {
  return typeof window === "undefined" || window.matchMedia("(min-width: 1024px)").matches;
}

function isDocxFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(".docx") || file.type === DOCX_MIME_TYPE;
}

async function readTextDocument(file: File): Promise<{ name: string; content: string }> {
  if (isDocxFile(file)) {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    const warnings = result.messages?.map((message) => message.message).filter(Boolean) || [];
    const warningText = warnings.length ? `\n\n[Word 解析提示]\n${warnings.map((message) => `- ${message}`).join("\n")}` : "";
    return {
      name: file.name,
      content: `${result.value.trim()}${warningText}`.trim() || "[Word 文档没有提取到可用文本]",
    };
  }

  return {
    name: file.name,
    content: await file.text(),
  };
}



export default function LiteArenaPanel() {
  const token = useAuthStore((s) => s.token) || "";
  const [packages, setPackages] = useState<AgentPackageSummary[]>([]);
  const [selectedPackageId, setSelectedPackageId] = useState("");
  const [selectedPackage, setSelectedPackage] = useState<AgentPackageDetail | null>(null);
  const [versions, setVersions] = useState<PackageVersion[]>([]);
  const [thread, setThread] = useState<ArenaThread | null>(null);
  const [threadDetail, setThreadDetail] = useState<ArenaThreadDetail | null>(null);
  const [report, setReport] = useState<ArenaReport | null>(null);
  const [optimization, setOptimization] = useState<OptimizationResult | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("agent");
  const [selectedSkillId, setSelectedSkillId] = useState("");

  const [instruction, setInstruction] = useState("");
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [generatePreviews, setGeneratePreviews] = useState<PackagePreview[]>([]);
  const [sideStreaming, setSideStreaming] = useState({ baseline: false, enhanced: false });
  const [nowMs, setNowMs] = useState(Date.now());
  const [isWideLayout, setIsWideLayout] = useState(prefersWideLayout);
  const [sidebarOpen, setSidebarOpen] = useState(prefersWideLayout);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(prefersWideLayout);
  const [leftWidth, setLeftWidth] = useState(400);
  const [rightWidth, setRightWidth] = useState(450);
  const [documents, setDocuments] = useState<Array<{ name: string; content: string }>>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const docFileRef = useRef<HTMLInputElement | null>(null);
  const preserveGenerateProgressRef = useRef(false);

  // Interactive optimization state
  const [interactiveMode, setInteractiveMode] = useState(false);
  const [interactiveMessages, setInteractiveMessages] = useState<Array<{ role: string; content: string }>>([]);
  const [interactiveIssues, setInteractiveIssues] = useState<DiagnosisIssue[]>([]);
  const [interactiveAdopted, setInteractiveAdopted] = useState<AdoptedChange[]>([]);
  const [interactivePhase, setInteractivePhase] = useState<"idle" | "diagnosing" | "chatting">("idle");
  const [interactiveInput, setInteractiveInput] = useState("");
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const selectedPackageIdRef = useRef(selectedPackageId);
  useEffect(() => { selectedPackageIdRef.current = selectedPackageId; }, [selectedPackageId]);
  const threadRef = useRef(thread);
  useEffect(() => { threadRef.current = thread; }, [thread]);

  // Center preview mode (view file in main panel)
  const [centerPreview, setCenterPreview] = useState<
    | { type: "agent" | "rubric" | "skill" | "diff"; name: string; content: string }
    | { type: "report"; name: string; report: ArenaReport }
    | null
  >(null);
  const [hasSavedSession, setHasSavedSession] = useState(false);

  // Version compare state
  const [compareBaseId, setCompareBaseId] = useState("");
  const [compareTargetId, setCompareTargetId] = useState("");
  const [compareResult, setCompareResult] = useState<VersionCompareResult | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);

  const messages = threadDetail?.messages || [];
  const selectedSkill = selectedPackage?.snapshot.skills.find((s) => (s.id || s.dirName) === selectedSkillId) || selectedPackage?.snapshot.skills[0] || null;
  const sidebarStyle = { "--sidebar-width": `${leftWidth}px` } as CSSProperties;
  const detailStyle = { "--detail-width": `${rightWidth}px` } as CSSProperties;

  useEffect(() => { const timer = window.setInterval(() => setNowMs(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const syncLayout = () => {
      const wide = media.matches;
      setIsWideLayout(wide);
      if (!wide) {
        setSidebarOpen(false);
        setRightSidebarOpen(false);
      }
    };
    syncLayout();
    media.addEventListener("change", syncLayout);
    return () => media.removeEventListener("change", syncLayout);
  }, []);
  useEffect(() => { if (selectedPackage?.snapshot.skills.length) setSelectedSkillId((c) => c || selectedPackage.snapshot.skills[0]!.id); else setSelectedSkillId(""); }, [selectedPackage]);
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [interactiveMessages, interactivePhase]);
  useEffect(() => { if (!token) return; refreshPackages(); }, [token]);

  // Persist / restore report per thread
  const reportStorageKey = (threadId: string) => `arena-report-${threadId}`;

  useEffect(() => {
    if (!thread?.id) { setReport(null); return; }
    const saved = localStorage.getItem(reportStorageKey(thread.id));
    if (saved) {
      try { setReport(JSON.parse(saved)); } catch { setReport(null); }
    } else {
      setReport(null);
    }
  }, [thread?.id]);

  useEffect(() => {
    if (!thread?.id || !report) return;
    localStorage.setItem(reportStorageKey(thread.id), JSON.stringify(report));
  }, [report, thread?.id]);

  // Persist / restore interactive optimization state per package
  const interactiveStorageKey = (packageId: string) => `interactive-opt-${packageId}`;

  function saveInteractiveState(packageId: string, messages: typeof interactiveMessages, adopted: typeof interactiveAdopted, issues: typeof interactiveIssues) {
    localStorage.setItem(
      interactiveStorageKey(packageId),
      JSON.stringify({ messages, adopted, issues }),
    );
  }

  useEffect(() => {
    const preserveGenerateProgress = preserveGenerateProgressRef.current;
    preserveGenerateProgressRef.current = false;
    setCenterPreview(null);
    setInteractiveInput("");
    setInteractivePhase("idle");
    if (!preserveGenerateProgress) {
      setProgress(null);
      setStatus("");
      setGeneratePreviews([]);
    }
    setSideStreaming({ baseline: false, enhanced: false });

    if (!selectedPackageId) {
      setInteractiveMode(false);
      setHasSavedSession(false);
      setInteractiveMessages([]);
      setInteractiveAdopted([]);
      setInteractiveIssues([]);
      return;
    }
    const saved = localStorage.getItem(interactiveStorageKey(selectedPackageId));
    if (saved) {
      try {
        const data = JSON.parse(saved);
        const validMessages = (data.messages || []).filter(
          (m: any) => m && typeof m === "object" && typeof m.role === "string" && typeof m.content === "string"
        );
        const validAdopted = (data.adopted || []).filter(
          (a: any) => a && typeof a === "object" && typeof a.id === "string"
        );
        const validIssues = (data.issues || []).filter(
          (i: any) => i && typeof i === "object" && typeof i.id === "string"
        );
        if (validMessages.length > 0) {
          setInteractiveMessages(validMessages);
          setInteractiveAdopted(validAdopted);
          setInteractiveIssues(validIssues);
          setHasSavedSession(true);
          setInteractiveMode(true); // auto-resume interactive panel if session exists
          return;
        }
      } catch { /* ignore corrupt data */ }
    }
    // No saved session for this package: close interactive panel
    setInteractiveMode(false);
    setHasSavedSession(false);
    setInteractiveMessages([]);
    setInteractiveAdopted([]);
    setInteractiveIssues([]);
  }, [selectedPackageId]);

  // Persist / restore optimization result per package
  const optimizationStorageKey = (packageId: string) => `arena-optimization-${packageId}`;

  useEffect(() => {
    if (!selectedPackageId) {
      setOptimization(null);
      return;
    }
    const saved = localStorage.getItem(optimizationStorageKey(selectedPackageId));
    if (saved) {
      try { setOptimization(JSON.parse(saved)); } catch { setOptimization(null); }
    } else {
      setOptimization(null);
    }
  }, [selectedPackageId]);



  // Persist / restore version compare state per package
  const compareStorageKey = (packageId: string) => `arena-compare-${packageId}`;

  useEffect(() => {
    if (!selectedPackageId) {
      setCompareResult(null);
      setCompareBaseId("");
      setCompareTargetId("");
      return;
    }
    const saved = localStorage.getItem(compareStorageKey(selectedPackageId));
    if (saved) {
      try {
        const data = JSON.parse(saved);
        setCompareResult(data.result || null);
        setCompareBaseId(data.baseId || "");
        setCompareTargetId(data.targetId || "");
      } catch {
        setCompareResult(null);
        setCompareBaseId("");
        setCompareTargetId("");
      }
    } else {
      setCompareResult(null);
      setCompareBaseId("");
      setCompareTargetId("");
    }
  }, [selectedPackageId]);



  // optimization save helper
  function saveOptimizationState(packageId: string, opt: OptimizationResult) {
    localStorage.setItem(optimizationStorageKey(packageId), JSON.stringify(opt));
  }

  // compare save helper
  function saveCompareState(packageId: string, result: VersionCompareResult | null, baseId: string, targetId: string) {
    localStorage.setItem(
      compareStorageKey(packageId),
      JSON.stringify({ result, baseId, targetId }),
    );
  }

  function startProgress(title: string, phase: string) { setProgress({ title, phase, steps: [phase], startedAt: Date.now(), active: true, isError: false }); }
  function pushProgress(label: string) { setProgress((prev) => prev ? { ...prev, phase: label, steps: prev.steps[prev.steps.length - 1] === label ? prev.steps : [...prev.steps, label] } : { title: "当前进度", phase: label, steps: [label], startedAt: Date.now(), active: true, isError: false }); }
  function finishProgress(label: string) { setProgress((prev) => prev ? { ...prev, active: false, isError: false, phase: label, steps: prev.steps[prev.steps.length - 1] === label ? prev.steps : [...prev.steps, label] } : null); }
  function failProgress(label: string) { setProgress((prev) => prev ? { ...prev, active: false, isError: true, phase: label, steps: prev.steps[prev.steps.length - 1] === label ? prev.steps : [...prev.steps, label] } : null); }
  function formatElapsed(ms: number) { const total = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`; }

  function clearWorkspaceState() {
    selectedPackageIdRef.current = "";
    setSelectedPackageId("");
    setSelectedPackage(null);
    setThread(null);
    setThreadDetail(null);
    setVersions([]);
    setReport(null);
    setOptimization(null);
    setCompareResult(null);
    setCompareBaseId("");
    setCompareTargetId("");
    setSelectedSkillId("");
    setCenterPreview(null);
    setInteractiveMode(false);
    setInteractiveMessages([]);
    setInteractiveAdopted([]);
    setInteractiveIssues([]);
    setInput("");
    setSideStreaming({ baseline: false, enhanced: false });
  }

  async function refreshPackages(preferredPackageId?: string) {
    if (!token) return;
    const list = await liteApi.listPackages(token);
    setPackages(list);
    const currentPackageId = selectedPackageIdRef.current || selectedPackageId;
    const preferredExists = preferredPackageId && list.some((item) => item.id === preferredPackageId);
    const selectedExists = currentPackageId && list.some((item) => item.id === currentPackageId);
    const nextId = (preferredExists && preferredPackageId) || (selectedExists && currentPackageId) || list[0]?.id || "";
    if (nextId) {
      if (nextId !== currentPackageId) {
        await openPackage(nextId, list);
      } else {
        // Same package: just refresh the package list metadata, don't reset UI states
        const detail = await liteApi.getPackage(token, nextId);
        const versionList = await liteApi.listVersions(token, nextId);
        if (selectedPackageIdRef.current === nextId) {
          setSelectedPackage(detail);
          setVersions(versionList);
          setPackages((prev) => prev.map((item) => item.id === nextId ? { ...item, name: detail.name, description: detail.description, versionNumber: detail.versionNumber, updatedAt: detail.updatedAt } : item));
        }
      }
    } else {
      clearWorkspaceState();
    }
  }

  async function openPackage(packageId: string, snapshotList?: AgentPackageSummary[]) {
    if (!token || !packageId) return;
    selectedPackageIdRef.current = packageId;
    setSelectedPackageId(packageId);
    const detail = await liteApi.getPackage(token, packageId);
    const versionList = await liteApi.listVersions(token, packageId);
    const threads = await liteApi.listThreads(token, packageId);
    const activeThread = threads[0] || await liteApi.createThread(token, packageId);
    const activeDetail = await liteApi.getThread(token, activeThread.id);
    // Guard against race: user may have switched to another package while we were loading
    if (selectedPackageIdRef.current === packageId) {
      setSelectedPackage(detail); setVersions(versionList); setThread(activeThread); setThreadDetail(activeDetail); setReport(null); setOptimization(null); setDetailTab("agent"); setSideStreaming({ baseline: false, enhanced: false });
    }
    if (!snapshotList) setPackages((prev) => prev.map((item) => item.id === packageId ? { ...item, name: detail.name, description: detail.description, versionNumber: detail.versionNumber, updatedAt: detail.updatedAt } : item));
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

  async function handleDocFiles(fileList: FileList | null) {
    if (!fileList) return;
    const files = Array.from(fileList);
    const results: Array<{ name: string; content: string }> = [];
    for (const file of files) {
      try {
        results.push(await readTextDocument(file));
      } catch (error) {
        setStatus(`${file.name} 读取失败：${error instanceof Error ? error.message : "不支持的文档格式"}`);
      }
    }
    if (results.length > 0) {
      setDocuments((prev) => [...prev, ...results]);
      setStatus(`已添加 ${results.length} 个文档`);
    }
  }

  async function handleGenerate() {
    if ((!instruction.trim() && documents.length === 0) || !token) return;
    startProgress("生成智能体", "正在生成智能体..."); setStatus("正在生成智能体...");
    setGeneratePreviews([]);
    try {
      let createdId = "";
      let createdName = "";
      await liteApi.generatePackageStream(token, instruction.trim(), undefined, documents, (event) => {
        if (event.event === "phase") { pushProgress(event.data.label); setStatus(event.data.label); }
        if (event.event === "preview_delta") { setGeneratePreviews((prev) => appendPackagePreviewDelta(prev, event.data)); }
        if (event.event === "preview") { setGeneratePreviews((prev) => upsertPackagePreview(prev, event.data)); }
        if (event.event === "done") { createdId = event.data.id; createdName = event.data.name; }
        if (event.event === "error") throw new Error(event.data.error || "生成失败");
      });
      if (createdId) {
        preserveGenerateProgressRef.current = true;
        setInstruction("");
        setDocuments([]);
        await refreshPackages(createdId);
      }
      const doneLabel = createdName ? `生成完成：${createdName}` : "生成完成，已打开新智能体";
      finishProgress(doneLabel); setStatus(doneLabel);
    } catch (error) {
      const message = error instanceof Error ? error.message : "生成失败";
      failProgress(message); setStatus(message);
    }
  }

  async function handleImport(file: File) {
    if (!token) return;
    startProgress("导入 ZIP", "正在导入..."); setStatus("正在导入...");
    try {
      const created = await liteApi.importPackage(token, file);
      await refreshPackages(created.id);
      finishProgress("导入成功"); setStatus("导入成功");
    } catch (error) {
      const message = error instanceof Error ? error.message : "导入失败";
      failProgress(message); setStatus(message);
    }
  }

  async function handleSend() {
    if (!token || !thread?.id || !input.trim() || !threadDetail) return;
    const prompt = input.trim();
    const tempSharedId = `temp-shared-${Date.now()}`;
    const tempBaselineId = `temp-baseline-${Date.now()}`;
    const tempEnhancedId = `temp-enhanced-${Date.now()}`;
    const now = new Date().toISOString();
    const tempShared: ArenaMessage = { id: tempSharedId, threadId: thread.id, side: "shared", role: "user", content: prompt, createdAt: now };
    const tempBaseline: ArenaMessage = { id: tempBaselineId, threadId: thread.id, side: "baseline", role: "assistant", content: "", createdAt: now };
    const tempEnhanced: ArenaMessage = { id: tempEnhancedId, threadId: thread.id, side: "enhanced", role: "assistant", content: "", createdAt: now };
    setInput(""); setReport(null); setOptimization(null);
    flushSync(() => {
      setThreadDetail({ thread: threadDetail.thread, messages: [...threadDetail.messages, tempShared, tempBaseline, tempEnhanced] });
    });
    setSideStreaming({ baseline: true, enhanced: true }); startProgress(selectedPackage?.name || "工作台", "正在生成回复..."); setStatus("正在生成...");
    try {
      await liteApi.sendMessageStream(token, thread.id, prompt, undefined, (event) => {
        if (event.event === "phase") { pushProgress(event.data.label); setStatus(event.data.label); return; }
        if (event.event === "shared") { setThreadDetail((prev) => prev ? { ...prev, messages: prev.messages.map((m) => m.id === tempSharedId ? event.data.message : m) } : prev); return; }
        if (event.event === "side_start") { setSideStreaming((prev) => ({ ...prev, [event.data.side]: true })); return; }
        if (event.event === "delta") {
          const targetId = event.data.side === "baseline" ? tempBaselineId : tempEnhancedId;
          setThreadDetail((prev) => prev ? { ...prev, messages: prev.messages.map((m) => m.id === targetId ? { ...m, content: `${m.content}${event.data.delta}` } : m) } : prev);
          return;
        }
        if (event.event === "side_done") {
          const targetId = event.data.side === "baseline" ? tempBaselineId : tempEnhancedId;
          setSideStreaming((prev) => ({ ...prev, [event.data.side]: false }));
          setThreadDetail((prev) => prev ? { ...prev, messages: prev.messages.map((m) => m.id === targetId ? { ...m, content: event.data.content } : m) } : prev);
          return;
        }
        if (event.event === "done") {
          setThread(event.data.thread);
          setSideStreaming({ baseline: false, enhanced: false });
          finishProgress("回复已生成"); setStatus("回复已生成");
          return;
        }
        if (event.event === "error") throw new Error(event.data.error || "发送失败");
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "发送失败";
      setSideStreaming({ baseline: false, enhanced: false });
      setInput(prompt);
      failProgress(message); setStatus(message);
    }
  }

  async function handleReport() {
    if (!token || !thread?.id) return;
    const currentThreadId = thread.id;
    startProgress("生成评估报告", "正在生成报告..."); setStatus("正在生成报告...");
    try {
      let nextReport: ArenaReport | null = null;
      await liteApi.generateReportStream(token, currentThreadId, undefined, (event) => {
        if (event.event === "phase") { pushProgress(event.data.label); setStatus(event.data.label); }
        if (event.event === "done") nextReport = event.data;
        if (event.event === "error") throw new Error(event.data.error || "评估失败");
      });
      if (nextReport && threadRef.current?.id === currentThreadId) {
        setReport(nextReport);
        // 只有用户没有在交互式优化中时才自动切换到报告
        if (!interactiveMode) setDetailTab("report");
      }
      finishProgress("报告已生成"); setStatus(interactiveMode ? "报告已生成，点击右侧「报告」查看" : "报告已生成");
    } catch (error) {
      const message = error instanceof Error ? error.message : "评估失败";
      failProgress(message); setStatus(message);
    }
  }

  async function handleOptimize() {
    if (!token || !thread?.id || !selectedPackageId) return;
    const currentPkgId = selectedPackageId;
    startProgress("执行优化", "正在运行专家优化..."); setStatus("正在优化...");
    try {
      let result: OptimizationResult | null = null;
      await liteApi.optimizePackageStream(token, currentPkgId, thread.id, undefined, (event) => {
        if (event.event === "phase") { pushProgress(event.data.label); setStatus(event.data.label); }
        if (event.event === "done") result = event.data;
        if (event.event === "error") throw new Error(event.data.error || "优化失败");
      });
      if (result) {
        await refreshPackages(currentPkgId);
        saveOptimizationState(currentPkgId, result);
        if (selectedPackageIdRef.current === currentPkgId) {
          setOptimization(result);
        }
      }
      finishProgress("优化完成"); setStatus("优化完成");
    } catch (error) {
      const message = error instanceof Error ? error.message : "优化失败";
      failProgress(message); setStatus(message);
    }
  }

  async function handleDelete() {
    const deletingId = selectedPackageIdRef.current || selectedPackageId;
    if (!token || !deletingId) return;
    if (!window.confirm("确定要删除当前智能体吗？")) return;
    clearWorkspaceState();
    setPackages((prev) => prev.filter((item) => item.id !== deletingId));
    try {
      await liteApi.deletePackage(token, deletingId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "删除失败";
      failProgress(message);
      setStatus(message);
      await refreshPackages(deletingId);
      return;
    }
    // Clean up package-scoped localStorage data
    localStorage.removeItem(interactiveStorageKey(deletingId));
    localStorage.removeItem(optimizationStorageKey(deletingId));
    localStorage.removeItem(compareStorageKey(deletingId));
    await refreshPackages();
  }

  async function handleExport() {
    if (!token || !selectedPackageId) return;
    await liteApi.exportPackage(token, selectedPackageId);
    setStatus("导出已开始");
  }

  async function startInteractive() {
    if (!token || !thread?.id || !selectedPackageId) return;
    setInteractiveMode(true);
    setCenterPreview(null);
    // Check if there's a saved session for this package
    const saved = localStorage.getItem(interactiveStorageKey(selectedPackageId));
    if (saved) {
      try {
        const data = JSON.parse(saved);
        const validMessages = (data.messages || []).filter(
          (m: any) => m && typeof m === "object" && typeof m.role === "string" && typeof m.content === "string"
        );
        const validAdopted = (data.adopted || []).filter(
          (a: any) => a && typeof a === "object" && typeof a.id === "string"
        );
        const validIssues = (data.issues || []).filter(
          (i: any) => i && typeof i === "object" && typeof i.id === "string"
        );
        if (validMessages.length > 0) {
          setInteractiveMessages(validMessages);
          setInteractiveAdopted(validAdopted);
          setInteractiveIssues(validIssues);
          setHasSavedSession(true);
          return; // Resume from saved session, no need to re-diagnose
        }
      } catch { /* ignore */ }
    }
    setHasSavedSession(false);
    // Fresh start: run diagnosis with simulated progress steps
    setInteractivePhase("diagnosing");
    setInteractiveMessages([]);
    setInteractiveIssues([]);
    setInteractiveAdopted([]);
    startProgress("交互式优化", "正在初始化分析...");
    const stepTimers: number[] = [];
    stepTimers.push(window.setTimeout(() => pushProgress("正在读取智能体内容..."), 600));
    stepTimers.push(window.setTimeout(() => pushProgress("正在分析 Arena 对话轨迹..."), 1800));
    stepTimers.push(window.setTimeout(() => pushProgress("正在识别潜在优化问题..."), 4000));
    stepTimers.push(window.setTimeout(() => pushProgress("正在生成优化建议..."), 7000));
    const currentPkgId = selectedPackageId;
    try {
      const result = await liteApi.diagnosePackage(token, currentPkgId, thread.id);
      stepTimers.forEach((id) => window.clearTimeout(id));
      const welcomeMsg = { role: "assistant", content: result.welcomeMessage };
      saveInteractiveState(currentPkgId, [welcomeMsg], [], result.issues);
      if (selectedPackageIdRef.current === currentPkgId) {
        setInteractiveMode(true);
        setInteractiveIssues(result.issues);
        // Only set welcome message if UI is empty (user may have switched back and restored a longer session)
        setInteractiveMessages((prev) => prev.length === 0 ? [welcomeMsg] : prev);
      }
      finishProgress(`分析完成，发现 ${result.issues.length} 个问题`);
    } catch (error) {
      stepTimers.forEach((id) => window.clearTimeout(id));
      const message = error instanceof Error ? error.message : "诊断失败";
      const errorMsg = { role: "assistant", content: `❌ 诊断失败：${message}` };
      saveInteractiveState(currentPkgId, [errorMsg], [], []);
      if (selectedPackageIdRef.current === currentPkgId) {
        setInteractiveMode(true);
        setInteractiveMessages((prev) => prev.length === 0 ? [errorMsg] : prev);
      }
      failProgress(message);
    } finally {
      if (selectedPackageIdRef.current === currentPkgId) {
        setInteractivePhase("idle");
      }
    }
  }

  async function sendInteractiveMessage() {
    if (!token || !selectedPackageId || !interactiveInput.trim() || interactivePhase !== "idle") return;
    const currentPkgId = selectedPackageId;
    const userMsg = interactiveInput.trim();
    setInteractiveInput("");

    // Read latest state from localStorage to avoid stale closure after package switch
    // Default to empty — never trust closure-captured state after a potential switch
    let latestMessages: typeof interactiveMessages = [];
    let latestAdopted: typeof interactiveAdopted = [];
    let latestIssues: typeof interactiveIssues = [];
    const saved = localStorage.getItem(interactiveStorageKey(currentPkgId));
    if (saved) {
      try {
        const data = JSON.parse(saved);
        if (data.messages && Array.isArray(data.messages)) {
          latestMessages = data.messages.filter(
            (m: any) => m && typeof m === "object" && typeof m.role === "string" && typeof m.content === "string"
          );
        }
        if (data.adopted && Array.isArray(data.adopted)) {
          latestAdopted = data.adopted.filter(
            (a: any) => a && typeof a === "object" && typeof a.id === "string"
          );
        }
        if (data.issues && Array.isArray(data.issues)) {
          latestIssues = data.issues.filter(
            (i: any) => i && typeof i === "object" && typeof i.id === "string"
          );
        }
      } catch { /* ignore corrupt data */ }
    }

    // Build new messages with user message and update UI immediately
    const messagesWithUser = [...latestMessages, { role: "user", content: userMsg }];
    setInteractiveMessages(messagesWithUser);
    setInteractivePhase("chatting");
    startProgress("交互式优化", "专家正在思考...");

    // Save user message immediately so it's not lost if user switches packages
    saveInteractiveState(currentPkgId, messagesWithUser, latestAdopted, latestIssues);

    try {
      const result = await liteApi.chatOptimize(token, currentPkgId, messagesWithUser, latestAdopted);

      // Build final messages with assistant reply using known array (not prev from state)
      const finalMessages = [...messagesWithUser, { role: "assistant", content: result.reply }];
      const finalAdopted = result.newAdoptions.length > 0 ? [...latestAdopted, ...result.newAdoptions] : latestAdopted;

      // Always save to localStorage for the original package
      saveInteractiveState(currentPkgId, finalMessages, finalAdopted, latestIssues);

      // Only update UI if user is still on the same package
      if (selectedPackageIdRef.current === currentPkgId) {
        setInteractiveMessages(finalMessages);
        if (result.newAdoptions.length > 0) {
          setInteractiveAdopted(finalAdopted);
        }
      }
      finishProgress("专家已回复");
    } catch (error) {
      const message = error instanceof Error ? error.message : "对话失败";
      const errorMessages = [...messagesWithUser, { role: "assistant", content: `❌ 对话失败：${message}` }];
      saveInteractiveState(currentPkgId, errorMessages, latestAdopted, latestIssues);
      if (selectedPackageIdRef.current === currentPkgId) {
        setInteractiveMessages(errorMessages);
      }
      failProgress(message);
    } finally {
      if (selectedPackageIdRef.current === currentPkgId) {
        setInteractivePhase("idle");
      }
    }
  }

  async function saveInteractiveChanges() {
    if (!token || !selectedPackageId || interactiveAdopted.length === 0) return;
    const currentPkgId = selectedPackageId;
    const currentAdopted = interactiveAdopted;
    const note = window.prompt("请输入新版本备注（可选）：");
    if (note === null) return; // cancelled
    startProgress("保存修改", "正在应用修改并生成新版本...");
    try {
      const result = await liteApi.applyInteractiveChanges(token, currentPkgId, currentAdopted, note);
      await refreshPackages(currentPkgId);
      // Clear saved interactive session
      localStorage.removeItem(interactiveStorageKey(currentPkgId));
      if (selectedPackageIdRef.current === currentPkgId) {
        setInteractiveMode(false);
        setHasSavedSession(false);
        setOptimization(null);
        setInteractiveMessages([]);
        setInteractiveIssues([]);
        setInteractiveAdopted([]);
        setDetailTab("versions");
      }
      finishProgress(`已保存为新版本 v${result.versionNumber}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存失败";
      failProgress(message);
    }
  }

  async function handleUpdateNote(versionId: string, currentNote: string) {
    if (!token || !selectedPackageId) return;
    const note = window.prompt("请输入版本备注：", currentNote);
    if (note === null) return;
    try {
      await liteApi.updateVersionNote(token, selectedPackageId, versionId, note);
      await refreshPackages(selectedPackageId);
    } catch (error) {
      alert(error instanceof Error ? error.message : "更新备注失败");
    }
  }

  function formatWinner(value: ArenaReport["winningSide"]) { return value === "baseline" ? "基础模型" : value === "enhanced" ? (selectedPackage?.name || "智能体") : "平局"; }
  function buildReportMarkdown(report: ArenaReport): string {
    const winner = report.winningSide;
    const baselineWin = winner === "baseline";
    const enhancedWin = winner === "enhanced";
    const lines: string[] = [
      `# 📊 评估报告`,
      "",
      `> **结论**：${formatWinner(report.winningSide)} ｜ ${report.recommendation}`,
      "",
      `---`,
      "",
      `## 🏆 总体得分`,
      "",
      `### ${baselineWin ? "🥇" : enhancedWin ? "🥈" : "🟡"} 基础模型：${report.baseline.total} 分`,
      `${report.baseline.summary}`,
      "",
      `### ${enhancedWin ? "🥇" : baselineWin ? "🥈" : "🟡"} ${selectedPackage?.name || "智能体"}：${report.enhanced.total} 分`,
      `${report.enhanced.summary}`,
      "",
      `---`,
      "",
      `## 📋 维度评分对比`,
      "",
    ];
    for (const d of report.baseline.dimensions) {
      const e = report.enhanced.dimensions.find((x) => x.key === d.key);
      const bScore = d.score;
      const eScore = e?.score ?? 0;
      const bMax = d.maxScore;
      const eMax = e?.maxScore ?? d.maxScore;
      const diff = eScore - bScore;
      const diffIcon = diff > 0 ? "🟢 +" : diff < 0 ? "🔴 " : "⚪ ";
      const diffText = diff === 0 ? "持平" : `${diffIcon}${diff}`;
      lines.push(`### ${d.name}`);
      lines.push(`- 基础模型：**${bScore}/${bMax}**`);
      lines.push(`- ${selectedPackage?.name || "智能体"}：**${eScore}/${eMax}**`);
      lines.push(`- 差距：${diffText}`);
      lines.push("");
    }
    return lines.join("\n");
  }
  function buildDiffMarkdown(result: VersionCompareResult): string {
    const lines: string[] = [
      `# 版本对比：v${result.baseVersion.versionNumber} → v${result.targetVersion.versionNumber}`,
      "",
      "## 🤖 AI 总结",
      "",
      result.summary || "暂无总结",
      "",
      "---",
      "",
    ];
    const pushDiff = (title: string, diffs: LineDiff[]) => {
      const changes = diffs.filter((d) => d.type !== "same");
      if (changes.length === 0) return;
      lines.push(`## ${title}`);
      lines.push("```diff");
      for (const d of diffs) {
        if (d.type === "same") lines.push(` ${d.text}`);
        else if (d.type === "removed") lines.push(`-${d.text}`);
        else if (d.type === "added") lines.push(`+${d.text}`);
      }
      lines.push("```");
      lines.push("");
    };
    pushDiff("agent.md", result.diffs.agentMd);
    pushDiff("rubric.md", result.diffs.rubricMd);
    for (const skill of result.diffs.skills) {
      pushDiff(`${skill.name} (${skill.dirName})`, skill.diff);
    }
    return lines.join("\n");
  }
  function formatExpert(value: OptimizationResult["issues"][number]["expert"]) { return value === "persona" ? "角色专家" : value === "skill" ? "技能专家" : value === "rubric" ? "评估专家" : "合并专家"; }
  function formatTarget(value: OptimizationResult["issues"][number]["target"]) { return value === "agent" ? "agent.md" : value === "skill" ? "技能文件" : "rubric.md"; }

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
      <aside style={sidebarStyle} className="absolute inset-y-0 left-0 z-30 flex w-[min(22rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] flex-col border-r border-border/70 bg-card/95 shadow-xl backdrop-blur lg:relative lg:z-auto lg:w-[var(--sidebar-width)] lg:max-w-none lg:bg-card/40 lg:shadow-none lg:backdrop-blur-0">
        <div className="flex h-12 shrink-0 items-center justify-end border-b border-border/70 px-3">
          <button
            onClick={() => setSidebarOpen(false)}
            className="flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="收起侧边栏"
          >
            <PanelLeftClose className="size-4" />
          </button>
        </div>
        <ScrollArea className="flex-1 min-h-0">
          <div className="space-y-4 p-4">
            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">生成 Agent / Skill</div>
              <Textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="输入需求描述，或直接上传文档让 AI 自动生成..." rows={3} className="resize-none rounded-[14px] border-border/70 bg-card/80 text-xs" />
              {documents.length > 0 && (
                <div className="space-y-1.5">
                  {documents.map((doc, i) => (
                    <div key={`${doc.name}-${i}`} className="flex items-center justify-between rounded-lg border border-border/70 bg-card/60 px-2.5 py-1.5 text-xs">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <FileText className="size-3 shrink-0 text-muted-foreground" />
                        <span className="truncate">{doc.name}</span>
                      </div>
                      <button onClick={() => setDocuments((prev) => prev.filter((_, idx) => idx !== i))} className="shrink-0 text-muted-foreground hover:text-destructive">
                        <X className="size-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" className="flex-1 min-w-[4rem] rounded-[12px]" onClick={() => void handleGenerate()} disabled={!instruction.trim() && documents.length === 0}><Sparkles className="mr-1.5 size-3.5" />生成</Button>
                <Button size="sm" variant="outline" className="flex-1 min-w-[4rem] rounded-[12px]" onClick={() => docFileRef.current?.click()}><FileText className="mr-1.5 size-3.5" />文档</Button>
                <input ref={docFileRef} type="file" multiple accept=".txt,.md,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.csv,.json,.yaml,.yml,.js,.ts,.py,.html,.css" hidden onChange={(e) => { void handleDocFiles(e.target.files); e.currentTarget.value = ""; }} />
                <Button size="sm" variant="outline" className="flex-1 min-w-[4rem] rounded-[12px]" onClick={() => fileRef.current?.click()}><Upload className="mr-1.5 size-3.5" />导入</Button>
                <input ref={fileRef} type="file" accept=".zip" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void handleImport(file); }} />
              </div>
            </div>
            <div className="h-px bg-border/70" />
            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">仓库 ({packages.length})</div>
              <div className="space-y-1.5">
                {packages.map((pkg) => (
                  <button key={pkg.id} onClick={() => void openPackage(pkg.id)} className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors ${pkg.id === selectedPackageId ? "border-primary/30 bg-primary/5" : "border-transparent hover:bg-muted"}`}>
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary font-bold text-xs">{pkg.name.charAt(0).toUpperCase()}</div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{pkg.name}</div>
                      <div className="truncate text-[11px] text-muted-foreground">v{pkg.versionNumber}</div>
                    </div>
                  </button>
                ))}
                {packages.length === 0 && <div className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">暂无智能体</div>}
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
          title="展开侧边栏"
        >
          <PanelLeftOpen className="size-4" />
        </button>
      </div>
      )}

      {/* Main Arena */}
      <main className="flex min-w-0 flex-1 flex-col bg-card/20">
        {interactiveMode ? (
          <>
            <div className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-card/40 px-14 py-2 lg:px-5">
              <div className="flex min-w-0 items-center gap-3">
                <div className="text-sm font-semibold">💬 交互式优化</div>
                <div className="hidden text-xs text-muted-foreground sm:block">与专家对话逐步优化智能体</div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {interactiveAdopted.length > 0 && (
                  <span className="text-[10px] text-muted-foreground">{interactiveAdopted.length} 项已采纳</span>
                )}
                <Button size="sm" variant="ghost" className="rounded-[12px] text-muted-foreground hover:text-foreground" onClick={() => setInteractiveMode(false)}>✕ 关闭</Button>
                <Button size="sm" variant="outline" className="rounded-[12px] text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => {
                  if (window.confirm("确定要重新开始吗？当前对话和已采纳的修改将被清除。")) {
                    if (selectedPackageId) {
                      localStorage.removeItem(interactiveStorageKey(selectedPackageId));
                    }
                    setInteractiveMessages([]);
                    setInteractiveAdopted([]);
                    setInteractiveIssues([]);
                    void startInteractive();
                  }
                }}>↻ 重新开始</Button>
                {interactiveAdopted.length > 0 && (
                  <Button size="sm" className="rounded-[12px]" onClick={() => {
                    const list = interactiveAdopted.map((c, i) => `${i + 1}. [${c.target}${c.targetId ? `/${c.targetId}` : ""}] ${c.reason}`).join("\n");
                    if (window.confirm(`确认保存以下修改为新版本？\n\n${list}\n\n保存后将生成新版本并退出交互式优化。`)) {
                      void saveInteractiveChanges();
                    }
                  }}>保存</Button>
                )}
              </div>
            </div>
            <div ref={chatScrollRef} className="flex-1 space-y-5 overflow-y-auto px-3 py-4 sm:px-6">
              {interactiveMessages.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className="max-w-[88%] sm:max-w-[70%] lg:max-w-[50%]">
                    <div className="text-[10px] font-medium text-muted-foreground mb-1">
                      {m.role === "user" ? "你" : "🎓 优化专家"}
                    </div>
                    <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${
                      m.role === "user"
                        ? "bg-primary/10 text-foreground rounded-tr-sm border border-primary/15"
                        : "bg-muted/70 text-foreground rounded-tl-sm border border-border/60"
                    }`}>
                      <MarkdownContent content={m.content} />
                    </div>
                  </div>
                </div>
              ))}
              {interactivePhase !== "idle" && (
                <div className="flex justify-start">
                  <div className="w-full max-w-[94%] sm:max-w-[90%]">
                    <div className="text-xs font-medium text-muted-foreground mb-1.5 pl-1">🎓 优化专家</div>
                    {interactivePhase === "diagnosing" ? (
                      <div className="rounded-2xl px-5 py-4 text-sm bg-muted/70 border border-border/60 rounded-tl-sm shadow-sm">
                        <div className="space-y-3">
                          <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
                            <Loader2 className="size-4 animate-spin" />
                            <span>首次分析需要 10-30 秒，请稍候...</span>
                          </div>
                          <div className="text-xs text-muted-foreground space-y-1.5">
                            <div className="flex items-center gap-2">
                              <span className="inline-flex size-4 items-center justify-center rounded-full bg-primary/20 text-primary text-[10px]">1</span>
                              读取智能体内容
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="inline-flex size-4 items-center justify-center rounded-full bg-primary/20 text-primary text-[10px]">2</span>
                              分析 Arena 对话轨迹
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="inline-flex size-4 items-center justify-center rounded-full bg-primary/20 text-primary text-[10px]">3</span>
                              识别潜在优化问题
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="inline-flex size-4 items-center justify-center rounded-full bg-muted text-muted-foreground text-[10px]">4</span>
                              生成诊断报告
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-2xl px-4 py-3 text-sm bg-muted/70 border border-border/60 rounded-tl-sm shadow-sm">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Loader2 className="size-3 animate-spin" />专家正在思考...
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
                    <div className="text-[11px] font-medium text-muted-foreground">📋 已采纳的修改 ({interactiveAdopted.length})</div>
                    <div className="text-[10px] text-primary/80">💡 点击「保存」按钮后生成新版本</div>
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {interactiveAdopted.map((change) => (
                      <button
                        key={change.id}
                        onClick={() => {
                          setInteractiveMode(false);
                          const diffs = computeLineDiff(change.original, change.modified);
                          const diffLines = diffs.map((d) => d.type === "same" ? ` ${d.text}` : d.type === "removed" ? `-${d.text}` : `+${d.text}`);
                          setCenterPreview({
                            type: "diff",
                            name: `${change.target}${change.targetId ? `/${change.targetId}` : ""} — ${change.reason}`,
                            content: [
                              `# 已采纳修改：${change.reason}`,
                              "",
                              "```diff",
                              ...diffLines,
                              "```",
                            ].join("\n"),
                          });
                        }}
                        className="shrink-0 rounded-lg border border-border/70 bg-muted/40 px-2.5 py-1.5 text-xs max-w-xs text-left hover:border-primary/30 hover:bg-primary/5 transition-colors cursor-pointer"
                      >
                        <div className="flex items-center gap-1.5">
                          <Badge variant="secondary" className="text-[10px] h-4 px-1 shrink-0">{change.target}{change.targetId ? `/${change.targetId}` : ""}</Badge>
                          <span className="text-muted-foreground truncate" title={change.reason}>{change.reason}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div className="shrink-0 border-t border-border/70 bg-card/40 p-3 sm:p-4">
              <div className="flex flex-col gap-3 sm:flex-row">
                <Textarea value={interactiveInput} onChange={(e) => setInteractiveInput(e.target.value)} placeholder="输入消息与专家对话..." rows={2} className="min-h-[56px] resize-none rounded-[14px] border-border/70 bg-card/80" onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendInteractiveMessage(); } }} />
                <Button className="h-10 w-full rounded-[12px] px-5 sm:w-auto sm:self-end" onClick={() => void sendInteractiveMessage()} disabled={interactivePhase !== "idle" || !interactiveInput.trim()}><Send className="mr-1.5 size-4" />发送</Button>
              </div>
            </div>
          </>
        ) : centerPreview ? (
          <>
            <div className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-card/40 px-14 py-2 lg:px-5">
              <div className="flex min-w-0 items-center gap-3">
                <div className="truncate text-sm font-semibold">👁 {centerPreview.name}</div>
                <div className="hidden text-xs text-muted-foreground sm:block">中间栏预览</div>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="rounded-[12px]" onClick={() => setCenterPreview(null)}>返回工作台</Button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-3 sm:p-6">
              {centerPreview.type === "report" ? (
                <div className="max-w-3xl mx-auto space-y-6">
                  {/* Title */}
                  <div className="text-xl font-bold">📊 评估报告</div>

                  {/* Result & Recommendation */}
                  <div className="rounded-[20px] border border-border/70 bg-muted/50 p-4 space-y-3">
                    <div>
                      <span className="text-sm font-semibold">🏆 结果：</span>
                      <span className="text-sm">{formatWinner(centerPreview.report.winningSide)}</span>
                    </div>
                    <div>
                      <span className="text-sm font-semibold">💡 建议：</span>
                      <span className="text-sm text-muted-foreground">{centerPreview.report.recommendation}</span>
                    </div>
                  </div>

                  {/* Score cards */}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="rounded-[20px] border border-border/70 bg-muted/50 p-4 text-center space-y-1">
                      <div className="text-sm text-muted-foreground">基础模型</div>
                      <div className="text-3xl font-bold">{centerPreview.report.baseline.total}</div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">评语</div>
                      <div className="text-xs text-muted-foreground leading-relaxed">{centerPreview.report.baseline.summary}</div>
                    </div>
                    <div className="rounded-[20px] border border-border/70 bg-muted/50 p-4 text-center space-y-1">
                      <div className="text-sm text-muted-foreground">{selectedPackage?.name || "智能体"}</div>
                      <div className="text-3xl font-bold">{centerPreview.report.enhanced.total}</div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">评语</div>
                      <div className="text-xs text-muted-foreground leading-relaxed">{centerPreview.report.enhanced.summary}</div>
                    </div>
                  </div>

                  {/* Dimensions table */}
                  <div className="overflow-x-auto rounded-[20px] border border-border/70">
                    <table className="min-w-[640px] w-full text-sm">
                      <thead className="bg-muted/80">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">维度</th>
                          <th className="px-3 py-2 text-left font-medium">基础模型</th>
                          <th className="px-3 py-2 text-left font-medium">{selectedPackage?.name || "智能体"}</th>
                          <th className="px-3 py-2 text-left font-medium">差距</th>
                        </tr>
                      </thead>
                      <tbody>
                        {centerPreview.report.baseline.dimensions.map((d, i) => {
                          const e = centerPreview.report.enhanced.dimensions[i];
                          const diff = (e?.score ?? 0) - d.score;
                          return (
                            <tr key={d.key} className="border-t border-border">
                              <td className="px-3 py-2">{d.name}</td>
                              <td className="px-3 py-2">{d.score}/{d.maxScore}</td>
                              <td className="px-3 py-2">{e?.score ?? 0}/{e?.maxScore ?? d.maxScore}</td>
                              <td className={`px-3 py-2 font-medium ${diff > 0 ? "text-emerald-600" : diff < 0 ? "text-red-500" : "text-muted-foreground"}`}>{diff > 0 ? `+${diff}` : diff}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="max-w-3xl mx-auto">
                  <div className="rounded-[20px] border border-border/70 bg-muted/50 p-5 text-sm">
                    <MarkdownContent content={centerPreview.content} />
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-card/40 px-14 py-2 lg:px-5">
              <div className="flex min-w-0 items-center gap-3">
                <div className="truncate text-sm font-semibold">{selectedPackage?.name || "工作台"}</div>
                <div className="hidden text-xs text-muted-foreground sm:block">输入问题，测试智能体效果</div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button size="sm" variant="outline" className="rounded-[12px]" onClick={() => void handleReport()} disabled={!threadDetail || threadDetail.messages.length === 0}><BarChart3 className="mr-1.5 size-3.5" />评估报告</Button>
                <Button size="sm" variant="outline" className="rounded-[12px]" onClick={() => void startInteractive()} disabled={!thread}>
                  💬 交互式优化
                  {hasSavedSession && <span className="ml-1 text-[10px] opacity-70">(继续)</span>}
                </Button>
              </div>
            </div>

            {progress && (
              <div className={`mx-5 mt-3 rounded-[20px] border px-5 py-3 ${progress.isError ? "border-destructive/20 bg-destructive/5" : progress.active ? "border-primary/15 bg-primary/5" : "border-emerald-500/15 bg-emerald-500/5"}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    {progress.active ? <Loader2 className="size-4 animate-spin text-primary" /> : progress.isError ? <XCircle className="size-4 text-destructive" /> : <CheckCircle2 className="size-4 text-emerald-500" />}
                    {progress.title}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground"><Clock className="size-3" />{formatElapsed(nowMs - progress.startedAt)}</div>
                    {!progress.active && (
                      <button onClick={() => setProgress(null)} className="text-xs text-muted-foreground hover:text-foreground transition-colors" title="关闭">✕</button>
                    )}
                  </div>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{progress.phase}</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {progress.steps.map((step, i) => (
                    <Badge key={`${step}-${i}`} variant={i === progress.steps.length - 1 ? "default" : "secondary"} className="text-[10px]">{step}</Badge>
                  ))}
                </div>
              </div>
            )}

            <PackagePreviewCard previews={generatePreviews} />

            <div className="flex-1 overflow-auto">
              <ConversationBoard messages={messages} sideStreaming={sideStreaming} packageName={selectedPackage?.name} />
            </div>

            <div className="border-t border-border/70 bg-card/40 p-3 sm:p-4">
              <div className="flex flex-col gap-3 sm:flex-row">
                <Textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder={`输入问题，测试 ${selectedPackage?.name || "智能体"} 效果...`} rows={2} className="min-h-[60px] resize-none rounded-[14px] border-border/70 bg-card/80" />
                <Button className="h-10 w-full rounded-[12px] px-5 sm:w-auto sm:self-end" onClick={() => void handleSend()} disabled={!selectedPackage || !thread || sideStreaming.baseline || sideStreaming.enhanced}><Send className="mr-1.5 size-4" />发送</Button>
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
      <aside style={detailStyle} className="absolute inset-y-0 right-0 z-30 flex w-[min(24rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] flex-col border-l border-border/70 bg-card/95 shadow-xl backdrop-blur lg:relative lg:z-auto lg:w-[var(--detail-width)] lg:max-w-none lg:bg-card/40 lg:shadow-none lg:backdrop-blur-0">
        <div className="flex min-h-12 shrink-0 items-center justify-between gap-2 border-b border-border/70 px-3 py-2 sm:px-4">
          <div className="min-w-0 truncate text-sm font-semibold">{selectedPackage?.name || "未选择"}</div>
          <div className="flex shrink-0 items-center gap-1">
            <Button size="sm" variant="outline" className="h-7 text-xs rounded-[8px]" onClick={() => void handleExport()} disabled={!selectedPackageId}>导出</Button>
            <Button size="icon" variant="ghost" className="size-7 rounded-[10px] text-destructive hover:text-destructive" onClick={() => void handleDelete()} disabled={!selectedPackageId}><Trash2 className="size-3.5" /></Button>
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
            { key: "agent" as DetailTab, label: "Agent", icon: FileText },
            { key: "rubric" as DetailTab, label: "Rubric", icon: ListChecks },
            { key: "skills" as DetailTab, label: "Skills", icon: Wrench },
            { key: "versions" as DetailTab, label: "版本", icon: GitCompare },
            { key: "report" as DetailTab, label: "报告", icon: BarChart3 },
          ].map((tab) => (
            <button key={tab.key} onClick={() => {
              if (interactiveMode) {
                if (!window.confirm('切换标签将暂时退出交互式优化模式，已采纳的修改不会丢失。是否继续？')) return;
                setInteractiveMode(false);
              }
              setDetailTab(tab.key);
            }} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition-colors ${detailTab === tab.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
              <tab.icon className="size-3" />{tab.label}
            </button>
          ))}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="space-y-4 p-3 sm:p-4">
              {!selectedPackage && <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">请选择一个智能体</div>}

              {selectedPackage && detailTab === "agent" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">agent.md</div>
                    <button onClick={() => setCenterPreview({ type: "agent", name: "agent.md", content: selectedPackage.snapshot.agentMd })} className="text-[10px] text-primary hover:underline">👁 在中间打开</button>
                  </div>
                  <div className="rounded-[20px] border border-border/70 bg-muted/50 p-4 text-sm cursor-pointer hover:border-primary/30 transition-colors overflow-auto max-h-[60vh]" onClick={() => setCenterPreview({ type: "agent", name: "agent.md", content: selectedPackage.snapshot.agentMd })}>
                    <MarkdownContent content={selectedPackage.snapshot.agentMd} />
                  </div>
                </div>
              )}

              {selectedPackage && detailTab === "rubric" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">rubric.md</div>
                    <button onClick={() => setCenterPreview({ type: "rubric", name: "rubric.md", content: selectedPackage.snapshot.rubricMd })} className="text-[10px] text-primary hover:underline">👁 在中间打开</button>
                  </div>
                  <div className="rounded-[20px] border border-border/70 bg-muted/50 p-4 text-sm cursor-pointer hover:border-primary/30 transition-colors overflow-auto max-h-[60vh]" onClick={() => setCenterPreview({ type: "rubric", name: "rubric.md", content: selectedPackage.snapshot.rubricMd })}>
                    <MarkdownContent content={selectedPackage.snapshot.rubricMd} />
                  </div>
                </div>
              )}

              {selectedPackage && detailTab === "skills" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">技能文件</div>
                    {selectedSkill && (
                      <button onClick={() => setCenterPreview({ type: "skill", name: selectedSkill.name, content: selectedSkill.skillMd })} className="text-[10px] text-primary hover:underline">👁 在中间打开</button>
                    )}
                  </div>
                  {selectedPackage.snapshot.skills.length > 0 ? (
                    <>
                      <div className="flex gap-1.5 overflow-x-auto pb-1">
                        {selectedPackage.snapshot.skills.map((skill) => (
                          <button key={skill.id || skill.dirName} onClick={() => setSelectedSkillId(skill.id || skill.dirName)} className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors ${selectedSkillId === (skill.id || skill.dirName) ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>{skill.name}</button>
                        ))}
                      </div>
                      <div className="rounded-[20px] border border-border/70 bg-muted/50 p-4 text-sm cursor-pointer hover:border-primary/30 transition-colors overflow-auto max-h-[60vh]" onClick={() => selectedSkill && setCenterPreview({ type: "skill", name: selectedSkill.name, content: selectedSkill.skillMd })}>
                        <MarkdownContent content={selectedSkill?.skillMd || "暂无技能内容"} />
                      </div>
                    </>
                  ) : <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">暂无技能文件</div>}
                </div>
              )}

              {selectedPackage && detailTab === "versions" && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">版本记录</div>
                    {compareResult && (
                      <button onClick={() => { setCompareResult(null); setCompareBaseId(""); setCompareTargetId(""); }} className="text-[10px] text-primary hover:underline">清除对比</button>
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
                          <option key={v.id} value={v.id}>v{v.versionNumber} ({v.source})</option>
                        ))}
                      </select>
                      <span className="text-muted-foreground">→</span>
                      <select
                        className="min-w-0 flex-1 rounded-lg border border-border/70 bg-muted/50 px-2 py-1 text-xs"
                        value={compareTargetId}
                        onChange={(e) => setCompareTargetId(e.target.value)}
                      >
                        <option value="">选择目标版本</option>
                        {versions.map((v) => (
                          <option key={v.id} value={v.id}>v{v.versionNumber} ({v.source})</option>
                        ))}
                      </select>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[10px] rounded-[8px]"
                        disabled={!compareBaseId || !compareTargetId || compareBaseId === compareTargetId || compareLoading}
                        onClick={() => {
                          if (!token || !selectedPackageId || !compareBaseId || !compareTargetId) return;
                          setCompareLoading(true);
                          const currentPkgId = selectedPackageId;
                          liteApi.compareVersions(token, currentPkgId, compareBaseId, compareTargetId)
                            .then((res) => {
                              saveCompareState(currentPkgId, res, compareBaseId, compareTargetId);
                              if (selectedPackageIdRef.current === currentPkgId) {
                                setCompareResult(res);
                              }
                            })
                            .catch((err) => { alert(err.message || "对比失败"); })
                            .finally(() => {
                              if (selectedPackageIdRef.current === currentPkgId) {
                                setCompareLoading(false);
                              }
                            });
                        }}
                      >
                        {compareLoading ? "对比中..." : "对比"}
                      </Button>
                    </div>
                  )}

                  {/* Compare result */}
                  {compareResult && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs">
                        <div>
                          <div className="font-medium">对比结果</div>
                          <div className="text-muted-foreground">v{compareResult.baseVersion.versionNumber} → v{compareResult.targetVersion.versionNumber}</div>
                        </div>
                        <button onClick={() => setCenterPreview({ type: "diff", name: "版本对比", content: buildDiffMarkdown(compareResult) })} className="text-[10px] text-primary hover:underline">👁 在中间打开</button>
                      </div>
                      <div className="rounded-lg border border-primary/15 bg-primary/5 px-3 py-2.5 text-xs">
                        <div className="flex items-center gap-1.5 font-medium text-primary mb-2">
                          <span className="inline-flex size-5 items-center justify-center rounded-md bg-primary/10 text-[10px]">🤖</span>
                          AI 总结
                        </div>
                        <div className="text-muted-foreground leading-relaxed">
                          <MarkdownContent content={compareResult.summary || "暂无总结"} />
                        </div>
                      </div>
                      <VersionDiffView result={compareResult} />
                    </div>
                  )}

                  {/* Version list */}
                  {!compareResult && (
                    <div className="space-y-1.5">
                      {versions.map((v) => (
                        <div key={v.id} className={`rounded-lg border px-3 py-2 text-xs ${compareBaseId === v.id || compareTargetId === v.id ? "border-primary/30 bg-primary/5" : "border-border/70 bg-muted/50"}`}>
                          <div className="flex items-center justify-between">
                            <span className="font-medium">v{v.versionNumber}</span>
                            <span className="text-muted-foreground">{v.source}</span>
                            <span className="text-muted-foreground">{new Date(v.createdAt).toLocaleString()}</span>
                          </div>
                          <div className="mt-1.5">
                            {v.note ? (
                              <button
                                onClick={() => handleUpdateNote(v.id, v.note || "")}
                                className="text-left text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                                title="点击编辑备注"
                              >
                                📝 {v.note}
                              </button>
                            ) : (
                              <button
                                onClick={() => handleUpdateNote(v.id, "")}
                                className="text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                                title="点击添加备注"
                              >
                                + 添加备注
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                      {versions.length === 0 && <div className="text-center text-sm text-muted-foreground py-4">暂无版本记录</div>}
                    </div>
                  )}
                </div>
              )}

              {detailTab === "report" && (report ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">评估报告</div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => void handleReport()} className="text-[10px] text-primary hover:underline">↻ 重新生成</button>
                      <button onClick={() => setCenterPreview({ type: "report", name: "评估报告", report })} className="text-[10px] text-primary hover:underline">👁 在中间打开</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div className="rounded-[20px] border border-border/70 bg-muted/50 p-3 text-center">
                      <div className="text-xs text-muted-foreground">基础模型</div>
                      <div className="text-2xl font-bold">{report.baseline.total}</div>
                      <div className="text-[10px] text-muted-foreground">{report.baseline.summary}</div>
                    </div>
                    <div className="rounded-[20px] border border-border/70 bg-muted/50 p-3 text-center">
                      <div className="text-xs text-muted-foreground">{selectedPackage?.name || "智能体"}</div>
                      <div className="text-2xl font-bold">{report.enhanced.total}</div>
                      <div className="text-[10px] text-muted-foreground">{report.enhanced.summary}</div>
                    </div>
                  </div>
                  <div className="rounded-[20px] border border-border/70 bg-muted/50 p-3 text-sm">
                    <div><strong>结果：</strong>{formatWinner(report.winningSide)}</div>
                    <div className="mt-1"><strong>建议：</strong>{report.recommendation}</div>
                  </div>
                  <div className="overflow-x-auto rounded-[20px] border border-border/70">
                    <table className="min-w-[420px] w-full text-xs">
                      <thead className="bg-muted/80"><tr><th className="px-2 py-1.5 text-left">维度</th><th className="px-2 py-1.5 text-left">基准</th><th className="px-2 py-1.5 text-left">增强</th></tr></thead>
                      <tbody>
                        {report.baseline.dimensions.map((d, i) => {
                          const e = report.enhanced.dimensions[i];
                          return <tr key={d.key} className="border-t border-border"><td className="px-2 py-1.5">{d.name}</td><td className="px-2 py-1.5">{d.score}/{d.maxScore}</td><td className="px-2 py-1.5">{e?.score ?? 0}/{e?.maxScore ?? d.maxScore}</td></tr>;
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">还没有生成报告</div>)}

              {detailTab === "optimization" && (optimization ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">优化结果</div>
                    <Button size="sm" variant="outline" className="h-7 text-xs rounded-[8px]" onClick={() => void startInteractive()}>💬 交互式优化</Button>
                  </div>
                  <div className="rounded-[20px] border border-border/70 bg-muted/50 p-3 text-sm"><strong>新版本：</strong>v{optimization.versionNumber}</div>
                  <div className="space-y-2">
                    {optimization.issues.map((issue, i) => (
                      <div key={`${issue.expert}-${i}`} className="rounded-[20px] border border-border/70 bg-muted/50 p-3 text-sm">
                        <div className="font-medium">[{formatExpert(issue.expert)}] {issue.title}</div>
                        <div className="mt-1 text-xs text-muted-foreground"><strong>目标：</strong>{formatTarget(issue.target)}{issue.targetId ? ` / ${issue.targetId}` : ""}</div>
                        <div className="mt-1">{issue.reason}</div>
                        {issue.evidence.length > 0 && <div className="mt-1 text-xs text-muted-foreground"><strong>证据：</strong>{issue.evidence.join("; ")}</div>}
                      </div>
                    ))}
                    {optimization.issues.length === 0 && <div className="text-sm text-muted-foreground">当前没有额外优化项</div>}
                  </div>
                  {optimization && selectedPackage && <OptimizationDiffView oldSnapshot={selectedPackage.snapshot} optimization={optimization} />}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">优化</div>
                  <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground space-y-3">
                    <div>还没有进行交互式优化</div>
                    <Button size="sm" variant="outline" className="rounded-[8px]" onClick={() => void startInteractive()} disabled={!thread}>💬 交互式优化</Button>
                  </div>
                </div>
              ))}

              {detailTab === "diff" && (optimization && selectedPackage ? (
                <OptimizationDiffView oldSnapshot={selectedPackage.snapshot} optimization={optimization} />
              ) : <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">还没有执行优化</div>)}
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
