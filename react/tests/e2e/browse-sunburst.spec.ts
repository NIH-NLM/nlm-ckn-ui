import { expect, test } from "@playwright/test";
import {
  filterErrorsContaining,
  getCollectedErrors,
  installErrorInstrumentation,
} from "./utils/errorInstrumentation";
import { hierarchyDeepChildren, hierarchyLabelsResponse, hierarchyRoot } from "./utils/testSeeds";

const mockRoot = hierarchyRoot({ children: hierarchyDeepChildren() });

test("Browse loads Sunburst visualization", async ({ page }) => {
  await installErrorInstrumentation(page);

  // Mock the CL hierarchy endpoints Browse's sunburst view fetches.
  await page.route("**/arango_api/hierarchy/labels/", async (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(hierarchyLabelsResponse),
    });
  });
  await page.route("**/arango_api/hierarchy/", async (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockRoot),
      });
    }
    return route.continue();
  });

  // Navigate -> Browse, then switch to the sunburst: Browse defaults to the
  // tree view.
  await page.goto("/");
  await page.getByRole("link", { name: "Browse" }).click();
  await expect(page).toHaveURL(/#\/browse$/);
  await page.getByRole("button", { name: /sunburst/i }).click();
  await expect(page).toHaveURL(/#\/browse\?view=sunburst$/);

  // SVG visible
  const svg = page.locator("#sunburst-container svg");
  await expect(svg).toBeVisible();

  // Has child path
  const childPath = page.locator('#sunburst-container svg path:not([fill="none"])').first();
  await expect(childPath).toBeVisible();

  // Click child (zoom) by clicking its label
  await page
    .locator("#sunburst-container svg text", { hasText: "A" })
    .first()
    .click({ force: true });

  // Grandchild label visible
  const visibleGrandchildLabel = page
    .locator(
      '#sunburst-container svg text:has-text("A1"), #sunburst-container svg text:has-text("B1")',
    )
    .first();
  await expect(visibleGrandchildLabel).toBeVisible();

  // Verify no "split of undefined" errors occurred
  expect(filterErrorsContaining(await getCollectedErrors(page), "split").length).toBe(0);
});
