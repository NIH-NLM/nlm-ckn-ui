import { defineConfig, devices } from "@playwright/test";

// Playwright config for CRA dev server on port 3000
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  fullyParallel: true,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "off",
    screenshot: "only-on-failure",
    video: "off",
  },
  webServer: [
    {
      command: "npm start",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        // Ensure CRA starts on 3000 without prompts
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
