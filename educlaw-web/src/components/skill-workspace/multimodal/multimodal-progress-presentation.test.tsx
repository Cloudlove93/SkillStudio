// @vitest-environment jsdom

import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  MediaSessionDetail,
  MediaSessionProgress,
} from '../../../api/lite-api';
import { MultimodalInspectorContent } from './MultimodalDataDrawers';
import { MultimodalProgressStep } from './MultimodalProgressStep';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function detail(mediaStage: MediaSessionDetail['mediaStage']): MediaSessionDetail {
  return {
    sessionId: '101',
    displayName: '函数课程蒸馏',
    status: 'collecting',
    mediaStage,
    revisionNo: 3,
    createdAt: '2026-08-27T08:00:00.000Z',
    updatedAt: '2026-08-27T08:01:00.000Z',
    mediaState: {
      schemaVersion: 1,
      primarySource: {
        sourceId: 'source-1',
        kind: 'video',
        assetRef: {
          objectKey: 'skill-sessions/101/source/video.mp4',
          mimeType: 'video/mp4',
          sizeBytes: 2048,
          sha256: 'a'.repeat(64),
        },
      },
      pendingUpload: null,
      transcript: { status: 'pending', editable: true, segments: [] },
      evidenceTimeline: { evidenceItems: [] },
      candidatePasses: {
        frameworks: [],
        principles: [],
        cases: [],
        counterexamples: [],
        terms: [],
      },
      candidatePassMeta: null,
      semanticMoments: [],
      degradations: [],
      adlerOverview: null,
      adlerOverviewReview: null,
      selectedCandidateIds: [],
      candidateValidations: [],
      candidateSkills: [],
      operationReceipts: [],
    },
  };
}

function progress(
  mediaStage: MediaSessionProgress['mediaStage'],
  currentJob: NonNullable<MediaSessionProgress['currentJob']>,
): MediaSessionProgress {
  return {
    sessionId: '101',
    displayName: '函数课程蒸馏',
    status: 'collecting',
    mediaStage,
    revisionNo: 3,
    createdAt: '2026-08-27T08:00:00.000Z',
    updatedAt: '2026-08-27T08:01:00.000Z',
    currentJob,
  };
}

describe('multimodal progress presentation', () => {
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

  it('shows security as completed before offering the explicit processing start', async () => {
    const readyProgress = progress('ready_to_process', {
      jobId: '701',
      jobType: 'media_quality_check',
      status: 'succeeded',
      percent: 95,
      hint: 'ready_to_complete',
    });
    const readyDetail = detail('ready_to_process');

    await act(async () => {
      root.render(
        <>
          <MultimodalProgressStep
            detail={readyDetail}
            progress={readyProgress}
            error={null}
            busyAction={null}
            uploadPercent={null}
            displayName="函数课程蒸馏"
            sourceUrl=""
            rightsConfirmed={false}
            fileInputRef={createRef<HTMLInputElement>()}
            onDisplayNameChange={vi.fn()}
            onSourceUrlChange={vi.fn()}
            onRightsConfirmedChange={vi.fn()}
            onFileSelected={vi.fn()}
            onChooseFile={vi.fn()}
            onImportUrl={vi.fn()}
            onCancelUpload={vi.fn()}
            onStart={vi.fn()}
            onCancel={vi.fn()}
            onDeleteReference={vi.fn()}
            onOpenDiagnostics={vi.fn()}
          />
          <MultimodalInspectorContent
            detail={readyDetail}
            error={null}
            progress={readyProgress}
            statusText="素材已就绪"
            view="progress"
            selectedLayer={null}
            selectedCandidate={null}
            selectedSkill={null}
            framePreview={null}
            onSeek={vi.fn()}
            onUpdateTranscript={vi.fn()}
            onPreviewFrame={vi.fn()}
            onRemoveEvidence={vi.fn()}
            onUpdateCandidate={vi.fn()}
            onSplitCandidate={vi.fn()}
            onDiscardCandidate={vi.fn()}
            onMergeSelectedCandidates={vi.fn()}
            onSaveCandidates={vi.fn()}
          />
        </>,
      );
    });

    const nodes = container.querySelectorAll('.skill-mm-process-nodes > li');
    expect(nodes[0]?.getAttribute('data-status')).toBe('complete');
    expect(nodes[1]?.getAttribute('data-status')).toBe('future');
    expect(nodes[0]?.getAttribute('aria-label')).toBe('安全校验：已完成');
    expect(nodes[1]?.getAttribute('aria-label')).toBe(
      '媒体预处理：未开始',
    );
    expect(
      container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow'),
    ).toBe('100');
    expect(container.textContent).toContain('素材安全校验已完成');
    expect(container.textContent).toContain('开始蒸馏');
    expect(container.textContent).not.toContain('ready_to_complete');
    expect(container.textContent).not.toContain('95%');
  });

  it('never exposes internal worker phases or job types in either progress surface', async () => {
    const currentProgress = progress('transcribing', {
      jobId: '702',
      jobType: 'transcribe',
      status: 'leased',
      percent: 15,
      hint: 'downloading_audio（重试）',
    });
    const currentDetail = detail('transcribing');

    await act(async () => {
      root.render(
        <>
          <MultimodalProgressStep
            detail={currentDetail}
            progress={currentProgress}
            error={null}
            busyAction={null}
            uploadPercent={null}
            displayName="函数课程蒸馏"
            sourceUrl=""
            rightsConfirmed={false}
            fileInputRef={createRef<HTMLInputElement>()}
            onDisplayNameChange={vi.fn()}
            onSourceUrlChange={vi.fn()}
            onRightsConfirmedChange={vi.fn()}
            onFileSelected={vi.fn()}
            onChooseFile={vi.fn()}
            onImportUrl={vi.fn()}
            onCancelUpload={vi.fn()}
            onStart={vi.fn()}
            onCancel={vi.fn()}
            onDeleteReference={vi.fn()}
            onOpenDiagnostics={vi.fn()}
          />
          <MultimodalInspectorContent
            detail={currentDetail}
            error={null}
            progress={currentProgress}
            statusText="处理中"
            view="progress"
            selectedLayer={null}
            selectedCandidate={null}
            selectedSkill={null}
            framePreview={null}
            onSeek={vi.fn()}
            onUpdateTranscript={vi.fn()}
            onPreviewFrame={vi.fn()}
            onRemoveEvidence={vi.fn()}
            onUpdateCandidate={vi.fn()}
            onSplitCandidate={vi.fn()}
            onDiscardCandidate={vi.fn()}
            onMergeSelectedCandidates={vi.fn()}
            onSaveCandidates={vi.fn()}
          />
        </>,
      );
    });

    expect(container.textContent).toContain('正在进行语音转录');
    expect(container.textContent).not.toContain('downloading_audio');
    expect(container.textContent).not.toContain('transcribe');
    expect(container.textContent).not.toContain('开始蒸馏');
    expect(
      container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow'),
    ).toBe('15');
  });
});
