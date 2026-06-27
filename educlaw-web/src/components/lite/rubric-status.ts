const RUBRIC_REQUIRED_HEADINGS = [
  '# Rubric',
  '## \u8bc4\u5206\u76ee\u6807',
  '## \u8bc4\u5206\u7ef4\u5ea6',
  '### \u89d2\u8272\u8d34\u5408',
  '### Skill \u9075\u5faa',
  '### \u56de\u7b54\u8d28\u91cf',
  '### \u5b89\u5168\u8fb9\u754c',
  '## \u4f7f\u7528\u8bf4\u660e',
];

function normalizeRubricMarkdown(rubricMd: string | null | undefined): string {
  return String(rubricMd || '').trim();
}

function hasTemplateRubricStructure(content: string): boolean {
  if (!content) return false;
  if (RUBRIC_REQUIRED_HEADINGS.some((heading) => !content.includes(heading))) {
    return false;
  }
  return (content.match(/^###\s+/gm) || []).length >= 4;
}

function hasLegacyRubricStructure(content: string): boolean {
  const numberedSections = content.match(/^\s*\d+[.)\u3001]\s+/gm) || [];
  const hasScoringLanguage =
    /(?:\u8bc4\u4f30\u8981\u70b9|\u8bc4\u5206\u8981\u70b9|\u8bc4\u5206\u6807\u51c6|\u7b49\u7ea7|\u4f18\u79c0|\u826f\u597d|\u5f85\u6539\u8fdb|\u4e0d\u5408\u683c)/.test(
      content,
    );
  return numberedSections.length >= 4 && hasScoringLanguage;
}

function hasWeightedLegacyRubricStructure(content: string): boolean {
  const numberedSections =
    content.match(/^\s*(?:\d+[.)\u3001]|[\u2460-\u2468])\s*/gm) || [];
  const hasScoringLanguage =
    /(?:\u6574\u4f53\u8bc4\u4ef7|\u5177\u4f53\u8bc4\u4ef7|\u6743\u91cd|\u4f18\u79c0|\u826f\u597d|\u5408\u683c|\u5f85\u6539\u8fdb|\u4e0d\u5408\u683c)/.test(
      content,
    );
  return numberedSections.length >= 4 && hasScoringLanguage;
}

function looksLikeWeightedRubric(content: string): boolean {
  const dimensionHeadings =
    content.match(/^\s*(?:[\u2460-\u2468]|\d+[.)\u3001])\s*[^\n]+$/gm) || [];
  const hasWeights =
    /(?:\d{1,3}\s*%)|(?:\u6743\u91cd)|(?:\u6bd4\u4f8b)|(?:\u5360\u6bd4)/.test(
      content,
    );
  const hasEvaluationShape =
    /(?:\u6574\u4f53\u8bc4\u4ef7|\u5177\u4f53\u8bc4\u4ef7|\u8bc4\u4ef7\u51c6\u5219|\u8bc4\u4f30\u6807\u51c6|\u8bc4\u5206\u6807\u51c6|Evaluation Criteria|Rubric)/i.test(
      content,
    );
  return dimensionHeadings.length >= 4 && (hasWeights || hasEvaluationShape);
}

function hasTabularLegacyRubricStructure(content: string): boolean {
  const percentMatches = content.match(/\b\d{1,3}\s*%/g) || [];
  const hasHeaderSignals =
    /(?:\u8bc4\u4ef7\u51c6\u5219|\u8bc4\u4f30\u6807\u51c6|\u8bc4\u5206\u6807\u51c6|Evaluation Criteria|Rubric)/i.test(
      content,
    );
  const hasTableColumns = /(?:\u7ef4\u5ea6|\u6743\u91cd)/.test(content);
  const hasGradeSignals =
    /(?:\u4f18\u79c0|\u826f\u597d|\u5408\u683c|\u5f85\u6539\u8fdb|\u4e0d\u5408\u683c)/.test(
      content,
    );
  return (
    hasHeaderSignals &&
    hasTableColumns &&
    hasGradeSignals &&
    percentMatches.length >= 3 &&
    content.length >= 120
  );
}

function hasCompactScorableRubricStructure(content: string): boolean {
  const markdownDimensions = content.match(/^###\s+[^\n]+$/gm) || [];
  const numberedDimensions =
    content.match(
      /^\s*(?:###\s*)?(?:\d+[.)\u3001]\s*[^\d\s][^\n]*|\u7ef4\u5ea6[\u4e00-\u5341]?[^\n]*)$/gm,
    ) || [];
  const hasDimensionSection =
    /(?:##\s*(?:\u8bc4\u5206\u7ef4\u5ea6|\u8bc4\u4f30\u7ef4\u5ea6)|\u8bc4\u4ef7\u51c6\u5219|\u8bc4\u4f30\u6807\u51c6|\u8bc4\u5206\u6807\u51c6|Evaluation Criteria|Rubric)/i.test(
      content,
    );
  const hasScoringSignals =
    /(?:\u4f18\u79c0|\u826f\u597d|\u5408\u683c|\u5f85\u6539\u8fdb|\u4e0d\u5408\u683c|\u6ee1\u5206\u6807\u51c6|\u8bc4\u5206|score|Full score)/i.test(
      content,
    );
  const hasSummaryGoal =
    /(?:Overall evaluation|\u6574\u4f53\u8bc4\u4ef7|\u8bc4\u5206\u76ee\u6807|\u8bc4\u4f30\u76ee\u6807|\u8bc4\u4ef7\u76ee\u6807)/i.test(
      content,
    );
  const hasStructuredBody = /[-*]\s+/.test(content) || hasScoringSignals;
  return (
    hasDimensionSection &&
    (markdownDimensions.length >= 2 ||
      numberedDimensions.length >= 3 ||
      (numberedDimensions.length >= 2 && hasSummaryGoal)) &&
    hasStructuredBody
  );
}

function hasScoreBandWeightedRubricStructure(content: string): boolean {
  const dimensionHeadings =
    content.match(/^\s*维度[一二三四五六七八九十百0-9]+[:：]?[^\n]*$/gmu) || [];
  const hasHeaderSignals =
    /(?:\u8bc4\u4f30\u91cf\u8868|\u8bc4\u4f30\u6807\u51c6|\u8bc4\u5206\u6807\u51c6|\u8bc4\u4ef7\u51c6\u5219|Evaluation Criteria|Rubric)/i.test(
      content,
    );
  const hasWeights =
    /(?:\u6743\u91cd)|(?:\d{1,3}\s*%)/.test(content);
  const hasScoreBands =
    /(?:\u5206\u503c|\u8bc4\u7ea7\u6807\u51c6|(?:^|\s)[1-5]\u5206(?:\s|$))/m.test(
      content,
    );
  return (
    dimensionHeadings.length >= 4 &&
    hasHeaderSignals &&
    hasWeights &&
    hasScoreBands
  );
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
  return '当前 rubric 还不能直接用于评分。请补充评分维度、分值或评分说明，或先点“修复 rubric”让 AI 补全。';
}
