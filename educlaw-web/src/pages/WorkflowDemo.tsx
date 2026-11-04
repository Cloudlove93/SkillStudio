import { useMemo, useState } from 'react'
import {
  Bot,
  BookOpenCheck,
  CircleDot,
  Flag,
  GitBranch,
  LockKeyhole,
  Play,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
} from 'lucide-react'

type NodeId = 'start' | 'skill' | 'llm' | 'condition' | 'end'
type NodeStatus = 'idle' | 'running' | 'success' | 'failed' | 'skipped'

type WorkflowNode = {
  id: NodeId
  name: string
  description: string
  status: NodeStatus
}

const baseNodes: WorkflowNode[] = [
  { id: 'start', name: '开始', description: '接收教师的任务输入', status: 'idle' },
  { id: 'skill', name: '教案分析 Skill', description: '提取课时目标与学生情况', status: 'idle' },
  { id: 'llm', name: '生成教学活动', description: '根据分析结果组织活动建议', status: 'idle' },
  { id: 'condition', name: '检查完整性', description: '确认输出包含目标与评价方式', status: 'idle' },
  { id: 'end', name: '结束', description: '返回教学活动方案', status: 'idle' },
]

const statusLabel: Record<NodeStatus, string> = {
  idle: '待运行',
  running: '运行中',
  success: '已完成',
  failed: '失败',
  skipped: '已跳过',
}

const nodeIcon = (id: NodeId) => {
  const className = 'size-4'
  if (id === 'start') return <Flag className={className} />
  if (id === 'skill') return <BookOpenCheck className={className} />
  if (id === 'llm') return <Sparkles className={className} />
  if (id === 'condition') return <GitBranch className={className} />
  return <CircleDot className={className} />
}

function nodeStatusStyle(status: NodeStatus) {
  if (status === 'running') return 'border-primary bg-primary/5 ring-4 ring-primary/10'
  if (status === 'success') return 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30'
  if (status === 'failed') return 'border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/30'
  if (status === 'skipped') return 'border-border bg-muted/50 opacity-65'
  return 'border-border bg-card hover:border-primary/50'
}

function badgeStyle(status: NodeStatus) {
  if (status === 'running') return 'bg-primary/10 text-primary'
  if (status === 'success') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
  if (status === 'failed') return 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300'
  return 'bg-muted text-muted-foreground'
}

export default function WorkflowDemo({ embedded = false }: { embedded?: boolean }) {
  const [workflowEnabled, setWorkflowEnabled] = useState(true)
  const [nodes, setNodes] = useState(baseNodes)
  const [selectedId, setSelectedId] = useState<NodeId>('skill')
  const [isRunning, setIsRunning] = useState(false)
  const [simulateFailure, setSimulateFailure] = useState(false)
  const [savedAt, setSavedAt] = useState('尚未保存')
  const [log, setLog] = useState('等待试跑')

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedId) ?? nodes[0],
    [nodes, selectedId],
  )

  function updateStatus(id: NodeId, status: NodeStatus) {
    setNodes((current) => current.map((node) => (node.id === id ? { ...node, status } : node)))
  }

  function resetRun() {
    setIsRunning(false)
    setNodes(baseNodes)
    setLog('运行状态已清除')
  }

  function saveWorkflow() {
    setSavedAt(new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date()))
    setLog('已保存工作流草稿（本地数据）')
  }

  async function runWorkflow(forceSuccess = false) {
    if (isRunning) return
    setIsRunning(true)
    setNodes(baseNodes)
    setLog('正在执行：接收教学任务…')

    const pause = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))
    const steps: Array<[NodeId, string]> = [
      ['start', '已接收输入：为初一学生设计一节光合作用导入课'],
      ['skill', '教案分析 Skill 已提取学习目标与常见误区'],
      ['llm', '正在组织问题链、活动与形成性评价…'],
      ['condition', '正在检查输出是否完整…'],
      ['end', '已生成可直接使用的教学活动方案'],
    ]

    for (const [id, message] of steps) {
      updateStatus(id, 'running')
      setSelectedId(id)
      setLog(message)
      await pause(620)

      if (simulateFailure && !forceSuccess && id === 'llm') {
        updateStatus(id, 'failed')
        updateStatus('condition', 'skipped')
        updateStatus('end', 'skipped')
        setLog('生成教学活动失败：模型服务暂不可用，可重试该节点')
        setIsRunning(false)
        return
      }

      updateStatus(id, 'success')
    }

    setLog('试跑完成：已生成“光合作用导入课”活动方案')
    setIsRunning(false)
  }

  function retryFailedNode() {
    setSimulateFailure(false)
    void runWorkflow(true)
  }

  if (!workflowEnabled) {
    return (
      <main className={`${embedded ? 'min-h-full' : 'min-h-screen'} bg-background px-5 py-10 text-foreground`}>
        <section className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center rounded-3xl border border-border bg-card p-9 text-center shadow-sm">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground"><LockKeyhole className="size-6" /></div>
          <h1 className="mt-5 text-xl font-semibold">工作流已关闭</h1>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">灰度开关关闭后，教师不会看到工作流编辑入口。</p>
          <button type="button" onClick={() => setWorkflowEnabled(true)} className="mt-6 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm">
            重新开启
          </button>
        </section>
      </main>
    )
  }

  return (
    <main className={`${embedded ? 'min-h-full' : 'min-h-screen'} bg-background text-foreground`}>
      <header className="border-b border-border bg-card/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-5 py-4 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Bot className="size-5" /></div>
            <div className="min-w-0">
              <p className="text-sm font-semibold">初中生物备课助手</p>
              <p className="text-xs text-muted-foreground">编辑 Agent · 工作流</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setWorkflowEnabled(false)} className="hidden rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted-foreground transition hover:bg-muted sm:inline-flex">
              关闭灰度
            </button>
            <button type="button" onClick={saveWorkflow} className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium transition hover:bg-muted">
              <Save className="size-4" /> 保存
            </button>
            <button type="button" onClick={() => void runWorkflow()} disabled={isRunning} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60">
              <Play className="size-4" fill="currentColor" /> {isRunning ? '试跑中…' : '整体试跑'}
            </button>
          </div>
        </div>
      </header>

      <div className={`${embedded ? 'max-w-none px-4 py-4 lg:px-5' : 'mx-auto max-w-[1500px] px-5 py-5 lg:px-8'}`}>
        <section className="mb-5 flex flex-col justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <span className="inline-flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><GitBranch className="size-4" /></span>
            <div>
              <p className="text-sm font-semibold">教学活动生成流程</p>
              <p className="text-xs text-muted-foreground">草稿已启用 · {savedAt}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button type="button" onClick={() => setSimulateFailure((value) => !value)} className={`rounded-full px-3 py-1.5 font-medium ${simulateFailure ? 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300' : 'bg-muted text-muted-foreground'}`}>
              {simulateFailure ? '模拟 LLM 失败：开' : '模拟 LLM 失败：关'}
            </button>
            <button type="button" onClick={resetRun} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 font-medium text-muted-foreground hover:bg-muted"><RotateCcw className="size-3.5" /> 清除运行状态</button>
          </div>
        </section>

        <div className="grid gap-5 xl:grid-cols-[224px_minmax(0,1fr)_320px]">
          <aside className="rounded-2xl border border-border bg-card p-4">
            <p className="text-xs font-semibold tracking-[0.12em] text-muted-foreground">节点库</p>
            <p className="mt-1 text-xs text-muted-foreground">点击节点即可查看配置。</p>
            <div className="mt-4 grid grid-cols-2 gap-2 xl:grid-cols-1">
              {baseNodes.map((node) => (
                <button key={node.id} type="button" onClick={() => setSelectedId(node.id)} className="flex items-center gap-2 rounded-xl border border-border px-3 py-2.5 text-left text-sm transition hover:border-primary/50 hover:bg-primary/5">
                  <span className="text-primary">{nodeIcon(node.id)}</span>
                  <span className="font-medium">{node.name}</span>
                  {node.id !== 'start' && node.id !== 'end' && <Plus className="ml-auto size-3.5 text-muted-foreground" />}
                </button>
              ))}
            </div>
            <div className="mt-5 rounded-xl bg-muted p-3 text-xs leading-5 text-muted-foreground">
              <span className="font-semibold text-foreground">当前范围</span><br />仅模拟画布与执行状态，不会调用真实 Skill 或模型。
            </div>
          </aside>

          <section className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2"><span className="size-2 rounded-full bg-emerald-500" /><span className="text-sm font-medium">流程画布</span></div>
              <span className="text-xs text-muted-foreground">版本 v2 · 自动保存草稿</span>
            </div>
            <div className="relative min-h-[520px] overflow-x-auto bg-[radial-gradient(rgba(85,90,255,0.11)_1px,transparent_1px)] bg-[size:20px_20px] p-5">
              <div className="relative mx-auto h-[470px] min-w-[760px] max-w-[1050px]">
                <svg viewBox="0 0 1050 470" className="pointer-events-none absolute inset-0 size-full" aria-hidden="true">
                  <defs><marker id="workflow-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" /></marker></defs>
                  <path d="M 183 235 H 312" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary/45" markerEnd="url(#workflow-arrow)" />
                  <path d="M 470 235 H 570" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary/45" markerEnd="url(#workflow-arrow)" />
                  <path d="M 716 235 H 760 V150 H 790" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary/45" markerEnd="url(#workflow-arrow)" />
                  <path d="M 850 207 V 295" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary/45" markerEnd="url(#workflow-arrow)" />
                </svg>
                <div className="absolute left-[3%] top-[185px] w-[160px]"><WorkflowNodeCard node={nodes[0]} selected={selectedId === 'start'} onSelect={setSelectedId} /></div>
                <div className="absolute left-[30%] top-[185px] w-[160px]"><WorkflowNodeCard node={nodes[1]} selected={selectedId === 'skill'} onSelect={setSelectedId} /></div>
                <div className="absolute left-[55%] top-[185px] w-[160px]"><WorkflowNodeCard node={nodes[2]} selected={selectedId === 'llm'} onSelect={setSelectedId} /></div>
                <div className="absolute left-[75%] top-[92px] w-[150px]"><WorkflowNodeCard node={nodes[3]} selected={selectedId === 'condition'} onSelect={setSelectedId} /></div>
                <div className="absolute left-[75%] top-[300px] w-[150px]"><WorkflowNodeCard node={nodes[4]} selected={selectedId === 'end'} onSelect={setSelectedId} /></div>
                <span className="absolute left-[77%] top-[233px] rounded bg-background px-1.5 text-[10px] font-medium text-emerald-600">通过</span>
              </div>
            </div>
          </section>

          <aside className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-2">
              <div><p className="text-xs font-semibold tracking-[0.12em] text-muted-foreground">节点配置</p><h2 className="mt-1 text-base font-semibold">{selectedNode.name}</h2></div>
              <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${badgeStyle(selectedNode.status)}`}>{statusLabel[selectedNode.status]}</span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{selectedNode.description}</p>
            <NodeSettings id={selectedNode.id} />
            <div className="mt-5 border-t border-border pt-4">
              <p className="text-xs font-semibold tracking-[0.12em] text-muted-foreground">最近运行</p>
              <div className="mt-2 rounded-xl bg-muted p-3 text-sm leading-5 text-muted-foreground">{log}</div>
              {selectedNode.status === 'failed' && <button type="button" onClick={retryFailedNode} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"><RotateCcw className="size-4" /> 重试该节点</button>}
            </div>
          </aside>
        </div>
      </div>
    </main>
  )
}

function WorkflowNodeCard({ node, selected, onSelect }: { node: WorkflowNode; selected: boolean; onSelect: (id: NodeId) => void }) {
  return (
    <button type="button" onClick={() => onSelect(node.id)} className={`w-full rounded-xl border p-3 text-left shadow-sm transition ${nodeStatusStyle(node.status)} ${selected ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''}`}>
      <div className="flex items-center justify-between gap-2"><span className="text-primary">{nodeIcon(node.id)}</span><span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${badgeStyle(node.status)}`}>{statusLabel[node.status]}</span></div>
      <p className="mt-3 truncate text-sm font-semibold">{node.name}</p>
      <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">{node.description}</p>
    </button>
  )
}

function NodeSettings({ id }: { id: NodeId }) {
  const content: Record<NodeId, { label: string; value: string }> = {
    start: { label: '输入变量', value: '{{ $input }}' },
    skill: { label: '固定 Skill 版本', value: '教案分析 · v1.4' },
    llm: { label: '提示词', value: '基于分析结果，生成 15 分钟导入活动。' },
    condition: { label: '判断规则', value: '输出包含“学习目标”且包含“评价方式”' },
    end: { label: '输出模板', value: '{{ $node.llm.output.text }}' },
  }
  const setting = content[id]
  return (
    <label className="mt-5 block text-xs font-medium text-muted-foreground">
      {setting.label}
      <div className="mt-1.5 rounded-lg border border-border bg-muted/60 px-3 py-2.5 text-sm font-normal leading-5 text-foreground">{setting.value}</div>
      {id === 'skill' && <span className="mt-1.5 block text-[11px] text-muted-foreground">已锁定版本，保证试跑结果可复现。</span>}
    </label>
  )
}
