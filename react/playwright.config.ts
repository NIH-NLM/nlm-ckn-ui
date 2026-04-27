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
      // In CI: build once and serve the static bundle. The CRA dev server's
      // webpack-dev-server-client overlay iframe intercepts clicks on the
      // GitHub Actions runners (HMR websocket can't connect), so e2e times
      // out. The production build has no dev-server overlay.
      // Locally: keep `npm start` for fast HMR-friendly development.
      command: process.env.CI ? "npm run build-react && npx --no-install serve -s build -l 3000" : "npm start",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      // Pipe webServer output so build/serve failures are visible in CI logs
      // instead of hiding behind a generic "Process ... exit code 1" message.
      stdout: "pipe",
      stderr: "pipe",
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
