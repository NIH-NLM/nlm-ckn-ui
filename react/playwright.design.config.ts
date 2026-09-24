import { defineConfig, devices } from "@playwright/test";

// Design-fidelity checks: measure the served page against the values in the
// Figma frame, in every engine we support. Runs against a real backend with a
// loaded dataset, so it is not part of CI — point DESIGN_BASE_URL at a local
// Django server (default) or a deployed environment.
const viewport = { width: 1440, height: 1060 };

export default defineConfig({
  testDir: "./tests/design",
  timeout: 60_000,
  reporter: [["list"], ["html", { outputFolder: "playwright-report-design", open: "never" }]],
  use: {
    baseURL: process.env.DESIGN_BASE_URL ?? "http://localhost:8000",
    screenshot: "on",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport } },
    { name: "webkit", use: { ...devices["Desktop Safari"], viewport } },
    { name: "firefox", use: { ...devices["Desktop Firefox"], viewport } },
  ],
});
