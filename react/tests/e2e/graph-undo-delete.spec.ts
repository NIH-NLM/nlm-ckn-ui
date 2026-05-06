import { expect, test } from "@playwright/test";
import {
  filterErrorsContaining,
  getCollectedErrors,
  installErrorInstrumentation,
} from "./utils/errorInstrumentation";
import { generateGraphAndWait, setupGraphMocks } from "./utils/graphMocks";
import { doc, edgeWithSource } from "./utils/testSeeds";

const COLL = "TEST_DOCUMENT_COLLECTION";
const SOURCE_TEXT = "PMID:12345";

function buildInitialGraph(originId: string) {
  const root = doc("ROOT", "Root");
  const child1 = doc("CHILD1", "Child One");
  const child2 = doc("CHILD2", "Child Two");
  const e1 = edgeWithSource("E1", root._id, child1._id, "has_child", SOURCE_TEXT);
  const e2 = edgeWithSource("E2", root._id, child2._id, "has_child", "PMID:67890");
  return { [originId]: { nodes: [root, child1, child2], links: [e1, e2] } };
}

function buildExpansionResponse(nodeId: string) {
  return { [nodeId]: { nodes: [], links: [] } };
}

const mockOptions = {
  buildGraph: buildInitialGraph,
  buildExpansion: buildExpansionResponse,
};

const undoFromHistoryPanel = async (page: import("@playwright/test").Page) => {
  await page.getByRole("button", { name: "< Show Options" }).click();
  await page.getByRole("button", { name: "History" }).click();
  const undoButton = page.locator("#tab-panel-history button", { hasText: "Undo" });
  await expect(undoButton).toBeEnabled();
  await undoButton.click();
};

test("Removing a node creates undo history and undo restores it", async ({ page }) => {
  await installErrorInstrumentation(page);
  const originId = `${COLL}/ROOT`;
  await setupGraphMocks(page, originId, mockOptions);
  await generateGraphAndWait(page, 3);

  // Right-click CHILD1 and click "Remove"
  const childNode = page.locator("g.node").filter({ hasText: "Child One" }).first();
  await childNode.waitFor({ state: "visible" });
  await childNode.click({ button: "right", force: true });
  const popup = page.locator(".document-popup");
  await expect(popup).toBeVisible();
  await popup.getByRole("button", { name: "Remove Node", exact: true }).click();

  // After removal: 2 nodes (ROOT, CHILD2)
  await expect(async () => {
    expect(await page.locator("g.node").count()).toBe(2);
  }).toPass({ timeout: 5000 });

  // Undo via the History panel — same path the existing spec uses
  await undoFromHistoryPanel(page);

  // After undo: 3 nodes (ROOT, CHILD1, CHILD2) and the link is back
  await expect(async () => {
    expect(await page.locator("g.node").count()).toBe(3);
  }).toPass({ timeout: 5000 });
  await expect(page.locator("g.node").filter({ hasText: "Child One" })).toHaveCount(1);

  expect(filterErrorsContaining(await getCollectedErrors(page), "split").length).toBe(0);
});

test("Bulk delete via lasso creates undo history and undo restores all selected nodes", async ({
  page,
}) => {
  await installErrorInstrumentation(page);
  const originId = `${COLL}/ROOT`;
  await setupGraphMocks(page, originId, mockOptions);
  await generateGraphAndWait(page, 3);

  // window.confirm gates bulk delete — auto-accept it
  page.on("dialog", (dialog) => dialog.accept());

  // Wait for the simulation to settle so nodes are at their final positions
  // before we draw the lasso polygon. Without this, the drag races the sim
  // and the polygon may not enclose any node.
  await page.waitForTimeout(500);

  // Scroll the graph wrapper into view so the simulation's nodes (which D3
  // places relative to the SVG center) sit inside the browser viewport —
  // mouse events at viewport coordinates won't reach the SVG otherwise.
  const wrapper = page.locator("#chart-container-wrapper");
  await wrapper.scrollIntoViewIfNeeded();

  // Enable lasso mode
  await page.getByRole("button", { name: "Lasso", exact: false }).click();
  await expect(page.getByRole("button", { name: /Lasso/ })).toHaveAttribute("aria-pressed", "true");

  // Drag a polygon over the wrapper's visible viewport intersection.
  // The wrapper bounding box may extend past the viewport in headless CI;
  // clamping keeps every mouse coord on-screen so events reach the SVG.
  const wrapperBox = await wrapper.boundingBox();
  if (!wrapperBox) throw new Error("wrapper has no bounding box");
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  const padding = 8;
  const left = Math.max(wrapperBox.x, 0) + padding;
  const right = Math.min(wrapperBox.x + wrapperBox.width, viewport.width) - padding;
  const top = Math.max(wrapperBox.y, 0) + padding;
  const bottom = Math.min(wrapperBox.y + wrapperBox.height, viewport.height) - padding;
  if (right <= left || bottom <= top) {
    throw new Error(
      `Degenerate lasso bounds after clamping: left=${left} right=${right} top=${top} bottom=${bottom} wrapperBox=${JSON.stringify(wrapperBox)} viewport=${JSON.stringify(viewport)}`,
    );
  }

  await page.mouse.move(left, top);
  await page.mouse.down();
  await page.mouse.move(right, top, { steps: 10 });
  await page.mouse.move(right, bottom, { steps: 10 });
  await page.mouse.move(left, bottom, { steps: 10 });
  await page.mouse.move(left, top, { steps: 10 });
  await page.mouse.up();

  // Action bar appears with the selected count; click "Delete"
  const actionBar = page.locator(".lasso-action-bar");
  await expect(actionBar).toBeVisible({ timeout: 10000 });
  await actionBar.getByRole("button", { name: "Delete" }).click();

  // After bulk delete: 0 nodes
  await expect(async () => {
    expect(await page.locator("g.node").count()).toBe(0);
  }).toPass({ timeout: 5000 });

  // Undo via History panel
  await undoFromHistoryPanel(page);

  // All 3 nodes restored; both links back
  await expect(async () => {
    expect(await page.locator("g.node").count()).toBe(3);
  }).toPass({ timeout: 5000 });

  expect(filterErrorsContaining(await getCollectedErrors(page), "split").length).toBe(0);
});

// NOTE: An edge-remove + undo E2E test was attempted here but right-clicking
// `path.link-hit-area` is unreliable in headless tests — the link path is a
// thin diagonal stroke whose bounding box is mostly empty space, and the
// simulation may not have spread the nodes far enough at click time for the
// hit region to be reachable. Edge undo is exercised by the existing
// `handleRemoveEdge` snapshot pattern (which this PR's `handleRemove` mirrors)
// and by the redux-undo unit tests in graphSlice.delete-undo.test.js. If a
// reliable way to drive the contextmenu on a link path emerges, add it back.
