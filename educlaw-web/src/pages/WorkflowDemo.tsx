import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from 'react';
import { useNavigate } from 'react-router';
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  getBezierPath,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Flag,
  GitBranch,
  Layers3,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Plus,
  Puzzle,
  Repeat,
  Rocket,
  Save,
  Search,
  Sparkles,
  Split,
  Trash2,
  Wand2,
  X,
  type LucideIcon,
} from 'lucide-react';
import type {
  AgentPackageDetail,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
  WorkflowNodeTrace,
  WorkflowRunReport,
} from '@educlaw/shared';
import { toast } from 'sonner';
import { agentsApi } from '../api/agents';
import { liteApi } from '../api/lite-api';
import {
  AGENT_TEMPLATE_PRESETS,
  ANALYSIS_SKILL_PRESETS,
  LESSON_PACK_PRESETS,
  type StudioPreset,
} from '../lib/studio-presets';
import { routes } from '../lib/routes';
import {
  buildWorkflowAgentInstructions,
  collectWorkflowSkillIds,
} from './workflow-publish';
import './workflow-studio.css';

type Props = {
  embedded?: boolean;
  token?: string;
  packageId?: string;
  packageVersionId?: string | null;
  onOpenLibrary?: () => void;
};
type InsertableNodeType = 'llm' | 'skill' | 'condition' | 'loop';
type CanvasNodeData = {
  node: WorkflowNode;
  selected: boolean;
  trace?: WorkflowNodeTrace['status'];
};
type PublishSkillOption = {
  id: string;
  name: string;
  description: string;
  packageName: string;
  versionId: string | null;
  versionNumber: number | null;
};

const nodeLabels: Record<WorkflowNode['type'], string> = {
  start: '开始',
  llm: 'LLM',
  skill: 'Skill',
  condition: '条件',
  loop: '循环',
  end: '结束',
};
const nodeIcons: Record<WorkflowNode['type'], LucideIcon> = {
  start: Play,
  llm: Sparkles,
  skill: Puzzle,
  condition: Split,
  loop: Repeat,
  end: Flag,
};
const traceLabels: Record<WorkflowNodeTrace['status'], string> = {
  queued: '排队中',
  running: '运行中',
  succeeded: '已完成',
  failed: '失败',
  skipped: '已跳过',
};

function id(prefix: string) {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function defaultWorkflow(): WorkflowDefinition {
  return {
    schemaVersion: 1,
    nodes: [
      {
        id: 'start',
        type: 'start',
        name: '开始',
        position: { x: 80, y: 180 },
        params: {},
      },
      {
        id: 'end',
        type: 'end',
        name: '结束',
        position: { x: 420, y: 180 },
        params: { outputTemplate: '' },
      },
    ],
    edges: [{ id: 'start-end', from: 'start', to: 'end' }],
  };
}
function newWorkflowNode(
  type: InsertableNodeType,
  position: { x: number; y: number },
): WorkflowNode {
  const nodeId = id(type);
  if (type === 'skill')
    return {
      id: nodeId,
      type,
      name: '调用 Skill',
      position,
      params: { skillId: '', inputTemplate: '' },
    };
  if (type === 'condition')
    return {
      id: nodeId,
      type,
      name: '条件分支',
      position,
      params: { left: '', operator: 'not_empty', right: '' },
    };
  if (type === 'loop')
    return {
      id: nodeId,
      type,
      name: '循环处理',
      position,
      params: { iterations: 3, promptTemplate: '根据工作流输入逐轮完善结果。' },
    };
  return {
    id: nodeId,
    type,
    name: 'LLM 步骤',
    position,
    params: { promptTemplate: '' },
  };
}
function edgeFor(
  from: string,
  to: string,
  condition?: WorkflowEdge['condition'],
): WorkflowEdge {
  return { id: id('edge'), from, to, ...(condition ? { condition } : {}) };
}
function downstreamIds(workflow: WorkflowDefinition, startId: string) {
  const seen = new Set<string>();
  const queue = [startId];
  while (queue.length) {
    const nodeId = queue.shift()!;
    if (seen.has(nodeId)) continue;
    seen.add(nodeId);
    workflow.edges
      .filter((edge) => edge.from === nodeId)
      .forEach((edge) => queue.push(edge.to));
  }
  return seen;
}
function insertNodeOnEdge(
  workflow: WorkflowDefinition,
  type: InsertableNodeType,
  edgeId: string,
  position?: { x: number; y: number },
  overrides?: { name?: string; params?: Record<string, unknown> },
): WorkflowDefinition {
  const edge = workflow.edges.find((item) => item.id === edgeId);
  const source = edge
    ? workflow.nodes.find((node) => node.id === edge.from)
    : undefined;
  const target = edge
    ? workflow.nodes.find((node) => node.id === edge.to)
    : undefined;
  const fallbackPosition =
    source && target
      ? {
          x: Math.round((source.position.x + target.position.x) / 2),
          y: Math.round((source.position.y + target.position.y) / 2),
        }
      : { x: 260, y: 160 };
  const base = newWorkflowNode(type, position || fallbackPosition);
  const node = {
    ...base,
    ...(overrides?.name ? { name: overrides.name } : {}),
    params: { ...base.params, ...(overrides?.params ?? {}) },
  };
  if (!edge || !source || !target)
    return { ...workflow, nodes: [...workflow.nodes, node] };
  // 新节点和现有节点都按固定宽度绘制；插入时把下游整体右移，避免节点叠在一起。
  const nodeWidth = 240;
  const gap = 40;
  const x = position
    ? position.x
    : Math.max(source.position.x + 260, target.position.x - 260);
  const y = position
    ? position.y
    : Math.round((source.position.y + target.position.y) / 2);
  const delta = Math.max(0, x + nodeWidth + gap - target.position.x);
  const downstream =
    delta > 0 ? downstreamIds(workflow, target.id) : new Set<string>();
  const shifted = workflow.nodes.map((item) =>
    downstream.has(item.id)
      ? { ...item, position: { ...item.position, x: item.position.x + delta } }
      : item,
  );
  const inserted = { ...node, position: { x, y } };
  // 把原来的连线拆成“上游 → 新节点 → 下游”，否则新节点不可达，草稿无法通过校验。
  const rewiredEdges = [
    ...workflow.edges.filter((item) => item.id !== edgeId),
    edgeFor(edge.from, node.id, edge.condition),
    edgeFor(node.id, edge.to),
  ];
  return { ...workflow, nodes: [...shifted, inserted], edges: rewiredEdges };
}
function wouldCreateCycle(
  workflow: WorkflowDefinition,
  from: string,
  to: string,
) {
  const visited = new Set<string>();
  const visit = (nodeId: string): boolean => {
    if (nodeId === from) return true;
    if (visited.has(nodeId)) return false;
    visited.add(nodeId);
    return workflow.edges
      .filter((edge) => edge.from === nodeId)
      .some((edge) => visit(edge.to));
  };
  return visit(to);
}
function deleteWorkflowNode(
  workflow: WorkflowDefinition,
  nodeId: string,
): WorkflowDefinition {
  const node = workflow.nodes.find((item) => item.id === nodeId);
  if (!node || node.type === 'start' || node.type === 'end') return workflow;
  const incoming = workflow.edges.find((edge) => edge.to === nodeId);
  const outgoing = workflow.edges.filter((edge) => edge.from === nodeId);
  const remaining = workflow.edges.filter(
    (edge) => edge.from !== nodeId && edge.to !== nodeId,
  );
  if (
    incoming &&
    outgoing[0] &&
    !remaining.some(
      (edge) =>
        edge.from === incoming.from &&
        edge.to === outgoing[0].to &&
        edge.condition === incoming.condition,
    )
  )
    remaining.push(edgeFor(incoming.from, outgoing[0].to, incoming.condition));
  return {
    ...workflow,
    nodes: workflow.nodes.filter((item) => item.id !== nodeId),
    edges: remaining,
  };
}
function durationLabel(value?: number) {
  return typeof value === 'number' ? `${value} ms` : '';
}

function WorkflowCanvasNode(props: NodeProps) {
  const data = props.data as unknown as CanvasNodeData;
  const node = data.node;
  const Icon = nodeIcons[node.type];
  const isCondition = node.type === 'condition';
  const state =
    data.trace ||
    (node.type === 'skill' && !String(node.params.skillId || '').trim()
      ? 'unbound'
      : undefined);
  const meta = data.trace
    ? traceLabels[data.trace]
    : node.type === 'start'
      ? '工作流入口'
      : node.type === 'end'
        ? '工作流出口'
        : state === 'unbound'
          ? '未绑定 Skill'
          : '待运行';
  return (
    <div
      className={`wf-node${data.selected ? ' is-selected' : ''}`}
      data-type={node.type}
    >
      {node.type !== 'start' ? (
        <Handle type="target" position={Position.Left} className="wf-handle" />
      ) : null}
      <div className="wf-node-head">
        <span className="wf-node-icon">
          <Icon size={15} aria-hidden="true" />
        </span>
        <span className="wf-node-copy">
          <span className="wf-node-kind">{nodeLabels[node.type]}</span>
          <strong className="wf-node-name">{node.name}</strong>
        </span>
        <span
          className={`wf-node-state${state ? ` is-${state}` : ''}`}
          aria-hidden="true"
        />
      </div>
      <p className="wf-node-meta">{meta}</p>
      {node.type !== 'end' && !isCondition ? (
        <Handle type="source" position={Position.Right} className="wf-handle" />
      ) : null}
      {isCondition ? (
        <>
          <Handle
            id="true"
            type="source"
            position={Position.Right}
            className="wf-handle wf-handle-true"
          />
          <Handle
            id="false"
            type="source"
            position={Position.Right}
            className="wf-handle wf-handle-false"
          />
          <span className="wf-branch is-true">是</span>
          <span className="wf-branch is-false">否</span>
        </>
      ) : null}
    </div>
  );
}

function InsertableEdge(props: EdgeProps) {
  const [path, labelX, labelY] = getBezierPath(props);
  const data = props.data as
    | {
        onInsert?: (edgeId: string) => void;
        condition?: WorkflowEdge['condition'];
      }
    | undefined;
  return (
    <>
      <BaseEdge path={path} markerEnd={props.markerEnd} style={props.style} />
      <EdgeLabelRenderer>
        {data?.condition ? (
          <span
            className="wf-edge-condition"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY - 18}px)`,
            }}
          >
            {data.condition === 'false' ? '否' : '是'}
          </span>
        ) : null}
        <button
          type="button"
          className="wf-edge-add nodrag nopan"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
          onClick={() => data?.onInsert?.(props.id)}
          aria-label="在线路中插入节点"
          title="在线路中插入节点"
        >
          <Plus size={12} aria-hidden="true" />
        </button>
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { workflow: WorkflowCanvasNode };
const edgeTypes = { insertable: InsertableEdge };

type TemplateField =
  | 'promptTemplate'
  | 'inputTemplate'
  | 'left'
  | 'right'
  | 'outputTemplate';
type NodeConfigPanelProps = {
  node: WorkflowNode;
  skills: Array<{ id: string; name: string; packageName?: string }>;
  upstreamNodes: WorkflowNode[];
  onClose: () => void;
  onDelete: () => void;
  onRename: (value: string) => void;
  onUpdateParams: (params: Record<string, unknown>) => void;
};

function NodeConfigPanel({
  node,
  skills,
  upstreamNodes,
  onClose,
  onDelete,
  onRename,
  onUpdateParams,
}: NodeConfigPanelProps) {
  const Icon = nodeIcons[node.type];
  const initialField: TemplateField | null =
    node.type === 'llm' || node.type === 'loop'
      ? 'promptTemplate'
      : node.type === 'skill'
        ? 'inputTemplate'
        : node.type === 'condition'
          ? 'left'
          : node.type === 'end'
            ? 'outputTemplate'
            : null;
  const [activeField, setActiveField] = useState<TemplateField | null>(
    initialField,
  );
  useEffect(() => setActiveField(initialField), [initialField, node.id]);
  const parameter = (
    field: TemplateField,
    label: string,
    multiline = true,
    placeholder?: string,
  ) => {
    const value = String(node.params[field] || '');
    const referencesVariable = /{{\s*\$/.test(value);
    const isInputReference = /^{{\s*\$input\s*}}$/.test(value);
    const isNodeReference =
      /^{{\s*\$node\.[A-Za-z0-9_-]+\.output\.text\s*}}$/.test(value);
    const referenceName = isInputReference
      ? '工作流输入'
      : isNodeReference
        ? '上游节点输出'
        : '';
    return (
      <div className="wf-field" key={field}>
        <div className="wf-field-head">
          <label className="wf-field-label" htmlFor={`${node.id}-${field}`}>
            {label}
          </label>
          <div
            className="wf-segmented"
            role="group"
            aria-label={`${label}的取值方式`}
          >
            <button
              type="button"
              className={!referencesVariable ? 'is-active' : undefined}
              onClick={() => setActiveField(field)}
            >
              固定值
            </button>
            <button
              type="button"
              className={referencesVariable ? 'is-active' : undefined}
              onClick={() => setActiveField(field)}
            >
              引用变量
            </button>
          </div>
        </div>
        {referenceName ? (
          <div className="wf-reference">
            <span>
              已引用：<strong>{referenceName}</strong>
            </span>
            <button
              type="button"
              onClick={() => {
                setActiveField(field);
                onUpdateParams({ ...node.params, [field]: '' });
              }}
            >
              改为固定值
            </button>
          </div>
        ) : multiline ? (
          <textarea
            id={`${node.id}-${field}`}
            className="wf-textarea"
            value={value}
            placeholder={placeholder}
            onFocus={() => setActiveField(field)}
            onChange={(event) =>
              onUpdateParams({ ...node.params, [field]: event.target.value })
            }
          />
        ) : (
          <input
            id={`${node.id}-${field}`}
            className="wf-input"
            value={value}
            placeholder={placeholder}
            onFocus={() => setActiveField(field)}
            onChange={(event) =>
              onUpdateParams({ ...node.params, [field]: event.target.value })
            }
          />
        )}
        <p className="wf-field-hint">
          {referencesVariable
            ? '当前使用变量，可在下方变量列表中替换。'
            : '当前使用固定值；点击“引用变量”后从下方选择。'}
        </p>
      </div>
    );
  };
  const availableVariables = [
    {
      label: '工作流输入',
      detail: '开始节点 · 用户输入',
      value: '{{ $input }}',
    },
    ...upstreamNodes
      .filter(
        (item) =>
          item.type === 'llm' || item.type === 'skill' || item.type === 'loop',
      )
      .map((item) => ({
        label: `${item.name} 的输出`,
        detail: `${nodeLabels[item.type]} · ${item.id.slice(0, 8)}`,
        value: `{{ $node.${item.id}.output.text }}`,
      })),
  ];
  const insertVariable = (value: string) => {
    if (!activeField) {
      toast.error('请先选择一个输入参数');
      return;
    }
    const current = String(node.params[activeField] || '');
    onUpdateParams({
      ...node.params,
      [activeField]: current ? `${current}${value}` : value,
    });
  };
  return (
    <aside className="wf-inspector">
      <header className="wf-inspector-head">
        <div className="wf-inspector-title">
          <span className="wf-inspector-node-icon" data-type={node.type}>
            <Icon size={15} aria-hidden="true" />
          </span>
          <div>
            <span className="wf-inspector-eyebrow">
              {nodeLabels[node.type]} 节点 · 配置
            </span>
            <h2>{node.name || '节点配置'}</h2>
          </div>
        </div>
        <button
          type="button"
          className="wf-icon-button"
          onClick={onClose}
          title="隐藏节点配置"
          aria-label="隐藏节点配置"
        >
          <PanelRightClose size={16} />
        </button>
      </header>
      <div className="wf-inspector-body">
        <section className="wf-section">
          <label className="wf-field-label" htmlFor="workflow-node-name">
            节点名称
          </label>
          <input
            id="workflow-node-name"
            className="wf-input"
            value={node.name}
            onChange={(event) => onRename(event.target.value)}
          />
        </section>
        <section className="wf-section">
          <div className="wf-section-head">
            <h3>参数</h3>
            <span>固定值或变量引用</span>
          </div>
          {node.type === 'llm'
            ? parameter(
                'promptTemplate',
                '提示词',
                true,
                '描述这个 LLM 节点要完成的任务',
              )
            : null}
          {node.type === 'loop' ? (
            <>
              <div className="wf-field">
                <label
                  className="wf-field-label"
                  htmlFor="workflow-loop-iterations"
                >
                  循环次数
                </label>
                <input
                  id="workflow-loop-iterations"
                  className="wf-input"
                  type="number"
                  min="1"
                  max="20"
                  value={String(node.params.iterations || 1)}
                  onChange={(event) =>
                    onUpdateParams({
                      ...node.params,
                      iterations: Math.max(
                        1,
                        Math.min(20, Number(event.target.value) || 1),
                      ),
                    })
                  }
                />
                <p className="wf-field-hint">
                  每轮会带入上一轮结果，最多 20 轮。
                </p>
              </div>
              {parameter(
                'promptTemplate',
                '每轮处理说明',
                true,
                '例如：检查并完善上一轮结果，直到内容更清晰完整',
              )}
            </>
          ) : null}
          {node.type === 'skill' ? (
            <>
              <div className="wf-field">
                <label
                  className="wf-field-label"
                  htmlFor="workflow-skill-select"
                >
                  调用的 Skill
                </label>
                <select
                  id="workflow-skill-select"
                  className="wf-select"
                  value={String(node.params.skillId || '')}
                  onChange={(event) =>
                    onUpdateParams({
                      ...node.params,
                      skillId: event.target.value,
                    })
                  }
                >
                  <option value="">暂不绑定（草稿）</option>
                  {skills.map((skill) => (
                    <option key={skill.id} value={skill.id}>
                      {skill.name}
                      {skill.packageName ? ` · ${skill.packageName}` : ''}
                    </option>
                  ))}
                </select>
                {!skills.length ? (
                  <p className="wf-field-hint">
                    仓库里还没有可绑定的 Skill；可先保存草稿，之后再绑定。
                  </p>
                ) : null}
              </div>
              {parameter(
                'inputTemplate',
                '输入内容',
                true,
                '填写固定内容，或引用上游节点输出',
              )}
            </>
          ) : null}
          {node.type === 'condition' ? (
            <>
              <div className="wf-field">
                <label
                  className="wf-field-label"
                  htmlFor="workflow-condition-operator"
                >
                  判断方式
                </label>
                <select
                  id="workflow-condition-operator"
                  className="wf-select"
                  value={String(node.params.operator || 'not_empty')}
                  onChange={(event) =>
                    onUpdateParams({
                      ...node.params,
                      operator: event.target.value,
                    })
                  }
                >
                  <option value="not_empty">不为空</option>
                  <option value="is_empty">为空</option>
                  <option value="equals">等于</option>
                  <option value="not_equals">不等于</option>
                  <option value="contains">包含</option>
                  <option value="not_contains">不包含</option>
                </select>
              </div>
              {parameter('left', '待判断内容', false, '例如：用户提交的内容')}
              {!['is_empty', 'not_empty'].includes(
                String(node.params.operator || 'not_empty'),
              )
                ? parameter('right', '比较值', false, '例如：通过')
                : null}
            </>
          ) : null}
          {node.type === 'end'
            ? parameter(
                'outputTemplate',
                '工作流输出',
                true,
                '设置最终输出内容',
              )
            : null}
          {node.type === 'start' ? (
            <div className="wf-callout">
              用户在试运行面板填写的输入会作为工作流输入，供后续节点按需引用。
            </div>
          ) : null}
        </section>
        {node.type !== 'start' ? (
          <section className="wf-section">
            <div className="wf-section-head">
              <h3>可用变量</h3>
              <span>点击插入</span>
            </div>
            <p className="wf-field-hint">变量会插入到当前选中的参数。</p>
            <div className="wf-variable-list">
              {availableVariables.map((variable) => (
                <button
                  key={variable.value}
                  type="button"
                  className="wf-variable"
                  onClick={() => insertVariable(variable.value)}
                >
                  <strong>{variable.label}</strong>
                  <span>{variable.detail}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}
        {node.type !== 'start' && node.type !== 'end' ? (
          <section className="wf-section">
            <details className="wf-advanced">
              <summary>高级设置</summary>
              <div>
                <label>
                  失败处理
                  <select
                    className="wf-select"
                    value={String(node.params.errorMode || 'fail')}
                    onChange={(event) =>
                      onUpdateParams({
                        ...node.params,
                        errorMode: event.target.value,
                      })
                    }
                  >
                    <option value="fail">中断工作流</option>
                    <option value="continue">继续后续节点</option>
                  </select>
                </label>
                <label>
                  失败重试次数
                  <input
                    className="wf-input"
                    type="number"
                    min="0"
                    max="3"
                    value={String(node.params.retryCount || 0)}
                    onChange={(event) =>
                      onUpdateParams({
                        ...node.params,
                        retryCount: Number(event.target.value) || 0,
                      })
                    }
                  />
                </label>
                <p className="wf-field-hint">
                  高级配置会随草稿保存；运行引擎将逐步支持继续执行和自动重试。
                </p>
              </div>
            </details>
          </section>
        ) : null}
        {node.type !== 'start' && node.type !== 'end' ? (
          <button type="button" className="wf-danger-button" onClick={onDelete}>
            <Trash2 size={13} aria-hidden="true" />
            删除节点
          </button>
        ) : null}
      </div>
    </aside>
  );
}

export default function WorkflowDemo({
  embedded = false,
  token,
  packageId,
  packageVersionId,
  onOpenLibrary,
}: Props) {
  const navigate = useNavigate();
  const [pkg, setPkg] = useState<AgentPackageDetail | null>(null);
  const [versionId, setVersionId] = useState(packageVersionId || '');
  const [createdPackageId, setCreatedPackageId] = useState<string | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowDefinition>(defaultWorkflow);
  const [selectedId, setSelectedId] = useState('start');
  const [input, setInput] = useState('');
  const [run, setRun] = useState<WorkflowRunReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [insertEdgeId, setInsertEdgeId] = useState<string | null>(null);
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance | null>(
    null,
  );
  const [nodeLibraryOpen, setNodeLibraryOpen] = useState(true);
  const [nodeConfigOpen, setNodeConfigOpen] = useState(
    () => typeof window === 'undefined' || window.innerWidth > 1180,
  );
  const [nodeQuery, setNodeQuery] = useState('');
  const [paletteTab, setPaletteTab] = useState<'nodes' | 'resources'>('nodes');
  const [resourceFilter, setResourceFilter] = useState<
    'all' | 'analysis' | 'agent' | 'lesson'
  >('all');
  const [runnerOpen, setRunnerOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState('');
  const [publishName, setPublishName] = useState('');
  const [publishDescription, setPublishDescription] = useState('');
  const [publishInstructions, setPublishInstructions] = useState('');
  const [publishOptions, setPublishOptions] = useState<PublishSkillOption[]>(
    [],
  );
  const [repositorySkillOptions, setRepositorySkillOptions] = useState<
    PublishSkillOption[]
  >([]);
  const [loadingRepositorySkills, setLoadingRepositorySkills] = useState(false);
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [publishSkillQuery, setPublishSkillQuery] = useState('');
  const [loadingPublishSkills, setLoadingPublishSkills] = useState(false);
  const [publishSkillError, setPublishSkillError] = useState('');
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [flowNodes, setFlowNodes, onFlowNodesChange] = useNodesState<Node>([]);
  const [flowEdges, setFlowEdges, onFlowEdgesChange] = useEdgesState<Edge>([]);
  const undoStack = useRef<WorkflowDefinition[]>([]);
  const redoStack = useRef<WorkflowDefinition[]>([]);
  const canvasRef = useRef<HTMLElement | null>(null);
  const workflowPackageId = packageId || createdPackageId;

  useEffect(() => {
    if (!token || !workflowPackageId) return;
    void Promise.all([
      liteApi.getPackage(token, workflowPackageId),
      liteApi.listVersions(token, workflowPackageId),
    ])
      .then(([detail, versions]) => {
        const savedWorkflow = detail.snapshot.workflow;
        setPkg(detail);
        setWorkflow(savedWorkflow || defaultWorkflow());
        setSelectedId(savedWorkflow?.nodes[0]?.id || 'start');
        setVersionId(packageVersionId || String(versions[0]?.id || ''));
        undoStack.current = [];
        redoStack.current = [];
      })
      .catch((error) =>
        toast.error(error instanceof Error ? error.message : '无法加载工作流'),
      );
  }, [packageVersionId, token, workflowPackageId]);

  const loadRepositorySkillOptions = useCallback(async () => {
    if (!token) return [] as PublishSkillOption[];
    const records = new Map<string, PublishSkillOption>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await liteApi.listRepositorySkills(token, {
        limit: 100,
        cursor,
      });
      page.items.forEach((skill) => {
        records.set(skill.id, {
          id: skill.id,
          name: skill.name,
          description: skill.description,
          packageName: skill.packageName,
          versionId: skill.currentVersionId ?? skill.latestVersionId,
          versionNumber:
            skill.currentVersionNumber ?? skill.latestVersionNumber,
        });
      });
      if (!page.nextCursor || cursors.has(page.nextCursor)) break;
      cursors.add(page.nextCursor);
      cursor = page.nextCursor;
    } while (cursor);
    return [...records.values()];
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let active = true;
    setLoadingRepositorySkills(true);
    void loadRepositorySkillOptions()
      .then((options) => {
        if (active) setRepositorySkillOptions(options);
      })
      .catch(() => {
        if (active) setRepositorySkillOptions([]);
      })
      .finally(() => {
        if (active) setLoadingRepositorySkills(false);
      });
    return () => {
      active = false;
    };
  }, [loadRepositorySkillOptions, token]);

  const updateWorkflow = (
    recipe: (current: WorkflowDefinition) => WorkflowDefinition,
  ) =>
    setWorkflow((current) => {
      const next = recipe(current);
      if (next !== current) {
        undoStack.current.push(current);
        redoStack.current = [];
      }
      return next;
    });
  const undo = () => {
    const previous = undoStack.current.pop();
    if (previous)
      setWorkflow((current) => {
        redoStack.current.push(current);
        return previous;
      });
  };
  const redo = () => {
    const next = redoStack.current.pop();
    if (next)
      setWorkflow((current) => {
        undoStack.current.push(current);
        return next;
      });
  };
  const updateParams = (params: Record<string, unknown>) =>
    updateWorkflow((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.id === selectedId ? { ...node, params } : node,
      ),
    }));
  const insertNode = (
    type: InsertableNodeType,
    edgeId?: string,
    position?: { x: number; y: number },
    overrides?: { name?: string; params?: Record<string, unknown> },
  ) => {
    updateWorkflow((current) =>
      insertNodeOnEdge(
        current,
        type,
        edgeId ||
          current.edges.find((edge) => edge.to === 'end')?.id ||
          current.edges[0]?.id ||
          '',
        position,
        overrides,
      ),
    );
    setInsertEdgeId(null);
  };

  const selected = useMemo(
    () =>
      workflow.nodes.find((node) => node.id === selectedId) ||
      workflow.nodes[0],
    [selectedId, workflow.nodes],
  );
  const canvasNodes = useMemo<Node[]>(() => {
    const traceByNode = new Map(
      run?.traces.map((trace) => [trace.nodeId, trace]) || [],
    );
    return workflow.nodes.map((node) => ({
      id: node.id,
      type: 'workflow',
      position: node.position,
      data: {
        node,
        selected: node.id === selectedId,
        trace: traceByNode.get(node.id)?.status,
      },
    }));
  }, [selectedId, workflow.nodes, run]);
  const canvasEdges = useMemo<Edge[]>(
    () =>
      workflow.edges.map((edge) => ({
        id: edge.id,
        source: edge.from,
        target: edge.to,
        sourceHandle: edge.condition,
        type: 'insertable',
        data: {
          onInsert: (edgeId: string) => setInsertEdgeId(edgeId),
          condition: edge.condition,
        },
        style: { stroke: '#a9a3c9', strokeWidth: 1.5 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: '#a9a3c9',
          width: 15,
          height: 15,
        },
      })),
    [workflow.edges],
  );
  useEffect(() => {
    setFlowNodes(canvasNodes);
  }, [canvasNodes, setFlowNodes]);
  useEffect(() => {
    setFlowEdges(canvasEdges);
  }, [canvasEdges, setFlowEdges]);
  useEffect(() => {
    const element = canvasRef.current;
    if (!flowInstance || !element || typeof ResizeObserver === 'undefined')
      return;
    let timer = 0;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void flowInstance.fitView({ padding: 0.32, duration: 0 });
      }, 140);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [flowInstance]);
  useEffect(() => {
    if (!flowInstance) return;
    const timer = window.setTimeout(() => {
      void flowInstance.fitView({ padding: 0.32, duration: 0 });
    }, 160);
    return () => window.clearTimeout(timer);
  }, [
    flowInstance,
    nodeLibraryOpen,
    nodeConfigOpen,
    paletteTab,
    workflow.nodes.length,
  ]);
  useEffect(() => {
    if (!publishOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !publishing) setPublishOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [publishOpen, publishing]);
  const unboundSkillNodes = workflow.nodes.filter(
    (node) =>
      node.type === 'skill' && !String(node.params.skillId || '').trim(),
  );
  const skillNodeCount = workflow.nodes.filter(
    (node) => node.type === 'skill',
  ).length;
  const selectedPublishSkills = useMemo(
    () =>
      publishOptions.filter(
        (option) => option.versionId && selectedSkillIds.includes(option.id),
      ),
    [publishOptions, selectedSkillIds],
  );
  const filteredPublishOptions = useMemo(() => {
    const keyword = publishSkillQuery.trim().toLowerCase();
    if (!keyword) return publishOptions;
    return publishOptions.filter((option) =>
      `${option.name} ${option.description} ${option.packageName}`
        .toLowerCase()
        .includes(keyword),
    );
  }, [publishOptions, publishSkillQuery]);
  const nodeLibraryItems: Array<
    [InsertableNodeType, string, string, LucideIcon]
  > = [
    ['llm', 'LLM 步骤', '生成与改写内容', Sparkles],
    ['skill', '调用 Skill', '挂载已发布能力', Puzzle],
    ['condition', '条件分支', '按结果分流', Split],
    ['loop', '循环处理', '重复直到满足条件', Repeat],
  ];
  const workflowSkillOptions = useMemo(() => {
    const options = new Map<
      string,
      { id: string; name: string; description: string; packageName: string }
    >();
    (pkg?.snapshot.skills ?? []).forEach((skill) => {
      options.set(skill.id, {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        packageName: '当前工作流',
      });
    });
    repositorySkillOptions.forEach((skill) => {
      options.set(skill.id, {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        packageName: skill.packageName,
      });
    });
    return [...options.values()];
  }, [pkg?.snapshot.skills, repositorySkillOptions]);
  const allResourcePresets = useMemo(
    () => [
      ...ANALYSIS_SKILL_PRESETS,
      ...AGENT_TEMPLATE_PRESETS,
      ...LESSON_PACK_PRESETS,
    ],
    [],
  );
  const matchResource = useCallback(
    (preset: StudioPreset) => {
      const keyword = nodeQuery.trim().toLowerCase();
      if (!keyword) return true;
      return `${preset.name} ${preset.description} ${preset.tags.join(' ')}`
        .toLowerCase()
        .includes(keyword);
    },
    [nodeQuery],
  );
  const filteredAnalysis = useMemo(
    () => ANALYSIS_SKILL_PRESETS.filter(matchResource),
    [matchResource],
  );
  const filteredAgents = useMemo(
    () => AGENT_TEMPLATE_PRESETS.filter(matchResource),
    [matchResource],
  );
  const filteredLessonPacks = useMemo(
    () => LESSON_PACK_PRESETS.filter(matchResource),
    [matchResource],
  );
  const filteredWorkflowSkills = useMemo(() => {
    const keyword = nodeQuery.trim().toLowerCase();
    if (!keyword) return workflowSkillOptions;
    return workflowSkillOptions.filter((skill) =>
      `${skill.name} ${skill.description}`.toLowerCase().includes(keyword),
    );
  }, [nodeQuery, workflowSkillOptions]);
  const insertPresetStep = (preset: StudioPreset) => {
    insertNode('llm', insertEdgeId || undefined, undefined, {
      name: preset.name,
      params: { promptTemplate: preset.prompt, inputTemplate: '{{ $input }}' },
    });
  };
  const insertWorkflowSkill = (skill: { id: string; name: string }) => {
    insertNode('skill', insertEdgeId || undefined, undefined, {
      name: skill.name,
      params: { skillId: skill.id, inputTemplate: '{{ $input }}' },
    });
  };
  const paletteItems = (items: typeof nodeLibraryItems) =>
    items.map(([type, label, description, Icon]) => (
      <button
        key={type}
        type="button"
        data-type={type}
        draggable
        onDragStart={(event) =>
          event.dataTransfer.setData('application/educlaw-workflow-node', type)
        }
        className="wf-palette-item"
        onClick={() => insertNode(type, insertEdgeId || undefined)}
      >
        <span className="wf-palette-icon">
          <Icon size={15} aria-hidden="true" />
        </span>
        <span className="wf-palette-copy">
          <strong>{label}</strong>
          <small>{description}</small>
        </span>
        <Plus size={13} className="wf-palette-plus" aria-hidden="true" />
      </button>
    ));
  const filteredPaletteItems = nodeQuery.trim()
    ? nodeLibraryItems.filter(([, label, description]) =>
        `${label} ${description}`
          .toLowerCase()
          .includes(nodeQuery.trim().toLowerCase()),
      )
    : [];
  const resourceIcon = (preset: StudioPreset) =>
    preset.kind === 'lesson-pack' ? (
      <Layers3 size={14} aria-hidden="true" />
    ) : preset.kind === 'analysis-skill' ? (
      <Wand2 size={14} aria-hidden="true" />
    ) : (
      <Rocket size={14} aria-hidden="true" />
    );
  const resourceItems = (presets: StudioPreset[]) =>
    presets.map((preset) => (
      <button
        key={preset.id}
        type="button"
        className={`wf-resource-item is-${preset.kind}`}
        onClick={() => insertPresetStep(preset)}
        title={preset.description}
      >
        <span className="wf-resource-icon">{resourceIcon(preset)}</span>
        <span className="wf-resource-copy">
          <strong>{preset.name}</strong>
          <small>{preset.description}</small>
        </span>
        <Plus size={13} className="wf-resource-plus" aria-hidden="true" />
      </button>
    ));
  const lessonPackGrid = (packs: StudioPreset[]) => (
    <div className="wf-lesson-pack-grid">
      {['语文', '数学', '英语'].map((subject) => {
        const subjectPacks = packs.filter((pack) => pack.subject === subject);
        if (!subjectPacks.length) return null;
        return (
          <div className="wf-lesson-pack-row" key={subject}>
            <span>{subject}</span>
            {subjectPacks.map((pack) => (
              <button
                key={pack.id}
                type="button"
                onClick={() => insertPresetStep(pack)}
                title={`${pack.name} · ${pack.description}`}
              >
                <strong>{pack.grade}</strong>
                <small>{pack.lessonCount} 节</small>
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
  const workflowSkillItems = (
    skills: Array<{
      id: string;
      name: string;
      description: string;
      packageName?: string;
    }>,
  ) =>
    skills.map((skill) => (
      <button
        key={skill.id}
        type="button"
        className="wf-palette-item is-preset"
        onClick={() => insertWorkflowSkill(skill)}
        title={skill.description}
      >
        <span className="wf-palette-icon">
          <Puzzle size={15} aria-hidden="true" />
        </span>
        <span className="wf-palette-copy">
          <strong>{skill.name}</strong>
          <small>
            {skill.packageName || '当前工作流'} ·{' '}
            {skill.description || '已绑定 Skill'}
          </small>
        </span>
        <Plus size={13} className="wf-palette-plus" aria-hidden="true" />
      </button>
    ));
  const resourceFilterOptions = [
    ['all', '全部', allResourcePresets.length],
    ['analysis', '分析 Skill', ANALYSIS_SKILL_PRESETS.length],
    ['agent', 'Agent', AGENT_TEMPLATE_PRESETS.length],
    ['lesson', '课例包', LESSON_PACK_PRESETS.length],
  ] as const;
  const resourceMatches = nodeQuery.trim()
    ? [...filteredAnalysis, ...filteredAgents, ...filteredLessonPacks]
    : [];
  const hasSearchResults =
    filteredPaletteItems.length +
      filteredWorkflowSkills.length +
      resourceMatches.length >
    0;

  async function persistWorkflow(
    notify = true,
  ): Promise<{ packageId: string; versionId: string } | null> {
    if (!token) return null;
    if (!workflowPackageId) {
      const detail = await liteApi.createWorkflow(token, workflow);
      const newPackageId = String(detail.id);
      const versions = await liteApi.listVersions(token, newPackageId);
      const newVersionId = String(versions[0]?.id || '');
      setCreatedPackageId(newPackageId);
      setPkg(detail);
      setVersionId(newVersionId);
      if (notify) toast.success('工作流草稿已创建');
      return newVersionId
        ? { packageId: newPackageId, versionId: newVersionId }
        : null;
    }
    if (!versionId) return null;
    await liteApi.validateWorkflow(token, workflowPackageId, workflow);
    const detail = await liteApi.saveWorkflow(token, workflowPackageId, {
      expectedPackageVersionId: versionId,
      definition: workflow,
    });
    const versions = await liteApi.listVersions(token, workflowPackageId);
    const newVersionId = String(versions[0]?.id || versionId);
    setPkg(detail);
    setVersionId(newVersionId);
    if (notify) toast.success('工作流已保存为新版本');
    return { packageId: workflowPackageId, versionId: newVersionId };
  }
  async function save() {
    if (!token) return;
    setBusy(true);
    try {
      await persistWorkflow();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存工作流失败');
    } finally {
      setBusy(false);
    }
  }
  async function execute() {
    if (!workflowPackageId || !versionId) {
      toast.error('请先保存工作流');
      return;
    }
    if (!input.trim()) {
      toast.error('请先填写试跑输入');
      return;
    }
    setBusy(true);
    try {
      const report = await liteApi.runWorkflow(token!, workflowPackageId, {
        packageVersionId: versionId,
        requestId: id('run'),
        content: input,
      });
      setRun(report);
      if (report.status === 'succeeded') toast.success('试跑完成');
      else toast.error(report.error?.message || '试跑失败');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '启动试跑失败');
    } finally {
      setBusy(false);
    }
  }
  async function saveAndRun() {
    if (!token) {
      toast.error('请先登录');
      return;
    }
    if (!input.trim()) {
      toast.error('请先填写试跑输入');
      return;
    }
    setBusy(true);
    try {
      const saved = await persistWorkflow(false);
      if (!saved) {
        toast.error('请先保存工作流');
        return;
      }
      const report = await liteApi.runWorkflow(token, saved.packageId, {
        packageVersionId: saved.versionId,
        requestId: id('run'),
        content: input,
      });
      setRun(report);
      if (report.status === 'succeeded') toast.success('试跑完成');
      else toast.error(report.error?.message || '试跑失败');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存并试跑失败');
    } finally {
      setBusy(false);
    }
  }
  async function openPublish() {
    if (!token) return;
    if (!workflowPackageId || !versionId || !pkg) {
      toast.error('请先保存工作流');
      return;
    }
    const workflowName = pkg.name.trim() || '未命名工作流';
    const agentName =
      workflowName === '未命名工作流' ? '未命名 Agent' : workflowName;
    const workflowDescription = pkg.description.trim();
    setPublishName(agentName);
    setPublishDescription(
      workflowDescription &&
        workflowDescription !== '通过工作流编辑器创建的草稿。'
        ? workflowDescription
        : workflowName === '未命名工作流'
          ? '由工作流整理生成，可直接对话。'
          : `由工作流「${workflowName}」生成，可直接对话。`,
    );
    setPublishInstructions(
      buildWorkflowAgentInstructions(
        workflow,
        workflowName,
        pkg.snapshot.agentMd,
      ),
    );
    setPublishOptions([]);
    setSelectedSkillIds([]);
    setPublishSkillQuery('');
    setPublishError('');
    setPublishSkillError('');
    setPublishOpen(true);
    setLoadingPublishSkills(true);
    try {
      const options = await loadRepositorySkillOptions();
      setPublishOptions(options);
      const boundIds = new Set(collectWorkflowSkillIds(workflow));
      setSelectedSkillIds(
        options
          .filter((option) => option.versionId && boundIds.has(option.id))
          .slice(0, 20)
          .map((option) => option.id),
      );
    } catch (error) {
      setPublishSkillError(
        error instanceof Error ? error.message : '无法读取 Skill 仓库',
      );
    } finally {
      setLoadingPublishSkills(false);
    }
  }
  async function publishAgent() {
    if (!token || publishing) return;
    if (!publishName.trim()) {
      setPublishError('请填写 Agent 名称');
      return;
    }
    if (!selectedPublishSkills.length) {
      setPublishError('请至少选择一个 Skill，Agent 才能直接对话');
      return;
    }
    if (selectedPublishSkills.length > 20) {
      setPublishError('一个 Agent 最多装配 20 个 Skill');
      return;
    }
    setPublishing(true);
    setPublishError('');
    try {
      const agent = await agentsApi.create(token, {
        name: publishName.trim(),
        description: publishDescription.trim(),
        instructions: publishInstructions.trim(),
        model: '',
        skills: selectedPublishSkills.map((skill) => ({
          skillId: skill.id,
          skillVersionId: skill.versionId!,
          enabled: true,
        })),
      });
      toast.success('Agent 已生成，可以直接对话');
      setPublishOpen(false);
      navigate(routes.chat(agent.id));
    } catch (error) {
      setPublishError(
        error instanceof Error ? error.message : '发布失败，请重试',
      );
    } finally {
      setPublishing(false);
    }
  }
  const onConnect = (connection: Connection) => {
    if (!connection.source || !connection.target) return;
    updateWorkflow((current) => {
      const source = current.nodes.find(
        (node) => node.id === connection.source,
      );
      const target = current.nodes.find(
        (node) => node.id === connection.target,
      );
      if (
        !source ||
        !target ||
        source.type === 'end' ||
        target.type === 'start'
      )
        return current;
      if (wouldCreateCycle(current, connection.source!, connection.target!)) {
        toast.error('工作流不能形成循环');
        return current;
      }
      const condition =
        source.type === 'condition'
          ? connection.sourceHandle === 'false'
            ? 'false'
            : 'true'
          : undefined;
      const rewired = current.edges.filter((edge) => {
        const replacesSource =
          edge.from === connection.source &&
          (source.type === 'condition' ? edge.condition === condition : true);
        const replacesTarget =
          target.type !== 'end' && edge.to === connection.target;
        return !replacesSource && !replacesTarget;
      });
      return {
        ...current,
        edges: [
          ...rewired,
          edgeFor(connection.source!, connection.target!, condition),
        ],
      };
    });
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const type = event.dataTransfer.getData(
      'application/educlaw-workflow-node',
    ) as InsertableNodeType;
    if (!['llm', 'skill', 'condition', 'loop'].includes(type)) return;
    insertNode(
      type,
      insertEdgeId || undefined,
      flowInstance?.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      }),
    );
  };

  return (
    <main className={`wf-studio${embedded ? ' is-embedded' : ' is-page'}`}>
      <header className="wf-topbar">
        <div className="wf-topbar-left">
          {onOpenLibrary ? (
            <>
              <button type="button" className="wf-back" onClick={onOpenLibrary}>
                <ArrowLeft size={15} aria-hidden="true" />
                工作流库
              </button>
              <span className="wf-topbar-divider" aria-hidden="true" />
            </>
          ) : null}
          <span className="wf-title-icon">
            <GitBranch size={16} aria-hidden="true" />
          </span>
          <div className="wf-title">
            <h1>{pkg?.name || '未命名工作流'}</h1>
            <p>
              {workflowPackageId
                ? `v${pkg?.versionNumber ?? '—'} · ${workflow.nodes.length} 个节点 · ${skillNodeCount} 个 Skill 节点`
                : '尚未保存 · 首次保存时创建工作流草稿'}
            </p>
          </div>
        </div>
        <div className="wf-topbar-actions">
          <div className="wf-history" role="group" aria-label="历史操作">
            <button
              type="button"
              className="wf-icon-button"
              disabled={!undoStack.current.length || busy}
              onClick={undo}
              title="撤销"
              aria-label="撤销"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              className="wf-icon-button"
              disabled={!redoStack.current.length || busy}
              onClick={redo}
              title="重做"
              aria-label="重做"
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <span className="wf-topbar-divider" aria-hidden="true" />
          <button
            type="button"
            className="wf-button"
            disabled={busy}
            onClick={() => void save()}
          >
            <Save size={14} aria-hidden="true" />
            保存草稿
          </button>
          <button
            type="button"
            className="wf-button"
            disabled={busy}
            onClick={() => setRunnerOpen(true)}
          >
            <Play size={14} aria-hidden="true" />
            试运行
          </button>
          <button
            type="button"
            className="wf-button is-primary"
            disabled={busy || !workflowPackageId || !versionId}
            onClick={() => void openPublish()}
            title={
              !workflowPackageId || !versionId
                ? '请先保存工作流'
                : '把工作流整理成一个可直接对话的 Agent'
            }
          >
            <Rocket size={14} aria-hidden="true" />
            发布为 Agent
          </button>
        </div>
      </header>
      <div
        className={`wf-body${nodeLibraryOpen ? ' has-palette' : ''}${nodeConfigOpen ? ' has-inspector' : ''}`}
      >
        {nodeLibraryOpen ? (
          <aside className="wf-palette">
            <header className="wf-palette-head">
              <div>
                <span className="wf-palette-eyebrow">NODE LIBRARY</span>
                <h2>节点与资源</h2>
              </div>
              <button
                type="button"
                className="wf-icon-button"
                onClick={() => setNodeLibraryOpen(false)}
                title="隐藏节点库"
                aria-label="隐藏节点库"
              >
                <PanelLeftClose size={16} />
              </button>
            </header>
            <label className="wf-palette-search">
              <Search size={13} aria-hidden="true" />
              <input
                value={nodeQuery}
                onChange={(event) => setNodeQuery(event.target.value)}
                placeholder="搜索节点、Skill、课例包"
                aria-label="搜索节点与资源"
              />
            </label>
            <div
              className="wf-palette-tabs"
              role="tablist"
              aria-label="节点库视图"
            >
              <button
                type="button"
                role="tab"
                aria-selected={paletteTab === 'nodes'}
                className={paletteTab === 'nodes' ? 'is-active' : undefined}
                onClick={() => {
                  setPaletteTab('nodes');
                  setNodeQuery('');
                }}
              >
                节点
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={paletteTab === 'resources'}
                className={paletteTab === 'resources' ? 'is-active' : undefined}
                onClick={() => {
                  setPaletteTab('resources');
                  setNodeQuery('');
                }}
              >
                资源
                <b>{allResourcePresets.length}</b>
              </button>
            </div>
            <div className="wf-palette-scroll">
              {nodeQuery.trim() ? (
                <div className="wf-palette-group">
                  <span className="wf-palette-group-label">
                    搜索结果{' '}
                    <em>
                      {filteredPaletteItems.length +
                        filteredWorkflowSkills.length +
                        resourceMatches.length}
                    </em>
                  </span>
                  {hasSearchResults ? (
                    <>
                      {filteredPaletteItems.length
                        ? paletteItems(filteredPaletteItems)
                        : null}
                      {filteredWorkflowSkills.length
                        ? workflowSkillItems(filteredWorkflowSkills)
                        : null}
                      {resourceMatches.length ? (
                        <div className="wf-resource-list">
                          {resourceItems(resourceMatches)}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <p className="wf-palette-empty">没有匹配的节点或资源。</p>
                  )}
                </div>
              ) : paletteTab === 'nodes' ? (
                <>
                  <div className="wf-palette-group">
                    <span className="wf-palette-group-label">基础能力</span>
                    {paletteItems(nodeLibraryItems.slice(0, 2))}
                  </div>
                  <div className="wf-palette-group">
                    <span className="wf-palette-group-label">逻辑</span>
                    {paletteItems(nodeLibraryItems.slice(2))}
                  </div>
                  <div className="wf-palette-group">
                    <span className="wf-palette-group-label">
                      仓库 Skill <em>{workflowSkillOptions.length}</em>
                    </span>
                    {loadingRepositorySkills ? (
                      <p className="wf-palette-empty">正在读取仓库 Skill…</p>
                    ) : workflowSkillOptions.length ? (
                      workflowSkillItems(workflowSkillOptions)
                    ) : (
                      <p className="wf-palette-empty">
                        仓库里还没有 Skill。先去仓库创建或载入预置 Skill。
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div
                    className="wf-resource-filter"
                    role="group"
                    aria-label="资源类型"
                  >
                    {resourceFilterOptions.map(([key, label, count]) => (
                      <button
                        key={key}
                        type="button"
                        className={
                          resourceFilter === key ? 'is-active' : undefined
                        }
                        onClick={() => setResourceFilter(key)}
                      >
                        {label}
                        <b>{count}</b>
                      </button>
                    ))}
                  </div>
                  {(resourceFilter === 'all' ||
                    resourceFilter === 'analysis') &&
                  filteredAnalysis.length ? (
                    <div className="wf-palette-group">
                      <span className="wf-palette-group-label">
                        分析 Skill <em>{filteredAnalysis.length}</em>
                      </span>
                      <div className="wf-resource-list">
                        {resourceItems(filteredAnalysis)}
                      </div>
                    </div>
                  ) : null}
                  {(resourceFilter === 'all' || resourceFilter === 'agent') &&
                  filteredAgents.length ? (
                    <div className="wf-palette-group">
                      <span className="wf-palette-group-label">
                        Agent 模板 <em>{filteredAgents.length}</em>
                      </span>
                      <div className="wf-resource-list">
                        {resourceItems(filteredAgents)}
                      </div>
                    </div>
                  ) : null}
                  {(resourceFilter === 'all' || resourceFilter === 'lesson') &&
                  filteredLessonPacks.length ? (
                    <div className="wf-palette-group">
                      <span className="wf-palette-group-label">
                        课例包 Skill <em>{filteredLessonPacks.length}</em>
                      </span>
                      {lessonPackGrid(filteredLessonPacks)}
                    </div>
                  ) : null}
                </>
              )}
            </div>
            <div className="wf-palette-note">
              <span>提示</span>
              <p>
                点击资源直接拼进流程；连线中的 ＋ 可插入指定类型节点。仓库 Skill
                在发布为 Agent 时装配。
              </p>
            </div>
          </aside>
        ) : null}
        <section className="wf-canvas-wrap" ref={canvasRef}>
          {!nodeLibraryOpen ? (
            <button
              type="button"
              className="wf-panel-tab is-left"
              onClick={() => setNodeLibraryOpen(true)}
              title="显示节点库"
              aria-label="显示节点库"
            >
              <PanelLeftOpen size={14} />
              <span>节点</span>
            </button>
          ) : null}
          {!nodeConfigOpen ? (
            <button
              type="button"
              className="wf-panel-tab is-right"
              onClick={() => setNodeConfigOpen(true)}
              title="显示节点配置"
              aria-label="显示节点配置"
            >
              <span>配置</span>
              <PanelRightOpen size={14} />
            </button>
          ) : null}
          {selectedEdgeId ? (
            <button
              type="button"
              className="wf-edge-delete"
              onClick={() => {
                updateWorkflow((current) => ({
                  ...current,
                  edges: current.edges.filter(
                    (edge) => edge.id !== selectedEdgeId,
                  ),
                }));
                setSelectedEdgeId(null);
              }}
            >
              <Trash2 size={13} aria-hidden="true" />
              删除连线
            </button>
          ) : null}
          {insertEdgeId ? (
            <div className="wf-insert-popover">
              <span>在此处添加节点</span>
              {(
                [
                  ['llm', 'LLM'],
                  ['skill', 'Skill'],
                  ['condition', '条件'],
                  ['loop', '循环'],
                ] as Array<[InsertableNodeType, string]>
              ).map(([type, label]) => (
                <button
                  type="button"
                  key={type}
                  onClick={() => insertNode(type, insertEdgeId)}
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                className="is-plain"
                onClick={() => setInsertEdgeId(null)}
              >
                取消
              </button>
            </div>
          ) : null}
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onInit={setFlowInstance}
            onConnect={onConnect}
            onNodeClick={(_, node) => {
              setSelectedId(node.id);
              setSelectedEdgeId(null);
              setNodeConfigOpen(true);
            }}
            onEdgeClick={(_, edge) => setSelectedEdgeId(edge.id)}
            onPaneClick={() => setSelectedEdgeId(null)}
            onNodesChange={onFlowNodesChange}
            onEdgesChange={onFlowEdgesChange}
            onNodeDragStop={(_, node) =>
              updateWorkflow((current) => ({
                ...current,
                nodes: current.nodes.map((item) =>
                  item.id === node.id
                    ? { ...item, position: node.position }
                    : item,
                ),
              }))
            }
            onNodesDelete={(nodes) =>
              updateWorkflow((current) =>
                nodes.reduce(
                  (next, node) => deleteWorkflowNode(next, node.id),
                  current,
                ),
              )
            }
            onEdgesDelete={(edges) => {
              updateWorkflow((current) => ({
                ...current,
                edges: current.edges.filter(
                  (edge) => !edges.some((item) => item.id === edge.id),
                ),
              }));
              setSelectedEdgeId(null);
            }}
            onDrop={onDrop}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
            }}
            zoomOnScroll={!embedded}
            preventScrolling={!embedded}
            deleteKeyCode={['Backspace', 'Delete']}
          >
            <Background gap={18} size={1.2} />
            <Controls position="bottom-left" showInteractive={false} />
          </ReactFlow>
          {runnerOpen ? (
            <section className="wf-runner" aria-label="试运行">
              <header className="wf-runner-head">
                <div className="wf-runner-title">
                  <span
                    className={`wf-runner-pulse${run ? ` is-${run.status}` : ''}`}
                    aria-hidden="true"
                  />
                  <h2>试运行</h2>
                  {run ? (
                    <span className={`wf-runner-badge is-${run.status}`}>
                      {run.status === 'succeeded'
                        ? '成功'
                        : run.status === 'failed'
                          ? '失败'
                          : '运行中'}
                    </span>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="wf-icon-button"
                  onClick={() => setRunnerOpen(false)}
                  title="关闭试运行"
                  aria-label="关闭试运行"
                >
                  <X size={15} />
                </button>
              </header>
              <div className="wf-runner-body">
                <label className="wf-field-label" htmlFor="workflow-run-input">
                  输入
                </label>
                <textarea
                  id="workflow-run-input"
                  className="wf-textarea wf-runner-input"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="输入一项教学任务，例如：为初二物理《浮力》设计一节探究课"
                />
                {!workflowPackageId || !versionId ? (
                  <p className="wf-runner-hint">
                    尚未保存；点「保存并试跑」会自动保存后再运行。
                  </p>
                ) : null}
                {unboundSkillNodes.length ? (
                  <p className="wf-runner-hint is-warning">
                    还有 {unboundSkillNodes.length} 个 Skill
                    节点未绑定，绑定后才能试跑。
                  </p>
                ) : null}
                <div className="wf-runner-actions">
                  <button
                    type="button"
                    className="wf-button"
                    onClick={() => void saveAndRun()}
                    disabled={busy || unboundSkillNodes.length > 0}
                  >
                    <Save size={13} aria-hidden="true" />
                    保存并试跑
                  </button>
                  <button
                    type="button"
                    className="wf-button is-primary"
                    onClick={() => void execute()}
                    disabled={
                      busy ||
                      unboundSkillNodes.length > 0 ||
                      !workflowPackageId ||
                      !versionId
                    }
                  >
                    <Play size={13} aria-hidden="true" />
                    {busy ? '正在运行…' : '开始试跑'}
                  </button>
                </div>
                {run ? (
                  <div className="wf-runner-result">
                    <div className="wf-runner-output">
                      <span>输出</span>
                      <p>{run.output || run.error?.message || '暂无输出'}</p>
                    </div>
                    <div className="wf-runner-traces">
                      <span>运行轨迹</span>
                      <ol>
                        {run.traces.map((trace) => {
                          const node = workflow.nodes.find(
                            (item) => item.id === trace.nodeId,
                          );
                          return (
                            <li
                              key={trace.nodeId}
                              className={`is-${trace.status}`}
                            >
                              <span
                                className="wf-trace-dot"
                                aria-hidden="true"
                              />
                              <span className="wf-trace-name">
                                {node?.name || trace.nodeId}
                              </span>
                              <span className="wf-trace-status">
                                {traceLabels[trace.status]}
                              </span>
                              {durationLabel(trace.durationMs) ? (
                                <span className="wf-trace-time">
                                  {durationLabel(trace.durationMs)}
                                </span>
                              ) : null}
                            </li>
                          );
                        })}
                      </ol>
                    </div>
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}
        </section>
        {nodeConfigOpen ? (
          <NodeConfigPanel
            node={selected}
            skills={workflowSkillOptions}
            upstreamNodes={workflow.edges
              .filter((edge) => edge.to === selected.id)
              .map((edge) =>
                workflow.nodes.find((node) => node.id === edge.from),
              )
              .filter((node): node is WorkflowNode => Boolean(node))}
            onClose={() => setNodeConfigOpen(false)}
            onRename={(name) =>
              updateWorkflow((current) => ({
                ...current,
                nodes: current.nodes.map((node) =>
                  node.id === selected.id ? { ...node, name } : node,
                ),
              }))
            }
            onUpdateParams={updateParams}
            onDelete={() => {
              updateWorkflow((current) =>
                deleteWorkflowNode(current, selected.id),
              );
              setSelectedId('start');
            }}
          />
        ) : null}
      </div>
      {publishOpen ? (
        <div
          className="wf-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !publishing)
              setPublishOpen(false);
          }}
        >
          <section
            className="wf-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wf-publish-title"
          >
            <header className="wf-modal-head">
              <div>
                <span className="wf-inspector-eyebrow">
                  PUBLISH · 生成可直接对话的 Agent
                </span>
                <h2 id="wf-publish-title">发布为 Agent</h2>
                <p>把工作流里的 Skill 装配到一个 Agent，生成后直接进入对话。</p>
              </div>
              <button
                type="button"
                className="wf-icon-button"
                onClick={() => setPublishOpen(false)}
                disabled={publishing}
                title="关闭"
                aria-label="关闭发布面板"
              >
                <X size={16} />
              </button>
            </header>
            <div className="wf-modal-body">
              <div className="wf-modal-grid">
                <label>
                  Agent 名称
                  <input
                    className="wf-input"
                    value={publishName}
                    onChange={(event) => setPublishName(event.target.value)}
                    placeholder="例如：初中物理备课 Agent"
                  />
                </label>
                <label>
                  描述
                  <input
                    className="wf-input"
                    value={publishDescription}
                    onChange={(event) =>
                      setPublishDescription(event.target.value)
                    }
                    placeholder="一句话说明这个 Agent 能做什么"
                  />
                </label>
              </div>
              <label>
                指令
                <textarea
                  className="wf-textarea wf-modal-instructions"
                  value={publishInstructions}
                  onChange={(event) =>
                    setPublishInstructions(event.target.value)
                  }
                />
              </label>
              <section className="wf-publish-skills">
                <header>
                  <span>装配 Skill</span>
                  <span>
                    {loadingPublishSkills
                      ? '正在读取…'
                      : `已选 ${selectedPublishSkills.length} / 20`}
                  </span>
                </header>
                <input
                  className="wf-input"
                  type="search"
                  value={publishSkillQuery}
                  onChange={(event) => setPublishSkillQuery(event.target.value)}
                  placeholder="搜索仓库里的 Skill"
                  aria-label="搜索仓库里的 Skill"
                />
                {loadingPublishSkills ? (
                  <p className="wf-field-hint">正在读取 Skill 仓库…</p>
                ) : publishOptions.length ? (
                  <ul className="wf-publish-skill-options">
                    {filteredPublishOptions.map((skill) => {
                      const checked = selectedSkillIds.includes(skill.id);
                      const disabled =
                        !skill.versionId ||
                        (!checked && selectedPublishSkills.length >= 20);
                      return (
                        <li key={skill.id}>
                          <label
                            className={
                              disabled && !checked ? 'is-disabled' : undefined
                            }
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={disabled}
                              onChange={(event) => {
                                const nextChecked = event.target.checked;
                                setSelectedSkillIds((current) =>
                                  nextChecked
                                    ? [...current, skill.id]
                                    : current.filter((id) => id !== skill.id),
                                );
                              }}
                            />
                            <span className="wf-publish-skill-icon">
                              <Puzzle size={12} aria-hidden="true" />
                            </span>
                            <span className="wf-publish-skill-copy">
                              <strong>{skill.name}</strong>
                              <small>
                                {skill.description || skill.packageName}
                              </small>
                            </span>
                            <span className="wf-publish-skill-version">
                              {skill.versionNumber
                                ? `v${skill.versionNumber}`
                                : '无版本'}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="wf-field-hint is-warning">
                    仓库里还没有可装配的 Skill。先在仓库里创建一个
                    Skill，再回来发布。
                  </p>
                )}
                {!loadingPublishSkills &&
                publishOptions.length &&
                !filteredPublishOptions.length ? (
                  <p className="wf-field-hint">没有匹配的 Skill。</p>
                ) : null}
                {publishSkillError ? (
                  <p className="wf-field-hint is-warning">
                    {publishSkillError}
                  </p>
                ) : null}
                {unboundSkillNodes.length ? (
                  <p className="wf-field-hint is-warning">
                    有 {unboundSkillNodes.length} 个 Skill
                    节点未绑定，发布时会按上面勾选的 Skill 装配。
                  </p>
                ) : null}
              </section>
              {publishError ? (
                <p role="alert" className="wf-modal-error">
                  {publishError}
                </p>
              ) : null}
            </div>
            <footer className="wf-modal-foot">
              <button
                type="button"
                className="wf-button"
                onClick={() => setPublishOpen(false)}
                disabled={publishing}
              >
                取消
              </button>
              <button
                type="button"
                className="wf-button is-primary"
                onClick={() => void publishAgent()}
                disabled={
                  publishing ||
                  loadingPublishSkills ||
                  !publishName.trim() ||
                  !selectedPublishSkills.length ||
                  selectedPublishSkills.length > 20
                }
              >
                {publishing ? '正在生成…' : '发布并开始对话'}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </main>
  );
}
