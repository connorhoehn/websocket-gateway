import { defineConfig, devices } from '@playwright/test';

// Playwright E2E config.
//
// Scoped to `e2e/**/*.spec.ts` so it does not pick up vitest tests in
// `src/**/*.test.ts` (vitest owns those). The dev server is expected to be
// running on http://localhost:5174 (or PLAYWRIGHT_BASE_URL) — start it
// manually with `npm run dev` in a separate terminal, or rely on the
// webServer block below.

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts$/,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'line',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5174',
    headless: true,
    // We intentionally ignore HTTPS errors and do NOT wait for idle network —
    // the app fires WS + social-api requests at a non-running backend and
    // those connection errors are expected in this E2E environment.
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: 'chromium',
      // Use a wide viewport so the right-anchored slide-out panel (width 320–
      // 340 px) does not visually occlude the rightmost header buttons like
      // "Past Calls" / "Export". The real UI has the panel float above content
      // too, but at 1920px all header buttons remain clickable.
      use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 900 } },
    },
  ],
});
