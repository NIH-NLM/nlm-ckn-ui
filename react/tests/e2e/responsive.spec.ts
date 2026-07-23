import { expect, test } from "@playwright/test";
import { smallGraphWithEdges } from "./utils/testSeeds";

// Routes that render without a backend (the header — where the overflow lives —
// is global, so these prove the fix app-wide).
const ROUTES = [
  ["home", "/#/"],
  ["about", "/#/about"],
  ["graph", "/#/graph"],
  ["not-found", "/#/invalid-route-xyz"],
];

for (const width of [390, 1200]) {
  for (const [name, path] of ROUTES) {
    test(`no horizontal overflow at ${width}px on ${name}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path, { waitUntil: "networkidle" });
      // Allow 1px for sub-pixel rounding.
      const overflow = await page.evaluate((w) => document.documentElement.scrollWidth - w, width);
      expect(overflow, `scrollWidth exceeds ${width}px by ${overflow}px`).toBeLessThanOrEqual(1);
    });
  }
}

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

test("options panel opens and closes on mobile without overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });

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

  await page.goto(`/#/collections/${TEST_COLL}/${originKey}`);

  const toggle = page.locator(".graph-workspace-canvas .toggle-options-button");
  const panel = page.locator(".graph-options-side-panel");

  // Open
  await toggle.click();
  await expect(panel).toBeInViewport();
  // Panel is inside the viewport horizontally (no overflow while open)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - 390);
  expect(overflow).toBeLessThanOrEqual(1);

  // Close — the toggle must remain reachable (not covered by the panel)
  await toggle.click();
  await expect(panel).not.toBeInViewport();
});
