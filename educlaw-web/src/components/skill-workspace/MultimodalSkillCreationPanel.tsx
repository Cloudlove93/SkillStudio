import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type {
  AdlerLayerKey,
  CandidatePassKey,
  MultimodalCandidatePasses,
  MultimodalCandidateSuggestion,
} from '@educlaw/shared';
import { ADLER_LAYER_KEYS } from '@educlaw/shared';
import { Check, Loader2, Sparkles } from 'lucide-react';
import {
  LiteApiError,
  liteApi,
  type MediaSessionDetail,
} from '../../api/lite-api';
import { uploadMediaFile } from '../../api/media-upload';
import {
  applyMultimodalEvent,
  applyMediaGenerationResult,
  confirmMediaGenerationReliably,
  createMultimodalWorkbenchState,
  evidenceAlignmentAtTime,
  limitMultimodalCandidateSelection,
  mediaOperationIdempotencyKey,
  MULTIMODAL_RESUME_KEY,
  MULTIMODAL_SELECTION_LIMIT,
  pendingConfirmationStage,
  mediaReconcileIntervalMs,
  serializeMultimodalResumeState,
  shouldReconcileMediaDetail,
  shouldStreamMediaProgress,
  toggleMultimodalCandidateSelection,
} from './multimodal-guided-creation-state';
import { MediaReviewPane } from './multimodal/MediaReviewPane';
import { MultimodalCandidateStep } from './multimodal/MultimodalCandidateStep';
import {
  MultimodalInspectorContent,
  type MultimodalInspectorKind,
} from './multimodal/MultimodalDataDrawers';
import { MultimodalOverviewStep } from './multimodal/MultimodalOverviewStep';
import { MultimodalProgressStep } from './multimodal/MultimodalProgressStep';
import { MultimodalReleaseStep } from './multimodal/MultimodalReleaseStep';
import { MultimodalWizardShell } from './multimodal/MultimodalWizardShell';
import {
  BACKGROUND_STAGE_NOTICES,
  deriveMultimodalWizardStep,
  evidenceByIds,
  MULTIMODAL_WIZARD_STEPS,
  type MultimodalWizardStep,
} from './multimodal/multimodal-wizard-model';
import { InspectorPortal } from './InspectorPortal';
import { useWorkspaceInspector } from './WorkspaceInspectorProvider';
import type { InspectorView } from './workspace-inspector-state';

const MULTIMODAL_INSPECTOR_CONFIG: Record<
  Exclude<MultimodalInspectorKind, null>,
  { view: InspectorView; title: string; description?: string }
> = {
  progress: {
    view: 'multimodal-progress',
    title: '处理状态',
    description: '查看服务端保存的处理阶段与已形成证据。',
  },
  transcript: {
    view: 'multimodal-transcript',
    title: '完整转录',
    description: '搜索和修订当前素材的时间对齐转录。',
  },
  evidence: {
    view: 'multimodal-evidence',
    title: '证据库',
    description: '筛选声音、画面与转录证据，不改变原始素材。',
  },
  diagnostics: { view: 'multimodal-diagnostics', title: '处理诊断' },
  overview: { view: 'multimodal-overview', title: '内容概览' },
  candidate: { view: 'multimodal-candidate', title: '编辑候选' },
  skill: { view: 'multimodal-skill', title: 'Skill 内容' },
};
const PASS_LABELS: Record<CandidatePassKey, string> = {
  frameworks: '框架',
  principles: '原则',
  cases: '案例',
  counterexamples: '反例',
  terms: '术语',
  fused: '融合主题',
};
const STAGE_LABELS: Record<MediaSessionDetail['mediaStage'], string> = {
  draft: '等待素材',
  uploading: '上传与安全校验',
  ready_to_process: '素材已就绪',
  preparing_media: '准备媒体',
  transcribing: '理解声音与转录',
  reviewing_transcript: '整理转录',
  building_semantic_windows: '定位语义重点',
  building_evidence: '构建证据时间线',
  building_adler: '生成 Adler 概览',
  awaiting_adler_overview: '等待确认内容概览',
  extracting_candidates: '提取 Skill 候选',
  validating_candidates: '验证候选可复用性',
  awaiting_candidates: '等待确认候选',
  building_skills: '构建可运行 Skill',
  arena_testing: '等待确认生成',
  ready_to_publish: '等待确认生成',
  publishing: '生成中',
  published: '已生成',
  failed: '处理失败',
  cancelled: '已取消',
};

function requestId(prefix: string) {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toUiError(error: unknown) {
  if (error instanceof LiteApiError) {
    return {
      code: error.code ?? 'MEDIA_ACTION_FAILED',
      message: error.message,
      retryable: error.status == null || error.status >= 500,
      requestId:
        typeof error.details?.requestId === 'string'
          ? error.details.requestId
          : undefined,
    };
  }
  return {
    code: 'MEDIA_ACTION_FAILED',
    message: error instanceof Error ? error.message : '操作未完成，请检查当前状态',
    retryable: true,
  };
}

function flattenCandidates(passes: MultimodalCandidatePasses) {
  return (Object.keys(PASS_LABELS) as CandidatePassKey[]).flatMap((passKey) =>
    passes[passKey].map((candidate) => ({ passKey, candidate })),
  );
}

type Props = {
  token: string;
  onPublished?: () => Promise<void> | void;
  onOpenRepository?: () => void;
  onOpenGeneratedSkill?: (skillId: string) => Promise<void> | void;
};

export function MultimodalSkillCreationPanel({
  token,
  onPublished,
  onOpenRepository,
  onOpenGeneratedSkill,
}: Props) {
  const {
    state: inspectorState,
    openInspector,
    closeInspector,
    setInspectorDirty,
  } = useWorkspaceInspector();
  const [state, dispatch] = useReducer(
    applyMultimodalEvent,
    undefined,
    createMultimodalWorkbenchState,
  );
  const [displayName, setDisplayName] = useState('课堂素材蒸馏');
  const [sourceUrl, setSourceUrl] = useState('');
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [overviewNotes, setOverviewNotes] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [framePreview, setFramePreview] = useState<{
    evidenceId: string;
    url: string;
  } | null>(null);
  const [candidateDraft, setCandidateDraft] =
    useState<MultimodalCandidatePasses | null>(null);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>(
    [],
  );
  const [selectedEvidenceIds, setSelectedEvidenceIds] = useState<string[]>([]);
  const [reviewStep, setReviewStep] =
    useState<MultimodalWizardStep>('processing');
  const [selectedLayer, setSelectedLayer] = useState<AdlerLayerKey | null>(
    null,
  );
  const [selectedCandidateEditor, setSelectedCandidateEditor] = useState<{
    passKey: CandidatePassKey;
    candidate: MultimodalCandidateSuggestion;
  } | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<
    MediaSessionDetail['mediaState']['candidateSkills'][number] | null
  >(null);
  const [streamEpoch, setStreamEpoch] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const playerRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const programmaticSeekRef = useRef(false);
  const appliedDetailRevisionRef = useRef<number | null>(null);
  const publishedNotificationRef = useRef<string | null>(null);
  const detail = state.detail;
  const inspectorKind = inspectorState.descriptor?.owner === 'multimodal'
    ? (Object.entries(MULTIMODAL_INSPECTOR_CONFIG).find(
        ([, config]) => config.view === inspectorState.descriptor?.view,
      )?.[0] as Exclude<MultimodalInspectorKind, null> | undefined) ?? null
    : null;

  const openMultimodalInspector = (
    kind: Exclude<MultimodalInspectorKind, null>,
    options?: { title?: string; itemId?: string; preferredWidth?: number },
  ) => {
    const config = MULTIMODAL_INSPECTOR_CONFIG[kind];
    openInspector({
      owner: 'multimodal',
      view: config.view,
      title: options?.title ?? config.title,
      description: config.description,
      itemId: options?.itemId,
      preferredWidth: options?.preferredWidth,
    });
  };
  const confirmation = detail
    ? pendingConfirmationStage(detail.mediaStage)
    : null;
  const activeStep = detail ? deriveMultimodalWizardStep(detail) : 'processing';
  const candidates = useMemo(
    () => (candidateDraft ? flattenCandidates(candidateDraft) : []),
    [candidateDraft],
  );
  const candidateItems = useMemo(
    () =>
      candidates.map(({ passKey, candidate }) => ({
        passKey,
        candidate,
        validation:
          detail?.mediaState.candidateValidations.find(
            (item) => item.candidate.candidateId === candidate.candidateId,
          ) ?? null,
      })),
    [candidates, detail?.mediaState.candidateValidations],
  );

  useEffect(() => {
    const itemId = inspectorState.descriptor?.itemId;
    if (!itemId || inspectorState.descriptor?.owner !== 'multimodal') return;
    if (
      inspectorKind === 'overview' &&
      ADLER_LAYER_KEYS.includes(itemId as AdlerLayerKey)
    ) {
      setSelectedLayer((current) => current === itemId ? current : itemId as AdlerLayerKey);
      return;
    }
    if (inspectorKind === 'candidate' && candidateDraft) {
      const selected = flattenCandidates(candidateDraft).find(
        ({ candidate }) => candidate.candidateId === itemId,
      );
      if (selected) {
        setSelectedCandidateEditor((current) =>
          current?.candidate.candidateId === itemId ? current : selected,
        );
      }
      return;
    }
    if (inspectorKind === 'skill') {
      const selected = detail?.mediaState.candidateSkills.find(
        (skill) => skill.id === itemId,
      );
      if (selected) {
        setSelectedSkill((current) => current?.id === itemId ? current : selected);
      }
    }
  }, [
    candidateDraft,
    detail?.mediaState.candidateSkills,
    inspectorKind,
    inspectorState.descriptor?.itemId,
    inspectorState.descriptor?.owner,
  ]);
  const fusedTopicItems = useMemo(() => {
    if (!candidateDraft) return [];
    const fusedItems = candidateItems.filter(
      (item) =>
        item.passKey === 'fused' &&
        item.validation?.overallPassed &&
        item.validation.disposition === 'retain',
    );
    const atomicItems = candidateItems.filter(
      (item) => item.passKey !== 'fused',
    );
    return fusedItems.map((fused) => {
      const subject = fused.candidate;
      const mergedSources =
        subject.evidenceIds.length > 0
          ? atomicItems.filter((atomic) => {
              const ids = atomic.candidate.evidenceIds;
              return (
                ids.length > 0 &&
                ids.every((id) => subject.evidenceIds.includes(id))
              );
            })
          : atomicItems.filter((atomic) =>
              atomic.candidate.evidenceIds.some((id) =>
                subject.evidenceIds.includes(id),
              ),
            );
      return {
        fused,
        mergedSources,
      };
    });
  }, [candidateItems, candidateDraft]);
  const reviewEvidenceAlignment = useMemo(() => {
    if (!detail) return { items: [], relation: 'empty' as const };
    if (selectedEvidenceIds.length) {
      return {
        items: evidenceByIds(
          detail.mediaState.evidenceTimeline.evidenceItems,
          selectedEvidenceIds,
        ),
        relation: 'selected' as const,
      };
    }
    return evidenceAlignmentAtTime(detail, state.playerTimeMs);
  }, [detail, selectedEvidenceIds, state.playerTimeMs]);
  const connectionLabel = detail
    ? `${STAGE_LABELS[detail.mediaStage]} · 修订 ${detail.revisionNo} · ${
        state.connection === 'sse'
          ? '实时'
          : state.connection === 'polling'
            ? '恢复查询'
            : state.connection === 'settled'
              ? '已同步'
              : '离线'
      }`
    : '尚未创建任务';
  const backgroundNotice = detail
    ? (BACKGROUND_STAGE_NOTICES[detail.mediaStage] ?? null)
    : null;

  const refresh = async (sessionId = detail?.sessionId) => {
    if (!sessionId) return;
    const next = await liteApi.getMediaSessionDetail(token, { sessionId });
    dispatch({ type: 'detail.received', detail: next });
  };

  const runAction = async (name: string, action: () => Promise<unknown>) => {
    dispatch({ type: 'action.started', action: name });
    try {
      await action();
      dispatch({ type: 'action.completed' });
    } catch (error) {
      dispatch({ type: 'action.failed', error: toUiError(error) });
      throw error;
    }
  };

  const ensureSession = async () => {
    if (detail) return detail;
    const created = await liteApi.createMediaSession(token, {
      idempotencyKey: requestId('media-session'),
      displayName: displayName.trim() || '课堂素材蒸馏',
    });
    dispatch({ type: 'detail.received', detail: created });
    localStorage.setItem(
      MULTIMODAL_RESUME_KEY,
      serializeMultimodalResumeState({ sessionId: created.sessionId }),
    );
    return created;
  };

  useEffect(() => {
    let cancelled = false;
    try {
      const stored = JSON.parse(
        localStorage.getItem(MULTIMODAL_RESUME_KEY) ?? 'null',
      ) as { sessionId?: unknown } | null;
      if (typeof stored?.sessionId === 'string') {
        liteApi
          .getMediaSessionDetail(token, { sessionId: stored.sessionId })
          .then((next) => {
            if (!cancelled) dispatch({ type: 'detail.received', detail: next });
          })
          .catch(() => localStorage.removeItem(MULTIMODAL_RESUME_KEY));
      }
    } catch {
      localStorage.removeItem(MULTIMODAL_RESUME_KEY);
    }
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!detail?.sessionId) return;
    if (!shouldStreamMediaProgress(detail.mediaStage)) {
      dispatch({ type: 'connection.settled' });
      return;
    }
    let cancelled = false;
    let streamEnded = false;
    const streamAbortController = new AbortController();
    dispatch({ type: 'connection.sse' });
    liteApi
      .streamMediaProgress(
        token,
        { sessionId: detail.sessionId },
        (event) => {
          if (event.event === 'stream_end') streamEnded = true;
          if (!cancelled) dispatch({ type: 'stream.event', event });
        },
        streamAbortController.signal,
      )
      .then(() => {
        if (!cancelled && !streamEnded) {
          dispatch({ type: 'connection.polling' });
        }
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: 'connection.polling' });
      });
    return () => {
      cancelled = true;
      streamAbortController.abort();
    };
  }, [detail?.mediaStage, detail?.sessionId, streamEpoch, token]);

  useEffect(() => {
    if (
      !detail?.sessionId ||
      !shouldReconcileMediaDetail(
        detail.mediaStage,
        state.connection,
        Boolean(
          state.error?.retryable &&
            (detail.mediaStage === 'arena_testing' ||
              detail.mediaStage === 'ready_to_publish'),
        ),
      )
    )
      return;
    let cancelled = false;
    let pollInFlight = false;
    const poll = async () => {
      if (pollInFlight) return;
      pollInFlight = true;
      try {
        const [nextDetail, progress] = await Promise.all([
          liteApi.getMediaSessionDetail(token, { sessionId: detail.sessionId }),
          state.connection === 'sse'
            ? Promise.resolve(null)
            : liteApi.getMediaProgress(token, { sessionId: detail.sessionId }),
        ]);
        if (!cancelled) {
          dispatch({ type: 'detail.received', detail: nextDetail });
          if (progress !== null) {
            dispatch({ type: 'progress.received', progress });
          }
          if (state.connection === 'offline') {
            dispatch({ type: 'connection.polling' });
          }
        }
      } catch {
        if (!cancelled) dispatch({ type: 'connection.offline' });
      } finally {
        pollInFlight = false;
      }
    };
    void poll();
    const timer = window.setInterval(
      () => void poll(),
      mediaReconcileIntervalMs(state.connection),
    );
    const scheduleSseReconnect =
      state.connection === 'sse'
        ? null
        : window.setTimeout(
            () => setStreamEpoch((current) => current + 1),
            15_000,
          );
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      if (scheduleSseReconnect !== null) {
        window.clearTimeout(scheduleSseReconnect);
      }
    };
  }, [
    detail?.mediaStage,
    detail?.sessionId,
    state.connection,
    state.error?.retryable,
    token,
  ]);

  useEffect(() => {
    const sessionId = detail?.sessionId;
    const objectKey = detail?.mediaState.primarySource?.assetRef.objectKey;
    if (!sessionId || !objectKey) {
      setPreviewUrl(null);
      return;
    }
    let cancelled = false;
    liteApi
      .createMediaAssetPreview(token, {
        sessionId,
        objectKey,
      })
      .then((grant) => {
        if (!cancelled) setPreviewUrl(grant.url);
      })
      .catch(() => {
        if (!cancelled) setPreviewUrl(null);
      });
    return () => {
      cancelled = true;
      setPreviewUrl(null);
    };
  }, [
    detail?.mediaState.primarySource?.assetRef.objectKey,
    detail?.sessionId,
    token,
  ]);

  useEffect(() => {
    if (!detail) return;
    if (appliedDetailRevisionRef.current !== detail.revisionNo) {
      appliedDetailRevisionRef.current = detail.revisionNo;
      setCandidateDraft(detail.mediaState.candidatePasses);
      const fusedIds = new Set(
        detail.mediaState.candidatePasses.fused.map(
          (candidate) => candidate.candidateId,
        ),
      );
      const retainedFusedIds = new Set(
        detail.mediaState.candidateValidations
          .filter(
            (item) =>
              fusedIds.has(item.candidate.candidateId) &&
              item.overallPassed &&
              item.disposition === 'retain',
          )
          .map((item) => item.candidate.candidateId),
      );
      setSelectedCandidateIds(
        limitMultimodalCandidateSelection(
          detail.mediaState.selectedCandidateIds.length
            ? detail.mediaState.selectedCandidateIds.filter((id) =>
                retainedFusedIds.has(id),
              )
            : [...retainedFusedIds],
        ),
      );
    }
    if (
      detail.mediaStage === 'published' &&
      publishedNotificationRef.current !== detail.sessionId
    ) {
      publishedNotificationRef.current = detail.sessionId;
      void onPublished?.();
    }
  }, [detail, onPublished]);

  useEffect(() => {
    setReviewStep(activeStep);
  }, [activeStep]);

  useEffect(() => {
    setSelectedEvidenceIds([]);
  }, [detail?.revisionNo]);

  const uploadFile = async (file: File) => {
    if (!/^(audio|video)\//.test(file.type)) {
      dispatch({
        type: 'action.failed',
        error: {
          code: 'UNSUPPORTED_MEDIA_TYPE',
          message: '请选择 MP4、WebM、MP3、WAV、M4A 等音视频文件',
          retryable: false,
        },
      });
      return;
    }
    await runAction('upload', async () => {
      const session = await ensureSession();
      const intent = await liteApi.createMediaUploadIntent(token, {
        sessionId: session.sessionId,
        idempotencyKey: requestId('upload-intent'),
        fileName: file.name,
        declaredMimeType: file.type,
        sizeBytes: file.size,
      });
      const controller = new AbortController();
      uploadAbortRef.current = controller;
      const uploaded = await uploadMediaFile({
        intent,
        file,
        signal: controller.signal,
        onProgress: (percent) => dispatch({ type: 'upload.progress', percent }),
      });
      await liteApi.confirmMediaUpload(token, {
        sessionId: session.sessionId,
        idempotencyKey: requestId('upload-confirm'),
        uploadToken: intent.uploadToken,
        expectedRevisionNo: intent.revisionNo,
        parts: uploaded.parts,
      });
      uploadAbortRef.current = null;
      await refresh(session.sessionId);
      dispatch({ type: 'connection.polling' });
    }).catch(() => undefined);
  };

  const importUrl = async () => {
    if (!rightsConfirmed || !sourceUrl.trim()) return;
    await runAction('url-import', async () => {
      const session = await ensureSession();
      await liteApi.importMediaUrl(token, {
        sessionId: session.sessionId,
        idempotencyKey: requestId('url-import'),
        url: sourceUrl.trim(),
        rightsConfirmed: true,
      });
      await refresh(session.sessionId);
      dispatch({ type: 'connection.polling' });
    }).catch(() => undefined);
  };

  const startProcessing = async () => {
    if (!detail) return;
    await runAction('process', async () => {
      await liteApi.startMediaProcessing(token, {
        sessionId: detail.sessionId,
        idempotencyKey: requestId('process'),
        expectedRevisionNo: detail.revisionNo,
        understandingMode: 'auto',
      });
      await refresh();
      dispatch({ type: 'connection.polling' });
    }).catch(() => undefined);
  };

  const seekTo = (timeMs: number, preserveEvidenceSelection = false) => {
    programmaticSeekRef.current = preserveEvidenceSelection;
    if (playerRef.current) playerRef.current.currentTime = timeMs / 1_000;
    dispatch({ type: 'player.seek', timeMs });
  };

  const selectOverviewEvidence = (evidenceIds: string[]) => {
    if (!detail) return;
    const selected = evidenceByIds(
      detail.mediaState.evidenceTimeline.evidenceItems,
      evidenceIds,
    );
    setSelectedEvidenceIds(evidenceIds);
    if (selected[0]) seekTo(selected[0].timeRange.startMs, true);
  };

  const updateTranscript = async (
    segmentIndex: number,
    text: string,
    speaker: string | null,
  ) => {
    if (!detail) return;
    const segment = detail.mediaState.transcript.segments[segmentIndex];
    if (!segment || text.trim() === segment.text) return;
    await runAction('transcript-edit', async () => {
      await liteApi.updateMediaTranscriptSegment(token, {
        sessionId: detail.sessionId,
        idempotencyKey: requestId('transcript-edit'),
        expectedRevisionNo: detail.revisionNo,
        segmentIndex,
        expectedSegmentRevisionNo: segment.revisionNo ?? 0,
        text: text.trim(),
        speaker,
      });
      await refresh();
    }).catch(() => undefined);
  };

  const removeEvidence = async (evidenceId: string) => {
    if (!detail) return;
    const evidenceItems =
      detail.mediaState.evidenceTimeline.evidenceItems.filter(
        (item) => item.evidenceId !== evidenceId,
      );
    if (!evidenceItems.length) return;
    await runAction('evidence-edit', async () => {
      await liteApi.updateMediaEvidence(token, {
        sessionId: detail.sessionId,
        idempotencyKey: requestId('evidence-edit'),
        expectedRevisionNo: detail.revisionNo,
        evidenceItems,
      });
      await refresh();
    }).catch(() => undefined);
  };

  const updateCandidate = (
    passKey: CandidatePassKey,
    candidateId: string,
    patch: Partial<MultimodalCandidateSuggestion>,
  ) => {
    setInspectorDirty(true);
    setCandidateDraft((current) =>
      current
        ? {
            ...current,
            [passKey]: current[passKey].map((item) =>
              item.candidateId === candidateId ? { ...item, ...patch } : item,
            ),
          }
        : current,
    );
    setSelectedCandidateEditor((current) =>
      current?.candidate.candidateId === candidateId
        ? {
            ...current,
            candidate: { ...current.candidate, ...patch },
          }
        : current,
    );
  };

  const discardCandidate = (passKey: CandidatePassKey, candidateId: string) => {
    setCandidateDraft((current) =>
      current
        ? {
            ...current,
            [passKey]: current[passKey].filter(
              (item) => item.candidateId !== candidateId,
            ),
          }
        : current,
    );
    setSelectedCandidateIds((current) =>
      current.filter((id) => id !== candidateId),
    );
    if (selectedCandidateEditor?.candidate.candidateId === candidateId) {
      setSelectedCandidateEditor(null);
      setInspectorDirty(false);
      closeInspector({ force: true });
    }
  };

  const splitCandidate = (
    passKey: CandidatePassKey,
    candidate: MultimodalCandidateSuggestion,
  ) => {
    const splitIds = [requestId('candidate'), requestId('candidate')];
    setCandidateDraft((current) =>
      current
        ? {
            ...current,
            [passKey]: current[passKey].flatMap((item) =>
              item.candidateId === candidate.candidateId
                ? [
                    {
                      ...item,
                      candidateId: splitIds[0],
                      title: `${item.title}（一）`,
                      summary: `${item.summary}（拆分一）`,
                    },
                    {
                      ...item,
                      candidateId: splitIds[1],
                      title: `${item.title}（二）`,
                      summary: `${item.summary}（拆分二）`,
                    },
                  ]
                : [item],
            ),
          }
        : current,
    );
    setSelectedCandidateIds((current) =>
      current.filter((id) => id !== candidate.candidateId),
    );
    setSelectedCandidateEditor(null);
    setInspectorDirty(false);
    closeInspector({ force: true });
  };

  const mergeSelectedCandidates = () => {
    if (!candidateDraft) return;
    const selected = flattenCandidates(candidateDraft).filter(({ candidate }) =>
      selectedCandidateIds.includes(candidate.candidateId),
    );
    const first = selected[0];
    const second = selected.find(
      ({ passKey, candidate }) =>
        passKey === first?.passKey &&
        candidate.candidateId !== first.candidate.candidateId,
    );
    if (!first || !second) return;
    const mergedId = requestId('candidate');
    const removedIds = new Set([
      first.candidate.candidateId,
      second.candidate.candidateId,
    ]);
    const merged: MultimodalCandidateSuggestion = {
      ...first.candidate,
      candidateId: mergedId,
      title: `${first.candidate.title} / ${second.candidate.title}`,
      summary: `${first.candidate.summary}\n${second.candidate.summary}`,
      reusableRule: `${first.candidate.reusableRule}\n${second.candidate.reusableRule}`,
      evidenceIds: [
        ...new Set([
          ...first.candidate.evidenceIds,
          ...second.candidate.evidenceIds,
        ]),
      ],
      claimType:
        first.candidate.claimType === second.candidate.claimType
          ? first.candidate.claimType
          : 'modelInference',
      visualAssertion:
        first.candidate.visualAssertion || second.candidate.visualAssertion,
    };
    setCandidateDraft((current) =>
      current
        ? {
            ...current,
            [first.passKey]: [
              ...current[first.passKey].filter(
                (item) => !removedIds.has(item.candidateId),
              ),
              merged,
            ],
          }
        : current,
    );
    setSelectedCandidateIds((current) => [
      ...current.filter((id) => !removedIds.has(id)),
      mergedId,
    ]);
    setInspectorDirty(true);
  };

  const saveCandidates = async () => {
    if (!detail || !candidateDraft) return;
    await runAction('candidate-edit', async () => {
      await liteApi.updateMediaCandidates(token, {
        sessionId: detail.sessionId,
        idempotencyKey: requestId('candidate-edit'),
        expectedRevisionNo: detail.revisionNo,
        candidatePasses: candidateDraft,
      });
      await refresh();
      setInspectorDirty(false);
    }).catch(() => undefined);
  };

  const confirmOverview = async () => {
    if (!detail) return;
    await runAction('overview-confirm', async () => {
      await liteApi.confirmMediaOverview(token, {
        sessionId: detail.sessionId,
        idempotencyKey: requestId('overview-confirm'),
        expectedRevisionNo: detail.revisionNo,
        title: detail.displayName,
        userNotes: overviewNotes,
      });
      await refresh();
      dispatch({ type: 'connection.polling' });
    }).catch(() => undefined);
  };

  const confirmCandidates = async () => {
    if (!detail || !selectedCandidateIds.length) return;
    await runAction('candidate-confirm', async () => {
      await liteApi.confirmMediaCandidates(token, {
        sessionId: detail.sessionId,
        idempotencyKey: requestId('candidate-confirm'),
        expectedRevisionNo: detail.revisionNo,
        selectedCandidateIds,
      });
      await refresh();
      dispatch({ type: 'connection.polling' });
    }).catch(() => undefined);
  };

  const confirmGeneration = async () => {
    if (
      !detail ||
      (detail.mediaStage !== 'arena_testing' &&
        detail.mediaStage !== 'ready_to_publish')
    ) return;
    const sessionId = detail.sessionId;
    const expectedRevisionNo = detail.revisionNo;
    const idempotencyKey = mediaOperationIdempotencyKey(
      'generate-confirm',
      sessionId,
      expectedRevisionNo,
    );
    dispatch({ type: 'action.started', action: 'generate-confirm' });
    try {
      const resolution = await confirmMediaGenerationReliably({
        confirm: () =>
          liteApi.confirmGeneratedMediaSkills(token, {
            sessionId,
            idempotencyKey,
            expectedRevisionNo,
            targetPackageId: null,
            expectedPackageVersionId: null,
          }),
        getDetail: () => liteApi.getMediaSessionDetail(token, { sessionId }),
      });
      dispatch({
        type: 'detail.received',
        detail:
          resolution.kind === 'result'
            ? applyMediaGenerationResult(detail, resolution.result)
            : resolution.detail,
      });
      dispatch({ type: 'action.completed' });
      if (resolution.kind === 'result') {
        void liteApi
          .getMediaSessionDetail(token, { sessionId })
          .then((reconciled) =>
            dispatch({ type: 'detail.received', detail: reconciled }),
          )
          .catch(() => undefined);
      }
    } catch (error) {
      dispatch({ type: 'action.failed', error: toUiError(error) });
    }
  };

  const cancel = async () => {
    if (!detail) return;
    await runAction('cancel', async () => {
      await liteApi.cancelMediaProcessing(token, {
        sessionId: detail.sessionId,
        expectedRevisionNo: detail.revisionNo,
      });
      await refresh();
    }).catch(() => undefined);
  };

  const deleteSession = async () => {
    if (!detail) return;
    await runAction('delete', async () => {
      await liteApi.deleteMediaSession(token, {
        sessionId: detail.sessionId,
        expectedRevisionNo: detail.revisionNo,
      });
      localStorage.removeItem(MULTIMODAL_RESUME_KEY);
      setPreviewUrl(null);
      window.location.reload();
    }).catch(() => undefined);
  };

  const previewFrame = async (evidenceId: string, objectKey: string) => {
    if (!detail) return;
    try {
      const grant = await liteApi.createMediaAssetPreview(token, {
        sessionId: detail.sessionId,
        objectKey,
      });
      setFramePreview({ evidenceId, url: grant.url });
    } catch (error) {
      dispatch({ type: 'action.failed', error: toUiError(error) });
    }
  };

  const reviewStepIndex = MULTIMODAL_WIZARD_STEPS.findIndex(
    (item) => item.key === reviewStep,
  );
  const activeStepIndex = MULTIMODAL_WIZARD_STEPS.findIndex(
    (item) => item.key === activeStep,
  );
  const isReviewingCompletedStep = reviewStepIndex < activeStepIndex;
  const visibleError = state.error ?? (detail?.error
    ? {
        code: detail.error.code,
        message: detail.error.message,
        retryable: detail.error.retryable,
      }
    : null);

  const actions = isReviewingCompletedStep ? (
    <button
      type="button"
      className="skill-primary-button"
      onClick={() => setReviewStep(activeStep)}
    >
      返回当前步骤
    </button>
  ) : reviewStep === 'overview' && confirmation === 'adler_overview' ? (
    <button
      type="button"
      className="skill-primary-button"
      onClick={() => void confirmOverview()}
      disabled={Boolean(state.busyAction)}
    >
      <Check size={16} />
      确认概览并提取候选
    </button>
  ) : reviewStep === 'candidates' &&
    confirmation === 'evidence_and_candidates' ? (
    <>
      {fusedTopicItems.length > 0 && (
        <button
          type="button"
          className="skill-secondary-button skill-mm-action-muted"
          onClick={() => void saveCandidates()}
          disabled={Boolean(state.busyAction) || candidates.length === 0}
        >
          保存修改并重新验证
        </button>
      )}
      <button
        type="button"
        className="skill-primary-button skill-mm-action-confirm"
        onClick={() => void confirmCandidates()}
        disabled={
          Boolean(state.busyAction) ||
          selectedCandidateIds.length === 0 ||
          selectedCandidateIds.length > MULTIMODAL_SELECTION_LIMIT
        }
      >
        <Sparkles size={16} aria-hidden="true" />
        确认 {selectedCandidateIds.length} 个融合主题并构建 Skill
      </button>
    </>
  ) : reviewStep === 'release' &&
    (detail?.mediaStage === 'arena_testing' ||
      detail?.mediaStage === 'ready_to_publish') ? (
    <button
      type="button"
      className="skill-primary-button"
      onClick={() => void confirmGeneration()}
      disabled={Boolean(state.busyAction)}
      aria-busy={state.busyAction === 'generate-confirm'}
    >
      {state.busyAction === 'generate-confirm' ? (
        <Loader2 className="spin" size={16} aria-hidden="true" />
      ) : (
        <Check size={16} aria-hidden="true" />
      )}
      {state.busyAction === 'generate-confirm'
        ? '正在生成并保存…'
        : `确认生成 ${detail.mediaState.candidateSkills.length} 个 Skill`}
    </button>
  ) : null;

  return (
    <main className="skill-center skill-multimodal-view">
      <MultimodalWizardShell
        title={detail?.displayName ?? '从音视频中蒸馏可运行的 Skill'}
        description="声音、画面、转录和人工确认共同形成可追溯证据，未经确认不会生成。"
        statusText={connectionLabel}
        activeStep={activeStep}
        reviewStep={reviewStep}
        onReviewStep={(step) => {
          const requestedIndex = MULTIMODAL_WIZARD_STEPS.findIndex(
            (item) => item.key === step,
          );
          if (requestedIndex <= activeStepIndex) setReviewStep(step);
        }}
        media={
          detail?.mediaState.primarySource ? (
            <MediaReviewPane
              hasVisualTrack={state.hasVisualTrack}
              previewUrl={previewUrl}
              playerTimeMs={state.playerTimeMs}
              visibleEvidence={reviewEvidenceAlignment.items}
              evidenceRelation={reviewEvidenceAlignment.relation}
              onPlayerElement={(node) => {
                playerRef.current = node;
              }}
              onTimeUpdate={(timeMs) => {
                if (programmaticSeekRef.current) {
                  programmaticSeekRef.current = false;
                } else {
                  setSelectedEvidenceIds([]);
                }
                dispatch({ type: 'player.seek', timeMs });
              }}
              onSeek={seekTo}
              onOpenTranscript={() => openMultimodalInspector('transcript')}
              onOpenEvidence={() => openMultimodalInspector('evidence')}
            />
          ) : (
            <div className="skill-mm-media-placeholder">
              <span>课堂素材</span>
              <h2>上传后在这里回放</h2>
              <p>处理完成后，播放器会与结论和证据保持时间对齐。</p>
            </div>
          )
        }
        actions={actions}
      >
        {(visibleError || detail?.mediaStage === 'failed') &&
          reviewStep !== 'processing' &&
          reviewStep === activeStep && (
            <div className="skill-mm-inline-error" role="alert">
              <div>
                <strong>{visibleError?.message ?? '当前步骤处理失败'}</strong>
                {detail?.mediaStage === 'failed' && (
                  <p>系统已自动尝试恢复，仍未成功。请查看诊断。</p>
                )}
                {state.revisionConflict && (
                  <p>服务端状态已变化，请刷新后再编辑，不会自动覆盖。</p>
                )}
              </div>
              <div className="skill-mm-inline-error-actions">
                <button
                  type="button"
                  className="skill-primary-button"
                  onClick={() => openMultimodalInspector('diagnostics')}
                >
                  查看诊断
                </button>
                {state.revisionConflict && (
                  <button
                    type="button"
                    className="skill-secondary-button"
                    onClick={() => void refresh()}
                  >
                    刷新
                  </button>
                )}
              </div>
            </div>
          )}

        {reviewStep !== 'processing' && detail && backgroundNotice && (
          <div className="skill-mm-pipeline-status" role="status">
            <Loader2 className="spin" size={15} />
            <div>
              <strong>{backgroundNotice.title}</strong>
              <span>{backgroundNotice.body}</span>
            </div>
          </div>
        )}

        {reviewStep === 'processing' && (
          <MultimodalProgressStep
            detail={detail}
            progress={state.progress}
            error={visibleError}
            busyAction={state.busyAction}
            uploadPercent={state.uploadPercent}
            displayName={displayName}
            sourceUrl={sourceUrl}
            rightsConfirmed={rightsConfirmed}
            fileInputRef={fileInputRef}
            onDisplayNameChange={setDisplayName}
            onSourceUrlChange={setSourceUrl}
            onRightsConfirmedChange={setRightsConfirmed}
            onFileSelected={(file) => void uploadFile(file)}
            onChooseFile={() => fileInputRef.current?.click()}
            onImportUrl={() => void importUrl()}
            onCancelUpload={() => uploadAbortRef.current?.abort()}
            onStart={() => void startProcessing()}
            onCancel={() => void cancel()}
            onDeleteReference={() => void deleteSession()}
            onOpenDiagnostics={() => openMultimodalInspector('diagnostics')}
          />
        )}

        {reviewStep === 'overview' &&
          (detail?.mediaState.adlerOverview ? (
            <MultimodalOverviewStep
              overview={detail.mediaState.adlerOverview}
              notes={overviewNotes}
              busy={Boolean(state.busyAction)}
              onNotesChange={setOverviewNotes}
              onSelectEvidence={selectOverviewEvidence}
              onExpandLayer={(layer) => {
                setSelectedLayer(layer);
                openMultimodalInspector('overview', {
                  title: MULTIMODAL_INSPECTOR_CONFIG.overview.title,
                  itemId: layer,
                });
              }}
            />
          ) : (
            <p className="skill-media-muted">内容概览仍在生成中。</p>
          ))}

        {reviewStep === 'candidates' &&
          (candidateDraft ? (
            <MultimodalCandidateStep
              topics={fusedTopicItems}
              selectedCandidateIds={selectedCandidateIds}
              selectionLimit={MULTIMODAL_SELECTION_LIMIT}
              onToggle={(candidateId, checked) =>
                setSelectedCandidateIds((current) =>
                  toggleMultimodalCandidateSelection(
                    current,
                    candidateId,
                    checked,
                  ),
                )
              }
              onEditTopic={(candidate) => {
                setSelectedCandidateEditor({
                  passKey: 'fused',
                  candidate,
                });
                openMultimodalInspector('candidate', {
                  title: candidate.title,
                  itemId: candidate.candidateId,
                  preferredWidth: 440,
                });
              }}
            />
          ) : (
            <p className="skill-media-muted">Skill 候选仍在生成与验证中。</p>
          ))}

        {reviewStep === 'release' &&
          (detail ? (
            <MultimodalReleaseStep
              detail={detail}
              onOpenSkill={(skill) => {
                setSelectedSkill(skill);
                openMultimodalInspector('skill', {
                  title: skill.name,
                  itemId: skill.id,
                  preferredWidth: 480,
                });
              }}
              onOpenTrial={() => {
                const generatedSkillId = Object.keys(
                  detail.publishedPackage?.skillVersionIds ?? {},
                )[0];
                if (generatedSkillId && onOpenGeneratedSkill) {
                  void onOpenGeneratedSkill(generatedSkillId);
                  return;
                }
                void onPublished?.();
                onOpenRepository?.();
              }}
              onOpenRepository={() => {
                void onPublished?.();
                onOpenRepository?.();
              }}
            />
          ) : (
            <p className="skill-media-muted">尚未生成 Skill。</p>
          ))}
      </MultimodalWizardShell>

      <InspectorPortal owner="multimodal">
        <MultimodalInspectorContent
          detail={detail}
          error={visibleError}
          progress={state.progress}
          statusText={connectionLabel}
          view={inspectorKind}
          selectedLayer={selectedLayer}
          selectedCandidate={selectedCandidateEditor}
          selectedSkill={selectedSkill}
          framePreview={framePreview}
          onSeek={(timeMs) => seekTo(timeMs)}
          onUpdateTranscript={(index, text, speaker) =>
            void updateTranscript(index, text, speaker)
          }
          onPreviewFrame={(evidenceId, objectKey) =>
            void previewFrame(evidenceId, objectKey)
          }
          onRemoveEvidence={(evidenceId) => void removeEvidence(evidenceId)}
          onUpdateCandidate={updateCandidate}
          onSplitCandidate={splitCandidate}
          onDiscardCandidate={discardCandidate}
          onMergeSelectedCandidates={mergeSelectedCandidates}
          onSaveCandidates={() => void saveCandidates()}
        />
      </InspectorPortal>
    </main>
  );
}
