import { expect, test } from "@playwright/test";
import {
  filterErrorsContaining,
  getCollectedErrors,
  installErrorInstrumentation,
} from "./utils/errorInstrumentation";

test("About page loads and displays content", async ({ page }) => {
  await installErrorInstrumentation(page);

  await page.goto("/#/about");

  // Check title
  await expect(page.locator("h1.content-page-title")).toHaveText(
    "About the NLM Cell Knowledge Network",
  );

  // Check content text
  await expect(page.locator(".about-text-section")).toContainText(
    "National Library of Medicine (NLM) Cell Knowledge Network",
  );

  // Check schema image
  await expect(page.locator(".schema-image-actual")).toBeVisible();

  // Verify no "split of undefined" errors occurred
  expect(filterErrorsContaining(await getCollectedErrors(page), "split").length).toBe(0);
});
