import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const panelSource = readFileSync(
  new URL('./LiteArenaPanel.tsx', import.meta.url),
  'utf8',
);
const boardSource = readFileSync(
  new URL('./lite-rendering.tsx', import.meta.url),
  'utf8',
);
const dialogSource = readFileSync(
  new URL('./AnswerSkillOptimizationDialog.tsx', import.meta.url),
  'utf8',
);
const apiSource = readFileSync(
  new URL('../../api/answer-skill-optimizations.ts', import.meta.url),
  'utf8',
);

test('thread detail supplies answer summaries to the board without per-card requests', () => {
  assert.match(
    panelSource,
    /answerOptimizations=\{threadDetail\?\.answerOptimizations \|\| \[\]\}/,
  );
  assert.match(panelSource, /refreshAnswerOptimizationSummaries/);
  assert.doesNotMatch(
    boardSource,
    /liteApi|answerSkillOptimizationApi|fetch\(/,
  );
});

test('only a persisted enhanced answer with a summary renders the optimization action', () => {
  assert.match(boardSource, /typeof enhancedMsg\.id === 'number'/);
  assert.match(boardSource, /optimizationByAnswerId\.get\(enhancedMsg\.id\)/);
  assert.match(boardSource, /!\(sideStreaming\.enhanced && isLatest\)/);
  assert.match(boardSource, /onOptimizeAnswer\?\.\(\{/);
  assert.match(panelSource, /input\.summary\.action === 'unavailable'/);
  assert.match(panelSource, /!input\.summary\.canOptimize/);
});

test('the dialog explains the draft workflow in ordinary user-facing language', () => {
  assert.match(dialogSource, /提出反馈/);
  assert.match(dialogSource, /查看并修改规则草稿/);
  assert.match(dialogSource, /预览草稿效果/);
  assert.match(dialogSource, /确认保存新版本/);
  assert.match(dialogSource, /当前内容只是草稿，尚未影响正式版本/);
  assert.match(dialogSource, /我们理解到的问题/);
  assert.match(dialogSource, /AI 准备怎样修改回答规则/);
  assert.match(dialogSource, /当前展示：草稿 v\{detail\.revision\}/);
  assert.match(dialogSource, /这是最近一次成功生成的规则草稿/);
  assert.match(dialogSource, /失败的修改尝试不会改变这里的内容/);
  assert.match(dialogSource, /当前规则与草稿 v\$\{detail\.revision\}/);
  assert.match(dialogSource, /当前版本中的规则/);
  assert.match(dialogSource, /草稿 v\{detail\.revision\} 准备写入的规则/);
  assert.match(dialogSource, /这里只展示本次涉及的规则片段/);
});

test('the dialog exposes refinement, three-sample preview, and confirm states', () => {
  assert.match(dialogSource, /detail\.testResult\.samples\.map/);
  assert.match(dialogSource, /草稿效果预览/);
  assert.match(dialogSource, /效果较稳定/);
  assert.match(dialogSource, /发现可改进点/);
  assert.match(dialogSource, /AI 评估仅供参考/);
  assert.doesNotMatch(dialogSource, /质量门已通过|质量门未通过/);
  assert.match(dialogSource, /runtimeSelectionCheck\.targetSkillSelected/);
  assert.match(dialogSource, /getConfirmBlockReason\(detail\)/);
  assert.match(dialogSource, /!detail\.replayAvailability\.available/);
  assert.match(dialogSource, /已有诊断和草稿仍可查看/);
  assert.match(dialogSource, /确认保存新版本/);
  assert.match(dialogSource, /formatOptimizationReusability/);
  assert.match(dialogSource, /formatOptimizationPatchSection/);
  assert.match(dialogSource, /formatOptimizationPatchOperation/);
  assert.match(dialogSource, /formatOptimizationStatus/);
  assert.match(dialogSource, /formatOptimizationFailure/);
  assert.match(dialogSource, /formatOptimizationUnavailableReason/);
  assert.match(dialogSource, /已满足的要求：/);
  assert.doesNotMatch(dialogSource, /\{detail\.patch\.(?:section|operation)\}/);
  assert.match(dialogSource, /\{detail\.patch\.reason\}/);
  assert.match(dialogSource, /\{detail\.diagnosis\.summary\}/);
  assert.match(dialogSource, /detail\?\.failureCode/);
  assert.doesNotMatch(dialogSource, /detail\.diagnosis\.reusability ===/);
  assert.match(dialogSource, /detail\.refinementHistory\.map/);
  assert.match(dialogSource, /你的意见：/);
  assert.match(dialogSource, /系统已调整：/);
  assert.match(dialogSource, /还需要你再说明一点/);
  assert.match(dialogSource, /这条意见更适合当前这一次回答/);
  assert.match(dialogSource, /这次没有生成新草稿/);
  assert.match(dialogSource, /根据我的意见修改当前草稿/);
  assert.match(dialogSource, /按预览问题修改当前草稿/);
  assert.match(dialogSource, /结合预览问题和我的意见修改当前草稿/);
  assert.match(dialogSource, /重新试运行当前草稿/);
  assert.match(dialogSource, /不会修改草稿 v\{detail\.revision\}/);
  assert.match(dialogSource, /getAnswerOptimizationFailureReasonGroups/);
  assert.match(dialogSource, /查看其余可改进内容/);
});

test('API mutations send IDs and feedback but never a client-owned package snapshot', () => {
  assert.match(apiSource, /questionMessageId: number/);
  assert.match(apiSource, /enhancedAnswerMessageId: number/);
  assert.match(apiSource, /'Idempotency-Key': idempotencyKey/);
  assert.doesNotMatch(apiSource, /fullPackageSnapshot|result_json/);
  assert.doesNotMatch(
    apiSource,
    /interface CreateAnswerOptimizationInput[\s\S]*?skillMd:/,
  );
});

test('revise submits only the selected Skill IDs while resolving target selection', () => {
  assert.match(dialogSource, /const isTargetSelection =/);
  assert.match(dialogSource, /isTargetSelection && selectedSkillIds\.length === 1/);
  assert.match(dialogSource, /\{ targetSkillId: selectedSkillIds\[0\] \}/);
  assert.match(dialogSource, /\{ targetSkillIds: selectedSkillIds \}/);
  assert.match(dialogSource, /\.\.\.targetSelectionPayload/);
});

test('draft refinement submits only the opinion, source, and current revision', () => {
  assert.match(
    dialogSource,
    /\.\.\.\(normalized \? \{ additionalFeedback: normalized \} : \{\}\)/,
  );
  assert.match(dialogSource, /revisionSource: 'draft_review' as const/);
  assert.match(dialogSource, /revisionSource: 'test_failure' as const/);
  assert.match(dialogSource, /expectedRevision:\s*detail\.revision/);
  assert.doesNotMatch(
    apiSource,
    /additionalFeedback:[\s\S]{0,180}(?:skillMd|testResult|patch|draft|snapshot):/,
  );
  assert.match(dialogSource, /applyDetail\(response\.data\)/);
});

test('retesting the current draft remains separate from revising it', () => {
  assert.match(dialogSource, /onClick=\{\(\) => void handleTest\(\)\}/);
  assert.match(
    dialogSource,
    /handleRefineDraft\(\s*availableActions\.refinementSource,\s*\)/,
  );
  assert.match(dialogSource, /revisionSource: 'alternative_regeneration'/);
  assert.match(dialogSource, /availableActions\.canRegenerateAlternative/);
  assert.match(
    dialogSource,
    /根据目前所有要求重新生成另一版草稿/,
  );
  assert.match(dialogSource, /不会沿用当前草稿的具体写法/);
});

test('the final button model separates draft, failed-test, and passed-test actions', () => {
  assert.match(dialogSource, /用当前草稿试运行/);
  assert.match(dialogSource, /重新试运行当前草稿/);
  assert.match(dialogSource, /根据我的意见继续修改当前草稿/);
  assert.match(dialogSource, /确认保存新版本/);
  assert.match(dialogSource, /availableActions\.canRegenerateAlternative && \(/);
  assert.doesNotMatch(
    dialogSource,
    /detail\.testResult\?\.qualityGate\.passed && \(/,
  );
  assert.match(dialogSource, /availableActions\.confirmNeedsAdvisory/);
  assert.match(dialogSource, /AI 评估仍发现可改进点/);
  assert.match(dialogSource, /返回继续修改/);
  assert.match(dialogSource, /仍然保存新版本/);
  assert.match(dialogSource, /onClick=\{requestConfirm\}/);
});

test('the advisory dialog is the only extra step before a concerned preview is saved', () => {
  assert.match(
    dialogSource,
    /if \(availableActions\.confirmNeedsAdvisory\) \{\s*setConfirmWarningOpen\(true\);\s*return;/,
  );
  assert.match(
    dialogSource,
    /setConfirmWarningOpen\(false\);\s*void handleConfirm\(\);/,
  );
  assert.match(dialogSource, /advisoryIssues\.map/);
});

test('refinement outcomes are explicit and technical failures are localized', () => {
  assert.match(dialogSource, /outcome\?\.kind === 'needs_clarification'/);
  assert.match(
    dialogSource,
    /outcome\?\.kind ===\s*'not_suitable_for_shared_rule'/,
  );
  assert.match(dialogSource, /outcome\?\.kind === 'technical_failure'/);
  assert.match(dialogSource, /formatRefinementTechnicalFailure\(outcome\.code\)/);
  assert.match(dialogSource, /当前仍为草稿 v\{turn\.fromRevision\}/);
});

test('an immediate mutation ref blocks double clicks before React rerenders', () => {
  assert.match(
    dialogSource,
    /if \(activeMutation\.current !== null\) return false;/,
  );
  assert.match(dialogSource, /activeMutation\.current = action;/);
  assert.match(dialogSource, /if \(!beginOperation\('refine'\)\) return;/);
  assert.match(dialogSource, /disabled=\{\s*Boolean\(busyAction\)/);
});
