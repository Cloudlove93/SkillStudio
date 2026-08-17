export type AnswerOptimizationPanelLayout =
  | { mode: 'auto'; height: null }
  | { mode: 'manual'; height: number }
  | { mode: 'collapsed'; height: null };

export function clampStatusPanelHeight(
  requestedHeight: number,
  availableHeight: number,
  conversationMinimum = 128,
  panelMinimum = 76,
) {
  const maximum = Math.max(panelMinimum, availableHeight - conversationMinimum);
  return Math.min(maximum, Math.max(panelMinimum, requestedHeight));
}

export function createManualPanelLayout(
  requestedHeight: number,
  availableHeight: number,
): AnswerOptimizationPanelLayout {
  return {
    mode: 'manual',
    height: clampStatusPanelHeight(requestedHeight, availableHeight),
  };
}

export function collapsePanelLayout(): AnswerOptimizationPanelLayout {
  return { mode: 'collapsed', height: null };
}

export function resetPanelLayout(): AnswerOptimizationPanelLayout {
  return { mode: 'auto', height: null };
}
