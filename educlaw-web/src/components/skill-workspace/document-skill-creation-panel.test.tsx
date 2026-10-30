// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DOCUMENT_CONTENT_QUALITY_ERROR } from '@educlaw/shared';
import { WorkspaceInspectorProvider } from './WorkspaceInspectorProvider';

const api = vi.hoisted(() => ({
  generatePackageStream: vi.fn(),
}));

vi.mock('../../api/lite-api', () => ({ liteApi: api }));
vi.mock('./InspectorPortal', () => ({
  InspectorPortal: ({ children }: { children: ReactNode }) => children,
}));

import { DocumentSkillCreationPanel } from './DocumentSkillCreationPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function textFile(name: string, content: string) {
  return Object.assign(new File([content], name, { type: 'text/markdown' }), {
    text: async () => content,
  });
}

function setInputFile(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [file],
  });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderPanel(onGenerated = vi.fn()) {
  await act(async () =>
    root.render(
      <MemoryRouter>
        <WorkspaceInspectorProvider>
          <DocumentSkillCreationPanel
            token="test-token"
            onGenerated={onGenerated}
          />
        </WorkspaceInspectorProvider>
      </MemoryRouter>,
    ),
  );
  return onGenerated;
}

it('rejects a meaningless document immediately without starting generation', async () => {
  const onGenerated = await renderPanel();
  const input = container.querySelector<HTMLInputElement>(
    'input[name="skill-source-documents"]',
  )!;

  await act(async () => setInputFile(input, textFile('a.md', '68fjjfy4mi夫57')));

  expect(container.textContent).toContain(
    'a.md：' + DOCUMENT_CONTENT_QUALITY_ERROR,
  );
  expect(
    container.querySelector<HTMLButtonElement>('.skill-primary-button')
      ?.disabled,
  ).toBe(true);
  expect(api.generatePackageStream).not.toHaveBeenCalled();
  expect(onGenerated).not.toHaveBeenCalled();
});

it('keeps meaningful documents eligible for normal generation', async () => {
  api.generatePackageStream.mockImplementation(
    async (
      _token: string,
      _instruction: string,
      _model: undefined,
      _documents: unknown[],
      onEvent: (event: { event: string; data: Record<string, unknown> }) => void,
    ) => {
      onEvent({
        event: 'done',
        data: { id: 'package-1', name: '函数作业设计' },
      });
      onEvent({ event: 'stream_end', data: { ok: true } });
    },
  );
  const onGenerated = await renderPanel();
  const input = container.querySelector<HTMLInputElement>(
    'input[name="skill-source-documents"]',
  )!;

  await act(async () =>
    setInputFile(input, textFile('lesson.md', '设计一份函数作业并说明评价标准')),
  );

  const generateButton = container.querySelector<HTMLButtonElement>(
    '.skill-primary-button',
  )!;
  expect(container.textContent).toContain('已添加 1 份文档');
  expect(generateButton.disabled).toBe(false);

  await act(async () => generateButton.click());

  expect(api.generatePackageStream).toHaveBeenCalledOnce();
  expect(onGenerated).toHaveBeenCalledOnce();
});
