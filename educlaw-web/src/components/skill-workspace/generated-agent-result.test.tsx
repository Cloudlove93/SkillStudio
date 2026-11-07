// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { GuidedCreationSession } from '@educlaw/shared';
import { GeneratedAgentResult } from './GeneratedAgentResult';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const container = document.createElement('div');
const root = createRoot(container);
afterEach(async () => {
  await act(async () => root.render(null));
});

const session = {
  id: '55',
  status: 'completed',
  package_id: '41',
  skill_id: '42',
  draft: {},
  generatedAgent: {
    agentId: '41',
    skillId: '42',
    skillVersionId: '43',
    packageVersionId: '44',
    sourceSessionId: '55',
    name: '课堂活动助手',
    description: '设计活动',
    instructions: '先确认教学目标',
    model: 'teaching-model',
    skills: [
      {
        id: 'lesson',
        dirName: 'lesson',
        name: '课堂活动方法',
        description: '',
        skillMd: '# Lesson',
      },
    ],
  },
} as GuidedCreationSession;

it('previews the saved Agent and dispatches separate Agent and Skill actions', async () => {
  const onOpenAgent = vi.fn();
  const onOpenSkill = vi.fn();
  await act(async () =>
    root.render(
      <GeneratedAgentResult
        session={session}
        onOpenAgent={onOpenAgent}
        onOpenSkill={onOpenSkill}
      />,
    ),
  );
  expect(container.textContent).toContain('课堂活动助手');
  expect(container.textContent).toContain('先确认教学目标');
  expect(container.textContent).toContain('课堂活动方法');
  const buttons = container.querySelectorAll<HTMLButtonElement>('button');
  await act(async () => buttons[0]?.click());
  expect(onOpenAgent).toHaveBeenCalledOnce();
  expect(onOpenSkill).not.toHaveBeenCalled();
  await act(async () => buttons[1]?.click());
  expect(onOpenSkill).toHaveBeenCalledOnce();
});

it('keeps old skill-only results readable and provides explicit conversion', async () => {
  const onOpenAgent = vi.fn();
  await act(async () =>
    root.render(
      <GeneratedAgentResult
        session={{ ...session, generatedAgent: null }}
        onOpenAgent={onOpenAgent}
        onOpenSkill={vi.fn()}
      />,
    ),
  );
  expect(container.textContent).toContain('历史 Skill 生成记录');
  expect(container.querySelector('button')?.textContent).toContain(
    '转为 Agent',
  );
  await act(async () => container.querySelector('button')?.click());
  expect(onOpenAgent).toHaveBeenCalledOnce();
});
