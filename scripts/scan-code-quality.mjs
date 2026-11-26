import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const phase = process.argv[2];
if (!['before', 'after'].includes(phase)) {
  throw new Error('Usage: pnpm quality:scan before|after');
}
const output = resolve(root, 'docs/software/evidence/code-quality', phase);
if (phase === 'before' && existsSync(resolve(output, 'summary.json'))) {
  throw new Error(
    'The before baseline already exists. Preserve it; scan after for the current working tree.',
  );
}
mkdirSync(output, { recursive: true });
function run(args, cwd = root, allowed = [0]) {
  const result = spawnSync('pnpm', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error || !allowed.includes(result.status)) {
    throw new Error(
      `${args.join(' ')}\n${result.error || result.stderr || result.stdout}`,
    );
  }
  return result.stdout;
}
const projects = ['educlaw-server', 'educlaw-web'];
const targets = {
  'educlaw-server': [
    'src/services/workflow-service.ts',
    'src/services/package-service.ts',
    'src/services/guided-creation-service.ts',
  ],
  'educlaw-web': [
    'src/pages/WorkflowDemo.tsx',
    'src/components/skill-workspace/skill-conversation-list.ts',
  ],
};
const targetNames = new Set([
  'runWorkflow',
  'collectRubricBlock',
  'parseStagePhrasing',
  'parseEducationPhrasing',
  'isSkillConversationThread',
  'execute',
]);
let fileCount = 0;
const findings = [];
const targetComplexity = [];
const sourceHashes = {};
for (const project of projects) {
  const cwd = resolve(root, project);
  const reportPath = resolve(output, `${project}-eslint.json`);
  run(
    [
      'exec',
      'eslint',
      'src',
      '--ignore-pattern',
      '**/*.test.*',
      '--format',
      'json-with-metadata',
      '--output-file',
      reportPath,
      '--rule',
      'complexity:["warn",15]',
      '--rule',
      'max-depth:["warn",4]',
    ],
    cwd,
    [0, 1],
  );
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  // Keep the evidence portable; ESLint otherwise embeds machine-specific absolute paths.
  for (const item of report.results) {
    sourceHashes[relative(root, item.filePath).replaceAll('\\', '/')] =
      createHash('sha256').update(readFileSync(item.filePath)).digest('hex');
    item.filePath = relative(root, item.filePath).replaceAll('\\', '/');
    delete item.source;
    delete item.suppressedMessages;
    for (const message of item.messages) {
      findings.push({
        file: item.filePath,
        line: message.line,
        rule: message.ruleId,
        severity: message.severity,
        type: report.metadata.rulesMeta[message.ruleId]?.type ?? 'problem',
        message: message.message,
      });
    }
  }
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  fileCount += report.results.length;
  const targeted = JSON.parse(
    run(
      [
        'exec',
        'eslint',
        ...targets[project],
        '--format',
        'json',
        '--rule',
        'complexity:["warn",0]',
      ],
      cwd,
      [0, 1],
    ),
  );
  for (const item of targeted) {
    for (const message of item.messages) {
      if (message.ruleId !== 'complexity') continue;
      const match = message.message.match(
        /(?:function|Function) '([^']+)' has a complexity of (\d+)/,
      );
      if (match && targetNames.has(match[1]))
        targetComplexity.push({
          file: relative(root, item.filePath),
          function: match[1],
          complexity: Number(match[2]),
        });
    }
  }
}
const duplicatePath = resolve(output, 'jscpd-report.json');
run([
  'exec',
  'jscpd',
  'educlaw-server/src',
  'educlaw-web/src',
  '--format',
  'typescript,tsx',
  '--min-lines',
  '5',
  '--min-tokens',
  '70',
  '--ignore',
  '**/*.test.*,**/dist/**,**/node_modules/**',
  '--reporters',
  'json',
  '--output',
  output,
  '--silent',
]);
const duplication = JSON.parse(readFileSync(duplicatePath, 'utf8'));
for (const duplicate of duplication.duplicates) {
  for (const side of ['firstFile', 'secondFile']) {
    const name = duplicate[side].name;
    duplicate[side].name = name.startsWith(root)
      ? relative(root, name).replaceAll('\\', '/')
      : name;
  }
}
writeFileSync(duplicatePath, JSON.stringify(duplication, null, 2) + '\n');
const summary = {
  phase,
  scannedAt: new Date().toISOString(),
  baseCommit: spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).stdout.trim(),
  tools: {
    eslint: run([
      '--filter',
      'educlaw-server',
      'exec',
      'eslint',
      '--version',
    ]).trim(),
    jscpd: '4.0.5',
  },
  scope:
    'educlaw-server/src + educlaw-web/src; exclude *.test.*; duplication scans TypeScript/TSX only',
  sourceHashes,
  fileCount,
  lintErrors: findings.filter((f) => f.severity === 2).length,
  bugIndicators: findings.filter((f) => f.type === 'problem').length,
  codeSmells: findings.filter((f) => f.type !== 'problem').length,
  complexityOver15: findings.filter((f) => f.rule === 'complexity').length,
  maxDepthOver4: findings.filter((f) => f.rule === 'max-depth').length,
  duplication: duplication.statistics.total,
  targetComplexity,
  findings,
};
writeFileSync(
  resolve(output, 'summary.json'),
  JSON.stringify(summary, null, 2) + '\n',
);
console.log(
  JSON.stringify(
    { ...summary, findings: undefined, duplication: summary.duplication },
    null,
    2,
  ),
);
