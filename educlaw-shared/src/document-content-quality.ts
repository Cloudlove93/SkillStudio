export const DOCUMENT_CONTENT_QUALITY_ERROR =
  '未识别到有意义的文字，无法生成 Skill，请上传包含明确内容的文档';

const CJK_RUN_PATTERN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu;
const LATIN_WORD_PATTERN = /[A-Za-zÀ-ÖØ-öø-ÿ]{2,}/g;
const KEYBOARD_SEQUENCE_PATTERN =
  /qwert|asdf|zxcv|hjkl|poiuy|lkjh|mnbv/i;
const CODE_KEYWORD_PATTERN =
  /\b(?:class|const|def|enum|export|for|from|function|if|import|interface|let|private|public|return|select|type|update|var|while)\b/i;

function normalizeDocumentContent(content: string): string {
  return String(content || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
}

function isWordLikeLatinToken(token: string): boolean {
  if (token.length < 3 || KEYBOARD_SEQUENCE_PATTERN.test(token)) return false;
  const lower = token.toLowerCase();
  const vowelCount = (lower.match(/[aeiou]/g) || []).length;
  if (token.length >= 8) return vowelCount >= 2;
  return vowelCount >= 1 && !/[bcdfghjklmnpqrstvwxyz]{4,}/i.test(token);
}

function hasMeaningfulStructuredContent(content: string): boolean {
  if (CODE_KEYWORD_PATTERN.test(content) && /[{}()[\]=:;]/.test(content)) {
    return true;
  }

  try {
    const parsed = JSON.parse(content) as unknown;
    if (parsed && typeof parsed === 'object') {
      const serializedWords = JSON.stringify(parsed)
        .replace(/[{}\[\]":,]/g, ' ')
        .trim();
      if (
        serializedWords &&
        hasMeaningfulDocumentContent(serializedWords)
      ) {
        return true;
      }
    }
  } catch {
    // Non-JSON documents are evaluated by the language and table heuristics.
  }

  const rows = content
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean);
  if (rows.length < 2) return false;
  const delimiter = [',', '\t', '|'].find((candidate) =>
    rows.slice(0, 3).every((row) => row.includes(candidate)),
  );
  if (!delimiter) return false;
  return hasMeaningfulDocumentContent(
    rows.join(' ').split(delimiter).join(' '),
  );
}

export function hasMeaningfulDocumentContent(content: string): boolean {
  const normalized = normalizeDocumentContent(content);
  const visible = normalized.replace(/\s/g, '');
  if (visible.length < 4) return false;

  const cjkRuns = normalized.match(CJK_RUN_PATTERN) || [];
  const cjkCount = cjkRuns.reduce(
    (sum, run) => sum + Array.from(run).length,
    0,
  );
  const longestCjkRun = cjkRuns.reduce(
    (longest, run) => Math.max(longest, Array.from(run).length),
    0,
  );
  if (longestCjkRun >= 4 || (cjkCount >= 5 && cjkRuns.length <= 3)) {
    return true;
  }

  const latinTokens = normalized.match(LATIN_WORD_PATTERN) || [];
  const wordLikeLatinTokens = latinTokens.filter(isWordLikeLatinToken);
  const latinLetterCount = wordLikeLatinTokens.reduce(
    (sum, token) => sum + token.length,
    0,
  );
  if (
    (wordLikeLatinTokens.length >= 2 && latinLetterCount >= 8) ||
    (wordLikeLatinTokens.length >= 1 &&
      latinLetterCount >= 8 &&
      cjkCount >= 2)
  ) {
    return true;
  }

  return hasMeaningfulStructuredContent(normalized);
}
