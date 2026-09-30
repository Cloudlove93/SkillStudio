import { strict as assert } from 'node:assert';
import test from 'node:test';
import type { ArenaAnswerOptimizationSummary } from '@educlaw/shared';
import type { AnswerSkillOptimizationDetail } from '../../api/answer-skill-optimizations';
import {
  createIdempotencyKey,
  formatOptimizationFailure,
  formatOptimizationPatchOperation,
  formatOptimizationPatchSection,
  formatOptimizationReusability,
  formatOptimizationStatus,
  formatOptimizationUnavailableReason,
  formatAnswerOptimizationSampleAssessment,
  formatRefinementTechnicalFailure,
  formatUuidV4,
  getAnswerOptimizationAvailableActions,
  getAnswerOptimizationButtonState,
  getConfirmBlockReason,
  getAnswerOptimizationFailureReasonGroups,
  getAnswerOptimizationFailureReasons,
  getAnswerOptimizationFlowStep,
} from './answer-skill-optimization-state.ts';

function summary(
  action: ArenaAnswerOptimizationSummary['action'],
  overrides: Partial<ArenaAnswerOptimizationSummary> = {},
): ArenaAnswerOptimizationSummary {
  return {
    enhancedAnswerMessageId: 12,
    optimizationId: action === 'create' || action === 'unavailable' ? null : 20,
    status:
      action === 'create' || action === 'unavailable' ? null : 'draft_ready',
    finalVersionId: null,
    versionNumber: null,
    canOptimize:
      action === 'create' || action === 'restart' || action === 'resume',
    action,
    unavailableReason:
      action === 'unavailable' ? 'replay_context_unavailable' : null,
    ...overrides,
  };
}

for (const [action, label, disabled, intent] of [
  ['create', '优化这次回答', false, 'create'],
  ['resume', '继续优化', false, 'open'],
  ['restart', '重新优化', false, 'create'],
  ['unavailable', '该历史回答不支持优化', true, 'none'],
] as const) {
  test(`maps ${action} to the expected answer action`, () => {
    assert.deepEqual(
      {
        label: getAnswerOptimizationButtonState(summary(action)).label,
        disabled: getAnswerOptimizationButtonState(summary(action)).disabled,
        intent: getAnswerOptimizationButtonState(summary(action)).intent,
      },
      { label, disabled, intent },
    );
  });
}

test('disables a completed answer and shows its version', () => {
  const state = getAnswerOptimizationButtonState(
    summary('completed', {
      status: 'completed',
      finalVersionId: 31,
      versionNumber: 2,
      canOptimize: false,
    }),
  );
  assert.deepEqual(
    {
      label: state.label,
      disabled: state.disabled,
      intent: state.intent,
    },
    {
      label: '已优化为 v2',
      disabled: true,
      intent: 'none',
    },
  );
});

test('disables an existing legacy task instead of offering resume', () => {
  const state = getAnswerOptimizationButtonState(
    summary('unavailable', {
      optimizationId: 20,
      status: 'failed',
      unavailableReason: 'replay_model_unavailable',
    }),
  );

  assert.equal(state.label, '该历史回答不支持继续优化');
  assert.equal(state.disabled, true);
  assert.equal(state.intent, 'none');
  assert.match(state.hint, /缺少实际模型记录/);
});

test('formats all optimization reusability values in Simplified Chinese', () => {
  assert.equal(formatOptimizationReusability('reusable'), '可复用改进');
  assert.equal(
    formatOptimizationReusability('single_turn'),
    '仅适用于本次回答',
  );
  assert.equal(formatOptimizationReusability('unclear'), '反馈不明确');
});

test('formats all patch section and operation values in Simplified Chinese', () => {
  assert.deepEqual(
    [
      'Instructions',
      'Workflow',
      'Output Format',
      'Examples',
      'Common Issues',
    ].map((value) =>
      formatOptimizationPatchSection(
        value as Parameters<typeof formatOptimizationPatchSection>[0],
      ),
    ),
    ['指令', '工作流程', '输出格式', '示例', '常见问题'],
  );
  assert.deepEqual(
    ['replace', 'append', 'add_section'].map((value) =>
      formatOptimizationPatchOperation(
        value as Parameters<typeof formatOptimizationPatchOperation>[0],
      ),
    ),
    ['替换', '追加', '新增章节'],
  );
});

test('formats every optimization status in Simplified Chinese', () => {
  assert.deepEqual(
    [
      'processing',
      'target_selection_required',
      'draft_ready',
      'test_ready',
      'completed',
      'cancelled',
      'failed',
    ].map((value) =>
      formatOptimizationStatus(
        value as Parameters<typeof formatOptimizationStatus>[0],
      ),
    ),
    [
      '正在处理',
      '需要选择目标 Skill',
      '草稿已生成',
      '草稿效果已预览',
      '已完成',
      '已取消',
      '处理失败',
    ],
  );
});

test('formats known failures and hides unknown internal codes', () => {
  assert.equal(
    formatOptimizationFailure('feedback_not_reusable'),
    '这条要求更适合只修改当前回答，不建议写入以后所有类似回答的规则',
  );
  assert.equal(
    formatOptimizationFailure('feedback_unclear'),
    '这条意见还不够具体，请说明希望保留、删除或加强哪部分内容',
  );
  assert.equal(
    formatOptimizationFailure('operation_interrupted'),
    '上次操作被中断，请重新尝试',
  );
  assert.equal(
    formatOptimizationFailure('replay_context_unavailable'),
    '缺少完整上下文记录，无法继续优化',
  );
  assert.equal(
    formatOptimizationFailure('replay_model_unavailable'),
    '缺少实际模型记录，无法继续优化',
  );
  assert.equal(
    formatOptimizationFailure('skill_validation_failed'),
    'Skill 草稿格式校验失败，请重新生成',
  );
  assert.equal(
    formatOptimizationFailure('model_unavailable'),
    '模型服务暂时不可用，请稍后重试',
  );
  assert.equal(
    formatOptimizationFailure('private_internal_code'),
    '处理失败，请稍后重试',
  );
});

test('distinguishes every draft refinement technical failure for users', () => {
  assert.deepEqual(
    [
      'model_unavailable',
      'invalid_model_output',
      'patch_application_failed',
      'skill_validation_failed',
      'revision_conflict',
      'unknown',
    ].map((code) =>
      formatRefinementTechnicalFailure(
        code as Parameters<typeof formatRefinementTechnicalFailure>[0],
      ),
    ),
    [
      '模型服务暂时不可用，可以使用相同意见重试',
      '模型生成的规则格式不符合要求，可以使用相同意见重试',
      '生成的修改无法安全应用到当前规则',
      '修改后的规则未通过格式校验',
      '草稿已在其他操作中更新，请刷新后重试',
      '处理过程中发生未知错误，可以稍后重试',
    ],
  );
});

test('formats provenance unavailability without exposing internal values', () => {
  assert.equal(
    formatOptimizationUnavailableReason('missing_answer_run'),
    '缺少回答生成记录，暂不支持优化',
  );
  assert.equal(
    formatOptimizationUnavailableReason('replay_context_unavailable'),
    '缺少完整上下文记录，暂不支持优化',
  );
  assert.equal(
    formatOptimizationUnavailableReason('replay_model_unavailable'),
    '缺少实际模型记录，暂不支持优化',
  );
  assert.equal(
    formatOptimizationUnavailableReason('unknown_reason'),
    '该历史回答缺少完整生成记录，暂不支持优化',
  );
});

test('allows advisory preview concerns but keeps the real confirm safeguards', () => {
  const detail = {
    status: 'test_ready',
    revision: 2,
    replayAvailability: { available: true, reason: null },
    targetSkill: { skillId: 'skill-one' },
    patch: { section: 'Workflow', operation: 'replace' },
    draft: { validation: { valid: true, errors: [] } },
    testResult: {
      testedRevision: 2,
      qualityGate: { passed: true },
      runtimeSelectionCheck: { targetSkillSelected: true },
    },
  } as AnswerSkillOptimizationDetail;

  assert.equal(getConfirmBlockReason(detail), null);
  const advisory = {
    ...detail,
    testResult: {
      ...detail.testResult!,
      qualityGate: {
        ...detail.testResult!.qualityGate,
        passed: false,
      },
    },
  } as AnswerSkillOptimizationDetail;
  assert.equal(getConfirmBlockReason(advisory), null);
  assert.deepEqual(getAnswerOptimizationAvailableActions(advisory), {
    canRefineDraft: true,
    refinementSource: 'test_failure',
    refinementRequiresFeedback: false,
    canPreviewDraft: true,
    canRegenerateAlternative: false,
    canConfirm: true,
    confirmNeedsAdvisory: true,
  });
  assert.match(
    getConfirmBlockReason({
      ...detail,
      testResult: {
        ...detail.testResult!,
        runtimeSelectionCheck: {
          ...detail.testResult!.runtimeSelectionCheck,
          targetSkillSelected: false,
        },
      },
    }) || '',
    /没有选中目标 Skill/,
  );
  assert.match(
    getConfirmBlockReason({
      ...detail,
      replayAvailability: {
        available: false,
        reason: 'replay_context_unavailable',
      },
    }) || '',
    /缺少完整生成记录/,
  );
});

test('derives draft and preview actions from one policy function', () => {
  const draft = {
    status: 'draft_ready',
    replayAvailability: { available: true, reason: null },
    draft: { validation: { valid: true } },
    testResult: null,
  } as AnswerSkillOptimizationDetail;
  assert.deepEqual(getAnswerOptimizationAvailableActions(draft), {
    canRefineDraft: true,
    refinementSource: 'draft_review',
    refinementRequiresFeedback: true,
    canPreviewDraft: true,
    canRegenerateAlternative: true,
    canConfirm: false,
    confirmNeedsAdvisory: false,
  });
});

test('allows a stable preview to confirm directly while keeping further edits available', () => {
  const detail = {
    status: 'test_ready',
    revision: 2,
    replayAvailability: { available: true, reason: null },
    targetSkill: { skillId: 'skill-one' },
    patch: { section: 'Workflow', operation: 'replace' },
    draft: { validation: { valid: true, errors: [] } },
    testResult: {
      testedRevision: 2,
      qualityGate: { passed: true },
      runtimeSelectionCheck: { targetSkillSelected: true },
    },
  } as AnswerSkillOptimizationDetail;

  assert.deepEqual(getAnswerOptimizationAvailableActions(detail), {
    canRefineDraft: true,
    refinementSource: 'draft_review',
    refinementRequiresFeedback: true,
    canPreviewDraft: true,
    canRegenerateAlternative: false,
    canConfirm: true,
    confirmNeedsAdvisory: false,
  });
});

test('uses plain-language sample assessments instead of presenting AI scores as permission', () => {
  assert.equal(
    formatAnswerOptimizationSampleAssessment({
      passed: true,
      criticalRisk: false,
    }),
    '总体符合',
  );
  assert.equal(
    formatAnswerOptimizationSampleAssessment({
      passed: false,
      criticalRisk: false,
    }),
    '部分符合',
  );
  assert.equal(
    formatAnswerOptimizationSampleAssessment({
      passed: true,
      criticalRisk: true,
    }),
    '建议改进',
  );
});

test('maps draft, test, and completed states to the four user-facing steps', () => {
  assert.equal(getAnswerOptimizationFlowStep(null), 1);
  assert.equal(
    getAnswerOptimizationFlowStep({
      status: 'draft_ready',
      draft: { validation: { valid: true } },
    } as AnswerSkillOptimizationDetail),
    2,
  );
  assert.equal(
    getAnswerOptimizationFlowStep({
      status: 'test_ready',
    } as AnswerSkillOptimizationDetail),
    3,
  );
  assert.equal(
    getAnswerOptimizationFlowStep({
      status: 'completed',
    } as AnswerSkillOptimizationDetail),
    4,
  );
});

test('deduplicates failed quality evidence for the user-facing explanation', () => {
  const detail = {
    testResult: {
      qualityGate: {
        passed: false,
        overallSummary: '沟通措辞仍不够中性。',
      },
      samples: [
        {
          passed: false,
          unmetRequirements: ['沟通措辞仍不够中性。', '缺少替代表述。'],
          riskNotes: ['可能给学生增加监控责任。'],
          criticalRisk: false,
        },
        {
          passed: false,
          unmetRequirements: ['缺少替代表述。'],
          riskNotes: [],
          criticalRisk: true,
        },
        {
          passed: true,
          unmetRequirements: [],
          riskNotes: [],
          criticalRisk: false,
        },
      ],
      runtimeSelectionCheck: {
        targetSkillSelected: false,
      },
    },
  } as AnswerSkillOptimizationDetail;

  assert.deepEqual(getAnswerOptimizationFailureReasons(detail), [
    '沟通措辞仍不够中性。',
    '缺少替代表述。',
    '可能给学生增加监控责任。',
    '重测回答中存在严重风险',
    '正常回答流程没有选中本次修改的规则模块',
  ]);
  const groups = getAnswerOptimizationFailureReasonGroups(detail);
  assert.ok(groups.visible.length > 0);
  assert.equal(
    groups.visible.flatMap((group) => group.reasons).length,
    5,
  );
  assert.equal(groups.hidden.length, 0);
});

test('creates a backend-compatible UUID v4 idempotency key', () => {
  assert.match(
    createIdempotencyKey(),
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  assert.equal(
    formatUuidV4(new Uint8Array(16)),
    '00000000-0000-4000-8000-000000000000',
  );
});
