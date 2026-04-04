import { expect, test } from "@playwright/test";
import {
  filterErrorsContaining,
  getCollectedErrors,
  installErrorInstrumentation,
} from "./utils/errorInstrumentation";
import { doc, edge } from "./utils/testSeeds";

const COLL = "TEST_DOCUMENT_COLLECTION";

// Build a graph with 3 nodes (A, B, C) and traversal edges A→B, A→C.
// When includeInterNodeEdges is true, the backend also returns B→C.
function buildGraphWithInterNodeEdge(originId: string, includeInterEdge: boolean) {
  const a = doc("A", "Node A");
  const b = doc("B", "Node B");
  const c = doc("C", "Node C");
  const e1 = edge("E1", a._id, b._id, "traversal");
  const e2 = edge("E2", a._id, c._id, "traversal");

  const links = [e1, e2];
  if (includeInterEdge) {
    links.push(edge("E_INTER", b._id, c._id, "inter_node"));
  }

  return {
    [originId]: {
      nodes: [a, b, c],
      links,
    },
  };
}

function setupCommonMocks(page: import("@playwright/test").Page) {
  return Promise.all([
    page.route("**/arango_api/collections/", async (route) => {
      if (route.request().method() === "POST") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([COLL]),
        });
      }
      return route.continue();
    }),
    page.route("**/arango_api/edge_filter_options/", async (route) => {
      if (route.request().method() === "POST") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            Label: { type: "categorical", values: ["traversal", "inter_node"] },
          }),
        });
      }
      return route.continue();
    }),
    page.route("**/arango_api/document/details", async (route) => {
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
    }),
  ]);
}

test("Inter-node edges render when backend includes them", async ({ page }) => {
  await installErrorInstrumentation(page);

  const originId = `${COLL}/A`;

  await setupCommonMocks(page);

  await page.route("**/arango_api/graph/", async (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(buildGraphWithInterNodeEdge(originId, true)),
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

  // Wait for graph to render with all 3 nodes and 3 edges (including inter-node B→C)
  await expect(page.locator("g.node")).toHaveCount(3, { timeout: 10000 });
  await expect(page.locator("g.link")).toHaveCount(3, { timeout: 10000 });

  const errors = filterErrorsContaining(await getCollectedErrors(page), "favicon");
  expect(errors).toHaveLength(0);
});

test("Graph shows only traversal edges when inter-node edge is absent", async ({ page }) => {
  await installErrorInstrumentation(page);

  const originId = `${COLL}/A`;

  await setupCommonMocks(page);

  await page.route("**/arango_api/graph/", async (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(buildGraphWithInterNodeEdge(originId, false)),
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

  // Only 2 traversal edges, no inter-node edge
  await expect(page.locator("g.node")).toHaveCount(3, { timeout: 10000 });
  await expect(page.locator("g.link")).toHaveCount(2, { timeout: 10000 });

  const errors = filterErrorsContaining(await getCollectedErrors(page), "favicon");
  expect(errors).toHaveLength(0);
});
