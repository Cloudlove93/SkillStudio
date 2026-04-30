import { useEffect, useRef, useState } from "react";
import type {
  AgentPackageDetail,
  AgentPackageSummary,
  ArenaMessage,
  ArenaReport,
  ArenaThread,
  ArenaThreadDetail,
  OptimizationResult,
  PackageVersion,
  UserSummary,
} from "@educlaw/shared";
import { useAuthStore } from "../stores/auth";
import { liteApi } from "../api/lite-api";
import {
  appendPackagePreviewDelta,
  ConversationBoard,
  MarkdownContent,
  OptimizationDiffView,
  PackagePreviewCard,
  upsertPackagePreview,
  type PackagePreview,
} from "../components/lite/lite-rendering";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sparkles, Send, Upload, Download, Trash2, FileText, ListChecks, Wrench,
  History, BarChart3, Zap, GitCompare, Clock, CheckCircle2, XCircle, Loader2,
} from "lucide-react";

type DetailTab = "agent" | "rubric" | "skills" | "versions" | "report" | "optimization" | "diff";
type ProgressState = { title: string; phase: string; steps: string[]; startedAt: number; active: boolean; isError: boolean };

export default function LiteWorkspace() {
  const token = useAuthStore((s) => s.token) || "";
  const [user, setUser] = useState<UserSummary | null>(null);
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
  const [model, setModel] = useState("");
  const [instruction, setInstruction] = useState("");
  const [input, setInput] = useState("");
  const [, setStatus] = useState("");
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [generatePreviews, setGeneratePreviews] = useState<PackagePreview[]>([]);
  const [sideStreaming, setSideStreaming] = useState({ baseline: false, enhanced: false });
  const [nowMs, setNowMs] = useState(Date.now());
  const fileRef = useRef<HTMLInputElement | null>(null);

  const messages = threadDetail?.messages || [];
  const selectedSkill = selectedPackage?.snapshot.skills.find((s) => s.id === selectedSkillId) || selectedPackage?.snapshot.skills[0] || null;

  useEffect(() => { const timer = window.setInterval(() => setNowMs(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { if (selectedPackage?.snapshot.skills.length) setSelectedSkillId((c) => c || selectedPackage.snapshot.skills[0]!.id); else setSelectedSkillId(""); }, [selectedPackage]);
  useEffect(() => { if (!token) return; liteApi.me(token).then(setUser).catch(() => {}); refreshPackages(); }, [token]);

  function startProgress(title: string, phase: string) { setProgress({ title, phase, steps: [phase], startedAt: Date.now(), active: true, isError: false }); }
  function pushProgress(label: string) { setProgress((prev) => prev ? { ...prev, phase: label, steps: prev.steps[prev.steps.length - 1] === label ? prev.steps : [...prev.steps, label] } : { title: "当前进度", phase: label, steps: [label], startedAt: Date.now(), active: true, isError: false }); }
  function finishProgress(label: string) { setProgress((prev) => prev ? { ...prev, active: false, isError: false, phase: label, steps: prev.steps[prev.steps.length - 1] === label ? prev.steps : [...prev.steps, label] } : null); }
  function failProgress(label: string) { setProgress((prev) => prev ? { ...prev, active: false, isError: true, phase: label, steps: prev.steps[prev.steps.length - 1] === label ? prev.steps : [...prev.steps, label] } : null); }
  function formatElapsed(ms: number) { const total = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`; }

  async function refreshPackages(preferredPackageId?: string) {
    if (!token) return;
    const list = await liteApi.listPackages(token);
    setPackages(list);
    const nextId = preferredPackageId || selectedPackageId || list[0]?.id || "";
    if (nextId) await openPackage(nextId, list);
    else { setSelectedPackageId(""); setSelectedPackage(null); setThread(null); setThreadDetail(null); setVersions([]); setReport(null); setOptimization(null); setSideStreaming({ baseline: false, enhanced: false }); }
  }

  async function openPackage(packageId: string, snapshotList?: AgentPackageSummary[]) {
    if (!token || !packageId) return;
    setSelectedPackageId(packageId);
    const detail = await liteApi.getPackage(token, packageId);
    const versionList = await liteApi.listVersions(token, packageId);
    const threads = await liteApi.listThreads(token, packageId);
    const activeThread = threads[0] || await liteApi.createThread(token, packageId, model || undefined);
    const activeDetail = await liteApi.getThread(token, activeThread.id);
    setSelectedPackage(detail); setVersions(versionList); setThread(activeThread); setThreadDetail(activeDetail); setReport(null); setOptimization(null); setDetailTab("agent"); setSideStreaming({ baseline: false, enhanced: false });
    if (!snapshotList) setPackages((prev) => prev.map((item) => item.id === packageId ? { ...item, name: detail.name, description: detail.description, versionNumber: detail.versionNumber, updatedAt: detail.updatedAt } : item));
  }

  async function handleGenerate() {
    if (!instruction.trim() || !token) return;
    startProgress("生成智能体包", "正在生成智能体包..."); setStatus("正在生成...");
    setGeneratePreviews([]);
    try {
      let createdId = "";
      await liteApi.generatePackageStream(token, instruction.trim(), model || undefined, [], (event) => {
        if (event.event === "phase") { pushProgress(event.data.label); setStatus(event.data.label); }
        if (event.event === "preview_delta") { setGeneratePreviews((prev) => appendPackagePreviewDelta(prev, event.data)); }
        if (event.event === "preview") { setGeneratePreviews((prev) => upsertPackagePreview(prev, event.data)); }
        if (event.event === "done") createdId = event.data.id;
        if (event.event === "error") throw new Error(event.data.error || "生成失败");
      });
      if (createdId) { setInstruction(""); await refreshPackages(createdId); }
      finishProgress("智能体包生成完成"); setStatus("生成完成");
    } catch (error) {
      const message = error instanceof Error ? error.message : "生成失败";
      failProgress(message); setStatus(message);
    } finally {
      setGeneratePreviews([]);
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
    setInput(""); setReport(null); setOptimization(null); setThreadDetail({ thread: threadDetail.thread, messages: [...threadDetail.messages, tempShared, tempBaseline, tempEnhanced] }); setSideStreaming({ baseline: true, enhanced: true }); startProgress("Arena 对比", "正在生成回复..."); setStatus("正在生成...");
    try {
      await liteApi.sendMessageStream(token, thread.id, prompt, model || undefined, (event) => {
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
          setThreadDetail((prev) => prev ? { thread: event.data.thread, messages: [...prev.messages.filter((m) => ![tempSharedId, tempBaselineId, tempEnhancedId].includes(m.id)), ...event.data.messages] } : prev);
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
    startProgress("生成评估报告", "正在生成报告..."); setStatus("正在生成报告...");
    try {
      let nextReport: ArenaReport | null = null;
      await liteApi.generateReportStream(token, thread.id, model || undefined, (event) => {
        if (event.event === "phase") { pushProgress(event.data.label); setStatus(event.data.label); }
        if (event.event === "done") nextReport = event.data;
        if (event.event === "error") throw new Error(event.data.error || "评估失败");
      });
      if (nextReport) { setReport(nextReport); setDetailTab("report"); }
      finishProgress("报告已生成"); setStatus("报告已生成");
    } catch (error) {
      const message = error instanceof Error ? error.message : "评估失败";
      failProgress(message); setStatus(message);
    }
  }

  async function handleOptimize() {
    if (!token || !thread?.id || !selectedPackageId) return;
    startProgress("执行优化", "正在运行专家优化..."); setStatus("正在优化...");
    try {
      let result: OptimizationResult | null = null;
      await liteApi.optimizePackageStream(token, selectedPackageId, thread.id, model || undefined, (event) => {
        if (event.event === "phase") { pushProgress(event.data.label); setStatus(event.data.label); }
        if (event.event === "done") result = event.data;
        if (event.event === "error") throw new Error(event.data.error || "优化失败");
      });
      if (result) {
        await refreshPackages(selectedPackageId);
        setOptimization(result);
        setDetailTab("optimization");
      }
      finishProgress("优化完成"); setStatus("优化完成");
    } catch (error) {
      const message = error instanceof Error ? error.message : "优化失败";
      failProgress(message); setStatus(message);
    }
  }

  async function handleDelete() {
    if (!token || !selectedPackageId) return;
    if (!window.confirm("确定要删除当前智能体包吗？")) return;
    await liteApi.deletePackage(token, selectedPackageId);
    await refreshPackages();
  }

  async function handleExport() {
    if (!token || !selectedPackageId) return;
    await liteApi.exportPackage(token, selectedPackageId);
    setStatus("导出已开始");
  }

  function formatWinner(value: ArenaReport["winningSide"]) { return value === "baseline" ? "基准模型" : value === "enhanced" ? "增强版本" : "平局"; }
  function formatExpert(value: OptimizationResult["issues"][number]["expert"]) { return value === "persona" ? "角色专家" : value === "skill" ? "技能专家" : value === "rubric" ? "评估专家" : "合并专家"; }
  function formatTarget(value: OptimizationResult["issues"][number]["target"]) { return value === "agent" ? "agent.md" : value === "skill" ? "技能文件" : "rubric.md"; }

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-background text-foreground">
      {/* Decorative layer */}
      <div className="pointer-events-none absolute inset-0 bg-mesh-gradient opacity-80" />
      <div className="pointer-events-none absolute left-[-8rem] top-[-7rem] h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(85,90,255,0.12),transparent_65%)] blur-3xl animate-float-orb-1" />
      <div className="pointer-events-none absolute right-[-8rem] top-12 h-64 w-64 rounded-full bg-[radial-gradient(circle,rgba(55,130,255,0.12),transparent_65%)] blur-3xl animate-float-orb-2" />

      <div className="relative z-10 flex h-full flex-col gap-3 p-3 sm:p-4">
        {/* Header */}
        <div className="flex items-center justify-between rounded-[20px] border border-border/70 bg-background/95 px-5 py-3 shadow-[var(--shadow-sm)]">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-[14px] bg-primary text-white font-bold">E</div>
            <div>
              <div className="text-sm font-semibold tracking-tight">EduClaw Lite</div>
              <div className="text-[11px] text-muted-foreground">Prompt + Arena + Optimize</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">{user?.username || "用户"}</span>
            <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => useAuthStore.getState().logout()}>退出</button>
          </div>
        </div>

        {/* Main workspace */}
        <div className="flex min-h-0 flex-1 overflow-hidden rounded-[24px] border border-border/70 bg-background/95 shadow-[var(--shadow-md)]">
          {/* Sidebar */}
          <aside className="flex w-80 flex-col border-r border-border bg-card/60">
            <div className="flex items-center gap-3 border-b border-border px-5 py-4">
              <div className="flex size-9 items-center justify-center rounded-xl bg-primary text-white font-bold text-sm">E</div>
              <div className="font-semibold tracking-tight text-sm">智能体包</div>
            </div>
            <ScrollArea className="flex-1">
              <div className="space-y-4 p-4">
                {/* Generate */}
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">生成智能体包</div>
                  <Textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="描述你想生成的智能体，例如：班级管理助手、作文批改导师..." rows={4} className="resize-none rounded-[16px] border-border/70 bg-card/80" />
                  <div className="flex gap-2">
                    <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="覆盖模型（可选）" className="h-9 text-xs rounded-[12px] border-border/70 bg-card/80" />
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" className="flex-1 rounded-[12px]" onClick={() => void handleGenerate()} disabled={!instruction.trim()}><Sparkles className="mr-1.5 size-3.5" />生成</Button>
                    <Button size="sm" variant="outline" className="rounded-[12px]" onClick={() => fileRef.current?.click()}><Upload className="mr-1.5 size-3.5" />导入</Button>
                    <input ref={fileRef} type="file" accept=".zip" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void handleImport(file); }} />
                  </div>
                </div>
                <div className="h-px bg-border" />
                {/* Package list */}
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">仓库 ({packages.length})</div>
                  <div className="space-y-1.5">
                    {packages.map((pkg) => (
                      <button key={pkg.id} onClick={() => void openPackage(pkg.id)} className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors ${pkg.id === selectedPackageId ? "border-primary/30 bg-primary/5" : "border-transparent hover:bg-muted"}`}>
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary font-bold text-xs">{pkg.name.charAt(0).toUpperCase()}</div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{pkg.name}</div>
                          <div className="truncate text-[11px] text-muted-foreground">v{pkg.versionNumber} · {pkg.description}</div>
                        </div>
                      </button>
                    ))}
                    {packages.length === 0 && <div className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">暂无智能体包</div>}
                  </div>
                </div>
              </div>
            </ScrollArea>
          </aside>

          {/* Main Arena */}
          <main className="flex min-w-0 flex-1 flex-col bg-card/30">
            <div className="flex items-center justify-between border-b border-border bg-card/60 px-5 py-3">
              <div className="flex items-center gap-3">
                <div className="text-sm font-semibold">Arena 对比</div>
                <div className="text-xs text-muted-foreground">同一问题同时发给基准模型与增强版本</div>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="rounded-[12px]" onClick={() => void handleReport()} disabled={!threadDetail || threadDetail.messages.length === 0}><BarChart3 className="mr-1.5 size-3.5" />评估报告</Button>
                <Button size="sm" className="rounded-[12px]" onClick={() => void handleOptimize()} disabled={!thread}><Zap className="mr-1.5 size-3.5" />优化</Button>
              </div>
            </div>

            {progress && (
              <div className={`mx-5 mt-3 rounded-[20px] border px-5 py-3 ${progress.isError ? "border-destructive/20 bg-destructive/5" : progress.active ? "border-primary/15 bg-primary/5" : "border-emerald-500/15 bg-emerald-500/5"}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    {progress.active ? <Loader2 className="size-4 animate-spin text-primary" /> : progress.isError ? <XCircle className="size-4 text-destructive" /> : <CheckCircle2 className="size-4 text-emerald-500" />}
                    {progress.title}
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground"><Clock className="size-3" />{formatElapsed(nowMs - progress.startedAt)}</div>
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
              <ConversationBoard messages={messages} sideStreaming={sideStreaming} />
            </div>

            <div className="border-t border-border bg-card/60 p-4">
              <div className="flex gap-3">
                <Textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder="输入同一个问题，同时发给基准模型和增强版本..." rows={3} className="min-h-[80px] resize-none rounded-[16px] border-border/70 bg-card/80" />
                <Button className="self-end h-10 px-5 rounded-[12px]" onClick={() => void handleSend()} disabled={!selectedPackage || !thread || sideStreaming.baseline || sideStreaming.enhanced}><Send className="mr-1.5 size-4" />发送</Button>
              </div>
            </div>
          </main>

          {/* Detail panel */}
          <aside className="flex w-96 flex-col border-l border-border bg-card/60">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="text-sm font-semibold">{selectedPackage?.name || "未选择"}</div>
              <div className="flex items-center gap-1">
                <Button size="icon" variant="ghost" className="size-7 rounded-[10px]" onClick={() => void handleExport()} disabled={!selectedPackageId}><Download className="size-3.5" /></Button>
                <Button size="icon" variant="ghost" className="size-7 rounded-[10px] text-destructive hover:text-destructive" onClick={() => void handleDelete()} disabled={!selectedPackageId}><Trash2 className="size-3.5" /></Button>
              </div>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-4 space-y-4">
                <div className="flex flex-wrap gap-1">
                  {[
                    { key: "agent" as DetailTab, label: "Agent", icon: FileText },
                    { key: "rubric" as DetailTab, label: "Rubric", icon: ListChecks },
                    { key: "skills" as DetailTab, label: "Skills", icon: Wrench },
                    { key: "versions" as DetailTab, label: "版本", icon: History },
                    { key: "report" as DetailTab, label: "报告", icon: BarChart3 },
                    { key: "optimization" as DetailTab, label: "优化", icon: Zap },
                    { key: "diff" as DetailTab, label: "对比", icon: GitCompare },
                  ].map((tab) => (
                    <button key={tab.key} onClick={() => setDetailTab(tab.key)} className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${detailTab === tab.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
                      <tab.icon className="size-3" />{tab.label}
                    </button>
                  ))}
                </div>

                {!selectedPackage && <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">请选择一个智能体包</div>}

                {selectedPackage && detailTab === "agent" && (
                  <div className="space-y-2">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">agent.md</div>
                    <div className="rounded-[20px] border border-border/70 bg-muted/50 p-4 text-sm"><MarkdownContent content={selectedPackage.snapshot.agentMd} /></div>
                  </div>
                )}

                {selectedPackage && detailTab === "rubric" && (
                  <div className="space-y-2">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">rubric.md</div>
                    <div className="rounded-[20px] border border-border/70 bg-muted/50 p-4 text-sm"><MarkdownContent content={selectedPackage.snapshot.rubricMd} /></div>
                  </div>
                )}

                {selectedPackage && detailTab === "skills" && (
                  <div className="space-y-2">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">技能文件</div>
                    {selectedPackage.snapshot.skills.length > 0 ? (
                      <>
                        <div className="flex flex-wrap gap-1">
                          {selectedPackage.snapshot.skills.map((skill) => (
                            <button key={skill.id} onClick={() => setSelectedSkillId(skill.id)} className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${selectedSkillId === skill.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>{skill.name}</button>
                          ))}
                        </div>
                        <div className="rounded-[20px] border border-border/70 bg-muted/50 p-4 text-sm"><MarkdownContent content={selectedSkill?.skillMd || "暂无技能内容"} /></div>
                      </>
                    ) : <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">暂无技能文件</div>}
                  </div>
                )}

                {selectedPackage && detailTab === "versions" && (
                  <div className="space-y-2">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">版本记录</div>
                    <div className="space-y-1.5">
                      {versions.map((v) => (
                        <div key={v.id} className="flex items-center justify-between rounded-lg border border-border/70 bg-muted/50 px-3 py-2 text-xs">
                          <span className="font-medium">v{v.versionNumber}</span>
                          <span className="text-muted-foreground">{v.source}</span>
                          <span className="text-muted-foreground">{new Date(v.createdAt).toLocaleString()}</span>
                        </div>
                      ))}
                      {versions.length === 0 && <div className="text-center text-sm text-muted-foreground py-4">暂无版本记录</div>}
                    </div>
                  </div>
                )}

                {detailTab === "report" && (report ? (
                  <div className="space-y-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">评估报告</div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-[20px] border border-border/70 bg-muted/50 p-3 text-center">
                        <div className="text-xs text-muted-foreground">基准模型</div>
                        <div className="text-2xl font-bold">{report.baseline.total}</div>
                        <div className="text-[10px] text-muted-foreground">{report.baseline.summary}</div>
                      </div>
                      <div className="rounded-[20px] border border-border/70 bg-muted/50 p-3 text-center">
                        <div className="text-xs text-muted-foreground">增强版本</div>
                        <div className="text-2xl font-bold">{report.enhanced.total}</div>
                        <div className="text-[10px] text-muted-foreground">{report.enhanced.summary}</div>
                      </div>
                    </div>
                    <div className="rounded-[20px] border border-border/70 bg-muted/50 p-3 text-sm">
                      <div><strong>结果：</strong>{formatWinner(report.winningSide)}</div>
                      <div className="mt-1"><strong>建议：</strong>{report.recommendation}</div>
                    </div>
                    <div className="overflow-hidden rounded-[20px] border border-border/70">
                      <table className="w-full text-xs">
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
                    <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">优化结果</div>
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
                ) : <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">还没有执行优化</div>)}

                {detailTab === "diff" && (optimization && selectedPackage ? (
                  <OptimizationDiffView oldSnapshot={selectedPackage.snapshot} optimization={optimization} />
                ) : <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">还没有执行优化</div>)}
              </div>
            </ScrollArea>
          </aside>
        </div>
      </div>
    </div>
  );
}
