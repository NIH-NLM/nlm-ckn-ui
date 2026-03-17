import { expect, test } from "@playwright/test";
import {
  filterErrorsContaining,
  getCollectedErrors,
  installErrorInstrumentation,
} from "./utils/errorInstrumentation";
import { smallGraphWithEdges } from "./utils/testSeeds";

const DOC_COLL = "TEST_DOCUMENT_COLLECTION";

function buildRaw(originId: string) {
  const { root, edges } = smallGraphWithEdges();
  const nodes = [
    root,
    ...(root.children || []),
    ...(root.children?.[0]?.children || []),
    ...(root.children?.[1]?.children || []),
  ];
  const links = edges.map((e, i) => ({
    ...e,
    _key: `${e._from.split("/")[1]}-${e._to.split("/")[1]}-${i}`,
  }));
  return { [originId]: { nodes, links } };
}

test("Numeric edge filters render sliders; categorical render dropdowns", async ({ page }) => {
  await installErrorInstrumentation(page);

  const originId = `${DOC_COLL}/ROOT`;

  await page.route("**/arango_api/collections/", async (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([DOC_COLL]),
      });
    }
    return route.continue();
  });

  // Return both numeric and categorical filter options
  await page.route("**/arango_api/edge_filter_options/", async (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          Label: { type: "categorical", values: ["has_child", "path"] },
          F_beta_confidence_score: { type: "numeric", min: 0, max: 1 },
        }),
      });
    }
    return route.continue();
  });

  await page.route("**/arango_api/graph/", async (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(buildRaw(originId)),
      });
    }
    return route.continue();
  });

  await page.route("**/arango_api/document/details", async (route) => {
    if (route.request().method() === "POST") {
      const req = await route.request().postDataJSON();
      const ids: string[] = req.document_ids || [];
      const results = ids.map((id) => ({ _id: id, label: id.split("/")[1] }));
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(results),
      });
    }
    return route.continue();
  });

  await page.addInitScript((origin) => {
    const persistedRoot = {
      nodesSlice: JSON.stringify({ originNodeIds: [origin] }),
      savedGraphs: JSON.stringify({ graphs: [] }),
      _persist: JSON.stringify({ version: -1, rehydrated: true }),
      // biome-ignore lint/suspicious/noExplicitAny: mock store
    } as any;
    localStorage.setItem("persist:root", JSON.stringify(persistedRoot));
  }, originId);

  await page.goto("/#/graph");
  const generateBtn = page.getByRole("button", { name: /Generate Graph|Update Graph/i });
  await expect(generateBtn).toBeVisible();
  await generateBtn.click();
  const svg = page.locator("#chart-container-wrapper svg");
  await expect(svg).toBeVisible();

  // Open options panel and Filters tab
  const toggleOptions = page.locator(".graph-component-wrapper .toggle-options-button");
  await toggleOptions.click();
  await expect(page.locator("#graph-options-panel")).toBeVisible();
  const filtersTab = page.getByRole("button", { name: "Filters" });
  await filtersTab.click();

  // Verify categorical filter renders as a dropdown
  const labelDropdown = page.locator('input[placeholder="Filter by Label..."]');
  await expect(labelDropdown).toBeVisible();

  // Verify numeric filter renders as a range slider (rc-slider)
  const sliderContainer = page.locator(".range-slider-filter");
  await expect(sliderContainer).toBeVisible();
  await expect(sliderContainer.locator(".range-slider-label")).toHaveText(
    "F_beta_confidence_score",
  );
  await expect(sliderContainer.locator(".rc-slider")).toBeVisible();

  // Verify numeric inputs are present with correct min/max
  const minInput = sliderContainer.locator('input[aria-label="F_beta_confidence_score minimum"]');
  const maxInput = sliderContainer.locator('input[aria-label="F_beta_confidence_score maximum"]');
  await expect(minInput).toBeVisible();
  await expect(maxInput).toBeVisible();

  // Verify no runtime errors
  expect(filterErrorsContaining(await getCollectedErrors(page), "split").length).toBe(0);
});

test("Adjusting numeric slider sends range in graph request", async ({ page }) => {
  await installErrorInstrumentation(page);

  const originId = `${DOC_COLL}/ROOT`;
  // biome-ignore lint/suspicious/noExplicitAny: mock body
  const postedBodies: any[] = [];

  await page.route("**/arango_api/collections/", async (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([DOC_COLL]),
      });
    }
    return route.continue();
  });

  await page.route("**/arango_api/edge_filter_options/", async (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          Label: { type: "categorical", values: ["has_child"] },
          F_beta_confidence_score: { type: "numeric", min: 0, max: 1 },
        }),
      });
    }
    return route.continue();
  });

  await page.route("**/arango_api/graph/", async (route) => {
    if (route.request().method() === "POST") {
      const body = await route.request().postDataJSON();
      postedBodies.push(body);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(buildRaw(originId)),
      });
    }
    return route.continue();
  });

  await page.route("**/arango_api/document/details", async (route) => {
    if (route.request().method() === "POST") {
      const req = await route.request().postDataJSON();
      const ids: string[] = req.document_ids || [];
      const results = ids.map((id) => ({ _id: id, label: id.split("/")[1] }));
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(results),
      });
    }
    return route.continue();
  });

  await page.addInitScript((origin) => {
    const persistedRoot = {
      nodesSlice: JSON.stringify({ originNodeIds: [origin] }),
      savedGraphs: JSON.stringify({ graphs: [] }),
      _persist: JSON.stringify({ version: -1, rehydrated: true }),
      // biome-ignore lint/suspicious/noExplicitAny: mock store
    } as any;
    localStorage.setItem("persist:root", JSON.stringify(persistedRoot));
  }, originId);

  await page.goto("/#/graph");
  const generateBtn = page.getByRole("button", { name: /Generate Graph|Update Graph/i });
  await expect(generateBtn).toBeVisible();
  await generateBtn.click();
  await expect(page.locator("#chart-container-wrapper svg")).toBeVisible();

  // Open Filters tab
  const toggleOptions = page.locator(".graph-component-wrapper .toggle-options-button");
  await toggleOptions.click();
  const filtersTab = page.getByRole("button", { name: "Filters" });
  await filtersTab.click();

  // Type a new minimum into the numeric input
  const sliderContainer = page.locator(".range-slider-filter");
  await expect(sliderContainer).toBeVisible();
  const minInput = sliderContainer.locator('input[aria-label="F_beta_confidence_score minimum"]');
  await minInput.fill("0.5");

  // Wait for debounce
  await page.waitForTimeout(300);

  // Regenerate graph
  postedBodies.length = 0;
  await generateBtn.click();

  // Verify the request includes a numeric range filter (dict, not array)
  const found = postedBodies.some(
    (b) =>
      b?.edge_filters?.F_beta_confidence_score &&
      typeof b.edge_filters.F_beta_confidence_score === "object" &&
      !Array.isArray(b.edge_filters.F_beta_confidence_score) &&
      b.edge_filters.F_beta_confidence_score.min === 0.5,
  );
  expect(found).toBe(true);

  expect(filterErrorsContaining(await getCollectedErrors(page), "split").length).toBe(0);
});
