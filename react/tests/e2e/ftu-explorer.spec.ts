import { expect, test } from "@playwright/test";
import {
  filterErrorsContaining,
  getCollectedErrors,
  installErrorInstrumentation,
} from "./utils/errorInstrumentation";

test("FTU Explorer page loads illustration component", async ({ page }) => {
  await installErrorInstrumentation(page);

  await page.goto("/#/ftu");

  // Check for the custom element (might be hidden if script not loaded, but should be attached)
  const ftuElement = page.locator("hra-medical-illustration");
  await expect(ftuElement).toBeAttached();

  // Check for expand button
  const expandBtn = page.locator("button.expand-button");
  await expect(expandBtn).toBeVisible();
  await expect(expandBtn).toHaveAttribute("title", "Expand");

  // Click expand
  await expandBtn.click();
  await expect(expandBtn).toHaveAttribute("title", "Collapse");
  await expect(page.locator(".ftu-container")).toHaveClass(/fullscreen/);

  // Click collapse
  await expandBtn.click();
  await expect(expandBtn).toHaveAttribute("title", "Expand");
  await expect(page.locator(".ftu-container")).not.toHaveClass(/fullscreen/);

  // Verify no critical errors occurred
  const errors = await getCollectedErrors(page);
  expect(filterErrorsContaining(errors, "split").length).toBe(0);
  expect(filterErrorsContaining(errors, "import.meta").length).toBe(0);
});

test("FTU web component script loads without module errors", async ({ page }) => {
  const consoleErrors: string[] = [];

  // Collect console errors before navigation
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });

  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });

  await page.goto("/#/ftu");

  // Wait for the web component to be defined
  await page.waitForFunction(() => {
    return customElements.get("hra-medical-illustration") !== undefined;
  }, { timeout: 10000 });

  // Verify no ES module errors
  const moduleErrors = consoleErrors.filter(
    (err) => err.includes("import.meta") || err.includes("Cannot use import")
  );
  expect(moduleErrors).toHaveLength(0);
});

test("FTU illustration container has valid dimensions", async ({ page }) => {
  await page.goto("/#/ftu");

  const ftuElement = page.locator("hra-medical-illustration");
  await expect(ftuElement).toBeAttached();

  // Verify the container has non-zero dimensions (catches CSS height issues)
  const boundingBox = await ftuElement.boundingBox();
  expect(boundingBox).not.toBeNull();
  expect(boundingBox?.height).toBeGreaterThan(0);
  expect(boundingBox?.width).toBeGreaterThan(0);
});
