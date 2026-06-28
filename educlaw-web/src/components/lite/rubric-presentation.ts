export type RubricLevelTablePresentation = {
  kind: 'level-table';
  raw: string;
  title: string;
  dimensionCount: number;
  weighted: boolean;
  columns: string[];
  rows: Array<{
    cells: string[];
  }>;
};

export type RubricScoreBandPresentation = {
  kind: 'score-band';
  raw: string;
  title: string;
  dimensionCount: number;
  weighted: boolean;
  dimensions: Array<{
    title: string;
    weight?: string;
    bands: Array<{
      label: string;
      reason: string;
    }>;
  }>;
};

export type RubricCriteriaPresentation = {
  kind: 'criteria';
  raw: string;
  title: string;
  dimensionCount: number;
  weighted: boolean;
  rows: Array<{
    title: string;
    weight?: string;
    reason: string;
  }>;
};

export type RubricMarkdownPresentation = {
  kind: 'markdown';
  raw: string;
  title: string;
  dimensionCount: number;
  weighted: boolean;
};

export type RubricPresentation =
  | RubricLevelTablePresentation
  | RubricScoreBandPresentation
  | RubricCriteriaPresentation
  | RubricMarkdownPresentation;

const SUPPORT_ONLY_SECTION_PATTERNS = [
  /^(?:分级描述)(?:[:：\s]|$)/i,
  /^(?:案例对比|案例参考|正面案例|反面案例)(?:[:：\s]|$)/i,
  /^(?:测试情景|测试场景|情景测试)(?:[:：\s]|$)/i,
  /^(?:规范依据|政策依据|参考依据|法规依据)(?:[:：\s]|$)/i,
  /^(?:附录|参考资料|参考文献|references?|appendix)(?:[:：\s]|$)/i,
] as const;

const CANONICAL_RUBRIC_TITLES = [
  '评价准则',
  '评估标准',
  '评分标准',
  '评价量表',
  '评估量表',
  'Rubric',
] as const;

function cleanPresentationText(value: string): string {
  return value
    .trim()
    .replace(/^#+\s*/, '')
    .replace(/^\d+\s*[、.．)\]]\s*/, '')
    .replace(/^[（(]\d+[)）]\s*/, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

function normalizeDisplayTitle(value: string): string {
  const cleaned = cleanPresentationText(value);
  const canonical = CANONICAL_RUBRIC_TITLES.find((title) =>
    cleaned.startsWith(title),
  );

  return canonical || cleaned;
}

function isMarkdownDividerCell(value: string): boolean {
  return /^:?-{3,}:?$/.test(value.trim());
}

function isMarkdownDividerRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every(isMarkdownDividerCell);
}

function normalizeLines(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line, index, lines) => {
      if (line.trim()) return true;
      const previous = lines[index - 1]?.trim() || '';
      const next = lines[index + 1]?.trim() || '';
      return Boolean(previous && next);
    });
}

function extractTitle(lines: string[]): string {
  for (const rawLine of lines) {
    const line = normalizeDisplayTitle(rawLine);
    if (!line) continue;
    if (/^(?:维度|权重|分值|评分等级|评级标准)\b/.test(line)) continue;
    return line;
  }

  return 'Rubric';
}

function splitStructuredCells(line: string): string[] {
  if (line.includes('\t')) {
    const cells = line
      .split('\t')
      .map((cell) => cleanPresentationText(cell))
      .filter(Boolean);
    return isMarkdownDividerRow(cells) ? [] : cells;
  }

  if (line.includes('|')) {
    const cells = line
      .split('|')
      .map((cell) => cleanPresentationText(cell))
      .filter(Boolean);
    return isMarkdownDividerRow(cells) ? [] : cells;
  }

  return [];
}

function hasStructuredDelimiter(line: string): boolean {
  return line.includes('\t') || line.includes('|');
}

function looksLikeLevelTableHeader(cells: string[]): boolean {
  if (cells.length < 3) return false;
  const joined = cells.join(' | ');

  return (
    /维度/.test(joined) &&
    /(优秀|良好|合格|待改进|不合格|评分等级|评级标准|5分|4分|3分)/.test(joined)
  );
}

function parseLevelTable(
  lines: string[],
  raw: string,
): RubricLevelTablePresentation | null {
  for (let index = 0; index < lines.length; index += 1) {
    const headerCells = splitStructuredCells(lines[index] || '');
    if (!looksLikeLevelTableHeader(headerCells)) continue;

    const rows: Array<{ cells: string[] }> = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const rawLine = lines[cursor] || '';
      const cells = splitStructuredCells(rawLine);
      if (!cells.length && hasStructuredDelimiter(rawLine)) continue;
      if (!cells.length || cells.length < 2) break;
      rows.push({ cells });
    }

    if (!rows.length) continue;

    return {
      kind: 'level-table',
      raw,
      title: extractTitle(lines),
      dimensionCount: rows.length,
      weighted: headerCells.some((cell) => /权重|占比|比例/.test(cell)),
      columns: headerCells,
      rows,
    };
  }

  return null;
}

function isDimensionHeading(line: string): boolean {
  return /^维度[一二三四五六七八九十百0-9]+[:：]?\s*/.test(line.trim());
}

function parseDimensionTitle(line: string): string {
  const trimmed = line.trim();
  const match = trimmed.match(
    /^维度[一二三四五六七八九十百0-9]+[:：]?\s*(.+)$/,
  );
  if (match?.[1]) return cleanPresentationText(match[1]);
  return cleanPresentationText(trimmed);
}

function parseScoreBandLine(
  line: string,
): { label: string; reason: string } | null {
  const match = line
    .trim()
    .match(
      /^(优秀(?:\s*\(\d+\))?|良好(?:\s*\(\d+\))?|合格(?:\s*\(\d+\))?|待改进(?:\s*\(\d+\))?|不合格(?:\s*\(\d+\))?|严重失误(?:\s*\(\d+\))?|[1-5]分)\s+(.+)$/,
    );
  if (!match) return null;

  return { label: match[1].trim(), reason: cleanPresentationText(match[2]) };
}

function parseScoreBands(
  lines: string[],
  raw: string,
): RubricScoreBandPresentation | null {
  const dimensions: RubricScoreBandPresentation['dimensions'] = [];
  let current: RubricScoreBandPresentation['dimensions'][number] | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (isDimensionHeading(line)) {
      current = {
        title: parseDimensionTitle(line),
        bands: [],
      };
      dimensions.push(current);
      continue;
    }

    if (!current) continue;

    const weightMatch = line.match(/^权重[:：]\s*(.+)$/);
    if (weightMatch) {
      current.weight = cleanPresentationText(weightMatch[1]);
      continue;
    }

    if (/^(分值|评分等级|评级标准)(?:\s+.+)?$/.test(line)) continue;

    const band = parseScoreBandLine(line);
    if (band) current.bands.push(band);
  }

  const validDimensions = dimensions.filter(
    (dimension) => dimension.bands.length > 0,
  );
  if (!validDimensions.length) return null;

  return {
    kind: 'score-band',
    raw,
    title: extractTitle(lines),
    dimensionCount: validDimensions.length,
    weighted: validDimensions.some((dimension) => Boolean(dimension.weight)),
    dimensions: validDimensions,
  };
}

function isCriteriaHeading(line: string): boolean {
  return /^(?:[①②③④⑤⑥⑦⑧⑨⑩]|\d+[、.)）])\s*/.test(line.trim());
}

function cleanCriteriaTitle(line: string): { title: string; weight?: string } {
  const trimmed = cleanPresentationText(
    line.trim().replace(/^(?:[①②③④⑤⑥⑦⑧⑨⑩]|\d+[、.)）])\s*/, ''),
  );
  const weightMatch = trimmed.match(/（?\s*权重[:：]?\s*([^）)]+)\s*）?/);
  const title = trimmed
    .replace(/（?\s*权重[:：]?\s*[^）)]+\s*）?/, '')
    .replace(/[（(]\s*$/, '')
    .trim();

  return {
    title,
    weight: weightMatch?.[1]?.trim(),
  };
}

function splitInlineCriteriaReason(title: string): {
  title: string;
  reason?: string;
} {
  const normalized = cleanPresentationText(title);
  if (!normalized) return { title: normalized };

  const inlineReasonMatch = normalized.match(
    /^(.+?)\s+(应提供|应体现|应包含|需要提供|需要体现|需要包含|用于评估|评估要点|评分要点)(.+)$/,
  );
  if (inlineReasonMatch) {
    return {
      title: inlineReasonMatch[1].trim(),
      reason: `${inlineReasonMatch[2]}${inlineReasonMatch[3]}`.trim(),
    };
  }

  const splitByGap = normalized.split(/\s{2,}|\t+/).map((part) => part.trim());
  if (splitByGap.length >= 2) {
    return {
      title: splitByGap[0] || normalized,
      reason: splitByGap.slice(1).join(' ').trim(),
    };
  }

  return { title: normalized };
}

function isSupportOnlyCriteriaTitle(title: string): boolean {
  const normalized = title.trim();
  if (!normalized) return false;
  return SUPPORT_ONLY_SECTION_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );
}

function parseCriteria(
  lines: string[],
  raw: string,
): RubricCriteriaPresentation | null {
  const rows: RubricCriteriaPresentation['rows'] = [];
  let current: RubricCriteriaPresentation['rows'][number] | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^(整体评价|具体评价)[:：]/.test(line)) continue;

    if (isCriteriaHeading(line)) {
      const heading = cleanCriteriaTitle(line);
      if (isSupportOnlyCriteriaTitle(heading.title)) break;
      const inlineSplit = splitInlineCriteriaReason(heading.title);
      current = {
        title: inlineSplit.title,
        weight: heading.weight,
        reason: inlineSplit.reason || '',
      };
      rows.push(current);
      continue;
    }

    if (!current) continue;
    current.reason = current.reason
      ? `${current.reason}\n${cleanPresentationText(line)}`.trim()
      : cleanPresentationText(line);
  }

  const validRows = rows.filter((row) => row.title && row.reason);
  if (!validRows.length) return null;

  return {
    kind: 'criteria',
    raw,
    title: extractTitle(lines),
    dimensionCount: validRows.length,
    weighted: validRows.some((row) => Boolean(row.weight)),
    rows: validRows,
  };
}

export function parseRubricPresentation(content: string): RubricPresentation {
  const raw = content.trim();
  const lines = normalizeLines(raw);

  return (
    parseLevelTable(lines, raw) ||
    parseScoreBands(lines, raw) ||
    parseCriteria(lines, raw) || {
      kind: 'markdown',
      raw,
      title: extractTitle(lines),
      dimensionCount: 0,
      weighted: false,
    }
  );
}
