import { expect, test } from "@playwright/test";
import {
  filterErrorsContaining,
  getCollectedErrors,
  installErrorInstrumentation,
} from "./utils/errorInstrumentation";
import { deepChildren, doc, sunburstRoot } from "./utils/testSeeds";

const COLL = "TEST_DOCUMENT_COLLECTION";
const SEARCH_DOC = doc("S001", "Search Node");
const TREE_DOC = doc("T001", "Tree Node");

test("Graph page shows two selected nodes and builds graph with both origins", async ({ page }) => {
  await installErrorInstrumentation(page);

  // Mock search
  await page.route("**/arango_api/search/", async (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([SEARCH_DOC]),
      });
    }
    return route.continue();
  });

  // Mock tree (includes TREE_DOC)
  const mockTree = sunburstRoot({ children: [TREE_DOC, ...deepChildren()] });
  await page.route("**/arango_api/sunburst/", async (route) => {
    if (route.request().method() === "POST") {
      // Single root object
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockTree),
      });
    }
    return route.continue();
  });

  // Mock collections, edge filter options, graph
  await page.route("**/arango_api/collections/", async (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([COLL]),
      });
    }
    return route.continue();
  });
  await page.route("**/arango_api/edge_filter_options/", async (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ Label: ["has_child"] }),
      });
    }
    return route.continue();
  });
  // Mock document details
  await page.route("**/arango_api/document/details", async (route) => {
    if (route.request().method() === "POST") {
      const req = await route.request().postDataJSON();
      const ids: string[] = req.document_ids || [];
      const results = ids.map((id) => {
        if (id === SEARCH_DOC._id) return SEARCH_DOC;
        if (id === TREE_DOC._id) return TREE_DOC;
        return { _id: id, label: id.split("/")[1] };
      });
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(results),
      });
    }
    return route.continue();
  });
  await page.route("**/arango_api/graph/", async (route) => {
    if (route.request().method() === "POST") {
      // Minimal graph per origin id
      const req = await route.request().postDataJSON();
      const nodeIds: string[] = req.node_ids || [];
      // biome-ignore lint/suspicious/noExplicitAny: mock payload
      const payload: Record<string, { nodes: any[]; links: any[] }> = {};
      for (const id of nodeIds) {
        payload[id] = { nodes: [{ _id: id, label: id.split("/")[1] }], links: [] };
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(payload),
      });
    }
    return route.continue();
  });

  // Add from Search
  await page.goto("/");
  await page.getByPlaceholder("Search NCKN...").fill("sea");
  // Ensure result
  await expect(page.locator(".unified-search-results-list")).toContainText("Search Node");
  // Click add button
  await page
    .locator(
      ".unified-search-results-list .result-item-row-link .item-meta-actions .add-to-graph-button",
    )
    .click();

  // Add from Tree
  await page.getByRole("link", { name: "Explore" }).click();
  await expect(page).toHaveURL(/#\/tree$/);
  // Wait for portal add buttons
  const addButtons = page.locator(".add-to-graph-button");
  await addButtons.first().waitFor({ state: "visible" });
  // Click through buttons (order may vary)
  const btnCount = await addButtons.count();
  for (let i = 0; i < btnCount; i++) {
    await addButtons.nth(i).click();
  }

  // Open Graph
  await page.getByRole("link", { name: "Graph" }).click();
  await expect(page).toHaveURL(/#\/graph$/);
  // Selected items visible
  const selectedTable = page.locator(".selected-items-container");
  await selectedTable.waitFor({ state: "visible" });
  await expect(selectedTable).toContainText("Search Node");
  await expect(selectedTable).toContainText("Tree Node");

  // Verify no "split of undefined" errors occurred
  expect(filterErrorsContaining(await getCollectedErrors(page), "split").length).toBe(0);
});
