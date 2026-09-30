import type {
  AgentPackageSnapshot,
  GuidedConfirmationCard,
  GuidedCreationDocument,
  GuidedCreationMessage,
  GuidedCreationSession,
  GuidedCreationSessionDetail,
  GuidedCreationStep,
  GuidedCreationStage,
  GuidedCreationStatus,
  GuidedDraftField,
  GuidedFieldState,
  GuidedEducationDimension,
  GuidedEducationDraft,
  GuidedEducationDraftOp,
  GuidedEducationEvidenceSource,
  GuidedSkillDraft,
} from '@educlaw/shared';
import { query, withTransaction } from './db.js';
import { generateJson } from './llm-service.js';
import {
  buildGeneratedPackageSnapshot,
  createPackageWithSnapshotTx,
} from './package-service.js';
import {
  applyDraftOperations,
  applyFieldStateOperations,
  buildConfirmationCard,
  evaluateDraft,
  evaluateGuidedFlow,
  GUIDED_DRAFT_FIELDS,
  GUIDED_FIELD_LABELS,
  GUIDED_STAGE_KEYS,
  GUIDED_STAGES,
  nextGuidedStage,
  sanitizeDraftOperations,
  type DraftOperation,
} from './guided-creation-policy.js';
import {
  applyEducationOperations,
  buildEducationConfirmationCard,
  educationDraftToGenerationBrief,
  evaluateEducationFlow,
  GUIDED_CREATION_STEPS,
  GUIDED_EDUCATION_DIMENSIONS,
  GUIDED_EDUCATION_LABELS,
  sanitizeEducationOperations,
  type EducationDraftOperation,
} from './guided-education-policy.js';
import {
  GUIDED_SKILL_CONVERSION_RULES,
  matchTeachingExperiences,
} from './guided-experience-library.js';

export interface GuidedExtractionResult {
  operations: DraftOperation[];
  stage_complete: boolean;
  acknowledgement: string;
}

export interface GuidedEducationExtractionResult {
  operations: EducationDraftOperation[];
  step_complete: boolean;
  acknowledgement: string;
  question?: string;
  suggested_options?: string[];
}

export interface GuidedQuestionPhrasing {
  field?: string;
  stage?: string;
  step?: string;
  mode?: 'collect_field' | 'confirm_stage';
  question: string;
  suggested_options: string[];
}

export interface GuidedAssistantTurn {
  draft: GuidedSkillDraft;
  field_states: Record<GuidedDraftField, GuidedFieldState>;
  status: Extract<
    GuidedCreationStatus,
    'collecting' | 'ready_for_confirmation'
  >;
  next_blocking_field: GuidedDraftField | null;
  acknowledgement: string;
  content: string;
  suggested_options: string[];
  confirmation: GuidedConfirmationCard | null;
  confirmed_stages: GuidedCreationStage[];
  next_stage: GuidedCreationStage | null;
  focus_stage: GuidedCreationStage | null;
  education_draft?: GuidedEducationDraft;
  completed_steps?: GuidedCreationStep[];
  current_step?: GuidedCreationStep | null;
  focus_step?: GuidedCreationStep | null;
}

const DRAFT_FIELD_SET = new Set<string>(GUIDED_DRAFT_FIELDS);
const OPERATION_SET = new Set(['set', 'replace', 'remove']);
const EXTRACTION_STATE_SET = new Set(['explicit', 'inferred', 'conflicted']);
const GUIDED_STAGE_SET = new Set<string>(GUIDED_STAGE_KEYS);
const GUIDED_EDUCATION_DIMENSION_SET = new Set<string>(
  GUIDED_EDUCATION_DIMENSIONS,
);
const GUIDED_EDUCATION_SOURCE_SET = new Set<string>([
  'user_explicit',
  'user_adopted',
  'inferred',
  'platform_default',
  'conflicted',
]);
const GUIDED_EDUCATION_OP_SET = new Set<string>(['set', 'replace', 'remove']);
const GUIDED_CREATION_STEP_SET = new Set<string>(GUIDED_CREATION_STEPS);

const FALLBACK_QUESTIONS: Record<GuidedDraftField, string> = {
  roles: '这个 Skill 主要给谁使用，并希望它扮演什么角色？',
  goal: '你最希望这个 Skill 帮你完成什么目标？',
  usage_scenario: '通常会在什么教学场景中使用它？',
  input_contract: '使用时，你会提供哪些信息或材料？',
  output_contract: '你希望它最终输出什么内容和格式？',
  core_capabilities: '它必须具备哪些核心能力？',
  workflow: '你希望它按照怎样的步骤完成任务？',
  knowledge_evidence: '它应优先依据哪些材料或知识？',
  boundaries_permissions: '有哪些明确不能做的事情或权限边界？',
  exception_recovery: '信息不足或处理失败时，希望它如何处理？',
  completion_evidence: '满足什么条件时可以认为任务已经完成？',
};

const FALLBACK_OPTIONS: Partial<Record<GuidedDraftField, string[]>> = {
  roles: ['教师', '教研员', '学生'],
  goal: ['生成教学内容', '分析学习表现', '提供教学建议'],
  usage_scenario: ['课前备课', '课堂教学', '课后复盘'],
  input_contract: ['教学目标和教材', '课堂记录', '学生作业或数据'],
  output_contract: ['结构化方案', '分析报告', '可直接使用的文本'],
  core_capabilities: ['提炼关键信息', '生成内容', '检查质量'],
  workflow: ['分析输入后生成', '分步骤与用户确认', '生成后自动检查'],
};

const STAGE_CONFIRMATION_OPTIONS = ['准确，继续', '我想补充', '需要调整'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanAcknowledgement(value: string): string {
  const cleaned = value.replace(/[？?]+/g, '。').replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, 200) || '明白了。';
}

export function parseExtractionResult(value: unknown): GuidedExtractionResult {
  if (!isRecord(value) || !Array.isArray(value.operations)) {
    throw new Error('INVALID_MODEL_EXTRACTION');
  }
  if (
    typeof value.acknowledgement !== 'string' ||
    !value.acknowledgement.trim() ||
    value.operations.length > GUIDED_DRAFT_FIELDS.length * 2
  ) {
    throw new Error('INVALID_MODEL_EXTRACTION');
  }

  const operations: DraftOperation[] = value.operations.map((operation) => {
    if (
      !isRecord(operation) ||
      typeof operation.op !== 'string' ||
      !OPERATION_SET.has(operation.op) ||
      typeof operation.path !== 'string' ||
      !DRAFT_FIELD_SET.has(operation.path)
    ) {
      throw new Error('INVALID_MODEL_EXTRACTION');
    }
    if (operation.op !== 'remove') {
      if (typeof operation.value !== 'string' || !operation.value.trim()) {
        throw new Error('INVALID_MODEL_EXTRACTION');
      }
    }
    if (
      operation.state !== undefined &&
      (typeof operation.state !== 'string' ||
        !EXTRACTION_STATE_SET.has(operation.state))
    ) {
      throw new Error('INVALID_MODEL_EXTRACTION');
    }
    return {
      op: operation.op as DraftOperation['op'],
      path: operation.path,
      value: operation.value,
      state: operation.state as DraftOperation['state'],
      evidence:
        typeof operation.evidence === 'string'
          ? operation.evidence.trim().slice(0, 500)
          : undefined,
    };
  });

  return {
    operations,
    stage_complete: value.stage_complete === true,
    acknowledgement: cleanAcknowledgement(value.acknowledgement),
  };
}

export function parseEducationExtractionResult(
  value: unknown,
): GuidedEducationExtractionResult {
  if (!isRecord(value) || !Array.isArray(value.operations)) {
    throw new Error('INVALID_EDUCATION_EXTRACTION');
  }
  if (
    typeof value.acknowledgement !== 'string' ||
    !value.acknowledgement.trim() ||
    value.operations.length > GUIDED_EDUCATION_DIMENSIONS.length * 2
  ) {
    throw new Error('INVALID_EDUCATION_EXTRACTION');
  }

  const operations = value.operations.map((operation) => {
    if (
      !isRecord(operation) ||
      typeof operation.dimension !== 'string' ||
      !GUIDED_EDUCATION_DIMENSION_SET.has(operation.dimension) ||
      typeof operation.source !== 'string' ||
      !GUIDED_EDUCATION_SOURCE_SET.has(operation.source)
    ) {
      throw new Error('INVALID_EDUCATION_EXTRACTION');
    }
    const op =
      typeof operation.op === 'string' &&
      GUIDED_EDUCATION_OP_SET.has(operation.op)
        ? (operation.op as GuidedEducationDraftOp)
        : undefined;
    // remove 不要求 content；其他 op 必须有非空 content。
    if (op !== 'remove') {
      if (
        typeof operation.content !== 'string' ||
        !operation.content.trim()
      ) {
        throw new Error('INVALID_EDUCATION_EXTRACTION');
      }
    }
    return {
      dimension: operation.dimension as GuidedEducationDimension,
      op,
      content:
        typeof operation.content === 'string'
          ? operation.content.trim().slice(0, MAX_MESSAGE_CHARS)
          : '',
      source: operation.source as GuidedEducationEvidenceSource,
      quote:
        typeof operation.quote === 'string'
          ? operation.quote.trim().slice(0, 500)
          : undefined,
      experience_id:
        typeof operation.experience_id === 'string'
          ? operation.experience_id.trim().slice(0, 120)
          : undefined,
    };
  });

  return {
    operations,
    step_complete: value.step_complete === true,
    acknowledgement: cleanAcknowledgement(value.acknowledgement),
    question:
      typeof value.question === 'string' ? value.question.trim() : undefined,
    suggested_options: Array.isArray(value.suggested_options)
      ? value.suggested_options
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 4)
      : undefined,
  };
}

function parsePhrasing(
  phrasing: GuidedQuestionPhrasing | null,
  field: GuidedDraftField,
): { question: string; suggested_options: string[] } {
  const fallbackQuestion = FALLBACK_QUESTIONS[field];
  const candidate = phrasing?.question?.replace(/\s+/g, ' ').trim() ?? '';
  const questionMarks = candidate.match(/[？?]/g)?.length ?? 0;
  const usesExpectedField = !phrasing?.field || phrasing.field === field;
  const question =
    usesExpectedField && questionMarks === 1 && candidate.length <= 120
      ? candidate.replace(/\?$/, '？')
      : fallbackQuestion;

  const candidateOptions = Array.isArray(phrasing?.suggested_options)
    ? phrasing.suggested_options
        .filter((option): option is string => typeof option === 'string')
        .map((option) => option.trim())
        .filter(Boolean)
        .slice(0, 4)
    : [];
  const suggested_options =
    candidateOptions.length >= 2
      ? candidateOptions
      : (FALLBACK_OPTIONS[field] ?? []).slice(0, 4);

  return { question, suggested_options };
}

export function buildGuidedAssistantTurn(input: {
  current_draft: GuidedSkillDraft;
  current_field_states: Partial<Record<GuidedDraftField, GuidedFieldState>>;
  extraction: GuidedExtractionResult;
  phrasing: GuidedQuestionPhrasing | null;
}): GuidedAssistantTurn {
  const draft = applyDraftOperations(
    input.current_draft,
    input.extraction.operations,
  );
  const stateOverrides = applyFieldStateOperations(
    input.current_field_states,
    input.extraction.operations,
  );
  const evaluation = evaluateDraft(draft, stateOverrides);
  const acknowledgement = cleanAcknowledgement(input.extraction.acknowledgement);

  if (evaluation.ready_for_confirmation) {
    return {
      draft: evaluation.normalized_draft,
      field_states: evaluation.field_states,
      status: 'ready_for_confirmation',
      next_blocking_field: null,
      acknowledgement,
      content: `${acknowledgement}\n\n信息已经完整，请检查确认内容。确认后我会生成这个 Skill。`,
      suggested_options: [],
      confirmation: buildConfirmationCard(evaluation.normalized_draft),
      confirmed_stages: [],
      next_stage: null,
      focus_stage: null,
    };
  }

  const nextField = evaluation.next_blocking_field!;
  const { question, suggested_options } = parsePhrasing(
    input.phrasing,
    nextField,
  );
  return {
    draft: evaluation.normalized_draft,
    field_states: evaluation.field_states,
    status: 'collecting',
    next_blocking_field: nextField,
    acknowledgement,
    content: `${acknowledgement}\n\n${question}`,
    suggested_options,
    confirmation: null,
    confirmed_stages: [],
    next_stage: null,
    focus_stage: null,
  };
}

function parseStagePhrasing(
  phrasing: GuidedQuestionPhrasing | null,
  stage: GuidedCreationStage,
  field: GuidedDraftField | null,
  draft: GuidedSkillDraft,
): { question: string; suggested_options: string[] } {
  const candidate = phrasing?.question?.replace(/\s+/g, ' ').trim() ?? '';
  const firstQuestion = candidate.match(/^.*?[？?]/)?.[0]?.trim() ?? '';
  const usesExpectedStage = !phrasing?.stage || phrasing.stage === stage;
  const expectedMode = field ? 'collect_field' : 'confirm_stage';
  const usesExpectedMode = phrasing?.mode
    ? phrasing.mode === expectedMode
    : field !== null;
  const usesExpectedField = field
    ? phrasing?.field === field
    : !phrasing?.field;
  const candidateIsUsable =
    usesExpectedStage &&
    usesExpectedMode &&
    usesExpectedField &&
    firstQuestion.length <= 160;
  const confirmationSummary = GUIDED_STAGES.find(
    (candidateStage) => candidateStage.key === stage,
  )!
    .fields.map((stageField) => {
      const value = draft[stageField]?.trim();
      if (!value) return null;
      const conciseValue = value.length > 48 ? `${value.slice(0, 48)}…` : value;
      return `${GUIDED_FIELD_LABELS[stageField]}为“${conciseValue}”`;
    })
    .filter((value): value is string => Boolean(value))
    .join('，');
  const fallbackQuestion = field
    ? FALLBACK_QUESTIONS[field]
    : `我已经记下${confirmationSummary ? `：${confirmationSummary}` : '这些信息'}。这个理解准确吗？`;
  const question =
    candidateIsUsable
      ? firstQuestion.replace(/\?$/, '？')
      : fallbackQuestion;
  const candidateOptions = Array.isArray(phrasing?.suggested_options)
    ? phrasing.suggested_options
        .filter((option): option is string => typeof option === 'string')
        .map((option) => option.trim())
        .filter(Boolean)
        .slice(0, 4)
    : [];
  return {
    question,
    suggested_options:
      candidateIsUsable && candidateOptions.length >= 2
        ? candidateOptions
        : field
          ? (FALLBACK_OPTIONS[field] ?? []).slice(0, 4)
          : STAGE_CONFIRMATION_OPTIONS,
  };
}

function isClearStageConfirmation(value: string): boolean {
  const normalized = value.normalize('NFKC').replace(/\s+/g, '');
  return /^(?:嗯+[，,]?)?(?:准确|正确|是的|对(?:的)?|没错|没问题|可以(?:的)?|好的|确认|就是这样|就这样|就按这个来|按这个来|好[的呀]?|行|可以[了]?|继续|下一步|好了|可以了|就这样吧|结束吧|没有了|没了|差不多了|够了|就这样|先这样|就这些|就到这里|就按这个|按这个来|按这样|知道了|明白了|了解了|懂了|清楚了|收到|没问题了|没问题)(?:[，,。.!！]*(?:继续|下一步|吧|了|结束|啦|呗|哈|呀|哦|喔))*[。.!！]?$/.test(
    normalized,
  );
}

function isDelegatedStageAnswer(value: string): boolean {
  const normalized = value.normalize('NFKC').replace(/\s+/g, '');
  return /^(?:你决定|你来决定|都可以|都行|随便|随你|你看着办|无所谓|不知道|不清楚|不确定|暂时不知道|按默认)(?:就行|即可|吧)?[。.!！]?$/.test(
    normalized,
  );
}

export function buildGuidedAssistantTurnV2(input: {
  current_draft: GuidedSkillDraft;
  current_field_states: Partial<Record<GuidedDraftField, GuidedFieldState>>;
  confirmed_stages: GuidedCreationStage[];
  current_stage: GuidedCreationStage | null;
  user_message: string;
  extraction: GuidedExtractionResult;
  phrasing: GuidedQuestionPhrasing | null;
}): GuidedAssistantTurn {
  const operations = sanitizeDraftOperations(
    input.current_draft,
    input.current_field_states,
    input.extraction.operations,
    input.user_message,
  );
  const draft = applyDraftOperations(input.current_draft, operations);
  const stateOverrides = applyFieldStateOperations(
    input.current_field_states,
    operations,
  );
  const confirmedStages = [...input.confirmed_stages];
  if (input.current_stage) {
    const stage = GUIDED_STAGES.find(
      (candidate) => candidate.key === input.current_stage,
    );
    const hasExplicitStageEvidence = operations.some(
      (operation) =>
        operation.state === 'explicit' &&
        stage?.fields.some((field) => field === operation.path),
    );
    const hasCompleteExplicitStage = stage?.fields.every(
      (field) =>
        stateOverrides[field] === 'explicit' && Boolean(draft[field]?.trim()),
    );
    const hasReliableUserConfirmation =
      !isDelegatedStageAnswer(input.user_message) &&
      (input.extraction.stage_complete ||
        isClearStageConfirmation(input.user_message));
    if (
      hasCompleteExplicitStage &&
      (hasExplicitStageEvidence || hasReliableUserConfirmation) &&
      !confirmedStages.includes(input.current_stage)
    ) {
      confirmedStages.push(input.current_stage);
    }
  }

  const evaluation = evaluateGuidedFlow(
    draft,
    stateOverrides,
    confirmedStages,
  );
  const acknowledgement = cleanAcknowledgement(input.extraction.acknowledgement);
  if (evaluation.ready_for_confirmation) {
    return {
      draft: evaluation.normalized_draft,
      field_states: evaluation.field_states,
      status: 'ready_for_confirmation',
      next_blocking_field: null,
      acknowledgement,
      content: `${acknowledgement}\n\n你的想法已经梳理完整，请检查确认内容。确认后我会生成这个 Skill。`,
      suggested_options: [],
      confirmation: buildConfirmationCard(evaluation.normalized_draft),
      confirmed_stages: evaluation.confirmed_stages,
      next_stage: null,
      focus_stage: null,
    };
  }

  const focusStage = evaluation.next_stage!;
  const stageDefinition = GUIDED_STAGES.find(
    (stage) => stage.key === focusStage,
  )!;
  const nextBlockingField =
    stageDefinition.fields.find(
      (field) => evaluation.field_states[field] !== 'explicit',
    ) ?? null;
  const { question, suggested_options } = parseStagePhrasing(
    input.phrasing,
    focusStage,
    nextBlockingField,
    evaluation.normalized_draft,
  );
  return {
    draft: evaluation.normalized_draft,
    field_states: evaluation.field_states,
    status: 'collecting',
    next_blocking_field: nextBlockingField,
    acknowledgement,
    content: `${acknowledgement}\n\n${question}`,
    suggested_options,
    confirmation: null,
    confirmed_stages: evaluation.confirmed_stages,
    next_stage: focusStage,
    focus_stage: focusStage,
  };
}

const STEP_DIMENSIONS: Record<
  GuidedCreationStep,
  readonly GuidedEducationDimension[]
> = {
  intent_context: ['educational_goal', 'audience_context'],
  teacher_experience: ['input_evidence', 'teaching_strategy', 'action_adaptation'],
  strategy_co_creation: ['teaching_strategy'],
  action_adjustment: ['action_adaptation', 'boundaries_responsibility'],
  evidence_review: ['completion_evidence'],
};

const STEP_FALLBACK_QUESTIONS: Record<GuidedCreationStep, string> = {
  intent_context:
    '完成这个 Skill 后，你最希望学生发生什么变化，它会在怎样的真实教学情境中使用？',
  teacher_experience:
    '你实际教学时，学生最容易卡在哪里，你通常会怎样判断并处理？',
  strategy_co_creation:
    '结合你的经验，你希望这个 Skill 采用怎样的教学方式来推动学生真正理解？',
  action_adjustment:
    '使用过程中要观察哪些表现，出现什么情况时应该调整做法或交给教师确认？',
  evidence_review:
    '看到哪些具体表现或作品时，你会认为这个 Skill 在教育上真正有效？',
};

const STEP_FALLBACK_OPTIONS: Record<GuidedCreationStep, string[]> = {
  intent_context: ['理解关键概念', '能够独立实践', '能解释并迁移应用'],
  teacher_experience: ['说说常见困难', '分享一次有效做法', '说明你会关注什么'],
  strategy_co_creation: ['先诊断再引导', '通过探究形成理解', '用反馈推动修正'],
  action_adjustment: ['根据错误类型调整', '逐步增减学习支架', '关键节点由教师确认'],
  evidence_review: ['用作品或表现判断', '用真实任务验证', '结合过程与结果判断'],
};

const STEP_CONFIRMATION_QUESTIONS: Record<GuidedCreationStep, string> = {
  intent_context: '我先确认一下：目标和使用对象这样理解准确吗？',
  teacher_experience: '我先确认一下：这些材料和已有做法，确实是你希望保留的经验吗？',
  strategy_co_creation: '我先确认一下：这就是你希望采用的教学策略吗？',
  action_adjustment: '我先确认一下：观察、调整和教师负责的边界这样安排合适吗？',
  evidence_review: '我先确认一下：这些表现可以作为有效完成的依据吗？',
};

function hasUserOwnedEvidence(
  draft: GuidedEducationDraft,
  dimension: GuidedEducationDimension,
): boolean {
  return Boolean(
    draft[dimension]?.evidence.some(
      (evidence) =>
        evidence.source === 'user_explicit' ||
        evidence.source === 'user_adopted',
    ),
  );
}

function parseEducationPhrasing(
  phrasing: GuidedQuestionPhrasing | null,
  step: GuidedCreationStep,
  draft: GuidedEducationDraft,
): { question: string; suggested_options: string[] } {
  const candidate = phrasing?.question?.replace(/\s+/g, ' ').trim() ?? '';
  const firstQuestion = candidate.match(/^.*?[？?]/)?.[0]?.trim() ?? '';
  const usesExpectedStep = !phrasing?.step || phrasing.step === step;
  const intentFallback =
    step === 'intent_context' &&
    draft.educational_goal?.content &&
    draft.audience_context?.content
      ? `我理解你希望“${draft.educational_goal.content.slice(0, 48)}”，主要用于“${draft.audience_context.content.slice(0, 48)}”。这个方向准确吗？`
      : STEP_FALLBACK_QUESTIONS[step];
  const stepHasContent = STEP_DIMENSIONS[step].every((dimension) =>
    Boolean(draft[dimension]?.content?.trim()),
  );
  const question = stepHasContent
    ? step === 'intent_context'
      ? intentFallback
      : STEP_CONFIRMATION_QUESTIONS[step]
    : usesExpectedStep && firstQuestion.length > 0 && firstQuestion.length <= 180
    ? firstQuestion.replace(/\?$/, '？')
    : intentFallback;
  const candidateOptions = Array.isArray(phrasing?.suggested_options)
    ? phrasing.suggested_options
        .filter((option): option is string => typeof option === 'string')
        .map((option) => option.trim())
        .filter(Boolean)
        .slice(0, 4)
    : [];
  return {
    question,
    suggested_options:
      candidateOptions.length >= 2
        ? candidateOptions
        : stepHasContent
          ? STAGE_CONFIRMATION_OPTIONS
          : STEP_FALLBACK_OPTIONS[step],
  };
}

function addUserAdoption(
  draft: GuidedEducationDraft,
  step: GuidedCreationStep,
  quote: string,
): GuidedEducationDraft {
  const next = structuredClone(draft);
  for (const dimension of STEP_DIMENSIONS[step]) {
    if (hasUserOwnedEvidence(next, dimension)) continue;
    if (!next[dimension]?.content) {
      next[dimension] = {
        content: '由用户确认采纳',
        evidence: [{ source: 'user_adopted', quote }],
      };
    } else {
      const section = next[dimension];
      section.evidence = section.evidence.filter(
        (item) => item.source !== 'conflicted',
      );
      section.evidence.push({ source: 'user_adopted', quote });
    }
  }
  return next;
}

export function buildGuidedAssistantTurnV3(input: {
  current_draft: GuidedEducationDraft;
  completed_steps: GuidedCreationStep[];
  current_step: GuidedCreationStep | null;
  user_message: string;
  extraction: GuidedEducationExtractionResult;
  phrasing: GuidedQuestionPhrasing | null;
}): GuidedAssistantTurn {
  const operations = sanitizeEducationOperations(
    input.current_draft,
    input.extraction.operations,
    input.user_message,
  );
  let draft = applyEducationOperations(input.current_draft, operations);
  const completedSteps = [...input.completed_steps];

  if (input.current_step) {
    const relevantDimensions = STEP_DIMENSIONS[input.current_step];
    const participated = operations.some(
      (operation) =>
        relevantDimensions.includes(operation.dimension) &&
        (operation.source === 'user_explicit' ||
          operation.source === 'user_adopted'),
    );
    const userDelegated = isDelegatedStageAnswer(input.user_message);
    if (isClearStageConfirmation(input.user_message) || userDelegated) {
      draft = addUserAdoption(draft, input.current_step, input.user_message);
    }
    const requiredDimensions = STEP_DIMENSIONS[input.current_step];
    const hasRequiredEvidence = requiredDimensions.every((dimension) =>
      hasUserOwnedEvidence(draft, dimension),
    );
    const confirmedExisting =
      isClearStageConfirmation(input.user_message) &&
      STEP_DIMENSIONS[input.current_step].some(
        (dimension) => Boolean(draft[dimension]?.content),
      );
    const hasConflictedInStep = requiredDimensions.some(
      (dimension) =>
        Boolean(draft[dimension]?.evidence.some(
          (item) => item.source === 'conflicted',
        )),
    );
    const hasAccumulatedEvidence = hasRequiredEvidence && !hasConflictedInStep;
    if (
      (participated || confirmedExisting || hasAccumulatedEvidence || userDelegated) &&
      hasRequiredEvidence &&
      !hasConflictedInStep &&
      !completedSteps.includes(input.current_step)
    ) {
      completedSteps.push(input.current_step);
    }
    if (
      !completedSteps.includes(input.current_step) &&
      !hasConflictedInStep &&
      requiredDimensions.every((dimension) =>
        Boolean(draft[dimension]?.content),
      ) &&
      !hasRequiredEvidence
    ) {
      draft = addUserAdoption(draft, input.current_step, '系统根据已有内容自动整理');
      completedSteps.push(input.current_step);
    }
  }

  // Do not silently fill education dimensions with platform defaults. The
  // teacher must express or explicitly adopt materials and responsibility.
  const platformDefaultsEnabled = false;
  if (platformDefaultsEnabled) {
    const defaults: EducationDraftOperation[] = [];
    if (!draft.input_evidence?.content) {
      defaults.push({
        dimension: 'input_evidence',
        content:
          '优先依据教师提供的课程标准、教材、学情、任务材料和本次使用中的真实记录；信息不足时先向教师确认。',
        source: 'platform_default',
      });
    }
    if (!draft.boundaries_responsibility?.content) {
      defaults.push({
        dimension: 'boundaries_responsibility',
        content:
          '不编造学生表现和教学事实；涉及安全、专业判断、评价结论或影响学生的重要决定时，由教师确认。',
        source: 'platform_default',
      });
    }
    draft = applyEducationOperations(draft, defaults);
  }

  const evaluation = evaluateEducationFlow(draft, completedSteps);
  const acknowledgement = cleanAcknowledgement(input.extraction.acknowledgement);
  const legacyStates = Object.fromEntries(
    GUIDED_DRAFT_FIELDS.map((field) => [field, 'missing']),
  ) as Record<GuidedDraftField, GuidedFieldState>;

  if (evaluation.ready_for_confirmation) {
    return {
      draft: {},
      field_states: legacyStates,
      education_draft: evaluation.normalized_draft,
      completed_steps: evaluation.completed_steps,
      current_step: null,
      focus_step: null,
      status: 'ready_for_confirmation',
      next_blocking_field: null,
      acknowledgement,
      content: `${acknowledgement}\n\n你的教学想法已经整理成完整方案，请检查确认。确认后我会生成这个 Skill。`,
      suggested_options: [],
      confirmation: buildEducationConfirmationCard(
        evaluation.normalized_draft,
      ),
      confirmed_stages: [],
      next_stage: null,
      focus_stage: null,
    };
  }

  const focusStep = evaluation.current_step ?? 'evidence_review';
  const { question, suggested_options } = parseEducationPhrasing(
    input.phrasing,
    focusStep,
    evaluation.normalized_draft,
  );
  return {
    draft: {},
    field_states: legacyStates,
    education_draft: evaluation.normalized_draft,
    completed_steps: evaluation.completed_steps,
    current_step: focusStep,
    focus_step: focusStep,
    status: 'collecting',
    next_blocking_field: null,
    acknowledgement,
    content: `${acknowledgement}\n\n${question}`,
    suggested_options,
    confirmation: null,
    confirmed_stages: [],
    next_stage: null,
    focus_stage: null,
  };
}

const MAX_MESSAGE_CHARS = 12_000;
const MAX_DOCUMENTS = 10;
const MAX_DOCUMENT_CHARS = 12_000;
const DEFAULT_LIST_LIMIT = 30;
const MAX_LIST_LIMIT = 100;
const GUIDED_FINALIZE_LEASE_MS = 10 * 60 * 1_000;
const GUIDED_MESSAGE_LEASE_MS = 2 * 60 * 1_000;
const MAX_ROUNDS_PER_STEP = 12;
const MAX_TOTAL_USER_MESSAGES = 30;

export class GuidedCreationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'GuidedCreationError';
  }
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return (value as T | null | undefined) ?? fallback;
}

function asNullableId(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

function asIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function mapSession(row: Record<string, unknown>): GuidedCreationSession {
  const storedDraft = parseJson<Record<string, unknown>>(row.draft_json, {});
  const storedStates = parseJson<
    Partial<Record<GuidedDraftField, GuidedFieldState>>
  >(row.field_states_json, {});
  const flowVersion = Math.max(1, Number(row.flow_version ?? 1));
  const storedProgress = parseJson<unknown[]>(
    row.confirmed_stages_json,
    [],
  );
  const confirmedStages = storedProgress.filter(
    (stage): stage is GuidedCreationStage =>
      typeof stage === 'string' && GUIDED_STAGE_SET.has(stage),
  );
  const completedSteps = storedProgress.filter(
    (step): step is GuidedCreationStep =>
      typeof step === 'string' && GUIDED_CREATION_STEP_SET.has(step),
  );
  const educationEvaluation =
    flowVersion >= 3
      ? evaluateEducationFlow(
          storedDraft as GuidedEducationDraft,
          completedSteps,
        )
      : null;
  const legacyEvaluation =
    flowVersion >= 3
      ? evaluateDraft({}, {})
      : flowVersion >= 2
        ? evaluateGuidedFlow(
            storedDraft as GuidedSkillDraft,
            storedStates,
            confirmedStages,
          )
        : evaluateDraft(storedDraft as GuidedSkillDraft, storedStates);
  return {
    id: String(row.id),
    display_name:
      typeof row.display_name === 'string' ? row.display_name : null,
    deleted_at: row.deleted_at ? asIso(row.deleted_at) : null,
    status: row.status as GuidedCreationStatus,
    model: typeof row.model === 'string' ? row.model : null,
    documents: parseJson<GuidedCreationDocument[]>(row.documents_json, []),
    draft: flowVersion >= 3 ? {} : legacyEvaluation.normalized_draft,
    field_states: legacyEvaluation.field_states,
    education_draft: educationEvaluation?.normalized_draft,
    flow_version: flowVersion,
    confirmed_stages: flowVersion === 2 ? confirmedStages : [],
    next_stage:
      flowVersion === 2 ? nextGuidedStage(confirmedStages) : null,
    completed_steps: flowVersion >= 3 ? completedSteps : undefined,
    current_step:
      flowVersion >= 3 ? educationEvaluation?.current_step ?? null : undefined,
    confirmation: parseJson<GuidedConfirmationCard | null>(
      row.confirmation_json,
      null,
    ),
    revision_no: Number(row.revision_no),
    package_id: asNullableId(row.package_id),
    skill_id: asNullableId(row.skill_id),
    skill_version_id: asNullableId(row.skill_version_id),
    error: parseJson<Record<string, unknown> | null>(row.error_json, null),
    created_at: asIso(row.created_at),
    updated_at: asIso(row.updated_at),
    completed_at: row.completed_at ? asIso(row.completed_at) : null,
  };
}

function mapMessage(row: Record<string, unknown>): GuidedCreationMessage {
  return {
    id: String(row.id),
    session_id: String(row.session_id),
    message_no: Number(row.message_no),
    client_message_id:
      typeof row.client_message_id === 'string'
        ? row.client_message_id
        : null,
    role: row.role as GuidedCreationMessage['role'],
    content: String(row.content),
    metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}),
    created_at: asIso(row.created_at),
  };
}

function normalizeDocuments(
  documents: GuidedCreationDocument[] | undefined,
): GuidedCreationDocument[] {
  if (documents === undefined) return [];
  if (!Array.isArray(documents) || documents.length > MAX_DOCUMENTS) {
    throw new GuidedCreationError(
      'INVALID_DOCUMENTS',
      '参考材料数量不符合要求',
      400,
    );
  }
  return documents.map((document) => {
    if (
      !isRecord(document) ||
      typeof document.name !== 'string' ||
      !document.name.trim() ||
      typeof document.content !== 'string' ||
      !document.content.trim() ||
      document.content.length > MAX_DOCUMENT_CHARS
    ) {
      throw new GuidedCreationError(
        'INVALID_DOCUMENT',
        '参考材料格式不正确或内容过长',
        400,
      );
    }
    return {
      name: document.name.trim().slice(0, 200),
      content: document.content.trim(),
      ...(typeof document.mime_type === 'string' && document.mime_type.trim()
        ? { mime_type: document.mime_type.trim().slice(0, 100) }
        : {}),
    };
  });
}

function normalizeMessage(value: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new GuidedCreationError('INVALID_MESSAGE', '请输入 Skill 需求', 400);
  }
  if (value.length > MAX_MESSAGE_CHARS) {
    throw new GuidedCreationError('MESSAGE_TOO_LONG', '消息内容过长', 400);
  }
  return value.trim();
}

function normalizeClientMessageId(value: string): string {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(value)
  ) {
    throw new GuidedCreationError(
      'INVALID_CLIENT_MESSAGE_ID',
      'client_message_id 格式不正确',
      400,
    );
  }
  return value;
}

export async function getGuidedCreationDetail(input: {
  auth_user_id: string;
  session_id: string;
}): Promise<GuidedCreationSessionDetail> {
  const sessionResult = await query<Record<string, unknown>>(
    `select *
       from skill_guided_creation_sessions
      where id = $1 and user_id = $2 and deleted_at is null`,
    [input.session_id, input.auth_user_id],
  );
  const row = sessionResult.rows[0];
  if (!row) {
    throw new GuidedCreationError(
      'GUIDED_SESSION_NOT_FOUND',
      '没有找到这个 Skill 草稿',
      404,
    );
  }
  const messageResult = await query<Record<string, unknown>>(
    `select m.*
       from skill_guided_creation_messages m
       join skill_guided_creation_sessions s on s.id = m.session_id
      where m.session_id = $1 and s.user_id = $2
        and s.deleted_at is null
      order by m.message_no asc`,
    [input.session_id, input.auth_user_id],
  );
  return { ...mapSession(row), messages: messageResult.rows.map(mapMessage) };
}

export async function listGuidedCreations(input: {
  auth_user_id: string;
  status?: GuidedCreationStatus[];
  limit?: number;
  cursor?: string;
}): Promise<{ items: GuidedCreationSession[]; next_cursor: string | null }> {
  const limit = Math.min(
    MAX_LIST_LIMIT,
    Math.max(1, Math.trunc(input.limit ?? DEFAULT_LIST_LIMIT)),
  );
  const values: unknown[] = [input.auth_user_id];
  const where = ['user_id = $1', 'deleted_at is null'];
  if (input.status?.length) {
    values.push(input.status);
    where.push(`status = any($${values.length}::text[])`);
  }
  if (input.cursor) {
    values.push(input.cursor);
    where.push(`updated_at < $${values.length}::timestamptz`);
  }
  values.push(limit + 1);
  const result = await query<Record<string, unknown>>(
    `select *
       from skill_guided_creation_sessions
      where ${where.join(' and ')}
      order by updated_at desc, id desc
      limit $${values.length}`,
    values,
  );
  const hasMore = result.rows.length > limit;
  const rows = result.rows.slice(0, limit);
  return {
    items: rows.map(mapSession),
    next_cursor: hasMore ? asIso(rows[rows.length - 1]?.updated_at) : null,
  };
}

function normalizeDisplayName(value: string): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 200) {
    throw new GuidedCreationError(
      'INVALID_DISPLAY_NAME',
      '名称需要填写 1 到 200 个字符',
      400,
    );
  }
  return value.trim();
}

export async function renameGuidedCreation(input: {
  auth_user_id: string;
  session_id: string;
  revision_no: number;
  display_name: string;
}): Promise<GuidedCreationSessionDetail> {
  const displayName = normalizeDisplayName(input.display_name);
  const result = await query(
    `update skill_guided_creation_sessions
        set display_name = $4,
            revision_no = revision_no + 1,
            updated_at = now()
      where id = $1
        and user_id = $2
        and revision_no = $3
        and deleted_at is null
        and status <> 'finalizing'`,
    [
      input.session_id,
      input.auth_user_id,
      input.revision_no,
      displayName,
    ],
  );
  if (result.rowCount !== 1) {
    throw new GuidedCreationError(
      'SESSION_REVISION_CONFLICT',
      '会话已更新，请刷新后重试',
      409,
      true,
    );
  }
  return getGuidedCreationDetail({
    auth_user_id: input.auth_user_id,
    session_id: input.session_id,
  });
}

export async function deleteGuidedCreation(input: {
  auth_user_id: string;
  session_id: string;
  revision_no: number;
}): Promise<{ id: string; deleted_at: string }> {
  const result = await query<Record<string, unknown>>(
    `update skill_guided_creation_sessions
        set deleted_at = now(),
            revision_no = revision_no + 1,
            updated_at = now()
      where id = $1
        and user_id = $2
        and revision_no = $3
        and deleted_at is null
        and status <> 'finalizing'
      returning id, deleted_at`,
    [input.session_id, input.auth_user_id, input.revision_no],
  );
  const row = result.rows[0];
  if (!row) {
    throw new GuidedCreationError(
      'SESSION_REVISION_CONFLICT',
      '会话已更新，请刷新后重试',
      409,
      true,
    );
  }
  return { id: String(row.id), deleted_at: asIso(row.deleted_at) };
}

function extractionPrompt(input: {
  draft: GuidedSkillDraft;
  messages: GuidedCreationMessage[];
  content: string;
  documents: GuidedCreationDocument[];
}): { systemPrompt: string; userPrompt: string; maxTokens: number } {
  const history = [...input.messages, { role: 'user', content: input.content }]
    .slice(-12)
    .map((message) => `${message.role}: ${message.content}`)
    .join('\n');
  const documentSummary = input.documents
    .map((document) => `# ${document.name}\n${document.content}`)
    .join('\n\n')
    .slice(0, MAX_DOCUMENT_CHARS);
  return {
    systemPrompt:
      '你负责从教育 Skill 对话中提取结构化信息。只返回 JSON。operations 只能使用 set、replace、remove，path 只能来自给定字段；不要自行决定是否完成，也不要提出问题。state 只能是 explicit、inferred、conflicted。',
    userPrompt: `字段：${GUIDED_DRAFT_FIELDS.join(', ')}\n当前草案：${JSON.stringify(input.draft)}\n对话：\n${history}\n参考材料：\n${documentSummary || '无'}\n返回：{"operations":[],"acknowledgement":"一句简短确认"}`,
    maxTokens: 4_096,
  };
}

function extractionPromptV2(input: {
  draft: GuidedSkillDraft;
  messages: GuidedCreationMessage[];
  content: string;
  documents: GuidedCreationDocument[];
  currentStage: GuidedCreationStage | null;
}): { systemPrompt: string; userPrompt: string; maxTokens: number } {
  const history = [...input.messages, { role: 'user', content: input.content }]
    .slice(-12)
    .map((message) => `${message.role}: ${message.content}`)
    .join('\n');
  const documentSummary = input.documents
    .map((document) => `# ${document.name}\n${document.content}`)
    .join('\n\n')
    .slice(0, MAX_DOCUMENT_CHARS);
  const stage = GUIDED_STAGES.find(
    (candidate) => candidate.key === input.currentStage,
  );
  return {
    systemPrompt:
      '你负责从教育 Skill 共创对话中提取用户真正表达的经验和要求，只返回 JSON。不得替用户补全想法。operations 的 path 只能来自给定字段；明确来自本轮用户原话时 state 才能为 explicit，并必须在 evidence 中逐字复制能够在本轮用户消息中找到的短语；合理推测只能标记 inferred。已有 explicit 内容必须保留：补充信息用 set，只有用户明确否定或纠正先前说法时才用 replace。stage_complete 只有在本轮用户确实回答了当前阶段问题且信息足以进入下一阶段时才为 true。“你决定”“都可以”等放弃表达不算完成。当前阶段为空时必须返回 false。不要提出问题。',
    userPrompt: `字段：${GUIDED_DRAFT_FIELDS.join(', ')}\n当前阶段：${input.currentStage ?? '尚未开始，先记录初始目标'}\n本阶段字段：${stage?.fields.join(', ') ?? '无'}\n当前草案：${JSON.stringify(input.draft)}\n对话：\n${history}\n本轮用户消息：${input.content}\n参考材料：\n${documentSummary || '无'}\n返回：{"operations":[{"op":"set","path":"goal","value":"提取值","state":"explicit","evidence":"本轮用户原话"}],"stage_complete":false,"acknowledgement":"一句简短确认"}`,
    maxTokens: 4_096,
  };
}

function extractionPromptV3(input: {
  draft: GuidedEducationDraft;
  messages: GuidedCreationMessage[];
  content: string;
  documents: GuidedCreationDocument[];
  currentStep: GuidedCreationStep | null;
}): { systemPrompt: string; userPrompt: string; maxTokens: number } {
  const history = [...input.messages, { role: 'user', content: input.content }]
    .slice(-14)
    .map((message) => `${message.role}: ${message.content}`)
    .join('\n');
  const documentSummary = input.documents
    .map((document) => `# ${document.name}\n${document.content}`)
    .join('\n\n')
    .slice(0, MAX_DOCUMENT_CHARS);
  const step = input.currentStep ?? 'intent_context';
  const candidates = matchTeachingExperiences({ draft: input.draft, step });
  const candidateContext = candidates.map((item) => ({
    experience_id: item.experience_id,
    applicable_when: item.applicable_when,
    educational_intent: item.educational_intent,
    suggested_strategy: item.suggested_strategy,
    observation_signals: item.observation_signals,
    adjustment_guidance: item.adjustment_guidance,
    teacher_responsibility: item.teacher_responsibility,
    effectiveness_evidence: item.effectiveness_evidence,
  }));

  return {
    systemPrompt:
      '你负责通过自然对话帮助教师把真实教育经验提炼为可执行的 Skill。只返回 JSON。一次回答可以更新多个教育维度，但不得把 AI 推测冒充成用户意见。source=user_explicit 或 user_adopted 时，quote 必须逐字来自本轮用户消息；用户没有表达或采纳的候选经验只能帮助你提出更好的问题，绝不能写入 operations。不要重复询问草案中已经明确的内容。如果本轮已经回答当前步骤，question 应自然进入下一个步骤；信息含糊或冲突时才针对当前步骤补问一次。每轮只提出一个最有价值的问题，question 只能有一个问号，suggested_options 提供 2 到 4 个贴合当前情境的方向并允许用户自由表达。step_complete 只是辅助判断，后端会依据证据独立决定是否推进。\noperations 每项可带 op 字段：补充新信息用 set（默认，追加合并）；用户明确纠正或否定先前说法时用 replace（覆盖该维度 content 与证据，必须配 source=user_explicit/user_adopted）；用户撤回某个维度内容时用 remove（不需要 content/source）。不要用 replace 覆盖你推测出来的内容。\n当本轮用户说法与草案已有内容明显冲突（例如对象从「小学生」改成「中学生」）且用户未明确表示纠正时，用 source=conflicted 标记该维度，content 留空，并在 question 中向用户确认真实意图；不要直接合并矛盾内容。',
    userPrompt: `七个维度：${GUIDED_EDUCATION_DIMENSIONS.map((dimension) => `${dimension}（${GUIDED_EDUCATION_LABELS[dimension]}）`).join('，')}\n当前共创步骤：${input.currentStep ?? '尚未开始；先吸收初始需求，再从教育意图开始'}\n当前草案：${JSON.stringify(input.draft)}\n对话：\n${history}\n本轮用户消息：${input.content}\n参考材料：\n${documentSummary || '无'}\n最多两条内部候选经验（只用于启发追问）：${JSON.stringify(candidateContext)}\nSkill 转化提醒：${GUIDED_SKILL_CONVERSION_RULES.join('；')}\n返回：{"operations":[{"dimension":"educational_goal","op":"set","content":"提炼后的结论","source":"user_explicit","quote":"本轮用户原话"}],"step_complete":false,"acknowledgement":"一句具体承接，不要重复用户整句话","question":"下一步唯一的问题？","suggested_options":["方向1","方向2"]}`,
    maxTokens: 4_096,
  };
}

function phrasingPrompt(input: {
  field: GuidedDraftField;
  draft: GuidedSkillDraft;
}): { systemPrompt: string; userPrompt: string; maxTokens: number } {
  return {
    systemPrompt:
      '你负责把一个确定的追问写得自然、简短。只能问一个问题，不得追问其他字段。给出 2 到 4 个可选短答案，同时允许用户自由输入。只返回 JSON。',
    userPrompt: `必须询问字段：${input.field}\n当前草案：${JSON.stringify(input.draft)}\n返回：{"field":"${input.field}","question":"一个问题？","suggested_options":["选项1","选项2"]}`,
    maxTokens: 1_024,
  };
}

function phrasingPromptV2(input: {
  stage: GuidedCreationStage;
  field: GuidedDraftField | null;
  draft: GuidedSkillDraft;
  recentQuestions: string[];
}): { systemPrompt: string; userPrompt: string; maxTokens: number } {
  const stageDefinition = GUIDED_STAGES.find(
    (candidate) => candidate.key === input.stage,
  )!;
  const mode = input.field ? 'collect_field' : 'confirm_stage';
  const task = input.field
    ? `只询问尚未明确的字段 ${input.field}（${GUIDED_FIELD_LABELS[input.field]}），不得再次询问本阶段其他已知字段。`
    : '本阶段字段已经明确。请简短复述当前理解并询问是否准确，不得重新要求用户描述这些字段。';
  return {
    systemPrompt:
      '你负责用自然对话帮助教师说出自己的做法和经验。每轮只能有一个问号、一个主要问题，不要替用户作答。问题和选项必须紧扣已知草案中的学科与目标，不得引入用户没有提到的其他课题、学科或实验。不要重复最近已经问过的问题。只返回 JSON。',
    userPrompt: `当前阶段：${input.stage}\n本阶段字段：${stageDefinition.fields.join(', ')}\n问题模式：${mode}\n当前任务：${task}\n已知草案：${JSON.stringify(input.draft)}\n最近问题：${input.recentQuestions.join(' | ') || '无'}\n返回：{"stage":"${input.stage}","field":${input.field ? `"${input.field}"` : 'null'},"mode":"${mode}","question":"一个自然的问题？","suggested_options":["方向1","方向2"]}`,
    maxTokens: 1_024,
  };
}

function parseQuestionPhrasing(value: unknown): GuidedQuestionPhrasing | null {
  if (!isRecord(value)) return null;
  return {
    field: typeof value.field === 'string' ? value.field : undefined,
    stage: typeof value.stage === 'string' ? value.stage : undefined,
    step: typeof value.step === 'string' ? value.step : undefined,
    mode:
      value.mode === 'collect_field' || value.mode === 'confirm_stage'
        ? value.mode
        : undefined,
    question: typeof value.question === 'string' ? value.question : '',
    suggested_options: Array.isArray(value.suggested_options)
      ? value.suggested_options.filter(
          (option): option is string => typeof option === 'string',
        )
      : [],
  };
}

function currentFocusStage(
  session: GuidedCreationSessionDetail,
): GuidedCreationStage | null {
  const focusStage = [...session.messages]
    .reverse()
    .find((message) => message.role === 'assistant')?.metadata.focus_stage;
  return typeof focusStage === 'string' && GUIDED_STAGE_SET.has(focusStage)
    ? (focusStage as GuidedCreationStage)
    : null;
}

function currentFocusStep(
  session: GuidedCreationSessionDetail,
): GuidedCreationStep | null {
  const focusStep = [...session.messages]
    .reverse()
    .find((message) => message.role === 'assistant')?.metadata.focus_step;
  return typeof focusStep === 'string' && GUIDED_CREATION_STEP_SET.has(focusStep)
    ? (focusStep as GuidedCreationStep)
    : null;
}

function fallbackEducationExtraction(input: {
  content: string;
  currentStep: GuidedCreationStep | null;
}): GuidedEducationExtractionResult {
  const quote = input.content.slice(0, 500);
  const operations: EducationDraftOperation[] = [];
  if (!isDelegatedStageAnswer(input.content)) {
    if (!input.currentStep || input.currentStep === 'intent_context') {
      operations.push({
        dimension: 'educational_goal',
        content: input.content,
        source: 'user_explicit',
        quote,
      });
      const audience = input.content.match(
        /小学|初中|高中|大学|职校|[一二三四五六七八九十0-9]{1,3}年级|教师|老师|学生|家长|教研员|分组实验|演示实验|实验课|课堂|课前|课后/g,
      );
      if (audience?.length) {
        operations.push({
          dimension: 'audience_context',
          content: `使用对象与情境：${[...new Set(audience)].join('、')}`,
          source: 'user_explicit',
          quote: audience[0],
        });
      }
    } else {
      const dimension: Record<GuidedCreationStep, GuidedEducationDimension> = {
        intent_context: 'educational_goal',
        teacher_experience: 'teaching_strategy',
        strategy_co_creation: 'teaching_strategy',
        action_adjustment: 'action_adaptation',
        evidence_review: 'completion_evidence',
      };
      operations.push({
        dimension: dimension[input.currentStep],
        content: input.content,
        source: 'user_explicit',
        quote,
      });
    }
  }
  return {
    operations,
    step_complete: false,
    acknowledgement: '我已经记下你的想法，我们继续把它梳理得更具体。',
  };
}

function enrichInitialEducationExtraction(
  extraction: GuidedEducationExtractionResult,
  content: string,
): GuidedEducationExtractionResult {
  const dimensions = new Set(
    extraction.operations.map((operation) => operation.dimension),
  );
  const local = fallbackEducationExtraction({ content, currentStep: null });
  return {
    ...extraction,
    operations: [
      ...extraction.operations,
      ...local.operations.filter(
        (operation) => !dimensions.has(operation.dimension),
      ),
    ],
  };
}

async function generateAssistantTurn(input: {
  session: GuidedCreationSessionDetail;
  content: string;
}): Promise<GuidedAssistantTurn> {
  if (input.session.flow_version >= 3) {
    const currentStep = currentFocusStep(input.session);
    let extraction: GuidedEducationExtractionResult;
    try {
      extraction = parseEducationExtractionResult(
        await generateJson<unknown>(
          extractionPromptV3({
            draft: input.session.education_draft ?? {},
            messages: input.session.messages,
            content: input.content,
            documents: input.session.documents,
            currentStep,
          }),
        ),
      );
      if (!currentStep) {
        extraction = enrichInitialEducationExtraction(
          extraction,
          input.content,
        );
      }
    } catch {
      extraction = fallbackEducationExtraction({
        content: input.content,
        currentStep,
      });
    }
    let effectiveDraft = input.session.education_draft ?? {};
    const effectiveCompletedSteps = [...(input.session.completed_steps ?? [])];
    if (currentStep && !effectiveCompletedSteps.includes(currentStep)) {
      const stepRounds = input.session.messages.filter(
        (m) =>
          m.role === 'assistant' && m.metadata?.focus_step === currentStep,
      ).length;
      const totalUserMessages = input.session.messages.filter(
        (m) => m.role === 'user',
      ).length;
      if (
        stepRounds >= MAX_ROUNDS_PER_STEP ||
        totalUserMessages >= MAX_TOTAL_USER_MESSAGES
      ) {
        effectiveDraft = structuredClone(effectiveDraft);
        for (const dimension of STEP_DIMENSIONS[currentStep]) {
          if (!hasUserOwnedEvidence(effectiveDraft, dimension)) {
            effectiveDraft[dimension] = {
              content: '系统根据多轮对话自动整理',
              evidence: [
                { source: 'user_adopted', quote: '多轮对话汇总' },
              ],
            };
          }
        }
        effectiveCompletedSteps.push(currentStep);
      }
    }
    const baseInput = {
      current_draft: effectiveDraft,
      completed_steps: effectiveCompletedSteps,
      current_step: currentStep,
      user_message: input.content,
      extraction,
    };
    const preview = buildGuidedAssistantTurnV3({
      ...baseInput,
      phrasing: null,
    });
    if (preview.status === 'ready_for_confirmation') return preview;
    return buildGuidedAssistantTurnV3({
      ...baseInput,
      phrasing:
        currentStep && extraction.question && extraction.suggested_options
          ? {
              step: preview.current_step ?? undefined,
              question: extraction.question,
              suggested_options: extraction.suggested_options,
            }
          : null,
    });
  }

  const usesStageFlow = input.session.flow_version === 2;
  const currentStage = usesStageFlow ? currentFocusStage(input.session) : null;
  let extraction: GuidedExtractionResult;
  try {
    const rawExtraction = await generateJson<unknown>(
      usesStageFlow
        ? extractionPromptV2({
            draft: input.session.draft,
            messages: input.session.messages,
            content: input.content,
            documents: input.session.documents,
            currentStage,
          })
        : extractionPrompt({
            draft: input.session.draft,
            messages: input.session.messages,
            content: input.content,
            documents: input.session.documents,
          }),
    );
    extraction = parseExtractionResult(rawExtraction);
  } catch {
    const fallbackExtraction: GuidedExtractionResult = {
      operations: [],
      stage_complete: false,
      acknowledgement: '我们继续把你的想法梳理清楚。',
    };
    return usesStageFlow
      ? buildGuidedAssistantTurnV2({
          current_draft: input.session.draft,
          current_field_states: input.session.field_states,
          confirmed_stages: input.session.confirmed_stages,
          current_stage: currentStage,
          user_message: input.content,
          extraction: fallbackExtraction,
          phrasing: null,
        })
      : buildGuidedAssistantTurn({
          current_draft: input.session.draft,
          current_field_states: input.session.field_states,
          extraction: fallbackExtraction,
          phrasing: null,
        });
  }
  if (usesStageFlow) {
    const previewTurn = buildGuidedAssistantTurnV2({
      current_draft: input.session.draft,
      current_field_states: input.session.field_states,
      confirmed_stages: input.session.confirmed_stages,
      current_stage: currentStage,
      user_message: input.content,
      extraction,
      phrasing: null,
    });
    if (previewTurn.status === 'ready_for_confirmation') return previewTurn;
    if (currentStage) {
      const totalUserMessages = input.session.messages.filter(
        (m) => m.role === 'user',
      ).length;
      const stageRounds = input.session.messages.filter(
        (m) =>
          m.role === 'assistant' && m.metadata?.focus_stage === currentStage,
      ).length;
      if (
        stageRounds >= MAX_ROUNDS_PER_STEP ||
        totalUserMessages >= MAX_TOTAL_USER_MESSAGES
      ) {
        const forcedExtraction: GuidedExtractionResult = {
          operations: [],
          stage_complete: true,
          acknowledgement: '我们把这个阶段的内容确认一下，然后继续。',
        };
        const forcedTurn = buildGuidedAssistantTurnV2({
          current_draft: input.session.draft,
          current_field_states: input.session.field_states,
          confirmed_stages: input.session.confirmed_stages,
          current_stage: currentStage,
          user_message: '确认',
          extraction: forcedExtraction,
          phrasing: null,
        });
        if (forcedTurn.status === 'ready_for_confirmation') return forcedTurn;
        return forcedTurn;
      }
    }
    let phrasing: GuidedQuestionPhrasing | null;
    try {
      phrasing = parseQuestionPhrasing(
        await generateJson<unknown>(
          phrasingPromptV2({
            stage: previewTurn.focus_stage!,
            field: previewTurn.next_blocking_field,
            draft: previewTurn.draft,
            recentQuestions: input.session.messages
              .filter((message) => message.role === 'assistant')
              .slice(-4)
              .map((message) => message.content),
          }),
        ),
      );
    } catch {
      phrasing = null;
    }
    return buildGuidedAssistantTurnV2({
      current_draft: input.session.draft,
      current_field_states: input.session.field_states,
      confirmed_stages: input.session.confirmed_stages,
      current_stage: currentStage,
      user_message: input.content,
      extraction,
      phrasing,
    });
  }
  const previewDraft = applyDraftOperations(
    input.session.draft,
    extraction.operations,
  );
  const previewStates = applyFieldStateOperations(
    input.session.field_states,
    extraction.operations,
  );
  const previewEvaluation = evaluateDraft(previewDraft, previewStates);
  if (previewEvaluation.ready_for_confirmation) {
    return buildGuidedAssistantTurn({
      current_draft: input.session.draft,
      current_field_states: input.session.field_states,
      extraction,
      phrasing: null,
    });
  }
  const totalUserMessages = input.session.messages.filter(
    (m) => m.role === 'user',
  ).length;
  if (totalUserMessages >= MAX_TOTAL_USER_MESSAGES) {
    const forcedExtraction: GuidedExtractionResult = {
      operations: [],
      stage_complete: true,
      acknowledgement: '我们已经聊了很多，让我帮你整理一下。',
    };
    return buildGuidedAssistantTurn({
      current_draft: input.session.draft,
      current_field_states: input.session.field_states,
      extraction: forcedExtraction,
      phrasing: null,
    });
  }
  let phrasing: GuidedQuestionPhrasing | null = null;
  if (previewEvaluation.next_blocking_field) {
    try {
      const rawPhrasing = await generateJson<unknown>(
        phrasingPrompt({
          field: previewEvaluation.next_blocking_field,
          draft: previewEvaluation.normalized_draft,
        }),
      );
      phrasing = parseQuestionPhrasing(rawPhrasing);
    } catch {
      phrasing = null;
    }
  }
  return buildGuidedAssistantTurn({
    current_draft: input.session.draft,
    current_field_states: input.session.field_states,
    extraction,
    phrasing,
  });
}

export async function processGuidedCreationMessage(input: {
  auth_user_id: string;
  session_id: string;
  client_message_id: string;
  revision_no: number;
  content: string;
}): Promise<GuidedCreationSessionDetail> {
  let content = normalizeMessage(input.content);
  const clientMessageId = normalizeClientMessageId(input.client_message_id);
  let session = await getGuidedCreationDetail({
    auth_user_id: input.auth_user_id,
    session_id: input.session_id,
  });
  const existingUserMessage = session.messages.find(
    (message) => message.client_message_id === clientMessageId,
  );
  const existingAssistantMessage = session.messages.find(
    (message) =>
      message.role === 'assistant' &&
      message.metadata.reply_to_client_message_id === clientMessageId,
  );
  if (existingUserMessage && existingAssistantMessage) return session;

  let acceptedRevision: number;
  let userMessageNo: number;
  if (existingUserMessage) {
    const messageLeaseExpired =
      session.status === 'collecting' &&
      Date.now() - new Date(session.updated_at).getTime() >= GUIDED_MESSAGE_LEASE_MS;
    if (session.status !== 'failed' && !messageLeaseExpired) {
      throw new GuidedCreationError(
        'MESSAGE_PROCESSING',
        '这条消息正在处理中',
        409,
        true,
      );
    }
    const reclaimed = await query(
      messageLeaseExpired
        ? `update skill_guided_creation_sessions
              set status = 'collecting',
                  error_json = null,
                  updated_at = now()
            where id = $1
              and user_id = $2
              and revision_no = $3
              and status = 'collecting'
              and updated_at < now() - interval '2 minutes'`
        : `update skill_guided_creation_sessions
              set status = 'collecting',
                  error_json = null,
                  updated_at = now()
            where id = $1
              and user_id = $2
              and revision_no = $3
              and status = 'failed'`,
      [input.session_id, input.auth_user_id, session.revision_no],
    );
    if (reclaimed.rowCount !== 1) {
      throw new GuidedCreationError(
        'MESSAGE_PROCESSING',
        '这条消息正在处理中',
        409,
        true,
      );
    }
    content = existingUserMessage.content;
    acceptedRevision = session.revision_no;
    userMessageNo = existingUserMessage.message_no;
    session = {
      ...session,
      status: 'collecting',
      error: null,
      messages: session.messages.filter(
        (message) => message.id !== existingUserMessage.id,
      ),
    };
  } else {
    if (
      session.status === 'completed' ||
      session.status === 'cancelled' ||
      session.status === 'finalizing'
    ) {
      throw new GuidedCreationError(
        'GUIDED_SESSION_NOT_EDITABLE',
        '当前 Skill 草稿不能继续编辑',
        409,
      );
    }
    if (session.revision_no !== input.revision_no) {
      throw new GuidedCreationError(
        'SESSION_REVISION_CONFLICT',
        '草稿已更新，请刷新后重试',
        409,
        true,
      );
    }
    const accepted = await withTransaction(async (client) => {
      const locked = await client.query<Record<string, unknown>>(
        `select revision_no, status
           from skill_guided_creation_sessions
          where id = $1 and user_id = $2
          for update`,
        [input.session_id, input.auth_user_id],
      );
      const lockedRow = locked.rows[0];
      if (!lockedRow) {
        throw new GuidedCreationError(
          'GUIDED_SESSION_NOT_FOUND',
          '没有找到这个 Skill 草稿',
          404,
        );
      }
      const duplicate = await client.query<Record<string, unknown>>(
        `select message_no
           from skill_guided_creation_messages
          where session_id = $1 and client_message_id = $2`,
        [input.session_id, clientMessageId],
      );
      if (duplicate.rows[0]) {
        return {
          inserted: false,
          revision: Number(lockedRow.revision_no),
          messageNo: Number(duplicate.rows[0].message_no),
        };
      }
      if (Number(lockedRow.revision_no) !== input.revision_no) {
        throw new GuidedCreationError(
          'SESSION_REVISION_CONFLICT',
          '草稿已更新，请刷新后重试',
          409,
          true,
        );
      }
      const sequence = await client.query<Record<string, unknown>>(
        `select coalesce(max(message_no), 0) as last_message_no
           from skill_guided_creation_messages
          where session_id = $1`,
        [input.session_id],
      );
      const messageNo = Number(sequence.rows[0]?.last_message_no ?? 0) + 1;
      await client.query(
        `insert into skill_guided_creation_messages (
           session_id, message_no, client_message_id, role, content, metadata_json
         ) values ($1, $2, $3, 'user', $4, '{}'::jsonb)`,
        [input.session_id, messageNo, clientMessageId, content],
      );
      const updated = await client.query(
        `update skill_guided_creation_sessions
            set status = 'collecting',
                confirmation_json = null,
                error_json = null,
                revision_no = revision_no + 1,
                updated_at = now()
          where id = $1 and user_id = $2 and revision_no = $3`,
        [input.session_id, input.auth_user_id, input.revision_no],
      );
      if (updated.rowCount !== 1) {
        throw new GuidedCreationError(
          'SESSION_REVISION_CONFLICT',
          '草稿已更新，请刷新后重试',
          409,
          true,
        );
      }
      return {
        inserted: true,
        revision: input.revision_no + 1,
        messageNo,
      };
    });
    if (!accepted.inserted) {
      return processGuidedCreationMessage(input);
    }
    acceptedRevision = accepted.revision;
    userMessageNo = accepted.messageNo;
  }

  let turn: GuidedAssistantTurn;
  try {
    turn = await generateAssistantTurn({ session, content });
  } catch (error) {
    await query(
      `update skill_guided_creation_sessions
          set status = 'failed',
              error_json = $4::jsonb,
              updated_at = now()
        where id = $1
          and user_id = $2
          and revision_no = $3
          and status = 'collecting'`,
      [
        input.session_id,
        input.auth_user_id,
        acceptedRevision,
        JSON.stringify({
          code: 'GUIDED_ASSISTANT_FAILED',
          message: '需求理解失败，请重试',
          retryable: true,
        }),
      ],
    );
    if (error instanceof GuidedCreationError) throw error;
    throw new GuidedCreationError(
      'GUIDED_ASSISTANT_FAILED',
      '需求理解失败，请重试',
      500,
      true,
    );
  }

  await withTransaction(async (client) => {
    const locked = await client.query<Record<string, unknown>>(
      `select revision_no, status
         from skill_guided_creation_sessions
        where id = $1 and user_id = $2
        for update`,
      [input.session_id, input.auth_user_id],
    );
    const lockedRow = locked.rows[0];
    if (
      !lockedRow ||
      Number(lockedRow.revision_no) !== acceptedRevision ||
      lockedRow.status !== 'collecting'
    ) {
      throw new GuidedCreationError(
        'SESSION_REVISION_CONFLICT',
        '草稿已更新，请刷新后重试',
        409,
        true,
      );
    }
    await client.query(
      `insert into skill_guided_creation_messages (
         session_id, message_no, role, content, metadata_json
       ) values ($1, $2, 'assistant', $3, $4::jsonb)`,
      [
        input.session_id,
        userMessageNo + 1,
        turn.content,
        JSON.stringify({
          reply_to_client_message_id: clientMessageId,
          next_blocking_field: turn.next_blocking_field,
          focus_stage: turn.focus_stage,
          focus_step: turn.focus_step,
          confirmed_stages: turn.confirmed_stages,
          completed_steps: turn.completed_steps,
          suggested_options: turn.suggested_options,
          confirmation: turn.confirmation,
        }),
      ],
    );
    const updated = await client.query(
      `update skill_guided_creation_sessions
          set status = $3,
              draft_json = $4::jsonb,
              field_states_json = $5::jsonb,
              confirmed_stages_json = $6::jsonb,
              confirmation_json = $7::jsonb,
              error_json = null,
              updated_at = now()
        where id = $1 and user_id = $2 and revision_no = $8`,
      [
        input.session_id,
        input.auth_user_id,
        turn.status,
        JSON.stringify(turn.education_draft ?? turn.draft),
        JSON.stringify(turn.education_draft ? {} : turn.field_states),
        JSON.stringify(turn.completed_steps ?? turn.confirmed_stages),
        turn.confirmation ? JSON.stringify(turn.confirmation) : null,
        acceptedRevision,
      ],
    );
    if (updated.rowCount !== 1) {
      throw new GuidedCreationError(
        'SESSION_REVISION_CONFLICT',
        '草稿已更新，请刷新后重试',
        409,
        true,
      );
    }
  });

  return getGuidedCreationDetail({
    auth_user_id: input.auth_user_id,
    session_id: input.session_id,
  });
}

export async function startGuidedCreation(input: {
  auth_user_id: string;
  content: string;
  client_message_id: string;
  model?: string;
  documents?: GuidedCreationDocument[];
}): Promise<GuidedCreationSessionDetail> {
  const documents = normalizeDocuments(input.documents);
  const content = normalizeMessage(input.content);
  const clientMessageId = normalizeClientMessageId(input.client_message_id);
  const result = await query<Record<string, unknown>>(
    `insert into skill_guided_creation_sessions (
       user_id, model, documents_json, start_client_message_id, flow_version
     ) values ($1, $2, $3::jsonb, $4, 3)
     on conflict (user_id, start_client_message_id)
       where start_client_message_id is not null
     do nothing
     returning *`,
    [
      input.auth_user_id,
      input.model?.trim() || null,
      JSON.stringify(documents),
      clientMessageId,
    ],
  );
  let sessionId = String(result.rows[0]?.id ?? '');
  if (!sessionId) {
    const existing = await query<Record<string, unknown>>(
      `select id
         from skill_guided_creation_sessions
        where user_id = $1 and start_client_message_id = $2`,
      [input.auth_user_id, clientMessageId],
    );
    sessionId = String(existing.rows[0]?.id ?? '');
  }
  if (!sessionId) {
    throw new GuidedCreationError(
      'GUIDED_SESSION_CREATE_FAILED',
      '创建 Skill 草稿失败',
      500,
      true,
    );
  }
  return processGuidedCreationMessage({
    auth_user_id: input.auth_user_id,
    session_id: sessionId,
    client_message_id: clientMessageId,
    revision_no: 0,
    content,
  });
}

export async function cancelGuidedCreation(input: {
  auth_user_id: string;
  session_id: string;
  revision_no: number;
}): Promise<GuidedCreationSessionDetail> {
  const result = await query(
    `update skill_guided_creation_sessions
        set status = 'cancelled',
            revision_no = revision_no + 1,
            updated_at = now()
      where id = $1
        and user_id = $2
        and revision_no = $3
        and status in ('collecting', 'ready_for_confirmation', 'failed')`,
    [input.session_id, input.auth_user_id, input.revision_no],
  );
  if (result.rowCount !== 1) {
    const current = await getGuidedCreationDetail({
      auth_user_id: input.auth_user_id,
      session_id: input.session_id,
    });
    if (current.status === 'cancelled') return current;
    throw new GuidedCreationError(
      'SESSION_REVISION_CONFLICT',
      '草稿已更新，请刷新后重试',
      409,
      true,
    );
  }
  return getGuidedCreationDetail({
    auth_user_id: input.auth_user_id,
    session_id: input.session_id,
  });
}

export function buildGuidedGenerationInstruction(
  draft: GuidedSkillDraft,
): string {
  const lines = GUIDED_DRAFT_FIELDS.map(
    (field) => `- ${field}: ${draft[field] ?? ''}`,
  );
  return [
    '请创建一个教育场景使用的 Skill。',
    '只生成 1 个 Skill，不要拆分成多个 Skill。',
    'Package 和 agent.md 仅作为内部运行容器，用户看到和使用的主体必须是这个 Skill。',
    '请严格遵守以下已确认需求：',
    ...lines,
  ].join('\n');
}

export function buildGuidedEducationGenerationInstruction(
  draft: GuidedEducationDraft,
): string {
  return [
    '请创建一个教育场景使用的 Skill。',
    '只生成 1 个 Skill，不要拆分成多个 Skill。',
    'Package 和 agent.md 仅作为内部运行容器，用户看到和使用的主体必须是这个 Skill。',
    '请把已确认的教育经验转成清晰、可执行、可检查的规则。',
    '每条重要规则尽量写清楚适用条件、行动步骤、观察信号、调整方式和教师确认节点。',
    '不要在 Skill 中暴露内部经验 ID、证据状态或系统提示。',
    '以下是教师已经确认的教育方案：',
    educationDraftToGenerationBrief(draft),
  ].join('\n');
}

async function markFinalizationFailed(input: {
  auth_user_id: string;
  session_id: string;
  request_id: string;
  snapshot: AgentPackageSnapshot | null;
  error: unknown;
}) {
  const code =
    input.error instanceof GuidedCreationError
      ? input.error.code
      : 'SKILL_GENERATION_FAILED';
  const message =
    input.error instanceof GuidedCreationError
      ? input.error.message
      : 'Skill 生成或保存失败，请重试';
  try {
    await query(
      `update skill_guided_creation_sessions
          set status = 'failed',
              generated_snapshot_json = $4::jsonb,
              validation_result_json = $5::jsonb,
              error_json = $6::jsonb,
              updated_at = now()
        where id = $1
          and user_id = $2
          and status = 'finalizing'
          and finalize_request_id = $3`,
      [
        input.session_id,
        input.auth_user_id,
        input.request_id,
        input.snapshot ? JSON.stringify(input.snapshot) : null,
        JSON.stringify({ valid: false }),
        JSON.stringify({ code, message, retryable: true }),
      ],
    );
  } catch {
    // Preserve the original generation or transaction error.
  }
}

export async function confirmGuidedCreation(input: {
  auth_user_id: string;
  session_id: string;
  revision_no: number;
  request_id: string;
  on_phase?: (
    phase: 'generating' | 'validating' | 'saving',
  ) => void;
  on_preview?: (preview: {
    type: string;
    name: string;
    content: string;
  }) => void;
}): Promise<GuidedCreationSessionDetail> {
  if (
    typeof input.request_id !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(input.request_id)
  ) {
    throw new GuidedCreationError(
      'INVALID_FINALIZE_REQUEST_ID',
      'request_id 格式不正确',
      400,
    );
  }
  const session = await getGuidedCreationDetail({
    auth_user_id: input.auth_user_id,
    session_id: input.session_id,
  });
  if (session.status === 'completed') return session;
  if (session.revision_no !== input.revision_no) {
    throw new GuidedCreationError(
      'SESSION_REVISION_CONFLICT',
      '草稿已更新，请刷新后重试',
      409,
      true,
    );
  }
  if (session.status === 'finalizing') {
    const leaseAge = Date.now() - new Date(session.updated_at).getTime();
    if (leaseAge < GUIDED_FINALIZE_LEASE_MS) {
      throw new GuidedCreationError(
        'FINALIZATION_IN_PROGRESS',
        'Skill 正在生成中',
        409,
        true,
      );
    }
  } else if (
    session.status !== 'ready_for_confirmation' &&
    session.status !== 'failed'
  ) {
    throw new GuidedCreationError(
      'GUIDED_SESSION_NOT_READY',
      '请先完成需求确认',
      409,
    );
  }

  const claimed = await query(
    `update skill_guided_creation_sessions
        set status = 'finalizing',
            finalize_request_id = $4,
            error_json = null,
            updated_at = now()
      where id = $1
        and user_id = $2
        and revision_no = $3
        and (
          status in ('ready_for_confirmation', 'failed')
          or (status = 'finalizing' and updated_at < now() - interval '10 minutes')
        )`,
    [
      input.session_id,
      input.auth_user_id,
      input.revision_no,
      input.request_id,
    ],
  );
  if (claimed.rowCount !== 1) {
    throw new GuidedCreationError(
      'FINALIZATION_IN_PROGRESS',
      'Skill 正在生成中',
      409,
      true,
    );
  }

  let snapshot: AgentPackageSnapshot | null = null;
  try {
    input.on_phase?.('generating');
    snapshot = await buildGeneratedPackageSnapshot({
      instruction:
        session.flow_version >= 3
          ? buildGuidedEducationGenerationInstruction(
              session.education_draft ?? {},
            )
          : buildGuidedGenerationInstruction(session.draft),
      model: session.model ?? undefined,
      documents: session.documents.map((document) => ({
        name: document.name,
        content: document.content,
      })),
      max_skills: 1,
      onPreview: input.on_preview,
    });
    input.on_phase?.('validating');
    if (snapshot.skills.length !== 1) {
      throw new GuidedCreationError(
        'INVALID_GENERATED_SKILL_COUNT',
        '生成结果必须且只能包含一个 Skill',
        422,
        true,
      );
    }

    input.on_phase?.('saving');
    await withTransaction(async (client) => {
      const locked = await client.query<Record<string, unknown>>(
        `select id
           from skill_guided_creation_sessions
          where id = $1
            and user_id = $2
            and status = 'finalizing'
            and finalize_request_id = $3
            and revision_no = $4
          for update`,
        [
          input.session_id,
          input.auth_user_id,
          input.request_id,
          input.revision_no,
        ],
      );
      if (!locked.rows[0]) {
        throw new GuidedCreationError(
          'FINALIZATION_LEASE_LOST',
          '生成任务状态已变化，请刷新后重试',
          409,
          true,
        );
      }
      const created = await createPackageWithSnapshotTx(
        client,
        input.auth_user_id,
        snapshot!,
        'generated',
      );
      const mapping = await client.query<Record<string, unknown>>(
        `select skill_id, skill_version_id
           from agent_package_version_skills
          where package_version_id = $1 and package_id = $2
          order by sort_order asc
          limit 1`,
        [created.packageVersionId, created.packageId],
      );
      const skillId = mapping.rows[0]?.skill_id;
      const skillVersionId = mapping.rows[0]?.skill_version_id;
      if (!skillId || !skillVersionId) {
        throw new GuidedCreationError(
          'SKILL_VERSION_PERSIST_FAILED',
          'Skill 版本保存失败',
          500,
          true,
        );
      }
      const completed = await client.query(
        `update skill_guided_creation_sessions
            set status = 'completed',
                generated_snapshot_json = $5::jsonb,
                validation_result_json = $6::jsonb,
                package_id = $7,
                skill_id = $8,
                skill_version_id = $9,
                error_json = null,
                completed_at = now(),
                updated_at = now()
          where id = $1
            and user_id = $2
            and finalize_request_id = $3
            and revision_no = $4
            and status = 'finalizing'`,
        [
          input.session_id,
          input.auth_user_id,
          input.request_id,
          input.revision_no,
          JSON.stringify(snapshot),
          JSON.stringify({ valid: true, skill_count: 1 }),
          created.packageId,
          skillId,
          skillVersionId,
        ],
      );
      if (completed.rowCount !== 1) {
        throw new GuidedCreationError(
          'FINALIZATION_LEASE_LOST',
          '生成任务状态已变化，请刷新后重试',
          409,
          true,
        );
      }
    });
  } catch (error) {
    await markFinalizationFailed({
      auth_user_id: input.auth_user_id,
      session_id: input.session_id,
      request_id: input.request_id,
      snapshot,
      error,
    });
    if (error instanceof GuidedCreationError) throw error;
    throw new GuidedCreationError(
      'SKILL_GENERATION_FAILED',
      'Skill 生成或保存失败，请重试',
      500,
      true,
    );
  }

  return getGuidedCreationDetail({
    auth_user_id: input.auth_user_id,
    session_id: input.session_id,
  });
}
