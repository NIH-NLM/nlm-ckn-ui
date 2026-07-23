import { expect, test } from "@playwright/test";
import {
  filterErrorsContaining,
  getCollectedErrors,
  installErrorInstrumentation,
} from "./utils/errorInstrumentation";
import { smallGraphWithEdges } from "./utils/testSeeds";

// History strip: auto-populates a card on origin add, and clicking a card
// restores that snapshot in place (positions preserved, no reflow).

const TEST_COLL = "TEST_DOCUMENT_COLLECTION";

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

test("History strip auto-captures a card and restores position on click", async ({ page }) => {
  await installErrorInstrumentation(page);

  const originKey = "ROOT";
  const originId = `${TEST_COLL}/${originKey}`;
  const { root } = smallGraphWithEdges();

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

  await page.route(`**/arango_api/collection/${TEST_COLL}/${originKey}/`, async (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(root),
    });
  });

  await page.goto(`/#/collections/${TEST_COLL}/${originKey}`);

  // Graph renders.
  const svg = page.locator(".graph-workspace-canvas #chart-container-wrapper svg");
  await expect(svg).toBeVisible();
  await expect(svg).toHaveAttribute("data-sim-settled", "true", { timeout: 10000 });

  const nodeGroups = page.locator("g.node");
  await expect(nodeGroups)
    .toHaveCount(3, { timeout: 5000 })
    .catch(async () => {
      const count = await nodeGroups.count();
      expect(count).toBeGreaterThan(2);
    });

  // A History card auto-appears for the origin, with a real SVG-snapshot thumbnail.
  const shelfCard = page.locator(".saved-graph-shelf .saved-graph-card").first();
  await expect(shelfCard).toBeVisible({ timeout: 10000 });
  const thumbSrc = await shelfCard.locator(".saved-graph-card-thumb img").getAttribute("src");
  expect(thumbSrc).toMatch(/^data:image\/svg\+xml/);

  // Clicking the card marks it active.
  await shelfCard.locator(".saved-graph-card-thumb").click();
  await expect(shelfCard).toHaveClass(/saved-graph-card--active/);

  // Wait for the origin node to be present in the store, then record its position.
  await page.waitForFunction(
    (id) =>
      // biome-ignore lint/suspicious/noExplicitAny: accessing custom property
      (window as any).__STORE__
        ?.getState?.()
        .graph?.present?.graphData?.nodes?.some((n: { id: string }) => n.id === id),
    originId,
  );
  const originalPos = await page.evaluate((id) => {
    // biome-ignore lint/suspicious/noExplicitAny: accessing custom property
    const store: any = (window as any).__STORE__;
    const node = store
      .getState()
      // biome-ignore lint/suspicious/noExplicitAny: generic test type
      .graph.present.graphData.nodes.find((n: any) => n.id === id);
    return { x: node.x, y: node.y };
  }, originId);

  // Perturb the live position directly (equivalent to a user drag, deterministic).
  await page.evaluate(
    (args) => {
      // biome-ignore lint/suspicious/noExplicitAny: accessing custom property
      const store: any = (window as any).__STORE__;
      store.dispatch({
        type: "graph/updateNodePosition",
        payload: { nodeId: args.id, x: args.x + 250, y: args.y + 250, userPinned: true },
      });
    },
    { id: originId, x: originalPos.x, y: originalPos.y },
  );
  await expect
    .poll(() =>
      page.evaluate(
        (id) =>
          // biome-ignore lint/suspicious/noExplicitAny: accessing custom property
          (window as any).__STORE__
            ?.getState?.()
            // biome-ignore lint/suspicious/noExplicitAny: generic test type
            .graph.present.graphData.nodes.find((n: any) => n.id === id)?.x,
        originId,
      ),
    )
    .toBeCloseTo(originalPos.x + 250, 0);

  // Click the History card again: restore does not reflow, so the node
  // returns to its recorded (pre-perturbation) position.
  await shelfCard.locator(".saved-graph-card-thumb").click();
  await expect(shelfCard).toHaveClass(/saved-graph-card--active/);

  await expect
    .poll(() =>
      page.evaluate(
        (id) =>
          // biome-ignore lint/suspicious/noExplicitAny: accessing custom property
          (window as any).__STORE__
            ?.getState?.()
            // biome-ignore lint/suspicious/noExplicitAny: generic test type
            .graph.present.graphData.nodes.find((n: any) => n.id === id)?.x,
        originId,
      ),
    )
    .toBeCloseTo(originalPos.x, 0);
  const restoredY = await page.evaluate((id) => {
    // biome-ignore lint/suspicious/noExplicitAny: accessing custom property
    const store: any = (window as any).__STORE__;
    return (
      store
        .getState()
        // biome-ignore lint/suspicious/noExplicitAny: generic test type
        .graph.present.graphData.nodes.find((n: any) => n.id === id)?.y
    );
  }, originId);
  expect(restoredY).toBeCloseTo(originalPos.y, 0);

  // Graph still shows the expected nodes after restore.
  await expect(nodeGroups)
    .toHaveCount(3, { timeout: 5000 })
    .catch(async () => {
      const count = await nodeGroups.count();
      expect(count).toBeGreaterThan(2);
    });

  expect(filterErrorsContaining(await getCollectedErrors(page), "split").length).toBe(0);
});
