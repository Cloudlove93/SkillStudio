import AdmZip, { type IZipEntry } from 'adm-zip';
import type {
  AgentPackageDetail,
  AgentPackageSnapshot,
  AgentPackageSummary,
  PackageSkill,
  PackageVersion,
} from '@educlaw/shared';
import {
  generateChat,
  generateJson,
  generateText,
  streamText,
} from './llm-service.js';
import { getLogger } from '../lib/request-context.js';
import { safeError } from '../lib/logger.js';
import {
  buildAgentSystemPrompt,
  buildAgentUserPrompt,
  buildBaseMetadataSystemPrompt,
  buildBaseMetadataUserPrompt,
  buildRubricBoundaryReviewSystemPrompt,
  buildRubricBoundaryReviewUserPrompt,
  buildRubricLocatorSystemPrompt,
  buildRubricLocatorUserPrompt,
  buildRubricSystemPrompt,
  buildRubricUserPrompt,
  buildSkillSystemPrompt,
  buildSkillUserPrompt,
} from '../prompts/package-generation.js';
import { randomUUID } from 'node:crypto';
import { query, withTransaction, type Queryable } from './db.js';
import type { DbRowPackage, DbRowPackageVersion } from '../types.js';
import { parseDbJson } from '../utils/json.js';
import { syncPackageVersionSkillsFromSnapshot } from './skill-version-service.js';
import {
  createPackageZipReader,
  PackageZipSecurityError,
} from './package-import-security.js';

interface PackageGenerationResult {
  name: string;
  description: string;
  agentMd: string;
  rubricMd: string;
  skills: Array<{
    dirName: string;
    name: string;
    description: string;
    skillMd: string;
  }>;
}

interface PackageBaseGenerationResult {
  name: string;
  description: string;
  skills: Array<{
    dirName: string;
    name: string;
    description: string;
  }>;
}

interface PackageGeneratePreview {
  type: string;
  name: string;
  content: string;
}

interface PackageGeneratePreviewDelta {
  type: string;
  name: string;
  delta: string;
}

interface RubricBoundaryReviewResult {
  decision: 'keep' | 'expand_up' | 'expand_down' | 'expand_both';
  reason?: string;
  linesUp?: number;
  linesDown?: number;
}

interface RubricLocatorResult {
  startLine: number;
  endLine: number;
  confidence: 'high' | 'medium' | 'low' | 'none';
  reason?: string;
}

function emptyPackageSnapshot(): AgentPackageSnapshot {
  return {
    name: '',
    description: '',
    versionLabel: '',
    agentMd: '',
    rubricMd: '',
    skills: [],
  };
}

const MAX_BASE_DOCUMENT_CHARS = 12_000;
const MAX_SKILL_DOCUMENT_CHARS = 8_000;
const MAX_GENERATED_SKILLS = 2;
const MAX_SOURCE_RUBRIC_CHARS = 12_000;
const MAX_GENERATED_PACKAGE_NAME_CHARS = 10;
// AI 兜底定位 rubric 的窗口大小与触发阈值
const RUBRIC_LOCATOR_WINDOW_CHARS = 6_000;
const RUBRIC_LOCATOR_MIN_QUALITY_SIGNALS = 2;
const RUBRIC_LOCATOR_MIN_EXTRACTED_CHARS = 100;
const RUBRIC_SECTION_KEYWORDS = [
  'rubric',
  'evaluation criteria',
  '评分标准',
  '评估标准',
  '评估规则',
  '打分标准',
  '评测标准',
  '评价准则',
  '评价标准',
  '评估量表',
  '评价量表',
  '评分量表',
];

const RUBRIC_SUPPORT_BOUNDARY_PATTERNS = [
  /^(?:#{1,6}\s*)?分级描述(?:（.*?）|\(.*?\))?(?:[:：\s]|$)/i,
  /^(?:#{1,6}\s*)?(?:案例对比|案例参考|正面案例|反面案例)(?:[:：\s]|$)/i,
  /^(?:#{1,6}\s*)?(?:测试情景|测试场景|情景测试)(?:[:：\s]|$)/i,
  /^(?:#{1,6}\s*)?(?:规范依据|政策依据|参考依据|法规依据)(?:[:：\s]|$)/i,
  /^(?:#{1,6}\s*)?(?:附录|参考资料|参考文献|references?|appendix)(?:[:：\s]|$)/i,
  /^\s*[6789]\s*[、.)）]\s*(?:案例对比|案例参考|测试情景|测试场景|规范依据|附录|参考资料)/i,
];

const RAW_RUBRIC_SECTION_PATTERNS = [
  /^\s*##\s*原始\s*rubric\s*要点\s*$/i,
  /^\s*原始\s*rubric\s*要点\s*$/i,
  /^\s*##\s*原始\s*rubric\s*内容\s*$/i,
  /^\s*原始\s*rubric\s*内容\s*$/i,
  /^\s*##\s*原始评分内容\s*$/i,
  /^\s*原始评分内容\s*$/i,
];

const RUBRIC_SIGNAL_PATTERN =
  /(?:权重|占比|比例|分值|评分等级|评级标准|关键检查点|评估要点|评分要点|优秀|良好|合格|待改进|不合格|严重失误|满分标准|\d{1,3}\s*%|\|)/g;

function ensureSkillIds(snapshot: AgentPackageSnapshot): AgentPackageSnapshot {
  const skills = Array.isArray(snapshot.skills) ? snapshot.skills : [];
  const usedIds = new Set<string>();
  return {
    ...snapshot,
    skills: skills.map((skill, index) => {
      const rawId = String(skill.id || '').trim();
      if (rawId) {
        usedIds.add(rawId);
        return { ...skill, id: rawId };
      }
      const base =
        slugify(String(skill.dirName || '').trim()) ||
        slugify(String(skill.name || '').trim()) ||
        `skill-${index + 1}`;
      let nextId = base;
      let suffix = 2;
      while (usedIds.has(nextId)) {
        nextId = `${base}-${suffix}`;
        suffix += 1;
      }
      usedIds.add(nextId);
      return {
        ...skill,
        id: nextId,
      };
    }),
  };
}

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') ||
    `skill-${Math.random().toString(36).slice(2, 8)}`
  );
}

function buildDocumentContext(
  documents?: Array<{ name: string; content: string }>,
  maxChars = MAX_BASE_DOCUMENT_CHARS,
): string {
  if (!documents || documents.length === 0) return '';

  const parts = ['', 'Uploaded documents:'];
  let remaining = maxChars;

  for (let index = 0; index < documents.length; index += 1) {
    const document = documents[index];
    const name = String(document?.name || `Document ${index + 1}`);
    const content = String(document?.content || '');

    if (remaining <= 0) {
      parts.push(`[Document ${index + 1}: ${name}]\n[内容已因长度限制省略]`);
      continue;
    }

    const chunk = content.slice(0, remaining);
    remaining -= chunk.length;
    const truncated =
      chunk.length < content.length
        ? '\n[内容已截断以控制单次模型请求长度]'
        : '';
    parts.push(`[Document ${index + 1}: ${name}]\n${chunk}${truncated}`);
  }

  return parts.join('\n');
}

function getMarkdownHeadingLevel(line: string): number | null {
  const match = line.match(/^\s*(#{1,6})\s+/);
  return match ? match[1].length : null;
}

function normalizeSectionHeading(line: string): string {
  return line
    .trim()
    .replace(/^#{1,6}\s*/, '')
    .replace(/^[\d.\-()（）一二三四五六七八九十、\s]+/, '')
    // 剥掉末尾的括号副标题，如 "评价准则（基于智能体输出的评价维度）" → "评价准则"
    .replace(/\s*[（(][^（）()]*[)）]\s*$/, '')
    .replace(/[:：]\s*$/, '')
    .trim()
    .toLowerCase();
}

function isRubricSectionHeading(line: string): boolean {
  const normalized = normalizeSectionHeading(line);
  if (!normalized) return false;
  return RUBRIC_SECTION_KEYWORDS.some(
    (keyword) => normalized === keyword || normalized.endsWith(keyword),
  );
}

function isLikelyNumberedSectionHeading(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 50) return false;
  return /^\d+[、.)）]\s*[\u4e00-\u9fffA-Za-z]/.test(trimmed);
}

function isRubricSupportBoundary(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return RUBRIC_SUPPORT_BOUNDARY_PATTERNS.some((pattern) =>
    pattern.test(trimmed),
  );
}

function isLikelyRubricBodyLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (
    isSupportOnlyLegacyHeading(line) ||
    isLikelyRubricSupportSectionHeading(line) ||
    isRubricSupportBoundary(line)
  ) {
    return false;
  }

  return (
    /^(?:#{1,6}\s*)?(?:维度[一二三四五六七八九十百0-9]+|[①-⑨]|\d+[、.)）])/.test(
      trimmed,
    ) ||
    /(?:权重|占比|比例|分值|评分等级|评级标准|关键检查点|评估要点|评分要点|优秀|良好|合格|待改进|不合格|严重失误|\b[1-5]分\b|\d{1,3}\s*%|\|)/.test(
      trimmed,
    )
  );
}

function isLikelyRubricBoundaryLine(line: string): boolean {
  return isRubricSupportBoundary(line);
}

function truncateByCodePoints(value: string, maxChars: number): string {
  const chars = Array.from(value);
  if (chars.length <= maxChars) return value;
  return chars.slice(0, maxChars).join('');
}

function sanitizeGeneratedPackageName(name: string): string {
  const normalized = name
    .replace(/\s+/g, ' ')
    .replace(/[：:;；，,。.!！?？]+$/u, '')
    .trim();
  if (!normalized) return '智能体助手';
  return truncateByCodePoints(
    normalized,
    MAX_GENERATED_PACKAGE_NAME_CHARS,
  ).trim();
}

function isLikelyRubricSupportSectionHeading(line: string): boolean {
  const normalized = normalizeSectionHeading(line);
  if (!normalized) return false;
  return (
    /(?:案例对比|案例参考|正面案例|反面案例|对比案例|case comparison|case studies?|cases?)/i.test(
      normalized,
    ) ||
    /(?:测试情景|测试场景|情景测试|应用情景|scenarios?|test cases?)/i.test(
      normalized,
    ) ||
    /(?:规范依据|政策依据|参考依据|法规依据|课程标准|行动计划|standards?|policy basis|guidelines?)/i.test(
      normalized,
    )
  );
}

function isLikelyRubricContinuationHeading(line: string): boolean {
  return isLikelyStandaloneRubricStart(line);
}

function isLikelyStandaloneRubricStart(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;

  if (isRubricSectionHeading(line)) return true;

  const normalized = normalizeSectionHeading(line);
  // 第二组（标准|准则|量表）不再可选，避免"问题评估""方案评估"等非 rubric 章节误匹配
  return /(?:evaluation criteria|rubric|评估|评价|评分).*(?:标准|准则|量表)/i.test(
    normalized,
  );
}

function isStrongRubricCandidateStart(line: string): boolean {
  const normalized = normalizeSectionHeading(line);
  if (!normalized) return false;
  return (
    /^\d+\s*[、.)）]\s*(?:评价|评估|评分)(?:准则|标准|量表)/.test(
      line.trim(),
    ) ||
    /^维度[一二三四五六七八九十百0-9]+[:：.]/.test(line.trim()) ||
    /(?:^|[\s-])(evaluation criteria|rubric)(?:$|[\s-])/i.test(normalized) ||
    /(?:评分|评估|评价)(?:标准|准则|量表)/.test(normalized)
  );
}

function countRubricSignals(value: string): number {
  return (value.match(RUBRIC_SIGNAL_PATTERN) || []).length;
}

function scoreRubricCandidate(headingLine: string, extracted: string): number {
  let score = countRubricSignals(extracted);
  const trimmedHeading = headingLine.trim();
  if (
    /^\d+\s*[、.)）]\s*(?:评价|评估|评分)(?:准则|标准|量表)/.test(
      trimmedHeading,
    )
  ) {
    score += 140;
  } else if (isRubricSectionHeading(headingLine)) {
    score += /^#{1,6}\s*rubric$/i.test(trimmedHeading) ? 40 : 110;
  }
  score += Math.min(
    24,
    (extracted.match(/^\s*(?:#{1,6}\s*)?(?:\d+[.)、]|[①-⑨]|维度)/gmu) || [])
      .length * 4,
  );
  return score;
}

function collectRubricBlock(lines: string[], startIndex: number): string {
  const headingLevel = getMarkdownHeadingLevel(lines[startIndex] ?? '');
  const sectionLines: string[] = [];
  let rubricSignalCount = 0;

  for (let cursor = startIndex; cursor < lines.length; cursor += 1) {
    const currentLine = lines[cursor] ?? '';
    const currentHeadingLevel = getMarkdownHeadingLevel(currentLine);
    const rubricBodyLine = isLikelyRubricBodyLine(currentLine);
    const rubricExampleHeading =
      /^(?:#{1,6}\s*)?分级描述(?:（.*?）|\(.*?\))?(?:[:：\s]|$)/i.test(
        currentLine.trim(),
      );

    if (cursor > startIndex) {
      if (isLikelyRubricBoundaryLine(currentLine) || rubricExampleHeading)
        break;

      if (
        headingLevel !== null &&
        currentHeadingLevel !== null &&
        currentHeadingLevel <= headingLevel &&
        !rubricBodyLine
      ) {
        break;
      }

      if (headingLevel === null) {
        // 起始行不是 markdown 标题（如编号标题 "1. 评分标准"）。
        // 遇到 markdown 子标题时，只有当它级别较浅（h1-h3）且不是 rubric body 时才 break；
        // h4+ 视为 rubric 内部子章节（如 "#### 评分细则"），继续收集。
        if (
          currentHeadingLevel !== null &&
          currentHeadingLevel <= 3 &&
          !rubricBodyLine
        ) {
          break;
        }
        if (
          rubricSignalCount > 0 &&
          isLikelyNumberedSectionHeading(currentLine) &&
          !rubricBodyLine &&
          !isLikelyRubricContinuationHeading(currentLine)
        ) {
          break;
        }
      }
    }

    if (rubricBodyLine) rubricSignalCount += 1;
    sectionLines.push(currentLine);
  }

  return sectionLines.join('\n').trim();
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

function extractRubricSectionFromText(content: string): string {
  const normalizedContent = content.trim();
  if (!normalizedContent) return '';

  const lines = normalizedContent.split(/\r?\n/);
  const candidates: Array<{ startIndex: number; endIndex: number; extracted: string; score: number }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (!isRubricSectionHeading(line) && !isStrongRubricCandidateStart(line)) {
      continue;
    }

    const extracted = collectRubricBlock(lines, index);
    if (!extracted) continue;

    const score = scoreRubricCandidate(line, extracted);
    if (score > 0) {
      // 记录起止行号用于合并
      const blockLines = extracted.split(/\r?\n/);
      candidates.push({
        startIndex: index,
        endIndex: index + blockLines.length - 1,
        extracted,
        score,
      });
    }
  }

  if (candidates.length > 0) {
    // 按文档出现顺序排序，合并重叠/相邻的段落
    candidates.sort((left, right) => left.startIndex - right.startIndex);
    const merged: Array<{ startIndex: number; endIndex: number; extracted: string }> = [];
    for (const cand of candidates) {
      const last = merged[merged.length - 1];
      if (last && cand.startIndex <= last.endIndex + 2) {
        // 重叠或相邻（间隔≤1行），合并
        // 检查间隔区是否含 rubric 边界行（如"## 案例对比"），含则不合并
        const gapLines = lines.slice(last.endIndex + 1, cand.startIndex);
        if (gapLines.some((l) => isLikelyRubricBoundaryLine(l))) {
          merged.push({
            startIndex: cand.startIndex,
            endIndex: cand.endIndex,
            extracted: cand.extracted,
          });
          continue;
        }
        // 用原始行范围重建合并块，避免多个重叠候选把同一段尾部反复拼接，
        // 造成内容指数级膨胀。边界行已在上方 gap 检查中排除。
        const newEnd = Math.max(last.endIndex, cand.endIndex);
        last.endIndex = newEnd;
        last.extracted = lines
          .slice(last.startIndex, newEnd + 1)
          .join('\n')
          .trim();
      } else {
        merged.push({
          startIndex: cand.startIndex,
          endIndex: cand.endIndex,
          extracted: cand.extracted,
        });
      }
    }
    return merged.map((m) => m.extracted).join('\n\n').trim();
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (!isRubricSectionHeading(line)) continue;
    return collectRubricBlock(lines, index);
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (!isLikelyStandaloneRubricStart(line)) continue;

    const extracted = collectRubricBlock(lines, index);
    if (
      extracted &&
      /(?:权重|分值|评分等级|评级标准|关键检查点|评估要点|评分要点|优秀|良好|合格|待改进|不合格|\b[1-5]分\b)/.test(
        extracted,
      )
    ) {
      return extracted;
    }
  }

  if (
    countRubricSignals(normalizedContent) >= 2 &&
    /(?:rubric|evaluation criteria|评分|评估|评价)/i.test(normalizedContent)
  ) {
    return normalizedContent;
  }

  return '';
}

function stripRubricSupportTail(content: string): string {
  const normalized = content.trim();
  if (!normalized) return '';

  const lines = normalized.split(/\r?\n/);
  const kept: string[] = [];

  for (const line of lines) {
    if (isRubricSupportBoundary(line)) break;
    kept.push(line);
  }

  return kept.join('\n').trim() || normalized;
}

/**
 * 检测并重组 mammoth/extractRawText 输出的扁平表格单元格序列。
 *
 * docx 经 mammoth.extractRawText 转换后，Word 表格的每个单元格会输出为独立一行，
 * 既无 \t 也无 | 分隔，导致前端 splitStructuredCells 无法识别表格结构。
 *
 * 本函数检测"连续短行 + 含 rubric 表头信号词"的模式，按列数把扁平行重新拼成 \t 分隔行。
 * 仅在检测到明确的表头信号（维度/权重/优秀/良好/合格/不合格等）时触发，避免误改普通段落。
 */
function reconstructDocxFlatTable(content: string): string {
  const lines = content.split(/\r?\n/);
  if (lines.length < 4) return content; // 太短不可能是表格

  // 表头信号词：连续两行中至少出现这些词，才认为是 rubric 表头
  // 允许尾部带括号修饰，如 "维度（一级）" / "权重(%)"
  const HEADER_SIGNAL_WORDS =
    /^(?:维度|一级维度|二级维度|权重|分值|评分等级|评级标准|优秀|良好|合格|不合格|待改进|满分标准|权威文献依据|评估要点|评分要点)(?:[（(].*?[)）])?$/i;

  // 等级/权重信号行：单独一行的百分比或等级描述
  const VALUE_SIGNAL_WORDS =
    /^(?:\d{1,3}\s*%|优秀|良好|合格|不合格|待改进|严重失误|满分|\d{1,2}\s*分|[①②③④⑤⑥⑦⑧⑨⑩])/;

  /**
   * 收集连续的扁平单元格行。
   * 允许单元格之间有 1 个空行间隔（mammoth 常见输出格式）。
   * 遇到 markdown 标题、编号章节标题、或 2+ 连续空行时停止。
   */
  function collectFlatCells(startIdx: number): { cells: string[]; nextIdx: number } {
    const cells: string[] = [];
    let j = startIdx;
    let lastBlank = false;
    while (j < lines.length) {
      const cur = (lines[j] ?? '').trim();
      if (!cur) {
        // 连续 2 个空行 → 结束
        if (lastBlank) break;
        // 空行后还有内容 → 允许跳过 1 个空行
        if (j + 1 < lines.length && (lines[j + 1] ?? '').trim() && cells.length > 0) {
          lastBlank = true;
          j += 1;
          continue;
        }
        break;
      }
      lastBlank = false;
      // 遇到 markdown 标题或编号章节标题 → 结束（但第一行允许是标题）
      if (cells.length > 0 && /^(?:#{1,6}\s|\d+\s*[、.)）])/.test(cur)) break;
      // 超长行可能不是单元格 → 结束
      if (cur.length > 200) break;
      cells.push(cur);
      j += 1;
    }
    return { cells, nextIdx: j };
  }

  /**
   * 将扁平单元格按 columnCount 组合为 \t 分隔的表格行。
   */
  function reassembleRows(cells: string[], columnCount: number): string[] {
    const rows: string[] = [];
    for (let k = 0; k < cells.length; k += columnCount) {
      const chunk = cells.slice(k, k + columnCount);
      if (chunk.length === columnCount) {
        rows.push(chunk.join('\t'));
      } else if (chunk.length > 0) {
        // 末尾不足一行的，保留原样
        rows.push(...chunk);
      }
    }
    return rows;
  }

  const output: string[] = [];
  let i = 0;
  let modified = false;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    // 检测表头起点：短行命中 HEADER_SIGNAL_WORDS
    if (trimmed && trimmed.length <= 30 && HEADER_SIGNAL_WORDS.test(trimmed)) {
      // 收集表头 + 后续所有扁平单元格
      const { cells: blockLines, nextIdx: j } = collectFlatCells(i);

      // 判断是否为 rubric 表头：至少 4 行，含 ≥2 个表头信号词
      const headerSignalCount = blockLines.filter((l) =>
        HEADER_SIGNAL_WORDS.test(l),
      ).length;

      if (blockLines.length >= 4 && headerSignalCount >= 2) {
        // 推断列数：表头信号词的连续段长度
        const headerEnd = blockLines.findIndex(
          (l, idx) =>
            idx > 0 &&
            !HEADER_SIGNAL_WORDS.test(l) &&
            !VALUE_SIGNAL_WORDS.test(l),
        );
        const columnCount =
          headerEnd === -1
            ? blockLines.findIndex((l, idx) => idx > 0 && !HEADER_SIGNAL_WORDS.test(l))
            : headerEnd;
        if (columnCount < 3 || columnCount > 10) {
          output.push(line);
          i += 1;
          continue;
        }

        // 把所有扁平行按 columnCount 重新组合为 \t 分隔行
        const rows = reassembleRows(blockLines, columnCount);
        output.push(...rows);
        i = j;
        modified = true;
        continue;
      }
    }

    output.push(line);
    i += 1;
  }

  return modified ? output.join('\n') : content;
}

export function extractRubricSectionFromContent(content: string): string {
  const normalizedContent = content.trim();
  if (!normalizedContent) return '';

  // 预处理：重组 docx 扁平表格（mammoth.extractRawText 把表格每个单元格拆成独立行）
  const reconstructed = reconstructDocxFlatTable(normalizedContent);

  const rawRubricSection = extractRawRubricSection(reconstructed);
  if (rawRubricSection) {
    const extractedRawRubric = extractRubricSectionFromText(rawRubricSection);
    if (extractedRawRubric && countRubricSignals(extractedRawRubric) >= 2) {
      return stripRubricSupportTail(extractedRawRubric);
    }
  }

  const extracted = extractRubricSectionFromText(reconstructed);
  if (extracted) return stripRubricSupportTail(extracted);

  return '';
}

export function buildSourceRubricExcerpt(
  documents?: Array<{ name: string; content: string }>,
  maxChars = MAX_SOURCE_RUBRIC_CHARS,
): string {
  if (!documents || documents.length === 0) return '';

  const parts: string[] = [];
  let remaining = maxChars;

  for (let index = 0; index < documents.length; index += 1) {
    if (remaining <= 0) break;

    const document = documents[index];
    const extracted = extractRubricSectionFromContent(
      String(document?.content || ''),
    );
    if (!extracted) continue;

    const chunk = extracted.slice(0, remaining);
    remaining -= chunk.length;
    const truncated =
      chunk.length < extracted.length ? '\n[Rubric excerpt truncated]' : '';
    parts.push(`${chunk}${truncated}`.trim());
  }

  return parts.join('\n\n').trim();
}

const CLEAN_RUBRIC_SUPPORT_BOUNDARIES = [...RUBRIC_SUPPORT_BOUNDARY_PATTERNS];

function trimStoredRubricSupportSections(content: string): string {
  const normalized = content.trim();
  if (!normalized) return '';

  const extracted = extractRubricSectionFromContent(normalized);
  if (extracted && extracted !== normalized) {
    return stripRubricSupportTail(extracted);
  }

  return stripRubricSupportTail(normalized);
}

function clampReviewLineCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(6, Math.floor(value)));
}

function locateExcerptLineRange(
  content: string,
  excerpt: string,
): { start: number; end: number } | null {
  const sourceLines = content.split(/\r?\n/);
  const excerptLines = excerpt.split(/\r?\n/);
  if (excerptLines.length === 0) return null;

  for (
    let start = 0;
    start <= sourceLines.length - excerptLines.length;
    start += 1
  ) {
    let matched = true;
    for (let offset = 0; offset < excerptLines.length; offset += 1) {
      if ((sourceLines[start + offset] ?? '') !== excerptLines[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return { start, end: start + excerptLines.length - 1 };
    }
  }

  return null;
}

function applyBoundaryReviewExpansion(
  content: string,
  excerpt: string,
  review: RubricBoundaryReviewResult,
): string {
  if (review.decision === 'keep') return excerpt;
  const range = locateExcerptLineRange(content, excerpt);
  if (!range) return excerpt;

  const sourceLines = content.split(/\r?\n/);
  const up = clampReviewLineCount(review.linesUp);
  const down = clampReviewLineCount(review.linesDown);
  const start = Math.max(0, range.start - up);
  const end = Math.min(sourceLines.length - 1, range.end + down);
  return (
    sourceLines
      .slice(start, end + 1)
      .join('\n')
      .trim() || excerpt
  );
}

async function reviewRubricExtractionBoundary(
  documentName: string,
  content: string,
  extracted: string,
): Promise<string> {
  if (!extracted) return '';

  const range = locateExcerptLineRange(content, extracted);
  if (!range) return extracted;

  const sourceLines = content.split(/\r?\n/);
  const leadingContext = sourceLines
    .slice(Math.max(0, range.start - 4), range.start)
    .join('\n')
    .trim();
  const trailingContext = sourceLines
    .slice(range.end + 1, Math.min(sourceLines.length, range.end + 5))
    .join('\n')
    .trim();

  if (!leadingContext && !trailingContext) return extracted;

  try {
    const raw = await generateChat(
      [
        {
          role: 'system',
          content: buildRubricBoundaryReviewSystemPrompt(),
        },
        {
          role: 'user',
          content: buildRubricBoundaryReviewUserPrompt({
            documentName,
            extractedRubric: extracted,
            leadingContext,
            trailingContext,
          }),
        },
      ],
      undefined,
      0,
    );
    if (typeof raw !== 'string' || !raw.trim()) return extracted;
    const parsed = JSON.parse(raw) as Partial<RubricBoundaryReviewResult>;
    const decision = parsed.decision;
    if (
      decision !== 'keep' &&
      decision !== 'expand_up' &&
      decision !== 'expand_down' &&
      decision !== 'expand_both'
    ) {
      return extracted;
    }
    const reviewed = applyBoundaryReviewExpansion(content, extracted, {
      decision,
      linesUp: parsed.linesUp,
      linesDown: parsed.linesDown,
      reason: parsed.reason,
    });
    return extractRubricSectionFromContent(reviewed) || reviewed || extracted;
  } catch (error) {
    getLogger({ component: 'package-generation' }).warn({
      event: 'packages.generate.rubric.boundary_review_failed',
      documentName,
      error: safeError(error),
    });
    return extracted;
  }
}

/**
 * 判断规则抽取结果质量是否达标。
 * 返回 true 表示质量低，需要触发 AI 兜底定位。
 */
function isRuleExtractedLowQuality(extracted: string): boolean {
  if (!extracted) return true;
  if (extracted.length < RUBRIC_LOCATOR_MIN_EXTRACTED_CHARS) return true;
  if (countRubricSignals(extracted) < RUBRIC_LOCATOR_MIN_QUALITY_SIGNALS) {
    return true;
  }
  return false;
}

/**
 * 在原文中粗定位含 rubric 关键词的窗口，避免把超长文档全文交给 LLM。
 * 返回窗口的起止行号（0-based, inclusive）与带行号的文本。
 * 若无法粗定位，则返回以文档中段为中心的默认窗口。
 */
function locateRubricWindow(
  content: string,
  maxWindowChars = RUBRIC_LOCATOR_WINDOW_CHARS,
): { startLine: number; endLine: number; numberedWindow: string } {
  const lines = content.split(/\r?\n/);
  const keywordPattern =
    /(?:评价|评估|评分|rubric|evaluation criteria|准则|标准|量表|维度|权重|分值|优秀|合格|不合格|待改进|满分)/i;
  const hitIndexes: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (keywordPattern.test(lines[i] ?? '')) hitIndexes.push(i);
  }

  let startLine = 0;
  let endLine = lines.length - 1;

  if (hitIndexes.length > 0) {
    const first = hitIndexes[0];
    const last = hitIndexes[hitIndexes.length - 1];
    // 以首个命中行前 8 行为窗口起点，末个命中行后 30 行为终点
    startLine = Math.max(0, first - 8);
    endLine = Math.min(lines.length - 1, last + 30);
  }

  // 按字符预算收窄窗口
  let windowChars = 0;
  let trimmedEnd = endLine;
  for (let i = startLine; i <= endLine; i += 1) {
    windowChars += (lines[i] ?? '').length + 8; // 行号 + \t + \n
    if (windowChars > maxWindowChars) {
      trimmedEnd = Math.max(startLine + 5, i - 1);
      break;
    }
  }
  endLine = trimmedEnd;

  const numberedWindow = lines
    .slice(startLine, endLine + 1)
    .map((line, idx) => `${startLine + idx + 1}\t${line}`)
    .join('\n');

  return { startLine, endLine, numberedWindow };
}

/**
 * 调用 LLM 从文档窗口中精确定位 rubric 起止行号。
 * 失败或低置信度时返回 null。
 */
async function aiLocateRubricSection(
  documentName: string,
  content: string,
): Promise<string | null> {
  // 预处理：重组 docx 扁平表格，确保 AI 看到的是结构化行而非散行
  const reconstructed = reconstructDocxFlatTable(content.trim());
  if (!reconstructed) return null;

  const { startLine: windowStart, endLine: windowEnd, numberedWindow } =
    locateRubricWindow(reconstructed);
  if (!numberedWindow.trim()) return null;

  try {
    const result = await generateJson<RubricLocatorResult>({
      systemPrompt: buildRubricLocatorSystemPrompt(),
      userPrompt: buildRubricLocatorUserPrompt({
        documentName,
        windowStartLine: windowStart + 1,
        windowEndLine: windowEnd + 1,
        numberedWindow,
      }),
      temperature: 0,
      maxTokens: 2000,
    });

    if (
      !result ||
      result.confidence === 'none' ||
      result.confidence === 'low' ||
      !Number.isInteger(result.startLine) ||
      !Number.isInteger(result.endLine)
    ) {
      return null;
    }

    // 行号是 1-based，转换为 0-based 数组索引
    const startIdx = result.startLine - 1;
    const endIdx = result.endLine - 1;
    const lines = reconstructed.split(/\r?\n/);
    if (
      startIdx < 0 ||
      endIdx < 0 ||
      startIdx >= lines.length ||
      endIdx >= lines.length ||
      endIdx < startIdx ||
      // 必须落在 LLM 可见的窗口范围内，防止幻觉行号
      startIdx < windowStart ||
      endIdx > windowEnd
    ) {
      return null;
    }

    const located = lines.slice(startIdx, endIdx + 1).join('\n').trim();
    if (!located) return null;

    // 校验：AI 抽取结果必须包含足够的 rubric 信号词，避免误定位
    if (countRubricSignals(located) < RUBRIC_LOCATOR_MIN_QUALITY_SIGNALS) {
      return null;
    }

    return located;
  } catch (error) {
    getLogger({ component: 'package-generation' }).warn({
      event: 'packages.generate.rubric.ai_locator_failed',
      documentName,
      error: safeError(error),
    });
    return null;
  }
}

async function buildReviewedSourceRubricExcerpt(
  documents?: Array<{ name: string; content: string }>,
  maxChars = MAX_SOURCE_RUBRIC_CHARS,
): Promise<string> {
  if (!documents || documents.length === 0) return '';

  const parts: string[] = [];
  let remaining = maxChars;

  for (let index = 0; index < documents.length; index += 1) {
    if (remaining <= 0) break;

    const document = documents[index];
    const documentName = String(document?.name || `Document ${index + 1}`);
    const content = String(document?.content || '');
    let extracted = extractRubricSectionFromContent(content);

    // 规则抽取失败或质量低时，触发 AI 兜底定位
    if (isRuleExtractedLowQuality(extracted)) {
      const aiLocated = await aiLocateRubricSection(documentName, content);
      if (aiLocated && aiLocated.length > extracted.length) {
        getLogger({ component: 'package-generation' }).info({
          event: 'packages.generate.rubric.ai_locator_used',
          documentName,
          ruleExtractedLen: extracted.length,
          aiLocatedLen: aiLocated.length,
        });
        extracted = aiLocated;
      }
    }

    if (!extracted) continue;

    const reviewed = await reviewRubricExtractionBoundary(
      documentName,
      content,
      extracted,
    );
    const chunk = reviewed.slice(0, remaining);
    remaining -= chunk.length;
    const truncated =
      chunk.length < reviewed.length ? '\n[Rubric excerpt truncated]' : '';
    parts.push(`${chunk}${truncated}`.trim());
  }

  return parts.join('\n\n').trim();
}

function normalizeSkillMetadata(
  skills: PackageBaseGenerationResult['skills'],
  maxSkills = MAX_GENERATED_SKILLS,
) {
  const used = new Set<string>();
  return skills.slice(0, maxSkills).map((skill, index) => {
    const baseDirName = slugify(
      skill.dirName || skill.name || `skill-${index + 1}`,
    );
    let dirName = baseDirName;
    let suffix = 2;
    while (used.has(dirName)) {
      dirName = `${baseDirName}-${suffix}`;
      suffix += 1;
    }
    used.add(dirName);

    return {
      dirName,
      name: (skill.name || `技能 ${index + 1}`).trim(),
      description: sanitizeSkillDescription(skill.description),
    };
  });
}

function sanitizeSkillDescription(description: string | undefined): string {
  return (
    (description || '用于处理该智能体的核心任务')
      .replace(/\s+/g, ' ')
      .replace(/[<>]/g, '')
      .trim()
      .slice(0, 180) || '用于处理该智能体的核心任务'
  );
}

function stripMarkdownFence(value: string | undefined | null): string {
  const trimmed = String(value ?? '').trim();
  const match = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i);
  return (match ? match[1] : trimmed).trim();
}

const RUBRIC_REQUIRED_SECTIONS = [
  '# Rubric',
  '## 评分目标',
  '## 评分维度',
  '## 使用说明',
];

function normalizeRubricMarkdown(rubricMd: string | undefined | null): string {
  return stripMarkdownFence(String(rubricMd || '')).trim();
}

function countCleanRubricDimensions(content: string): number {
  const lines = content.split(/\r?\n/);
  let count = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (CLEAN_RUBRIC_SUPPORT_BOUNDARIES.some((pattern) => pattern.test(line))) {
      break;
    }
    if (
      /^###\s+/.test(line) ||
      /^(?:维度[一二三四五六七八九十百0-9]+|[①②③④⑤⑥⑦⑧⑨]|\d+\s*[、.)）])/.test(
        line,
      )
    ) {
      count += 1;
    }
  }

  return count;
}

function hasCleanScorableRubricStructure(content: string): boolean {
  const trimmed = trimStoredRubricSupportSections(content);
  const hasHeading =
    /(?:评分|评估|评价)(?:标准|准则|量表)|rubric|evaluation criteria/i.test(
      trimmed,
    );
  const hasDimensionSection =
    /##\s*(评分维度|评估维度)/.test(trimmed) ||
    /(?:^|\n)\s*(?:维度[一二三四五六七八九十百0-9]+|[①②③④⑤⑥⑦⑧⑨]|\d+\s*[、.)）])/.test(
      trimmed,
    );
  const hasScoreSignals =
    /(?:权重|占比|比例|分值|评分等级|评级标准|关键检查点|评估要点|评分要点|优秀|良好|合格|待改进|不合格|严重失误|满分标准|\d{1,3}\s*%|\|)/.test(
      trimmed,
    );

  return (
    hasHeading &&
    hasDimensionSection &&
    hasScoreSignals &&
    countCleanRubricDimensions(trimmed) >= 1
  );
}

export function normalizeStoredRubricMarkdown(
  rubricMd: string | undefined | null,
): string {
  const normalized = normalizeRubricMarkdown(rubricMd);
  if (!normalized) return '';
  return trimStoredRubricSupportSections(normalized);
}

function hasLegacyRubricStructure(content: string): boolean {
  const numberedSections = countScorableLegacyDimensionLines(content);
  const hasHeaderSignals =
    /评价准则|评估标准|评分标准|评价标准|Evaluation Criteria|Rubric/i.test(
      content,
    );
  const hasStructuredScores =
    /(?:\d{1,3}\s*%)|权重|等级|优秀|良好|合格|待改进|不合格|分值|评级标准|满分标准/.test(
      content,
    );
  const hasNarrativeRubricShape =
    numberedSections >= 3 &&
    /整体评价|具体评价|应提供|评估要点|评分要点/.test(content);
  return (
    hasHeaderSignals &&
    numberedSections >= 1 &&
    (hasStructuredScores || hasNarrativeRubricShape)
  );
}

function hasWeightedLegacyRubricStructure(content: string): boolean {
  const numberedSections = countScorableLegacyDimensionLines(content);
  const hasHeaderSignals =
    /评价准则|评估标准|评分标准|评价标准|Evaluation Criteria|Rubric/i.test(
      content,
    );
  const hasScoringLanguage =
    /璇勪及瑕佺偣|璇勫垎瑕佺偣|璇勫垎鏍囧噯|璇勪环鍑嗗垯|璇勪及鏍囧噯|鏁翠綋璇勪环|鍏蜂綋璇勪环|鏉冮噸|绛夌骇|浼樼|鑹ソ|鍚堟牸|寰呮敼杩泑涓嶅悎鏍?|涓ラ噸澶辫|搴旀彁渚?/.test(
      content,
    );
  return hasHeaderSignals && numberedSections >= 1 && hasScoringLanguage;
}

function looksLikeWeightedRubric(content: string): boolean {
  const dimensionHeadings = countScorableLegacyDimensionLines(content);
  const hasHeaderSignals =
    /评价准则|评估标准|评分标准|评价标准|Evaluation Criteria|Rubric/i.test(
      content,
    );
  const hasWeights = /(?:\d{1,3}\s*%)|权重|比例|占比/.test(content);
  const hasEvaluationShape = /整体评价|具体评价|应提供/.test(content);
  return (
    hasHeaderSignals &&
    dimensionHeadings >= 1 &&
    (hasWeights || hasEvaluationShape)
  );
}

function hasTabularLegacyRubricStructure(content: string): boolean {
  const percentMatches = content.match(/\b\d{1,3}\s*%/g) || [];
  const hasHeaderSignals =
    /(?:\u8bc4\u4ef7\u51c6\u5219|\u8bc4\u4f30\u6807\u51c6|\u8bc4\u5206\u6807\u51c6|Evaluation Criteria|Rubric)/i.test(
      content,
    );
  const hasTableColumns = /(?:\u7ef4\u5ea6|\u6743\u91cd)/i.test(content);
  const hasGradeSignals =
    /(?:\u4f18\u79c0|\u826f\u597d|\u5408\u683c|\u5f85\u6539\u8fdb|\u4e0d\u5408\u683c)/i.test(
      content,
    );
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
      /^\s*(?:###\s*)?(?:\d+[.)、]\s*[^\d\s][^\n]*|维度[一二三四五六七八九十]?[^\n]*)$/gm,
    ) || [];
  const hasDimensionSection =
    /##\s*(评分维度|评估维度)|评价准则|评估标准|评分标准|Evaluation Criteria|Rubric/i.test(
      content,
    );
  const hasScoringSignals =
    /优秀|良好|合格|待改进|不合格|满分标准|评分|score|Full score/i.test(
      content,
    );
  const hasSummaryGoal =
    /Overall evaluation|整体评价|评分目标|评估目标|评价目标/i.test(content);
  const hasWeightSignals = /(?:\d{1,3}\s*%)|权重|分值|评级标准/.test(content);
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
  const hasHeaderSignals =
    /评估量表|评估标准|评分标准|评价准则|Evaluation Criteria|Rubric/i.test(
      content,
    );
  const hasWeights = /权重|(?:\d{1,3}\s*%)/.test(content);
  const hasScoreBands = /分值|评级标准|(?:^|\s)[1-5]分(?:\s|$)/m.test(content);
  return (
    dimensionHeadings.length >= 1 &&
    hasHeaderSignals &&
    hasWeights &&
    hasScoreBands
  );
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
    isLikelyRubricSupportSectionHeading(line) ||
    /(?:附录|参考资料|参考文献|注释|备注|其他说明|references?|appendix|notes?)/i.test(
      normalized,
    )
  );
}

function countScorableLegacyDimensionLines(content: string): number {
  const matches =
    content.match(/^\s*(?:[①②③④⑤⑥⑦⑧⑨⑩]|\d+[.)、])\s*[^\n]+$/gm) || [];
  return matches.filter((line) => !isSupportOnlyLegacyHeading(line)).length;
}

export function hasConfiguredRubricText(
  rubricMd: string | undefined | null,
): boolean {
  const content = normalizeRubricMarkdown(rubricMd);
  if (!content) return false;
  return (
    hasCleanScorableRubricStructure(content) ||
    validateRubricMarkdown(content).length === 0 ||
    hasLegacyRubricStructure(content) ||
    hasWeightedLegacyRubricStructure(content) ||
    looksLikeWeightedRubric(content) ||
    hasTabularLegacyRubricStructure(content) ||
    hasCompactScorableRubricStructure(content) ||
    hasScoreBandWeightedRubricStructure(content)
  );
}

export function validateRubricMarkdown(rubricMd: string): string[] {
  const content = normalizeRubricMarkdown(rubricMd);
  if (!content) return ['rubric.md 不能为空'];
  if (hasCleanScorableRubricStructure(content)) return [];
  if (!content) return ['rubric.md 不能为空'];
  if (
    hasLegacyRubricStructure(content) ||
    hasWeightedLegacyRubricStructure(content) ||
    looksLikeWeightedRubric(content) ||
    hasTabularLegacyRubricStructure(content) ||
    hasCompactScorableRubricStructure(content) ||
    hasScoreBandWeightedRubricStructure(content)
  ) {
    return [];
  }

  const errors: string[] = [];
  for (const heading of RUBRIC_REQUIRED_SECTIONS) {
    if (!content.includes(heading)) {
      errors.push(`rubric.md 缺少必要章节：${heading}`);
    }
  }

  if ((content.match(/^###\s+/gm) || []).length < 4) {
    errors.push('rubric.md 至少需要 4 个评分维度（### 标题）');
  }

  return errors;
}

function extractRubricDimensionTitles(content: string): string[] {
  const titles = new Set<string>();
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const markdownHeading = line.match(/^#{1,6}\s+(.+)$/);
    if (markdownHeading) {
      const title = markdownHeading[1]!.trim();
      if (
        title &&
        !/^rubric$/i.test(title) &&
        !/^评分(目标|维度)$/i.test(title) &&
        !/^使用说明$/i.test(title)
      ) {
        titles.add(title.replace(/\s*\([^)]*\)\s*$/, '').trim());
      }
      continue;
    }

    const weightedTitle = line.match(
      /^(?:维度[一二三四五六七八九十百0-9]+[:：]?\s*|[①②③④⑤⑥⑦⑧⑨⑩]|\d+[.)、]\s*)([^：:\n]+?)(?:\s*[（(].*?(?:权重|占比|%)?.*?[）)])?\s*$/,
    );
    if (weightedTitle?.[1]) {
      titles.add(weightedTitle[1].trim());
      continue;
    }

    const tableTitle = line.match(/^([^|]{2,60})\s+\d{1,3}%\s+/);
    if (tableTitle?.[1]) {
      titles.add(tableTitle[1].trim());
    }
  }

  return [...titles].filter((title) => title.length >= 2).slice(0, 6);
}

function buildFallbackRubricMarkdown(input: {
  packageName: string;
  packageDescription: string;
  sourceRubricExcerpt?: string;
  rubricDraft?: string;
}): string {
  const source = normalizeRubricMarkdown(input.sourceRubricExcerpt);
  const draft = normalizeRubricMarkdown(input.rubricDraft);
  const preservedSource = source || draft;
  const dimensionTitles = extractRubricDimensionTitles(preservedSource);
  const fallbackTitles = ['角色贴合', 'Skill 遵循', '回答质量', '安全边界'];
  const mergedTitles = [...dimensionTitles];
  for (const title of fallbackTitles) {
    if (mergedTitles.length >= 4) break;
    if (!mergedTitles.includes(title)) {
      mergedTitles.push(title);
    }
  }
  const finalTitles = mergedTitles.slice(0, 4);

  const dimensionBlocks = finalTitles.flatMap((title, index) => {
    const emphasis =
      index === 0
        ? '优先检查回答是否真正贴合当前智能体的任务场景、对象和目标。'
        : index === finalTitles.length - 1
          ? '如原始 rubric 涉及风险边界、转介、禁区或不可越界事项，应优先遵循这些要求。'
          : '优先遵循原始 rubric 中与该维度相关的权重、等级描述、案例和限制条件。';
    return [
      `### ${title}`,
      `- ${emphasis}`,
      '- 如原始 rubric 中有更细规则，评分时以原文为准。',
      '',
    ];
  });

  const preservedSection = preservedSource
    ? ['', '## 原始 rubric 要点', preservedSource]
    : [];

  return [
    '# Rubric',
    '',
    '## 评分目标',
    `- 用于评估 ${input.packageName} 的回答是否贴合任务、可执行并保持必要的安全边界。`,
    `- 结合智能体定位“${input.packageDescription}”进行评分，优先保留用户原始 rubric 的维度与要求。`,
    '',
    '## 评分维度',
    ...dimensionBlocks,
    '## 使用说明',
    '- 先判断回答是否完成用户任务，再逐项评分并给出简短结论。',
    '- 如果原始 rubric 中包含权重、等级、案例、规范依据或禁止事项，评分时优先遵循这些内容。',
    '- 当原始 rubric 结构不完整时，可先按本页结构评分，再参考下方原始内容补充判断。',
    ...preservedSection,
  ]
    .join('\n')
    .trim();
}

export function sanitizeGeneratedRubricMarkdown(
  rubricMd: string | undefined | null,
): string {
  const content = normalizeStoredRubricMarkdown(rubricMd);
  if (!content) return '';
  return validateRubricMarkdown(content).length === 0 ? content : '';
}

function resolveRubricMarkdown(
  generatedRubricMd: string | undefined | null,
  sourceRubricExcerpt: string | undefined | null,
): string {
  const generated = normalizeRubricMarkdown(generatedRubricMd);
  const source = normalizeRubricMarkdown(sourceRubricExcerpt);

  if (generated && hasConfiguredRubricText(generated)) {
    return generated;
  }

  if (source) {
    return source;
  }

  return generated;
}

export function assertRubricConfigured(
  rubricMd: string | undefined | null,
  feature: string,
): void {
  if (!hasConfiguredRubricText(rubricMd)) {
    throw new Error(
      `当前智能体还没有配置 rubric。请先在 Rubric 标签中补充评分规则后再使用${feature}。`,
    );
  }
}

async function collectStreamedText(
  input: Parameters<typeof generateText>[0],
  onDelta?: (delta: string) => void,
): Promise<string> {
  let content = '';
  const fallbackToNonStream = async (event: string, error?: unknown) => {
    getLogger({ component: 'package-generation' }).warn({
      event,
      ...(error ? { error: safeError(error) } : {}),
    });
    const fallbackText = await generateText(input);
    onDelta?.(fallbackText);
    return fallbackText;
  };

  try {
    for await (const delta of streamText(input)) {
      content += delta;
      onDelta?.(delta);
    }
  } catch (error) {
    if (content.trim().length === 0) {
      return fallbackToNonStream('packages.generate.stream.retry', error);
    }
    throw new Error(
      `模型流式响应中断：${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  if (content.trim().length === 0) {
    return fallbackToNonStream('packages.generate.stream.empty');
  }

  return content;
}

async function generateRubricWithRepair(
  input: {
    model?: string;
    packageName: string;
    packageDescription: string;
    agentExcerpt: string;
    sourceRubricExcerpt: string;
    useStream?: boolean;
    mode?: 'repair' | 'optimize';
  },
  onPreviewDelta?: (delta: PackageGeneratePreviewDelta) => void,
): Promise<string> {
  const {
    model,
    packageName,
    packageDescription,
    agentExcerpt,
    sourceRubricExcerpt,
    useStream = true,
    mode = 'repair',
  } = input;
  const normalizedSource = normalizeRubricMarkdown(sourceRubricExcerpt);
  const hasUsableSource = hasConfiguredRubricText(normalizedSource);

  if (hasUsableSource && mode === 'repair') {
    return normalizedSource;
  }

  const requestRubricText = async (rubricDraft?: string): Promise<string> => {
    const normalizedDraftInput = normalizeRubricMarkdown(rubricDraft);
    const userPrompt = buildRubricUserPrompt({
      packageName,
      packageDescription,
      agentExcerpt,
      sourceRubricExcerpt: normalizedSource,
      rubricDraft:
        normalizedDraftInput &&
        (mode === 'optimize' || normalizedDraftInput !== normalizedSource)
          ? normalizedDraftInput
          : undefined,
      mode,
    });
    const request = {
      model,
      systemPrompt: buildRubricSystemPrompt(),
      userPrompt: useStream
        ? userPrompt
        : [
            userPrompt,
            '',
            mode === 'optimize'
              ? 'Keep the optimized rubric concise and directly scorable.'
              : 'Keep the repaired rubric concise.',
            'Preserve the original dimensions and constraints, but summarize long prose instead of repeating it verbatim.',
            'Limit each scoring dimension to a short heading plus up to 3 compact bullets.',
          ].join('\n'),
      temperature: 0.25,
      maxTokens: useStream ? 2200 : 2800,
    };

    if (useStream) {
      return stripMarkdownFence(
        await collectStreamedText(request, (delta) =>
          onPreviewDelta?.({ type: 'rubric', name: 'rubric.md', delta }),
        ),
      );
    }

    return stripMarkdownFence(String((await generateText(request)) ?? ''));
  };

  let rubricDraft = '';
  try {
    rubricDraft = await requestRubricText(
      mode === 'optimize' ? normalizedSource : normalizedSource || undefined,
    );
  } catch (error) {
    getLogger({ component: 'package-generation' }).warn({
      event: 'packages.generate.rubric.skipped',
      error: safeError(error),
    });
  }

  const normalizedDraft = normalizeRubricMarkdown(rubricDraft);
  if (hasConfiguredRubricText(normalizedDraft)) {
    return normalizedDraft;
  }

  if (normalizedDraft && (mode === 'optimize' || !normalizedSource)) {
    try {
      const repaired = await requestRubricText(normalizedDraft);
      if (hasConfiguredRubricText(repaired)) {
        return repaired;
      }
      rubricDraft = repaired;
    } catch (error) {
      getLogger({ component: 'package-generation' }).warn({
        event: 'packages.generate.rubric.repair_failed',
        error: safeError(error),
      });
    }
  }

  if (normalizedDraft) {
    try {
      const repaired = await requestRubricText(normalizedDraft);
      if (hasConfiguredRubricText(repaired)) {
        return repaired;
      }
      rubricDraft = repaired;
    } catch (error) {
      getLogger({ component: 'package-generation' }).warn({
        event: 'packages.generate.rubric.repair_retry_failed',
        error: safeError(error),
      });
    }
  }

  const fallbackRubric = buildFallbackRubricMarkdown({
    packageName,
    packageDescription,
    sourceRubricExcerpt: normalizedSource,
    rubricDraft: rubricDraft || normalizedDraft,
  });
  if (hasConfiguredRubricText(fallbackRubric)) {
    getLogger({ component: 'package-generation' }).info({
      event: 'packages.generate.rubric.fallback_used',
      hasSourceRubric: Boolean(normalizedSource),
      hasDraftRubric: Boolean(normalizedDraft),
    });
    return fallbackRubric;
  }

  return resolveRubricMarkdown(rubricDraft, normalizedSource);
}

function normalizeSkillMdFrontmatter(
  skillMd: string,
  dirName: string,
  description: string,
): string {
  const trimmed = stripMarkdownFence(skillMd);
  const safeDescription = sanitizeSkillDescription(description);
  const frontmatter = `---\nname: ${dirName}\ndescription: ${safeDescription}\n---`;
  const match = trimmed.match(/^---\s*\n[\s\S]*?\n---\s*\n?/);
  const body = match ? trimmed.slice(match[0].length).trimStart() : trimmed;
  return `${frontmatter}\n\n${body}`.trim();
}

function normalizeSkillMdMissingSections(
  skillMd: string,
  skillName: string,
  description: string,
): string {
  const match = skillMd.match(/^---\s*\n[\s\S]*?\n---\s*\n?/);
  const frontmatter = match ? match[0].trim() : '';
  let body = match ? skillMd.slice(match[0].length).trim() : skillMd.trim();
  const safeDescription = sanitizeSkillDescription(description);

  const sectionTemplates: Array<{ title: string; lines: string[] }> = [
    {
      title: 'Instructions',
      lines: [
        `- 围绕“${skillName}”处理用户请求，先确认问题场景、对象、限制条件和用户真正需要的结果。`,
        `- 依据“${safeDescription}”整理可用原则、步骤与边界，避免脱离材料编造。`,
        '- 对涉及安全、心理危机、违法、紧急风险或未成年人保护的内容，给出保守建议并提示寻求学校、监护人或专业人员支持。',
      ],
    },
    {
      title: 'Workflow',
      lines: [
        '1. 识别用户输入中的场景、角色、时间线、证据线索和核心诉求。',
        `2. 对照“${safeDescription}”提取可用原则、处理步骤、话术、记录要求和边界条件。`,
        '3. 将建议组织成可执行步骤，区分立即行动、沟通记录、后续跟进和必要的升级转介。',
        '4. 检查输出是否符合本技能边界，避免越权判断，并补充必要的安全注意事项。',
      ],
    },
    {
      title: 'Output Format',
      lines: [
        '- 先用一两句话概括判断和处理重点。',
        '- 按步骤列出建议，每一步说明目的、做法和注意事项。',
        '- 如存在风险或信息不足，单独列出需要补充的信息、升级转介条件和保守处理建议。',
      ],
    },
    {
      title: 'Examples',
      lines: [
        `- 示例 1：当用户提出与“${skillName}”直接相关的请求时，先判断场景，再给出分步骤方案。`,
        '- 示例 2：当输入信息不足时，先补问关键条件，再继续提供可执行结果。',
      ],
    },
    {
      title: 'Common Issues',
      lines: [
        '- 信息不足：先追问缺失条件，不要直接假设。',
        '- 请求越界：明确说明不适用范围，并引导到更合适的能力或人工处理。',
        '- 风险升级：涉及持续伤害、严重威胁、自伤他伤、违法或紧急安全风险时，应提示尽快联系学校管理者、监护人或专业机构。',
      ],
    },
  ];

  for (const section of sectionTemplates) {
    if (!new RegExp(`^##?\\s*${section.title}`, 'im').test(body)) {
      body = [body.trim(), `## ${section.title}`, ...section.lines]
        .filter(Boolean)
        .join('\n\n');
    }
  }

  return frontmatter ? `${frontmatter}\n\n${body.trim()}`.trim() : body.trim();
}

/**
 * 修复并标准化 SKILL.md：先补齐/校正 frontmatter，再补齐缺失的必要章节。
 * 供交互式反馈优化等外部流程使用。repairContext.name 可用于在缺失章节模板中
 * 填入技能显示名（不传则使用 dirName）。
 */
export function normalizeAndRepairSkillMd(
  skillMd: string,
  dirName: string,
  description: string,
  repairContext?: { name?: string; sourceContext?: string },
): string {
  const skillName = repairContext?.name || dirName;
  const withFrontmatter = normalizeSkillMdFrontmatter(
    skillMd,
    dirName,
    description,
  );
  return normalizeSkillMdMissingSections(withFrontmatter, skillName, description);
}

/** 对外暴露的 SKILL.md 标准校验，供交互式反馈优化等流程复用。 */
export function validatePackageSkillMd(
  skillMd: string,
  dirName: string,
): string[] {
  return validateSkillMdStandard(skillMd, dirName);
}

function normalizeSnapshot(
  input: PackageGenerationResult,
): AgentPackageSnapshot {
  return {
    name: sanitizeGeneratedPackageName(input.name),
    description: input.description.trim(),
    versionLabel: 'v1',
    agentMd: input.agentMd.trim(),
    rubricMd: normalizeStoredRubricMarkdown(input.rubricMd),
    skills: input.skills.map((skill) => ({
      id: randomUUID(),
      dirName: slugify(skill.dirName || skill.name),
      name: skill.name.trim(),
      description: skill.description.trim(),
      skillMd: skill.skillMd.trim(),
    })),
  };
}

/* ── Claude Skill / Agent Skill 标准校验 ── */

function getBaseOutputSchemaPrompt(): string {
  return [
    '## 输出 JSON 结构',
    '返回一个严格 JSON 对象，不要 Markdown 代码块，不要解释。',
    '{',
    '  "name": "智能体名称",',
    '  "description": "智能体一句话描述",',
    '  "skills": [',
    '    {',
    '      "dirName": "kebab-case-dir-name",',
    '      "name": "技能显示名称",',
    '      "description": "一句话说明该 skill 做什么，以及什么时候使用"',
    '    }',
    '  ]',
    '}',
    '',
    '要求：',
    '1. JSON 只包含 name、description、skills',
    '2. skills 最多 2 个，选择最能支撑该智能体工作的核心技能',
    '3. dirName 必须是小写英文 kebab-case',
    "4. description 必须包含'当/如果/用于/遇到/针对'等触发词",
    '5. 不要在本步骤生成 agent.md、rubric.md 或 SKILL.md',
    '6. name 不超过 10 个字，简洁明了',
  ].join('\n');
}

function createFallbackBase(
  instruction: string,
  documents?: Array<{ name: string; content: string }>,
): PackageBaseGenerationResult {
  const firstDocumentName = documents?.[0]?.name
    ?.replace(/\.[^.]+$/, '')
    .trim();
  const source =
    instruction.trim() ||
    documents
      ?.map((document) => document.content)
      .join('\n')
      .trim() ||
    '';
  const compact = source.replace(/\s+/g, ' ').slice(0, 28).trim();
  const name = firstDocumentName || (compact ? `${compact}助手` : '智能体助手');
  const description = compact
    ? `用于根据“${compact}”相关需求完成分析、生成与答疑任务。`
    : '用于根据用户需求和上传资料完成分析、生成与答疑任务。';

  return {
    name: sanitizeGeneratedPackageName(name),
    description,
    skills: [
      {
        dirName: 'core-task',
        name: '核心任务处理',
        description:
          '用于当用户提出核心任务时，分析需求并生成结构化、高质量的回答。',
      },
      {
        dirName: documents?.length ? 'document-grounding' : 'quality-review',
        name: documents?.length ? '资料理解与引用' : '质量检查',
        description: documents?.length
          ? '用于遇到上传资料时，提取关键信息并基于资料完成回答。'
          : '用于在输出前检查内容的准确性、完整性和表达质量。',
      },
    ],
  };
}

function normalizeBaseMetadataJson(
  parsed: Partial<PackageBaseGenerationResult>,
  fallback: PackageBaseGenerationResult,
): PackageBaseGenerationResult {
  return {
    name:
      typeof parsed.name === 'string' && parsed.name.trim()
        ? sanitizeGeneratedPackageName(parsed.name)
        : sanitizeGeneratedPackageName(fallback.name),
    description:
      typeof parsed.description === 'string' && parsed.description.trim()
        ? parsed.description
        : fallback.description,
    skills:
      Array.isArray(parsed.skills) && parsed.skills.length > 0
        ? parsed.skills.map((skill, index) => ({
            dirName:
              typeof skill?.dirName === 'string'
                ? skill.dirName
                : `skill-${index + 1}`,
            name:
              typeof skill?.name === 'string'
                ? skill.name
                : `技能 ${index + 1}`,
            description:
              typeof skill?.description === 'string'
                ? skill.description
                : `用于当用户需要技能 ${index + 1} 时提供支持。`,
          }))
        : fallback.skills,
  };
}

function buildSnapshotJson(snapshot: AgentPackageSnapshot): string {
  const json = JSON.stringify(snapshot, null, 2);
  JSON.parse(json);
  return json;
}

function toSkillVersionSource(source: string): PackageVersion['source'] {
  if (
    source === 'generated' ||
    source === 'imported' ||
    source === 'optimized' ||
    source === 'manual' ||
    source === 'interactive' ||
    source === 'rollback'
  ) {
    return source;
  }
  return 'imported';
}

function getCompactSkillTemplatePrompt(): string {
  return [
    '返回完整 SKILL.md 的 Markdown 文本，不要 JSON，不要 Markdown 代码块。',
    'SKILL.md 必须包含：',
    '---',
    'name: <dirName>',
    "description: <一句话说明该 skill 做什么，以及什么时候使用，必须包含触发词如'当/如果/用于/遇到/针对'>",
    '---',
    '# <Skill 显示名称>',
    '## When to use',
    '## When not to use',
    '## Instructions',
    '## Workflow',
    '## Output Format',
    '## Examples',
    '## Common Issues',
    '',
    '要求：',
    '- 内容要精炼，每个章节 2-5 条即可',
    '- frontmatter name 必须等于 dirName',
    '- When to use 只写该 skill 自己负责的触发场景',
    '- When not to use 写清楚应交给其他 skill、普通问答、或安全转介的场景',
    '- Output Format 必须给出固定模板字段，例如：场景判断、处理方案、可用话术、风险提示、后续评估',
    '- 只返回 SKILL.md 文件内容本身，不要解释',
  ].join('\n');
}

function extractFrontmatterValue(skillMd: string, key: string): string | null {
  const match = skillMd.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const line = match[1].split(/\r?\n/).find((l) => l.trim().startsWith(`${key}:`));
  if (!line) return null;
  const value = line.slice(line.indexOf(':') + 1).trim();
  return value.replace(/^["']|["']$/g, '');
}

export function validateSkillMdStandard(
  skillMd: string,
  dirName: string,
): string[] {
  const errors: string[] = [];

  // 1. 检查是否以 YAML frontmatter 开头
  if (!skillMd.trim().startsWith('---')) {
    errors.push('SKILL.md 必须以 YAML frontmatter（---）开头');
    return errors; // 没有 frontmatter 后续检查无意义
  }

  const fmName = extractFrontmatterValue(skillMd, 'name');
  const fmDescription = extractFrontmatterValue(skillMd, 'description');

  // 2. 检查 frontmatter 中是否包含 name 和 description
  if (!fmName) errors.push('YAML frontmatter 缺少 name 字段');
  if (!fmDescription) errors.push('YAML frontmatter 缺少 description 字段');

  // 3. 检查 name 是否为小写英文 kebab-case
  if (fmName && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fmName)) {
    errors.push(`frontmatter name "${fmName}" 不是小写英文 kebab-case`);
  }

  // 4. 检查 name 是否包含保留词
  if (fmName && /\b(claude|anthropic)\b/i.test(fmName)) {
    errors.push(
      `frontmatter name "${fmName}" 包含保留词（claude / anthropic）`,
    );
  }

  // 5. 检查 dirName 是否与 frontmatter name 一致
  if (fmName && dirName !== fmName) {
    errors.push(`dirName "${dirName}" 与 frontmatter name "${fmName}" 不一致`);
  }

  // 6. 检查 description 是否过长（>200 字符）
  if (fmDescription && fmDescription.length > 200) {
    errors.push(
      `frontmatter description 过长（${fmDescription.length} 字符，建议 ≤200）`,
    );
  }

  // 7. 检查 description 是否包含 XML 尖括号
  if (fmDescription && /[<>]/.test(fmDescription)) {
    errors.push('frontmatter description 不应包含 XML 尖括号');
  }
  const triggerPattern =
    /(\u5f53|\u5982\u679c|\u7528\u4e8e|\u9002\u5408|\u573a\u666f|\u89e6\u53d1|\u8c03\u7528|\u9700\u8981|\u60c5\u51b5|\u9488\u5bf9|\u9047\u5230|\u9762\u5bf9|\u51fa\u73b0|\u7528\u6237|\u8f93\u5165|\u8bf7\u6c42|\u95ee\u9898|\u4efb\u52a1|\u4f8b\u5982|\bwhen\b|\bwhenever\b|\bif\b|\bfor\b|\buse(?:d|s|ing)?\b|\buser\b|\brequest\b|\binput\b|\btask\b|\bworkflow\b|\bscenario\b|\btrigger\b)/i;
  if (fmDescription && !triggerPattern.test(fmDescription)) {
    errors.push(
      'frontmatter description 应说明 skill 的触发场景（什么时候使用）',
    );
  }

  const body = skillMd.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '').trim();
  if (body.length < 200) {
    errors.push('SKILL.md 正文过短（<200 字符），请补充详细说明');
  }

  const requiredSections = [
    'Instructions',
    'Workflow',
    'Output Format',
    'Examples',
    'Common Issues',
  ];
  for (const section of requiredSections) {
    if (!new RegExp(`^##?\\s*${section}`, 'im').test(body)) {
      errors.push(`正文缺少必要章节：${section}`);
    }
  }

  return errors;
}

function validateBaseGenerationResult(
  generated: PackageBaseGenerationResult,
): void {
  const errors: string[] = [];

  if (!generated.name?.trim()) errors.push('缺少智能体 name');
  if (!generated.description?.trim()) errors.push('缺少智能体 description');

  if (!Array.isArray(generated.skills) || generated.skills.length === 0) {
    errors.push('skills 必须为非空数组');
  } else {
    for (
      let index = 0;
      index < Math.min(generated.skills.length, MAX_GENERATED_SKILLS);
      index += 1
    ) {
      const skill = generated.skills[index];
      const prefix = `skills[${index}]`;
      if (!skill.dirName?.trim()) errors.push(`${prefix} 缺少 dirName`);
      if (!skill.name?.trim()) errors.push(`${prefix} 缺少 name`);
      if (!skill.description?.trim()) errors.push(`${prefix} 缺少 description`);
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `生成基础结构校验失败：\n${errors.map((e) => '- ' + e).join('\n')}`,
    );
  }
}

function validateGenerationResult(generated: PackageGenerationResult): void {
  const errors: string[] = [];

  // 检查顶层字段
  if (!generated.name?.trim()) errors.push('缺少智能体 name');
  if (!generated.description?.trim()) errors.push('缺少智能体 description');
  if (!generated.agentMd?.trim()) errors.push('缺少 agentMd');

  // 检查 skills
  if (!Array.isArray(generated.skills) || generated.skills.length === 0) {
    errors.push('skills 必须为非空数组');
  } else {
    for (let i = 0; i < generated.skills.length; i++) {
      const skill = generated.skills[i];
      const prefix = `skills[${i}]`;
      if (!skill.dirName?.trim()) errors.push(`${prefix} 缺少 dirName`);
      if (!skill.name?.trim()) errors.push(`${prefix} 缺少 name`);
      if (!skill.description?.trim()) errors.push(`${prefix} 缺少 description`);
      if (!skill.skillMd?.trim()) {
        errors.push(`${prefix} 缺少 skillMd`);
      } else {
        if (skill.skillMd.trim().length < 300) {
          errors.push(`${prefix} skillMd 过短（<300 字符），请补充详细内容`);
        }
        const skillErrors = validateSkillMdStandard(
          skill.skillMd,
          skill.dirName || '',
        );
        for (const e of skillErrors) {
          errors.push(`${prefix} ${e}`);
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `生成结果校验失败：\n${errors.map((e) => '- ' + e).join('\n')}`,
    );
  }
}

function toSummary(
  row: DbRowPackage,
  version: DbRowPackageVersion,
): AgentPackageSummary {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    versionNumber: version.version_number,
    updatedAt: row.updated_at,
  };
}

function toDetail(
  row: DbRowPackage,
  version: DbRowPackageVersion,
): AgentPackageDetail {
  return {
    ...toSummary(row, version),
    snapshot: parseDbJson<AgentPackageSnapshot>(
      version.snapshot_json,
      emptyPackageSnapshot(),
    ),
  };
}

async function getPackageRow(userId: string, packageId: string | number) {
  const packageResult = await query<DbRowPackage>(
    'select * from agent_packages where id = $1 and user_id = $2',
    [packageId, userId],
  );
  const row = packageResult.rows[0];
  if (!row) throw new Error('智能体不存在');

  const versionResult = await query<DbRowPackageVersion>(
    'select * from agent_package_versions where id = $1',
    [row.current_version_id],
  );
  const version = versionResult.rows[0];
  if (!version) throw new Error('当前版本不存在');
  return { row, version };
}

export async function listPackages(userId: string) {
  const result = await query<
    DbRowPackage & { current_version_number: number }
  >(
    `select p.*, v.version_number as current_version_number
     from agent_packages p
     join agent_package_versions v on v.id = p.current_version_id
     where p.user_id = $1
     order by p.updated_at desc`,
    [userId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    versionNumber: row.current_version_number,
    updatedAt: row.updated_at,
  }));
}

export async function getPackage(userId: string, packageId: string | number) {
  const { row, version } = await getPackageRow(userId, packageId);
  return toDetail(row, version);
}

export async function getPackageWithVersionId(
  userId: string,
  packageId: string | number,
): Promise<{ package: AgentPackageDetail; versionId: number }> {
  const { row, version } = await getPackageRow(userId, packageId);
  return {
    package: toDetail(row, version),
    versionId: version.id,
  };
}

export async function renamePackage(
  userId: string,
  packageId: string | number,
  name: string,
) {
  const nextName = name.trim();
  if (!nextName) throw new Error('Package name is required');
  if (nextName.length > 80) throw new Error('Package name is too long');

  const now = new Date().toISOString();
  const result = await query<DbRowPackage>(
    'update agent_packages set name = $1, updated_at = $2 where id = $3 and user_id = $4 returning *',
    [nextName, now, packageId, userId],
  );
  if (result.rowCount === 0) throw new Error('Package not found');

  const versionResult = await query<DbRowPackageVersion>(
    'select * from agent_package_versions where id = $1',
    [result.rows[0].current_version_id],
  );
  const version = versionResult.rows[0];
  if (!version) throw new Error('Current version not found');
  return toDetail(result.rows[0], version);
}

export async function listVersions(userId: string, packageId: string | number) {
  const packageResult = await query<DbRowPackage>(
    'select * from agent_packages where id = $1 and user_id = $2',
    [packageId, userId],
  );
  const row = packageResult.rows[0];
  if (!row) throw new Error('智能体不存在');

  const versions = await query<DbRowPackageVersion>(
    'select * from agent_package_versions where package_id = $1 order by version_number desc',
    [packageId],
  );

  return versions.rows.map(
    (version: DbRowPackageVersion): PackageVersion => ({
      id: version.id,
      packageId: version.package_id,
      versionNumber: version.version_number,
      createdAt: version.created_at,
      source: version.source as PackageVersion['source'],
      note: version.note || '',
      snapshot: parseDbJson<AgentPackageSnapshot>(
        version.snapshot_json,
        emptyPackageSnapshot(),
      ),
    }),
  );
}

export async function updateVersionNote(
  userId: string,
  packageId: string,
  versionId: string,
  note: string,
) {
  const packageResult = await query<DbRowPackage>(
    'select * from agent_packages where id = $1 and user_id = $2',
    [packageId, userId],
  );
  const row = packageResult.rows[0];
  if (!row) throw new Error('智能体不存在');

  const result = await query<DbRowPackageVersion>(
    'update agent_package_versions set note = $1 where id = $2 and package_id = $3 returning *',
    [note, versionId, packageId],
  );
  if (result.rowCount === 0) throw new Error('版本不存在');
  const version = result.rows[0];
  return {
    id: version.id,
    packageId: version.package_id,
    versionNumber: version.version_number,
    createdAt: version.created_at,
    source: version.source as PackageVersion['source'],
    note: version.note || '',
    snapshot: parseDbJson<AgentPackageSnapshot>(
      version.snapshot_json,
      emptyPackageSnapshot(),
    ),
  };
}

export interface CreatedPackageSnapshotIds {
  packageId: number;
  packageVersionId: number;
  packageVersionNumber: number;
  skillVersionIds: Record<string, string>;
}

export async function createPackageWithSnapshotTx(
  client: Queryable,
  userId: string,
  snapshot: AgentPackageSnapshot,
  source: PackageVersion['source'],
): Promise<CreatedPackageSnapshotIds> {
  const now = new Date().toISOString();
  const fixedSnapshot = ensureSkillIds(snapshot);
  const pkgResult = await client.query<{ id: number }>(
    'insert into agent_packages (user_id, name, description, current_version_id, created_at, updated_at) values ($1, $2, $3, 0, $4, $5) returning id',
    [userId, fixedSnapshot.name, fixedSnapshot.description, now, now],
  );
  const packageId = pkgResult.rows[0].id;
  const verResult = await client.query<{ id: number }>(
    'insert into agent_package_versions (package_id, version_number, source, snapshot_json, created_at) values ($1, $2, $3, $4, $5) returning id',
    [packageId, 1, source, JSON.stringify(fixedSnapshot), now],
  );
  const packageVersionId = verResult.rows[0].id;
  const syncedVersions = await syncPackageVersionSkillsFromSnapshot(client, {
    packageId,
    packageVersionId,
    packageVersionNumber: 1,
    source,
    snapshot: fixedSnapshot,
  });
  await client.query(
    'update agent_packages set current_version_id = $1 where id = $2',
    [packageVersionId, packageId],
  );
  return {
    packageId,
    packageVersionId,
    packageVersionNumber: 1,
    skillVersionIds: Object.fromEntries(
      [...syncedVersions].map(([skillUid, version]) => [skillUid, version.id]),
    ),
  };
}

export async function createPackageVersionWithSnapshotTx(
  client: Queryable,
  input: {
    userId: string;
    packageId: string | number;
    expectedPackageVersionId: string | number;
    snapshot: AgentPackageSnapshot;
    source: PackageVersion['source'];
    note?: string;
  },
): Promise<CreatedPackageSnapshotIds> {
  const now = new Date().toISOString();
  const packageResult = await client.query<DbRowPackage>(
    'select * from agent_packages where id = $1 and user_id = $2 for update',
    [input.packageId, input.userId],
  );
  const pkg = packageResult.rows[0];
  if (!pkg) throw new Error('智能体不存在');
  if (String(pkg.current_version_id) !== String(input.expectedPackageVersionId)) {
    throw new Error('PACKAGE_VERSION_CONFLICT');
  }
  const currentVersionResult = await client.query<DbRowPackageVersion>(
    'select * from agent_package_versions where id = $1 and package_id = $2',
    [input.expectedPackageVersionId, input.packageId],
  );
  const currentVersion = currentVersionResult.rows[0];
  if (!currentVersion) throw new Error('PACKAGE_VERSION_CONFLICT');
  const currentSnapshot = parseDbJson<AgentPackageSnapshot>(
    currentVersion.snapshot_json,
    emptyPackageSnapshot(),
  );
  await syncPackageVersionSkillsFromSnapshot(client, {
    packageId: input.packageId,
    packageVersionId: currentVersion.id,
    packageVersionNumber: currentVersion.version_number,
    source: currentVersion.source as PackageVersion['source'],
    snapshot: currentSnapshot,
  });
  const nextVersionNumber = currentVersion.version_number + 1;
  const fixedSnapshot = ensureSkillIds({
    ...input.snapshot,
    name: input.snapshot.name || pkg.name,
    description: input.snapshot.description || pkg.description,
    versionLabel: `v${nextVersionNumber}`,
  });
  const versionResult = await client.query<{ id: number }>(
    'insert into agent_package_versions (package_id, version_number, source, snapshot_json, note, created_at) values ($1, $2, $3, $4, $5, $6) returning id',
    [
      input.packageId,
      nextVersionNumber,
      input.source,
      JSON.stringify(fixedSnapshot),
      input.note ?? '',
      now,
    ],
  );
  const packageVersionId = versionResult.rows[0].id;
  const syncedVersions = await syncPackageVersionSkillsFromSnapshot(client, {
    packageId: input.packageId,
    packageVersionId,
    packageVersionNumber: nextVersionNumber,
    source: input.source,
    snapshot: fixedSnapshot,
    note: input.note,
  });
  await client.query(
    `update agent_packages
        set name = $1, description = $2, current_version_id = $3, updated_at = $4
      where id = $5 and user_id = $6`,
    [
      fixedSnapshot.name,
      fixedSnapshot.description,
      packageVersionId,
      now,
      input.packageId,
      input.userId,
    ],
  );
  return {
    packageId: Number(input.packageId),
    packageVersionId,
    packageVersionNumber: nextVersionNumber,
    skillVersionIds: Object.fromEntries(
      [...syncedVersions].map(([skillUid, version]) => [skillUid, version.id]),
    ),
  };
}

async function createPackageWithSnapshot(
  userId: string,
  snapshot: AgentPackageSnapshot,
  source: PackageVersion['source'],
) {
  const { packageId } = await withTransaction((client) =>
    createPackageWithSnapshotTx(client, userId, snapshot, source),
  );

  return getPackage(userId, packageId);
}

export async function buildGeneratedPackageSnapshot(input: {
  instruction: string;
  model?: string;
  documents?: Array<{ name: string; content: string }>;
  max_skills?: number;
  onPreview?: (preview: PackageGeneratePreview) => void;
  onPreviewDelta?: (delta: PackageGeneratePreviewDelta) => void;
}): Promise<AgentPackageSnapshot> {
  const {
    instruction,
    model,
    documents,
    onPreview,
    onPreviewDelta,
  } = input;
  const maxSkills = Math.min(
    MAX_GENERATED_SKILLS,
    Math.max(1, Math.trunc(input.max_skills ?? MAX_GENERATED_SKILLS)),
  );
  const startedAt = Date.now();
  const docParts = buildDocumentContext(documents, MAX_BASE_DOCUMENT_CHARS);
  const skillDocParts = buildDocumentContext(
    documents,
    MAX_SKILL_DOCUMENT_CHARS,
  );
  const sourceRubricExcerpt = await buildReviewedSourceRubricExcerpt(documents);
  const hasInstruction = instruction.trim().length > 0;

  getLogger({ component: 'package-generation' }).info({
    event: 'packages.generate.base.start',
    instructionLength: instruction.length,
    documentCount: documents?.length || 0,
    documentChars:
      documents?.reduce(
        (sum, doc) => sum + String(doc?.content || '').length,
        0,
      ) || 0,
    model,
  });

  const fallbackBase = createFallbackBase(instruction, documents);
  let base: PackageBaseGenerationResult;
  try {
    const baseJson = await generateJson<Partial<PackageBaseGenerationResult>>({
      model,
      systemPrompt: buildBaseMetadataSystemPrompt(),
      userPrompt: buildBaseMetadataUserPrompt({
        hasInstruction,
        instruction,
        documentContext: docParts,
        outputSchemaPrompt: getBaseOutputSchemaPrompt(),
      }),
      temperature: 0.4,
      maxTokens: 2000,
    });
    base = normalizeBaseMetadataJson(baseJson, fallbackBase);
  } catch (error) {
    getLogger({ component: 'package-generation' }).warn({
      event: 'packages.generate.base.fallback',
      error: safeError(error),
    });
    base = fallbackBase;
  }

  validateBaseGenerationResult(base);
  const skillMetas = normalizeSkillMetadata(base.skills, maxSkills);
  getLogger({ component: 'package-generation' }).info({
    event: 'packages.generate.base.done',
    durationMs: Date.now() - startedAt,
    skillCount: skillMetas.length,
  });

  const agentMd = stripMarkdownFence(
    await collectStreamedText(
      {
        model,
        systemPrompt: buildAgentSystemPrompt(),
        userPrompt: buildAgentUserPrompt({
          packageName: base.name,
          packageDescription: base.description,
          skillMetasJson: JSON.stringify(skillMetas, null, 2),
          hasInstruction,
          sourceContext: hasInstruction ? instruction : docParts,
        }),
        temperature: 0.35,
        maxTokens: 3500,
      },
      (delta) => onPreviewDelta?.({ type: 'agent', name: 'agent.md', delta }),
    ),
  );

  const resolvedRubricMd = normalizeStoredRubricMarkdown(sourceRubricExcerpt);

  onPreview?.({
    type: 'agent',
    name: 'agent.md',
    content: agentMd.trim().slice(0, 1200),
  });
  if (resolvedRubricMd.trim()) {
    onPreview?.({
      type: 'rubric',
      name: 'rubric.md',
      content: resolvedRubricMd.trim().slice(0, 800),
    });
  }

  const skills = await Promise.all(
    skillMetas.map(async (skillMeta, index) => {
      const skillStartedAt = Date.now();
      getLogger({ component: 'package-generation' }).info({
        event: 'packages.generate.skill.start',
        index: index + 1,
        total: skillMetas.length,
        dirName: skillMeta.dirName,
        model,
      });

      const skillMdRaw = await collectStreamedText(
        {
          model,
          systemPrompt: buildSkillSystemPrompt(),
          userPrompt: buildSkillUserPrompt({
            packageName: base.name,
            packageDescription: base.description,
            agentExcerpt: agentMd.slice(0, 1800),
            rubricExcerpt: resolvedRubricMd.slice(0, 1200),
            documentContext: skillDocParts,
            skillMetaJson: JSON.stringify(skillMeta),
            siblingSkillsJson: JSON.stringify(
              skillMetas.filter((meta) => meta.dirName !== skillMeta.dirName),
              null,
              2,
            ),
            skillTemplatePrompt: getCompactSkillTemplatePrompt(),
          }),
          temperature: 0.35,
          maxTokens: 4000,
        },
        (delta) =>
          onPreviewDelta?.({ type: 'skill', name: skillMeta.name, delta }),
      );

      const skillMd = normalizeSkillMdMissingSections(
        normalizeSkillMdFrontmatter(
          skillMdRaw || '',
          skillMeta.dirName,
          skillMeta.description,
        ),
        skillMeta.name,
        skillMeta.description,
      );
      const skill = { ...skillMeta, skillMd };
      onPreview?.({
        type: 'skill',
        name: skill.name,
        content: skill.skillMd.slice(0, 800),
      });
      getLogger({ component: 'package-generation' }).info({
        event: 'packages.generate.skill.done',
        index: index + 1,
        dirName: skill.dirName,
        durationMs: Date.now() - skillStartedAt,
      });
      return skill;
    }),
  );

  const generated: PackageGenerationResult = {
    name: base.name,
    description: base.description,
    agentMd,
    rubricMd: resolvedRubricMd,
    skills,
  };

  if (resolvedRubricMd.trim() && !hasConfiguredRubricText(resolvedRubricMd)) {
    getLogger({ component: 'package-generation' }).warn({
      event: 'packages.generate.rubric.invalid',
      reason: sourceRubricExcerpt.trim()
        ? 'rubric repair failed and the extracted document rubric was preserved'
        : 'generated rubric remained incomplete after repair',
    });
  }

  validateGenerationResult(generated);

  const snapshot = normalizeSnapshot(generated);
  onPreview?.({
    type: 'json',
    name: 'snapshot.json',
    content: buildSnapshotJson(snapshot).slice(0, 4000),
  });
  getLogger({ component: 'package-generation' }).info({
    event: 'packages.generate.validate.done',
    durationMs: Date.now() - startedAt,
  });
  return snapshot;
}

export async function generatePackage(
  userId: string,
  instruction: string,
  model?: string,
  documents?: Array<{ name: string; content: string }>,
  onPreview?: (preview: PackageGeneratePreview) => void,
  onPreviewDelta?: (delta: PackageGeneratePreviewDelta) => void,
) {
  const snapshot = await buildGeneratedPackageSnapshot({
    instruction,
    model,
    documents,
    onPreview,
    onPreviewDelta,
  });
  return createPackageWithSnapshot(userId, snapshot, 'generated');
}

async function importPackageWithVersions(
  userId: string,
  versions: Array<{
    versionNumber: number;
    source: string;
    snapshot: AgentPackageSnapshot;
    createdAt: string;
  }>,
) {
  if (versions.length === 0) throw new Error('版本历史为空');

  const now = new Date().toISOString();

  // Sort by versionNumber ascending to ensure correct insertion order
  const sortedVersions = [...versions].sort(
    (a, b) => a.versionNumber - b.versionNumber,
  );

  // Derive package name/description from any version that has it
  let packageName = '';
  let packageDescription = '';
  for (const v of sortedVersions) {
    if (v.snapshot.name) packageName = v.snapshot.name;
    if (v.snapshot.description) packageDescription = v.snapshot.description;
    if (packageName && packageDescription) break;
  }
  if (!packageName) packageName = '导入的智能体';
  if (!packageDescription) packageDescription = '导入的智能体';

  const packageId = await withTransaction(async (client) => {
    const pkgResult = await client.query<{ id: number }>(
      'insert into agent_packages (user_id, name, description, current_version_id, created_at, updated_at) values ($1, $2, $3, 0, $4, $5) returning id',
      [userId, packageName, packageDescription, now, now],
    );
    const nextPackageId = pkgResult.rows[0].id;

    // 创建所有版本记录（确保每个 snapshot 都有 name/description）
    let currentVersionId = 0;
    let maxVersionNumber = 0;
    for (const v of sortedVersions) {
      const enrichedSnapshot: AgentPackageSnapshot = ensureSkillIds({
        ...v.snapshot,
        name: v.snapshot.name || packageName,
        description: v.snapshot.description || packageDescription,
      });
      const verResult = await client.query<{ id: number }>(
        'insert into agent_package_versions (package_id, version_number, source, snapshot_json, created_at) values ($1, $2, $3, $4, $5) returning id',
        [
          nextPackageId,
          v.versionNumber,
          v.source,
          JSON.stringify(enrichedSnapshot),
          v.createdAt || now,
        ],
      );
      const versionId = verResult.rows[0].id;
      await syncPackageVersionSkillsFromSnapshot(client, {
        packageId: nextPackageId,
        packageVersionId: versionId,
        packageVersionNumber: v.versionNumber,
        source: toSkillVersionSource(v.source),
        snapshot: enrichedSnapshot,
      });
      if (v.versionNumber >= maxVersionNumber) {
        maxVersionNumber = v.versionNumber;
        currentVersionId = versionId;
      }
    }

    // Update package with real current_version_id
    await client.query(
      'update agent_packages set current_version_id = $1 where id = $2',
      [currentVersionId, nextPackageId],
    );
    return nextPackageId;
  });

  return getPackage(userId, packageId);
}

export async function importPackageZip(userId: string, zipBuffer: Buffer) {
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();
  const zipReader = createPackageZipReader(entries);
  const manifestEntry = entries.find((entry: IZipEntry) =>
    entry.entryName.endsWith('manifest.json'),
  );
  const snapshotEntry = entries.find((entry: IZipEntry) =>
    entry.entryName.endsWith('snapshot.json'),
  );
  const agentEntry = entries.find((entry: IZipEntry) =>
    entry.entryName.endsWith('agent.md'),
  );
  const rubricEntry = entries.find((entry: IZipEntry) =>
    entry.entryName.endsWith('rubric.md'),
  );
  const versionsEntry = entries.find((entry: IZipEntry) =>
    entry.entryName.endsWith('versions.json'),
  );

  if (versionsEntry) {
    try {
      const versions = JSON.parse(
        zipReader.readText(versionsEntry),
      ) as Array<{
        versionNumber: number;
        source: string;
        snapshot: AgentPackageSnapshot;
        createdAt: string;
      }>;
      if (Array.isArray(versions) && versions.length > 0) {
        return importPackageWithVersions(userId, versions);
      }
    } catch (error) {
      if (error instanceof PackageZipSecurityError) throw error;
      // fallback to snapshot or normal import
    }
  }

  if (snapshotEntry) {
    try {
      const snapshot = JSON.parse(
        zipReader.readText(snapshotEntry),
      ) as AgentPackageSnapshot;
      if (snapshot?.agentMd && Array.isArray(snapshot.skills)) {
        return createPackageWithSnapshot(
          userId,
          {
            ...snapshot,
            name: snapshot.name?.trim() || '导入的智能体',
            description: snapshot.description?.trim() || '导入的智能体',
            versionLabel: snapshot.versionLabel || 'v1',
            rubricMd:
              typeof snapshot.rubricMd === 'string'
                ? snapshot.rubricMd.trim()
                : '',
          },
          'imported',
        );
      }
    } catch (error) {
      if (error instanceof PackageZipSecurityError) throw error;
      // fallback to normal import
    }
  }

  if (!manifestEntry || !agentEntry) {
    throw new Error(
      '导入的 ZIP 文件中缺少 snapshot.json，或缺少 manifest.json / agent.md',
    );
  }

  const manifest = JSON.parse(zipReader.readText(manifestEntry)) as {
    name?: string;
    description?: string;
  };

  // 普通导入（兼容旧格式或没有版本历史的 ZIP）
  const skillEntries = entries.filter((entry: IZipEntry) =>
    /skills\/[^/]+\/SKILL\.md$/.test(entry.entryName),
  );
  const skills: PackageSkill[] = skillEntries.map((entry: IZipEntry) => {
    const parts = entry.entryName.split('/');
    const dirName = parts[parts.length - 2]!;
    const content = zipReader.readText(entry);
    const title =
      content
        .split('\n')
        .find((line: string) => line.startsWith('# '))
        ?.replace(/^#\s+/, '') || dirName;
    return {
      id: randomUUID(),
      dirName,
      name: title,
      description: `${title} skill`,
      skillMd: content,
    };
  });

  const snapshot: AgentPackageSnapshot = {
    name: manifest.name?.trim() || '导入的智能体',
    description: manifest.description?.trim() || '导入的智能体',
    versionLabel: 'v1',
    agentMd: zipReader.readText(agentEntry).trim(),
    rubricMd: rubricEntry ? zipReader.readText(rubricEntry).trim() : '',
    skills,
  };

  return createPackageWithSnapshot(userId, snapshot, 'imported');
}

export async function exportPackageZip(userId: string, packageId: string) {
  const pkg = await getPackage(userId, packageId);
  const versions = await listVersions(userId, packageId);
  const zip = new AdmZip();

  zip.addFile(
    'manifest.json',
    Buffer.from(
      JSON.stringify(
        {
          name: pkg.snapshot.name,
          description: pkg.snapshot.description,
          versionLabel: pkg.snapshot.versionLabel,
          versionCount: versions.length,
          hasVersionHistory: versions.length > 1,
          exportedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    ),
  );
  zip.addFile('snapshot.json', Buffer.from(buildSnapshotJson(pkg.snapshot)));

  zip.addFile('agent.md', Buffer.from(pkg.snapshot.agentMd));
  zip.addFile('rubric.md', Buffer.from(pkg.snapshot.rubricMd));
  for (const skill of pkg.snapshot.skills) {
    zip.addFile(`skills/${skill.dirName}/SKILL.md`, Buffer.from(skill.skillMd));
  }

  if (versions.length > 0) {
    zip.addFile(
      'versions.json',
      Buffer.from(
        JSON.stringify(
          versions.map((v) => ({
            versionNumber: v.versionNumber,
            source: v.source,
            snapshot: v.snapshot,
            createdAt: v.createdAt,
          })),
          null,
          2,
        ),
      ),
    );
  }

  return zip.toBuffer();
}

export async function deletePackage(userId: string, packageId: string) {
  const pkg = await query<DbRowPackage>(
    'select * from agent_packages where id = $1 and user_id = $2',
    [packageId, userId],
  );
  if (!pkg.rows[0])
    throw new Error('\u667a\u80fd\u4f53\u5305\u4e0d\u5b58\u5728');

  await query(
    'delete from arena_messages where thread_id in (select id from arena_threads where package_id = $1 and user_id = $2)',
    [packageId, userId],
  );
  await query(
    'delete from arena_threads where package_id = $1 and user_id = $2',
    [packageId, userId],
  );
  await query('delete from agent_package_versions where package_id = $1', [
    packageId,
  ]);
  await query('delete from agent_packages where id = $1 and user_id = $2', [
    packageId,
    userId,
  ]);
}

export async function applyOptimizedSnapshot(
  userId: string,
  packageId: string | number,
  snapshot: AgentPackageSnapshot,
  source: PackageVersion['source'],
  note?: string,
) {
  const now = new Date().toISOString();

  await withTransaction(async (client) => {
    const packageResult = await client.query<DbRowPackage>(
      'select * from agent_packages where id = $1 and user_id = $2 for update',
      [packageId, userId],
    );
    const pkg = packageResult.rows[0];
    if (!pkg) throw new Error('智能体不存在');

    const versions = await client.query<DbRowPackageVersion>(
      'select * from agent_package_versions where package_id = $1 order by version_number desc limit 1 for update',
      [packageId],
    );
    const nextVersion = (versions.rows[0]?.version_number || 0) + 1;
    const currentVersion = versions.rows[0];
    const currentSnapshot = currentVersion
      ? parseDbJson<AgentPackageSnapshot>(
          currentVersion.snapshot_json,
          emptyPackageSnapshot(),
        )
      : emptyPackageSnapshot();

    const nextSnapshot: AgentPackageSnapshot = ensureSkillIds({
      ...snapshot,
      name: snapshot.name || pkg.name,
      description: snapshot.description || pkg.description,
      rubricMd: normalizeStoredRubricMarkdown(snapshot.rubricMd),
      versionLabel: `v${nextVersion}`,
    });

    const verResult = await client.query<{ id: number }>(
      'insert into agent_package_versions (package_id, version_number, source, snapshot_json, note, created_at) values ($1, $2, $3, $4, $5, $6) returning id',
      [
        packageId,
        nextVersion,
        source,
        JSON.stringify(nextSnapshot),
        note || '',
        now,
      ],
    );
    const versionId = verResult.rows[0].id;

    if (currentVersion) {
      await syncPackageVersionSkillsFromSnapshot(client, {
        packageId,
        packageVersionId: currentVersion.id,
        packageVersionNumber: currentVersion.version_number,
        source: currentVersion.source as PackageVersion['source'],
        snapshot: currentSnapshot,
      });
    }
    await syncPackageVersionSkillsFromSnapshot(client, {
      packageId,
      packageVersionId: versionId,
      packageVersionNumber: nextVersion,
      source,
      snapshot: nextSnapshot,
      note,
    });

    await client.query(
      'update agent_packages set name = $1, description = $2, current_version_id = $3, updated_at = $4 where id = $5 and user_id = $6',
      [pkg.name, pkg.description, versionId, now, pkg.id, userId],
    );
  });

  return getPackage(userId, packageId);
}

export async function repairPackageRubric(
  userId: string,
  packageId: string,
  model?: string,
) {
  void model;
  const pkg = await getPackage(userId, packageId);
  const currentRawRubric = normalizeRubricMarkdown(pkg.snapshot.rubricMd);
  const currentRubric = normalizeStoredRubricMarkdown(pkg.snapshot.rubricMd);

  if (currentRubric && hasConfiguredRubricText(currentRubric)) {
    if (currentRubric !== currentRawRubric) {
      const nextSnapshot: AgentPackageSnapshot = {
        ...pkg.snapshot,
        rubricMd: currentRubric,
        skills: pkg.snapshot.skills.map((skill) => ({ ...skill })),
      };

      return applyOptimizedSnapshot(
        userId,
        packageId,
        nextSnapshot,
        'optimized',
        'AI 修复 rubric.md',
      );
    }

    return pkg;
  }

  assertRubricConfigured(currentRubric, 'rubric 修复');
}

export async function optimizePackageRubric(
  userId: string,
  packageId: string,
  model?: string,
) {
  const pkg = await getPackage(userId, packageId);
  const currentRawRubric = normalizeRubricMarkdown(pkg.snapshot.rubricMd);
  const currentRubric = normalizeStoredRubricMarkdown(pkg.snapshot.rubricMd);

  if (currentRubric && hasConfiguredRubricText(currentRubric)) {
    if (currentRubric !== currentRawRubric) {
      const nextSnapshot: AgentPackageSnapshot = {
        ...pkg.snapshot,
        rubricMd: currentRubric,
        skills: pkg.snapshot.skills.map((skill) => ({ ...skill })),
      };

      return applyOptimizedSnapshot(
        userId,
        packageId,
        nextSnapshot,
        'optimized',
        'AI 优化 rubric.md',
      );
    }
  }

  assertRubricConfigured(currentRubric, 'rubric 优化');

  const optimizedRubric = await generateRubricWithRepair({
    model,
    packageName: pkg.snapshot.name,
    packageDescription: pkg.snapshot.description,
    agentExcerpt: pkg.snapshot.agentMd.slice(0, 1800),
    sourceRubricExcerpt: currentRubric,
    useStream: false,
    mode: 'optimize',
  });

  if (!hasConfiguredRubricText(optimizedRubric)) {
    throw new Error(
      'AI 未能把当前 rubric 优化成可评分格式，请稍后重试或手动编辑。',
    );
  }

  const normalizedOptimized = normalizeStoredRubricMarkdown(optimizedRubric);
  if (normalizedOptimized === currentRubric) {
    throw new Error('AI 没有产出新的 rubric 内容，请稍后重试。');
  }

  const nextSnapshot: AgentPackageSnapshot = {
    ...pkg.snapshot,
    rubricMd: normalizedOptimized,
    skills: pkg.snapshot.skills.map((skill) => ({ ...skill })),
  };

  return applyOptimizedSnapshot(
    userId,
    packageId,
    nextSnapshot,
    'optimized',
    'AI 优化 rubric.md',
  );
}

export async function applyManualMarkdownEdit(
  userId: string,
  packageId: string,
  input: {
    target: 'agent' | 'rubric' | 'skill';
    content: string;
    skillId?: string;
    note?: string;
  },
) {
  const pkg = await getPackage(userId, packageId);
  const content = String(input.content || '').trim();
  if (!content) throw new Error('编辑内容不能为空');

  const nextSnapshot: AgentPackageSnapshot = {
    ...pkg.snapshot,
    skills: pkg.snapshot.skills.map((skill) => ({ ...skill })),
  };

  if (input.target === 'agent') {
    if (content === pkg.snapshot.agentMd.trim())
      throw new Error('内容没有变化，无需保存新版本');
    nextSnapshot.agentMd = content;
    return applyOptimizedSnapshot(
      userId,
      packageId,
      nextSnapshot,
      'manual',
      input.note || '手动编辑 agent.md',
    );
  }

  if (input.target === 'rubric') {
    const currentRawRubric = pkg.snapshot.rubricMd.trim();
    const normalizedCurrentRubric = normalizeStoredRubricMarkdown(
      pkg.snapshot.rubricMd,
    );
    const normalizedNextRubric =
      normalizeStoredRubricMarkdown(content) || content;
    if (
      normalizedNextRubric === normalizedCurrentRubric &&
      currentRawRubric === normalizedNextRubric
    ) {
      throw new Error('内容没有变化，无需保存新版本');
    }
    nextSnapshot.rubricMd = normalizedNextRubric;
    return applyOptimizedSnapshot(
      userId,
      packageId,
      nextSnapshot,
      'manual',
      input.note || '手动编辑 rubric.md',
    );
  }

  const skillId = String(input.skillId || '');
  if (!skillId) throw new Error('缺少要编辑的技能');
  const skillIndex = nextSnapshot.skills.findIndex(
    (skill) => skill.id === skillId || skill.dirName === skillId,
  );
  if (skillIndex === -1) throw new Error('技能不存在');

  const fmName = extractFrontmatterValue(content, 'name');
  const fmDescription = extractFrontmatterValue(content, 'description');
  if (!content.startsWith('---') || !fmName || !fmDescription) {
    throw new Error(
      'SKILL.md 必须保留 YAML frontmatter，并包含 name 和 description',
    );
  }

  const currentSkill = nextSnapshot.skills[skillIndex]!;
  const normalizedContent = content.replace(/\r\n/g, '\n');
  if (normalizedContent === currentSkill.skillMd.trim())
    throw new Error('内容没有变化，无需保存新版本');
  nextSnapshot.skills[skillIndex] = {
    ...currentSkill,
    name: fmName,
    description: fmDescription,
    skillMd: normalizedContent,
  };

  return applyOptimizedSnapshot(
    userId,
    packageId,
    nextSnapshot,
    'manual',
    input.note || `手动编辑 ${currentSkill.dirName}/SKILL.md`,
  );
}

/* ── version compare ── */

export interface LineDiff {
  type: 'same' | 'removed' | 'added';
  text: string;
}

export interface SkillDiff {
  dirName: string;
  name: string;
  diff: LineDiff[];
}

export interface VersionCompareResult {
  baseVersion: {
    id: number;
    versionNumber: number;
    source: string;
    createdAt: string;
  };
  targetVersion: {
    id: number;
    versionNumber: number;
    source: string;
    createdAt: string;
  };
  diffs: {
    agentMd: LineDiff[];
    rubricMd: LineDiff[];
    skills: SkillDiff[];
  };
  summary: string;
}

function computeDiff(oldText: string, newText: string): LineDiff[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const result: LineDiff[] = [];
  let i = 0,
    j = 0;

  while (i < oldLines.length || j < newLines.length) {
    const oldLine = i < oldLines.length ? oldLines[i] : undefined;
    const newLine = j < newLines.length ? newLines[j] : undefined;

    if (oldLine === newLine) {
      result.push({ type: 'same', text: oldLine || '' });
      i++;
      j++;
    } else if (oldLine !== undefined && newLine !== undefined) {
      // Check if old line appears later in new (removed)
      const newIndexAhead = newLines.slice(j + 1).indexOf(oldLine);
      // Check if new line appeared earlier in old (added)
      const oldIndexAhead = oldLines.slice(i + 1).indexOf(newLine);

      if (
        newIndexAhead !== -1 &&
        (oldIndexAhead === -1 || newIndexAhead <= oldIndexAhead)
      ) {
        // oldLine is removed, skip it
        result.push({ type: 'removed', text: oldLine });
        i++;
      } else if (
        oldIndexAhead !== -1 &&
        (newIndexAhead === -1 || oldIndexAhead < newIndexAhead)
      ) {
        // newLine is added
        result.push({ type: 'added', text: newLine });
        j++;
      } else {
        // Both changed
        result.push({ type: 'removed', text: oldLine });
        result.push({ type: 'added', text: newLine });
        i++;
        j++;
      }
    } else if (oldLine !== undefined) {
      result.push({ type: 'removed', text: oldLine });
      i++;
    } else if (newLine !== undefined) {
      result.push({ type: 'added', text: newLine });
      j++;
    }
  }

  return result;
}

function compactDiff(diffs: LineDiff[], contextLines = 2): LineDiff[] {
  const result: LineDiff[] = [];
  let sameRunStart = -1;

  for (let i = 0; i < diffs.length; i++) {
    const d = diffs[i];
    if (d.type !== 'same') {
      if (sameRunStart !== -1) {
        const runLen = i - sameRunStart;
        if (runLen > contextLines * 2) {
          result.push(
            ...diffs.slice(sameRunStart, sameRunStart + contextLines),
          );
          result.push({
            type: 'same',
            text: `... (${runLen - contextLines * 2} 行未变更) ...`,
          });
          result.push(...diffs.slice(i - contextLines, i));
        } else {
          result.push(...diffs.slice(sameRunStart, i));
        }
        sameRunStart = -1;
      }
      result.push(d);
    } else {
      if (sameRunStart === -1) sameRunStart = i;
    }
  }

  if (sameRunStart !== -1) {
    const runLen = diffs.length - sameRunStart;
    if (runLen > contextLines * 2) {
      result.push(...diffs.slice(sameRunStart, sameRunStart + contextLines));
      result.push({
        type: 'same',
        text: `... (${runLen - contextLines * 2} 行未变更) ...`,
      });
      result.push(...diffs.slice(diffs.length - contextLines, diffs.length));
    } else {
      result.push(...diffs.slice(sameRunStart, diffs.length));
    }
  }

  return result;
}

export async function getVersion(
  userId: string,
  packageId: string | number,
  versionId: string,
): Promise<PackageVersion> {
  const packageResult = await query<DbRowPackage>(
    'select * from agent_packages where id = $1 and user_id = $2',
    [packageId, userId],
  );
  if (!packageResult.rows[0]) throw new Error('智能体不存在');

  const versionResult = await query<DbRowPackageVersion>(
    'select * from agent_package_versions where id = $1 and package_id = $2',
    [versionId, packageId],
  );
  const row = versionResult.rows[0];
  if (!row) throw new Error('版本不存在');

  return {
    id: row.id,
    packageId: row.package_id,
    versionNumber: row.version_number,
    createdAt: row.created_at,
    source: row.source as PackageVersion['source'],
    note: row.note || '',
    snapshot: parseDbJson<AgentPackageSnapshot>(
      row.snapshot_json,
      emptyPackageSnapshot(),
    ),
  };
}

export async function compareVersions(
  userId: string,
  packageId: string | number,
  baseVersionId: string,
  targetVersionId: string,
  model?: string,
): Promise<VersionCompareResult> {
  const base = await getVersion(userId, packageId, baseVersionId);
  const target = await getVersion(userId, packageId, targetVersionId);

  const agentMdDiff = compactDiff(
    computeDiff(base.snapshot.agentMd, target.snapshot.agentMd),
  );
  const rubricMdDiff = compactDiff(
    computeDiff(base.snapshot.rubricMd, target.snapshot.rubricMd),
  );

  const skillDiffs: SkillDiff[] = [];
  const allDirNames = new Set([
    ...base.snapshot.skills.map((s) => s.dirName),
    ...target.snapshot.skills.map((s) => s.dirName),
  ]);

  for (const dirName of allDirNames) {
    const baseSkill = base.snapshot.skills.find((s) => s.dirName === dirName);
    const targetSkill = target.snapshot.skills.find(
      (s) => s.dirName === dirName,
    );
    const name = targetSkill?.name || baseSkill?.name || dirName;

    if (!baseSkill && targetSkill) {
      skillDiffs.push({
        dirName,
        name,
        diff: compactDiff(
          targetSkill.skillMd
            .split('\n')
            .map((text) => ({ type: 'added' as const, text })),
        ),
      });
    } else if (baseSkill && !targetSkill) {
      skillDiffs.push({
        dirName,
        name,
        diff: compactDiff(
          baseSkill.skillMd
            .split('\n')
            .map((text) => ({ type: 'removed' as const, text })),
        ),
      });
    } else if (baseSkill && targetSkill) {
      const diff = compactDiff(
        computeDiff(baseSkill.skillMd, targetSkill.skillMd),
      );
      if (diff.some((d) => d.type !== 'same')) {
        skillDiffs.push({ dirName, name, diff });
      }
    }
  }

  // AI summary
  const diffSummary = [
    `## agent.md`,
    agentMdDiff
      .filter((d) => d.type !== 'same')
      .slice(0, 40)
      .map((d) => `${d.type === 'removed' ? '-' : '+'} ${d.text}`)
      .join('\n'),
    ``,
    `## rubric.md`,
    rubricMdDiff
      .filter((d) => d.type !== 'same')
      .slice(0, 40)
      .map((d) => `${d.type === 'removed' ? '-' : '+'} ${d.text}`)
      .join('\n'),
    ``,
    `## skills`,
    skillDiffs
      .map((s) => {
        const changes = s.diff.filter((d) => d.type !== 'same').slice(0, 20);
        return `### ${s.name} (${s.dirName})\n${changes.map((d) => `${d.type === 'removed' ? '-' : '+'} ${d.text}`).join('\n')}`;
      })
      .join('\n\n'),
  ].join('\n');

  const summaryPrompt = [
    '你是智能体版本对比专家。请根据以下两个版本的 diff，用中文总结改动内容。',
    '',
    `基准版本：v${base.versionNumber} (${base.source})`,
    `目标版本：v${target.versionNumber} (${target.source})`,
    '',
    '## Diff 内容',
    diffSummary.split('\n').slice(0, 200).join('\n').slice(0, 6000),
    '',
    '## 要求',
    '1. 总结每个文件（agent.md、rubric.md、skills）的主要改动',
    '2. 用 markdown 表格格式返回，表格包含以下列：',
    '   | 文件 | 改动类型 | 变化内容 | 作用/影响 |',
    '   - 文件：agent.md / rubric.md / skill 名称',
    '   - 改动类型：新增 / 删除 / 修改 / 重构 / 优化 / 无变更',
    '   - 变化内容：具体改了什么（1-2句话，精炼）',
    '   - 作用/影响：这个改动带来了什么效果（1句话）',
    '3. 表格下方用 1-2 句话总结整体改动趋势',
    "4. 如果无改动，表格里写'无变更'，总结写'两个版本一致'",
    '5. 必须返回包含 summary 字段的 JSON，summary 内容为 markdown 表格',
  ].join('\n');

  let summary: string | undefined;
  try {
    const result = await generateJson<{ summary: string }>({
      model,
      systemPrompt:
        '你是智能体版本对比专家。根据 diff 内容总结改动。必须严格返回 JSON 格式：{"summary": "总结内容"}。summary 不能为空，必须包含实质性的总结内容。不要返回其他内容。',
      userPrompt: summaryPrompt,
      temperature: 0.3,
    });
    summary = result.summary?.trim();
  } catch {
    // Fall through to the plain-text summary fallback.
  }

  // Fallback: if JSON parsing fails or summary is empty, try plain text
  if (!summary) {
    try {
      const chatResult = await generateChat(
        [
          {
            role: 'system',
            content:
              '你是智能体版本对比专家。根据 diff 内容用中文总结改动。直接输出总结文本，不要返回 JSON。',
          },
          { role: 'user', content: summaryPrompt },
        ],
        model,
        0.3,
      );
      summary = chatResult.trim();
    } catch {
      // Fall through to the static summary fallback.
    }
  }

  if (!summary) {
    const hasChanges =
      agentMdDiff.some((d) => d.type !== 'same') ||
      rubricMdDiff.some((d) => d.type !== 'same') ||
      skillDiffs.length > 0;
    summary = hasChanges
      ? 'AI 总结生成失败，请直接查看下方的 diff 详情。'
      : '两个版本无差异。';
  }

  return {
    baseVersion: {
      id: base.id,
      versionNumber: base.versionNumber,
      source: base.source,
      createdAt: base.createdAt,
    },
    targetVersion: {
      id: target.id,
      versionNumber: target.versionNumber,
      source: target.source,
      createdAt: target.createdAt,
    },
    diffs: { agentMd: agentMdDiff, rubricMd: rubricMdDiff, skills: skillDiffs },
    summary,
  };
}
