export interface PackageSwitchDecisionInput {
  hasActiveProgress: boolean;
  preserveGenerateProgress: boolean;
}

export interface PackageSwitchDecision {
  preserveTransientState: boolean;
  clearCenterPreview: boolean;
  clearProgress: boolean;
  clearGeneratePreviews: boolean;
  clearSideStreaming: boolean;
}

export function getPackageSwitchDecision({
  hasActiveProgress,
  preserveGenerateProgress,
}: PackageSwitchDecisionInput): PackageSwitchDecision {
  const preserveTransientState =
    hasActiveProgress || preserveGenerateProgress;

  return {
    preserveTransientState,
    clearCenterPreview: !preserveTransientState || preserveGenerateProgress,
    clearProgress: !preserveTransientState,
    clearGeneratePreviews: !preserveTransientState,
    clearSideStreaming: !preserveTransientState,
  };
}
