export function extractSkillFrontmatterValue(
  skillMd: string,
  key: string,
): string | null {
  const match = skillMd.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const line = match[1]
    .split(/\r?\n/)
    .find((entry) => entry.trim().startsWith(`${key}:`));
  if (!line) return null;
  const value = line.slice(line.indexOf(':') + 1).trim();
  return value.replace(/^["']|["']$/g, '');
}

/**
 * Structural rules every SKILL.md must satisfy, whichever path writes it:
 * a frontmatter block carrying name and description, with a bounded
 * description. These are integrity constraints, not naming conventions — the
 * legacy repair path also edits Skills whose frontmatter name is a Chinese
 * display name rather than the directory slug, so name format and
 * `dirName` equality stay in the strict standard below.
 */
export function validateSkillIdentity(
  skillMd: string,
  dirName: string,
): string[] {
  void dirName;
  const errors: string[] = [];

  if (!skillMd.trim().startsWith('---')) {
    errors.push('SKILL.md 必须以 YAML frontmatter（---）开头');
    return errors;
  }

  const fmName = extractSkillFrontmatterValue(skillMd, 'name');
  const fmDescription = extractSkillFrontmatterValue(skillMd, 'description');
  if (!fmName) errors.push('YAML frontmatter 缺少 name 字段');
  if (!fmDescription) errors.push('YAML frontmatter 缺少 description 字段');

  if (fmDescription && fmDescription.length > 200) {
    errors.push(
      `frontmatter description 过长（${fmDescription.length} 字符，建议 ≤200）`,
    );
  }
  if (fmDescription && /[<>]/.test(fmDescription)) {
    errors.push('frontmatter description 不应包含 XML 尖括号');
  }

  return errors;
}

/**
 * Full quality gate used when a Skill version is created or formally
 * published: structural identity plus the directory/name convention, trigger
 * wording, body length and required sections. The legacy manual repair path
 * only runs `validateSkillIdentity`, so pre-existing Skills that predate these
 * conventions can still be fixed in place.
 */
export function validateSkillMdStandard(
  skillMd: string,
  dirName: string,
): string[] {
  const errors = validateSkillIdentity(skillMd, dirName);
  if (!skillMd.trim().startsWith('---')) return errors;

  const fmName = extractSkillFrontmatterValue(skillMd, 'name');
  const fmDescription = extractSkillFrontmatterValue(skillMd, 'description');

  if (fmName && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fmName)) {
    errors.push(`frontmatter name "${fmName}" 不是小写英文 kebab-case`);
  }
  if (fmName && /\b(claude|anthropic)\b/i.test(fmName)) {
    errors.push(
      `frontmatter name "${fmName}" 包含保留词（claude / anthropic）`,
    );
  }
  if (fmName && dirName !== fmName) {
    errors.push(`dirName "${dirName}" 与 frontmatter name "${fmName}" 不一致`);
  }

  const triggerPattern =
    /(当|如果|用于|适合|场景|触发|调用|需要|情况|针对|遇到|面对|出现|用户|输入|请求|问题|任务|例如|\bwhen\b|\bwhenever\b|\bif\b|\bfor\b|\buse(?:d|s|ing)?\b|\buser\b|\brequest\b|\binput\b|\btask\b|\bworkflow\b|\bscenario\b|\btrigger\b)/i;
  if (fmDescription && !triggerPattern.test(fmDescription)) {
    errors.push('frontmatter description 应说明 skill 的触发场景（什么时候使用）');
  }

  const body = skillMd.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '').trim();
  if (body.length < 200) {
    errors.push('SKILL.md 正文过短（<200 字符），请补充详细说明');
  }
  for (const section of [
    'Instructions',
    'Workflow',
    'Output Format',
    'Examples',
    'Common Issues',
  ]) {
    if (!new RegExp(`^##?\\s*${section}`, 'im').test(body)) {
      errors.push(`正文缺少必要章节：${section}`);
    }
  }
  return errors;
}
