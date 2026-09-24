import { expect, test } from "@playwright/test";
import {
  filterErrorsContaining,
  getCollectedErrors,
  installErrorInstrumentation,
} from "./utils/errorInstrumentation";
import { generateGraphAndSettle, openNodeContextMenu } from "./utils/graphInteractions";
import { doc, edge } from "./utils/testSeeds";

const COLL = "TEST_DOCUMENT_COLLECTION";

// The live graph is a client-side union of each origin's own captured
// neighborhood (`originSubgraphs`). The bulk graph fetch behind Generate
// Graph now populates that per-origin state directly, so seeding two
// origins the ordinary way is enough to exercise composition — no need to
// promote plain nodes to origins first.
const originA = doc("ORIGIN_A", "Origin A");
const originB = doc("ORIGIN_B", "Origin B");
const shared = doc("SHARED", "Shared Node");
const aOnly = doc("A_ONLY", "A Only");
const bOnly = doc("B_ONLY", "B Only");
const straggler = doc("STRAGGLER", "Straggler Node");

const originAId = originA._id;
const originBId = originB._id;
const aOnlyId = aOnly._id;
const sharedId = shared._id;

function neighborhoodFor(nodeId: string) {
  if (nodeId === originAId) {
    return {
      nodes: [originA, shared, aOnly],
      links: [
        edge("E_A_SHARED", originA._id, shared._id, "related"),
        edge("E_A_ONLY", originA._id, aOnly._id, "related"),
      ],
    };
  }
  if (nodeId === originBId) {
    return {
      nodes: [originB, shared, bOnly],
      links: [
        edge("E_B_SHARED", originB._id, shared._id, "related"),
        edge("E_B_ONLY", originB._id, bOnly._id, "related"),
      ],
    };
  }
  if (nodeId === aOnlyId) {
    // A plain expand (not an origin add) of A_ONLY introduces a node that
    // belongs to no origin's captured neighborhood — a straggler.
    return {
      nodes: [aOnly, straggler],
      links: [edge("E_AONLY_STRAGGLER", aOnly._id, straggler._id, "related")],
    };
  }
  if (nodeId === sharedId) {
    // Promoting SHARED to an origin captures the same neighborhood as
    // ORIGIN_A (it mirrors A's set, not B's) so the composed union stays
    // {ORIGIN_A, SHARED, A_ONLY} — excluding the plain-expand STRAGGLER.
    return {
      nodes: [shared, originA, aOnly],
      links: [
        edge("E_SHARED_A", shared._id, originA._id, "related"),
        edge("E_SHARED_AONLY", shared._id, aOnly._id, "related"),
      ],
    };
  }
  return { nodes: [], links: [] };
}

async function setupMocks(page: import("@playwright/test").Page) {
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
        body: JSON.stringify({ Label: { type: "categorical", values: ["related"] } }),
      });
    }
    return route.continue();
  });

  // graph/ (union query + single-origin re-fetch): return each requested
  // node id's neighborhood. addOriginNode re-queries one origin through this
  // same endpoint (node_ids: [id]) — keying by node_ids covers both the
  // initial bulk fetch and that re-fetch.
  await page.route("**/arango_api/graph/", async (route) => {
    if (route.request().method() === "POST") {
      const body = await route.request().postDataJSON();
      const nodeIds: string[] = body.node_ids || [];
      const payload: Record<string, { nodes: unknown[]; links: unknown[] }> = {};
      for (const id of nodeIds) {
        payload[id] = neighborhoodFor(id);
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(payload),
      });
    }
    return route.continue();
  });

  // edges-between/ (cross-origin edge fill): no cross edges needed for this
  // test, an empty array is sufficient.
  await page.route("**/arango_api/graph/edges-between/", async (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
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
}

test("Removing an origin drops its unshared nodes and preserves shared node position", async ({
  page,
}) => {
  test.setTimeout(60000);
  await installErrorInstrumentation(page);
  await setupMocks(page);

  // Seed both origins via redux-persist, as the sibling graph specs do.
  await page.addInitScript(
    (ids) => {
      const persistedRoot = {
        nodesSlice: JSON.stringify({ originNodeIds: ids }),
        savedGraphs: JSON.stringify({ graphs: [] }),
        _persist: JSON.stringify({ version: -1, rehydrated: true }),
      };
      localStorage.setItem("persist:root", JSON.stringify(persistedRoot));
    },
    [originAId, originBId],
  );

  await page.goto("/#/graph");
  await page.locator(".selected-items-container").waitFor({ state: "visible" });
  await generateGraphAndSettle(page);

  const svg = page.locator("#chart-container-wrapper svg");
  await expect(svg).toBeVisible();
  await expect(svg).toHaveAttribute("data-sim-settled", "true", { timeout: 10000 });

  // Union graph: ORIGIN_A, ORIGIN_B, SHARED, A_ONLY, B_ONLY.
  await expect(async () => {
    expect(await page.locator("g.node").count()).toBe(5);
  }).toPass({ timeout: 5000 });

  // Snapshot the shared node's on-screen position before removing an origin.
  const sharedNode = page.locator("g.node").filter({ hasText: "Shared Node" }).first();
  await sharedNode.waitFor({ state: "visible" });
  const beforeBox = await sharedNode.boundingBox();
  expect(beforeBox).not.toBeNull();

  // Right-click ORIGIN_B and remove it as an origin.
  const originBNode = page.locator("g.node").filter({ hasText: "Origin B" }).first();
  await originBNode.waitFor({ state: "visible" });
  const popup = await openNodeContextMenu(page, originBNode);
  const removeButton = popup.getByRole("button", { name: "Remove as origin", exact: true });
  await expect(removeButton).toBeVisible();
  await removeButton.click();

  // After removal: ORIGIN_B and B_ONLY (only in B's captured neighborhood)
  // are gone; ORIGIN_A, SHARED, A_ONLY (all in A's neighborhood) remain.
  await expect(async () => {
    expect(await page.locator("g.node").count()).toBe(3);
  }).toPass({ timeout: 5000 });
  await expect(page.locator("g.node").filter({ hasText: "Origin B" })).toHaveCount(0);
  await expect(page.locator("g.node").filter({ hasText: "B Only" })).toHaveCount(0);
  await expect(page.locator("g.node").filter({ hasText: "Origin A" })).toHaveCount(1);
  await expect(page.locator("g.node").filter({ hasText: "A Only" })).toHaveCount(1);

  // SHARED itself survives (it's still in A's neighborhood), holding
  // approximately its pre-removal position — layout is preserved, not
  // reflowed.
  const sharedNodeAfter = page.locator("g.node").filter({ hasText: "Shared Node" }).first();
  await sharedNodeAfter.waitFor({ state: "visible" });
  const afterBox = await sharedNodeAfter.boundingBox();
  expect(afterBox).not.toBeNull();
  if (beforeBox && afterBox) {
    expect(Math.abs(afterBox.x - beforeBox.x)).toBeLessThanOrEqual(20);
    expect(Math.abs(afterBox.y - beforeBox.y)).toBeLessThanOrEqual(20);
  }

  // Origins panel lists the remaining origin (ORIGIN_A) and can be closed.
  await page.getByRole("button", { name: /^origins \(\d+\)$/i }).click();
  const panel = page.getByRole("complementary", { name: /current origins/i });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Origin A");
  await expect(panel).not.toContainText("Origin B");

  await page.getByLabel(/close origins panel/i).click();
  await expect(panel).toBeHidden();

  expect(filterErrorsContaining(await getCollectedErrors(page), "split").length).toBe(0);
});

test("Undo after removing an origin restores it in both the graph and the Origins panel", async ({
  page,
}) => {
  test.setTimeout(60000);
  await installErrorInstrumentation(page);
  await setupMocks(page);

  await page.addInitScript(
    (ids) => {
      const persistedRoot = {
        nodesSlice: JSON.stringify({ originNodeIds: ids }),
        savedGraphs: JSON.stringify({ graphs: [] }),
        _persist: JSON.stringify({ version: -1, rehydrated: true }),
      };
      localStorage.setItem("persist:root", JSON.stringify(persistedRoot));
    },
    [originAId, originBId],
  );

  await page.goto("/#/graph");
  await page.locator(".selected-items-container").waitFor({ state: "visible" });
  await generateGraphAndSettle(page);

  const svg = page.locator("#chart-container-wrapper svg");
  await expect(svg).toBeVisible();
  await expect(svg).toHaveAttribute("data-sim-settled", "true", { timeout: 10000 });

  await expect(async () => {
    expect(await page.locator("g.node").count()).toBe(5);
  }).toPass({ timeout: 5000 });

  // Remove ORIGIN_B as an origin.
  const originBNode = page.locator("g.node").filter({ hasText: "Origin B" }).first();
  await originBNode.waitFor({ state: "visible" });
  const popup = await openNodeContextMenu(page, originBNode);
  const removeButton = popup.getByRole("button", { name: "Remove as origin", exact: true });
  await expect(removeButton).toBeVisible();
  await removeButton.click();

  await expect(async () => {
    expect(await page.locator("g.node").count()).toBe(3);
  }).toPass({ timeout: 5000 });
  await expect(page.locator("g.node").filter({ hasText: "Origin B" })).toHaveCount(0);

  // Undo the removal via the History panel.
  await page.getByRole("button", { name: /show options/i }).click();
  await page.getByRole("button", { name: /^history$/i }).click();
  await page.getByRole("button", { name: /undo/i }).click();

  // The graph regains ORIGIN_B and its unshared node.
  await expect(async () => {
    expect(await page.locator("g.node").count()).toBe(5);
  }).toPass({ timeout: 5000 });
  await expect(page.locator("g.node").filter({ hasText: "Origin B" })).toHaveCount(1);
  await expect(page.locator("g.node").filter({ hasText: "B Only" })).toHaveCount(1);

  // The Origins panel (live origins) also lists ORIGIN_B again (its display
  // name may not have resolved post-undo, so match on the raw id too).
  await page.getByRole("button", { name: /^origins \(\d+\)$/i }).click();
  const panel = page.getByRole("complementary", { name: /current origins/i });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Origin A");
  await expect(panel).toContainText(/Origin B|ORIGIN_B/);

  // The staging cart (nodesSlice, persisted) is resynced to match.
  await expect(async () => {
    const persisted = await page.evaluate(() => localStorage.getItem("persist:root"));
    const root = JSON.parse(persisted ?? "{}");
    const nodesSlice = JSON.parse(root.nodesSlice ?? "{}");
    expect((nodesSlice.originNodeIds || []).sort()).toEqual([originAId, originBId].sort());
  }).toPass({ timeout: 5000 });

  expect(filterErrorsContaining(await getCollectedErrors(page), "split").length).toBe(0);
});

test("Expanding a node then adding a new origin drops the expand-introduced straggler", async ({
  page,
}) => {
  test.setTimeout(60000);
  await installErrorInstrumentation(page);
  await setupMocks(page);

  // Only ORIGIN_A is seeded initially; ORIGIN_B is added later via the
  // context menu's "Add as origin" action.
  await page.addInitScript(
    (ids) => {
      const persistedRoot = {
        nodesSlice: JSON.stringify({ originNodeIds: ids }),
        savedGraphs: JSON.stringify({ graphs: [] }),
        _persist: JSON.stringify({ version: -1, rehydrated: true }),
      };
      localStorage.setItem("persist:root", JSON.stringify(persistedRoot));
    },
    [originAId],
  );

  await page.goto("/#/graph");
  await page.locator(".selected-items-container").waitFor({ state: "visible" });
  await generateGraphAndSettle(page);

  const svg = page.locator("#chart-container-wrapper svg");
  await expect(svg).toBeVisible();
  await expect(svg).toHaveAttribute("data-sim-settled", "true", { timeout: 10000 });

  // Origin A's neighborhood only: ORIGIN_A, SHARED, A_ONLY.
  await expect(async () => {
    expect(await page.locator("g.node").count()).toBe(3);
  }).toPass({ timeout: 5000 });

  // Expand A_ONLY to introduce a straggler node not covered by any origin's
  // captured neighborhood (expandNode never writes originSubgraphs).
  const aOnlyNode = page.locator("g.node").filter({ hasText: "A Only" }).first();
  await aOnlyNode.waitFor({ state: "visible" });
  const expandPopup = await openNodeContextMenu(page, aOnlyNode);
  const expandButton = expandPopup.getByRole("button", { name: "Expand", exact: true });
  await expect(expandButton).toBeVisible();
  await expandButton.click();

  await expect(async () => {
    expect(await page.locator("g.node").count()).toBe(4);
  }).toPass({ timeout: 5000 });
  await expect(page.locator("g.node").filter({ hasText: "Straggler Node" })).toHaveCount(1);

  // Promote SHARED (a node already in the canvas) to a second origin via its
  // "Add as origin" action. SHARED's mocked neighborhood mirrors A's set
  // ({SHARED, ORIGIN_A, A_ONLY}), so the composed union stays those three nodes
  // and drops STRAGGLER — which only ever entered D3 via the plain expand and
  // belongs to no origin's captured subgraph.
  const sharedNode = page.locator("g.node").filter({ hasText: "Shared Node" }).first();
  const popup = await openNodeContextMenu(page, sharedNode);
  const addButton = popup.getByRole("button", { name: "Add as origin", exact: true });
  await expect(addButton).toBeVisible();
  await addButton.click();

  // The composed union (A ∪ SHARED-as-origin) is authoritative: it does not
  // include STRAGGLER, which only ever existed in D3 via the plain expand
  // and was never captured into any origin's subgraph. If recompose/add were
  // still additive-only, STRAGGLER would remain stranded in D3 forever.
  await expect(async () => {
    expect(await page.locator("g.node").count()).toBe(3);
  }).toPass({ timeout: 5000 });
  await expect(page.locator("g.node").filter({ hasText: "Straggler Node" })).toHaveCount(0);

  expect(filterErrorsContaining(await getCollectedErrors(page), "split").length).toBe(0);
});
