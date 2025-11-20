import { defineConfig, devices } from "@playwright/test";

// Artifacts-enabled config: same as base, but always record trace and video
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  fullyParallel: true,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on",
    screenshot: "only-on-failure",
    video: "on",
  },
  webServer: [
    {
      command: "npm start",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        BROWSER: "none",
        PORT: "3000",
      },
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
