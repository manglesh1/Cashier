// Playwright config for Cashier E2E smoke tests.
//
// Defaults assume:
//   - Cashier dev server on http://localhost:5173    (vite default)
//   - aeroSportsAdmin API on http://localhost:5171   (BOOKING_TEST_BASE_URL)
//
// Override via env vars when needed (e.g. CI):
//   CASHIER_BASE_URL, API_BASE_URL, CASHIER_EMAIL, CASHIER_PASSWORD,
//   CASHIER_LOCATION_ID
//
// Each test seeds its own fixtures via the API (no shared catalog
// state, no flaky DB cleanup between runs).
import { defineConfig, devices } from "@playwright/test";

const CASHIER_BASE_URL = process.env.CASHIER_BASE_URL || "http://localhost:5173";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: CASHIER_BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    viewport: { width: 1366, height: 900 },
    actionTimeout: 15_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
