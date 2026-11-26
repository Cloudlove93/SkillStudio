// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getPackage: vi.fn(),
  listVersions: vi.fn(),
  runWorkflow: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock('../api/lite-api', () => ({ liteApi: mocks }));
vi.mock('sonner', () => ({
  toast: { success: mocks.success, error: mocks.error },
}));
// The canvas is unrelated to execution feedback; exercise the real page, form and API handler.
vi.mock('@xyflow/react', () => ({
  ReactFlow: () => null,
  Background: () => null,
  BaseEdge: () => null,
  Controls: () => null,
  EdgeLabelRenderer: () => null,
  Handle: () => null,
  MiniMap: () => null,
  MarkerType: { ArrowClosed: 'arrow' },
  Position: { Left: 'left', Right: 'right' },
  getBezierPath: vi.fn(),
  useNodesState: (initial: []) => [...useState(initial), vi.fn()],
  useEdgesState: (initial: []) => [...useState(initial), vi.fn()],
}));
import WorkflowDemo from './WorkflowDemo';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.getPackage.mockResolvedValue({
    id: 'pkg',
    name: '课堂工作流',
    snapshot: { skills: [] },
  });
  mocks.listVersions.mockResolvedValue([{ id: 'version-1' }]);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <WorkflowDemo
        token="test"
        packageId="pkg"
        packageVersionId="version-1"
      />,
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function execute() {
  const input = container.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )!.set!.call(input, '浮力教学');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const button = Array.from(container.querySelectorAll('button')).find(
    (item) => item.textContent === '整体试跑',
  )!;
  await act(async () => button.click());
  expect(button.disabled).toBe(false);
}

describe('workflow run feedback', () => {
  it('shows success after a successful run', async () => {
    mocks.runWorkflow.mockResolvedValue({ status: 'succeeded', traces: [] });
    await execute();
    expect(mocks.runWorkflow).toHaveBeenCalledWith(
      'test',
      'pkg',
      expect.objectContaining({
        content: '浮力教学',
        packageVersionId: 'version-1',
      }),
    );
    expect(mocks.success).toHaveBeenCalledWith('试跑完成');
    expect(mocks.error).not.toHaveBeenCalled();
  });
  it.each([
    ['节点失败', '节点失败'],
    [undefined, '试跑失败'],
  ])('shows failed run feedback with message %s', async (message, expected) => {
    mocks.runWorkflow.mockResolvedValue({
      status: 'failed',
      traces: [],
      error: { message },
    });
    await execute();
    expect(mocks.error).toHaveBeenCalledWith(expected);
    expect(mocks.success).not.toHaveBeenCalled();
  });
  it('shows network failure and releases the busy state', async () => {
    mocks.runWorkflow.mockRejectedValue(new Error('连接失败'));
    await execute();
    expect(mocks.error).toHaveBeenCalledWith('连接失败');
  });
});
