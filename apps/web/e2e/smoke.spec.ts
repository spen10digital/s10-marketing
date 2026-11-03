import { expect, test } from '@playwright/test';

test('health endpoint responds without touching the database', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(typeof body.version).toBe('string');
});

test('signed-out visitors are sent to sign in, keeping where they were going', async ({ request }) => {
  const res = await request.get('/dashboard', { maxRedirects: 0 });
  expect([303, 307]).toContain(res.status());
  expect(res.headers().location).toMatch(/\/api\/auth\/login\?returnTo=%2Fdashboard$/);
});

test('the signed-out page offers sign-in and sign-up', async ({ page }) => {
  await page.goto('/signed-out');
  await expect(page.getByText('S10/Marketing').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/api/auth/login');
  await expect(page.getByRole('link', { name: 'Create account' })).toHaveAttribute(
    'href',
    '/api/auth/login?screen=signup',
  );
});

test('the studio requires sign-in', async ({ request }) => {
  const res = await request.get('/studio', { maxRedirects: 0 });
  expect([303, 307]).toContain(res.status());
  expect(res.headers().location).toMatch(/\/api\/auth\/login\?returnTo=/);
});

test('the AI stream refuses cross-site and signed-out requests', async ({ request, baseURL }) => {
  const data = { brandSlug: 'x', request: { action: 'transform', input: { text: 'hi', op: 'shorten' } } };
  const noOrigin = await request.post('/api/ai/stream', { data });
  expect(noOrigin.status()).toBe(403);
  const otherSite = await request.post('/api/ai/stream', {
    data,
    headers: { origin: 'https://evil.example' },
  });
  expect(otherSite.status()).toBe(403);
  const signedOut = await request.post('/api/ai/stream', {
    data,
    headers: { origin: new URL(baseURL!).origin },
  });
  expect(signedOut.status()).toBe(401);
});

test('sign-out only accepts POST', async ({ request }) => {
  const res = await request.get('/api/auth/logout', { maxRedirects: 0 });
  expect(res.status()).toBe(405);
});

// Full flow against a deployed dev environment with a dedicated Cognito test user:
//   E2E_BASE_URL=https://… E2E_EMAIL=… E2E_PASSWORD=… pnpm test:e2e
test.describe('signed in (dev environment only)', () => {
  test.skip(!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD, 'needs E2E_EMAIL / E2E_PASSWORD');

  test('sign in → create organization if needed → create brand → save voice', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByLabel(/email/i).first().fill(process.env.E2E_EMAIL!);
    await page
      .getByRole('button', { name: /next|continue|sign in/i })
      .first()
      .click();
    const password = page.getByLabel(/password/i).first();
    await password.fill(process.env.E2E_PASSWORD!);
    await page
      .getByRole('button', { name: /sign in|continue/i })
      .first()
      .click();

    await page.waitForURL(/\/(dashboard|orgs\/new)/, { timeout: 60_000 });
    if (page.url().includes('/orgs/new')) {
      await page.getByLabel('Organization name').fill('E2E Org');
      await page.getByRole('button', { name: 'Create organization' }).click();
      await page.waitForURL(/\/dashboard/);
    }

    const name = `E2E Brand ${Date.now()}`;
    await page.goto('/brands/new');
    await page.getByLabel('Brand name').fill(name);
    await page.getByRole('button', { name: 'Create brand' }).click();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();

    await page.getByLabel('Tone').fill('friendly, concise');
    await page.getByRole('button', { name: 'Save new version' }).click();
    await expect(page.getByText('Voice saved as version 1.')).toBeVisible();
  });
});
