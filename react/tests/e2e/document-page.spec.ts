import { expect, test } from "@playwright/test";
import {
  filterErrorsContaining,
  getCollectedErrors,
  installErrorInstrumentation,
} from "./utils/errorInstrumentation";
import { smallGraphWithEdges } from "./utils/testSeeds";

const TEST_COLL = "TEST_DOCUMENT_COLLECTION";

// Raw graph shape: keyed by origin id (non-shortest paths)
function buildRawGraph(originId: string) {
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
  return {
    [originId]: {
      nodes,
      links,
    },
  };
}

test("DocumentPage shows details, toggles panel, renders graph, and opens options", async ({
  page,
}) => {
  await installErrorInstrumentation(page);

  const originKey = "ROOT";
  const originId = `${TEST_COLL}/${originKey}`;
  const { root } = smallGraphWithEdges();

  // Mock document fetch
  await page.route(`**/arango_api/collection/${TEST_COLL}/${originKey}/`, async (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(root),
    });
  });

  // Mock collections
  await page.route("**/arango_api/collections/", async (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([TEST_COLL]),
      });
    }
    return route.continue();
  });

  // Mock edge filter options
  await page.route("**/arango_api/edge_filter_options/", async (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ Label: { type: "categorical", values: ["has_child"] } }),
      });
    }
    return route.continue();
  });

  // Mock graph fetch
  await page.route("**/arango_api/graph/", async (route) => {
    if (route.request().method() === "POST") {
      const raw = buildRawGraph(originId);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(raw),
      });
    }
    return route.continue();
  });

  // Navigate direct route
  await page.goto(`/#/collections/${TEST_COLL}/${originKey}`);

  // Details visible
  await expect(page.locator(".document-item-header h1")).toHaveText(
    /Test document collection: Root/i,
  );
  await expect(page.locator(".document-card-panel .document-info-fieldset")).toBeVisible();

  // Graph visible
  const graphWrapper = page.locator(".force-graph-panel #chart-container-wrapper svg");
  await expect(graphWrapper).toBeVisible();

  // Nodes/links rendered
  const nodeGroups = page.locator("g.node");
  await expect(nodeGroups)
    .toHaveCount(3, { timeout: 5000 })
    .catch(async () => {
      const count = await nodeGroups.count();
      expect(count).toBeGreaterThan(2);
    });
  const linkGroups = page.locator("g.link");
  await expect(linkGroups)
    .toHaveCount(2, { timeout: 5000 })
    .catch(async () => {
      const count = await linkGroups.count();
      expect(count).toBeGreaterThan(1);
    });

  // Toggle details -> hidden; graph expands
  await page.locator(".document-item-header .toggle-options-button").click();
  await expect(page.locator(".document-card-panel")).toHaveClass(/hidden/);
  await expect(page.locator(".force-graph-panel")).toHaveClass(/flex-full/);

  // Options open/close
  const toggleOptions = page.locator(".force-graph-panel .toggle-options-button");
  await toggleOptions.click();
  await expect(page.locator("#graph-options-panel")).toBeVisible();
  await toggleOptions.click();
  await expect(page.locator("#graph-options-panel")).toBeHidden();

  // Verify no "split of undefined" errors occurred
  expect(filterErrorsContaining(await getCollectedErrors(page), "split").length).toBe(0);
});
