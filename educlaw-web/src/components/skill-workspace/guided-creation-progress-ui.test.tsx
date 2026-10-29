// @vitest-environment jsdom

import { act } from 'react';
import type {
  GuidedCreationSessionDetail,
  GuidedDraftField,
  GuidedEducationDraft,
  GuidedFieldState,
} from '@educlaw/shared';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GuidedSkillCreationPanel } from './GuidedSkillCreationPanel';
import { SkillInspectorContent } from './SkillInspectorContent';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const draftFields: GuidedDraftField[] = [
  'roles',
  'goal',
  'usage_scenario',
  'input_contract',
  'output_contract',
  'core_capabilities',
  'workflow',
  'knowledge_evidence',
  'boundaries_permissions',
  'exception_recovery',
  'completion_evidence',
];

function fieldStates(
  overrides: Partial<Record<GuidedDraftField, GuidedFieldState>> = {},
) {
  return Object.fromEntries(
    draftFields.map((field) => [field, overrides[field] ?? 'missing']),
  ) as Record<GuidedDraftField, GuidedFieldState>;
}

function session(
  overrides: Partial<GuidedCreationSessionDetail> = {},
): GuidedCreationSessionDetail {
  return {
    id: 'guided-session',
    display_name: '课堂教学设计',
    deleted_at: null,
    status: 'collecting',
    model: null,
    documents: [],
    draft: {},
    field_states: fieldStates(),
    flow_version: 3,
    confirmed_stages: [],
    next_stage: null,
    completed_steps: [],
    current_step: 'intent_context',
    confirmation: null,
    revision_no: 1,
    package_id: null,
    skill_id: null,
    skill_version_id: null,
    error: null,
    created_at: '2026-10-29T08:00:00.000Z',
    updated_at: '2026-10-29T08:00:00.000Z',
    completed_at: null,
    messages: [],
    ...overrides,
  };
}

function educationSection(
  content: string,
  source:
    | 'user_explicit'
    | 'user_adopted'
    | 'inferred'
    | 'platform_default'
    | 'conflicted',
) {
  return { content, evidence: [{ source }] };
}

const inferredEducationDraft: GuidedEducationDraft = {
  educational_goal: educationSection('理解课文主旨', 'inferred'),
  audience_context: educationSection('七年级语文课堂', 'inferred'),
  input_evidence: educationSection('教材与学情信息', 'inferred'),
  teaching_strategy: educationSection('通过问题引导讨论', 'inferred'),
  action_adaptation: educationSection('根据学生回答调整追问', 'inferred'),
  boundaries_responsibility: educationSection('关键判断由教师确认', 'inferred'),
  completion_evidence: educationSection('学生可以概括主旨', 'inferred'),
};

function panelProps(currentSession: GuidedCreationSessionDetail) {
  return {
    session: currentSession,
    pendingMessage: null,
    documents: [],
    busy: false,
    phase: null,
    previews: [],
    error: null,
    onSend: vi.fn(),
    onConfirm: vi.fn(),
    onSummarize: vi.fn(),
    onRetry: vi.fn(),
    onFiles: vi.fn(),
    onRemoveDocument: vi.fn(),
  };
}

function inspectorProps(currentSession: GuidedCreationSessionDetail) {
  return {
    descriptor: { owner: 'guided', view: 'summary', title: '需求摘要' } as const,
    session: currentSession,
    activeView: 'create' as const,
    versions: [],
    currentVersionId: null,
    onOpenVersionManager: vi.fn(),
    token: 'test-token',
    answerOptimization: null,
    onAnswerOptimizationSaved: vi.fn(),
    onAnswerOptimizationRerun: vi.fn(),
  };
}

describe('guided creation progress UI', () => {
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

  it('keeps inferred first-turn content at 0/5 in both progress surfaces', async () => {
    const currentSession = session({ education_draft: inferredEducationDraft });

    await act(async () => {
      root.render(
        <>
          <GuidedSkillCreationPanel {...panelProps(currentSession)} />
          <SkillInspectorContent {...inspectorProps(currentSession)} />
        </>,
      );
    });

    const conversationProgress = container.querySelector('[aria-label="共创进度"]');
    const requirementProgress = container.querySelector('.skill-context-progress');

    expect(conversationProgress?.textContent).toContain('已完成 0/5');
    expect(conversationProgress?.textContent).toContain('当前环节：目标与对象');
    expect(requirementProgress?.textContent).toContain('需求完整度');
    expect(requirementProgress?.textContent).toContain('已完成 0/5');

    for (const step of [
      '目标与对象',
      '经验与依据',
      '教学策略',
      '行动与边界',
      '效果与证据',
    ]) {
      expect(container.textContent).toContain(step);
    }
    for (const dimension of [
      '教育目标',
      '对象与情境',
      '输入与依据',
      '教育策略',
      '行动与调整',
      '边界与责任',
      '完成与证据',
    ]) {
      expect(container.textContent).toContain(dimension);
    }
    expect(
      [...container.querySelectorAll('*')].filter(
        (element) => element.textContent === 'AI 已整理，待确认',
      ),
    ).toHaveLength(7);
  });

  it('shows dimension confirmation states without inflating the five-step total', async () => {
    const currentSession = session({
      education_draft: {
        educational_goal: educationSection('理解课文主旨', 'user_explicit'),
        audience_context: educationSection('七年级语文课堂', 'conflicted'),
        input_evidence: educationSection('教材与学情信息', 'platform_default'),
      },
      completed_steps: ['intent_context'],
    });

    await act(async () => {
      root.render(<SkillInspectorContent {...inspectorProps(currentSession)} />);
    });

    expect(container.querySelector('.skill-context-progress')?.textContent).toContain(
      '已完成 0/5',
    );
    expect(container.textContent).toContain('已确认');
    expect(container.textContent).toContain('需要澄清');
    expect(container.textContent).toContain('AI 已整理，待确认');
    expect(container.textContent).toContain('等待补充');
  });

  it('submits a suggested confirmation instead of only filling the composer', async () => {
    const onSend = vi.fn();
    const currentSession = session({
      messages: [
        {
          id: 'assistant-1',
          session_id: 'guided-session',
          message_no: 1,
          client_message_id: null,
          role: 'assistant',
          content: '目标和对象这样理解准确吗？',
          metadata: { suggested_options: ['准确，继续', '我想补充'] },
          created_at: '2026-10-29T08:00:00.000Z',
        },
      ],
    });
    const props = panelProps(currentSession);
    props.onSend = onSend;

    await act(async () => {
      root.render(<GuidedSkillCreationPanel {...props} />);
    });

    const option = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '准确，继续',
    );
    expect(option).toBeTruthy();
    await act(async () => {
      option?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onSend).toHaveBeenCalledWith('准确，继续');
  });

  it('keeps the legacy V1 inspector and V2 conversation progress contracts', async () => {
    const v1Session = session({
      flow_version: 1,
      current_step: undefined,
      completed_steps: undefined,
      draft: { goal: '组织一节函数概念课' },
      field_states: fieldStates({ goal: 'explicit' }),
    });

    await act(async () => {
      root.render(<SkillInspectorContent {...inspectorProps(v1Session)} />);
    });
    expect(container.querySelector('.skill-context-progress')?.textContent).toContain(
      '1/11',
    );

    const v2Session = session({
      flow_version: 2,
      current_step: undefined,
      completed_steps: undefined,
      confirmed_stages: ['positioning', 'scenario_input'],
      next_stage: 'expected_result',
    });
    await act(async () => {
      root.render(<GuidedSkillCreationPanel {...panelProps(v2Session)} />);
    });
    expect(container.querySelector('[aria-label="共创进度"]')?.textContent).toContain(
      '已完成 2/6',
    );
    expect(container.querySelector('[aria-label="共创进度"]')?.textContent).toContain(
      '当前：说清理想结果',
    );
  });
});
