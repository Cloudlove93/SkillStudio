#!/usr/bin/env node
/**
 * 预览环境关键链路冒烟检查。
 *
 * 用法：
 *   EDUCLAW_WEB_BASE=http://127.0.0.1:8081 \
 *   EDUCLAW_API_BASE=http://127.0.0.1:18081 \
 *   pnpm smoke:preview
 *
 * 说明：该脚本面向本地/预览环境，使用 x-user-id 访问仓库接口；
 * 生产环境应改用真实登录令牌。
 * 预期数量与当前预置资产基线一致；调整课例包或 Agent 数量时同步更新。
 */

const webBase = (
  process.env.EDUCLAW_WEB_BASE || 'http://127.0.0.1:8081'
).replace(/\/$/, '');
const apiBase = (
  process.env.EDUCLAW_API_BASE || 'http://127.0.0.1:18081'
).replace(/\/$/, '');
const userId = process.env.EDUCLAW_SEED_USER_ID || '395513060934025505';
const userHeaders = { 'x-user-id': userId };

function pass(message) {
  console.log(`PASS ${message}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
  pass(message);
}

async function getText(url, headers = {}) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`GET ${url} -> ${response.status}`);
  return response.text();
}

async function getJson(url, headers = {}) {
  return JSON.parse(await getText(url, headers));
}

async function listRepositorySkills() {
  const items = [];
  let cursor = null;
  do {
    const suffix = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
    const page = await getJson(
      `${apiBase}/api/skills/repository?limit=100${suffix}`,
      userHeaders,
    );
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

async function main() {
  const home = await fetch(`${webBase}/`);
  assert(home.ok, `首页可访问（${home.status}）`);

  const live = await getJson(`${apiBase}/livez`);
  assert(live.ok === true, '服务 livez 正常');

  const ready = await getJson(`${apiBase}/readyz`);
  assert(ready.ok === true, '服务 readyz 正常');

  const lessons = await getJson(`${webBase}/lessons/index.json`);
  assert(
    lessons.length === 1404,
    `课例索引为 1404 节（实际 ${lessons.length}）`,
  );

  const skills = await listRepositorySkills();
  assert(skills.length === 52, `仓库 Skill 为 52 个（实际 ${skills.length}）`);
  const lessonPacks = skills.filter((skill) =>
    skill.dirName.startsWith('lesson-pack-'),
  );
  assert(
    lessonPacks.length === 36,
    `课例包 Skill 为 36 个（实际 ${lessonPacks.length}）`,
  );
  const analysisSkills = skills.filter(
    (skill) => skill.packageName === '课堂分析方法集（预置）',
  );
  assert(
    analysisSkills.length === 14,
    `分析 Skill 为 14 个（实际 ${analysisSkills.length}）`,
  );
  assert(
    lessonPacks.every((skill) => skill.currentVersionNumber >= 2),
    '所有课例包 Skill 均指向当前版本 v2',
  );

  const agents = await getJson(`${apiBase}/api/agent-workspaces`, userHeaders);
  const agentNames = new Set(agents.map((agent) => agent.name));
  for (const name of [
    '小学语文教研 Agent',
    '初中数学教研 Agent',
    '高中英语教研 Agent',
    '单元整体教学设计师',
    '作业与评价设计师',
    '学情诊断师',
    '课例拆解师',
    '文本解读师',
    '思维链分析师',
    '课堂话语分析师',
  ]) {
    assert(agentNames.has(name), `Agent 存在：${name}`);
  }

  const packages = await getJson(`${apiBase}/api/packages`, userHeaders);
  for (const name of [
    '小学语数英课例包（预置）',
    '初中语数英课例包（预置）',
    '高中语数英课例包（预置）',
    '课堂分析方法集（预置）',
  ]) {
    assert(
      packages.some((pkg) => pkg.name === name),
      `预置包存在：${name}`,
    );
  }
  const primaryPack = packages.find(
    (pkg) => pkg.name === '小学语数英课例包（预置）',
  );
  assert(
    primaryPack && primaryPack.versionNumber >= 2,
    `课例容器版本已递增（实际 v${primaryPack?.versionNumber ?? '?'}）`,
  );

  console.log('smoke complete: preview key paths are healthy');
}

main().catch((error) => {
  console.error(
    `SMOKE FAILED: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
