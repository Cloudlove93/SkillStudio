import type {
  GuidedConfirmationCard,
  GuidedCreationStage,
  GuidedDraftField,
  GuidedFieldState,
  GuidedSkillDraft,
} from '@educlaw/shared';

export const GUIDED_DRAFT_FIELDS = [
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
] as const satisfies readonly GuidedDraftField[];

export const GUIDED_REQUIRED_FIELDS = [
  'roles',
  'goal',
  'usage_scenario',
  'input_contract',
  'output_contract',
  'core_capabilities',
  'workflow',
] as const satisfies readonly GuidedDraftField[];

export const GUIDED_STAGES = [
  {
    key: 'positioning',
    fields: ['roles', 'goal'],
  },
  {
    key: 'scenario_input',
    fields: ['usage_scenario', 'input_contract'],
  },
  {
    key: 'expected_result',
    fields: ['output_contract'],
  },
  {
    key: 'working_method',
    fields: ['core_capabilities', 'workflow'],
  },
  {
    key: 'evidence_scope',
    fields: ['knowledge_evidence'],
  },
  {
    key: 'boundaries_completion',
    fields: [
      'boundaries_permissions',
      'exception_recovery',
      'completion_evidence',
    ],
  },
] as const satisfies readonly {
  key: GuidedCreationStage;
  fields: readonly GuidedDraftField[];
}[];

export const GUIDED_STAGE_KEYS = GUIDED_STAGES.map((stage) => stage.key);

const FIELD_SET = new Set<string>(GUIDED_DRAFT_FIELDS);
const REQUIRED_FIELD_SET = new Set<GuidedDraftField>(GUIDED_REQUIRED_FIELDS);

const SAFE_DEFAULTS: Partial<Record<GuidedDraftField, string>> = {
  knowledge_evidence: '以用户提供的材料和当前对话中的明确信息为依据。',
  boundaries_permissions: '不编造事实，不执行超出用户授权范围的操作。',
  exception_recovery: '信息不足时说明缺口并请求补充；处理失败时保留已完成内容并给出重试建议。',
  completion_evidence: '输出符合约定格式，关键步骤和结果可检查。',
};

export const GUIDED_FIELD_LABELS: Record<GuidedDraftField, string> = {
  roles: '使用者与角色',
  goal: '核心目标',
  usage_scenario: '使用场景',
  input_contract: '需要的输入',
  output_contract: '期望的输出',
  core_capabilities: '核心能力',
  workflow: '处理流程',
  knowledge_evidence: '知识与材料',
  boundaries_permissions: '边界与权限',
  exception_recovery: '异常处理',
  completion_evidence: '完成标准',
};

export interface DraftOperation {
  op: 'set' | 'replace' | 'remove';
  path: string;
  value?: unknown;
  state?: Extract<GuidedFieldState, 'explicit' | 'inferred' | 'conflicted'>;
  evidence?: string;
}

export interface DraftEvaluation {
  normalized_draft: GuidedSkillDraft;
  field_states: Record<GuidedDraftField, GuidedFieldState>;
  next_blocking_field: GuidedDraftField | null;
  ready_for_confirmation: boolean;
}

export interface GuidedFlowEvaluation extends DraftEvaluation {
  confirmed_stages: GuidedCreationStage[];
  next_stage: GuidedCreationStage | null;
}

function assertDraftField(path: string): asserts path is GuidedDraftField {
  if (!FIELD_SET.has(path)) {
    throw new Error('INVALID_DRAFT_PATH');
  }
}

function normalizeEvidence(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, '');
}

export function validateExplicitEvidence(
  userMessage: string,
  evidence: string | undefined,
): boolean {
  if (!evidence?.trim()) return false;
  const normalizedMessage = normalizeEvidence(userMessage);
  const normalizedEvidence = normalizeEvidence(evidence);
  return Boolean(
    normalizedEvidence && normalizedMessage.includes(normalizedEvidence),
  );
}

export function sanitizeDraftOperations(
  currentDraft: GuidedSkillDraft,
  currentStates: Partial<Record<GuidedDraftField, GuidedFieldState>>,
  operations: readonly DraftOperation[],
  userMessage: string,
): DraftOperation[] {
  const accepted: DraftOperation[] = [];
  for (const operation of operations) {
    assertDraftField(operation.path);
    if (operation.op === 'remove') {
      accepted.push(operation);
      continue;
    }

    let state = operation.state ?? 'inferred';
    if (
      state === 'explicit' &&
      !validateExplicitEvidence(userMessage, operation.evidence)
    ) {
      state = 'inferred';
    }
    if (
      state === 'inferred' &&
      currentStates[operation.path] === 'explicit' &&
      currentDraft[operation.path]
    ) {
      continue;
    }
    let value = operation.value;
    const currentValue = currentDraft[operation.path];
    if (
      state === 'explicit' &&
      operation.op === 'set' &&
      currentStates[operation.path] === 'explicit' &&
      typeof currentValue === 'string' &&
      currentValue.trim() &&
      typeof value === 'string' &&
      value.trim()
    ) {
      const existing = currentValue.trim();
      const incoming = value.trim();
      if (existing.includes(incoming)) {
        value = existing;
      } else if (!incoming.includes(existing)) {
        value = `${existing}；${incoming}`;
      }
    }
    accepted.push({ ...operation, value, state });
  }
  return accepted;
}

export function nextGuidedStage(
  confirmedStages: readonly GuidedCreationStage[],
): GuidedCreationStage | null {
  const confirmed = new Set(confirmedStages);
  return GUIDED_STAGE_KEYS.find((stage) => !confirmed.has(stage)) ?? null;
}

export function applyDraftOperations(
  current: GuidedSkillDraft,
  operations: readonly DraftOperation[],
): GuidedSkillDraft {
  const next: GuidedSkillDraft = { ...current };

  for (const operation of operations) {
    assertDraftField(operation.path);
    if (operation.op === 'remove') {
      delete next[operation.path];
      continue;
    }
    if (operation.op !== 'set' && operation.op !== 'replace') {
      throw new Error('INVALID_DRAFT_OPERATION');
    }
    if (typeof operation.value !== 'string' || !operation.value.trim()) {
      throw new Error('INVALID_DRAFT_VALUE');
    }
    next[operation.path] = operation.value.trim();
  }

  return next;
}

export function applyFieldStateOperations(
  current: Partial<Record<GuidedDraftField, GuidedFieldState>>,
  operations: readonly DraftOperation[],
): Partial<Record<GuidedDraftField, GuidedFieldState>> {
  const next = { ...current };
  for (const operation of operations) {
    assertDraftField(operation.path);
    if (operation.op === 'remove') {
      delete next[operation.path];
      continue;
    }
    next[operation.path] = operation.state ?? 'inferred';
  }
  return next;
}

export function evaluateDraft(
  draft: GuidedSkillDraft,
  knownStates: Partial<Record<GuidedDraftField, GuidedFieldState>> = {},
): DraftEvaluation {
  const normalized_draft: GuidedSkillDraft = {};
  const field_states = {} as Record<GuidedDraftField, GuidedFieldState>;

  for (const field of GUIDED_DRAFT_FIELDS) {
    const value = draft[field]?.trim();
    const knownState = knownStates[field];
    if (value) {
      normalized_draft[field] = value;
      field_states[field] = knownState ?? 'inferred';
      continue;
    }

    const defaultValue = SAFE_DEFAULTS[field];
    if (!REQUIRED_FIELD_SET.has(field) && defaultValue) {
      normalized_draft[field] = defaultValue;
      field_states[field] = 'defaulted';
      continue;
    }
    field_states[field] = 'missing';
  }

  for (const field of GUIDED_DRAFT_FIELDS) {
    if (knownStates[field] === 'conflicted') {
      field_states[field] = 'conflicted';
    }
  }

  const next_blocking_field =
    GUIDED_REQUIRED_FIELDS.find(
      (field) =>
        field_states[field] === 'missing' ||
        field_states[field] === 'conflicted',
    ) ?? null;

  return {
    normalized_draft,
    field_states,
    next_blocking_field,
    ready_for_confirmation: next_blocking_field === null,
  };
}

export function evaluateGuidedFlow(
  draft: GuidedSkillDraft,
  knownStates: Partial<Record<GuidedDraftField, GuidedFieldState>>,
  confirmedStages: readonly GuidedCreationStage[],
): GuidedFlowEvaluation {
  const evaluation = evaluateDraft(draft, knownStates);
  const confirmed = GUIDED_STAGE_KEYS.filter((stage) =>
    confirmedStages.includes(stage),
  );
  const next_stage = nextGuidedStage(confirmed);
  return {
    ...evaluation,
    confirmed_stages: confirmed,
    next_stage,
    ready_for_confirmation:
      next_stage === null && evaluation.ready_for_confirmation,
  };
}

function pair(label: string, value: string | undefined): string {
  return `${label}：${value ?? '未填写'}`;
}

export function buildConfirmationCard(
  draft: GuidedSkillDraft,
): GuidedConfirmationCard {
  return {
    title: '请确认这个 Skill',
    sections: [
      {
        key: 'positioning',
        title: '定位与目标',
        content: [pair('角色', draft.roles), pair('目标', draft.goal)].join('\n'),
      },
      {
        key: 'scenario',
        title: '使用场景',
        content: draft.usage_scenario ?? '未填写',
      },
      {
        key: 'input_output',
        title: '输入与输出',
        content: [
          pair('输入', draft.input_contract),
          pair('输出', draft.output_contract),
        ].join('\n'),
      },
      {
        key: 'capability_flow',
        title: '能力与流程',
        content: [
          pair('能力', draft.core_capabilities),
          pair('流程', draft.workflow),
        ].join('\n'),
      },
      {
        key: 'knowledge_boundary',
        title: '依据与边界',
        content: [
          pair('依据', draft.knowledge_evidence),
          pair('边界', draft.boundaries_permissions),
        ].join('\n'),
      },
      {
        key: 'recovery_completion',
        title: '异常与完成标准',
        content: [
          pair('异常处理', draft.exception_recovery),
          pair('完成标准', draft.completion_evidence),
        ].join('\n'),
      },
    ],
  };
}
