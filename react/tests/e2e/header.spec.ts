import { expect, test } from "@playwright/test";

test("global header shows brand + search on a non-Search route", async ({ page }) => {
  await page.goto("/#/collections");
  // Brand
  await expect(page.getByAltText(/NLM Cell Knowledge Network logo/i)).toBeVisible();
  await expect(page.getByText("NLM Cell Knowledge Network")).toBeVisible();
  // Header search present and functional (dropdown opens on input)
  const search = page.getByPlaceholder("Search gene, tissue, cell set, publication...");
  await expect(search).toBeVisible();
  await search.click();
  await search.fill("lung");
  await expect(page.locator(".search-results-dropdown")).toHaveClass(/show/);
});
