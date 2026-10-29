import type {
  GuidedCreationSessionDetail,
  GuidedCreationStep,
  GuidedEducationDimension,
  GuidedEducationSection,
} from '@educlaw/shared';

export type GuidedDimensionStatus =
  | 'missing'
  | 'pending'
  | 'confirmed'
  | 'conflicted';

export type GuidedStepStatus =
  | 'pending'
  | 'active'
  | 'completed'
  | 'conflicted';

export const GUIDED_CREATION_STEP_DEFINITIONS: ReadonlyArray<{
  key: GuidedCreationStep;
  label: string;
  dimensions: ReadonlyArray<{
    key: GuidedEducationDimension;
    label: string;
  }>;
}> = [
  {
    key: 'intent_context',
    label: '目标与对象',
    dimensions: [
      { key: 'educational_goal', label: '教育目标' },
      { key: 'audience_context', label: '对象与情境' },
    ],
  },
  {
    key: 'teacher_experience',
    label: '经验与依据',
    dimensions: [{ key: 'input_evidence', label: '输入与依据' }],
  },
  {
    key: 'strategy_co_creation',
    label: '教学策略',
    dimensions: [{ key: 'teaching_strategy', label: '教育策略' }],
  },
  {
    key: 'action_adjustment',
    label: '行动与边界',
    dimensions: [
      { key: 'action_adaptation', label: '行动与调整' },
      { key: 'boundaries_responsibility', label: '边界与责任' },
    ],
  },
  {
    key: 'evidence_review',
    label: '效果与证据',
    dimensions: [{ key: 'completion_evidence', label: '完成与证据' }],
  },
];

export interface GuidedDimensionProgress {
  key: GuidedEducationDimension;
  label: string;
  content: string;
  status: GuidedDimensionStatus;
}

export interface GuidedStepProgress {
  key: GuidedCreationStep;
  label: string;
  status: GuidedStepStatus;
  confirmedDimensionCount: number;
  dimensions: GuidedDimensionProgress[];
}

export interface GuidedCreationProgress {
  completedStepCount: number;
  totalStepCount: number;
  currentStep: GuidedCreationStep | null;
  currentStepLabel: string | null;
  steps: GuidedStepProgress[];
}

function dimensionStatus(
  section: GuidedEducationSection | undefined,
  stepConfirmed: boolean,
): GuidedDimensionStatus {
  if (!section?.content?.trim()) return 'missing';
  const evidenceItems = section.evidence ?? [];
  if (evidenceItems.some((evidence) => evidence.source === 'conflicted')) {
    return 'conflicted';
  }
  // Extracted user text is still a proposal until the user confirms the
  // current conversation step. Keep it pending so the two progress surfaces
  // cannot report completion ahead of the dialogue.
  if (!stepConfirmed) return 'pending';
  if (
    evidenceItems.some(
      (evidence) =>
        evidence.source === 'user_explicit' ||
        evidence.source === 'user_adopted',
    )
  ) {
    return 'confirmed';
  }
  return 'pending';
}

export function deriveGuidedCreationProgress(
  session: GuidedCreationSessionDetail,
): GuidedCreationProgress {
  const completedSteps = new Set(session.completed_steps ?? []);
  const currentStep = session.current_step ?? null;
  const steps = GUIDED_CREATION_STEP_DEFINITIONS.map((definition) => {
    const stepConfirmed = completedSteps.has(definition.key);
    const dimensions = definition.dimensions.map((dimension) => {
      const section = session.education_draft?.[dimension.key];
      return {
        ...dimension,
        content: section?.content?.trim() ?? '',
        status: dimensionStatus(section, stepConfirmed),
      };
    });
    const confirmedDimensionCount = dimensions.filter(
      (dimension) => dimension.status === 'confirmed',
    ).length;
    const hasConflict = dimensions.some(
      (dimension) => dimension.status === 'conflicted',
    );
    const isCompleted =
      completedSteps.has(definition.key) &&
      confirmedDimensionCount === dimensions.length;
    const status: GuidedStepStatus = hasConflict
      ? 'conflicted'
      : isCompleted
        ? 'completed'
        : currentStep === definition.key
          ? 'active'
          : 'pending';

    return {
      key: definition.key,
      label: definition.label,
      status,
      confirmedDimensionCount,
      dimensions,
    };
  });
  const currentDefinition = GUIDED_CREATION_STEP_DEFINITIONS.find(
    (definition) => definition.key === currentStep,
  );

  return {
    completedStepCount: steps.filter((step) => step.status === 'completed')
      .length,
    totalStepCount: GUIDED_CREATION_STEP_DEFINITIONS.length,
    currentStep,
    currentStepLabel: currentDefinition?.label ?? null,
    steps,
  };
}
