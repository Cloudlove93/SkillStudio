import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  Background, BaseEdge, Controls, EdgeLabelRenderer, Handle, MarkerType, MiniMap,
  Position, ReactFlow, getBezierPath,
  type Connection, type Edge, type EdgeProps, type Node, type NodeProps, type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ChevronLeft, ChevronRight, GitBranch, Play, Plus, Save, Trash2 } from 'lucide-react';
import type { AgentPackageDetail, WorkflowDefinition, WorkflowEdge, WorkflowNode, WorkflowRunReport } from '@educlaw/shared';
import { toast } from 'sonner';
import { liteApi } from '../api/lite-api';

type Props = { embedded?: boolean; token?: string; packageId?: string; packageVersionId?: string | null };
type InsertableNodeType = 'llm' | 'skill' | 'condition';
type CanvasNodeData = { node: WorkflowNode; selected: boolean; trace?: string };

const nodeLabels: Record<WorkflowNode['type'], string> = { start: '开始', llm: 'LLM', skill: 'Skill', condition: '条件', end: '结束' };
const nodeColors: Record<WorkflowNode['type'], string> = { start: '#2563eb', llm: '#7c3aed', skill: '#0f766e', condition: '#b45309', end: '#475569' };

function id(prefix: string) {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? `${prefix}-${crypto.randomUUID()}` : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function defaultWorkflow(): WorkflowDefinition {
  return { schemaVersion: 1, nodes: [
    { id: 'start', type: 'start', name: '开始', position: { x: 80, y: 180 }, params: {} },
    { id: 'end', type: 'end', name: '结束', position: { x: 420, y: 180 }, params: { outputTemplate: '{{ $input }}' } },
  ], edges: [{ id: 'start-end', from: 'start', to: 'end' }] };
}
function newWorkflowNode(type: InsertableNodeType, position: { x: number; y: number }): WorkflowNode {
  const nodeId = id(type);
  if (type === 'skill') return { id: nodeId, type, name: '调用 Skill', position, params: { skillId: '', inputTemplate: '{{ $input }}' } };
  if (type === 'condition') return { id: nodeId, type, name: '条件分支', position, params: { left: '{{ $input }}', operator: 'not_empty', right: '' } };
  return { id: nodeId, type, name: 'LLM 步骤', position, params: { promptTemplate: '{{ $input }}' } };
}
function edgeFor(from: string, to: string, condition?: WorkflowEdge['condition']): WorkflowEdge {
  return { id: id('edge'), from, to, ...(condition ? { condition } : {}) };
}
function insertNodeOnEdge(workflow: WorkflowDefinition, type: InsertableNodeType, edgeId: string, position?: { x: number; y: number }): WorkflowDefinition {
  const edge = workflow.edges.find(item => item.id === edgeId);
  if (!edge) return workflow;
  const source = workflow.nodes.find(node => node.id === edge.from);
  const target = workflow.nodes.find(node => node.id === edge.to);
  if (!source || !target) return workflow;
  const node = newWorkflowNode(type, position || { x: Math.round((source.position.x + target.position.x) / 2), y: Math.round((source.position.y + target.position.y) / 2) });
  const replacement = type === 'condition'
    ? [edgeFor(edge.from, node.id, edge.condition), edgeFor(node.id, edge.to, 'true'), edgeFor(node.id, edge.to, 'false')]
    : [edgeFor(edge.from, node.id, edge.condition), edgeFor(node.id, edge.to)];
  const nodes = [...workflow.nodes, node].map(item => item.type === 'end' && edge.to === item.id && type !== 'condition'
    ? { ...item, params: { ...item.params, outputTemplate: `{{ $node.${node.id}.output.text }}` } } : item);
  return { ...workflow, nodes, edges: [...workflow.edges.filter(item => item.id !== edge.id), ...replacement] };
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

export default function WorkflowDemo({ embedded = false, token, packageId, packageVersionId }: Props) {
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
  const flowNodes = useMemo<Node[]>(() => workflow.nodes.map(node => ({ id: node.id, type: 'workflow', position: node.position, data: { node, selected: node.id === selectedId, trace: traceByNode.get(node.id)?.status } })), [selectedId, workflow.nodes, run]);
  const flowEdges = useMemo<Edge[]>(() => workflow.edges.map(edge => ({ id: edge.id, source: edge.from, target: edge.to, sourceHandle: edge.condition, type: 'insertable', label: edge.condition, markerEnd: { type: MarkerType.ArrowClosed }, data: { onInsert: (edgeId: string) => setInsertEdgeId(edgeId) }, labelStyle: { fontSize: 11, fill: '#64748b' } })), [workflow.edges]);
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
      if (current.edges.some(edge => edge.from === connection.source && (source.type === 'condition' ? edge.condition === condition : true))) { toast.error(source.type === 'condition' ? '该条件分支已经连线' : '该节点只能有一条出线'); return current; }
      if (target.type !== 'end' && current.edges.some(edge => edge.to === connection.target)) { toast.error('该节点已经有入线'); return current; }
      return { ...current, edges: [...current.edges, edgeFor(connection.source!, connection.target!, condition)] };
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
      <div className="flex gap-2"><button className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm disabled:opacity-50" disabled={!undoStack.current.length || busy} onClick={undo}><ChevronLeft className="size-4" />撤销</button><button className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm disabled:opacity-50" disabled={!redoStack.current.length || busy} onClick={redo}>重做<ChevronRight className="size-4" /></button><button className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm" disabled={busy} onClick={() => void save()}><Save className="size-4" />保存草稿</button><button className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60" disabled={busy || unboundSkillNodes.length > 0} onClick={() => void execute()} title={unboundSkillNodes.length ? '请先为所有 Skill 节点选择 Skill' : undefined}><Play className="size-4" />整体试跑</button></div>
    </header>
    <div className="mx-auto mt-4 grid max-w-[1440px] gap-4 xl:grid-cols-[220px_minmax(0,1fr)_340px]">
      <aside className="rounded-2xl border bg-card p-4"><h2 className="text-sm font-semibold">节点库</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">拖入画布，或点击在线路末端插入。</p><div className="mt-3 grid gap-2">{([['llm', 'LLM 步骤'], ['skill', '调用 Skill'], ['condition', '条件分支']] as Array<[InsertableNodeType, string]>).map(([type, label]) => <button key={type} type="button" draggable onDragStart={event => event.dataTransfer.setData('application/educlaw-workflow-node', type)} className="cursor-grab rounded-lg border px-3 py-2 text-left text-sm active:cursor-grabbing" onClick={() => insertNode(type, insertEdgeId || undefined)}><Plus className="mr-2 inline size-4" />{label}</button>)}</div><p className="mt-4 text-xs leading-5 text-muted-foreground">点击连线中的 ＋ 可精确插入节点；拖拽节点可调整位置，拖动端点可手动连线。</p></aside>
      <section className="relative min-h-[560px] overflow-hidden rounded-2xl border bg-card"><div className="absolute left-4 top-4 z-10 rounded-lg bg-background/90 px-3 py-2 text-xs text-muted-foreground shadow-sm"><GitBranch className="mr-1 inline size-3.5" />拖拽、连线或点击 ＋ 编排流程</div>{insertEdgeId ? <div className="absolute right-4 top-4 z-10 flex items-center gap-2 rounded-xl border bg-background p-2 shadow-lg"><span className="px-1 text-xs text-muted-foreground">在线路中插入</span>{([['llm', 'LLM'], ['skill', 'Skill'], ['condition', '条件']] as Array<[InsertableNodeType, string]>).map(([type, label]) => <button type="button" key={type} className="rounded-md border px-2 py-1 text-xs hover:border-primary" onClick={() => insertNode(type, insertEdgeId)}>{label}</button>)}<button type="button" className="px-1 text-xs text-muted-foreground" onClick={() => setInsertEdgeId(null)}>取消</button></div> : null}
        <ReactFlow nodes={flowNodes} edges={flowEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onInit={setFlowInstance} onConnect={onConnect} onNodeClick={(_, node) => setSelectedId(node.id)} onNodesChange={changes => { const positions = changes.filter(change => change.type === 'position' && change.position && !change.dragging); if (!positions.length) return; updateWorkflow(current => ({ ...current, nodes: current.nodes.map(node => { const change = positions.find(item => item.id === node.id); return change?.position ? { ...node, position: change.position } : node; }) })); }} onNodesDelete={nodes => updateWorkflow(current => nodes.reduce((next, node) => deleteWorkflowNode(next, node.id), current))} onEdgesDelete={edges => updateWorkflow(current => ({ ...current, edges: current.edges.filter(edge => !edges.some(item => item.id === edge.id)) }))} onDrop={onDrop} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }} fitView deleteKeyCode={['Backspace', 'Delete']}><Background gap={18} size={1} /><Controls /><MiniMap nodeColor={node => nodeColors[((node.data as unknown as CanvasNodeData).node.type)]} /></ReactFlow>
      </section>
      <aside className="rounded-2xl border bg-card p-4"><h2 className="text-sm font-semibold">节点配置</h2><p className="mt-1 text-sm text-muted-foreground">{selected.name} · {nodeLabels[selected.type]}</p>{selected.type === 'llm' ? <label className="mt-4 block text-sm">提示词模板<textarea className="mt-1 min-h-28 w-full rounded-lg border p-2" value={String(selected.params.promptTemplate || '')} onChange={event => updateParams({ ...selected.params, promptTemplate: event.target.value })} /></label> : null}{selected.type === 'skill' ? <><label className="mt-4 block text-sm">选择 Skill<select className="mt-1 w-full rounded-lg border p-2" value={String(selected.params.skillId || '')} onChange={event => updateParams({ ...selected.params, skillId: event.target.value })}><option value="">暂不绑定（草稿）</option>{pkg?.snapshot.skills.map(skill => <option key={skill.id} value={skill.id}>{skill.name}</option>)}</select></label>{!pkg?.snapshot.skills.length ? <p className="mt-2 text-xs leading-5 text-muted-foreground">当前工作流尚无可绑定的 Skill。可先保存草稿，之后再绑定。</p> : null}<label className="mt-3 block text-sm">输入模板<textarea className="mt-1 min-h-20 w-full rounded-lg border p-2" value={String(selected.params.inputTemplate || '')} onChange={event => updateParams({ ...selected.params, inputTemplate: event.target.value })} /></label></> : null}{selected.type === 'condition' ? <label className="mt-4 block text-sm">判断输入<input className="mt-1 w-full rounded-lg border p-2" value={String(selected.params.left || '')} onChange={event => updateParams({ ...selected.params, left: event.target.value })} /></label> : null}{selected.type === 'end' ? <label className="mt-4 block text-sm">输出模板<textarea className="mt-1 min-h-20 w-full rounded-lg border p-2" value={String(selected.params.outputTemplate || '')} onChange={event => updateParams({ ...selected.params, outputTemplate: event.target.value })} /></label> : null}{selected.type !== 'start' && selected.type !== 'end' ? <button type="button" className="mt-4 inline-flex items-center gap-2 rounded-lg border border-destructive/40 px-3 py-2 text-sm text-destructive" onClick={() => { updateWorkflow(current => deleteWorkflowNode(current, selected.id)); setSelectedId('start'); }}><Trash2 className="size-4" />删除节点</button> : null}<label className="mt-5 block text-sm">试跑输入<textarea className="mt-1 min-h-24 w-full rounded-lg border p-2" value={input} onChange={event => setInput(event.target.value)} placeholder="输入一项教学任务" /></label></aside>
    </div>
  </main>;
}
