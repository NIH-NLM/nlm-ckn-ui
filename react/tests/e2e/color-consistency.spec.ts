import { expect, test } from "@playwright/test";
import {
  filterErrorsContaining,
  getCollectedErrors,
  installErrorInstrumentation,
} from "./utils/errorInstrumentation";
import {
  hierarchyDeepChildren,
  hierarchyLabelsResponse,
  hierarchyRoot,
  smallGraphWithEdges,
} from "./utils/testSeeds";

const COLL = "TEST_DOCUMENT_COLLECTION";
// This color is defined in nlm-ckn-collection-maps.json for TEST_DOCUMENT_COLLECTION
const EXPECTED_COLOR = "#777777";

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

test.describe("Collection colors consistency", () => {
  test("Graph nodes use predefined collection color from config", async ({ page }) => {
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

    // Seed origin via redux-persist
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

    // Generate graph
    const generateBtn = page.getByRole("button", { name: /Generate Graph|Update Graph/i });
    await expect(generateBtn).toBeVisible();
    await generateBtn.click();

    // Wait for nodes to render
    const nodes = page.locator("g.node circle");
    await expect(async () => {
      const count = await nodes.count();
      expect(count).toBeGreaterThan(0);
    }).toPass();

    // Check that node circles have the expected fill color
    const firstNodeCircle = nodes.first();
    const fillColor = await firstNodeCircle.getAttribute("fill");

    // Color should match the predefined color for TEST_DOCUMENT_COLLECTION
    expect(fillColor?.toLowerCase()).toBe(EXPECTED_COLOR.toLowerCase());

    expect(filterErrorsContaining(await getCollectedErrors(page), "split").length).toBe(0);
  });

  test("Sunburst segments use predefined collection color from config", async ({ page }) => {
    await installErrorInstrumentation(page);

    const mockRoot = hierarchyRoot({ children: hierarchyDeepChildren(COLL), coll: COLL });

    // Mock the CL hierarchy endpoints.
    await page.route("**/arango_api/hierarchy/labels/", async (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(hierarchyLabelsResponse),
      });
    });
    await page.route("**/arango_api/hierarchy/", async (route) => {
      if (route.request().method() === "POST") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(mockRoot),
        });
      }
      return route.continue();
    });

    // Browse defaults to the tree, so ask for the sunburst explicitly
    await page.goto("/#/browse?view=sunburst");

    // Wait for SVG to be visible
    const svg = page.locator("#sunburst-container svg");
    await expect(svg).toBeVisible();

    // Wait for paths to render
    const paths = page.locator('#sunburst-container svg path[fill]:not([fill="none"])');
    await expect(async () => {
      const count = await paths.count();
      expect(count).toBeGreaterThan(0);
    }).toPass();

    // Check that at least one path has the expected collection color
    const pathColors = await paths.evaluateAll((elements) =>
      elements.map((el) => el.getAttribute("fill")?.toLowerCase()),
    );

    // At least one segment should have our test collection color
    expect(pathColors.some((c) => c === EXPECTED_COLOR.toLowerCase())).toBe(true);

    expect(filterErrorsContaining(await getCollectedErrors(page), "split").length).toBe(0);
  });

  test("Tree nodes use predefined collection color from config", async ({ page }) => {
    await installErrorInstrumentation(page);

    const mockApiResponse = hierarchyRoot({
      label: "Root",
      children: hierarchyDeepChildren(COLL),
      coll: COLL,
    });

    // Mock the CL hierarchy endpoints (used by Browse's tree view)
    await page.route("**/arango_api/hierarchy/labels/", async (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(hierarchyLabelsResponse),
      });
    });
    await page.route("**/arango_api/hierarchy/", async (route) => {
      if (route.request().method() === "POST") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(mockApiResponse),
        });
      }
      return route.continue();
    });

    // Navigate to Browse's tree view (Explore merged into Browse)
    await page.goto("/#/browse?view=tree");

    // Wait for SVG to be visible
    const container = page.locator(".tree-constructor-container");
    const svg = container.locator("svg");
    await expect(svg).toBeVisible();

    // Wait for node circles to render
    const nodeCircles = container.locator("g.node-group circle");
    await expect(async () => {
      const count = await nodeCircles.count();
      expect(count).toBeGreaterThan(0);
    }).toPass();

    // Check that node circles have the expected fill color
    const firstNodeCircle = nodeCircles.first();
    const fillColor = await firstNodeCircle.getAttribute("fill");

    // Color should match the predefined color for TEST_DOCUMENT_COLLECTION
    expect(fillColor?.toLowerCase()).toBe(EXPECTED_COLOR.toLowerCase());

    expect(filterErrorsContaining(await getCollectedErrors(page), "split").length).toBe(0);
  });

  test("Colors remain consistent when navigating between visualizations", async ({ page }) => {
    await installErrorInstrumentation(page);

    const originId = `${COLL}/ROOT`;
    // The sunburst view and the tree view share one fetched root (Browse's
    // whole point is not refetching on toggle), so one mock response covers
    // both.
    const mockRoot = hierarchyRoot({ children: hierarchyDeepChildren(COLL), coll: COLL });

    // Mock all APIs
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
          body: JSON.stringify(buildRawGraph(originId)),
        });
      }
      return route.continue();
    });

    await page.route("**/arango_api/hierarchy/labels/", async (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(hierarchyLabelsResponse),
      });
    });
    // Each page.goto below is a full reload, so Browse mounts fresh and
    // fetches its own root every time -- the same mock response serves the
    // sunburst view and the tree view since they share this one endpoint.
    await page.route("**/arango_api/hierarchy/", async (route) => {
      if (route.request().method() === "POST") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(mockRoot),
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

    // Seed origin for graph
    await page.addInitScript((origin) => {
      const persistedRoot = {
        nodesSlice: JSON.stringify({ originNodeIds: [origin] }),
        savedGraphs: JSON.stringify({ graphs: [] }),
        _persist: JSON.stringify({ version: -1, rehydrated: true }),
      };
      localStorage.setItem("persist:root", JSON.stringify(persistedRoot));
    }, originId);

    // 1. Start at Browse's sunburst view, capture color
    await page.goto("/#/browse?view=sunburst");
    const sunburstSvg = page.locator("#sunburst-container svg");
    await expect(sunburstSvg).toBeVisible();
    const sunburstPaths = page.locator('#sunburst-container svg path[fill]:not([fill="none"])');
    await expect(async () => {
      const count = await sunburstPaths.count();
      expect(count).toBeGreaterThan(0);
    }).toPass();
    const sunburstColors = await sunburstPaths.evaluateAll((elements) =>
      elements.map((el) => el.getAttribute("fill")?.toLowerCase()),
    );
    const sunburstHasExpectedColor = sunburstColors.some((c) => c === EXPECTED_COLOR.toLowerCase());

    // 2. Toggle to the tree view in place (Browse's whole point is not
    // refetching or remounting on toggle), verify same color.
    await page.getByRole("button", { name: /tree/i }).click();
    const treeContainer = page.locator(".tree-constructor-container");
    const treeSvg = treeContainer.locator("svg");
    await expect(treeSvg).toBeVisible();
    const treeCircles = treeContainer.locator("g.node-group circle");
    await expect(async () => {
      const count = await treeCircles.count();
      expect(count).toBeGreaterThan(0);
    }).toPass();
    const treeColor = await treeCircles.first().getAttribute("fill");

    // 3. Navigate to Graph, verify same color
    await page.goto("/#/graph");
    const generateBtn = page.getByRole("button", { name: /Generate Graph|Update Graph/i });
    await expect(generateBtn).toBeVisible();
    await generateBtn.click();
    const graphNodes = page.locator("g.node circle");
    await expect(async () => {
      const count = await graphNodes.count();
      expect(count).toBeGreaterThan(0);
    }).toPass();
    const graphColor = await graphNodes.first().getAttribute("fill");

    // All should use the same predefined color
    expect(sunburstHasExpectedColor).toBe(true);
    expect(treeColor?.toLowerCase()).toBe(EXPECTED_COLOR.toLowerCase());
    expect(graphColor?.toLowerCase()).toBe(EXPECTED_COLOR.toLowerCase());

    expect(filterErrorsContaining(await getCollectedErrors(page), "split").length).toBe(0);
  });
});
