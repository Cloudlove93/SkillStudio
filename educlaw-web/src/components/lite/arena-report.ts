import type { ArenaReport } from '@educlaw/shared';

export interface ArenaReportRow {
  key: string;
  name: string;
  baselineScore: number;
  baselineMaxScore: number;
  baselineReason: string;
  enhancedScore: number;
  enhancedMaxScore: number;
  enhancedReason: string;
  diff: number;
}

export interface ArenaReportSideCard {
  key: 'baseline' | 'enhanced';
  label: string;
  total: number;
  summary: string;
}

function resolveArenaReportLabels(
  labelsOrEnhancedLabel?: { baseline: string; enhanced: string } | string,
) {
  if (labelsOrEnhancedLabel && typeof labelsOrEnhancedLabel === 'object') {
    return labelsOrEnhancedLabel;
  }
  return {
    baseline: '基础模型',
    enhanced: labelsOrEnhancedLabel || 'Enhanced',
  };
}

export function formatArenaReportWinner(
  winningSide: ArenaReport['winningSide'],
  labelsOrEnhancedLabel: { baseline: string; enhanced: string } | string,
): string {
  const labels = resolveArenaReportLabels(labelsOrEnhancedLabel);
  if (winningSide === 'baseline') {
    return labels.baseline;
  }
  if (winningSide === 'enhanced') {
    return labels.enhanced;
  }
  return '平局';
}

export function buildArenaReportRows(report: ArenaReport): ArenaReportRow[] {
  const baselineByKey = new Map(
    report.baseline.dimensions.map(
      (dimension) => [dimension.key, dimension] as const,
    ),
  );
  const enhancedByKey = new Map(
    report.enhanced.dimensions.map(
      (dimension) => [dimension.key, dimension] as const,
    ),
  );
  const orderedKeys = [
    ...report.baseline.dimensions.map((dimension) => dimension.key),
    ...report.enhanced.dimensions
      .map((dimension) => dimension.key)
      .filter((key) => !baselineByKey.has(key)),
  ];

  return orderedKeys.map((key) => {
    const baseline = baselineByKey.get(key);
    const enhanced = enhancedByKey.get(key);
    const name = baseline?.name || enhanced?.name || key;
    const baselineScore = baseline?.score ?? 0;
    const enhancedScore = enhanced?.score ?? 0;
    const fallbackMaxScore = baseline?.maxScore ?? enhanced?.maxScore ?? 10;

    return {
      key,
      name,
      baselineScore,
      baselineMaxScore: baseline?.maxScore ?? fallbackMaxScore,
      baselineReason: baseline?.reason ?? '',
      enhancedScore,
      enhancedMaxScore: enhanced?.maxScore ?? fallbackMaxScore,
      enhancedReason: enhanced?.reason ?? '',
      diff: enhancedScore - baselineScore,
    };
  });
}

export function buildArenaReportSideCards(
  report: ArenaReport,
  labelsOrEnhancedLabel: { baseline: string; enhanced: string } | string,
): ArenaReportSideCard[] {
  const labels = resolveArenaReportLabels(
    report.labels || labelsOrEnhancedLabel,
  );
  return [
    {
      key: 'baseline',
      label: labels.baseline,
      total: report.baseline.total,
      summary: report.baseline.summary,
    },
    {
      key: 'enhanced',
      label: labels.enhanced,
      total: report.enhanced.total,
      summary: report.enhanced.summary,
    },
  ];
}
