#!/usr/bin/env node
/**
 * 轻量密钥扫描：只扫描 git 已跟踪的文本文件，避免把本地 .preview.env 等忽略文件带入。
 *
 * 用法：
 *   pnpm secret:check
 *
 * 说明：这是进入 gitleaks/Semgrep 之前的低成本门禁，不是完整 SAST。
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const root = process.cwd();
const files = execFileSync('git', ['ls-files', '-z'], {
  cwd: root,
  encoding: 'utf8',
})
  .split('\0')
  .filter(Boolean);

const binaryExtensions =
  /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|pdf|zip|gz|tar|mp3|mp4|mov|wav|map)$/i;

function shouldSkip(file) {
  return (
    file === '.env.example' ||
    file === 'pnpm-lock.yaml' ||
    file.endsWith('.md') ||
    file.startsWith('docs/') ||
    file.startsWith('auth-service/') ||
    file.startsWith('python/media_worker/tests/fixtures/') ||
    file.includes('/test-utils/') ||
    file.startsWith('test-utils/') ||
    file.startsWith('educlaw-web/public/lessons/') ||
    binaryExtensions.test(file) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(file)
  );
}

const patterns = [
  {
    name: 'OpenAI-style key',
    regex: /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    name: 'AWS access key',
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    name: 'private key block',
    regex: /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/g,
  },
  {
    name: 'assigned secret',
    regex:
      /\b(?:api[_-]?key|secret|password|token)\s*[:=]\s*['"]([A-Za-z0-9_\-./+=]{16,})['"]/gi,
    allow: (value) =>
      /your|replace|example|dummy|placeholder|test|local|change[-_]?me|x{6,}|\$\{/i.test(
        value,
      ),
  },
  {
    name: 'database URL with password',
    regex:
      /\b(?:postgres(?:ql)?|mysql|mongodb):\/\/[^:\s/]+:([^@\s/]{8,})@/gi,
    allow: (value) =>
      /\$\{/.test(value) ||
      /local|test|example|dummy|placeholder|change|educlaw|acceptance/i.test(
        value,
      ),
  },
];

function lineNumber(text, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (text[cursor] === '\n') line += 1;
  }
  return line;
}

function redact(value) {
  if (value.length <= 6) return '***';
  return `${value.slice(0, 4)}****${value.slice(-2)}`;
}

const findings = [];

for (const file of files) {
  if (shouldSkip(file)) continue;
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  if (text.includes('\0')) continue;
  if (text.length > 2_000_000) continue;

  for (const pattern of patterns) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    for (const match of text.matchAll(regex)) {
      const value = match[1] ?? match[0];
      if (pattern.allow?.(value)) continue;
      findings.push({
        file,
        line: lineNumber(text, match.index ?? 0),
        name: pattern.name,
        value: redact(value),
      });
    }
  }
}

if (findings.length === 0) {
  console.log('secret scan passed: no obvious secrets in tracked files');
  process.exit(0);
}

console.error(`secret scan failed: ${findings.length} potential secret(s) found`);
for (const finding of findings) {
  console.error(`- ${finding.file}:${finding.line} [${finding.name}] ${finding.value}`);
}
process.exit(1);
