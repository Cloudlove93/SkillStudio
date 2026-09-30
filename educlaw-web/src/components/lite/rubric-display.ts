const DISPLAY_BOUNDARY_PATTERNS = [
  /^(?:#{1,6}\s*)?分级描述(?:（.*?）)?(?:[:：\s]|$)/i,
  /^(?:#{1,6}\s*)?(?:案例对比|案例参考|正面案例|反面案例)(?:[:：\s]|$)/i,
  /^(?:#{1,6}\s*)?(?:测试情景|测试场景|情景测试)(?:[:：\s]|$)/i,
  /^(?:#{1,6}\s*)?(?:规范依据|政策依据|参考依据|法规依据)(?:[:：\s]|$)/i,
  /^(?:#{1,6}\s*)?(?:附录|参考资料|references?|appendix)(?:[:：\s]|$)/i,
  /^\s*[6789]\s*[、.)）]\s*(?:案例对比|案例参考|测试情景|测试场景|规范依据|附录|参考资料)/i,
] as const;

const RAW_RUBRIC_SECTION_PATTERNS = [
  /^\s*##\s*原始\s*rubric\s*要点\s*$/i,
  /^\s*原始\s*rubric\s*要点\s*$/i,
  /^\s*##\s*原始\s*rubric\s*内容\s*$/i,
  /^\s*原始\s*rubric\s*内容\s*$/i,
  /^\s*##\s*原始评分内容\s*$/i,
  /^\s*原始评分内容\s*$/i,
] as const;

const MAIN_RUBRIC_START_PATTERNS = [
  /^\s*(?:#{1,6}\s*)?\d+\s*[、.)）]\s*(?:评价|评估|评分)(?:准则|标准|量表)/,
  /^\s*(?:#{1,6}\s*)?(?:评价|评估|评分)(?:准则|标准|量表)(?:\s*[（(].*?[)）])?\s*$/i,
  /^\s*(?:#{1,6}\s*)?维度[一二三四五六七八九十百0-9]+[:：]/,
  // 兜底：纯"评价准则/评分标准/..."（无编号、无副标题），与后端 RUBRIC_SECTION_KEYWORDS 对齐
  /^\s*(?:#{1,6}\s*)?(?:评价准则|评价标准|评分标准|评估标准|评估准则|评分准则|评价量表|评估量表|评分量表)\s*$/i,
] as const;

const SUMMARY_SECTION_PATTERNS = [
  /^\s*(?:整体评价|Overall evaluation)[:：]/i,
  /^\s*(?:具体评价|Specific evaluation)[:：]?\s*$/i,
] as const;

function isDisplayBoundary(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return DISPLAY_BOUNDARY_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function stripDisplaySupportTail(content: string): string {
  const lines = content.split(/\r?\n/);
  const kept: string[] = [];

  for (const line of lines) {
    if (isDisplayBoundary(line)) break;
    kept.push(line);
  }

  return kept.join('\n').trim();
}

function stripNarrativeSummarySections(content: string): string {
  const lines = content.split(/\r?\n/);
  const kept: string[] = [];
  let skippingSummary = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (SUMMARY_SECTION_PATTERNS.some((pattern) => pattern.test(line))) {
      skippingSummary = true;
      continue;
    }

    if (skippingSummary) {
      if (
        /^(?:[①②③④⑤⑥⑦⑧⑨⑩]|\d+[、.)）]|维度[一二三四五六七八九十百0-9]+[:：])/.test(
          line,
        )
      ) {
        skippingSummary = false;
      } else {
        continue;
      }
    }

    kept.push(rawLine);
  }

  const compacted: string[] = [];
  let previousBlank = false;
  for (const line of kept) {
    const blank = !line.trim();
    if (blank && previousBlank) continue;
    compacted.push(line);
    previousBlank = blank;
  }

  return compacted.join('\n').trim();
}

function findMainRubricStartIndex(lines: string[]): number {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() || '';
    if (!line) continue;
    if (MAIN_RUBRIC_START_PATTERNS.some((pattern) => pattern.test(line))) {
      return index;
    }
  }

  return -1;
}

function extractMainRubricBlock(content: string): string {
  const lines = content.split(/\r?\n/);
  const startIndex = findMainRubricStartIndex(lines);
  if (startIndex === -1) return '';

  let blockStartIndex = startIndex;
  let previousLine = '';

  for (let index = startIndex - 1; index >= 0; index -= 1) {
    const candidate = lines[index]?.trim() || '';
    if (!candidate) continue;
    previousLine = candidate;
    break;
  }

  if (
    previousLine &&
    /(?:评价准则|评估标准|评分标准|评估量表|评分量表|rubric|evaluation criteria)/i.test(
      previousLine,
    )
  ) {
    blockStartIndex = startIndex - 1;
  }

  return stripNarrativeSummarySections(
    stripDisplaySupportTail(lines.slice(blockStartIndex).join('\n')),
  );
}

function extractRawRubricSection(content: string): string {
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (!RAW_RUBRIC_SECTION_PATTERNS.some((pattern) => pattern.test(line))) {
      continue;
    }

    return lines
      .slice(index + 1)
      .join('\n')
      .trim();
  }

  return '';
}

export function extractDisplayRubricContent(content: string): string {
  const normalized = content.trim();
  if (!normalized) return '';

  const rawRubricSection = extractRawRubricSection(normalized);
  if (rawRubricSection) {
    const rawMainBlock = extractMainRubricBlock(rawRubricSection);
    if (rawMainBlock) return rawMainBlock;

    const cleanedRawRubric = stripNarrativeSummarySections(
      stripDisplaySupportTail(rawRubricSection),
    );
    if (cleanedRawRubric) return cleanedRawRubric;
  }

  const mainBlock = extractMainRubricBlock(normalized);
  if (mainBlock) return mainBlock;

  return (
    stripNarrativeSummarySections(stripDisplaySupportTail(normalized)) ||
    normalized
  );
}
