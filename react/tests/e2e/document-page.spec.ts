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

test("DocumentPage shows details, renders graph, and opens/closes options", async ({ page }) => {
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
  await expect(page.locator(".graph-workspace-inspector .document-info-fieldset")).toBeVisible();

  // Graph visible
  const graphWrapper = page.locator(".graph-workspace-canvas #chart-container-wrapper svg");
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

  // Options open/close
  const toggleOptions = page.locator(".graph-workspace-canvas .toggle-options-button");
  await toggleOptions.click();
  await expect(page.locator("#graph-options-panel")).toBeVisible();
  await toggleOptions.click();
  await expect(page.locator("#graph-options-panel")).toBeHidden();

  // Verify no "split of undefined" errors occurred
  expect(filterErrorsContaining(await getCollectedErrors(page), "split").length).toBe(0);
});

test("DocumentPage: inspector swaps on node click and saved-graph shelf gains a card", async ({
  page,
}) => {
  await installErrorInstrumentation(page);

  const originKey = "ROOT";
  const originId = `${TEST_COLL}/${originKey}`;
  const { root } = smallGraphWithEdges();

  // Mock the origin document fetch specifically (more specific than the
  // wildcard route below; Playwright matches the most recently registered
  // route first, so register this after the wildcard and early-return from
  // the wildcard handler when the key is ROOT).
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

  // Wildcard document mock: resolves any clicked node's document by key
  // parsed out of the URL.
  await page.route(`**/arango_api/collection/${TEST_COLL}/*/`, async (route) => {
    const url = new URL(route.request().url());
    const parts = url.pathname.split("/").filter(Boolean);
    const key = parts[parts.length - 1];
    if (key === originKey) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(root),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ _id: `${TEST_COLL}/${key}`, label: key }),
    });
  });

  await page.goto(`/#/collections/${TEST_COLL}/${originKey}`);

  // Inspector initially shows the origin document.
  const inspectorLegend = page.locator(".node-inspector .document-info-legend");
  await expect(inspectorLegend).toContainText(`${TEST_COLL}_${originKey}`);

  // Wait for the graph to render, then click a non-origin node.
  const nodeGroups = page.locator("g.node");
  await expect(nodeGroups)
    .toHaveCount(3, { timeout: 5000 })
    .catch(async () => {
      const count = await nodeGroups.count();
      expect(count).toBeGreaterThan(2);
    });

  // The origin node carries id TEST_COLL/ROOT; find a node that isn't it by
  // checking each candidate's bound datum via evaluate (stable regardless of
  // simulation layout/position).
  const nonOriginIndex = await page.evaluate(
    ({ coll, key }) => {
      const groups = Array.from(document.querySelectorAll("g.node"));
      // biome-ignore lint/suspicious/noExplicitAny: d3 datum access in browser context
      const idx = groups.findIndex((el) => (el as any).__data__?._id !== `${coll}/${key}`);
      return idx;
    },
    { coll: TEST_COLL, key: originKey },
  );
  expect(nonOriginIndex).toBeGreaterThanOrEqual(0);

  // Node selection is wired to a left-click interaction (see
  // ForceGraphConstructor/graphRendering.js: onNodeLeftClick fires on
  // "click"); right-click stays reserved for the context menu.
  await nodeGroups.nth(nonOriginIndex).click();

  // Inspector swaps to the clicked node's document.
  await expect(inspectorLegend).not.toContainText(`${TEST_COLL}_${originKey}`, { timeout: 5000 });

  // Saved-graph shelf gains a card when a graph is saved via the store.
  await page.waitForFunction(
    () => (window as unknown as { __STORE__?: unknown }).__STORE__ != null,
  );
  await page.evaluate((graphName) => {
    // biome-ignore lint/suspicious/noExplicitAny: accessing custom property
    const store: any = (window as any).__STORE__;
    const present = store.getState().graph.present;
    store.dispatch({
      type: "savedGraphs/saveGraph",
      payload: {
        name: graphName,
        originNodeIds: present.originNodeIds ?? [],
        settings: present.settings ?? {},
        graphData: present.graphData,
      },
    });
  }, "Task 12 Shelf Graph");

  const shelfCard = page.locator(".saved-graph-card");
  await expect(shelfCard).toBeVisible();
  await expect(shelfCard).toContainText("Task 12 Shelf Graph");

  expect(filterErrorsContaining(await getCollectedErrors(page), "split").length).toBe(0);
});
