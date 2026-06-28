import { extractDisplayRubricContent } from './rubric-display.ts';

const RUBRIC_REQUIRED_HEADINGS = [
  '# Rubric',
  '## 评分目标',
  '## 评分维度',
  '## 使用说明',
];

function normalizeRubricMarkdown(rubricMd: string | null | undefined): string {
  const normalized = String(rubricMd || '').trim();
  if (!normalized) return '';
  return extractDisplayRubricContent(normalized);
}

function normalizeLegacyDimensionHeading(line: string): string {
  return line
    .trim()
    .replace(/^(?:###\s*)?/, '')
    .replace(/^(?:[①②③④⑤⑥⑦⑧⑨⑩]|\d+[.)、])\s*/, '')
    .replace(/[:：].*$/, '')
    .trim()
    .toLowerCase();
}

function isSupportOnlyLegacyHeading(line: string): boolean {
  const normalized = normalizeLegacyDimensionHeading(line);
  if (!normalized) return false;

  return (
    /^(?:整体评价|具体评价)$/i.test(normalized) ||
    /(?:案例对比|案例参考|测试情景|测试场景|规范依据|政策依据|参考依据|法规依据|case comparison|scenarios?|guidelines?|references?|appendix|notes?)/i.test(
      normalized,
    )
  );
}

function countScorableLegacyDimensionLines(content: string): number {
  const matches =
    content.match(
      /^\s*(?:###\s*)?(?:[①②③④⑤⑥⑦⑧⑨⑩]|\d+[.)、]|维度[一二三四五六七八九十百0-9]+[:：]?)[^\n]*$/gmu,
    ) || [];

  return matches.filter((line) => !isSupportOnlyLegacyHeading(line)).length;
}

function hasTemplateRubricStructure(content: string): boolean {
  if (!content) return false;
  if (RUBRIC_REQUIRED_HEADINGS.some((heading) => !content.includes(heading))) {
    return false;
  }
  return (content.match(/^###\s+/gm) || []).length >= 4;
}

function hasLegacyRubricStructure(content: string): boolean {
  const numberedSections = countScorableLegacyDimensionLines(content);
  const hasHeaderSignals =
    /(?:评价准则|评估标准|评分标准|评价标准|Evaluation Criteria|Rubric)/i.test(
      content,
    );
  const hasStructuredScores =
    /(?:\d{1,3}\s*%)|(?:权重)|(?:等级)|(?:优秀)|(?:良好)|(?:合格)|(?:待改进)|(?:不合格)|(?:分值)|(?:评级标准)|(?:满分标准)/.test(
      content,
    );
  const hasNarrativeRubricShape =
    numberedSections >= 3 &&
    /(?:整体评价|具体评价|应提供|评估要点|评分要点)/.test(content);

  return (
    hasHeaderSignals &&
    numberedSections >= 1 &&
    (hasStructuredScores || hasNarrativeRubricShape)
  );
}

function hasWeightedLegacyRubricStructure(content: string): boolean {
  const numberedSections = countScorableLegacyDimensionLines(content);
  const hasHeaderSignals =
    /(?:评价准则|评估标准|评分标准|评价标准|Evaluation Criteria|Rubric)/i.test(
      content,
    );
  const hasScoringLanguage =
    /(?:整体评价|具体评价|权重|优秀|良好|合格|待改进|不合格)/.test(content);

  return hasHeaderSignals && numberedSections >= 1 && hasScoringLanguage;
}

function looksLikeWeightedRubric(content: string): boolean {
  const dimensionHeadings = countScorableLegacyDimensionLines(content);
  const hasHeaderSignals =
    /(?:评价准则|评估标准|评分标准|评价标准|Evaluation Criteria|Rubric)/i.test(
      content,
    );
  const hasWeights = /(?:\d{1,3}\s*%)|(?:权重)|(?:比例)|(?:占比)/.test(content);
  const hasEvaluationShape = /(?:整体评价|具体评价|应提供)/i.test(content);

  return (
    hasHeaderSignals &&
    dimensionHeadings >= 1 &&
    (hasWeights || hasEvaluationShape)
  );
}

function hasTabularLegacyRubricStructure(content: string): boolean {
  const percentMatches = content.match(/\b\d{1,3}\s*%/g) || [];
  const hasHeaderSignals =
    /(?:评价准则|评估标准|评分标准|Evaluation Criteria|Rubric)/i.test(content);
  const hasTableColumns = /(?:维度|权重)/.test(content);
  const hasGradeSignals = /(?:优秀|良好|合格|待改进|不合格)/.test(content);

  return (
    hasHeaderSignals &&
    hasTableColumns &&
    hasGradeSignals &&
    percentMatches.length >= 1 &&
    content.length >= 60
  );
}

function hasCompactScorableRubricStructure(content: string): boolean {
  const markdownDimensions = content.match(/^###\s+[^\n]+$/gm) || [];
  const numberedDimensions =
    content.match(
      /^\s*(?:###\s*)?(?:\d+[.)、]\s*[^\d\s][^\n]*|维度[一二三四五六七八九十百0-9]+[^\n]*)$/gmu,
    ) || [];
  const hasDimensionSection =
    /(?:##\s*(?:评分维度|评估维度)|评价准则|评估标准|评分标准|Evaluation Criteria|Rubric)/i.test(
      content,
    );
  const hasScoringSignals =
    /(?:优秀|良好|合格|待改进|不合格|满分标准|评分|score|Full score)/i.test(
      content,
    );
  const hasSummaryGoal =
    /(?:Overall evaluation|整体评价|评分目标|评估目标|评价目标)/i.test(content);
  const hasWeightSignals =
    /(?:\d{1,3}\s*%)|(?:权重)|(?:分值)|(?:评级标准)/.test(content);
  const hasStructuredBody = /[-*]\s+/.test(content) || hasScoringSignals;

  return (
    hasDimensionSection &&
    ((markdownDimensions.length >= 1 && hasStructuredBody) ||
      (numberedDimensions.length >= 2 &&
        (hasScoringSignals || hasSummaryGoal || hasWeightSignals)))
  );
}

function hasScoreBandWeightedRubricStructure(content: string): boolean {
  const dimensionHeadings =
    content.match(/^\s*维度[一二三四五六七八九十百0-9]+[:：]?[^\n]*$/gmu) || [];
  const hasWeights = /(?:权重)|(?:\d{1,3}\s*%)/.test(content);
  const hasScoreBands = /(?:分值|评级标准|(?:^|\s)[1-5]分(?:\s|$))/m.test(
    content,
  );

  return dimensionHeadings.length >= 1 && hasWeights && hasScoreBands;
}

export function hasRubricContent(rubricMd: string | null | undefined): boolean {
  return normalizeRubricMarkdown(rubricMd).length > 0;
}

export function isRubricUsable(rubricMd: string | null | undefined): boolean {
  const content = normalizeRubricMarkdown(rubricMd);
  if (!content) return false;

  return (
    hasTemplateRubricStructure(content) ||
    hasLegacyRubricStructure(content) ||
    hasWeightedLegacyRubricStructure(content) ||
    looksLikeWeightedRubric(content) ||
    hasTabularLegacyRubricStructure(content) ||
    hasCompactScorableRubricStructure(content) ||
    hasScoreBandWeightedRubricStructure(content)
  );
}

export function getRubricEditValidationError(
  rubricMd: string | null | undefined,
): string {
  const content = normalizeRubricMarkdown(rubricMd);
  if (!content) return '编辑内容不能为空';
  if (isRubricUsable(content)) return '';

  return '当前 rubric 结构较松，但仍可保存。生成报告会尽量基于现有内容打分；如需更稳定的评分，可继续补充评分维度、权重或等级说明。';
}
