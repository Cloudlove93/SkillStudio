import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../docs/software/evidence/code-quality',
);
const escape = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const before = JSON.parse(
  readFileSync(resolve(directory, 'before/summary.json'), 'utf8'),
);
for (const phase of ['before', 'after']) {
  const current = JSON.parse(
    readFileSync(resolve(directory, phase, 'summary.json'), 'utf8'),
  );
  const metrics = [
    ['Bug 指标（problem 类型诊断）', current.bugIndicators],
    ['Code Smell（其余规则诊断）', current.codeSmells],
    ['ESLint 错误', current.lintErrors],
    ['圈复杂度 > 15 的函数', current.complexityOver15],
    ['嵌套深度 > 4 的位置', current.maxDepthOver4],
    ['重复代码行占比', `${current.duplication.percentage}%`],
  ];
  const rows = current.targetComplexity
    .map((item) => {
      const previous = before.targetComplexity.find(
        (old) => old.file === item.file && old.function === item.function,
      );
      return `<tr><td><strong>${escape(item.function)}</strong><small>${escape(item.file)}</small></td><td>${previous.complexity}</td><td>${item.complexity}</td></tr>`;
    })
    .join('');
  const findings = current.findings.filter(
    (item) => item.severity === 2 || item.rule?.startsWith('react-hooks/'),
  );
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>SkillStudio 代码质量扫描 — ${phase}</title>
<style>
*{box-sizing:border-box}body{font:15px/1.55 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#17212b;background:#f3f5f7;margin:0;padding:34px 42px}main{max-width:1180px;margin:auto}h1{font-size:28px;margin:2px 0 6px}h2{font-size:18px;margin:22px 0 10px}p{margin:5px 0}.eyebrow{font-size:12px;letter-spacing:1px;color:#456377}.muted,small{color:#596773}small{display:block;font-size:11px}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:22px 0}.metric{background:white;border:1px solid #dce2e7;padding:13px 18px}.value{font-size:30px;font-weight:650;line-height:1.4}table{border-collapse:collapse;width:100%;background:white}th,td{text-align:left;border-bottom:1px solid #dce2e7;padding:9px 14px}th{font-size:12px;background:#e9eef2}td:nth-child(2),td:nth-child(3){width:100px;font-variant-numeric:tabular-nums}.note{margin-top:18px;border-left:3px solid #456377;padding-left:14px;font-size:12px}.finding{font-size:12px;margin:5px 0}a{color:#255a82}footer{font-size:11px;color:#596773;margin-top:18px}
</style><main>
<div class="eyebrow">SKILLSTUDIO / ESLINT + JSCPD / 实际扫描汇总</div>
<h1>${phase === 'before' ? '重构前扫描报告' : '重构后扫描报告'}</h1>
<p class="muted">ESLint ${escape(current.tools.eslint)} · jscpd ${escape(current.tools.jscpd)} · ${escape(new Date(current.scannedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }))}（北京时间）</p>
<p class="muted">范围：educlaw-server/src 与 educlaw-web/src；排除 *.test.*；ESLint ${current.fileCount} 个文件。</p>
<div class="metrics">${metrics.map(([label, value]) => `<div class="metric"><div class="muted">${escape(label)}</div><div class="value">${escape(value)}</div></div>`).join('')}</div>
<h2>本次重构相关函数的圈复杂度</h2>
<table><thead><tr><th>函数与源文件</th><th>重构前</th><th>${phase === 'before' ? '当前基线' : '重构后'}</th></tr></thead><tbody>${rows}</tbody></table>
<h2>现有 ESLint 规则中需要关注的诊断</h2>
${findings.map((item) => `<p class="finding">${escape(item.file)}:${item.line} · ${escape(item.rule)}<br>${escape(item.message)}</p>`).join('') || '<p class="muted">无错误和 Hooks 依赖诊断。</p>'}
<div class="note">指标口径：Bug 指标取 ESLint meta.type=problem 的诊断数，不表示已证实的业务 Bug；Code Smell 为其余规则诊断数（含复杂度与深度规则），不冒充 SonarQube 分类。重复检测最少 5 行、70 tokens；未达阈值的小重复不会计入。报告保留历史问题。</div>
<footer>基线提交 ${escape(current.baseCommit)} · 原始证据：<a href="summary.json">summary.json</a> / <a href="educlaw-server-eslint.json">后端 ESLint</a> / <a href="educlaw-web-eslint.json">前端 ESLint</a> / <a href="jscpd-report.json">jscpd</a></footer>
</main></html>`;
  writeFileSync(resolve(directory, phase, 'report.html'), html);
}
console.log('Saved before/report.html and after/report.html');
