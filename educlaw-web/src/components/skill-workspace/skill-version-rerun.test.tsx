// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { ArenaThread, SkillVersionDetail } from '@educlaw/shared';
import type { AnswerOptimizationRerunRequest } from './answer-optimization-selection';
const api = vi.hoisted(() => ({
  createArenaThread: vi.fn(),
  renameArenaThread: vi.fn(),
  startArenaRun: vi.fn(),
  recoverArenaRun: vi.fn(),
}));
vi.mock('../../api/lite-api', () => ({ liteApi: api }));
vi.mock('./SkillVersionWorkspace', () => ({
  SkillVersionWorkspace: () => <div>versions</div>,
}));
vi.mock('../lite/lite-rendering', () => ({
  MarkdownContent: ({ content }: { content: string }) => <div>{content}</div>,
}));
import { SkillDetailWorkspace } from './SkillDetailWorkspace';
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
it('consumes an optimization rerun once even after visiting version management and returning', async () => {
  await import('./SkillRunWorkspace');
  const version = {
    id: '3',
    skillId: '11',
    versionNumber: 3,
    createdInPackageVersionId: '10',
    status: 'active',
  } as SkillVersionDetail;
  const thread = {
    id: 91,
    skillArenaConfig: { right: { skillVersionId: '3' } },
  } as ArenaThread;
  const done = {
    runId: 'r1',
    threadId: 91,
    revision: 3,
    status: 'succeeded',
    shared: {
      id: 1,
      threadId: 91,
      side: 'shared',
      role: 'user',
      content: 'rerun question',
    },
    messages: [
      {
        id: 2,
        threadId: 91,
        side: 'enhanced',
        role: 'assistant',
        content: 'saved',
      },
    ],
  };
  api.createArenaThread.mockResolvedValue(thread);
  api.renameArenaThread.mockResolvedValue(thread);
  api.startArenaRun.mockResolvedValue(done);
  api.recoverArenaRun.mockResolvedValue({
    detail: { messages: done.messages },
    run: done,
  });
  const root = createRoot(document.createElement('div'));
  function Harness({ view }: { view: 'run' | 'versions' }) {
    const [rerun, setRerun] = useState<AnswerOptimizationRerunRequest | null>({
      requestId: 'only-once',
      versionNumber: 3,
      selection: {
        origin: 'run',
        question: 'rerun question',
      } as AnswerOptimizationRerunRequest['selection'],
    });
    const [threadId, setThreadId] = useState<string | null>(null);
    return (
      <SkillDetailWorkspace
        token="t"
        skill={{ packageId: '7', skillId: '11', name: 'S', description: '' }}
        view={view}
        versions={[version]}
        currentVersionId="3"
        currentPackageVersionId="99"
        versionsLoading={false}
        conversations={[thread]}
        selectedConversationId={threadId}
        onConversationCreated={(t) => setThreadId(String(t.id))}
        onConversationUpdated={() => {}}
        onNewConversation={() => setThreadId(null)}
        onReloadVersions={async () => {}}
        onPublishUpdate={() => {}}
        onNavigate={() => {}}
        onBackToRepository={() => {}}
        onOptimizeAnswer={() => {}}
        answerRerunRequest={rerun}
        {...{ onRerunHandled: () => setRerun(null) }}
      />
    );
  }
  try {
    await act(async () => root.render(<Harness view="run" />));
    expect(api.startArenaRun).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<Harness view="versions" />));
    await act(async () => root.render(<Harness view="run" />));
    expect(api.startArenaRun).toHaveBeenCalledTimes(1);
    expect(api.createArenaThread).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
  }
});
