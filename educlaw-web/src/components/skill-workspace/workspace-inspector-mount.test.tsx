// @vitest-environment jsdom

import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MultimodalSkillCreationPanel } from './MultimodalSkillCreationPanel';
import { WorkspaceInspector } from './WorkspaceInspector';
import {
  useWorkspaceInspector,
  WorkspaceInspectorProvider,
} from './WorkspaceInspectorProvider';
import type { InspectorDescriptor } from './workspace-inspector-state';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

  it('uses the intended default inspector width when no preference is stored', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/skills']}>
          <WorkspaceInspectorProvider>
            <WorkspaceInspector
              defaultDescriptor={{
                owner: 'skill',
                view: 'summary',
                title: '当前 Skill',
              }}
            />
          </WorkspaceInspectorProvider>
        </MemoryRouter>,
      );
    });

    const inspector = container.querySelector<HTMLElement>('.workspace-inspector');
    expect(inspector?.style.getPropertyValue('--workspace-inspector-width')).toBe(
      '384px',
    );
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

  it('restores a pinned Skill launcher after the inspector closes', async () => {
    localStorage.setItem('eduskill:skill-launcher-pinned:v1', 'true');
    const onNavigate = vi.fn();
    const skillNavigation = {
      activeView: 'run',
      onNavigate,
    };

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/skills']}>
          <WorkspaceInspectorProvider>
            <WorkspaceInspector
              defaultDescriptor={{
                owner: 'skill',
                view: 'summary',
                title: '当前 Skill',
              }}
              {...({ skillNavigation } as Record<string, unknown>)}
            />
          </WorkspaceInspectorProvider>
        </MemoryRouter>,
      );
    });

    expect(
      container.querySelector('[aria-label="Skill 功能切换"]'),
    ).not.toBeNull();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="展开右侧栏"]')
        ?.click();
    });
    expect(
      container.querySelector('[aria-label="Skill 功能切换"]'),
    ).toBeNull();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="收起右侧栏"]')
        ?.click();
    });
    expect(
      container.querySelector('[aria-label="Skill 功能切换"]'),
    ).not.toBeNull();
  });

  it('keeps a pinned Skill launcher visible while switching to Arena', async () => {
    localStorage.setItem('eduskill:skill-launcher-pinned:v1', 'true');
    const onNavigate = vi.fn();
    const skillNavigation = {
      activeView: 'run',
      onNavigate,
    };

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/skills']}>
          <WorkspaceInspectorProvider>
            <WorkspaceInspector
              defaultDescriptor={{
                owner: 'skill',
                view: 'summary',
                title: '当前 Skill',
              }}
              {...({ skillNavigation } as Record<string, unknown>)}
            />
          </WorkspaceInspectorProvider>
        </MemoryRouter>,
      );
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="切换到 Arena"]')
        ?.click();
    });

    expect(onNavigate).toHaveBeenCalledWith('arena');
    expect(
      container.querySelector('[aria-label="Skill 功能切换"]'),
    ).not.toBeNull();
  });

  it('restores the pinned launcher preference after the workspace remounts', async () => {
    localStorage.setItem('eduskill:skill-launcher-pinned:v1', 'true');
    const renderWorkspace = () => (
      <MemoryRouter initialEntries={['/skills']}>
        <WorkspaceInspectorProvider>
          <WorkspaceInspector
            defaultDescriptor={{
              owner: 'skill',
              view: 'summary',
              title: '当前 Skill',
            }}
            skillNavigation={{ activeView: 'optimize', onNavigate: vi.fn() }}
          />
        </WorkspaceInspectorProvider>
      </MemoryRouter>
    );

    await act(async () => root.render(renderWorkspace()));
    expect(
      container.querySelector('[aria-label="Skill 功能切换"]'),
    ).not.toBeNull();

    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(renderWorkspace()));

    expect(
      container.querySelector('[aria-label="Skill 功能切换"]'),
    ).not.toBeNull();
    expect(
      container
        .querySelector('[aria-label="切换到 优化"]')
        ?.getAttribute('aria-current'),
    ).toBe('page');
  });

  it('does not silently cancel the pinned launcher preference when Escape is pressed', async () => {
    localStorage.setItem('eduskill:skill-launcher-pinned:v1', 'true');

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/skills']}>
          <WorkspaceInspectorProvider>
            <WorkspaceInspector
              defaultDescriptor={{
                owner: 'skill',
                view: 'summary',
                title: '当前 Skill',
              }}
              skillNavigation={{ activeView: 'run', onNavigate: vi.fn() }}
            />
          </WorkspaceInspectorProvider>
        </MemoryRouter>,
      );
    });

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(localStorage.getItem('eduskill:skill-launcher-pinned:v1')).toBe('true');
    expect(
      container.querySelector('[aria-label="Skill 功能切换"]'),
    ).not.toBeNull();
  });
});
