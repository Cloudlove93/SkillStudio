import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

// Run against Vite. All business requests are intercepted with isolated fixtures.
const { values } = parseArgs({
  options: { playwright: { type: 'string' }, browsers: { type: 'string' } },
});
if (values.browsers) process.env.PLAYWRIGHT_BROWSERS_PATH = values.browsers;
const { chromium } = await import(
  values.playwright || process.env.PLAYWRIGHT_MODULE || 'playwright'
);
const base = process.env.ASSET_CENTER_URL || 'http://127.0.0.1:5174';
const evidence = fileURLToPath(
  new URL('../../docs/acceptance/evidence/p1-asset-center/', import.meta.url),
);
await mkdir(evidence, { recursive: true });
const timestamp = '2026-11-09T01:00:00.000Z';
const skill = {
  id: '21',
  packageId: '8',
  name: '分层阅读',
  description: '依据学习目标设计阅读活动、提问与评价。',
  skillUid: 'reading',
  dirName: 'reading',
  packageName: '语文教学工具',
  packageDescription: '',
  updatedAt: timestamp,
  currentVersionId: '210',
  currentVersionNumber: 2,
  latestVersionId: '210',
  latestVersionNumber: 2,
};
const binding = {
  skillId: '99',
  packageId: '1',
  skillVersionId: '991',
  enabled: true,
  available: true,
  name: skill.name,
  description: skill.description,
  versionNumber: 1,
};
let agent = {
  id: '1',
  name: '阅读教学助手',
  description: '从学情分析到课堂活动，协助教师规划一节阅读课。',
  model: 'teaching-model',
  instructions: '先确认学段与学习目标，再设计教学活动。',
  skills: [binding],
  currentVersion: '10',
  sourceSessionId: '55',
  createdAt: timestamp,
  updatedAt: timestamp,
};
const otherAgents = Array.from({ length: 13 }, (_, index) => ({
  ...agent,
  id: String(index + 2),
  name:
    ['数学探究助手', '写作反馈助手', '课堂评价助手'][index % 3] +
    ` ${index + 1}`,
  skills: index % 3 === 0 ? [] : [binding],
  currentVersion: String(20 + index),
}));
const thread = {
  id: 91,
  packageId: 1,
  title: '设计一节阅读课',
  model: agent.model,
  arenaKind: 'skill_arena',
  basePackageVersionId: '10',
  createdAt: timestamp,
  updatedAt: timestamp,
  skillArenaConfig: {
    mode: 'skill_arena',
    compositionMode: 'skill_only',
    surface: 'run',
    basePackageVersionId: '10',
    left: null,
    right: {
      side: 'right',
      skillId: '99',
      skillVersionId: '991',
      skillUid: 'reading',
      skillName: skill.name,
      versionNumber: 1,
    },
    agentExecution: {
      agentId: '1',
      name: agent.name,
      instructions: '历史固定指令',
      model: agent.model,
      skills: [
        {
          ...binding,
          packageVersionId: '10',
          skillUid: 'reading',
          skillMd: '# 固定阅读方法\n\n先阅读，再讨论。',
        },
      ],
    },
  },
};
const skillVersion = (id, skillId, packageId) => ({
  id,
  skillId,
  packageId,
  versionNumber: id === '991' ? 1 : 2,
  source: 'manual',
  status: 'active',
  createdAt: timestamp,
  createdInPackageVersionId: '10',
  skill: {
    id: 'reading',
    dirName: 'reading',
    name: skill.name,
    description: skill.description,
    skillMd:
      '# 分层阅读\n\n1. 确认学习目标\n2. 分组阅读与讨论\n3. 记录学习反馈',
  },
});
const checks = [];
const contrastChecks = [];
const errors = [];
const unknownRequests = [];
let conflictNext = false;
let sent = 0;
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: 'zh-CN',
    reducedMotion: 'reduce',
  });
  await context.addInitScript(() =>
    localStorage.setItem('access_token', 'p1-fixture-token'),
  );
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const json = (value, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(value),
      });
    if (path === '/auth/me')
      return json({ id: 'fixture-user', username: 'P1 浏览器验收' });
    if (path === '/api/skills/repository')
      return json({ items: [skill], nextCursor: null });
    if (path === '/api/agent-workspaces') return json([agent, ...otherAgents]);
    if (path.match(/^\/api\/agent-workspaces\/\d+\/conversations$/))
      return json([thread]);
    if (path === '/api/agent-workspaces/1') {
      if (request.method() === 'PUT') {
        if (conflictNext) {
          conflictNext = false;
          return json(
            { error: '配置已被另一位编辑者更新，请重新加载后重试。' },
            409,
          );
        }
        const input = request.postDataJSON();
        assert.equal(input.expectedUpdatedAt, agent.updatedAt);
        agent = {
          ...agent,
          ...input,
          updatedAt: new Date(Date.parse(agent.updatedAt) + 1000).toISOString(),
          skills: input.skills.map((item) => ({ ...binding, ...item })),
        };
      }
      return json(agent);
    }
    if (path === '/api/packages/1/versions')
      return json([
        {
          id: 10,
          versionNumber: 1,
          source: 'manual',
          note: '初始教学配置',
          createdAt: timestamp,
          snapshot: {
            agentMd: agent.instructions,
            skills: [{ id: 'reading', name: skill.name, enabled: true }],
          },
        },
      ]);
    if (path === '/api') {
      const { action, pkgId, payload } = request.postDataJSON();
      const id = pkgId === '1' ? '99' : '21';
      const version = pkgId === '1' ? '991' : '210';
      if (action === 'skill.list')
        return json({ data: [{ ...skill, id, packageId: pkgId }] });
      if (action === 'skill.version.list')
        return json({
          data: {
            items: [skillVersion(version, id, pkgId)],
            nextCursor: null,
            currentVersionId: version,
            currentPackageVersionId: '10',
          },
        });
      if (action === 'skill.version.detail')
        return json({ data: skillVersion(payload.versionId, id, pkgId) });
    }
    if (path === '/api/arena/threads/91/runs') {
      if (request.method() === 'GET')
        return json({ detail: { ...thread, thread, messages: [] }, run: null });
      sent++;
      const content = request.postDataJSON().content;
      return json({
        runId: 'fixture-run',
        threadId: '91',
        revision: 1,
        status: 'succeeded',
        shared: { id: 1, threadId: 91, side: 'shared', role: 'user', content },
        messages: [
          {
            id: 2,
            threadId: 91,
            side: 'enhanced',
            role: 'assistant',
            content: '模拟回答已完成，请先确定学生的阅读目标。',
          },
        ],
        content: '',
        reasoningContent: '',
        thinkingRequested: false,
        thinkingEnabled: false,
      });
    }
    if (path === '/__p1-result') {
      const session = {
        package_id: '1',
        skill_id: '99',
        draft: {},
        generatedAgent: {
          ...agent,
          packageVersionId: '10',
          skills: [
            { id: '99', name: skill.name, description: skill.description },
          ],
        },
      };
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>P1 生成结果组件验收</title></head><body><div id="root"></div><script type="module">
        import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (type) => type; window.__vite_plugin_react_preamble_installed__ = true;
        const {default: React} = await import('/node_modules/.vite/deps/react.js');
        const {default: ReactDOM} = await import('/node_modules/.vite/deps/react-dom_client.js');
        await import('/src/index.css'); await import('/src/components/skill-workspace/skill-workspace.css');
        const {GeneratedAgentResult} = await import('/src/components/skill-workspace/GeneratedAgentResult.tsx');
        ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(GeneratedAgentResult, {session:${JSON.stringify(session)},onOpenAgent:()=>location.assign('/agents?agentId=1&autochat=1'),onOpenSkill:()=>location.assign('/agents?tab=skills&previewPackage=1&previewSkill=99&skillVersion=991')}));
      </script></body></html>`,
      });
    }
    if (path.startsWith('/api') || path.startsWith('/auth')) {
      unknownRequests.push(`${request.method()} ${path}`);
      return json({ error: 'Unmocked request' }, 500);
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => {
    errors.push(error.message);
    console.error(error.message);
  });
  const record = (name) => {
    checks.push({ name, passed: true });
    console.log(`通过 ${name}`);
  };
  const screenshot = (name) =>
    page.screenshot({ path: `${evidence}${name}.png`, fullPage: true });
  const noOverflow = async () =>
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
  const checkContrast = async (theme) => {
    const ratios = await page.evaluate(() => {
      const context = document.createElement('canvas').getContext('2d');
      const rgb = (color) => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        return [...context.getImageData(0, 0, 1, 1).data];
      };
      const luminance = (channels) =>
        channels
          .slice(0, 3)
          .map((channel) => {
            const value = channel / 255;
            return value <= 0.04045
              ? value / 12.92
              : ((value + 0.055) / 1.055) ** 2.4;
          })
          .reduce(
            (sum, value, index) =>
              sum + value * [0.2126, 0.7152, 0.0722][index],
            0,
          );
      const backdrop = rgb(
        getComputedStyle(document.querySelector('.asset-center'))
          .backgroundColor,
      );
      return [
        ['辅助文字', '.asset-kind', 'color', 4.5],
        ['主要按钮', '.asset-heading .asset-primary', 'color', 4.5],
        ['当前页签', '.asset-tabs [aria-selected=true]', 'color', 4.5],
        ['输入框边界', '.asset-search', 'borderTopColor', 3],
      ].map(([name, selector, property, minimum]) => {
        const style = getComputedStyle(document.querySelector(selector));
        const foreground = rgb(style[property]);
        const background = rgb(style.backgroundColor);
        const composite = (color, under) =>
          color.map((value, index) =>
            index === 3
              ? 255
              : (value * color[3]) / 255 + under[index] * (1 - color[3] / 255),
          );
        const bg = composite(background, backdrop);
        const fg = composite(foreground, bg);
        const lighter = Math.max(luminance(fg), luminance(bg));
        const darker = Math.min(luminance(fg), luminance(bg));
        return {
          name,
          ratio: Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2)),
          minimum,
        };
      });
    });
    for (const item of ratios)
      assert(item.ratio >= item.minimum, `${theme} ${item.name} ${item.ratio}`);
    contrastChecks.push({ theme, ratios });
  };
  await page.goto(`${base}/agents`);
  await page.getByText('共 14 项', { exact: true }).waitFor();
  assert.equal(await page.locator('.asset-card').count(), 12);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await page.getByText('第 2 / 2 页', { exact: true }).waitFor();
  assert.equal(await page.locator('.asset-card').count(), 2);
  await page.getByRole('button', { name: '上一页', exact: true }).click();
  await page.getByText('第 1 / 2 页', { exact: true }).waitFor();
  await page.getByRole('searchbox').fill('阅读');
  await page.getByLabel('资产状态', { exact: true }).selectOption('ready');
  await page.getByLabel('排序方式', { exact: true }).selectOption('name');
  await page
    .getByRole('tab', { name: 'Agent', exact: true })
    .press('ArrowRight');
  await page.locator('#assets-skills-tab[aria-selected=true]').waitFor();
  assert.equal(
    await page
      .getByRole('tab', { name: 'Skill', exact: true })
      .evaluate((element) => element === document.activeElement),
    true,
  );
  await page.getByRole('searchbox').fill('分层');
  await page.getByRole('tab', { name: 'Agent', exact: true }).click();
  await page.locator('#assets-agents-tab[aria-selected=true]').waitFor();
  assert.equal(await page.getByRole('searchbox').inputValue(), '阅读');
  assert.equal(
    await page.getByLabel('资产状态', { exact: true }).inputValue(),
    'ready',
  );
  await page.reload();
  assert.equal(await page.getByRole('searchbox').inputValue(), '阅读');
  record('双页签独立搜索、筛选、排序、分页及刷新恢复，方向键切换焦点');
  await page.getByRole('searchbox').fill('');
  await page.getByLabel('资产状态', { exact: true }).selectOption('all');
  await page.getByText('共 14 项', { exact: true }).waitFor();
  await noOverflow();
  await checkContrast('light');
  await screenshot('desktop-assets');
  await page.getByRole('searchbox').fill('阅读教学助手');
  await page.getByRole('button', { name: '阅读教学助手', exact: true }).click();
  await page.getByRole('region', { name: 'Agent 只读详情' }).waitFor();
  assert.equal(await page.locator('input, textarea').count(), 0);
  await screenshot('agent-overview');
  await page.getByText('版本记录', { exact: true }).click();
  await page.getByText('v1 ·', { exact: false }).first().waitFor();
  await page.getByRole('button', { name: '查看 Skill', exact: true }).click();
  await page.locator('pre').filter({ hasText: '分层阅读' }).waitFor();
  assert(page.url().includes('previewPackage=1'));
  assert(page.url().includes('skillVersion=991'));
  await screenshot('skill-detail');
  record('Agent 默认只读、版本记录、跨包 Skill 固定版本详情');
  await page.goto(`${base}/agents?agentId=1`);
  await page.getByRole('tab', { name: '编辑配置', exact: true }).click();
  await page.getByLabel('启用', { exact: true }).uncheck();
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await page.getByText('配置已保存', { exact: false }).waitFor();
  assert.equal(agent.skills[0].enabled, false);
  await page.reload();
  await page.getByRole('tab', { name: '编辑配置', exact: true }).click();
  assert.equal(
    await page.getByLabel('启用', { exact: true }).isChecked(),
    false,
  );
  record('停用 Skill 保存并刷新后保持停用，保存携带 expectedUpdatedAt');
  await page.setViewportSize({ width: 375, height: 812 });
  await noOverflow();
  await screenshot('mobile-editor');
  await page.setViewportSize({ width: 1440, height: 1000 });
  conflictNext = true;
  await page.getByLabel('Agent 名称', { exact: true }).fill('本地未保存名称');
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await page.getByRole('button', { name: '重新加载配置', exact: true }).click();
  await page.getByRole('alertdialog').waitFor();
  assert.equal(
    await page
      .getByRole('button', { name: '继续编辑', exact: true })
      .evaluate((element) => element === document.activeElement),
    true,
  );
  await page.keyboard.press('Shift+Tab');
  assert.equal(
    await page
      .getByRole('button', { name: '放弃并继续', exact: true })
      .evaluate((element) => element === document.activeElement),
    true,
  );
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('alertdialog').count(), 0);
  assert.equal(
    await page.getByLabel('Agent 名称', { exact: true }).inputValue(),
    '本地未保存名称',
  );
  await page.getByRole('button', { name: '重新加载配置', exact: true }).click();
  await page.getByRole('button', { name: '放弃并继续', exact: true }).click();
  await page.getByRole('region', { name: 'Agent 只读详情' }).waitFor();
  record('409 保留本地编辑，重新加载确认框焦点约束、Escape 取消及确认恢复');
  await page.goto(`${base}/skills?view=repository&skill=8%3A21`);
  await page.getByRole('region', { name: 'Skill 详情' }).waitFor();
  assert(new URL(page.url()).pathname === '/agents');
  await page.goto(`${base}/skills?agentId=1&conversation=91`);
  await page.getByLabel('输入教学任务', { exact: true }).waitFor();
  record('/skills 旧列表和 agentId/conversation 深链兼容');
  await page.setViewportSize({ width: 375, height: 812 });
  await noOverflow();
  assert.equal(
    await page
      .getByRole('complementary', { name: 'Agent 对话历史' })
      .isVisible(),
    false,
  );
  await page.getByRole('button', { name: '对话历史', exact: true }).click();
  assert.equal(
    await page
      .getByRole('complementary', { name: 'Agent 对话历史' })
      .isVisible(),
    true,
  );
  await page.getByRole('button', { name: /设计一节阅读课/ }).click();
  assert.equal(
    await page
      .getByRole('complementary', { name: 'Agent 对话历史' })
      .isVisible(),
    false,
  );
  const input = page.getByLabel('输入教学任务', { exact: true });
  await input.fill('阅读任务');
  await input.dispatchEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    isComposing: true,
  });
  assert.equal(sent, 0);
  await input.press('Shift+Enter');
  assert.equal(sent, 0);
  await input.press('Enter');
  await page
    .getByText('模拟回答已完成，请先确定学生的阅读目标。', { exact: false })
    .waitFor();
  assert.equal(sent, 1);
  await screenshot('mobile-conversation');
  record(
    '375px 对话历史折叠，输入法选词与 Shift+Enter 保留输入，Enter 发送一次',
  );
  await page.goto(`${base}/agents`);
  await page.getByText('共 14 项', { exact: true }).waitFor();
  await noOverflow();
  await screenshot('mobile-assets');
  await page.setViewportSize({ width: 768, height: 1024 });
  await noOverflow();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByTitle('切换到暗色模式').click();
  await page.locator('html.dark').waitFor();
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector('.asset-center'))
        .backgroundColor === 'rgb(17, 20, 42)',
  );
  await checkContrast('dark');
  await screenshot('dark-assets');
  record('375、768、1440px 无横向溢出，明暗主题可用');
  await page.goto(`${base}/__p1-result`);
  await page.getByRole('region', { name: '生成结果' }).waitFor();
  await page
    .getByRole('heading', { name: '阅读教学助手', exact: true })
    .waitFor();
  assert.equal(await page.locator('.asset-card').count(), 2);
  await screenshot('generated-result');
  await page
    .getByRole('button', { name: '进入 Agent 对话', exact: true })
    .click();
  await page.getByLabel('输入教学任务', { exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('conversation'), '91');
  assert.equal(new URL(page.url()).searchParams.has('autochat'), false);
  await page.goto(`${base}/__p1-result`);
  await page.getByRole('button', { name: '查看 Skill', exact: true }).click();
  await page.getByRole('region', { name: 'Skill 详情' }).waitFor();
  record('P3 生成结果组件复用 Agent/Skill 卡片并打开固定版本 Skill');
  assert.deepEqual(errors, []);
  assert.deepEqual(unknownRequests, []);
  await writeFile(
    `${evidence}browser-checks.json`,
    JSON.stringify(
      {
        fixture: true,
        database: false,
        modelCalls: false,
        checkedAt: new Date().toISOString(),
        checks,
        contrastChecks,
        errors,
        unknownRequests,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(JSON.stringify({ passed: checks.length, evidence }, null, 2));
} finally {
  await browser.close();
}
