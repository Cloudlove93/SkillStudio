import type { ArenaReport } from '@educlaw/shared';

export interface GeneratedReportViewState {
  detailTab: 'report';
  centerPreview: {
    type: 'report';
    name: string;
    report: ArenaReport;
  };
}

export function buildGeneratedReportViewState(
  report: ArenaReport,
  reportName = '评估报告',
): GeneratedReportViewState {
  return {
    detailTab: 'report',
    centerPreview: {
      type: 'report',
      name: reportName,
      report,
    },
  };
}

export function buildReportCompletionStatusMessage(
  isCurrentThreadSelected: boolean,
): string {
  return isCurrentThreadSelected
    ? '报告已生成'
    : '报告已生成，可返回原智能体查看';
}
