import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8');
const multimodalCss = () => read('../styles/multimodal-workbench.css');

describe('multimodal wizard UI contract', () => {
  it('uses an ordered four-step process and a fixed action bar', () => {
    const shell = read('./MultimodalWizardShell.tsx');

    expect(shell).toContain('<ol className="skill-mm-steps"');
    expect(shell).toContain(
      "aria-current={status === 'current' ? 'step' : undefined}",
    );
    expect(shell).toContain('第 {currentIndex + 1}/4 步');
    expect(shell).toContain('skill-mm-actionbar');
  });

  it('keeps future steps non-interactive while completed steps remain reviewable', () => {
    const shell = read('./MultimodalWizardShell.tsx');

    expect(shell).toContain('index <= activeIndex');
    expect(shell).toContain('props.onReviewStep(step.key)');
    expect(shell).toContain('<div className="skill-mm-step-content">');
  });

  it('uses one page-level scroll context without nested scroll panes', () => {
    const css = multimodalCss();

    expect(css).toMatch(
      /\.skill-multimodal-view\s*\{[^}]*overflow-y:\s*auto;/s,
    );
    expect(css).toMatch(
      /\.skill-mm-shell\s*\{[^}]*grid-template-rows:\s*auto auto 1fr auto;[^}]*min-height:\s*100%;/s,
    );
    expect(css).toMatch(/\.skill-mm-main\s*\{[^}]*align-items:\s*start;/s);
    expect(css).toMatch(
      /\.skill-mm-media\s*\{[^}]*position:\s*sticky;[^}]*top:\s*10px;/s,
    );
    expect(css).not.toMatch(
      /\.skill-mm-media,\s*\n\.skill-mm-task\s*\{[^}]*overflow:\s*auto;/s,
    );
    expect(css).not.toMatch(
      /\.skill-mm-now-evidence\s*\{[^}]*overflow:\s*auto;/s,
    );
    expect(css).toMatch(
      /\.skill-mm-actionbar\s*\{[^}]*position:\s*sticky;[^}]*bottom:\s*0;/s,
    );
  });

  it('shows four stable processing nodes and automatic recovery guidance', () => {
    const source = read('./MultimodalProgressStep.tsx');

    expect(source).toContain("label: '安全校验'");
    expect(source).toContain("label: '媒体预处理'");
    expect(source).toContain("label: '语音转录'");
    expect(source).toContain("label: '关键帧与证据'");
    expect(source).toContain('系统已自动尝试恢复');
    expect(source).toContain('查看处理诊断');
    expect(source).not.toContain('重试此步骤');
    expect(multimodalCss()).toContain('.skill-mm-auto-recovery-note');
  });

  it('keeps the multimodal workflow mounted and defers large inspector searches', () => {
    const panel = read('../MultimodalSkillCreationPanel.tsx');
    const inspector = read('./MultimodalDataDrawers.tsx');

    expect(panel).toContain('<InspectorPortal owner="multimodal">');
    expect(panel).not.toContain('key={inspectorState.descriptor');
    expect(inspector).toContain('useDeferredValue');
  });

  it('keeps the nearest time-aligned evidence beside the player', () => {
    const source = read('./MediaReviewPane.tsx');

    expect(source).toContain('当前时间的证据');
    expect(source).toContain('即将出现的证据');
    expect(source).toContain('最近的证据');
    expect(source).toContain('visibleEvidence.map');
    expect(source).not.toContain('evidenceTimeline.evidenceItems.map');
    expect(source).toContain('完整转录');
    expect(source).toContain('证据库');
  });

  it('renders Chinese Adler layers and only one compact default statement', () => {
    const source = read('./MultimodalOverviewStep.tsx');

    expect(source).toContain('ADLER_LAYER_LABELS[layer]');
    expect(source).toContain('.slice(0, 1)');
    expect(source).not.toContain('.slice(0, 2)');
    expect(source).toContain('查看全部');
    expect(source).toContain('onSelectEvidence');
    expect(source).not.toContain('<pre>');
  });

  it('uses the shared non-modal inspector and virtualizes complete data lists', () => {
    const panel = read('../MultimodalSkillCreationPanel.tsx');
    const data = read('./MultimodalDataDrawers.tsx');

    expect(panel).toContain('<InspectorPortal owner="multimodal">');
    expect(panel).toContain('openMultimodalInspector');
    expect(panel).toContain('setInspectorDirty');
    expect(data).toContain('MultimodalInspectorContent');
    expect(data).not.toContain('MultimodalDrawer');
    expect(data).not.toContain('Dialog.');
    expect(data).toContain('useVirtualizer');
    expect(data).toContain('getVirtualItems()');
    expect(data).toContain('measureElement');
    expect(data).toContain('role="status"');
    expect(data).toContain('aria-live="polite"');
    expect(data).toContain('低置信度');
    expect(data).toContain('证据类型');
  });

  it('restores the selected multimodal item from an inspector deep link', () => {
    const panel = read('../MultimodalSkillCreationPanel.tsx');

    expect(panel).toContain('inspectorState.descriptor?.itemId');
    expect(panel).toContain('ADLER_LAYER_KEYS.includes');
    expect(panel).toContain('candidate.candidateId === itemId');
    expect(panel).toContain('skill.id === itemId');
  });

  it('does not render a complete transcript or evidence array outside a virtual list', () => {
    const data = read('./MultimodalDataDrawers.tsx');

    expect(data).not.toContain('transcript.segments.map');
    expect(data).not.toContain('evidenceItems.map');
    expect(data).toContain('overscan: 6');
  });

  it('shows fused topics as selectable cards with attribution and inspector edits', () => {
    const source = read('./MultimodalCandidateStep.tsx');

    expect(source).toContain('paginateMultimodalItems(props.topics, page, 6)');
    expect(source).toContain(
      '已选择 {props.selectedCandidateIds.length}/{props.topics.length}',
    );
    expect(source).toContain('props.onEditTopic');
    expect(source).toContain('查看详情与来源');
    expect(source).not.toContain('expandedTopicId');
    expect(source).not.toContain('skill-mm-topic-sources');
    expect(source).not.toContain('<textarea');

    const inspector = read('./MultimodalDataDrawers.tsx');
    expect(inspector).toContain('融合来源');
  });

  it('edits, splits, and discards candidates inside the focused inspector', () => {
    const source = read('./MultimodalDataDrawers.tsx');

    expect(source).toContain("props.view === 'candidate'");
    expect(source).toContain('候选标题');
    expect(source).toContain('props.onUpdateCandidate');
    expect(source).toContain('props.onSplitCandidate');
    expect(source).toContain('props.onDiscardCandidate');
  });

  it('shows a compact direct-generation review without Arena or nested accordions', () => {
    const source = read('./MultimodalReleaseStep.tsx');

    expect(source).toContain('props.onOpenSkill');
    expect(source).not.toContain('<pre>{skill.skillMd}</pre>');
    expect(source).toContain('确认生成');
    expect(source).not.toContain('Arena');
    expect(source).not.toContain('<details');
    expect(source).toContain('进入工作区试用');
    expect(source).toContain('进入 Skill 仓库');
  });

  it('hides engineering package identifiers from the completion result', () => {
    const source = read('./MultimodalReleaseStep.tsx');

    expect(source).not.toContain('Package #');
    expect(source).not.toContain('packageVersionId');
    expect(source).toContain('已加入工作区并保存到 Skill 仓库');
  });

  it('mounts one current step instead of the legacy vertical sections', () => {
    const panel = read('../MultimodalSkillCreationPanel.tsx');

    expect(panel).toContain('<MultimodalWizardShell');
    expect(panel).toContain("reviewStep === 'processing'");
    expect(panel).toContain("reviewStep === 'overview'");
    expect(panel).toContain("reviewStep === 'candidates'");
    expect(panel).toContain("reviewStep === 'release'");
    expect(panel).not.toContain('skill-media-transcript-list');
    expect(panel).not.toContain('skill-media-evidence-grid');
    expect(panel).not.toContain('skill-media-adler-grid');
  });

  it('keeps diagnostics instead of manual retry inside a failed later-stage context', () => {
    const panel = read('../MultimodalSkillCreationPanel.tsx');

    expect(panel).toContain("detail?.mediaStage === 'failed'");
    expect(panel).toContain('系统已自动尝试恢复，仍未成功。请查看诊断。');
    expect(panel).not.toContain('retryProcessing');
    expect(panel).not.toContain('重试此步骤');
    expect(panel).not.toContain('请稍后重试');
    expect(panel).toContain('reviewStep === activeStep');
  });

  it('only presents retained fused topics for selection', () => {
    const panel = read('../MultimodalSkillCreationPanel.tsx');

    expect(panel).toContain("item.passKey === 'fused'");
    expect(panel).toContain('item.validation?.overallPassed');
    expect(panel).toContain("item.validation.disposition === 'retain'");
    expect(panel).toContain('retainedFusedIds.has(id)');
  });

  it('prevents overlapping reconciliation requests', () => {
    const panel = read('../MultimodalSkillCreationPanel.tsx');

    expect(panel).toContain('pollInFlight');
    expect(panel).toContain('mediaReconcileIntervalMs(state.connection)');
    expect(panel).toContain("state.connection === 'sse'");
    expect(panel).toContain('Promise.resolve(null)');
  });

  it('reuses the generation request key and reconciles a lost success response', () => {
    const panel = read('../MultimodalSkillCreationPanel.tsx');

    expect(panel).toMatch(
      /mediaOperationIdempotencyKey\(\s*'generate-confirm'/,
    );
    expect(panel).toContain('confirmMediaGenerationReliably({');
    expect(panel).toContain('getDetail: () => liteApi.getMediaSessionDetail');
  });
});
