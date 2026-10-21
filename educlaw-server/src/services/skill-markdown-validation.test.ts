import { describe, expect, it } from 'vitest';
import {
  extractSkillFrontmatterValue,
  validateSkillIdentity,
  validateSkillMdStandard,
} from './skill-markdown-validation.js';

const legacyDoc = (name: string, description = 'Teaching procedure') =>
  `---\nname: ${name}\ndescription: ${description}\n---\n# Steps\nUse the rule.`;

describe('skill markdown identity validation', () => {
  it('accepts a legacy document whose frontmatter name is a Chinese display name', () => {
    // Pre-existing Skills commonly use a display name here, so the structural
    // gate must not block repairing them.
    expect(validateSkillIdentity(legacyDoc('作文批改与反馈'), 'essay-review')).toEqual([]);
  });

  it('accepts a frontmatter name that differs from the directory slug', () => {
    expect(validateSkillIdentity(legacyDoc('renamed'), 'essay-review')).toEqual([]);
  });

  it('stops at a missing frontmatter block', () => {
    expect(validateSkillIdentity('# No frontmatter', 'x')).toEqual([
      'SKILL.md 必须以 YAML frontmatter（---）开头',
    ]);
  });

  it('requires a name and a description', () => {
    expect(validateSkillIdentity('---\ndescription: When used\n---\n# Body', 'x')).toContain(
      'YAML frontmatter 缺少 name 字段',
    );
    expect(validateSkillIdentity('---\nname: demo\n---\n# Body', 'demo')).toContain(
      'YAML frontmatter 缺少 description 字段',
    );
  });

  it('rejects an over long or angle-bracket description', () => {
    expect(
      validateSkillIdentity(legacyDoc('demo', 'x'.repeat(201)), 'demo').some((error) =>
        error.includes('description 过长'),
      ),
    ).toBe(true);
    expect(validateSkillIdentity(legacyDoc('demo', 'When <tag> is used'), 'demo')).toContain(
      'frontmatter description 不应包含 XML 尖括号',
    );
  });
});

describe('skill markdown standard validation', () => {
  it('keeps the directory and naming conventions', () => {
    expect(validateSkillMdStandard(legacyDoc('renamed'), 'essay-review')).toContain(
      'dirName "essay-review" 与 frontmatter name "renamed" 不一致',
    );
    expect(validateSkillMdStandard(legacyDoc('Not Kebab'), 'Not Kebab')).toContain(
      'frontmatter name "Not Kebab" 不是小写英文 kebab-case',
    );
    expect(validateSkillMdStandard(legacyDoc('claude-helper'), 'claude-helper')).toContain(
      'frontmatter name "claude-helper" 包含保留词（claude / anthropic）',
    );
  });

  it('adds quality errors for a legacy document that satisfies identity', () => {
    const errors = validateSkillMdStandard(legacyDoc('essay-review'), 'essay-review');
    expect(errors.some((error) => error.includes('正文缺少必要章节'))).toBe(true);
    expect(errors.some((error) => error.includes('正文过短'))).toBe(true);
    // Identity itself passes, which is what the legacy edit path relies on.
    expect(validateSkillIdentity(legacyDoc('essay-review'), 'essay-review')).toEqual([]);
  });

  it('reads a frontmatter value without quotes', () => {
    expect(
      extractSkillFrontmatterValue(`---\nname: "demo"\ndescription: "When to use"\n---\n`, 'description'),
    ).toBe('When to use');
  });
});
