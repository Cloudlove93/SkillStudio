import type { AnswerSkillOptimizationDetail } from '../../api/answer-skill-optimizations';

type ReviewSource = Pick<AnswerSkillOptimizationDetail, 'patch' | 'diff'>;

export interface AnswerOptimizationReviewItem {
  id: string;
  title: string;
  summary: string;
  before: string;
  after: string;
}

function markdownSections(content: string): Array<{ title: string; content: string }> {
  const lines = content.trim().split(/\r?\n/u);
  const sections: Array<{ title: string; content: string }> = [];
  let current: { title: string; lines: string[] } | null = null;
  for (const line of lines) {
    const heading = line.match(/^#{2,6}\s+(.+)$/u);
    if (heading) {
      if (current) sections.push({ title: current.title, content: current.lines.join('\n').trim() });
      current = { title: heading[1]!.trim(), lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) sections.push({ title: current.title, content: current.lines.join('\n').trim() });
  return sections;
}

export function createOptimizationReviewItems(
  source: ReviewSource,
): AnswerOptimizationReviewItem[] {
  if (source.patch) {
    const beforeSections = markdownSections(source.diff?.before ?? '');
    const afterSections = markdownSections(source.diff?.after ?? '');
    if (afterSections.length > 1) {
      const beforeByTitle = new Map(beforeSections.map((section) => [section.title, section.content]));
      return afterSections.slice(0, 6).map((section, index) => ({
        id: `${source.patch!.section}:${section.title}:${index}`,
        title: section.title,
        summary: index === 0 ? source.patch!.reason.trim() : '已随本轮草案一起更新。',
        before: beforeByTitle.get(section.title) ?? '',
        after: section.content,
      }));
    }
    return [{
      id: `${source.patch.section}:${source.patch.operation}`,
      title: `调整 ${source.patch.section}`,
      summary: source.patch.reason.trim() || `已更新 ${source.patch.section}。`,
      before: source.diff?.before.trim() || '',
      after: source.diff?.after.trim() || source.patch.proposedContent.trim(),
    }];
  }
  if (!source.diff) return [];
  return [{
    id: 'generated-change',
    title: '更新 Skill 规则',
    summary: '已根据本轮反馈整理修改。',
    before: source.diff.before.trim(),
    after: source.diff.after.trim(),
  }];
}

export function buildChangeRemovalFeedback(
  item: Pick<AnswerOptimizationReviewItem, 'title' | 'summary' | 'after'>,
): string {
  const target = (item.after.trim() || item.summary.trim()).replace(/[。！？!?]+$/u, '');
  return `撤销“${item.title}”这一项修改：${target}。保留本轮草案中的其他修改不变。`;
}
