import { expect, test } from '@playwright/test';
import { e2eSkipReason, hasE2ECredentials, login } from './helpers';

test.skip(!hasE2ECredentials(), e2eSkipReason);

test('登录后首页显示三个创建入口', async ({ page }) => {
  await login(page);

  await expect(page.getByRole('button', { name: /材料提炼/ })).toBeVisible();
  await expect(
    page.getByRole('button', { name: /结构视图\s*适合专家/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /工作流\s*按需编排/ }),
  ).toBeVisible();
});

test('输入初二数学需求推荐初中数学8年级课例包', async ({ page }) => {
  await login(page);

  await page.getByLabel('描述你的教学需求').fill('初二数学课例的提问链分析');
  await expect(page.getByText('初中数学8年级课例包').first()).toBeVisible();
});

test('仓库显示预置课例包与跨场景 Agent', async ({ page }) => {
  await login(page);

  await page.goto('/agents?tab=skills');
  const skillSearch = page.getByPlaceholder('搜索名称或描述');
  await skillSearch.fill('初中数学8年级课例包');
  await expect(page.getByText('初中数学8年级课例包').first()).toBeVisible();

  await skillSearch.fill('ASR 课例清洗');
  await expect(page.getByText('ASR 课例清洗').first()).toBeVisible();

  await page.goto('/agents');
  const agentSearch = page.getByPlaceholder('搜索名称或描述');
  await agentSearch.fill('单元整体教学设计师');
  await expect(page.getByText('单元整体教学设计师').first()).toBeVisible();

  await agentSearch.fill('学情诊断师');
  await expect(page.getByText('学情诊断师').first()).toBeVisible();
});

test('工作流 Skill 节点可以选择仓库课例包', async ({ page }) => {
  await login(page);

  await page.getByRole('button', { name: /工作流\s*按需编排/ }).click();
  await expect(page.getByText('调用 Skill')).toBeVisible();

  await page
    .getByRole('button', { name: /调用 Skill/ })
    .first()
    .click();

  const skillNode = page
    .locator('.react-flow__node')
    .filter({ hasText: '调用 Skill' });
  await expect(skillNode).toBeVisible();
  await skillNode.click();

  await expect(page.getByText('调用的 Skill')).toBeVisible();

  const select = page.locator('#workflow-skill-select');
  await expect(select).toBeVisible();
  await expect(
    select.locator('option', { hasText: '初中数学8年级课例包' }),
  ).toHaveCount(1);
});
