// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { SkillVersionDetail } from '@educlaw/shared';
const api = vi.hoisted(() => ({
  createArenaThread: vi.fn(),
  sendMessageStream: vi.fn(),
}));
vi.mock('../../api/lite-api', () => ({ liteApi: api }));
import { SkillArenaWorkspace } from './SkillArenaWorkspace';
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
it.each([null, '99'])(
  'uses only a verified current package head for Arena answer optimization (%s)',
  async (head) => {
    api.createArenaThread.mockResolvedValue({ id: 91 });
    api.sendMessageStream.mockImplementation(async (...args: unknown[]) => {
      const emit = args[6] as (e: unknown) => void;
      for (const side of ['baseline', 'enhanced'])
        emit({
          event: 'side_done',
          data: { side, content: `${side} answer`, ok: true },
        });
      emit({
        event: 'done',
        data: {
          messages: [
            { side: 'shared', id: 1, threadId: 91 },
            { side: 'baseline', id: 2 },
            { side: 'enhanced', id: 3 },
          ],
        },
      });
    });
    const container = document.createElement('div');
    const root = createRoot(container);
    const optimize = vi.fn();
    const versions = [2, 1].map((n) => ({
      id: String(n),
      skillId: '11',
      versionNumber: n,
      status: 'active',
      createdInPackageVersionId: '20',
    })) as SkillVersionDetail[];
    try {
      await act(async () =>
        root.render(
          <SkillArenaWorkspace
            token="t"
            packageId="7"
            versions={versions}
            currentVersionId="2"
            {...{ currentPackageVersionId: head }}
            onCompleted={() => {}}
            onOptimizeAnswer={optimize}
          />,
        ),
      );
      await act(async () => {
        const input = container.querySelector('textarea')!;
        Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          'value',
        )!.set!.call(input, 'question');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () =>
        container
          .querySelector<HTMLButtonElement>('[aria-label="运行版本对比"]')!
          .click(),
      );
      const buttons = Array.from(container.querySelectorAll('button')).filter(
        (b) => b.textContent?.includes('改进这个版本'),
      );
      if (head) {
        expect(buttons).toHaveLength(2);
        await act(async () => buttons[0].click());
        expect(optimize).toHaveBeenCalledWith(
          expect.objectContaining({ currentPackageVersionId: 99 }),
        );
      } else {
        expect(buttons).toHaveLength(0);
        expect(optimize).not.toHaveBeenCalled();
      }
    } finally {
      await act(async () => root.unmount());
    }
  },
);
