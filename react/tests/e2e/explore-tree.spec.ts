import { expect, test } from "@playwright/test";
import {
  filterErrorsContaining,
  getCollectedErrors,
  installErrorInstrumentation,
} from "./utils/errorInstrumentation";
import { hierarchyDeepChildren, hierarchyLabelsResponse, hierarchyRoot } from "./utils/testSeeds";

// Tree.js consumes the API response as the root directly (post lazy-load
// refactor). Children are inlined so the click handler hits the cached-
// children branch and never triggers a lazy fetch.
const mockApiResponse = hierarchyRoot({ label: "Root", children: hierarchyDeepChildren() });

test("Browse's tree view shows Root then expands to children", async ({ page }) => {
  await installErrorInstrumentation(page);

  // Mock the CL hierarchy endpoints for Browse's tree view.
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
        body: JSON.stringify(mockApiResponse),
      });
    }
    return route.continue();
  });

  // Navigate -> Browse, then toggle to the tree view -- Explore no longer
  // exists as a separate page; it merged into Browse (#245).
  await page.goto("/");
  await page.getByRole("link", { name: "Browse" }).click();
  await expect(page).toHaveURL(/#\/browse$/);
  await page.getByRole("button", { name: /tree/i }).click();

  // URL reflects the toggled view.
  await expect(page).toHaveURL(/#\/browse\?view=tree$/);

  // SVG visible
  const container = page.locator(".tree-constructor-container");
  const svg = container.locator("svg");
  await expect(svg).toBeVisible();

  // Expand root
  const rootNodeGroup = container.locator("g.node-group").first();
  await expect(rootNodeGroup).toBeVisible();
  await rootNodeGroup.click();

  // Children visible
  await expect(container.getByText("A").first()).toBeVisible();
  await expect(container.getByText("B").first()).toBeVisible();

  // Expand child
  const aNodeGroup = container.locator("g.node-group", { hasText: "A" }).first();
  await aNodeGroup.dispatchEvent("click");
  await expect(container.getByText("A1").first()).toBeVisible();

  // Verify no "split of undefined" errors occurred
  expect(filterErrorsContaining(await getCollectedErrors(page), "split").length).toBe(0);
});
