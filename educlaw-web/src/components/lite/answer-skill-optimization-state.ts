import type {
  ArenaAnswerOptimizationStatus,
  ArenaAnswerOptimizationSummary,
  ArenaAnswerOptimizationUnavailableReason,
} from '@educlaw/shared';
import type {
  AnswerSkillOptimizationDetail,
  AnswerSkillRefinementTechnicalFailureCode,
} from '../../api/answer-skill-optimizations';

type AnswerOptimizationReusability = NonNullable<
  AnswerSkillOptimizationDetail['diagnosis']
>['reusability'];
type AnswerOptimizationPatch = NonNullable<
  AnswerSkillOptimizationDetail['patch']
>;

export interface AnswerOptimizationButtonState {
  label: string;
  disabled: boolean;
  intent: 'create' | 'open' | 'none';
  hint: string;
}

const REUSABILITY_LABELS: Record<AnswerOptimizationReusability, string> = {
  reusable: '可复用改进',
  single_turn: '仅适用于本次回答',
  unclear: '反馈不明确',
};

const PATCH_SECTION_LABELS: Record<AnswerOptimizationPatch['section'], string> =
  {
    Instructions: '指令',
    Workflow: '工作流程',
    'Output Format': '输出格式',
    Examples: '示例',
    'Common Issues': '常见问题',
  };

const PATCH_OPERATION_LABELS: Record<
  AnswerOptimizationPatch['operation'],
  string
> = {
  replace: '替换',
  append: '追加',
  add_section: '新增章节',
};

const STATUS_LABELS: Record<ArenaAnswerOptimizationStatus, string> = {
  processing: '正在处理',
  target_selection_required: '需要选择目标 Skill',
  draft_ready: '草稿已生成',
  test_ready: '草稿效果已预览',
  completed: '已完成',
  cancelled: '已取消',
  failed: '处理失败',
};

const FAILURE_LABELS: Readonly<Record<string, string>> = {
  feedback_not_reusable:
    '这条要求更适合只修改当前回答，不建议写入以后所有类似回答的规则',
  feedback_unclear:
    '这条意见还不够具体，请说明希望保留、删除或加强哪部分内容',
  operation_interrupted: '上次操作被中断，请重新尝试',
  replay_context_unavailable: '缺少完整上下文记录，无法继续优化',
  replay_model_unavailable: '缺少实际模型记录，无法继续优化',
  skill_validation_failed: 'Skill 草稿格式校验失败，请重新生成',
  model_unavailable: '模型服务暂时不可用，请稍后重试',
  model_output_invalid: '模型返回内容无法解析，请重新尝试',
  evaluation_invalid: '重测评估结果无法解析，请重新重测',
  context_invalid: '回答上下文校验失败，无法继续优化',
  replay_provenance_unavailable: '该历史回答缺少完整生成记录，无法继续优化',
  'Optimization model is temporarily unavailable':
    '模型服务暂时不可用，请稍后重试',
};

const REFINEMENT_TECHNICAL_FAILURE_LABELS: Record<
  AnswerSkillRefinementTechnicalFailureCode,
  string
> = {
  model_unavailable: '模型服务暂时不可用，可以使用相同意见重试',
  invalid_model_output: '模型生成的规则格式不符合要求，可以使用相同意见重试',
  patch_application_failed: '生成的修改无法安全应用到当前规则',
  skill_validation_failed: '修改后的规则未通过格式校验',
  revision_conflict: '草稿已在其他操作中更新，请刷新后重试',
  unknown: '处理过程中发生未知错误，可以稍后重试',
};

export function formatRefinementTechnicalFailure(
  code: AnswerSkillRefinementTechnicalFailureCode,
): string {
  return REFINEMENT_TECHNICAL_FAILURE_LABELS[code];
}

const UNAVAILABLE_REASON_LABELS: Record<
  ArenaAnswerOptimizationUnavailableReason,
  string
> = {
  missing_answer_run: '缺少回答生成记录，暂不支持优化',
  replay_context_unavailable: '缺少完整上下文记录，暂不支持优化',
  replay_model_unavailable: '缺少实际模型记录，暂不支持优化',
};

export function formatOptimizationReusability(
  value: AnswerOptimizationReusability,
): string {
  return REUSABILITY_LABELS[value];
}

export function formatOptimizationPatchSection(
  value: AnswerOptimizationPatch['section'],
): string {
  return PATCH_SECTION_LABELS[value];
}

export function formatOptimizationPatchOperation(
  value: AnswerOptimizationPatch['operation'],
): string {
  return PATCH_OPERATION_LABELS[value];
}

export function formatOptimizationStatus(
  value: ArenaAnswerOptimizationStatus,
): string {
  return STATUS_LABELS[value];
}

export function formatOptimizationFailure(
  value: string | null | undefined,
): string {
  if (!value) return '处理失败，请稍后重试';
  return FAILURE_LABELS[value] ?? '处理失败，请稍后重试';
}

export function formatOptimizationUnavailableReason(
  value: ArenaAnswerOptimizationUnavailableReason | string | null | undefined,
): string {
  if (!value || !(value in UNAVAILABLE_REASON_LABELS)) {
    return '该历史回答缺少完整生成记录，暂不支持优化';
  }
  return UNAVAILABLE_REASON_LABELS[
    value as ArenaAnswerOptimizationUnavailableReason
  ];
}

export function getAnswerOptimizationFlowStep(
  detail: AnswerSkillOptimizationDetail | null,
): 1 | 2 | 3 | 4 {
  if (!detail) return 1;
  if (detail.status === 'completed') return 4;
  if (detail.status === 'test_ready') return 3;
  if (detail.draft?.validation.valid) return 2;
  return 1;
}

export function getAnswerOptimizationFailureReasons(
  detail: AnswerSkillOptimizationDetail,
): string[] {
  const testResult = detail.testResult;
  if (!testResult || testResult.qualityGate.passed) return [];
  const reasons = new Set<string>();
  const add = (value: string) => {
    const normalized = value.trim();
    if (normalized) reasons.add(normalized);
  };
  for (const sample of testResult.samples) {
    if (sample.passed && !sample.criticalRisk) continue;
    sample.unmetRequirements.forEach(add);
    sample.riskNotes.forEach(add);
    if (sample.criticalRisk) add('重测回答中存在严重风险');
  }
  if (!testResult.runtimeSelectionCheck.targetSkillSelected) {
    add('正常回答流程没有选中本次修改的规则模块');
  }
  if (reasons.size === 0) {
    add(testResult.qualityGate.overallSummary);
  }
  return [...reasons];
}

export interface AnswerOptimizationFailureReasonGroup {
  label: string;
  reasons: string[];
}

const FAILURE_REASON_GROUPS = [
  {
    label: '称呼与事实认定',
    keywords: ['称呼', '定性', '标签', '事实', '施暴', '受害', '霸凌'],
  },
  {
    label: '家长沟通',
    keywords: ['家长', '监护人', '家庭', '联系'],
  },
  {
    label: '道歉和修复性沟通',
    keywords: ['道歉', '和解', '修复', '见面'],
  },
  {
    label: '学生隐私与监控',
    keywords: ['隐私', '监控', '监督', '公开', '姓名'],
  },
  {
    label: '风险筛查',
    keywords: ['风险', '安全', '伤害', '法律', '危机'],
  },
  {
    label: '处理顺序',
    keywords: ['顺序', '步骤', '流程', '当天', '第一天'],
  },
] as const;

function failureReasonGroupLabel(reason: string): string {
  return (
    FAILURE_REASON_GROUPS.find((group) =>
      group.keywords.some((keyword) => reason.includes(keyword)),
    )?.label ?? '其他'
  );
}

export function getAnswerOptimizationFailureReasonGroups(
  detail: AnswerSkillOptimizationDetail,
): {
  visible: AnswerOptimizationFailureReasonGroup[];
  hidden: AnswerOptimizationFailureReasonGroup[];
} {
  const reasons = getAnswerOptimizationFailureReasons(detail);
  const grouped = new Map<string, string[]>();
  for (const reason of reasons) {
    const label = failureReasonGroupLabel(reason);
    const existing = grouped.get(label) ?? [];
    if (!existing.includes(reason)) existing.push(reason);
    grouped.set(label, existing);
  }
  const flattened = [...grouped.entries()].flatMap(([label, values]) =>
    values.map((reason) => ({ label, reason })),
  );
  const toGroups = (
    items: Array<{ label: string; reason: string }>,
  ): AnswerOptimizationFailureReasonGroup[] => {
    const result = new Map<string, string[]>();
    for (const item of items) {
      result.set(item.label, [...(result.get(item.label) ?? []), item.reason]);
    }
    return [...result.entries()].map(([label, groupedReasons]) => ({
      label,
      reasons: groupedReasons,
    }));
  };
  return {
    visible: toGroups(flattened.slice(0, 5)),
    hidden: toGroups(flattened.slice(5)),
  };
}

export function formatUuidV4(bytes: Uint8Array): string {
  if (bytes.length !== 16) {
    throw new Error('UUID v4 requires exactly 16 bytes');
  }
  const normalized = Uint8Array.from(bytes);
  normalized[6] = (normalized[6] & 0x0f) | 0x40;
  normalized[8] = (normalized[8] & 0x3f) | 0x80;
  const hex = Array.from(normalized, (value) =>
    value.toString(16).padStart(2, '0'),
  ).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

export function createIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return formatUuidV4(bytes);
}

export function getAnswerOptimizationButtonState(
  summary: ArenaAnswerOptimizationSummary,
): AnswerOptimizationButtonState {
  switch (summary.action) {
    case 'create':
      return {
        label: '优化这次回答',
        disabled: false,
        intent: 'create',
        hint: '根据这次回答和你的反馈改进 Skill',
      };
    case 'restart':
      return {
        label: '重新优化',
        disabled: false,
        intent: 'create',
        hint: '上一次任务已取消，可重新开始',
      };
    case 'resume':
      return {
        label: '继续优化',
        disabled: false,
        intent: 'open',
        hint: '恢复尚未完成的优化任务',
      };
    case 'completed':
      return {
        label: `已优化为 v${summary.versionNumber ?? '?'}`,
        disabled: true,
        intent: 'none',
        hint: '请基于当前版本重新提问后再继续优化',
      };
    case 'unavailable':
      return {
        label:
          summary.optimizationId === null
            ? '该历史回答不支持优化'
            : '该历史回答不支持继续优化',
        disabled: true,
        intent: 'none',
        hint: formatOptimizationUnavailableReason(summary.unavailableReason),
      };
  }
}

export function getConfirmBlockReason(
  detail: AnswerSkillOptimizationDetail,
): string | null {
  if (!detail.replayAvailability.available) {
    return '该历史回答缺少完整生成记录，不能保存优化版本';
  }
  if (detail.status !== 'test_ready') return '请先完成草稿重测';
  if (
    !detail.targetSkill ||
    !detail.patch ||
    !detail.draft?.validation.valid
  ) {
    return '当前规则草稿不完整或未通过格式校验';
  }
  const result = detail.testResult;
  if (!result || result.testedRevision !== detail.revision) {
    return '当前草稿修订还没有完成重测';
  }
  if (!result.runtimeSelectionCheck.targetSkillSelected) {
    return '正常 Skill 选择器没有选中目标 Skill';
  }
  return null;
}

export interface AnswerOptimizationAvailableActions {
  canRefineDraft: boolean;
  refinementSource: 'draft_review' | 'test_failure';
  refinementRequiresFeedback: boolean;
  canPreviewDraft: boolean;
  canRegenerateAlternative: boolean;
  canConfirm: boolean;
  confirmNeedsAdvisory: boolean;
}

export function getAnswerOptimizationAvailableActions(
  detail: AnswerSkillOptimizationDetail,
): AnswerOptimizationAvailableActions {
  const replayAvailable = detail.replayAvailability.available;
  const hasValidDraft = Boolean(detail.draft?.validation.valid);
  const previewHasIssues =
    detail.status === 'test_ready' &&
    Boolean(detail.testResult) &&
    !detail.testResult!.qualityGate.passed;
  const confirmBlockReason = getConfirmBlockReason(detail);
  return {
    canRefineDraft:
      replayAvailable &&
      hasValidDraft &&
      ['draft_ready', 'test_ready', 'failed'].includes(detail.status),
    refinementSource: previewHasIssues ? 'test_failure' : 'draft_review',
    refinementRequiresFeedback: !previewHasIssues,
    canPreviewDraft:
      replayAvailable &&
      hasValidDraft &&
      ['draft_ready', 'test_ready'].includes(detail.status),
    canRegenerateAlternative:
      replayAvailable && hasValidDraft && detail.status === 'draft_ready',
    canConfirm: confirmBlockReason === null,
    confirmNeedsAdvisory:
      confirmBlockReason === null && previewHasIssues,
  };
}

export function formatAnswerOptimizationSampleAssessment(sample: {
  passed: boolean;
  criticalRisk: boolean;
}): '总体符合' | '部分符合' | '建议改进' {
  if (sample.criticalRisk) return '建议改进';
  return sample.passed ? '总体符合' : '部分符合';
}
