// @vitest-environment jsdom

import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MultimodalSkillCreationPanel } from './MultimodalSkillCreationPanel';
import { WorkspaceInspector } from './WorkspaceInspector';
import {
  useWorkspaceInspector,
  WorkspaceInspectorProvider,
} from './WorkspaceInspectorProvider';
import type { InspectorDescriptor } from './workspace-inspector-state';

let openInspector: ((descriptor: InspectorDescriptor) => void) | null = null;

function InspectorTestController() {
  const inspector = useWorkspaceInspector();

  useEffect(() => {
    openInspector = inspector.openInspector;
    return () => {
      openInspector = null;
    };
  }, [inspector.openInspector]);

  return null;
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('workspace inspector mount stability', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('keeps multimodal form state mounted while inspector views change', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/skills']}>
          <WorkspaceInspectorProvider>
            <MultimodalSkillCreationPanel token="test-token" />
            <WorkspaceInspector
              defaultDescriptor={{
                owner: 'multimodal',
                view: 'multimodal-progress',
                title: '处理状态',
              }}
            />
            <InspectorTestController />
          </WorkspaceInspectorProvider>
        </MemoryRouter>,
      );
    });

    const taskName = container.querySelector<HTMLInputElement>(
      'input[name="multimodal-task-name"]',
    );
    expect(taskName).not.toBeNull();

    await act(async () => {
      setInputValue(taskName!, '函数课程蒸馏');
    });
    expect(taskName!.value).toBe('函数课程蒸馏');

    await act(async () => {
      openInspector?.({
        owner: 'multimodal',
        view: 'multimodal-progress',
        title: '处理状态',
      });
    });
    await act(async () => {
      openInspector?.({
        owner: 'multimodal',
        view: 'multimodal-diagnostics',
        title: '处理诊断',
      });
    });

    const taskNameAfterSwitch = container.querySelector<HTMLInputElement>(
      'input[name="multimodal-task-name"]',
    );
    expect(taskNameAfterSwitch).toBe(taskName);
    expect(taskNameAfterSwitch?.value).toBe('函数课程蒸馏');
    expect(taskNameAfterSwitch?.isConnected).toBe(true);
  });
});
