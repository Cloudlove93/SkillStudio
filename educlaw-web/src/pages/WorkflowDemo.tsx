import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  Background, BaseEdge, Controls, EdgeLabelRenderer, Handle, MarkerType, MiniMap,
  Position, ReactFlow, getBezierPath, useEdgesState, useNodesState,
  type Connection, type Edge, type EdgeProps, type Node, type NodeProps, type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ChevronLeft, ChevronRight, FolderOpen, GitBranch, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Play, Plus, Save, Trash2 } from 'lucide-react';
import type { AgentPackageDetail, WorkflowDefinition, WorkflowEdge, WorkflowNode, WorkflowRunReport } from '@educlaw/shared';
import { toast } from 'sonner';
import { liteApi } from '../api/lite-api';

type Props = { embedded?: boolean; token?: string; packageId?: string; packageVersionId?: string | null; onOpenLibrary?: () => void };
type InsertableNodeType = 'llm' | 'skill' | 'condition' | 'loop';
type CanvasNodeData = { node: WorkflowNode; selected: boolean; trace?: string };

const nodeLabels: Record<WorkflowNode['type'], string> = { start: '开始', llm: 'LLM', skill: 'Skill', condition: '条件', loop: '循环', end: '结束' };
const nodeColors: Record<WorkflowNode['type'], string> = { start: '#2563eb', llm: '#7c3aed', skill: '#0f766e', condition: '#b45309', loop: '#be185d', end: '#475569' };

function id(prefix: string) {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? `${prefix}-${crypto.randomUUID()}` : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function defaultWorkflow(): WorkflowDefinition {
  return { schemaVersion: 1, nodes: [
    { id: 'start', type: 'start', name: '开始', position: { x: 80, y: 180 }, params: {} },
    { id: 'end', type: 'end', name: '结束', position: { x: 420, y: 180 }, params: { outputTemplate: '' } },
  ], edges: [{ id: 'start-end', from: 'start', to: 'end' }] };
}
function newWorkflowNode(type: InsertableNodeType, position: { x: number; y: number }): WorkflowNode {
  const nodeId = id(type);
  if (type === 'skill') return { id: nodeId, type, name: '调用 Skill', position, params: { skillId: '', inputTemplate: '' } };
  if (type === 'condition') return { id: nodeId, type, name: '条件分支', position, params: { left: '', operator: 'not_empty', right: '' } };
  if (type === 'loop') return { id: nodeId, type, name: '循环处理', position, params: { iterations: 3, promptTemplate: '根据工作流输入逐轮完善结果。' } };
  return { id: nodeId, type, name: 'LLM 步骤', position, params: { promptTemplate: '' } };
}
function edgeFor(from: string, to: string, condition?: WorkflowEdge['condition']): WorkflowEdge {
  return { id: id('edge'), from, to, ...(condition ? { condition } : {}) };
}
function insertNodeOnEdge(workflow: WorkflowDefinition, type: InsertableNodeType, edgeId: string, position?: { x: number; y: number }): WorkflowDefinition {
  const edge = workflow.edges.find(item => item.id === edgeId);
  const source = edge ? workflow.nodes.find(node => node.id === edge.from) : undefined;
  const target = edge ? workflow.nodes.find(node => node.id === edge.to) : undefined;
  const fallbackPosition = source && target
    ? { x: Math.round((source.position.x + target.position.x) / 2), y: Math.round((source.position.y + target.position.y) / 2) }
    : { x: 260, y: 160 };
  const node = newWorkflowNode(type, position || fallbackPosition);
  return { ...workflow, nodes: [...workflow.nodes, node] };
}
function wouldCreateCycle(workflow: WorkflowDefinition, from: string, to: string) {
  const visited = new Set<string>();
  const visit = (nodeId: string): boolean => {
    if (nodeId === from) return true;
    if (visited.has(nodeId)) return false;
    visited.add(nodeId);
    return workflow.edges.filter(edge => edge.from === nodeId).some(edge => visit(edge.to));
  };
  return visit(to);
}
function deleteWorkflowNode(workflow: WorkflowDefinition, nodeId: string): WorkflowDefinition {
  const node = workflow.nodes.find(item => item.id === nodeId);
  if (!node || node.type === 'start' || node.type === 'end') return workflow;
  const incoming = workflow.edges.find(edge => edge.to === nodeId);
  const outgoing = workflow.edges.filter(edge => edge.from === nodeId);
  const remaining = workflow.edges.filter(edge => edge.from !== nodeId && edge.to !== nodeId);
  if (incoming && outgoing[0] && !remaining.some(edge => edge.from === incoming.from && edge.to === outgoing[0].to && edge.condition === incoming.condition)) remaining.push(edgeFor(incoming.from, outgoing[0].to, incoming.condition));
  return { ...workflow, nodes: workflow.nodes.filter(item => item.id !== nodeId), edges: remaining };
}

function WorkflowCanvasNode(props: NodeProps) {
  const data = props.data as unknown as CanvasNodeData;
  const node = data.node;
  const isCondition = node.type === 'condition';
  return <div className={`min-w-40 rounded-xl border bg-card px-3 py-2.5 shadow-sm ${data.selected ? 'border-primary ring-2 ring-primary/25' : 'border-border'}`}>
    {node.type !== 'start' ? <Handle type="target" position={Position.Left} className="!bg-primary" /> : null}
    <div className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ backgroundColor: nodeColors[node.type] }} /><span className="text-xs font-medium text-muted-foreground">{nodeLabels[node.type]}</span></div>
    <strong className="mt-1 block max-w-36 truncate text-sm">{node.name}</strong>
    <span className="mt-1 block text-xs text-muted-foreground">{data.trace || (node.type === 'skill' && !node.params.skillId ? '未绑定 Skill' : '待运行')}</span>
    {node.type !== 'end' && !isCondition ? <Handle type="source" position={Position.Right} className="!bg-primary" /> : null}
    {isCondition ? <><Handle id="true" type="source" position={Position.Right} className="!top-[38%] !bg-emerald-600" /><Handle id="false" type="source" position={Position.Right} className="!top-[72%] !bg-amber-600" /></> : null}
  </div>;
}
function InsertableEdge(props: EdgeProps) {
  const [path, labelX, labelY] = getBezierPath(props);
  const onInsert = (props.data as { onInsert?: (edgeId: string) => void } | undefined)?.onInsert;
  return <><BaseEdge path={path} markerEnd={props.markerEnd} style={props.style} /><EdgeLabelRenderer><button type="button" className="nodrag nopan absolute grid size-5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border bg-background text-xs text-muted-foreground shadow-sm hover:border-primary hover:text-primary" style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }} onClick={() => onInsert?.(props.id)} aria-label="在线路中插入节点" title="在线路中插入节点">+</button></EdgeLabelRenderer></>;
}
const nodeTypes = { workflow: WorkflowCanvasNode };
const edgeTypes = { insertable: InsertableEdge };

type TemplateField = 'promptTemplate' | 'inputTemplate' | 'left' | 'right' | 'outputTemplate';
type NodeConfigPanelProps = {
  node: WorkflowNode;
  skills: Array<{ id: string; name: string }>;
  upstreamNodes: WorkflowNode[];
  input: string;
  onInputChange: (value: string) => void;
  onClose: () => void;
  onDelete: () => void;
  onRename: (value: string) => void;
  onUpdateParams: (params: Record<string, unknown>) => void;
};

function NodeConfigPanel({ node, skills, upstreamNodes, input, onInputChange, onClose, onDelete, onRename, onUpdateParams }: NodeConfigPanelProps) {
  const initialField: TemplateField | null = node.type === 'llm' || node.type === 'loop' ? 'promptTemplate' : node.type === 'skill' ? 'inputTemplate' : node.type === 'condition' ? 'left' : node.type === 'end' ? 'outputTemplate' : null;
  const [activeField, setActiveField] = useState<TemplateField | null>(initialField);
  useEffect(() => setActiveField(initialField), [initialField, node.id]);
  const parameter = (field: TemplateField, label: string, multiline = true, placeholder?: string) => {
    const value = String(node.params[field] || '');
    const referencesVariable = /{{\s*\$/.test(value);
    const isInputReference = /^{{\s*\$input\s*}}$/.test(value);
    const isNodeReference = /^{{\s*\$node\.[A-Za-z0-9_-]+\.output\.text\s*}}$/.test(value);
    const referenceName = isInputReference ? '工作流输入' : isNodeReference ? '上游节点输出' : '';
    return <div className="rounded-xl border p-3">
      <div className="flex items-center justify-between gap-2"><label className="text-sm font-medium" htmlFor={`${node.id}-${field}`}>{label}</label><div className="flex rounded-md bg-muted p-0.5 text-xs"><button type="button" className={`rounded px-2 py-1 ${!referencesVariable ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'}`} onClick={() => setActiveField(field)}>固定值</button><button type="button" className={`rounded px-2 py-1 ${referencesVariable ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'}`} onClick={() => setActiveField(field)}>引用变量</button></div></div>
      {referenceName ? <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-dashed bg-muted/40 px-3 py-2 text-sm"><span>已引用：<strong>{referenceName}</strong></span><button type="button" className="text-xs text-primary hover:underline" onClick={() => { setActiveField(field); onUpdateParams({ ...node.params, [field]: '' }); }}>改为固定值</button></div> : multiline ? <textarea id={`${node.id}-${field}`} className="mt-2 min-h-24 w-full resize-y rounded-lg border bg-background p-2 text-sm outline-none focus:border-primary" value={value} placeholder={placeholder} onFocus={() => setActiveField(field)} onChange={event => onUpdateParams({ ...node.params, [field]: event.target.value })} /> : <input id={`${node.id}-${field}`} className="mt-2 w-full rounded-lg border bg-background p-2 text-sm outline-none focus:border-primary" value={value} placeholder={placeholder} onFocus={() => setActiveField(field)} onChange={event => onUpdateParams({ ...node.params, [field]: event.target.value })} />}
      <p className="mt-2 text-xs text-muted-foreground">{referencesVariable ? '当前使用变量。可在下方变量列表中更换。' : '当前使用固定值；点击“引用变量”后可从下方选择。'}</p>
    </div>;
  };
  const availableVariables = [{ label: '工作流输入', detail: '开始节点 · 用户输入', value: '{{ $input }}' }, ...upstreamNodes.filter(item => item.type === 'llm' || item.type === 'skill' || item.type === 'loop').map(item => ({ label: `${item.name} 的输出`, detail: `${nodeLabels[item.type]} · ${item.id.slice(0, 8)}`, value: `{{ $node.${item.id}.output.text }}` }))];
  const insertVariable = (value: string) => {
    if (!activeField) { toast.error('请先选择一个输入参数'); return; }
    const current = String(node.params[activeField] || '');
    onUpdateParams({ ...node.params, [activeField]: current ? `${current}${value}` : value });
  };
  return <aside className="max-h-[calc(100vh-7rem)] overflow-y-auto rounded-2xl border bg-card p-4">
    <div className="flex items-center justify-between gap-2"><div><h2 className="text-sm font-semibold">节点配置</h2><p className="mt-1 text-xs text-muted-foreground">{nodeLabels[node.type]} 节点</p></div><button type="button" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={onClose} title="隐藏节点配置" aria-label="隐藏节点配置"><PanelRightClose className="size-4" /></button></div>
    <section className="mt-4 border-b pb-4"><label className="block text-sm font-medium" htmlFor="workflow-node-name">节点名称<input id="workflow-node-name" className="mt-2 w-full rounded-lg border bg-background p-2 text-sm outline-none focus:border-primary" value={node.name} onChange={event => onRename(event.target.value)} /></label></section>
    <section className="mt-4"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold">输入</h3><span className="text-xs text-muted-foreground">固定值或变量引用</span></div><div className="mt-3 grid gap-3">
      {node.type === 'llm' ? parameter('promptTemplate', '提示词', true, '描述这个 LLM 节点要完成的任务') : null}
      {node.type === 'loop' ? <><div className="rounded-xl border p-3"><label className="block text-sm font-medium">循环次数<input className="mt-2 w-full rounded-lg border bg-background p-2 text-sm font-normal outline-none focus:border-primary" type="number" min="1" max="20" value={String(node.params.iterations || 1)} onChange={event => onUpdateParams({ ...node.params, iterations: Math.max(1, Math.min(20, Number(event.target.value) || 1)) })} /></label><p className="mt-2 text-xs leading-5 text-muted-foreground">每轮会带入上一轮结果，最多 20 轮；不需要额外回连画布。</p></div>{parameter('promptTemplate', '每轮处理说明', true, '例如：检查并完善上一轮结果，直到内容更清晰完整')}</> : null}
      {node.type === 'skill' ? <><label className="block rounded-xl border p-3 text-sm font-medium">调用的 Skill<select className="mt-2 w-full rounded-lg border bg-background p-2 text-sm font-normal outline-none focus:border-primary" value={String(node.params.skillId || '')} onChange={event => onUpdateParams({ ...node.params, skillId: event.target.value })}><option value="">暂不绑定（草稿）</option>{skills.map(skill => <option key={skill.id} value={skill.id}>{skill.name}</option>)}</select></label>{!skills.length ? <p className="rounded-lg bg-muted px-3 py-2 text-xs leading-5 text-muted-foreground">当前工作流还没有可绑定的 Skill；可先保存草稿，之后再绑定。</p> : null}{parameter('inputTemplate', '输入内容', true, '填写固定内容，或引用上游节点输出')}</> : null}
      {node.type === 'condition' ? <><div className="rounded-xl border p-3"><label className="block text-sm font-medium">判断方式<select className="mt-2 w-full rounded-lg border bg-background p-2 text-sm font-normal outline-none focus:border-primary" value={String(node.params.operator || 'not_empty')} onChange={event => onUpdateParams({ ...node.params, operator: event.target.value })}><option value="not_empty">不为空</option><option value="is_empty">为空</option><option value="equals">等于</option><option value="not_equals">不等于</option><option value="contains">包含</option><option value="not_contains">不包含</option></select></label></div>{parameter('left', '待判断内容', false, '例如：用户提交的内容')}{!['is_empty', 'not_empty'].includes(String(node.params.operator || 'not_empty')) ? parameter('right', '比较值', false, '例如：通过') : null}</> : null}
      {node.type === 'end' ? parameter('outputTemplate', '工作流输出', true, '设置最终输出内容') : null}
      {node.type === 'start' ? <div className="rounded-xl border border-dashed p-3 text-sm"><p className="font-medium">工作流输入</p><p className="mt-1 text-xs leading-5 text-muted-foreground">试运行时填写的内容会作为工作流输入，供后续节点按需引用。</p></div> : null}
    </div></section>
    {node.type !== 'start' ? <section className="mt-4"><h3 className="text-sm font-semibold">可用变量</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">点击变量，插入到当前选中的输入参数。</p><div className="mt-2 grid gap-2">{availableVariables.map(variable => <button key={variable.value} type="button" className="rounded-lg border px-3 py-2 text-left hover:border-primary hover:bg-muted/50" onClick={() => insertVariable(variable.value)}><span className="block text-xs font-medium">{variable.label}</span><span className="mt-1 block text-[11px] text-muted-foreground">{variable.detail}</span></button>)}</div></section> : null}
    {node.type !== 'start' && node.type !== 'end' ? <details className="mt-4 rounded-xl border p-3"><summary className="cursor-pointer text-sm font-medium">高级设置</summary><div className="mt-3 grid gap-3"><label className="block text-sm">失败处理<select className="mt-1 w-full rounded-lg border bg-background p-2 text-sm" value={String(node.params.errorMode || 'fail')} onChange={event => onUpdateParams({ ...node.params, errorMode: event.target.value })}><option value="fail">中断工作流</option><option value="continue">继续后续节点</option></select></label><label className="block text-sm">失败重试次数<input className="mt-1 w-full rounded-lg border bg-background p-2 text-sm" type="number" min="0" max="3" value={String(node.params.retryCount || 0)} onChange={event => onUpdateParams({ ...node.params, retryCount: Number(event.target.value) || 0 })} /></label><p className="text-xs leading-5 text-muted-foreground">高级配置会随草稿保存；运行引擎将逐步支持继续执行和自动重试。</p></div></details> : null}
    {node.type !== 'start' && node.type !== 'end' ? <button type="button" className="mt-5 inline-flex items-center gap-2 rounded-lg border border-destructive/40 px-3 py-2 text-sm text-destructive hover:bg-destructive/5" onClick={onDelete}><Trash2 className="size-4" />删除节点</button> : null}
    <section className="mt-5 border-t pt-4"><label className="block text-sm font-medium">试运行输入<textarea className="mt-2 min-h-24 w-full rounded-lg border bg-background p-2 text-sm outline-none focus:border-primary" value={input} onChange={event => onInputChange(event.target.value)} placeholder="输入一项教学任务" /></label></section>
  </aside>;
}

export default function WorkflowDemo({ embedded = false, token, packageId, packageVersionId, onOpenLibrary }: Props) {
  const [pkg, setPkg] = useState<AgentPackageDetail | null>(null);
  const [versionId, setVersionId] = useState(packageVersionId || '');
  const [createdPackageId, setCreatedPackageId] = useState<string | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowDefinition>(defaultWorkflow);
  const [selectedId, setSelectedId] = useState('start');
  const [input, setInput] = useState('');
  const [run, setRun] = useState<WorkflowRunReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [insertEdgeId, setInsertEdgeId] = useState<string | null>(null);
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance | null>(null);
  const [nodeLibraryOpen, setNodeLibraryOpen] = useState(true);
  const [nodeConfigOpen, setNodeConfigOpen] = useState(true);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [flowNodes, setFlowNodes, onFlowNodesChange] = useNodesState<Node>([]);
  const [flowEdges, setFlowEdges, onFlowEdgesChange] = useEdgesState<Edge>([]);
  const undoStack = useRef<WorkflowDefinition[]>([]);
  const redoStack = useRef<WorkflowDefinition[]>([]);
  const workflowPackageId = packageId || createdPackageId;

  useEffect(() => {
    if (!token || !workflowPackageId) return;
    void Promise.all([liteApi.getPackage(token, workflowPackageId), liteApi.listVersions(token, workflowPackageId)]).then(([detail, versions]) => {
      const savedWorkflow = detail.snapshot.workflow;
      setPkg(detail); setWorkflow(savedWorkflow || defaultWorkflow()); setSelectedId(savedWorkflow?.nodes[0]?.id || 'start'); setVersionId(packageVersionId || String(versions[0]?.id || ''));
      undoStack.current = []; redoStack.current = [];
    }).catch(error => toast.error(error instanceof Error ? error.message : '无法加载工作流'));
  }, [packageVersionId, token, workflowPackageId]);

  const updateWorkflow = (recipe: (current: WorkflowDefinition) => WorkflowDefinition) => setWorkflow(current => {
    const next = recipe(current);
    if (next !== current) { undoStack.current.push(current); redoStack.current = []; }
    return next;
  });
  const undo = () => { const previous = undoStack.current.pop(); if (previous) setWorkflow(current => { redoStack.current.push(current); return previous; }); };
  const redo = () => { const next = redoStack.current.pop(); if (next) setWorkflow(current => { undoStack.current.push(current); return next; }); };
  const updateParams = (params: Record<string, unknown>) => updateWorkflow(current => ({ ...current, nodes: current.nodes.map(node => node.id === selectedId ? { ...node, params } : node) }));
  const insertNode = (type: InsertableNodeType, edgeId?: string, position?: { x: number; y: number }) => {
    updateWorkflow(current => insertNodeOnEdge(current, type, edgeId || current.edges.find(edge => edge.to === 'end')?.id || current.edges[0]?.id || '', position));
    setInsertEdgeId(null);
  };

  const selected = useMemo(() => workflow.nodes.find(node => node.id === selectedId) || workflow.nodes[0], [selectedId, workflow.nodes]);
  const traceByNode = new Map(run?.traces.map(trace => [trace.nodeId, trace]) || []);
  const canvasNodes = useMemo<Node[]>(() => workflow.nodes.map(node => ({ id: node.id, type: 'workflow', position: node.position, data: { node, selected: node.id === selectedId, trace: traceByNode.get(node.id)?.status } })), [selectedId, workflow.nodes, run]);
  const canvasEdges = useMemo<Edge[]>(() => workflow.edges.map(edge => ({ id: edge.id, source: edge.from, target: edge.to, sourceHandle: edge.condition, type: 'insertable', label: edge.condition, markerEnd: { type: MarkerType.ArrowClosed }, data: { onInsert: (edgeId: string) => setInsertEdgeId(edgeId) }, labelStyle: { fontSize: 11, fill: '#64748b' } })), [workflow.edges]);
  useEffect(() => { setFlowNodes(canvasNodes); }, [canvasNodes, setFlowNodes]);
  useEffect(() => { setFlowEdges(canvasEdges); }, [canvasEdges, setFlowEdges]);
  const layout = embedded ? 'min-h-full p-4 lg:p-5' : 'min-h-screen p-6';
  const unboundSkillNodes = workflow.nodes.filter(node => node.type === 'skill' && !String(node.params.skillId || '').trim());

  async function save() {
    if (!token) return;
    setBusy(true);
    try {
      if (!workflowPackageId) {
        const detail = await liteApi.createWorkflow(token, workflow); const newPackageId = String(detail.id); const versions = await liteApi.listVersions(token, newPackageId);
        setCreatedPackageId(newPackageId); setPkg(detail); setVersionId(String(versions[0]?.id || '')); toast.success('工作流草稿已创建');
      } else {
        if (!versionId) return;
        await liteApi.validateWorkflow(token, workflowPackageId, workflow);
        const detail = await liteApi.saveWorkflow(token, workflowPackageId, { expectedPackageVersionId: versionId, definition: workflow }); const versions = await liteApi.listVersions(token, workflowPackageId);
        setPkg(detail); setVersionId(String(versions[0]?.id || versionId)); toast.success('工作流已保存为新版本');
      }
    } catch (error) { toast.error(error instanceof Error ? error.message : '保存工作流失败'); } finally { setBusy(false); }
  }
  async function execute() {
    if (!workflowPackageId || !versionId) { toast.error('请先保存工作流'); return; }
    if (!input.trim()) { toast.error('请先填写试跑输入'); return; }
    setBusy(true);
    try { const report = await liteApi.runWorkflow(token!, workflowPackageId, { packageVersionId: versionId, requestId: id('run'), content: input }); setRun(report); report.status === 'succeeded' ? toast.success('试跑完成') : toast.error(report.error?.message || '试跑失败'); }
    catch (error) { toast.error(error instanceof Error ? error.message : '启动试跑失败'); } finally { setBusy(false); }
  }
  const onConnect = (connection: Connection) => {
    if (!connection.source || !connection.target) return;
    updateWorkflow(current => {
      const source = current.nodes.find(node => node.id === connection.source); const target = current.nodes.find(node => node.id === connection.target);
      if (!source || !target || source.type === 'end' || target.type === 'start') return current;
      if (wouldCreateCycle(current, connection.source!, connection.target!)) { toast.error('工作流不能形成循环'); return current; }
      const condition = source.type === 'condition' ? (connection.sourceHandle === 'false' ? 'false' : 'true') : undefined;
      const rewired = current.edges.filter(edge => {
        const replacesSource = edge.from === connection.source && (source.type === 'condition' ? edge.condition === condition : true);
        const replacesTarget = target.type !== 'end' && edge.to === connection.target;
        return !replacesSource && !replacesTarget;
      });
      return { ...current, edges: [...rewired, edgeFor(connection.source!, connection.target!, condition)] };
    });
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault(); const type = event.dataTransfer.getData('application/educlaw-workflow-node') as InsertableNodeType;
    if (!['llm', 'skill', 'condition'].includes(type)) return;
    insertNode(type, insertEdgeId || undefined, flowInstance?.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  };

  return <main className={layout}>
    <header className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card px-5 py-4">
      <div><h1 className="text-lg font-semibold">{pkg?.name || '未命名工作流'}</h1><p className="text-sm text-muted-foreground">{workflowPackageId ? `当前版本 ${versionId || '加载中'}；可先保存未绑定 Skill 的草稿。` : '直接编辑画布；首次保存时创建工作流草稿。'}</p></div>
      <div className="flex flex-wrap gap-2">{onOpenLibrary ? <button className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm" onClick={onOpenLibrary}><FolderOpen className="size-4" />工作流库</button> : null}<button className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm disabled:opacity-50" disabled={!undoStack.current.length || busy} onClick={undo}><ChevronLeft className="size-4" />撤销</button><button className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm disabled:opacity-50" disabled={!redoStack.current.length || busy} onClick={redo}>重做<ChevronRight className="size-4" /></button><button className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm" disabled={busy} onClick={() => void save()}><Save className="size-4" />保存草稿</button><button className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60" disabled={busy || unboundSkillNodes.length > 0} onClick={() => void execute()} title={unboundSkillNodes.length ? '请先为所有 Skill 节点选择 Skill' : undefined}><Play className="size-4" />整体试跑</button></div>
    </header>
    <div className={`mx-auto mt-4 grid max-w-[1440px] gap-4 ${nodeLibraryOpen ? nodeConfigOpen ? 'xl:grid-cols-[220px_minmax(0,1fr)_340px]' : 'xl:grid-cols-[220px_minmax(0,1fr)]' : nodeConfigOpen ? 'xl:grid-cols-[minmax(0,1fr)_340px]' : 'xl:grid-cols-[minmax(0,1fr)]'}`}>
      {nodeLibraryOpen ? <aside className="rounded-2xl border bg-card p-4"><div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">节点库</h2><button type="button" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => setNodeLibraryOpen(false)} title="隐藏节点库" aria-label="隐藏节点库"><PanelLeftClose className="size-4" /></button></div><p className="mt-1 text-xs leading-5 text-muted-foreground">拖入画布，或点击添加节点。</p><div className="mt-3 grid gap-2">{([['llm', 'LLM 步骤'], ['skill', '调用 Skill'], ['condition', '条件分支'], ['loop', '循环处理']] as Array<[InsertableNodeType, string]>).map(([type, label]) => <button key={type} type="button" draggable onDragStart={event => event.dataTransfer.setData('application/educlaw-workflow-node', type)} className="cursor-grab rounded-lg border px-3 py-2 text-left text-sm active:cursor-grabbing" onClick={() => insertNode(type, insertEdgeId || undefined)}><Plus className="mr-2 inline size-4" />{label}</button>)}</div><p className="mt-4 text-xs leading-5 text-muted-foreground">点击连线中的 ＋ 可在附近放置节点；新节点不会自动连线，需要拖动端点自行连接。</p></aside> : null}
      <section className="relative min-h-[560px] overflow-hidden rounded-2xl border bg-card"><div className="absolute left-4 top-4 z-10 rounded-lg bg-background/90 px-3 py-2 text-xs text-muted-foreground shadow-sm"><GitBranch className="mr-1 inline size-3.5" />拖拽端点即可连线或重连</div>{!nodeLibraryOpen ? <button type="button" className="absolute left-0 top-1/2 z-10 flex -translate-y-1/2 items-center gap-1 rounded-r-lg border border-l-0 bg-background/95 px-2 py-3 text-xs font-medium text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground" onClick={() => setNodeLibraryOpen(true)} title="显示节点库" aria-label="显示节点库"><PanelLeftOpen className="size-4" /><span>节点库</span></button> : null}{!nodeConfigOpen ? <button type="button" className="absolute right-0 top-1/2 z-10 flex -translate-y-1/2 items-center gap-1 rounded-l-lg border border-r-0 bg-background/95 px-2 py-3 text-xs font-medium text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground" onClick={() => setNodeConfigOpen(true)} title="显示节点配置" aria-label="显示节点配置"><span>节点配置</span><PanelRightOpen className="size-4" /></button> : null}{selectedEdgeId ? <button type="button" className="absolute bottom-4 right-4 z-10 inline-flex items-center gap-2 rounded-lg border border-destructive/40 bg-background px-3 py-2 text-xs text-destructive shadow-sm" onClick={() => { updateWorkflow(current => ({ ...current, edges: current.edges.filter(edge => edge.id !== selectedEdgeId) })); setSelectedEdgeId(null); }}><Trash2 className="size-3.5" />删除连线</button> : null}{insertEdgeId ? <div className="absolute right-4 top-4 z-10 flex items-center gap-2 rounded-xl border bg-background p-2 shadow-lg"><span className="px-1 text-xs text-muted-foreground">在此处添加节点</span>{([['llm', 'LLM'], ['skill', 'Skill'], ['condition', '条件'], ['loop', '循环']] as Array<[InsertableNodeType, string]>).map(([type, label]) => <button type="button" key={type} className="rounded-md border px-2 py-1 text-xs hover:border-primary" onClick={() => insertNode(type, insertEdgeId)}>{label}</button>)}<button type="button" className="px-1 text-xs text-muted-foreground" onClick={() => setInsertEdgeId(null)}>取消</button></div> : null}
        <ReactFlow nodes={flowNodes} edges={flowEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onInit={setFlowInstance} onConnect={onConnect} onNodeClick={(_, node) => { setSelectedId(node.id); setSelectedEdgeId(null); }} onEdgeClick={(_, edge) => setSelectedEdgeId(edge.id)} onPaneClick={() => setSelectedEdgeId(null)} onNodesChange={onFlowNodesChange} onEdgesChange={onFlowEdgesChange} onNodeDragStop={(_, node) => updateWorkflow(current => ({ ...current, nodes: current.nodes.map(item => item.id === node.id ? { ...item, position: node.position } : item) }))} onNodesDelete={nodes => updateWorkflow(current => nodes.reduce((next, node) => deleteWorkflowNode(next, node.id), current))} onEdgesDelete={edges => { updateWorkflow(current => ({ ...current, edges: current.edges.filter(edge => !edges.some(item => item.id === edge.id)) })); setSelectedEdgeId(null); }} onDrop={onDrop} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }} fitView deleteKeyCode={['Backspace', 'Delete']}><Background gap={18} size={1} /><Controls /><MiniMap nodeColor={node => nodeColors[((node.data as unknown as CanvasNodeData).node.type)]} /></ReactFlow>
      </section>
      {nodeConfigOpen ? <NodeConfigPanel node={selected} skills={pkg?.snapshot.skills || []} upstreamNodes={workflow.edges.filter(edge => edge.to === selected.id).map(edge => workflow.nodes.find(node => node.id === edge.from)).filter((node): node is WorkflowNode => Boolean(node))} input={input} onInputChange={setInput} onClose={() => setNodeConfigOpen(false)} onRename={name => updateWorkflow(current => ({ ...current, nodes: current.nodes.map(node => node.id === selected.id ? { ...node, name } : node) }))} onUpdateParams={updateParams} onDelete={() => { updateWorkflow(current => deleteWorkflowNode(current, selected.id)); setSelectedId('start'); }} /> : null}
    </div>
  </main>;
}
