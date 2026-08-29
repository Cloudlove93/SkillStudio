import type {
  AdlerLayerKey,
  MediaStage,
  MultimodalClaimType,
  MultimodalEvidenceKind,
} from '@educlaw/shared';
import type {
  MediaSessionDetail,
  MediaSessionProgress,
} from '../../../api/lite-api';

type PublicMediaJob = NonNullable<MediaSessionProgress['currentJob']>;

const MEDIA_JOB_PROGRESS_LABELS: Record<
  PublicMediaJob['jobType'],
  { active: string; completed: string }
> = {
  media_quality_check: {
    active: '正在进行安全校验',
    completed: '安全校验完成',
  },
  media_prepare: {
    active: '正在预处理媒体',
    completed: '媒体预处理完成',
  },
  transcribe: {
    active: '正在进行语音转录',
    completed: '语音转录完成',
  },
  frame_materialize: {
    active: '正在生成关键帧与证据',
    completed: '关键帧与证据生成完成',
  },
};

const INTERNAL_WORKER_PHASE_LABELS: Record<string, string> = {
  claimed: '任务已进入处理队列',
  ready_to_complete: '正在提交处理结果',
  downloading_source: '正在读取素材',
  probing_media: '正在分析媒体信息',
  normalizing_audio: '正在标准化音轨',
  detecting_visual_signals: '正在识别画面变化',
  uploading_result_manifest: '正在保存处理结果',
  downloading_audio: '正在读取音轨',
  transcribing: '正在识别语音内容',
  transcribing_audio: '正在识别语音内容',
  uploading_transcript: '正在保存转录结果',
  downloading_video: '正在读取视频画面',
  materializing_frames: '正在生成候选关键帧',
  uploading_frames: '正在保存关键帧',
};

const TRUSTED_LOCALIZED_PROGRESS_LABELS = new Set([
  ...Object.values(INTERNAL_WORKER_PHASE_LABELS),
  ...Object.values(MEDIA_JOB_PROGRESS_LABELS).flatMap((labels) => [
    labels.active,
    labels.completed,
  ]),
]);

export function mediaJobProgressLabel(job: PublicMediaJob) {
  const labels = MEDIA_JOB_PROGRESS_LABELS[job.jobType];
  if (job.status === 'succeeded') return labels.completed;
  if (job.status === 'failed') return '处理失败';
  if (job.status === 'cancelled') return '处理已取消';
  const hint = job.hint?.trim();
  if (hint && TRUSTED_LOCALIZED_PROGRESS_LABELS.has(hint)) return hint;
  return (hint && INTERNAL_WORKER_PHASE_LABELS[hint]) || labels.active;
}

export function mediaJobProgressPercent(job: PublicMediaJob) {
  return job.status === 'succeeded' ? 100 : job.percent;
}

export type MultimodalWizardStep =
  | 'processing'
  | 'overview'
  | 'candidates'
  | 'release';

export const MULTIMODAL_WIZARD_STEPS = [
  { key: 'processing', label: '处理素材' },
  { key: 'overview', label: '确认内容' },
  { key: 'candidates', label: '选择 Skill' },
  { key: 'release', label: '确认生成' },
] as const satisfies ReadonlyArray<{
  key: MultimodalWizardStep;
  label: string;
}>;

export const ADLER_LAYER_LABELS: Record<AdlerLayerKey, string> = {
  structure: '内容结构',
  interpretation: '核心理解',
  critique: '问题与不足',
  application: '可迁移应用',
};

export const EVIDENCE_KIND_LABELS: Record<MultimodalEvidenceKind, string> = {
  transcript: '转录',
  audio_segment: '音频片段',
  frame: '关键帧',
};

export const CLAIM_TYPE_LABELS: Record<MultimodalClaimType, string> = {
  sourceFact: '原文事实',
  modelInference: '模型推断',
  userInput: '人工输入',
};

export const BACKGROUND_STAGE_NOTICES: Partial<
  Record<MediaStage, { title: string; body: string }>
> = {
  extracting_candidates: {
    title: '正在后台提取 Skill 候选',
    body: '完成后会自动进入「选择 Skill」步骤，无需操作。',
  },
  validating_candidates: {
    title: '正在后台验证 Skill 候选',
    body: '验证通过后即可在这里选择候选，无需操作。',
  },
  building_skills: {
    title: '正在后台构建可运行 Skill',
    body: '完成后会自动进入「确认生成」步骤，无需操作。',
  },
  publishing: {
    title: '正在生成 Skill',
    body: '完成后会自动加入工作区并保存到 Skill 仓库。',
  },
};

type DegradationPresentation = {
  title: string;
  detail: string;
};

const DEGRADATION_PRESENTATIONS: Record<string, DegradationPresentation> = {
  ASR_LOW_CONFIDENCE_UNCONFIRMED: {
    title: '语音识别置信度偏低',
    detail:
      '转录中存在模型把握不高的片段，可能包含识别错误。相关转录证据在人工确认前仅作参考，不应作为依据。',
  },
  ASR_TRANSCRIPT_CORRECTION_FAILED: {
    title: '转录纠错未完成',
    detail: '模型未能完成自动纠错，已保留原始语音识别文本。建议在「完整转录」中人工修订识别有误的片段。',
  },
  LOW_CONFIDENCE_SEGMENTS: {
    title: '低置信度转录片段',
    detail:
      '部分转录片段的语音识别置信度偏低，可能包含同音字或术语误识。建议在「完整转录」中核对并修订。',
  },
  NO_AUDIO_TRACK: {
    title: '视频素材缺少音轨',
    detail: '上传的视频中未检测到可识别的音轨，无法生成语音转录，相关证据将仅限画面。',
  },
  AUDIO_TRACK_MISSING: {
    title: '视频素材缺少音轨',
    detail: '上传的视频中未检测到可识别的音轨，无法生成语音转录，相关证据将仅限画面。',
  },
  AUDIO_PLAYBACK_UNAVAILABLE: {
    title: '音频定位回放不可用',
    detail: '缺少可直接播放的音轨文件，无法点击转录跳转到对应时间点回放音频，但不影响转录文本本身。',
  },
  VISUAL_ONLY: {
    title: '仅有画面证据',
    detail: '该语义时刻只有画面可以提供依据，语音和转录部分未能形成有效证据。',
  },
  FRAME_NOT_APPLICABLE: {
    title: '该时刻不适用画面证据',
    detail:
      '音频素材或语义时刻与画面内容无关，没有抽取关键帧。可以根据音频和转录证据判断结论。',
  },
  FRAME_SHARPNESS_THRESHOLD_RELAXED: {
    title: '画面清晰度阈值已放宽',
    detail:
      '满足默认清晰度阈值的候选帧已用完，已保留剩余候选中最清晰的若干张并在此做降级标记，使用时注意可能存在模糊。',
  },
  FRAME_EVIDENCE_REPAIR_ATTEMPTED: {
    title: '画面证据已尝试修复',
    detail: '初次筛选后没有可用候选帧，已扩大范围再次尝试，结果仅供参考。',
  },
  NO_USABLE_VISUAL_EVIDENCE: {
    title: '无可用画面证据',
    detail:
      '经过画面质量筛选和语义排序后，该时刻未保留到可用的关键帧证据。建议以音频/转录证据或其他时刻作为判断依据。',
  },
  VISUAL_SIGNAL_DETECTOR_UNAVAILABLE: {
    title: '画面信号检测缺失',
    detail: '画面变化或场景切换检测未能产出有效数据，已退化为按等时间隔采样关键帧，分布可能不够理想。',
  },
  VISION_RANKING_FALLBACK: {
    title: '画面语义排序已降级',
    detail:
      '无法完成画面语义重排序，已退化为按清晰度、构图等确定性质量选择关键帧，相关性可能略有下降。',
  },
  VISION_RANKING_OUTPUT_INVALID: {
    title: '画面语义排序结果无效',
    detail:
      '画面语义排序的模型输出格式异常，已退化为按确定性质量选择关键帧，相关性可能略有下降。',
  },
};

// 兼容历史会话中的降级键：旧版把机器码直接写进 message，或 code 直接是英文分组 key
const LEGACY_DEGRADATION_ALIASES: Record<string, keyof typeof DEGRADATION_PRESENTATIONS> = {
  one_or_more_segments_below_confidence_threshold: 'LOW_CONFIDENCE_SEGMENTS',
  TRANSCRIPT_LOW_CONFIDENCE: 'ASR_LOW_CONFIDENCE_UNCONFIRMED',
  LOW_CONFIDENCE: 'LOW_CONFIDENCE_SEGMENTS',
  SHARPNESS_THRESHOLD_RELAXED: 'FRAME_SHARPNESS_THRESHOLD_RELAXED',
  TRANSCRIPT_EVIDENCE_UNCONFIRMED: 'ASR_LOW_CONFIDENCE_UNCONFIRMED',
  ASR_UNCONFIRMED: 'ASR_LOW_CONFIDENCE_UNCONFIRMED',
  BLURRY_FRAMES_USED: 'FRAME_SHARPNESS_THRESHOLD_RELAXED',
  NO_FRAME: 'FRAME_NOT_APPLICABLE',
};

export function degradationPresentation(code: string, fallbackMessage?: string): {
  title: string;
  detail: string;
} {
  const mapped = LEGACY_DEGRADATION_ALIASES[code] ?? code;
  const preset = DEGRADATION_PRESENTATIONS[mapped];
  if (preset) return preset;
  const safeMessage = fallbackMessage?.trim();
  if (safeMessage && /[\u4e00-\u9fa5]/.test(safeMessage)) {
    return { title: '处理降级', detail: safeMessage };
  }
  return {
    title: '处理降级',
    detail: safeMessage
      ? `系统记录：${safeMessage}。该标记表明流水线在此处使用了降级策略，不影响整体结论。`
      : '流水线在此处使用了降级策略，不影响整体结论。',
  };
}

/** 仅保留用于单一 code 展示的短标题（不推荐用于诊断抽屉详情） */
export function degradationLabel(code: string): string {
  return degradationPresentation(code).title;
}

const STAGE_STEP: Record<
  Exclude<MediaStage, 'failed' | 'cancelled'>,
  MultimodalWizardStep
> = {
  draft: 'processing',
  uploading: 'processing',
  ready_to_process: 'processing',
  preparing_media: 'processing',
  transcribing: 'processing',
  reviewing_transcript: 'processing',
  building_semantic_windows: 'processing',
  building_evidence: 'processing',
  building_adler: 'processing',
  awaiting_adler_overview: 'overview',
  extracting_candidates: 'overview',
  validating_candidates: 'candidates',
  awaiting_candidates: 'candidates',
  building_skills: 'candidates',
  arena_testing: 'release',
  ready_to_publish: 'release',
  publishing: 'release',
  published: 'release',
};

export function deriveMultimodalWizardStep(
  detail: MediaSessionDetail,
): MultimodalWizardStep {
  if (detail.mediaStage !== 'failed' && detail.mediaStage !== 'cancelled') {
    return STAGE_STEP[detail.mediaStage];
  }
  if (detail.mediaStage === 'cancelled') return 'processing';
  const resumeStage = detail.error?.resumeStage;
  if (resumeStage && resumeStage !== 'failed' && resumeStage !== 'cancelled') {
    return STAGE_STEP[resumeStage];
  }
  if (detail.mediaState?.candidateSkills?.length || detail.arenaEvaluation) {
    return 'release';
  }
  if (detail.mediaState?.candidateValidations?.length) return 'candidates';
  const candidatePasses = detail.mediaState?.candidatePasses;
  if (
    candidatePasses &&
    Object.values(candidatePasses).some((candidates) => candidates.length > 0)
  ) {
    return 'candidates';
  }
  if (detail.mediaState?.adlerOverview) return 'overview';
  return 'processing';
}

type DegradationLike = {
  code: string;
  message: string;
  semanticMomentId?: string | null;
};

export function aggregateMultimodalDegradations<T extends DegradationLike>(
  items: readonly T[],
): Array<T & { count: number; semanticMomentIds: string[] }> {
  const groups = new Map<
    string,
    T & { count: number; semanticMomentIds: string[] }
  >();

  for (const item of items) {
    const normalizedMessage = item.message.trim().replace(/\s+/g, ' ');
    const key = item.code + '::' + normalizedMessage;
    const current = groups.get(key);
    if (current) {
      current.count += 1;
      if (item.semanticMomentId) {
        current.semanticMomentIds.push(item.semanticMomentId);
      }
      continue;
    }
    groups.set(key, {
      ...item,
      message: normalizedMessage,
      count: 1,
      semanticMomentIds: item.semanticMomentId
        ? [item.semanticMomentId]
        : [],
    });
  }

  return [...groups.values()];
}

export function paginateMultimodalItems<T>(
  items: readonly T[],
  requestedPage: number,
  pageSize: number,
): {
  items: T[];
  page: number;
  pageCount: number;
  total: number;
} {
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const pageCount = Math.max(1, Math.ceil(items.length / safePageSize));
  const page = Math.min(
    Math.max(1, Math.floor(requestedPage)),
    pageCount,
  );

  return {
    items: items.slice(
      (page - 1) * safePageSize,
      page * safePageSize,
    ),
    page,
    pageCount,
    total: items.length,
  };
}

export function evidenceByIds<T extends { evidenceId: string }>(
  evidence: readonly T[],
  evidenceIds: readonly string[],
): T[] {
  const selected = new Set(evidenceIds);
  return evidence.filter((item) => selected.has(item.evidenceId));
}
