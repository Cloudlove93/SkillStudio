import type {
  GuidedConfirmationCard,
  GuidedCreationStep,
  GuidedEducationDimension,
  GuidedEducationDraft,
  GuidedEducationDraftOp,
  GuidedEducationEvidenceSource,
} from '@educlaw/shared';

export const GUIDED_EDUCATION_DIMENSIONS = [
  'educational_goal',
  'audience_context',
  'input_evidence',
  'teaching_strategy',
  'action_adaptation',
  'boundaries_responsibility',
  'completion_evidence',
] as const satisfies readonly GuidedEducationDimension[];

export const GUIDED_CREATION_STEPS = [
  'intent_context',
  'teacher_experience',
  'strategy_co_creation',
  'action_adjustment',
  'evidence_review',
] as const satisfies readonly GuidedCreationStep[];

export const GUIDED_EDUCATION_LABELS: Record<GuidedEducationDimension, string> = {
  educational_goal: '教育目标',
  audience_context: '对象与情境',
  input_evidence: '输入与依据',
  teaching_strategy: '教育策略',
  action_adaptation: '行动与调整',
  boundaries_responsibility: '边界与责任',
  completion_evidence: '完成与证据',
};

const DIMENSION_SET = new Set<string>(GUIDED_EDUCATION_DIMENSIONS);
const USER_OWNED_SOURCES = new Set<GuidedEducationEvidenceSource>([
  'user_explicit',
  'user_adopted',
]);
const EDUCATION_OP_SET = new Set<GuidedEducationDraftOp>([
  'set',
  'replace',
  'remove',
]);
// Every education dimension must be expressed or explicitly adopted by the
// teacher. Technical completeness alone must never trigger generation.
const CRITICAL_USER_DIMENSIONS = GUIDED_EDUCATION_DIMENSIONS;
const DIMENSION_TO_STEP: Record<GuidedEducationDimension, GuidedCreationStep> = {
  educational_goal: 'intent_context',
  audience_context: 'intent_context',
  input_evidence: 'teacher_experience',
  teaching_strategy: 'strategy_co_creation',
  action_adaptation: 'action_adjustment',
  boundaries_responsibility: 'action_adjustment',
  completion_evidence: 'evidence_review',
};

export interface EducationDraftOperation {
  dimension: GuidedEducationDimension;
  op?: GuidedEducationDraftOp;
  content: string;
  source: GuidedEducationEvidenceSource;
  quote?: string;
  experience_id?: string;
}

export interface GuidedEducationEvaluation {
  normalized_draft: GuidedEducationDraft;
  completed_steps: GuidedCreationStep[];
  current_step: GuidedCreationStep | null;
  missing_dimensions: GuidedEducationDimension[];
  missing_user_decisions: GuidedEducationDimension[];
  conflicted_dimensions: GuidedEducationDimension[];
  ready_for_confirmation: boolean;
}

function normalizeEvidence(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, '');
}

function isQuotedByUser(userMessage: string, quote: string | undefined): boolean {
  if (!quote?.trim()) return false;
  return normalizeEvidence(userMessage).includes(normalizeEvidence(quote));
}

function assertDimension(
  dimension: string,
): asserts dimension is GuidedEducationDimension {
  if (!DIMENSION_SET.has(dimension)) {
    throw new Error('INVALID_EDUCATION_DIMENSION');
  }
}

function hasUserEvidence(
  draft: GuidedEducationDraft,
  dimension: GuidedEducationDimension,
): boolean {
  return Boolean(
    draft[dimension]?.evidence.some((item) => USER_OWNED_SOURCES.has(item.source)),
  );
}

export function sanitizeEducationOperations(
  currentDraft: GuidedEducationDraft,
  operations: readonly EducationDraftOperation[],
  userMessage: string,
): EducationDraftOperation[] {
  const accepted: EducationDraftOperation[] = [];

  for (const operation of operations) {
    assertDimension(operation.dimension);
    const op: GuidedEducationDraftOp =
      operation.op && EDUCATION_OP_SET.has(operation.op)
        ? operation.op
        : 'set';

    // remove 操作由用户主动撤回，不需要 content/source；但不能撤回不存在的维度。
    if (op === 'remove') {
      if (!currentDraft[operation.dimension]?.content) continue;
      accepted.push({ ...operation, op, content: '' });
      continue;
    }

    if (!operation.content?.trim()) continue;

    let source = operation.source;
    if (
      (source === 'user_explicit' || source === 'user_adopted') &&
      !isQuotedByUser(userMessage, operation.quote)
    ) {
      source = 'inferred';
    }

    const existing = currentDraft[operation.dimension];
    // replace 必须由用户主动纠正，降级为 inferred 时不再视为替换，避免后端误覆盖。
    if (
      op === 'replace' &&
      source !== 'user_explicit' &&
      source !== 'user_adopted'
    ) {
      // 推测不能覆盖用户已有内容，跳过该操作。
      if (existing?.evidence.some((item) => USER_OWNED_SOURCES.has(item.source))) {
        continue;
      }
    }
    if (
      source === 'inferred' &&
      existing?.evidence.some((item) => USER_OWNED_SOURCES.has(item.source))
    ) {
      continue;
    }

    accepted.push({
      ...operation,
      op,
      content: operation.content.trim(),
      source,
    });
  }

  return accepted;
}

export function applyEducationOperations(
  currentDraft: GuidedEducationDraft,
  operations: readonly EducationDraftOperation[],
): GuidedEducationDraft {
  const next: GuidedEducationDraft = structuredClone(currentDraft);

  for (const operation of operations) {
    assertDimension(operation.dimension);
    const op: GuidedEducationDraftOp =
      operation.op && EDUCATION_OP_SET.has(operation.op)
        ? operation.op
        : 'set';

    if (op === 'remove') {
      delete next[operation.dimension];
      continue;
    }

    const content = operation.content?.trim();

    // LLM 标记 source=conflicted 且不提供 content 时，只追加冲突证据，
    // 不合并 content，让 evaluate 把该维度纳入 pendingDimension 引导用户澄清。
    if (operation.source === 'conflicted' && !content) {
      const existing = next[operation.dimension];
      if (!existing?.content) continue;
      existing.evidence.push({
        source: 'conflicted',
        ...(operation.quote ? { quote: operation.quote } : {}),
      });
      continue;
    }

    if (!content) throw new Error('INVALID_EDUCATION_CONTENT');

    const existing = next[operation.dimension];

    // replace：用户明确纠正，覆盖 content 并用新 evidence 替换旧 evidence
    // （含清除 conflicted）。这是与 set（追加合并）的关键区别。
    if (op === 'replace') {
      next[operation.dimension] = {
        content,
        evidence: [
          {
            source: operation.source,
            ...(operation.quote ? { quote: operation.quote } : {}),
            ...(operation.experience_id
              ? { experience_id: operation.experience_id }
              : {}),
          },
        ],
      };
      continue;
    }

    const mergedContent = !existing?.content
      ? content
      : existing.content.includes(content)
        ? existing.content
        : content.includes(existing.content)
          ? content
          : `${existing.content}；${content}`;
    // 用户在本轮重新明确表达或采纳后，旧的冲突标记不再阻塞流程，应予清除。
    const priorEvidence =
      operation.source === 'user_explicit' ||
      operation.source === 'user_adopted'
        ? (existing?.evidence ?? []).filter(
            (item) => item.source !== 'conflicted',
          )
        : (existing?.evidence ?? []);
    const evidence = [
      ...priorEvidence,
      {
        source: operation.source,
        ...(operation.quote ? { quote: operation.quote } : {}),
        ...(operation.experience_id
          ? { experience_id: operation.experience_id }
          : {}),
      },
    ];

    next[operation.dimension] = { content: mergedContent, evidence };
  }

  return next;
}

export function nextGuidedCreationStep(
  completedSteps: readonly GuidedCreationStep[],
): GuidedCreationStep | null {
  const completed = new Set(completedSteps);
  return GUIDED_CREATION_STEPS.find((step) => !completed.has(step)) ?? null;
}

export function evaluateEducationFlow(
  draft: GuidedEducationDraft,
  completedSteps: readonly GuidedCreationStep[],
): GuidedEducationEvaluation {
  const normalized_draft: GuidedEducationDraft = {};
  for (const dimension of GUIDED_EDUCATION_DIMENSIONS) {
    const section = draft[dimension];
    if (!section?.content?.trim()) continue;
    normalized_draft[dimension] = {
      content: section.content.trim(),
      evidence: section.evidence ?? [],
    };
  }

  const uniqueCompleted = GUIDED_CREATION_STEPS.filter((step) =>
    completedSteps.includes(step),
  );
  const missing_dimensions = GUIDED_EDUCATION_DIMENSIONS.filter(
    (dimension) => !normalized_draft[dimension]?.content,
  );
  const missing_user_decisions = CRITICAL_USER_DIMENSIONS.filter(
    (dimension) => !hasUserEvidence(normalized_draft, dimension),
  );
  const conflicted_dimensions = GUIDED_EDUCATION_DIMENSIONS.filter((dimension) =>
    normalized_draft[dimension]?.evidence.some(
      (evidence) => evidence.source === 'conflicted',
    ),
  );
  // 冲突维度也需要引导用户澄清，否则会出现「无下一步但无法确认」的死锁。
  const pendingDimension = [
    ...missing_dimensions,
    ...missing_user_decisions,
    ...conflicted_dimensions,
  ][0];
  const nextUncompletedStep = nextGuidedCreationStep(uniqueCompleted);
  const pendingStep = pendingDimension
    ? DIMENSION_TO_STEP[pendingDimension]
    : null;
  const current_step =
    pendingStep &&
    (nextUncompletedStep === null ||
      GUIDED_CREATION_STEPS.indexOf(pendingStep) <
        GUIDED_CREATION_STEPS.indexOf(nextUncompletedStep))
      ? pendingStep
      : nextUncompletedStep;

  return {
    normalized_draft,
    completed_steps: uniqueCompleted,
    current_step,
    missing_dimensions,
    missing_user_decisions,
    conflicted_dimensions,
    ready_for_confirmation:
      current_step === null &&
      missing_dimensions.length === 0 &&
      missing_user_decisions.length === 0 &&
      conflicted_dimensions.length === 0,
  };
}

export function buildEducationConfirmationCard(
  draft: GuidedEducationDraft,
): GuidedConfirmationCard {
  return {
    title: '请确认这个 Skill',
    sections: GUIDED_EDUCATION_DIMENSIONS.map((dimension) => ({
      key: dimension,
      title: GUIDED_EDUCATION_LABELS[dimension],
      content: draft[dimension]?.content?.trim() || '待确认',
    })),
  };
}

export function educationDraftToGenerationBrief(
  draft: GuidedEducationDraft,
): string {
  const value = (dimension: GuidedEducationDimension) =>
    draft[dimension]?.content?.trim() || '未明确';

  return [
    `教育目标：${value('educational_goal')}`,
    `对象与真实情境：${value('audience_context')}`,
    `输入材料与判断依据：${value('input_evidence')}`,
    `教育策略：${value('teaching_strategy')}`,
    `观察与调整规则：${value('action_adaptation')}`,
    `边界、责任与教师确认节点：${value('boundaries_responsibility')}`,
    `完成标准与教育有效性证据：${value('completion_evidence')}`,
  ].join('\n');
}
