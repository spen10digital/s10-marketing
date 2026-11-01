import { expect, test } from '@playwright/test';

test('health endpoint responds without touching the database', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(typeof body.version).toBe('string');
});

test('root redirects to the placeholder dashboard', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('S10/Marketing').first()).toBeVisible();
});
