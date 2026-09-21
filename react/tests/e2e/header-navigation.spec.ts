import { expect, test } from "@playwright/test";
import {
  filterErrorsContaining,
  getCollectedErrors,
  installErrorInstrumentation,
} from "./utils/errorInstrumentation";
import { hierarchyLabelsResponse, hierarchyRoot } from "./utils/testSeeds";

test("Header navigation links work correctly", async ({ page }) => {
  await installErrorInstrumentation(page);

  // Mock common APIs to prevent crashes/overlays
  await page.route("**/arango_api/collections/", async (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(["TEST_COLLECTION"]),
    });
  });
  await page.route("**/arango_api/edge_filter_options/", async (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ Label: { type: "categorical", values: ["has_child"] } }),
    });
  });
  await page.route("**/arango_api/graph/", async (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({}),
    });
  });
  await page.route("**/arango_api/document/details", async (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });
  await page.route("**/arango_api/hierarchy/labels/", async (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(hierarchyLabelsResponse),
    });
  });
  await page.route("**/arango_api/hierarchy/", async (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(hierarchyRoot({ label: "cell" })),
    });
  });

  await page.goto("/");

  // Check active state for Search
  await expect(page.locator('.navbar a[href="#/"] h4')).toHaveClass(/active-nav/);

  // Navigate to Browse -- the merged sunburst/tree page.
  await page.getByRole("link", { name: "Browse" }).click();
  await expect(page).toHaveURL(/#\/browse$/);
  await expect(page.locator('.navbar a[href="#/browse"] h4')).toHaveClass(/active-nav/);

  // Navigate to Collections
  await page.getByRole("link", { name: "Collections" }).click();
  await expect(page).toHaveURL(/#\/collections$/);
  await expect(page.locator('.navbar a[href="#/collections"] h4')).toHaveClass(/active-nav/);

  // Navigate to Graph
  await page.getByRole("link", { name: "Graph", exact: true }).click();
  await expect(page).toHaveURL(/#\/graph$/);
  await expect(page.locator('.navbar a[href="#/graph"] h4')).toHaveClass(/active-nav/);

  // Navigate to About
  await page.getByRole("link", { name: "About" }).click();
  await expect(page).toHaveURL(/#\/about$/);
  await expect(page.locator('.navbar a[href="#/about"] h4')).toHaveClass(/active-nav/);

  // Verify no "split of undefined" errors occurred
  expect(filterErrorsContaining(await getCollectedErrors(page), "split").length).toBe(0);
});

// The active nav item must be visually distinct, not merely carry the class.
// A bare `.active-nav` selector is (0,1,0) and loses to `.navbar h4` at (0,1,1),
// so the blue silently never applied while every class assertion above stayed
// green. Assert the resolved colour, which is the part users actually see.
test("Active nav item resolves to the primary blue", async ({ page }) => {
  const PRIMARY = "rgb(0, 113, 188)"; // --color-primary #0071bc
  const INACTIVE = "rgb(50, 58, 69)"; // --color-gray-dark #323a45

  await page.route("**/arango_api/**", async (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );

  await page.goto("/#/collections");
  const active = page.locator(".navbar a[href='#/collections'] h4");
  await expect(active).toHaveClass(/active-nav/);
  await expect(active).toHaveCSS("color", PRIMARY);

  // A neighbour stays gray, proving the rule is scoped rather than global.
  await expect(page.locator(".navbar a[href='#/about'] h4")).toHaveCSS("color", INACTIVE);

  // Frame IV distinguishes the active item by colour alone — same Medium weight.
  await expect(active).toHaveCSS("font-weight", "500");
});
