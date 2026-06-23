import { expect, test } from "@playwright/test";
import {
  filterErrorsContaining,
  getCollectedErrors,
  installErrorInstrumentation,
} from "./utils/errorInstrumentation";
import { openNodeContextMenu } from "./utils/graphInteractions";
import { doc, edge, type TestDoc, type TestEdge } from "./utils/testSeeds";

const COLL = "TEST_DOCUMENT_COLLECTION";

// Build initial graph with just root and one child
function buildInitialGraph(originId: string) {
  const root = doc("ROOT", "Root");
  const child1 = doc("CHILD1", "Child One");
  const e1 = edge("E1", root._id, child1._id, "has_child");

  return {
    [originId]: {
      nodes: [root, child1],
      links: [e1],
    },
  };
}

// Build expansion response - additional nodes connected to CHILD1
function buildExpansionResponse(nodeId: string) {
  const expandedNode = doc("CHILD1", "Child One");
  const grandchild1 = doc("GC1", "Grandchild One");
  const grandchild2 = doc("GC2", "Grandchild Two");
  const e1 = edge("E_GC1", expandedNode._id, grandchild1._id, "has_child");
  const e2 = edge("E_GC2", expandedNode._id, grandchild2._id, "has_child");

  return {
    [nodeId]: {
      nodes: [expandedNode, grandchild1, grandchild2],
      links: [e1, e2],
    },
  };
}

test("Expand button fetches and adds new nodes to graph", async ({ page }) => {
  await installErrorInstrumentation(page);

  const originId = `${COLL}/ROOT`;
  const nodeToExpand = `${COLL}/CHILD1`;

  // Track API calls to verify expand request
  let expandRequestMade = false;
  let expandRequestBody: Record<string, unknown> | null = null;

  // Mock collections
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

  // Mock graph fetch - returns different data based on request
  // IMPORTANT: Simulates real backend behavior where empty allowed_collections returns no data
  await page.route("**/arango_api/graph/", async (route) => {
    if (route.request().method() === "POST") {
      const body = await route.request().postDataJSON();

      // Check if this is an expansion request (depth=1, single node)
      if (body.depth === 1 && body.node_ids?.length === 1) {
        expandRequestMade = true;
        expandRequestBody = body;
        const expandedNodeId = body.node_ids[0];

        // Simulate backend behavior: empty allowed_collections returns no results
        // This is the actual bug - backend can't traverse without collections
        const collections = body.allowed_collections || [];
        if (collections.length === 0) {
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ [expandedNodeId]: { nodes: [], links: [] } }),
          });
        }

        // Simulate backend behavior: edge_filters must be an object, not an array
        if (Array.isArray(body.edge_filters)) {
          return route.fulfill({
            status: 400,
            contentType: "application/json",
            body: JSON.stringify({
              edge_filters: ['Expected a dictionary of items but got type "list".'],
            }),
          });
        }

        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(buildExpansionResponse(expandedNodeId)),
        });
      }

      // Initial graph fetch
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(buildInitialGraph(originId)),
      });
    }
    return route.continue();
  });

  // Mock document details
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

  // Seed origin node via redux-persist
  await page.addInitScript((origin) => {
    const persistedRoot = {
      nodesSlice: JSON.stringify({ originNodeIds: [origin] }),
      savedGraphs: JSON.stringify({ graphs: [] }),
      _persist: JSON.stringify({ version: -1, rehydrated: true }),
    };
    localStorage.setItem("persist:root", JSON.stringify(persistedRoot));
  }, originId);

  // Navigate to graph page
  await page.goto("/#/graph");

  // Wait for selected items and generate graph
  await page.locator(".selected-items-container").waitFor({ state: "visible" });
  await page.getByRole("button", { name: /Generate Graph|Update Graph/i }).click();

  // Wait for SVG and initial nodes to render
  const svg = page.locator("#chart-container-wrapper svg");
  await expect(svg).toBeVisible();

  // Count initial nodes (should be 2: ROOT and CHILD1)
  const initialNodes = page.locator("g.node");
  await expect(async () => {
    const count = await initialNodes.count();
    expect(count).toBe(2);
  }).toPass({ timeout: 5000 });

  // Find and right-click the CHILD1 node to open popup (popup is triggered by contextmenu)
  // We need to click on the non-origin node to test expansion
  const childNode = page.locator("g.node").filter({ hasText: "Child One" }).first();
  await childNode.waitFor({ state: "visible" });
  const popup = await openNodeContextMenu(page, childNode);

  // Click the Expand button
  const expandButton = popup.getByRole("button", { name: "Expand", exact: true });
  await expect(expandButton).toBeVisible();
  await expandButton.click();

  // Verify the expand API request was made with correct parameters
  await expect(async () => {
    expect(expandRequestMade).toBe(true);
  }).toPass({ timeout: 5000 });

  // Verify allowed_collections was passed (not empty)
  expect(expandRequestBody).not.toBeNull();
  expect(expandRequestBody!.allowed_collections).toBeDefined();
  expect(Array.isArray(expandRequestBody!.allowed_collections)).toBe(true);
  expect((expandRequestBody!.allowed_collections as string[]).length).toBeGreaterThan(0);

  // Verify edge_filters is an object (not an array) - backend requires this
  expect(expandRequestBody!.edge_filters).toBeDefined();
  expect(Array.isArray(expandRequestBody!.edge_filters)).toBe(false);
  expect(typeof expandRequestBody!.edge_filters).toBe("object");

  // Wait for new nodes to appear (should now be 4: ROOT, CHILD1, GC1, GC2)
  await expect(async () => {
    const count = await page.locator("g.node").count();
    expect(count).toBe(4);
  }).toPass({ timeout: 5000 });

  // Verify no console errors occurred
  expect(filterErrorsContaining(await getCollectedErrors(page), "split").length).toBe(0);
  expect(filterErrorsContaining(await getCollectedErrors(page), "failed").length).toBe(0);
});

test("Expand button closes popup after triggering expansion", async ({ page }) => {
  await installErrorInstrumentation(page);

  const originId = `${COLL}/ROOT`;

  // Mock collections
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
      const body = await route.request().postDataJSON();

      // Expansion request
      if (body.depth === 1 && body.node_ids?.length === 1) {
        const expandedNodeId = body.node_ids[0];
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(buildExpansionResponse(expandedNodeId)),
        });
      }

      // Initial fetch
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(buildInitialGraph(originId)),
      });
    }
    return route.continue();
  });

  // Mock document details
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

  // Seed state
  await page.addInitScript((origin) => {
    const persistedRoot = {
      nodesSlice: JSON.stringify({ originNodeIds: [origin] }),
      savedGraphs: JSON.stringify({ graphs: [] }),
      _persist: JSON.stringify({ version: -1, rehydrated: true }),
    };
    localStorage.setItem("persist:root", JSON.stringify(persistedRoot));
  }, originId);

  await page.goto("/#/graph");
  await page.locator(".selected-items-container").waitFor({ state: "visible" });
  await page.getByRole("button", { name: /Generate Graph|Update Graph/i }).click();

  // Wait for nodes
  await expect(async () => {
    const count = await page.locator("g.node").count();
    expect(count).toBeGreaterThan(0);
  }).toPass({ timeout: 5000 });

  // Right-click node to open popup (popup is triggered by contextmenu)
  const node = page.locator("g.node").first();
  const popup = await openNodeContextMenu(page, node);

  // Click expand
  await popup.getByRole("button", { name: "Expand", exact: true }).click();

  // Popup should close after clicking expand
  await expect(popup).toBeHidden({ timeout: 3000 });

  // Verify no errors
  expect(filterErrorsContaining(await getCollectedErrors(page), "split").length).toBe(0);
});

// Incremental-layout regression test: expanding a node should leave the
// positions of pre-existing nodes exactly where they were, only flowing the
// new nodes into the existing layout (preserve mental map). Backed by the
// auto-pin / auto-release loop in ForceGraphConstructor.updateGraph.
test("Expanding a node preserves the positions of pre-existing nodes", async ({ page }) => {
  await installErrorInstrumentation(page);

  const originId = `${COLL}/ROOT`;

  // Reusable mocks for collections, edge filter options, graph fetch, and
  // document details — mirror the patterns in the earlier tests.
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
        body: JSON.stringify({ Label: { type: "categorical", values: ["has_child"] } }),
      });
    }
    return route.continue();
  });
  await page.route("**/arango_api/graph/", async (route) => {
    if (route.request().method() === "POST") {
      const body = await route.request().postDataJSON();
      if (body.depth === 1 && body.node_ids?.length === 1) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(buildExpansionResponse(body.node_ids[0])),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(buildInitialGraph(originId)),
      });
    }
    return route.continue();
  });
  await page.route("**/arango_api/document/details", async (route) => {
    if (route.request().method() === "POST") {
      const req = await route.request().postDataJSON();
      const ids: string[] = req.document_ids || [];
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(ids.map((id) => ({ _id: id, label: id.split("/")[1] }))),
      });
    }
    return route.continue();
  });

  await page.addInitScript((origin) => {
    const persistedRoot = {
      nodesSlice: JSON.stringify({ originNodeIds: [origin] }),
      savedGraphs: JSON.stringify({ graphs: [] }),
      _persist: JSON.stringify({ version: -1, rehydrated: true }),
    };
    localStorage.setItem("persist:root", JSON.stringify(persistedRoot));
  }, originId);

  await page.goto("/#/graph");
  await page.locator(".selected-items-container").waitFor({ state: "visible" });
  await page.getByRole("button", { name: /Generate Graph|Update Graph/i }).click();

  const svg = page.locator("#chart-container-wrapper svg");
  await expect(svg).toBeVisible();

  // Wait for the initial layout to settle. data-sim-settled is the
  // deterministic sentinel set by ForceGraphConstructor after waitForAlpha
  // resolves and runSimulation(false) drains alpha to 0.
  await expect(svg).toHaveAttribute("data-sim-settled", "true", { timeout: 10000 });

  // Snapshot the rendered transform of the ROOT node before we expand
  // CHILD1. ROOT is NOT the node being expanded, so its position MUST be
  // identical after the expand — that's the whole point of incremental
  // layout.
  const rootNode = page.locator("g.node").filter({ hasText: "Root" }).first();
  await rootNode.waitFor({ state: "visible" });
  const beforeTransform = await rootNode.getAttribute("transform");
  expect(beforeTransform).not.toBeNull();

  // Expand CHILD1, which adds GC1 and GC2 to the graph.
  const childNode = page.locator("g.node").filter({ hasText: "Child One" }).first();
  const popup = await openNodeContextMenu(page, childNode);
  await popup.getByRole("button", { name: "Expand", exact: true }).click();

  // Wait for the expansion to fully complete: 4 rendered nodes AND sim
  // settled. The data-sim-settled attr flips to "false" while updateGraph
  // reheats and back to "true" once waitForAlpha resolves.
  await expect(svg).toHaveAttribute("data-sim-settled", "false", { timeout: 5000 });
  await expect(svg).toHaveAttribute("data-sim-settled", "true", { timeout: 10000 });
  await expect(async () => {
    const count = await page.locator("g.node").count();
    expect(count).toBe(4);
  }).toPass({ timeout: 5000 });

  // The auto-pin set fx/fy on ROOT for the duration of the reheat, and the
  // auto-release ran after runSimulation(false) drained alpha. ROOT's
  // rendered transform must therefore be exactly the pre-expand value.
  const rootNodeAfter = page.locator("g.node").filter({ hasText: "Root" }).first();
  const afterTransform = await rootNodeAfter.getAttribute("transform");
  expect(afterTransform).toBe(beforeTransform);

  expect(filterErrorsContaining(await getCollectedErrors(page), "split").length).toBe(0);
});

// Pin/Unpin action: right-click a node, choose Pin, confirm the pin marker
// renders and the node carries the .pinned class. Re-right-clicking shows
// "Unpin"; clicking it removes the marker and class.
test("Pin/Unpin action toggles the pin marker on a node", async ({ page }) => {
  await installErrorInstrumentation(page);

  const originId = `${COLL}/ROOT`;

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
        body: JSON.stringify({ Label: { type: "categorical", values: ["has_child"] } }),
      });
    }
    return route.continue();
  });
  await page.route("**/arango_api/graph/", async (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(buildInitialGraph(originId)),
      });
    }
    return route.continue();
  });
  await page.route("**/arango_api/document/details", async (route) => {
    if (route.request().method() === "POST") {
      const req = await route.request().postDataJSON();
      const ids: string[] = req.document_ids || [];
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(ids.map((id) => ({ _id: id, label: id.split("/")[1] }))),
      });
    }
    return route.continue();
  });

  await page.addInitScript((origin) => {
    const persistedRoot = {
      nodesSlice: JSON.stringify({ originNodeIds: [origin] }),
      savedGraphs: JSON.stringify({ graphs: [] }),
      _persist: JSON.stringify({ version: -1, rehydrated: true }),
    };
    localStorage.setItem("persist:root", JSON.stringify(persistedRoot));
  }, originId);

  await page.goto("/#/graph");
  await page.locator(".selected-items-container").waitFor({ state: "visible" });
  await page.getByRole("button", { name: /Generate Graph|Update Graph/i }).click();

  const svg = page.locator("#chart-container-wrapper svg");
  await expect(svg).toBeVisible();
  await expect(svg).toHaveAttribute("data-sim-settled", "true", { timeout: 10000 });

  const rootNode = page.locator("g.node").filter({ hasText: "Root" }).first();
  await rootNode.waitFor({ state: "visible" });

  // No pin to begin with.
  await expect(rootNode).not.toHaveClass(/pinned/);

  // Right-click → Pin.
  let popup = await openNodeContextMenu(page, rootNode);
  await expect(popup.getByRole("button", { name: "Pin", exact: true })).toBeVisible();
  await popup.getByRole("button", { name: "Pin", exact: true }).click();
  await expect(popup).toBeHidden({ timeout: 3000 });

  // Node should now carry the .pinned class so the marker renders.
  await expect(rootNode).toHaveClass(/pinned/);

  // Re-right-click → button now reads "Unpin".
  popup = await openNodeContextMenu(page, rootNode);
  await expect(popup.getByRole("button", { name: "Unpin", exact: true })).toBeVisible();
  await popup.getByRole("button", { name: "Unpin", exact: true }).click();
  await expect(popup).toBeHidden({ timeout: 3000 });

  // .pinned should be gone.
  await expect(rootNode).not.toHaveClass(/pinned/);

  expect(filterErrorsContaining(await getCollectedErrors(page), "split").length).toBe(0);
});
