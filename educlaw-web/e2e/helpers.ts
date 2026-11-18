import { expect, type Page } from '@playwright/test';

export function hasE2ECredentials() {
  return Boolean(process.env.E2E_USERNAME && process.env.E2E_PASSWORD);
}

export async function login(page: Page) {
  await page.goto('/');
  await page.waitForURL(/\/login/);

  await page.getByLabel('邮箱').fill(process.env.E2E_USERNAME!);
  await page.getByLabel('密码').fill(process.env.E2E_PASSWORD!);
  await page.locator('form').getByRole('button', { name: '登录' }).click();

  await page.waitForURL('/');
  await expect(page.getByText('材料提炼')).toBeVisible();
}

export const e2eSkipReason =
  'set E2E_USERNAME and E2E_PASSWORD to run browser E2E';
