// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { GuidedCreationSession } from '@educlaw/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InnoSkillPortalPages } from './InnoSkillPortalPages';
import { InnoSkillSidebar } from './InnoSkillSidebar';
import type { RepositorySkill } from './SkillRepositoryWorkspace';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const skill: RepositorySkill = {
  key: '7:11',
  packageId: '7',
  skillId: '11',
  name: '分层教学助手',
  description: '根据课堂表现生成分层教学活动',
  updatedAt: '2026-11-01T00:00:00Z',
  latestVersionId: '21',
  latestVersionNumber: 2,
  currentVersionId: '21',
  currentVersionNumber: 2,
};

const draft = {
  id: 'draft-1',
  display_name: '课堂活动设计',
  status: 'ready_for_confirmation',
  documents: [],
  draft: {},
  field_states: {},
  flow_version: 3,
  confirmed_stages: [],
  next_stage: null,
  completed_steps: ['intent_context'],
  current_step: 'teacher_experience',
  confirmation: null,
  revision_no: 2,
  package_id: null,
  skill_id: null,
  skill_version_id: null,
  error: null,
  deleted_at: null,
  model: null,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  completed_at: null,
} as GuidedCreationSession;

describe('InnoSkill portal integration', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('opens a real repository Skill from the portal home', () => {
    const onOpenSkill = vi.fn();
    act(() =>
      root.render(
        <InnoSkillPortalPages
          view="home"
          skills={[skill]}
          sessions={[draft]}
          search=""
          onSearch={vi.fn()}
          onNew={vi.fn()}
          onOpenSquare={vi.fn()}
          onOpenMySkills={vi.fn()}
          onOpenSkill={onOpenSkill}
          onOpenVersions={vi.fn()}
          onOpenDraft={vi.fn()}
          onOpenPipeline={vi.fn()}
          onOpenReview={vi.fn()}
        />,
      ),
    );

    act(() =>
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent?.includes('打开使用'))!
        .click(),
    );

    expect(onOpenSkill).toHaveBeenCalledWith(skill);
    expect(container.textContent).toContain('分层教学助手');
  });

  it('keeps prototype navigation connected to real drafts and Skills', () => {
    const onNavigate = vi.fn();
    const onSelectDraft = vi.fn();
    const onSelectSkill = vi.fn();
    act(() =>
      root.render(
        <InnoSkillSidebar
          sessions={[draft]}
          selectedSessionId={null}
          selectedCreateMode="conversation"
          activeSection="home"
          collapsed={false}
          userName="teacher"
          isAdmin={false}
          skills={[skill]}
          activeSkillKey={null}
          onToggle={vi.fn()}
          onNavigate={onNavigate}
          onCreateMode={vi.fn()}
          onSelectDraft={onSelectDraft}
          onRenameDraft={async () => undefined}
          onDeleteDraft={async () => undefined}
          onSelectSkill={onSelectSkill}
          onSkillAction={vi.fn()}
          onAdmin={vi.fn()}
          onLogout={vi.fn()}
        />,
      ),
    );

    const buttons = [...container.querySelectorAll('button')];
    act(() =>
      buttons.find((button) => button.textContent === '工作台')!.click(),
    );
    act(() =>
      buttons
        .find((button) => button.textContent?.includes('课堂活动设计'))!
        .click(),
    );
    act(() =>
      buttons.find((button) => button.textContent === '分层教学助手')!.click(),
    );

    expect(onNavigate).toHaveBeenCalledWith('workbench');
    expect(onSelectDraft).toHaveBeenCalledWith(draft);
    expect(onSelectSkill).toHaveBeenCalledWith(skill);
  });
});
