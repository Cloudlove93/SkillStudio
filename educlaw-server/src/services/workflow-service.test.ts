import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowDefinition, WorkflowNode } from '@educlaw/shared';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  getVersion: vi.fn(),
  generateText: vi.fn(),
}));
vi.mock('./db.js', () => ({ query: mocks.query, withTransaction: vi.fn() }));
vi.mock('./package-service.js', () => ({
  getVersion: mocks.getVersion,
  getPackage: vi.fn(),
  createPackageWithSnapshotTx: vi.fn(),
  createPackageVersionWithSnapshotTx: vi.fn(),
}));
vi.mock('./llm-service.js', () => ({ generateText: mocks.generateText }));
import { runWorkflow } from './workflow-service.js';

const node = (
  id: string,
  type: WorkflowNode['type'],
  params = {},
): WorkflowNode => ({
  id,
  type,
  name: id,
  position: { x: 0, y: 0 },
  params,
});
function workflow(steps: WorkflowNode[] = []): WorkflowDefinition {
  const nodes = [
    node('start', 'start'),
    ...steps,
    node('end', 'end', {
      outputTemplate: steps.length
        ? `{{ $node.${steps.at(-1)!.id}.output.text }}`
        : '{{ $input }}',
    }),
  ];
  return {
    schemaVersion: 1,
    nodes,
    edges: nodes
      .slice(1)
      .map((next, i) => ({ id: `e${i}`, from: nodes[i].id, to: next.id })),
  };
}
function useWorkflow(definition: WorkflowDefinition) {
  mocks.getVersion.mockResolvedValue({
    id: 'version-1',
    snapshot: {
      agentMd: '教学助手',
      skills: [{ id: 'lesson', name: '备课', skillMd: '给出教学步骤' }],
      workflow: definition,
    },
  });
}
const request = {
  packageVersionId: 'version-1',
  requestId: 'request-1',
  content: '浮力',
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.query.mockImplementation(async (sql: string) => ({
    rows: sql.startsWith('insert') ? [{ id: 7 }] : [],
  }));
  mocks.generateText.mockResolvedValue('模型输出');
  useWorkflow(workflow());
});

describe('workflow execution regression', () => {
  it('persists a completed start/end run without calling the model', async () => {
    const report = await runWorkflow('owner', 'pkg', request);
    expect(report.status).toBe('succeeded');
    expect(report.output).toBe('浮力');
    expect(report.traces.map((trace) => trace.status)).toEqual([
      'succeeded',
      'succeeded',
    ]);
    expect(mocks.generateText).not.toHaveBeenCalled();
    expect(mocks.query).toHaveBeenLastCalledWith(
      expect.stringContaining('update arena_runs'),
      expect.arrayContaining([2, 7]),
    );
  });

  it.each(['llm', 'skill'] as const)(
    'renders input for a %s node and uses the versioned prompt',
    async (type) => {
      useWorkflow(
        workflow([
          node('step', type, {
            skillId: 'lesson',
            promptTemplate: '{{ $input }}',
            inputTemplate: '{{ $input }}',
          }),
        ]),
      );
      const report = await runWorkflow('owner', 'pkg', request);
      expect(report.output).toBe('模型输出');
      expect(mocks.generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          userPrompt: '浮力',
          systemPrompt: expect.stringContaining('教学助手'),
        }),
      );
      if (type === 'skill')
        expect(mocks.generateText.mock.calls[0][0].systemPrompt).toContain(
          '给出教学步骤',
        );
    },
  );

  it('feeds the previous loop result into the following iteration', async () => {
    useWorkflow(
      workflow([
        node('step', 'loop', {
          iterations: 2,
          promptTemplate: '完善 {{ $input }}',
        }),
      ]),
    );
    mocks.generateText
      .mockResolvedValueOnce('初稿')
      .mockResolvedValueOnce('终稿');
    const report = await runWorkflow('owner', 'pkg', request);
    expect(report.output).toBe('终稿');
    expect(mocks.generateText).toHaveBeenCalledTimes(2);
    expect(mocks.generateText.mock.calls[1][0].userPrompt).toContain(
      '上一轮结果：初稿',
    );
  });

  it.each(['equals', 'not_equals'])(
    'routes the %s condition and skips the other branch',
    async (operator) => {
      const definition = workflow();
      definition.nodes.splice(
        1,
        0,
        node('check', 'condition', {
          left: '{{ $input }}',
          right: '浮力',
          operator,
        }),
        node('yes', 'llm', { promptTemplate: '真分支' }),
        node('no', 'llm', { promptTemplate: '假分支' }),
      );
      definition.nodes.at(-1)!.params.outputTemplate = '{{ $input }}';
      definition.edges = [
        { id: 'a', from: 'start', to: 'check' },
        { id: 'b', from: 'check', to: 'yes', condition: 'true' },
        { id: 'c', from: 'check', to: 'no', condition: 'false' },
        { id: 'd', from: 'yes', to: 'end' },
        { id: 'e', from: 'no', to: 'end' },
      ];
      useWorkflow(definition);
      const report = await runWorkflow('owner', 'pkg', request);
      expect(report.status).toBe('succeeded');
      expect(mocks.generateText).toHaveBeenCalledTimes(1);
      expect(mocks.generateText.mock.calls[0][0].userPrompt).toBe(
        operator === 'equals' ? '真分支' : '假分支',
      );
      expect(
        report.traces.filter((trace) => trace.status === 'skipped'),
      ).toHaveLength(1);
    },
  );

  it('marks a model error as failed and persists the stable public error', async () => {
    useWorkflow(
      workflow([node('step', 'llm', { promptTemplate: '{{ $input }}' })]),
    );
    mocks.generateText.mockRejectedValue(new Error('private provider details'));
    const report = await runWorkflow('owner', 'pkg', request);
    expect(report.status).toBe('failed');
    expect(report.error?.code).toBe('WORKFLOW_RUN_FAILED');
    expect(JSON.stringify(report)).not.toContain('private provider details');
    expect(report.traces.map((trace) => trace.status)).toEqual([
      'succeeded',
      'failed',
      'skipped',
    ]);
    expect(mocks.query.mock.calls.at(-1)?.[1][0]).toBe(3);
  });

  it('replays an existing request without running nodes again', async () => {
    const previous = { runId: 'existing', status: 'succeeded' };
    mocks.query.mockResolvedValueOnce({ rows: [{ report_json: previous }] });
    expect(await runWorkflow('owner', 'pkg', request)).toEqual(previous);
    expect(mocks.getVersion).not.toHaveBeenCalled();
    expect(mocks.generateText).not.toHaveBeenCalled();
  });
});
