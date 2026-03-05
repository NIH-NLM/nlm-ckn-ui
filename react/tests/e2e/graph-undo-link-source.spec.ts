import { expect, test } from "@playwright/test";
import {
  filterErrorsContaining,
  getCollectedErrors,
  installErrorInstrumentation,
} from "./utils/errorInstrumentation";
import { doc, edge, type TestEdge } from "./utils/testSeeds";

const COLL = "TEST_DOCUMENT_COLLECTION";
const SOURCE_TEXT = "PMID:12345";

function edgeWithSource(
  key: string,
  fromDocId: string,
  toDocId: string,
  label: string,
  source: string,
): TestEdge & { Source: string } {
  return {
    ...edge(key, fromDocId, toDocId, label),
    Source: source,
  };
}

function buildInitialGraph(originId: string) {
  const root = doc("ROOT", "Root");
  const child = doc("CHILD1", "Child One");
  const e1 = edgeWithSource("E1", root._id, child._id, "has_child", SOURCE_TEXT);
  return {
    [originId]: {
      nodes: [root, child],
      links: [e1],
    },
  };
}

function buildDeeperGraph(originId: string) {
  const root = doc("ROOT", "Root");
  const child = doc("CHILD1", "Child One");
  const child2 = doc("CHILD2", "Child Two");
  const e1 = edgeWithSource("E1", root._id, child._id, "has_child", SOURCE_TEXT);
  const e2 = edgeWithSource("E2", root._id, child2._id, "has_child", "PMID:67890");
  return {
    [originId]: {
      nodes: [root, child, child2],
      links: [e1, e2],
    },
  };
}

function buildExpansionResponse(nodeId: string) {
  const expandedNode = doc("CHILD1", "Child One");
  const grandchild = doc("GC1", "Grandchild One");
  const e1 = edgeWithSource("E_GC1", expandedNode._id, grandchild._id, "has_child", "PMID:99999");
  return {
    [nodeId]: {
      nodes: [expandedNode, grandchild],
      links: [e1],
    },
  };
}

/**
 * Shared API mocking for graph tests with Source text on edges.
 */
async function setupGraphMocks(
  page: import("@playwright/test").Page,
  originId: string,
) {
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

  await page.route("**/arango_api/graph/", async (route) => {
    if (route.request().method() === "POST") {
      const body = await route.request().postDataJSON();

      // Expansion request (depth=1, single node)
      if (body.depth === 1 && body.node_ids?.length === 1) {
        const expandedNodeId = body.node_ids[0];
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(buildExpansionResponse(expandedNodeId)),
        });
      }

      // Deeper graph for depth >= 3
      if (body.depth >= 3) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(buildDeeperGraph(originId)),
        });
      }

      // Default graph fetch
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
    };
    localStorage.setItem("persist:root", JSON.stringify(persistedRoot));
  }, originId);
}

/**
 * Generate a graph and wait for initial nodes to render.
 */
async function generateGraphAndWait(page: import("@playwright/test").Page, expectedNodes: number) {
  await page.goto("/#/graph");
  await page.locator(".selected-items-container").waitFor({ state: "visible" });
  await page.getByRole("button", { name: /Generate Graph|Update Graph/i }).click();

  const svg = page.locator("#chart-container-wrapper svg");
  await expect(svg).toBeVisible();
  await expect(async () => {
    expect(await page.locator("g.node").count()).toBe(expectedNodes);
  }).toPass({ timeout: 5000 });
}

test("Expanding a node creates undo history and undo restores the previous graph", async ({
  page,
}) => {
  await installErrorInstrumentation(page);
  const originId = `${COLL}/ROOT`;
  await setupGraphMocks(page, originId);
  await generateGraphAndWait(page, 2);

  // Expand CHILD1 via right-click popup
  const childNode = page.locator("g.node").filter({ hasText: "Child One" }).first();
  await childNode.waitFor({ state: "visible" });
  await childNode.click({ button: "right", force: true });

  const popup = page.locator(".document-popup");
  await expect(popup).toBeVisible();
  await popup.getByRole("button", { name: "Expand" }).click();

  // Wait for expansion: should now have 3 nodes (ROOT, CHILD1, GC1)
  await expect(async () => {
    expect(await page.locator("g.node").count()).toBe(3);
  }).toPass({ timeout: 5000 });

  // Open the History panel and verify the Undo button is enabled
  await page.getByRole("button", { name: "< Show Options" }).click();
  await page.getByRole("button", { name: "History" }).click();

  const undoButton = page.locator("#tab-panel-history button", { hasText: "Undo" });
  await expect(undoButton).toBeVisible();
  await expect(undoButton).toBeEnabled();

  // Click Undo
  await undoButton.click();

  // After undo the graph should go back to 2 nodes (ROOT, CHILD1)
  await expect(async () => {
    expect(await page.locator("g.node").count()).toBe(2);
  }).toPass({ timeout: 5000 });

  expect(filterErrorsContaining(await getCollectedErrors(page), "split").length).toBe(0);
});

test("Undo after settings change restores the previous graph", async ({ page }) => {
  await installErrorInstrumentation(page);
  const originId = `${COLL}/ROOT`;
  await setupGraphMocks(page, originId);
  await generateGraphAndWait(page, 2);

  // Open options and change depth from 2 to 3
  await page.getByRole("button", { name: "< Show Options" }).click();
  await page.locator("#depth-select").selectOption("3");

  // "Apply Changes" banner should appear — click it to regenerate
  const applyButton = page.getByRole("button", { name: "Apply Changes" });
  await expect(applyButton).toBeVisible();
  await applyButton.click();

  // New graph should have 3 nodes (ROOT, CHILD1, CHILD2)
  await expect(async () => {
    expect(await page.locator("g.node").count()).toBe(3);
  }).toPass({ timeout: 5000 });

  // Undo via History panel button
  await page.getByRole("button", { name: "History" }).click();
  const undoButton = page.locator("#tab-panel-history button", { hasText: "Undo" });
  await expect(undoButton).toBeEnabled();
  await undoButton.click();

  // Should restore the original 2-node graph
  await expect(async () => {
    expect(await page.locator("g.node").count()).toBe(2);
  }).toPass({ timeout: 5000 });

  // Settings should revert — depth back to 2, no "Apply Changes" banner
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.locator("#depth-select")).toHaveValue("2");
  await expect(page.getByRole("button", { name: "Apply Changes" })).not.toBeVisible();

  expect(filterErrorsContaining(await getCollectedErrors(page), "split").length).toBe(0);
});

test("Undo after expand preserves link source text from collection map", async ({ page }) => {
  await installErrorInstrumentation(page);
  const originId = `${COLL}/ROOT`;
  await setupGraphMocks(page, originId);
  await generateGraphAndWait(page, 2);

  // Verify initial link source text (hidden in DOM but text content is present)
  const linkSourceEls = page.locator("text.link-source");
  await expect(async () => {
    await expect(linkSourceEls.first()).toHaveText(SOURCE_TEXT);
  }).toPass({ timeout: 5000 });

  // Expand CHILD1
  const childNode = page.locator("g.node").filter({ hasText: "Child One" }).first();
  await childNode.waitFor({ state: "visible" });
  await childNode.click({ button: "right", force: true });
  const popup = page.locator(".document-popup");
  await expect(popup).toBeVisible();
  await popup.getByRole("button", { name: "Expand" }).click();

  await expect(async () => {
    expect(await page.locator("g.node").count()).toBe(3);
  }).toPass({ timeout: 5000 });

  // Undo via keyboard
  await page.keyboard.press("Control+z");
  await expect(async () => {
    expect(await page.locator("g.node").count()).toBe(2);
  }).toPass({ timeout: 5000 });

  // After undo, the original link source text should be preserved —
  // NOT replaced with a node ID like "TEST_DOCUMENT_COLLECTION/ROOT"
  await expect(linkSourceEls.first()).toHaveText(SOURCE_TEXT);

  expect(filterErrorsContaining(await getCollectedErrors(page), "split").length).toBe(0);
});
