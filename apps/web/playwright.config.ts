import { randomBytes } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Against a deployed dev branch, set E2E_BASE_URL and no local server starts.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `pnpm build && pnpm start --port ${port}`,
        url: `${baseURL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 240_000,
        // Throwaway, non-secret test values: sign-in is configured (so signed-out redirects work) but points nowhere.
        env: {
          APP_ENV: 'local',
          SUITE_URL: 'http://localhost:9',
          COGNITO_USER_POOL_ID: 'us-east-2_E2ETEST',
          COGNITO_CLIENT_ID: 'e2e-test-client',
          COGNITO_DOMAIN: 'e2e-test.auth.us-east-2.amazoncognito.com',
          SUITE_SESSION_SECRET: randomBytes(32).toString('base64url'),
        },
      },
});
